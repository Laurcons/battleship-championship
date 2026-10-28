export type CancelReason = 'void' | 'stop';

/** Lets the series loop abandon whatever it is waiting for (restart, reset, lobby deleted). */
export class CancelToken {
  private listeners: (() => void)[] = [];
  reason: CancelReason | null = null;

  get cancelled(): boolean {
    return this.reason !== null;
  }

  cancel(reason: CancelReason): void {
    if (this.reason !== null) return;
    this.reason = reason;
    const listeners = this.listeners;
    this.listeners = [];
    for (const l of listeners) l();
  }

  /** Runs `fn` on cancellation (immediately if already cancelled). Returns a function that unregisters it. */
  onCancel(fn: () => void): () => void {
    if (this.reason !== null) {
      fn();
      return () => undefined;
    }
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}
