import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../shared/core/EventBus';
import { EV, type GameBus, type GameEvents } from '../../shared/core/Events';
import { PLAYER_ENTITY_ID } from '../../shared/combat/DamageSystem';
import { PICKUP_HEIGHT, PICKUP_LIFETIME, type PerksRuntime, type Pickup } from '../../shared/perks/PerksRuntime';
import { PerksRenderer } from './PerksRenderer';

/**
 * What the perks look like (M9), pinned before unit C1's refactor.
 *
 * The runtime is faked rather than built: `PerksRuntime` owns whether a pickup exists and
 * whether a footstep is revealed, and those rules are tested where they live. What is pinned
 * here is this file's half — the pool it builds, the bob, the spin, the blink, and the ring
 * the trail is compacted out of.
 */

// ========================================== the fake ==========================================

interface FakePerks {
  pickups: Pickup[];
  perkState: { tracker: boolean };
  revealed: Set<number>;
  revealsFootstep(entityId: number): boolean;
}

function fakePerks(pickupCount: number): FakePerks {
  const pickups: Pickup[] = [];
  for (let i = 0; i < pickupCount; i++) pickups.push({ active: false, x: 0, y: 0, z: 0, age: 0 });
  const revealed = new Set<number>();
  return {
    pickups,
    perkState: { tracker: false },
    revealed,
    revealsFootstep: (entityId: number) => revealed.has(entityId),
  };
}

function makeRenderer(pickupCount = 3): {
  renderer: PerksRenderer;
  perks: FakePerks;
  bus: GameBus;
  scene: THREE.Scene;
} {
  const perks = fakePerks(pickupCount);
  const bus: GameBus = new EventBus<GameEvents>();
  const scene = new THREE.Scene();
  const renderer = new PerksRenderer(perks as unknown as PerksRuntime, bus, scene);
  return { renderer, perks, bus, scene };
}

function step(bus: GameBus, entityId: number, x: number, y: number, z: number): void {
  bus.emit(EV.PlayerFootstep, { entityId, x, y, z, speed: 4, heavy: false, quiet: false, material: 0 });
}

function pickupMeshes(renderer: PerksRenderer): THREE.Mesh[] {
  return renderer.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
}

function trailCloud(renderer: PerksRenderer): THREE.Points {
  const points = renderer.group.children.find((c): c is THREE.Points => c instanceof THREE.Points);
  if (points === undefined) throw new Error('no trail cloud in the group');
  return points;
}

// ======================================== the pickups =========================================

describe('the scavenger pickup pool', () => {
  it('builds one hidden mesh per simulation slot, plus the trail cloud, under one named group', () => {
    const { renderer, scene } = makeRenderer(4);
    expect(renderer.group.name).toBe('perks');
    expect(scene.children).toContain(renderer.group);
    expect(renderer.group.children).toHaveLength(5);
    const meshes = pickupMeshes(renderer);
    expect(meshes).toHaveLength(4);
    for (const mesh of meshes) {
      expect(mesh.visible).toBe(false);
      expect(mesh.matrixAutoUpdate).toBe(false);
    }
    // One geometry and one material across the pool, not four of each.
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(1);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    // The cloud is added after the meshes, and starts hidden with nothing to draw.
    const cloud = trailCloud(renderer);
    expect(renderer.group.children.indexOf(cloud)).toBe(4);
    expect(cloud.visible).toBe(false);
    expect(cloud.frustumCulled).toBe(false);
    expect(cloud.geometry.drawRange.count).toBe(0);
  });

  it('shows an active pickup at its bob height and spins it on the frame delta', () => {
    const { renderer, perks } = makeRenderer(1);
    const pickup = perks.pickups[0]!;
    pickup.active = true;
    pickup.x = 2;
    pickup.y = 1;
    pickup.z = -3;

    renderer.render(0.5);
    const mesh = pickupMeshes(renderer)[0]!;
    const spin = 0.5 * 2.2;
    expect(mesh.visible).toBe(true);
    expect(mesh.position.x).toBe(2);
    expect(mesh.position.z).toBe(-3);
    expect(mesh.position.y).toBe(1 + PICKUP_HEIGHT + Math.sin(spin * 1.6) * 0.05);
    expect(mesh.rotation.y).toBe(spin);
    expect(mesh.scale.x).toBe(1);
  });

  it('blinks over the last three seconds of a pickup life, and not before', () => {
    const steady = makeRenderer(1);
    steady.perks.pickups[0]!.active = true;
    steady.perks.pickups[0]!.age = PICKUP_LIFETIME - 3;
    steady.renderer.render(0.1);
    expect(pickupMeshes(steady.renderer)[0]!.scale.x).toBe(1);

    const blinking = makeRenderer(1);
    blinking.perks.pickups[0]!.active = true;
    blinking.perks.pickups[0]!.age = PICKUP_LIFETIME - 2.9;
    blinking.renderer.render(0.1);
    const spin = 0.1 * 2.2;
    expect(pickupMeshes(blinking.renderer)[0]!.scale.x).toBe(0.7 + 0.3 * Math.abs(Math.sin(spin * 6)));
  });

  it('hides a spent pickup and forgets its spin, so the next one starts upright', () => {
    const { renderer, perks } = makeRenderer(1);
    const pickup = perks.pickups[0]!;
    pickup.active = true;
    renderer.render(1);
    expect(pickupMeshes(renderer)[0]!.rotation.y).toBe(2.2);

    pickup.active = false;
    renderer.render(1);
    expect(pickupMeshes(renderer)[0]!.visible).toBe(false);

    pickup.active = true;
    renderer.render(0.5);
    expect(pickupMeshes(renderer)[0]!.rotation.y).toBe(0.5 * 2.2);
  });
});

