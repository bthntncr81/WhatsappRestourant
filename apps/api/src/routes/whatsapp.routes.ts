import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
  ApiResponse,
  MessageDto,
  WhatsAppSendResponseDto,
} from '@whatres/shared';
import { whatsappService } from '../services/whatsapp.service';
import { whatsappProviderService } from '../services/whatsapp-provider.service';
import { conversationFlowService } from '../services/conversation-flow.service';
import { whatsappConfigService } from '../services/whatsapp-config.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';

const router = Router();
const logger = createLogger();

/**
 * Verify Meta webhook signature (HMAC-SHA256)
 * Returns true if valid, false if invalid, null if no verification needed
 */
function verifyMetaSignature(
  signature: string | undefined,
  rawBody: Buffer | undefined,
  appSecret: string,
): boolean | null {
  if (!signature) return null; // No signature header = no verification needed

  if (!rawBody) {
    logger.warn('Webhook signature present but rawBody not captured');
    return false;
  }

  try {
    const expectedSig = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const providedHash = signature.replace('sha256=', '');

    // timingSafeEqual requires equal length buffers
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(providedHash, 'hex');
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  } catch (error) {
    logger.error({ error }, 'Signature verification error');
    return false;
  }
}

// Validation schemas
const webhookPayloadSchema = z.object({
  messageId: z.string().optional(),
  from: z.string().min(1),
  fromName: z.string().optional(),
  type: z.enum(['text', 'location', 'image', 'voice', 'interactive', 'button']),
  timestamp: z.string().optional(),
  text: z
    .object({
      body: z.string(),
    })
    .optional(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  image: z
    .object({
      id: z.string().optional(),
      url: z.string().optional(),
      caption: z.string().optional(),
      mimeType: z.string().optional(),
    })
    .optional(),
  voice: z
    .object({
      id: z.string().optional(),
      url: z.string().optional(),
      mimeType: z.string().optional(),
    })
    .optional(),
  interactive: z
    .object({
      type: z.string(),
      buttonReply: z
        .object({
          id: z.string(),
          title: z.string(),
        })
        .optional(),
      listReply: z
        .object({
          id: z.string(),
          title: z.string(),
          description: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  raw: z.unknown().optional(),
});

const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
});

/**
 * POST /whatsapp/webhook
 * Receives incoming WhatsApp messages from provider
 * Supports both direct payload format and Meta Cloud API format
 */
router.post(
  '/webhook',
  async (req: Request, res: Response<ApiResponse<MessageDto>>, next: NextFunction) => {
    try {
      // Get tenant ID from header
      const tenantId = req.headers['x-tenant-id'] as string;
      if (!tenantId) {
        throw new AppError(400, 'MISSING_TENANT', 'x-tenant-id header is required');
      }

      logger.info(
        { tenantId, body: JSON.stringify(req.body).substring(0, 200) },
        'WhatsApp webhook received'
      );

      // Try to parse as Meta Cloud API format first
      let payload = whatsappProviderService.parseWebhookPayload(req.body);

      if (!payload) {
        // Fallback to direct payload format
        const validation = webhookPayloadSchema.safeParse(req.body);
        if (!validation.success) {
          logger.warn(
            { errors: validation.error.flatten().fieldErrors },
            'Invalid webhook payload'
          );
          throw new AppError(400, 'INVALID_PAYLOAD', 'Invalid webhook payload', {
            errors: validation.error.flatten().fieldErrors,
          });
        }
        payload = validation.data;
      }

      // Process incoming message (stores in DB + geo check side effect)
      const message = await whatsappService.processIncomingMessage(tenantId, payload);

      // Route through conversation flow state machine (async, don't block webhook)
      setImmediate(async () => {
        try {
          await conversationFlowService.handleIncomingMessage(
            tenantId,
            message.conversationId,
            message,
            payload!,
          );
        } catch (error) {
          logger.error({ error, tenantId, messageId: message.id }, 'Conversation flow processing failed');
        }
      });

      res.status(200).json({
        success: true,
        data: message,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /whatsapp/webhook
 * Webhook verification endpoint (for Meta Cloud API) - legacy/global
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const result = whatsappProviderService.verifyWebhook(mode, token, challenge);
  if (result !== null) {
    res.status(200).send(result);
  } else {
    res.status(403).send('Forbidden');
  }
});

// ==================== PER-TENANT WEBHOOK ENDPOINTS ====================

/**
 * GET /whatsapp/webhook/:tenantId
 * Per-tenant webhook verification (Meta sends GET to verify)
 */
router.get('/webhook/:tenantId', async (req: Request, res: Response) => {
  const { tenantId } = req.params;
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  try {
    const config = await whatsappConfigService.getDecryptedConfig(tenantId);
    if (!config) {
      logger.warn({ tenantId }, 'Webhook verify: no config found for tenant');
      return res.status(403).send('Forbidden');
    }

    if (mode === 'subscribe' && token === config.webhookVerifyToken) {
      logger.info({ tenantId }, 'Per-tenant webhook verified');
      await whatsappConfigService.markVerified(tenantId);
      return res.status(200).send(challenge);
    }

    logger.warn({ tenantId, mode, token }, 'Per-tenant webhook verification failed');
    return res.status(403).send('Forbidden');
  } catch (error) {
    logger.error({ error, tenantId }, 'Webhook verification error');
    return res.status(500).send('Internal Server Error');
  }
});

/**
 * POST /whatsapp/webhook/:tenantId
 * Per-tenant webhook - receives messages from Meta for a specific tenant
 */
router.post(
  '/webhook/:tenantId',
  async (req: Request, res: Response, next: NextFunction) => {
    const { tenantId } = req.params;
    try {
      // Verify webhook signature if tenant has appSecret configured
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const rawBody = (req as any).rawBody as Buffer | undefined;

      if (signature) {
        const tenantConfig = await whatsappConfigService.getDecryptedConfig(tenantId);
        if (tenantConfig?.appSecret) {
          const result = verifyMetaSignature(signature, rawBody, tenantConfig.appSecret);
          if (result === false) {
            logger.warn(
              { tenantId, hasRawBody: !!rawBody, signaturePrefix: signature.substring(0, 20) },
              'Webhook signature verification failed',
            );
            return res.status(403).json({ success: false, error: 'Invalid signature' });
          }
        }
        // If no appSecret configured, skip verification (tenant hasn't set it up yet)
      }

      logger.info(
        { tenantId, body: JSON.stringify(req.body).substring(0, 200) },
        'Per-tenant webhook received'
      );

      // Parse Meta Cloud API format
      let payload = whatsappProviderService.parseWebhookPayload(req.body);

      if (!payload) {
        // Could be a status update - just acknowledge
        return res.status(200).json({ success: true, data: null });
      }

      // Process incoming message
      const message = await whatsappService.processIncomingMessage(tenantId, payload);

      // Route through conversation flow (async)
      setImmediate(async () => {
        try {
          await conversationFlowService.handleIncomingMessage(
            tenantId,
            message.conversationId,
            message,
            payload!,
          );
        } catch (error) {
          logger.error({ error, tenantId, messageId: message.id }, 'Conversation flow failed');
        }
      });

      res.status(200).json({ success: true, data: message });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /whatsapp/send
 * Send message via WhatsApp
 * Requires authentication
 */
router.post(
  '/send',
  requireAuth,
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<WhatsAppSendResponseDto>>, next: NextFunction) => {
    try {
      const validation = sendMessageSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const { conversationId, text } = validation.data;

      const result = await whatsappService.sendMessage(
        req.tenantId!,
        conversationId,
        text,
        req.user!.sub
      );

      res.json({
        success: true,
        data: {
          success: true,
          messageId: result.messageId,
          externalId: result.externalId,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export const whatsappRouter = router;
