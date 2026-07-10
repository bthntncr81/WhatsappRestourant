import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../../logger';
import { ReplyModelChoice } from './model-router.service';

const logger = createLogger();

/**
 * Thin wrapper around the official Anthropic SDK for customer-reply
 * generation. Every failure path returns null so callers fall back to the
 * existing local reply — the guest conversation must never break because
 * of the hybrid layer.
 *
 * Model ids (no date suffixes):
 *  - simple  → AI_MODEL_SIMPLE  || 'claude-haiku-4-5'
 *  - complex → AI_MODEL_COMPLEX || 'claude-sonnet-4-6'
 */

export interface ClaudeReplyResult {
  text: string;
  /** Exact model id used for the request */
  model: string;
}

function resolveModelId(choice: 'haiku' | 'sonnet'): string {
  return choice === 'sonnet'
    ? process.env.AI_MODEL_COMPLEX || 'claude-sonnet-4-6'
    : process.env.AI_MODEL_SIMPLE || 'claude-haiku-4-5';
}

export class ClaudeClientService {
  private client: Anthropic | null = null;

  private getClient(): Anthropic | null {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    if (!this.client) {
      this.client = new Anthropic(); // ANTHROPIC_API_KEY from env
    }
    return this.client;
  }

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  /**
   * Generate a customer-facing reply. Returns null on ANY error (rate limit,
   * connection, API error, missing key) — the caller keeps the local reply.
   */
  async generateReply(params: {
    choice: Exclude<ReplyModelChoice, 'local'>;
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ClaudeReplyResult | null> {
    const client = this.getClient();
    if (!client) return null;

    const model = resolveModelId(params.choice);
    const startTime = Date.now();

    try {
      const resp = await client.messages.create({
        model,
        max_tokens: 1024,
        system: params.system,
        messages: params.messages,
      });

      // Join all text blocks from the response content
      const text = resp.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      if (!text) {
        logger.warn({ model, stopReason: resp.stop_reason }, 'Claude returned empty reply');
        return null;
      }

      logger.info(
        {
          model,
          durationMs: Date.now() - startTime,
          inputTokens: resp.usage?.input_tokens,
          outputTokens: resp.usage?.output_tokens,
        },
        'Claude reply generated'
      );

      return { text, model };
    } catch (error) {
      // Every error falls back to the local Qwen path — guest input must
      // never be lost because the hybrid layer failed.
      if (error instanceof Anthropic.RateLimitError) {
        logger.warn({ model, error: error.message }, 'Claude rate limited, falling back to local');
      } else if (error instanceof Anthropic.APIConnectionError) {
        logger.warn({ model, error: error.message }, 'Claude connection error, falling back to local');
      } else if (error instanceof Anthropic.APIError) {
        // instanceof narrows the type — status is available directly
        logger.warn(
          { model, status: error.status, error: error.message },
          'Claude API error, falling back to local'
        );
      } else {
        logger.warn({ model, error }, 'Claude unexpected error, falling back to local');
      }
      return null;
    }
  }
}

export const claudeClientService = new ClaudeClientService();
