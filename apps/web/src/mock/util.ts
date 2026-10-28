/** A fresh account token: 32 random characters after the `bsc_` prefix. */
export function newToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `bsc_${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}
