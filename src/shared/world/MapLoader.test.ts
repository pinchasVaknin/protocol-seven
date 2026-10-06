import { describe, expect, it } from 'vitest';
import { loadMapCollision, shareMapCollision } from './MapLoader';
import { PROP_SHAPES } from './maps/props';
import type { MapDef } from './maps/types';

/**
 * Turning an authored map into collision.
 *
 * The counting is the part worth pinning. The collider set is sized up front from how many
 * solid brushes and solid prop parts the map has, and then filled — so if the count and the fill
 * ever disagree the set either throws mid-load or silently wastes space. Both halves read
 * `solid`, and they have to read it the same way: `brush.solid !== false` for a brush, which
 * means an absent flag is solid, and `part.solid` for a prop part, which means an absent flag is
 * not. The two defaults are opposite, which is exactly the kind of thing a refactor flattens by
 * accident.
 */

const BOX = { x: 2, y: 2, z: 2 };

function mapWith(over: Partial<MapDef> = {}): MapDef {
  return {
    id: 'mp_test',
    name: 'TEST',
    brushes: [],
    props: [],
    spawns: [],
    navBounds: { min: { x: -20, y: -8, z: -20 }, max: { x: 20, y: 12, z: 20 } },
    ...over,
  } as MapDef;
}

/** How many parts of a shape are solid, read off the catalogue rather than hard-coded. */
function solidPartsOf(shape: keyof typeof PROP_SHAPES): number {
  return PROP_SHAPES[shape].parts.filter((p) => p.solid).length;
}

