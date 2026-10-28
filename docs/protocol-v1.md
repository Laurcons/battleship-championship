# Program Protocol v1 (DRAFT)

Status: agreed in principle (all open questions answered). The zod schemas in `packages/protocol` are the single source of truth for the frame shapes, and a test validates every JSON example in `docs/` against them.

## 1. Transport

- Endpoint: `wss://<host>/program/v1`. The protocol version is in the path, so the server can route before parsing any frame.
- One JSON object per **text** frame, UTF-8. Binary frames are rejected. No `permessage-deflate`.
- Inbound frames (program to platform) are at most 16 KiB.
- **Heartbeat uses WebSocket-level ping/pong**, not JSON messages. The server pings every 15 s, and any standard WebSocket library answers automatically. No pong within 30 s means the connection is dead.
- Every message has a `"type"` field.

## 2. Conventions

- Coordinates are 0-indexed. `x` is the column and `y` is the row.
- A ship placement is `{"len": 4, "x": 2, "y": 5, "dir": "h"}`. `(x, y)` is the first cell, `"h"` extends towards +x, and `"v"` extends towards +y.
- Shot results: `"miss"`, `"hit"`, `"sunk"`, `"repeat"`. `"sunk"` implies a hit, and carries `"len"` (the sunk ship's length) when the ruleset announces sunk ships. If the ruleset does not announce sunk ships, `"sunk"` is never sent; the result is `"hit"`. `"repeat"` only occurs when the ruleset's `repeat_shot` is `"waste"`: the shot was at an already-shot cell, changes nothing, and ends the turn. It is a bug in the program, and the web UI highlights it.
- Boards are arrays of row strings. Row `y` is `board[y]`, and column `x` is character `x`:

| Char | `you` grid (your own board) | `enemy` grid (what you know) |
|---|---|---|
| `.` | water, not shot | not yet shot |
| `o` | enemy shot missed here | your shot missed |
| `S` | your intact ship | n/a |
| `x` | your ship, hit | hit |
| `#` | n/a | cell of a ship you sank (only when sunk ships are announced) |

- Request/response pairing uses `rid`, an integer unique within the connection. A reply must echo the `rid` of the request it answers.

## 3. Messages

Program to platform: `hello`, `placement`, `fire` (3 types).
Platform to program: `welcome`, `place`, `turn`, `game_over`, `reset`, `error` (6 types).

### `hello` (program to platform; must be the first frame, within 5 s)

```json
{
  "type": "hello",
  "token": "bsc_xxxxxxxxxxxxxxxxxxxxxxxx",
  "lobby": "K7QM-4XD2-7",
  "accepts": ["classic-10x10"],
  "program": { "name": "my-bot", "version": "0.3.1" },
  "session_id": "optional, see section 6"
}
```

`hello` does everything at once: it authenticates, joins the lobby, checks the ruleset, and **is the program's "ready" confirmation**. There is no separate `ready` message. A program that needs setup time simply delays `hello` until it is ready. `program` and `session_id` are optional.

### `welcome` (platform to program)

```json
{
  "type": "welcome",
  "session_id": "s_9b1c...",
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

After `welcome` the program waits. A game or battery starts **only when a participant presses "Start" in the web interface**, which is possible once both seats are connected. The program may be connected for a long time, and no messages are sent in the meantime. The next message it receives is `place`.

### `place` (platform to program)

```json
{
  "type": "place", "rid": 1, "deadline_ms": 10000,
  "game": { "id": "g_8f3a", "index": 1, "total": 100, "first": "you" },
  "opponent": { "name": "Alex", "program": { "name": "x", "version": "1" } },
  "error": null,
  "strikes": 0
}
```

`place` is also the **game start**: it carries all the context for the game (index, total, who moves first, opponent info). There is no separate `game_start`. The `opponent.program` field is `null` if the opponent has not sent its program metadata. `game.index == 1` marks the start of a new battery; a program keeps cross-game memory only within one battery.

### `placement` (program to platform)

```json
{
  "type": "placement", "rid": 1,
  "ships": [
    { "len": 5, "x": 0, "y": 0, "dir": "h" },
    { "len": 4, "x": 0, "y": 2, "dir": "h" }
  ]
}
```

All ships go in **one** message. The lengths must match the fleet exactly, and ships must be inside the board and respect the `touching` rule.

### `turn` (platform to program)

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

- `you` and `enemy` are full boards (10 strings each, so about 300 bytes in total, constant size throughout the game). A program does not need any memory of earlier messages. A restarted program can continue from this message alone.
- `last_shot` is the result of your previous shot. It is `null` on your first turn of the game.
- `incoming` lists the opponent's shots since your last turn, in order. It is empty after a hit with `extra_turn_on_hit`. This is the only place the order of the opponent's shots is visible during a game. It is the basis for opponent modeling.
- `enemy_remaining` lists the lengths of the opponent's unsunk ships. It is `null` when sunk ships are not announced.
- `error` is set when your previous reply was invalid and this is a re-issue (see section 5); `strikes` is then your updated strike count. `place` carries `error` and `strikes` too.

### `fire` (program to platform)

```json
{ "type": "fire", "rid": 7, "x": 3, "y": 4 }
```

The platform answers a `fire` with the next `turn` (or `game_over`). There is **no separate result message**. The result arrives in `last_shot`.

### `game_over` (platform to program)

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

- `reason`: `"sunk"` (all ships sunk), `"timeout"`, `"strikes"`, `"disconnect"`. `winner` says who won, so a forfeit by the opponent is `winner: "you"`.
- `reveal` shows the opponent's final layout and all of the opponent's shots in order. This is the data for cross-game opponent modeling, and it is safe because the game is over. It is `null` when the ruleset has `reveal_on_game_over: false`.
- `series.done` is `true` after the last game of the battery. There is no separate `series_over`. The connection stays open and the lobby may start another battery later (it begins with a `place` with `game.index == 1`).
- After `game_over` the next `place` follows immediately inside a battery, with no acknowledgement needed.

### `reset` (platform to program)

```json
{ "type": "reset", "reason": "restart_game" }
```

`reason` is `"restart_game"` (the game is voided; the same game index will be played again) or `"reset_series"` (all battery results are discarded; the program should discard cross-game memory too). The program drops its current game state and waits for the next `place`. `reset` needs no reply, and can arrive at any time.

### `error` (platform to program, standalone)

```json
{ "type": "error", "code": "bad_json", "message": "human readable", "fatal": false }
```

Standalone errors cover problems that are not an invalid reply to a pending request, such as malformed JSON or an unknown `type`. If `fatal` is `true`, the platform closes the connection right after.

## 4. One game, as a sequence

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

## 5. Misbehavior

| Situation | Platform behavior |
|---|---|
| Repeated shot with `repeat_shot: "waste"` | Not a strike. The result is `"repeat"`, the turn passes, and the move is highlighted in the move history. |
| Invalid placement or invalid `fire` (out of bounds, already shot with `repeat_shot: "invalid"`, wrong fleet, ...) | One **strike**. The platform re-sends the same request type (`place` or `turn`) with a new `rid`, `error` filled in and `strikes` updated. After `max_strikes` the game is lost (`reason: "strikes"`). |
| Reply with a wrong shape (valid JSON but fails the schema) for the pending `rid` | Same as an invalid move: one strike. |
| No reply before `deadline_ms` | The game is lost immediately (`reason: "timeout"`). Not a strike. |
| Reply with a stale `rid` (answering a request that was cancelled by a reset or already answered) | Ignored. Recorded in the debug frame log only, no strike, no message. |
| Malformed JSON, unknown `type`, or a message when no request is pending | Standalone non-fatal `error`. Counted toward the abuse limiter. |
| More than 20 ignored or invalid frames in 10 s, an oversized frame, or a binary frame | Fatal `error`, then the connection is closed. |
| Disconnect during a game | The grace timer (`grace_ms`) starts. See section 6. |

## 6. Reset, reconnect and resume

- The server can send `reset` at any time. After `reset`, all pending `rid`s are void.
- **`session_id` is optional.** `welcome` issues one. If the connection drops while the process is still alive, the program can reconnect with `hello.session_id` to reclaim **exactly the same seat**. This matters only for self-play lobbies. A restarted program has lost its `session_id` and simply sends `hello` without it, taking the first empty seat. An unknown or expired `session_id` is treated as absent, not as an error.
- When the platform accepts a reconnect during `grace_ms`:
  1. It replies with `welcome` with `"resumed": true`.
  2. If a request was pending for that seat, it immediately re-issues it (`place` or `turn`) with a **new `rid`**. Because `turn` already carries the full state, no extra "resume" payload is needed. Resuming and normal play use the same code path.
  3. If it is the opponent's turn, nothing else is sent; the next `turn` arrives when it is this seat's turn.
- While the seat is disconnected the grace timer runs instead of the move timer, and the move timer starts fresh after the resume.
- If the grace period expires: a single game is forfeited by the absent seat (`reason: "disconnect"`); a battery ends as `aborted` with partial results kept.
- If the server restarts, an in-progress game is voided and no `session_id` survives. Programs reconnect and start with `hello` as normal.

## 7. Error codes and close codes

`error.code` values for gameplay errors (in `turn.error` / `place.error`): `out_of_bounds`, `already_fired`, `bad_fleet`, `ship_out_of_bounds`, `ships_overlap`, `ships_touching`, `bad_shape`.

Standalone `error.code` values: `bad_json`, `unknown_type`, `unexpected_message`, `frame_too_large`, `rate_limited`. Just before the platform closes a connection during the handshake it also sends a fatal `error` whose code names the reason: `auth_failed`, `ruleset_mismatch`, `lobby_full`, `hello_timeout` (the WebSocket close code says the same, see below).

WebSocket close codes (after a fatal condition at connect time):

| Code | Meaning |
|---|---|
| 4400 | bad request (invalid `hello`) |
| 4401 | `auth_failed`: bad token, unknown lobby, or not allowed. The platform deliberately does not distinguish these. |
| 4408 | no `hello` within 5 s |
| 4409 | lobby has no empty seat |
| 4426 | none of the `accepts` rulesets matches the lobby's ruleset. Only sent after authentication; the message names the lobby's ruleset. |
| 4429 | rate limited |
| 4500 | internal error |
| 4000 | the platform closed the connection normally (lobby closed, token replaced) |

## 8. What was optimized (review notes)

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
