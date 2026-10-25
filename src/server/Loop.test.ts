import { afterEach, describe, expect, it } from 'vitest';
import { installClock } from '../shared/core/Clock';
import { DT } from '../shared/core/Loop';
import { ServerLoop } from './Loop';
import { nodeClock } from './NodeClock';

/**
 * The server's fixed 60 Hz tick (B8).
 *
 * S4.11: *"the server tick is the clock."* A server that quietly dropped a tick under load
 * would run its match slower than the clock every client derives its own tick number from, and
 * the two would diverge permanently with nothing reporting it — which is why this loop shares
 * `DT` with the client and nothing else.
 *
 * **Almost all of this is asserted on a loop that has never been started**, which is exact and
 * free. There is exactly **one** test that runs the real thing, and it is deliberately short.
 *
 * The reason is a property of the class rather than of the test: `arm` waits out the last
 * stretch before a tick on the **immediate queue** — see its own comment for why a timer there
 * would be the expensive half of this loop — so a running `ServerLoop` keeps its process on the
 * check phase and never sleeps. Inside a parallel test runner that is one core gone for as long
 * as it runs, and six such tests were measured starving unrelated suites elsewhere in the tree
 * past their timeouts. The loop's real behaviour over hundreds of seconds is what the NET
 * oracle exercises; what is pinned here is its arithmetic, its accounting and its shutdown.
 */

installClock(nodeClock);

const live: ServerLoop[] = [];

afterEach(() => {
  for (const loop of live) loop.stop();
  live.length = 0;
});

function loop(opts: Partial<ConstructorParameters<typeof ServerLoop>[0]> = {}): ServerLoop {
  const made = new ServerLoop({ tick: () => {}, ...opts });
  live.push(made);
  return made;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ServerLoop', () => {
  describe('before it has run', () => {
    it('is at tick zero, with no simulated time', () => {
      const l = loop();
      expect(l.currentTick).toBe(0);
      expect(l.simTime).toBe(0);
      expect(l.isRunning).toBe(false);
      expect(l.meanSimMs).toBe(0);
    });

    it('reports zeroed jitter rather than nothing', () => {
      // The §7 panel reads this on its first frame, before a single interval exists.
      const j = loop().jitter();
      expect(j).toEqual({ p50: 0, p99: 0, min: 0, max: 0, mean: 0, late: 0, dropped: 0, ticks: 0, hz: 0 });
    });

    it('is a no-op to stop something that never started', () => {
      let stopped = 0;
      const l = loop({ onStop: () => stopped++ });
      l.stop();
      expect(stopped).toBe(0);
      expect(l.isRunning).toBe(false);
    });
  });

  describe('derived time', () => {
    it('counts simulated seconds from ticks, never from the wall clock', () => {
      const l = loop();
      // The tick index is what `simTime` is derived from, and `DT` is the shared constant.
      expect(l.simTime).toBe(l.currentTick * DT);
    });
  });

  describe('running', () => {
    it('delivers ticks on an absolute schedule, drops none, and stops dead', async () => {
      // The one test that runs the real loop. 50 ms is three ticks; the assertion is a range,
      // because the whole point of the class is that the platform is not punctual — what must
      // hold is that it delivered, counted, and abandoned nothing.
      let ticks = 0;
      const l = loop({ tick: () => ticks++ });

      l.start();
      expect(l.isRunning).toBe(true);
      await sleep(50);
      l.stop();
      const atStop = ticks;

      expect(ticks).toBeGreaterThanOrEqual(1);
      expect(ticks).toBeLessThanOrEqual(8);
      expect(l.currentTick).toBe(ticks);
      expect(l.simTime).toBe(ticks * DT);
      expect(l.jitter().dropped).toBe(0);
      expect(l.jitter().ticks).toBe(ticks);
      expect(l.meanSimMs).toBeGreaterThanOrEqual(0);

      // §4.18 counts a pending immediate the same way it counts a timer, and `wake` would
      // otherwise get one more turn after the loop has been told it is done.
      await sleep(30);
      expect(ticks).toBe(atStop);
      expect(l.isRunning).toBe(false);
    });

    it('ignores a second start, because one schedule is not two', () => {
      // Asserted without running: a doubled loop would arm twice, and `start` returns early.
      const l = loop();
      l.start();
      l.start();
      expect(l.isRunning).toBe(true);
      l.stop();
      expect(l.isRunning).toBe(false);
    });

    it('calls back once when it stops, and not again', () => {
      let stopped = 0;
      const l = loop({ onStop: () => stopped++ });
      l.start();
      l.stop();
      l.stop();
      expect(stopped).toBe(1);
    });
  });
});
