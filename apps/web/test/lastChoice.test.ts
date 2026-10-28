import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLastGodMode, rememberGodMode } from '../src/lib/lastChoice';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('remembering the last god-mode choice', () => {
  it('starts on, then follows the last choice, separately for each participant', () => {
    expect(getLastGodMode('p_alice')).toBe(true);
    rememberGodMode('p_alice', false);
    expect(getLastGodMode('p_alice')).toBe(false);
    expect(getLastGodMode('p_bruno')).toBe(true);
    rememberGodMode('p_alice', true);
    expect(getLastGodMode('p_alice')).toBe(true);
  });

  it('keeps working when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getLastGodMode('p_alice')).toBe(true);
    expect(() => rememberGodMode('p_alice', false)).not.toThrow();
  });
});
