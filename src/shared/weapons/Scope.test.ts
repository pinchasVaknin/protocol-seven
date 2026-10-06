import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import { ScopeState } from './Scope';
import { AR_DEFAULT, requireWeapon } from './WeaponDefs';

/**
 * The sniper scope: breath sway, the hold, and the glint.
 *
 * The sway is **two sines at incommensurate rates**, and that is the whole mechanic: one sine
 * is a pendulum a player learns to fire at the ends of within a minute, and two at a ratio that
 * never repeats inside a scope-in produce a wandering figure that has to be corrected. A change
 * that made the second a harmonic of the first would turn the mechanic back into a metronome
 * and nothing would fail.
 *
 * The sway is applied to the **aim**, not to the picture, so these numbers are where the rounds
 * go. `WeaponSystem` adds them into the same channel recoil's offset rides in.
 */

const SNIPER = requireWeapon('sniper_kestrel');

/** Ticks of scope, aimed and either holding or not. */
function hold(scope: ScopeState, seconds: number, holding = false, ads = 1): void {
  const ticks = Math.round(seconds / DT);
  for (let tick = 0; tick < ticks; tick++) scope.step(SNIPER, ads, holding);
}

describe('the shipped scope profile', () => {
  it('is the Kestrel\'s, and it glints', () => {
    expect(SNIPER.scope).toEqual({
      swayDeg: 0.55,
      swayRate: 0.42,
      breathSeconds: 3.2,
      breathRecovery: 4.5,
      breathHoldScale: 0.08,
      magnification: 4.5,
      glint: true,
    });
  });
});

describe('a fresh scope', () => {
  it('is down, steady and with a full lungful', () => {
    const scope = new ScopeState();
    expect(scope.swayYaw).toBe(0);
    expect(scope.swayPitch).toBe(0);
    expect(scope.breath).toBe(1);
    expect(scope.holding).toBe(false);
    expect(scope.isScoped).toBe(false);
  });
});

describe('the sway', () => {
  it('wanders on two rates that do not repeat', () => {
    const scope = new ScopeState();
    const sways: string[] = [];
    for (let tick = 0; tick < 6; tick++) {
      scope.step(SNIPER, 1, false);
      sways.push(`${scope.swayYaw.toFixed(6)}/${scope.swayPitch.toFixed(6)}`);
    }
    expect(sways).toEqual([
      '0.024182/0.330902',
      '0.048318/0.332993',
      '0.072360/0.334844',
      '0.096263/0.336453',
      '0.119979/0.337821',
      '0.143463/0.338946',
    ]);
    expect(scope.isScoped).toBe(true);
    // Not holding, so the lungful is untouched.
    expect(scope.breath).toBe(1);
  });

  it('is two sines at a ratio that is not a harmonic', () => {
    // 0.61 of the yaw rate, phase-shifted: the pitch and the yaw never come back into step
    // inside a scope-in, which is what makes the figure wander rather than swing.
    const scope = new ScopeState();
    let sameSign = 0;
    for (let tick = 0; tick < 600; tick++) {
      scope.step(SNIPER, 1, false);
      if (Math.sign(scope.swayYaw) === Math.sign(scope.swayPitch)) sameSign++;
    }
    // A single sine for both would make this 600. A harmonic would make it 0 or 600.
    expect(sameSign).toBeGreaterThan(100);
    expect(sameSign).toBeLessThan(500);
  });

  it('arrives with the sight picture rather than snapping on at the end', () => {
    const quarter = new ScopeState();
    quarter.step(SNIPER, 0.25, false);
    const full = new ScopeState();
    full.step(SNIPER, 1, false);
    // Scaled by `adsFraction`, so the wobble comes up with the scope.
    expect(Math.abs(quarter.swayPitch)).toBeLessThan(Math.abs(full.swayPitch));
    expect(Math.abs(quarter.swayPitch)).toBeCloseTo(Math.abs(full.swayPitch) * 0.25, 9);
  });

  it('stays inside the authored amplitude', () => {
    const scope = new ScopeState();
    const sway = SNIPER.scope?.swayDeg ?? 0;
    for (let tick = 0; tick < 1200; tick++) {
      scope.step(SNIPER, 1, false);
      // Fatigue can add 45% as the breath runs down, and nothing is holding it here.
      expect(Math.abs(scope.swayYaw)).toBeLessThanOrEqual(sway * 1.45 + 1e-9);
      expect(Math.abs(scope.swayPitch)).toBeLessThanOrEqual(sway * 1.45 * 0.62 + 1e-9);
    }
  });
});

