import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D } from 'three';
import {
  GRENADE_PIN_OUT,
  GRENADE_PULL_AT,
  GRENADE_THROW,
  GRENADE_WINDUP_AT,
  GrenadeThrowPose,
  grenadeDriveAt,
  grenadeThrowFor,
  grenadeThrowSource,
} from './GrenadeThrowPose';
import { HandsBase } from './WeaponBasePose';
import { ViewmodelMotion } from './ViewmodelMotion';
import { makeViewmodelDrive, type ViewmodelDrive } from './ViewmodelDrive';
import { DEFAULT_VIEWMODEL_CONFIG, type ViewmodelConfig } from '../../shared/weapons/ViewmodelConfig';
import type { GrenadeModel } from './GrenadeMesh';
import type { ViewmodelHands } from './ViewmodelHands';

/**
 * The throw's four keyframes, the pin, and the one frame the grenade leaves the hand on.
 *
 * `throwFraction` and `grenadeDriveAt` are a pair and are tested as one: the first is what a
 * match drives the pose through and the second is what the hand tuner drives it through, and
 * the whole point of them is that the tuner is posing the *match's* throw and not its own.
 */

const DEG2RAD = Math.PI / 180;
const EQUIPMENT = ['eq_frag', 'eq_semtex', 'eq_flashbang', 'eq_smoke', 'eq_claymore'];

function config(overrides: Partial<ViewmodelConfig> = {}): ViewmodelConfig {
  return { ...DEFAULT_VIEWMODEL_CONFIG, ...overrides };
}

function drive(overrides: Partial<ViewmodelDrive> = {}): ViewmodelDrive {
  return { ...makeViewmodelDrive(), ...overrides };
}

function quietMotion(): ViewmodelMotion {
  const motion = new ViewmodelMotion();
  motion.reset(0, 0);
  return motion;
}

interface Fake {
  readonly throw: GrenadeThrowPose;
  readonly grenade: GrenadeModel & { held: boolean };
  readonly bases: number[][];
  at(t: number, cfg?: ViewmodelConfig, d?: Partial<ViewmodelDrive>): void;
}

function built(poseId = 'nothing_has_this_id', withHands = false): Fake {
  const bases: number[][] = [];
  const hands = withHands ? { update: (m: Matrix4): void => void bases.push([...m.elements]) } : null;
  const grenade = {
    equipmentId: poseId,
    poseId,
    root: new Object3D(),
    hands: hands as unknown as ViewmodelHands | null,
    pinCarrier: new Object3D(),
    lever: new Object3D(),
    held: true,
    setHeld(held: boolean): void {
      grenade.held = held;
    },
    dispose(): void {},
  };
  const throwPose = new GrenadeThrowPose();
  throwPose.set(grenade as unknown as GrenadeModel);
  const base = new HandsBase();
  const motion = quietMotion();
  return {
    throw: throwPose,
    grenade: grenade as unknown as GrenadeModel & { held: boolean },
    bases,
    at(t, cfg = config({ idleAmplitude: 0 }), d = {}): void {
      const dr = grenadeDriveAt(t);
      throwPose.pose(base, motion, drive({ throwing: true, throwCook: dr.cook, throwRelease: dr.release, ...d }), cfg);
    },
  };
}

describe('throwFraction and grenadeDriveAt', () => {
  it('map the simulation’s two numbers onto one line', () => {
    expect(GrenadeThrowPose.throwFraction(-1, 0)).toBe(0);
    expect(GrenadeThrowPose.throwFraction(0, 0)).toBe(0);
    // The cook carries the hand from READY to WIND-UP over `GRENADE_COCK_SECONDS`.
    expect(GrenadeThrowPose.throwFraction(0.17, 0)).toBeCloseTo(GRENADE_WINDUP_AT / 2, 12);
    expect(GrenadeThrowPose.throwFraction(0.34, 0)).toBeCloseTo(GRENADE_WINDUP_AT, 12);
    // A cook longer than the arm takes is still the held pose, never past it.
    expect(GrenadeThrowPose.throwFraction(99, 0)).toBeCloseTo(GRENADE_WINDUP_AT, 12);
    expect(GrenadeThrowPose.throwFraction(-1, 1)).toBe(1);
  });

  it('let the release outrank the cook, because once it is running the cook is over', () => {
    expect(GrenadeThrowPose.throwFraction(0.2, 1)).toBe(1);
    expect(GrenadeThrowPose.throwFraction(9, 0.5)).toBeCloseTo(GRENADE_WINDUP_AT + (1 - GRENADE_WINDUP_AT) * 0.5, 12);
  });

  it('invert each other, which is what puts the tuner on the match’s own path', () => {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const d = grenadeDriveAt(t);
      expect(GrenadeThrowPose.throwFraction(d.cook, d.release)).toBeCloseTo(t, 12);
    }
  });

  it('report a cook only in the first half and a release only in the second', () => {
    expect(grenadeDriveAt(0.25).release).toBe(0);
    expect(grenadeDriveAt(0.25).cook).toBeGreaterThan(0);
    expect(grenadeDriveAt(0.75).cook).toBe(-1);
    expect(grenadeDriveAt(0.75).release).toBeGreaterThan(0);
  });
});

