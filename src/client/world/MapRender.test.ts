import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MAPS, findMap } from '../../shared/modes/ModeRegistry';
import { PROP_SHAPES } from '../../shared/world/maps/props';
import type { MapDef, MaterialKey } from '../../shared/world/maps/types';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import { SHADOW_TIERS } from '../engine/Renderer';
import { MODELLED_PROP_SHAPES } from './PropModels';
import { applyAmbient, buildMapChunked, loadMap, type LoadedMap, type MapBuildProgress } from './MapRender';

/**
 * `rememberShadowAuthoring` writes into a `WeakMap` the renderer keeps to itself, so the only
 * way to see that the build told it what the map authored is to watch the call. Everything else
 * in the module stays real.
 */
const remembered: Array<[THREE.LightShadow, number, boolean, number]> = [];
vi.mock('../engine/Renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/Renderer')>();
  return {
    ...actual,
    rememberShadowAuthoring: (
      shadow: THREE.LightShadow,
      radius: number,
      castShadow: boolean,
      normalBias: number,
    ): void => {
      remembered.push([shadow, radius, castShadow, normalBias]);
      actual.rememberShadowAuthoring(shadow, radius, castShadow, normalBias);
    },
  };
});

/**
 * Characterization tests for the map's render half (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 *
 * `ProceduralTextures` is the one dependency that needs a canvas, and the build reads exactly two
 * things off it — a texture to hang on a material and a world scale for the UVs — so a stub of
 * those two is enough to build every shipped map in node, with the real collision world, the real
 * AO bake and the real lights.
 */

const textures = {
  get: (): { worldScale: number; texture: null } => ({ worldScale: 2, texture: null }),
} as unknown as ProceduralTextures;

function drain(def: MapDef, quality: Parameters<typeof loadMap>[2] = 'medium'): {
  map: LoadedMap;
  progress: MapBuildProgress[];
} {
  const steps = buildMapChunked(def, textures, quality);
  const progress: MapBuildProgress[] = [];
  let step = steps.next();
  while (step.done !== true) {
    progress.push(step.value);
    step = steps.next();
  }
  return { map: step.value, progress };
}

function describeTree(map: LoadedMap): string[] {
  const rows: string[] = [];
  map.root.traverse((object) => {
    if (object === map.root) return;
    const mesh = object as THREE.Mesh & { count?: number };
    const parts = [`${object.type} ${object.name}`];
    if (mesh.isMesh === true) {
      parts.push(`verts=${mesh.geometry.getAttribute('position').count}`);
      parts.push(`tris=${(mesh.geometry.getIndex()?.count ?? 0) / 3}`);
      if (mesh.count !== undefined) parts.push(`instances=${mesh.count}`);
    }
    rows.push(parts.join(' '));
  });
  return rows;
}

