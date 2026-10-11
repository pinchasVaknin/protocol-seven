import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { SIM_HZ } from '../core/Loop';
import {
  AiScheduler,
  DEFAULT_SCHEDULER,
  SCHEDULER_CONFIG_KEYS,
  SCHEDULER_TUNABLES,
  schedulerConfigToSource,
} from './AiScheduler';

/**
 * The AI work scheduler, pinned — and the one claim in the file that is a measurement.
 *
 * S6.6 requires the work to be staggered, and the file argues that `index % period` is the
 * *wrong* stagger: ten bots on six perception phases come out as 2,2,2,2,1,1 with the first
 * four ticks of every cycle doing twice the work of the last two, which is exactly the spike
 * staggering was supposed to remove. The proportional spread holds for any count and period.
 *
 * That is a property, not an example, so the test below asserts it as one: over a whole cycle,
 * for every roster size from 1 to 24 and every rate in the table, **no tick carries more than
 * `ceil(count / period)` bots' worth of work**, and every bot runs exactly once per cycle.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow });

function scheduler(): AiScheduler {
  return new AiScheduler({ ...DEFAULT_SCHEDULER });
}

type WorkKind = 'perception' | 'tactical' | 'path';

const RATE_OF: Readonly<Record<WorkKind, number>> = {
  perception: DEFAULT_SCHEDULER.perceptionHz,
  tactical: DEFAULT_SCHEDULER.tacticalHz,
  path: DEFAULT_SCHEDULER.pathHz,
};

function isDue(s: AiScheduler, kind: WorkKind, index: number): boolean {
  if (kind === 'perception') return s.perceptionDue(index);
  if (kind === 'tactical') return s.tacticalDue(index);
  return s.pathDue(index);
}

/**
 * How many bots are due on each tick of one full cycle, and how often each bot ran.
 *
 * The period comes from the same rate the predicate reads, which is the whole of what makes
 * this a cycle: asking `pathDue` over a perception-length window would sample a fifth of one.
 */
function cycleLoad(
  kind: WorkKind,
  count: number,
): { perTick: number[]; perBot: number[]; period: number } {
  const s = scheduler();
  const period = Math.max(1, Math.round(SIM_HZ / Math.max(RATE_OF[kind], 1)));
  const perTick: number[] = [];
  const perBot = new Array<number>(count).fill(0);
  for (let tick = 0; tick < period; tick++) {
    s.beginTick(tick, count);
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (!isDue(s, kind, i)) continue;
      n++;
      perBot[i] = (perBot[i] ?? 0) + 1;
    }
    perTick.push(n);
  }
  return { perTick, perBot, period };
}

describe('the rates', () => {
  it('are the authored ones, and every one has a slider', () => {
    expect(DEFAULT_SCHEDULER).toEqual({
      perceptionHz: 10,
      tacticalHz: 4,
      pathHz: 3,
      astarNodesPerTick: 420,
    });
    expect(SCHEDULER_CONFIG_KEYS).toEqual(Object.keys(DEFAULT_SCHEDULER));
    for (const key of SCHEDULER_CONFIG_KEYS) {
      const meta = SCHEDULER_TUNABLES[key];
      expect(meta.min).toBeLessThanOrEqual(DEFAULT_SCHEDULER[key]);
      expect(meta.max).toBeGreaterThanOrEqual(DEFAULT_SCHEDULER[key]);
    }
  });

  it('serialise back into pasteable source, in declaration order', () => {
    const src = schedulerConfigToSource(DEFAULT_SCHEDULER);
    expect(src).toBe(
      [
        'export const DEFAULT_SCHEDULER: SchedulerConfig = {',
        '  perceptionHz: 10,',
        '  tacticalHz: 4,',
        '  pathHz: 3,',
        '  astarNodesPerTick: 420,',
        '};',
      ].join('\n'),
    );
  });

  it('hand perception its own interval, which is what the velocity estimate divides by', () => {
    const s = scheduler();
    expect(s.perceptionInterval).toBe(1 / DEFAULT_SCHEDULER.perceptionHz);
  });

  it('never divide by a zero rate', () => {
    const s = new AiScheduler({ ...DEFAULT_SCHEDULER, perceptionHz: 0 });
    expect(Number.isFinite(s.perceptionInterval)).toBe(true);
    s.beginTick(0, 4);
    expect(typeof s.perceptionDue(0)).toBe('boolean');
  });
});

