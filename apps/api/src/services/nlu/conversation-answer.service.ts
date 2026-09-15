import OpenAI from 'openai';
import { getConfig } from '@whatres/config';
import prisma from '../../db/prisma';
import { menuService } from '../menu.service';
import { createLogger } from '../../logger';
import { CanonicalMenuExport } from '@whatres/shared';

const logger = createLogger();

/**
 * CONVERSATION ANSWER SERVICE
 * ---------------------------
 * Free-text answering layer for questions that are NOT an order action
 * ("gel al yapiyor musunuz", "icinde ne var", "ikisi arasinda fark ne",
 * "450 pahali degil mi", "en ucuz ne var").
 *
 * Design rules (see product spec):
 *  - The FULL published menu (name + category + price + DESCRIPTION) goes into
 *    the prompt. The model may never invent a product and may never claim a
 *    listed product does not exist.
 *  - Answers are short (1-3 sentences), warm, Turkish, NO emoji.
 *  - Prices are fixed: no discounts, no bargaining. A cheaper menu alternative
 *    may be suggested instead.
 *  - Off-topic (general chit-chat) is politely redirected once; on the second
 *    attempt the bot stops producing in that lane.
 *  - Never teaches the customer "what to type"; never leaks a raw error.
 */

/** Off-topic redirect texts. The first one carries a stable marker phrase
 *  ("siparis asistaniyim") that the flow layer counts in the message history
 *  to know a redirect was already spent in this conversation. */
export const OFF_TOPIC_FIRST =
  'Ben restoranin siparis asistaniyim, o konuda yardimci olamiyorum. Menumuz, urunlerimiz veya siparisiniz hakkinda her seyi sorabilirsiniz.';
export const OFF_TOPIC_FIRST_MARKER = 'siparis asistaniyim';
export const OFF_TOPIC_FINAL =
  'Bu konuda size yardimci olamiyorum. Siparisiniz icin buradayim.';
export const OFF_TOPIC_FINAL_MARKER = 'Siparisiniz icin buradayim';

/**
 * Marker inside TEMPLATES.greeting — used to enforce "greeting at most once".
 * MUST match the template's exact casing: Prisma `contains` is case-sensitive
 * on PostgreSQL, so 'Hosgeldiniz' would never match 'hosgeldiniz'.
 */
export const GREETING_MARKER = 'hosgeldiniz';

export type ConversationAnswerKind = 'answer' | 'redirect' | 'closed';

export interface ConversationAnswerResult {
  text: string;
  kind: ConversationAnswerKind;
}

export interface CartLine {
  name: string;
  qty: number;
  unitPrice: number;
  notes?: string | null;
}

export interface ConversationAnswerInput {
  tenantId: string;
  conversationId: string;
  /** Raw (non-normalized) customer text — keeps Turkish characters. */
  userText: string;
  /** Current draft cart, if any. */
  cart?: CartLine[] | null;
  cartTotal?: number | null;
  /** True when the customer is pushing back on price (rule 1). */
  priceObjection?: boolean;
  /** How many off-topic redirects were already sent in this conversation. */
  offTopicStrikes?: number;
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string', enum: ['restoran', 'diger'] },
    reply: { type: 'string' },
  },
  required: ['scope', 'reply'],
  additionalProperties: false,
} as const;

const LLM_TIMEOUT_MS = 12_000;
const HISTORY_TURNS = 8;
const MAX_REPLY_CHARS = 600;
/** Prompt budget for the menu block (~3k tokens worst case). */
const MAX_MENU_CHARS = 9_000;
/** Per-item description clip inside the menu block. */
const MAX_DESC_CHARS = 160;

