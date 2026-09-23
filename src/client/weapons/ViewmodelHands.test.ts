import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ARM_REACH_USED, solveArm } from './ViewmodelHands';

const UPPER = 0.34;
const LOWER = 0.26;

describe('solveArm', () => {
  it('puts the elbow an upper arm from the shoulder and a forearm from the wrist', () => {
    const shoulder = new Vector3(0.25, -0.15, 0.05);
    const wrist = new Vector3(0.15, -0.2, -0.25);
    const elbow = solveArm(shoulder, wrist, new Vector3(1, -1, 0), UPPER, LOWER, new Vector3());
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER, 6);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(LOWER, 6);
  });

  it('bends the elbow toward the bend direction', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, 0, -0.4);
    const elbow = solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(elbow.y).toBeLessThan(0);
    expect(Math.abs(elbow.x)).toBeLessThan(1e-9);
  });

  it('slides the shoulder toward a wrist beyond reach, so the wrist is still reached', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, 0, -2);
    const elbow = solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(shoulder.distanceTo(wrist)).toBeCloseTo((UPPER + LOWER) * ARM_REACH_USED, 6);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(LOWER, 6);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(UPPER, 6);
  });

  it('pushes the shoulder back from a wrist closer than the arm can fold', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, 0, -0.01);
    solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(shoulder.distanceTo(wrist)).toBeGreaterThanOrEqual(UPPER - LOWER);
  });

  it('still finds an elbow when the bend lies along the arm', () => {
    const shoulder = new Vector3(0, 0, 0);
    const wrist = new Vector3(0, -0.4, 0);
    const elbow = solveArm(shoulder, wrist, new Vector3(0, -1, 0), UPPER, LOWER, new Vector3());
    expect(Number.isFinite(elbow.x) && Number.isFinite(elbow.y) && Number.isFinite(elbow.z)).toBe(true);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(LOWER, 6);
  });
});
