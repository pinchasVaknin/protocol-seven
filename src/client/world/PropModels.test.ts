import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { findMap } from '../../shared/modes/ModeRegistry';
import { PROP_SHAPES } from '../../shared/world/maps/props';
import type { MapDef } from '../../shared/world/maps/types';

/**
 * Characterization tests for the station's model (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 *
 * The template is module-level and arrives over the network, so the loader is replaced with one
 * that resolves a small scene built here. That is the only way to reach `addStations` from node,
 * and it is also what makes the order of the tests below matter: the "not yet arrived" cases run
 * before the preload, because the template they are about is a page-wide value that never goes
 * back to null.
 */

const loadAsync = vi.fn();

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync = loadAsync;
  },
}));

/** A stand-in for the welded station: two meshes under a root, as the file ships. */
function fakeStation(): THREE.Object3D {
  const root = new THREE.Object3D();
  root.name = 'station_ammo';
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  crate.name = 'crate';
  const cans = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.5), new THREE.MeshBasicMaterial());
  cans.name = 'cans';
  crate.add(cans);
  root.add(crate);
  return root;
}

function stationPlacements(def: MapDef): MapDef['props'] {
  return def.props.filter((p) => p.shape === 'ammoCrate');
}

describe('PropModels catalogue', () => {
  it('names a shape that the collision catalogue actually carries', async () => {
    const { STATION_SHAPE } = await import('./PropModels');
    expect(STATION_SHAPE).toBe('ammoCrate');
    expect(Object.keys(PROP_SHAPES)).toContain(STATION_SHAPE);
  });

  it('marks every part of that shape hidden, so the boxes collide and are not drawn', async () => {
    const { STATION_SHAPE } = await import('./PropModels');
    const shape = PROP_SHAPES[STATION_SHAPE as keyof typeof PROP_SHAPES];
    expect(shape.parts.length).toBeGreaterThan(0);
    for (const part of shape.parts) expect(part.hidden).toBe(true);
  });

  it('lists exactly the station as the one modelled shape', async () => {
    const { MODELLED_PROP_SHAPES, STATION_SHAPE } = await import('./PropModels');
    expect([...MODELLED_PROP_SHAPES]).toEqual([STATION_SHAPE]);
    expect(MODELLED_PROP_SHAPES.has(STATION_SHAPE)).toBe(true);
    expect(MODELLED_PROP_SHAPES.has('crate')).toBe(false);
  });
});

describe('PropModels before the file arrives', () => {
  it('has no model and places nothing', async () => {
    const { PropModels } = await import('./PropModels');
    const models = new PropModels();
    const root = new THREE.Object3D();
    expect(models.stationModel()).toBe(null);
    expect(models.addStations(root, findMap('mp_foundry').def)).toBe(0);
    expect(root.children).toEqual([]);
  });

  it('clears the in-flight task on a failure, so a later world tries again', async () => {
    const { preloadStation } = await import('./PropModels');
    loadAsync.mockRejectedValueOnce(new Error('offline'));
    await expect(preloadStation()).resolves.toBeUndefined();
    expect(loadAsync).toHaveBeenCalledTimes(1);

    loadAsync.mockRejectedValueOnce(new Error('offline again'));
    await preloadStation();
    expect(loadAsync).toHaveBeenCalledTimes(2);
  });
});

