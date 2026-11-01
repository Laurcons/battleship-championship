import { z } from 'zod';
import { GAMEPLAY_ERROR_CODES, STANDALONE_ERROR_CODES } from './constants.js';

// The `id` of a schema becomes its name in the generated JSON Schemas (docs/protocol-v1.md, section
// "JSON Schemas"), the `description` the text next to the field. Keep descriptions to one sentence:
// the details live in the protocol document.

/** Largest ruleset id; mirrors the engine's `RULESET_ID_PATTERN`. */
const rulesetId = z.string().min(1).max(40);
const int = z.number().int().min(-1_000_000).max(1_000_000);
const rid = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .meta({ description: 'Identifies one request. A reply must carry the rid of the request it answers.' });

// --- Program -> platform -----------------------------------------------------------------------

export const programInfoSchema = z
  .object({
    name: z.string().min(1).max(64).meta({ description: 'Name of the program, shown in the web interface.' }),
    version: z.string().max(32).optional().meta({ description: 'Version of the program, shown in the web interface.' }),
  })
  .meta({ id: 'ProgramInfo', description: 'Self-reported metadata of a program.' });

export const helloSchema = z
  .object({
    type: z.literal('hello'),
    token: z.string().min(1).max(200).meta({ description: 'The account token (bsc_...).' }),
    lobby: z.string().min(1).max(32).meta({ description: 'The lobby id, for example K7QM-4XD2-7. Case, dashes and spaces are not significant.' }),
    accepts: z
      .array(rulesetId)
      .min(1)
      .max(20)
      .meta({ description: 'Ids of the rulesets this program can play. The lobby refuses the connection if its ruleset is not listed.' }),
    program: programInfoSchema.optional(),
    session_id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .meta({ description: 'The session_id of the latest welcome, to reclaim exactly the same seat. Optional.' }),
  })
  .meta({
    id: 'Hello',
    description: 'First frame of every connection: authenticates, joins the lobby, checks the ruleset and says the program is ready.',
  });

export const shipSchema = z
  .object({
    len: int.meta({ description: 'Length in cells.' }),
    x: int.meta({ description: 'Column of the first cell (0-based).' }),
    y: int.meta({ description: 'Row of the first cell (0-based).' }),
    dir: z.enum(['h', 'v']).meta({ description: '"h" extends towards +x, "v" towards +y.' }),
  })
  .meta({ id: 'Ship', description: 'A ship placement.' });

export const placementSchema = z
  .object({
    type: z.literal('placement'),
    rid,
    ships: z.array(shipSchema).max(50).meta({ description: 'The whole fleet, in any order.' }),
  })
  .meta({ id: 'Placement', description: 'Answer to a place request: the complete fleet in one message.' });

export const fireSchema = z
  .object({
    type: z.literal('fire'),
    rid,
    x: int.meta({ description: 'Column to shoot at (0-based).' }),
    y: int.meta({ description: 'Row to shoot at (0-based).' }),
  })
  .meta({ id: 'Fire', description: 'Answer to a turn request: the cell to shoot at.' });

export const inboundSchema = z.discriminatedUnion('type', [helloSchema, placementSchema, fireSchema]);

export type Hello = z.infer<typeof helloSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Fire = z.infer<typeof fireSchema>;
export type InboundFrame = z.infer<typeof inboundSchema>;

// --- Platform -> program -----------------------------------------------------------------------

/** A board as row strings; rectangular, 1..20 rows. Dimensions vs the ruleset are checked by callers. */
const grid = (chars: string) =>
  z
    .array(z.string().regex(new RegExp(`^[${chars}]+$`)).max(20))
    .min(1)
    .max(20)
    .refine((rows) => rows.every((r) => r.length === rows[0]?.length), 'rows must have equal length');

/** The program's own board: `.` water, `o` enemy miss, `S` intact ship, `x` hit ship cell. */
export const ownGridSchema = grid('.oSx').meta({
  id: 'OwnGrid',
  description: 'Your own board, one string per row (height rows of width characters): . water, o enemy shot missed, S intact ship, x hit ship cell.',
});

