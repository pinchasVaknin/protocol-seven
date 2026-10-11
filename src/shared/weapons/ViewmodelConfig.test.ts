import { describe, expect, it } from 'vitest';
import {
  cloneViewmodelConfig,
  DEFAULT_VIEWMODEL_CONFIG,
  viewmodelConfigToSource,
  VIEWMODEL_CONFIG_KEYS,
  VIEWMODEL_TUNABLES,
} from './ViewmodelConfig';

/**
 * Every number the gun in your hands is posed by.
 *
 * Fifty-one of them, all tuned by eye through the F1 panel and pasted back as source — which
 * makes the serialiser part of how the file is edited rather than a convenience. A paste that
 * dropped a key or printed `0.30000000000000004` would be a pose nobody could reproduce, so
 * the output is pinned exactly.
 *
 * The `Record<keyof ViewmodelConfig, TunableMeta>` type is what keeps the panel honest: adding
 * a field without a slider is a compile error. What it cannot check is that the shipped value
 * is *inside* the slider, and that is the assertion below.
 */

describe('the viewmodel config', () => {
  it('is the fifty-one numbers the pose is made of', () => {
    expect(VIEWMODEL_CONFIG_KEYS.length).toBe(51);
    // Derived from the config by `Object.keys`, so the array and the record cannot diverge.
    expect(VIEWMODEL_CONFIG_KEYS).toEqual(Object.keys(DEFAULT_VIEWMODEL_CONFIG));
    expect(Object.keys(VIEWMODEL_TUNABLES).sort()).toEqual([...VIEWMODEL_CONFIG_KEYS].sort());
  });

  it('gives every key a usable slider, with the shipped value inside it', () => {
    const outside: string[] = [];
    for (const key of VIEWMODEL_CONFIG_KEYS) {
      const meta = VIEWMODEL_TUNABLES[key];
      expect(meta.label.length, key).toBeGreaterThan(0);
      expect(meta.min, key).toBeLessThan(meta.max);
      expect(meta.step, key).toBeGreaterThan(0);
      const value = DEFAULT_VIEWMODEL_CONFIG[key];
      if (value < meta.min || value > meta.max) outside.push(`${key}=${value} [${meta.min},${meta.max}]`);
    }
    // Unlike the weapon table, every one of these is inside its own range.
    expect(outside).toEqual([]);
  });

  it('lays the sliders out in contiguous groups', () => {
    const groups: string[] = [];
    for (const key of VIEWMODEL_CONFIG_KEYS) {
      const group = VIEWMODEL_TUNABLES[key].group;
      if (groups[groups.length - 1] !== group) groups.push(group);
    }
    expect(new Set(groups).size).toBe(groups.length);
  });
});

describe('cloning it', () => {
  it('is a flat copy, because the config is flat', () => {
    const clone = cloneViewmodelConfig(DEFAULT_VIEWMODEL_CONFIG);
    expect(clone).not.toBe(DEFAULT_VIEWMODEL_CONFIG);
    expect(clone).toEqual(DEFAULT_VIEWMODEL_CONFIG);
    clone.hipX = 99;
    // The default is a module singleton the whole client poses against.
    expect(DEFAULT_VIEWMODEL_CONFIG.hipX).toBe(0.152);
  });
});

describe('serialising it back to source', () => {
  it('emits the shipped pose exactly as it is pasted back', () => {
    expect(viewmodelConfigToSource(DEFAULT_VIEWMODEL_CONFIG)).toBe(
      [
        'export const DEFAULT_VIEWMODEL_CONFIG: ViewmodelConfig = {',
        '  // -- hip pose --',
        '  hipX: 0.152,',
        '  hipY: -0.132,',
        '  hipZ: -0.33,',
        '  hipPitch: 1.2,',
        '  hipYaw: -4.5,',
        '  hipRoll: 1.6,',
        '',
        '  // -- ads pose --',
        '  adsY: -0.0925,',
        '  adsZ: -0.275,',
        '  adsOvershoot: 0.14,',
        '',
        '  // -- sprint pose --',
        '  sprintX: 0.2,',
        '  sprintY: -0.2,',
        '  sprintZ: -0.29,',
        '  sprintPitch: -13,',
        '  sprintYaw: -26,',
        '  sprintRoll: 17,',
        '  tacSprintExtraY: -0.07,',
        '  tacSprintExtraPitch: -12,',
        '  slideExtraY: -0.05,',
        '  slideExtraRoll: 9,',
        '',
        '  // -- swap pose --',
        '  swapX: 0.02,',
        '  swapY: -0.32,',
        '  swapZ: 0.06,',
        '  swapPitch: -34,',
        '  swapRoll: 16,',
        '',
        '  // -- sway --',
        '  swayPosition: 0.028,',
        '  swayRotation: 2.4,',
        '  swayMax: 0.05,',
        '  swayRate: 11,',
        '  swayAdsScale: 0.28,',
        '',
        '  // -- bob --',
        '  bobAmount: 0.011,',
        '  bobLateral: 0.017,',
        '  bobRoll: 0.9,',
        '  bobAdsScale: 0.22,',
        '  idleAmplitude: 0.0032,',
        '  idleHz: 0.31,',
        '',
        '  // -- kick --',
        '  kickBack: 0.026,',
        '  kickUp: 0.008,',
        '  kickPitch: 1.35,',
        '  kickRoll: 0.5,',
        '  kickLateral: 0.012,',
        '  kickAdsScale: 0,',
        '',
        '  // -- reload --',
        '  reloadDropY: -0.115,',
        '  reloadDropZ: 0.045,',
        '  reloadPitch: -19,',
        '  reloadRoll: 22,',
        '  reloadYaw: 13,',
        '  magThrow: 0.22,',
        '  chargeThrow: 0.055,',
        '',
        '  // -- muzzle --',
        '  muzzleRight: 0.17,',
        '  muzzleUp: -0.11,',
        '  muzzleForward: 0.62,',
        '};',
      ].join('\n'),
    );
  });

  it('emits a line for every key, so a paste loses nothing', () => {
    const source = viewmodelConfigToSource(DEFAULT_VIEWMODEL_CONFIG);
    for (const key of VIEWMODEL_CONFIG_KEYS) {
      expect(source, key).toContain(`  ${key}: `);
    }
  });

  it('rounds to five places, so a dragged slider does not paste a float artefact', () => {
    // Five rather than the weapon table's four: `idleAmplitude` ships at 0.0032 and the
    // sway numbers are of that size, so a fourth-place rounding would quantise them.
    const cfg = cloneViewmodelConfig(DEFAULT_VIEWMODEL_CONFIG);
    cfg.hipX = 0.1 + 0.2;
    expect(viewmodelConfigToSource(cfg)).toContain('  hipX: 0.3,');
    cfg.hipX = 1 / 3;
    expect(viewmodelConfigToSource(cfg)).toContain('  hipX: 0.33333,');
  });
});
