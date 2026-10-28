import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateToken, TOKEN_PATTERN } from '../src/index.js';

describe('generateToken', () => {
  it('has the documented shape', () => {
    for (let i = 0; i < 100; i++) expect(generateToken((n) => randomBytes(n))).toMatch(TOKEN_PATTERN);
  });

  it('is unbiased: bytes above the largest multiple of 62 are discarded', () => {
    // First request yields only rejected bytes, so a second request must be made.
    const calls: number[] = [];
    const feed = [new Uint8Array(64).fill(250), new Uint8Array(64).fill(61)];
    const token = generateToken((n) => {
      calls.push(n);
      return feed.shift() ?? new Uint8Array(n).fill(0);
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(token).toBe(`bsc_${'9'.repeat(32)}`);
  });

  it('does not collide', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateToken((n) => randomBytes(n)));
    expect(seen.size).toBe(5000);
  });
});
