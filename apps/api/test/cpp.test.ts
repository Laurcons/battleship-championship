/* eslint-disable @typescript-eslint/no-explicit-any -- frames are inspected as loose JSON in tests */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { eventually, startTestApp, tokenFor, wait, type TestApp } from './helpers/testApp.js';
import { World } from './helpers/world.js';

/**
 * The C++ shim (examples/cpp): compiled strictly as C++98 with sanitizers, then driven by a scripted
 * platform (exact parsing and framing) and by the real platform (end to end).
 */

const cppDir = join(import.meta.dirname, '../../../examples/cpp');
const probeSource = join(import.meta.dirname, 'fixtures/cpp/probe.cpp');
const haveCompiler = spawnSync('g++', ['--version']).status === 0;

let build: string;
let studentBin: string; // examples/cpp/bot.cpp, exactly as students receive it
let probeBin: string; // the same shim with a bot that prints everything it is given
let noTokenBin: string; // the probe with an empty bsc_token

function compile(out: string, sources: string[], extra: string[] = []): void {
  const flags = ['-std=c++98', '-Wall', '-Wextra', '-pedantic', '-Werror', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', cppDir];
  const r = spawnSync('g++', [...flags, ...extra, '-o', out, ...sources], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`compilation failed:\n${r.stderr}`);
}

beforeAll(() => {
  if (!haveCompiler) return;
  build = mkdtempSync(join(tmpdir(), 'bsc-cpp-'));
  studentBin = join(build, 'student');
  probeBin = join(build, 'probe');
  noTokenBin = join(build, 'notoken');
  compile(studentBin, [join(cppDir, 'bot.cpp'), join(cppDir, 'bsc.cpp')]);
  compile(probeBin, [probeSource, join(cppDir, 'bsc.cpp')]);
  compile(noTokenBin, [probeSource, join(cppDir, 'bsc.cpp')], ['-DPROBE_NO_TOKEN']);
}, 120_000);

afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

// --- running programs --------------------------------------------------------------------------

interface Running {
  out(): string;
  probes(): any[];
  exited: Promise<number | null>;
  stdin(text: string): void;
  kill(): void;
}
const children: ChildProcess[] = [];
const servers: { close(): unknown }[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  for (const s of servers.splice(0)) s.close();
});

