import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { logger, logStorage } from '@config/logger';

export const REQUEST_ID_HEADER = 'x-request-id';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers[REQUEST_ID_HEADER] as string) || uuidv4();
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const startTime = Date.now();
  const store: string[] = [];

  logStorage.run(store, () => {
    // Intercept res.json to inject captured logs
    const originalJson = res.json;
    res.json = function (body) {
      if (body && typeof body === 'object') {
        body.logs = store;
      }
      return originalJson.call(this, body);
    };

    logger.debug(`→ ${req.method} ${req.path}`, {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      const logMessage = `${req.method} ${req.path} ${statusCode} ${res.statusMessage} - ${duration}ms`;

      if (statusCode >= 500) {
        logger.error(logMessage, { requestId, duration, statusCode });
      } else if (statusCode >= 400) {
        logger.warn(logMessage, { requestId, duration, statusCode });
      } else {
        logger.http(logMessage, { requestId, duration, statusCode });
      }
    });

    next();
  });
}
