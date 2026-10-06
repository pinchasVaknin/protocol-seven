import { describe, expect, it } from 'vitest';
import { DIAGONAL_DEPS, NAV_DEFAULT_LAYERS, NAV_DIRS, NAV_MAX_LAYERS, NavGrid, type NavBakeStats } from './NavGrid';

/**
 * The navmesh structure and its queries, on a grid small enough to reason about by hand.
 *
 * Every one of these methods is read by A*, by the string puller, by cover selection and by
 * spawn selection, on the simulation tick and on both machines — so each is a contract rather
 * than an implementation detail, and the arithmetic in them is the kind that is wrong by one
 * without looking wrong. The layered column is where that risk concentrates: `cellAt` wants
 * the lowest surface, `cellAtY` wants the nearest one, `layerFrom` wants the one movement can
 * actually reach, and answering any of those with another layer's node is how a bot decides it
 * is standing somewhere it is not.
 *
 * ## The fixture
 *
 * A 4x4 grid of 1 m cells with the origin at (0, 0) and two layers, so node indices are small
 * enough to write down: `layer * 16 + iz * 4 + ix`.
 *
 * - Layer 0 is a floor at y = 0 everywhere **except column (0, 0)**, which is left unwalkable
 *   so the ring search has something to search for.
 * - Layer 1 is a deck at y = 4 over columns (2, 2) and (3, 2) — nodes 26 and 27. Four metres
 *   is Foundry's catwalk height, and it is deliberately out of reach of every step, drop and
 *   mantle window, which is what makes the layer tests mean something.
 */

function stats(): NavBakeStats {
  return { cells: 0, walkable: 0, pruned: 0, links: 0, bakeMs: 0, stacked: 0, climbLinks: 0 };
}

const DECK = [26, 27] as const;

function fixture(): NavGrid {
  const grid = new NavGrid(1, 0, 0, 4, 4, 2, stats());
  for (let node = 1; node < 16; node++) {
    grid.walkable[node] = 1;
    grid.normalY[node] = 1;
  }
  for (const node of DECK) {
    grid.walkable[node] = 1;
    grid.height[node] = 4;
    grid.normalY[node] = 1;
  }
  return grid;
}

