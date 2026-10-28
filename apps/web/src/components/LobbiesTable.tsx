import { Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { LobbySummary } from '../api/types';
import { timeAgo } from '../lib/format';
import { LobbyStatusBadge, ViewerModeBadge } from './Badges';

function seriesLine(lobby: LobbySummary): string {
  const s = lobby.series;
  if (!s) return '—';
  const [a, b] = lobby.seats;
  const score = `${s.score[1]}–${s.score[2]}`;
  if (s.status === 'running') return `${s.played}/${s.target} · ${score}`;
  if (s.status === 'aborted') return `aborted at ${s.played}/${s.target} · ${score}`;
  return s.target === 1
    ? `${s.score[1] ? a.owner.name : b.owner.name} won`
    : `${s.target} games · ${score}`;
}

export function LobbiesTable({ lobbies, showCreator = false }: { lobbies: LobbySummary[]; showCreator?: boolean }) {
  return (
    <Table hover responsive className="align-middle" data-testid="lobbies-table">
      <thead>
        <tr>
          <th>Lobby</th>
          <th>Players</th>
          <th>Ruleset</th>
          <th>Status</th>
          <th>Latest battery</th>
          <th>Activity</th>
          <th>View</th>
        </tr>
      </thead>
      <tbody>
        {lobbies.map((l) => (
          <tr key={l.id} data-testid="lobby-row">
            <td>
              <Link to={`/lobbies/${l.id}`} className="mono fw-semibold">
                {l.id}
              </Link>
              {showCreator && <div className="small text-body-secondary">by {l.createdBy.name}</div>}
            </td>
            <td>
              {l.seats[0].owner.name} <span className="text-body-secondary">vs</span> {l.seats[1].owner.name}
            </td>
            <td className="mono small">{l.rulesetId}</td>
            <td>
              <LobbyStatusBadge status={l.status} />
            </td>
            <td className="small">{seriesLine(l)}</td>
            <td className="small text-body-secondary">{timeAgo(l.lastActivityAt)}</td>
            <td>
              <ViewerModeBadge mode={l.viewerMode} godMode={l.godMode} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