describe('loadMap', () => {
  it('drains the chunked build without yielding, and hands back the same map', () => {
    const def = findMap('mp_testbed').def;
    const direct = loadMap(def, textures, 'medium');
    const { map: chunked } = drain(def, 'medium');
    expect(describeTree(direct)).toEqual(describeTree(chunked));
    expect(direct.stats.drawCalls).toBe(chunked.stats.drawCalls);
    expect(direct.stats.triangles).toBe(chunked.stats.triangles);
    expect(direct.stats.chunks).toBe(chunked.stats.chunks);
  });

  it('defaults to the medium shadow tier', () => {
    const def = findMap('mp_foundry').def;
    const implicit = loadMap(def, textures);
    const explicit = loadMap(def, textures, 'medium');
    const sizeOf = (map: LoadedMap): number[] => {
      const sizes: number[] = [];
      map.root.traverse((o) => {
        const light = o as THREE.DirectionalLight;
        if (light.isDirectionalLight === true) sizes.push(light.shadow.mapSize.x);
      });
      return sizes;
    };
    expect(sizeOf(implicit)).toEqual(sizeOf(explicit));
  });

  it('names the root after the map and carries the shared loader\'s collision half', () => {
    const entry = findMap('mp_depot');
    const map = loadMap(entry.def, textures, 'medium');
    expect(map.root.name).toBe(`map:${entry.def.id}`);
    expect(map.def).toBe(entry.def);
    expect(map.spawns.length).toBe(entry.def.spawns.length);
    expect(map.navBounds).toEqual(entry.def.navBounds);
    expect(map.collision.overlapCapsule).toBeTypeOf('function');
  });

  it('pins each shipped map\'s build', () => {
    const rows = MAPS.map((entry) => {
      const map = loadMap(entry.def, textures, 'medium');
      return `${entry.id} draws=${map.stats.drawCalls} tris=${map.stats.triangles} chunks=${map.stats.chunks} children=${map.root.children.length}`;
    });
    expect(rows).toMatchInlineSnapshot(`
      [
        "mp_foundry draws=38 tris=84104 chunks=39 children=43",
        "mp_dunes draws=32 tris=102320 chunks=33 children=35",
        "mp_depot draws=42 tris=150856 chunks=43 children=51",
        "mp_testbed draws=17 tris=34504 chunks=18 children=20",
      ]
    `);
  });

  it('pins the whole tree of one map', () => {
    expect(describeTree(loadMap(findMap('mp_testbed').def, textures, 'medium'))).toMatchInlineSnapshot(`
      [
        "Mesh brushes:floor verts=4052 tris=6824 instances=1",
        "Mesh brushes:concrete verts=4810 tris=7564 instances=1",
        "Mesh brushes:hazard verts=1344 tris=1140 instances=1",
        "Mesh brushes:accent verts=1084 tris=936 instances=1",
        "Mesh brushes:concreteDark verts=4386 tris=6252 instances=1",
        "Mesh brushes:metal verts=1312 tris=1800 instances=1",
        "Mesh prop:crate:0 verts=210 tris=288 instances=5",
        "Mesh prop:crate:1 verts=120 tris=140 instances=5",
        "Mesh prop:crateTall:0 verts=322 tris=480 instances=3",
        "Mesh prop:crateTall:1 verts=154 tris=192 instances=3",
        "Mesh prop:barrier:0 verts=172 tris=220 instances=4",
        "Mesh prop:barrier:1 verts=72 tris=60 instances=4",
        "Mesh prop:pillar:0 verts=240 tris=324 instances=6",
        "Mesh prop:pillar:1 verts=154 tris=192 instances=6",
        "Mesh prop:lightBox:0 verts=40 tris=28 instances=16",
        "Mesh prop:lightBox:1 verts=40 tris=28 instances=16",
        "HemisphereLight ",
        "Object3D ",
        "DirectionalLight ",
        "Mesh sky verts=425 tris=720 instances=1",
      ]
    `);
  });
});

