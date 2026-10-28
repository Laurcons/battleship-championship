import { CLASSIC_10X10 } from '@bsc/engine';
import { describe, expect, it } from 'vitest';
import { adminLoginSchema, createLobbySchema, rulesetSchema, startSeriesSchema, updateSettingsSchema } from '../src/index.js';

describe('request schemas', () => {
  it('accepts valid lobby requests and rejects unknown opponents', () => {
    expect(createLobbySchema.safeParse({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' }).success).toBe(true);
    expect(createLobbySchema.safeParse({ opponent: { kind: 'participant', participantId: 'p_1' }, rulesetId: 'x', godMode: false }).success).toBe(true);
    expect(createLobbySchema.safeParse({ opponent: { kind: 'bot', bot: 'chess-engine' }, rulesetId: 'x' }).success).toBe(false);
    expect(createLobbySchema.safeParse({ opponent: { kind: 'robot' }, rulesetId: 'x' }).success).toBe(false);
    expect(createLobbySchema.safeParse({ opponent: { kind: 'bot', bot: 'random' } }).success).toBe(false);
  });

  it('bounds numbers and strings', () => {
    expect(startSeriesSchema.safeParse({ games: 100 }).success).toBe(true);
    for (const games of [0, -1, 1.5, '3', 10_000_000]) expect(startSeriesSchema.safeParse({ games }).success).toBe(false);
    expect(adminLoginSchema.safeParse({ username: 'a', password: "x".repeat(1025) }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({}).success).toBe(true);
    expect(updateSettingsSchema.safeParse({ allowGodMode: 'yes' }).success).toBe(false);
  });

  it('accepts the engine ruleset shape and drops unknown fields', () => {
    const parsed = rulesetSchema.parse({ ...CLASSIC_10X10, injected: 'x' });
    expect(parsed).toEqual(CLASSIC_10X10);
  });
});