function run(bin: string, env: Record<string, string>): Running {
  const child = spawn(bin, [], { env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=0', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  // setEncoding decodes UTF-8 across chunk boundaries (the probe writes unbuffered, byte by byte).
  child.stdout?.setEncoding('utf8').on('data', (d) => (output += d));
  child.stderr?.setEncoding('utf8').on('data', (d) => (output += d));
  return {
    out: () => output,
    // The probe writes byte by byte, so the last line may be half written: only complete lines are read.
    probes: () =>
      output
        .slice(0, output.lastIndexOf('\n') + 1)
        .split('\n')
        .filter((l) => l.startsWith('PROBE '))
        .map((l) => JSON.parse(l.slice(6))),
    exited: new Promise((resolve) => child.on('exit', resolve)),
    stdin: (text) => child.stdin?.write(text),
    kill: () => child.kill('SIGKILL'),
  };
}

const TOKEN = 'bsc_' + 'a'.repeat(32);
const LOBBY = 'K7QM-4XD2-7';
const BACKSLASH = String.fromCharCode(92);

// --- a scripted platform -----------------------------------------------------------------------

class Fake {
  readonly wss: WebSocketServer;
  readonly sockets: WebSocket[] = [];
  readonly frames: any[][] = [];
  readonly pongs: number[] = [];

  private constructor(wss: WebSocketServer) {
    this.wss = wss;
    wss.on('connection', (ws) => {
      const i = this.sockets.push(ws) - 1;
      this.frames[i] = [];
      ws.on('message', (data) => this.frames[i]?.push(JSON.parse(data.toString())));
      ws.on('pong', () => this.pongs.push(i));
    });
  }

  static async start(): Promise<Fake> {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', maxPayload: 1 << 20 });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const fake = new Fake(wss);
    servers.push(wss);
    return fake;
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.wss.address() as { port: number }).port}/program/v1`;
  }

  env(extra: Record<string, string> = {}): Record<string, string> {
    return { BSC_URL: this.url, BSC_TOKEN: TOKEN, BSC_LOBBY: LOBBY, ...extra };
  }

  async connection(i = 0): Promise<WebSocket> {
    return eventually(() => this.sockets[i], 8000, `connection ${i}`);
  }

  async received(count: number, conn = 0): Promise<any[]> {
    return eventually(() => ((this.frames[conn]?.length ?? 0) >= count ? (this.frames[conn] as any[]) : false), 8000, `${count} frames from the program`);
  }

  async send(frame: object | string, conn = 0, options: { fin?: boolean } = {}): Promise<void> {
    const ws = await this.connection(conn);
    ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame), options);
  }
}

const rows = (w: number, h: number, fill = '.') => Array.from({ length: h }, () => fill.repeat(w));
const ruleset = (over: Record<string, unknown> = {}) => ({
  id: 'classic-10x10', width: 10, height: 10, fleet: [5, 4, 3, 3, 2], touching: false, extra_turn_on_hit: true,
  announce_sunk: true, repeat_shot: 'invalid', reveal_on_game_over: true, ...over,
});
const welcome = (over: Record<string, unknown> = {}) => ({
  type: 'welcome', session_id: 's_9b1c', seat: 2, resumed: false, lobby: LOBBY, ruleset: ruleset(),
  limits: { place_ms: 10000, move_ms: 8000, grace_ms: 60000, max_strikes: 3 }, ...over,
});
const game = { id: 'g_1', index: 3, total: 100, first: 'opponent' };
const place = (over: Record<string, unknown> = {}) => ({
  type: 'place', rid: 1, deadline_ms: 10000, game, opponent: { name: 'Alex', program: { name: 'x-bot', version: '1' } }, error: null, strikes: 0, ...over,
});
const turn = (over: Record<string, unknown> = {}) => ({
  type: 'turn', rid: 7, deadline_ms: 9000, game, you: rows(10, 10), enemy: rows(10, 10), enemy_remaining: [5, 4, 3, 3, 2],
  last_shot: null, incoming: [], error: null, strikes: 0, ...over,
});

describe.skipIf(!haveCompiler)('C++ shim against a scripted platform', () => {
  it('compiles as strict C++98 without warnings (done in beforeAll) and says hello correctly', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env({ BSC_RULESET: 'classic-10x10, tiny-8x8', BSC_NAME: 'Jo "the" \\ bot' }));
    const [hello] = await fake.received(1);
    expect(hello).toEqual({
      type: 'hello', token: TOKEN, lobby: LOBBY, accepts: ['classic-10x10', 'tiny-8x8'], program: { name: 'Jo "the" \\ bot', version: 'cpp-shim' },
    });
    p.kill();
  });

  it('reads the welcome frame into the ruleset and limits', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome({ ruleset: ruleset({ id: 'odd-8x6', width: 8, height: 6, fleet: [4, 3, 2], touching: true, extra_turn_on_hit: false, announce_sunk: false, repeat_shot: 'waste', reveal_on_game_over: false }) }));
    await fake.send(place({ rid: 5 }));
    const [place1] = await eventually(() => p.probes().length >= 1 && p.probes(), 8000, 'place probe');
    expect(place1).toMatchObject({
      event: 'place', seat: 2, ruleset: 'odd-8x6', w: 8, h: 6, fleet: [4, 3, 2], touching: 1, extra: 0, announce: 0, waste: 1, reveal_rule: 0,
      place_ms: 10000, move_ms: 8000, max_strikes: 3, game: 3, total: 100, first: 0, opp: 'Alex', opp_prog: 'x-bot', deadline: 10000, strikes: 0, error: '',
    });
    expect(p.out()).toContain('Esti jucatorul 2');
    p.kill();
  });

  it('answers place with a placement echoing the rid exactly, and ships built from the callback', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, { ...fake.env(), PROBE_VERTICAL: '1' });
    await fake.received(1);
    await fake.send(welcome());
    await fake.send('{"type":"place","rid":9007199254740991,"deadline_ms":10000,"game":{"id":"g","index":1,"total":1,"first":"you"},"opponent":{"name":"A","program":null},"error":null,"strikes":0}');
    const frames = await fake.received(2);
    expect(frames[1]).toEqual({
      type: 'placement', rid: 9007199254740991,
      ships: [{ len: 5, x: 9, y: 0, dir: 'v' }, { len: 4, x: 0, y: 2, dir: 'h' }, { len: 3, x: 0, y: 4, dir: 'h' }, { len: 3, x: 0, y: 6, dir: 'h' }, { len: 2, x: 0, y: 8, dir: 'h' }],
    });
    expect(p.probes()[0]).toMatchObject({ first: 1, opp: 'A', opp_prog: '' }); // "program": null
    p.kill();
  });

  it('reads a turn: boards, last shot, incoming shots, remaining ships; replies with fire', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome());
    const you = ['SSSSS.....', '.o........', 'SSSS.o....', '..........', 'SSS..SSS..', '..........', '........xx', '..........', '..........', '.........#'];
    const enemy = ['xxxxx.....', '...o......', '..........', '...x......', '...x......', '..........', '......o...', '..........', '..........', '.........#'];
    await fake.send(turn({ you, enemy, last_shot: { x: 3, y: 4, result: 'sunk', len: 2 }, incoming: [{ x: 1, y: 1, result: 'miss' }, { x: 8, y: 6, result: 'hit' }, { x: 9, y: 6, result: 'sunk', len: 2 }], enemy_remaining: [4, 3], error: { code: 'already_fired', message: 'm' }, strikes: 2 }));
    const frames = await fake.received(2);
    expect(frames[1]).toEqual({ type: 'fire', rid: 7, x: 5, y: 0 }); // the probe fires at the first free cell
    const t = await eventually(() => p.probes().find((e) => e.event === 'turn'), 8000, 'turn probe');
    expect(t).toMatchObject({
      you, enemy, last_x: 3, last_y: 4, last_result: 's', last_len: 2, in_n: 3, in_x: [1, 8, 9], in_y: [1, 6, 6], in_r: 'mhs',
      rem_n: 2, rem: [4, 3], error: 'already_fired', strikes: 2, deadline: 9000,
    });
    expect(p.out()).toContain('Mutare invalida (already_fired)');
    p.kill();
  });

  it('represents "no last shot" and "sunk ships not announced" explicitly', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, { ...fake.env(), PROBE_SHOT: '4,2' });
    await fake.received(1);
    await fake.send(welcome());
    await fake.send(turn({ enemy_remaining: null, last_shot: null }));
    const frames = await fake.received(2);
    expect(frames[1]).toEqual({ type: 'fire', rid: 7, x: 4, y: 2 });
    expect(p.probes()[0]).toMatchObject({ last_x: -1, last_y: -1, last_result: '-', last_len: 0, in_n: 0, rem_n: -1 });
    p.kill();
  });

  it('copes with the biggest frames the platform can send: 20x20 boards and 400 shots each way', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome({ ruleset: ruleset({ id: 'huge', width: 20, height: 20, fleet: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }) }));
    const shots = Array.from({ length: 400 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20), result: ['miss', 'hit', 'sunk', 'repeat'][i % 4], ...(i % 4 === 2 ? { len: 1 + (i % 7) } : {}) }));
    const board = Array.from({ length: 20 }, (_, y) => 'ox.S#'.repeat(5).slice(y % 5, (y % 5) + 20));
    await fake.send(turn({ you: board, enemy: board, incoming: shots }));
    await fake.received(2);
    const t = await eventually(() => p.probes().find((e) => e.event === 'turn'), 8000, 'turn probe');
    expect(t.w).toBe(20);
    expect(t.you).toEqual(board);
    expect(t.enemy).toEqual(board);
    expect(t.in_n).toBe(400);
    expect(t.in_x).toEqual(shots.map((s) => s.x));
    expect(t.in_y).toEqual(shots.map((s) => s.y));
    const letter: Record<string, string> = { miss: 'm', hit: 'h', sunk: 's', repeat: 'r' };
    expect(t.in_r).toBe(shots.map((s) => letter[s.result as string]).join(''));
    const ships = Array.from({ length: 10 }, (_, i) => ({ len: 10 - i, x: i, y: i, dir: i % 2 ? 'v' : 'h' }));
    await fake.send({
      type: 'game_over', game: { id: 'g', index: 3, total: 100 }, winner: 'opponent', reason: 'timeout', last_shot: { x: 1, y: 2, result: 'miss' }, incoming: shots,
      series: { score: { you: 1, opponent: 2 }, done: true }, reveal: { opponent_ships: ships, opponent_shots: shots },
    });
    const over = await eventually(() => p.probes().find((e) => e.event === 'game_over'), 8000, 'game_over probe');
    expect(over).toMatchObject({
      game: 3, total: 100, won: 0, reason: 'timeout', score_me: 1, score_opp: 2, done: 1, last_x: 1, last_y: 2, last_result: 'm', in_n: 400,
      reveal: 1, ships: 10, ship_len: ships.map((s) => s.len), ship_x: ships.map((s) => s.x), ship_y: ships.map((s) => s.y), ship_dir: ships.map((s) => s.dir).join(''),
      shots: 400, shot_x: shots.map((s) => s.x), shot_y: shots.map((s) => s.y),
    });
    p.kill();
  });

  it('reads game_over without reveal, and the three reset reasons', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome());
    await fake.send({ type: 'game_over', game: { id: 'g', index: 1, total: 2 }, winner: 'you', reason: 'sunk', last_shot: { x: 6, y: 6, result: 'sunk', len: 2 }, incoming: [], series: { score: { you: 1, opponent: 0 }, done: false }, reveal: null });
    for (const reason of ['restart_game', 'reset_series', 'series_stopped']) await fake.send({ type: 'reset', reason });
    const probes = await eventually(() => (p.probes().length >= 4 ? p.probes() : false), 8000, 'probes');
    expect(probes[0]).toMatchObject({ event: 'game_over', won: 1, reason: 'sunk', reveal: 0, ships: 0, shots: 0, last_result: 's', last_len: 2, done: 0 });
    expect(probes.slice(1).map((e) => e.reason)).toEqual(['restart_game', 'reset_series', 'series_stopped']);
    expect(p.out()).toContain('AI CASTIGAT');
    p.kill();
  });

  it('resolves JSON escapes and unicode in names, and survives non-BMP characters', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome());
    await fake.send(JSON.stringify(place({ opponent: { name: 'Ștefan', program: { name: 'a"b\\c\nd é 😀' } } })));
    // Escapes spelled out with backslashes, as a JSON encoder that escapes everything would send them.
    const escaped = [BACKSLASH + 'u0041', BACKSLASH + 'u00e9', BACKSLASH + 'u20ac', BACKSLASH + 'ud83d', BACKSLASH + 'ude00', BACKSLASH + '/', BACKSLASH + 't'].join('');
    await fake.send(`{"type":"place","rid":2,"deadline_ms":1,"game":{"id":"g","index":1,"total":1,"first":"you"},"opponent":{"name":"${escaped}","program":null},"error":null,"strikes":0}`);
    const probes = await eventually(() => (p.probes().length >= 2 ? p.probes() : false), 8000, 'probes');
    expect(probes[0]).toMatchObject({ opp: 'Ștefan', opp_prog: 'a"b\\c\nd é 😀' });
    expect(probes[1].opp).toBe('Aé€??/\t');
    p.kill();
  });

  it('reassembles fragmented messages, answers pings, and ignores a message larger than it can hold', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome());
    const text = JSON.stringify(place({ rid: 11 }));
    await fake.send(text.slice(0, 20), 0, { fin: false });
    await fake.send(text.slice(20, 90), 0, { fin: false });
    await fake.send(text.slice(90), 0, { fin: true });
    const frames = await fake.received(2);
    expect(frames[1]).toMatchObject({ type: 'placement', rid: 11 });

    (await fake.connection()).ping(Buffer.from('hi'));
    await eventually(() => fake.pongs.length > 0, 4000, 'pong');

    // 70 000 bytes: a 64-bit length header, over the shim's buffer. It must be skipped, not crash.
    await fake.send(JSON.stringify(place({ rid: 12 })) + ' '.repeat(70_000));
    await fake.send(place({ rid: 13 }));
    const after = await fake.received(3);
    expect(after[2]).toMatchObject({ type: 'placement', rid: 13 });
    expect(after).toHaveLength(3);
    p.kill();
  });

  it('prints platform errors, ignores unreadable and unknown frames, and keeps going', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome());
    await fake.send({ type: 'error', code: 'bad_json', message: 'human readable', fatal: false });
    await fake.send('this is not json');
    await fake.send('{"type":"from_the_future","x":1}');
    await fake.send('{"type":"place","rid":3,');
    await fake.send(place({ rid: 4 }));
    const frames = await fake.received(2);
    expect(frames[1]).toMatchObject({ type: 'placement', rid: 4 });
    expect(p.out()).toContain('Eroare de la platforma (bad_json): human readable');
    expect(p.out()).toContain('necitibil');
    p.kill();
  });

  it('reconnects after a dropped connection, reusing the session id', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, fake.env());
    await fake.received(1);
    await fake.send(welcome({ session_id: 's_keepme' }));
    await eventually(() => p.out().includes('Conectat'), 4000, 'welcome handled');
    (await fake.connection()).terminate();
    const second = await fake.received(1, 1);
    expect(second[0]).toMatchObject({ type: 'hello', session_id: 's_keepme', token: TOKEN });
    await fake.send(welcome({ session_id: 's_keepme', resumed: true }), 1);
    await fake.send(turn({ rid: 21 }), 1);
    const frames = await fake.received(2, 1);
    expect(frames[1]).toMatchObject({ type: 'fire', rid: 21 });
    expect(p.out()).toContain('sesiune reluata');
    p.kill();
  }, 20_000);

  it('reconnects after transient close codes, but gives up on the ones retrying cannot fix', async () => {
    for (const [code, retries] of [[4500, true], [4408, true], [4401, false], [4403, false], [4426, false], [4409, false], [4000, false]] as const) {
      const fake = await Fake.start();
      const p = run(probeBin, fake.env());
      await fake.received(1);
      (await fake.connection()).close(code, 'because');
      if (retries) {
        await fake.received(1, 1); // came back
        p.kill();
      } else {
        expect(await p.exited).toBe(1);
        expect(p.out()).toContain(`cod ${code}`);
        expect(fake.sockets).toHaveLength(1);
      }
      if (code === 4403) expect(p.out()).toContain('Allow ws://');
    }
  }, 40_000);

  it('refuses wss:// with an explanation, without connecting', async () => {
    const p = run(probeBin, { BSC_URL: 'wss://example.org/program/v1', BSC_TOKEN: TOKEN, BSC_LOBBY: LOBBY });
    expect(await p.exited).toBe(1);
    expect(p.out()).toContain('ws://');
    expect(p.out()).toContain('TLS');
  });

  it('explains an HTTPS redirect and does not retry it', async () => {
    const http: Server = createServer((_req, res) => {
      res.writeHead(301, { Location: 'https://example.org/program/v1' });
      res.end();
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    servers.push(http);
    const port = (http.address() as { port: number }).port;
    const p = run(probeBin, { BSC_URL: `ws://127.0.0.1:${port}/program/v1`, BSC_TOKEN: TOKEN, BSC_LOBBY: LOBBY });
    expect(await p.exited).toBe(1);
    expect(p.out()).toContain('301');
    expect(p.out()).toContain('HTTPS');
  });

  it('keeps retrying while the server is down, and connects when it comes up', async () => {
    const fake = await Fake.start();
    const url = fake.url;
    const port = Number(new URL(url).port);
    await new Promise<void>((resolve) => fake.wss.close(() => resolve()));
    const p = run(probeBin, { BSC_URL: url, BSC_TOKEN: TOKEN, BSC_LOBBY: LOBBY });
    await eventually(() => p.out().includes('Nu m-am putut conecta'), 4000, 'first failure');
    const wss = new WebSocketServer({ port, host: '127.0.0.1' });
    servers.push(wss);
    const hello = await new Promise<any>((resolve) => wss.on('connection', (ws) => ws.once('message', (d) => resolve(JSON.parse(d.toString())))));
    expect(hello.type).toBe('hello');
    p.kill();
  }, 20_000);

  it('asks for the lobby code when none is configured, and refuses a missing token', async () => {
    const fake = await Fake.start();
    const p = run(probeBin, { BSC_URL: fake.url });
    p.stdin('abcd-1234-x\n');
    const [hello] = await fake.received(1);
    expect(hello.lobby).toBe('abcd-1234-x');
    p.kill();
    const noToken = run(noTokenBin, { BSC_URL: fake.url, BSC_LOBBY: LOBBY });
    expect(await noToken.exited).toBe(1);
    expect(noToken.out()).toContain('bsc_token');
  });
});