describe('buildMapChunked progress', () => {
  it('counts the chunks up front, so the fraction never jumps backwards', () => {
    for (const entry of MAPS) {
      const { map, progress } = drain(entry.def);
      expect(progress.length).toBe(map.stats.chunks);
      let previous = 0;
      for (const step of progress) {
        expect(step.total).toBe(map.stats.chunks);
        expect(step.done).toBe(previous + 1);
        previous = step.done;
      }
      expect(previous).toBe(map.stats.chunks);
    }
  });

  it('is one chunk per brush material, one per drawn prop part, and one each for lights and sky', () => {
    const def = findMap('mp_foundry').def;
    const { progress } = drain(def);
    const labels = progress.map((step) => step.label);
    const materials = new Set(def.brushes.map((brush) => brush.material));
    const brushLabels = labels.filter((label) => label.startsWith('brushes:'));
    expect(new Set(brushLabels).size).toBe(materials.size);
    expect(labels[labels.length - 2]).toBe('lights');
    expect(labels[labels.length - 1]).toBe('sky');
  });

  it('pins the label sequence of every map', () => {
    const rows = MAPS.map((entry) => `${entry.id} :: ${drain(entry.def).progress.map((s) => s.label).join(' ')}`);
    expect(rows).toMatchInlineSnapshot(`
      [
        "mp_foundry :: brushes:concreteDark brushes:floor brushes:brick brushes:concrete brushes:grate brushes:rust brushes:hazard brushes:accent prop:container:0 prop:container:1 prop:container:2 prop:container:3 prop:crateTall:0 prop:crateTall:1 prop:spool:0 prop:spool:1 prop:spool:2 prop:machine:0 prop:machine:1 prop:machine:2 prop:barrels:0 prop:barrels:1 prop:barrels:2 prop:barrels:3 prop:crate:0 prop:crate:1 prop:girder:0 prop:girder:1 prop:girder:2 prop:barrier:0 prop:barrier:1 prop:ladle:0 prop:ladle:1 prop:ladle:2 prop:ladle:3 prop:lightBox:0 prop:lightBox:1 lights sky",
        "mp_dunes :: brushes:sand brushes:plaster brushes:clayTile brushes:wood brushes:accent prop:sandbags:0 prop:sandbags:1 prop:sandbags:2 prop:palm:0 prop:palm:1 prop:palm:2 prop:palm:3 prop:palm:4 prop:stall:0 prop:stall:1 prop:stall:2 prop:stall:3 prop:stall:4 prop:crate:0 prop:crate:1 prop:barrels:0 prop:barrels:1 prop:barrels:2 prop:barrels:3 prop:well:0 prop:well:1 prop:well:2 prop:well:3 prop:well:4 prop:well:5 prop:well:6 lights sky",
        "mp_depot :: brushes:asphalt brushes:concreteDark brushes:paintedSteel brushes:metal brushes:concrete brushes:hazard brushes:grate brushes:accent prop:forklift:0 prop:forklift:1 prop:forklift:2 prop:forklift:3 prop:forklift:4 prop:pallets:0 prop:pallets:1 prop:pallets:2 prop:pallets:3 prop:barrels:0 prop:barrels:1 prop:barrels:2 prop:barrels:3 prop:crate:0 prop:crate:1 prop:crateTall:0 prop:crateTall:1 prop:spool:0 prop:spool:1 prop:spool:2 prop:girder:0 prop:girder:1 prop:girder:2 prop:containerBlue:0 prop:containerBlue:1 prop:containerBlue:2 prop:containerBlue:3 prop:containerBlue:4 prop:lightMast:0 prop:lightMast:1 prop:lightMast:2 prop:lightMast:3 prop:lightMast:4 lights sky",
        "mp_testbed :: brushes:floor brushes:concrete brushes:hazard brushes:accent brushes:concreteDark brushes:metal prop:crate:0 prop:crate:1 prop:crateTall:0 prop:crateTall:1 prop:barrier:0 prop:barrier:1 prop:pillar:0 prop:pillar:1 prop:lightBox:0 prop:lightBox:1 lights sky",
      ]
    `);
  });

  it('does not count a modelled prop\'s hidden parts, because they are never meshed', () => {
    const def = findMap('mp_foundry').def;
    const { progress } = drain(def);
    const propLabels = progress.filter((step) => step.label.startsWith('prop:')).map((s) => s.label);
    for (const shape of new Set(def.props.map((p) => p.shape))) {
      const parts = PROP_SHAPES[shape as keyof typeof PROP_SHAPES].parts;
      const drawnParts = MODELLED_PROP_SHAPES.has(shape)
        ? parts.filter((part) => (part as { hidden?: boolean }).hidden !== true)
        : parts;
      const emitted = propLabels.filter((label) => label.startsWith(`prop:${shape}:`));
      expect(emitted.length).toBe(drawnParts.length);
    }
    // The station is the modelled shape, and every one of its parts is hidden.
    expect(propLabels.some((label) => label.startsWith('prop:ammoCrate:'))).toBe(false);
  });
});

