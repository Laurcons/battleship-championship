/* eslint-disable @typescript-eslint/no-explicit-any -- the test client returns untyped JSON on purpose */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../../src/bootstrap.js';
import { loadConfig, type Config } from '../../src/config.js';
import { MemoryStore } from '../../src/store/memory.js';
import type { Store } from '../../src/store/store.js';
import type { Clock } from '../../src/platform/util.js';

export const SHARED_PASSWORD = 'correct horse battery staple';
export const ADMIN_PASSWORD = 'admin-secret-1';

export interface ApiResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** A tiny HTTP client with its own cookie jar, so one test can act as several people. */
export class Client {
  cookie = '';
  constructor(
    private readonly base: string,
    private readonly origin: string,
  ) {}

  async request<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] ??= 'application/json';
    if (method !== 'GET') headers.origin ??= this.origin;
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('bsc_session='));
    if (setCookie) {
      const value = setCookie.split(';')[0] as string;
      this.cookie = value === 'bsc_session=' ? '' : value;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get = <T = any>(path: string) => this.request<T>('GET', path);
  post = <T = any>(path: string, body?: unknown) => this.request<T>('POST', path, body ?? {});
  patch = <T = any>(path: string, body?: unknown) => this.request<T>('PATCH', path, body ?? {});
  del = <T = any>(path: string) => this.request<T>('DELETE', path);

  async loginAdmin(): Promise<void> {
    const r = await this.post('/api/auth/admin', { username: 'admin', password: ADMIN_PASSWORD });
    if (r.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(r.body)}`);
  }

  async loginAs(participantId: string | undefined): Promise<void> {
    if (!participantId) throw new Error('unknown participant');
    const gate = await this.post('/api/auth/gate', { password: SHARED_PASSWORD });
    if (gate.status !== 200) throw new Error(`gate failed: ${JSON.stringify(gate.body)}`);
    const r = await this.post('/api/auth/participant', { participantId });
    if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
  }
}

export interface TestApp {
  app: NestExpressApplication;
  config: Config;
  store: Store;
  url: string;
  client(): Client;
  /** Admin-created participants by name. */
  people: Record<string, string>;
  close(): Promise<void>;
}

export async function startTestApp(
  options: { env?: Record<string, string>; names?: string[]; clock?: Clock; store?: Store } = {},
): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    SHARED_PASSWORD: SHARED_PASSWORD,
    ADMIN_PASSWORD: ADMIN_PASSWORD,
    ...options.env,
  });
  const store = options.store ?? new MemoryStore();
  const app = await createApp({ config, store, ...(options.clock ? { clock: options.clock } : {}) });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const make = () => new Client(url, url);

  const admin = make();
  await admin.loginAdmin();
  const people: Record<string, string> = {};
  for (const name of options.names ?? ['Alice', 'Bruno', 'Chen']) {
    const r = await admin.post('/api/admin/participants', { name });
    people[name] = r.body.id;
  }
  return { app, config, store, url, client: make, people, close: () => app.close() };
}
