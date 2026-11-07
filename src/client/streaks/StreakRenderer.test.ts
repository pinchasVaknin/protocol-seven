import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CarePackage } from '../../shared/streaks/CarePackage';
import { SentryGun } from '../../shared/streaks/SentryGun';
import { STREAK_DEFS } from '../../shared/streaks/StreakDefs';
import type { StreakSystem } from '../../shared/streaks/StreakSystem';
import { OBJ_TEAM_A, OBJ_TEAM_B, type StreakEntityState } from '../../shared/net/Skirmish';
import type { ViewerContext } from '../../shared/ui/TeamColour';
import { palette } from '../ui/Palette';
import { StreakRenderer } from './StreakRenderer';

/**
 * The two reconcile paths are the point of this file: one walks the local simulation's live
 * streaks and splits on the concrete class, the other walks the server's replicated records and
 * splits on the streak id. Both must end in the same meshes, and the tests below are written so
 * that a change to either dispatch shows up as a different scene.
 *
 * Real prototypes stand in for the streaks: `instanceof` has to answer exactly as it does in a
 * match, and constructing a `SentryGun` would drag the whole simulation in behind it.
 */

vi.mock('./SentryModel', async (importOriginal) => {
  const original = await importOriginal<typeof import('./SentryModel')>();
  return { ...original, sentryModel: (): null => null };
});

const KIND = Object.fromEntries(STREAK_DEFS.map((def, index) => [def.id, index])) as Record<string, number>;

interface FakeSentry {
  instanceId: number;
  x: number;
  y: number;
  z: number;
  restYaw: number;
  ownerId: number;
  team: 'A' | 'B';
  turretYaw: number;
  turretPitch: number;
  health: { fraction: number };
}

function sentry(instanceId: number, overrides: Partial<FakeSentry> = {}): SentryGun {
  const base: FakeSentry = {
    instanceId,
    x: 1,
    y: 0,
    z: -2,
    restYaw: 0.25,
    ownerId: 100,
    team: 'A',
    turretYaw: 0,
    turretPitch: 0,
    health: { fraction: 1 },
    ...overrides,
  };
  return Object.assign(Object.create(SentryGun.prototype) as object, base) as SentryGun;
}

function carePackage(instanceId: number, y = 5): CarePackage {
  return Object.assign(Object.create(CarePackage.prototype) as object, { instanceId, x: 4, y, z: -6 }) as CarePackage;
}

function record(instanceId: number, kind: number, overrides: Partial<StreakEntityState> = {}): StreakEntityState {
  return {
    instanceId,
    kind,
    ownerId: 100,
    team: 0,
    x: 1,
    y: 0,
    z: -2,
    yaw: 0.25,
    pitch: 0,
    health: 255,
    ...overrides,
  } as StreakEntityState;
}

let active: unknown[] = [];
let viewer: ViewerContext = { team: 'A', freeForAll: false };
let localId = 100;
let renderer: StreakRenderer;

function system(): StreakSystem {
  return { get active(): unknown[] { return active; } } as unknown as StreakSystem;
}

/** Bodies in the scene, by what they are: a sentry has a turret group, a crate has two meshes. */
function bodies(): THREE.Object3D[] {
  return [...renderer.group.children];
}

function fillOf(body: THREE.Object3D): THREE.Sprite | undefined {
  return body.children.find((c): c is THREE.Sprite => c.type === 'Sprite' && c.renderOrder === 11);
}

beforeEach(() => {
  (globalThis as Record<string, unknown>)['document'] = {
    documentElement: { style: { setProperty: (): undefined => undefined } },
  };
  palette.set('off');
  active = [];
  viewer = { team: 'A', freeForAll: false };
  localId = 100;
  renderer = new StreakRenderer(system(), () => viewer, (id) => id === localId);
});

describe('construction', () => {
  it('names its group and starts empty', () => {
    expect(renderer.group.name).toBe('streaks');
    expect(renderer.group.children).toHaveLength(0);
  });

  it('draws nothing for an empty roster', () => {
    renderer.update();
    expect(renderer.group.children).toHaveLength(0);
  });
});

