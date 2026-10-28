# Testing Strategy (DRAFT)

Nothing counts as done until it has tests, and a bug fix starts with a failing regression test. All test layers run from the repo root with `pnpm`, headless, with no manual setup beyond Docker.

## Environment (verified on this machine)

- Node 24, pnpm 11, Docker 29 with `mariadb:11.4` images already present, Playwright Chromium already cached. If the cached Chromium does not match the Playwright version in the lockfile, the matching browser is installed with `pnpm exec playwright install chromium`.
- Integration and E2E tests use a throwaway MariaDB container (`docker compose -f docker-compose.test.yml up -d`, data on tmpfs), started and stopped by the test scripts.

## Commands

| Command | What it runs |
|---|---|
| `pnpm test` | Unit and component tests (engine, protocol, API units, web components). Seconds, no Docker. |
| `pnpm test:int` | API integration tests against a real MariaDB with real WebSocket clients. |
| `pnpm test:e2e` | Playwright browser tests against the real running stack. |
| `pnpm test:all` | Everything above plus lint and typecheck. |
| `pnpm test:soak` | Long-running battery and concurrency checks. Not part of `test:all`. |

## Layers

1. **Engine (unit and property tests).** Vitest and fast-check, with seeded randomness. Covers placement validity, the touching rule, shots, sunk detection, win detection, extra turns and alternating first mover. Property tests include: any random legal game terminates, replaying the event log reproduces the state exactly, and a seat view never contains hidden opponent data.
2. **Protocol.** Every schema has golden fixtures. **Every JSON example in `docs/` is extracted and validated against the schemas**, so the documentation cannot drift from the implementation.
3. **API integration.** A real NestJS app with real MariaDB and real `ws` clients, covering:
   - bot-vs-bot batteries end to end and the stored aggregates;
   - ruleset mismatch, first-empty-seat allocation and self-play;
   - reset at every phase, including mid-turn;
   - resume within the grace period (with and without `session_id`) and expiry of the grace period;
   - timeouts, strikes, `stopOnInfraction` and stale `rid` handling;
   - server restart voiding the game and recovering series progress;
   - ruleset immutability and the rule that the last enabled ruleset cannot be disabled.
   Platform constants are shortened by env vars so these tests run quickly without fake clocks.
4. **Security.**
   - A table-driven **IDOR matrix**: every HTTP route, SSE stream and WebSocket action is called as each role (anonymous, owner, other participant, admin) and checked against the expected outcome.
   - `auth_failed` is indistinguishable for a wrong token and a wrong lobby.
   - Replacing a token drops active connections, and a participant without a token cannot connect a program.
   - Raw SSE and history responses in restricted mode are scanned for the opponent's layout.
   - Login rate limits, frame-size limits and the abuse limiter.
   - Response headers (CSP, cookie flags).
5. **Chaos and fuzz.** A chaos bot sends garbage frames, double and late replies and mid-turn disconnects, and the platform must stay up and keep other lobbies unaffected. Parsers are fuzzed with fast-check.
6. **UI component tests.** Vitest with React Testing Library for the board, move list, before/after scrubber, forms and the heatmaps.
7. **End-to-end UI tests.** Playwright (headless Chromium) against the real stack, using the practice bots and the example programs as opponents:
   - participant login (shared password, name dropdown) and the admin login;
   - admin creates, enables and disables rulesets, and the god-mode toggle affects only new lobbies;
   - creating a lobby, watching a live game, and clicking a history item to see the board before and after;
   - a battery with the aggregate results page;
   - the restart buttons, the account page (no token yet, created once, replaced) and the notice for a token replaced elsewhere;
   - an XSS payload in a program name renders inert;
   - the docs pages render and the example downloads work.
   Screenshots are saved for each key page.
8. **Soak (`test:soak`).** A 1000-game battery with memory sampling, and 10 concurrent lobbies.

## Manual testing

I run the real stack locally (API, web, MariaDB container), connect the example programs and the chaos bot, and drive the UI with Playwright, reading its screenshots, console and network logs. That covers behavior and layout bugs.

Limits: I cannot judge feel and aesthetics like a person with a real browser, and I cannot test the actual Coolify deployment (TLS, proxy header trust, persistent volume). Those need a short checklist run by a human after the first deploy:

- the WebSocket works through the proxy over `wss://`;
- the proxy's forwarded-IP header is honored only from the proxy;
- the database volume survives a redeploy;
- rolling deployments are disabled.
