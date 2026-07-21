import path from 'path';
import { createLogger, format, transports, Logger } from 'winston';
import Transport from 'winston-transport';
import DailyRotateFile from 'winston-daily-rotate-file';

import { env } from '@config/env';

const devFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.colorize({ all: true }),
  format.printf(({ level, message, timestamp, stack }) => {
    const stackTrace = stack ? `\n${stack}` : '';
    return `[${timestamp}] ${level}: ${message}${stackTrace}`;
  }),
);

const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json(),
);

const consoleTransport = new transports.Console({
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
});

const fileTransports: DailyRotateFile[] = [];

if (env.NODE_ENV === 'production') {
  fileTransports.push(
    new DailyRotateFile({
      filename: path.join(env.LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
    }),
  );

  fileTransports.push(
    new DailyRotateFile({
      filename: path.join(env.LOG_DIR, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
    }),
  );
}

import { AsyncLocalStorage } from 'async_hooks';

export const logStorage = new AsyncLocalStorage<string[]>();

class RequestLogTransport extends Transport {
  log(info: any, callback: () => void) {
    if (this.emit) {
      setImmediate(() => {
        this.emit('logged', info);
      });
    }

    const store = logStorage.getStore();
    if (store) {
      const level = info.level;
      const message = info.message;
      const stack = info.stack ? `\n${info.stack}` : '';
      const meta = Object.keys(info).reduce((acc: any, key) => {
        if (!['level', 'message', 'timestamp', 'service', 'environment', 'stack'].includes(key)) {
          acc[key] = info[key];
        }
        return acc;
      }, {});

      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      store.push(
        `[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}${metaStr}${stack}`,
      );
    }

    callback();
  }
}

export const logger: Logger = createLogger({
  level: env.LOG_LEVEL,
  defaultMeta: {
    service: env.APP_NAME,
    environment: env.NODE_ENV,
  },
  transports: [consoleTransport, ...fileTransports, new RequestLogTransport()],
  exitOnError: false,
});
