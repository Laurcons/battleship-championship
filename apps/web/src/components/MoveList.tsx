import { useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import type { LobbySummary, ViewEvent } from '../api/types';
import { describeEvent } from '../lib/events';

export function MoveList({
  events,
  lobby,
  selected,
  onSelect,
}: {
  events: ViewEvent[];
  lobby: LobbySummary;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const items = useMemo(
    () => events.map((event, index) => ({ index, event, desc: describeEvent(event, lobby) })),
    [events, lobby],
  );
  const problems = items.filter((i) => i.desc.problem).length;
  // Newest first: new moves appear at the top, where the eye is, and nothing has to scroll.
  const shown = (onlyProblems ? items.filter((i) => i.desc.problem) : items).slice().reverse();

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-1">
        <span className="small-label">Move history ({events.length}), newest first</span>
        <Form.Check
          type="switch"
          id="only-problems"
          label={`Only problems (${problems})`}
          checked={onlyProblems}
          onChange={(e) => setOnlyProblems(e.target.checked)}
          className="small"
        />
      </div>
      <div
        className="move-list border rounded"
        role="listbox"
        aria-label="Move history"
        tabIndex={0}
      >
        {shown.length === 0 && <div className="p-3 text-body-secondary small">No moves yet.</div>}
        {shown.map(({ index, desc, event }) => {
          const ms = 'ms' in event && event.ms !== undefined ? event.ms : null;
          return (
            <div
              key={index}
              role="option"
              aria-selected={index === selected}
              tabIndex={-1}
              className={`move-item ${index === selected ? 'selected' : ''} ${desc.problem ? 'problem' : ''}`}
              data-testid="move-item"
              data-problem={desc.problem}
              data-index={index}
              onClick={() => onSelect(index)}
              title={desc.detail}
            >
              <span className="move-no">{index + 1}</span>
              <i className={`bi bi-${desc.icon}`} aria-hidden="true" />
              <span className="move-text">
                {desc.text}
                {desc.detail && (
                  <span className="d-block small text-body-secondary mono text-break">
                    {desc.detail}
                  </span>
                )}
              </span>
              {ms !== null && (
                <span className="move-ms">
                  {ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
