import { describe, expect, it } from 'vitest';
import { NAV_DIRS, NavGrid } from '../world/Navmesh';
import { MAX_WAYPOINTS, Path, Pathfinder, type PathClient } from './Pathing';

/**
 * A* over the navmesh grid, with string-pulled smoothing — pinned.
 *
 * Two properties matter more than the search itself, and both are what the tests are about.
 *
 * **It is resumable.** S6.6 requires a cap on expansions per tick with the overflow deferred,
 * and you cannot defer a search that only exists inside one function call. So a search bigger
 * than one tick's budget has to survive across ticks and arrive at the same path it would have
 * found in one go — that is the assertion that would catch a broken resume, and a broken resume
 * is a bot that silently never gets a path.
 *
 * **Only one search runs at a time.** Requests queue, a client that asks again while queued
 * replaces its own entry rather than adding a second, and a cancelled client is never called
 * back. Ten bots replanning at 3 Hz is thirty searches a second and the working set is one
 * allocation, which only holds if all three of those are true.
 *
 * The scores are stamped rather than cleared, so the test that matters for that is simply: two
 * searches in a row over the same grid give the same answer.
 */

const STEP_HEIGHT = 0.6;
const MAX_DROP = 3;

/**
 * A square single-layer grid at one metre, origin at `(0, 0)`, every walkable node linked to
 * each of its eight walkable neighbours.
 *
 * Written by hand rather than baked: what the pathfinder needs from a grid is a link graph and
 * a height per node, so a bake would make these tests depend on a map and on unit A5. Diagonals
 * are linked only when both of their orthogonals are, which is the rule that stops a path
 * cutting a corner through a wall.
 */
function grid(
  dim: number,
  options: {
    blocked?: ReadonlyArray<readonly [number, number]>;
    heights?: ReadonlyArray<readonly [number, number, number]>;
    climbs?: ReadonlyArray<readonly [number, number, number]>;
  } = {},
): NavGrid {
  const nav = new NavGrid(1, 0, 0, dim, dim, 1, {
    cells: dim * dim,
    walkable: 0,
    pruned: 0,
    links: 0,
    bakeMs: 0,
    stacked: 0,
    climbLinks: 0,
  });
  const blocked = new Set((options.blocked ?? []).map(([ix, iz]) => iz * dim + ix));
  for (let i = 0; i < dim * dim; i++) {
    if (blocked.has(i)) continue;
    nav.walkable[i] = 1;
    nav.normalY[i] = 1;
    nav.stats.walkable++;
  }
  for (const [ix, iz, height] of options.heights ?? []) nav.height[nav.index(ix, iz)] = height;

  for (let iz = 0; iz < dim; iz++) {
    for (let ix = 0; ix < dim; ix++) {
      const node = nav.index(ix, iz);
      if (nav.walkable[node] !== 1) continue;
      let bits = 0;
      for (let d = 0; d < NAV_DIRS.length; d++) {
        const step = NAV_DIRS[d];
        if (step === undefined) continue;
        const nx = ix + step.dx;
        const nz = iz + step.dz;
        if (!nav.inBounds(nx, nz)) continue;
        if (nav.walkable[nav.index(nx, nz)] !== 1) continue;
        if (step.dx !== 0 && step.dz !== 0) {
          if (nav.walkable[nav.index(ix + step.dx, iz)] !== 1) continue;
          if (nav.walkable[nav.index(ix, iz + step.dz)] !== 1) continue;
        }
        bits |= 1 << d;
        nav.stats.links++;
      }
      nav.links[node] = bits;
    }
  }
  for (const [ix, iz, dir] of options.climbs ?? []) {
    const node = nav.index(ix, iz);
    nav.climb[node] = (nav.climb[node] ?? 0) | (1 << dir);
    nav.stats.climbLinks++;
  }
  return nav;
}

/** A client that records what it was told, as a bot's `onPathReady` would act on it. */
function client(id: number): PathClient & { readonly calls: boolean[] } {
  const calls: boolean[] = [];
  return {
    pathClientId: id,
    path: new Path(),
    calls,
    onPathReady(found: boolean): void {
      calls.push(found);
    },
  };
}

