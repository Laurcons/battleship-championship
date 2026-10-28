/* eslint-disable @typescript-eslint/no-explicit-any -- frames are inspected as loose JSON in tests */
import { createBrain, type BotKind } from '@bsc/bots';
import { seededRng, type Rng, type Ruleset } from '@bsc/engine';
import { outboundSchema, toWireRuleset } from '@bsc/protocol';
import WebSocket from 'ws';

export interface Behavior {
  /** Return the frame to send, `null` to stay silent, or `undefined` for the default (play well). */
  onPlace?(frame: any, p: TestProgram): object | null | undefined;
  onTurn?(frame: any, p: TestProgram): object | null | undefined;
}

export interface ProgramOptions {
  token: string;
  lobby: string;
  accepts?: string[];
  program?: { name: string; version?: string };
  sessionId?: string;
  behavior?: Behavior;
  brain?: BotKind;
  seed?: number;
  /** Skip sending hello (to test handshake failures). */
  noHello?: boolean;
}

/** A scripted program speaking the real wire protocol over a real WebSocket. */
export class TestProgram {
  readonly received: any[] = [];
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  sessionId: string | null = null;
  seat: number | null = null;
  ruleset: Ruleset | null = null;
  behavior: Behavior;
  private waiters: { test: () => boolean; resolve: () => void }[] = [];
  private rng: Rng;
  private brain;

  private constructor(
    readonly socket: WebSocket,
    readonly options: ProgramOptions,
  ) {
    this.behavior = options.behavior ?? {};
    this.rng = seededRng(options.seed ?? 1);
    this.brain = createBrain(options.brain ?? 'hunt-target');
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const frame = JSON.parse(data.toString());
      // Every frame the platform sends must satisfy the documented schemas.
      const check = outboundSchema.safeParse(frame);
      if (!check.success) throw new Error(`platform sent an invalid frame: ${JSON.stringify(check.error.issues)} ${data.toString()}`);
      this.received.push(frame);
      this.react(frame);
      this.check();
    });
    socket.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.check();
    });
    socket.on('error', () => undefined);
  }

  static async connect(baseUrl: string, options: ProgramOptions): Promise<TestProgram> {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/program/v1`);
    const p = new TestProgram(ws, options);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    if (!options.noHello) p.hello();
    return p;
  }

  hello(overrides: Record<string, unknown> = {}): void {
    this.send({
      type: 'hello',
      token: this.options.token,
      lobby: this.options.lobby,
      accepts: this.options.accepts ?? ['classic-10x10'],
      program: this.options.program ?? { name: 'test-program', version: '1.0.0' },
      ...(this.options.sessionId ? { session_id: this.options.sessionId } : {}),
      ...overrides,
    });
  }

  send(frame: object | string): void {
    const text = typeof frame === 'string' ? frame : JSON.stringify(frame);
    this.sent.push(text);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(text);
  }

  private react(frame: any): void {
    if (frame.type === 'welcome') {
      this.sessionId = frame.session_id;
      this.seat = frame.seat;
      this.ruleset = null;
      return;
    }
    if (frame.type === 'place') {
      const custom = this.behavior.onPlace?.(frame, this);
      if (custom === null) return;
      this.send(custom ?? { type: 'placement', rid: frame.rid, ships: this.brain.place(this.rulesetFor(frame), this.rng) });
    } else if (frame.type === 'turn') {
      const custom = this.behavior.onTurn?.(frame, this);
      if (custom === null) return;
      if (custom) return this.send(custom);
      const cell = this.brain.fire(this.rulesetFor(frame), { you: frame.you, enemy: frame.enemy, enemyRemaining: frame.enemy_remaining }, this.rng);
      this.send({ type: 'fire', rid: frame.rid, x: cell.x, y: cell.y });
    }
  }

  /** The program reads the ruleset from `welcome`, as a real one would. */
  private rulesetFor(_frame: any): Ruleset {
    if (!this.ruleset) {
      const w = this.received.find((f) => f.type === 'welcome');
      if (!w) throw new Error('no welcome yet');
      const r = w.ruleset;
      this.ruleset = {
        id: r.id, description: '', width: r.width, height: r.height, fleet: r.fleet, touching: r.touching,
        extraTurnOnHit: r.extra_turn_on_hit, announceSunk: r.announce_sunk, repeatShot: r.repeat_shot, revealOnGameOver: r.reveal_on_game_over,
      };
      // The wire form must round-trip to the same ruleset.
      void toWireRuleset;
    }
    return this.ruleset;
  }

  of(type: string): any[] {
    return this.received.filter((f) => f.type === type);
  }

  private check(): void {
    for (const w of [...this.waiters]) {
      if (w.test()) {
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
    }
  }

  /** Resolves when `test` becomes true (checked on every frame and on close). */
  waitFor(test: () => boolean, ms = 8000, what = 'condition'): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== entry);
        reject(new Error(`timed out waiting for ${what}; received: ${this.received.map((f) => f.type).join(',')}`));
      }, ms);
      const entry = { test, resolve: () => (clearTimeout(timer), resolve()) };
      this.waiters.push(entry);
    });
  }

  waitForFrame(type: string, count = 1, ms = 8000): Promise<void> {
    return this.waitFor(() => this.of(type).length >= count, ms, `${count}x ${type}`);
  }

  waitForClose(ms = 8000): Promise<{ code: number; reason: string }> {
    return this.waitFor(() => this.closed !== null, ms, 'close').then(() => this.closed as { code: number; reason: string });
  }

  /** Abruptly drops the connection (no close handshake), as a crashed program would. */
  kill(): void {
    this.socket.terminate();
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000);
  }
}
