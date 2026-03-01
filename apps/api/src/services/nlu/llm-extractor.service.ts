import OpenAI from 'openai';
import { getConfig } from '@whatres/config';
import { createLogger } from '../../logger';
import {
  MenuCandidateDto,
  LlmExtractionResponse,
  LLM_EXTRACTION_SCHEMA,
} from '@whatres/shared';

const logger = createLogger();

/**
 * System prompt prefix - kept stable for prompt caching
 * This part should remain identical across requests to benefit from caching
 */
const SYSTEM_PROMPT_PREFIX = `Sen bir restoran siparis asistanisin. Musterinin mesajindan siparis detaylarini cikarman gerekiyor.

GOREV:
1. Musterinin mesajini analiz et
2. Verilen menu adaylari icinden siparis edilen urunleri belirle
3. Miktarlari, secenekleri ve ekstra istekleri cikar
4. Belirsizlik varsa aciklayici soru sor

TURKCE MIKTAR KELIMELERI:
- bir=1, iki=2, uc=3, dort=4, bes=5, alti=6, yedi=7, sekiz=8, dokuz=9, on=10
- "tane", "adet" = miktar belirteci (orn: "iki tane" = 2)
- "cift" = 2 (orn: "bir cift lahmacun" = 2)
- Miktar belirtilmemisse 1 kabul et

OLUMSUZLUK / OZEL ISTEK:
- "olmadan", "haris", "-siz", "-suz", "-siz", "-suz" = istenmeyen malzeme
  Ornek: "sosusuz", "aci olmadan", "sogansiz"
  → notes alanina yaz (orn: "Sos olmadan"), optionSelections'a EKLEME
- "ekstra", "fazla", "bol" = ekstra istek
  Ornek: "ekstra sos", "bol sogan"
  → extras alanina yaz

GENEL SIPARIS NOTLARI (orderNotes):
- Teslimat veya siparis geneline dair notlar → orderNotes alanina yaz
  Ornek: "zile basmayin", "kapiya birakin", "aramadan gelin", "acele olsun", "catal kaşık koymayin"
- Bu notlar belirli bir urune ait DEGiL, tum siparise ait
- Urun-spesifik notlar (orn: "sogansiz") → item.notes alanina yaz (orderNotes'a DEGIL)

DEGISIKLIK KOMUTLARI (action alani):
- "ekle", "bir de ... istiyorum", "... da ekle" → action: "add"
- "cikar", "kaldir", "istemiyorum", "iptal" → action: "remove"
- Mevcut sipariste degisiklik yoksa → action: "keep"
- Yeni siparis (mevcut siparis yoksa) → tum itemler action: "add"

SELAMLAMA vs SIPARIS:
- "merhaba", "selam", "iyi gunler", "nasilsiniz" gibi selamlasmalar:
  Eger SADECE selamlama varsa → items: [], confidence: 0.1, clarificationQuestion: null
  Eger selamlama + siparis varsa (orn: "merhaba bir doner istiyorum") → siparisi cikar

KISA CEVAPLAR (BAGLAM):
- Eger onceki mesajda soru sorulduysa (orn: "Et Doner mi Tavuk Doner mi?")
  ve musteri kisa cevap verdiyse (orn: "tavuk", "et", "acili")
  → Bu cevabi onceki sorunun baglaminda degerlendir

ZORUNLU OPSIYONLAR:
- Eger bir urunun zorunlu opsiyon grubu varsa ve musteri belirtmediyse:
  → clarificationQuestion ile sor (orn: "Et Doner mi Tavuk Doner mi istersiniz?")
  → confidence'i 0.5-0.6 yap

BENZER ISIMLI URUNLER (COK ONEMLI):
- Eger musteri genel bir isim soylerse (orn: "doner", "burger", "pizza") ve menude bu ismi iceren BIRDEN FAZLA urun varsa:
  → ASLA kendin secme! Mutlaka clarificationQuestion ile sor.
  → Ornek: "doner" → menude "Et Doner" ve "Tavuk Doner" varsa → "Doner olarak hangisini istersiniz: Et Doner mi, Tavuk Doner mi?"
  → Ornek: "burger" → menude 4 burger varsa → "Burger olarak hangisini istersiniz: Klasik, Cheese, Double, Tavuk?"
  → Bu durumda items dizisine o urunu EKLEME, bos birak ve soruyu sor
  → confidence'i 0.4-0.5 yap
- Eger musteri spesifik isim soylerse (orn: "et doner", "tavuk burger", "cheese burger"):
  → Direkt eslestirebilirsin, soru sormana gerek yok

CONFIDENCE SKORU:
- 0.9-1.0: Siparis tamamen net, tum opsiyonlar secili
- 0.7-0.9: Buyuk oranda net, kucuk varsayimlar var
- 0.5-0.7: Belirsizlik var, onay gerekli
- 0.0-0.5: Cok belirsiz, mutlaka soru sor
- Selamlama/sohbet: 0.0-0.1

KURALLAR:
- Sadece verilen menu adaylari (candidates) icinden secim yap
- Mevcut siparis varsa, her mevcut item icin action: "keep" kullan (degisiklik yoksa)
- Yeni eklenen itemler icin action: "add"
- Cikarilmak istenen itemler icin action: "remove"
- Eger musteri menude olmayan bir sey istiyorsa, clarificationQuestion ile en yakin alternatifi oner
`;

