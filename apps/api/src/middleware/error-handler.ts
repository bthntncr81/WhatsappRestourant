import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { Logger } from 'pino';
import { ApiResponse } from '@whatres/shared';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (
    err: Error | AppError,
    req: Request,
    res: Response<ApiResponse>,
    _next: NextFunction
  ) => {
    logger.error(
      {
        err,
        method: req.method,
        path: req.path,
        body: req.body,
        query: req.query,
      },
      'Unhandled error'
    );

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      });
    }

    // Handle unexpected errors
    const statusCode = 500;
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : err.message,
      },
    };

    return res.status(statusCode).json(response);
  };
}