describe('the tables', () => {
  it('give every piece of equipment its own throw and anything else the shipped one', () => {
    expect(grenadeThrowFor('nothing_has_this_id').table).toBe(GRENADE_THROW);
    expect(grenadeThrowFor('nothing_has_this_id').pinOut).toBe(GRENADE_PIN_OUT);
    for (const id of EQUIPMENT) expect(grenadeThrowFor(id).table).not.toBe(GRENADE_THROW);
  });

  it('leave the claymore on the default pin travel, since it has no pin to pull', () => {
    expect(grenadeThrowFor('eq_claymore').pinOut).toBe(GRENADE_PIN_OUT);
    expect(grenadeThrowFor('eq_semtex').pinOut).toBe(GRENADE_PIN_OUT);
    expect(grenadeThrowFor('eq_frag').pinOut).not.toBe(GRENADE_PIN_OUT);
  });

  it('are complete: four named keyframes on every row', () => {
    for (const id of [...EQUIPMENT, 'nothing_has_this_id']) {
      const { table } = grenadeThrowFor(id);
      for (const key of ['ready', 'pull', 'windup', 'release'] as const) {
        for (const axis of ['x', 'y', 'z', 'pitch', 'yaw', 'roll'] as const) {
          expect(Number.isFinite(table[key][axis])).toBe(true);
        }
      }
    }
  });

  it('are copied into the pose, never aliased, so the tuner cannot write into the shipped one', () => {
    const f = built('eq_frag');
    const shipped = grenadeThrowFor('eq_frag');
    expect(f.throw.table.ready).toEqual(shipped.table.ready);
    expect(f.throw.table.ready).not.toBe(shipped.table.ready);
    f.throw.table.ready.x = 99;
    expect(shipped.table.ready.x).not.toBe(99);
  });

  it('are re-read when a different grenade comes into the hand', () => {
    const throwPose = new GrenadeThrowPose();
    throwPose.set(built('eq_frag').grenade);
    const frag = { ...throwPose.table.windup };
    throwPose.set(built('eq_claymore').grenade);
    expect(throwPose.table.windup).not.toEqual(frag);
    expect(throwPose.table.windup).toEqual(grenadeThrowFor('eq_claymore').table.windup);
    // And the pin travel comes with it.
    expect(throwPose.pinOut).toEqual(grenadeThrowFor('eq_claymore').pinOut);
  });
});

