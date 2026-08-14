import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const payload = source === 'body' ? { ...req.query, ...req.body } : req[source];
      const data = schema.parse(payload);
      if (source === 'body') {
        req.body = data;
      } else {
        req[source] = data;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        next({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Validation failed', details });
      } else {
        next(error);
      }
    }
  };
}

