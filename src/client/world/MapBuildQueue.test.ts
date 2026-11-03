import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import { MapBuildQueue, type BuildReport } from './MapBuildQueue';
import type { LoadedMap } from './MapRender';

/**
 * Characterization tests for the background map build (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 *
 * The queue's own decisions are about *state* — what is building, what is waiting, what a second
 * `start` for the same map does — and none of them needs a frame budget to be true, so the tests
 * below pump to completion rather than timing anything. The two things that are wall clock
 * (`elapsedMs` and `workMs`) are asserted as shapes, not values.
 */

const textures = {
  get: (): { worldScale: number; texture: null } => ({ worldScale: 2, texture: null }),
} as unknown as ProceduralTextures;

interface Completion {
  mapId: string;
  built: LoadedMap;
  report: BuildReport;
}

function makeQueue(quality: 'off' | 'low' | 'medium' | 'high' = 'medium'): {
  queue: MapBuildQueue;
  completions: Completion[];
} {
  const completions: Completion[] = [];
  const queue = new MapBuildQueue({
    textures,
    shadowQuality: () => quality,
    onComplete: (mapId, built, report) => { completions.push({ mapId, built, report }); },
  });
  return { queue, completions };
}

/** Pump until the build is done, with a generous ceiling so a hang is a failure not a hang. */
function pumpToEnd(queue: MapBuildQueue, budgetMs = 5): number {
  let frames = 0;
  while (queue.building && frames < 100_000) {
    queue.pump(budgetMs);
    frames++;
  }
  expect(queue.building).toBe(false);
  return frames;
}

describe('MapBuildQueue before anything is asked of it', () => {
  it('is idle, has no progress and nothing pending', () => {
    const { queue } = makeQueue();
    expect(queue.building).toBe(false);
    expect(queue.progress).toBe(null);
    expect(queue.pendingMapId).toBe('');
    expect(queue.hasReady('mp_foundry')).toBe(false);
    expect(queue.take('mp_foundry')).toBe(null);
  });

  it('spends nothing on a frame with no build in flight', () => {
    const { queue } = makeQueue();
    expect(queue.pump()).toBe(0);
    expect(queue.pump(50)).toBe(0);
  });

  it('is safe to cancel when there is nothing to cancel', () => {
    const { queue } = makeQueue();
    expect(() => queue.cancel()).not.toThrow();
    expect(queue.building).toBe(false);
    expect(queue.pendingMapId).toBe('');
  });
});

describe('MapBuildQueue.start', () => {
  it('starts building and names the map it is building', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    expect(queue.building).toBe(true);
    expect(queue.pendingMapId).toBe('mp_foundry');
    expect(queue.hasReady('mp_foundry')).toBe(false);
  });

  it('is idempotent for a build already in flight', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(5);
    const progress = queue.progress;
    queue.start('mp_foundry');
    // The half-done build was not thrown away and restarted.
    expect(queue.progress).toBe(progress);
    expect(queue.building).toBe(true);
  });

  it('is idempotent for a map already built and waiting', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    pumpToEnd(queue);
    queue.start('mp_foundry');
    expect(queue.building).toBe(false);
    expect(completions.length).toBe(1);
    expect(queue.hasReady('mp_foundry')).toBe(true);
  });

  it('throws away a build in flight when a different map is asked for', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(5);
    queue.start('mp_depot');
    expect(queue.pendingMapId).toBe('mp_depot');
    pumpToEnd(queue);
    expect(completions.length).toBe(1);
    expect(completions[0]?.mapId).toBe('mp_depot');
  });

  it('throws away a finished map when a different one is asked for', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    pumpToEnd(queue);
    expect(queue.hasReady('mp_foundry')).toBe(true);
    queue.start('mp_depot');
    expect(queue.hasReady('mp_foundry')).toBe(false);
    expect(queue.pendingMapId).toBe('mp_depot');
  });

  it('throws for a map the registry does not know', () => {
    const { queue } = makeQueue();
    expect(() => queue.start('mp_nowhere')).toThrow();
  });
});

describe('MapBuildQueue.pump', () => {
  it('reports the milliseconds it spent, so a frame probe can attribute the spike', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    const spent = queue.pump(5);
    expect(spent).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(spent)).toBe(true);
  });

  it('publishes the progress of the last chunk it finished', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(0.000_001);
    const progress = queue.progress;
    expect(progress).not.toBe(null);
    expect(progress?.done).toBeGreaterThan(0);
    expect(progress?.total).toBeGreaterThan(progress?.done ?? 0);
    expect(progress?.label.startsWith('brushes:')).toBe(true);
  });

  it('checks the budget after a chunk, so one chunk always runs however small the budget', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(0);
    expect(queue.progress?.done).toBe(1);
  });

  it('finishes the build over enough frames and reaches the last chunk', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    const frames = pumpToEnd(queue);
    expect(frames).toBeGreaterThan(0);
    expect(completions.length).toBe(1);
    expect(completions[0]?.report.chunks).toBe((completions[0]?.built.stats.chunks ?? 0) + 1);
  });

  it('clears the progress once the build is done', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    pumpToEnd(queue);
    expect(queue.progress).toBe(null);
  });

  it('spends nothing on the frames after the build has finished', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    pumpToEnd(queue);
    expect(queue.pump(5)).toBe(0);
  });

  it('uses the default budget when it is given none', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_testbed');
    let frames = 0;
    while (queue.building && frames < 100_000) {
      queue.pump();
      frames++;
    }
    expect(completions.length).toBe(1);
  });
});

