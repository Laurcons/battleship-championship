import { Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import type { LiveUpdate } from '@bsc/api-contract';
import { CLOCK, type Clock } from './util.js';
import { LobbiesService } from './lobbies.service.js';
import type { Viewer } from './policy.js';

export const EMIT_INTERVAL_MS = 80;

interface Subscriber {
  viewer: Viewer;
  send: (update: LiveUpdate) => void;
  /** Ends the stream (the lobby was deleted, or the platform is stopping). */
  end: () => void;
}

/** Fans lobby changes out to live viewers (SSE), at most every `EMIT_INTERVAL_MS` per lobby. */
@Injectable()
export class LiveHub implements BeforeApplicationShutdown {
  private subscribers = new Map<string, Set<Subscriber>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastEmit = new Map<string, number>();

  constructor(
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    lobbies.onChange((id, force) => this.emit(id, force));
    lobbies.onDelete((lobby) => this.close(lobby.id));
  }

  count(): number {
    let n = 0;
    for (const set of this.subscribers.values()) n += set.size;
    return n;
  }

  /** Registers a viewer and immediately sends the current state. Returns the unsubscribe function. */
  subscribe(lobbyId: string, viewer: Viewer, send: (update: LiveUpdate) => void, end: () => void = () => undefined): () => void {
    const sub: Subscriber = { viewer, send, end };
    let set = this.subscribers.get(lobbyId);
    if (!set) this.subscribers.set(lobbyId, (set = new Set()));
    set.add(sub);
    void this.push(lobbyId, sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subscribers.delete(lobbyId);
    };
  }

  emit(lobbyId: string, force = false): void {
    if (!this.subscribers.has(lobbyId)) return;
    const now = this.clock.now();
    const last = this.lastEmit.get(lobbyId) ?? 0;
    if (force || now - last >= EMIT_INTERVAL_MS) {
      this.flush(lobbyId);
      return;
    }
    if (!this.timers.has(lobbyId)) {
      this.timers.set(lobbyId, setTimeout(() => this.flush(lobbyId), EMIT_INTERVAL_MS - (now - last)));
    }
  }

  private flush(lobbyId: string): void {
    const timer = this.timers.get(lobbyId);
    if (timer) clearTimeout(timer);
    this.timers.delete(lobbyId);
    this.lastEmit.set(lobbyId, this.clock.now());
    for (const sub of this.subscribers.get(lobbyId) ?? []) void this.push(lobbyId, sub);
  }

  private async push(lobbyId: string, sub: Subscriber): Promise<void> {
    const lobby = this.lobbies.find(lobbyId);
    if (!lobby) return;
    try {
      sub.send(await this.lobbies.liveUpdate(lobby, sub.viewer));
    } catch {
      // a viewer that cannot be served right now simply misses this update
    }
  }

  private close(lobbyId: string): void {
    for (const sub of this.subscribers.get(lobbyId) ?? []) sub.end();
    const timer = this.timers.get(lobbyId);
    if (timer) clearTimeout(timer);
    this.timers.delete(lobbyId);
    this.subscribers.delete(lobbyId);
  }

  beforeApplicationShutdown(): void {
    this.dispose();
  }

  dispose(): void {
    for (const set of this.subscribers.values()) for (const sub of set) sub.end();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.subscribers.clear();
  }
}
