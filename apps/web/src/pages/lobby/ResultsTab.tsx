import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ButtonGroup, Button, Card, Col, Row, Table } from 'react-bootstrap';
import { useApi } from '../../api/context';
import type { LobbySummary, Seat, SeriesInfo } from '../../api/types';
import { ShotsHistogram, WinRateBar } from '../../components/Charts';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { Heatmap } from '../../components/Heatmap';
import { keys } from '../../hooks/queries';
import { percent } from '../../lib/format';
import { SeriesSelect } from './SeriesSelect';

const num = (v: number | null, digits = 1) => (v === null ? '–' : v.toFixed(digits));

export function ResultsTab({
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
  const [heat, setHeat] = useState<'shots' | 'placements'>('shots');
  const report = useQuery({ queryKey: keys.report(lobby.id, seriesId), queryFn: () => api.getSeriesReport(lobby.id, seriesId) });
  if (report.isLoading) return <Loading />;
  const data = report.data;
  const names: [string, string] = [lobby.seats[0].owner.name, lobby.seats[1].owner.name];
  if (!data || data.stats.played === 0) {
    return (
      <>
        <SeriesSelect seriesList={seriesList} value={seriesId} onChange={onSeries} />
        <ErrorAlert error={report.error} />
        <div className="text-center text-body-secondary py-5" data-testid="results-empty">
          No finished games yet. Results appear here once a battery has played.
        </div>
      </>
    );
  }
  const { stats, heatmap, info } = data;
  const verdictText =
    stats.verdict === 'tie'
      ? `Tie: ${stats.seats[1].wins}–${stats.seats[2].wins}`
      : stats.verdict
        ? `${names[stats.verdict - 1]} leads ${Math.max(stats.seats[1].wins, stats.seats[2].wins)}–${Math.min(stats.seats[1].wins, stats.seats[2].wins)}`
        : '';
  const partial = info.status !== 'done';

  return (
    <>
      <SeriesSelect seriesList={seriesList} value={seriesId} onChange={onSeries} />
      <ErrorAlert error={report.error} />
      <Alert variant={stats.significant ? 'success' : 'secondary'} data-testid="verdict">
        <div className="fw-semibold fs-5">
          {verdictText}
          {partial && <span className="badge text-bg-warning text-dark ms-2">{info.status === 'running' ? 'in progress' : 'aborted'}</span>}
        </div>
        <div className="small">
          {stats.played} decided game{stats.played === 1 ? '' : 's'}.{' '}
          {stats.significant
            ? 'The difference is statistically significant: the 95% confidence interval of the win rate excludes 50%.'
            : stats.played < 30
              ? 'Too few games to tell apart luck from skill. Battleship has a lot of luck: play more games.'
              : 'The 95% confidence interval still includes 50%, so this result could be luck.'}
        </div>
      </Alert>

      <Row className="g-3 mb-4">
        <Col lg={6}>
          <WinRateBar label={names[0]} rate={stats.seats[1].winRate} low={stats.seats[1].winRateLow} high={stats.seats[1].winRateHigh} />
        </Col>
        <Col lg={6}>
          <WinRateBar label={names[1]} rate={stats.seats[2].winRate} low={stats.seats[2].winRateLow} high={stats.seats[2].winRateHigh} />
        </Col>
      </Row>

      <Table responsive size="sm" className="mb-4" data-testid="stats-table">
        <thead>
          <tr>
            <th />
            <th>{names[0]}</th>
            <th>{names[1]}</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['Wins', (s: Seat) => String(stats.seats[s].wins)],
              ['Win rate', (s: Seat) => percent(stats.seats[s].winRate, 1)],
              ['Average shots to win', (s: Seat) => num(stats.seats[s].avgShotsToWin)],
              ['Median shots to win', (s: Seat) => num(stats.seats[s].medianShotsToWin, 1)],
              ['Wins when moving first', (s: Seat) => `${stats.seats[s].asFirst.wins} of ${stats.seats[s].asFirst.played}`],
              ['Wins when moving second', (s: Seat) => `${stats.seats[s].asSecond.wins} of ${stats.seats[s].asSecond.played}`],
              ['Games lost by opponent forfeit', (s: Seat) => String(stats.seats[s === 1 ? 2 : 1].forfeits)],
              ['Infractions', (s: Seat) => String(stats.seats[s].infractions)],
              ['Average think time', (s: Seat) => (stats.seats[s].avgThinkMs === null ? '–' : `${stats.seats[s].avgThinkMs!.toFixed(1)} ms`)],
            ] as [string, (s: Seat) => string][]
          ).map(([label, f]) => (
            <tr key={label}>
              <th scope="row" className="fw-normal">
                {label}
              </th>
              <td className="mono">{f(1)}</td>
              <td className="mono">{f(2)}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Card className="mb-4">
        <Card.Body>
          <Card.Title as="h2" className="h6">
            Shots needed in won games
          </Card.Title>
          <ShotsHistogram stats={stats} names={names} />
        </Card.Body>
      </Card>

      <div className="d-flex align-items-center gap-3 mb-2">
        <h2 className="h6 m-0">Heatmaps over {heatmap.games} finished game{heatmap.games === 1 ? '' : 's'}</h2>
        <ButtonGroup size="sm">
          <Button variant={heat === 'shots' ? 'info' : 'outline-secondary'} onClick={() => setHeat('shots')} aria-pressed={heat === 'shots'}>
            Where they shoot
          </Button>
          <Button variant={heat === 'placements' ? 'info' : 'outline-secondary'} onClick={() => setHeat('placements')} aria-pressed={heat === 'placements'}>
            Where they place ships
          </Button>
        </ButtonGroup>
      </div>
      <p className="small text-body-secondary">
        Only finished games are included, so nothing here reveals a game in progress. Use it to scout, then improve your program between lobbies.
      </p>
      <div className="d-flex flex-wrap gap-4">
        {([1, 2] as Seat[]).map((seat) => (
          <Heatmap
            key={seat}
            title={`${names[seat - 1]}: ${heat === 'shots' ? 'shots' : 'ship cells'}`}
            values={heatmap[heat][seat]}
            color={heat === 'shots' ? '52, 152, 219' : '243, 156, 18'}
          />
        ))}
      </div>
    </>
  );
}
