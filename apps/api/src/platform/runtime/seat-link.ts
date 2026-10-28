import { createBrain, type BotKind } from '@bsc/bots';
import { seededRng, type Rng, type Ruleset, type SeatView } from '@bsc/engine';

/** The connection to one seat's program: a WebSocket, or a built-in practice bot. */
export interface SeatLink {
  readonly kind: 'ws' | 'bot';
  /** Sends one already-serialized protocol frame. */
  send(text: string): void;
  close(code: number, reason: string): void;
}

/**
 * A practice bot. It goes through exactly the same path as a real program: it is sent `place` and
 * `turn` frames and answers with `placement` and `fire` frames, which the platform parses and
 * validates like any other.
 */
export class BotLink implements SeatLink {
  readonly kind = 'bot' as const;
  private closed = false;
  private readonly rng: Rng = seededRng(Math.floor(Math.random() * 2 ** 31));

  constructor(
    private readonly bot: BotKind,
    private readonly ruleset: Ruleset,
    /** Delivers a reply to the platform, as a program would over the wire. */
    private readonly reply: (text: string) => void,
  ) {}

  send(text: string): void {
    if (this.closed) return;
    const frame = JSON.parse(text) as { type: string; rid?: number; you?: string[]; enemy?: string[]; enemy_remaining?: number[] | null };
    const brain = createBrain(this.bot);
    let answer: object | null = null;
    if (frame.type === 'place') {
      answer = { type: 'placement', rid: frame.rid, ships: brain.place(this.ruleset, this.rng) };
    } else if (frame.type === 'turn') {
      const view: SeatView = { you: frame.you ?? [], enemy: frame.enemy ?? [], enemyRemaining: frame.enemy_remaining ?? null };
      const cell = brain.fire(this.ruleset, view, this.rng);
      answer = { type: 'fire', rid: frame.rid, x: cell.x, y: cell.y };
    }
    if (!answer) return;
    const body = JSON.stringify(answer);
    // Yield to the event loop between moves so a long battery never starves other requests.
    setImmediate(() => {
      if (!this.closed) this.reply(body);
    });
  }

  close(): void {
    this.closed = true;
  }
}

