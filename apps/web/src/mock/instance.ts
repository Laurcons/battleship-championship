import { createMockApiClient, createMockControls } from './MockApiClient';
import type { Speed } from './runner';
import { MockServer } from './server';
import { localStoragePersistence, localStorageSession } from './storage';

const SPEED_KEY = 'bsc-mock-speed';

/** The single in-browser fake backend. Replaced by the real HTTP client when the API exists. */
export const mockServer = new MockServer(localStoragePersistence, localStorageSession);
export const mockApi = createMockApiClient(mockServer);

const base = createMockControls(mockServer);
const saved = (() => {
  try {
    return localStorage.getItem(SPEED_KEY);
  } catch {
    return null;
  }
})();
if (saved === 'watch' || saved === 'fast' || saved === 'instant') mockServer.setSpeed(saved);

/** Same controls, but the chosen game speed survives reloads. */
export const mockControls = {
  ...base,
  setSpeed(speed: Speed) {
    base.setSpeed(speed);
    try {
      localStorage.setItem(SPEED_KEY, speed);
    } catch {
      /* ignore */
    }
  },
};

// A reload right after a change must not lose it: save pending changes as the page goes away.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => mockServer.flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') mockServer.flushSave();
  });
}
