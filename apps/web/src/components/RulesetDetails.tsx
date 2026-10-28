import type { Ruleset } from '@bsc/engine';
import { Fragment, type ReactNode } from 'react';

/** The fleet drawn as ship bars, one row per ship. */
export function FleetPreview({ fleet }: { fleet: number[] }) {
  const lens = [...fleet].sort((a, b) => b - a);
  return (
    <span role="img" aria-label={`Fleet: ships of length ${lens.join(', ')}`} className="d-inline-flex flex-column gap-1 align-middle">
      {lens.map((len, i) => (
        <span key={i} className="d-flex gap-1" aria-hidden="true">
          {Array.from({ length: len }, (_, k) => (
            <span key={k} className="cell cell-ship" style={{ width: 14, height: 14 }} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Every setting of a ruleset, in plain words. Used on the new-lobby page, the lobby Rules tab and the docs. */
export function RulesetDetails({ ruleset: r, testId }: { ruleset: Ruleset; testId?: string }) {
  const cells = r.fleet.reduce((a, b) => a + b, 0);
  const rows: [string, ReactNode][] = [
    ['Board', `${r.width}×${r.height}`],
    [
      'Fleet',
      <span key="fleet" className="d-inline-flex align-items-center gap-3">
        <FleetPreview fleet={r.fleet} />
        <span>
          {r.fleet.length} ships ({[...r.fleet].sort((a, b) => b - a).join(', ')}), {cells} cells
        </span>
      </span>,
    ],
    ['Touching', r.touching ? 'Ships may touch' : 'Ships may not touch, not even diagonally'],
    ['After a hit', r.extraTurnOnHit ? 'A hit gives another turn' : 'Turns alternate after every shot'],
    ['Sunk ships', r.announceSunk ? 'Announced, with their length' : 'Not announced: programs only learn hit or miss'],
    ['Repeated shot', r.repeatShot === 'invalid' ? 'An invalid move: it counts as a strike' : 'Wastes the turn (result "repeat")'],
    ['After a game', r.revealOnGameOver ? "Programs are shown the opponent's layout and shots" : 'The opponent layout stays hidden from programs'],
  ];
  return (
    <dl className="ruleset-details" data-testid={testId ?? 'ruleset-details'}>
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
