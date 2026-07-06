import { Request, Response, NextFunction } from 'express';
import { adminService, AdminJwtPayload } from '../services/admin.service';
import { AppError } from './error-handler';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminJwtPayload;
    }
  }
}

/**
 * Guards /api/admin/* routes. Requires a valid SUPER_ADMIN JWT (issued by
 * adminService.login). Completely separate from tenant requireAuth — an admin
 * token has no tenant scope and grants cross-tenant access.
 */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'NO_TOKEN', 'Yönetici oturumu gerekli.');
    }
    const token = authHeader.split(' ')[1];
    req.admin = adminService.verifyToken(token);
    next();
  } catch (error) {
    next(error);
  }
}