describe('PropModels once the file has arrived', () => {
  it('fetches once per page and resolves for everyone after', async () => {
    const { preloadStation, PropModels } = await import('./PropModels');
    const scene = fakeStation();
    loadAsync.mockResolvedValue({ scene });
    const calls = loadAsync.mock.calls.length;

    await Promise.all([preloadStation(), preloadStation(), new PropModels().preloadStation()]);
    expect(loadAsync.mock.calls.length).toBe(calls + 1);
    expect(loadAsync.mock.calls[calls]?.[0]).toBe('/models/props/station_ammo.glb');

    await preloadStation();
    expect(loadAsync.mock.calls.length).toBe(calls + 1);
  });

  it('turns shadows on for every mesh in the template it keeps', async () => {
    const { PropModels } = await import('./PropModels');
    const template = new PropModels().stationModel();
    expect(template).not.toBe(null);
    let meshes = 0;
    template?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      meshes++;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    });
    expect(meshes).toBe(2);
  });

  it('puts one clone on every ammoCrate the map places, and answers how many', async () => {
    const { PropModels, STATION_SHAPE } = await import('./PropModels');
    const models = new PropModels();
    const def = findMap('mp_foundry').def;
    const placed = stationPlacements(def);
    expect(placed.length).toBeGreaterThan(0);

    const root = new THREE.Object3D();
    expect(models.addStations(root, def)).toBe(placed.length);
    expect(root.children.length).toBe(placed.length);
    for (const child of root.children) expect(child.name).toBe(`prop:${STATION_SHAPE}:model`);
  });

  it('places each clone at its prop\'s position and heading', async () => {
    const { PropModels } = await import('./PropModels');
    const def = findMap('mp_foundry').def;
    const root = new THREE.Object3D();
    new PropModels().addStations(root, def);
    const placed = stationPlacements(def);
    root.children.forEach((clone, i) => {
      const prop = placed[i];
      expect(clone.position.toArray()).toEqual([prop?.position.x, prop?.position.y, prop?.position.z]);
      expect(clone.rotation.y).toBe(prop?.rotationY);
    });
  });

  it('is a clone each time rather than the template itself', async () => {
    const { PropModels } = await import('./PropModels');
    const models = new PropModels();
    const template = models.stationModel();
    const root = new THREE.Object3D();
    models.addStations(root, findMap('mp_foundry').def);
    for (const child of root.children) expect(child).not.toBe(template);
    expect(new Set(root.children).size).toBe(root.children.length);
  });

  it('freezes every node of a clone, because the map root was frozen before it arrived', async () => {
    const { PropModels } = await import('./PropModels');
    const root = new THREE.Object3D();
    new PropModels().addStations(root, findMap('mp_foundry').def);
    for (const clone of root.children) {
      clone.traverse((node) => {
        expect(node.matrixAutoUpdate).toBe(false);
        expect(node.matrixWorldAutoUpdate).toBe(false);
      });
    }
  });

  it('composes the world matrix before freezing, so a frozen clone is not at the origin', async () => {
    const { PropModels } = await import('./PropModels');
    const def = findMap('mp_foundry').def;
    const root = new THREE.Object3D();
    new PropModels().addStations(root, def);
    const clone = root.children[0];
    const prop = stationPlacements(def)[0];
    const position = new THREE.Vector3().setFromMatrixPosition(clone?.matrixWorld ?? new THREE.Matrix4());
    expect(position.x).toBeCloseTo(prop?.position.x ?? 0, 10);
    expect(position.y).toBeCloseTo(prop?.position.y ?? 0, 10);
    expect(position.z).toBeCloseTo(prop?.position.z ?? 0, 10);
  });

  it('turns shadows on for every mesh of every clone', async () => {
    const { PropModels } = await import('./PropModels');
    const root = new THREE.Object3D();
    new PropModels().addStations(root, findMap('mp_foundry').def);
    let meshes = 0;
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      meshes++;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    });
    expect(meshes).toBeGreaterThan(0);
  });

  it('places only this shape, and nothing on a map that has none', async () => {
    const { PropModels } = await import('./PropModels');
    const def = findMap('mp_testbed').def;
    const root = new THREE.Object3D();
    expect(new PropModels().addStations(root, def)).toBe(stationPlacements(def).length);
    expect(root.children.length).toBe(stationPlacements(def).length);
    expect(def.props.length).toBeGreaterThan(root.children.length);
  });
});

describe('PropModels.dispose', () => {
  it('stops answering for this world but keeps the page\'s template', async () => {
    const { PropModels, preloadStation } = await import('./PropModels');
    const models = new PropModels();
    expect(models.stationModel()).not.toBe(null);

    models.dispose();
    expect(models.stationModel()).toBe(null);
    expect(models.addStations(new THREE.Object3D(), findMap('mp_foundry').def)).toBe(0);
    await expect(models.preloadStation()).resolves.toBeUndefined();

    // The next world still finds it.
    await preloadStation();
    expect(new PropModels().stationModel()).not.toBe(null);
  });
});
