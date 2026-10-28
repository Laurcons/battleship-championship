# Battleships Championship

A small platform for a Battleship coding championship among friends. Everyone writes a program that plays Battleship; programs connect to the platform over a WebSocket, and the platform referees their games. Participants use a web interface to create lobbies, run batteries of games, watch games live, and read the results.

- Programs speak a small JSON protocol: [docs/protocol-v1.md](docs/protocol-v1.md). Example programs in TypeScript and Python are in [examples/](examples/).
- Participants log in with a shared password and pick their name. The admin has a separate login.
- Decisions behind the design: [DECISIONS.md](DECISIONS.md). Testing approach: [docs/testing.md](docs/testing.md). Running it for real: [docs/deployment.md](docs/deployment.md).

## Try it

Requires Node 24 and pnpm 11.

```bash
pnpm install
pnpm dev          # the web interface against an in-browser mock (no server needed)
```

The mock has a developer panel (bottom right) that simulates programs connecting, misbehaving and disconnecting. Password for participants: `battleship`; admin: `admin` / `admin`.

To run the real thing locally, with data kept in memory:

```bash
SHARED_PASSWORD=battleship ADMIN_PASSWORD=admin pnpm --filter @bsc/api start     # API on :3000
VITE_API_MODE=http pnpm --filter @bsc/web dev                                      # web on :5173, forwarding /api to :3000
```

Or build the web app and let the API serve it on one port:

```bash
VITE_API_MODE=http pnpm --filter @bsc/web build
WEB_DIST=apps/web/dist SHARED_PASSWORD=battleship ADMIN_PASSWORD=admin pnpm --filter @bsc/api start
```

Then open http://localhost:3000. Without `DATABASE_URL` the platform keeps everything in memory; with it, in MariaDB (see [docs/deployment.md](docs/deployment.md)).

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | The game itself: rules, placement, shots, replay, statistics. Pure TypeScript, no I/O. |
| `packages/protocol` | The program protocol: zod schemas, frame builders, lobby codes, tokens. |
| `packages/api-contract` | Types and request schemas shared by the API and the web app. |
| `packages/bots` | The practice bots (random, hunt and target). |
| `apps/api` | NestJS API: HTTP, server-sent events, the program WebSocket, the game runtime, MariaDB via Prisma. |
| `apps/web` | Vite + React web interface (Bootswatch Darkly). Runs on a mock or on the real API. |
| `examples/` | Minimal example programs. They show the protocol, not a strategy. |
| `docs/` | Protocol, rules for programs, rulesets, getting started, testing, deployment. |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web interface on the in-browser mock. |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the repo. |
| `pnpm test` | Unit and API tests (engine, protocol, API on in-memory storage, web components). Seconds. |
| `pnpm test:int` | API tests against a real MariaDB (Docker). |
| `pnpm test:e2e` | Browser tests of the interface on the mock. |
| `pnpm test:e2e:real` | Browser tests against the real stack, with real WebSocket programs. |
| `pnpm test:soak` | A 1000-game battery and ten concurrent lobbies on MariaDB. Slow; not part of `test:all`. |
| `pnpm test:all` | Everything except the soak test. |

## Security notes

The platform assumes friendly participants but defends against technical abuse: every route declares who may call it and fails closed, lobbies are invisible to non-members (a foreign lobby and a missing one look the same), tokens are stored hashed and shown once, passwords are scrypt hashes, cookies are HttpOnly + SameSite, state-changing requests are checked for origin, responses carry a strict CSP, and inbound sizes and rates are limited. Report anything that looks wrong to the maintainer.

## Licence

Not chosen yet. The code is kept free of secrets and personal data so it can be opened up later.
