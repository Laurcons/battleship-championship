import { MAX_INBOUND_FRAME_BYTES, MESSAGE_TYPES_TO_PLATFORM } from './constants.js';
import { inboundSchema, type InboundFrame } from './schemas.js';

/** UTF-8 size of a string, without depending on Node's Buffer or the DOM's TextEncoder. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4; // surrogate pair: count both halves once
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export type ParseResult =
  | { ok: true; frame: InboundFrame }
  | {
      ok: false;
      code: 'bad_json' | 'unknown_type' | 'bad_shape' | 'frame_too_large';
      message: string;
      /** The `rid` if one could be read from the (invalid) frame, so a strike can be attributed. */
      rid?: number;
      type?: string;
    };

/**
 * Parses one inbound text frame. Never throws. `bad_shape` means valid JSON of a known `type` that
 * fails its schema; callers treat that as an invalid reply (a strike) when it answers a pending
 * request, and as an unexpected message otherwise.
 */
export function parseInbound(text: string): ParseResult {
  if (utf8Length(text) > MAX_INBOUND_FRAME_BYTES) {
    return { ok: false, code: 'frame_too_large', message: `Frames are limited to ${MAX_INBOUND_FRAME_BYTES} bytes.` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad_json', message: 'The frame is not valid JSON.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, code: 'bad_json', message: 'A frame must be a JSON object.' };
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !(MESSAGE_TYPES_TO_PLATFORM as readonly string[]).includes(type)) {
    return { ok: false, code: 'unknown_type', message: 'Unknown or missing "type".' };
  }
  const parsed = inboundSchema.safeParse(value);
  if (parsed.success) return { ok: true, frame: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at "${issue.path.join('.')}"` : '';
  const rid = typeof record.rid === 'number' && Number.isSafeInteger(record.rid) ? record.rid : undefined;
  return {
    ok: false,
    code: 'bad_shape',
    message: `Invalid "${type}" frame${where}: ${issue?.message ?? 'unexpected shape'}.`,
    type,
    ...(rid === undefined ? {} : { rid }),
  };
}