/** What the program knows of the opponent's board: `.` unknown, `o` miss, `x` hit, `#` sunk ship cell. */
export const enemyGridSchema = grid('.ox#').meta({
  id: 'EnemyGrid',
  description: 'What you know of the opponent board, one string per row (height rows of width characters): . not shot, o your shot missed, x hit, # cell of a sunk ship (only when sunk ships are announced).',
});

export const wireRulesetSchema = z
  .object({
    id: rulesetId,
    width: z.number().int().meta({ description: 'Columns.' }),
    height: z.number().int().meta({ description: 'Rows.' }),
    fleet: z.array(z.number().int()).meta({ description: 'Length of every ship each program places.' }),
    touching: z.boolean().meta({ description: 'Whether ships may touch, diagonals included.' }),
    extra_turn_on_hit: z.boolean().meta({ description: 'Whether a hit gives the shooter another turn.' }),
    announce_sunk: z.boolean().meta({ description: 'Whether sinking a ship is reported ("sunk" with its length, enemy_remaining, # cells).' }),
    repeat_shot: z.enum(['invalid', 'waste']).meta({ description: '"invalid": a strike. "waste": the shot is ignored and the turn passes.' }),
    reveal_on_game_over: z.boolean().meta({ description: 'Whether game_over reveals the opponent layout and shots.' }),
  })
  .meta({ id: 'Ruleset', description: 'The rules of the lobby.' });

export const limitsSchema = z
  .object({
    place_ms: z.number().int().meta({ description: 'Time to answer a place request.' }),
    move_ms: z.number().int().meta({ description: 'Time to answer a turn request.' }),
    grace_ms: z.number().int().meta({ description: 'How long a disconnected seat may come back during a game or battery.' }),
    max_strikes: z.number().int().meta({ description: 'Strikes after which a game is lost.' }),
  })
  .meta({ id: 'Limits', description: 'Platform limits, the same for every ruleset.' });

export const welcomeSchema = z
  .object({
    type: z.literal('welcome'),
    session_id: z.string().meta({ description: 'Identifies this connection\'s session. Send it as hello.session_id to reclaim the seat. A new one is issued on every welcome.' }),
    seat: z.union([z.literal(1), z.literal(2)]).meta({ description: 'The seat this program plays.' }),
    resumed: z.boolean().meta({ description: 'True when the seat was reclaimed inside its resume window.' }),
    lobby: z.string().meta({ description: 'The lobby id in canonical form.' }),
    ruleset: wireRulesetSchema,
    limits: limitsSchema,
  })
  .meta({ id: 'Welcome', description: 'Answer to an accepted hello.' });

export const gameplayErrorSchema = z
  .object({
    code: z.enum(GAMEPLAY_ERROR_CODES),
    message: z.string().meta({ description: 'Human readable explanation.' }),
  })
  .meta({ id: 'GameplayError', description: 'Why the previous reply was invalid.' });

export const gameInfoSchema = z
  .object({
    id: z.string().meta({ description: 'Unique id of this game.' }),
    index: z.number().int().min(1).meta({ description: '1-based number of the game in the battery. 1 starts a new battery.' }),
    total: z.number().int().min(1).meta({ description: 'Number of games in the battery.' }),
    first: z.enum(['you', 'opponent']).meta({ description: 'Who shoots first.' }),
  })
  .meta({ id: 'GameInfo', description: 'Which game of the battery this is.' });

export const wireShotSchema = z
  .object({
    x: z.number().int().meta({ description: 'Column (0-based).' }),
    y: z.number().int().meta({ description: 'Row (0-based).' }),
    result: z.enum(['miss', 'hit', 'sunk', 'repeat']).meta({ description: '"sunk" only when the ruleset announces sunk ships, otherwise "hit". "repeat" only with repeat_shot "waste".' }),
    len: z.number().int().optional().meta({ description: 'Length of the sunk ship. Only with "sunk".' }),
  })
  .meta({ id: 'Shot', description: 'A shot and its result.' });