// --- the real platform -------------------------------------------------------------------------

describe.skipIf(!haveCompiler)('C++ shim against the real platform', () => {
  let w: World | null = null;
  let t: TestApp | null = null;
  afterEach(async () => {
    await w?.close();
    await t?.close();
    w = t = null;
  });

  const env = (url: string, token: string, lobby: string, extra: Record<string, string> = {}) => ({
    BSC_URL: `${url.replace('http', 'ws')}/program/v1`, BSC_TOKEN: token, BSC_LOBBY: lobby, ...extra,
  });

  it('the student template plays a whole battery against itself without a single infraction', async () => {
    w = await World.create({ MOVE_TIMEOUT_MS: '5000', PLACE_TIMEOUT_MS: '5000', GRACE_MS: '5000' });
    const lobby = await w.newLobby();
    const a = run(studentBin, env(w.t.url, w.aliceToken, lobby.id));
    const b = run(studentBin, env(w.t.url, w.brunoToken, lobby.id));
    await eventually(async () => (await w?.lobby(lobby.id))?.canStart, 8000, 'both programs connected');
    const done = await w.startAndFinish(lobby.id, 5);
    expect(done.series).toMatchObject({ status: 'done', played: 5 });
    await eventually(() => a.out().match(/Jocul \d\/5/g)?.length === 5 && b.out().match(/Jocul \d\/5/g)?.length === 5, 4000, 'results printed');
    expect(a.out()).toContain('Esti jucatorul 1');
    expect(b.out()).toContain('Esti jucatorul 2');
    expect(a.out()).not.toMatch(/Mutare invalida|Eroare de la platforma/);
    const games = await w.games(done.id);
    expect(games.every((g: any) => g.infractions[1] === 0 && g.infractions[2] === 0 && g.reason === 'sunk')).toBe(true);
    const wins = (out: string) => (out.match(/AI CASTIGAT/g) ?? []).length;
    expect(wins(a.out()) + wins(b.out())).toBe(5);
  }, 60_000);

  it('plays against a practice bot on a ruleset it was not written for (reads the rules from welcome)', async () => {
    w = await World.create({ MOVE_TIMEOUT_MS: '5000', PLACE_TIMEOUT_MS: '5000' });
    const admin = w.t.client();
    await admin.loginAdmin();
    const made = await admin.post('/api/admin/rulesets', {
      id: 'small-8x6', description: 'x', width: 8, height: 6, fleet: [3, 2, 2], touching: true, extraTurnOnHit: false, announceSunk: false, repeatShot: 'waste', revealOnGameOver: false,
    });
    expect(made.status).toBe(201);
    const lobby = (await w.alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'hunt-target' }, rulesetId: 'small-8x6' })).body;
    const a = run(studentBin, env(w.t.url, w.aliceToken, lobby.id, { BSC_RULESET: 'small-8x6' }));
    await eventually(async () => (await w?.lobby(lobby.id))?.canStart, 8000, 'connected');
    const done = await w.startAndFinish(lobby.id, 3);
    expect(done.series).toMatchObject({ status: 'done', played: 3 });
    const games = await w.games(done.id);
    expect(games.every((g: any) => g.infractions[1] === 0)).toBe(true);
    expect(a.out()).toContain('8x6');
  }, 60_000);

  it('tells the student when the ruleset does not match, and when ws:// is not allowed for the account', async () => {
    w = await World.create();
    const lobby = await w.newLobby();
    const wrong = run(studentBin, env(w.t.url, w.aliceToken, lobby.id, { BSC_RULESET: 'something-else' }));
    expect(await wrong.exited).toBe(1);
    expect(wrong.out()).toContain('classic-10x10'); // the platform names the lobby's ruleset
    expect(wrong.out()).toContain('cod 4426');
    const badToken = run(studentBin, env(w.t.url, 'bsc_' + 'z'.repeat(32), lobby.id));
    expect(await badToken.exited).toBe(1);
    expect(badToken.out()).toContain('cod 4401');
    await w.close();
    w = null;

    t = await startTestApp({ names: ['Alice'], secureOnly: true });
    const alice = t.client();
    await alice.loginAs(t.people.Alice as string);
    const token = await tokenFor(alice);
    const own = (await alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'hunt-target' }, rulesetId: 'classic-10x10' })).body;
    const refused = run(studentBin, env(t.url, token, own.id));
    expect(await refused.exited).toBe(1);
    expect(refused.out()).toContain('tls_required');
    expect(refused.out()).toContain('Allow ws://');
  }, 30_000);

  it('survives a game restart, and gives up cleanly when the platform closes its connection for good', async () => {
    w = await World.create({ MOVE_TIMEOUT_MS: '5000', PLACE_TIMEOUT_MS: '5000', GRACE_MS: '8000' });
    const lobby = await w.newLobby();
    const a = run(studentBin, env(w.t.url, w.aliceToken, lobby.id));
    const b = run(studentBin, env(w.t.url, w.brunoToken, lobby.id));
    await eventually(async () => (await w?.lobby(lobby.id))?.canStart, 8000, 'connected');
    await w.start(lobby.id, 30);
    await eventually(() => /Jocul 2\//.test(a.out()), 8000, 'a couple of games played');
    const restarted = await w.alice.post(`/api/lobbies/${lobby.id}/restart-game`);
    expect(restarted.status).toBe(200);
    await eventually(() => a.out().includes('Reset de la platforma (restart_game)') && b.out().includes('Reset de la platforma (restart_game)'), 8000, 'both saw the reset');
    // Replacing Bruno's token drops his connection (code 4000): his program gives up, the battery waits.
    await w.bruno.post('/api/me/token/replace');
    expect(await b.exited).toBe(1);
    expect(b.out()).toContain('cod 4000');
    await wait(100);
    a.kill();
  }, 60_000);
});

