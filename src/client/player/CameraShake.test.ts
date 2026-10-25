import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA_CONFIG, type CameraConfig } from './CameraConfig';
import { CameraShake } from './CameraShake';

/**
 * The additive shake channel (brief S5.4), pinned before unit C1's refactor.
 *
 * Pure arithmetic over a config, so it is tested here in full: the trauma ledger, the squared
 * amplitude, the linear decay, and the three summed sines. The numbers below were taken from
 * the tree as it stood; `toBe` rather than `toBeCloseTo` because a shake that drifts by an ulp
 * is a shake somebody re-derived.
 */

function cfg(overrides: Partial<CameraConfig> = {}): CameraConfig {
  return { ...DEFAULT_CAMERA_CONFIG, ...overrides };
}

describe('CameraShake.add', () => {
  it('accumulates and clamps at one, so overlapping hits do not stack forever', () => {
    const shake = new CameraShake();
    shake.add(0.25);
    expect(shake.trauma).toBe(0.25);
    shake.add(0.5);
    expect(shake.trauma).toBe(0.75);
    shake.add(0.5);
    expect(shake.trauma).toBe(1);
    shake.add(4);
    expect(shake.trauma).toBe(1);
  });

  it('clamps a negative amount at zero rather than going under', () => {
    const shake = new CameraShake();
    shake.add(0.4);
    shake.add(-10);
    expect(shake.trauma).toBe(0);
  });
});

describe('CameraShake.update', () => {
  it('zeroes the three angles and advances nothing while there is no trauma', () => {
    const shake = new CameraShake();
    shake.yaw = 1;
    shake.pitch = 1;
    shake.roll = 1;
    shake.update(cfg(), 0.016);
    expect(shake.yaw).toBe(0);
    expect(shake.pitch).toBe(0);
    expect(shake.roll).toBe(0);
    expect(shake.trauma).toBe(0);
  });

  it('does not advance its clock on an idle frame: the first loud frame is the same either way', () => {
    const idled = new CameraShake();
    idled.update(cfg(), 0.5);
    idled.update(cfg(), 0.5);
    idled.add(1);
    idled.update(cfg(), 0.1);

    const fresh = new CameraShake();
    fresh.add(1);
    fresh.update(cfg(), 0.1);

    expect(idled.yaw).toBe(fresh.yaw);
    expect(idled.pitch).toBe(fresh.pitch);
    expect(idled.roll).toBe(fresh.roll);
  });

  it('decays trauma linearly by the config rate, and never past zero', () => {
    const shake = new CameraShake();
    shake.add(1);
    shake.update(cfg({ shakeDecay: 3.4 }), 0.1);
    expect(shake.trauma).toBe(1 - 3.4 * 0.1);
    shake.update(cfg({ shakeDecay: 3.4 }), 10);
    expect(shake.trauma).toBe(0);
  });

  it('scales the three angles by trauma squared, so a small nudge stays subtle', () => {
    const still = cfg({ shakeDecay: 0 });
    const full = new CameraShake();
    full.add(1);
    full.update(still, 0.1);
    const half = new CameraShake();
    half.add(0.5);
    half.update(still, 0.1);
    // Same time, same frequencies: only the squared amplitude differs, by exactly four.
    expect(full.yaw).toBe(half.yaw * 4);
    expect(full.pitch).toBe(half.pitch * 4);
    expect(full.roll).toBe(half.roll * 4);
  });

  it('is frame-rate independent: one step of 0.2 lands where two of 0.1 do', () => {
    const still = cfg({ shakeDecay: 0 });
    const one = new CameraShake();
    one.add(1);
    one.update(still, 0.2);
    const two = new CameraShake();
    two.add(1);
    two.update(still, 0.1);
    two.update(still, 0.1);
    expect(two.yaw).toBe(one.yaw);
    expect(two.pitch).toBe(one.pitch);
    expect(two.roll).toBe(one.roll);
  });

  it('holds the shipped curve, value for value', () => {
    const shake = new CameraShake();
    shake.add(1);
    shake.update(cfg(), 0.1);
    expect(shake.yaw).toBe(-0.0033316298677656974);
    expect(shake.pitch).toBe(-0.001628592328047588);
    expect(shake.roll).toBe(0.01029872866633296);
    shake.update(cfg(), 0.1);
    expect(shake.trauma).toBe(0.3199999999999999);
    expect(shake.yaw).toBe(0.0010376814426711382);
    expect(shake.pitch).toBe(-0.00075689447571231);
    expect(shake.roll).toBe(-0.00045333906004260465);
  });
});

describe('CameraShake.reset', () => {
  it('clears the ledger, the angles and the clock', () => {
    const shake = new CameraShake();
    shake.add(1);
    shake.update(cfg(), 0.3);
    shake.reset();
    expect(shake.trauma).toBe(0);
    expect(shake.yaw).toBe(0);
    expect(shake.pitch).toBe(0);
    expect(shake.roll).toBe(0);

    // The clock went with it: a fresh instance driven the same way agrees.
    shake.add(1);
    shake.update(cfg(), 0.1);
    const fresh = new CameraShake();
    fresh.add(1);
    fresh.update(cfg(), 0.1);
    expect(shake.yaw).toBe(fresh.yaw);
  });
});
