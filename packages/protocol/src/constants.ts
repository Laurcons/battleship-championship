/** Path of the program WebSocket endpoint; the protocol version is part of it. */
export const PROGRAM_PATH = '/program/v1';

export const MAX_INBOUND_FRAME_BYTES = 16 * 1024;
export const HELLO_TIMEOUT_MS = 5_000;
export const PING_INTERVAL_MS = 15_000;
export const PONG_TIMEOUT_MS = 30_000;
/** More than this many ignored or invalid frames within the window is fatal. */
export const ABUSE_MAX_FRAMES = 20;
export const ABUSE_WINDOW_MS = 10_000;

/** Gameplay error codes carried in `place.error` / `turn.error`. */
export const GAMEPLAY_ERROR_CODES = [
  'out_of_bounds',
  'already_fired',
  'bad_fleet',
  'ship_out_of_bounds',
  'ships_overlap',
  'ships_touching',
  'bad_shape',
] as const;
export type GameplayErrorCode = (typeof GAMEPLAY_ERROR_CODES)[number];

/** Codes of standalone `error` frames. */
export const STANDALONE_ERROR_CODES = [
  'bad_json',
  'bad_shape',
  'unknown_type',
  'unexpected_message',
  'frame_too_large',
  'rate_limited',
  // Only sent just before the connection is closed during the handshake; the close code says the same.
  'bad_hello',
  'auth_failed',
  'ruleset_mismatch',
  'lobby_full',
  'lobby_expired',
  'hello_timeout',
  'tls_required',
] as const;
export type StandaloneErrorCode = (typeof STANDALONE_ERROR_CODES)[number];

/** WebSocket close codes (see docs/protocol-v1.md, section 8). */
export const CLOSE = {
  CLOSED_BY_PLATFORM: 4000,
  BAD_REQUEST: 4400,
  AUTH_FAILED: 4401,
  TLS_REQUIRED: 4403,
  HELLO_TIMEOUT: 4408,
  LOBBY_FULL: 4409,
  LOBBY_EXPIRED: 4410,
  RULESET_MISMATCH: 4426,
  RATE_LIMITED: 4429,
  INTERNAL: 4500,
} as const;

export const MESSAGE_TYPES_TO_PLATFORM = ['hello', 'placement', 'fire'] as const;
export const MESSAGE_TYPES_TO_PROGRAM = ['welcome', 'place', 'turn', 'game_over', 'reset', 'error'] as const;
