// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/types';
import { MockServer, memoryPersistence } from '../src/mock/server';

let server: MockServer;

const as = (id: string, name: string) => server.setSession({ role: 'participant', participantId: id, name });
const alice = () => as('p_alice', 'Alice');
const bruno = () => as('p_bruno', 'Bruno');
const dana = () => as('p_dana', 'Dana');
const admin = () => server.setSession({ role: 'admin', username: 'admin' });

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.code : 'other';
  }
};

async function waitFor(check: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  server = new MockServer(memoryPersistence());
  server.setSpeed('instant');
});

afterEach(() => {
  for (const lobby of server.state.lobbies) server.deleteLobbyForTest?.(lobby.id);
});

describe('login', () => {
  it('requires the shared password before names are revealed, and logs in', () => {
    expect(code(() => server.loginParticipant('p_alice'))).toBe('unauthenticated');
    expect(code(() => server.verifySharedPassword('nope'))).toBe('invalid_credentials');
    const names = server.verifySharedPassword('battleship').map((p) => p.name);
    expect(names).toEqual(['Alice', 'Bruno', 'Chen', 'Dana']);
    expect(server.loginParticipant('p_alice')).toMatchObject({ role: 'participant', name: 'Alice' });
  });

  it('rate-limits repeated failures', () => {
    for (let i = 0; i < 5; i++) code(() => server.verifySharedPassword('wrong'));
    expect(code(() => server.verifySharedPassword('battleship'))).toBe('rate_limited');
    expect(code(() => server.loginAdmin('admin', 'admin'))).toBe('rate_limited');
  });

  it('logs the admin in with the right credentials only', () => {
    expect(code(() => server.loginAdmin('admin', 'wrong'))).toBe('invalid_credentials');
    expect(server.loginAdmin('admin', 'admin')).toMatchObject({ role: 'admin' });
  });
});