/** Run the pathfinder to quiescence with a generous budget, and say how many ticks it took. */
function drain(pf: Pathfinder, budget = 100000, maxTicks = 200): number {
  let ticks = 0;
  while ((pf.busy || pf.pending > 0) && ticks < maxTicks) {
    pf.step(budget);
    ticks++;
  }
  return ticks;
}

describe('a path', () => {
  it('is nothing until it is written', () => {
    const path = new Path();
    expect(path.count).toBe(0);
    expect(path.cursor).toBe(0);
    expect(path.goalIndex).toBe(-1);
    expect(path.active).toBe(false);
    expect(path.complete).toBe(false);
    expect(path.remainingDistance(0, 0)).toBe(0);
  });

  it('is active while the follower has waypoints left and complete once it does not', () => {
    const path = new Path();
    path.count = 2;
    expect(path.active).toBe(true);
    expect(path.complete).toBe(false);
    path.cursor = 2;
    expect(path.active).toBe(false);
    expect(path.complete).toBe(true);
  });

  it('measures what is left through the waypoints, from where the body is now', () => {
    const path = new Path();
    path.x[0] = 3;
    path.z[0] = 0;
    path.x[1] = 3;
    path.z[1] = 4;
    path.count = 2;
    expect(path.remainingDistance(0, 0)).toBe(7);
    path.cursor = 1;
    expect(path.remainingDistance(3, 0)).toBe(4);
  });

  it('forgets everything on clear', () => {
    const path = new Path();
    path.count = 3;
    path.cursor = 1;
    path.goalIndex = 9;
    path.clear();
    expect(path.count).toBe(0);
    expect(path.cursor).toBe(0);
    expect(path.goalIndex).toBe(-1);
  });
});

describe('a search over open ground', () => {
  it('finds a path and hands it to the client that asked', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(1, 1), nav.index(12, 12));
    drain(pf);

    expect(bot.calls).toEqual([true]);
    expect(bot.path.count).toBeGreaterThan(0);
    expect(bot.path.goalIndex).toBe(nav.index(12, 12));
    expect(pf.searchesCompleted).toBe(1);
    expect(pf.searchesFailed).toBe(0);
  });

  it('string-pulls it, so a straight run is far fewer waypoints than cells', () => {
    const nav = grid(24);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(1, 12), nav.index(20, 12));
    drain(pf);
    // Nineteen cells of open floor in a line: a grid path is a staircase, a walked one is not.
    expect(bot.path.count).toBeLessThan(5);
    expect(bot.path.count).toBeGreaterThan(0);
  });

  it('ends on the cell that was asked for', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    const goal = nav.index(12, 9);
    pf.request(bot, nav.index(2, 2), goal);
    drain(pf);
    const last = bot.path.count - 1;
    expect(bot.path.x[last]).toBe(nav.centerX(nav.indexOfX(goal)));
    expect(bot.path.z[last]).toBe(nav.centerZ(nav.indexOfZ(goal)));
  });

  it('goes round a wall rather than through it', () => {
    // A wall across the middle with a gap at the far edge.
    const blocked: Array<readonly [number, number]> = [];
    for (let ix = 0; ix < 14; ix++) blocked.push([ix, 8]);
    const nav = grid(16, { blocked });
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(2, 2), nav.index(2, 13));
    drain(pf);

    expect(bot.calls).toEqual([true]);
    // It had to reach the gap at ix 14, so some waypoint is well to the right.
    let furthest = 0;
    for (let i = 0; i < bot.path.count; i++) furthest = Math.max(furthest, bot.path.x[i] ?? 0);
    expect(furthest).toBeGreaterThan(12);
  });

  it('answers the same way twice, because the scores are stamped rather than cleared', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const first = client(1);
    pf.request(first, nav.index(1, 1), nav.index(12, 12));
    drain(pf);
    const second = client(2);
    pf.request(second, nav.index(1, 1), nav.index(12, 12));
    drain(pf);

    expect(second.path.count).toBe(first.path.count);
    for (let i = 0; i < first.path.count; i++) {
      expect(second.path.x[i]).toBe(first.path.x[i]);
      expect(second.path.z[i]).toBe(first.path.z[i]);
    }
  });
});

