import { createContext, useContext, type ReactNode } from 'react';
import type { MockControls } from './MockApiClient';

const ControlsContext = createContext<MockControls | null>(null);

export function MockControlsProvider({ controls, children }: { controls: MockControls; children: ReactNode }) {
  return <ControlsContext.Provider value={controls}>{children}</ControlsContext.Provider>;
}

/** Null when the app runs against the real API. */
export function useMockControls(): MockControls | null {
  return useContext(ControlsContext);
}
