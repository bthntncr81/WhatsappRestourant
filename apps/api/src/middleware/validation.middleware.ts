import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from './error-handler';

export const validate = (schema: z.ZodSchema) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed', {
          errors: error.errors,
        });
      }
      throw error;
    }
  };
};


