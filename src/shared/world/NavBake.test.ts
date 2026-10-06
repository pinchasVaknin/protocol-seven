import { describe, expect, it } from 'vitest';
import { navBakeOptionsFor } from '../ai/BotDirector';
import { installClock } from '../core/Clock';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { loadMapCollision } from './MapLoader';
import { bakeNavmesh, samplePatrolCells } from './NavBake';
import type { NavGrid } from './NavGrid';
import { DEPOT_MAP } from './maps/depot';
import { GREYBOX_MAP } from './maps/greybox';
import type { MapDef } from './maps/types';

/**
 * The navmesh bake, pinned on two real maps.
 *
 * Nothing in the game asks the bake a question directly — it runs once at load, and every bot
 * for the rest of the match reads the graph it left behind. A bake that changed by one cell
 * would surface as bots taking a different corner three minutes later, and `npm run hashrun`
 * would call it a determinism failure without saying where. This is the test that says where.
 *
 * **Why two maps.** Greybox is the single-layer case the bake was written for: one floor, no
 * mantles, no stacked columns. Depot is the only map that asks for `navClimb` and for three
 * layers, so it is the only one that exercises the climb window, the drop window and a column
 * carrying a container roof over a yard. Between them every branch of the bake runs.
 *
 * **Why a fingerprint rather than cell-by-cell assertions.** Depot bakes 53,760 nodes. The
 * `stats` are the shape of the graph and are readable on their own; the fingerprint is the
 * contents, weighted by index so that moving a value from one cell to another changes it. A
 * change that reorders the column walk, drops a link or shifts a surface by a float fails
 * here, which is the class of mistake this code is most at risk of.
 */

let fakeNow = 0;
// The bake times itself off the clock. Installed before the describe bodies bake, which vitest
// runs at collection time.
installClock({ nowMs: () => fakeNow++ });

function bake(def: MapDef): NavGrid {
  const collision = loadMapCollision(def);
  return bakeNavmesh(collision.collision, def.navBounds, navBakeOptionsFor(def, DEFAULT_MOVEMENT_CONFIG));
}

/**
 * Every value in the baked graph, as four numbers.
 *
 * Three of the sums are weighted by a function of the node index, so two cells swapping their
 * values is a different fingerprint where an unweighted sum would not notice. `height` is
 * summed raw, which pins the surface floats to their last bit.
 */
function fingerprint(nav: NavGrid): Record<string, number> {
  let links = 0;
  let climb = 0;
  let linkLayer = 0;
  let height = 0;
  for (let i = 0; i < nav.cellCount; i++) {
    links += (nav.links[i] ?? 0) * ((i % 7) + 1);
    climb += (nav.climb[i] ?? 0) * ((i % 5) + 1);
    linkLayer += nav.linkLayer[i] ?? 0;
    height += nav.height[i] ?? 0;
  }
  return { links, climb, linkLayer, height };
}

/** How many columns ended up carrying at least `atLeast` walkable surfaces. */
function columnsWithLayers(nav: NavGrid, atLeast: number): number {
  let found = 0;
  for (let column = 0; column < nav.columnCount; column++) {
    let walkable = 0;
    for (let layer = 0; layer < nav.layers; layer++) {
      if (nav.walkable[layer * nav.columnCount + column] === 1) walkable++;
    }
    if (walkable >= atLeast) found++;
  }
  return found;
}

function walkableNodes(nav: NavGrid): number {
  let walkable = 0;
  for (let i = 0; i < nav.cellCount; i++) if (nav.walkable[i] === 1) walkable++;
  return walkable;
}

describe('baking the navmesh on Greybox', () => {
  const nav = bake(GREYBOX_MAP);

  it('covers navBounds at the cell size, two layers deep', () => {
    expect([nav.dimX, nav.dimZ, nav.layers]).toEqual([104, 80, 2]);
    expect(nav.columnCount).toBe(104 * 80);
    expect(nav.cellCount).toBe(104 * 80 * 2);
    expect(nav.stats.cells).toBe(nav.cellCount);
  });

  it('finds the same graph it has always found', () => {
    expect(nav.stats.cells).toBe(16640);
    expect(nav.stats.walkable).toBe(5373);
    expect(nav.stats.pruned).toBe(1338);
    expect(nav.stats.links).toBe(39226);
    expect(nav.stats.stacked).toBe(0);
    expect(nav.stats.climbLinks).toBe(0);
    expect(fingerprint(nav)).toEqual({
      links: 4845636,
      climb: 0,
      linkLayer: 0,
      height: 5274.150013640523,
    });
  });

  it('stacks no column and offers no mantle, because the grey box has neither', () => {
    expect(columnsWithLayers(nav, 2)).toBe(0);
    // Every link therefore lands on layer 0, which is what a zero `linkLayer` word means.
    expect(fingerprint(nav).linkLayer).toBe(0);
  });

  it('leaves the walkable array agreeing with the count it reports', () => {
    // `stats.walkable` is decremented by the prune, so the array is the authority on both.
    expect(walkableNodes(nav)).toBe(nav.stats.walkable);
    expect(nav.stats.pruned).toBeGreaterThan(0);
  });

  it('scatters patrol destinations on the lattice, every one of them reachable', () => {
    const patrol = samplePatrolCells(nav, 7);
    expect(Array.from(patrol)).toEqual([
      735, 749, 763, 777, 791, 805, 819, 2190, 2309, 2323, 2337, 2351, 2261, 2275, 3647, 3661,
      3675, 3703, 3717, 3731, 5103, 5117, 5131, 5145, 5159, 5173, 4979, 6559, 6573, 6587, 6601,
      6615, 6629, 6747, 7703, 7717, 7731, 7745, 7759, 7773, 7787, 5432, 5439, 5446,
    ]);
    // Taken from the pruned grid: a patrol goal A* cannot solve is a bot standing still.
    for (const node of patrol) expect(nav.walkable[node]).toBe(1);
    expect(new Set(patrol).size).toBe(patrol.length);
  });
});

