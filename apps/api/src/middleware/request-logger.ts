import { Request, Response, NextFunction } from 'express';
import { Logger } from 'pino';

export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const logData = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('user-agent'),
        ip: req.ip || req.socket.remoteAddress,
      };

      if (res.statusCode >= 400) {
        logger.warn(logData, 'Request completed with error');
      } else {
        logger.info(logData, 'Request completed');
      }
    });

    next();
  };
}


