import type { ApiClient } from '../api/client';
import type { Session } from '../api/types';
import type { Seat } from '@bsc/engine';
import type { Speed } from './runner';
import type { MockServer } from './server';
import type { SimProfile } from './state';

/** Wraps a `MockServer` as an `ApiClient`, adding a small artificial latency like a network would. */
export function createMockApiClient(server: MockServer, latencyMs = 120): ApiClient {
  const call = <T>(fn: () => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(fn());
        } catch (error) {
          reject(error);
        }
      }, latencyMs);
    });

  return {
    getSession: () => call(() => server.getSession()),
    verifySharedPassword: (password) => call(() => server.verifySharedPassword(password)),
    loginParticipant: (id) => call(() => server.loginParticipant(id)),
    loginAdmin: (username, password) => call(() => server.loginAdmin(username, password)),
    logout: () => call(() => server.logout()),
    getMyToken: () => call(() => server.getMyToken()),
    createToken: () => call(() => server.createToken()),
    replaceToken: () => call(() => server.replaceToken()),
    acknowledgeTokenNotice: () => call(() => server.acknowledgeTokenNotice()),
    listRulesets: () => call(() => server.listRulesets()),
    listParticipants: () => call(() => server.listParticipants()),
    getPlatformInfo: () => call(() => server.getPlatformInfo()),
    listLobbies: () => call(() => server.listLobbies()),
    getLobby: (id) => call(() => server.getLobby(id)),
    createLobby: (input) => call(() => server.createLobby(input)),
    deleteLobby: (id) => call(() => server.deleteLobby(id)),
    startSeries: (id, games) => call(() => server.startSeries(id, games)),
    restartGame: (id) => call(() => server.restartGame(id)),
    resetSeries: (id) => call(() => server.resetSeries(id)),
    listSeries: (id) => call(() => server.listSeries(id)),
    listGames: (id, seriesId) => call(() => server.listGames(id, seriesId)),
    getGame: (id, gameId) => call(() => server.getGame(id, gameId)),
    getSeriesReport: (id, seriesId) => call(() => server.getSeriesReport(id, seriesId)),
    getFrameLog: (id, seat) => call(() => server.getFrameLog(id, seat)),
    subscribeLobby: (id, cb, onError) => {
      try {
        return server.subscribeLobby(id, cb);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
        return () => undefined;
      }
    },
    admin: {
      listParticipants: () => call(() => server.adminListParticipants()),
      createParticipant: (name) => call(() => server.adminCreateParticipant(name)),
      renameParticipant: (id, name) => call(() => server.adminRenameParticipant(id, name)),
      deleteParticipant: (id) => call(() => server.adminDeleteParticipant(id)),
      createRuleset: (r) => call(() => server.adminCreateRuleset(r)),
      setRulesetEnabled: (id, enabled) => call(() => server.adminSetRulesetEnabled(id, enabled)),
      setDefaultRuleset: (id) => call(() => server.adminSetDefaultRuleset(id)),
      getSettings: () => call(() => server.adminGetSettings()),
      updateSettings: (patch) => call(() => server.adminUpdateSettings(patch)),
      listAuditLog: () => call(() => server.adminListAuditLog()),
      listAllLobbies: () => call(() => server.adminListAllLobbies()),
    },
  };
}

/** Developer controls that exist only in the mock (the simulated outside world). */
export interface MockControls {
  getSpeed(): Speed;
  setSpeed(speed: Speed): void;
  connectProgram(lobbyId: string, seat: Seat, profile?: SimProfile): void;
  disconnectProgram(lobbyId: string, seat: Seat): void;
  setProfile(lobbyId: string, seat: Seat, profile: SimProfile): void;
  simulateServerRestart(): void;
  expireLobby(lobbyId: string): void;
  simulateTokenReplacedElsewhere(participantId: string): void;
  /** Jumps straight to a session, skipping the login flow. */
  switchSession(session: Session | null): void;
  participants(): { id: string; name: string }[];
  resetData(): void;
  sharedPassword(): string;
  adminLogin(): { username: string; password: string };
}

export function createMockControls(server: MockServer): MockControls {
  return {
    getSpeed: () => server.getSpeed(),
    setSpeed: (speed) => server.setSpeed(speed),
    connectProgram: (id, seat, profile) => server.connectProgram(id, seat, profile),
    disconnectProgram: (id, seat) => server.disconnectProgram(id, seat),
    setProfile: (id, seat, profile) => server.setProfile(id, seat, profile),
    simulateServerRestart: () => server.simulateServerRestart(),
    expireLobby: (id) => server.expireLobby(id),
    simulateTokenReplacedElsewhere: (id) => server.simulateTokenReplacedElsewhere(id),
    switchSession: (session) => server.setSession(session),
    participants: () => server.state.participants.map((p) => ({ id: p.id, name: p.name })),
    resetData: () => server.resetData(),
    sharedPassword: () => server.state.sharedPassword,
    adminLogin: () => ({ ...server.state.admin }),
  };
}
