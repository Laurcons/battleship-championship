/* eslint-disable @typescript-eslint/no-explicit-any -- JSON responses are inspected loosely */
import { expect } from 'vitest';
import { TestProgram, type ProgramOptions } from './program.js';
import { eventually, startTestApp, tokenFor, type Client, type TestApp } from './testApp.js';

/** Alice and Bruno with tokens, fast timeouts, and helpers to create lobbies and run batteries. */
export class World {
  programs: TestProgram[] = [];

  private constructor(
    readonly t: TestApp,
    readonly alice: Client,
    readonly bruno: Client,
    public aliceToken: string,
    public brunoToken: string,
  ) {}

  static async create(env: Record<string, string> = {}): Promise<World> {
    const t = await startTestApp({
      env: { MOVE_TIMEOUT_MS: '400', PLACE_TIMEOUT_MS: '400', GRACE_MS: '600', HELLO_TIMEOUT_MS: '300', ...env },
    });
    const alice = t.client();
    await alice.loginAs(t.people.Alice);
    const bruno = t.client();
    await bruno.loginAs(t.people.Bruno);
    return new World(t, alice, bruno, await tokenFor(alice), await tokenFor(bruno));
  }

  async close(): Promise<void> {
    for (const p of this.programs) p.kill();
    await this.t.close();
  }

  async connect(who: 'alice' | 'bruno', lobby: string, extra: Partial<ProgramOptions> = {}): Promise<TestProgram> {
    const p = await TestProgram.connect(this.t.url, { token: who === 'alice' ? this.aliceToken : this.brunoToken, lobby, ...extra });
    this.programs.push(p);
    return p;
  }

  async newLobby(body: Record<string, unknown> = {}): Promise<any> {
    const r = await this.alice.post('/api/lobbies', {
      opponent: { kind: 'participant', participantId: this.t.people.Bruno },
      rulesetId: 'classic-10x10',
      ...body,
    });
    expect(r.status).toBe(201);
    return r.body;
  }

  /** A lobby with both programs connected and ready to start. */
  async readyLobby(
    lobbyBody: Record<string, unknown> = {},
    a: Partial<ProgramOptions> = { seed: 1 },
    b: Partial<ProgramOptions> = { seed: 2 },
  ): Promise<{ lobby: any; a: TestProgram; b: TestProgram }> {
    const lobby = await this.newLobby(lobbyBody);
    const pa = await this.connect('alice', lobby.id, a);
    const pb = await this.connect('bruno', lobby.id, b);
    await pa.waitForFrame('welcome');
    await pb.waitForFrame('welcome');
    await eventually(async () => (await this.alice.get(`/api/lobbies/${lobby.id}`)).body.status === 'ready', 8000, 'lobby ready');
    return { lobby, a: pa, b: pb };
  }

  async lobby(id: string): Promise<any> {
    return (await this.alice.get(`/api/lobbies/${id}`)).body;
  }

  async start(id: string, games = 1): Promise<void> {
    const started = await this.alice.post(`/api/lobbies/${id}/start`, { games });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
  }

  async untilSeriesEnds(id: string, ms = 20_000): Promise<any> {
    return eventually(async () => {
      const lobby = await this.lobby(id);
      return lobby.series && lobby.series.status !== 'running' ? lobby : false;
    }, ms, 'the series to end');
  }

  async startAndFinish(id: string, games = 1): Promise<any> {
    await this.start(id, games);
    return this.untilSeriesEnds(id);
  }

  async games(id: string): Promise<any[]> {
    return (await this.alice.get(`/api/lobbies/${id}/games`)).body;
  }

  async game(id: string, gameId: string): Promise<any> {
    return (await this.alice.get(`/api/lobbies/${id}/games/${gameId}`)).body;
  }
}
