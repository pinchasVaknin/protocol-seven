import { describe, expect, it } from 'vitest';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { NavGrid } from '../world/Navmesh';
import type { CoverPoint } from '../world/maps/types';
import { CoverIndex } from './Cover';
import { Perception } from './Perception';

/**
 * Cover points, validated and scored — pinned.
 *
 * The definition of cover lives here, and it is not "near an object": **a cover point is cover
 * only if the threat cannot see the body that would be standing in it.** That is one raycast
 * per candidate, from the threat's eye to the pose the bot would adopt, and a candidate whose
 * line is clear is discarded no matter how close to a crate it is. Three tests below are that
 * one rule, because it is the only test that cannot be fooled by geometry the map author did
 * not think about.
 *
 * The rest is the two things that make selection not look blind: the cover has to be oriented
 * *against* the threat rather than merely near it, and occupancy has to be tracked so two bots
 * do not pile into the same 0.6 m spot.
 */

const BOUNDS = { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 16, z: 40 } };

/**
 * A flat single-layer navmesh, 32 x 32 at one metre, origin at `(0, 0)`.
 *
 * Written by hand rather than baked: `CoverIndex` asks a grid four questions — which cell is at
 * a position, and that cell's centre and height — and nothing about links, so a bake would make
 * every test here depend on a map and on unit A5's correctness.
 */
function navGrid(dim = 32): NavGrid {
  const grid = new NavGrid(1, 0, 0, dim, dim, 1, {
    cells: dim * dim,
    walkable: 0,
    pruned: 0,
    links: 0,
    bakeMs: 0,
    stacked: 0,
    climbLinks: 0,
  });
  for (let i = 0; i < dim * dim; i++) {
    grid.walkable[i] = 1;
    grid.height[i] = 0;
    grid.normalY[i] = 1;
  }
  grid.stats.walkable = dim * dim;
  return grid;
}

/** A world with a floor at y = 0, plus whatever the test puts in it. */
function world(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 2);
  set.add({ x: 16, y: -0.5, z: 16 }, { x: 80, y: 1, z: 80 }, 0, 0, 0, 'floor');
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  return new CollisionWorld(set, BOUNDS, 4);
}

/** An authored cover point at `(x, y, z)` facing `facingYaw`. */
function point(
  x: number,
  z: number,
  facingYaw = 0,
  height: CoverPoint['height'] = 'high',
  y = 0,
): CoverPoint {
  return { position: { x, y, z }, facingYaw, height };
}

describe('the index built at load', () => {
  it('keeps the points the navmesh accepts, snapped to their cell', () => {
    const index = new CoverIndex([point(4.3, 6.8), point(10.1, 2.2)], navGrid());
    expect(index.count).toBe(2);
    expect(index.rejected).toBe(0);
    // Snapped to the cell centre, which is where a bot would actually stand.
    expect(index.slots[0]?.x).toBe(4.5);
    expect(index.slots[0]?.z).toBe(6.5);
    expect(index.slots[0]?.y).toBe(0);
    expect(index.slots[0]?.cellIndex).toBeGreaterThanOrEqual(0);
    expect(index.slots[0]?.occupantId).toBe(-1);
  });

  it('reports the ones it rejected, so bad map data is visible', () => {
    const index = new CoverIndex([point(4, 4), point(900, 900), point(-50, -50)], navGrid());
    expect(index.count).toBe(1);
    expect(index.rejected).toBe(2);
  });

  it('keeps each point facing and height', () => {
    const index = new CoverIndex([point(4, 4, 1.25, 'low')], navGrid());
    expect(index.slots[0]?.facingYaw).toBe(1.25);
    expect(index.slots[0]?.height).toBe('low');
  });
});

