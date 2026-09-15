import OpenAI from 'openai';
import { getConfig } from '@whatres/config';
import { createLogger } from '../../logger';

const logger = createLogger();

/**
 * Stage-1 intent analysis (runs on EVERY guest message when the AI router
 * is enabled). Uses the SAME OpenAI-compatible local LLM (Ollama/Qwen)
 * configuration as llm-extractor.service.ts — free, low latency.
 *
 * The result is used ONLY for reply-model routing (haiku/sonnet/local) and
 * the negative-constraint order gate. It does NOT replace the existing NLU
 * order extraction.
 */

export interface IntentAnalysis {
  /** ISO-ish language guess of the message, e.g. 'tr', 'en' */
  language: string | null;
  /** Free-form intent labels detected in the message */
  intents: string[];
  /** Number of distinct actionable intents (order, change, cancel, ask...) */
  actionableIntentCount: number;
  urgency: 'low' | 'normal' | 'high';
  /** True when the message is a confirmation ("evet", "tamam", "aynen"...) */
  isConfirmation: boolean;
  /** True when the message contains a restrictive/negative constraint */
  negativeConstraint: boolean;
  /** The constraint text, if any (e.g. "sogan olmasin") */
  negativeConstraintText: string | null;
}

/**
 * LLM-free negative-constraint detector (single-line regex).
 * Input is diacritic-folded first so it matches both raw Turkish text
 * ("olmasın", "hariç", "dışında") and normalizeTr()'ed text ("olmasin").
 * Source pattern: /(sadece|yalnız(?:ca)?|hariç|olmasın|istemiyorum|koyma|ekleme|açma|dışında)/i
 */
export const NEGATIVE_CONSTRAINT_REGEX =
  /(sadece|yalniz(?:ca)?|haric|olmasin|istemiyorum|koyma|ekleme|acma|disinda)/i;

function foldTr(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o');
}

export function detectNegativeConstraint(text: string): boolean {
  return NEGATIVE_CONSTRAINT_REGEX.test(foldTr(text || ''));
}

/**
 * A restrictive request the customer attached to an order ("sadece
 * mozerella", "sogan olmasin"). It is written onto the order as a note — it
 * never blocks or silences the order flow.
 */
export interface SpecialRequest {
  kind: 'only' | 'exclude' | 'other';
  /** Customer wording (original Turkish spelling), <= 80 chars */
  note: string;
}

/**
 * Fold char-by-char so every index in the folded string points at the same
 * character of the original — the returned note can then keep the customer's
 * own spelling ("soğan olmasın", not "sogan olmasin").
 */
function foldTrAligned(text: string): string {
  let out = '';
  for (const ch of text) {
    let lower = ch.toLocaleLowerCase('tr');
    if (lower.length !== 1) lower = ch.toLowerCase().charAt(0) || ch;
    out += lower
      .replace('ı', 'i')
      .replace('ş', 's')
      .replace('ç', 'c')
      .replace('ğ', 'g')
      .replace('ü', 'u')
      .replace('ö', 'o');
    // Astral characters (emoji) are 2 UTF-16 units: keep lengths aligned.
    if (ch.length === 2) out += ' ';
  }
  return out;
}

const ONLY_STOP_WORDS = new Set([
  'olacak', 'olsun', 'olsa', 'lutfen', 'koyun', 'ekleyin', 'istiyorum', 've',
  'olmali', 'olarak', 'olur', 'olmasi',
]);
const QUANTITY_WORDS = new Set(['bir', 'iki', 'uc', 'dort', 'bes', 'tane', 'adet', 'yarim']);
const LOGISTICS_WORDS = ['paket', 'gel', 'al', 'nakit', 'kart', 'kapida', 'konum', 'adres', 'siparis', 'bu', 'bunu', 'onu', 'su'];
const EXCLUDE_VERBS = new Set([
  'olmasin', 'olmadan', 'koyma', 'koymayin', 'koymasin', 'istemiyorum',
  'haric', 'disinda', 'ekleme', 'eklemeyin',
]);
// Words that never name an ingredient. "artik istemiyorum" / "yok istemiyorum"
// are a general refusal: as a note they told the kitchen "Ozel istek: artik
// istemiyorum" and flipped every removal into a keep.
const GENERIC_WORDS = new Set([
  'siparis', 'siparisi', 'siparisim', 'siparisimi', 'bunu', 'onu', 'sunu', 'hic', 'hicbir', 'sey', 'bir', 'ben', 'biz',
  'artik', 'yok', 'simdi', 'hicbirini', 'hepsini', 'tumunu', 'vazgectim', 'baska', 'bunlari', 'bunlar', 'hepsi',
  'onlari', 'sunlari', 'kadar', 'tamam', 'evet', 'hayir',
]);
// "sadece bu kadar", "evet sadece bunlar" = "that's all", not "only X".
const FILLER_ONLY = new Set(['bu', 'bunlar', 'bunlari', 'bunu', 'kadar', 'baska', 'hepsi', 'o', 'onlar', 'su', 'sunlar', 'bukadar']);
// Product-type words: excluding one of these removes a product, it is not an ingredient note.
const PRODUCT_TYPE_STEMS = [
  'icece', 'tatli', 'yemek', 'urun', 'menu', 'siparis', 'pizza', 'sandvic', 'makarna', 'burger', 'salata',
  'corba', 'kola', 'ayran', 'soda', 'gazoz', 'meyve suyu', 'tatlilar',
];

