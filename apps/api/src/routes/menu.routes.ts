import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  ApiResponse,
  MenuVersionDto,
  MenuItemDto,
  MenuOptionGroupDto,
  MenuOptionDto,
  MenuSynonymDto,
  CanonicalMenuExport,
  MenuImportResultDto,
} from '@whatres/shared';
import { menuService } from '../services/menu.service';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();

// All routes require authentication and OWNER/ADMIN role
router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN']));

// ==================== VALIDATION SCHEMAS ====================

const createItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  basePrice: z.number().min(0),
  category: z.string().min(1),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
  optionGroupIds: z.array(z.string()).optional(),
});

const updateItemSchema = createItemSchema.partial();

const createOptionGroupSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['SINGLE', 'MULTI']),
  required: z.boolean().optional(),
  minSelect: z.number().min(0).optional(),
  maxSelect: z.number().min(1).optional(),
  sortOrder: z.number().optional(),
});

const updateOptionGroupSchema = createOptionGroupSchema.partial();

const createOptionSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1),
  priceDelta: z.number().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

const updateOptionSchema = createOptionSchema.omit({ groupId: true }).partial();

const createSynonymSchema = z.object({
  phrase: z.string().min(1),
  mapsToItemId: z.string().optional(),
  mapsToOptionId: z.string().optional(),
  weight: z.number().min(1).optional(),
});

const updateSynonymSchema = createSynonymSchema.partial();

const importSchema = z.object({
  categories: z.array(
    z.object({
      name: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          basePrice: z.number(),
          isActive: z.boolean().optional(),
          optionGroupNames: z.array(z.string()).optional(),
        })
      ),
    })
  ),
  optionGroups: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['SINGLE', 'MULTI']),
      required: z.boolean().optional(),
      minSelect: z.number().optional(),
      maxSelect: z.number().optional(),
      options: z.array(
        z.object({
          name: z.string(),
          priceDelta: z.number().optional(),
          isDefault: z.boolean().optional(),
          isActive: z.boolean().optional(),
        })
      ),
    })
  ),
  synonyms: z
    .array(
      z.object({
        phrase: z.string(),
        mapsToItemName: z.string().optional(),
        mapsToOptionName: z.string().optional(),
        weight: z.number().optional(),
      })
    )
    .optional(),
});

// ==================== VERSION ROUTES ====================

/**
 * GET /menu/versions
 */
