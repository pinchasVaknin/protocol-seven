import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/MathUtil';
import {
  DEFAULT_INTERPOLATION_DELAY_MS,
  EntityInterpolator,
  makeInterpolatedPose,
  type InterpolatedPose,
} from './Interpolation';
import { makeEntitySnapshot, type EntitySnapshot } from './Snapshot';

/**
 * Remote entities, rendered in the past (S4.12) — pinned before A23 split `sample`.
 *
 * This file had no tests either, and it is the other half of the pair S4.12 warns about:
 * *"local player predicted, remotes interpolated — two different code paths, and conflating
 * them is the classic bug."* What is asserted here is what a player sees of everybody else —
 * the blend, the short way round a turn, the brief extrapolation and the freeze after it.
 */

function body(mutate: (e: EntitySnapshot) => void = () => undefined): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = 3;
  mutate(e);
  return e;
}

/** Push `x` at `serverMs`, so a test reads as a path through time. */
function at(interp: EntityInterpolator, serverMs: number, x: number, extra: (e: EntitySnapshot) => void = () => undefined): void {
  interp.push(
    body((e) => {
      e.x = x;
      extra(e);
    }),
    serverMs,
  );
}

function poseAt(interp: EntityInterpolator, renderMs: number): InterpolatedPose {
  const out = makeInterpolatedPose();
  interp.sample(renderMs, out);
  return out;
}

describe('the sample buffer', () => {
  it('keeps the newest state unsmoothed, and counts what it holds', () => {
    const interp = new EntityInterpolator();
    expect(interp.sampleCount).toBe(0);

    at(interp, 1000, 1, (e) => (e.health = 70));
    at(interp, 1100, 2, (e) => (e.health = 40));

    expect(interp.sampleCount).toBe(2);
    expect(interp.latestMs).toBe(1100);
    // Discrete facts take effect when they arrive: blending health would invent a number.
    expect(interp.latest.health).toBe(40);
    expect(interp.latest.x).toBe(2);
  });

  it('does not let a late frame move the newest state backwards', () => {
    const interp = new EntityInterpolator();
    at(interp, 1100, 2, (e) => (e.health = 40));
    at(interp, 1000, 1, (e) => (e.health = 70));
    expect(interp.latestMs).toBe(1100);
    expect(interp.latest.health).toBe(40);
    // The late sample is still held, and still blended from.
    expect(interp.sampleCount).toBe(2);
  });

  it('holds at most its ring and keeps the newest', () => {
    const interp = new EntityInterpolator();
    for (let i = 0; i < 40; i++) at(interp, 1000 + i * 50, i);
    expect(interp.sampleCount).toBe(32);
    expect(interp.latest.x).toBe(39);
  });

  it('leaves the pose alone when it has nothing to say', () => {
    const interp = new EntityInterpolator();
    const out = makeInterpolatedPose();
    out.x = 5;
    interp.sample(1000, out);
    expect(out.x).toBe(5);
    expect(out.extrapolated).toBe(false);
    expect(out.frozen).toBe(false);
  });
});