describe('occupancy', () => {
  it('is nobody until a bot claims a slot', () => {
    const index = new CoverIndex([point(4, 4), point(6, 6)], navGrid());
    expect(index.occupiedCount).toBe(0);
    index.claim(0, 7);
    expect(index.occupiedCount).toBe(1);
    expect(index.slots[0]?.occupantId).toBe(7);
  });

  it('moves a bot rather than letting it hold two slots at once', () => {
    const index = new CoverIndex([point(4, 4), point(6, 6)], navGrid());
    index.claim(0, 7);
    index.claim(1, 7);
    expect(index.occupiedCount).toBe(1);
    expect(index.slots[0]?.occupantId).toBe(-1);
    expect(index.slots[1]?.occupantId).toBe(7);
  });

  it('drops a bot claim on request, and everybody on a reset', () => {
    const index = new CoverIndex([point(4, 4), point(6, 6)], navGrid());
    index.claim(0, 7);
    index.claim(1, 8);
    index.release(7);
    expect(index.slots[0]?.occupantId).toBe(-1);
    expect(index.slots[1]?.occupantId).toBe(8);
    index.releaseAll();
    expect(index.occupiedCount).toBe(0);
  });

  it('ignores a claim on a slot that does not exist', () => {
    const index = new CoverIndex([point(4, 4)], navGrid());
    index.claim(99, 7);
    expect(index.occupiedCount).toBe(0);
  });
});

describe('what counts as cover', () => {
  /**
   * A threat at `(16, 1.6, 4)` looking up the z axis, and a candidate at `(16, z)`.
   *
   * The wall is between them when it is asked for, so the one test that matters — standing
   * here, can the threat see me — can be run both ways with nothing else changing.
   */
  function arena(walled: boolean, facingYaw = 0): { index: CoverIndex; perception: Perception } {
    const cw = walled ? world([16, 1.5, 12, 8, 3, 0.6]) : world();
    return {
      index: new CoverIndex([point(16, 16, facingYaw)], navGrid()),
      perception: new Perception(cw),
    };
  }

  it('is a point whose line the threat cannot hold', () => {
    const { index, perception } = arena(true);
    expect(index.select(1, 16, 0, 18, 16, 1.6, 4, 20, perception)).toBe(0);
  });

  it('is not a point in the open, however near the bot it is', () => {
    const { index, perception } = arena(false);
    // The same candidate, the same distance, and nothing in the way: refused.
    expect(index.select(1, 16, 0, 18, 16, 1.6, 4, 20, perception)).toBe(-1);
  });

  it('is not a point whose cover faces the wrong way', () => {
    // Facing yaw pi looks up +Z, away from a threat that is down -Z of the slot.
    const { index, perception } = arena(true, Math.PI);
    expect(index.select(1, 16, 0, 18, 16, 1.6, 4, 20, perception)).toBe(-1);
  });

  it('is not a point the bot is standing almost on top of the threat in', () => {
    const cw = world([16, 1.5, 12, 8, 3, 0.6]);
    const index = new CoverIndex([point(16, 16)], navGrid());
    const perception = new Perception(cw);
    // Threat a metre from the slot: inside the 1.5 m floor, so the slot is no use.
    expect(index.select(1, 16, 0, 18, 16, 1.6, 15.5, 20, perception)).toBe(-1);
  });

  it('is nothing at all when no candidate is within range', () => {
    const { index, perception } = arena(true);
    expect(index.select(1, 0, 0, 0, 16, 1.6, 4, 2, perception)).toBe(-1);
  });

  it('tests a low point crouched and a high one standing', () => {
    // A wall 1.1 m tall, a third of the way along: the threat eye is at 1.6, so the line to a
    // crouched torso at 0.77 passes 1.05 m up at the wall and the line to a standing one at
    // 1.26 passes 1.37 — this hides the first and not the second.
    const cw = world([16, 0.55, 12, 8, 1.1, 0.6]);
    const perception = new Perception(cw);
    const low = new CoverIndex([point(16, 16, 0, 'low')], navGrid());
    const high = new CoverIndex([point(16, 16, 0, 'high')], navGrid());
    expect(low.select(1, 16, 0, 18, 16, 1.6, 4, 20, perception)).toBe(0);
    expect(high.select(1, 16, 0, 18, 16, 1.6, 4, 20, perception)).toBe(-1);
  });
});

