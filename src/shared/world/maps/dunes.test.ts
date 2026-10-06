import { describe, expect, it } from 'vitest';
import { DUNES_MAP } from './dunes';

/**
 * Dunes, as assembled (refactor A3a).
 *
 * Same reasoning as `depot.test.ts`: one export, built entirely at module load, and the SIM
 * oracles record only this map's spawns. The resupply assertion is the one that guards the
 * load-order trap — `supply` and the two `ammoCrate` props come from statements that mutate
 * arrays the map literal then spreads.
 */

describe('DUNES_MAP', () => {
  it('is the authored identity', () => {
    expect(DUNES_MAP.id).toBe('mp_dunes');
    expect(DUNES_MAP.name).toBe('DUNES');
  });

  it('assembles the counts the whole file exists to produce', () => {
    expect(DUNES_MAP.brushes).toHaveLength(109);
    expect(DUNES_MAP.props).toHaveLength(62);
    expect(DUNES_MAP.spawns).toHaveLength(18);
    expect(DUNES_MAP.lanes).toHaveLength(3);
    expect(DUNES_MAP.objectives).toHaveLength(6);
    expect(DUNES_MAP.coverPoints).toHaveLength(164);
    expect(DUNES_MAP.lights).toHaveLength(2);
  });

  it('carries both resupply stations, which are filled by a side effect before the map is built', () => {
    expect(DUNES_MAP.supply).toEqual([
      { id: 'ammo_w', position: { x: -18, y: 0, z: 6 }, rotationY: 0, radius: 2 },
      { id: 'ammo_e', position: { x: 18, y: 0, z: -6 }, rotationY: Math.PI, radius: 2 },
    ]);
  });

  it('has the two ammo crates in props, spread from the array those statements fill', () => {
    const crates = DUNES_MAP.props.filter((p) => p.shape === 'ammoCrate');

    expect(crates).toEqual([
      { shape: 'ammoCrate', position: { x: -18, y: 0, z: 6 }, rotationY: 0 },
      { shape: 'ammoCrate', position: { x: 18, y: 0, z: -6 }, rotationY: Math.PI },
    ]);
  });

  it('every brush is a solid with three positive extents', () => {
    for (const brush of DUNES_MAP.brushes) {
      expect(brush.size.x).toBeGreaterThan(0);
      expect(brush.size.y).toBeGreaterThan(0);
      expect(brush.size.z).toBeGreaterThan(0);
    }
  });

  it('gives both teams the same number of spawns', () => {
    const a = DUNES_MAP.spawns.filter((s) => s.team === 'A').length;
    const b = DUNES_MAP.spawns.filter((s) => s.team === 'B').length;

    expect(a).toBe(9);
    expect(b).toBe(9);
  });

  it('mirrors every spawn across the origin', () => {
    for (const spawn of DUNES_MAP.spawns) {
      const mirrored = DUNES_MAP.spawns.some(
        (other) =>
          other.team !== spawn.team &&
          Math.abs(other.position.x + spawn.position.x) < 1e-9 &&
          Math.abs(other.position.z + spawn.position.z) < 1e-9,
      );
      expect(mirrored).toBe(true);
    }
  });

  it('names the six objectives both modes read, with unique ids', () => {
    const ids = (DUNES_MAP.objectives ?? []).map((o) => o.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it('gives Domination three flags, Search and Destroy two sites and one bomb spawn', () => {
    const kinds = (DUNES_MAP.objectives ?? []).map((o) => o.kind);

    expect(kinds.filter((k) => k === 'flag')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'bombsite')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'bombspawn')).toHaveLength(1);
  });

  it('keeps every prop inside the village floor', () => {
    for (const prop of DUNES_MAP.props) {
      expect(Math.abs(prop.position.x)).toBeLessThanOrEqual(32);
      expect(Math.abs(prop.position.z)).toBeLessThanOrEqual(38);
    }
  });
});