describe('interpolating between two samples', () => {
  it('blends position and pitch linearly across the pair that brackets the render time', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 0, (e) => {
      e.y = 0;
      e.z = 10;
      e.pitch = 0;
    });
    at(interp, 1100, 10, (e) => {
      e.y = 2;
      e.z = 0;
      e.pitch = 0.5;
    });

    const mid = poseAt(interp, 1050);
    expect(mid.x).toBeCloseTo(5, 6);
    expect(mid.y).toBeCloseTo(1, 6);
    expect(mid.z).toBeCloseTo(5, 6);
    expect(mid.pitch).toBeCloseTo(0.25, 6);
    expect(mid.extrapolated).toBe(false);
    expect(mid.frozen).toBe(false);
  });

  it('picks the bracketing pair, not the newest, when later samples exist', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 0);
    at(interp, 1100, 10);
    at(interp, 1200, 100);
    at(interp, 1300, 1000);

    expect(poseAt(interp, 1150).x).toBeCloseTo(55, 6);
  });

  it('turns the short way round, so a body crossing north does not spin', () => {
    const interp = new EntityInterpolator();
    const a = 6.2;
    const b = 0.1;
    at(interp, 1000, 0, (e) => (e.yaw = a));
    at(interp, 1100, 0, (e) => (e.yaw = b));

    const mid = poseAt(interp, 1050);
    // The long way round would walk backwards through 3 radians; the short way is forward
    // through north, which is what `angleDelta` returns.
    expect(mid.yaw).toBeCloseTo(a + angleDelta(a, b) * 0.5, 6);
    expect(mid.yaw).toBeGreaterThan(a);
  });

  it('changes stance at the sample that carries it, never halfway', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 0, (e) => (e.stance = 'STAND'));
    at(interp, 1100, 10, (e) => (e.stance = 'CROUCH'));
    expect(poseAt(interp, 1001).stance).toBe('CROUCH');
    expect(poseAt(interp, 1099).stance).toBe('CROUCH');
  });

  it('draws the oldest sample rather than inventing a pose before it', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 4, (e) => (e.yaw = 1.25));
    at(interp, 1100, 9);

    const early = poseAt(interp, 900);
    expect(early.x).toBe(4);
    expect(early.yaw).toBe(1.25);
    expect(early.extrapolated).toBe(false);
    expect(early.frozen).toBe(false);
  });

  it('does not divide by a zero span', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 3);
    at(interp, 1000, 7);
    const pose = poseAt(interp, 999.5);
    expect(Number.isNaN(pose.x)).toBe(false);
  });
});

describe('extrapolating past the newest sample', () => {
  it('continues along the motion observed between the last two poses', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 0);
    at(interp, 1100, 10);

    // Half a sample-gap past the newest: half the observed step again.
    const ahead = poseAt(interp, 1150);
    expect(ahead.x).toBeCloseTo(15, 6);
    expect(ahead.extrapolated).toBe(true);
    expect(ahead.frozen).toBe(false);
  });

  it('freezes past the cap rather than gliding through a wall', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 0);
    at(interp, 1100, 10);

    // MAX_EXTRAPOLATION_MS is 250: one millisecond past it is a frozen body.
    const frozen = poseAt(interp, 1100 + 251);
    expect(frozen.x).toBe(10);
    expect(frozen.frozen).toBe(true);
    expect(frozen.extrapolated).toBe(false);
  });

  it('draws a lone sample as it is, with nothing to extrapolate from', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 4, (e) => (e.pitch = 0.5));
    const ahead = poseAt(interp, 1050);
    expect(ahead.x).toBe(4);
    expect(ahead.pitch).toBe(0.5);
    expect(ahead.extrapolated).toBe(false);
  });

  it('keeps the newest pitch rather than extrapolating it', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 0, (e) => (e.pitch = 0));
    at(interp, 1100, 10, (e) => (e.pitch = 0.4));
    expect(poseAt(interp, 1150).pitch).toBe(0.4);
  });
});

describe('a teleport', () => {
  it('cuts to the new place instead of sliding across the map', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 0);
    at(interp, 1100, 1);
    // The body died over there and came back over here.
    at(interp, 1200, 30);

    interp.snapTo(1200);
    expect(interp.sampleCount).toBe(1);
    // The very next sample is the post-spawn state: a clean cut, not a slide and not a stall.
    expect(poseAt(interp, 1200).x).toBe(30);
    expect(poseAt(interp, 1150).x).toBe(30);
  });

  it('survives a reset with its newest state, which is what makes snapTo two lines', () => {
    const interp = new EntityInterpolator();
    at(interp, 1000, 7);
    interp.reset();
    expect(interp.sampleCount).toBe(0);
    expect(interp.latestMs).toBe(0);
    expect(interp.latest.x).toBe(7);

    const out = makeInterpolatedPose();
    out.x = -1;
    interp.sample(1000, out);
    expect(out.x).toBe(-1);
  });
});

describe('the delay itself', () => {
  it('is the hundred milliseconds S4.12 asks for', () => {
    expect(DEFAULT_INTERPOLATION_DELAY_MS).toBe(100);
  });
});