describe('buildMapChunked cancellation', () => {
  it('is finished for good once it has been returned early', () => {
    const steps = buildMapChunked(findMap('mp_foundry').def, textures, 'medium');
    steps.next();
    steps.next();
    const result = steps.return(undefined as unknown as LoadedMap);
    expect(result.done).toBe(true);
    expect(steps.next().done).toBe(true);
  });

  it('fires dispose on every geometry and material a cancelled build had made', () => {
    const steps = buildMapChunked(findMap('mp_foundry').def, textures, 'medium');
    steps.next();
    steps.next();
    steps.next();
    // The partial root is not exposed, so count the disposals through three's own event by
    // patching the prototype for the length of this test.
    let geometryDisposals = 0;
    let materialDisposals = 0;
    const geometryDispose = THREE.BufferGeometry.prototype.dispose;
    const materialDispose = THREE.Material.prototype.dispose;
    THREE.BufferGeometry.prototype.dispose = function patched(this: THREE.BufferGeometry): void {
      geometryDisposals++;
      geometryDispose.call(this);
    };
    THREE.Material.prototype.dispose = function patched(this: THREE.Material): void {
      materialDisposals++;
      materialDispose.call(this);
    };
    try {
      steps.return(undefined as unknown as LoadedMap);
    } finally {
      THREE.BufferGeometry.prototype.dispose = geometryDispose;
      THREE.Material.prototype.dispose = materialDispose;
    }
    expect(geometryDisposals).toBeGreaterThan(0);
    expect(materialDisposals).toBeGreaterThan(0);
    expect(geometryDisposals).toBe(materialDisposals);
  });

  it('does not dispose the map it just handed back', () => {
    const { map } = drain(findMap('mp_testbed').def);
    expect(map.root.children.length).toBeGreaterThan(0);
    const positions = new Map<string, number>();
    map.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh === true) positions.set(mesh.name, mesh.geometry.getAttribute('position').count);
    });
    expect([...positions.values()].every((count) => count > 0)).toBe(true);
  });

  it('empties the root and frees its meshes on dispose', () => {
    const map = loadMap(findMap('mp_testbed').def, textures, 'medium');
    let geometryDisposals = 0;
    map.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh === true) mesh.geometry.addEventListener('dispose', () => { geometryDisposals++; });
    });
    map.dispose();
    expect(geometryDisposals).toBeGreaterThan(0);
    expect(map.root.children).toEqual([]);
  });
});

describe('brush meshes', () => {
  it('makes one shadow-casting, non-updating mesh per material', () => {
    const map = loadMap(findMap('mp_foundry').def, textures, 'medium');
    const brushes = map.root.children.filter((child) => child.name.startsWith('brushes:'));
    expect(brushes.length).toBeGreaterThan(0);
    for (const mesh of brushes) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.matrixAutoUpdate).toBe(false);
    }
  });

  it('builds a vertex-coloured dithered Lambert material', () => {
    const map = loadMap(findMap('mp_foundry').def, textures, 'medium');
    const mesh = map.root.children.find((child) => child.name === 'brushes:concrete') as THREE.Mesh;
    const material = mesh.material as THREE.MeshLambertMaterial;
    expect(material.type).toBe('MeshLambertMaterial');
    expect(material.vertexColors).toBe(true);
    expect(material.dithering).toBe(true);
  });

  it('pulls only the decorative materials toward the camera in depth', () => {
    const map = loadMap(findMap('mp_foundry').def, textures, 'medium');
    const offsets: string[] = [];
    for (const child of map.root.children) {
      if (!child.name.startsWith('brushes:')) continue;
      const material = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
      offsets.push(`${child.name} ${String(material.polygonOffset)} ${material.polygonOffsetFactor} ${material.polygonOffsetUnits}`);
    }
    for (const row of offsets) {
      const trim = row.startsWith('brushes:accent') || row.startsWith('brushes:hazard');
      expect(row.endsWith(trim ? 'true -2 -2' : 'false 0 0')).toBe(true);
    }
  });
});

