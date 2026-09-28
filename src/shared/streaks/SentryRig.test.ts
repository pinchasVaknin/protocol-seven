import { describe, expect, it } from 'vitest';
import { HitboxRig, makeRigHit, type RigHit } from '../combat/HitboxRig';
import { SENTRY_RIG } from './SentryGun';

/**
 * The sentry's silhouette, pinned to the model it wears.
 *
 * `SENTRY_RIG` stopped being two boxes standing in for a drawing on 2026-09-28 and became six
 * measured off `public/models/props/sentry_turret.glb`. The numbers in that file are checked by
 * `check:props`; what is checked here is the thing a number cannot show — that a shot aimed
 * where a player sees a part of the turret **resolves against that part**, and that the only
 * place a bullet does full damage is still the receiver.
 *
 * These go through `HitboxRig.raycast`, the function the damage path actually calls, rather
 * than reading the box list back. A layout can be right and still be unreachable behind the
 * bounding-sphere reject, which is the failure a table comparison would miss: the barrel
 * reaches 0.68 m in front of the mount and would sit outside the old 0.60 m sphere.
 */

/** A sentry at the origin, facing -Z, which is where yaw 0 points everywhere in this project. */
function sentry(yaw = 0): HitboxRig {
  const rig = new HitboxRig(SENTRY_RIG);
  rig.setTransform(0, 0, 0, yaw);
  return rig;
}

type Point = readonly [number, number, number];

/** What a shot from `from` toward `to` hits, or null. */
function shoot(rig: HitboxRig, from: Point, to: Point): RigHit | null {
  const [ox, oy, oz] = from;
  const dx = to[0] - ox;
  const dy = to[1] - oy;
  const dz = to[2] - oz;
  const len = Math.hypot(dx, dy, dz);
  const hit = makeRigHit();
  // Twice the distance so the ray runs through the rig rather than stopping inside it.
  return rig.raycast(ox, oy, oz, dx / len, dy / len, dz / len, len * 2, hit) ? hit : null;
}

const named = (hit: RigHit | null): string | null =>
  hit === null ? null : (SENTRY_RIG.boxes[hit.boxIndex]?.name ?? null);

describe('the sentry silhouette', () => {
  it('is 0.89 m tall, the height of the model', () => {
    // The model measures 0.890 from the feet to the top of the back plate; the layout derives
    // its height from the boxes, so a box that grew past the turret shows up here.
    expect(SENTRY_RIG.height).toBeGreaterThan(0.88);
    expect(SENTRY_RIG.height).toBeLessThan(0.9);
  });

  it('gives bots the receiver to aim at, where the old single box was', () => {
    // `buildLayout` takes `aimY` from the first torso box. Bots aimed at 0.68 before the model
    // arrived and aim at 0.697 now: the same place, for the same reason.
    expect(SENTRY_RIG.aimY).toBeCloseTo(0.697, 3);
  });

  it('counts only the receiver as torso, so the turret did not get cheaper to destroy', () => {
    // The silhouette roughly doubled when it was measured off the model. Every box it gained is
    // structure — stand, jacket, barrel, spade grips — and takes the shooter's limb multiplier.
    const torso = SENTRY_RIG.boxes.filter((b) => b.zone === 'torso');
    expect(torso.map((b) => b.name)).toEqual(['body']);
    expect(SENTRY_RIG.boxes.every((b) => b.zone === 'torso' || b.zone === 'leg')).toBe(true);
    // No head: a turret has none, and head multipliers would kill a 260 HP object to a spray.
    expect(SENTRY_RIG.boxes.some((b) => b.zone === 'head')).toBe(false);
  });
});

describe('a shot at the sentry', () => {
  it('hits the barrel where the barrel is drawn', () => {
    // 0.55 m in front of the mount at barrel height: air under the old rig, which stopped
    // 0.21 m short of the muzzle.
    expect(named(shoot(sentry(), [1.5, 0.722, -0.55], [0, 0.722, -0.55]))).toBe('barrel');
  });

  it('hits the stand across the width the legs are drawn at', () => {
    // 0.3 m off the centre line at ankle height — outside the old 0.36 m box entirely.
    expect(named(shoot(sentry(), [0.3, 0.08, 2], [0.3, 0.08, 0]))).toBe('feet');
  });

  it('hits the receiver from the flank, and that is the torso', () => {
    // From the side, because that is the only bearing where the receiver is the first thing a
    // bullet reaches — see the two tests below.
    const hit = shoot(sentry(), [2, 0.75, 0], [0, 0.75, 0]);
    expect(named(hit)).toBe('body');
    expect(hit?.zone).toBe('torso');
  });

  it('puts the barrel in front of the receiver, head on', () => {
    // Walking into a sentry's arc and firing back at the middle of it hits the gun, not the
    // body behind it, and a limb multiplier is what that costs. The old rig had no barrel at
    // all, so the same shot went straight to the torso.
    expect(named(shoot(sentry(), [0, 0.7, -2], [0, 0.7, 0]))).toBe('barrel');
    expect(named(shoot(sentry(), [0, 0.65, -2], [0, 0.65, 0]))).toBe('jacket');
  });

  it('puts the spade grips in front of the receiver, from behind', () => {
    // The other side of the same fact: flanking a sentry from the rear meets the ammunition
    // box and the grips first. Forward is -Z, so behind it is +Z.
    expect(named(shoot(sentry(), [0, 0.65, 2], [0, 0.65, 0]))).toBe('breech');
  });

  it('misses past the feet, so the box is not wider than the stand', () => {
    // The stand is 0.736 across and the square box is 0.80; half of it is 0.40, so 0.45 is air.
    expect(shoot(sentry(), [0.45, 0.08, 2], [0.45, 0.08, 0])).toBeNull();
  });

  it('misses over the turret', () => {
    expect(shoot(sentry(), [0, 1.2, 2], [0, 1.2, 0])).toBeNull();
  });

  it('carries the barrel round with the traverse, because the rig turns with the gun', () => {
    // `applyPose` gives `HitboxRig` the turret's aim yaw, so a sentry looking 90° left has its
    // barrel boxes 90° left too. This is the half of the one-yaw bargain that works.
    const rig = sentry(Math.PI / 2);
    // Yaw 0 points down -Z; a quarter turn puts the muzzle on -X.
    expect(named(shoot(rig, [-0.55, 0.722, 1.5], [-0.55, 0.722, 0]))).toBe('barrel');
    // And nothing is left in front of where it used to point.
    expect(shoot(rig, [1.5, 0.722, -0.55], [0, 0.722, -0.55])).toBeNull();
  });
});