describe('the stagger', () => {
  it('runs every bot exactly once per cycle, at every rate and roster size', () => {
    for (const kind of ['perception', 'tactical', 'path'] as const) {
      for (const count of [1, 2, 3, 5, 8, 10, 16, 24]) {
        const { perBot } = cycleLoad(kind, count);
        for (let i = 0; i < count; i++) expect(perBot[i]).toBe(1);
      }
    }
  });

  it('spreads them so no tick carries more than its share — the whole point of the file', () => {
    for (const kind of ['perception', 'tactical', 'path'] as const) {
      for (const count of [1, 2, 3, 5, 8, 10, 16, 24]) {
        const { perTick, period } = cycleLoad(kind, count);
        const share = Math.ceil(count / period);
        for (const n of perTick) expect(n).toBeLessThanOrEqual(share);
        expect(perTick.reduce((a, b) => a + b, 0)).toBe(count);
      }
    }
  });

  it('is dead even with ten bots on a twenty-tick path cycle: one every other tick', () => {
    const { perTick } = cycleLoad('path', 10);
    expect(perTick.length).toBe(20);
    expect(perTick.filter((n) => n === 1).length).toBe(10);
    expect(perTick.filter((n) => n === 0).length).toBe(10);
  });

  it('runs everything every tick when the rate is the tick rate', () => {
    const s = new AiScheduler({ ...DEFAULT_SCHEDULER, perceptionHz: SIM_HZ });
    for (let tick = 0; tick < 4; tick++) {
      s.beginTick(tick, 6);
      for (let i = 0; i < 6; i++) expect(s.perceptionDue(i)).toBe(true);
    }
  });
});

describe('the work it dispatched', () => {
  it('counts each kind separately, and starts over every tick', () => {
    const s = scheduler();
    s.beginTick(0, 10);
    let perception = 0;
    for (let i = 0; i < 10; i++) if (s.perceptionDue(i)) perception++;
    for (let i = 0; i < 10; i++) s.tacticalDue(i);
    for (let i = 0; i < 10; i++) s.pathDue(i);
    expect(s.perceptionRuns).toBe(perception);
    expect(s.perceptionRuns).toBeGreaterThan(0);

    s.beginTick(1, 10);
    expect(s.perceptionRuns).toBe(0);
    expect(s.tacticalRuns).toBe(0);
    expect(s.pathRuns).toBe(0);
  });

  it('spends the A* allowance as nodes, never below one', () => {
    const spent: number[] = [];
    const pathfinder = { step: (n: number) => spent.push(n) };
    scheduler().runPathBudget(pathfinder as never);
    expect(spent).toEqual([DEFAULT_SCHEDULER.astarNodesPerTick]);

    const starved = new AiScheduler({ ...DEFAULT_SCHEDULER, astarNodesPerTick: 0 });
    starved.runPathBudget(pathfinder as never);
    expect(spent[1]).toBe(1);
  });
});

describe('the timing acceptance criterion 6 is read from', () => {
  it('measures the block it was wrapped around', () => {
    const s = scheduler();
    fakeNow = 1000;
    s.beginTick(0, 4);
    fakeNow = 1002.5;
    s.endTick();
    expect(s.lastMs).toBe(2.5);
    expect(s.worstMs).toBe(2.5);
    expect(s.sampleCount).toBe(1);
  });

  it('keeps the worst it has seen, not the latest', () => {
    const s = scheduler();
    for (const ms of [1, 9, 2]) {
      fakeNow = 0;
      s.beginTick(0, 4);
      fakeNow = ms;
      s.endTick();
    }
    expect(s.lastMs).toBe(2);
    expect(s.worstMs).toBe(9);
  });

  it('computes real percentiles rather than a running average', () => {
    const s = scheduler();
    // 100 samples: ninety-nine at 1 ms and one at 50.
    for (let i = 0; i < 100; i++) {
      fakeNow = 0;
      s.beginTick(i, 4);
      fakeNow = i === 99 ? 50 : 1;
      s.endTick();
    }
    s.recompute();
    expect(s.sampleCount).toBe(100);
    expect(s.p50Ms).toBe(1);
    // A single 50 ms outlier does not move p99 — which is exactly why the file keeps a ring
    // and sorts it instead of holding a running average, and why `worstMs` is reported too.
    expect(s.p99Ms).toBe(1);
    expect(s.worstMs).toBe(50);
    expect(s.meanMs).toBeGreaterThan(1);
    expect(s.meanMs).toBeLessThan(2);
  });

  it('does move p99 once the tail is one per cent of the window', () => {
    const s = scheduler();
    for (let i = 0; i < 100; i++) {
      fakeNow = 0;
      s.beginTick(i, 4);
      fakeNow = i >= 97 ? 50 : 1;
      s.endTick();
    }
    s.recompute();
    expect(s.p50Ms).toBe(1);
    expect(s.p99Ms).toBe(50);
  });

  it('computes nothing from nothing', () => {
    const s = scheduler();
    s.recompute();
    expect(s.p50Ms).toBe(0);
    expect(s.p99Ms).toBe(0);
    expect(s.sampleCount).toBe(0);
  });

  it('forgets its history on reset', () => {
    const s = scheduler();
    fakeNow = 0;
    s.beginTick(0, 4);
    fakeNow = 7;
    s.endTick();
    s.recompute();
    s.reset();
    expect(s.sampleCount).toBe(0);
    expect(s.worstMs).toBe(0);
    expect(s.lastMs).toBe(0);
    expect(s.p50Ms).toBe(0);
    expect(s.meanMs).toBe(0);
  });
});
