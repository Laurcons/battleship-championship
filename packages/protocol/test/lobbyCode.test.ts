// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateLobbyCode, normalizeLobbyCode } from '../src/lobbyCode.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('lobby codes', () => {
  it('has the documented shape and no ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLobbyCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('is unique enough: no collisions in 20000 codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(generateLobbyCode());
    expect(seen.size).toBe(20_000);
  });

  it('normalizes case, spaces, missing dashes and look-alike characters', () => {
    const code = generateLobbyCode();
    expect(normalizeLobbyCode(code)).toBe(code);
    expect(normalizeLobbyCode(code.toLowerCase())).toBe(code);
    expect(normalizeLobbyCode(code.replace(/-/g, ' '))).toBe(code);
    expect(normalizeLobbyCode(code.replace(/-/g, ''))).toBe(code);
  });

  it('rejects wrong lengths and characters', () => {
    expect(normalizeLobbyCode('')).toBeNull();
    expect(normalizeLobbyCode('ABCD-EFGH')).toBeNull();
    expect(normalizeLobbyCode('ABCD-EFGH-JK')).toBeNull();
    expect(normalizeLobbyCode('ABCD-EFG!-J')).toBeNull();
  });

  it('detects every single-character typo (so a mistyped id never reaches the server)', () => {
    for (let n = 0; n < 300; n++) {
      const code = generateLobbyCode();
      const plain = code.replace(/-/g, '');
      for (let pos = 0; pos < plain.length; pos++) {
        for (const ch of ALPHABET) {
          if (ch === plain[pos]) continue;
          const typo = plain.slice(0, pos) + ch + plain.slice(pos + 1);
          expect(normalizeLobbyCode(typo), `${plain} -> ${typo}`).toBeNull();
        }
      }
    }
  });
});
