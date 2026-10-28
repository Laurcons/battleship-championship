import type { Session } from '../api/types';
import type { Persistence, SessionStore } from './server';
import type { MockState } from './state';

const STATE_KEY = 'bsc-mock-state-v1';
const SESSION_KEY = 'bsc-mock-session-v1';

export const localStoragePersistence: Persistence = {
  load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? (JSON.parse(raw) as MockState) : null;
    } catch {
      return null;
    }
  },
  save(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  },
  clear() {
    try {
      localStorage.removeItem(STATE_KEY);
    } catch {
      // ignore
    }
  },
};

export const localStorageSession: SessionStore = {
  load() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  save(session) {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  },
};