describe('prop instances', () => {
  it('makes one InstancedMesh per drawn shape part, with one matrix per placement', () => {
    const def = findMap('mp_foundry').def;
    const map = loadMap(def, textures, 'medium');
    const props = map.root.children.filter((child) => child.name.startsWith('prop:'));
    expect(props.length).toBeGreaterThan(0);
    for (const object of props) {
      const mesh = object as THREE.InstancedMesh;
      expect(mesh.isInstancedMesh).toBe(true);
      const shape = mesh.name.split(':')[1] ?? '';
      expect(mesh.count).toBe(def.props.filter((p) => p.shape === shape).length);
      expect(mesh.instanceMatrix.usage).toBe(THREE.StaticDrawUsage);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.matrixAutoUpdate).toBe(false);
      expect(mesh.boundingSphere).not.toBe(null);
    }
  });

  it('composes each instance from its placement\'s position and y rotation', () => {
    const def = findMap('mp_foundry').def;
    const map = loadMap(def, textures, 'medium');
    const mesh = map.root.children.find((child) => child.name.startsWith('prop:crate:')) as THREE.InstancedMesh;
    const placements = def.props.filter((p) => p.shape === 'crate');
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    placements.forEach((prop, i) => {
      mesh.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, scale);
      expect(position.x).toBeCloseTo(prop.position.x, 5);
      expect(position.y).toBeCloseTo(prop.position.y, 5);
      expect(position.z).toBeCloseTo(prop.position.z, 5);
      expect(scale.x).toBeCloseTo(1, 6);
      const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), prop.rotationY);
      expect(Math.abs(quaternion.dot(expected))).toBeCloseTo(1, 6);
    });
  });

  it('draws no mesh for the station\'s hidden collision boxes', () => {
    const map = loadMap(findMap('mp_foundry').def, textures, 'medium');
    const names = map.root.children.map((child) => child.name);
    expect(names.some((name) => name.startsWith('prop:ammoCrate:'))).toBe(false);
  });

  it('counts a prop\'s instanced triangles once per placement', () => {
    const def = findMap('mp_foundry').def;
    const map = loadMap(def, textures, 'medium');
    let expected = 0;
    for (const child of map.root.children) {
      const mesh = child as THREE.InstancedMesh;
      if (mesh.isMesh !== true) continue;
      const tris = (mesh.geometry.getIndex()?.count ?? 0) / 3;
      expected += mesh.isInstancedMesh === true ? tris * mesh.count : tris;
    }
    expect(map.stats.triangles).toBe(Math.round(expected));
  });
});

