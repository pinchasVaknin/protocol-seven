import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import { DEG2RAD, RAD2DEG } from '../core/MathUtil';
import { Rng } from '../core/Rng';
import { BotBlackboard } from './BotBlackboard';
import { CombatBehaviour } from './CombatBehaviour';
import { DEFAULT_TIERS } from './DifficultyTiers';
import { weaponProfileFor } from './WeaponProfile';

/**
 * How a bot aims and when it pulls the trigger — pinned.
 *
 * The rule S6.4 exists to enforce is that **bots must never be pixel-perfect**, and the way
 * this file gets there is by never letting the bot aim at the target at all: it aims at an
 * error point that orbits the target and shrinks. So the three properties worth holding still
 * are the three stages of that error.
 *
 * **The opening rounds are wrong on purpose.** `onContact` snaps the error to the *edge* of the
 * tier's first-burst cone — not inside it, on it — which is the miss-first-burst rule and what
 * turns "I died to a bot" into "I got shot at, and then I died".
 *
 * **It converges.** Accuracy improves the longer a bot holds you, which is the shape a human
 * tracking someone has.
 *
 * **The trigger is gated on the aim having arrived.** A bot spraying at a wall halfway through
 * a turn looks broken, and is broken; and the aim is slew-limited, so a Veteran cannot answer a
 * shot in the back instantly.
 */

const TIER = DEFAULT_TIERS.REGULAR;
const AR = weaponProfileFor('AR');
const SHOTGUN = weaponProfileFor('SHOTGUN');
const SNIPER = weaponProfileFor('SNIPER');

/** A blackboard that has seen a target `range` metres down -Z, at eye height. */
function believing(range = 20, vx = 0, vz = 0): BotBlackboard {
  const bb = new BotBlackboard();
  bb.noteSighting(2, 0, 1.6, -range, 0, range, 0.1);
  bb.lastKnownVx = vx;
  bb.lastKnownVz = vz;
  bb.armReaction(0);
  return bb;
}

/** A behaviour already looking down -Z, which is yaw 0. */
function aiming(): CombatBehaviour {
  const cb = new CombatBehaviour();
  cb.reset(0, 0);
  return cb;
}

/** Slew the aim until it stops moving, and say how many ticks it took. */
function settle(cb: CombatBehaviour, bb: BotBlackboard, ticks: number, rng = new Rng(7)): void {
  for (let i = 0; i < ticks; i++) cb.updateAim(TIER, bb, 0, 1.6, 0, rng);
}

describe('a fresh behaviour', () => {
  it('holds the angles it was reset to and wants nothing', () => {
    const cb = new CombatBehaviour();
    cb.reset(1.25, -0.2);
    expect(cb.aimYaw).toBe(1.25);
    expect(cb.aimPitch).toBe(-0.2);
    expect(cb.wantsFire).toBe(false);
    expect(cb.wantsAds).toBe(false);
    expect(cb.aimErrorDeg).toBe(0);
    expect(cb.aimOffSolutionDeg).toBe(0);
    expect(cb.burstRemaining).toBe(0);
  });
});

