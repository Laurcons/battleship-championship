# Deployment

The platform is one container: the API, which also serves the built web app, plus a MariaDB database. It is built for **one instance**; game state lives in memory while games are played and is stored when each game ends.

## What you need

- A MariaDB 11 database and a user with full rights on it.
- A way to run the image built from the `Dockerfile` in the repository root, behind HTTPS (Coolify does this).
- Two password hashes: the shared participant password and the admin password.

Create the hashes with `pnpm --filter @bsc/api hash-password` (it prompts for the password and prints a `scrypt:...` string; paste it as it is, no quoting or escaping needed). Make the shared password long and random.

## Configuration

All settings are environment variables; see `.env.example` for the full list.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/database`. Required in production. |
| `PUBLIC_ORIGIN` | The public address, e.g. `https://battleships.example.com`. Required in production; used for the cross-site request check. |
| `TRUST_PROXY_HOPS` | How many reverse proxies sit in front of the app. Behind Coolify's proxy: `1`. With `0` the client address is the socket address, which is wrong behind a proxy (all logins would share one rate limit). Never set it higher than the real number: clients could then forge their address. |
| `SHARED_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `ADMIN_USERNAME` | Credentials. Plain-text variants exist for local use only and are refused in production. |
| `MOVE_TIMEOUT_MS`, `PLACE_TIMEOUT_MS`, `GRACE_MS`, `IDLE_EXPIRY_MS`, `MAX_OPEN_LOBBIES`, `MAX_STRIKES` | The platform constants (defaults: 10 s, 10 s, 60 s, 2 h, 10, 3). |

The container applies database migrations on start (`prisma migrate deploy`), then starts the platform on `PORT` (default 3000). `GET /api/health` answers `{"ok":true}` when the database is reachable.

## Coolify checklist

1. Create the MariaDB resource and a persistent volume for its data.
2. Create the application from the repository's `Dockerfile`. Set the variables above. Expose port 3000.
3. **Disable rolling deployments.** Two instances at once would split the games and double-run batteries. A deploy stops the old container, then starts the new one.
4. Check **WebSocket support** through the proxy: `wss://<host>/program/v1` must upgrade (the example programs are a quick test).
5. Check that `TRUST_PROXY_HOPS=1` gives real client addresses: failed logins from two networks must not share a rate limit.
6. Redeploy once and confirm the database volume survives and that the platform comes back with its lobbies. A battery that was running waits for its programs to reconnect.

## Deploying during an event

A restart voids the game in progress and drops every program connection. Batteries keep their results and wait for the programs to reconnect (the resume window applies), so a short deploy between games is invisible apart from a pause. Programs should reconnect on their own: see `docs/program-rules.md`.

## Backups

Everything worth keeping is in the database: participants, rulesets, lobbies, series, games with their event logs, and the audit log. Back it up with the usual MariaDB tools. The raw frame logs (the debugging view) are in memory only and are lost on restart.
