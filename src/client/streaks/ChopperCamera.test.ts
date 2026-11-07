import { describe, expect, it } from 'vitest';
import type { ChopperGunner } from '../../shared/streaks/ChopperGunner';
import { ChopperCamera } from './ChopperCamera';

/**
 * No DOM here at all: the class owns a `THREE.PerspectiveCamera` and copies a reported pose
 * into it. The stand-in chopper writes the view the way the real one does.
 */

interface View {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  fov: number;
}

function chopper(view: View, active = true): ChopperGunner {
  return {
    activeView(out: View): boolean {
      if (!active) return false;
      Object.assign(out, view);
      return true;
    },
  } as unknown as ChopperGunner;
}

const VIEW: View = { x: 10, y: 40, z: -20, pitch: -0.6, yaw: 1.1, fov: 62 };

describe('ChopperCamera', () => {
  it('answers null when no streak owns the view', () => {
    expect(new ChopperCamera().cameraFor(null, 1.78)).toBeNull();
  });

  it('answers null when the streak has no active view', () => {
    expect(new ChopperCamera().cameraFor(chopper(VIEW, false), 1.78)).toBeNull();
  });

  it('copies the reported pose onto the camera', () => {
    const camera = new ChopperCamera().cameraFor(chopper(VIEW), 1.78);
    expect(camera).not.toBeNull();
    expect(camera?.position.toArray()).toEqual([10, 40, -20]);
    expect(camera?.rotation.x).toBeCloseTo(-0.6, 10);
    expect(camera?.rotation.y).toBeCloseTo(1.1, 10);
    expect(camera?.rotation.z).toBe(0);
  });

  it('turns yaw before pitch, so a banked gunship does not roll', () => {
    const camera = new ChopperCamera().cameraFor(chopper(VIEW), 1.78);
    expect(camera?.rotation.order).toBe('YXZ');
  });

  it('takes the field of view and the aspect it is given', () => {
    const camera = new ChopperCamera().cameraFor(chopper(VIEW), 1.78);
    expect(camera?.fov).toBeCloseTo(62, 10);
    expect(camera?.aspect).toBeCloseTo(1.78, 10);
  });

  it('hands back the same camera object every frame', () => {
    const rig = new ChopperCamera();
    const first = rig.cameraFor(chopper(VIEW), 1.78);
    expect(rig.cameraFor(chopper(VIEW), 1.78)).toBe(first);
  });

  it('rebuilds the projection only when the lens actually moved', () => {
    const rig = new ChopperCamera();
    const camera = rig.cameraFor(chopper(VIEW), 1.78);
    const projection = camera?.projectionMatrix.elements.join(',');

    rig.cameraFor(chopper(VIEW), 1.78);
    expect(camera?.projectionMatrix.elements.join(',')).toBe(projection);

    rig.cameraFor(chopper(VIEW), 2.4);
    expect(camera?.projectionMatrix.elements.join(',')).not.toBe(projection);
  });

  it('rebuilds the projection when the field of view moves past a thousandth', () => {
    const rig = new ChopperCamera();
    const camera = rig.cameraFor(chopper(VIEW), 1.78);
    const projection = camera?.projectionMatrix.elements.join(',');

    rig.cameraFor(chopper({ ...VIEW, fov: 62.0001 }), 1.78);
    expect(camera?.projectionMatrix.elements.join(',')).toBe(projection);

    rig.cameraFor(chopper({ ...VIEW, fov: 70 }), 1.78);
    expect(camera?.projectionMatrix.elements.join(',')).not.toBe(projection);
  });

  it('keeps following the pose on frames where the lens did not change', () => {
    const rig = new ChopperCamera();
    rig.cameraFor(chopper(VIEW), 1.78);
    const camera = rig.cameraFor(chopper({ ...VIEW, x: 99, yaw: -2 }), 1.78);
    expect(camera?.position.x).toBe(99);
    expect(camera?.rotation.y).toBeCloseTo(-2, 10);
  });
});