describe('the arc', () => {
  it('poses nothing when no grenade is in the hand', () => {
    const throwPose = new GrenadeThrowPose();
    expect(() => throwPose.pose(new HandsBase(), quietMotion(), drive({ throwCook: 0.2 }), config())).not.toThrow();
  });

  it('lands on each of the four keyframes in turn', () => {
    const f = built();
    for (const [t, pose] of [
      [0, GRENADE_THROW.ready],
      [GRENADE_PULL_AT, GRENADE_THROW.pull],
      [GRENADE_WINDUP_AT, GRENADE_THROW.windup],
      [1, GRENADE_THROW.release],
    ] as const) {
      f.at(t);
      expect(f.grenade.root.position.x).toBeCloseTo(pose.x, 9);
      expect(f.grenade.root.position.y).toBeCloseTo(pose.y, 9);
      expect(f.grenade.root.position.z).toBeCloseTo(pose.z, 9);
      expect(f.grenade.root.rotation.z).toBeCloseTo(pose.roll * DEG2RAD, 9);
    }
  });

  it('accelerates into the release, which is the 200 ms the player reads', () => {
    const f = built();
    const zAt = (t: number): number => {
      f.at(t);
      return f.grenade.root.position.z;
    };
    // Linear from the wind-up on, so its midpoint is the arithmetic one.
    const mid = GRENADE_WINDUP_AT + (1 - GRENADE_WINDUP_AT) / 2;
    expect(zAt(mid)).toBeCloseTo((GRENADE_THROW.windup.z + GRENADE_THROW.release.z) / 2, 9);
  });

  it('never jumps across the whole throw, on any of the five tables', () => {
    for (const id of EQUIPMENT) {
      const f = built(id);
      f.at(0);
      let previous = f.grenade.root.position.clone();
      for (let i = 1; i <= 200; i++) {
        f.at(i / 200);
        expect(f.grenade.root.position.distanceTo(previous)).toBeLessThan(0.05);
        previous = f.grenade.root.position.clone();
      }
    }
  });
});

describe('the pin', () => {
  it('starts home, travels out, and is clear by the wind-up', () => {
    const f = built();
    f.at(0);
    expect(f.grenade.pinCarrier.position.length()).toBe(0);
    f.at(0.3);
    expect(f.grenade.pinCarrier.position.length()).toBeGreaterThan(0);
    f.at(GRENADE_WINDUP_AT);
    expect(f.grenade.pinCarrier.position.x).toBeCloseTo(GRENADE_PIN_OUT.x, 9);
    expect(f.grenade.pinCarrier.rotation.z).toBeCloseTo(GRENADE_PIN_OUT.roll * DEG2RAD, 9);
  });

  it('stays out for the rest of the throw rather than coming back', () => {
    const f = built();
    for (const t of [0.6, 0.8, 1]) {
      f.at(t);
      expect(f.grenade.pinCarrier.position.x).toBeCloseTo(GRENADE_PIN_OUT.x, 9);
    }
  });

  it('starts a little after the grenade is up, not on the first frame', () => {
    const f = built();
    f.at(0.05);
    expect(f.grenade.pinCarrier.position.length()).toBe(0);
  });
});

describe('what is still in the hand', () => {
  it('holds the grenade for the whole release and lets go on the last frame', () => {
    const f = built();
    const seen: boolean[] = [];
    for (let i = 0; i <= 40; i++) {
      f.at(i / 40);
      seen.push(f.grenade.held);
    }
    expect(seen.filter((held, i) => i > 0 && held !== seen[i - 1])).toHaveLength(1);
    expect(seen[seen.length - 1]).toBe(false);
    expect(seen[seen.length - 2]).toBe(true);
  });

  it('takes the lever with it', () => {
    const f = built();
    f.at(0.9);
    expect(f.grenade.lever?.visible).toBe(true);
    f.at(1);
    expect(f.grenade.lever?.visible).toBe(false);
  });

  it('hands the glove the grenade’s own pose, once per frame', () => {
    const f = built('eq_frag', true);
    f.at(0.4);
    expect(f.bases).toHaveLength(1);
    const composed = new Matrix4().compose(f.grenade.root.position, f.grenade.root.quaternion, f.grenade.root.scale);
    expect(f.bases[0]).toEqual([...composed.elements]);
  });
});

describe('grenadeThrowSource', () => {
  it('prints a row that drops straight back into the table', () => {
    const { table, pinOut } = grenadeThrowFor('eq_frag');
    const text = grenadeThrowSource('eq_frag', table, pinOut);
    expect(text.startsWith('  eq_frag: {')).toBe(true);
    expect(text).toContain('    table: {');
    for (const key of ['ready', 'pull', 'windup', 'release']) expect(text).toContain(`      ${key}: {`);
    expect(text).toContain('    pinOut: {');
    expect(text.endsWith('  },')).toBe(true);
    expect(text.split('\n')).toHaveLength(9);
  });

  it('rounds to four places', () => {
    const { table, pinOut } = grenadeThrowFor('eq_frag');
    const text = grenadeThrowSource('eq_frag', { ...table, ready: { ...table.ready, x: 0.123456 } }, pinOut);
    expect(text).toContain('x: 0.1235,');
  });
});
