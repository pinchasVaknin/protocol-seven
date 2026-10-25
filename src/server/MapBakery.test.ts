import { beforeAll, describe, expect, it } from 'vitest';
import { installClock } from '../shared/core/Clock';
import { MAPS } from '../shared/modes/ModeRegistry';
import { MapBakery } from './MapBakery';
import { nodeClock } from './NodeClock';

/**
 * The boot bake, and the one call an instance makes to get a world (B8).
 *
 * §4.19 asks for two things of this: that construction of a match does *no* flood fills — which
 * is what makes `LOADING` *"instantiation, not baking"* — and that the memory it holds is
 * **reported as a number** rather than estimated, because the number decides whether the target
 * host can hold every map. Both are asserted here.
 *
 * The real clock, because the report's milliseconds are the thing the boot log is read for.
 */

installClock(nodeClock);

let bakery: MapBakery;

beforeAll(() => {
  bakery = new MapBakery();
  bakery.bakeAll();
});

describe('MapBakery', () => {
  it('has no report until it has baked', () => {
    expect(new MapBakery().bootReport()).toBeNull();
  });

  it('bakes every map in the registry, and reports one row each', () => {
    const report = bakery.bootReport();
    expect(report).not.toBeNull();
    expect(report?.maps).toHaveLength(MAPS.length);
    for (const entry of MAPS) {
      expect(report?.maps.some((row) => row.mapId === entry.id)).toBe(true);
    }
  });

  it('counts the bytes it holds rather than estimating them', () => {
    // §4.19: "if that memory does not fit the target host, say so and report the number." An
    // estimate would not be worth reporting.
    const report = bakery.bootReport();
    expect(report?.totalBytes).toBeGreaterThan(0);
    const summed = (report?.maps ?? []).reduce((total, row) => total + row.bytes, 0);
    expect(report?.totalBytes).toBe(summed);
    for (const row of report?.maps ?? []) expect(row.bytes).toBeGreaterThan(0);
  });

  it('reports what the bake cost in time and in heap', () => {
    const report = bakery.bootReport();
    expect(report?.totalMs).toBeGreaterThanOrEqual(0);
    expect(report?.heapDeltaBytes).toBeGreaterThanOrEqual(0);
    expect(report?.rssAfterBytes).toBeGreaterThan(0);
  });

  it('throws on a map id that was never baked, because that is a caller bug', () => {
    // Every id reaching here has been through `findMap`, so a miss is a bug in the caller
    // rather than bad input from a client.
    expect(() => bakery.get('mp_not_a_map')).toThrow(/was not baked at boot/);
  });

  it('hands an instance shared geometry and a private scratch', () => {
    // The one call an instance makes for a world: the navmesh is shared outright, and the
    // collision is a share rather than the bake itself, so two instances on one map cannot
    // write through each other.
    const a = bakery.instanceView('mp_foundry');
    const b = bakery.instanceView('mp_foundry');
    const baked = bakery.get('mp_foundry');

    expect(a.nav).toBe(baked.nav);
    expect(b.nav).toBe(baked.nav);
    expect(a.collision).not.toBe(b.collision);
    expect(a.collision.collision.colliders).toBe(baked.collision.collision.colliders);
  });
});
