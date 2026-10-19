import { describe, expect, it } from 'vitest';
import { HitboxRig, HUMANOID_LAYOUTS, HUMANOID_RIG, type RigLayout } from '../../shared/combat/HitboxRig';
import { makeRigSnapshot, restoreRig, RigHistory, saveRig } from './RigHistory';

/**
 * The ring of rig transforms lag compensation rewinds into (B1).
 *
 * Two things here are the file's actual design rather than incidental behaviour, and both are
 * pinned on purpose:
 *
 * 1. **The tick is stored alongside the transform**, so a rewind of exactly one buffer length
 *    *misses* instead of reading the present pose and reporting a clean compensation that did
 *    nothing. The class comment says so; nothing proved it until here.
 * 2. **`fill` overwrites the tick tags**, which is what makes a previous life's slots
 *    unmatchable. The consequence — that after a spawn only the spawn tick answers, and every
 *    other tick degrades to the present — is the safe direction, and it is what the code does.
 */

/** The buffer length `RigHistory` is built on, which is private to it. 60 ticks is 1.0 s. */
const HISTORY_TICKS = 60;

const CROUCH: RigLayout = HUMANOID_LAYOUTS[1] ?? HUMANOID_RIG;

function rigAt(x: number, y: number, z: number, yaw: number, layout: RigLayout = HUMANOID_RIG): HitboxRig {
  const rig = new HitboxRig(layout);
  rig.setTransform(x, y, z, yaw);
  return rig;
}

function poseOf(rig: HitboxRig): [number, number, number, number, string] {
  return [rig.x, rig.y, rig.z, rig.yaw, rig.layout.id];
}

describe('RigHistory', () => {
  it('has a second layout to test with, so the layout assertions mean something', () => {
    expect(CROUCH).not.toBe(HUMANOID_RIG);
  });

  it('puts a rig back where it was on a recorded tick', () => {
    const history = new RigHistory();
    const rig = rigAt(3, 1, -4, 0.5);
    history.push(rig, 10);

    rig.setTransform(99, 99, 99, 2);
    expect(history.has(10)).toBe(true);
    expect(history.applyAt(rig, 10)).toBe(true);
    expect(poseOf(rig)).toEqual([3, 1, -4, 0.5, 'humanoid']);
  });

  it('carries the pose the body was drawn in, not just the position', () => {
    const history = new RigHistory();
    const rig = rigAt(1, 0, 2, 0, CROUCH);
    history.push(rig, 7);

    rig.setLayout(HUMANOID_RIG);
    expect(history.applyAt(rig, 7)).toBe(true);
    expect(rig.layout).toBe(CROUCH);
  });

  it('answers for nothing before anything is pushed', () => {
    const history = new RigHistory();
    expect(history.has(0)).toBe(false);
    expect(history.has(41)).toBe(false);
  });

  it('misses a tick exactly one buffer old instead of reading the present', () => {
    const history = new RigHistory();
    const rig = rigAt(5, 0, 5, 0);
    history.push(rig, 10);
    // Same ring slot, one full buffer later.
    expect(history.has(10 + HISTORY_TICKS)).toBe(false);
  });

  it('leaves the rig exactly as it was when the tick is not held', () => {
    const history = new RigHistory();
    history.push(rigAt(0, 0, 0, 0), 1);

    const rig = rigAt(8, 2, -1, 1.25, CROUCH);
    expect(history.applyAt(rig, 2)).toBe(false);
    expect(poseOf(rig)).toEqual([8, 2, -1, 1.25, CROUCH.id]);
  });

  it('overwrites a slot when the ring wraps round to it', () => {
    const history = new RigHistory();
    const rig = rigAt(1, 0, 1, 0);
    history.push(rig, 0);
    rig.setTransform(2, 0, 2, 0);
    history.push(rig, HISTORY_TICKS);

    expect(history.has(0)).toBe(false);
    expect(history.has(HISTORY_TICKS)).toBe(true);
    const probe = rigAt(0, 0, 0, 0);
    history.applyAt(probe, HISTORY_TICKS);
    expect([probe.x, probe.z]).toEqual([2, 2]);
  });

  it('after a spawn fill, the spawn tick answers and every other tick degrades to the present', () => {
    const history = new RigHistory();
    const spawned = rigAt(12, 0, -6, 0.25, CROUCH);
    history.fill(spawned, 100);

    expect(history.has(100)).toBe(true);
    // The fill stamps one tick into every slot, so no other tick can match — which is what
    // makes the previous life's slots unreachable. The caller then resolves against the
    // present, which `applyAt` documents as the correct degradation.
    expect(history.has(60)).toBe(false);
    expect(history.has(99)).toBe(false);
    expect(history.has(140)).toBe(false);

    const rig = rigAt(0, 0, 0, 0);
    expect(history.applyAt(rig, 100)).toBe(true);
    expect(poseOf(rig)).toEqual([12, 0, -6, 0.25, CROUCH.id]);
  });

  it('a spawn fill makes the previous life unreachable', () => {
    const history = new RigHistory();
    // A previous life recorded tick 100, whose slot is index 40.
    history.push(rigAt(-50, 0, -50, 0), 100);
    history.fill(rigAt(1, 0, 1, 0), 160);

    const rig = rigAt(0, 0, 0, 0);
    expect(history.applyAt(rig, 100)).toBe(false);
    expect([rig.x, rig.z]).toEqual([0, 0]);
  });

  it('indexes a negative tick onto a real slot', () => {
    const history = new RigHistory();
    const rig = rigAt(4, 0, 4, 0);
    history.push(rig, -5);
    expect(history.has(-5)).toBe(true);
    expect(history.has(HISTORY_TICKS - 5)).toBe(false);
  });
});

describe('the rig snapshot held aside during a rewind', () => {
  it('round-trips the transform and the layout', () => {
    const slot = makeRigSnapshot();
    saveRig(rigAt(7, 1.5, -2, 0.75, CROUCH), slot);

    const rig = rigAt(0, 0, 0, 0);
    restoreRig(slot, rig);
    expect(poseOf(rig)).toEqual([7, 1.5, -2, 0.75, CROUCH.id]);
  });

  it('starts blank, standing, at the origin', () => {
    const slot = makeRigSnapshot();
    expect([slot.x, slot.y, slot.z, slot.yaw]).toEqual([0, 0, 0, 0]);
    expect(slot.layout).toBe(HUMANOID_RIG);
  });
});