describe('loadMapCollision', () => {
  it('loads an empty map into an empty collider set', () => {
    const loaded = loadMapCollision(mapWith());

    expect(loaded.collision.colliders.count).toBe(0);
    expect(loaded.stats.brushes).toBe(0);
    expect(loaded.stats.props).toBe(0);
    expect(loaded.stats.colliders).toBe(0);
  });

  it('makes one collider per solid brush', () => {
    const loaded = loadMapCollision(
      mapWith({
        brushes: [
          { position: { x: 0, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'concrete' },
          { position: { x: 4, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'metal' },
        ],
      }),
    );

    expect(loaded.collision.colliders.count).toBe(2);
    expect(loaded.stats.colliders).toBe(2);
  });

  it('treats a brush with no solid flag as solid, and skips one flagged false', () => {
    const loaded = loadMapCollision(
      mapWith({
        brushes: [
          { position: { x: 0, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'concrete' },
          { position: { x: 4, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'hazard', solid: false },
          { position: { x: 8, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'metal', solid: true },
        ],
      }),
    );

    expect(loaded.collision.colliders.count).toBe(2);
    // The brush count in the stats is every brush, solid or not: it describes the map.
    expect(loaded.stats.brushes).toBe(3);
  });

  it('makes one collider per solid part of each prop placement', () => {
    const loaded = loadMapCollision(
      mapWith({ props: [{ shape: 'crate', position: { x: 0, y: 0, z: 0 }, rotationY: 0 }] }),
    );

    expect(loaded.collision.colliders.count).toBe(solidPartsOf('crate'));
    expect(loaded.stats.props).toBe(1);
  });

  it('skips the parts of a prop that are trim rather than solid', () => {
    const crate = PROP_SHAPES.crate;

    expect(crate.parts.length).toBeGreaterThan(solidPartsOf('crate'));
  });

  it('counts brushes and prop parts together', () => {
    const loaded = loadMapCollision(
      mapWith({
        brushes: [{ position: { x: 0, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'concrete' }],
        props: [
          { shape: 'crate', position: { x: 4, y: 0, z: 0 }, rotationY: 0 },
          { shape: 'pillar', position: { x: 8, y: 0, z: 0 }, rotationY: 0 },
        ],
      }),
    );

    expect(loaded.collision.colliders.count).toBe(1 + solidPartsOf('crate') + solidPartsOf('pillar'));
  });

  it('carries the brush rotations onto the collider', () => {
    const loaded = loadMapCollision(
      mapWith({
        brushes: [
          { position: { x: 0, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'concrete' },
          {
            position: { x: 4, y: 0, z: 0 },
            size: BOX,
            rotationY: 0.5,
            rotationX: 0.1,
            material: 'concrete',
          },
        ],
      }),
    );

    expect(loaded.collision.colliders.isAxisAligned(0)).toBe(true);
    expect(loaded.collision.colliders.isAxisAligned(1)).toBe(false);
  });

  it('rotates a prop part offset by the placement yaw', () => {
    const shape = PROP_SHAPES.crate;
    const offset = shape.parts.find((p) => p.solid)?.offset ?? { x: 0, y: 0, z: 0 };

    const straight = loadMapCollision(
      mapWith({ props: [{ shape: 'crate', position: { x: 0, y: 0, z: 0 }, rotationY: 0 }] }),
    );
    const turned = loadMapCollision(
      mapWith({ props: [{ shape: 'crate', position: { x: 0, y: 0, z: 0 }, rotationY: Math.PI }] }),
    );

    // A half turn negates the horizontal offset and leaves the vertical one alone.
    expect(turned.collision.colliders.centerX(0)).toBeCloseTo(-straight.collision.colliders.centerX(0), 5);
    expect(turned.collision.colliders.centerY(0)).toBeCloseTo(straight.collision.colliders.centerY(0), 5);
    expect(offset).toBeDefined();
  });

  it('places a prop part at the placement position plus its own offset', () => {
    const loaded = loadMapCollision(
      mapWith({ props: [{ shape: 'crate', position: { x: 7, y: 0, z: -3 }, rotationY: 0 }] }),
    );
    const first = PROP_SHAPES.crate.parts.find((p) => p.solid);

    expect(loaded.collision.colliders.centerX(0)).toBeCloseTo(7 + (first?.offset.x ?? 0), 5);
    expect(loaded.collision.colliders.centerZ(0)).toBeCloseTo(-3 + (first?.offset.z ?? 0), 5);
  });

  it('reports grid statistics alongside the colliders', () => {
    const loaded = loadMapCollision(
      mapWith({
        brushes: [{ position: { x: 0, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'concrete' }],
      }),
    );

    expect(loaded.stats.hashCells).toBeGreaterThan(0);
    expect(loaded.stats.hashEntries).toBeGreaterThan(0);
  });

  it('passes the spawns and the nav bounds through untouched', () => {
    const def = mapWith({
      spawns: [{ team: 'A', position: { x: 1, y: 0, z: 2 }, facingYaw: 0, radius: 3 }],
    });
    const loaded = loadMapCollision(def);

    expect(loaded.spawns).toBe(def.spawns);
    expect(loaded.navBounds).toBe(def.navBounds);
    expect(loaded.def).toBe(def);
  });

  it('leaves spare capacity, so a map on the boundary does not throw', () => {
    const loaded = loadMapCollision(
      mapWith({
        brushes: [{ position: { x: 0, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'concrete' }],
      }),
    );

    expect(loaded.collision.colliders.capacity).toBeGreaterThan(loaded.collision.colliders.count);
  });
});

describe('shareMapCollision', () => {
  it('reuses the baked collider set and grid rather than rebuilding them', () => {
    const baked = loadMapCollision(
      mapWith({
        brushes: [{ position: { x: 0, y: 0, z: 0 }, size: BOX, rotationY: 0, material: 'concrete' }],
      }),
    );
    const shared = shareMapCollision(baked);

    expect(shared.collision.colliders).toBe(baked.collision.colliders);
    expect(shared.collision.hash).toBe(baked.collision.hash);
    expect(shared.collision).not.toBe(baked.collision);
  });

  it('keeps everything else the baked load produced', () => {
    const baked = loadMapCollision(mapWith());
    const shared = shareMapCollision(baked);

    expect(shared.def).toBe(baked.def);
    expect(shared.spawns).toBe(baked.spawns);
    expect(shared.stats).toEqual(baked.stats);
  });
});
