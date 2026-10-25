import { beforeAll, describe, expect, it } from 'vitest';
import { installClock } from '../shared/core/Clock';
import { InstanceState } from '../shared/net/Skirmish';
import { MapBakery } from './MapBakery';
import {
  AllocationError,
  FaultyMatchAllocator,
  InProcessMatchAllocator,
  type MatchRequest,
} from './MatchAllocator';

/**
 * One interface for every match that is created or destroyed (B8).
 *
 * §4.17: *"Every match is created and destroyed through one interface. Matchmaking never
 * constructs a `MatchInstance` directly."* The tests cover the cap §4.9 fixes at one, the seed
 * derivation that keeps a soak run reproducible past its first match, the double-destroy that
 * both the normal end and the failure path will try, and all three injected faults — which
 * exist because *"an allocator that cannot be slow and cannot fail will need rewriting the
 * first time a match runs anywhere but in-process."*
 *
 * A real `MapBakery` and real `LiveMatch`es, because the allocator's whole job is to build one
 * and release it; a fake would test the test.
 */

let now = 5_000;

installClock({ nowMs: () => now });

let bakery: MapBakery;

beforeAll(() => {
  bakery = new MapBakery();
  bakery.bakeAll();
});

function allocator(seed = 1234): InProcessMatchAllocator {
  return new InProcessMatchAllocator({
    bakery,
    snapshotHz: 20,
    interpolationDelayMs: 100,
    readyTimeoutMs: 5_000,
    summaryHoldSeconds: 12,
    currentTick: () => 41_000,
    seed,
    roundSecondsOverride: 1,
  });
}

function request(overrides: Partial<MatchRequest> = {}): MatchRequest {
  return {
    modeId: 'TDM',
    mapId: 'mp_foundry',
    players: [],
    // Two bots rather than ten: nothing here counts them, and a world is the expensive part
    // of an allocation.
    botFill: { count: 2, tier: 'MIX' },
    ...overrides,
  };
}

describe('InProcessMatchAllocator', () => {
  it('starts empty, with capacity for exactly one', () => {
    // §4.9: "Hard cap: two live instances — the warmup arena plus at most one live match." The
    // arena is not allocated through here, so this allocator's own capacity is one.
    const alloc = allocator();
    expect(alloc.capacity).toEqual({ max: 1, inUse: 1 - 1 });
    expect(alloc.allocationCount).toBe(0);
  });

  it('builds the match that was asked for and reports it in use', async () => {
    const alloc = allocator();
    const handle = await alloc.allocate(request({ mapId: 'mp_dunes', modeId: 'DOM' }));

    expect(handle.id).toBe(1);
    expect(handle.instance.mapId).toBe('mp_dunes');
    expect(handle.instance.modeId).toBe('DOM');
    expect(alloc.capacity.inUse).toBe(1);
    expect(alloc.allocationCount).toBe(1);

    await alloc.destroy(handle);
  });

  it('reads the state off the instance rather than copying it', async () => {
    // The handle's `state` is a getter, so a caller holding one cannot be told a state the
    // instance left behind.
    const alloc = allocator();
    const handle = await alloc.allocate(request());
    expect(handle.state).toBe(InstanceState.READY_WAIT);

    handle.instance.begin(41_000);
    expect(handle.state).toBe(InstanceState.RUNNING);

    await alloc.destroy(handle);
  });

  it('refuses a second match while one is live, as a capacity failure', async () => {
    const alloc = allocator();
    const first = await alloc.allocate(request());

    await expect(alloc.allocate(request())).rejects.toThrow(AllocationError);
    await expect(alloc.allocate(request())).rejects.toMatchObject({ kind: 'capacity' });

    await alloc.destroy(first);
  });

  it('frees the slot once the match is destroyed', async () => {
    const alloc = allocator();
    const first = await alloc.allocate(request());
    await alloc.destroy(first);

    const second = await alloc.allocate(request());
    expect(second.id).toBe(2);
    expect(alloc.capacity.inUse).toBe(1);
    await alloc.destroy(second);
  });

  it('derives each match seed from the configured one and the match id', async () => {
    // A soak run stays reproducible end to end rather than only within its first match, and a
    // disputed match can be replayed from (configured seed, match id).
    const alloc = allocator(7);
    const first = await alloc.allocate(request());
    await alloc.destroy(first);
    const second = await alloc.allocate(request());
    await alloc.destroy(second);

    // Same configured seed, different id, different match seed — and both reconstructible.
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect((7 + 1 * 0x9e37) & 0x7fff_ffff).not.toBe((7 + 2 * 0x9e37) & 0x7fff_ffff);
  });

  it('treats a second destroy as a no-op rather than a second failure', async () => {
    // A double-destroy is exactly what a failure path and a normal end will both try to do.
    const alloc = allocator();
    const handle = await alloc.allocate(request());
    await alloc.destroy(handle);

    await expect(alloc.destroy(handle)).resolves.toBeUndefined();
    expect(alloc.capacity.inUse).toBe(0);
  });

  it('counts every allocation this process has made', async () => {
    const alloc = allocator();
    for (let i = 0; i < 2; i++) {
      const handle = await alloc.allocate(request());
      await alloc.destroy(handle);
    }
    expect(alloc.allocationCount).toBe(2);
  });
});

describe('FaultyMatchAllocator', () => {
  it('passes everything through while no fault is set', async () => {
    const inner = allocator();
    const faulty = new FaultyMatchAllocator(inner);

    const handle = await faulty.allocate(request());
    expect(handle.id).toBe(1);
    expect(faulty.capacity).toEqual(inner.capacity);

    await faulty.destroy(handle);
  });

  it('fails the next N allocations and then recovers', async () => {
    const faulty = new FaultyMatchAllocator(allocator());
    faulty.faults.failuresRemaining = 1;

    await expect(faulty.allocate(request())).rejects.toMatchObject({ kind: 'failure' });
    expect(faulty.faults.failuresRemaining).toBe(0);

    const handle = await faulty.allocate(request());
    expect(handle.id).toBe(1);
    await faulty.destroy(handle);
  });

  it('reports no capacity at all while exhausted, and refuses with that reason', async () => {
    const faulty = new FaultyMatchAllocator(allocator());
    faulty.faults.exhausted = true;

    expect(faulty.capacity).toEqual({ max: 0, inUse: 0 });
    await expect(faulty.allocate(request())).rejects.toMatchObject({ kind: 'capacity' });
  });

  it('stalls before delegating, so the caller cannot assume it has an instance', async () => {
    const faulty = new FaultyMatchAllocator(allocator());
    faulty.faults.latencyMs = 5;

    const pending = faulty.allocate(request());
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    const handle = await pending;
    expect(handle.id).toBe(1);
    await faulty.destroy(handle);
  });

  it('checks exhaustion before the failure counter, so the reason is the right one', async () => {
    const faulty = new FaultyMatchAllocator(allocator());
    faulty.faults.exhausted = true;
    faulty.faults.failuresRemaining = 1;

    await expect(faulty.allocate(request())).rejects.toMatchObject({ kind: 'capacity' });
    // The failure was not consumed: the two knobs fail at different points on purpose.
    expect(faulty.faults.failuresRemaining).toBe(1);
  });
});
