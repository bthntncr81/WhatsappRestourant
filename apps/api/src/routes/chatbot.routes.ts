import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@whatres/shared';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { chatbotService } from '../services/chatbot.service';

const router = Router();

router.use(requireAuth);

const messageSchema = z.object({
  message: z.string().min(1),
});

const locationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

/**
 * POST /api/chatbot/message
 * Send a message to the chatbot and get a response
 */
router.post(
  '/message',
  validate(messageSchema),
  async (req: Request, res: Response<ApiResponse<{ reply: string; buttons?: Array<{ id: string; title: string }>; orderIntent?: unknown }>>, next: NextFunction) => {
    try {
      const { message } = req.body;
      const result = await chatbotService.processMessage(
        req.tenantId!,
        req.user!.sub,
        message
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/chatbot/location
 * Send a simulated location for testing geo flow
 */
router.post(
  '/location',
  validate(locationSchema),
  async (req: Request, res: Response<ApiResponse<{ reply: string; buttons?: Array<{ id: string; title: string }> }>>, next: NextFunction) => {
    try {
      const { latitude, longitude } = req.body;
      const result = await chatbotService.sendLocation(
        req.tenantId!,
        req.user!.sub,
        latitude,
        longitude,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/chatbot/simulate-payment
 * Simulate iyzico payment callback (test only - localhost unreachable by iyzico)
 */
router.post(
  '/simulate-payment',
  async (req: Request, res: Response<ApiResponse<{ reply: string; buttons?: Array<{ id: string; title: string }> }>>, next: NextFunction) => {
    try {
      const success = req.body.success !== false; // default true
      const result = await chatbotService.simulatePayment(
        req.tenantId!,
        req.user!.sub,
        success,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/chatbot/history
 * Get chat history for current user
 */
router.get(
  '/history',
  async (req: Request, res: Response<ApiResponse<unknown[]>>, next: NextFunction) => {
    try {
      const history = await chatbotService.getChatHistory(req.tenantId!, req.user!.sub);
      res.json({ success: true, data: history });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/chatbot/history
 * Clear chat history
 */
router.delete(
  '/history',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await chatbotService.clearChatHistory(req.tenantId!, req.user!.sub);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export const chatbotRouter = router;


