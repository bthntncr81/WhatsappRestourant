import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ApiResponse,
  ConversationDto,
  MessageDto,
  InboxSummaryDto,
  ConversationAssignmentDto,
  ConversationLockDto,
  ConversationParticipantDto,
  InternalNoteDto,
  AgentDto,
} from '@whatres/shared';
import { inboxService } from '../services/inbox.service';
import { assignmentService } from '../services/assignment.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

// All routes require authentication and at least STAFF role (for viewing)
// Write operations check role individually
router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN', 'AGENT', 'STAFF']));

// Validation schemas
const conversationQuerySchema = z.object({
  status: z.enum(['OPEN', 'PENDING_AGENT', 'CLOSED']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const updateConversationSchema = z.object({
  status: z.enum(['OPEN', 'PENDING_AGENT', 'CLOSED']).optional(),
  customerName: z.string().optional(),
});

const replySchema = z.object({
  text: z.string().min(1),
});

const assignSchema = z.object({
  userId: z.string().min(1),
});

const internalNoteSchema = z.object({
  text: z.string().min(1),
});

/**
 * GET /inbox/summary
 * Get inbox summary counts
 */
router.get(
  '/summary',
  async (req: Request, res: Response<ApiResponse<InboxSummaryDto>>, next: NextFunction) => {
    try {
      const summary = await inboxService.getSummary(req.tenantId!);
      res.json({ success: true, data: summary });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /inbox/conversations
 * List conversations with optional filters
 */
router.get(
  '/conversations',
  async (
    req: Request,
    res: Response<ApiResponse<{ conversations: ConversationDto[]; total: number }>>,
    next: NextFunction
  ) => {
    try {
      const validation = conversationQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid query parameters', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await inboxService.getConversations(req.tenantId!, validation.data);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /inbox/conversations/:id
 * Get single conversation
 */
router.get(
  '/conversations/:id',
  async (req: Request, res: Response<ApiResponse<ConversationDto>>, next: NextFunction) => {
    try {
      const conversation = await inboxService.getConversation(req.tenantId!, req.params.id);
      res.json({ success: true, data: conversation });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /inbox/conversations/:id
 * Update conversation (status, customerName)
 */
router.patch(
  '/conversations/:id',
  async (req: Request, res: Response<ApiResponse<ConversationDto>>, next: NextFunction) => {
    try {
      const validation = updateConversationSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const conversation = await inboxService.updateConversation(
        req.tenantId!,
        req.params.id,
        validation.data
      );
      res.json({ success: true, data: conversation });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /inbox/conversations/:id/messages
 * Get messages for a conversation
 */
router.get(
  '/conversations/:id/messages',
  async (req: Request, res: Response<ApiResponse<MessageDto[]>>, next: NextFunction) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const before = req.query.before as string | undefined;

      const messages = await inboxService.getMessages(
        req.tenantId!,
        req.params.id,
        limit,
        before
      );
      res.json({ success: true, data: messages });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /inbox/conversations/:id/reply
 * Send reply to conversation
 */
router.post(
  '/conversations/:id/reply',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<MessageDto>>, next: NextFunction) => {
    try {
      const validation = replySchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      // Check if user can write (lock check)
      const canWrite = await assignmentService.canWrite(
        req.tenantId!,
        req.params.id,
        req.user!.sub
      );

      if (!canWrite) {
        throw new AppError(423, 'CONVERSATION_LOCKED', 'Conversation is locked by another user');
      }

      const message = await inboxService.replyToConversation(
        req.tenantId!,
        req.params.id,
        validation.data.text,
        req.user!.sub
      );
      res.json({ success: true, data: message });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== ASSIGNMENT ====================

/**
 * GET /inbox/agents
 * Get available agents for assignment
 */
router.get(
  '/agents',
  async (req: Request, res: Response<ApiResponse<AgentDto[]>>, next: NextFunction) => {
    try {
      const agents = await assignmentService.getAvailableAgents(req.tenantId!);
      res.json({ success: true, data: agents });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /inbox/conversations/:id/assignment
 * Get current assignment for conversation
 */
router.get(
  '/conversations/:id/assignment',
  async (req: Request, res: Response<ApiResponse<ConversationAssignmentDto | null>>, next: NextFunction) => {
    try {
      const assignment = await assignmentService.getAssignment(req.tenantId!, req.params.id);
      res.json({ success: true, data: assignment });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /inbox/conversations/:id/assign
 * Assign conversation to an agent
 */
router.post(
  '/conversations/:id/assign',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<ConversationAssignmentDto>>, next: NextFunction) => {
    try {
      const validation = assignSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const assignment = await assignmentService.assignConversation(
        req.tenantId!,
        req.params.id,
        validation.data.userId
      );
      res.json({ success: true, data: assignment });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /inbox/conversations/:id/assign
 * Remove assignment from conversation
 */
router.delete(
  '/conversations/:id/assign',
  requireRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await assignmentService.unassignConversation(req.tenantId!, req.params.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /inbox/conversations/:id/handoff-to-agent
 * Hand off conversation to human agent
 */
router.post(
  '/conversations/:id/handoff-to-agent',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await assignmentService.handoffToAgent(req.tenantId!, req.params.id);
      res.json({ success: true, message: 'Conversation handed off to agent' });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== LOCK ====================

/**
 * GET /inbox/conversations/:id/lock
 * Get current lock status
 */
router.get(
  '/conversations/:id/lock',
  async (req: Request, res: Response<ApiResponse<ConversationLockDto | null>>, next: NextFunction) => {
    try {
      const lock = await assignmentService.getLock(req.tenantId!, req.params.id, req.user!.sub);
      res.json({ success: true, data: lock });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /inbox/conversations/:id/lock
 * Acquire lock on conversation
 */
router.post(
  '/conversations/:id/lock',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<ConversationLockDto>>, next: NextFunction) => {
    try {
      const lock = await assignmentService.acquireLock(
        req.tenantId!,
        req.params.id,
        req.user!.sub
      );
      res.json({ success: true, data: lock });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /inbox/conversations/:id/lock
 * Refresh lock (heartbeat)
 */
router.put(
  '/conversations/:id/lock',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<ConversationLockDto>>, next: NextFunction) => {
    try {
      const lock = await assignmentService.refreshLock(
        req.tenantId!,
        req.params.id,
        req.user!.sub
      );
      res.json({ success: true, data: lock });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /inbox/conversations/:id/lock
 * Release lock
 */
router.delete(
  '/conversations/:id/lock',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await assignmentService.releaseLock(req.tenantId!, req.params.id, req.user!.sub);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== PARTICIPANTS ====================

/**
 * GET /inbox/conversations/:id/participants
 * Get participants in conversation
 */
router.get(
  '/conversations/:id/participants',
  async (req: Request, res: Response<ApiResponse<ConversationParticipantDto[]>>, next: NextFunction) => {
    try {
      const participants = await assignmentService.getParticipants(req.tenantId!, req.params.id);
      res.json({ success: true, data: participants });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /inbox/conversations/:id/join
 * Join conversation as participant
 */
router.post(
  '/conversations/:id/join',
  async (req: Request, res: Response<ApiResponse<ConversationParticipantDto>>, next: NextFunction) => {
    try {
      const participant = await assignmentService.joinConversation(
        req.tenantId!,
        req.params.id,
        req.user!.sub,
        req.user!.role
      );
      res.json({ success: true, data: participant });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /inbox/conversations/:id/leave
 * Leave conversation
 */
router.delete(
  '/conversations/:id/leave',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await assignmentService.leaveConversation(req.tenantId!, req.params.id, req.user!.sub);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== INTERNAL NOTES ====================

/**
 * GET /inbox/conversations/:id/notes
 * Get internal notes for conversation
 */
router.get(
  '/conversations/:id/notes',
  async (req: Request, res: Response<ApiResponse<InternalNoteDto[]>>, next: NextFunction) => {
    try {
      const notes = await assignmentService.getInternalNotes(req.tenantId!, req.params.id);
      res.json({ success: true, data: notes });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /inbox/conversations/:id/notes
 * Create internal note
 */
router.post(
  '/conversations/:id/notes',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<InternalNoteDto>>, next: NextFunction) => {
    try {
      const validation = internalNoteSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const note = await assignmentService.createInternalNote(
        req.tenantId!,
        req.params.id,
        req.user!.sub,
        validation.data.text
      );
      res.json({ success: true, data: note });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /inbox/notes/:noteId
 * Update internal note
 */
router.patch(
  '/notes/:noteId',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<InternalNoteDto>>, next: NextFunction) => {
    try {
      const validation = internalNoteSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const note = await assignmentService.updateInternalNote(
        req.tenantId!,
        req.params.noteId,
        req.user!.sub,
        validation.data.text
      );
      res.json({ success: true, data: note });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /inbox/notes/:noteId
 * Delete internal note
 */
router.delete(
  '/notes/:noteId',
  requireRole(['OWNER', 'ADMIN', 'AGENT']),
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      const isAdmin = ['OWNER', 'ADMIN'].includes(req.user!.role);
      await assignmentService.deleteInternalNote(
        req.tenantId!,
        req.params.noteId,
        req.user!.sub,
        isAdmin
      );
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export const inboxRouter = router;

