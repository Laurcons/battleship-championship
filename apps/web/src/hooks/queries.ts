import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context';
import type { GameDetail, LiveUpdate, LobbySummary, Seat } from '../api/types';

export const keys = {
  session: ['session'] as const,
  lobbies: ['lobbies'] as const,
  lobby: (id: string) => ['lobby', id] as const,
  live: (id: string) => ['live', id] as const,
  series: (id: string) => ['series', id] as const,
  games: (id: string, seriesId?: string) => ['games', id, seriesId ?? 'current'] as const,
  game: (id: string, gameId: string) => ['game', id, gameId] as const,
  report: (id: string, seriesId?: string) => ['report', id, seriesId ?? 'current'] as const,
  frames: (id: string, seat: Seat) => ['frames', id, seat] as const,
  rulesets: ['rulesets'] as const,
  participants: ['participants'] as const,
  platform: ['platform'] as const,
  token: ['token'] as const,
  admin: {
    participants: ['admin', 'participants'] as const,
    settings: ['admin', 'settings'] as const,
    audit: ['admin', 'audit'] as const,
    lobbies: ['admin', 'lobbies'] as const,
  },
};

export function useSession() {
  const api = useApi();
  return useQuery({ queryKey: keys.session, queryFn: () => api.getSession(), staleTime: Infinity });
}

export function useLobbies() {
  const api = useApi();
  return useQuery({ queryKey: keys.lobbies, queryFn: () => api.listLobbies(), refetchInterval: 3000 });
}

export function useLobby(id: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.lobby(id), queryFn: () => api.getLobby(id), retry: false });
}

export function useRulesets() {
  const api = useApi();
  return useQuery({ queryKey: keys.rulesets, queryFn: () => api.listRulesets() });
}

/**
 * Subscribes to a lobby's live updates and mirrors them into the query cache. The latest game
 * (live, or the last finished one) is available under `keys.live(id)`.
 */
export function useLobbyLive(lobbyId: string) {
  const api = useApi();
  const qc = useQueryClient();
  const last = useRef<{ played: number | null; status: string; gameId: string | null; gameStatus: string | null }>({
    played: null,
    status: '',
    gameId: null,
    gameStatus: null,
  });
  useEffect(() => {
    const unsubscribe = api.subscribeLobby(lobbyId, (update: LiveUpdate) => {
      qc.setQueryData<LobbySummary>(keys.lobby(lobbyId), update.lobby);
      qc.setQueryData<GameDetail | null>(keys.live(lobbyId), update.game);
      const prev = last.current;
      const next = {
        played: update.lobby.series?.played ?? null,
        status: update.lobby.status,
        gameId: update.game?.id ?? null,
        gameStatus: update.game?.status ?? null,
      };
      const changed = JSON.stringify(prev) !== JSON.stringify(next);
      last.current = next;
      if (changed) {
        void qc.invalidateQueries({ queryKey: ['games', lobbyId] });
        void qc.invalidateQueries({ queryKey: ['report', lobbyId] });
        void qc.invalidateQueries({ queryKey: ['series', lobbyId] });
      }
    });
    return unsubscribe;
  }, [api, lobbyId, qc]);
  return useQuery<GameDetail | null>({
    queryKey: keys.live(lobbyId),
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  });
}

/** Runs a lobby action and refreshes everything that may have changed. */
export function useLobbyAction<TArgs extends unknown[]>(
  lobbyId: string,
  action: (...args: TArgs) => Promise<LobbySummary | void>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => action(...args),
    onSuccess: (result) => {
      if (result) qc.setQueryData(keys.lobby(lobbyId), result);
      void qc.invalidateQueries({ queryKey: ['games', lobbyId] });
      void qc.invalidateQueries({ queryKey: ['report', lobbyId] });
      void qc.invalidateQueries({ queryKey: ['series', lobbyId] });
      void qc.invalidateQueries({ queryKey: keys.lobbies });
    },
  });
}
