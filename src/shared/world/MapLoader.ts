// ========================================== IMPORTS =========================================== \\
//#region Imports
import { ColliderSet } from './ColliderSet';
import { CollisionWorld } from './CollisionWorld';
import { PROP_SHAPES } from './maps/props';
import type { Box, MapDef, SpawnZone } from './maps/types';
import { simCos, simSin } from '../core/SimMath';
//#endregion
/**
 * Turns a `MapDef` into the things the *simulation* needs from a map: the collider set,
 * the spatial hash wrapped in a `CollisionWorld`, the spawn zones and the nav bounds.
 *
 * **M9 split.** Until now this file also built render meshes, assigned materials and
 * placed lights, which is why it is named for loading a map rather than for loading
 * collision. Those three jobs went to `client/world/MapRender.ts`; the collision and nav
 * half stayed, because the server has to load a map and has no renderer to load it into.
 *
 * This is the payoff of the M1 decision to author maps as *data* rather than as scene
 * setup code: nothing here had to be reimplemented, only lifted out from between the
 * mesh-building passes it was interleaved with.
 */

// =========================================== TYPES ============================================ \\
//#region Types
export interface LoadedCollision {
  readonly def: MapDef;
  readonly collision: CollisionWorld;
  readonly spawns: readonly SpawnZone[];
  readonly navBounds: Box;
  readonly stats: CollisionStats;
}

export interface CollisionStats {
  brushes: number;
  props: number;
  colliders: number;
  hashCells: number;
  hashEntries: number;
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Build the collision world for a map.
 *
 * Allocation happens once, at load. The returned `CollisionWorld` is the single structure
 * that serves both the collision broadphase and every gameplay raycast (S4.3).
 */
/**
 * A second view over collision that has already been loaded (M11, S4.19).
 *
 * The collider set and the spatial hash are the expensive, immutable half and are shared; the
 * `CollisionWorld` around them is per-instance because it carries query scratch. See
 * `CollisionWorld.sharing` for why that line is drawn where it is.
 *
 * Everything else in the record is already immutable data off the `MapDef`, so it is passed
 * straight through rather than copied.
 */
export function shareMapCollision(baked: LoadedCollision): LoadedCollision {
  return {
    ...baked,
    collision: CollisionWorld.sharing(baked.collision.colliders, baked.collision.hash),
  };
}

export function loadMapCollision(def: MapDef): LoadedCollision {
  const colliders = new ColliderSet(countSolidParts(def) + 8);
  addBrushColliders(colliders, def);
  addPropColliders(colliders, def);

  const collision = new CollisionWorld(colliders, def.navBounds, 4);
  const [dx, dy, dz] = collision.hash.dimensions;

  return {
    def,
    collision,
    spawns: def.spawns,
    navBounds: def.navBounds,
    stats: {
      brushes: def.brushes.length,
      props: def.props.length,
      colliders: colliders.count,
      hashCells: dx * dy * dz,
      hashEntries: collision.hash.itemCount,
    },
  };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * How many colliders the map needs, counted before any are made.
 *
 * The two defaults are deliberately opposite and both halves of the load read them the same way:
 * a brush with no `solid` flag **is** solid, and a prop part with no `solid` flag is **not**. A
 * count that disagreed with the fill would either throw mid-load or quietly waste the set.
 */
function countSolidParts(def: MapDef): number {
  const solidBrushes = def.brushes.filter((b) => b.solid !== false).length;
  let solidPropParts = 0;
  for (const p of def.props) {
    const shape = PROP_SHAPES[p.shape];
    for (const part of shape.parts) if (part.solid) solidPropParts++;
  }
  return solidBrushes + solidPropParts;
}

/** Every solid brush, with all three of its rotations. */
function addBrushColliders(colliders: ColliderSet, def: MapDef): void {
  for (const brush of def.brushes) {
    if (brush.solid === false) continue;
    colliders.add(
      brush.position,
      brush.size,
      brush.rotationY,
      brush.rotationX ?? 0,
      brush.rotationZ ?? 0,
      brush.material,
    );
  }
}

/**
 * Every solid part of every prop placement, with its local offset turned by the placement yaw.
 *
 * One scratch record for the whole walk: a map has thousands of parts and this runs at load,
 * where an allocation per part is the kind of thing that shows up as a hitch on the first frame.
 */
function addPropColliders(colliders: ColliderSet, def: MapDef): void {
  const worldOffset = { x: 0, y: 0, z: 0 };
  for (const placement of def.props) {
    const shape = PROP_SHAPES[placement.shape];
    const c = simCos(placement.rotationY);
    const s = simSin(placement.rotationY);
    for (const part of shape.parts) {
      if (!part.solid) continue;
      worldOffset.x = placement.position.x + part.offset.x * c + part.offset.z * s;
      worldOffset.y = placement.position.y + part.offset.y;
      worldOffset.z = placement.position.z - part.offset.x * s + part.offset.z * c;
      colliders.add(worldOffset, part.size, placement.rotationY, 0, 0, part.material);
    }
  }
}
//#endregion
