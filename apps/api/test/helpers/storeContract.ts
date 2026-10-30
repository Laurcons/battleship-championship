import { CLASSIC_10X10, emptyHeatmap, type GameEvent } from '@bsc/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionRow, GameRow, LobbyRow, ParticipantRow, SeriesRow, Store } from '../../src/store/store.js';

const participant = (over: Partial<ParticipantRow> = {}): ParticipantRow => ({
  id: 'p_1',
  name: 'Alice',
  tokenHash: null,
  tokenPreview: null,
  tokenCreatedAt: null,
  tokenReplaced: false,
  tokenNoticeAt: null,
  allowInsecure: false,
  activityReviewedAt: 0,
  createdAt: 1_000,
  ...over,
});

const connection = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: 'c_1',
  participantId: 'p_1',
  kind: 'connected',
  at: 10_000,
  endedAt: null,
  endReason: null,
  ip: '84.1.1.1',
  secure: true,
  programName: 'bot',
  programVersion: '1.0',
  lobbyId: 'K7QM-4XD2-7',
  seat: 1,
  takeoverIp: null,
  ...over,
});

const lobby = (over: Partial<LobbyRow> = {}): LobbyRow => ({
  id: 'K7QM-4XD2-7',
  rulesetId: 'classic-10x10',
  godMode: true,
  stopOnInfraction: false,
  createdBy: 'p_1',
  seats: [
    { kind: 'participant', participantId: 'p_1' },
    { kind: 'bot', bot: 'random' },
  ],
  createdAt: 2_000,
  lastActivityAt: 2_500,
  ...over,
});

const series = (over: Partial<SeriesRow> = {}): SeriesRow => ({
  id: 's_1',
  lobbyId: 'K7QM-4XD2-7',
  target: 3,
  played: 0,
  score: { 1: 0, 2: 0 },
  status: 'running',
  abortReason: null,
  startedAt: 3_000,
  endedAt: null,
  heatmap: emptyHeatmap(CLASSIC_10X10),
  ...over,
});

const events: GameEvent[] = [
  { type: 'placed', seat: 1, ships: [{ len: 5, x: 0, y: 0, dir: 'h' }], ms: 3 },
  { type: 'shot', seat: 1, x: 1, y: 1, result: 'miss', ms: 2 },
  { type: 'infraction', seat: 2, code: 'out_of_bounds', message: 'é "quoted"  text', strikes: 1, raw: '{"x":99}' },
];

const game = (over: Partial<GameRow> = {}): GameRow => ({
  id: 'g_1',
  lobbyId: 'K7QM-4XD2-7',
  seriesId: 's_1',
  index: 1,
  first: 1,
  status: 'over',
  winner: 1,
  reason: 'sunk',
  startedAt: 4_000,
  endedAt: 4_900,
  shots: { 1: 17, 2: 12 },
  infractions: { 1: 0, 2: 1 },
  events,
  times: [4_001, 4_002, 4_003],
  summary: { index: 1, winner: 1, reason: 'sunk', first: 1, shots: { 1: 17, 2: 12 }, infractions: { 1: 0, 2: 1 }, thinkMs: { 1: [3], 2: [2] } } as never,
  ...over,
});

