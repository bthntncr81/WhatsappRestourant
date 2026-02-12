import { Request, Response, NextFunction } from 'express';
import { JwtPayload, MemberRole } from '@whatres/shared';
import { authService } from '../services/auth.service';
import { AppError } from './error-handler';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      tenantId?: string;
    }
  }
}

/**
 * Middleware to extract and verify JWT token
 * Also extracts tenant ID from x-tenant-id header
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'NO_TOKEN', 'No authentication token provided');
    }

    const token = authHeader.split(' ')[1];
    const payload = authService.verifyToken(token);

    // Get tenant ID from header or use from token
    const headerTenantId = req.headers['x-tenant-id'] as string;
    const tenantId = headerTenantId || payload.tenantId;

    // Verify user has access to requested tenant
    if (headerTenantId && headerTenantId !== payload.tenantId) {
      throw new AppError(403, 'TENANT_MISMATCH', 'Token is not valid for this tenant');
    }

    req.user = payload;
    req.tenantId = tenantId;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to check if user has required role(s)
 */
export function requireRole(allowedRoles: MemberRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'NOT_AUTHENTICATED', 'Authentication required');
      }

      if (!allowedRoles.includes(req.user.role)) {
        throw new AppError(
          403,
          'INSUFFICIENT_PERMISSIONS',
          `Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Optional auth - doesn't fail if no token, but populates user if present
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const payload = authService.verifyToken(token);
      req.user = payload;
      req.tenantId = (req.headers['x-tenant-id'] as string) || payload.tenantId;
    }
    next();
  } catch {
    // Ignore errors for optional auth
    next();
  }
}


