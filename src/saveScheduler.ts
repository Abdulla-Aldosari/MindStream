/** Timer surface the scheduler needs; injected so tests can drive time by hand. */
export interface SchedulerClock {
  now(): number;
  setTimer(fn: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const realClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Coalesces bursts of `schedule()` calls into one `save()`:
 * - it runs `delayMs` after the last call (trailing debounce), but
 * - never later than `maxWaitMs` after the first call of the burst, so a long
 *   typing session cannot postpone it forever.
 * `flush()` runs a pending save right now (no-op when nothing is pending).
 */
export class SaveScheduler {
  private timer: unknown;
  private firstAt = 0;
  private pending = false;

  constructor(
    private readonly save: () => void,
    private readonly delayMs: number,
    private readonly maxWaitMs: number,
    private readonly clock: SchedulerClock = realClock
  ) {}

  get isPending(): boolean {
    return this.pending;
  }

  schedule(): void {
    const now = this.clock.now();
    if (!this.pending) {
      this.pending = true;
      this.firstAt = now;
    } else {
      this.clock.clearTimer(this.timer);
    }
    const remaining = Math.max(0, this.maxWaitMs - (now - this.firstAt));
    this.timer = this.clock.setTimer(() => this.run(), Math.min(this.delayMs, remaining));
  }

  flush(): void {
    if (this.pending) {
      this.clock.clearTimer(this.timer);
      this.run();
    }
  }

  /** Drops a pending save without running it. */
  cancel(): void {
    if (this.pending) {
      this.clock.clearTimer(this.timer);
      this.pending = false;
    }
  }

  private run(): void {
    this.pending = false;
    this.save();
  }
}
