import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { buildJsonSchemas, frameSchema, inboundSchema, JSON_SCHEMA_DIR, MESSAGE_TYPES_TO_PLATFORM, outboundSchema } from '../src/index.js';
import { jsonBlocks } from './helpers/docsExamples.js';

const publishedDir = join(import.meta.dirname, '../../../apps/web/public', JSON_SCHEMA_DIR);
const generated = buildJsonSchemas();

// `pnpm --filter @bsc/protocol schemas` rewrites the published files from the zod schemas.
if (process.env.UPDATE_SCHEMAS) {
  mkdirSync(publishedDir, { recursive: true });
  for (const [name, text] of Object.entries(generated)) writeFileSync(join(publishedDir, name), text);
}

function compile(name: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: false });
  return ajv.compile(JSON.parse(readFileSync(join(publishedDir, name), 'utf8')));
}

const examples = jsonBlocks()
  .map((b) => ({ at: `${b.file}:${b.line}`, value: JSON.parse(b.text) as Record<string, unknown> }))
  .filter((b) => frameSchema.safeParse(b.value).success);

describe('published JSON Schemas', () => {
  it.each(Object.keys(generated))('%s is what the zod schemas generate (run "pnpm --filter @bsc/protocol schemas" to update)', (name) => {
    expect(readFileSync(join(publishedDir, name), 'utf8')).toBe(generated[name]);
  });

  it('are valid JSON Schema documents that compile', () => {
    for (const name of Object.keys(generated)) expect(() => compile(name)).not.toThrow();
  });

  it('accept every protocol example in docs/', () => {
    expect(examples.length).toBeGreaterThanOrEqual(9);
    const all = compile('program-v1.json');
    const toPlatform = compile('to-platform.json');
    const toProgram = compile('to-program.json');
    for (const { at, value } of examples) {
      const mine = (MESSAGE_TYPES_TO_PLATFORM as readonly string[]).includes(value.type as string) ? toPlatform : toProgram;
      const other = mine === toPlatform ? toProgram : toPlatform;
      expect(all(value), `${at}: ${JSON.stringify(all.errors)}`).toBe(true);
      expect(mine(value), `${at}: ${JSON.stringify(mine.errors)}`).toBe(true);
      expect(other(value), `${at} must not match the other direction`).toBe(false);
    }
  });

  it('agree with the zod schemas on damaged copies of every example', () => {
    const all = compile('program-v1.json');
    const damage: unknown[] = [null, 'x', -1, 1.5, [], {}, true];
    let accepted = 0;
    let rejected = 0;
    for (const { at, value } of examples) {
      const variants: Record<string, unknown>[] = [];
      for (const key of Object.keys(value)) {
        variants.push(Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)));
        for (const bad of damage) variants.push({ ...value, [key]: bad });
      }
      variants.push({ ...value, type: 'nope' }, { ...value, extra: 1 });
      for (const variant of variants) {
        const zodSays = frameSchema.safeParse(variant).success;
        expect(all(variant), `${at}: ${JSON.stringify(variant)}`).toBe(zodSays);
        if (zodSays) accepted++;
        else rejected++;
      }
    }
    // Both verdicts must occur, or the comparison proves nothing.
    expect(accepted).toBeGreaterThan(10);
    expect(rejected).toBeGreaterThan(300);
  });

  it('tell the two boards apart: S only on your own, # only on the enemy one', () => {
    const turn = examples.find((e) => e.value.type === 'turn')?.value as { you: string[]; enemy: string[] };
    const toProgram = compile('to-program.json');
    expect(toProgram({ ...turn, enemy: turn.enemy.map((r, i) => (i === 0 ? `S${r.slice(1)}` : r)) })).toBe(false);
    expect(toProgram({ ...turn, you: turn.you.map((r, i) => (i === 0 ? `#${r.slice(1)}` : r)) })).toBe(false);
    expect(toProgram({ ...turn, enemy: turn.enemy.map((r, i) => (i === 0 ? `#${r.slice(1)}` : r)) })).toBe(true);
  });

  it('leave objects open: unknown fields are ignored, not errors', () => {
    const hello = examples.find((e) => e.value.type === 'hello')?.value;
    expect(compile('to-platform.json')({ ...hello, future_field: { a: 1 } })).toBe(true);
    expect(inboundSchema.safeParse({ ...hello, future_field: 1 }).success).toBe(true);
    const turn = examples.find((e) => e.value.type === 'turn')?.value;
    expect(compile('to-program.json')({ ...turn, future_field: [] })).toBe(true);
    expect(outboundSchema.safeParse({ ...turn, future_field: 1 }).success).toBe(true);
  });
});