describe('choosing between several', () => {
  /** Four candidates behind one long wall, at increasing distance from the bot. */
  function row(): { index: CoverIndex; perception: Perception } {
    const points = [point(16, 16), point(16, 18), point(16, 20), point(16, 24)];
    return {
      index: new CoverIndex(points, navGrid()),
      perception: new Perception(world([16, 1.5, 12, 8, 3, 0.6])),
    };
  }

  it('takes the one nearest the bot, all else equal', () => {
    const { index, perception } = row();
    expect(index.select(1, 16, 0, 16, 16, 1.6, 4, 30, perception)).toBe(0);
    // Standing further up the row, the nearest is a different slot.
    expect(index.select(1, 16, 0, 24, 16, 1.6, 4, 30, perception)).toBe(3);
  });

  it('skips a slot another bot has already claimed', () => {
    const { index, perception } = row();
    index.claim(0, 9);
    expect(index.select(1, 16, 0, 16, 16, 1.6, 4, 30, perception)).toBe(1);
  });

  it('still offers a bot the slot it is itself standing in', () => {
    const { index, perception } = row();
    index.claim(0, 1);
    expect(index.select(1, 16, 0, 16, 16, 1.6, 4, 30, perception)).toBe(0);
  });

  it('refuses a slot on another level, however close in plan', () => {
    const grid = navGrid();
    const index = new CoverIndex([point(16, 16)], grid);
    const perception = new Perception(world([16, 1.5, 12, 8, 3, 0.6]));
    // The bot is four metres below the slot: another floor, not "two metres away".
    expect(index.select(1, 16, -4, 18, 16, 1.6, 4, 20, perception)).toBe(-1);
  });

  it('scores more candidates than it can hold and still answers', () => {
    // Thirty-two candidates against a cap of sixteen: the nearest few are scored and the rest
    // are not scored at all, so the answer must still be one of the near ones.
    const points: CoverPoint[] = [];
    for (let i = 0; i < 32; i++) points.push(point(16, 14 + i * 0.5));
    const index = new CoverIndex(points, navGrid());
    const perception = new Perception(world([16, 1.5, 12, 8, 3, 0.6]));
    const chosen = index.select(1, 16, 0, 14, 16, 1.6, 4, 40, perception);
    expect(chosen).toBeGreaterThanOrEqual(0);
    const slot = index.slots[chosen];
    expect(slot).toBeDefined();
    expect(Math.abs((slot?.z ?? 0) - 14)).toBeLessThan(10);
  });
});

describe('the peek beside a slot', () => {
  it('is lateral, along the cover own face', () => {
    const index = new CoverIndex([point(16, 16, 0)], navGrid());
    // Facing yaw 0 protects from -Z, so the lateral axis is x.
    expect(index.peekOffsetX(0, 1)).toBeCloseTo(1, 9);
    expect(Math.abs(index.peekOffsetZ(0, 1))).toBeLessThan(1e-9);
  });

  it('turns with the cover', () => {
    const index = new CoverIndex([point(16, 16, Math.PI * 0.5)], navGrid());
    expect(Math.abs(index.peekOffsetX(0, 1))).toBeLessThan(1e-9);
    expect(index.peekOffsetZ(0, 1)).toBeCloseTo(-1, 9);
  });

  it('leans either way, and nowhere for a slot that does not exist', () => {
    const index = new CoverIndex([point(16, 16, 0)], navGrid());
    expect(index.peekOffsetX(0, -1)).toBeCloseTo(-1, 9);
    expect(index.peekOffsetX(5, 1)).toBe(0);
    expect(index.peekOffsetZ(5, 1)).toBe(0);
  });
});
