import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { World } from './helpers/world.js';

/** The downloadable example programs, run for real against a live platform. */

const examples = join(import.meta.dirname, '../../../examples');

let w: World;
const children: ChildProcess[] = [];
beforeEach(async () => {
  w = await World.create({ MOVE_TIMEOUT_MS: '5000', PLACE_TIMEOUT_MS: '5000', GRACE_MS: '5000' });
});
afterEach(async () => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  await w.close();
});

function run(command: string, args: string[], env: Record<string, string>): { out: () => string; exited: Promise<number | null> } {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout?.on('data', (d) => (output += d));
  child.stderr?.on('data', (d) => (output += d));
  return { out: () => output, exited: new Promise((resolve) => child.on('exit', resolve)) };
}

async function playTogether(command: string, args: string[], extraEnv: Record<string, string> = {}) {
  const lobby = await w.newLobby();
  const url = `${w.t.url.replace('http', 'ws')}/program/v1`;
  const env = (token: string) => ({ BSC_URL: url, BSC_TOKEN: token, BSC_LOBBY: lobby.id, ...extraEnv });
  const first = run(command, args, env(w.aliceToken));
  const second = run(command, args, env(w.brunoToken));
  await w.t.client(); // keep the linter honest about the world being used
  const ready = async () => {
    for (let i = 0; i < 200; i++) {
      const l = await w.lobby(lobby.id);
      if (l.canStart) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`programs never connected.\nfirst:\n${first.out()}\nsecond:\n${second.out()}`);
  };
  await ready();
  const done = await w.startAndFinish(lobby.id, 5);
  return { lobby, done, first, second };
}

describe('example programs', () => {
  it('the TypeScript example plays a battery against itself', async () => {
    const { done, first, second } = await playTogether('node', [join(examples, 'typescript/bot.ts')]);
    expect(done.series).toMatchObject({ status: 'done', played: 5 });
    expect(first.out()).toContain('connected as seat 1');
    expect(second.out()).toContain('connected as seat 2');
    expect(first.out().match(/won \(sunk\)/g)).toHaveLength(5);
    expect(first.out()).not.toMatch(/platform error/);
    // They really are valid: no infractions in any game.
    const games = await w.games(done.id);
    expect(games.every((g: { infractions: { 1: number; 2: number } }) => g.infractions[1] === 0 && g.infractions[2] === 0)).toBe(true);
  });

  const python = process.env.EXAMPLE_PYTHON;
  it.skipIf(!python)('the Python example plays a battery against itself (set EXAMPLE_PYTHON to a python with websockets)', async () => {
    const { done, first } = await playTogether(python as string, [join(examples, 'python/bot.py')]);
    expect(done.series).toMatchObject({ status: 'done', played: 5 });
    expect(first.out()).toContain('connected as seat');
    expect(first.out().match(/won \(sunk\)/g)).toHaveLength(5);
  });
});
