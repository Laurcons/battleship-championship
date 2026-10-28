import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { AppModule, type AppOptions } from './app.module.js';
import { CsrfMiddleware, SessionMiddleware, apiRateLimit, noStore, securityHeaders } from './http/middleware.js';
import { systemClock } from './platform/util.js';
import { AuthService } from './platform/auth.service.js';

/** Builds the application (without listening), so tests and `main` share one configuration. */
export async function createApp(options: AppOptions): Promise<NestExpressApplication> {
  const { config } = options;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), {
    logger: config.env === 'test' ? false : ['log', 'warn', 'error'],
    bodyParser: false,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use(securityHeaders);
  app.use('/api', noStore);
  app.use('/api', apiRateLimit(config.apiRatePerMinute, options.clock ?? systemClock));
  app.use(express.json({ limit: '32kb' }));
  const csrf = new CsrfMiddleware(config);
  app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => csrf.use(req, res, next));
  const session = new SessionMiddleware(app.get(AuthService));
  app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => void session.use(req, res, next));
  app.enableShutdownHooks();
  return app;
}

/** Serves the built web app (single-page app fallback) after the API routes. */
export function serveWeb(app: NestExpressApplication, webDist: string): void {
  const index = join(webDist, 'index.html');
  if (!existsSync(index)) return;
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.use(express.static(webDist, { index: false, maxAge: '1h' }));
  server.get(/^(?!\/api\/|\/program\/).*/, (_req, res) => res.sendFile(index));
}
