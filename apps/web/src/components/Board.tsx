import type { CSSProperties } from 'react';

const CELL_LABEL: Record<string, string> = {
  '.': 'water',
  o: 'miss',
  S: 'ship',
  x: 'hit',
  '#': 'sunk ship',
};
const CELL_CLASS: Record<string, string> = {
  '.': '',
  o: 'cell-miss',
  S: 'cell-ship',
  x: 'cell-hit',
  '#': 'cell-sunk',
};
const CELL_SYMBOL: Record<string, string> = { '.': '', o: '•', S: '', x: '✕', '#': '▣' };

export interface BoardProps {
  rows: string[];
  title?: string;
  subtitle?: string;
  highlight?: { x: number; y: number } | null;
  testId?: string;
}

export function Board({ rows, title, subtitle, highlight, testId }: BoardProps) {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const cell = Math.max(16, Math.min(32, Math.floor(380 / Math.max(width, 1))));
  const style = {
    '--cell': `${cell}px`,
    gridTemplateColumns: `auto repeat(${width}, var(--cell))`,
  } as CSSProperties;
  return (
    <figure className="board m-0" data-testid={testId} aria-label={title}>
      {title && <figcaption className="fw-semibold mb-0">{title}</figcaption>}
      {subtitle && <div className="small text-body-secondary mb-1">{subtitle}</div>}
      <div className="board-grid" style={style} role="grid">
        <div />
        {Array.from({ length: width }, (_, x) => (
          <div key={x} className="board-axis" aria-hidden="true">
            {x}
          </div>
        ))}
        {rows.map((row, y) => (
          <div key={y} style={{ display: 'contents' }} role="row">
            <div className="board-axis pe-1" aria-hidden="true">
              {y}
            </div>
            {[...row].map((ch, x) => (
              <div
                key={x}
                role="gridcell"
                className={`cell ${CELL_CLASS[ch] ?? ''} ${highlight && highlight.x === x && highlight.y === y ? 'cell-focus' : ''}`}
                data-cell={`${x},${y}`}
                data-state={CELL_LABEL[ch] ?? ch}
                aria-label={`${x},${y}: ${CELL_LABEL[ch] ?? ch}`}
                title={`(${x},${y}) ${CELL_LABEL[ch] ?? ''}`}
              >
                <span aria-hidden="true">{CELL_SYMBOL[ch] ?? ''}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className="visually-hidden">{`${width} by ${height} board`}</span>
    </figure>
  );
}

export function BoardLegend() {
  return (
    <div className="legend" aria-label="Board legend">
      <span>
        <span className="cell cell-ship" />
        Ship
      </span>
      <span>
        <span className="cell cell-miss">•</span>Miss
      </span>
      <span>
        <span className="cell cell-hit">✕</span>Hit
      </span>
      <span>
        <span className="cell cell-sunk">▣</span>Sunk ship
      </span>
    </div>
  );
}