describe('a fresh contact', () => {
  it('snaps the error to the edge of the first-burst cone, not inside it', () => {
    const cb = aiming();
    cb.onContact(TIER, new Rng(11));
    cb.updateAim(TIER, believing(), 0, 1.6, 0, new Rng(11));
    // On the cone rather than in the middle of it, which is what makes the opening rounds
    // deliberately wide. A hair inside after one tick, because that same tick redraws the
    // wander point and damps a step toward it.
    expect(cb.aimErrorDeg).toBeGreaterThan(TIER.firstBurstConeDeg * 0.95);
    expect(cb.aimErrorDeg).toBeLessThanOrEqual(TIER.firstBurstConeDeg);
    // And wider than the cone it will settle into, which is the whole shape of the rule.
    expect(TIER.firstBurstConeDeg).toBeGreaterThan(TIER.aimConeDeg);
    expect(cb.aimErrorDeg).toBeGreaterThan(TIER.aimConeDeg);
  });

  it('arms a burst of the tier length', () => {
    const cb = aiming();
    cb.onContact(TIER, new Rng(11));
    expect(cb.burstRemaining).toBeGreaterThanOrEqual(Math.round(TIER.burstMin));
    expect(cb.burstRemaining).toBeLessThanOrEqual(Math.round(TIER.burstMax));
  });

  it('puts the error somewhere different each time, either side of the target', () => {
    const seen = new Set<string>();
    let left = 0;
    let right = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const cb = aiming();
      cb.onContact(TIER, new Rng(seed));
      cb.updateAim(TIER, believing(), 0, 1.6, 0, new Rng(seed));
      seen.add(cb.aimYaw.toFixed(6));
      if (cb.aimYaw > 0) right++;
      if (cb.aimYaw < 0) left++;
    }
    // Several distinct openings rather than one, and the slew limit clamps the first tick of
    // the widest of them — so the count is well under twelve and both directions appear.
    expect(seen.size).toBeGreaterThan(2);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });
});

describe('the aim error over a held contact', () => {
  it('converges, so accuracy improves the longer a bot holds you', () => {
    const cb = aiming();
    const bb = believing();
    cb.onContact(TIER, new Rng(3));
    settle(cb, bb, 1);
    const opening = cb.aimErrorDeg;
    settle(cb, bb, 180);
    expect(cb.aimErrorDeg).toBeLessThan(opening);
  });

  it('settles inside a cone the tier widened for range, not inside the bare one', () => {
    const near = aiming();
    const nearBb = believing(5);
    settle(near, nearBb, 300);

    const far = aiming();
    const farBb = believing(60);
    settle(far, farBb, 300);

    // The M5 playtest note: bots felt too accurate at long distances.
    expect(TIER.rangeErrorPerTenM).toBeGreaterThan(0);
    expect(far.aimErrorDeg).toBeGreaterThan(near.aimErrorDeg);
  });

  it('widens for a moving target, in proportion to how fast it moves', () => {
    const still = aiming();
    settle(still, believing(20, 0, 0), 300);

    const running = aiming();
    settle(running, believing(20, 8, 0), 300);
    expect(running.aimErrorDeg).toBeGreaterThan(still.aimErrorDeg);
  });

  it('leads a moving target, by a fraction of the correct amount', () => {
    const cb = aiming();
    const bb = believing(20, 6, 0);
    settle(cb, bb, 400);
    // Led toward +x, so the view yaw moves off the straight-line solution.
    expect(TIER.leadFraction).toBeGreaterThan(0);
    expect(TIER.leadFraction).toBeLessThan(1);
    expect(Math.abs(cb.aimYaw)).toBeGreaterThan(0);
  });

  it('clamps the speed it assumes at the slide-cancel ceiling', () => {
    const fast = aiming();
    settle(fast, believing(20, 8.2, 0), 300);
    const absurd = aiming();
    settle(absurd, believing(20, 400, 0), 300);
    // S6.4 permits assuming M1's 8.2 m/s ceiling; past it nothing changes.
    expect(absurd.aimYaw).toBeCloseTo(fast.aimYaw, 6);
  });
});

