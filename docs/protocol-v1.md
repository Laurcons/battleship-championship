# Program Protocol v1

This is the protocol the platform implements. The shape of every frame is also available as JSON Schema (section 9).

**Terms.** A *lobby* has two *seats*, and one program plays on each. A *game* is one round of Battleship. A *battery* is the series of games started by one press of *Start* in the web interface. A *request* is a `place` or `turn` message: the platform asks, the program replies. A *strike* is a counted mistake in a reply (section 6).

## 1. Transport

- Endpoint: `wss://<host>/program/v1`. The protocol version is in the path, so the server can route before parsing any frame.
- One JSON object per **text** frame, UTF-8. Binary frames are rejected. No `permessage-deflate`.
- Frames from the program to the platform are at most 16 KiB.
- **Heartbeat uses WebSocket-level ping/pong**, not JSON messages. The platform pings every 15 s, and any standard WebSocket library answers automatically. A connection that has not answered for about 30 s is considered dead and is dropped. Make sure your program keeps answering pings while it thinks: a program that blocks its WebSocket thread for longer than that is disconnected. The program does not need to ping.
- Every message has a `"type"` field.

## 2. Conventions

### Coordinates, ships and shots

- Coordinates are 0-indexed. `x` is the column and `y` is the row.
- A ship placement is `{"len": 4, "x": 2, "y": 5, "dir": "h"}`. `(x, y)` is the first cell, `"h"` extends towards +x, and `"v"` extends towards +y.
- Shot results: `"miss"`, `"hit"`, `"sunk"`, `"repeat"`.
  - `"sunk"` implies a hit, and carries `"len"` (the sunk ship's length). It only occurs when the ruleset announces sunk ships (`announce_sunk`). Otherwise the result of that shot is `"hit"`.
  - `"repeat"` only occurs when the ruleset's `repeat_shot` is `"waste"`: the shot was at an already-shot cell, changes nothing, and ends the turn. It is a bug in the program, and the web UI highlights it.
- The starting player alternates: seat 1 starts the odd-numbered games of a battery, seat 2 the even-numbered ones. `game.first` says which one you are.

### Boards

Boards are arrays of row strings. Row `y` is `board[y]`, and column `x` is character `x`. A board has `height` rows of `width` characters (`welcome.ruleset`).

| Char | `you` grid (your own board) | `enemy` grid (what you know) |
|---|---|---|
| `.` | water, not shot | not yet shot |
| `o` | enemy shot missed here | your shot missed |
| `S` | your intact ship | never appears |
| `x` | your ship, hit | hit (and, when sunk ships are not announced, also the cells of sunk ships) |
| `#` | never appears | cell of a ship you sank (only when sunk ships are announced) |

### Messages

- **Requests and replies.** The platform sends `place` and `turn` as requests. Each carries a `rid`, and the reply (`placement`, `fire`) must echo it. Every request has a new `rid`, which never repeats on the same connection. Treat it as an opaque integer.
- **One request at a time.** A seat has at most one request pending. Between a reply and the next request, nothing is expected from the program. The program only sends `hello` once, first, and replies to requests. Anything else is an error (section 6).
- **Unknown fields are ignored**, in both directions. The platform ignores extra fields in your frames, and your program must ignore fields it does not know in the platform's frames. Fields may be added within v1 (section 10).
- **Unknown codes are not an error.** A program should treat an `error.code`, a `reset.reason` or a close code it does not know like a generic one of the same kind. The `message` strings are for humans: do not parse them.
- **Numbers** in frames from the program are JSON integers. Coordinates, ship lengths and `x`/`y` must be between -1,000,000 and 1,000,000, `rid` a non-negative integer. A value outside these limits or of the wrong type makes the frame invalid (`bad_shape`), including a coordinate far off the board. A coordinate that is within these limits but off the board is `out_of_bounds`.
- Field order and whitespace do not matter.

## 3. Data types

These objects appear in several messages.

**Ship** (in `placement.ships`, and `game_over.reveal.opponent_ships`)

| Field | Type | Meaning |
|---|---|---|
| `len` | integer | length in cells |
| `x`, `y` | integer | the first cell |
| `dir` | `"h"` or `"v"` | `"h"` extends towards +x, `"v"` towards +y |

**Shot** (in `last_shot`, `incoming`, `reveal.opponent_shots`)

| Field | Type | Meaning |
|---|---|---|
| `x`, `y` | integer | the cell |
| `result` | `"miss"`, `"hit"`, `"sunk"` or `"repeat"` | see section 2 |
| `len` | integer, only with `"sunk"` | length of the sunk ship |

**Game** (in `place` and `turn`; `game_over` has the same without `first`)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | unique id of this game |
| `index` | integer, from 1 | the game's number in the battery. `1` marks the start of a new battery |
| `total` | integer | number of games in the battery |
| `first` | `"you"` or `"opponent"` | who shoots first |

**GameplayError** (in `place.error` and `turn.error`)

| Field | Type | Meaning |
|---|---|---|
| `code` | string | one of the gameplay error codes (section 8) |
| `message` | string | human readable explanation |

**ProgramInfo** (in `hello.program`): `name` (1 to 64 characters) and optionally `version` (up to 32 characters). Both are shown in the web interface.

**Ruleset** (in `welcome.ruleset`; see the *Rulesets* page for what each setting means)

| Field | Type |
|---|---|
| `id` | string |
| `width`, `height` | integer |
| `fleet` | array of integers: the length of each ship |
| `touching`, `extra_turn_on_hit`, `announce_sunk`, `reveal_on_game_over` | boolean |
| `repeat_shot` | `"invalid"` or `"waste"` |

**Limits** (in `welcome.limits`, the same for every ruleset)

| Field | Meaning |
|---|---|
| `place_ms` | time to answer a `place` |
| `move_ms` | time to answer a `turn` |
| `grace_ms` | how long a disconnected seat may come back (section 7) |
| `max_strikes` | strikes after which a game is lost |

## 4. Messages

Program to platform: `hello`, `placement`, `fire` (3 types).
Platform to program: `welcome`, `place`, `turn`, `game_over`, `reset`, `error` (6 types).

### `hello` (program to platform)

Must be the first frame, within 5 s of connecting.

```json
{
  "type": "hello",
  "token": "bsc_xxxxxxxxxxxxxxxxxxxxxxxx",
  "lobby": "K7QM-4XD2-7",
  "accepts": ["classic-10x10"],
  "program": { "name": "my-bot", "version": "0.3.1" },
  "session_id": "s_xxxxxxxxxxxxxxxx"
}
```

| Field | Required | Meaning |
|---|---|---|
| `token` | yes | your account token (at most 200 characters) |
| `lobby` | yes | the lobby id. Case, dashes and spaces are not significant, so `k7qm4xd27` works too |
| `accepts` | yes | 1 to 20 ruleset ids (each at most 40 characters) your program can play. The lobby's ruleset must be among them |
| `program` | no | `ProgramInfo` |
| `session_id` | no | the `session_id` of your latest `welcome`, to reclaim exactly the same seat (section 7) |

`hello` does everything at once: it authenticates, joins the lobby, checks the ruleset, and **is the program's "ready" confirmation**. There is no separate `ready` message. A program that needs setup time simply delays `hello` until it is ready.

The platform checks a `hello` in this order, and the first problem is reported (section 8): the frame itself (`bad_hello`), then the token and lobby (`auth_failed`), whether the lobby has expired (`lobby_expired`), the ruleset (`ruleset_mismatch`) and finally whether there is a seat for you (`lobby_full`). All of these are fatal.

### `welcome` (platform to program)

Answer to an accepted `hello`, and always the first frame the platform sends.

```json
{
  "type": "welcome",
  "session_id": "s_9b1c0d2e3f4a5b6c",
  "seat": 1,
  "resumed": false,
  "lobby": "K7QM-4XD2-7",
  "ruleset": {
    "id": "classic-10x10", "width": 10, "height": 10,
    "fleet": [5, 4, 3, 3, 2],
    "touching": false, "extra_turn_on_hit": true,
    "announce_sunk": true, "repeat_shot": "invalid",
    "reveal_on_game_over": true
  },
  "limits": { "place_ms": 10000, "move_ms": 10000, "grace_ms": 60000, "max_strikes": 3 }
}
```

| Field | Meaning |
|---|---|
| `session_id` | opaque string. **A new one is issued with every `welcome`**, also after a resume, so always keep the latest |
| `seat` | `1` or `2`: the seat this program plays |
| `resumed` | `true` when the seat was reclaimed inside its resume window (section 7). `false` does **not** guarantee a fresh start: see section 7 |
| `lobby` | the lobby id in canonical form |
| `ruleset` | `Ruleset` |
| `limits` | `Limits` |

After `welcome` the program waits. A game or battery starts **only when a participant presses "Start" in the web interface**, which is possible once both seats are connected. The program may be connected for a long time, and nothing is sent in the meantime except `reset` (which can arrive at any time) and, if the program breaks a rule, `error`. The next request it receives is `place`.

### `place` (platform to program)

A request: place the whole fleet.

```json
{
  "type": "place", "rid": 1, "deadline_ms": 10000,
  "game": { "id": "g_8f3a", "index": 1, "total": 100, "first": "you" },
  "opponent": { "name": "Alex", "program": { "name": "x", "version": "1" } },
  "error": null,
  "strikes": 0
}
```

| Field | Meaning |
|---|---|
| `rid` | echo it in the `placement` |
| `deadline_ms` | milliseconds the program has to reply, counted from the moment the platform sent the frame. It equals `limits.place_ms` |
| `game` | `Game`. `place` is also the **game start**: there is no separate `game_start` message |
| `opponent.name` | display name of the opponent |
| `opponent.program` | what the opponent's `hello` said (`name`, `version`), or `null` if it sent no `program`. `version` is `""` if the opponent sent a program name without a version |
| `error` | `null`, or a `GameplayError` when this request repeats one that was answered badly (section 6) |
| `strikes` | your strikes in this game so far (section 6) |

`game.index == 1` marks the start of a new battery. A program keeps cross-game memory only within one battery. Both seats place at the same time.

A re-issued request (after an invalid reply) looks like this:

```json
{
  "type": "place", "rid": 2, "deadline_ms": 10000,
  "game": { "id": "g_8f3a", "index": 1, "total": 100, "first": "you" },
  "opponent": { "name": "Alex", "program": null },
  "error": { "code": "ships_overlap", "message": "Ships overlap at (2,1)." },
  "strikes": 1
}
```

### `placement` (program to platform)

The reply to `place`.

```json
{
  "type": "placement", "rid": 1,
  "ships": [
    { "len": 5, "x": 0, "y": 0, "dir": "h" },
    { "len": 4, "x": 0, "y": 2, "dir": "h" }
  ]
}
```

| Field | Meaning |
|---|---|
| `rid` | the `rid` of the `place` |
| `ships` | the whole fleet, **in one message**, in any order. At most 50 entries (more is invalid anyway) |

The lengths must match `ruleset.fleet` exactly (as a multiset), every ship must be inside the board, ships must not overlap, and they must respect the `touching` rule (when ships may not touch, that includes diagonals). The first problem found is reported, in this order: `bad_fleet`, then `ship_out_of_bounds` or `ships_overlap` (ship by ship), then `ships_touching`.

### `turn` (platform to program)

A request: choose a cell to shoot at. It carries the complete state of the game.

```json
{
  "type": "turn", "rid": 7, "deadline_ms": 10000,
  "game": { "id": "g_8f3a", "index": 1, "total": 100, "first": "you" },
  "you": [
    "SSSSS.....",
    ".o........",
    "SSSS.o....",
    "..........",
    "SSS..SSS..",
    "..........",
    "........xx",
    "..........",
    "..........",
    ".........."
  ],
  "enemy": [
    "..........",
    "...o......",
    "..........",
    "...x......",
    "...x......",
    "..........",
    "......o...",
    "..........",
    "..........",
    ".........."
  ],
  "enemy_remaining": [5, 4, 3, 2],
  "last_shot": { "x": 3, "y": 4, "result": "hit" },
  "incoming": [ { "x": 1, "y": 1, "result": "miss" } ],
  "error": null,
  "strikes": 0
}
```

| Field | Meaning |
|---|---|
| `rid` | echo it in the `fire` |
| `deadline_ms` | milliseconds the program has to reply, counted from the moment the platform sent the frame. It equals `limits.move_ms` |
| `game` | `Game` |
| `you`, `enemy` | full boards (section 2), constant size throughout the game (about 300 bytes together on a 10x10 board). A program does not need any memory of earlier messages: a restarted program can continue from this message alone |
| `enemy_remaining` | lengths of the opponent's unsunk ships, longest first. `null` when sunk ships are not announced |
| `last_shot` | the result of your previous shot. `null` on your first turn of the game |
| `incoming` | the opponent's shots since your last shot, in order. Empty after a hit with `extra_turn_on_hit` (you simply moved again). This is the only place the order of the opponent's shots is visible during a game, and the basis for opponent modeling |
| `error`, `strikes` | as in `place` |

On the first turn of the game, `last_shot` is `null`, and `incoming` holds the opponent's shots if the opponent moved first.

### `fire` (program to platform)

The reply to `turn`.

```json
{ "type": "fire", "rid": 7, "x": 3, "y": 4 }
```

| Field | Meaning |
|---|---|
| `rid` | the `rid` of the `turn` |
| `x`, `y` | the cell to shoot at |

The platform answers a `fire` with the next `turn` (or `game_over`). There is **no separate result message**. The result arrives in `last_shot`.

### `game_over` (platform to program)

A game ended with a result.

```json
{
  "type": "game_over",
  "game": { "id": "g_8f3a", "index": 1, "total": 100 },
  "winner": "you",
  "reason": "sunk",
  "last_shot": { "x": 6, "y": 6, "result": "sunk", "len": 2 },
  "incoming": [],
  "series": { "score": { "you": 1, "opponent": 0 }, "done": false },
  "reveal": {
    "opponent_ships": [ { "len": 5, "x": 0, "y": 0, "dir": "h" } ],
    "opponent_shots": [ { "x": 1, "y": 1, "result": "miss" } ]
  }
}
```

| Field | Meaning |
|---|---|
| `game` | `id`, `index` and `total` of the game that ended |
| `winner` | `"you"` or `"opponent"`. A forfeit by the opponent is `winner: "you"` |
| `reason` | `"sunk"` (all ships sunk), or a forfeit by the loser: `"timeout"`, `"strikes"`, `"disconnect"` |
| `last_shot`, `incoming` | as in `turn`: your most recent shot (`null` if you never shot) and the opponent's shots since. A program that was not asked to move after its last shot learns the last results here |
| `series.score` | games won in the battery so far, this one included |
| `series.done` | `true` after the last game of the battery |
| `reveal` | the opponent's final layout (`opponent_ships`) and all its shots in order (`opponent_shots`). This is the data for cross-game opponent modeling, and it is safe because the game is over. It is `null` when the ruleset has `reveal_on_game_over: false`. If the game ended before the opponent had placed, both lists are empty |

There is no separate `series_over`. Inside a battery the next `place` follows without acknowledgement, as soon as both programs are connected (a game does not start while a program is away). After the last game the connection stays open and the lobby may start another battery later (it begins with a `place` with `game.index == 1`).

A game that is voided (a restart, a stopped battery) does not get a `game_over`: it gets a `reset`.

### `reset` (platform to program)

```json
{ "type": "reset", "reason": "restart_game" }
```

| `reason` | Meaning |
|---|---|
| `"restart_game"` | the game is voided; the same game index will be played again, with a new `game.id`, starting with a new `place` |
| `"reset_series"` | all battery results are discarded; the program should discard cross-game memory too |
| `"series_stopped"` | the battery ended early, without a result for the game in progress, and no new `place` follows until a participant starts another battery. Games already finished keep their results. This happens when the lobby was created with *stop on infraction* and a program made its first infraction, and when the opponent's program did not come back within its resume window (section 7) |

The program drops its current game state and waits for the next `place`. All pending `rid`s are void. `reset` needs no reply, and can arrive at any time, including when no game is running.

### `error` (platform to program, standalone)

```json
{ "type": "error", "code": "bad_json", "message": "human readable", "fatal": false }
```

| Field | Meaning |
|---|---|
| `code` | see section 8 |
| `message` | human readable explanation |
| `fatal` | if `true`, the platform closes the connection right after |

Standalone errors cover problems that are not an invalid reply to a pending request, such as malformed JSON or an unknown `type`. Invalid replies to a request are reported differently: the request is re-issued with `error` set (section 6).

## 5. Requests, replies and the flow of a game

```
program                         platform
  | ---- hello ------------------> |   (auth + join + ruleset check + ready)
  | <--- welcome ----------------- |
  |         ... waits until a participant presses Start in the web UI ...
  | <--- place (rid 1) ----------- |   (game start + context)
  | ---- placement (rid 1) ------> |
  | <--- turn (rid 2) ------------ |   (if this program moves first)
  | ---- fire (rid 2) -----------> |
  | <--- turn (rid 3, last_shot) - |   (after a hit with extra turn: immediately)
  | ---- fire (rid 3) -----------> |
  | <--- turn (rid 4, last_shot, incoming) |   (after a miss: opponent plays, then this)
  |         ...                    |
  | <--- game_over --------------- |
  | <--- place (next game) ------- |   (battery: immediately, no handshake)
```

Minimum traffic is **two frames per move** (`fire`, then `turn`) and **one round trip per move**. Opponent moves and shot results are never sent as their own messages.

- **A program waits for requests.** When it is the opponent's turn, or the opponent is still placing, nothing is sent. A program must not apply a time limit of its own to this waiting. A game is also paused while either program is away: no new request is sent until both are connected again, so a `place` or `turn` can take up to `grace_ms` longer to arrive.
- **The clock.** The time to answer is `deadline_ms` from the moment the platform sends the request, so network latency counts. A re-issued request gets a fresh clock.
- **Strikes.** `strikes` counts the invalid replies of your seat in the current game. It starts at 0 in every game. When it reaches `limits.max_strikes`, the game is lost (`reason: "strikes"`), so with `max_strikes: 3` a program gets two retries.
- **Re-issue.** After an invalid reply, the platform sends the same kind of request again, with a new `rid`, `error` filled in and `strikes` updated. Everything else (the boards, `last_shot`, `incoming`) is unchanged. The `error` describes the invalid reply. A request re-issued after a reconnect (section 7) is the same request as before, including its `error` and `strikes`, with a new `rid` and a fresh clock.

## 6. Misbehavior

What the platform does with a frame from the program, depending on what is pending:

| Situation | Platform behavior |
|---|---|
| Invalid placement or invalid `fire` (out of bounds, already shot with `repeat_shot: "invalid"`, wrong fleet, ...) | One **strike**. The request is re-issued (section 5). After `max_strikes` the game is lost (`reason: "strikes"`). |
| A reply for the pending `rid` that fails the schema (`bad_shape`), or is the wrong type (for example a `fire` answering a `place`) | Same as an invalid move: one strike, with `error.code` `bad_shape`. |
| A `placement` or `fire` that fails the schema and has no readable `rid` | Not attributable to a request, so no strike. Standalone non-fatal `error` with code `bad_shape`. The request stays pending and may time out. |
| Repeated shot with `repeat_shot: "waste"` | Not a strike. The result is `"repeat"`, the turn passes, and the move is highlighted in the move history. |
| No reply before `deadline_ms` | The game is lost immediately (`reason: "timeout"`). Not a strike. |
| A reply with another `rid` than the pending request (for example answering a request cancelled by a reset) | Ignored: no strike, no message. It still shows in the frame log of the lobby's *Connection* tab. If no request is pending at all, the reply is answered with a non-fatal `unexpected_message` error instead. |
| A valid frame when no request is pending, or a second `hello` | Non-fatal `error` with code `unexpected_message`. |
| Malformed JSON, or an unknown `type` | Non-fatal `error` with code `bad_json` or `unknown_type`. |
| Any infraction (above, or a timeout) in a lobby created with **stop on infraction** | The game is voided (kept in the history), the battery ends as aborted with the results so far, and both programs receive `reset` with `reason: "series_stopped"`. |
| More than 20 ignored or invalid frames in 10 s | Fatal `error` with code `rate_limited`, then the connection is closed (4429). Every frame answered with an error and every ignored frame counts. Valid replies, and replies that cost a strike, do not. |
| A binary frame, or a frame over 16 KiB | Fatal `error` (`bad_json`, `frame_too_large`), then the connection is closed (4400). A frame over 64 KiB is cut off by the WebSocket layer (close code 1009, without an `error` frame). |
| Disconnect during a game | The grace timer (`grace_ms`) starts. See section 7. |

Before `welcome`, every problem with a frame is fatal (section 4, `hello`).

## 7. Reset, reconnect and resume

- The platform can send `reset` at any time. After `reset`, all pending `rid`s are void. A reply that was already on its way is ignored (section 6).
- **`session_id` is optional.** Every `welcome` issues a new one, which replaces the previous. If the connection drops while the process is still alive, the program can reconnect with the latest `hello.session_id` to reclaim **exactly the same seat**. This matters only for self-play lobbies. A restarted program has lost its `session_id` and simply sends `hello` without it, taking the first empty seat. An unknown or expired `session_id` is treated as absent, not as an error.
- **Which seat you get.** A seat belongs to the participant who owns it (for a lobby between two participants, each owns one; in a self-play lobby you own both). A connecting program takes the first seat of its participant without a program. If the participant owns only one seat and a program still seems to be connected on it (for example the old process died and the platform has not noticed yet), the new connection **replaces** the old one, which is closed with code 4000. In a self-play lobby with both seats taken, a further connection is refused with 4409.
- When the platform accepts a reconnect:
  1. It replies with `welcome`. `"resumed": true` if the seat was in its resume window (`grace_ms`).
  2. If a request was pending for that seat, it immediately re-issues it (`place` or `turn`) as it was last sent (same `error` and `strikes`), with a **new `rid`** and a fresh clock. Because `turn` already carries the full state, no extra "resume" payload is needed. Resuming and normal play use the same code path.
  3. If it is the opponent's turn, nothing else is sent; the next `turn` arrives when it is this seat's turn.
- **`resumed: false` does not mean a fresh start.** When a new connection replaces an old one the platform had not yet noticed was dead, `resumed` is `false`, and the pending request is still re-issued. A program must not assume the first request after `welcome` is a `place` with `game.index == 1`. A program that restarted in the middle of a battery has lost its cross-game memory, and nothing in the protocol tells it so except `game.index > 1`. It should continue as best it can.
- While the seat is disconnected the grace timer runs instead of the move timer, and the move timer starts fresh after the resume. The game is paused for both programs, and the opponent is told nothing.
- If the grace period expires:
  - a single game is forfeited by the absent seat (`reason: "disconnect"`, and the other program receives `game_over`);
  - a battery ends as `aborted` with partial results kept. The interrupted game is voided, and the program that stayed receives `reset` with `reason: "series_stopped"`.
- If the server restarts, an in-progress game is voided and no `session_id` survives. Connections are dropped without notice. Programs reconnect and start with `hello` as normal (retry every few seconds). A running battery waits for them and carries on with a fresh `place`.
- If the lobby is deleted, expires while connected, or the token is replaced, the platform closes the connection with code 4000 and a reason text.

## 8. Error codes and close codes

### Gameplay errors

Carried in `place.error` and `turn.error`. They are never fatal and always cost a strike.

| Code | Meaning |
|---|---|
| `bad_shape` | the reply failed the schema, had the wrong type, or has a number outside the allowed range |
| `out_of_bounds` | `fire` at a cell outside the board |
| `already_fired` | `fire` at a cell already shot (only with `repeat_shot: "invalid"`) |
| `bad_fleet` | the ship lengths do not match `ruleset.fleet` |
| `ship_out_of_bounds` | a ship leaves the board |
| `ships_overlap` | two ships share a cell |
| `ships_touching` | two ships touch while `touching` is `false` |

### Standalone errors

The `error` message. Whether it is fatal depends on the code and on when it happens:

| Code | Fatal | Close code when fatal | Cause |
|---|---|---|---|
| `bad_json` | before `welcome`: yes. Later: no | 4400 | the frame is not a JSON object. Also a binary frame, at any time (fatal) |
| `unknown_type` | before `welcome`: yes. Later: no | 4400 | `type` missing, or not a type the program may send |
| `bad_hello` | yes | 4400 | the first frame is a `hello` that fails the schema |
| `unexpected_message` | before `welcome`: yes (the first frame is not `hello`). Later: no | 4400 | a frame that makes no sense now (section 6) |
| `bad_shape` | no | none | a reply that fails the schema and has no readable `rid` (section 6) |
| `frame_too_large` | yes | 4400 | a frame over 16 KiB |
| `rate_limited` | yes | 4429 | too many ignored or invalid frames (section 6) |
| `hello_timeout` | yes | 4408 | no `hello` within 5 s |
| `auth_failed` | yes | 4401 | bad token, unknown lobby, or not allowed (not a seat owner in that lobby). The platform deliberately does not distinguish these |
| `lobby_expired` | yes | 4410 | the lobby was idle for too long and is read-only now. Only sent after authentication, to a participant who owns a seat in it; create a new lobby instead |
| `ruleset_mismatch` | yes | 4426 | none of the `accepts` rulesets matches the lobby's ruleset. Only sent after authentication; the message names the lobby's ruleset |
| `lobby_full` | yes | 4409 | the lobby has no empty seat for this participant |

### Close codes

Every fatal error above is followed by a close with the code in the table. These closes have no `error` frame:

| Code | Meaning |
|---|---|
| 4000 | the platform closed the connection normally: the lobby was closed or expired, the token was replaced, or a newer connection replaced this one. The close reason says which |
| 1009 | a frame over 64 KiB |
| 1006 | not sent by the platform: the connection was lost without a close (for example the platform restarted) |

## 9. JSON Schemas

The shape of every frame is also available as JSON Schema (draft 2020-12), generated from the platform's own schemas. They are linked from the top of this page (*Protocol versions*) and are served from the site as plain files:

| File | Contains |
|---|---|
| `/schemas/v1/program-v1.json` | every frame, either direction. `type` tells them apart |
| `/schemas/v1/to-platform.json` | frames the program sends: `hello`, `placement`, `fire` |
| `/schemas/v1/to-program.json` | frames the platform sends: `welcome`, `place`, `turn`, `game_over`, `reset`, `error` |

Each file is self-contained, with the shared types of section 3 under `$defs` (`Ship`, `Shot`, `Game`, ...). Use them to generate types for your language, or to validate the frames your program sends and receives while you develop it.

What the schemas do **not** say, because JSON Schema cannot express it:

- A board has `height` rows of `width` characters (from `welcome.ruleset`), not just 1 to 20.
- Whether a placement is legal (fleet, bounds, overlap, touching) or a shot is legal. Those are gameplay errors (section 8).
- Which frame is valid at which moment (sections 5 to 7).

Objects are open: extra fields are allowed, as described in section 2. The enumerations list the values of v1 today, and may gain values (section 10), so a program that rejects a frame because of a value it does not know breaks for no reason.

## 10. Versioning

The version is the path of the endpoint (`/program/v1`). A new field, error code or `reset` reason can be added within v1, which is why programs must ignore what they do not know (section 2). A breaking change gets a new endpoint, such as `/program/v2`.

## 11. Design notes

Why the protocol looks the way it does.

1. `hello` merges authentication, lobby join, ruleset negotiation, program metadata and the ready confirmation. A connection costs 1 round trip.
2. No `ready`, `game_start`, `lobby_status`, `series_over`, `fire_result`, `opponent_move`, `resume` or application-level heartbeat messages exist. The context rides along in `place`, results in `turn`, series state in `game_over`, resume in `welcome` plus a re-issued request.
3. Strictly request/response, so there is **one round trip per move**, which is the lowest possible. Frame count is deliberately not what matters; round trips are.
4. Errors on a reply re-issue the request with `error` set. This is one message instead of an `error` plus a new request.
5. Replies carry only the `rid` (not `game_id`). The `rid` alone is enough to discard stale replies after a reset.
6. State is full but constant-size (grids of strings) plus a small ordered `incoming` list. Programs can be stateless, and resume needs no special handling. A delta mode was considered and rejected: a turn is about 500 bytes, so a battery of 1000 games costs tens of megabytes at most.
7. All ships are placed in one message.
8. Heartbeats use native WebSocket ping/pong.
9. The protocol version is in the URL path.
10. Considered and rejected: binary encoding, compression (messages are small), batching several shots per message (impossible with `extra_turn_on_hit`, where each result decides the next shot), pipelining requests.