describe('baking the navmesh on Depot', () => {
  const nav = bake(DEPOT_MAP);

  it('honours the map own layer count and its opt-in to mantles', () => {
    expect(DEPOT_MAP.navLayers).toBe(3);
    expect(DEPOT_MAP.navClimb).toBe(true);
    expect([nav.dimX, nav.dimZ, nav.layers]).toEqual([128, 140, 3]);
  });

  it('finds the same graph it has always found, mantles included', () => {
    expect(nav.stats.cells).toBe(53760);
    expect(nav.stats.walkable).toBe(13616);
    expect(nav.stats.pruned).toBe(3876);
    expect(nav.stats.links).toBe(101016);
    expect(nav.stats.stacked).toBe(1810);
    expect(nav.stats.climbLinks).toBe(98);
    expect(fingerprint(nav)).toEqual({
      links: 12544359,
      climb: 957,
      linkLayer: 7632205,
      height: 27915.434393167496,
    });
    expect(walkableNodes(nav)).toBe(nav.stats.walkable);
  });

  it('stacks the yard under the container roofs, and never finds a third surface', () => {
    // 430 columns still carry two surfaces once the prune has run. Asking for three layers is
    // what *allows* a third, and on the shipped geometry no column has one — pinned because it
    // is a fact about the map a reader would otherwise have to bake to learn.
    expect(columnsWithLayers(nav, 2)).toBe(430);
    expect(columnsWithLayers(nav, 3)).toBe(0);
    // Pins current behaviour; suspected bug: NavBakeStats.stacked is never adjusted by the
    // reachability prune. `walkable` is decremented and `links` is recounted, so `stacked`
    // alone still reports the 1,810 columns phase 1 found, including the 1,380 whose upper
    // surface was then thrown away as unreachable.
    expect(nav.stats.stacked).toBe(1810);
    expect(nav.stats.stacked).toBeGreaterThan(columnsWithLayers(nav, 2));
  });

  it('marks a mantle as a link and as a climb, never as a climb alone', () => {
    let climbs = 0;
    for (let i = 0; i < nav.cellCount; i++) {
      const climb = nav.climb[i] ?? 0;
      const links = nav.links[i] ?? 0;
      // A climb is an edge in the graph first: A* must be able to see it without knowing how.
      expect(climb & ~links).toBe(0);
      // Every climb is a straight-on approach, so no climb bit may sit in the diagonal nibble.
      expect(climb & 0xf0).toBe(0);
      for (let d = 0; d < 8; d++) if ((climb & (1 << d)) !== 0) climbs++;
    }
    expect(climbs).toBe(nav.stats.climbLinks);
    expect(climbs).toBe(98);
  });

  it('samples the elevated routes as well as the floor', () => {
    const patrol = samplePatrolCells(nav, 7);
    expect(patrol.length).toBe(103);
    expect(Array.from(patrol).slice(0, 9)).toEqual([903, 917, 931, 945, 959, 973, 989, 1001, 887]);
    expect(Array.from(patrol).reduce((sum, node) => sum + node, 0)).toBe(975188);
    for (const node of patrol) expect(nav.walkable[node]).toBe(1);
    expect(new Set(patrol).size).toBe(patrol.length);
    // The tail of the scatter is the fine pass, which only takes surfaces off the ground.
    expect(Array.from(patrol).filter((node) => (nav.height[node] ?? 0) >= 1).length).toBe(17);
  });

  it('spaces the lattice by the metres it is asked for', () => {
    // 7 m at 0.5 m cells is a stride of 14, so a coarser spacing can only take fewer points.
    expect(samplePatrolCells(nav, 14).length).toBeLessThan(samplePatrolCells(nav, 7).length);
    expect(samplePatrolCells(nav, 0).length).toBeGreaterThan(samplePatrolCells(nav, 7).length);
  });
});
