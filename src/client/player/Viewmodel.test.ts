import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_CAMERA_CONFIG } from './CameraConfig';
import { ViewmodelLayer } from './Viewmodel';

/**
 * The viewmodel layer's plumbing (brief S5.4), pinned before unit C1's refactor.
 *
 * Three's scene graph needs no renderer, so the part that decides anything is testable here:
 * the second camera's own lens and depth range, the parenting that keeps the weapon's lighting
 * from swinging with the player, and the empty-pass rule that makes the layer free when there
 * is nothing to draw.
 */

describe('ViewmodelLayer', () => {
  it('builds its camera on the config FOV, with the viewmodel depth range', () => {
    const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
    expect(layer.camera.fov).toBe(DEFAULT_CAMERA_CONFIG.viewmodelFov);
    expect(layer.camera.near).toBe(0.008);
    expect(layer.camera.far).toBe(6);
    expect(layer.camera.aspect).toBe(1);
  });

  it('hangs the camera off the scene, and everything else off the camera', () => {
    const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
    // Three only traverses the scene graph, so a camera outside it would render nothing.
    expect(layer.scene.children).toContain(layer.camera);
    const lights = layer.camera.children.filter((c) => c instanceof THREE.Light);
    expect(lights).toHaveLength(3);
    // Key and rim aim down and forward of the camera, where the weapon actually sits.
    for (const light of lights) {
      if (light instanceof THREE.DirectionalLight) {
        expect(light.target.position.z).toBeLessThan(0);
      }
    }
    expect(layer.camera.children.some((c) => c instanceof THREE.Group)).toBe(true);
  });

  it('counts only drawables as content, never its own lights', () => {
    const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
    expect(layer.hasContent).toBe(false);

    const weapon = new THREE.Object3D();
    layer.add(weapon);
    expect(layer.hasContent).toBe(true);

    layer.remove(weapon);
    expect(layer.hasContent).toBe(false);
  });

  it('parents what it is given to the camera, not to the scene root', () => {
    const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
    const weapon = new THREE.Object3D();
    layer.add(weapon);
    expect(weapon.parent?.parent).toBe(layer.camera);
    expect(layer.scene.children).not.toContain(weapon);
  });

  it('rebuilds the projection on a resize', () => {
    const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
    const before = layer.camera.projectionMatrix.elements.slice();
    layer.resize(16 / 9);
    expect(layer.camera.aspect).toBe(16 / 9);
    expect(Array.from(layer.camera.projectionMatrix.elements)).not.toEqual(Array.from(before));
  });

  it('ignores a FOV change under a hundredth of a degree', () => {
    const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
    layer.setFov(65.005);
    expect(layer.camera.fov).toBe(DEFAULT_CAMERA_CONFIG.viewmodelFov);
    layer.setFov(70);
    expect(layer.camera.fov).toBe(70);
  });

  it('empties both the drawables and the scene on dispose', () => {
    const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
    layer.add(new THREE.Object3D());
    layer.dispose();
    expect(layer.hasContent).toBe(false);
    expect(layer.scene.children).toHaveLength(0);
  });
});
