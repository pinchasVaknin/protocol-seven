/**
 * Baking the navmesh out of map geometry at load (brief S6.5).
 *
 * Nothing here knows anything about maps. It asks the collision world what is in each
 * vertical column, reduces that to the set of surfaces a capsule can actually stand on,
 * links the ones movement can actually get between, and throws away whatever the spawns
 * cannot reach. A map therefore needs no nav authoring at all — only honest `navBounds`,
 * because the bake walks that volume.
 *
 * The interval analysis is the part worth reading: casting a single ray down from the
 * ceiling finds the *topmost* surface, which is sometimes the top of an overhang the player
 * walks under. Instead every collider in the column becomes a `[bottom, top]` interval,
 * overlaps are merged, and **every** merged surface with standing headroom is a candidate
 * floor — lowest first. That is what gives a catwalk deck and the floor beneath it two
 * separate nodes instead of one wrong one.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { nowMs } from '../core/Clock';
import type { CollisionWorld } from './CollisionWorld';
import { makeRayHit, rayBox, rayBoxExit } from './Geometry';
import {
  DIAGONAL_DEPS,
  NAV_DIRS,
  NAV_MAX_LAYERS,
  NavGrid,
  type NavBakeOptions,
  type NavBakeStats,
} from './NavGrid';
import type { Box, Vec3Lit } from './maps/types';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * How far above the found surface the clearance capsule is placed.
 *
 * A capsule resting exactly on a sloped surface intersects it: the bottom sphere's centre
 * is `radius` above the contact point vertically, but only `radius * cos(theta)` along the
 * surface normal. On the 46 degree limit that is a 0.11 m overlap, which would mark every
 * ramp cell unwalkable. Lifting past the worst case costs a little headroom strictness and
 * buys correct ramps.
 */
const NAV_LIFT = 0.12;

/** Colliders considered in one vertical column. Well past anything a map stacks. */
const MAX_COLUMN = 96;

/** Above this, a walkable surface is a route rather than floor, and is sampled finer. */
const ELEVATED_METRES = 1.0;

const columnCandidates = new Int32Array(512);
const intervalLo = new Float64Array(MAX_COLUMN);
const intervalHi = new Float64Array(MAX_COLUMN);
const intervalNy = new Float64Array(MAX_COLUMN);
const intervalOrder = new Int32Array(MAX_COLUMN);
const columnRay = makeRayHit();

/** Standable surfaces found in the current column, lowest first. Sized to the ceiling. */
const surfaceY = new Float64Array(NAV_MAX_LAYERS);
const surfaceNy = new Float64Array(NAV_MAX_LAYERS);
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function bakeNavmesh(world: CollisionWorld, bounds: Box, opts: NavBakeOptions): NavGrid {
  const t0 = nowMs();
  const layers = Math.max(1, Math.min(NAV_MAX_LAYERS, Math.floor(opts.layers)));
  const cs = opts.cellSize;
  const originX = Math.floor(bounds.min.x / cs) * cs;
  const originZ = Math.floor(bounds.min.z / cs) * cs;
  const dimX = Math.max(1, Math.ceil((bounds.max.x - originX) / cs));
  const dimZ = Math.max(1, Math.ceil((bounds.max.z - originZ) / cs));

  const stats: NavBakeStats = {
    cells: dimX * dimZ * layers,
    walkable: 0,
    pruned: 0,
    links: 0,
    bakeMs: 0,
    stacked: 0,
    climbLinks: 0,
  };
  const grid = new NavGrid(cs, originX, originZ, dimX, dimZ, layers, stats);

  markStandableColumns(world, grid, bounds, opts);
  linkGrid(grid, opts);

  stats.pruned = pruneUnreachable(grid, opts.seeds);
  if (stats.pruned > 0) {
    // Links pointed at nodes that no longer exist; rebuild rather than patch.
    stats.walkable -= stats.pruned;
    grid.links.fill(0);
    grid.climb.fill(0);
    grid.linkLayer.fill(0);
    linkGrid(grid, opts);
  }

  recordLinkCounts(grid);
  stats.bakeMs = nowMs() - t0;
  return grid;
}