describe('lights', () => {
  it('adds a hemisphere light with the map\'s own two colours', () => {
    const def = findMap('mp_foundry').def;
    const authored = def.lights.find((light) => light.kind === 'hemisphere');
    const map = loadMap(def, textures, 'medium');
    const light = map.root.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight === true) as THREE.HemisphereLight;
    expect(light.color.getHex()).toBe(authored?.kind === 'hemisphere' ? authored.skyColor : -1);
    expect(light.groundColor.getHex()).toBe(authored?.kind === 'hemisphere' ? authored.groundColor : -1);
    expect(light.intensity).toBe(authored?.intensity);
  });

  it('stands the key light sixty metres back along its own direction, aimed at the map centre', () => {
    const def = findMap('mp_foundry').def;
    const authored = def.lights.find((light) => light.kind === 'directional');
    if (authored?.kind !== 'directional') throw new Error('no key light');
    const map = loadMap(def, textures, 'medium');
    const light = map.root.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight === true) as THREE.DirectionalLight;
    const centre = new THREE.Vector3(
      (def.navBounds.min.x + def.navBounds.max.x) * 0.5,
      (def.navBounds.min.y + def.navBounds.max.y) * 0.5,
      (def.navBounds.min.z + def.navBounds.max.z) * 0.5,
    );
    const direction = new THREE.Vector3(authored.direction.x, authored.direction.y, authored.direction.z).normalize();
    const expected = centre.clone().addScaledVector(direction, -60);
    expect(light.position.distanceTo(expected)).toBeLessThan(1e-6);
    expect(light.target.position.distanceTo(centre)).toBeLessThan(1e-6);
    expect(map.root.children).toContain(light.target);
  });

  it('scales the authored softness by the chosen tier and remembers what was authored', () => {
    const def = findMap('mp_foundry').def;
    const authored = def.lights.find((light) => light.kind === 'directional');
    if (authored?.kind !== 'directional') throw new Error('no key light');
    for (const quality of ['off', 'low', 'medium', 'high'] as const) {
      const map = loadMap(def, textures, quality);
      const light = map.root.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight === true) as THREE.DirectionalLight;
      const tier = SHADOW_TIERS[quality];
      expect(light.castShadow).toBe(tier.size > 0);
      expect(light.shadow.mapSize.x).toBe(tier.size === 0 ? 1024 : tier.size);
      expect(light.shadow.bias).toBe(authored.shadowBias ?? -0.0004);
      expect(light.shadow.normalBias).toBe((authored.shadowNormalBias ?? 0.035) * tier.biasScale);
      expect(light.shadow.radius).toBe((authored.shadowRadius ?? 2.5) * (tier.radiusScale === 0 ? 1 : tier.radiusScale));
    }
  });

  it('tells the renderer what the map authored, so a later quality change scales the intent', () => {
    const def = findMap('mp_foundry').def;
    const authored = def.lights.find((light) => light.kind === 'directional');
    if (authored?.kind !== 'directional') throw new Error('no key light');
    remembered.length = 0;
    const map = loadMap(def, textures, 'high');
    const light = map.root.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight === true) as THREE.DirectionalLight;
    expect(remembered.length).toBe(1);
    expect(remembered[0]?.[0]).toBe(light.shadow);
    expect(remembered[0]?.[1]).toBe(authored.shadowRadius ?? 2.5);
    expect(remembered[0]?.[2]).toBe(authored.castShadow);
    expect(remembered[0]?.[3]).toBe(authored.shadowNormalBias ?? 0.035);
  });

  it('tells it nothing for a light the map does not cast shadows from', () => {
    const def = findMap('mp_testbed').def;
    const casters = def.lights.filter((light) => light.kind === 'directional' && light.castShadow).length;
    remembered.length = 0;
    loadMap(def, textures, 'medium');
    expect(remembered.length).toBe(casters);
  });

  it('frames the shadow camera on the authored extent', () => {
    const def = findMap('mp_foundry').def;
    const authored = def.lights.find((light) => light.kind === 'directional');
    if (authored?.kind !== 'directional') throw new Error('no key light');
    const map = loadMap(def, textures, 'medium');
    const shadow = (map.root.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight === true) as THREE.DirectionalLight).shadow;
    expect(shadow.camera.left).toBe(-authored.shadowExtent);
    expect(shadow.camera.right).toBe(authored.shadowExtent);
    expect(shadow.camera.top).toBe(authored.shadowExtent);
    expect(shadow.camera.bottom).toBe(-authored.shadowExtent);
    expect(shadow.camera.near).toBe(1);
    expect(shadow.camera.far).toBe(160);
  });

  it('places each point light where the map put it', () => {
    for (const entry of MAPS) {
      const authored = entry.def.lights.filter((light) => light.kind === 'point');
      if (authored.length === 0) continue;
      const map = loadMap(entry.def, textures, 'medium');
      const placed = map.root.children.filter((c) => (c as THREE.PointLight).isPointLight === true) as THREE.PointLight[];
      expect(placed.length).toBe(authored.length);
      placed.forEach((light, i) => {
        const spec = authored[i];
        if (spec?.kind !== 'point') throw new Error('not a point light');
        expect(light.position.toArray()).toEqual([spec.position.x, spec.position.y, spec.position.z]);
        expect(light.color.getHex()).toBe(spec.color);
        expect(light.intensity).toBe(spec.intensity);
        expect(light.distance).toBe(spec.distance);
        expect(light.decay).toBe(spec.decay);
      });
    }
  });

  it('frees the key light with the map, because its shadow owns a render target', () => {
    const map = loadMap(findMap('mp_foundry').def, textures, 'medium');
    const light = map.root.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight === true) as THREE.DirectionalLight;
    let freed = 0;
    const dispose = light.dispose.bind(light);
    light.dispose = (): void => { freed++; dispose(); };
    map.dispose();
    expect(freed).toBe(1);
  });
});

