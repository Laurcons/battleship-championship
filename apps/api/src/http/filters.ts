import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ApiError, type ApiErrorCode } from '@bsc/api-contract';
import type { Response } from 'express';

const STATUS: Record<ApiErrorCode, number> = {
  internal: 500,
  unavailable: 503,
  invalid_credentials: 401,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 400,
  rate_limited: 429,
};

/** Every error leaves as `{ error: { code, message, details? } }`; internals are never leaked. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    if (exception instanceof ApiError) {
      if (exception.code === 'rate_limited') {
        const retry = exception.details?.retryAfterSec;
        if (typeof retry === 'number') res.setHeader('Retry-After', String(retry));
      }
      res.status(STATUS[exception.code]).json({
        error: { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) },
      });
      return;
    }
    // HttpException (Nest) or an http-errors error from the body parser (malformed or oversized JSON).
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof (exception as { status?: unknown })?.status === 'number'
          ? (exception as { status: number }).status
          : null;
    if (status !== null && status >= 400 && status < 500) {
      const code: ApiErrorCode = status === 404 ? 'not_found' : status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'validation';
      const message = status === 413 ? 'The request is too large.' : status === 404 ? 'Not found.' : 'The request could not be understood.';
      res.status(status).json({ error: { code, message } });
      return;
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on the server.' } });
  }
}
