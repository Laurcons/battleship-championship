# Battleships Championship: Approved Decisions

Only decisions approved by the project owner live here. Proposals awaiting approval live in `OPEN-QUESTIONS.md`.

## 1. Purpose and trust model

- A friendly event for fewer than 5 participants. The platform must support up to 10.
- Participants write **autonomous programs** that play Battleship against each other through the platform.
- Strategy is entirely the program's responsibility.
  - A human must not interact with a program, in strategy matters, once a game has started.
  - A program must not use information from outside its platform connection.
  - This is enforced by trust, not by the platform. The platform *does* enforce correctness of moves and information hiding on the wire.
- Battleship involves luck, so **batteries of head-to-head games with aggregated results** are a first-class feature.
- Participants are trusted to play fairly and respect each other's time. They are *not* trusted to refrain from trying to break the platform, so the platform is hardened against technical abuse (IDOR, flooding, malformed input, XSS, etc.).

## 2. Stack, architecture and hosting

- TypeScript end to end.
- **API:** NestJS. **Frontend:** Vite + React + TanStack Query.
- **UI look:** React-Bootstrap with the **Bootswatch Darkly** theme (dark only), replacing the earlier light/dark idea. Hit, miss and sunk cells use symbols as well as colors. Contrast problems are fixed with Sass variable overrides and checked with automated accessibility tests (axe in Playwright).
- **Database:** MariaDB via Prisma. Event logs are stored as text/blob columns that we serialize ourselves (not the DB's JSON type).
- **pnpm monorepo:**
  - `packages/engine`: pure game logic with no I/O, shared by API and web;
  - `packages/protocol`: zod schemas, from which JSON Schema and the protocol reference are generated;
  - `apps/api`;
  - `apps/web`;
  - `examples/`.
- Programs connect over **raw WebSockets** (`@nestjs/platform-ws`, not socket.io). The browser live view uses **SSE**.
- A **seat driver abstraction** (`WebSocketSeat`, `BuiltinBotSeat`) lets practice bots go through the same engine path as real programs.
- Hosted on the **public internet** via **Coolify**. **Single API instance. Rolling deployments are disabled.**
- The platform code is closed-source for now but is built so it can be open-sourced easily (section 15).

## 3. Accounts and authentication

- **Participants** are managed by the admin (the list behind the name dropdown).
- Participants log in by entering a **global shared password**, then selecting their name from a dropdown. There is no per-participant password. (Deliberate: less friction.)
- The shared password is long and random, stored hashed, and login is rate-limited per IP. The forwarded-IP header is trusted only from Coolify's proxy.
- **Admin** logs in separately with username and password.
- Admin can:
  - set the **god-mode policy**: whether lobby creators may choose god mode at all (on by default). Turn it off for a competitive event: new lobbies between participants are then always restricted. Affects **new lobbies only**;
  - create, enable and disable rulesets (section 6);
  - manage participants;
  - view any lobby in god-mode;
  - read an **audit log** of sensitive actions (token creation and replacement, lobby restarts, logins).
- A participant sees a notice when their token has been replaced from another session.

## 4. Program connection

- Programs connect over **plain WebSocket** with a **JSON** protocol, specified in `docs/protocol-v1.md`.
  - The protocol version is in the URL path (`/program/v1`).
  - `hello` is the authentication, join, ruleset check **and ready confirmation**. There is no separate `ready` message.
  - Resume is `welcome` with `resumed: true` plus the pending request re-issued. There is no `resume` message.
  - Heartbeats use WebSocket ping/pong.
- Lobby ids are 8 Crockford-base32 characters plus a check character (for example `K7QM-4XD2-7`).
- A program identifies itself with:
  - an **account-level token** that does not change unless the participant replaces it. Replacing invalidates the old token and drops its connections;
  - the **lobby id**.
- **Tokens are created by the participant, on demand.** A new participant has no token. On the Account page they create one, and the full token is shown once, at that moment; the platform keeps only a hash and the last four characters. Until a token exists, programs cannot authenticate. Later the token page offers "Replace token" (with a warning that connected programs are disconnected), never "regenerate". The audit log distinguishes `token_created` from `token_replaced`.
- The lobby id is a human-readable, easy-to-copy, hard-to-enumerate string. It is a *locator*, not an authorization secret. Authorization is lobby membership.
- **Seat allocation:** a connecting program takes the **first empty seat**. Order is irrelevant.
- A participant may run multiple programs, including several in the same lobby against each other.
- The program's hello reports its **protocol version** (an integer) and an **`accepts` list of ruleset ids**. The lobby refuses on mismatch.
- The **wire protocol has its own integer version**, separate from rulesets. The platform may support several protocol versions at once, and the docs present all of them.
- Before a game (or before a battery), the lobby waits for both programs to **handshake** and confirm they are ready.
- Programs must handle a **reset** signal at any point in a game.
- **Resume:** a program that reconnects during the grace period receives its current game state (and any pending request) and carries on.
  - `welcome` issues a **`session_id`**, which is **optional** for programs. Reconnecting with it reclaims exactly the old seat (this matters only in self-play). Without it (for example the program restarted), the program takes the first empty seat.
  - While a seat is disconnected, the grace timer runs instead of the move timer. After a resume the move timer starts fresh.
  - After the grace period, an in-progress single game is forfeited by the absent seat. In a battery, the series ends as `aborted`.

## 5. Lobbies

- A participant creates a lobby and selects the opponent.
- A participant can be in multiple lobbies.
- A lobby is pinned to one ruleset when created. The **default** ruleset (preselected for new lobbies) is **chosen by the admin**, not the newest one: creating a new ruleset does not change it. The default must be enabled, so the admin cannot disable the default ruleset until another one is made the default.
- A lobby can be **restarted** for any reason.
- A lobby hosts either a **single game** or a **battery**: a target number of games played back-to-back, immediately and at full speed, with aggregate results at the end.
- A game or battery starts **only from the web interface**, when a participant (either seat's) presses "Start". The button is available once both programs are connected. It is also how a finished lobby runs again.
- The opponent needs no approval for a new lobby; it simply appears in their list. **Anyone who is part of a lobby can delete it**, and so can the admin.
- A participant sees only the lobbies where one of their seats plays. The admin sees all of them.
- **God mode is chosen by the lobby creator** with a checkbox when creating the lobby (both players then see both fleets live, or each sees only what their own program knows). It is **immutable** after creation, and the lobby list and lobby page show the mode. The checkbox starts on, and then simply remembers the creator's last choice in their browser; there is no preference setting and the interface does not mention it. Lobbies against yourself or a practice bot are always god mode, regardless of the choice and the policy. If the admin's policy forbids god mode, the creator cannot pick it.
- Once programs are connected and ready, they play to the end at full speed. **There is no pause or step facility.**
- Timeouts are **platform constants** (generous, env-configurable), not part of rulesets. Their purpose is to reclaim resources from forgotten lobbies, not to police play. Idle lobbies expire, and the number of open lobbies per participant is capped.

  | Constant | Default |
  |---|---|
  | Move timeout | 10 s |
  | Placement timeout | 10 s |
  | Disconnect grace (resume window) | 60 s |
  | Waiting for opponent / ready | no timeout, covered by idle expiry |
  | Idle lobby expiry | 2 h |
  | Open lobbies per participant | 10 |
  | Invalid-move strikes before forfeit | 3 |

  A **timeout forfeits the game immediately** (it is not a strike). Invalid moves are strikes.

## 6. Rulesets ("versions" / game modes)

- A ruleset is identified by a short descriptive **string** (for example `classic-10x10`) and holds a set of game parameters.
- Admin can create rulesets and **enable/disable** them. This only affects **new** lobbies.
- At least one ruleset is always enabled. The platform refuses to disable the last one. Lists of rulesets show the default first and disabled rulesets last.
- Rulesets are **immutable once a lobby has used them**. Only `enabled` and the description can change. To change rules, clone into a new ruleset.
- Platform bug fixes do **not** change a ruleset's version.
- Parameters (a closed list; no salvo or other exotic variants for now):
  - board size;
  - fleet (ship lengths);
  - whether ships may touch;
  - **extra turn on hit**;
  - whether the sunk ship type is announced;
  - first-mover rule;
  - repeated-shot handling: `invalid` (a strike) or `waste` (the shot counts as a repeat and the turn passes). Either way the move is highlighted in the move history;
  - **reveal on game over:** whether programs are shown the opponent's layout and shots when a game ends.
- **Seeded default `classic-10x10`:** 10×10, fleet 5/4/3/3/2, ships may not touch, **extra turn on hit**, sunk type announced, alternating first mover, repeated shot = invalid, reveal on game over = on.

## 7. Batteries (series)

- The **starter alternates** every game (no coin flip). Seat 1 (the first seat to connect) starts game 1, so a single-game lobby favors seat 1. This is accepted.
- **Battery size is chosen when pressing Start** (default 1, capped by the admin's maximum).
- **Series result:** the seat with more wins. An even-sized battery can end tied, and a tie is shown as a tie with no tiebreak. Voided games are not counted.
- **Handshake once per series.** Subsequent games start immediately. Each game gets a new `game_id`.
- **Disconnect mid-series:** the series is paused for the grace period. If the program doesn't return, the series ends as `aborted` with partial results kept.
- A forfeit counts as a loss for that game and the series continues. An optional lobby flag **`stopOnInfraction`** ends the series at the first infraction.
- **Aggregate stats:** wins and win rate with a confidence interval, average and median shots to win, shots histogram, wins as first vs second mover, forfeits, infractions, and average think time.
- The admin sets a **maximum battery size**.
- **Restart** has two buttons: "restart current game" (voids it and keeps the count) and "reset series" (discards all results). Either seat's participant may press them, and the action is recorded in the audit log.
- A running battery shows **progress and an ETA**.

## 8. Persistence and restarts

- Persist **at game end** (one transaction per game). Live events stream from memory.
- **Retention:** game records and audit log entries are kept indefinitely. Raw frame logs are a capped ring buffer per connection (last 2000 frames) and expire after 7 days.
- On server restart or deploy, a game in progress is voided. Series progress persists, and the lobby waits for programs to reconnect.

## 9. Information visibility

- The platform never sends hidden information to a program or to a browser that is not entitled to it. Redaction happens server-side in one function.
- **God-mode** (see everything) vs **restricted** (only what the viewer's own program knows) is decided per lobby at creation by its creator (see section 5). Same-participant lobbies and bot lobbies are always god-mode. Whatever the mode, a finished game is fully visible to both participants.
- God-mode is accepted as a theoretical leak to the participant's own program. We trust participants not to use it.

## 10. Live view and history

- Participants see each lobby live: placements, moves, infractions.
- A history list of all moves. Clicking an item shows the board state before and after that move.
- Game state is derived from an append-only event log, so history is a replay.

## 11. Misbehavior handling

- Programs are expected to misbehave or have bugs, and the platform copes.
- Malformed messages, illegal moves, timeouts, disconnects and stale or unsolicited messages are handled by defined policy.
- Every infraction is recorded as an event and visible in the history. Invalid moves and repeated shots are **highlighted in the move history**, since they are bugs the participant should see.
- Strikes apply to invalid moves and to replies with a wrong shape for a pending request. Stale and unsolicited messages are handled separately (see `docs/protocol-v1.md`, section 5).

## 12. Debugging tools

- Raw frame log per connection, both directions, timestamped, with the token redacted and the log size-capped.
- Connection status panel: connected state, latency, last heartbeat.
- Per-move think-time display.
- Infractions shown in the move list.
- Program metadata (`name`, `version`) sent in the hello message, shown in the UI.
- Game export/import as JSON; replay a recorded game against a program.
- Reproducible scenarios (fixed opponent placement, scripted opponent moves). Lower priority.
- History playback at human speed (client-side only).
- Protocol conformance checker.
- Chaos bot used in the platform's own tests.
- Dropped: pause/step mode.

## 13. Practice bots

- Platform-hosted practice opponents. **Basic strategies only**: `random` and `hunt-target`, both generic over ruleset parameters.
- Bot results are shown in the lobby but do not appear in any participant ranking.

## 14. Documentation and examples

- Full documentation of the platform-program interface, built into the web app behind the participant login:
  - a guide with the state machine diagram;
  - a generated message reference for every supported protocol version;
  - an error code table;
  - a "common mistakes" section;
  - downloadable JSON Schemas.
- Example programs (minimal raw-WebSocket clients in TypeScript and Python) are **also downloadable from the platform**. They play trivially and **disclose no strategy**.
- The bridge CLI is **postponed** and may never be built.

## 15. Security principles and open-sourceability

- Every resource access goes through one central authorization policy. IDOR tests use at least two participants.
- Tokens are high-entropy and stored hashed. They are never in URLs or logs.
- Strict input validation, size limits and rate limits on all inbound messages.
- Program-supplied strings are rendered as text only and a strict CSP is set.
- Resource caps on lobbies, retention and connections.
- No secrets or participant names in the repo; all config through environment variables.
- Dependencies with compatible licenses. The licence for the eventual open-sourcing is chosen later.
- Protocol spec, examples and tooling in their own packages. Clean git history.

## 16. Program rules and strategy expectations

These are stated in the docs (a dedicated "Rules for programs" page), so every participant knows what is expected.

- Programs are autonomous. No human interaction after a game has started, and no information from outside the platform connection.
- Programs **may keep in-memory state across the games of one battery**; that is where opponent modeling lives. Nothing may be persisted between batteries (files, databases, and so on). This is trust-enforced.
- The handshake includes the opponent's name and program metadata, plus `game_index` and `total`.
- **Heatmaps** are aggregated over a battery: shots per cell and placements per cell, per program. In restricted mode they are visible only for finished games.
- The protocol-version policy: bump only on breaking changes, keep the previous version for a deprecation window, and generate the docs for every supported version from its schemas.

## 17. Testing

- Automated tests at every layer (engine, protocol, API integration, security, chaos, UI components, Playwright end-to-end), plus manual testing of the running stack. Details are in `docs/testing.md`.
- Every feature ships with tests, and every bug fix starts with a regression test.
- All suites run from the repo root with `pnpm`, headless.
- Integration and end-to-end tests use a throwaway MariaDB container through Docker (`docker-compose.test.yml`).

## 18. UI mock (first build step)

- Before the real API exists, a UI mock is built so every participant and admin flow can be vetted.
- It lives in `apps/web` itself. All API calls go through an `ApiClient` interface. The mock implementation is in-memory (saved to `localStorage`), and the real HTTP/SSE client replaces it later. The interface is the first draft of the API contract.
- The real `packages/engine` (small, with tests) is built first, so boards, history scrubbing, stats and heatmaps are correct.
- A mock-mode-only **control panel** switches between participants and admin, simulates program connect/disconnect, invalid moves, timeouts and server restarts, changes game speed, and resets the data.
- Playwright tests are written against the mock now, so they can later run against the real stack.
- The mock runs with `pnpm dev`. It is not hosted anywhere.
- Mock stack: Bootstrap Icons, React Router, react-hook-form with zod, Recharts (boards and heatmaps are plain CSS grid), Vitest with React Testing Library, Playwright with axe.
- Build order: (1) monorepo scaffold and engine, (2) web shell with `ApiClient` and mock data, (3) participant flows, (4) lobby page, (5) admin flows, (6) docs pages and mock control panel, (7) Playwright tests across all flows.

## 19. Real implementation (second build step)

- `packages/protocol` holds the zod schemas for every frame, the frame builders (`placeFrame`, `turnFrame`, `gameOverFrame`), the wire ruleset mapping, lobby codes and token generation. API, bots, mock and tests all use it. A test validates every JSON example in `docs/` against the schemas.
- Build order: (1) protocol package, (2) API core (NestJS + Prisma/MariaDB, HTTP routes implementing `ApiClient`), (3) game runtime (WebSocket gateway, lobby orchestration, practice bots, SSE), (4) HTTP `ApiClient` in the web app and the Playwright suite against the real stack, (5) integration, security and chaos tests, deployment files and README, (6) example bots against the real server.
- In the mock, seat 1 is the lobby creator and starts game 1. The real platform uses the rule agreed earlier (the first program to connect takes the first empty seat); the mock differs only because its programs are simulated.
- Tokens are `bsc_` plus 32 characters from `[A-Za-z0-9]`, drawn without modulo bias from a cryptographically secure source.

## 20. Out of scope for now

- Tournament brackets (a good idea for after the platform works).
- Per-participant login passwords.
