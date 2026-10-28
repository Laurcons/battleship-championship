import type { CSSProperties } from 'react';

const SURFACE = [34, 34, 34]; // Darkly's body background (#222), under the translucent cell color

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (rgb: number[]) => 0.2126 * channel(rgb[0] as number) + 0.7152 * channel(rgb[1] as number) + 0.0722 * channel(rgb[2] as number);

/** Black or white, whichever reads better on the given background. */
function readableOn(rgb: number[]): string {
  const l = luminance(rgb);
  return (1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#fff' : '#000');
}

export function Heatmap({ values, title, color = '52, 152, 219' }: { values: number[][]; title: string; color?: string }) {
  const width = values[0]?.length ?? 0;
  const max = Math.max(1, ...values.flat());
  const cell = Math.max(14, Math.min(26, Math.floor(300 / Math.max(width, 1))));
  const style = { '--cell': `${cell}px`, gridTemplateColumns: `repeat(${width}, var(--cell))` } as CSSProperties;
  const base = color.split(',').map((n) => Number(n.trim()));
  return (
    <figure className="m-0" data-testid="heatmap">
      <figcaption className="small fw-semibold mb-1">{title}</figcaption>
      <div className="heatmap" style={style} role="img" aria-label={`${title}: ${values.flat().reduce((a, b) => a + b, 0)} events in total`}>
        {values.map((row, y) =>
          row.map((n, x) => {
            const alpha = n === 0 ? 0 : 0.15 + 0.85 * (n / max);
            const blended = base.map((c, i) => Math.round(alpha * c + (1 - alpha) * (SURFACE[i] as number)));
            return (
              <div
                key={`${x},${y}`}
                className="heat-cell"
                title={`(${x},${y}): ${n}`}
                style={{
                  background: n === 0 ? 'var(--bs-tertiary-bg)' : `rgba(${color}, ${alpha})`,
                  color: n === 0 ? undefined : readableOn(blended),
                }}
              >
                {width <= 10 && n > 0 ? n : ''}
              </div>
            );
          }),
        )}
      </div>
    </figure>
  );
}