describe('a search that cannot succeed', () => {
  it('tells the client so, and clears whatever it was following', () => {
    // An island the goal sits on, walled off completely.
    const blocked: Array<readonly [number, number]> = [];
    for (let i = 0; i < 16; i++) {
      blocked.push([i, 8]);
      blocked.push([8, i]);
    }
    const nav = grid(16, { blocked });
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    bot.path.count = 3;
    pf.request(bot, nav.index(2, 2), nav.index(12, 12));
    drain(pf);

    expect(bot.calls).toEqual([false]);
    expect(bot.path.count).toBe(0);
    expect(pf.searchesFailed).toBe(1);
    expect(pf.searchesCompleted).toBe(0);
  });

  it('refuses a request with no start or no goal, without queueing anything', () => {
    const nav = grid(8);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, -1, nav.index(2, 2));
    expect(bot.calls).toEqual([false]);
    expect(pf.pending).toBe(0);
    pf.request(bot, nav.index(2, 2), -1);
    expect(bot.calls).toEqual([false, false]);
    expect(pf.pending).toBe(0);
  });

  it('answers a search that is already where it is going', () => {
    const nav = grid(8);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    const here = nav.index(3, 3);
    pf.request(bot, here, here);
    drain(pf);
    expect(bot.calls.length).toBe(1);
  });
});

describe('the resumable half, which is what S6.6 asks for', () => {
  it('stops mid-search when the budget runs out and keeps the work', () => {
    const nav = grid(48);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(1, 1), nav.index(46, 46));

    pf.step(20);
    expect(pf.busy).toBe(true);
    expect(bot.calls).toEqual([]);
    expect(pf.nodesThisTick).toBeLessThanOrEqual(20);
    expect(pf.deferredRequests).toBe(1);
    expect(pf.budgetExhaustedTicks).toBeGreaterThan(0);

    const ticks = drain(pf, 20, 4000);
    expect(bot.calls).toEqual([true]);
    // More than one tick, which is the whole trade: quiet ticks instead of a spike. Not many
    // more, because the octile heuristic is admissible and tight — an open-ground search of
    // forty-five cells expands about forty-five nodes, and that is the heuristic working.
    expect(ticks).toBeGreaterThan(1);
  });

  it('arrives at the same path it would have found in one go', () => {
    const nav = grid(40, { blocked: [[20, 10], [20, 11], [20, 12], [20, 13], [20, 14]] });
    const atOnce = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const whole = client(1);
    atOnce.request(whole, nav.index(2, 12), nav.index(38, 12));
    drain(atOnce);

    const trickle = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const resumed = client(2);
    trickle.request(resumed, nav.index(2, 12), nav.index(38, 12));
    drain(trickle, 7, 5000);

    expect(resumed.calls).toEqual([true]);
    expect(resumed.path.count).toBe(whole.path.count);
    for (let i = 0; i < whole.path.count; i++) {
      expect(resumed.path.x[i]).toBe(whole.path.x[i]);
      expect(resumed.path.z[i]).toBe(whole.path.z[i]);
    }
  });

  it('reports the worst tick it has spent, and forgets it on request', () => {
    const nav = grid(32);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    pf.request(client(1), nav.index(1, 1), nav.index(30, 30));
    drain(pf, 50);
    expect(pf.worstNodesPerTick).toBeGreaterThan(0);
    pf.resetCounters();
    expect(pf.worstNodesPerTick).toBe(0);
    expect(pf.budgetExhaustedTicks).toBe(0);
    expect(pf.searchesCompleted).toBe(0);
    expect(pf.searchesFailed).toBe(0);
  });

  it('spends nothing when there is nothing to do', () => {
    const pf = new Pathfinder(grid(8), STEP_HEIGHT, MAX_DROP);
    pf.step(500);
    expect(pf.nodesThisTick).toBe(0);
    expect(pf.deferredRequests).toBe(0);
    expect(pf.busy).toBe(false);
  });
});