describe('the local path', () => {
  it('draws a body for a sentry and for a care package', () => {
    active = [sentry(1), carePackage(2)];
    renderer.update();
    expect(bodies()).toHaveLength(2);
  });

  it('skips a streak with no body at all', () => {
    active = [sentry(1), { instanceId: 9, x: 0, y: 0, z: 0 }];
    renderer.update();
    expect(bodies()).toHaveLength(1);
  });

  it('places each body where its streak is', () => {
    active = [sentry(1, { x: 3, y: 0, z: -7, restYaw: 1.2 })];
    renderer.update();
    expect(bodies()[0]?.position.toArray()).toEqual([3, 0, -7]);
    expect(bodies()[0]?.rotation.y).toBeCloseTo(1.2, 10);
  });

  it('reuses the same mesh across frames', () => {
    active = [sentry(1)];
    renderer.update();
    const body = bodies()[0];
    renderer.update();
    renderer.update();
    expect(bodies()[0]).toBe(body);
    expect(bodies()).toHaveLength(1);
  });

  it('aims a sentry every frame from its own turret angles', () => {
    const gun = sentry(1);
    active = [gun];
    renderer.update();
    const turretGroup = bodies()[0]?.children.find((c) => c.type === 'Group') as THREE.Group;
    gun.turretYaw = -1.4;
    gun.turretPitch = 0.33;
    renderer.update();
    expect(turretGroup.rotation.y).toBeCloseTo(-1.4, 10);
    expect(turretGroup.rotation.x).toBeCloseTo(0.33, 10);
  });

  it('follows a sentry’s health onto its bar', () => {
    const gun = sentry(1);
    active = [gun];
    renderer.update();
    const fill = fillOf(bodies()[0] as THREE.Object3D);
    (gun.health as { fraction: number }).fraction = 0.25;
    renderer.update();
    expect(fill?.scale.x).toBeCloseTo(0.7 * 0.25, 10);
  });

  it('drops a care package as it falls', () => {
    const crate = carePackage(2, 9);
    active = [crate];
    renderer.update();
    crate.y = 2.5;
    renderer.update();
    expect(bodies()[0]?.position.y).toBe(2.5);
  });

  it('takes the rest yaw once, at construction, and not again', () => {
    const gun = sentry(1, { restYaw: 0.5 });
    active = [gun];
    renderer.update();
    (gun as unknown as { restYaw: number }).restYaw = -2;
    renderer.update();
    expect(bodies()[0]?.rotation.y).toBeCloseTo(0.5, 10);
  });
});

describe('the replicated path', () => {
  it('draws a body for a sentry record and a care package record', () => {
    renderer.updateReplicated([record(1, KIND['sentry'] ?? 0), record(2, KIND['care_package'] ?? 0)]);
    expect(bodies()).toHaveLength(2);
  });

  it('skips a kind with nothing to draw, and one it does not know', () => {
    renderer.updateReplicated([
      record(1, KIND['sentry'] ?? 0),
      record(2, KIND['uav'] ?? 0),
      record(3, 999),
    ]);
    expect(bodies()).toHaveLength(1);
  });

  it('reads the wire’s health as a share of full', () => {
    renderer.updateReplicated([record(1, KIND['sentry'] ?? 0, { health: 128 })]);
    const fill = fillOf(bodies()[0] as THREE.Object3D);
    expect(fill?.scale.x).toBeCloseTo(0.7 * (128 / 255), 6);
  });

  it('aims a replicated sentry from the bearing on the wire', () => {
    renderer.updateReplicated([record(1, KIND['sentry'] ?? 0, { yaw: 0.9, pitch: -0.2 })]);
    const turretGroup = bodies()[0]?.children.find((c) => c.type === 'Group') as THREE.Group;
    expect(turretGroup.rotation.y).toBeCloseTo(0.9, 10);
    expect(turretGroup.rotation.x).toBeCloseTo(-0.2, 10);
  });

  it('reuses the mesh across frames, as the local path does', () => {
    renderer.updateReplicated([record(1, KIND['sentry'] ?? 0)]);
    const body = bodies()[0];
    renderer.updateReplicated([record(1, KIND['sentry'] ?? 0)]);
    expect(bodies()[0]).toBe(body);
  });

  it('ends in the same scene the local path would build', () => {
    active = [sentry(1, { x: 1, y: 0, z: -2, restYaw: 0.25, turretYaw: 0, turretPitch: 0 })];
    renderer.update();
    const local = bodies()[0]?.position.toArray();
    const localRotation = bodies()[0]?.rotation.y;

    const other = new StreakRenderer(system(), () => viewer, (id) => id === localId);
    other.updateReplicated([record(1, KIND['sentry'] ?? 0)]);
    expect(other.group.children[0]?.position.toArray()).toEqual(local);
    expect(other.group.children[0]?.rotation.y).toBeCloseTo(localRotation ?? 0, 10);
  });
});