describe('holding the breath', () => {
  it('damps the sway down over two tenths rather than switching it off', () => {
    const scope = new ScopeState();
    hold(scope, 0.2, false);
    const before = Math.abs(scope.swayYaw);
    hold(scope, 0.5, true);
    expect(scope.holding).toBe(true);
    // 0.08 of the amplitude once the blend is in, which is a held breath and not a frozen one.
    expect(Math.abs(scope.swayYaw)).toBeLessThan(before * 0.5);
  });

  it('spends the lungful while it is held and gives it back when it is not', () => {
    const scope = new ScopeState();
    hold(scope, 0.5, true);
    expect(scope.breath).toBe(0.8437499999999989);
    expect(scope.breath).toBeLessThan(1);
    const spent = scope.breath;
    hold(scope, 1, false);
    expect(scope.breath).toBeGreaterThan(spent);
    // Recovery is slower than the spend: 4.5 s against 3.2.
    expect(SNIPER.scope?.breathRecovery).toBeGreaterThan(SNIPER.scope?.breathSeconds ?? 0);
  });

  it('runs out, and the last of the air is the worst of the shake', () => {
    const scope = new ScopeState();
    hold(scope, 3.2, true);
    expect(scope.breath).toBe(0);
    // The meter is something you watch rather than something you spend: as it empties, the
    // fatigue term grows, so the sway at empty is worse than the sway at full.
    const empty = new ScopeState();
    empty.breath = 0;
    empty.step(SNIPER, 1, false);
    const fresh = new ScopeState();
    fresh.step(SNIPER, 1, false);
    expect(Math.abs(empty.swayPitch)).toBeGreaterThan(Math.abs(fresh.swayPitch));
    // 45% worse at empty, less the frame of air the reading tick already gave back — which
    // is the recovery doing its job, so the factor is 1.4483 rather than 1.45.
    expect(Math.abs(empty.swayPitch) / Math.abs(fresh.swayPitch)).toBeCloseTo(1.4483, 4);
  });

  it('cannot be held without a sight picture', () => {
    const scope = new ScopeState();
    scope.step(SNIPER, 0.4, true);
    expect(scope.isScoped).toBe(false);
    expect(scope.holding).toBe(false);
    expect(scope.breath).toBe(1);
  });
});

describe('a weapon with no scope', () => {
  it('has no sway, is never scoped, and still gets its breath back', () => {
    const scope = new ScopeState();
    scope.breath = 0.5;
    scope.step(AR_DEFAULT, 1, true);
    expect(scope.swayYaw).toBe(0);
    expect(scope.swayPitch).toBe(0);
    expect(scope.isScoped).toBe(false);
    expect(scope.holding).toBe(false);
    // Swapping off a sniper and back must not hand you an empty meter.
    expect(scope.breath).toBe(0.5055555555555555);
  });
});

describe('the glint', () => {
  it('is a property of the scope being up, not of firing', () => {
    expect(ScopeState.glinting(SNIPER, 0.9)).toBe(true);
    expect(ScopeState.glinting(SNIPER, 0.8)).toBe(false);
    // Holding an angle costs you something before you pull the trigger — and only on a
    // weapon whose profile says it glints.
    expect(ScopeState.glinting(AR_DEFAULT, 1)).toBe(false);
  });
});

describe('resetting', () => {
  it('puts the scope away and the lungful back', () => {
    const scope = new ScopeState();
    hold(scope, 2, true);
    scope.reset();
    expect(scope.swayYaw).toBe(0);
    expect(scope.swayPitch).toBe(0);
    expect(scope.breath).toBe(1);
    expect(scope.holding).toBe(false);
    expect(scope.isScoped).toBe(false);
    // And the phase with it, so a fresh scope-in starts where a fresh one starts.
    scope.step(SNIPER, 1, false);
    const fresh = new ScopeState();
    fresh.step(SNIPER, 1, false);
    expect(scope.swayYaw).toBe(fresh.swayYaw);
  });
});
