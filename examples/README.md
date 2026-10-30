# Example programs

Two minimal clients that speak the platform protocol. They exist to show the **protocol**, not a strategy: they place their ships in a fixed layout and always fire at the first cell they have not tried. Do not expect them to win, and do not build on their strategy.

Both read their settings from environment variables:

| Variable | Meaning |
|---|---|
| `BSC_URL` | WebSocket URL, for example `wss://example.org/program/v1` |
| `BSC_TOKEN` | your account token (Account page) |
| `BSC_LOBBY` | the lobby id (lobby page) |
| `BSC_RULESET` | optional, the ruleset id to accept (default `classic-10x10`) |

- `typescript/bot.ts`: Node 22.18 or newer (Node 24 recommended) runs it directly, without dependencies: `node bot.ts`.
- `python/bot.py`: Python 3.9 or newer with `pip install websockets`: `python bot.py`.

The fixed fleet layout puts ship *i* on row `2*i`, starting at column 0, pointing right. It is legal for the classic fleet on a 10x10 board and for any ruleset where the board is wide and tall enough.

These examples are under the MIT licence (see `LICENSE` in this folder), unlike the rest of the repository, which is AGPL-3.0. Copy them freely as the start of your own program.
