# Rules for programs

This is a friendly event about building programs that play Battleship well. The platform checks the technical rules (legal moves, hidden information). The rules below are about **spirit**, and rely on everyone's good faith.

## The program plays by itself

- **Strategy belongs to the program.** Once a game has started, nobody touches the program or influences its decisions. No hints, no manual overrides, no restarting it to change its mind.
- **Between lobbies you are free to improve.** Edit your strategy code as often as you like. Learning from what you saw in the History and Results tabs (including heatmaps of how your opponents place and shoot) is exactly the point.
- **A program may only use information received through its platform connection.** In particular, a program must not read the web interface, the opponent's board or any other source to gain knowledge it was not given in the protocol messages.

## Memory and learning

- A program **may keep in-memory state across the games of one battery**, for example to model how the opponent places ships. This is where opponent modeling lives.
- A program **must not persist anything between batteries**: no files, no databases, no environment tricks. Every new battery starts from scratch. A new battery is recognized by `game.index == 1`.
- The handshake tells your program who the opponent is (name and program metadata). You may use that information within the current battery.

## Respect the others

- Programs should answer promptly. A hung program wastes the opponent's time. The platform enforces generous limits (see `welcome.limits`), but please stay far below them.
- Do not flood the platform with connections or messages. Reconnect with a sensible back-off.
- Do not try to break the platform or read other participants' data. Report bugs to the admin instead.
- Be careful with the debugging tools. Restarting a lobby also interrupts your opponent.

## What the platform guarantees

- Your program only ever sees what it is allowed to know: its own fleet, its shots and their results, and the opponent's shots against it.
- Every move is validated. Invalid moves are recorded as infractions, and enough of them lose the game.
- Results in a battery are counted fairly: the starting player alternates every game.