describe('the slew limit', () => {
  it('never turns faster than the tier rate', () => {
    const cb = aiming();
    // A target directly behind: the furthest a bot can be asked to turn.
    const bb = new BotBlackboard();
    bb.noteSighting(2, 0, 1.6, 20, 0, 20, 0.1);
    const maxStepDeg = TIER.turnRateDeg * DT;
    let previous = cb.aimYaw;
    for (let i = 0; i < 40; i++) {
      cb.updateAim(TIER, bb, 0, 1.6, 0, new Rng(5));
      const stepDeg = Math.abs(cb.aimYaw - previous) * RAD2DEG;
      expect(stepDeg).toBeLessThanOrEqual(maxStepDeg + 1e-9);
      previous = cb.aimYaw;
    }
  });

  it('arrives eventually, inside the gate the trigger reads it against', () => {
    const cb = aiming();
    const bb = believing(20);
    settle(cb, bb, 400);
    // Not zero: the aim tracks the deliberate error point, so what is left once the turning
    // has finished is that error. What matters is that it settles well inside the 11 degree
    // fire gate, which is what lets the bot shoot at all.
    expect(cb.aimOffSolutionDeg).toBeGreaterThan(0);
    expect(cb.aimOffSolutionDeg).toBeLessThan(11);
  });

  it('never pitches past vertical', () => {
    const cb = aiming();
    const bb = new BotBlackboard();
    // A target directly overhead.
    bb.noteSighting(2, 0, 90, 0, 0, 90, 0.1);
    settle(cb, bb, 600);
    expect(cb.aimPitch).toBeLessThanOrEqual(89 * DEG2RAD + 1e-9);
  });
});

describe('looking at something that is not a target', () => {
  it('turns toward it, slew-limited the same way, with no deliberate error', () => {
    const cb = aiming();
    const maxStepDeg = TIER.turnRateDeg * DT;
    cb.lookToward(TIER, Math.PI * 0.5, 0);
    expect(Math.abs(cb.aimYaw) * RAD2DEG).toBeLessThanOrEqual(maxStepDeg + 1e-9);
    expect(cb.aimErrorDeg).toBe(0);
    expect(cb.aimOffSolutionDeg).toBeGreaterThan(0);

    for (let i = 0; i < 400; i++) cb.lookToward(TIER, Math.PI * 0.5, 0);
    expect(cb.aimYaw).toBeCloseTo(Math.PI * 0.5, 6);
    expect(cb.aimOffSolutionDeg).toBeCloseTo(0, 6);
  });
});