describe('authorization (IDOR)', () => {
  it('shows each participant only their own lobbies; the admin sees all', () => {
    alice();
    const aliceLobbies = server.listLobbies();
    expect(aliceLobbies.length).toBeGreaterThan(0);
    expect(aliceLobbies.every((l) => l.mySeats.length > 0)).toBe(true);
    const aliceIds = new Set(aliceLobbies.map((l) => l.id));
    admin();
    const all = server.listLobbies();
    expect(all.length).toBeGreaterThan(aliceLobbies.length);
    const foreign = all.find((l) => !aliceIds.has(l.id))!;

    alice();
    expect(code(() => server.getLobby(foreign.id))).toBe('not_found');
    expect(code(() => server.listGames(foreign.id))).toBe('not_found');
    expect(code(() => server.getSeriesReport(foreign.id))).toBe('not_found');
    expect(code(() => server.getFrameLog(foreign.id, 1))).toBe('not_found');
    expect(code(() => server.deleteLobby(foreign.id))).toBe('not_found');
    expect(code(() => server.startSeries(foreign.id, 1))).toBe('not_found');
    expect(code(() => server.restartGame(foreign.id))).toBe('not_found');
    expect(code(() => server.resetSeries(foreign.id))).toBe('not_found');
    expect(code(() => server.subscribeLobby(foreign.id, () => undefined))).toBe('not_found');
    expect(code(() => server.getLobby('NOPE-NOPE-0'))).toBe('not_found');
  });

  it('does not let a participant read a game of a lobby they are not in, even with a valid game id', () => {
    admin();
    const lobbyD = server.listLobbies().find((l) => l.seats[0].owner.name === 'Chen' && l.seats[1].owner.name === 'Dana')!;
    const gameId = server.listGames(lobbyD.id)[0]!.id;
    bruno();
    expect(code(() => server.getGame(lobbyD.id, gameId))).toBe('not_found');
  });

  it("only exposes a seat's frame log to its owner", () => {
    admin();
    const lobbyA = server.listLobbies().find((l) => l.seats[0].owner.name === 'Alice' && l.seats[1].owner.name === 'Bruno')!;
    bruno();
    expect(code(() => server.getFrameLog(lobbyA.id, 1))).toBe('forbidden');
    expect(code(() => server.getFrameLog(lobbyA.id, 2))).toBeNull();
    alice();
    expect(code(() => server.getFrameLog(lobbyA.id, 1))).toBeNull();
  });

  it('keeps admin-only calls away from participants and anonymous users', () => {
    server.logout();
    expect(code(() => server.adminListParticipants())).toBe('unauthenticated');
    expect(code(() => server.listLobbies())).toBe('unauthenticated');
    alice();
    expect(code(() => server.adminListParticipants())).toBe('forbidden');
    expect(code(() => server.adminUpdateSettings({ allowGodMode: false }))).toBe('forbidden');
    expect(code(() => server.adminCreateRuleset({} as never))).toBe('forbidden');
    expect(code(() => server.adminListAuditLog())).toBe('forbidden');
    admin();
    expect(code(() => server.createLobby({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' }))).toBe('forbidden');
  });
});

describe('stop on infraction', () => {
  it('is off by default; when on, the first infraction ends the battery and keeps the game as void', async () => {
    alice();
    const plain = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10' });
    expect(plain.stopOnInfraction).toBe(false);
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10', stopOnInfraction: true });
    expect(lobby.stopOnInfraction).toBe(true);
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2, { brain: 'hunt-target', fault: 'invalid_moves' });
    server.startSeries(lobby.id, 200);
    await waitFor(() => server.getLobby(lobby.id).series?.status === 'aborted');
    const info = server.getLobby(lobby.id).series!;
    expect(info.abortReason).toMatch(/first infraction/);
    expect(info.played).toBeLessThan(200);
    const games = server.listGames(lobby.id);
    expect(games.at(-1)).toMatchObject({ status: 'void' });
    expect(games.at(-1)!.infractions[2]).toBe(1);
    expect(server.getLobby(lobby.id).status).toBe('ready');
  });
});

describe('lobbies and batteries', () => {
  it('creates a lobby, refuses to start before programs connect, then plays a battery', async () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10' });
    expect(lobby.id).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
    expect(lobby.status).toBe('waiting');
    expect(code(() => server.startSeries(lobby.id, 3))).toBe('conflict');
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    expect(server.getLobby(lobby.id)).toMatchObject({ status: 'ready', canStart: true });
    expect(code(() => server.startSeries(lobby.id, 0))).toBe('validation');
    expect(code(() => server.startSeries(lobby.id, 100000))).toBe('validation');
    server.startSeries(lobby.id, 6);
    await waitFor(() => server.getLobby(lobby.id).series?.status === 'done');
    const report = server.getSeriesReport(lobby.id)!;
    expect(report.info.played).toBe(6);
    expect(report.stats.seats[1].wins + report.stats.seats[2].wins).toBe(6);
    const games = server.listGames(lobby.id);
    expect(games.map((g) => g.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(games.map((g) => g.first)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(server.getLobby(lobby.id).status).toBe('ready');
  });

  it('lets the creator choose god mode (on unless they say otherwise), and the opponent gets that choice', () => {
    alice();
    const mk = (godMode?: boolean) => server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10', godMode });
    expect(mk().viewerMode).toBe('god');
    expect(mk(true).viewerMode).toBe('god');
    const restricted = mk(false);
    expect(restricted).toMatchObject({ viewerMode: 'restricted', godMode: false });
    bruno();
    expect(server.getLobby(restricted.id).viewerMode).toBe('restricted');
  });

  it('keeps god mode on against yourself or a practice bot, whatever the choice or policy', () => {
    admin();
    server.adminUpdateSettings({ allowGodMode: false });
    alice();
    const self = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_alice' }, rulesetId: 'classic-10x10', godMode: false });
    const bot = server.createLobby({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10', godMode: false });
    expect(self.viewerMode).toBe('god');
    expect(bot.viewerMode).toBe('god');
  });

  it('refuses god mode between participants while the admin policy forbids it, and only affects new lobbies', () => {
    alice();
    const mk = (godMode?: boolean) => server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10', godMode });
    const before = mk(true);
    admin();
    server.adminUpdateSettings({ allowGodMode: false });
    expect(server.adminListAuditLog()[0]).toMatchObject({ action: 'god_mode_policy_changed', detail: 'not allowed' });
    alice();
    expect(server.getLobby(before.id).viewerMode).toBe('god'); // unchanged
    expect(code(() => mk(true))).toBe('conflict');
    expect(code(() => mk())).toBe('conflict'); // the default is on, so this also asks for god mode
    expect(mk(false).viewerMode).toBe('restricted');
    expect(server.getPlatformInfo().allowGodMode).toBe(false);
    admin();
    server.adminUpdateSettings({ allowGodMode: true });
    alice();
    expect(mk(true).viewerMode).toBe('god');
  });

  it('never changes the mode of an existing lobby', () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10', godMode: false });
    admin();
    server.adminUpdateSettings({ allowGodMode: true });
    server.adminUpdateSettings({ allowGodMode: false });
    expect(server.getLobby(lobby.id).viewerMode).toBe('god'); // admins always see everything
    alice();
    expect(server.getLobby(lobby.id).viewerMode).toBe('restricted');
  });

  it('migrates state saved when the admin setting was a plain "god mode default"', () => {
    const persistence = memoryPersistence();
    const first = new MockServer(persistence);
    const saved = JSON.parse(JSON.stringify(first.state));
    delete saved.settings.allowGodMode;
    saved.settings.godModeDefault = false;
    persistence.save(saved);
    const reloaded = new MockServer(persistence);
    reloaded.setSession({ role: 'participant', participantId: 'p_alice', name: 'Alice' });
    expect(reloaded.getPlatformInfo().allowGodMode).toBe(true);
    expect(JSON.stringify(reloaded.state.settings)).not.toContain('godModeDefault');
  });

  it('enforces the open lobby limit and refuses disabled rulesets', () => {
    alice();
    for (let i = 0; i < 20; i++) {
      const result = code(() => server.createLobby({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' }));
      if (result) {
        expect(result).toBe('conflict');
        break;
      }
    }
    expect(server.listLobbies().filter((l) => l.createdBy.id === 'p_alice' && l.status !== 'expired').length).toBeLessThanOrEqual(10);
    expect(code(() => server.createLobby({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'strict-10x10' }))).toBe('conflict');
  });

  it('handles restart (void the game, keep the count) and reset series (discard results)', async () => {
    alice();
    server.setSpeed('watch');
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_alice' }, rulesetId: 'quick-8x8' });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 5);
    await waitFor(() => server.listGames(lobby.id).some((g) => g.status === 'live'));
    const liveId = server.listGames(lobby.id).find((g) => g.status === 'live')!.id;
    server.restartGame(lobby.id);
    expect(server.listGames(lobby.id).find((g) => g.id === liveId)!.status).toBe('void');
    await waitFor(() => server.listGames(lobby.id).some((g) => g.status === 'live' && g.id !== liveId));
    expect(server.getLobby(lobby.id).series!.played).toBe(0);
    server.resetSeries(lobby.id);
    expect(server.getLobby(lobby.id).series).toBeNull();
    expect(server.listGames(lobby.id)).toEqual([]);
    expect(server.getLobby(lobby.id).status).toBe('ready');
  });

  it('pauses on a disconnect, resumes on reconnect, and aborts when the window expires', async () => {
    alice();
    server.setSpeed('watch');
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_alice' }, rulesetId: 'quick-8x8' });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 5);
    await waitFor(() => server.listGames(lobby.id).some((g) => g.status === 'live'));
    server.disconnectProgram(lobby.id, 2);
    const paused = server.getLobby(lobby.id);
    expect(paused.status).toBe('paused');
    expect(paused.seats[1].connection).toBe('grace');
    const movesBefore = server.listGames(lobby.id).at(-1)!.shots;
    await new Promise((r) => setTimeout(r, 400));
    expect(server.listGames(lobby.id).at(-1)!.shots).toEqual(movesBefore);
    server.connectProgram(lobby.id, 2);
    expect(server.getLobby(lobby.id).status).toBe('running');

    server.disconnectProgram(lobby.id, 1);
    server.state.lobbies.find((l) => l.id === lobby.id)!.seats[0].graceEndsAt = Date.now() - 1;
    await waitFor(() => server.getLobby(lobby.id).series?.status === 'aborted');
    expect(server.getLobby(lobby.id).series!.abortReason).toMatch(/did not reconnect/);
    expect(server.getLobby(lobby.id).status).toBe('waiting');
  });

  it('voids the game in progress and waits for programs after a platform restart', async () => {
    alice();
    server.setSpeed('watch');
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_alice' }, rulesetId: 'quick-8x8' });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 3);
    await waitFor(() => server.listGames(lobby.id).some((g) => g.status === 'live'));
    server.simulateServerRestart();
    const after = server.getLobby(lobby.id);
    expect(after.series!.status).toBe('running');
    expect(after.status).toBe('paused');
    expect(server.listGames(lobby.id).every((g) => g.status !== 'live')).toBe(true);
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    expect(server.getLobby(lobby.id).status).toBe('running');
  });
});

describe('information hiding', () => {
  it('never sends the hidden seat layout to a restricted viewer during a live game', async () => {
    bruno();
    server.setSpeed('watch');
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_dana' }, rulesetId: 'classic-10x10', godMode: false });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 1);
    await waitFor(() => (server.listGames(lobby.id).find((g) => g.status === 'live')?.shots[1] ?? 0) + (server.listGames(lobby.id).find((g) => g.status === 'live')?.shots[2] ?? 0) > 6);
    const gameId = server.listGames(lobby.id).find((g) => g.status === 'live')!.id;
    const secret = server.state.lobbies.find((l) => l.id === lobby.id)!.games.find((g) => g.id === gameId)!.events!;
    const dana1 = secret.find((e) => e.type === 'placed' && e.seat === 2);
    const bruno1 = secret.find((e) => e.type === 'placed' && e.seat === 1);

    // Bruno owns seat 1: sees his own layout, not Dana's
    const asBruno = server.getGame(lobby.id, gameId);
    expect(asBruno.viewerMode).toBe('restricted');
    expect(asBruno.events.find((e) => e.type === 'placed' && e.seat === 1)).toEqual(bruno1);
    expect(asBruno.events.find((e) => e.type === 'placed' && e.seat === 2)).toMatchObject({ ships: null });
    expect(JSON.stringify(asBruno)).not.toContain(JSON.stringify((dana1 as { ships: unknown }).ships));

    dana();
    const asDana = server.getGame(lobby.id, gameId);
    expect(asDana.events.find((e) => e.type === 'placed' && e.seat === 1)).toMatchObject({ ships: null });
    expect(JSON.stringify(asDana)).not.toContain(JSON.stringify((bruno1 as { ships: unknown }).ships));

    admin();
    expect(server.getGame(lobby.id, gameId).viewerMode).toBe('god');
  });

  it('reveals everything once a game is over, even to a restricted viewer', async () => {
    bruno();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_dana' }, rulesetId: 'classic-10x10', godMode: false });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 1);
    await waitFor(() => server.getLobby(lobby.id).series?.status === 'done');
    const game = server.getGame(lobby.id, server.listGames(lobby.id)[0]!.id);
    expect(game.viewerMode).toBe('restricted');
    expect(game.events.filter((e) => e.type === 'placed').every((e) => e.type === 'placed' && e.ships !== null)).toBe(true);
  });

  it('streams the same redaction to subscribers', async () => {
    bruno();
    server.setSpeed('watch');
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_dana' }, rulesetId: 'classic-10x10', godMode: false });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    const updates: string[] = [];
    const unsubscribe = server.subscribeLobby(lobby.id, (u) => updates.push(JSON.stringify(u)));
    server.startSeries(lobby.id, 1);
    await waitFor(() => updates.some((u) => u.includes('"events":[{"type":"placed"')) && updates.length > 4);
    unsubscribe();
    const dana = server.state.lobbies.find((l) => l.id === lobby.id)!.games[0]!.events!.find((e) => e.type === 'placed' && e.seat === 2) as { ships: unknown };
    for (const update of updates) expect(update).not.toContain(JSON.stringify(dana.ships));
  });
});

describe('admin', () => {
  it('never lets the last enabled ruleset be disabled', () => {
    admin();
    const enabled = server.listRulesets().filter((r) => r.enabled).map((r) => r.ruleset.id);
    const keep = enabled.at(-1)!;
    server.adminSetDefaultRuleset(keep);
    for (const id of enabled.filter((x) => x !== keep)) server.adminSetRulesetEnabled(id, false);
    expect(() => server.adminSetRulesetEnabled(keep, false)).toThrow(/At least one ruleset must stay enabled/);
  });

  it('validates new rulesets and keeps ids unique', () => {
    admin();
    const base = server.listRulesets().find((r) => r.ruleset.id === 'classic-10x10')!.ruleset;
    expect(code(() => server.adminCreateRuleset({ ...base, id: 'classic-10x10' }))).toBe('validation');
    expect(code(() => server.adminCreateRuleset({ ...base, id: 'Bad Id' }))).toBe('validation');
    expect(code(() => server.adminCreateRuleset({ ...base, id: 'tiny', width: 2 }))).toBe('validation');
    const created = server.adminCreateRuleset({ ...base, id: 'new-mode', extraTurnOnHit: false });
    expect(created).toMatchObject({ enabled: true, isDefault: false, lobbyCount: 0 }); // creating one does not change the default
  });

  it('manages participants safely', () => {
    admin();
    expect(code(() => server.adminCreateParticipant('Alice'))).toBe('conflict');
    expect(code(() => server.adminCreateParticipant('<script>'))).toBe('validation');
    const eve = server.adminCreateParticipant('Eve');
    expect(server.adminRenameParticipant(eve.id, 'Evelyn').name).toBe('Evelyn');
    expect(code(() => server.adminDeleteParticipant('p_missing'))).toBe('not_found');
    server.adminDeleteParticipant(eve.id);
    expect(server.adminListParticipants().some((p) => p.id === eve.id)).toBe(false);
  });

  it('records sensitive actions in the audit log', () => {
    alice();
    server.replaceToken();
    admin();
    expect(server.adminListAuditLog()[0]).toMatchObject({ actor: 'Alice', action: 'token_replaced' });
  });
});

describe('tokens', () => {
  it('shows only a masked token, returns a new one once when replaced, and disconnects programs', () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' });
    server.connectProgram(lobby.id, 1);
    expect(server.getMyToken()).toMatchObject({ exists: true, replaced: false });
    expect(server.getMyToken().preview).toMatch(/^bsc_••••••••.{4}$/);
    const { token } = server.replaceToken();
    expect(token).toMatch(/^bsc_[A-Za-z0-9]{32}$/);
    expect(server.getMyToken().replaced).toBe(true);
    expect(JSON.stringify(server.getMyToken())).not.toContain(token);
    expect(server.getLobby(lobby.id).seats[0].connection).toBe('disconnected');
  });

  it('starts empty for new participants: nothing is created until they ask', () => {
    admin();
    const eve = server.adminCreateParticipant('Eve');
    expect(eve.tokenCreatedAt).toBeNull();
    expect(server.adminListParticipants().find((p) => p.id === eve.id)!.tokenCreatedAt).toBeNull();
    as(eve.id, 'Eve');
    expect(server.getMyToken()).toEqual({ exists: false, preview: null, createdAt: null, replaced: false, notice: null });
    expect(code(() => server.replaceToken())).toBe('conflict'); // nothing to replace yet

    const { token } = server.createToken();
    expect(token).toMatch(/^bsc_[A-Za-z0-9]{32}$/);
    expect(server.getMyToken()).toMatchObject({ exists: true, replaced: false });
    expect(code(() => server.createToken())).toBe('conflict'); // creation happens once
    admin();
    expect(server.adminListParticipants().find((p) => p.id === eve.id)!.tokenCreatedAt).not.toBeNull();
    expect(server.adminListAuditLog()[0]).toMatchObject({ actor: 'Eve', action: 'token_created' });
  });

  it('refuses to connect a program for a participant who has no token', () => {
    admin();
    const eve = server.adminCreateParticipant('Eve');
    as(eve.id, 'Eve');
    const lobby = server.createLobby({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' });
    expect(code(() => server.connectProgram(lobby.id, 1))).toBe('conflict');
    expect(server.getLobby(lobby.id).seats[0].connection).toBe('disconnected');
    server.createToken();
    expect(code(() => server.connectProgram(lobby.id, 1))).toBeNull();
  });

  it('shows a notice when another session replaced the token, but not for a first creation', () => {
    alice();
    server.simulateTokenReplacedElsewhere('p_alice');
    expect(server.getMyToken().notice).not.toBeNull();
    server.acknowledgeTokenNotice();
    expect(server.getMyToken().notice).toBeNull();

    admin();
    const eve = server.adminCreateParticipant('Eve');
    as(eve.id, 'Eve');
    server.createToken();
    expect(server.getMyToken().notice).toBeNull();
  });

  it('does not let participants read or change each other\'s tokens', () => {
    alice();
    const before = server.getMyToken();
    bruno();
    server.replaceToken();
    alice();
    expect(server.getMyToken()).toEqual(before);
  });
});

describe('frame log', () => {
  it('contains the handshake and game frames that follow the documented protocol', async () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10' });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 1);
    await waitFor(() => server.getLobby(lobby.id).series?.status === 'done');
    const frames = server.getFrameLog(lobby.id, 1);
    const types = frames.map((f) => (JSON.parse(f.text) as { type?: string }).type);
    expect(types.slice(0, 2)).toEqual(['hello', 'welcome']);
    expect(types).toContain('place');
    expect(types).toContain('placement');
    expect(types).toContain('turn');
    expect(types.at(-1)).toBe('game_over');
    expect(frames.map((f) => f.text).join('')).not.toMatch(/bsc_[A-Za-z0-9]{10}/);
  });
});

describe('subscriptions', () => {
  it('refuses a subscription to a lobby the viewer cannot see (the client reports it instead of throwing)', async () => {
    const { createMockApiClient } = await import('../src/mock/MockApiClient');
    admin();
    const lobbyD = server.listLobbies().find((l) => l.seats[0].owner.name === 'Chen')!;
    alice();
    const api = createMockApiClient(server, 0);
    const errors: string[] = [];
    const unsubscribe = api.subscribeLobby(lobbyD.id, () => errors.push('update leaked'), (e) => errors.push(e.message));
    await new Promise((r) => setTimeout(r, 20));
    unsubscribe();
    expect(errors).toEqual(['Lobby not found.']);
  });
});

describe('game list order', () => {
  it('lists games by game number even when several start in the same millisecond', async () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'quick-8x8' });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 30);
    await waitFor(() => server.getLobby(lobby.id).series?.status === 'done');
    const record = server.state.lobbies.find((l) => l.id === lobby.id)!;
    for (const g of record.games) g.startedAt = 1000; // force identical timestamps
    expect(server.listGames(lobby.id).map((g) => g.index)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
});

describe('rulesets as seen by participants', () => {
  it('lists every ruleset, including disabled ones, but hides how many lobbies use each', () => {
    alice();
    const list = server.listRulesets();
    expect(list.map((r) => r.ruleset.id).sort()).toEqual(['classic-10x10', 'classic-10x10-touching', 'quick-8x8', 'strict-10x10']);
    expect(list.find((r) => r.ruleset.id === 'strict-10x10')!.enabled).toBe(false);
    expect(list.every((r) => r.lobbyCount === null)).toBe(true);
    admin();
    expect(server.listRulesets().find((r) => r.ruleset.id === 'classic-10x10')!.lobbyCount).toBeGreaterThan(0);
  });

  it('exposes the platform limits to every logged-in user, and only to them', () => {
    server.logout();
    expect(code(() => server.getPlatformInfo())).toBe('unauthenticated');
    bruno();
    expect(server.getPlatformInfo().limits).toEqual({ moveMs: 10_000, placeMs: 10_000, graceMs: 60_000, maxStrikes: 3, idleExpiryMs: 7_200_000 });
  });

  it('sends the ruleset to programs in the documented wire format', () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'quick-8x8' });
    server.connectProgram(lobby.id, 1);
    const welcome = JSON.parse(server.getFrameLog(lobby.id, 1).find((f) => f.text.includes('"type":"welcome"'))!.text);
    expect(welcome.ruleset).toMatchObject({ id: 'quick-8x8', width: 8, extra_turn_on_hit: false, announce_sunk: true });
    expect(welcome.ruleset).not.toHaveProperty('extraTurnOnHit');
  });
});

describe('default ruleset', () => {
  const ids = () => server.listRulesets().map((r) => r.ruleset.id);
  const defaults = () => server.listRulesets().filter((r) => r.isDefault).map((r) => r.ruleset.id);

  it('starts as classic-10x10 and is not changed by creating newer rulesets', () => {
    admin();
    expect(defaults()).toEqual(['classic-10x10']);
    const base = server.listRulesets().find((r) => r.isDefault)!.ruleset;
    server.adminCreateRuleset({ ...base, id: 'brand-new' });
    expect(defaults()).toEqual(['classic-10x10']);
  });

  it('can be chosen by the admin among enabled rulesets, and the choice is audited', () => {
    admin();
    server.adminSetDefaultRuleset('quick-8x8');
    expect(defaults()).toEqual(['quick-8x8']);
    expect(server.adminListAuditLog()[0]).toMatchObject({ action: 'default_ruleset_changed', target: 'quick-8x8' });
    alice();
    expect(defaults()).toEqual(['quick-8x8']); // participants see the same default
    expect(server.getPlatformInfo()).not.toHaveProperty('defaultRulesetId');
  });

  it('must be enabled, and the default cannot be disabled', () => {
    admin();
    expect(code(() => server.adminSetDefaultRuleset('strict-10x10'))).toBe('conflict'); // disabled
    expect(code(() => server.adminSetDefaultRuleset('nope'))).toBe('not_found');
    expect(code(() => server.adminSetRulesetEnabled('classic-10x10', false))).toBe('conflict'); // it is the default
    server.adminSetDefaultRuleset('quick-8x8');
    expect(code(() => server.adminSetRulesetEnabled('classic-10x10', false))).toBeNull();
    server.adminSetRulesetEnabled('classic-10x10', true);
    expect(defaults()).toEqual(['quick-8x8']); // re-enabling does not steal the default
  });

  it('lists the default first and disabled rulesets last, for everyone', () => {
    admin();
    expect(ids()).toEqual(['classic-10x10', 'classic-10x10-touching', 'quick-8x8', 'strict-10x10']);
    server.adminSetDefaultRuleset('quick-8x8');
    server.adminSetRulesetEnabled('classic-10x10-touching', false);
    // default, then the other enabled ones (newest first), then the disabled ones (newest first)
    const expected = ['quick-8x8', 'classic-10x10', 'strict-10x10', 'classic-10x10-touching'];
    expect(ids()).toEqual(expected);
    alice();
    expect(ids()).toEqual(expected);
  });

  it('is changeable only by the admin', () => {
    alice();
    expect(code(() => server.adminSetDefaultRuleset('quick-8x8'))).toBe('forbidden');
    server.logout();
    expect(code(() => server.adminSetDefaultRuleset('quick-8x8'))).toBe('unauthenticated');
  });

  it('falls back to the newest enabled ruleset for state saved before defaults existed', () => {
    const persistence = memoryPersistence();
    const first = new MockServer(persistence);
    const saved = JSON.parse(JSON.stringify(first.state));
    delete saved.settings.defaultRulesetId;
    persistence.save(saved);
    const reloaded = new MockServer(persistence);
    reloaded.setSession({ role: 'admin', username: 'admin' });
    expect(reloaded.listRulesets().filter((r) => r.isDefault).map((r) => r.ruleset.id)).toEqual(['classic-10x10']);
  });
});

describe('admin: deleting participants and resetting tokens', () => {
  const lobbyIds = () => {
    admin();
    return server.listLobbies().map((l) => l.id);
  };

  it('deletes the lobbies a participant has a seat in, including ones others created', () => {
    bruno();
    const foreign = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_dana' }, rulesetId: 'classic-10x10' });
    dana();
    const own = server.createLobby({ opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' });
    const before = lobbyIds();
    const unrelated = before.filter((id) => id !== foreign.id && id !== own.id);
    expect(before).toEqual(expect.arrayContaining([foreign.id, own.id]));

    admin();
    server.adminDeleteParticipant('p_dana');

    const after = lobbyIds();
    expect(after).not.toContain(foreign.id);
    expect(after).not.toContain(own.id);
    // Dana's seeded lobbies are gone too; nobody else's lobbies are touched.
    for (const l of server.listLobbies()) expect(l.seats.some((s) => s.owner.kind === 'participant' && s.owner.participantId === 'p_dana')).toBe(false);
    expect(after.filter((id) => unrelated.includes(id)).length).toBe(after.length);
    expect(server.adminListParticipants().map((p) => p.name)).not.toContain('Dana');
    const log = server.adminListAuditLog();
    expect(log.some((e) => e.action === 'lobby_deleted' && e.detail === 'with Dana')).toBe(true);
    expect(log.some((e) => e.action === 'participant_deleted' && e.target === 'Dana')).toBe(true);
  });

  it('stops a battery that was running in a deleted lobby', async () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10' });
    server.connectProgram(lobby.id, 1);
    server.connectProgram(lobby.id, 2);
    server.startSeries(lobby.id, 50);
    admin();
    expect(code(() => server.adminDeleteParticipant('p_bruno'))).toBeNull();
    expect(lobbyIds()).not.toContain(lobby.id);
    alice();
    expect(code(() => server.getLobby(lobby.id))).toBe('not_found');
  });

  it('resets a token: gone, programs dropped, owner notified, and a new one can be created', () => {
    alice();
    const lobby = server.createLobby({ opponent: { kind: 'participant', participantId: 'p_bruno' }, rulesetId: 'classic-10x10' });
    server.connectProgram(lobby.id, 1);
    expect(server.getLobby(lobby.id).seats[0].connection).toBe('connected');
    admin();
    const reset = server.adminResetParticipantToken('p_alice');
    expect(reset).toMatchObject({ name: 'Alice', tokenCreatedAt: null });
    expect(server.adminListAuditLog().some((e) => e.action === 'token_reset' && e.target === 'Alice')).toBe(true);

    alice();
    expect(server.getMyToken()).toMatchObject({ exists: false, preview: null, notice: { at: expect.any(Number) } });
    expect(code(() => server.replaceToken())).toBe('conflict');
    expect(server.getLobby(lobby.id).seats[0].connection).toBe('disconnected');
    server.createToken();
    expect(server.getMyToken()).toMatchObject({ exists: true, notice: null });
  });

  it('refuses to reset a token that does not exist, for an unknown participant, and for non-admins', () => {
    admin();
    server.adminCreateParticipant('Eve');
    const eve = server.adminListParticipants().find((p) => p.name === 'Eve');
    expect(code(() => server.adminResetParticipantToken(eve?.id as string))).toBe('conflict');
    expect(code(() => server.adminResetParticipantToken('p_missing'))).toBe('not_found');
    alice();
    expect(code(() => server.adminResetParticipantToken('p_bruno'))).toBe('forbidden');
    server.logout();
    expect(code(() => server.adminResetParticipantToken('p_bruno'))).toBe('unauthenticated');
  });
});
