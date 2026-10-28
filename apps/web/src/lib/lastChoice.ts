/** The god-mode choice a participant made last, remembered in this browser so the checkbox starts there. */
const key = (participantId: string) => `bsc-god-mode:${participantId}`;

export function getLastGodMode(participantId: string): boolean {
  try {
    return localStorage.getItem(key(participantId)) !== 'off';
  } catch {
    return true;
  }
}

export function rememberGodMode(participantId: string, on: boolean): void {
  try {
    localStorage.setItem(key(participantId), on ? 'on' : 'off');
  } catch {
    // remembering is a convenience only
  }
}
