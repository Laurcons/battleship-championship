import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASSIC_10X10 } from '@bsc/engine';
import { describe, expect, it } from 'vitest';
import { toWireRuleset } from '../src/index.js';

const doc = (name: string) => readFileSync(join(import.meta.dirname, '../../../docs', name), 'utf8');
const protocolDoc = doc('protocol-v1.md');
const rulesetsDoc = doc('rulesets.md');

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