describe('the navmesh grid', () => {
  it('addresses a node as layer, then row, then column', () => {
    const grid = fixture();
    expect(grid.columnCount).toBe(16);
    expect(grid.cellCount).toBe(32);
    expect(grid.index(2, 2)).toBe(10);
    expect(grid.node(2, 2, 0)).toBe(10);
    expect(grid.node(2, 2, 1)).toBe(26);
    expect(grid.layerOf(26)).toBe(1);
    expect(grid.columnOf(26)).toBe(10);
    // `indexOfX` / `indexOfZ` mod the layer out, so a consumer that only cares where a node is
    // in plan gets the same answer for the deck as for the floor beneath it.
    expect([grid.indexOfX(26), grid.indexOfZ(26)]).toEqual([2, 2]);
    expect([grid.indexOfX(10), grid.indexOfZ(10)]).toEqual([2, 2]);
  });

  it('converts between world metres and cells about the cell centre', () => {
    const grid = fixture();
    expect(grid.centerX(0)).toBe(0.5);
    expect(grid.centerZ(3)).toBe(3.5);
    expect(grid.cellX(2.5)).toBe(2);
    expect(grid.cellZ(0.1)).toBe(0);
    // Floor, not truncate: a position left of the origin is cell -1 and not cell 0.
    expect(grid.cellX(-0.5)).toBe(-1);
    expect(grid.inBounds(0, 0)).toBe(true);
    expect(grid.inBounds(-1, 0)).toBe(false);
    expect(grid.inBounds(4, 0)).toBe(false);
  });

  it('reads flags and heights off the arrays, and answers 0 past the end', () => {
    const grid = fixture();
    expect(grid.isWalkable(0)).toBe(false);
    expect(grid.isWalkable(26)).toBe(true);
    expect(grid.heightAt(26)).toBe(4);
    expect(grid.heightAt(10)).toBe(0);
    expect(grid.heightAt(999)).toBe(0);
  });

  it('gives the lowest surface in a column to cellAt, and the nearest to cellAtY', () => {
    const grid = fixture();
    // The floor, which is what every caller asking about ground level means.
    expect(grid.cellAt(2.5, 2.5)).toBe(10);
    // The column with nothing walkable in it, and a position off the grid entirely.
    expect(grid.cellAt(0.5, 0.5)).toBe(-1);
    expect(grid.cellAt(9, 9)).toBe(-1);

    expect(grid.cellAtY(2.5, 4, 2.5)).toBe(26);
    expect(grid.cellAtY(2.5, 0, 2.5)).toBe(10);
    // Halfway up, the floor still wins; past halfway the deck does. `>=` keeps the lower layer
    // on an exact tie, because the layers are walked upward.
    expect(grid.cellAtY(2.5, 1.9, 2.5)).toBe(10);
    expect(grid.cellAtY(2.5, 2, 2.5)).toBe(10);
    expect(grid.cellAtY(2.5, 2.1, 2.5)).toBe(26);
  });

  it('snaps to the column it is standing in before it searches at all', () => {
    const grid = fixture();
    expect(grid.nearestCell(2.5, 0, 2.5)).toBe(10);
    // A bot on the catwalk is answered with the catwalk, not with the floor four metres below.
    expect(grid.nearestCell(2.5, 4, 2.5)).toBe(26);
  });

  it('searches expanding rings when its own column has nothing, nearest first', () => {
    const grid = fixture();
    // Column (0, 0) is the hole. Ring 1 reaches (1, 0) and (0, 1) at the same distance, and
    // the first one the walk meets wins — the ring is walked row by row from -z.
    expect(grid.nearestCell(0.5, 0, 0.5)).toBe(1);
    // Far outside the grid: the search still arrives, given enough rings.
    expect(grid.nearestCell(-3.5, 0, -3.5, 12)).toBe(1);
    expect(grid.nearestCell(-3.5, 0, -3.5, 1)).toBe(-1);
    expect(grid.nearestCell(99, 0, 99, 3)).toBe(-1);
  });

  it('breaks a ring tie by height, weighted so a wrong layer loses to a farther cell', () => {
    const grid = fixture();
    // Standing in the hole at deck height. Ring 1 offers only floor cells; ring 1 still wins,
    // because the search returns the moment a ring finds anything at all.
    expect(grid.nearestCell(0.5, 4, 0.5)).toBe(1);
    // Punch out the column beside the deck so the query has to search, then ask from deck
    // height. dy is weighted by four, so the deck one cell away beats the floor in the very
    // next cell — which is what keeps a bot on a catwalk from being snapped off it.
    grid.walkable[grid.node(1, 2, 0)] = 0;
    expect(grid.nearestCell(1.9, 4, 2.5)).toBe(26);
    // The same position at floor height resolves to the floor under the deck instead.
    expect(grid.nearestCell(1.9, 0, 2.5)).toBe(10);
  });

  it('links a neighbour only where movement could cross the height difference', () => {
    const grid = fixture();
    // Flat ground: the step-up window carries it, and the nearer of two surfaces wins.
    expect(grid.layerFrom(2, 2, 0, 0.3, 0.5)).toBe(10);
    // From the deck, the floor is a four metre fall and the deck itself is level.
    expect(grid.layerFrom(2, 2, 4, 0.3, 0.5)).toBe(26);
    // Off the grid, and a column with nothing in it.
    expect(grid.layerFrom(9, 9, 0, 0.3, 0.5)).toBe(-1);
    expect(grid.layerFrom(0, 0, 0, 0.3, 0.5)).toBe(-1);
    // A catwalk edge over open floor: too high to step up to, too far to drop to.
    expect(grid.layerFrom(2, 2, 0, 0.3, 2)).toBe(10);
  });

  it('offers a mantle only above the step window and only up to the ledge height', () => {
    const grid = fixture();
    // One metre below the deck: above step-up, inside the mantle window.
    expect(grid.climbFrom(2, 2, 3, 0.3, 1.2)).toBe(26);
    // The window is open at the bottom, so anything a step absorbs is not a climb.
    expect(grid.climbFrom(2, 2, 3.8, 0.3, 1.2)).toBe(-1);
    // Zero disables them entirely, which is what every map but Depot asks for.
    expect(grid.climbFrom(2, 2, 3, 0.3, 0)).toBe(-1);
    expect(grid.climbFrom(2, 2, 3, 0.3, 0.3)).toBe(-1);
    // Four metres is a catwalk, not a ledge.
    expect(grid.climbFrom(2, 2, 0, 0.3, 1.2)).toBe(-1);
    expect(grid.climbFrom(9, 9, 3, 0.3, 1.2)).toBe(-1);
  });

  it('offers a deliberate drop only below ground snap and above the step-off limit', () => {
    const grid = fixture();
    expect(grid.dropFrom(2, 2, 4.6, 0.5, 2)).toBe(26);
    // Inside ground snap, so it is an ordinary link and this must not shadow it.
    expect(grid.dropFrom(2, 2, 4.2, 0.5, 2)).toBe(-1);
    // Zero disables them, and climbs without drops would be a trap in the literal sense.
    expect(grid.dropFrom(2, 2, 4.6, 0.5, 0)).toBe(-1);
    expect(grid.dropFrom(2, 2, 4.6, 0.5, 0.5)).toBe(-1);
    expect(grid.dropFrom(9, 9, 4.6, 0.5, 2)).toBe(-1);
  });

  it('packs two bits of layer per direction and resolves a neighbour through them', () => {
    const grid = fixture();
    grid.links[10] = 1 << 0;
    grid.setLinkLayer(10, 0, 1);
    expect(grid.linkLayer[10]).toBe(1);
    expect(grid.linked(10, 0)).toBe(true);
    expect(grid.linked(10, 1)).toBe(false);
    // Direction 0 is +x, and the link was recorded as landing on layer 1: the deck at (3, 2).
    expect(grid.neighbour(10, 0)).toBe(27);
    // An unlinked direction is -1 whatever the layer word says.
    expect(grid.neighbour(10, 1)).toBe(-1);

    // Each direction's two bits are independent, and a rewrite clears only its own.
    grid.setLinkLayer(10, 3, 2);
    expect(grid.linkLayer[10]).toBe(1 | (2 << 6));
    grid.setLinkLayer(10, 0, 0);
    expect(grid.linkLayer[10]).toBe(2 << 6);

    // A link that would leave the grid resolves to -1 rather than wrapping.
    grid.links[3] = 1 << 0;
    expect(grid.neighbour(3, 0)).toBe(-1);
  });

  it('reports a mantle separately from the link it rides on', () => {
    const grid = fixture();
    grid.links[10] = 0xff;
    grid.climb[10] = 1 << 2;
    expect(grid.isClimb(10, 2)).toBe(true);
    expect(grid.isClimb(10, 0)).toBe(false);
    // Every consumer of `links` is asking "can I get there", and the answer is yes either way.
    expect(grid.linked(10, 2)).toBe(true);
  });

  it('walks the straight line between two nodes under the same height rules the links use', () => {
    const grid = fixture();
    // Along the floor, every column on the line walkable.
    expect(grid.lineWalkable(8, 11, 0.3, 0.5)).toBe(true);
    // Floor to deck: the walk arrives at the floor, not at the surface that was asked for.
    expect(grid.lineWalkable(8, 27, 0.3, 0.5)).toBe(false);
    // Deck to deck, one cell apart, is a walk.
    expect(grid.lineWalkable(26, 27, 0.3, 0.5)).toBe(true);
    // A node to itself samples nothing and arrives where it started.
    expect(grid.lineWalkable(1, 1, 0.3, 0.5)).toBe(true);
    // Across the hole at (0, 0): the line from (1, 0) to (0, 1) passes through no column it
    // cannot resolve, but one that ends on the hole has nowhere to arrive.
    expect(grid.lineWalkable(1, 0, 0.3, 0.5)).toBe(false);
  });

  it('keeps the direction table, its diagonal dependencies and the layer ceiling in step', () => {
    expect(NAV_DIRS.length).toBe(8);
    // 0-3 orthogonal at cost 1, 4-7 diagonal at root two.
    for (let d = 0; d < 4; d++) expect(NAV_DIRS[d]?.cost).toBe(1);
    for (let d = 4; d < 8; d++) expect(NAV_DIRS[d]?.cost).toBe(Math.SQRT2);
    expect(DIAGONAL_DEPS.length).toBe(4);
    // A diagonal's two dependencies are its own two components, which is what stops a corner
    // being cut: both orthogonals must exist before the diagonal may.
    for (let d = 4; d < 8; d++) {
      const dir = NAV_DIRS[d];
      const deps = DIAGONAL_DEPS[d - 4];
      expect(NAV_DIRS[deps?.[0] ?? -1]?.dx).toBe(dir?.dx);
      expect(NAV_DIRS[deps?.[1] ?? -1]?.dz).toBe(dir?.dz);
    }
    // The ceiling is what two bits of layer per direction can address, and not one more.
    expect(NAV_MAX_LAYERS).toBe(4);
    expect(NAV_DEFAULT_LAYERS).toBe(2);
  });
});