describe('MapBuildQueue completion', () => {
  it('hands the caller the map, its id and a report, exactly once', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    pumpToEnd(queue);
    expect(completions.length).toBe(1);
    const done = completions[0];
    expect(done?.mapId).toBe('mp_foundry');
    expect(done?.built.def.id).toBe('mp_foundry');
    expect(done?.report.mapId).toBe('mp_foundry');
  });

  it('reports whole milliseconds of wall and work, the chunk and frame counts, and the worst chunk', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    const frames = pumpToEnd(queue);
    const report = completions[0]?.report;
    if (report === undefined) throw new Error('no report');
    expect(report.elapsedMs).toBe(Math.round(report.elapsedMs));
    expect(report.workMs).toBe(Math.round(report.workMs));
    expect(report.frames).toBe(frames);
    expect(report.chunks).toBeGreaterThan(0);
    expect(report.worstChunkMs).toBeGreaterThanOrEqual(0);
    // Two decimal places, which is what the hundredths rounding leaves.
    expect(Math.round(report.worstChunkMs * 100) / 100).toBe(report.worstChunkMs);
  });

  it('counts the chunks the build actually yielded, plus the one that returned', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_depot');
    pumpToEnd(queue);
    const report = completions[0]?.report;
    // Every yield is one chunk, and the `next()` that returns the map is one more.
    expect(report?.chunks).toBe((completions[0]?.built.stats.chunks ?? 0) + 1);
  });

  it('holds the finished map until it is taken', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    pumpToEnd(queue);
    expect(queue.hasReady('mp_foundry')).toBe(true);
    expect(queue.hasReady('mp_depot')).toBe(false);
    expect(queue.pendingMapId).toBe('mp_foundry');
    expect(queue.take('mp_depot')).toBe(null);
    expect(queue.take('mp_foundry')).toBe(completions[0]?.built);
  });

  it('hands ownership over once, and answers null after', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    pumpToEnd(queue);
    expect(queue.take('mp_foundry')).not.toBe(null);
    expect(queue.take('mp_foundry')).toBe(null);
    expect(queue.hasReady('mp_foundry')).toBe(false);
    expect(queue.pendingMapId).toBe('mp_foundry');
  });

  it('builds the map at the shadow quality it was asked for at start time', () => {
    const off = makeQueue('off');
    off.queue.start('mp_foundry');
    pumpToEnd(off.queue);
    const high = makeQueue('high');
    high.queue.start('mp_foundry');
    pumpToEnd(high.queue);
    const sizeOf = (map: LoadedMap | undefined): number => {
      let size = 0;
      map?.root.traverse((object) => {
        const light = object as unknown as { isDirectionalLight?: boolean; shadow?: { mapSize: { x: number } } };
        if (light.isDirectionalLight === true) size = light.shadow?.mapSize.x ?? 0;
      });
      return size;
    };
    expect(sizeOf(off.completions[0]?.built)).toBe(1024);
    expect(sizeOf(high.completions[0]?.built)).toBe(4096);
  });
});

describe('MapBuildQueue.cancel', () => {
  it('drops a build in flight and clears everything it was holding', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(5);
    queue.cancel();
    expect(queue.building).toBe(false);
    expect(queue.progress).toBe(null);
    expect(queue.pendingMapId).toBe('');
    expect(completions.length).toBe(0);
    expect(queue.pump(5)).toBe(0);
  });

  it('disposes the map that was waiting to be taken', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_testbed');
    pumpToEnd(queue);
    const built = completions[0]?.built;
    if (built === undefined) throw new Error('no map');
    queue.cancel();
    expect(queue.hasReady('mp_testbed')).toBe(false);
    expect(built.root.children).toEqual([]);
  });

  it('is safe to call twice', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(5);
    queue.cancel();
    expect(() => queue.cancel()).not.toThrow();
    expect(queue.pendingMapId).toBe('');
  });

  it('leaves the queue usable afterwards', () => {
    const { queue, completions } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(5);
    queue.cancel();
    queue.start('mp_depot');
    pumpToEnd(queue);
    expect(completions.length).toBe(1);
    expect(completions[0]?.mapId).toBe('mp_depot');
  });

  it('frees the GPU-side resources a half-built map had already made', () => {
    const { queue } = makeQueue();
    queue.start('mp_foundry');
    queue.pump(5);
    queue.pump(5);
    // The partial root is never exposed, so the disposals are counted on three's own prototype
    // for the length of the cancel: `return()` has to run the generator's `finally`, and simply
    // dropping the reference would free nothing on the GPU.
    let geometryDisposals = 0;
    const geometryDispose = THREE.BufferGeometry.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function patched(this: THREE.BufferGeometry): void {
      geometryDisposals++;
      geometryDispose.call(this);
    };
    try {
      queue.cancel();
    } finally {
      THREE.BufferGeometry.prototype.dispose = geometryDispose;
    }
    expect(geometryDisposals).toBeGreaterThan(0);
    expect(queue.building).toBe(false);
  });
});
