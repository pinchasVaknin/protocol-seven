import { describe, expect, it } from 'vitest';
import { FOUNDRY_MAP } from './foundry';

/**
 * Foundry, as assembled (refactor A3a).
 *
 * Same reasoning as `depot.test.ts`: one export, built entirely at module load, and the SIM
 * oracles record only this map's spawns. The resupply assertion is the one that guards the
 * load-order trap — `supply` and the two `ammoCrate` props come from statements that mutate
 * arrays the map literal then spreads.
 */

describe('FOUNDRY_MAP', () => {
  it('is the authored identity', () => {
    expect(FOUNDRY_MAP.id).toBe('mp_foundry');
    expect(FOUNDRY_MAP.name).toBe('FOUNDRY');
  });

  it('assembles the counts the whole file exists to produce', () => {
    expect(FOUNDRY_MAP.brushes).toHaveLength(48);
    expect(FOUNDRY_MAP.props).toHaveLength(78);
    expect(FOUNDRY_MAP.spawns).toHaveLength(16);
    expect(FOUNDRY_MAP.lanes).toHaveLength(3);
    expect(FOUNDRY_MAP.objectives).toHaveLength(6);
    expect(FOUNDRY_MAP.coverPoints).toHaveLength(220);
    expect(FOUNDRY_MAP.lights).toHaveLength(4);
  });

  it('carries both resupply stations, which are filled by a side effect before the map is built', () => {
    expect(FOUNDRY_MAP.supply).toEqual([
      { id: 'ammo_w', position: { x: -22, y: 0, z: -10 }, rotationY: 0, radius: 2 },
      { id: 'ammo_e', position: { x: 22, y: 0, z: 10 }, rotationY: Math.PI, radius: 2 },
    ]);
  });

  it('has the two ammo crates in props, spread from the array those statements fill', () => {
    const crates = FOUNDRY_MAP.props.filter((p) => p.shape === 'ammoCrate');

    expect(crates).toEqual([
      { shape: 'ammoCrate', position: { x: -22, y: 0, z: -10 }, rotationY: 0 },
      { shape: 'ammoCrate', position: { x: 22, y: 0, z: 10 }, rotationY: Math.PI },
    ]);
  });

  it('every brush is a solid with three positive extents', () => {
    for (const brush of FOUNDRY_MAP.brushes) {
      expect(brush.size.x).toBeGreaterThan(0);
      expect(brush.size.y).toBeGreaterThan(0);
      expect(brush.size.z).toBeGreaterThan(0);
    }
  });

  it('gives both teams the same number of spawns', () => {
    const a = FOUNDRY_MAP.spawns.filter((s) => s.team === 'A').length;
    const b = FOUNDRY_MAP.spawns.filter((s) => s.team === 'B').length;

    expect(a).toBe(8);
    expect(b).toBe(8);
  });

  it('mirrors every spawn across the origin', () => {
    for (const spawn of FOUNDRY_MAP.spawns) {
      const mirrored = FOUNDRY_MAP.spawns.some(
        (other) =>
          other.team !== spawn.team &&
          Math.abs(other.position.x + spawn.position.x) < 1e-9 &&
          Math.abs(other.position.z + spawn.position.z) < 1e-9,
      );
      expect(mirrored).toBe(true);
    }
  });

  it('names the six objectives both modes read, with unique ids', () => {
    const ids = (FOUNDRY_MAP.objectives ?? []).map((o) => o.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('gives Domination three flags, Search and Destroy two sites and one bomb spawn', () => {
    const kinds = (FOUNDRY_MAP.objectives ?? []).map((o) => o.kind);

    expect(kinds.filter((k) => k === 'flag')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'bombsite')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'bombspawn')).toHaveLength(1);
  });

  it('keeps every prop inside the hall floor', () => {
    for (const prop of FOUNDRY_MAP.props) {
      expect(Math.abs(prop.position.x)).toBeLessThanOrEqual(29);
      expect(Math.abs(prop.position.z)).toBeLessThanOrEqual(25);
    }
  });
});
