import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const int = (def: number) => z.coerce.number().int().min(0).default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3000),
  HOST: z.string().default('0.0.0.0'),
  /** `mysql://user:password@host:3306/database`; without it, data lives in memory only. */
  DATABASE_URL: z.string().optional(),
  /** Public origin of the site (for the CSRF origin check), e.g. https://battleships.example.com */
  PUBLIC_ORIGIN: z.string().optional(),
  /** Number of reverse proxies in front of the API whose X-Forwarded-For header is trusted. */
  TRUST_PROXY_HOPS: int(0),
  /** Where the built web app lives; served at `/` when present. */
  WEB_DIST: z.string().optional(),
  /** scrypt hashes (see `pnpm --filter @bsc/api hash-password`). Plain *_PASSWORD only outside production. */
  SHARED_PASSWORD_HASH: z.string().optional(),
  SHARED_PASSWORD: z.string().optional(),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SESSION_TTL_HOURS: int(24 * 7),
  COOKIE_SECURE: bool.optional(),

  // Platform constants (docs/DECISIONS.md section 5); environment-configurable.
  MOVE_TIMEOUT_MS: int(10_000),
  PLACE_TIMEOUT_MS: int(10_000),
  GRACE_MS: int(60_000),
  IDLE_EXPIRY_MS: int(2 * 60 * 60 * 1000),
  MAX_OPEN_LOBBIES: int(10),
  MAX_STRIKES: int(3),
  HELLO_TIMEOUT_MS: int(5_000),
  PING_INTERVAL_MS: int(15_000),
  PONG_TIMEOUT_MS: int(30_000),
  MAX_PROGRAM_CONNECTIONS: int(100),
  LOGIN_ATTEMPTS: int(5),
  LOGIN_WINDOW_MS: int(60_000),
});

export type Env = z.infer<typeof schema>;

export interface Config {
  env: Env['NODE_ENV'];
  port: number;
  host: string;
  databaseUrl: string | null;
  publicOrigin: string | null;
  trustProxyHops: number;
  webDist: string | null;
  sharedPassword: { hash: string } | { plain: string };
  admin: { username: string; password: { hash: string } | { plain: string } };
  sessionTtlMs: number;
  cookieSecure: boolean;
  limits: {
    moveMs: number;
    placeMs: number;
    graceMs: number;
    idleExpiryMs: number;
    maxOpenLobbies: number;
    maxStrikes: number;
    helloTimeoutMs: number;
    pingIntervalMs: number;
    pongTimeoutMs: number;
    maxProgramConnections: number;
  };
  loginRate: { attempts: number; windowMs: number };
}

export const CONFIG = Symbol('CONFIG');

/** Parses the environment. In production, plain-text passwords and a missing database are refused. */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const env = schema.parse(source);
  const production = env.NODE_ENV === 'production';
  const secret = (hash: string | undefined, plain: string | undefined, name: string) => {
    if (hash) return { hash };
    if (plain && !production) return { plain };
    if (production) throw new Error(`${name}_HASH must be set in production.`);
    throw new Error(`Set ${name}_HASH (or ${name} outside production).`);
  };
  if (production && !env.DATABASE_URL) throw new Error('DATABASE_URL must be set in production.');
  if (production && !env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN must be set in production.');
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL ?? null,
    publicOrigin: env.PUBLIC_ORIGIN?.replace(/\/$/, '') ?? null,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    webDist: env.WEB_DIST ?? null,
    sharedPassword: secret(env.SHARED_PASSWORD_HASH, env.SHARED_PASSWORD, 'SHARED_PASSWORD'),
    admin: { username: env.ADMIN_USERNAME, password: secret(env.ADMIN_PASSWORD_HASH, env.ADMIN_PASSWORD, 'ADMIN_PASSWORD') },
    sessionTtlMs: env.SESSION_TTL_HOURS * 3_600_000,
    cookieSecure: env.COOKIE_SECURE ?? production,
    limits: {
      moveMs: env.MOVE_TIMEOUT_MS,
      placeMs: env.PLACE_TIMEOUT_MS,
      graceMs: env.GRACE_MS,
      idleExpiryMs: env.IDLE_EXPIRY_MS,
      maxOpenLobbies: env.MAX_OPEN_LOBBIES,
      maxStrikes: env.MAX_STRIKES,
      helloTimeoutMs: env.HELLO_TIMEOUT_MS,
      pingIntervalMs: env.PING_INTERVAL_MS,
      pongTimeoutMs: env.PONG_TIMEOUT_MS,
      maxProgramConnections: env.MAX_PROGRAM_CONNECTIONS,
    },
    loginRate: { attempts: env.LOGIN_ATTEMPTS, windowMs: env.LOGIN_WINDOW_MS },
  };
}
