import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EQUIPMENT_CONFIG,
  EQUIPMENT_CONFIG_KEYS,
  EQUIPMENT_TUNABLES,
  cloneEquipmentConfig,
  equipmentConfigToSource,
  type EquipmentConfig,
} from './EquipmentConfig';

/**
 * The tuning panel's contract, pinned.
 *
 * The file's claim is that `Record<keyof EquipmentConfig, TunableMeta>` makes a field without a
 * slider a compile error, so the panel cannot drift. The compiler holds one direction of that;
 * what it cannot hold is that every slider's range actually contains the authored default, which
 * is the way this drifts in practice — a number is retuned past the bound its own slider allows
 * and the panel silently clamps it on first touch.
 */

describe('the config and its sliders', () => {
  it('declare the same keys, in the same order', () => {
    expect(EQUIPMENT_CONFIG_KEYS).toEqual(Object.keys(DEFAULT_EQUIPMENT_CONFIG));
    expect([...EQUIPMENT_CONFIG_KEYS].sort()).toEqual(Object.keys(EQUIPMENT_TUNABLES).sort());
  });

  it('give every number a slider whose range contains it', () => {
    for (const key of EQUIPMENT_CONFIG_KEYS) {
      const meta = EQUIPMENT_TUNABLES[key];
      const value = DEFAULT_EQUIPMENT_CONFIG[key];
      expect(meta.min).toBeLessThan(meta.max);
      expect(meta.step).toBeGreaterThan(0);
      expect(value).toBeGreaterThanOrEqual(meta.min);
      expect(value).toBeLessThanOrEqual(meta.max);
    }
  });

  it('group the sliders the way the panel lays them out', () => {
    const groups = new Set(EQUIPMENT_CONFIG_KEYS.map((k) => EQUIPMENT_TUNABLES[k].group));
    expect([...groups]).toEqual(['Throw', 'Warning', 'Flash', 'Smoke', 'Claymore', 'Blast']);
  });
});

describe('a cloned config', () => {
  it('carries every value and shares nothing', () => {
    const copy = cloneEquipmentConfig(DEFAULT_EQUIPMENT_CONFIG);
    expect(copy).toEqual(DEFAULT_EQUIPMENT_CONFIG);
    expect(copy).not.toBe(DEFAULT_EQUIPMENT_CONFIG);
    copy.gravity = 99;
    expect(DEFAULT_EQUIPMENT_CONFIG.gravity).toBe(18);
  });
});

describe('a tuned config written back as source', () => {
  it('is pasteable TypeScript with one line per key, in declaration order', () => {
    const src = equipmentConfigToSource(DEFAULT_EQUIPMENT_CONFIG);
    expect(src.startsWith('export const DEFAULT_EQUIPMENT_CONFIG: EquipmentConfig = {')).toBe(true);
    expect(src.endsWith('};')).toBe(true);
    const order = src
      .split('\n')
      .filter((l) => l.includes(':') && !l.includes('export const'))
      .map((l) => l.trim().split(':')[0]);
    expect(order).toEqual([...EQUIPMENT_CONFIG_KEYS]);
  });

  it('heads each group once, with a blank line between groups', () => {
    const src = equipmentConfigToSource(DEFAULT_EQUIPMENT_CONFIG);
    expect(src).toContain('  // -- throw --');
    expect(src).toContain('  // -- warning --');
    expect(src).toContain('  // -- flash --');
    expect(src).toContain('  // -- smoke --');
    expect(src).toContain('  // -- claymore --');
    expect(src).toContain('  // -- blast --');
    // Six groups, five gaps: the first header has no blank line in front of it.
    expect(src.split('\n').filter((l) => l === '').length).toBe(5);
  });

  it('rounds to four decimals, so a slider drag cannot write a float tail', () => {
    const tuned: EquipmentConfig = { ...DEFAULT_EQUIPMENT_CONFIG, drag: 0.1234567, gravity: 18.5 };
    const src = equipmentConfigToSource(tuned);
    expect(src).toContain('  drag: 0.1235,');
    expect(src).toContain('  gravity: 18.5,');
  });
});
