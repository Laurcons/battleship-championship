import { z } from 'zod';
import { GAMEPLAY_ERROR_CODES, STANDALONE_ERROR_CODES } from './constants.js';

/** Largest ruleset id; mirrors the engine's `RULESET_ID_PATTERN`. */
const rulesetId = z.string().min(1).max(40);
const int = z.number().int().min(-1_000_000).max(1_000_000);
const rid = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

// --- Program -> platform -----------------------------------------------------------------------

export const programInfoSchema = z.object({
  name: z.string().min(1).max(64),
  version: z.string().max(32).optional(),
});

export const helloSchema = z.object({
  type: z.literal('hello'),
  token: z.string().min(1).max(200),
  lobby: z.string().min(1).max(32),
  accepts: z.array(rulesetId).min(1).max(20),
  program: programInfoSchema.optional(),
  session_id: z.string().min(1).max(100).optional(),
});

export const shipSchema = z.object({
  len: int,
  x: int,
  y: int,
  dir: z.enum(['h', 'v']),
});

export const placementSchema = z.object({
  type: z.literal('placement'),
  rid,
  ships: z.array(shipSchema).max(50),
});

export const fireSchema = z.object({
  type: z.literal('fire'),
  rid,
  x: int,
  y: int,
});

export const inboundSchema = z.discriminatedUnion('type', [helloSchema, placementSchema, fireSchema]);

export type Hello = z.infer<typeof helloSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Fire = z.infer<typeof fireSchema>;
export type InboundFrame = z.infer<typeof inboundSchema>;

// --- Platform -> program -----------------------------------------------------------------------

const GRID_ROW = /^[.oSx#]+$/;

/** A board as row strings; rectangular, 1..20 rows. Dimensions vs the ruleset are checked by callers. */
export const gridSchema = z
  .array(z.string().regex(GRID_ROW).max(20))
  .min(1)
  .max(20)
  .refine((rows) => rows.every((r) => r.length === rows[0]?.length), 'rows must have equal length');

export const wireRulesetSchema = z.object({
  id: rulesetId,
  width: z.number().int(),
  height: z.number().int(),
  fleet: z.array(z.number().int()),
  touching: z.boolean(),
  extra_turn_on_hit: z.boolean(),
  announce_sunk: z.boolean(),
  repeat_shot: z.enum(['invalid', 'waste']),
  reveal_on_game_over: z.boolean(),
});

export const limitsSchema = z.object({
  place_ms: z.number().int(),
  move_ms: z.number().int(),
  grace_ms: z.number().int(),
  max_strikes: z.number().int(),
});

export const welcomeSchema = z.object({
  type: z.literal('welcome'),
  session_id: z.string(),
  seat: z.union([z.literal(1), z.literal(2)]),
  resumed: z.boolean(),
  lobby: z.string(),
  ruleset: wireRulesetSchema,
  limits: limitsSchema,
});

export const gameplayErrorSchema = z.object({
  code: z.enum(GAMEPLAY_ERROR_CODES),
  message: z.string(),
});

export const gameInfoSchema = z.object({
  id: z.string(),
  index: z.number().int().min(1),
  total: z.number().int().min(1),
  first: z.enum(['you', 'opponent']),
});

export const wireShotSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  result: z.enum(['miss', 'hit', 'sunk', 'repeat']),
  len: z.number().int().optional(),
});

export const placeSchema = z.object({
  type: z.literal('place'),
  rid,
  deadline_ms: z.number().int(),
  game: gameInfoSchema,
  opponent: z.object({
    name: z.string(),
    program: z.object({ name: z.string(), version: z.string().optional() }).nullable(),
  }),
  error: gameplayErrorSchema.nullable(),
  strikes: z.number().int().min(0),
});

export const turnSchema = z.object({
  type: z.literal('turn'),
  rid,
  deadline_ms: z.number().int(),
  game: gameInfoSchema,
  you: gridSchema,
  enemy: gridSchema,
  enemy_remaining: z.array(z.number().int()).nullable(),
  last_shot: wireShotSchema.nullable(),
  incoming: z.array(wireShotSchema),
  error: gameplayErrorSchema.nullable(),
  strikes: z.number().int().min(0),
});

export const gameOverSchema = z.object({
  type: z.literal('game_over'),
  game: z.object({ id: z.string(), index: z.number().int().min(1), total: z.number().int().min(1) }),
  winner: z.enum(['you', 'opponent']),
  reason: z.enum(['sunk', 'timeout', 'strikes', 'disconnect']),
  last_shot: wireShotSchema.nullable(),
  incoming: z.array(wireShotSchema),
  series: z.object({
    score: z.object({ you: z.number().int().min(0), opponent: z.number().int().min(0) }),
    done: z.boolean(),
  }),
  reveal: z
    .object({ opponent_ships: z.array(shipSchema), opponent_shots: z.array(wireShotSchema) })
    .nullable(),
});

export const resetSchema = z.object({
  type: z.literal('reset'),
  reason: z.enum(['restart_game', 'reset_series', 'series_stopped']),
});

export const errorFrameSchema = z.object({
  type: z.literal('error'),
  code: z.enum(STANDALONE_ERROR_CODES),
  message: z.string(),
  fatal: z.boolean(),
});

export const outboundSchema = z.discriminatedUnion('type', [
  welcomeSchema,
  placeSchema,
  turnSchema,
  gameOverSchema,
  resetSchema,
  errorFrameSchema,
]);

export type WireRuleset = z.infer<typeof wireRulesetSchema>;
export type WireShot = z.infer<typeof wireShotSchema>;
export type Welcome = z.infer<typeof welcomeSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type GameOver = z.infer<typeof gameOverSchema>;
export type Reset = z.infer<typeof resetSchema>;
export type ErrorFrame = z.infer<typeof errorFrameSchema>;
export type OutboundFrame = z.infer<typeof outboundSchema>;

/** Any frame of the protocol, either direction. */
export const frameSchema = z.union([inboundSchema, outboundSchema]);
