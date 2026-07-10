import prisma from '../../db/prisma';
import { createLogger } from '../../logger';
import { IntentAnalysis } from '../nlu/intent-analysis.service';

const logger = createLogger();

/**
 * Flywheel: every hybrid (Claude-generated) reply is captured as a teacher
 * sample for later QLoRA fine-tuning of the local Qwen model.
 *
 * - PII is masked before persisting (phones, emails, address lines).
 * - Called fire-and-forget: errors are swallowed, capture must never affect
 *   the guest conversation.
 *
 * Export: scripts/export-training.mjs → JSONL. Process: docs/ai-flywheel.md.
 */

/** Mask phone numbers, e-mails and address lines (simple approach). */
export function maskPii(text: string): string {
  if (!text) return text;
  return text
    // phone numbers: +90 555 123 45 67, 05551234567, 555-123-4567 ...
    .replace(/\+?\d[\d\s-]{8,}/g, '[TEL]')
    // e-mail addresses
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EPOSTA]')
    // any line mentioning an address → replace the free text wholesale
    .split('\n')
    .map((line) => (/adres/i.test(line) ? '[ADRES]' : line))
    .join('\n');
}

export interface TrainingCaptureInput {
  tenantId: string;
  /** 'claude-haiku' | 'claude-sonnet' */
  source: 'claude-haiku' | 'claude-sonnet';
  /** Exact model id used (e.g. claude-haiku-4-5) */
  model: string;
  language?: string | null;
  intentAnalysis?: IntentAnalysis | null;
  /** System prompt used to generate the reply */
  system: string;
  /** Conversation history passed to the model */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  assistantReply: string;
}

export class TrainingCaptureService {
  /**
   * Fire-and-forget capture. Never throws; never awaited by callers.
   */
  capture(input: TrainingCaptureInput): void {
    void this.persist(input).catch((error) => {
      logger.warn({ error, tenantId: input.tenantId }, 'Training sample capture failed (ignored)');
    });
  }

  private async persist(input: TrainingCaptureInput): Promise<void> {
    await prisma.aiTrainingSample.create({
      data: {
        tenantId: input.tenantId,
        source: input.source,
        model: input.model,
        language: input.language ?? input.intentAnalysis?.language ?? null,
        intentJson: input.intentAnalysis
          ? (JSON.parse(JSON.stringify(input.intentAnalysis)) as object)
          : undefined,
        contextJson: {
          system: maskPii(input.system),
          history: input.history.map((m) => ({
            role: m.role,
            content: maskPii(m.content),
          })),
        },
        userMessage: maskPii(input.userMessage),
        assistantReply: maskPii(input.assistantReply),
      },
    });
  }
}

export const trainingCaptureService = new TrainingCaptureService();
