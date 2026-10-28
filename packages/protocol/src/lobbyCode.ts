/** Crockford base32 without I, L, O, U: easy to read aloud and copy. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Weighted sum modulo 32 with odd weights: an odd number is invertible modulo 32, so changing any
 * single character always changes the check character (every single-character typo is detected).
 */
function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += ALPHABET.indexOf(body[i] as string) * (2 * i + 1);
  return ALPHABET[sum % 32] as string;
}

/** 8 random characters plus a check character, e.g. `K7QM-4XD2-7`. */
export function generateLobbyCode(random: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < 8; i++) body += ALPHABET[Math.floor(random() * 32)];
  return `${body.slice(0, 4)}-${body.slice(4)}-${checkChar(body)}`;
}

/** Normalizes user input (case, dashes, spaces, the usual look-alikes) to canonical form, or null. */
export function normalizeLobbyCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{9}$/.test(cleaned)) return null;
  const body = cleaned.slice(0, 8);
  if (checkChar(body) !== cleaned[8]) return null;
  return `${body.slice(0, 4)}-${body.slice(4)}-${cleaned[8]}`;
}
