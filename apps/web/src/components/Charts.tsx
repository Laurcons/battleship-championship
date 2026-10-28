import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriesStats } from '../api/types';
import { percent } from '../lib/format';

/** Win rate with its 95% confidence interval, drawn against the 50% line. */
export function WinRateBar({ rate, low, high, label }: { rate: number; low: number; high: number; label: string }) {
  return (
    <div>
      <div className="d-flex justify-content-between small mb-1">
        <span>{label}</span>
        <span className="mono">
          {percent(rate)} <span className="text-body-secondary">(95% CI {percent(low)}–{percent(high)})</span>
        </span>
      </div>
      <div className="ci-track" role="img" aria-label={`${label}: ${percent(rate)}, 95% confidence interval ${percent(low)} to ${percent(high)}`}>
        <div className="ci-mid" />
        <div className="ci-range" style={{ left: `${low * 100}%`, width: `${(high - low) * 100}%` }} />
        <div className="ci-point" style={{ left: `calc(${rate * 100}% - 1px)` }} />
      </div>
    </div>
  );
}

export function ShotsHistogram({ stats, names }: { stats: SeriesStats; names: [string, string] }) {
  const h1 = stats.seats[1].shotsHistogram;
  const h2 = stats.seats[2].shotsHistogram;
  const nonZero = h1.map((v, i) => (v || h2[i] ? i : -1)).filter((i) => i >= 0);
  if (nonZero.length === 0) return <p className="text-body-secondary small">No completed games yet.</p>;
  const lo = Math.max(0, (nonZero[0] as number) - 2);
  const hi = (nonZero.at(-1) as number) + 2;
  // Bucket by 5 shots to keep the chart readable.
  const data: { shots: string; a: number; b: number }[] = [];
  for (let start = lo - (lo % 5); start <= hi; start += 5) {
    let a = 0;
    let b = 0;
    for (let n = start; n < start + 5; n++) {
      a += h1[n] ?? 0;
      b += h2[n] ?? 0;
    }
    data.push({ shots: `${start}–${start + 4}`, a, b });
  }
  return (
    <div style={{ width: '100%', height: 260 }} role="img" aria-label="Histogram of shots needed per won game">
      <ResponsiveContainer initialDimension={{ width: 600, height: 260 }}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#444" />
          <XAxis dataKey="shots" stroke="#adb5bd" tick={{ fontSize: 11 }} label={{ value: 'shots in won games', position: 'insideBottom', offset: -4, fill: '#adb5bd', fontSize: 11 }} height={40} />
          <YAxis allowDecimals={false} stroke="#adb5bd" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ background: '#303030', border: '1px solid #444' }} />
          <Legend />
          <Bar dataKey="a" name={names[0]} fill="#3498db" />
          <Bar dataKey="b" name={names[1]} fill="#f39c12" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
