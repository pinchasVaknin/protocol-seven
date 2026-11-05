import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGameBus, EV, type GameBus } from '../../shared/core/Events';
import { DT } from '../../shared/core/Loop';
import { DamageSystem } from '../../shared/combat/DamageSystem';
import type { HitZone } from '../../shared/combat/HitboxRig';
import { findMap } from '../../shared/modes/ModeRegistry';
import { loadMapCollision } from '../../shared/world/MapLoader';
import type { CollisionWorld } from '../../shared/world/CollisionWorld';
import { DEFAULT_HEALTH_CONFIG } from '../../shared/player/Health';
import { TargetRange } from './TargetRange';

/**
 * The range builds twelve `TargetDummy` instances, so it needs the same recording canvas they
 * do — and the real grey-box collision world, which is shared code and runs in node, so the
 * floor each dummy is snapped to is the one the map actually has.
 */

function installCanvasRecorder(): void {
  const ctx: Record<string, unknown> = {};
  for (const op of ['clearRect', 'fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke']) {
    ctx[op] = (): undefined => undefined;
  }
  (globalThis as Record<string, unknown>)['document'] = {
    createElement: (): unknown => ({ width: 0, height: 0, getContext: (): unknown => ctx }),
    documentElement: { style: { setProperty: (): undefined => undefined } },
  };
}

/**
 * The grey-box testbed, whose geometry the range is authored over.
 *
 * Built once for the file: the range only ever reads it, through `probeGround`, so there is
 * nothing for one test to leave behind for the next — and baking the map's colliders five
 * times over is the most expensive thing this file would otherwise do.
 */
let testbed: CollisionWorld | null = null;
function testbedWorld(): CollisionWorld {
  testbed ??= loadMapCollision(findMap('mp_testbed').def).collision;
  return testbed;
}

interface Built {
  readonly range: TargetRange;
  readonly bus: GameBus;
  readonly damage: DamageSystem;
}

function build(world?: CollisionWorld): Built {
  const bus = createGameBus();
  const damage = new DamageSystem(bus);
  const range = new TargetRange(damage, bus, DEFAULT_HEALTH_CONFIG, world);
  return { range, bus, damage };
}

/**
 * One range per shape, shared by the tests that only read it.
 *
 * Building twelve dummies merges twenty-four geometries and makes twelve canvases, so a fresh
 * range per assertion was by far the most expensive thing in this file. The groups below that
 * change a range's state still build their own.
 */
let sharedFlat: Built | null = null;
let sharedGrounded: Built | null = null;
function readOnlyFlat(): Built {
  sharedFlat ??= build();
  return sharedFlat;
}
function readOnlyGrounded(): Built {
  sharedGrounded ??= build(testbedWorld());
  return sharedGrounded;
}

/** The payload `DamageSystem` publishes, as the range's subscriber reads it. */
function damageDealt(targetId: number, amount: number, zone: HitZone, distance: number) {
  return {
    sourceId: 0,
    targetId,
    weaponId: 'ar_carbine',
    zone,
    amount,
    x: 0,
    y: 0,
    z: 0,
    distance,
    falloffLoss: 0,
    penetrationLoss: 0,
    lethal: false,
    autonomous: false,
  };
}

const FIRING_LINE = { x: -20, z: -14 };

beforeEach(() => {
  installCanvasRecorder();
});

