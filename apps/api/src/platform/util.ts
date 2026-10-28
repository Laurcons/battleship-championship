import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface Clock {
  now(): number;
}
export const CLOCK = Symbol('CLOCK');
export const systemClock: Clock = { now: () => Date.now() };

const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Unguessable, URL-safe id, e.g. `g_4f9q2k7x1m8c`. */
export function newId(prefix: string, length = 12): string {
  let out = '';
  for (const b of randomBytes(length)) out += ID_ALPHABET[b % 32];
  return `${prefix}_${out}`;
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export function randomBytesUint8(n: number): Uint8Array {
  return new Uint8Array(randomBytes(n));
}

// --- passwords (scrypt) ------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

const scryptAsync = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key))),
  );

/**
 * `scrypt:<salt hex>:<hash hex>`. Colons, not dollar signs: `$` is interpolated by Docker Compose
 * and shells, which silently corrupts a hash pasted into an `.env` file.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${(await scryptAsync(password, salt)).toString('hex')}`;
}

export type Secret = { hash: string } | { plain: string };

export async function verifyPassword(password: string, secret: Secret): Promise<boolean> {
  if ('plain' in secret) {
    const a = createHash('sha256').update(password).digest();
    const b = createHash('sha256').update(secret.plain).digest();
    return timingSafeEqual(a, b);
  }
  // The first version of the format used `$` as the separator; it is still accepted.
  const [scheme, saltHex, hashHex] = secret.hash.split(/[:$]/);
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Serializes async work so check-then-act sequences cannot interleave. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Counts events per key within a sliding window. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  private recent(key: string): number[] {
    const now = this.clock.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Seconds until another attempt is allowed, or 0 if the key is not limited. */
  retryAfterSec(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((this.windowMs - (this.clock.now() - (list[0] as number))) / 1000));
  }

  hit(key: string): void {
    const list = this.recent(key);
    list.push(this.clock.now());
    this.hits.set(key, list);
    // Bound memory under a flood of distinct keys.
    if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value as string);
  }

  clear(key: string): void {
    this.hits.delete(key);
  }
}
