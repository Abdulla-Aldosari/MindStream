import * as assert from "assert";
import { SaveScheduler, SchedulerClock } from "../src/saveScheduler";

/** Manual clock: time only moves through `advance()`. */
class FakeClock implements SchedulerClock {
  time = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.time;
  }
  setTimer(fn: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, fn });
    return id;
  }
  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].fn();
    }
    this.time = target;
  }
}

function setup(delay = 3000, maxWait = 20000) {
  const clock = new FakeClock();
  let saves = 0;
  const scheduler = new SaveScheduler(
    () => {
      saves += 1;
    },
    delay,
    maxWait,
    clock
  );
  return { clock, scheduler, saves: () => saves };
}

describe("SaveScheduler", () => {
  it("runs one save after the quiet period, however many calls came before", () => {
    const { clock, scheduler, saves } = setup();
    scheduler.schedule();
    clock.advance(1000);
    scheduler.schedule();
    clock.advance(2999);
    assert.strictEqual(saves(), 0);
    clock.advance(1);
    assert.strictEqual(saves(), 1);
    assert.strictEqual(scheduler.isPending, false);
  });

  it("never postpones the save past maxWait during continuous activity", () => {
    const { clock, scheduler, saves } = setup(3000, 10000);
    for (let i = 0; i < 40; i++) {
      scheduler.schedule();
      clock.advance(500);
    }
    assert.ok(saves() >= 1);
    assert.ok(saves() <= 3);
  });

  it("flush runs a pending save immediately and cancels its timer", () => {
    const { clock, scheduler, saves } = setup();
    scheduler.schedule();
    scheduler.flush();
    assert.strictEqual(saves(), 1);
    clock.advance(60000);
    assert.strictEqual(saves(), 1);
  });

  it("flush does nothing when nothing is pending", () => {
    const { scheduler, saves } = setup();
    scheduler.flush();
    assert.strictEqual(saves(), 0);
  });

  it("cancel drops the pending save", () => {
    const { clock, scheduler, saves } = setup();
    scheduler.schedule();
    scheduler.cancel();
    clock.advance(60000);
    assert.strictEqual(saves(), 0);
    assert.strictEqual(scheduler.isPending, false);
  });

  it("starts a fresh burst after a save", () => {
    const { clock, scheduler, saves } = setup();
    scheduler.schedule();
    clock.advance(3000);
    scheduler.schedule();
    clock.advance(3000);
    assert.strictEqual(saves(), 2);
  });
});
