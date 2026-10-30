/* eslint-disable @typescript-eslint/no-explicit-any -- frames and API responses are inspected as loose JSON in tests */
import { createBrain, type BotKind } from '@bsc/bots';
import { seededRng, type Rng, type Ruleset } from '@bsc/engine';
import { expect, type Browser, type Page } from '@playwright/test';
import WebSocket from 'ws';

export const SHARED_PASSWORD = 'e2e shared password';
export const ADMIN = { username: 'admin', password: 'e2e admin password' };
const BASE = 'http://127.0.0.1:3100';

export const uid = () => Math.random().toString(36).slice(2, 6);

// --- the admin API, to set up people without clicking through the UI every time ---------------

export class AdminApi {
  private cookie = '';

  static async login(): Promise<AdminApi> {
    const api = new AdminApi();
    const res = await fetch(`${BASE}/api/auth/admin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify(ADMIN),
    });
    expect(res.status).toBe(200);
    api.cookie = (res.headers.getSetCookie()[0] as string).split(';')[0] as string;
    return api;
  }

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async person(prefix: string): Promise<string> {
    const name = `${prefix}${uid()}`;
    const created = await this.call('POST', '/api/admin/participants', { name });
    // The programs below speak plain ws://, which accounts forbid by default.
    await this.call('PATCH', `/api/admin/participants/${created.id}`, { allowInsecure: true });
    return name;
  }
}

// --- UI helpers -------------------------------------------------------------------------------

export async function loginAs(page: Page, name: string) {
  await page.goto('/login');
  await page.getByLabel('Shared password').fill(SHARED_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your name').selectOption({ label: name });
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByTestId('current-user')).toContainText(name);
}

export async function loginAsAdmin(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('current-user')).toContainText('Admin');
}

/** A new browser context, logged in as `name`. */
export async function personPage(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await loginAs(page, name);
  return page;
}

/** Creates the participant's token on the Account page, as they would, and returns it. */
export async function createToken(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Create my token' }).click();
  const token = (await page.getByTestId('new-token').locator('pre').textContent()) as string;
  expect(token).toMatch(/^bsc_[A-Za-z0-9]{32}$/);
  await page.getByRole('button', { name: 'I have saved it' }).click();
  return token;
}

export async function createLobby(page: Page, opponent: string, options: { ruleset?: string; godMode?: boolean } = {}): Promise<string> {
  await page.goto('/lobbies/new');
  // A participant is picked by name; a practice bot by its value, e.g. "bot:hunt-target".
  await page.getByLabel('Opponent').selectOption(opponent.startsWith('bot:') ? opponent : { label: opponent });
  if (options.ruleset) await page.getByLabel('Ruleset').selectOption(options.ruleset);
  if (options.godMode === false) await page.getByLabel('Show both fleets live (god mode)').uncheck();
  await page.getByRole('button', { name: 'Create lobby' }).click();
  await expect(page.getByTestId('lobby-id')).toBeVisible();
  return ((await page.getByTestId('lobby-id').textContent()) as string).trim();
}

export async function startBattery(page: Page, games: number) {
  await page.getByRole('button', { name: /^Start/ }).click();
  await page.getByLabel('Number of games').fill(String(games));
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
}

// --- a real program: a WebSocket client speaking the documented protocol ----------------------

export interface ProgramOptions {
  token: string;
  lobby: string;
  seed?: number;
  brain?: BotKind;
  /** Delay before each reply, so a game can be watched while it is live. */
  delayMs?: number;
  /** Return true to take over a turn (the default reply is then skipped). */
  onTurn?: (frame: any, send: (frame: object) => void) => boolean;
  program?: { name: string; version: string };
}

export class Program {
  readonly frames: any[] = [];
  closeCode: number | null = null;
  private rng: Rng;
  private ruleset: Ruleset | null = null;
  private brain;

  private constructor(
    private readonly ws: WebSocket,
    private readonly options: ProgramOptions,
  ) {
    this.rng = seededRng(options.seed ?? 1);
    this.brain = createBrain(options.brain ?? 'hunt-target');
    ws.on('message', (data) => this.onMessage(JSON.parse(data.toString())));
    ws.on('close', (code) => (this.closeCode = code));
    ws.on('error', () => undefined);
  }

  static async connect(options: ProgramOptions): Promise<Program> {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/program/v1`);
    const program = new Program(ws, options);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.send(
      JSON.stringify({
        type: 'hello',
        token: options.token,
        lobby: options.lobby,
        accepts: ['classic-10x10'],
        program: options.program ?? { name: 'e2e-bot', version: '1.0' },
      }),
    );
    return program;
  }

  private reply(frame: object) {
    const send = () => this.ws.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify(frame));
    if (this.options.delayMs) setTimeout(send, this.options.delayMs);
    else send();
  }

  private onMessage(frame: any) {
    this.frames.push(frame);
    if (frame.type === 'welcome') {
      const r = frame.ruleset;
      this.ruleset = {
        id: r.id, description: '', width: r.width, height: r.height, fleet: r.fleet, touching: r.touching,
        extraTurnOnHit: r.extra_turn_on_hit, announceSunk: r.announce_sunk, repeatShot: r.repeat_shot, revealOnGameOver: r.reveal_on_game_over,
      };
    } else if (frame.type === 'place' && this.ruleset) {
      this.reply({ type: 'placement', rid: frame.rid, ships: this.brain.place(this.ruleset, this.rng) });
    } else if (frame.type === 'turn' && this.ruleset) {
      if (this.options.onTurn?.(frame, (f) => this.ws.send(JSON.stringify(f)))) return;
      const cell = this.brain.fire(this.ruleset, { you: frame.you, enemy: frame.enemy, enemyRemaining: frame.enemy_remaining }, this.rng);
      this.reply({ type: 'fire', rid: frame.rid, x: cell.x, y: cell.y });
    }
  }

  of(type: string): any[] {
    return this.frames.filter((f) => f.type === type);
  }

  async waitForClose(): Promise<number> {
    await expect.poll(() => this.closeCode, { timeout: 10_000 }).not.toBeNull();
    return this.closeCode as number;
  }

  kill() {
    this.ws.terminate();
  }
}
