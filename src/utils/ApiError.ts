export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  isOperational: boolean;
  details?: Array<{ path: string; message: string }>;
}

export function createApiError(
  statusCode: number,
  message: string,
  code: string,
  details?: Array<{ path: string; message: string }>,
): ApiError {
  return { statusCode, code, message, isOperational: true, details };
}

export function badRequest(
  message = 'Bad Request',
  details?: Array<{ path: string; message: string }>,
): ApiError {
  return createApiError(400, message, 'BAD_REQUEST', details);
}

export function unauthorized(message = 'Unauthorized'): ApiError {
  return createApiError(401, message, 'UNAUTHORIZED');
}

export function forbidden(message = 'Forbidden'): ApiError {
  return createApiError(403, message, 'FORBIDDEN');
}

export function notFound(message = 'Resource not found'): ApiError {
  return createApiError(404, message, 'NOT_FOUND');
}

export function conflict(message = 'Resource conflict'): ApiError {
  return createApiError(409, message, 'CONFLICT');
}

export function validationError(
  message = 'Validation failed',
  details: Array<{ path: string; message: string }> = [],
): ApiError {
  return createApiError(422, message, 'VALIDATION_ERROR', details);
}

export function tooManyRequests(message = 'Too many requests'): ApiError {
  return createApiError(429, message, 'TOO_MANY_REQUESTS');
}

export function internalError(message = 'Internal Server Error'): ApiError {
  return createApiError(500, message, 'INTERNAL_ERROR');
}

export function serviceUnavailable(message = 'Service unavailable'): ApiError {
  return createApiError(503, message, 'SERVICE_UNAVAILABLE');
}
