import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import { DEG2RAD } from '../core/MathUtil';
import { simCos, simSin } from '../core/SimMath';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld, makeMoveOutput } from '../world/CollisionWorld';
import { DEFAULT_EQUIPMENT_CONFIG } from './EquipmentConfig';
import { equipmentDef } from './EquipmentDefs';
import {
  LAUNCH,
  ProjectilePool,
  previewTrajectory,
  solveLaunch,
  type Projectile,
} from './Projectile';

/**
 * A thrown object in flight, pinned.
 *
 * The design claim is that there is no second collision scheme: the arc is an integrated
 * ballistic curve stepped through the *existing* swept capsule solver, with a capsule whose
 * height is twice its radius. So what is held still below is the integration (gravity, drag,
 * one swept move a tick) and the three impact behaviours, each of which is a different grenade:
 * a frag rolls round a corner, a semtex stops where it lands, a claymore plants on the floor and
 * drops off a wall.
 *
 * `previewTrajectory` gets its own section because it exists to be the *same* integration — the
 * bot's safety check is only honest if the preview cannot disagree with the throw — so the test
 * that matters most is the one that runs both over the same arc and compares them.
 */

const CFG = DEFAULT_EQUIPMENT_CONFIG;
const FRAG = equipmentDef('frag');
const SEMTEX = equipmentDef('semtex');
const CLAYMORE = equipmentDef('claymore');

const FLOOR = { x: 40, y: 1, z: 40 };
const BOUNDS = { min: { x: -20, y: -8, z: -20 }, max: { x: 20, y: 12, z: 20 } };

/** A floor whose top face is y = 0, plus whatever else the test asks for. */
function world(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 2);
  set.add({ x: 0, y: -0.5, z: 0 }, FLOOR, 0, 0, 0, 'floor');
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  return new CollisionWorld(set, BOUNDS, 4);
}

/** A world with nothing in it at all, for the free-flight assertions. */
function emptyWorld(): CollisionWorld {
  return new CollisionWorld(new ColliderSet(1), BOUNDS, 4);
}

function pool(capacity = 4): ProjectilePool {
  return new ProjectilePool(capacity, FRAG);
}

/** One live projectile of `def`, at `(x, y, z)` with velocity `(vx, vy, vz)`. */
function live(
  p: ProjectilePool,
  def = FRAG,
  x = 0,
  y = 1,
  z = 0,
  vx = 0,
  vy = 0,
  vz = 0,
): Projectile {
  const made = p.spawn(def, 7, 'A', x, y, z, vx, vy, vz, def.fuseSeconds);
  expect(made).not.toBe(null);
  return made as Projectile;
}

describe('a fresh pool', () => {
  it('is its capacity of inactive slots and counts none of them', () => {
    const p = pool(3);
    expect(p.items.length).toBe(3);
    expect(p.items.every((x) => !x.active)).toBe(true);
    expect(p.liveCount).toBe(0);
  });
});

