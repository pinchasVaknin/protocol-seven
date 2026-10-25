import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { navBakeOptionsFor } from '../../shared/ai/BotDirector';
import { installClock } from '../../shared/core/Clock';
import { angleDelta } from '../../shared/core/MathUtil';
import {
  COUNTDOWN_SECONDS,
  planIntro,
  RETURN_SECONDS,
  type IntroPlan,
  type IntroPose,
} from '../../shared/cinematic/IntroPlan';
import { DEFAULT_MOVEMENT_CONFIG } from '../../shared/player/MovementConfig';
import { loadMapCollision } from '../../shared/world/MapLoader';
import { bakeNavmesh } from '../../shared/world/NavBake';
import { FOUNDRY_MAP } from '../../shared/world/maps/foundry';
import type { MatchWorld } from '../MatchWorld';
import { FOV_DEG, IntroCamera } from './IntroCamera';

/**
 * The match intro's camera (M15, Phase C), pinned before unit C1's refactor.
 *
 * The plan itself is `shared/cinematic/IntroPlan`'s and is tested there; what is pinned here is
 * what this file adds to it — the one-shot eligibility, the two blends between the rig and the
 * plan, the lens that travels with them, and the fast-forward's two answers to "faster than
 * what". Each case builds its own reference plan from the same inputs the camera is given, so
 * the expected pose at any `t` is known exactly rather than approximated.
 *
 * `window` is stubbed because `SpaceSkip` takes two listeners the moment a plan is built; it is
 * removed again after every case, so nothing leaks into another test file.
 */

// ===================================== the world it reads =====================================

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const COLLISION = loadMapCollision(FOUNDRY_MAP).collision;
const NAV = bakeNavmesh(
  COLLISION,
  FOUNDRY_MAP.navBounds,
  navBakeOptionsFor(FOUNDRY_MAP, DEFAULT_MOVEMENT_CONFIG),
);
const SPAWN = FOUNDRY_MAP.spawns[0]!.position;

interface FakeFlow {
  currentPhase: string;
  round: number;
  phaseSecondsTotal: number;
  phaseSecondsRemaining: number;
  shortenWarmup(seconds: number): void;
  asked: number[];
}

interface Harness {
  world: MatchWorld;
  flow: FakeFlow;
  camera: IntroCamera;
  rig: THREE.PerspectiveCamera;
  /** A plan built from the identical inputs, so the expected pose at `t` is exact. */
  plan: IntroPlan;
  poseAt(t: number): IntroPose;
}

/** `authoritative: false` is the networked case, where `shortenWarmup` does nothing. */
function harness(
  options: { modeId?: string; total?: number; authoritative?: boolean } = {},
): Harness {
  const modeId = options.modeId ?? 'TDM';
  const total = options.total ?? 16.5;
  const authoritative = options.authoritative ?? true;

  const flow: FakeFlow = {
    currentPhase: 'WARMUP',
    round: 1,
    phaseSecondsTotal: total,
    phaseSecondsRemaining: total,
    asked: [],
    shortenWarmup(seconds: number): void {
      this.asked.push(seconds);
      if (authoritative) this.phaseSecondsRemaining = seconds;
    },
  };

  const world = {
    match: { flow, inWarmupArena: false, mode: { id: modeId }, bots: { nav: NAV } },
    map: { def: FOUNDRY_MAP, collision: COLLISION },
    player: { sim: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z } },
  } as unknown as MatchWorld;

  const plan = planIntro({
    def: FOUNDRY_MAP,
    nav: NAV,
    collision: COLLISION,
    movement: DEFAULT_MOVEMENT_CONFIG,
    modeId: modeId as never,
    spawn: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
    fovDeg: FOV_DEG,
    freezeSeconds: total,
  });

  const rig = new THREE.PerspectiveCamera(90, 1, 0.1, 500);
  rig.position.set(4, 1.6, -7);
  rig.rotation.set(0.1, 0.8, 0, 'YXZ');

  return {
    world,
    flow,
    camera: new IntroCamera({ movement: DEFAULT_MOVEMENT_CONFIG }),
    rig,
    plan,
    poseAt(t: number): IntroPose {
      const out: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
      plan.poseAt(t, out);
      return out;
    },
  };
}

/** Put the freeze clock at `t` seconds into the timeline, then ask for the frame. */
function frameAt(h: Harness, t: number, dt = 0.016): THREE.PerspectiveCamera | null {
  h.flow.phaseSecondsRemaining = h.flow.phaseSecondsTotal - t;
  return h.camera.cameraFor(h.world, h.rig, 16 / 9, dt);
}

/**
 * The timeline position the camera actually read.
 *
 * `total - remaining` does not round-trip exactly, so a test that wants the pose at the frame
 * it just asked for has to ask the clock the same question the camera did.
 */
function clockT(h: Harness): number {
  return h.flow.phaseSecondsTotal - h.flow.phaseSecondsRemaining;
}

