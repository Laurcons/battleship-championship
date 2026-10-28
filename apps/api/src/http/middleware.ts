import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CONFIG, type Config } from '../config.js';
import { AuthService } from '../platform/auth.service.js';
import { COOKIE_NAME, parseCookies, type AuthedRequest } from './context.js';

/** Resolves the session cookie to a viewer (or none) before any handler runs. */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authed = req as AuthedRequest;
    try {
      const cookie = parseCookies(req.headers.cookie)[COOKIE_NAME];
      authed.sessionCookie = cookie;
      const viewer = await this.auth.viewerFor(cookie);
      if (viewer) authed.viewer = viewer;
      next();
    } catch (error) {
      next(error);
    }
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions: state-changing requests must be JSON (which a cross-site form
 * cannot send) and, when the browser says where they come from, must come from this site.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) return next();
    const reject = (message: string) => {
      res.status(403).json({ error: { code: 'forbidden', message } });
    };
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const allowed = this.config.publicOrigin ?? `${req.protocol}://${req.get('host')}`;
      if (origin !== allowed) return reject('Cross-site requests are not allowed.');
    } else if (req.headers['sec-fetch-site'] === 'cross-site') {
      return reject('Cross-site requests are not allowed.');
    }
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !req.is('application/json')) return reject('Send JSON with Content-Type: application/json.');
    next();
  }
}

/** Strict security headers. Scripts come only from this site; program-supplied text is rendered as text. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

/** API responses carry per-viewer data: never cache them. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