// ========================================= the trail ==========================================

describe('the tracker trail', () => {
  it('stays dark while Tracker is not equipped, whatever walks past', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.revealed.add(9);
    step(bus, 9, 1, 0, 1);
    renderer.render(0.1);
    expect(renderer.trailPoints).toBe(0);
    expect(trailCloud(renderer).visible).toBe(false);
  });

  it('remembers only revealed footsteps, a little above the floor', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);

    step(bus, 9, 1, 0, 2);
    step(bus, 4, 5, 0, 6); // not revealed: an ally, or no Tracker on this one
    step(bus, 9, 3, 0, 4);
    renderer.render(0.1);

    expect(renderer.trailPoints).toBe(2);
    const cloud = trailCloud(renderer);
    expect(cloud.visible).toBe(true);
    expect(cloud.geometry.drawRange.count).toBe(2);
    const pos = cloud.geometry.getAttribute('position');
    // The buffers are Float32Array, so the read-back is the single-precision value.
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([1, Math.fround(0.04), 2]);
    expect([pos.getX(1), pos.getY(1), pos.getZ(1)]).toEqual([3, Math.fround(0.04), 4]);
  });

  it('cools a print from accent-hot to a dim ember as it ages', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);
    step(bus, 9, 0, 0, 0);

    renderer.render(0);
    const colour = trailCloud(renderer).geometry.getAttribute('color');
    expect([colour.getX(0), colour.getY(0), colour.getZ(0)]).toEqual([1, Math.fround(0.7), 0.25]);

    renderer.render(4.5);
    expect(colour.getY(0)).toBe(Math.fround(0.35 + 0.35 * 0.5));
    expect(colour.getZ(0)).toBe(Math.fround(0.1 + 0.15 * 0.5));
  });

  it('drops a print after nine seconds and goes dark when the last one goes', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);
    step(bus, 9, 0, 0, 0);

    renderer.render(8.9);
    expect(renderer.trailPoints).toBe(1);
    renderer.render(0.2);
    expect(renderer.trailPoints).toBe(0);
    expect(trailCloud(renderer).visible).toBe(false);
    expect(trailCloud(renderer).geometry.drawRange.count).toBe(0);
  });

  it('compacts the live prints to the front of the buffer', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);

    step(bus, 9, 1, 0, 1);
    renderer.render(5);
    step(bus, 9, 2, 0, 2);
    renderer.render(5); // the first print is now past nine seconds

    expect(renderer.trailPoints).toBe(1);
    const pos = trailCloud(renderer).geometry.getAttribute('position');
    expect([pos.getX(0), pos.getZ(0)]).toEqual([2, 2]);
  });

  it('clears the trail when the local player respawns, and only for them', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);
    step(bus, 9, 1, 0, 1);
    renderer.render(0.1);
    expect(renderer.trailPoints).toBe(1);

    bus.emit(EV.PlayerSpawned, { entityId: 9, x: 0, y: 0, z: 0, yaw: 0 });
    renderer.render(0.1);
    expect(renderer.trailPoints).toBe(1);

    bus.emit(EV.PlayerSpawned, { entityId: PLAYER_ENTITY_ID, x: 0, y: 0, z: 0, yaw: 0 });
    expect(renderer.trailPoints).toBe(0);
    expect(trailCloud(renderer).visible).toBe(false);
    renderer.render(0.1);
    expect(renderer.trailPoints).toBe(0);
  });

  it('clears what it was showing the frame Tracker comes off', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);
    step(bus, 9, 1, 0, 1);
    renderer.render(0.1);
    expect(trailCloud(renderer).visible).toBe(true);

    perks.perkState.tracker = false;
    renderer.render(0.1);
    expect(renderer.trailPoints).toBe(0);
    expect(trailCloud(renderer).visible).toBe(false);
  });

  it('keeps at most a ring of prints, the oldest overwritten first', () => {
    const { renderer, perks, bus } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);
    for (let i = 0; i < 200; i++) step(bus, 9, i, 0, 0);
    renderer.render(0.1);
    expect(renderer.trailPoints).toBe(160);
  });
});

// ======================================== the teardown ========================================

describe('PerksRenderer.dispose', () => {
  it('leaves the scene, empties the group and drops its subscriptions', () => {
    const { renderer, perks, bus, scene } = makeRenderer();
    perks.perkState.tracker = true;
    perks.revealed.add(9);

    renderer.dispose();
    expect(scene.children).not.toContain(renderer.group);
    expect(renderer.group.children).toHaveLength(0);

    // A footstep after teardown reaches nothing.
    step(bus, 9, 1, 0, 1);
    expect(bus.listenerCount(EV.PlayerFootstep)).toBe(0);
  });
});
