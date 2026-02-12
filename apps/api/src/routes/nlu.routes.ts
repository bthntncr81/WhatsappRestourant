import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse, OrderIntentDto, MenuCandidateDto } from '@whatres/shared';
import { nluOrchestratorService, menuCandidateService } from '../services/nlu';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

// All routes require auth and AGENT+ role
router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN', 'AGENT']));

// Validation schemas
const feedbackSchema = z.object({
  feedback: z.enum(['correct', 'incorrect']),
});

const testExtractionSchema = z.object({
  text: z.string().min(1),
});

/**
 * GET /nlu/conversations/:conversationId/intents
 * Get order intents for a conversation
 */
router.get(
  '/conversations/:conversationId/intents',
  async (req: Request, res: Response<ApiResponse<OrderIntentDto[]>>, next: NextFunction) => {
    try {
      const intents = await nluOrchestratorService.getOrderIntents(
        req.tenantId!,
        req.params.conversationId
      );
      res.json({ success: true, data: intents });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /nlu/intents/:intentId/feedback
 * Submit feedback on order intent
 */
router.post(
  '/intents/:intentId/feedback',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      const validation = feedbackSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid feedback', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      await nluOrchestratorService.submitFeedback(
        req.tenantId!,
        req.params.intentId,
        validation.data.feedback
      );

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /nlu/test/candidates
 * Test menu candidate search (for debugging)
 */
router.post(
  '/test/candidates',
  async (req: Request, res: Response<ApiResponse<MenuCandidateDto[]>>, next: NextFunction) => {
    try {
      const validation = testExtractionSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const candidates = await menuCandidateService.findCandidates(
        req.tenantId!,
        validation.data.text
      );

      res.json({ success: true, data: candidates });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /nlu/test/extract
 * Test full extraction pipeline (for debugging)
 */
router.post(
  '/test/extract',
  async (
    req: Request,
    res: Response<ApiResponse<{ candidates: MenuCandidateDto[]; extraction: any }>>,
    next: NextFunction
  ) => {
    try {
      const validation = testExtractionSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      // Get candidates
      const candidates = await menuCandidateService.findCandidates(
        req.tenantId!,
        validation.data.text
      );

      // Get option groups
      const optionGroups = await menuCandidateService.getOptionGroupsForItems(
        req.tenantId!,
        candidates.map((c) => c.menuItemId)
      );

      // Import llmExtractorService
      const { llmExtractorService } = await import('../services/nlu');

      if (!llmExtractorService.isAvailable()) {
        throw new AppError(503, 'LLM_UNAVAILABLE', 'OpenAI API key not configured');
      }

      // Extract
      const extraction = await llmExtractorService.extractOrder(
        validation.data.text,
        candidates,
        optionGroups
      );

      res.json({
        success: true,
        data: { candidates, extraction },
      });
    } catch (error) {
      next(error);
    }
  }
);

export const nluRouter = router;


