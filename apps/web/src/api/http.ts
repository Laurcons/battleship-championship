import {
  ApiError,
  type AdminParticipant,
  type ApiClient,
  type ApiErrorCode,
  type AuditEntry,
  type Frame,
  type GameDetail,
  type GameListItem,
  type LiveUpdate,
  type LobbySummary,
  type MyToken,
  type ParticipantRef,
  type PlatformInfo,
  type PlatformSettings,
  type RulesetInfo,
  type SeriesInfo,
  type SeriesReport,
  type Session,
} from '@bsc/api-contract';

const CODES: readonly ApiErrorCode[] = [
  'invalid_credentials',
  'rate_limited',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'validation',
  'internal',
  'unavailable',
];

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('unavailable', 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // not JSON: a proxy error page, for instance
  }
  if (!res.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    const code = CODES.find((c) => c === error?.code) ?? (res.status >= 500 ? 'unavailable' : 'internal');
    throw new ApiError(code, error?.message ?? 'The server could not complete the request.', error?.details);
  }
  return payload as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
const enc = encodeURIComponent;

/** The real client: JSON over HTTP, with live lobby updates over server-sent events. */
export function createHttpApiClient(): ApiClient {
  return {
    getSession: () => get<Session | null>('/api/session'),
    verifySharedPassword: (password) => post<ParticipantRef[]>('/api/auth/gate', { password }),
    loginParticipant: (participantId) => post<Session>('/api/auth/participant', { participantId }),
    loginAdmin: (username, password) => post<Session>('/api/auth/admin', { username, password }),
    logout: () => post<void>('/api/auth/logout'),

    getMyToken: () => get<MyToken>('/api/me/token'),
    createToken: () => post<{ token: string }>('/api/me/token'),
    replaceToken: () => post<{ token: string }>('/api/me/token/replace'),
    acknowledgeTokenNotice: () => post<void>('/api/me/token/notice/ack'),

    listRulesets: () => get<RulesetInfo[]>('/api/rulesets'),
    listParticipants: () => get<ParticipantRef[]>('/api/participants'),
    getPlatformInfo: () => get<PlatformInfo>('/api/platform'),

    listLobbies: () => get<LobbySummary[]>('/api/lobbies'),
    getLobby: (id) => get<LobbySummary>(`/api/lobbies/${enc(id)}`),
    createLobby: (input) => post<LobbySummary>('/api/lobbies', input),
    deleteLobby: (id) => request<void>('DELETE', `/api/lobbies/${enc(id)}`),
    startSeries: (id, games) => post<LobbySummary>(`/api/lobbies/${enc(id)}/start`, { games }),
    restartGame: (id) => post<LobbySummary>(`/api/lobbies/${enc(id)}/restart-game`),
    resetSeries: (id) => post<LobbySummary>(`/api/lobbies/${enc(id)}/reset-series`),

    listSeries: (id) => get<SeriesInfo[]>(`/api/lobbies/${enc(id)}/series`),
    listGames: (id, seriesId) => get<GameListItem[]>(`/api/lobbies/${enc(id)}/games${seriesId ? `?seriesId=${enc(seriesId)}` : ''}`),
    getGame: (id, gameId) => get<GameDetail>(`/api/lobbies/${enc(id)}/games/${enc(gameId)}`),
    getSeriesReport: (id, seriesId) => get<SeriesReport | null>(`/api/lobbies/${enc(id)}/report${seriesId ? `?seriesId=${enc(seriesId)}` : ''}`),
    getFrameLog: (id, seat) => get<Frame[]>(`/api/lobbies/${enc(id)}/frames/${seat}`),

    subscribeLobby(lobbyId, onUpdate, onError) {
      const source = new EventSource(`/api/lobbies/${enc(lobbyId)}/live`);
      source.onmessage = (event) => {
        try {
          onUpdate(JSON.parse(event.data as string) as LiveUpdate);
        } catch {
          // ignore a malformed event; the next one replaces it
        }
      };
      source.onerror = () => {
        // While the browser is reconnecting the state is CONNECTING and nothing is lost: the first
        // event after a reconnect carries the full state. CLOSED means the server refused the stream.
        if (source.readyState === EventSource.CLOSED) onError?.(new Error('The live view could not be opened.'));
      };
      return () => source.close();
    },

    admin: {
      listParticipants: () => get<AdminParticipant[]>('/api/admin/participants'),
      createParticipant: (name) => post<AdminParticipant>('/api/admin/participants', { name }),
      renameParticipant: (id, name) => request<AdminParticipant>('PATCH', `/api/admin/participants/${enc(id)}`, { name }),
      deleteParticipant: (id) => request<void>('DELETE', `/api/admin/participants/${enc(id)}`),
      createRuleset: (ruleset) => post<RulesetInfo>('/api/admin/rulesets', ruleset),
      setRulesetEnabled: (id, enabled) => request<RulesetInfo>('PATCH', `/api/admin/rulesets/${enc(id)}`, { enabled }),
      setDefaultRuleset: (id) => post<RulesetInfo>(`/api/admin/rulesets/${enc(id)}/default`),
      getSettings: () => get<PlatformSettings>('/api/admin/settings'),
      updateSettings: (patch) => request<PlatformSettings>('PATCH', '/api/admin/settings', patch),
      listAuditLog: () => get<AuditEntry[]>('/api/admin/audit'),
      listAllLobbies: () => get<LobbySummary[]>('/api/admin/lobbies'),
    },
  };
}
