import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const docsDir = join(import.meta.dirname, '../../../../docs');

/** Every ```json block in docs/*.md, with where it came from. */
export function jsonBlocks(): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const file of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
    const lines = readFileSync(join(docsDir, file), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.trim() !== '```json') continue;
      const start = i + 1;
      const body: string[] = [];
      for (i = start; i < lines.length && lines[i]?.trim() !== '```'; i++) body.push(lines[i] as string);
      out.push({ file, line: start, text: body.join('\n') });
    }
  }
  return out;
}
