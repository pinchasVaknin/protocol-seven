import { describe, expect, it } from 'vitest';
import { DT } from '../../shared/core/Loop';
import { InstanceClock } from './InstanceClock';

/**
 * One instance's view of the master clock (B4).
 *
 * The class makes three claims that nothing else in the process can check for it, so each one
 * is a test here:
 *
 *  1. **The two tick numbers are different numbers.** An instance created at master tick
 *     41,000 has taken zero steps, and everything that means "how far into this match are we"
 *     has to read the local one. M10 could not tell them apart because its single match was
 *     created at tick 0; here they are permanently unequal, and that is what these tests pin.
 *  2. **The send cadence is an integer number of ticks**, so it does not beat against the tick
 *     rate.
 *  3. **Two instances never serialise on the same tick** (§4.19's staggering). That is the one
 *     property with a cost attached — it exists to keep two serialisation passes off the same
 *     16 ms of event loop — and it is a property of the arithmetic rather than of any caller,
 *     so it is checked over a run of ticks rather than at a point.
 */

describe('InstanceClock', () => {
  describe('the send cadence', () => {
    it('is every third tick at 20 Hz against a 60 Hz loop', () => {
      expect(new InstanceClock(0, 20, 0).snapshotEveryTicks).toBe(3);
    });

    it('is every tick at the loop rate', () => {
      expect(new InstanceClock(0, 60, 0).snapshotEveryTicks).toBe(1);
    });

    it('is every second tick at 30 Hz', () => {
      expect(new InstanceClock(0, 30, 0).snapshotEveryTicks).toBe(2);
    });

    it('rounds rather than truncating', () => {
      // 60 / 25 = 2.4, which rounds to 2 rather than flooring to 2 by accident.
      expect(new InstanceClock(0, 25, 0).snapshotEveryTicks).toBe(2);
      // 60 / 14 = 4.29 -> 4; 60 / 13 = 4.6 -> 5.
      expect(new InstanceClock(0, 14, 0).snapshotEveryTicks).toBe(4);
      expect(new InstanceClock(0, 13, 0).snapshotEveryTicks).toBe(5);
    });

    it('never falls below one tick for any rate the loop can serve', () => {
      // The `Math.max(1, ...)` floor, which is what a rate at or above the loop's needs: a
      // send cannot buy a fraction of a tick. 60 / 1000 rounds to 0, and the floor is the only
      // thing between that and a modulo by zero.
      expect(new InstanceClock(0, 120, 0).snapshotEveryTicks).toBe(1);
      expect(new InstanceClock(0, 1_000, 0).snapshotEveryTicks).toBe(1);
    });

    it('yields an infinite interval at a zero rate, which no caller can ask for', () => {
      // The floor guards the top of the range and not the bottom: 60 / 0 is Infinity, which
      // `Math.max` passes through, and `shouldSnapshot` then answers true only on absolute
      // tick 0. Pinned rather than fixed because it is unreachable — `Config` reads the rate as
      // `intOr(env['SNAPSHOT_HZ'], 20, 10, 60)`, clamped to [10, 60] before it gets here, so
      // the configured range cannot produce it.
      const clock = new InstanceClock(0, 0, 0);
      expect(clock.snapshotEveryTicks).toBe(Infinity);
      expect(clock.phaseOffset).toBe(0);
      clock.advance(0);
      expect(clock.shouldSnapshot()).toBe(true);
      clock.advance(1);
      expect(clock.shouldSnapshot()).toBe(false);
    });
  });

  describe('the snapshot phase offset', () => {
    it('leaves the arena unshifted', () => {
      expect(new InstanceClock(0, 20, 0).phaseOffset).toBe(0);
    });

    it('puts a live match one tick clear of the arena', () => {
      expect(new InstanceClock(0, 20, 1).phaseOffset).toBe(1);
    });

    it('is the index modulo the interval, not the index', () => {
      // A third instance degrades to a collision with the first rather than producing an offset
      // larger than the period, which would alias back to zero and undo the staggering.
      expect(new InstanceClock(0, 20, 3).phaseOffset).toBe(0);
      expect(new InstanceClock(0, 20, 4).phaseOffset).toBe(1);
    });
  });

  describe('the two tick numbers', () => {
    it('starts on the master tick it was created at, having taken no steps', () => {
      const clock = new InstanceClock(41_000, 20, 0);
      expect(clock.startTick).toBe(41_000);
      expect(clock.absoluteTick).toBe(41_000);
      expect(clock.localTick).toBe(-1);
    });

    it('counts a local step per advance while following the master', () => {
      const clock = new InstanceClock(41_000, 20, 0);
      clock.advance(41_000);
      expect(clock.absoluteTick).toBe(41_000);
      expect(clock.localTick).toBe(0);

      clock.advance(41_001);
      expect(clock.absoluteTick).toBe(41_001);
      expect(clock.localTick).toBe(1);
    });

    it('counts steps taken rather than master ticks elapsed', () => {
      // The instance is stepped three times over a master span of 1,000 ticks. "How far into
      // this match are we" is three steps, which is the distinction M10 could not make.
      const clock = new InstanceClock(41_000, 20, 0);
      clock.advance(41_100);
      clock.advance(41_500);
      clock.advance(42_000);
      expect(clock.absoluteTick).toBe(42_000);
      expect(clock.localTick).toBe(2);
    });
  });

  describe('localSeconds', () => {
    it('is zero before the first step, not negative', () => {
      // `local` starts at -1, so the floor is what keeps a mode clock from being handed a
      // negative duration on the tick an instance is created.
      expect(new InstanceClock(41_000, 20, 0).localSeconds).toBe(0);
    });

    it('is ticks over the loop rate, never wall clock', () => {
      const clock = new InstanceClock(41_000, 20, 0);
      for (let i = 0; i < 60; i++) clock.advance(41_000 + i);
      expect(clock.localTick).toBe(59);
      expect(clock.localSeconds).toBe(59 * DT);
    });
  });

  describe('shouldSnapshot', () => {
    it('is phase-shifted against the absolute tick, not the local one', () => {
      // Two instances created 1,000 ticks apart. Were the shift applied to the local tick they
      // would share a phase whenever their creation ticks were congruent, one time in three.
      const arena = new InstanceClock(0, 20, 0);
      const live = new InstanceClock(1_000, 20, 1);

      const arenaTicks: number[] = [];
      const liveTicks: number[] = [];
      for (let tick = 1_000; tick < 1_012; tick++) {
        arena.advance(tick);
        live.advance(tick);
        if (arena.shouldSnapshot()) arenaTicks.push(tick);
        if (live.shouldSnapshot()) liveTicks.push(tick);
      }

      expect(arenaTicks).toEqual([1_002, 1_005, 1_008, 1_011]);
      expect(liveTicks).toEqual([1_001, 1_004, 1_007, 1_010]);
    });

    it('never puts two staggered instances on the same tick', () => {
      const arena = new InstanceClock(0, 20, 0);
      const live = new InstanceClock(7, 20, 1);
      let both = 0;
      for (let tick = 0; tick < 600; tick++) {
        arena.advance(tick);
        live.advance(tick);
        if (arena.shouldSnapshot() && live.shouldSnapshot()) both++;
      }
      expect(both).toBe(0);
    });

    it('is every tick when the interval is one, for both instances', () => {
      // At the loop rate there is no room to stagger, so the offset collapses to zero and both
      // send every tick. Pinned because it is the case where the staggering cannot help.
      const clock = new InstanceClock(0, 60, 1);
      expect(clock.phaseOffset).toBe(0);
      clock.advance(1);
      expect(clock.shouldSnapshot()).toBe(true);
      clock.advance(2);
      expect(clock.shouldSnapshot()).toBe(true);
    });
  });
});