/**
 * Build dynamic part of system prompt with menu candidates
 */
function buildCandidatesPrompt(
  candidates: MenuCandidateDto[],
  optionGroups: Map<
    string,
    Array<{
      id: string;
      name: string;
      type: 'SINGLE' | 'MULTI';
      required: boolean;
      options: Array<{
        id: string;
        name: string;
        priceDelta: number;
        isDefault: boolean;
      }>;
    }>
  >
): string {
  if (candidates.length === 0) {
    return '\nMENU ADAYLARI: Menude eslesen urun bulunamadi.';
  }

  let prompt = '\nMENU ADAYLARI:\n';

  for (const candidate of candidates) {
    prompt += `\n[${candidate.menuItemId}] ${candidate.name} (${candidate.category}) - ${candidate.basePrice} TL`;

    if (candidate.synonymsMatched.length > 0) {
      prompt += ` (ayrica: ${candidate.synonymsMatched.join(', ')})`;
    }

    // Add option groups for this item
    const groups = optionGroups.get(candidate.menuItemId);
    if (groups && groups.length > 0) {
      for (const group of groups) {
        const reqLabel = group.required ? ' (zorunlu)' : '';
        const typeLabel = group.type === 'SINGLE' ? 'tek sec' : 'coklu sec';
        prompt += `\n  - ${group.name}${reqLabel} [${typeLabel}]: `;
        prompt += group.options
          .map((opt) => {
            const delta = opt.priceDelta > 0 ? ` +${opt.priceDelta}TL` : '';
            const def = opt.isDefault ? ' (varsayilan)' : '';
            return `${opt.name}${delta}${def}`;
          })
          .join(', ');
      }
    }
  }

  return prompt;
}

/**
 * Build existing order context for follow-up messages
 */
function buildExistingOrderContext(existingOrderContext?: string): string {
  if (!existingOrderContext) {
    return '';
  }
  return `\n\nMEVCUT SIPARIS:\n${existingOrderContext}\nMusteri yeni bir sey ekliyorsa action:"add", cikariyorsa action:"remove", mevcut itemlere dokunmuyorsa action:"keep" kullan.`;
}

export class LlmOrderExtractorService {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
    if (this.config.openai.apiKey) {
      this.client = new OpenAI({
        apiKey: this.config.openai.apiKey,
      });
    } else {
      logger.warn('OpenAI API key not configured - LLM extraction disabled');
    }
  }

  /**
   * Check if LLM service is available
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Extract order from user text using OpenAI Structured Outputs
   */
  async extractOrder(
    userText: string,
    candidates: MenuCandidateDto[],
    optionGroups: Map<
      string,
      Array<{
        id: string;
        name: string;
        type: 'SINGLE' | 'MULTI';
        required: boolean;
        options: Array<{
          id: string;
          name: string;
          priceDelta: number;
          isDefault: boolean;
        }>;
      }>
    >,
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
    existingOrderContext?: string
  ): Promise<LlmExtractionResponse> {
    if (!this.client) {
      throw new Error('OpenAI client not configured');
    }

    const startTime = Date.now();

    // Build system prompt with candidates and existing order context
    const systemPrompt =
      SYSTEM_PROMPT_PREFIX +
      buildCandidatesPrompt(candidates, optionGroups) +
      buildExistingOrderContext(existingOrderContext);

    // Build messages
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history if provided (last 8 messages for better context)
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory.slice(-8)) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add current user message
    messages.push({ role: 'user', content: userText });

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.openai.model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'order_extraction',
            strict: true,
            schema: LLM_EXTRACTION_SCHEMA,
          },
        },
        temperature: 0.3,
        max_completion_tokens: 1024,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const result = JSON.parse(content) as LlmExtractionResponse;

      logger.info(
        {
          userText: userText.substring(0, 50),
          candidatesCount: candidates.length,
          itemsExtracted: result.items.length,
          confidence: result.confidence,
          needsClarification: !!result.clarificationQuestion,
          hasExistingOrder: !!existingOrderContext,
          durationMs: Date.now() - startTime,
          tokensUsed: response.usage?.total_tokens,
        },
        'LLM extraction completed'
      );

      return result;
    } catch (error) {
      logger.error({ error }, 'LLM extraction failed');
      throw error;
    }
  }

  /**
   * Simple template-based summary (no LLM call needed)
   */
  generateSimpleSummary(
    items: Array<{
      name: string;
      qty: number;
      options: string[];
      price: number;
      notes?: string | null;
    }>,
    totalPrice: number,
    orderNotes?: string | null,
  ): string {
    const itemLines = items
      .map((item) => {
        let line = `  ${item.qty}x ${item.name}`;
        if (item.options.length > 0) {
          line += ` (${item.options.join(', ')})`;
        }
        line += ` - ${item.price.toFixed(2)} TL`;
        if (item.notes) {
          line += `\n    Not: ${item.notes}`;
        }
        return line;
      })
      .join('\n');

    let msg = `Siparisiniz:\n\n${itemLines}\n\nToplam: ${totalPrice.toFixed(2)} TL`;
    if (orderNotes) {
      msg += `\n\nNot: ${orderNotes}`;
    }
    msg += '\n\nBaska eklemek icin yazin, onaylamak icin "evet" yazin.';
    return msg;
  }
}

export const llmExtractorService = new LlmOrderExtractorService();