function foldWords(text: string): string[] {
  return foldTrAligned(text || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Does an exclusion note ("kolayi istemiyorum") name the removed PRODUCT
 * itself rather than an ingredient of it ("sogan istemiyorum")?
 * `productTexts` are the removed item's name, category and matched synonyms.
 * True → the extractor's removal is real and must not become a note.
 */
export function exclusionNamesProduct(note: string, productTexts: string[]): boolean {
  const noteWords = foldWords(note).filter(
    (w) => w.length >= 3 && !EXCLUDE_VERBS.has(w) && !GENERIC_WORDS.has(w) && w !== 'sade',
  );
  if (noteWords.length === 0) return true;
  const productWords = productTexts.flatMap(foldWords).filter((w) => w.length >= 3);
  return noteWords.some(
    (w) =>
      PRODUCT_TYPE_STEMS.some((s) => w.startsWith(s)) ||
      productWords.some((p) => w.startsWith(p) || p.startsWith(w) || commonPrefixLen(w, p) >= 5),
  );
}

/**
 * Turn a negative-constraint message into an order note.
 *
 * Returns null whenever the wording is really about quantity ("sadece 1
 * kola"), a product ("kola istemiyorum" = remove), logistics ("sadece
 * nakit") or nothing specific — a null must never block or change the order.
 *
 * `candidateNames` are menu item names AND matched synonyms from THIS message:
 * "sadece kola" means "only that product", not an ingredient, and "kolayi
 * istemiyorum" (matched via the synonym "kola" of "Coca Cola") is a removal.
 * `categoryNames` are matched with a looser stem ("tatliyi" ~ "Tatlilar").
 */
export function deriveSpecialRequest(
  rawText: string,
  negativeConstraintText: string | null | undefined,
  candidateNames: string[],
  categoryNames: string[] = [],
): SpecialRequest | null {
  const raw = rawText || '';
  const folded = foldTrAligned(raw);
  const tokens: Array<{ w: string; start: number; end: number }> = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(folded)) !== null) {
    tokens.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (tokens.length === 0) return null;

  // A clause break (punctuation) between token i-1 and token i
  const breakBefore = (i: number): boolean =>
    i <= 0 || /[,.;:!?\n]/.test(folded.slice(tokens[i - 1].end, tokens[i].start));

  const nameWords = candidateNames
    .flatMap((n) => foldTrAligned(n).split(/[^\p{L}\p{N}]+/u))
    .filter((w) => w.length >= 3);
  const categoryWords = categoryNames
    .flatMap((n) => foldTrAligned(n).split(/[^\p{L}\p{N}]+/u))
    .filter((w) => w.length >= 5);
  const isNameWord = (w: string) =>
    w.length >= 3 &&
    (nameWords.some((nw) => w.startsWith(nw) || nw.startsWith(w)) ||
      categoryWords.some((cw) => commonPrefixLen(w, cw) >= 5));
  const cap = (s: string) => (s.length > 80 ? s.substring(0, 80).trim() : s);
  const withSade = (note: string) =>
    tokens.some((t) => t.w === 'sade') && !/\bsade\b/i.test(foldTrAligned(note)) ? `${note}, sade` : note;

  // ---- 'only': "sadece X", "yalnizca X"
  const onlyIdx = tokens.findIndex((t) => t.w === 'sadece' || t.w === 'yalniz' || t.w === 'yalnizca');
  if (onlyIdx >= 0) {
    const taken: number[] = [];
    for (let j = onlyIdx + 1; j < tokens.length && taken.length < 3; j++) {
      if (breakBefore(j) || ONLY_STOP_WORDS.has(tokens[j].w)) break;
      taken.push(j);
    }
    if (taken.length > 0) {
      const first = tokens[taken[0]].w;
      const rejected =
        /^\d+$/.test(first) ||
        QUANTITY_WORDS.has(first) ||
        LOGISTICS_WORDS.some((l) => first === l || (l.length >= 4 && first.startsWith(l))) ||
        taken.every((j) => isNameWord(tokens[j].w)) ||
        taken.every((j) => FILLER_ONLY.has(tokens[j].w));
      if (!rejected) {
        const span = raw.slice(tokens[taken[0]].start, tokens[taken[taken.length - 1]].end);
        return { kind: 'only', note: cap(withSade(`Sadece ${span}`)) };
      }
    }
  }

  // ---- 'exclude': "sogan olmasin", "aci sos koymayin"
  for (let k = 0; k < tokens.length; k++) {
    if (!EXCLUDE_VERBS.has(tokens[k].w)) continue;
    // "ekleme yapabilir miyim" is not "do not add": only a clause-final ekleme counts
    if (tokens[k].w === 'ekleme' && k + 1 < tokens.length && !breakBefore(k + 1)) continue;
    const taken: number[] = [];
    for (let j = k - 1; j >= 0 && taken.length < 2; j--) {
      if (breakBefore(j + 1)) break;
      const w = tokens[j].w;
      if (GENERIC_WORDS.has(w) || isNameWord(w) || /^\d+$/.test(w)) break;
      taken.unshift(j);
    }
    if (taken.length === 0) continue;
    const span = raw.slice(tokens[taken[0]].start, tokens[k].end);
    return { kind: 'exclude', note: cap(withSade(span)) };
  }

  // ---- 'other': the analysis model's own constraint text, when it is not
  // just a product name or a quantity.
  const t = (negativeConstraintText || '').trim();
  if (t.length >= 3 && t.length <= 80) {
    const tw = foldTrAligned(t).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const meaningful = tw.filter(
      (w) => !isNameWord(w) && !QUANTITY_WORDS.has(w) && !/^\d+$/.test(w) && !GENERIC_WORDS.has(w)
        && w !== 'sadece' && !EXCLUDE_VERBS.has(w) && !FILLER_ONLY.has(w),
    );
    if (meaningful.length > 0) return { kind: 'other', note: cap(t) };
  }

  return null;
}

const ANALYSIS_SYSTEM_PROMPT = `Sen bir restoran WhatsApp asistaninin mesaj analiz motorusun.
Gorevin SADECE analiz: musteri mesajini incele ve asagidaki JSON semasina birebir uyan TEK bir JSON nesnesi dondur. JSON disinda HICBIR sey yazma (aciklama, markdown, kod blogu YOK).

Sema:
{
  "language": string,              // mesajin dili, or. "tr", "en"
  "intents": string[],             // tespit edilen niyetler, or. ["order_item","ask_question"]
  "actionableIntentCount": number, // aksiyon gerektiren FARKLI niyet sayisi (siparis verme, urun degistirme, iptal, adres bildirme, soru sorma...). Selamlasma/tesekkur aksiyon DEGILDIR.
  "urgency": "low"|"normal"|"high",// aciliyet ("acele","hemen","bekliyorum" -> high)
  "isConfirmation": boolean,       // mesaj bir onay mi ("evet","tamam","aynen","dogru")
  "negativeConstraint": boolean,   // kisitlayici/olumsuz bir ozel istek var mi ("sogan olmasin","sadece ketcap","aci haric","X istemiyorum","sos koyma")
  "negativeConstraintText": string|null // varsa kisitin kisa metni, yoksa null
}`;

export class IntentAnalysisService {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
    // Reuse the exact same OpenAI-compatible client configuration as
    // llm-extractor.service.ts (same OPENAI_API_KEY / OPENAI_BASE_URL /
    // OPENAI_MODEL env vars → local Ollama/Qwen when baseUrl is set).
    if (this.config.openai.apiKey) {
      this.client = new OpenAI({
        apiKey: this.config.openai.apiKey,
        baseURL: this.config.openai.baseUrl,
      });
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Analyze a guest message. Returns null when the local LLM is not
   * configured, crashes, times out, or returns unparseable JSON — callers
   * must treat null as "no analysis" and fall back gracefully.
   * The regex detector is OR'ed into negativeConstraint on success.
   */
  async analyze(userText: string): Promise<IntentAnalysis | null> {
    if (!this.client) return null;

    const startTime = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.openai.model,
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_completion_tokens: 512,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        logger.warn(
          { content: content.substring(0, 200) },
          'Intent analysis returned non-JSON output'
        );
        return null;
      }

      const analysis: IntentAnalysis = {
        language: typeof parsed.language === 'string' ? parsed.language : null,
        intents: Array.isArray(parsed.intents)
          ? parsed.intents.filter((i: unknown) => typeof i === 'string')
          : [],
        actionableIntentCount:
          typeof parsed.actionableIntentCount === 'number' &&
          Number.isFinite(parsed.actionableIntentCount)
            ? Math.max(0, Math.round(parsed.actionableIntentCount))
            : 0,
        urgency: ['low', 'normal', 'high'].includes(parsed.urgency)
          ? parsed.urgency
          : 'normal',
        isConfirmation: parsed.isConfirmation === true,
        // OR the LLM verdict with the LLM-free regex detector
        negativeConstraint:
          parsed.negativeConstraint === true || detectNegativeConstraint(userText),
        negativeConstraintText:
          typeof parsed.negativeConstraintText === 'string' &&
          parsed.negativeConstraintText.length > 0
            ? parsed.negativeConstraintText
            : null,
      };

      logger.info(
        {
          language: analysis.language,
          actionableIntentCount: analysis.actionableIntentCount,
          negativeConstraint: analysis.negativeConstraint,
          durationMs: Date.now() - startTime,
        },
        'Intent analysis completed'
      );

      return analysis;
    } catch (error) {
      // Local Qwen down/unreachable → null, caller falls back
      logger.warn({ error }, 'Intent analysis failed, falling back to null');
      return null;
    }
  }
}

export const intentAnalysisService = new IntentAnalysisService();
