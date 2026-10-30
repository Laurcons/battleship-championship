# C++ shim for beginners

A way to take part with nothing but a C++ compiler (aimed at Romanian high-school students using Code::Blocks): no libraries to install, no classes, no `std::string`.

| File | Who edits it | What it is |
|---|---|---|
| `bot.cpp` | the student | Configuration, and the four functions the student writes. **All documentation for the student is here, in Romanian**: every global variable, every function, its parameters and what it must do. |
| `bsc.h` | nobody | The contract: constants, the four function prototypes, the `extern` globals. |
| `bsc.cpp` | nobody | The shim. It owns `main()`. |
| `CITESTE-MA.txt` | nobody | Three-minute instructions for students (Romanian). |
| `make-zip.py` | the organizer | Builds the archive for students. |

## The idea

The platform protocol is request/response with the full state in every `turn` (docs/protocol-v1.md), so the shim can be completely synchronous: read a frame, fill global variables, call a function, send the reply. The student never sees a `rid`, JSON, sockets, pings or reconnection.

```cpp
void on_place_ships(int ship_x[], int ship_y[], char ship_dir[]);  // game start: fill the arrays
void on_my_turn(int &x, int &y);                                   // your turn: set x and y
void on_game_over();                                               // read i_won, opp_ship_*, opp_shot_* ...
void on_reset();                                                   // the platform voided the game
```

Inside `bsc.cpp`, from the bottom up: sockets (Winsock functions are looked up with `LoadLibrary`, so the Code::Blocks project needs no `-lws2_32`), a WebSocket client (handshake, masked text frames, fragmentation, ping/pong, close codes), a small JSON tokenizer (key lookups by dotted path, so frame key order does not matter), the protocol, and a `main()` with reconnection. It is plain C++98 and uses only `stdio`, `stdlib`, `string` and `time`.

Behavior worth knowing:

- **Plain `ws://` only.** There is no TLS. The account must be allowed to use `ws://` (admin page *Participants*, switch *Allow ws://*); otherwise `hello` fails with `tls_required` (close code 4403) and the shim says what to do. A `wss://` URL is refused with an explanation, and so is a proxy that redirects HTTP to HTTPS.
- **Reconnects** after a dropped connection or a platform restart (1 s, doubling to 10 s), reusing the `session_id` so the seat is resumed. It **stops** on errors that retrying cannot fix: bad token or lobby (4401), `ws://` not allowed (4403), wrong ruleset (4426), lobby full (4409), and 4000 (lobby closed, token replaced, or another program took the seat).
- Settings can be overridden with `BSC_URL`, `BSC_TOKEN`, `BSC_LOBBY`, `BSC_RULESET` and `BSC_NAME`, like the other examples (the tests use this). Without a lobby configured, it asks for one on stdin.
- The server's `Sec-WebSocket-Accept` is not verified (it would need SHA-1, and without TLS it protects nothing).
- Frames bigger than 64 KiB are skipped (the platform's largest, a 20x20 game over with 400 shots each way, is about 27 KiB).
- Console messages are in Romanian without diacritics, because the Windows console would garble them. The comments in `bot.cpp` do use diacritics and the file starts with a UTF-8 byte order mark so Code::Blocks reads them correctly.

## Building the archive

```bash
python3 make-zip.py --url ws://192.168.1.10:3000/program/v1 --out elevi.zip
```

The archive holds the four files with Windows line endings. `--url` writes the platform address into `bot.cpp` so students only paste their token. The students unpack it over the pre-made Code::Blocks project; the project needs to compile `bot.cpp` and `bsc.cpp`.

Try it without Code::Blocks: `g++ -std=c++98 -Wall -Wextra -pedantic -o bot bot.cpp bsc.cpp && BSC_LOBBY=... BSC_TOKEN=... ./bot`.

## Tests

`apps/api/test/cpp.test.ts` (part of `pnpm test`; skipped when `g++` or `python3` is missing):

- compiles the shim as `-std=c++98 -Wall -Wextra -pedantic -Werror` with AddressSanitizer and UBSan;
- drives it with a **scripted platform** and a probe program (`apps/api/test/fixtures/cpp/probe.cpp`) that prints every global it was given: hello, welcome, place, turn, game over and reset parsed field by field, 20x20 boards with 400 shots, JSON escapes and non-BMP characters, fragmented frames, ping/pong, an oversized frame, garbage, reconnection with `session_id`, every close code, `wss://`, redirects, a server that is down and comes up;
- runs the unmodified student template against the **real platform**: a 5-game battery against itself with zero infractions, a practice bot on a ruleset it was not written for, wrong ruleset / bad token / `ws://` not allowed, a game restart and a dropped token;
- builds the archive, unpacks it and compiles the result.

## Not verified

The Windows branch (`#ifdef _WIN32`: dynamic loading of `ws2_32.dll`, `SO_RCVTIMEO` with a `DWORD`) has only been checked for syntax against hand-written stand-ins for the Winsock headers, on Linux. It has **not been compiled with MinGW or run on Windows**. Compile and play one game on a Windows machine with the Code::Blocks MinGW before handing it out.