describe('trigger discipline', () => {
  /** A behaviour that has finished turning onto a target `range` away. */
  function ready(range = 20): { cb: CombatBehaviour; bb: BotBlackboard } {
    const cb = aiming();
    const bb = believing(range);
    cb.onContact(TIER, new Rng(3));
    settle(cb, bb, 500);
    return { cb, bb };
  }

  it('fires once everything it is waiting for has happened', () => {
    const { cb, bb } = ready();
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, 20, true);
    expect(cb.wantsFire).toBe(true);
  });

  it('never fires before the reaction delay has been paid', () => {
    const { cb, bb } = ready();
    bb.armReaction(1);
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, 20, true);
    expect(cb.wantsFire).toBe(false);
  });

  it('never fires without a line', () => {
    const { cb, bb } = ready();
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, 20, false);
    expect(cb.wantsFire).toBe(false);
  });

  it('never fires when the weapon refuses — a reload, a sprint-out', () => {
    const { cb, bb } = ready();
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, false, 20, true);
    expect(cb.wantsFire).toBe(false);
  });

  it('never fires beyond the engage range the weapon scales', () => {
    const { cb, bb } = ready();
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, TIER.engageRange + 5, true);
    expect(cb.wantsFire).toBe(false);
  });

  it('holds a shotgun until the target is close enough for pellets to matter', () => {
    const { cb, bb } = ready();
    const lane = TIER.engageRange * 0.8;
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, lane, true);
    expect(cb.wantsFire).toBe(true);
    cb.updateTrigger(TIER, SHOTGUN, bb, new Rng(2), 30, true, lane, true);
    expect(cb.wantsFire).toBe(false);
  });

  it('never fires while the aim is still swinging', () => {
    const cb = aiming();
    const bb = new BotBlackboard();
    bb.noteSighting(2, 0, 1.6, 20, 0, 20, 0.1);
    bb.armReaction(0);
    cb.updateAim(TIER, bb, 0, 1.6, 0, new Rng(5));
    expect(cb.aimOffSolutionDeg).toBeGreaterThan(11);
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, 20, true);
    expect(cb.wantsFire).toBe(false);
  });

  it('counts the burst out of the magazine, so it is rounds at any fire rate', () => {
    const { cb, bb } = ready();
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, 20, true);
    const opening = cb.burstRemaining;
    expect(opening).toBeGreaterThan(0);
    // Three rounds left the magazine.
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 27, true, 20, true);
    expect(cb.burstRemaining).toBe(opening - 3);
  });

  it('spends a burst of the tier length, then pauses before the next one', () => {
    const { cb, bb } = ready();
    // One round leaves the magazine for each tick the bot asked to fire, which is how the
    // burst is counted out: a burst is a number of rounds and stays that at any fire rate.
    let mag = 30;
    let fired = 0;
    for (let i = 0; i < 24; i++) {
      cb.updateTrigger(TIER, AR, bb, new Rng(2), mag, true, 20, true);
      if (!cb.wantsFire) break;
      mag--;
      fired++;
    }
    expect(fired).toBeGreaterThanOrEqual(Math.round(TIER.burstMin));
    expect(fired).toBeLessThanOrEqual(Math.round(TIER.burstMax));
    expect(cb.wantsFire).toBe(false);

    // The pause has to run out before anything fires again, with the magazine steady.
    cb.updateTrigger(TIER, AR, bb, new Rng(2), mag, true, 20, true);
    expect(cb.wantsFire).toBe(false);
    for (let i = 0; i < 120; i++) cb.updateTrigger(TIER, AR, bb, new Rng(2), mag, true, 20, true);
    expect(cb.wantsFire).toBe(true);
  });

  it('raises the sights by the tier range, scaled by the weapon', () => {
    const { cb, bb } = ready();
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, TIER.adsRange + 1, true);
    expect(cb.wantsAds).toBe(true);
    cb.updateTrigger(TIER, AR, bb, new Rng(2), 30, true, TIER.adsRange - 1, true);
    expect(cb.wantsAds).toBe(false);

    // A sniper aims from almost the moment it has a line; a shotgun never bothers.
    const close = TIER.adsRange * 0.3;
    cb.updateTrigger(TIER, SNIPER, bb, new Rng(2), 30, true, close, true);
    expect(cb.wantsAds).toBe(true);
    cb.updateTrigger(TIER, SHOTGUN, bb, new Rng(2), 30, true, close, true);
    expect(cb.wantsAds).toBe(false);
  });

  it('never raises the sights without a line', () => {
    const { cb, bb } = ready();
    cb.updateTrigger(TIER, SNIPER, bb, new Rng(2), 30, true, 40, false);
    expect(cb.wantsAds).toBe(false);
  });
});

describe('the weapon recoil', () => {
  it('reaches the bot view exactly as it reaches the player', () => {
    const cb = aiming();
    cb.applyRecoilResidual(0.02, 0.05);
    expect(cb.aimYaw).toBe(0.02);
    expect(cb.aimPitch).toBe(0.05);
  });

  it('cannot push the pitch past vertical', () => {
    const cb = aiming();
    for (let i = 0; i < 400; i++) cb.applyRecoilResidual(0, 0.1);
    expect(cb.aimPitch).toBeLessThanOrEqual(89 * DEG2RAD + 1e-9);
  });
});

describe('a reset mid-fight', () => {
  it('drops the error, the burst and the intent', () => {
    const { cb, bb } = (() => {
      const made = aiming();
      const board = believing();
      made.onContact(TIER, new Rng(3));
      settle(made, board, 20);
      made.updateTrigger(TIER, AR, board, new Rng(2), 30, true, 20, true);
      return { cb: made, bb: board };
    })();
    expect(bb.hasKnownTarget).toBe(true);
    cb.reset(0, 0);
    expect(cb.aimErrorDeg).toBe(0);
    expect(cb.burstRemaining).toBe(0);
    expect(cb.wantsFire).toBe(false);
    expect(cb.wantsAds).toBe(false);
  });
});