/**
 * A coarse scatter of walkable nodes, for patrol destinations.
 *
 * Sampled on a lattice rather than chosen at random so the points are spread rather than
 * clumped, and taken from the *pruned* grid so every one of them is reachable — a patrol goal
 * A* cannot solve is a bot standing still.
 *
 * **Elevated nodes are sampled at half the stride.** A ground floor is an *area* and a coarse
 * lattice describes it well; a catwalk is a *route* three metres wide, and the same lattice
 * walks straight past most of it. Measured on Foundry: the even lattice put 6 of 77 patrol
 * points on the deck, patrolling is about 5% of what a bot does in a firefight, and across
 * eighteen simulated minutes no bot went up at all. Density has to follow the route, not the
 * floor plan.
 *
 * M4 keyed that off the layer index, and M8's Depot showed why that was the wrong key: a
 * container roof sits in a column whose ground is *solid container*, so the roof is the
 * lowest standable surface there and lands on **layer 0**. Ninety-two roof cells were being
 * sampled at the coarse ground stride and almost all of them missed. Height is the property
 * that actually matters, so height is what is asked.
 */
export function samplePatrolCells(grid: NavGrid, spacingMetres: number): Int32Array {
  const baseStride = Math.max(1, Math.round(spacingMetres / grid.cellSize));
  const fineStride = Math.max(1, Math.round(baseStride / 2));
  const found: number[] = [];
  const taken = new Set<number>();

  sampleGroundLattice(grid, baseStride, found, taken);
  // Second, finer pass over anything off the ground, whichever layer it landed on.
  sampleElevatedLattice(grid, fineStride, found, taken);
  return Int32Array.from(found);
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Every column's standable surfaces, and whether a body actually fits on each of them.
 *
 * One loop over the columns rather than one over `iz` inside one over `ix`, because a column
 * index *is* `iz * dimX + ix`: the same cells, visited in the same order, one level of
 * nesting shallower.
 */
function markStandableColumns(
  world: CollisionWorld,
  grid: NavGrid,
  bounds: Box,
  opts: NavBakeOptions,
): void {
  const stats = grid.stats;
  const topY = bounds.max.y + 1;
  const columnDepth = bounds.max.y - bounds.min.y + 2;

  for (let column = 0; column < grid.columnCount; column++) {
    const ix = column % grid.dimX;
    const iz = (column - ix) / grid.dimX;
    const x = grid.centerX(ix);
    const z = grid.centerZ(iz);
    const intervals = collectColumn(world, x, z, topY, columnDepth);
    const found = standableSurfaces(intervals, bounds.min.y, opts, grid.layers);

    let layer = 0;
    for (let k = 0; k < found && layer < grid.layers; k++) {
      const y = surfaceY[k] ?? 0;
      // The authority on whether a bot fits here is the collision world itself.
      if (world.overlapCapsule(x, y + NAV_LIFT, z, opts.capsuleRadius, opts.standHeight)) continue;
      const node = layer * grid.columnCount + column;
      grid.walkable[node] = 1;
      grid.height[node] = y;
      grid.normalY[node] = surfaceNy[k] ?? 1;
      layer++;
      stats.walkable++;
    }
    if (layer > 1) stats.stacked++;
  }
}

/**
 * Reduce every collider in the column at (x, z) to a `[bottom, top]` interval, then merge
 * overlaps in place. Returns the number of merged intervals, ordered upward, with
 * `intervalNy[k]` holding the surface normal Y of whichever collider owns the top.
 */
function collectColumn(
  world: CollisionWorld,
  x: number,
  z: number,
  topY: number,
  depth: number,
): number {
  const hash = world.hash;
  hash.beginQuery();
  const n = hash.queryAabb(x, topY - depth, z, x, topY, z, columnCandidates);

  let count = 0;
  for (let k = 0; k < n && count < MAX_COLUMN; k++) {
    const idx = columnCandidates[k] ?? -1;
    if (idx < 0) continue;
    // Straight down: entry is the collider's top surface at this XZ, exit its underside.
    if (!rayBox(world.colliders, idx, x, topY, z, 0, -1, 0, depth, columnRay)) continue;
    const exitT = rayBoxExit(world.colliders, idx, x, topY, z, 0, -1, 0);
    if (exitT <= columnRay.t) continue;
    intervalLo[count] = topY - exitT;
    intervalHi[count] = topY - columnRay.t;
    intervalNy[count] = columnRay.ny;
    count++;
  }
  if (count === 0) return 0;

  sortIntervalsByBottom(count);
  return mergeIntervals(count);
}

/**
 * Order the first `count` intervals by their bottom, into `intervalOrder`.
 *
 * Insertion sort: `count` is a handful of boxes in practice.
 */
function sortIntervalsByBottom(count: number): void {
  for (let i = 0; i < count; i++) intervalOrder[i] = i;
  for (let i = 1; i < count; i++) {
    const cur = intervalOrder[i] ?? 0;
    const key = intervalLo[cur] ?? 0;
    let j = i - 1;
    while (j >= 0 && (intervalLo[intervalOrder[j] ?? 0] ?? 0) > key) {
      intervalOrder[j + 1] = intervalOrder[j] ?? 0;
      j--;
    }
    intervalOrder[j + 1] = cur;
  }
}

/**
 * Merge the ordered intervals forward into the front of the scratch arrays, and return how
 * many are left. Two that touch within 0.1 mm are one surface, and the merged interval takes
 * the normal of whichever collider owns its top.
 */
function mergeIntervals(count: number): number {
  const first = intervalOrder[0] ?? 0;
  let out = 0;
  let curLo = intervalLo[first] ?? 0;
  let curHi = intervalHi[first] ?? 0;
  let curNy = intervalNy[first] ?? 1;
  for (let i = 1; i < count; i++) {
    const src = intervalOrder[i] ?? 0;
    const lo = intervalLo[src] ?? 0;
    const hi = intervalHi[src] ?? 0;
    const ny = intervalNy[src] ?? 1;
    if (lo <= curHi + 1e-4) {
      if (hi > curHi) {
        curHi = hi;
        curNy = ny;
      }
      continue;
    }
    intervalLo[out] = curLo;
    intervalHi[out] = curHi;
    intervalNy[out] = curNy;
    out++;
    curLo = lo;
    curHi = hi;
    curNy = ny;
  }
  intervalLo[out] = curLo;
  intervalHi[out] = curHi;
  intervalNy[out] = curNy;
  return out + 1;
}

/**
 * Every merged surface that is a walkable slope with standing headroom above it, lowest
 * first, written into `surfaceY` / `surfaceNy`. Returns how many were found, capped at
 * the column`s layer count.
 *
 * Taking the lowest first is what makes an overhang something a bot walks *under*; taking
 * the ones above it too is what makes a catwalk somewhere a bot can walk *on*.
 */
function standableSurfaces(
  count: number,
  floorY: number,
  opts: NavBakeOptions,
  layers: number,
): number {
  const needed = opts.standHeight + NAV_LIFT;
  let found = 0;
  for (let i = 0; i < count && found < layers; i++) {
    const top = intervalHi[i] ?? 0;
    if (top < floorY) continue;
    if ((intervalNy[i] ?? 0) < opts.minGroundY) continue;
    const ceiling = i + 1 < count ? (intervalLo[i + 1] ?? Infinity) : Infinity;
    if (ceiling - top < needed) continue;
    surfaceY[found] = top;
    surfaceNy[found] = intervalNy[i] ?? 1;
    found++;
  }
  return found;
}

/**
 * Connectivity.
 *
 * Walks first, then mantles, then diagonals — and the order is the design. A climb link is
 * only ever offered where an ordinary walk was **not** available, so the graph never
 * carries two edges to the same place and A* is never asked to choose between a step and a
 * mantle over the same 0.3 m.
 *
 * Diagonals are deliberately walk-only. A mantle is a forward lunge that ends on the far
 * side of a ledge face, and a diagonal approach meets that face at 45 degrees where
 * `Mantle.detectMantle`'s forward probe is far more likely to miss. Offering a diagonal
 * climb would be offering an edge the bot cannot reliably cross, which is worse than not
 * offering it: a path that exists and cannot be walked is how a bot gets stuck for a whole
 * match. Every climb is a straight-on approach.
 *
 * One loop over the nodes rather than three over layer, `iz` and `ix`, because a node index
 * *is* `layer * columnCount + iz * dimX + ix`: the same nodes in the same order.
 */
function linkGrid(grid: NavGrid, opts: NavBakeOptions): void {
  const n = grid.cellCount;
  for (let node = 0; node < n; node++) {
    if (grid.walkable[node] !== 1) continue;
    const h = grid.height[node] ?? 0;
    linkStraightNeighbours(grid, opts, node, h);
    linkDiagonalNeighbours(grid, opts, node, h);
  }
}

/**
 * The four straight neighbours of one node: a walk where movement can cross the height
 * difference, else a mantle, else a step off the edge. Writes this node's `links` and `climb`.
 */
function linkStraightNeighbours(grid: NavGrid, opts: NavBakeOptions, node: number, h: number): void {
  const ix = grid.indexOfX(node);
  const iz = grid.indexOfZ(node);
  let mask = 0;
  let climbMask = 0;

  for (let d = 0; d < 4; d++) {
    const dir = NAV_DIRS[d];
    if (dir === undefined) continue;
    const j = grid.layerFrom(ix + dir.dx, iz + dir.dz, h, opts.stepHeight, opts.maxDrop);
    if (j >= 0) {
      mask |= 1 << d;
      grid.setLinkLayer(node, d, grid.layerOf(j));
      continue;
    }
    const climb = grid.climbFrom(ix + dir.dx, iz + dir.dz, h, opts.stepHeight, opts.mantleHeight);
    if (climb >= 0) {
      mask |= 1 << d;
      climbMask |= 1 << d;
      grid.setLinkLayer(node, d, grid.layerOf(climb));
      continue;
    }
    // Stepping off. Not a climb: nothing is pressed, the bot simply walks over the
    // edge — so it is an ordinary link that happens to descend a long way.
    const drop = grid.dropFrom(ix + dir.dx, iz + dir.dz, h, opts.maxDrop, opts.dropHeight);
    if (drop < 0) continue;
    mask |= 1 << d;
    grid.setLinkLayer(node, d, grid.layerOf(drop));
  }

  grid.links[node] = mask;
  grid.climb[node] = climbMask;
}

/**
 * The four diagonals of one node, on top of whatever the straight pass recorded. Walk-only,
 * and only where both orthogonals exist and neither of them was a mantle.
 */
function linkDiagonalNeighbours(grid: NavGrid, opts: NavBakeOptions, node: number, h: number): void {
  const ix = grid.indexOfX(node);
  const iz = grid.indexOfZ(node);
  const climbMask = grid.climb[node] ?? 0;
  let mask = grid.links[node] ?? 0;

  for (let d = 4; d < 8; d++) {
    const dir = NAV_DIRS[d];
    const deps = DIAGONAL_DEPS[d - 4];
    if (dir === undefined || deps === undefined) continue;
    // No corner cutting: a diagonal exists only where both its orthogonals do, and
    // only where neither of them was a mantle.
    if ((mask & (1 << deps[0])) === 0 || (mask & (1 << deps[1])) === 0) continue;
    if ((climbMask & (1 << deps[0])) !== 0 || (climbMask & (1 << deps[1])) !== 0) continue;
    const j = grid.layerFrom(ix + dir.dx, iz + dir.dz, h, opts.stepHeight, opts.maxDrop);
    if (j < 0) continue;
    mask |= 1 << d;
    grid.setLinkLayer(node, d, grid.layerOf(j));
  }

  grid.links[node] = mask;
}

/** BFS from the spawn seeds; anything unvisited stops being walkable. */
function pruneUnreachable(grid: NavGrid, seeds: readonly Vec3Lit[]): number {
  const seen = new Uint8Array(grid.cellCount);
  floodFromSeeds(grid, seeds, seen);
  return clearUnvisited(grid, seen);
}

/**
 * Mark every node reachable from a spawn seed, breadth first.
 *
 * A seed is a spawn position rather than a node, so it is snapped with a generous ring budget:
 * a spawn that failed to find the graph would prune the whole map it was meant to anchor.
 */
function floodFromSeeds(grid: NavGrid, seeds: readonly Vec3Lit[], seen: Uint8Array): void {
  const queue = new Int32Array(grid.cellCount);
  let head = 0;
  let tail = 0;

  for (const seed of seeds) {
    const start = grid.nearestCell(seed.x, seed.y, seed.z, 20);
    if (start < 0 || seen[start] === 1) continue;
    seen[start] = 1;
    queue[tail++] = start;
  }

  while (head < tail) {
    const i = queue[head++] ?? 0;
    for (let d = 0; d < 8; d++) {
      const j = grid.neighbour(i, d);
      if (j < 0 || seen[j] === 1) continue;
      seen[j] = 1;
      queue[tail++] = j;
    }
  }
}

/** Everything the flood did not reach stops being walkable. Returns how many that was. */
function clearUnvisited(grid: NavGrid, seen: Uint8Array): number {
  const n = grid.cellCount;
  let pruned = 0;
  for (let i = 0; i < n; i++) {
    if (grid.walkable[i] !== 1 || seen[i] === 1) continue;
    grid.walkable[i] = 0;
    grid.links[i] = 0;
    grid.climb[i] = 0;
    grid.linkLayer[i] = 0;
    pruned++;
  }
  return pruned;
}

/** Count what the linking left behind: the edges, and how many of them are mantles. */
function recordLinkCounts(grid: NavGrid): void {
  const n = grid.cellCount;
  let links = 0;
  let climbs = 0;
  for (let i = 0; i < n; i++) {
    links += popcount8(grid.links[i] ?? 0);
    climbs += popcount8(grid.climb[i] ?? 0);
  }
  grid.stats.links = links;
  grid.stats.climbLinks = climbs;
}

function popcount8(v: number): number {
  let x = v & 0xff;
  x = x - ((x >> 1) & 0x55);
  x = (x & 0x33) + ((x >> 2) & 0x33);
  return (x + (x >> 4)) & 0x0f;
}

/** The coarse pass: every layer on the base lattice, with the ground layer allowed a nudge. */
function sampleGroundLattice(
  grid: NavGrid,
  stride: number,
  found: number[],
  taken: Set<number>,
): void {
  const offset = Math.floor(stride / 2);
  for (let layer = 0; layer < grid.layers; layer++) {
    for (let iz = offset; iz < grid.dimZ; iz += stride) {
      for (let ix = offset; ix < grid.dimX; ix += stride) {
        takeGroundNode(grid, grid.node(ix, iz, layer), found, taken);
      }
    }
  }
}

/**
 * One lattice point on the coarse pass.
 *
 * Only the ground layer gets a nudge: an upper layer has genuine holes in it, and
 * snapping to the nearest walkable node would drag the point down onto the floor.
 */
function takeGroundNode(grid: NavGrid, node: number, found: number[], taken: Set<number>): void {
  if (grid.walkable[node] === 1) {
    addPatrolNode(node, found, taken);
    return;
  }
  if (grid.layerOf(node) !== 0) return;
  const x = grid.centerX(grid.indexOfX(node));
  const z = grid.centerZ(grid.indexOfZ(node));
  const near = grid.nearestCell(x, 0, z, 3);
  if (near >= 0) addPatrolNode(near, found, taken);
}

/** The fine pass: the same lattice at half the stride, taking only what is off the ground. */
function sampleElevatedLattice(
  grid: NavGrid,
  stride: number,
  found: number[],
  taken: Set<number>,
): void {
  const offset = Math.floor(stride / 2);
  for (let layer = 0; layer < grid.layers; layer++) {
    for (let iz = offset; iz < grid.dimZ; iz += stride) {
      for (let ix = offset; ix < grid.dimX; ix += stride) {
        takeElevatedNode(grid, grid.node(ix, iz, layer), found, taken);
      }
    }
  }
}

/** One lattice point on the fine pass: a route rather than floor, or nothing. */
function takeElevatedNode(grid: NavGrid, node: number, found: number[], taken: Set<number>): void {
  if (grid.walkable[node] !== 1) return;
  if ((grid.height[node] ?? 0) < ELEVATED_METRES) return;
  addPatrolNode(node, found, taken);
}

/** Keep a node once. The scatter is a set of places, not a count of visits. */
function addPatrolNode(node: number, found: number[], taken: Set<number>): void {
  if (taken.has(node)) return;
  taken.add(node);
  found.push(node);
}
//#endregion
