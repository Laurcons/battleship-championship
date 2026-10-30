import { createParamDecorator, SetMetadata, type ExecutionContext, type PipeTransform } from '@nestjs/common';
import { ApiError } from '@bsc/api-contract';
import type { Request } from 'express';
import type { ZodType } from 'zod';
import type { Viewer } from '../platform/policy.js';

export type AuthedRequest = Request & { viewer?: Viewer; sessionCookie?: string };

export const COOKIE_NAME = 'bsc_session';

const ACCESS_KEY = 'bsc:access';
export type Access = 'public' | 'any' | 'participant' | 'admin';

/**
 * Every route declares who may call it. Routes without a declaration are refused by the guard,
 * so a forgotten annotation fails closed.
 */
export const Access = (access: Access) => SetMetadata(ACCESS_KEY, access);
export const ACCESS_METADATA_KEY = ACCESS_KEY;

/** The signed-in viewer (set by the session middleware, checked by the guard). */
export const CurrentViewer = createParamDecorator((_data: unknown, ctx: ExecutionContext): Viewer => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.viewer) throw new ApiError('unauthenticated', 'You are not logged in.');
  return req.viewer;
});

/** The signed-in viewer, or undefined for an anonymous caller. Only for routes declared `public`. */
export const OptionalViewer = createParamDecorator((_data: unknown, ctx: ExecutionContext): Viewer | undefined =>
  ctx.switchToHttp().getRequest<AuthedRequest>().viewer,
);

export const CurrentParticipant = createParamDecorator((_data: unknown, ctx: ExecutionContext): { participantId: string; name: string } => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (req.viewer?.role !== 'participant') throw new ApiError('forbidden', 'Only participants can do this.');
  return req.viewer;
});

export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): { username: string } => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (req.viewer?.role !== 'admin') throw new ApiError('forbidden', 'Only the admin can do this.');
  return req.viewer;
});

export const SessionCookie = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined =>
  ctx.switchToHttp().getRequest<AuthedRequest>().sessionCookie,
);

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  ctx.switchToHttp().getRequest<Request>().ip ?? 'unknown',
);

/** Validates a request part against a zod schema, reporting the first problem in plain words. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
    throw new ApiError('validation', `Invalid request${where}: ${issue?.message ?? 'unexpected shape'}.`);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
