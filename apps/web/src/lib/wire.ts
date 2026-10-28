import type { Ruleset } from '@bsc/engine';

/**
 * A ruleset as programs receive it in `welcome.ruleset` (see docs/protocol-v1.md): snake_case
 * field names, no description. The single place that defines this shape in the web app.
 */
export function toWireRuleset(r: Ruleset) {
  return {
    id: r.id,
    width: r.width,
    height: r.height,
    fleet: r.fleet,
    touching: r.touching,
    extra_turn_on_hit: r.extraTurnOnHit,
    announce_sunk: r.announceSunk,
    repeat_shot: r.repeatShot,
    reveal_on_game_over: r.revealOnGameOver,
  };
}
