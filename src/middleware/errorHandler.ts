import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

import { logger } from '@config/logger';
import { ApiError } from '@utils/ApiError';

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ path: string; message: string }>;
  };
}

export function errorHandler(
  err: Error | ApiError | Record<string, unknown>,
  req: Request,
  res: Response,

  _next: NextFunction,
): void {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';

  if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request data';

    const details = err.errors.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    logger.warn('Validation error', { path: req.path, details });

    const response: ErrorResponse = {
      success: false,
      error: { code, message, details },
    };

    res.status(statusCode).json(response);
    return;
  }

  if (isApiError(err)) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  } else if (err instanceof Error) {
    code = 'INTERNAL_ERROR';
    message = err.message;
  }

  if (statusCode >= 500) {
    logger.error(message, {
      error: err instanceof Error ? err.stack : undefined,
      path: req.path,
      method: req.method,
      statusCode,
    });
  } else {
    logger.warn(message, {
      path: req.path,
      method: req.method,
      statusCode,
    });
  }

  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message:
        process.env.NODE_ENV === 'production' && statusCode === 500
          ? 'Internal Server Error'
          : message,
    },
  };

  if (process.env.NODE_ENV !== 'production' && err instanceof Error && err.stack) {
    (response.error as Record<string, unknown>).stack = err.stack;
  }

  res.status(statusCode).json(response);
}

function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    'code' in err &&
    'message' in err &&
    typeof (err as ApiError).statusCode === 'number' &&
    typeof (err as ApiError).code === 'string' &&
    typeof (err as ApiError).message === 'string'
  );
}
