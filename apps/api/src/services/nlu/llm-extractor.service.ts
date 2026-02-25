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
const SYSTEM_PROMPT_PREFIX = `Sen bir restoran sipariş asistanısın. Müşterinin mesajından sipariş detaylarını çıkarman gerekiyor.

GÖREV:
1. Müşterinin mesajını analiz et
2. Verilen menü adayları içinden sipariş edilen ürünleri belirle
3. Miktarları, seçenekleri ve ekstra istekleri çıkar
4. Belirsizlik varsa açıklayıcı soru sor

KURALLAR:
- Sadece verilen menü adayları (candidates) içinden seçim yap
- Eğer müşteri menüde olmayan bir şey istiyorsa, en yakın alternatifi öner
- Miktar belirtilmemişse 1 kabul et
- Belirsiz durumlarda clarificationQuestion ile sor
- Confidence skoru:
  - 0.9-1.0: Sipariş tamamen net
  - 0.7-0.9: Büyük oranda net, küçük varsayımlar var
  - 0.5-0.7: Belirsizlik var, onay gerekli
  - 0.0-0.5: Çok belirsiz, mutlaka soru sor
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
    return '\nMENÜ ADAYLARI: Menüde eşleşen ürün bulunamadı.';
  }

  let prompt = '\nMENÜ ADAYLARI:\n';

  for (const candidate of candidates) {
    prompt += `\n[${candidate.menuItemId}] ${candidate.name} (${candidate.category}) - ${candidate.basePrice} TL`;
    
    if (candidate.synonymsMatched.length > 0) {
      prompt += ` (ayrıca: ${candidate.synonymsMatched.join(', ')})`;
    }

    // Add option groups for this item
    const groups = optionGroups.get(candidate.menuItemId);
    if (groups && groups.length > 0) {
      for (const group of groups) {
        const reqLabel = group.required ? ' (zorunlu)' : '';
        const typeLabel = group.type === 'SINGLE' ? 'tek seç' : 'çoklu seç';
        prompt += `\n  - ${group.name}${reqLabel} [${typeLabel}]: `;
        prompt += group.options
          .map((opt) => {
            const delta = opt.priceDelta > 0 ? ` +${opt.priceDelta}TL` : '';
            const def = opt.isDefault ? ' (varsayılan)' : '';
            return `${opt.name}${delta}${def}`;
          })
          .join(', ');
      }
    }
  }

  return prompt;
}

export class LlmOrderExtractorService {
  private client: OpenAI | null = null;
  private config = getConfig();

  constructor() {
    if (this.config.openai.apiKey) {
      this.client = new OpenAI({
        apiKey: this.config.openai.apiKey,
        organization: this.config.openai.orgId,
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
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<LlmExtractionResponse> {
    if (!this.client) {
      throw new Error('OpenAI client not configured');
    }

    const startTime = Date.now();

    // Build system prompt
    const systemPrompt =
      SYSTEM_PROMPT_PREFIX + buildCandidatesPrompt(candidates, optionGroups);

    // Build messages
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history if provided
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory.slice(-6)) {
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
        max_tokens: 1024,
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
   * Generate a friendly order summary for confirmation
   */
  async generateOrderSummary(
    items: Array<{
      name: string;
      qty: number;
      options: string[];
      price: number;
    }>,
    totalPrice: number
  ): Promise<string> {
    if (!this.client) {
      // Fallback: simple template-based summary
      return this.generateSimpleSummary(items, totalPrice);
    }

    try {
      const itemsText = items
        .map((item) => {
          let line = `${item.qty}x ${item.name}`;
          if (item.options.length > 0) {
            line += ` (${item.options.join(', ')})`;
          }
          line += ` - ${item.price} TL`;
          return line;
        })
        .join('\n');

      const response = await this.client.chat.completions.create({
        model: this.config.openai.model,
        messages: [
          {
            role: 'system',
            content:
              'Verilen sipariş listesini doğal ve samimi bir dille özetle. Türkçe yaz. Kısa tut.',
          },
          {
            role: 'user',
            content: `Sipariş:\n${itemsText}\n\nToplam: ${totalPrice} TL\n\nBunu onay mesajı olarak özetle.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 256,
      });

      return (
        response.choices[0]?.message?.content ||
        this.generateSimpleSummary(items, totalPrice)
      );
    } catch {
      return this.generateSimpleSummary(items, totalPrice);
    }
  }

  /**
   * Simple template-based summary (fallback)
   */
  private generateSimpleSummary(
    items: Array<{
      name: string;
      qty: number;
      options: string[];
      price: number;
    }>,
    totalPrice: number
  ): string {
    const itemLines = items
      .map((item) => {
        let line = `• ${item.qty}x ${item.name}`;
        if (item.options.length > 0) {
          line += ` (${item.options.join(', ')})`;
        }
        return line;
      })
      .join('\n');

    return `Siparişinizi aldım:\n\n${itemLines}\n\n💰 Toplam: ${totalPrice.toFixed(2)} TL\n\nOnaylıyor musunuz?`;
  }
}

export const llmExtractorService = new LlmOrderExtractorService();