/** Behavior every `Store` must have. Run against each implementation. */
export function describeStoreContract(name: string, create: () => Promise<{ store: Store; cleanup(): Promise<void> }>): void {
  describe(`${name} store contract`, () => {
    let store: Store;
    let cleanup: () => Promise<void>;
    beforeEach(async () => {
      ({ store, cleanup } = await create());
      await store.init();
    });
    afterEach(async () => {
      await store.close();
      await cleanup();
    });

    it('stores participants, updates them in place, and enforces unique names and token hashes', async () => {
      await store.saveParticipant(participant());
      await store.saveParticipant(participant({ id: 'p_2', name: 'Bruno', tokenHash: 'a'.repeat(64), tokenPreview: 'wxyz', tokenCreatedAt: 5, tokenReplaced: true, tokenNoticeAt: 9, allowInsecure: true }));
      await store.saveParticipant(participant({ name: 'Alice B.' }));
      const rows = await store.listParticipants();
      expect(rows.map((r) => r.name).sort()).toEqual(['Alice B.', 'Bruno']);
      expect(rows.find((r) => r.id === 'p_2')).toEqual(
        participant({ id: 'p_2', name: 'Bruno', tokenHash: 'a'.repeat(64), tokenPreview: 'wxyz', tokenCreatedAt: 5, tokenReplaced: true, tokenNoticeAt: 9, allowInsecure: true }),
      );
      await expect(store.saveParticipant(participant({ id: 'p_3', name: 'Bruno' }))).rejects.toThrow();
      await expect(store.saveParticipant(participant({ id: 'p_3', name: 'Cleo', tokenHash: 'a'.repeat(64) }))).rejects.toThrow();
      await store.deleteParticipant('p_2');
      expect((await store.listParticipants()).map((r) => r.id)).toEqual(['p_1']);
    });

    it('stores rulesets and settings', async () => {
      await store.saveRuleset({ ruleset: CLASSIC_10X10, enabled: true, createdAt: 10 });
      await store.saveRuleset({ ruleset: CLASSIC_10X10, enabled: false, createdAt: 10 });
      expect(await store.listRulesets()).toEqual([{ ruleset: CLASSIC_10X10, enabled: false, createdAt: 10 }]);
      await store.setSetting('allowGodMode', 'true');
      await store.setSetting('allowGodMode', 'false');
      expect(await store.getSettings()).toEqual({ allowGodMode: 'false' });
    });

    it('stores lobbies and series, and deleting a lobby removes its series and games', async () => {
      await store.saveParticipant(participant());
      await store.saveLobby(lobby());
      await store.saveLobby(lobby({ lastActivityAt: 9_999, stopOnInfraction: true }));
      await store.saveSeries(series());
      await store.recordGame(game(), series({ played: 1, score: { 1: 1, 2: 0 } }));
      expect(await store.listLobbies()).toEqual([lobby({ lastActivityAt: 9_999, stopOnInfraction: true })]);
      expect(await store.listSeries('K7QM-4XD2-7')).toEqual([series({ played: 1, score: { 1: 1, 2: 0 } })]);
      await store.deleteLobby('K7QM-4XD2-7');
      expect(await store.listLobbies()).toEqual([]);
      expect(await store.listSeries('K7QM-4XD2-7')).toEqual([]);
      expect(await store.getGame('K7QM-4XD2-7', 'g_1')).toBeNull();
    });

    it('round-trips games exactly, lists them in order without the event log, and scopes lookups to the lobby', async () => {
      await store.saveParticipant(participant());
      await store.saveLobby(lobby());
      await store.saveLobby(lobby({ id: 'OTHER-LOBBY-0' }));
      await store.saveSeries(series());
      await store.recordGame(game({ id: 'g_2', index: 2, startedAt: 5_000 }), series({ played: 2 }));
      await store.recordGame(game(), series({ played: 1 }));
      await store.recordGame(game({ id: 'g_v', index: 2, status: 'void', winner: null, reason: null, summary: null, startedAt: 4_950 }), series({ played: 2 }));

      expect(await store.getGame('K7QM-4XD2-7', 'g_1')).toEqual(game());
      expect(await store.getGame('OTHER-LOBBY-0', 'g_1')).toBeNull();
      const metas = await store.listGames('s_1');
      expect(metas.map((m) => m.id)).toEqual(['g_1', 'g_v', 'g_2']);
      expect(metas[0]).not.toHaveProperty('events');
      expect(metas[0]).toMatchObject({ index: 1, first: 1, winner: 1, shots: { 1: 17, 2: 12 }, infractions: { 1: 0, 2: 1 } });
      expect((await store.listSummaries('s_1')).map((s) => s.index)).toEqual([1, 1]);
    });

    it('recordGame is atomic: a duplicate game id rolls back the series update', async () => {
      await store.saveParticipant(participant());
      await store.saveLobby(lobby());
      await store.saveSeries(series());
      await store.recordGame(game(), series({ played: 1 }));
      await expect(store.recordGame(game(), series({ played: 99 }))).rejects.toThrow();
      expect((await store.listSeries('K7QM-4XD2-7'))[0]?.played).toBe(1);
    });

    it('deletes a series with its games', async () => {
      await store.saveParticipant(participant());
      await store.saveLobby(lobby());
      await store.saveSeries(series());
      await store.saveSeries(series({ id: 's_2', startedAt: 3_500 }));
      await store.recordGame(game(), series({ played: 1 }));
      await store.deleteSeries('s_1');
      expect((await store.listSeries('K7QM-4XD2-7')).map((s) => s.id)).toEqual(['s_2']);
      expect(await store.getGame('K7QM-4XD2-7', 'g_1')).toBeNull();
    });

    it('keeps the audit log, newest first, honoring the limit', async () => {
      for (let i = 1; i <= 5; i++) await store.appendAudit({ at: i, actor: 'Alice', action: `a${i}`, target: null, detail: i % 2 ? 'odd' : null });
      const rows = await store.listAudit(3);
      expect(rows.map((r) => r.action)).toEqual(['a5', 'a4', 'a3']);
      expect(rows[0]).toMatchObject({ at: 5, actor: 'Alice', target: null, detail: 'odd' });
    });

    it('keeps the review time of a participant', async () => {
      await store.saveParticipant(participant({ activityReviewedAt: 12_345 }));
      expect((await store.listParticipants())[0]?.activityReviewedAt).toBe(12_345);
    });

    it('stores program connections: open, closed once, listed oldest first from a time, pruned, and gone with the participant', async () => {
      await store.saveParticipant(participant());
      await store.saveParticipant(participant({ id: 'p_2', name: 'Bruno' }));
      await store.addConnection(connection({ id: 'c_2', at: 30_000 }));
      await store.addConnection(connection({ id: 'c_1', at: 10_000, ip: '2a02:2f0e::1' }));
      await store.addConnection(connection({ id: 'c_3', participantId: 'p_2', at: 20_000, programName: null, programVersion: null }));
      await store.addConnection(connection({ id: 'c_4', kind: 'denied', at: 25_000, endedAt: 25_000, endReason: 'Refused: not their lobby.', seat: null }));
      expect((await store.listConnections(0)).map((c) => c.id)).toEqual(['c_1', 'c_3', 'c_4', 'c_2']);
      expect((await store.listConnections(20_000)).map((c) => c.id)).toEqual(['c_3', 'c_4', 'c_2']);
      expect((await store.listConnections(0)).find((c) => c.id === 'c_1')).toEqual(connection({ id: 'c_1', at: 10_000, ip: '2a02:2f0e::1' }));

      // Closing records the reason once; a second close changes nothing.
      await store.endConnection('c_1', 11_000, 'Replaced by a newer connection.', '91.2.2.2');
      await store.endConnection('c_1', 99_000, 'Closed by the program.', null);
      await store.endConnection('c_unknown', 99_000, 'x', null);
      expect((await store.listConnections(0)).find((c) => c.id === 'c_1')).toMatchObject({ endedAt: 11_000, endReason: 'Replaced by a newer connection.', takeoverIp: '91.2.2.2' });

      // After a restart whatever is still open is closed; closed ones are left alone.
      await store.endOpenConnections(50_000, 'The platform restarted.');
      const all = await store.listConnections(0);
      expect(all.find((c) => c.id === 'c_2')).toMatchObject({ endedAt: 50_000, endReason: 'The platform restarted.' });
      expect(all.find((c) => c.id === 'c_1')).toMatchObject({ endedAt: 11_000 });

      await store.pruneConnections(20_000);
      expect((await store.listConnections(0)).map((c) => c.id)).toEqual(['c_3', 'c_4', 'c_2']);
      await store.deleteParticipant('p_1');
      expect((await store.listConnections(0)).map((c) => c.id)).toEqual(['c_3']);
    });

    it('refuses a connection of a participant that does not exist', async () => {
      await expect(store.addConnection(connection({ participantId: 'p_missing' }))).rejects.toThrow();
    });

    it('manages web sessions', async () => {
      const s = (idHash: string, over: Partial<{ expiresAt: number; participantId: string | null }> = {}) => ({
        idHash: idHash.repeat(64).slice(0, 64),
        role: 'participant' as const,
        participantId: 'p_1' as string | null,
        adminUsername: null,
        createdAt: 1,
        expiresAt: 100,
        ...over,
      });
      await store.saveSession(s('a'));
      await store.saveSession(s('b', { expiresAt: 10 }));
      await store.saveSession(s('c', { participantId: 'p_2' }));
      expect(await store.getSession(s('a').idHash)).toEqual(s('a'));
      expect(await store.getSession('f'.repeat(64))).toBeNull();
      await store.deleteExpiredSessions(50);
      expect(await store.getSession(s('b').idHash)).toBeNull();
      await store.deleteSessionsOf('p_1');
      expect(await store.getSession(s('a').idHash)).toBeNull();
      expect(await store.getSession(s('c').idHash)).not.toBeNull();
      await store.deleteSession(s('c').idHash);
      expect(await store.getSession(s('c').idHash)).toBeNull();
    });
  });
}