describe('claiming a slot', () => {
  it('writes every field of the record, and a rising serial', () => {
    const p = pool();
    const first = p.spawn(SEMTEX, 7, 'B', 1, 2, 3, 4, 5, 6, 2.4) as Projectile;
    expect(first).toEqual({
      active: true,
      serial: 1,
      def: SEMTEX,
      ownerId: 7,
      team: 'B',
      phase: 'LIVE',
      x: 1,
      y: 2,
      z: 3,
      vx: 4,
      vy: 5,
      vz: 6,
      px: 1,
      py: 2,
      pz: 3,
      fuse: 2.4,
      age: 0,
      yaw: Math.atan2(-4, -6),
      pollTimer: 0,
      resting: false,
      stuckTo: -1,
      material: 0,
      replicated: false,
      tx: 1,
      ty: 2,
      tz: 3,
    } satisfies Projectile);
    expect((p.spawn(FRAG, 1, 'A', 0, 0, 0, 0, 0, 0, 3.5) as Projectile).serial).toBe(2);
    expect(p.liveCount).toBe(2);
  });

  it('faces the way it was thrown, so an oriented mesh reads right', () => {
    const p = pool();
    // Yaw 0 looks down -Z, so a throw along -Z comes out facing straight ahead.
    expect(Math.abs(live(p, FRAG, 0, 1, 0, 0, 0, -5).yaw)).toBe(0);
    // And a quarter turn for one thrown along -X.
    expect(live(p, FRAG, 0, 1, 0, -5, 0, 0).yaw).toBe(Math.PI * 0.5);
  });

  it('never comes back wearing the last tenant replication state', () => {
    const p = pool(1);
    const first = live(p);
    first.replicated = true;
    first.tx = 99;
    p.release(first);
    const second = live(p, FRAG, 5, 6, 7);
    expect(second.replicated).toBe(false);
    expect(second.tx).toBe(5);
    expect(second.ty).toBe(6);
    expect(second.tz).toBe(7);
  });

  it('refuses rather than growing, so the frame budget stays knowable', () => {
    const p = pool(2);
    live(p);
    live(p);
    expect(p.spawn(FRAG, 1, 'A', 0, 0, 0, 0, 0, 0, 3.5)).toBe(null);
  });

  it('is handed back on release, and all of them at once on releaseAll', () => {
    const p = pool(3);
    const one = live(p);
    live(p);
    one.phase = 'STUCK';
    one.stuckTo = 4;
    p.release(one);
    expect(one.active).toBe(false);
    expect(one.phase).toBe('LIVE');
    expect(one.stuckTo).toBe(-1);
    expect(p.liveCount).toBe(1);
    p.releaseAll();
    expect(p.liveCount).toBe(0);
  });
});

describe('one tick of free flight', () => {
  it('takes the previous centre, ages, and integrates gravity and drag', () => {
    const p = pool();
    const w = emptyWorld();
    const g = live(p, FRAG, 0, 5, 0, 3, 0, 0);
    const r = p.step(g, w, CFG);

    const decay = Math.max(0, 1 - CFG.drag * DT);
    const vy = -CFG.gravity * DT * decay;
    const vx = 3 * decay;
    expect(g.px).toBe(0);
    expect(g.py).toBe(5);
    expect(g.pz).toBe(0);
    expect(g.age).toBe(DT);
    expect(g.vx).toBe(vx);
    expect(g.vy).toBe(vy);
    expect(g.vz).toBe(0);
    expect(g.x).toBe(vx * DT);
    // The centre goes through the capsule solver's own frame and back — `moveCapsule` is given
    // the feet, so a radius comes off and goes back on — which is a different float from
    // `5 + vy * DT` by one ulp. The velocities above are the exact pins; bit-exactness of the
    // position belongs to the 3,600-tick state hashes.
    expect(g.y).toBeCloseTo(5 + vy * DT, 10);
    expect(g.y).toBeLessThan(5);
    expect(r).toEqual({ bounced: false, stuck: false, planted: false, impactSpeed: 0 });
  });

  it('falls faster every tick, which is what makes it an arc', () => {
    const p = pool();
    const w = emptyWorld();
    const g = live(p, FRAG, 0, 8, 0, 0, 0, 0);
    let last = 0;
    for (let i = 0; i < 10; i++) {
      p.step(g, w, CFG);
      expect(g.vy).toBeLessThan(last);
      last = g.vy;
    }
    expect(g.y).toBeLessThan(8);
  });

  it('bleeds speed to drag, so a hard throw does not carry half the map', () => {
    const p = pool();
    const w = emptyWorld();
    const g = live(p, FRAG, 0, 8, 0, 20, 0, 0);
    for (let i = 0; i < 60; i++) p.step(g, w, CFG);
    expect(g.vx).toBeLessThan(20);
    expect(g.vx).toBeGreaterThan(0);
  });

  it('does nothing but age once it is resting or out of its flight phase', () => {
    const p = pool();
    const w = emptyWorld();
    const resting = live(p, FRAG, 1, 2, 3, 9, 9, 9);
    resting.resting = true;
    expect(p.step(resting, w, CFG)).toEqual({
      bounced: false,
      stuck: false,
      planted: false,
      impactSpeed: 0,
    });
    expect(resting.x).toBe(1);
    expect(resting.vx).toBe(9);
    expect(resting.age).toBe(DT);

    const stuck = live(p, SEMTEX, 1, 2, 3, 9, 9, 9);
    stuck.phase = 'STUCK';
    p.step(stuck, w, CFG);
    expect(stuck.x).toBe(1);
    expect(stuck.vy).toBe(9);
  });

  it('hands back a record it reuses, so a caller must copy what it keeps', () => {
    const p = pool();
    const w = emptyWorld();
    const first = p.step(live(p, FRAG, 0, 5, 0), w, CFG);
    const second = p.step(live(p, FRAG, 0, 5, 0), w, CFG);
    expect(first).toBe(second);
  });
});

