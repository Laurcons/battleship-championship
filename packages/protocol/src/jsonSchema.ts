import { z } from 'zod';
import {
  errorFrameSchema,
  fireSchema,
  gameOverSchema,
  helloSchema,
  inboundSchema,
  outboundSchema,
  placementSchema,
  placeSchema,
  resetSchema,
  turnSchema,
  welcomeSchema,
} from './schemas.js';

/** Directory (below the web app's `public/`) the schemas of protocol v1 are published in. */
export const JSON_SCHEMA_DIR = 'schemas/v1';

const allFramesSchema = z.discriminatedUnion('type', [
  helloSchema,
  placementSchema,
  fireSchema,
  welcomeSchema,
  placeSchema,
  turnSchema,
  gameOverSchema,
  resetSchema,
  errorFrameSchema,
]);

const FILES = [
  {
    name: 'program-v1.json',
    title: 'Program protocol v1: every frame',
    description: 'Any frame of the program protocol, in either direction. The "type" field tells them apart.',
    schema: allFramesSchema,
  },
  {
    name: 'to-platform.json',
    title: 'Program protocol v1: frames sent by the program',
    description: 'hello, placement and fire.',
    schema: inboundSchema,
  },
  {
    name: 'to-program.json',
    title: 'Program protocol v1: frames sent by the platform',
    description: 'welcome, place, turn, game_over, reset and error.',
    schema: outboundSchema,
  },
] as const;

/**
 * The JSON Schemas of protocol v1, generated from the zod schemas (the source of truth): file name
 * to file content. Objects stay open (unknown fields are allowed): the platform ignores them in
 * inbound frames, and programs must ignore them in outbound frames.
 */
export function buildJsonSchemas(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of FILES) {
    // `input` mode leaves objects open; the schemas have no transforms, so input equals output.
    const { $schema, ...rest } = z.toJSONSchema(file.schema, { io: 'input' });
    const schema = { $schema, $id: file.name, title: file.title, description: file.description, ...rest };
    out[file.name] = `${JSON.stringify(schema, null, 2)}\n`;
  }
  return out;
}
