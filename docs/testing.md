# Testing Strategy

Nothing counts as done until it has tests, and a bug fix starts with a failing regression test. All test layers run from the repo root with `pnpm`, headless, with no manual setup beyond Docker.

## Environment (verified on this machine)

- Node 24, pnpm 11, Docker 29 with `mariadb:11.4` images already present, Playwright Chromium already cached. If the cached Chromium does not match the Playwright version in the lockfile, the matching browser is installed with `pnpm exec playwright install chromium`.
- Integration and E2E tests use a throwaway MariaDB container (`docker compose -f docker-compose.test.yml up -d`, data on tmpfs), started and stopped by the test scripts.

## Commands

| Command | What it runs |
|---|---|
| `pnpm test` | Unit and API tests: engine, protocol, shared contract, the whole API on in-memory storage (including real WebSocket programs, misbehavior, resume, redaction, the access matrix, fuzzing, the example programs), web components. Seconds to a minute, no Docker. |
| `pnpm test:int` | The same store contract, and the runtime, against a real MariaDB (Docker, started and stopped by the script). |
| `pnpm test:e2e` | Playwright browser tests of the interface on the in-browser mock. |
| `pnpm test:e2e:real` | Playwright browser tests against the real stack: the API serves the built web app and the programs are real WebSocket clients. |
| `pnpm test:soak` | A 1000-game battery with memory sampling and ten concurrent lobbies, on MariaDB. Slow; not part of `test:all`. |
| `pnpm test:all` | Lint, typecheck and everything above except the soak test. |

Set `EXAMPLE_PYTHON` to a Python with `websockets` installed to also run the Python example program in `pnpm test`.

## Layers

1. **Engine (unit and property tests).** Vitest and fast-check, with seeded randomness. Placement validity, the touching rule, shots, sunk detection, win detection, extra turns, alternating first mover; any random legal game terminates, replay reproduces the state, a seat view never contains hidden opponent data.
2. **Protocol.** Zod schemas, and **every JSON example in `docs/` is extracted and validated against them**, so the documentation cannot drift from the implementation. The frame builders are exercised on random games under every ruleset option: each frame validates, has the right dimensions, never reveals the opponent, and never mentions sunk ships when the ruleset does not announce them. The parser never throws, whatever it is given.
3. **Store contract.** One suite of behaviors (unique names, atomic game recording, cascading deletes, ordering, exact round-trips of event logs including emoji) runs against both the in-memory store and MariaDB.
4. **API.** A real NestJS application with real HTTP and real `ws` clients, covering:
   - login (shared password, name, admin), session fixation, cookie flags, login and API rate limits, forwarded-address handling;
   - participants, tokens (created on demand, shown once, hashed, replaced, notices), rulesets (validation, default, enable/disable guards), settings and the audit log;
   - lobbies: creation rules, god-mode choice and policy, caps, deletion, restoring after a restart;
   - the handshake: wrong token, unknown lobby and foreign lobby are indistinguishable; ruleset mismatch; full lobby; timeouts; binary and oversized frames; garbage;
   - games: full games and batteries between two programs and against practice bots, alternating first mover, self-play, atomic completion;
   - misbehavior: invalid moves and placements as strikes with the re-issued request, forfeit at the maximum, move timeout, stale replies, unsolicited messages, abuse limiter, repeat shots that are wasted;
   - resilience: a dropped program is resumed inside the grace period (with and without `session_id`), expires into a forfeit or an aborted battery, restart and reset of games and batteries, token replacement, lobby deletion, idle expiry, platform restart in the middle of a battery, graceful shutdown with live connections;
   - information hiding: a restricted viewer is never sent the opponent layout, in the live stream or the history, until the game ends.
5. **Security.**
   - A table-driven **access matrix**: every route is called as anonymous, admin, both players and an outsider and checked against the expected status; a coverage check fails if a route has no row.
   - Cross-site requests and non-JSON bodies are refused; malformed and oversized bodies get JSON errors, never stack traces.
   - Tokens never appear in any response or frame log.
   - Hostile input: random bodies at every write route and odd path parameters never produce a server error; hostile WebSocket clients cannot disturb a game in another lobby.
6. **UI component tests.** Vitest with React Testing Library for the board, move list, before/after scrubber, forms and the heatmaps.
7. **End-to-end UI tests.** Playwright (headless Chromium), with axe accessibility checks and screenshots:
   - on the mock: every participant and admin flow, including simulated misbehavior;
   - on the real stack: tokens made on the Account page, two participants with real programs playing a battery, practice bots, restricted views seen from three browsers, resume with the countdown, aborted batteries, infractions in the history, restart and reset from the interface, the admin policy, the audit log, and axe on real pages.
8. **Soak.** A 1000-game battery (heap growth, bounded frame log) and ten concurrent lobbies.
9. **Example programs.** The TypeScript example (and the Python one when available) play a battery against each other on a live platform with zero infractions.

## Manual testing

I run the real stack locally (API, web, MariaDB container), connect the example programs and the chaos bot, and drive the UI with Playwright, reading its screenshots, console and network logs. That covers behavior and layout bugs.

Limits: I cannot judge feel and aesthetics like a person with a real browser, and I cannot test the actual Coolify deployment (TLS, proxy header trust, persistent volume). Those need a short checklist run by a human after the first deploy:

- the WebSocket works through the proxy over `wss://`;
- the proxy's forwarded-IP header is honored only from the proxy;
- the database volume survives a redeploy;
- rolling deployments are disabled.
