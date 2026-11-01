# Getting started

You write a **program** that plays Battleship. The platform connects it to an opponent's program, checks every move, and keeps the score. Your program talks to the platform over a WebSocket using small JSON messages (see the *Protocol* page).

## How a game comes together

1. **Create a lobby** on the *Lobbies* page. Pick your opponent (another participant, yourself, or a practice bot), a **ruleset**, and whether both players see both fleets live (**god mode**). The lobby gets a short id such as `K7QM-4XD2-7`. Copy it from the lobby page.
2. **Start your program** with two pieces of information:
   - your **account token**. You create it yourself, once, on the *Account* page; the platform shows it only at that moment, so copy it into your program's settings. It is the same for all your programs, and only changes if you replace it;
   - the **lobby id**. It is different for every lobby.
3. Your program connects and sends `hello`. The platform answers with `welcome`. Both programs must be connected.
4. Anyone in the lobby presses **Start** in the web interface and chooses how many games to play. The programs then play at full speed until the last game ends. There is no pause button.
5. Watch live, then use the **History** tab to step through any game, and the **Results** tab for the statistics of a battery.

## God mode: friendly game or fair match

Whoever creates a lobby decides how much the players can see while a game is running:

- **God mode on** (the default): both players see both fleets live. Good for a friendly game where you give each other feedback.
- **God mode off** (*restricted view*): each player only sees what their own program knows. Good for a fair match without strategy disclosure. Once a game has ended, both players see everything.

The choice is fixed when the lobby is created, and the lobby shows which mode it is in. Lobbies against yourself or a practice bot are always in god mode. For a competitive event the admin can turn god mode off completely.

## Stop on infraction

A lobby can also be created with **stop on infraction**. In such a lobby a battery ends, as aborted with the results so far, at the first infraction of either program (an invalid move or placement, a malformed reply, or a timeout). The game where it happened is kept in the history, marked void, so you can see what went wrong. Use it to catch bugs early in a long battery instead of letting a broken program forfeit hundreds of games. Like god mode, it is fixed when the lobby is created.

## Rulesets

A ruleset fixes the board size, the fleet and the optional rules (touching ships, extra turn on a hit, whether sunk ships are announced, what happens on a repeated shot, whether the opponent's layout is revealed after a game). Your program lists the rulesets it supports in `hello.accepts`. If the lobby's ruleset is not among them, the connection is refused with close code 4426 and a message naming the lobby's ruleset.

The ruleset parameters are also sent to your program in `welcome`, so it does not have to hard-code them.

## Connecting

Use a standard WebSocket client. Nothing else is needed: no SDK, no special framing.

| What | Value |
|---|---|
| URL | `wss://<this site>/program/v1` (plain `ws://` only if the admin has allowed it for your account) |
| First message | `hello` with your token and the lobby id (within 5 s) |
| Heartbeat | WebSocket ping/pong, handled automatically by your library |
| JSON Schemas | Of every message, linked from the *Protocol* page |

The example programs (see *Examples*) read three environment variables: `BSC_URL`, `BSC_TOKEN` and `BSC_LOBBY`.

### Plain `ws://` and TLS

Programs connect over `wss://` (TLS) by default. Some environments cannot do TLS without extra libraries (for example a single C++ file in a school project). For those the admin can switch on *Allow ws://* for an individual participant on the *Participants* admin page. Such a program connects to `ws://<host>:<port>/program/v1` and sends its token unencrypted. If the account is not allowed, `hello` fails with the error `tls_required` and close code 4403. Treat a token that was sent over plain `ws://` to an account that is not allowed as exposed, and replace it on the *Account* page.

## If something goes wrong

- **Your program crashes or loses the connection.** You have a *resume window* (60 s). Reconnect with `hello` and the platform sends you the situation again (see *Reset, reconnect and resume* in the protocol). After the window, a single game is lost and a battery is aborted.
- **The platform restarts** (a deploy, for example). Your connection closes, the game in progress is voided, and a running battery keeps its results and waits for you. Reconnect with `hello` (retry every few seconds, with a short pause between attempts) and the battery carries on with a fresh `place`. A well-behaved program reconnects on its own.
- **You replace your token** (on the *Account* page, for example if you lost it). All connections using the old token are closed immediately.
- **The lobby is restarted** (from the web interface). Your program receives `reset` at any moment and must forget the current game.

## Common mistakes

- Not echoing the request's `rid` in your reply. Replies with a wrong `rid` are ignored, and the platform waits until your move times out.
- Answering a request that was cancelled by a `reset`.
- Sending more than one reply to the same request.
- Using 1-based coordinates. The board is 0-based; `x` is the column and `y` the row.
- Forgetting that after a hit the ruleset may give you another turn. A `turn` message is sent each time it is your move.
- Printing debug text to a pipe that the platform reads. The platform only reads WebSocket frames, so use your own logs.
- Taking too long. Moves must be answered within the move timeout (see `welcome.limits`).

## Debugging

Every lobby has a **Connection** tab with your programs' status, the raw frames exchanged (both directions), and the connection details. Invalid moves and repeated shots are highlighted in the move history so you can see exactly what your program did wrong.
