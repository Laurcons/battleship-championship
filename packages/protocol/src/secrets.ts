const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const TOKEN_PREFIX = 'bsc_';
export const TOKEN_BODY_LENGTH = 32;

/**
 * Creates a program token. `randomBytes` must be cryptographically secure (e.g. `crypto.randomBytes`
 * or `crypto.getRandomValues`). Bytes >= 248 are rejected so every character is uniformly likely.
 */
export function generateToken(randomBytes: (n: number) => Uint8Array): string {
  const limit = 248; // largest multiple of 62 that fits in a byte
  let body = '';
  while (body.length < TOKEN_BODY_LENGTH) {
    for (const b of randomBytes(TOKEN_BODY_LENGTH * 2)) {
      if (b < limit && body.length < TOKEN_BODY_LENGTH) body += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
    }
  }
  return TOKEN_PREFIX + body;
}

export const TOKEN_PATTERN = /^bsc_[A-Za-z0-9]{32}$/;
