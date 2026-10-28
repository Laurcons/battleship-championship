import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/platform/util.js';

describe('password hashes', () => {
  it('verify the right password only, whatever its length or content', async () => {
    for (const password of ['x', '', 'adminadmin', 'p@ss $word ${HOME} "quoted" é🚢', 'long'.repeat(500)]) {
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, { hash })).toBe(true);
      expect(await verifyPassword(password + ' ', { hash })).toBe(false);
    }
  });

  it('contain no character that Docker Compose, a shell or an .env file would rewrite', async () => {
    expect(await hashPassword('adminadmin')).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('still accepts hashes made with the older "$" separator', async () => {
    const hash = (await hashPassword('adminadmin')).replace(/:/g, '$');
    expect(await verifyPassword('adminadmin', { hash })).toBe(true);
    expect(await verifyPassword('wrong', { hash })).toBe(false);
  });

  it('rejects malformed hashes instead of throwing', async () => {
    for (const hash of ['', 'scrypt', 'scrypt:abc', 'md5:aa:bb', 'scrypt::']) expect(await verifyPassword('x', { hash })).toBe(false);
  });
});