describe('what a sentry is to the viewer', () => {
  it('paints your own sentry friendly, in every mode', () => {
    for (const context of [
      { team: 'A', freeForAll: false },
      { team: 'B', freeForAll: false },
      { team: 'A', freeForAll: true },
    ] as ViewerContext[]) {
      viewer = context;
      const fresh = new StreakRenderer(system(), () => viewer, (id) => id === localId);
      active = [sentry(1, { ownerId: 100, team: 'A' })];
      fresh.update();
      const fill = fillOf(fresh.group.children[0] as THREE.Object3D);
      expect((fill?.material as THREE.SpriteMaterial).color.getHex()).toBe(palette.current.friendly);
    }
  });

  it('paints an enemy sentry hostile', () => {
    viewer = { team: 'A', freeForAll: false };
    active = [sentry(1, { ownerId: 999, team: 'B' })];
    renderer.update();
    const fill = fillOf(bodies()[0] as THREE.Object3D);
    expect((fill?.material as THREE.SpriteMaterial).color.getHex()).toBe(palette.current.hostile);
  });

  it('makes somebody else’s sentry hostile in a free-for-all even on your own side', () => {
    viewer = { team: 'A', freeForAll: true };
    active = [sentry(1, { ownerId: 999, team: 'A' })];
    renderer.update();
    const fill = fillOf(bodies()[0] as THREE.Object3D);
    expect((fill?.material as THREE.SpriteMaterial).color.getHex()).toBe(palette.current.hostile);
  });

  it('reads the replicated record’s team byte, where only OBJ_TEAM_B means B', () => {
    viewer = { team: 'A', freeForAll: false };
    renderer.updateReplicated([record(1, KIND['sentry'] ?? 0, { ownerId: 999, team: OBJ_TEAM_B })]);
    expect((fillOf(bodies()[0] as THREE.Object3D)?.material as THREE.SpriteMaterial).color.getHex()).toBe(palette.current.hostile);

    const other = new StreakRenderer(system(), () => viewer, (id) => id === localId);
    other.updateReplicated([record(1, KIND['sentry'] ?? 0, { ownerId: 999, team: OBJ_TEAM_A })]);
    expect((fillOf(other.group.children[0] as THREE.Object3D)?.material as THREE.SpriteMaterial).color.getHex()).toBe(palette.current.friendly);
  });
});

describe('retirement', () => {
  it('disposes a body whose streak has gone', () => {
    active = [sentry(1), carePackage(2)];
    renderer.update();
    expect(bodies()).toHaveLength(2);
    active = [sentry(1)];
    renderer.update();
    expect(bodies()).toHaveLength(1);
  });

  it('unparents the retired body, leaving nothing behind in the scene', () => {
    active = [sentry(1), sentry(2)];
    renderer.update();
    active = [];
    renderer.update();
    expect(renderer.group.children).toHaveLength(0);
  });

  it('retires across the replicated path too', () => {
    renderer.updateReplicated([record(1, KIND['sentry'] ?? 0), record(2, KIND['care_package'] ?? 0)]);
    renderer.updateReplicated([]);
    expect(renderer.group.children).toHaveLength(0);
  });

  it('builds a new body when the same id comes back', () => {
    active = [sentry(1)];
    renderer.update();
    const first = bodies()[0];
    active = [];
    renderer.update();
    active = [sentry(1)];
    renderer.update();
    expect(bodies()[0]).not.toBe(first);
  });
});

describe('dispose', () => {
  it('empties the group and unparents it', () => {
    const scene = new THREE.Group();
    scene.add(renderer.group);
    active = [sentry(1), carePackage(2)];
    renderer.update();
    renderer.dispose();
    expect(renderer.group.children).toHaveLength(0);
    expect(renderer.group.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
  });
});