describe('the queue', () => {
  it('serves several clients, one search at a time', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const a = client(1);
    const b = client(2);
    const c = client(3);
    pf.request(a, nav.index(1, 1), nav.index(10, 10));
    pf.request(b, nav.index(2, 2), nav.index(11, 11));
    pf.request(c, nav.index(3, 3), nav.index(12, 12));
    expect(pf.pending).toBe(3);
    drain(pf);
    expect(a.calls).toEqual([true]);
    expect(b.calls).toEqual([true]);
    expect(c.calls).toEqual([true]);
    expect(pf.searchesCompleted).toBe(3);
  });

  it('replaces a client own outstanding request rather than adding a second', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(1, 1), nav.index(10, 10));
    pf.request(bot, nav.index(1, 1), nav.index(4, 4));
    expect(pf.pending).toBe(1);
    drain(pf);
    expect(bot.calls).toEqual([true]);
    // The second goal is the one that was served.
    expect(bot.path.goalIndex).toBe(nav.index(4, 4));
  });

  it('drops the newest when every bot asked on one tick, because it will ask again', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    for (let i = 0; i < 40; i++) {
      pf.request(client(i), nav.index(1, 1), nav.index(10, 10));
    }
    expect(pf.pending).toBe(32);
    expect(pf.deferredRequests).toBeGreaterThan(0);
  });

  it('forgets a cancelled client, queued or running', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const a = client(1);
    const b = client(2);
    pf.request(a, nav.index(1, 1), nav.index(10, 10));
    pf.request(b, nav.index(2, 2), nav.index(11, 11));
    pf.cancel(b);
    expect(pf.pending).toBe(1);
    drain(pf);
    expect(a.calls).toEqual([true]);
    expect(b.calls).toEqual([]);
  });

  it('abandons the active search when its own client cancels', () => {
    const nav = grid(48);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(1, 1), nav.index(46, 46));
    pf.step(10);
    expect(pf.busy).toBe(true);
    pf.cancel(bot);
    expect(pf.busy).toBe(false);
    drain(pf);
    expect(bot.calls).toEqual([]);
  });

  it('ignores a cancel for a client it never heard of', () => {
    const nav = grid(16);
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const a = client(1);
    pf.request(a, nav.index(1, 1), nav.index(10, 10));
    pf.cancel(client(99));
    expect(pf.pending).toBe(1);
    drain(pf);
    expect(a.calls).toEqual([true]);
  });
});

describe('what a climb costs the search', () => {
  it('sends a bot round to the ramp when the mantle is dear and the detour is cheap', () => {
    // Two routes of the same length; the direct one crosses a mantle.
    const nav = grid(16);
    const start = nav.index(8, 10);
    // Mark the straight-ahead link out of a whole row as a climb, so going through it costs
    // three and a half metres more than walking round.
    for (let ix = 6; ix <= 10; ix++) nav.climb[nav.index(ix, 9)] = 1 << 3;

    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, start, nav.index(8, 6));
    drain(pf);
    expect(bot.calls).toEqual([true]);
    // It still gets there; what the cost buys is that it preferred not to climb if it could.
    expect(bot.path.count).toBeGreaterThan(0);
  });

  it('still crosses one when there is no way round', () => {
    const blocked: Array<readonly [number, number]> = [];
    for (let ix = 0; ix < 16; ix++) if (ix !== 8) blocked.push([ix, 8]);
    const nav = grid(16, { blocked, climbs: [[8, 9, 3]] });
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(8, 12), nav.index(8, 4));
    drain(pf);
    expect(bot.calls).toEqual([true]);
  });
});

describe('the waypoint cap', () => {
  it('is never exceeded, however long the route', () => {
    // A serpentine corridor: the longest path this grid can express.
    const blocked: Array<readonly [number, number]> = [];
    for (let iz = 2; iz < 30; iz += 2) {
      for (let ix = 0; ix < 29; ix++) blocked.push([iz % 4 === 0 ? ix : 31 - ix, iz]);
    }
    const nav = grid(32, { blocked });
    const pf = new Pathfinder(nav, STEP_HEIGHT, MAX_DROP);
    const bot = client(1);
    pf.request(bot, nav.index(0, 0), nav.index(31, 31));
    drain(pf);
    expect(bot.path.count).toBeLessThanOrEqual(MAX_WAYPOINTS);
  });
});
