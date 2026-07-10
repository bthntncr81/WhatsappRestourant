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