/** The blend the file applies: `ease` over the first 0.35 s, and over the return. */
function smooth(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

// ======================================== the DOM stub ========================================

type Handler = (event: unknown) => void;

const handlers = new Map<string, Set<Handler>>();

/** How many listeners of `type` are registered right now. */
function listenerCount(type: string): number {
  return handlers.get(type)?.size ?? 0;
}

/** A synthetic Space, delivered to whatever `SpaceSkip` registered on the stub. */
function pressSpace(): void {
  const down = handlers.get('keydown');
  if (down === undefined || down.size === 0) throw new Error('nothing is listening for keydown');
  const event = {
    code: 'Space',
    key: ' ',
    repeat: false,
    preventDefault: (): void => {},
    stopPropagation: (): void => {},
  };
  for (const handler of [...down]) handler(event);
}

beforeEach(() => {
  handlers.clear();
  const stub = {
    addEventListener(type: string, handler: Handler): void {
      let set = handlers.get(type);
      if (set === undefined) {
        set = new Set<Handler>();
        handlers.set(type, set);
      }
      set.add(handler);
    },
    removeEventListener(type: string, handler: Handler): void {
      handlers.get(type)?.delete(handler);
    },
  };
  (globalThis as { window?: unknown }).window = stub;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

// ======================================== eligibility =========================================

describe('when the intro plays at all', () => {
  it('plays over the round-one freeze', () => {
    const h = harness();
    expect(frameAt(h, 0)).not.toBeNull();
    expect(h.camera.active).toBe(true);
  });

  it.each([
    ['the phase is not the freeze', { currentPhase: 'LIVE' }],
    ['this is not round one', { round: 2 }],
  ])('refuses once and for all when %s', (_name, patch) => {
    const h = harness();
    Object.assign(h.flow, patch);
    expect(frameAt(h, 0)).toBeNull();
    expect(h.camera.active).toBe(false);

    // No second chance at it: the freeze coming back does not start an intro.
    h.flow.currentPhase = 'WARMUP';
    h.flow.round = 1;
    expect(frameAt(h, 0)).toBeNull();
    expect(h.camera.active).toBe(false);
  });

  it('refuses in the warmup arena and on the range', () => {
    const arena = harness();
    (arena.world.match as unknown as { inWarmupArena: boolean }).inWarmupArena = true;
    expect(frameAt(arena, 0)).toBeNull();

    const range = harness({ modeId: 'RANGE' });
    expect(frameAt(range, 0)).toBeNull();
  });

  it('takes the key only while a plan is up, and gives it back when the world goes', () => {
    const h = harness();
    expect(listenerCount('keydown')).toBe(0);
    frameAt(h, 0);
    expect(listenerCount('keydown')).toBe(1);

    h.camera.reset();
    expect(listenerCount('keydown')).toBe(0);
    expect(h.camera.active).toBe(false);

    // A reset world plans afresh rather than carrying the old plan over.
    expect(frameAt(h, 0)).not.toBeNull();
    expect(listenerCount('keydown')).toBe(1);
  });

  it('forgets everything when a different world arrives mid-flight', () => {
    const h = harness();
    frameAt(h, 2);
    const other = harness();
    // The second world's own camera object is the same one; the world identity is what changed.
    const cam = h.camera.cameraFor(other.world, h.rig, 16 / 9, 0.016);
    expect(cam).not.toBeNull();
    // It restarted: at t = 0 the camera sits exactly on the rig.
    expect(cam!.position.x).toBe(h.rig.position.x);
  });
});

// ========================================= the blends =========================================

describe('the two blends', () => {
  it('starts on the rig exactly — position, angles and lens', () => {
    const h = harness();
    const cam = frameAt(h, 0)!;
    expect(cam.position.x).toBe(h.rig.position.x);
    expect(cam.position.y).toBe(h.rig.position.y);
    expect(cam.position.z).toBe(h.rig.position.z);
    expect(cam.rotation.y).toBe(h.rig.rotation.y);
    expect(cam.rotation.x).toBe(h.rig.rotation.x);
    expect(cam.fov).toBe(h.rig.fov);
    expect(cam.aspect).toBe(16 / 9);
  });

  it('eases the rig into the plan over the first 0.35 s', () => {
    const h = harness();
    const cam = frameAt(h, 0.175)!;
    const t = clockT(h);
    const w = smooth(t / 0.35);
    const pose = h.poseAt(t);
    const rigYaw = h.rig.rotation.y;

    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
    expect(cam.position.x).toBe(h.rig.position.x + (pose.x - h.rig.position.x) * w);
    expect(cam.position.y).toBe(h.rig.position.y + (pose.y - h.rig.position.y) * w);
    expect(cam.position.z).toBe(h.rig.position.z + (pose.z - h.rig.position.z) * w);
    // The yaw turns the short way. The shared helper and the local copy agree at every input
    // but exactly -PI, which no pose on this map produces.
    expect(cam.rotation.y).toBe(rigYaw + angleDelta(rigYaw, pose.yaw) * w);
    expect(cam.rotation.x).toBe(h.rig.rotation.x + (pose.pitch - h.rig.rotation.x) * w);
    expect(cam.fov).toBe(h.rig.fov + (FOV_DEG - h.rig.fov) * w);
  });

  it('is the plan, and the plan lens, once the blend is done', () => {
    const h = harness();
    const cam = frameAt(h, 2)!;
    const pose = h.poseAt(clockT(h));
    const rig = h.rig.position;
    // The weight is one, and the blend is still evaluated rather than short-circuited, so the
    // answer is `a + (b - a)` — which is the plan's pose to within an ulp, not bit for bit.
    expect(cam.position.x).toBe(rig.x + (pose.x - rig.x) * 1);
    expect(cam.position.y).toBe(rig.y + (pose.y - rig.y) * 1);
    expect(cam.position.z).toBe(rig.z + (pose.z - rig.z) * 1);
    expect(cam.position.x).toBeCloseTo(pose.x, 12);
    expect(cam.position.z).toBeCloseTo(pose.z, 12);
    expect(cam.rotation.x).toBe(h.rig.rotation.x + (pose.pitch - h.rig.rotation.x) * 1);
    expect(cam.fov).toBe(FOV_DEG);
    expect(cam.rotation.order).toBe('YXZ');
  });

  it('holds the last pose and eases back to the rig over the return', () => {
    const h = harness();
    const planEnd = h.plan.seconds;
    const cam = frameAt(h, planEnd + RETURN_SECONDS / 2)!;
    const w = 1 - smooth((clockT(h) - planEnd) / RETURN_SECONDS);
    // The pose is pinned where the plan ended; only the weight moves now.
    const pose = h.poseAt(planEnd);
    expect(cam.position.x).toBe(h.rig.position.x + (pose.x - h.rig.position.x) * w);
    expect(cam.position.z).toBe(h.rig.position.z + (pose.z - h.rig.position.z) * w);
    expect(cam.fov).toBe(h.rig.fov + (FOV_DEG - h.rig.fov) * w);
  });

  it('gives the frame back to the rig when the return is over, once and for all', () => {
    const h = harness();
    expect(frameAt(h, h.plan.seconds + RETURN_SECONDS)).toBeNull();
    expect(h.camera.active).toBe(false);
    expect(h.camera.label).toBe('');
    expect(listenerCount('keydown')).toBe(0);
    // Rewinding the clock does not bring it back.
    expect(frameAt(h, 1)).toBeNull();
  });
});

// ========================================== the label =========================================

describe('the label', () => {
  it('is empty before the first frame and after the last', () => {
    const h = harness({ modeId: 'DOM', total: 30 });
    expect(h.camera.label).toBe('');
    frameAt(h, 2);
    frameAt(h, h.plan.seconds + RETURN_SECONDS);
    expect(h.camera.label).toBe('');
  });

  it('names the segment the timeline is in', () => {
    const h = harness({ modeId: 'DOM', total: 30 });
    frameAt(h, 2);
    const labels = h.plan.segments.map((s) => s.label);
    expect(labels).toContain(h.camera.label);
  });
});

// ====================================== the fast-forward ======================================

describe('holding the key', () => {
  it('hands the gain to the freeze itself when this client owns the clock', async () => {
    const h = harness();
    frameAt(h, 0.1);
    pressSpace();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const before = h.flow.phaseSecondsRemaining;
    h.camera.cameraFor(h.world, h.rig, 16 / 9, 0.016);
    expect(h.flow.asked.length).toBeGreaterThan(0);
    expect(h.flow.phaseSecondsRemaining).toBeLessThan(before);
  });

  it('never spends the countdown, however long the key is held', async () => {
    const h = harness();
    frameAt(h, 0.1);
    pressSpace();
    await new Promise((resolve) => setTimeout(resolve, 250));

    h.flow.phaseSecondsRemaining = COUNTDOWN_SECONDS + 0.05;
    h.camera.cameraFor(h.world, h.rig, 16 / 9, 0.016);
    for (const asked of h.flow.asked) expect(asked).toBeGreaterThanOrEqual(COUNTDOWN_SECONDS);
    expect(h.flow.phaseSecondsRemaining).toBeGreaterThanOrEqual(COUNTDOWN_SECONDS);
  });

  it('keeps the gain locally when the freeze belongs to a server', async () => {
    const h = harness({ authoritative: false });
    frameAt(h, 0.1);
    pressSpace();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const unboosted = h.flow.phaseSecondsTotal - h.flow.phaseSecondsRemaining;
    const cam = h.camera.cameraFor(h.world, h.rig, 16 / 9, 0.016)!;
    // The server's clock did not move ...
    expect(h.flow.phaseSecondsRemaining).toBe(h.flow.phaseSecondsTotal - 0.1);
    // ... but the camera is further along the plan than that clock alone would put it.
    const pose = h.poseAt(unboosted);
    expect(cam.position.x === pose.x && cam.position.z === pose.z).toBe(false);
  });
});