describe('a frag that meets the floor', () => {
  it('bounces, keeping the restitution along the normal and the friction across it', () => {
    const p = pool();
    const w = world();
    const g = live(p, FRAG, 0, 0.12, 0, 4, -10, 0);
    const r = p.step(g, w, CFG);

    expect(r.bounced).toBe(true);
    expect(r.stuck).toBe(false);
    expect(r.planted).toBe(false);
    expect(r.impactSpeed).toBeGreaterThan(9);
    // Up again, slower, and still carrying most of its horizontal speed.
    expect(g.vy).toBeGreaterThan(0);
    expect(g.vy).toBeLessThan(10 * FRAG.restitution + 1);
    expect(g.vx).toBeGreaterThan(0);
    expect(g.vx).toBeLessThan(4);
    expect(g.phase).toBe('LIVE');
    expect(g.resting).toBe(false);
  });

  it('is told what it hit, for the bounce sound', () => {
    const p = pool();
    const w = world();
    const g = live(p, FRAG, 0, 0.12, 0, 0, -10, 0);
    p.step(g, w, CFG);
    expect(g.material).toBe(w.colliders.materialAt(0));
  });

  it('stops rolling once it is slower than its rest speed', () => {
    const p = pool();
    const w = world();
    const g = live(p, FRAG, 0, 0.08, 0, 0.2, -0.3, 0);
    const r = p.step(g, w, CFG);
    expect(g.resting).toBe(true);
    expect(g.vx).toBe(0);
    expect(g.vy).toBe(0);
    expect(g.vz).toBe(0);
    // A roll is not a click: the contact is reported but the bounce is not.
    expect(r.bounced).toBe(false);
    expect(r.impactSpeed).toBeGreaterThan(0);
  });

  it('comes to rest somewhere on the floor rather than falling through it', () => {
    const p = pool();
    const w = world();
    const g = live(p, FRAG, 0, 2, 0, 3, 0, 0);
    for (let i = 0; i < 600 && !g.resting; i++) p.step(g, w, CFG);
    expect(g.resting).toBe(true);
    expect(g.y).toBeGreaterThan(0);
    expect(g.y).toBeLessThan(0.3);
  });
});

describe('a semtex that meets anything', () => {
  it('stops dead and faces out of the surface', () => {
    const p = pool();
    const w = world();
    const g = live(p, SEMTEX, 0, 0.12, 0, 4, -10, 0);
    const r = p.step(g, w, CFG);
    expect(r.stuck).toBe(true);
    expect(r.bounced).toBe(false);
    expect(g.phase).toBe('STUCK');
    expect(g.resting).toBe(true);
    expect(g.vx).toBe(0);
    expect(g.vy).toBe(0);
    expect(g.vz).toBe(0);
    // Out of a floor is straight up, which `atan2(-0, -1)` reads as facing down -Z.
    expect(g.yaw).toBe(Math.atan2(-0, -0));
  });
});

