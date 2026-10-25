import { describe, expect, it } from 'vitest';
import {
  CAMERA_CONFIG_KEYS,
  CAMERA_TUNABLES,
  cameraConfigToSource,
  DEFAULT_CAMERA_CONFIG,
  FOV_MAX,
  FOV_MIN,
} from './CameraConfig';

/**
 * The camera's tuning table (brief S5.4), pinned before unit C1's refactor.
 *
 * `cameraConfigToSource` is what the tuning panel's copy-to-clipboard button produces, so it is
 * pasted back into this very file: the exact text, the group comments and the four-decimal
 * rounding are the behaviour, not a formatting detail.
 */

describe('the shipped defaults', () => {
  it('lists every key of the config, in declaration order', () => {
    expect(CAMERA_CONFIG_KEYS).toEqual([
      'fov',
      'viewmodelFov',
      'fovSprintAdd',
      'fovTacSprintAdd',
      'fovSlideAdd',
      'fovAdsScale',
      'fovRate',
      'bobAmplitude',
      'bobLateralScale',
      'bobRefSpeed',
      'bobRollDeg',
      'landDipMax',
      'landDipRefSpeed',
      'landDipSpring',
      'landDipDamping',
      'slideRollDeg',
      'strafeRollDeg',
      'rollRate',
      'shakeDecay',
      'shakeYawDeg',
      'shakePitchDeg',
      'shakeRollDeg',
      'shakeFrequency',
    ]);
  });

  it('gives every key a slider, and the world FOV the slider the menu advertises', () => {
    for (const key of CAMERA_CONFIG_KEYS) {
      const meta = CAMERA_TUNABLES[key];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.max).toBeGreaterThan(meta.min);
    }
    expect(FOV_MIN).toBe(60);
    expect(FOV_MAX).toBe(120);
    expect(CAMERA_TUNABLES.fov.min).toBe(FOV_MIN);
    expect(CAMERA_TUNABLES.fov.max).toBe(FOV_MAX);
    expect(DEFAULT_CAMERA_CONFIG.fov).toBeGreaterThanOrEqual(FOV_MIN);
    expect(DEFAULT_CAMERA_CONFIG.fov).toBeLessThanOrEqual(FOV_MAX);
  });
});

describe('cameraConfigToSource', () => {
  it('round-trips the defaults to the literal this file ships', () => {
    expect(cameraConfigToSource(DEFAULT_CAMERA_CONFIG)).toBe(
      [
        'export const DEFAULT_CAMERA_CONFIG: CameraConfig = {',
        '  // -- camera --',
        '  fov: 90,',
        '  viewmodelFov: 65,',
        '  fovSprintAdd: 5,',
        '  fovTacSprintAdd: 11,',
        '  fovSlideAdd: 13,',
        '  fovAdsScale: 0.74,',
        '  fovRate: 9,',
        '',
        '  // -- bob --',
        '  bobAmplitude: 0.032,',
        '  bobLateralScale: 0.65,',
        '  bobRefSpeed: 6.9,',
        '  bobRollDeg: 0.45,',
        '',
        '  // -- landing --',
        '  landDipMax: 0.15,',
        '  landDipRefSpeed: 12,',
        '  landDipSpring: 95,',
        '  landDipDamping: 13,',
        '',
        '  // -- roll --',
        '  slideRollDeg: 4.5,',
        '  strafeRollDeg: 0.9,',
        '  rollRate: 9,',
        '',
        '  // -- shake --',
        '  shakeDecay: 3.4,',
        '  shakeYawDeg: 1.1,',
        '  shakePitchDeg: 1.1,',
        '  shakeRollDeg: 1.6,',
        '  shakeFrequency: 6.1,',
        '};',
      ].join('\n'),
    );
  });

  it('rounds to four decimals, and prints a rounded-away sign as plain zero', () => {
    const lines = cameraConfigToSource({
      ...DEFAULT_CAMERA_CONFIG,
      fov: 90.000049,
      bobAmplitude: 0.03255551,
      shakeFrequency: -0.00004,
    }).split('\n');
    expect(lines).toContain('  fov: 90,');
    expect(lines).toContain('  bobAmplitude: 0.0326,');
    expect(lines).toContain('  shakeFrequency: 0,');
  });

  it('opens a group only when the group changes, and never with a leading blank line', () => {
    const lines = cameraConfigToSource(DEFAULT_CAMERA_CONFIG).split('\n');
    expect(lines[1]).toBe('  // -- camera --');
    expect(lines.filter((l) => l.startsWith('  // -- '))).toHaveLength(5);
    // One blank line before each group but the first, and none anywhere else.
    expect(lines.filter((l) => l === '')).toHaveLength(4);
  });
});
