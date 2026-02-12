import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ApiResponse,
  MessageDto,
  WhatsAppSendResponseDto,
} from '@whatres/shared';
import { whatsappService } from '../services/whatsapp.service';
import { nluOrchestratorService } from '../services/nlu';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';
import { createLogger } from '../logger';

const router = Router();
const logger = createLogger();

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
 * Tenant ID from x-tenant-id header (configured in provider webhook settings)
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

      // Log incoming webhook
      logger.info(
        { tenantId, body: JSON.stringify(req.body).substring(0, 200) },
        'WhatsApp webhook received'
      );

      // Validate payload
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

      // Process incoming message
      const message = await whatsappService.processIncomingMessage(tenantId, validation.data);

      // Trigger NLU processing for TEXT messages (async, don't wait)
      if (validation.data.type === 'text' && validation.data.text?.body) {
        setImmediate(async () => {
          try {
            await nluOrchestratorService.processMessage(
              tenantId,
              message.conversationId,
              message.id,
              validation.data.text!.body
            );
          } catch (error) {
            logger.error({ error, tenantId, messageId: message.id }, 'NLU processing failed');
          }
        });
      }

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
 * Webhook verification endpoint (for Meta/WhatsApp Cloud API)
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // For now, accept any verification (stub)
  // In production, verify token against configured secret
  if (mode === 'subscribe') {
    logger.info('WhatsApp webhook verification received');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

/**
 * POST /whatsapp/send
 * Send message via WhatsApp (stub)
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