describe('a claymore that meets the ground', () => {
  it('plants, starts arming, and takes its fuse from the arm time', () => {
    const p = pool();
    const w = world();
    const g = live(p, CLAYMORE, 0, 0.16, 0, 0, -8, 0);
    const r = p.step(g, w, CFG);
    expect(r.planted).toBe(true);
    expect(r.stuck).toBe(false);
    expect(g.phase).toBe('ARMING');
    expect(g.resting).toBe(true);
    expect(g.fuse).toBe(CLAYMORE.armSeconds);
    expect(g.vy).toBe(0);
  });

  it('drops off a wall instead of hanging over a doorway', () => {
    const p = pool();
    // A wall at x = 2, so a charge thrown into it meets a vertical face.
    const w = world([2, 2, 0, 0.5, 4, 8]);
    const g = live(p, CLAYMORE, 1.5, 2, 0, 12, 0, 0);
    const r = p.step(g, w, CFG);
    expect(r.planted).toBe(false);
    expect(g.phase).toBe('LIVE');
    // Its restitution and friction are both zero, so a wall simply takes its speed away.
    expect(g.vx).toBe(0);
    expect(g.resting).toBe(false);
  });
});

describe('the trajectory preview', () => {
  it('writes one triple per tick and stops at the seconds it was given', () => {
    const w = emptyWorld();
    const out = new Float32Array(3 * 256);
    const points = previewTrajectory(FRAG, CFG, w, 0, 5, 0, 6, 2, 0, 0.5, out, makeMoveOutput());
    expect(points).toBe(Math.round(0.5 / DT));
    expect(out[0]).not.toBe(0);
  });

  it('stops when the caller buffer runs out rather than overrunning it', () => {
    const w = emptyWorld();
    const out = new Float32Array(3 * 4);
    expect(previewTrajectory(FRAG, CFG, w, 0, 5, 0, 6, 2, 0, 10, out, makeMoveOutput())).toBe(4);
  });

  it('gives up at the first contact for equipment that does not bounce', () => {
    const w = world();
    const out = new Float32Array(3 * 256);
    const semtex = previewTrajectory(SEMTEX, CFG, w, 0, 0.12, 0, 4, -10, 0, 4, out, makeMoveOutput());
    const frag = previewTrajectory(FRAG, CFG, w, 0, 0.12, 0, 4, -10, 0, 4, out, makeMoveOutput());
    expect(semtex).toBe(1);
    expect(frag).toBeGreaterThan(1);
  });

  it('stops once a bouncing arc has come to rest', () => {
    const w = world();
    const out = new Float32Array(3 * 256);
    const points = previewTrajectory(FRAG, CFG, w, 0, 1, 0, 2, 0, 0, 10, out, makeMoveOutput());
    expect(points).toBeGreaterThan(1);
    expect(points).toBeLessThan(Math.round(10 / DT));
  });

  it('is the same integration the throw uses, which is the whole point of it', () => {
    // The same arc through the same world, one stepped and one previewed. The preview is what
    // a bot's safety check trusts, so any divergence here is a bot throwing at a place its
    // grenade will not land.
    const w = world();
    const p = pool();
    const g = live(p, FRAG, 0, 2.5, 0, 5, 1, -2);

    const out = new Float32Array(3 * 512);
    const points = previewTrajectory(
      FRAG, CFG, w, 0, 2.5, 0, 5, 1, -2, 2, out, makeMoveOutput(),
    );
    expect(points).toBeGreaterThan(20);

    // `out` is a Float32Array, so the comparison is at the precision the preview is stored in.
    for (let i = 0; i < points; i++) {
      p.step(g, w, CFG);
      expect(Math.fround(g.x)).toBe(out[i * 3]);
      expect(Math.fround(g.y)).toBe(out[i * 3 + 1]);
      expect(Math.fround(g.z)).toBe(out[i * 3 + 2]);
      if (g.resting) break;
    }
  });
});

