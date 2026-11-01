import { describe, expect, it } from 'vitest';
import { frameSchema, MESSAGE_TYPES_TO_PLATFORM, MESSAGE_TYPES_TO_PROGRAM } from '../src/index.js';
import { jsonBlocks } from './helpers/docsExamples.js';

const knownTypes: readonly string[] = [...MESSAGE_TYPES_TO_PLATFORM, ...MESSAGE_TYPES_TO_PROGRAM];

describe('JSON examples in docs/', () => {
  const blocks = jsonBlocks();

  it('finds the protocol examples', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(9);
  });

  it.each(blocks.map((b) => [`${b.file}:${b.line}`, b] as const))('%s is valid JSON and a valid frame', (_name, block) => {
    const value: unknown = JSON.parse(block.text);
    const type = (value as { type?: unknown } | null)?.type;
    if (typeof type === 'string' && knownTypes.includes(type)) {
      const result = frameSchema.safeParse(value);
      expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
    }
  });

  it('documents every message type at least once', () => {
    const seen = new Set(blocks.map((b) => (JSON.parse(b.text) as { type?: string }).type));
    for (const type of knownTypes) expect(seen.has(type), `no example for "${type}"`).toBe(true);
  });
});
