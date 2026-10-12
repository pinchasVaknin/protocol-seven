import { describe, expect, it } from 'vitest';
import {
  NO_SPECTATOR_TARGET,
  nextSpectatorTarget,
  pickSpectatorTarget,
  type SpectatorCandidate,
} from './SpectatorTarget';

/**
 * Who a dead player watches, pinned.
 *
 * Two questions, deliberately different. `pickSpectatorTarget` answers "show me somebody", and
 * its whole subtlety is `preferred`: the target already on screen wins whenever it is still
 * valid, so the camera does not hop to a lower id the instant a team-mate respawns. Continuity
 * is what makes a spectator camera watchable at all.
 *
 * `nextSpectatorTarget` answers "show me the next one", and it cycles **by id** rather than by
 * roster order. That is what makes two presses with three team-mates alive land back where they
 * started instead of walking whatever order the roster happens to be in.
 *
 * Both read one `isWatchable`, so they cannot disagree about who is a camera — a key press that
 * moved you off a valid target and onto nothing would be exactly that disagreement.
 */

function candidate(entityId: number, team: 'A' | 'B', alive = true): SpectatorCandidate {
  return { entityId, team, alive };
}

const ROSTER: readonly SpectatorCandidate[] = [
  candidate(0, 'A'),
  candidate(101, 'A'),
  candidate(100, 'A'),
  candidate(102, 'A'),
  candidate(200, 'B'),
];

describe('the sentinel', () => {
  it('is distinct from entity 0, which is a real seat', () => {
    expect(NO_SPECTATOR_TARGET).toBe(-1);
    expect(NO_SPECTATOR_TARGET).toBeLessThan(0);
  });
});

describe('picking somebody to watch', () => {
  it('takes the lowest living team-mate, never yourself', () => {
    // Lowest id rather than first in the roster, so the answer does not depend on roster order.
    expect(pickSpectatorTarget(0, 'A', ROSTER)).toBe(100);
  });

  it('keeps the body already on screen while it is still valid', () => {
    expect(pickSpectatorTarget(0, 'A', ROSTER, 102)).toBe(102);
  });

  it('drops a preferred body that has died, and falls back to the lowest', () => {
    const roster = [candidate(0, 'A'), candidate(100, 'A'), candidate(102, 'A', false)];
    expect(pickSpectatorTarget(0, 'A', roster, 102)).toBe(100);
  });

  it('ignores a preferred body on the other side', () => {
    expect(pickSpectatorTarget(0, 'A', ROSTER, 200)).toBe(100);
  });

  it('skips the dead', () => {
    const roster = [candidate(0, 'A'), candidate(100, 'A', false), candidate(101, 'A')];
    expect(pickSpectatorTarget(0, 'A', roster)).toBe(101);
  });

  it('never shows you the other side', () => {
    const roster = [candidate(0, 'A'), candidate(200, 'B'), candidate(201, 'B')];
    expect(pickSpectatorTarget(0, 'A', roster)).toBe(NO_SPECTATOR_TARGET);
  });

  it('has nobody to show when you are alone, or the roster is empty', () => {
    expect(pickSpectatorTarget(0, 'A', [])).toBe(NO_SPECTATOR_TARGET);
    expect(pickSpectatorTarget(0, 'A', [candidate(0, 'A')])).toBe(NO_SPECTATOR_TARGET);
  });

  it('reads the side it is given, not the side of the id', () => {
    expect(pickSpectatorTarget(0, 'B', ROSTER)).toBe(200);
  });
});

describe('cycling to the next one', () => {
  it('moves forward in id order, not roster order', () => {
    expect(nextSpectatorTarget(0, 'A', ROSTER, 100)).toBe(101);
    expect(nextSpectatorTarget(0, 'A', ROSTER, 101)).toBe(102);
  });

  it('wraps round the top', () => {
    expect(nextSpectatorTarget(0, 'A', ROSTER, 102)).toBe(100);
  });

  it('returns to where it started after a full lap', () => {
    let at = pickSpectatorTarget(0, 'A', ROSTER);
    const first = at;
    const seen: number[] = [];
    for (let press = 0; press < 3; press++) {
      seen.push(at);
      at = nextSpectatorTarget(0, 'A', ROSTER, at);
    }
    expect(seen).toEqual([100, 101, 102]);
    expect(at).toBe(first);
  });

  it('holds on the only watchable body rather than falling off it', () => {
    const roster = [candidate(0, 'A'), candidate(100, 'A'), candidate(200, 'B')];
    expect(nextSpectatorTarget(0, 'A', roster, 100)).toBe(100);
  });

  it('starts at the front when the current target is no longer valid', () => {
    // A target that died, left, or was never on this side: the key still has to work.
    expect(nextSpectatorTarget(0, 'A', ROSTER, 999)).toBe(100);
    expect(nextSpectatorTarget(0, 'A', ROSTER, NO_SPECTATOR_TARGET)).toBe(100);
    expect(nextSpectatorTarget(0, 'A', ROSTER, 200)).toBe(100);
  });

  it('gives the sentinel back when there is nobody left at all', () => {
    expect(nextSpectatorTarget(0, 'A', [candidate(0, 'A')], 0)).toBe(NO_SPECTATOR_TARGET);
    expect(nextSpectatorTarget(0, 'A', [], 100)).toBe(NO_SPECTATOR_TARGET);
  });

  it('skips a body that died since the last press', () => {
    const roster = [
      candidate(0, 'A'),
      candidate(100, 'A'),
      candidate(101, 'A', false),
      candidate(102, 'A'),
    ];
    expect(nextSpectatorTarget(0, 'A', roster, 100)).toBe(102);
  });

  it('agrees with the picker about who is watchable', () => {
    // The two share one predicate, so a press can never land on something `pick` would refuse.
    const roster = [candidate(0, 'A'), candidate(100, 'A', false), candidate(200, 'B')];
    expect(pickSpectatorTarget(0, 'A', roster)).toBe(NO_SPECTATOR_TARGET);
    expect(nextSpectatorTarget(0, 'A', roster, 100)).toBe(NO_SPECTATOR_TARGET);
  });
});
