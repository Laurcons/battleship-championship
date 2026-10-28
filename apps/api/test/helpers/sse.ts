/* eslint-disable @typescript-eslint/no-explicit-any -- SSE payloads are inspected loosely */
import type { Client } from './testApp.js';

/** Reads a lobby's live stream the way the browser does, keeping every raw event. */
export class SseReader {
  readonly raw: string[] = [];
  readonly updates: any[] = [];
  status = 0;
  private abort = new AbortController();
  private done: Promise<void>;

  private constructor(done: (r: SseReader) => Promise<void>) {
    this.done = done(this);
  }

  static async open(client: Client, base: string, lobbyId: string): Promise<SseReader> {
    let resolveOpen!: () => void;
    const opened = new Promise<void>((r) => (resolveOpen = r));
    const reader = new SseReader(async (self) => {
      const res = await fetch(`${base}/api/lobbies/${lobbyId}/live`, {
        headers: { cookie: client.cookie, accept: 'text/event-stream' },
        signal: self.abort.signal,
      });
      self.status = res.status;
      resolveOpen();
      if (!res.body) return;
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let i: number;
          while ((i = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const data = block.split('\n').find((l) => l.startsWith('data: '));
            if (data) {
              self.raw.push(data.slice(6));
              self.updates.push(JSON.parse(data.slice(6)));
            }
          }
        }
      } catch {
        // aborted
      }
    });
    await opened;
    return reader;
  }

  async close(): Promise<void> {
    this.abort.abort();
    await this.done;
  }
}
