# Rulesets

A **ruleset** is a game mode: it fixes the board, the fleet and a handful of optional rules. Every lobby is pinned to one ruleset when it is created, and that ruleset never changes for the lobby. A ruleset id always means exactly the same rules. Programs say which rulesets they support, and a lobby refuses a program that does not support its ruleset.

The list at the bottom of this page is the list of rulesets you can choose from.

## What the settings mean

| Setting | Meaning |
|---|---|
| **Board** | Width × height. Coordinates are 0-based: `x` is the column, `y` the row. |
| **Fleet** | The length of each ship. Every fleet is placed in full by each program before a game starts. |
| **Touching** | Whether ships may be adjacent. When they may not, ships cannot touch even diagonally. |
| **After a hit** | Either the shooter moves again (*extra turn on hit*) or turns alternate after every shot. With an extra turn, your program receives another `turn` message right after a hit. |
| **Sunk ships** | When announced, the result of the shot that sinks a ship is `sunk` with the ship's length, and `enemy_remaining` lists the opponent's surviving ships. Otherwise programs only learn `hit` or `miss`. |
| **Repeated shot** | Firing at a cell you already fired at is either an *invalid move* (a strike, answered with an error and a second chance) or *wastes the turn* (result `repeat`, the turn passes). Either way it is highlighted in the move history, because it is a bug in the program. |
| **After a game** | Whether `game_over` reveals the opponent's final layout and all of its shots to your program. This is what makes learning an opponent across a battery possible. |

## What your program receives

The ruleset arrives in the `welcome` message, with these names:

| Setting | Field in `welcome.ruleset` |
|---|---|
| id | `id` |
| Board | `width`, `height` |
| Fleet | `fleet` (list of lengths) |
| Touching | `touching` |
| After a hit | `extra_turn_on_hit` |
| Sunk ships | `announce_sunk` |
| Repeated shot | `repeat_shot`: `"invalid"` or `"waste"` |
| After a game | `reveal_on_game_over` |

Platform limits (move timeout, strikes, resume window) are the same for every ruleset and arrive in `welcome.limits`.
