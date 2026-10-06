import { describe, expect, it } from 'vitest';
import { DEPOT_MAP } from './depot';
import type { MapDef } from './types';

/**
 * Depot, as assembled (refactor A3a).
 *
 * These four map files have no tests and one export each — a `MapDef` built entirely at module
 * load, out of side-effecting calls and derived constants. That makes them the files where a
 * reordering refactor can do the most damage with the least noise, and the SIM oracles do not
 * cover all of it: `content.txt` records each map's **spawns** and nothing else, so a change
 * that silently dropped every brush and prop on the map would pass the oracle.
 *
 * ## The assertion that earns its place
 *
 * `supply` and the two `ammoCrate` props are filled by two `addSupplyPoint(...)` **statements**
 * that mutate arrays declared empty above them, and `props` then **spreads** one of those
 * arrays. Put those statements after the map literal — which is where a careless reading of
 * the section order would put them — and the two resupply stations vanish from the map with
 * nothing to say so. Pinned here because the oracle would not have caught it.
 */

/** Every brush describes a solid: no zero extent, no negative one. */
function assertBrushesAreSolids(map: MapDef): void {
  for (const brush of map.brushes) {
    expect(brush.size.x).toBeGreaterThan(0);
    expect(brush.size.y).toBeGreaterThan(0);
    expect(brush.size.z).toBeGreaterThan(0);
  }
}

describe('DEPOT_MAP', () => {
  it('is the authored identity', () => {
    expect(DEPOT_MAP.id).toBe('mp_depot');
    expect(DEPOT_MAP.name).toBe('DEPOT');
  });

  it('assembles the counts the whole file exists to produce', () => {
    expect(DEPOT_MAP.brushes).toHaveLength(50);
    expect(DEPOT_MAP.props).toHaveLength(86);
    expect(DEPOT_MAP.spawns).toHaveLength(18);
    expect(DEPOT_MAP.lanes).toHaveLength(3);
    expect(DEPOT_MAP.objectives).toHaveLength(6);
    expect(DEPOT_MAP.coverPoints).toHaveLength(172);
    expect(DEPOT_MAP.lights).toHaveLength(8);
  });

  it('carries both resupply stations, which are filled by a side effect before the map is built', () => {
    expect(DEPOT_MAP.supply).toEqual([
      { id: 'ammo_w', position: { x: -26, y: 0, z: 6 }, rotationY: 0, radius: 2 },
      { id: 'ammo_e', position: { x: 26, y: 0, z: -6 }, rotationY: Math.PI, radius: 2 },
    ]);
  });

  it('has the two ammo crates in props, spread from the array those statements fill', () => {
    const crates = DEPOT_MAP.props.filter((p) => p.shape === 'ammoCrate');

    expect(crates).toEqual([
      { shape: 'ammoCrate', position: { x: -26, y: 0, z: 6 }, rotationY: 0 },
      { shape: 'ammoCrate', position: { x: 26, y: 0, z: -6 }, rotationY: Math.PI },
    ]);
  });

  it('places one station per side, each at the mirror of the other', () => {
    const [west, east] = DEPOT_MAP.supply ?? [];

    expect(west?.position.x).toBe(-(east?.position.x ?? 0));
    expect(west?.position.z).toBe(-(east?.position.z ?? 0));
  });

  it('every brush is a solid with three positive extents', () => {
    assertBrushesAreSolids(DEPOT_MAP);
  });

  it('gives both teams the same number of spawns, because the yard is mirrored', () => {
    const a = DEPOT_MAP.spawns.filter((s) => s.team === 'A').length;
    const b = DEPOT_MAP.spawns.filter((s) => s.team === 'B').length;

    expect(a).toBe(9);
    expect(b).toBe(9);
    expect(a + b).toBe(DEPOT_MAP.spawns.length);
  });

  it('mirrors every spawn across the origin, which is what rotateHalfSpawns is for', () => {
    for (const spawn of DEPOT_MAP.spawns) {
      const mirrored = DEPOT_MAP.spawns.some(
        (other) =>
          other.team !== spawn.team &&
          Math.abs(other.position.x + spawn.position.x) < 1e-9 &&
          Math.abs(other.position.z + spawn.position.z) < 1e-9,
      );
      expect(mirrored).toBe(true);
    }
  });

  it('names the six objectives both modes read, with unique ids', () => {
    const ids = (DEPOT_MAP.objectives ?? []).map((o) => o.id);

    expect(ids).toEqual(['dom_a', 'dom_b', 'dom_c', 'snd_a', 'snd_b', 'snd_bomb']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives Domination three flags, Search and Destroy two sites and one bomb spawn', () => {
    const kinds = (DEPOT_MAP.objectives ?? []).map((o) => o.kind);

    expect(kinds.filter((k) => k === 'flag')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'bombsite')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'bombspawn')).toHaveLength(1);
  });

  it('keeps every prop inside the yard shell', () => {
    for (const prop of DEPOT_MAP.props) {
      expect(Math.abs(prop.position.x)).toBeLessThanOrEqual(30);
      expect(Math.abs(prop.position.z)).toBeLessThanOrEqual(33);
    }
  });

  it('runs its lane audit at import: three lanes, and nothing in them', () => {
    // auditLanes() throws from module scope, so reaching this line at all is the assertion.
    // It is spelled out rather than left implicit because the audit is the file's own gate.
    expect(DEPOT_MAP.lanes?.map((l) => l.name)).toHaveLength(3);
  });
});
