// @vitest-environment node
import { CLASSIC_10X10 } from '@bsc/engine';
import { describe, expect, it } from 'vitest';
import protocolDoc from '../../../docs/protocol-v1.md?raw';
import rulesetsDoc from '../../../docs/rulesets.md?raw';
import { toWireRuleset } from '../src/lib/wire';

describe('ruleset wire format', () => {
  it('has exactly the fields of the welcome example in the protocol document', () => {
    const blocks = [...protocolDoc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] as string));
    const welcome = blocks.find((b) => b.type === 'welcome');
    expect(welcome).toBeDefined();
    expect(Object.keys(toWireRuleset(CLASSIC_10X10)).sort()).toEqual(Object.keys(welcome.ruleset).sort());
  });

  it('documents every field in the rulesets page', () => {
    for (const field of Object.keys(toWireRuleset(CLASSIC_10X10))) {
      const documented = field === 'width' || field === 'height' ? 'width' : field;
      expect(rulesetsDoc, field).toContain(`\`${documented}`);
    }
  });

  it('maps values faithfully', () => {
    expect(toWireRuleset({ ...CLASSIC_10X10, extraTurnOnHit: false, repeatShot: 'waste' })).toMatchObject({
      extra_turn_on_hit: false,
      repeat_shot: 'waste',
      fleet: [5, 4, 3, 3, 2],
    });
  });
});

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