export class ConversationAnswerService {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
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
   * Produce a conversational answer. Returns null when nothing could be
   * generated — the caller is then responsible for a context-appropriate
   * fallback (never a raw error message).
   */
  async answer(input: ConversationAnswerInput): Promise<ConversationAnswerResult | null> {
    const strikes = input.offTopicStrikes ?? 0;

    let menu: CanonicalMenuExport | null = null;
    try {
      menu = await menuService.getPublishedMenu(input.tenantId);
    } catch (error) {
      logger.warn({ error, tenantId: input.tenantId }, 'Conversation answer: menu load failed');
    }

    if (!this.client || !menu) {
      return null;
    }

    const menuBlock = this.buildMenuBlock(menu);
    if (!menuBlock) return null;

    const history = await this.getHistory(input.conversationId);
    const recentProducts = this.findRecentProducts(menu, history, input.userText);

    const system = this.buildSystemPrompt({
      menuBlock,
      cart: input.cart ?? null,
      cartTotal: input.cartTotal ?? null,
      recentProducts,
      priceObjection: !!input.priceObjection,
    });

    const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
    for (const turn of history.slice(-HISTORY_TURNS)) {
      messages.push({ role: turn.role, content: turn.content });
    }
    // The incoming message is usually already persisted as the last history
    // entry; only append it when it is not.
    const last = history[history.length - 1];
    if (!last || last.role !== 'user' || last.content !== input.userText) {
      messages.push({ role: 'user', content: input.userText });
    }

    let parsed: { scope: string; reply: string } | null = null;
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.config.openai.model,
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'conversation_answer',
              strict: true,
              schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
            },
          },
          temperature: 0.4,
          max_completion_tokens: 400,
        },
        { timeout: LLM_TIMEOUT_MS, maxRetries: 0 },
      );

      const content = response.choices[0]?.message?.content;
      if (content) {
        parsed = JSON.parse(content) as { scope: string; reply: string };
      }
    } catch (error) {
      logger.warn(
        { error, tenantId: input.tenantId, conversationId: input.conversationId },
        'Conversation answer generation failed',
      );
      return null;
    }

    if (!parsed) return null;

    // ---- Scope guard (rule 4): general chit-chat is redirected, not answered.
    // FALSE-POSITIVE GUARD: a message that names an actual menu product is a
    // restaurant message by definition, whatever the model labelled it. Without
    // this a misclassification would shut down a paying customer mid-order.
    if (parsed.scope === 'diger' && !this.mentionsMenuItem(menu, input.userText)) {
      return strikes >= 1
        ? { text: OFF_TOPIC_FINAL, kind: 'closed' }
        : { text: OFF_TOPIC_FIRST, kind: 'redirect' };
    }

    const text = this.sanitize(parsed.reply);
    if (!text) return null;

    return { text, kind: 'answer' };
  }

  // ==================== PROMPT ====================

  private buildSystemPrompt(opts: {
    menuBlock: string;
    cart: CartLine[] | null;
    cartTotal: number | null;
    recentProducts: string[];
    priceObjection: boolean;
  }): string {
    let prompt = `Sen bir restoranin WhatsApp siparis asistanisin. Musteriyle samimi, sicak ve kisa konusursun.

CEVAP KURALLARI:
- Turkce yaz. EN FAZLA 3 cumle, tercihen 1-2 cumle.
- ASLA emoji kullanma.
- ASLA musteriye "su kelimeyi yaz", "sunu yazin", "menu yazin" gibi talimat verme. Cevabin ya bir bilgi ya da baglama uygun net bir soru olsun.
- ASLA hata mesaji, sistem mesaji veya teknik detay yazma.
- Selamlama cumlesi kullanma; musteri zaten konusmanin icinde. Dogrudan sorusunu cevapla.

MENU KULLANIMI (COK ONEMLI):
- Asagidaki MENU listesi restoranin TAM menusudur. Baska urun YOKTUR.
- Listede olan bir urun icin ASLA "menumuzde yok" deme.
- Listede OLMAYAN bir urunu ASLA uydurma; o durumda menudeki en yakin alternatifi oner.
- Fiyatlari birebir listeden al, yuvarlama veya tahmin yapma.
- "Icinde ne var", "acili mi", "vejetaryen mi" gibi sorulari urun ACIKLAMASINDAN cevapla.
- Aciklamada bu bilgi yoksa UYDURMA. Soyle de: "Bunu net bilmiyorum, isterseniz siparis notuna ekleyeyim."

KARSILASTIRMA:
- "ikisi arasinda fark ne", "bu mu o mu", "hangisi daha iyi" gibi sorularda son konusulan urunleri baz al.
- Karsilastirmayi gercek icerik uzerinden yap: malzemeler (aciklama) + fiyat. Sadece isim ve fiyat sayma.

FIYAT POLITIKASI (COK ONEMLI):
- Fiyatlar sabittir. ASLA indirim, pazarlik, "size ozel yapariz", "bir seyler ayarlariz" gibi seyler soyleme.
- Musteri fiyati pahali bulursa once anlayisli ol, fiyatin nedenini urun icerigiyle kisaca acikla,
  sonra menudeki daha uygun fiyatli bir alternatifi oner. Ornek ton:
  "Anliyorum, Dort Peynirli 450 TL cunku dort cesit peynirden geliyor. Isterseniz Margherita 400 TL'ye daha uygun."

SIPARIS AKISI:
- Siparisi sen onaylamazsin, sepete sen ekleme yapmazsin. Sadece sorulari cevaplarsin.
- Musteri odeme sorarsa: odeme kapida nakit veya kart ile yapilir; odeme yontemi siparis onaylaninca secilir. IBAN / havale / EFT ile odeme alinmaz. Tutar sorulursa sepet toplamini soyle.
- Musteri onay oncesi adres verirse: "Adres bilginizi not aldim, teslimat adiminda kullanacagim." Adres detayi (kat, sirket, daire) SORMA.

KAPSAM (scope alani):
- "restoran": menu, urunler, icerik, fiyat, siparis, teslimat, gel al, sure, oneri, calisma saatleri, restoranla ilgili her sey.
- "diger": hava durumu, spor, siyaset, genel muhabbet, kisisel sorular, restoranla ilgisi olmayan her sey.
- scope "diger" ise reply alanini bos birak; sistem kendi yanitini kullanacak.

CIKTI: Sadece {"scope": "...", "reply": "..."} JSON'u dondur. Baska hicbir sey yazma.
`;

    prompt += `\n${opts.menuBlock}\n`;

    if (opts.recentProducts.length > 0) {
      prompt += `\nSON KONUSULAN URUNLER (isaret zamirleri "ikisi", "bu", "o", "sunu" bunlara baglanir, en yeni once): ${opts.recentProducts.join(', ')}\n`;
    }

    if (opts.cart && opts.cart.length > 0) {
      const lines = opts.cart
        .map((i) => {
          let line = `- ${i.qty}x ${i.name} (${i.unitPrice.toFixed(2)} TL)`;
          if (i.notes) line += ` - Not: ${i.notes}`;
          return line;
        })
        .join('\n');
      prompt += `\nMUSTERININ MEVCUT SEPETI:\n${lines}`;
      if (opts.cartTotal != null) {
        prompt += `\nSepet toplami: ${opts.cartTotal.toFixed(2)} TL`;
      }
      prompt += '\n';
    } else {
      prompt += '\nMUSTERININ SEPETI: bos.\n';
    }

    if (opts.priceObjection) {
      prompt +=
        '\nDIKKAT: Musteri fiyattan sikayetci. Once anlayis goster, fiyatin sabit oldugunu ima et ' +
        '(fiyati savunurken urunun icerigine dayan), sonra menuden daha uygun bir alternatif oner. ' +
        'Indirim veya pazarlik ASLA teklif etme, ozur dilercesine yalvarma.\n';
    }

    return prompt;
  }

  /**
   * Build the FULL menu block (name + price + description, grouped by
   * category). This is what stops the "menumuzde sadece Su var" hallucination:
   * the model sees every active item, not a fuzzy-matched subset.
   *
   * SIZE BUDGET: a 22-item sandbox menu is ~1.5 KB, but a real tenant can have
   * hundreds of items and long descriptions, which would blow up both latency
   * and the context window. Degradation is ordered so the completeness promise
   * survives as long as possible:
   *   1. clip each description,
   *   2. drop descriptions entirely (names + prices still complete),
   *   3. only then drop items — and in that case the header no longer claims
   *      the list is exhaustive, so the model does not tell a customer that a
   *      real product "does not exist".
   */
  private buildMenuBlock(menu: CanonicalMenuExport): string | null {
    const active = menu.categories
      .map((c) => ({ name: c.name, items: c.items.filter((i) => i.isActive) }))
      .filter((c) => c.items.length > 0);

    const itemCount = active.reduce((n, c) => n + c.items.length, 0);
    if (itemCount === 0) return null;

    const render = (withDescriptions: boolean, limit: number): { body: string; shown: number } => {
      const parts: string[] = [];
      let shown = 0;

      for (const category of active) {
        if (shown >= limit) break;
        const slice = category.items.slice(0, limit - shown);
        const lines = slice.map((item) => {
          const price = item.effectivePrice ?? item.basePrice;
          let line = `- ${item.name} - ${price.toFixed(2)} TL`;
          if (item.effectivePrice != null && item.effectivePrice < item.basePrice) {
            line += ` (liste fiyati ${item.basePrice.toFixed(2)} TL, indirimli)`;
          }
          if (withDescriptions) {
            const desc = (item.description || '').trim().replace(/\s+/g, ' ');
            if (desc) {
              line += ` | Icindekiler: ${
                desc.length > MAX_DESC_CHARS ? `${desc.substring(0, MAX_DESC_CHARS)}...` : desc
              }`;
            }
          }
          return line;
        });
        shown += slice.length;
        parts.push(`${category.name}:\n${lines.join('\n')}`);
      }

      return { body: parts.join('\n\n'), shown };
    };

    // 1. Everything, with clipped descriptions.
    let out = render(true, itemCount);
    // 2. Still too big → drop descriptions, keep every name and price.
    if (out.body.length > MAX_MENU_CHARS) {
      out = render(false, itemCount);
    }
    // 3. Still too big → cut items. Completeness claim is dropped with them.
    if (out.body.length > MAX_MENU_CHARS) {
      let limit = itemCount;
      while (out.body.length > MAX_MENU_CHARS && limit > 20) {
        limit = Math.floor(limit * 0.8);
        out = render(false, limit);
      }
      return (
        `MENU (KISMI LISTE - ${out.shown}/${itemCount} urun gosteriliyor; ` +
        `listede gormedigin bir urun icin "yok" DEME, bilmedigini soyle):\n\n${out.body}`
      );
    }

    return `MENU (TAM LISTE - toplam ${itemCount} urun, bunlardan baska urun yoktur):\n\n${out.body}`;
  }

  /**
   * Does the customer's message name an actual menu product? Whole-word match
   * on the normalized text, so "su" matches "su ver" but not "susadim".
   */
  private mentionsMenuItem(menu: CanonicalMenuExport, userText: string): boolean {
    const haystack = ` ${this.normalize(userText)} `;
    if (haystack.trim().length === 0) return false;

    for (const category of menu.categories) {
      for (const item of category.items) {
        if (!item.isActive) continue;
        const name = this.normalize(item.name);
        if (name.length < 2) continue;
        if (haystack.includes(` ${name} `)) return true;
      }
    }
    return false;
  }

  // ==================== CONTEXT ====================

  private async getHistory(
    conversationId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    try {
      const messages = await prisma.message.findMany({
        where: { conversationId, kind: 'TEXT', text: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 12,
      });
      return messages
        .reverse()
        .map((m) => ({
          role: m.direction === 'IN' ? ('user' as const) : ('assistant' as const),
          content: m.text as string,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Resolve which menu products were mentioned most recently (by the customer
   * or by the bot). Feeds pronoun resolution for comparison questions.
   */
  private findRecentProducts(
    menu: CanonicalMenuExport,
    history: Array<{ role: string; content: string }>,
    userText: string,
  ): string[] {
    const names = menu.categories.flatMap((c) =>
      c.items.filter((i) => i.isActive).map((i) => i.name),
    );
    if (names.length === 0) return [];

    const found: string[] = [];
    const haystack = [...history.slice(-6).map((m) => m.content), userText].reverse();

    for (const text of haystack) {
      const norm = this.normalize(text);
      for (const name of names) {
        const normName = this.normalize(name);
        if (normName.length >= 3 && norm.includes(normName) && !found.includes(name)) {
          found.push(name);
        }
      }
      if (found.length >= 4) break;
    }

    return found.slice(0, 4);
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Strip emoji, collapse whitespace, hard-cap length. */
  private sanitize(raw: string): string {
    const noEmoji = stripEmoji(raw);
    const clean = noEmoji.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) return '';
    return clean.length > MAX_REPLY_CHARS
      ? `${clean.substring(0, MAX_REPLY_CHARS).trimEnd()}...`
      : clean;
  }
}

/** Remove emoji / pictographs / variation selectors from bot output. */
export function stripEmoji(text: string): string {
  return text
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{2190}-\u{21FF}\u{2B50}\u{2705}\u{274C}\u{2757}\u{2764}]/gu,
      '',
    )
    .replace(/ {2,}/g, ' ');
}

export const conversationAnswerService = new ConversationAnswerService();
