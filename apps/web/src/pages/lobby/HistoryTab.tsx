import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Col, Form, Row, Table } from 'react-bootstrap';
import { useApi } from '../../api/context';
import type { GameListItem, LobbySummary, SeriesInfo } from '../../api/types';
import { GameStatusBadge } from '../../components/Badges';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { GameViewer } from '../../components/GameViewer';
import { keys } from '../../hooks/queries';
import { formatDuration } from '../../lib/format';
import { seatName } from '../../lib/events';
import { SeriesSelect } from './SeriesSelect';

export function HistoryTab({
  lobby,
  seriesId,
  onSeries,
  seriesList,
}: {
  lobby: LobbySummary;
  seriesId: string | undefined;
  onSeries: (id: string | undefined) => void;
  seriesList: SeriesInfo[];
}) {
  const api = useApi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const games = useQuery({
    queryKey: keys.games(lobby.id, seriesId),
    queryFn: () => api.listGames(lobby.id, seriesId),
  });
  const list = games.data ?? [];
  const visible = list.filter(
    (g) =>
      !onlyProblems ||
      g.infractions[1] + g.infractions[2] > 0 ||
      g.status === 'void' ||
      (g.reason && g.reason !== 'sunk'),
  );
  const effectiveId =
    selectedId && list.some((g) => g.id === selectedId)
      ? selectedId
      : (list.filter((g) => g.status !== 'void').at(-1)?.id ?? null);
  const selectedItem = list.find((g) => g.id === effectiveId);
  const game = useQuery({
    queryKey: keys.game(lobby.id, effectiveId ?? ''),
    queryFn: () => api.getGame(lobby.id, effectiveId as string),
    enabled: !!effectiveId,
    refetchInterval: selectedItem?.status === 'live' ? 500 : false,
  });

  useEffect(() => setSelectedId(null), [seriesId]);

  if (games.isLoading) return <Loading />;
  return (
    <>
      <SeriesSelect seriesList={seriesList} value={seriesId} onChange={onSeries} />
      <ErrorAlert error={games.error} />
      {list.length === 0 ? (
        <div className="text-center text-body-secondary py-5" data-testid="history-empty">
          No games yet.
        </div>
      ) : (
        <Row className="g-4">
          <Col xl={4}>
            <div className="d-flex justify-content-between align-items-center mb-1">
              <span className="small-label">Games ({list.length})</span>
              <Form.Check
                type="switch"
                id="games-problems"
                label="Only games with problems"
                className="small"
                checked={onlyProblems}
                onChange={(e) => setOnlyProblems(e.target.checked)}
              />
            </div>
            <div className="small text-body-secondary mb-1" data-testid="games-legend">
              S1 = {lobby.seats[0].owner.name} · S2 = {lobby.seats[1].owner.name}
            </div>
            <div
              style={{ maxHeight: 560, overflowY: 'auto' }}
              className="border rounded"
              tabIndex={0}
              role="region"
              aria-label="Games in this battery"
            >
              <Table hover size="sm" className="m-0 align-middle" data-testid="games-table">
                <thead className="position-sticky top-0 bg-body">
                  <tr>
                    <th>#</th>
                    <th>Winner</th>
                    <th title="Shots fired by S1 / S2">Shots S1/S2</th>
                    <th title="Infractions (invalid moves, timeouts, malformed frames) recorded against S1 / S2">
                      Issues
                    </th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g) => (
                    <GameRow
                      key={g.id}
                      g={g}
                      lobby={lobby}
                      selected={g.id === effectiveId}
                      onSelect={() => setSelectedId(g.id)}
                    />
                  ))}
                </tbody>
              </Table>
            </div>
          </Col>
          <Col xl={8}>
            {game.isLoading && <Loading />}
            <ErrorAlert error={game.error} />
            {game.data && <GameViewer game={game.data} lobby={lobby} />}
          </Col>
        </Row>
      )}
    </>
  );
}

function GameRow({
  g,
  lobby,
  selected,
  onSelect,
}: {
  g: GameListItem;
  lobby: LobbySummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const problems = g.infractions[1] + g.infractions[2];
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer ${selected ? 'table-active' : ''}`}
      data-testid="game-row"
      aria-selected={selected}
    >
      <td>{g.index}</td>
      <td>
        {g.status === 'over' && g.winner ? (
          <>
            {seatName(lobby, g.winner)}
            {g.reason && g.reason !== 'sunk' && (
              <span className="badge text-bg-warning text-dark ms-1">{g.reason}</span>
            )}
          </>
        ) : (
          <GameStatusBadge status={g.status} />
        )}
      </td>
      <td className="mono small">
        {g.shots[1]}/{g.shots[2]}
      </td>
      <td data-testid="issues-cell">
        {problems > 0 ? (
          <span className="text-warning">
            {([1, 2] as const)
              .filter((seat) => g.infractions[seat] > 0)
              .map((seat) => `S${seat}: ${g.infractions[seat]}`)
              .join(' · ')}
          </span>
        ) : (
          <span className="text-body-secondary">–</span>
        )}
      </td>
      <td className="small text-body-secondary">{formatDuration(g.durationMs)}</td>
    </tr>
  );
}