describe('the one launch solution', () => {
  it('steps one release offset along the lofted aim', () => {
    solveLaunch(FRAG, CFG, 1, 2, 3, 0, 0, false);
    const loft = FRAG.throwLoftDeg * DEG2RAD;
    const cp = simCos(loft);
    const dx = -simSin(0) * cp;
    const dy = simSin(loft);
    const dz = -simCos(0) * cp;
    expect(LAUNCH.x).toBe(1 + dx * CFG.throwOffsetForward);
    expect(LAUNCH.y).toBe(2 + CFG.throwOffsetUp + dy * CFG.throwOffsetForward);
    expect(LAUNCH.z).toBe(3 + dz * CFG.throwOffsetForward);
    expect(LAUNCH.vx).toBe(dx * FRAG.throwSpeed);
    expect(LAUNCH.vy).toBe(dy * FRAG.throwSpeed);
    expect(LAUNCH.vz).toBe(dz * FRAG.throwSpeed);
  });

  it('aims where the body is looking', () => {
    // Yaw 0 looks down -Z; a quarter turn to the right sends it down -X.
    solveLaunch(FRAG, CFG, 0, 2, 0, 0, 0, false);
    expect(LAUNCH.vz).toBeLessThan(0);
    expect(Math.abs(LAUNCH.vx)).toBeLessThan(1e-9);

    solveLaunch(FRAG, CFG, 0, 2, 0, Math.PI * 0.5, 0, false);
    expect(LAUNCH.vx).toBeLessThan(0);
    expect(Math.abs(LAUNCH.vz)).toBeLessThan(1e-9);
  });

  it('lofts above the aim, so a flat throw still arcs', () => {
    solveLaunch(FRAG, CFG, 0, 2, 0, 0, 0, false);
    expect(FRAG.throwLoftDeg).toBeGreaterThan(0);
    expect(LAUNCH.vy).toBeGreaterThan(0);
  });

  it('aims below it for a claymore, which is put down rather than lobbed', () => {
    solveLaunch(CLAYMORE, CFG, 0, 2, 0, 0, 0, false);
    expect(CLAYMORE.throwLoftDeg).toBeLessThan(0);
    expect(LAUNCH.vy).toBeLessThan(0);
  });

  it('scales the speed for an underhand drop and leaves the release point alone', () => {
    solveLaunch(FRAG, CFG, 1, 2, 3, 0.4, 0, false);
    const lob = { ...LAUNCH };
    solveLaunch(FRAG, CFG, 1, 2, 3, 0.4, 0, true);
    expect(LAUNCH.x).toBe(lob.x);
    expect(LAUNCH.y).toBe(lob.y);
    expect(LAUNCH.z).toBe(lob.z);
    expect(Math.hypot(LAUNCH.vx, LAUNCH.vy, LAUNCH.vz)).toBeCloseTo(
      Math.hypot(lob.vx, lob.vy, lob.vz) * FRAG.dropScale,
      12,
    );
  });

  it('is one record, reused, so a caller must read it before asking again', () => {
    solveLaunch(FRAG, CFG, 1, 2, 3, 0, 0, false);
    const first = LAUNCH;
    solveLaunch(FRAG, CFG, 9, 9, 9, 0, 0, false);
    expect(LAUNCH).toBe(first);
    expect(LAUNCH.x).not.toBe(1 + 0 * CFG.throwOffsetForward);
  });

  it('puts a grenade in the air on the arc the preview then flies', () => {
    // The pair this function exists for: the launch and the arc, from the same two calls the
    // bot's safety check makes and the real throw makes.
    const w = world();
    const p = pool();
    solveLaunch(FRAG, CFG, 0, 2.5, 0, 0.3, 0.2, false);
    const g = live(p, FRAG, LAUNCH.x, LAUNCH.y, LAUNCH.z, LAUNCH.vx, LAUNCH.vy, LAUNCH.vz);

    const out = new Float32Array(3 * 512);
    const points = previewTrajectory(
      FRAG, CFG, w, LAUNCH.x, LAUNCH.y, LAUNCH.z, LAUNCH.vx, LAUNCH.vy, LAUNCH.vz, 2, out,
      makeMoveOutput(),
    );
    expect(points).toBeGreaterThan(20);
    for (let i = 0; i < points; i++) {
      p.step(g, w, CFG);
      expect(Math.fround(g.x)).toBe(out[i * 3]);
      expect(Math.fround(g.y)).toBe(out[i * 3 + 1]);
      expect(Math.fround(g.z)).toBe(out[i * 3 + 2]);
      if (g.resting) break;
    }
  });
});
