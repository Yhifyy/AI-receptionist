import { pino, type LoggerOptions } from 'pino';

export function createLogger(options?: LoggerOptions) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' 
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    ...options,
  });
}

export const logger = createLogger();