// --- the student archive -----------------------------------------------------------------------

const havePython = spawnSync('python3', ['--version']).status === 0;

describe.skipIf(!haveCompiler || !havePython)('student archive (make-zip.py)', () => {
  it('contains the four files with Windows line endings, bakes in the URL, and compiles as unpacked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bsc-zip-'));
    try {
      const zip = join(dir, 'elevi.zip');
      const made = spawnSync('python3', ['-I', join(cppDir, 'make-zip.py'), '--url', 'ws://192.168.1.10:3000/program/v1', '--out', zip], { encoding: 'utf8' });
      expect(made.status, made.stderr).toBe(0);
      const unpack = [
        'import sys, zipfile',
        'z = zipfile.ZipFile(sys.argv[1])',
        'print(",".join(sorted(z.namelist())))',
        'z.extractall(sys.argv[2])',
      ].join('\n');
      const listing = spawnSync('python3', ['-I', '-c', unpack, zip, join(dir, 'out')], { encoding: 'utf8' });
      expect(listing.stdout.trim()).toBe('CITESTE-MA.txt,bot.cpp,bsc.cpp,bsc.h');
      const bot = readFileSync(join(dir, 'out/bot.cpp'), 'utf8');
      expect(bot).toContain('char bsc_url[] = "ws://192.168.1.10:3000/program/v1";');
      expect(bot).toContain('\r\n');
      expect(bot.charCodeAt(0)).toBe(0xfeff); // the BOM keeps Code::Blocks from misreading the Romanian comments
      expect(bot).not.toMatch(/[^\r]\n/);
      // As students will build it: C++98, and a newer standard too.
      for (const std of ['-std=c++98', '-std=c++17']) {
        const built = spawnSync('g++', [std, '-Wall', '-Wextra', '-pedantic', '-Werror', '-o', join(dir, 'bot'), join(dir, 'out/bot.cpp'), join(dir, 'out/bsc.cpp')], { encoding: 'utf8' });
        expect(built.status, built.stderr).toBe(0);
      }
      const bad = spawnSync('python3', ['-I', join(cppDir, 'make-zip.py'), '--url', 'wss://example.org/x', '--out', join(dir, 'bad.zip')], { encoding: 'utf8' });
      expect(bad.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
