// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { formatDuration } from '../src/lib/format';

describe('formatDuration', () => {
  it('drops zero parts', () => {
    expect(formatDuration(60_000)).toBe('1 min');
    expect(formatDuration(90_000)).toBe('1 min 30 s');
    expect(formatDuration(7_200_000)).toBe('2 h');
    expect(formatDuration(7_260_000)).toBe('2 h 1 min');
    expect(formatDuration(10_000)).toBe('10 s');
    expect(formatDuration(250)).toBe('250 ms');
  });
});
