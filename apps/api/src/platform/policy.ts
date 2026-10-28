import type { Seat } from '@bsc/engine';
import type { ViewerMode } from '@bsc/api-contract';
import type { Lobby } from './lobby.js';

/** Who is asking. Built from the web session; every authorization decision starts here. */
export type Viewer =
  | { role: 'admin'; username: string }
  | { role: 'participant'; participantId: string; name: string };

export const actorName = (viewer: Viewer): string => (viewer.role === 'admin' ? `admin:${viewer.username}` : viewer.name);

/** The central authorization policy: nothing else decides who may see or do what with a lobby. */

export function ownsSeat(viewer: Viewer, lobby: Lobby, seat: Seat): boolean {
  const owner = lobby.row.seats[seat - 1];
  return viewer.role === 'participant' && owner?.kind === 'participant' && owner.participantId === viewer.participantId;
}

export function mySeats(viewer: Viewer, lobby: Lobby): Seat[] {
  return ([1, 2] as const).filter((s) => ownsSeat(viewer, lobby, s));
}

/** Lobbies are visible to their participants and to the admin; everyone else gets "not found". */
export function canAccessLobby(viewer: Viewer, lobby: Lobby): boolean {
  return viewer.role === 'admin' || mySeats(viewer, lobby).length > 0;
}

/** Only participants of the lobby may act in it (start, restart, reset); the admin is read-only. */
export function canActInLobby(viewer: Viewer, lobby: Lobby): boolean {
  return viewer.role === 'participant' && mySeats(viewer, lobby).length > 0;
}

export function canDeleteLobby(viewer: Viewer, lobby: Lobby): boolean {
  return canAccessLobby(viewer, lobby);
}

export function viewerMode(viewer: Viewer, lobby: Lobby): ViewerMode {
  return viewer.role === 'admin' || lobby.row.godMode ? 'god' : 'restricted';
}

/**
 * Seats whose hidden information the viewer must not see in a game. A finished game is fully
 * visible; in a restricted lobby a live game hides the seats the viewer does not own.
 */
export function hiddenSeats(viewer: Viewer, lobby: Lobby, gameFinished: boolean): Seat[] {
  if (viewerMode(viewer, lobby) === 'god' || gameFinished) return [];
  return ([1, 2] as const).filter((s) => !ownsSeat(viewer, lobby, s));
}

/** Frame logs hold a participant's raw traffic: only the owner of the seat and the admin may read them. */
export function canReadFrames(viewer: Viewer, lobby: Lobby, seat: Seat): boolean {
  return viewer.role === 'admin' || ownsSeat(viewer, lobby, seat);
}