router.get(
  '/versions',
  async (req: Request, res: Response<ApiResponse<MenuVersionDto[]>>, next: NextFunction) => {
    try {
      const versions = await menuService.getVersions(req.tenantId!);
      res.json({ success: true, data: versions });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /menu/versions
 */
router.post(
  '/versions',
  async (req: Request, res: Response<ApiResponse<MenuVersionDto>>, next: NextFunction) => {
    try {
      const version = await menuService.createVersion(req.tenantId!);
      res.status(201).json({ success: true, data: version });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /menu/versions/:versionId
 */
router.get(
  '/versions/:versionId',
  async (req: Request, res: Response<ApiResponse<MenuVersionDto>>, next: NextFunction) => {
    try {
      const version = await menuService.getVersion(req.tenantId!, req.params.versionId);
      res.json({ success: true, data: version });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /menu/versions/:versionId/publish
 */
router.post(
  '/versions/:versionId/publish',
  async (req: Request, res: Response<ApiResponse<MenuVersionDto>>, next: NextFunction) => {
    try {
      const version = await menuService.publishVersion(req.tenantId!, req.params.versionId);
      res.json({ success: true, data: version });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /menu/versions/:versionId/export
 */
router.get(
  '/versions/:versionId/export',
  async (req: Request, res: Response<ApiResponse<CanonicalMenuExport>>, next: NextFunction) => {
    try {
      const menu = await menuService.exportVersion(req.tenantId!, req.params.versionId);
      res.json({ success: true, data: menu });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /menu/published
 * Get the currently published menu (uses cache)
 */
router.get(
  '/published',
  async (req: Request, res: Response<ApiResponse<CanonicalMenuExport | null>>, next: NextFunction) => {
    try {
      const menu = await menuService.getPublishedMenu(req.tenantId!);
      res.json({ success: true, data: menu });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /menu/import
 */
router.post(
  '/import',
  async (req: Request, res: Response<ApiResponse<MenuImportResultDto>>, next: NextFunction) => {
    try {
      const validation = importSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid import data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const result = await menuService.importMenu(req.tenantId!, validation.data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== ITEM ROUTES ====================

/**
 * GET /menu/versions/:versionId/items
 */
router.get(
  '/versions/:versionId/items',
  async (req: Request, res: Response<ApiResponse<MenuItemDto[]>>, next: NextFunction) => {
    try {
      const items = await menuService.getItems(req.tenantId!, req.params.versionId);
      res.json({ success: true, data: items });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /menu/versions/:versionId/items
 */
router.post(
  '/versions/:versionId/items',
  async (req: Request, res: Response<ApiResponse<MenuItemDto>>, next: NextFunction) => {
    try {
      const validation = createItemSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid item data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const item = await menuService.createItem(req.tenantId!, req.params.versionId, validation.data);
      res.status(201).json({ success: true, data: item });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /menu/versions/:versionId/items/:itemId
 */
router.patch(
  '/versions/:versionId/items/:itemId',
  async (req: Request, res: Response<ApiResponse<MenuItemDto>>, next: NextFunction) => {
    try {
      const validation = updateItemSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid item data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const item = await menuService.updateItem(
        req.tenantId!,
        req.params.versionId,
        req.params.itemId,
        validation.data
      );
      res.json({ success: true, data: item });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /menu/versions/:versionId/items/:itemId
 */
router.delete(
  '/versions/:versionId/items/:itemId',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await menuService.deleteItem(req.tenantId!, req.params.versionId, req.params.itemId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== OPTION GROUP ROUTES ====================

/**
 * GET /menu/versions/:versionId/option-groups
 */
router.get(
  '/versions/:versionId/option-groups',
  async (req: Request, res: Response<ApiResponse<MenuOptionGroupDto[]>>, next: NextFunction) => {
    try {
      const groups = await menuService.getOptionGroups(req.tenantId!, req.params.versionId);
      res.json({ success: true, data: groups });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /menu/versions/:versionId/option-groups
 */
router.post(
  '/versions/:versionId/option-groups',
  async (req: Request, res: Response<ApiResponse<MenuOptionGroupDto>>, next: NextFunction) => {
    try {
      const validation = createOptionGroupSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid option group data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const group = await menuService.createOptionGroup(
        req.tenantId!,
        req.params.versionId,
        validation.data
      );
      res.status(201).json({ success: true, data: group });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /menu/versions/:versionId/option-groups/:groupId
 */
router.patch(
  '/versions/:versionId/option-groups/:groupId',
  async (req: Request, res: Response<ApiResponse<MenuOptionGroupDto>>, next: NextFunction) => {
    try {
      const validation = updateOptionGroupSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid option group data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const group = await menuService.updateOptionGroup(
        req.tenantId!,
        req.params.versionId,
        req.params.groupId,
        validation.data
      );
      res.json({ success: true, data: group });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /menu/versions/:versionId/option-groups/:groupId
 */
router.delete(
  '/versions/:versionId/option-groups/:groupId',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await menuService.deleteOptionGroup(req.tenantId!, req.params.versionId, req.params.groupId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== OPTION ROUTES ====================

/**
 * POST /menu/versions/:versionId/options
 */
router.post(
  '/versions/:versionId/options',
  async (req: Request, res: Response<ApiResponse<MenuOptionDto>>, next: NextFunction) => {
    try {
      const validation = createOptionSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid option data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const option = await menuService.createOption(
        req.tenantId!,
        req.params.versionId,
        validation.data
      );
      res.status(201).json({ success: true, data: option });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /menu/versions/:versionId/options/:optionId
 */
router.patch(
  '/versions/:versionId/options/:optionId',
  async (req: Request, res: Response<ApiResponse<MenuOptionDto>>, next: NextFunction) => {
    try {
      const validation = updateOptionSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid option data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const option = await menuService.updateOption(
        req.tenantId!,
        req.params.versionId,
        req.params.optionId,
        validation.data
      );
      res.json({ success: true, data: option });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /menu/versions/:versionId/options/:optionId
 */
router.delete(
  '/versions/:versionId/options/:optionId',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await menuService.deleteOption(req.tenantId!, req.params.versionId, req.params.optionId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== SYNONYM ROUTES ====================

/**
 * GET /menu/versions/:versionId/synonyms
 */
router.get(
  '/versions/:versionId/synonyms',
  async (req: Request, res: Response<ApiResponse<MenuSynonymDto[]>>, next: NextFunction) => {
    try {
      const synonyms = await menuService.getSynonyms(req.tenantId!, req.params.versionId);
      res.json({ success: true, data: synonyms });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /menu/versions/:versionId/synonyms
 */
router.post(
  '/versions/:versionId/synonyms',
  async (req: Request, res: Response<ApiResponse<MenuSynonymDto>>, next: NextFunction) => {
    try {
      const validation = createSynonymSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid synonym data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const synonym = await menuService.createSynonym(
        req.tenantId!,
        req.params.versionId,
        validation.data
      );
      res.status(201).json({ success: true, data: synonym });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /menu/versions/:versionId/synonyms/:synonymId
 */
router.patch(
  '/versions/:versionId/synonyms/:synonymId',
  async (req: Request, res: Response<ApiResponse<MenuSynonymDto>>, next: NextFunction) => {
    try {
      const validation = updateSynonymSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid synonym data', {
          errors: validation.error.flatten().fieldErrors,
        });
      }

      const synonym = await menuService.updateSynonym(
        req.tenantId!,
        req.params.versionId,
        req.params.synonymId,
        validation.data
      );
      res.json({ success: true, data: synonym });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /menu/versions/:versionId/synonyms/:synonymId
 */
router.delete(
  '/versions/:versionId/synonyms/:synonymId',
  async (req: Request, res: Response<ApiResponse<void>>, next: NextFunction) => {
    try {
      await menuService.deleteSynonym(req.tenantId!, req.params.versionId, req.params.synonymId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export const menuRouter = router;


