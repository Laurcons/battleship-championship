"""Minimal Battleships program. It demonstrates the protocol only: the fleet layout is fixed and
the "strategy" is to fire at the first cell not tried yet.

    pip install websockets
    BSC_URL=wss://host/program/v1 BSC_TOKEN=bsc_... BSC_LOBBY=K7QM-4XD2-7 python bot.py
"""
import asyncio
import json
import os

import websockets

URL = os.environ.get("BSC_URL", "ws://localhost:3000/program/v1")
TOKEN = os.environ["BSC_TOKEN"]
LOBBY = os.environ["BSC_LOBBY"]
RULESET = os.environ.get("BSC_RULESET", "classic-10x10")


async def main() -> None:
    fleet: list[int] = []
    async with websockets.connect(URL) as socket:
        await socket.send(json.dumps({
            "type": "hello",
            "token": TOKEN,
            "lobby": LOBBY,
            "accepts": [RULESET],
            "program": {"name": "example-py", "version": "1"},
        }))
        async for raw in socket:
            message = json.loads(raw)
            kind = message["type"]
            if kind == "welcome":
                fleet = message["ruleset"]["fleet"]
                print("connected as seat", message["seat"], "(resumed)" if message["resumed"] else "")
            elif kind == "place":
                # New game. Forget everything about the previous one here.
                ships = [{"len": n, "x": 0, "y": i * 2, "dir": "h"} for i, n in enumerate(fleet)]
                await socket.send(json.dumps({"type": "placement", "rid": message["rid"], "ships": ships}))
            elif kind == "turn":
                # `enemy` is a list of row strings: '.' means "not shot yet".
                y = next(i for i, row in enumerate(message["enemy"]) if "." in row)
                x = message["enemy"][y].index(".")
                await socket.send(json.dumps({"type": "fire", "rid": message["rid"], "x": x, "y": y}))
            elif kind == "game_over":
                game = message["game"]
                print(f"game {game['index']}/{game['total']}: {message['winner']} won ({message['reason']})")
            elif kind == "reset":
                # The lobby was restarted. Drop the current game; the next `place` starts a new one.
                print("reset:", message["reason"])
            elif kind == "error":
                print("platform error:", message["code"], message["message"])


if __name__ == "__main__":
    asyncio.run(main())
