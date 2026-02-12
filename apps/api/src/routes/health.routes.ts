import { Router, Request, Response } from 'express';
import { HealthResponse, ApiResponse } from '@whatres/shared';

const router = Router();
const startTime = Date.now();
const version = process.env.npm_package_version || '0.0.1';

router.get('/', (_req: Request, res: Response<ApiResponse<HealthResponse>>) => {
  const health: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version,
  };

  res.json({
    success: true,
    data: health,
  });
});

router.get('/ready', (_req: Request, res: Response<ApiResponse<{ ready: boolean }>>) => {
  // Add database/redis connection checks here
  res.json({
    success: true,
    data: { ready: true },
  });
});

router.get('/live', (_req: Request, res: Response<ApiResponse<{ alive: boolean }>>) => {
  res.json({
    success: true,
    data: { alive: true },
  });
});

export const healthRouter = router;


