import pino, { Logger } from 'pino';
import { getConfig } from '@whatres/config';

export function createLogger(): Logger {
  const config = getConfig();

  return pino({
    level: config.log.level,
    transport:
      config.server.nodeEnv === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  });
}