describe('TargetRange layout', () => {
  it('builds twelve targets under one named group', () => {
    const { range } = readOnlyFlat();
    expect(range.dummies).toHaveLength(12);
    expect(range.group.name).toBe('targets');
    expect(range.group.children).toHaveLength(12);
  });

  it('keeps every entity id clear of the human, bot and streak ranges', () => {
    const { range } = readOnlyFlat();
    for (const dummy of range.dummies) {
      expect(dummy.entityId).toBeGreaterThanOrEqual(10_000);
      expect(dummy.entityId).toBeLessThan(10_100);
    }
    const ids = range.dummies.map((d) => d.entityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lays the four measurement targets at exactly their stated straight-line range', () => {
    const { range } = readOnlyFlat();
    for (const metres of [5, 15, 25, 40]) {
      const dummy = range.dummies.find((d) => d.displayName === `${metres} M`);
      expect(dummy).toBeDefined();
      const dx = (dummy?.rig.x ?? 0) - FIRING_LINE.x;
      const dz = (dummy?.rig.z ?? 0) - FIRING_LINE.z;
      expect(Math.hypot(dx, dz)).toBeCloseTo(metres, 6);
    }
  });

  it('fans the four laterally, so none stands in front of another', () => {
    const { range } = readOnlyFlat();
    const laterals = [5, 15, 25, 40].map((m) => (range.dummies.find((d) => d.displayName === `${m} M`)?.rig.z ?? 0) - FIRING_LINE.z);
    expect(new Set(laterals).size).toBe(4);
    for (const lateral of laterals) expect(Math.abs(lateral)).toBeGreaterThan(0);
  });

  it('deals the behaviours the three bays ask for', () => {
    const { range } = readOnlyFlat();
    const counts = new Map<string, number>();
    for (const dummy of range.dummies) counts.set(dummy.behaviour, (counts.get(dummy.behaviour) ?? 0) + 1);
    expect(counts.get('static')).toBe(6);
    expect(counts.get('popup')).toBe(1);
    expect(counts.get('strafe')).toBe(2);
    expect(counts.get('infinite')).toBe(1);
    expect(counts.get('faller')).toBe(2);
  });

  it('puts the one infinite dummy alone in its own bay', () => {
    const { range } = readOnlyFlat();
    const dps = range.dummies.filter((d) => d.isInfinite);
    expect(dps).toHaveLength(1);
    const z = dps[0]?.rig.z ?? 0;
    for (const other of range.dummies) {
      if (other === dps[0]) continue;
      expect(Math.abs(other.rig.z - z)).toBeGreaterThan(1);
    }
  });

  it('faces every target back down the lane', () => {
    const { range } = readOnlyFlat();
    for (const dummy of range.dummies) expect(dummy.rig.yaw).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('TargetRange grounding', () => {
  it('leaves the authored height alone when there is no world to probe', () => {
    const { range } = readOnlyFlat();
    for (const dummy of range.dummies) expect(dummy.rig.y).toBe(0);
  });

  it('stands a target on the geometry under it rather than on its authored y', () => {
    const { range } = readOnlyGrounded();
    const dps = range.dummies.find((d) => d.isInfinite);
    // The DPS dummy is authored at y 0 and sits on the testbed's 1.5 m ledge.
    expect(dps?.rig.y).toBeCloseTo(1.5, 6);
  });

  it('raises the near faller onto the step it stands on', () => {
    const { range } = readOnlyGrounded();
    const near = range.dummies.find((d) => d.displayName === 'FALLER 20 m');
    expect(near?.rig.y).toBeCloseTo(0.3, 6);
  });

  it('leaves a target on the flat part of the room exactly where it was authored', () => {
    const { range } = readOnlyGrounded();
    const five = range.dummies.find((d) => d.displayName === '5 M');
    expect(five?.rig.y).toBe(0);
  });

  it('does not move a target sideways when it grounds it', () => {
    const flat = readOnlyFlat();
    const grounded = readOnlyGrounded();
    for (let i = 0; i < 12; i++) {
      expect(grounded.range.dummies[i]?.rig.x).toBe(flat.range.dummies[i]?.rig.x);
      expect(grounded.range.dummies[i]?.rig.z).toBe(flat.range.dummies[i]?.rig.z);
    }
  });
});

describe('TargetRange lookup', () => {
  it('answers by id', () => {
    const { range } = readOnlyFlat();
    const first = range.dummies[0];
    expect(range.get(first?.entityId ?? 0)).toBe(first);
  });

  it('answers undefined for an id it does not hold', () => {
    const { range } = readOnlyFlat();
    expect(range.get(-1)).toBeUndefined();
    expect(range.get(0)).toBeUndefined();
    expect(range.get(10_099)).toBeUndefined();
  });
});

describe('TargetRange damage wiring', () => {
  it('registers every target with the damage system', () => {
    const { range, damage } = build();
    for (const dummy of range.dummies) expect(damage.get(dummy.entityId)).toBe(dummy);
    range.dispose();
  });

  it('drives the read-out off the damage event rather than the shot', () => {
    const { range, bus } = build();
    const victim = range.dummies[0];
    bus.emit(EV.DamageDealt, damageDealt(victim?.entityId ?? 0, 37.5, 'head', 21.5));
    expect(victim?.totalDamage).toBeCloseTo(37.5, 10);
    expect(victim?.lastDamage).toBeCloseTo(37.5, 10);
    expect(victim?.lastZone).toBe('head');
    expect(victim?.lastDistance).toBeCloseTo(21.5, 10);
    range.dispose();
  });

  it('ignores a damage event for something that is not a target', () => {
    const { range, bus } = build();
    const totals = range.dummies.map((d) => d.totalDamage);
    expect(() => bus.emit(EV.DamageDealt, damageDealt(-99, 10, 'torso', 1))).not.toThrow();
    expect(range.dummies.map((d) => d.totalDamage)).toEqual(totals);
    range.dispose();
  });

  it('sends each event only to the target it names', () => {
    const { range, bus } = build();
    const victim = range.dummies[2];
    bus.emit(EV.DamageDealt, damageDealt(victim?.entityId ?? 0, 20, 'torso', 5));
    for (const dummy of range.dummies) {
      expect(dummy.totalDamage).toBeCloseTo(dummy === victim ? 20 : 0, 10);
    }
    range.dispose();
  });
});

describe('TargetRange ticking', () => {
  it('steps every target once per tick', () => {
    const { range } = build();
    const popup = range.dummies.find((d) => d.behaviour === 'popup');
    const before = popup?.rig.y ?? 0;
    for (let i = 0; i < Math.round(4 / DT); i++) range.step();
    expect(popup?.rig.y).not.toBe(before);
    range.dispose();
  });

  it('moves the movers and leaves the statics alone', () => {
    const { range } = build();
    const statics = range.dummies.filter((d) => d.behaviour === 'static' || d.isInfinite);
    const before = statics.map((d) => [d.rig.x, d.rig.y, d.rig.z]);
    for (let i = 0; i < 600; i++) range.step();
    expect(statics.map((d) => [d.rig.x, d.rig.y, d.rig.z])).toEqual(before);
    range.dispose();
  });

  it('renders every target against one camera position', () => {
    const { range } = build();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
    camera.position.set(FIRING_LINE.x, 1.6, FIRING_LINE.z);
    range.step();
    range.updateVisuals(1, camera);
    for (const dummy of range.dummies) {
      expect(dummy.group.position.x).toBeCloseTo(dummy.rig.x, 10);
      expect(dummy.group.position.z).toBeCloseTo(dummy.rig.z, 10);
    }
    range.dispose();
  });

  it('resets every target at once', () => {
    const { range, bus } = build();
    for (const dummy of range.dummies) {
      bus.emit(EV.DamageDealt, damageDealt(dummy.entityId, 40, 'torso', 9));
    }
    expect(range.dummies.every((d) => d.totalDamage > 0)).toBe(true);
    range.resetAll();
    expect(range.dummies.every((d) => d.totalDamage === 0)).toBe(true);
    expect(range.dummies.every((d) => d.health.current === DEFAULT_HEALTH_CONFIG.max)).toBe(true);
    range.dispose();
  });
});

describe('TargetRange dispose', () => {
  it('unregisters every target from the damage system', () => {
    const { range, damage } = build();
    const ids = range.dummies.map((d) => d.entityId);
    range.dispose();
    for (const id of ids) expect(damage.get(id)).toBeUndefined();
  });

  it('empties the list and the group', () => {
    const { range } = build();
    range.dispose();
    expect(range.dummies).toHaveLength(0);
    expect(range.group.children).toHaveLength(0);
    expect(range.get(10_001)).toBeUndefined();
  });

  it('releases the shared materials once', () => {
    const { range } = build();
    expect(() => range.dispose()).not.toThrow();
  });
});