export const placeSchema = z
  .object({
    type: z.literal('place'),
    rid,
    deadline_ms: z.number().int().meta({ description: 'Milliseconds, counted from the moment the platform sends this frame, to answer.' }),
    game: gameInfoSchema,
    opponent: z.object({
      name: z.string().meta({ description: 'Display name of the opponent.' }),
      program: z
        .object({ name: z.string(), version: z.string().optional() })
        .nullable()
        .meta({ description: 'What the opponent program said in its hello, or null.' }),
    }),
    error: gameplayErrorSchema.nullable().meta({ description: 'Set when the previous placement was invalid and this request repeats it.' }),
    strikes: z.number().int().min(0).meta({ description: 'Your strikes in this game so far.' }),
  })
  .meta({ id: 'Place', description: 'Request: place the fleet. Also the start of a game.' });

export const turnSchema = z
  .object({
    type: z.literal('turn'),
    rid,
    deadline_ms: z.number().int().meta({ description: 'Milliseconds, counted from the moment the platform sends this frame, to answer.' }),
    game: gameInfoSchema,
    you: ownGridSchema,
    enemy: enemyGridSchema,
    enemy_remaining: z
      .array(z.number().int())
      .nullable()
      .meta({ description: 'Lengths of the opponent\'s unsunk ships, longest first. Null when sunk ships are not announced.' }),
    last_shot: wireShotSchema.nullable().meta({ description: 'Result of your previous shot. Null on your first turn of the game.' }),
    incoming: z.array(wireShotSchema).meta({ description: 'The opponent\'s shots since your last shot, in order.' }),
    error: gameplayErrorSchema.nullable().meta({ description: 'Set when the previous shot was invalid and this request repeats it.' }),
    strikes: z.number().int().min(0).meta({ description: 'Your strikes in this game so far.' }),
  })
  .meta({ id: 'Turn', description: 'Request: choose a cell to shoot at. Carries the complete state of the game.' });

export const gameOverSchema = z
  .object({
    type: z.literal('game_over'),
    game: z.object({
      id: z.string(),
      index: z.number().int().min(1),
      total: z.number().int().min(1),
    }),
    winner: z.enum(['you', 'opponent']),
    reason: z.enum(['sunk', 'timeout', 'strikes', 'disconnect']).meta({ description: 'Why the game ended. "timeout", "strikes" and "disconnect" are forfeits by the loser.' }),
    last_shot: wireShotSchema.nullable().meta({ description: 'Result of your last shot, if you have not been told yet.' }),
    incoming: z.array(wireShotSchema).meta({ description: 'The opponent\'s shots you have not been told yet, in order.' }),
    series: z.object({
      score: z.object({ you: z.number().int().min(0), opponent: z.number().int().min(0) }).meta({ description: 'Games won in the battery so far, this one included.' }),
      done: z.boolean().meta({ description: 'True after the last game of the battery.' }),
    }),
    reveal: z
      .object({
        opponent_ships: z.array(shipSchema).meta({ description: 'Empty if the opponent never placed.' }),
        opponent_shots: z.array(wireShotSchema).meta({ description: 'All of the opponent\'s shots, in order.' }),
      })
      .nullable()
      .meta({ description: 'The opponent\'s final layout and shots. Null when the ruleset has reveal_on_game_over false.' }),
  })
  .meta({ id: 'GameOver', description: 'A game ended with a result.' });

export const resetSchema = z
  .object({
    type: z.literal('reset'),
    reason: z.enum(['restart_game', 'reset_series', 'series_stopped']).meta({
      description: '"restart_game": the game is voided and replayed. "reset_series": the battery is discarded, forget cross-game memory. "series_stopped": the battery ended early without a result.',
    }),
  })
  .meta({ id: 'Reset', description: 'Forget the current game and wait for the next place. Needs no reply and can arrive at any time.' });

export const errorFrameSchema = z
  .object({
    type: z.literal('error'),
    code: z.enum(STANDALONE_ERROR_CODES),
    message: z.string().meta({ description: 'Human readable explanation.' }),
    fatal: z.boolean().meta({ description: 'If true, the platform closes the connection right after.' }),
  })
  .meta({ id: 'ErrorMessage', description: 'A problem that is not an invalid reply to a pending request.' });

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
