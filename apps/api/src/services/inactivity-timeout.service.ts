import prisma from '../db/prisma';
import { whatsappService } from './whatsapp.service';
import { TEMPLATES } from './message-templates';
import { createLogger } from '../logger';
import { ConversationPhase } from '@whatres/shared';

const logger = createLogger();

// Phases that are considered "active order flow" — customer is building/paying an order
const ACTIVE_ORDER_PHASES: ConversationPhase[] = [
  'ORDER_COLLECTING',
  'ORDER_REVIEW',
  'LOCATION_REQUEST',
  'ADDRESS_SELECTION',
  'ADDRESS_COLLECTION',
  'ADDRESS_SAVE_PROMPT',
  'PAYMENT_METHOD_SELECTION',
  'PAYMENT_PENDING',
];

// Sub-states that should NOT be interrupted (they have their own active flows)
const EXCLUDED_SUB_STATES = [
  'INACTIVITY_WARNING',
  'UPSELL_OFFERED',
  'PAYMENT_CHANGE_PENDING',
];

const INACTIVITY_WARNING_MS = 5 * 60 * 1000; // 5 minutes
const INACTIVITY_CANCEL_MS = 1 * 60 * 1000;  // 1 minute after warning

export class InactivityTimeoutService {
  /**
   * Job 1: Find conversations inactive for 5+ minutes in active order phases
   * and send a warning message. Sets flowSubState = 'INACTIVITY_WARNING'.
   */
  async sendInactivityWarnings(): Promise<{ warned: number }> {
    const cutoff = new Date(Date.now() - INACTIVITY_WARNING_MS);

    const conversations = await prisma.conversation.findMany({
      where: {
        phase: { in: ACTIVE_ORDER_PHASES },
        lastMessageAt: { lt: cutoff },
        NOT: {
          flowSubState: { in: EXCLUDED_SUB_STATES },
        },
      },
      select: {
        id: true,
        tenantId: true,
        phase: true,
        flowSubState: true,
        flowMetadata: true,
      },
    });

    let warned = 0;

    for (const conv of conversations) {
      try {
        // Preserve existing flowMetadata, add warning timestamp
        let existingMetadata: Record<string, unknown> = {};
        try {
          existingMetadata = JSON.parse(conv.flowMetadata || '{}');
        } catch {
          /* ignore parse errors */
        }

        const warningMetadata = JSON.stringify({
          ...existingMetadata,
          inactivityWarningSentAt: new Date().toISOString(),
          preWarningSubState: conv.flowSubState || null,
        });

        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            flowSubState: 'INACTIVITY_WARNING',
            flowMetadata: warningMetadata,
          },
        });

        await whatsappService.sendText(conv.tenantId, conv.id, TEMPLATES.inactivityWarning);

        warned++;
        logger.info(
          { tenantId: conv.tenantId, conversationId: conv.id, phase: conv.phase },
          'Sent inactivity warning',
        );
      } catch (err) {
        logger.error(
          { err, tenantId: conv.tenantId, conversationId: conv.id },
          'Failed to send inactivity warning',
        );
      }
    }

    return { warned };
  }

  /**
   * Job 2: Find conversations with INACTIVITY_WARNING that have had no
   * customer response for 1+ minute. Auto-cancel the order.
   */
  async cancelInactiveOrders(): Promise<{ cancelled: number }> {
    const conversations = await prisma.conversation.findMany({
      where: {
        flowSubState: 'INACTIVITY_WARNING',
      },
      select: {
        id: true,
        tenantId: true,
        activeOrderId: true,
        flowMetadata: true,
        phase: true,
      },
    });

    let cancelled = 0;

    for (const conv of conversations) {
      try {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(conv.flowMetadata || '{}');
        } catch {
          /* ignore */
        }

        const warningSentAt = meta.inactivityWarningSentAt
          ? new Date(meta.inactivityWarningSentAt as string)
          : null;

        if (!warningSentAt) {
          // Corrupted state — clear it
          await this.clearInactivityState(conv.id);
          continue;
        }

        const timeSinceWarning = Date.now() - warningSentAt.getTime();
        if (timeSinceWarning < INACTIVITY_CANCEL_MS) {
          // Not yet 1 minute — skip
          continue;
        }

        // Check if customer sent a message AFTER the warning
        const customerMessageAfterWarning = await prisma.message.findFirst({
          where: {
            conversationId: conv.id,
            direction: 'IN',
            createdAt: { gt: warningSentAt },
          },
        });

        if (customerMessageAfterWarning) {
          // Customer responded — clear state (safety net, handleIncomingMessage
          // should have already cleared it)
          await this.clearInactivityState(conv.id);
          continue;
        }

        // No customer response after 1 minute — cancel the order
        if (conv.activeOrderId) {
          await prisma.order.updateMany({
            where: {
              id: conv.activeOrderId,
              tenantId: conv.tenantId,
              status: 'DRAFT',
            },
            data: { status: 'CANCELLED' },
          });
        }

        // Reset conversation to IDLE
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            phase: 'IDLE',
            activeOrderId: null,
            flowSubState: null,
            flowMetadata: null,
          },
        });

        // Send cancellation message
        await whatsappService.sendText(conv.tenantId, conv.id, TEMPLATES.inactivityCancelled);

        cancelled++;
        logger.info(
          { tenantId: conv.tenantId, conversationId: conv.id, orderId: conv.activeOrderId },
          'Auto-cancelled inactive order',
        );
      } catch (err) {
        logger.error(
          { err, tenantId: conv.tenantId, conversationId: conv.id },
          'Failed to cancel inactive order',
        );
      }
    }

    return { cancelled };
  }

  /**
   * Clear inactivity state and restore previous sub-state.
   * Called when customer responds to the warning.
   */
  async clearInactivityState(conversationId: string): Promise<void> {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { flowMetadata: true },
    });

    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(conv?.flowMetadata || '{}');
    } catch {
      /* ignore */
    }

    const preWarningSubState = (meta.preWarningSubState as string) || null;

    // Remove inactivity-specific keys
    delete meta.inactivityWarningSentAt;
    delete meta.preWarningSubState;

    const hasRemainingMetadata = Object.keys(meta).length > 0;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        flowSubState: preWarningSubState,
        flowMetadata: hasRemainingMetadata ? JSON.stringify(meta) : null,
      },
    });
  }
}

export const inactivityTimeoutService = new InactivityTimeoutService();