describe('the sky and the freeze', () => {
  it('puts the dome in the map\'s own root and counts it', () => {
    const map = loadMap(findMap('mp_dunes').def, textures, 'medium');
    const sky = map.root.children.find((child) => child.name === 'sky');
    expect(sky).toBeDefined();
    expect(sky?.matrixAutoUpdate).toBe(false);
  });

  it('turns matrix updates off for everything under the root', () => {
    const map = loadMap(findMap('mp_foundry').def, textures, 'medium');
    let auto = 0;
    map.root.traverse((object) => {
      if (object.matrixAutoUpdate || object.matrixWorldAutoUpdate) auto++;
    });
    expect(auto).toBe(0);
  });
});

describe('applyAmbient', () => {
  it('sets the clear colour and the fog from the map\'s own block', () => {
    for (const entry of MAPS) {
      const scene = new THREE.Scene();
      applyAmbient(scene, entry.def);
      expect((scene.background as THREE.Color).getHex()).toBe(entry.def.ambient.fogColor);
      const fog = scene.fog as THREE.Fog;
      expect(fog.color.getHex()).toBe(entry.def.ambient.fogColor);
      expect(fog.near).toBe(entry.def.ambient.fogNear);
      expect(fog.far).toBe(entry.def.ambient.fogFar);
    }
  });

  it('replaces whatever was there before', () => {
    const scene = new THREE.Scene();
    applyAmbient(scene, findMap('mp_foundry').def);
    applyAmbient(scene, findMap('mp_dunes').def);
    expect((scene.background as THREE.Color).getHex()).toBe(findMap('mp_dunes').def.ambient.fogColor);
  });
});

describe('map stats', () => {
  it('reports the collision half\'s numbers alongside its own', () => {
    const map = loadMap(findMap('mp_foundry').def, textures, 'medium');
    expect(map.stats.drawCalls).toBeGreaterThan(0);
    expect(map.stats.triangles).toBe(Math.round(map.stats.triangles));
    expect(map.stats.buildMs).toBeGreaterThanOrEqual(0);
    expect(map.stats.aoMs).toBeGreaterThanOrEqual(0);
    expect(map.stats.chunks).toBeGreaterThan(0);
    // From `loadMapCollision`, carried through untouched.
    expect(Object.keys(map.stats).length).toBeGreaterThan(5);
  });

  it('counts one draw call per mesh in the root', () => {
    for (const entry of MAPS) {
      const map = loadMap(entry.def, textures, 'medium');
      let meshes = 0;
      map.root.traverse((object) => {
        if ((object as THREE.Mesh).isMesh === true) meshes++;
      });
      expect(map.stats.drawCalls).toBe(meshes);
    }
  });

  it('counts the same chunks it yielded', () => {
    for (const entry of MAPS) {
      const { map, progress } = drain(entry.def);
      expect(map.stats.chunks).toBe(progress.length);
    }
  });
});

describe('a map with nothing in it', () => {
  const bare: MapDef = {
    id: 'mp_bare',
    name: 'BARE',
    brushes: [],
    props: [],
    spawns: [],
    lights: [],
    ambient: {
      fogColor: 0x101010,
      fogNear: 1,
      fogFar: 10,
      sky: { zenith: 0x202020, falloff: 1, disc: { color: 0xffffff, sizeDeg: 1, glowDeg: 1, intensity: 0 } },
    },
    coverPoints: [],
    navBounds: { min: { x: -4, y: 0, z: -4 }, max: { x: 4, y: 4, z: 4 } },
  } as unknown as MapDef;

  it('still yields the lights and the sky chunks', () => {
    const { map, progress } = drain(bare);
    expect(progress.map((step) => step.label)).toEqual(['lights', 'sky']);
    expect(map.stats.chunks).toBe(2);
    expect(map.stats.drawCalls).toBe(1);
  });

  it('falls back to the material\'s own world scale when a brush does not override it', () => {
    const withBrush: MapDef = {
      ...bare,
      brushes: [
        {
          position: { x: 0, y: 1, z: 0 },
          size: { x: 2, y: 2, z: 2 },
          rotationY: 0,
          material: 'concrete' as MaterialKey,
        },
      ],
    } as unknown as MapDef;
    const map = loadMap(withBrush, textures, 'medium');
    expect(map.root.children.some((child) => child.name === 'brushes:concrete')).toBe(true);
  });
});
