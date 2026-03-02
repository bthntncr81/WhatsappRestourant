import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { menuMediaService } from '../services/menu-media.service';
import { requireAuth } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error-handler';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max (further validated in service)
});

router.use(requireAuth);
router.use(requireRole(['OWNER', 'ADMIN']));

// GET / -- List all menu media for tenant
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const media = await menuMediaService.getMediaForTenant(req.tenantId!);
    res.json({ success: true, data: media });
  } catch (error) {
    next(error);
  }
});

// POST / -- Upload a new menu media file
router.post('/', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_FILE', 'Dosya yuklenemedi');
    const caption = req.body.caption || undefined;
    const media = await menuMediaService.uploadMedia(req.tenantId!, req.file, caption);
    res.status(201).json({ success: true, data: media });
  } catch (error) {
    next(error);
  }
});

// PUT /reorder -- Reorder all media
router.put('/reorder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ mediaIds: z.array(z.string().min(1)) });
    const validation = schema.safeParse(req.body);
    if (!validation.success) throw new AppError(400, 'VALIDATION_ERROR', 'Gecersiz veri');
    const media = await menuMediaService.reorderMedia(req.tenantId!, validation.data.mediaIds);
    res.json({ success: true, data: media });
  } catch (error) {
    next(error);
  }
});

// DELETE /:mediaId -- Delete a menu media file
router.delete('/:mediaId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await menuMediaService.deleteMedia(req.tenantId!, req.params.mediaId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export const menuMediaRouter = router;
