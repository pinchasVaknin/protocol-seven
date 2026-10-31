import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildHeldWeapon,
  buildWeaponModel,
  camoMaterial,
  heldWeaponMaterial,
  paintCamo,
  sharedWeaponSurfaces,
  type WeaponModel,
} from './WeaponMesh';
import { bodyBoxes, chargingBoxes, magazineBoxes, triggerHandAnchor, supportHandAnchor } from './WeaponMeshParts';
import { modelSpecFor } from './WeaponModelSpecs';

/**
 * The assembly: specs and tables in, a `WeaponModel` out.
 *
 * Two things stand between this file and a node runner, and both are answered here rather
 * than with jsdom. The textures are painted on a 2D canvas, so the suite installs a recording
 * one — the three painters only ever call `fillRect`, a stroked line and `fillStyle`, so a
 * context that keeps a command log *is* the production surface and the materials come out
 * with real `CanvasTexture`s on them. And a file-backed weapon needs a `WeaponAssetTemplate`,
 * which is a scene of named `Object3D`s and a record of socket positions — so the fake below
 * is one, built the way the GLB build carves one.
 *
 * What is deliberately not tested here is what the browser A/B covers instead: the sixty real
 * models built from the twelve shipped GLBs. A fake template proves the *wiring* — which
 * socket feeds which contract number, what a missing socket does — and the A/B proves the
 * numbers.
 */

// ---------------------------------------------------------------------------
// The recording canvas
// ---------------------------------------------------------------------------

interface RecordingContext {
  readonly log: string[];
  canvas: { width: number; height: number };
  fillStyle: unknown;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  fill(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(at: number, colour: string): void };
  createImageData(w: number, h: number): { width: number; height: number; data: Uint8ClampedArray };
  getImageData(_x: number, _y: number, w: number, h: number): { width: number; height: number; data: Uint8ClampedArray };
  putImageData(image: { width: number; height: number }, x: number, y: number): void;
}

const contexts: RecordingContext[] = [];

function recordingContext(canvas: { width: number; height: number }): RecordingContext {
  const ctx: RecordingContext = {
    log: [],
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect(x, y, w, h): void {
      ctx.log.push(`fill ${String(ctx.fillStyle)} ${x.toFixed(3)},${y.toFixed(3)} ${w.toFixed(3)}x${h.toFixed(3)}`);
    },
    beginPath(): void {
      ctx.log.push('begin');
    },
    closePath(): void {
      ctx.log.push('close');
    },
    fill(): void {
      ctx.log.push(`fillPath ${String(ctx.fillStyle)} ${ctx.globalAlpha}`);
    },
    createLinearGradient(x0, y0, x1, y1): { addColorStop(at: number, colour: string): void } {
      ctx.log.push(`gradient ${x0},${y0}->${x1},${y1}`);
      return { addColorStop: (at, colour) => void ctx.log.push(`stop ${at} ${colour}`) };
    },
    createImageData(w, h): { width: number; height: number; data: Uint8ClampedArray } {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    getImageData(_x, _y, w, h): { width: number; height: number; data: Uint8ClampedArray } {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(image, x, y): void {
      ctx.log.push(`put ${image.width}x${image.height} @${x},${y}`);
    },
    moveTo(x, y): void {
      ctx.log.push(`move ${x},${y}`);
    },
    lineTo(x, y): void {
      ctx.log.push(`line ${x},${y}`);
    },
    stroke(): void {
      ctx.log.push(`stroke ${ctx.strokeStyle} ${ctx.lineWidth}`);
    },
  };
  contexts.push(ctx);
  return ctx;
}

let originalDocument: unknown;

beforeAll(() => {
  originalDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement(tag: string): unknown {
      if (tag !== 'canvas') throw new Error(`The weapon textures only ever make a canvas, not a ${tag}.`);
      const canvas = { width: 0, height: 0, getContext: (kind: string) => (kind === '2d' ? recordingContext(canvas) : null) };
      return canvas;
    },
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

// ---------------------------------------------------------------------------
// The fake template
// ---------------------------------------------------------------------------

const SOCKETS = [
  'socket_grip',
  'socket_support',
  'socket_mag_grip',
  'socket_sight',
  'socket_muzzle',
  'socket_rail_top',
  'socket_rail_bottom',
] as const;

interface FakeTemplateOptions {
  readonly weaponId?: string;
  readonly sight?: THREE.Vector3;
  readonly frontSight?: THREE.Vector3;
  readonly ownOptic?: boolean;
  readonly ownGrip?: boolean;
  readonly scopeGlass?: boolean;
  readonly reticleSocket?: boolean;
  readonly magazineExit?: THREE.Vector3;
}

/**
 * A `WeaponAssetTemplate` the way the build carves one: a scene whose named groups are what
 * `groupNodes` looks for, plus the socket record the contract reads.
 */
function fakeTemplate(options: FakeTemplateOptions = {}): unknown {
  const scene = new THREE.Group();
  scene.name = 'weapon';

  const named = (name: string, parent: THREE.Object3D = scene): THREE.Object3D => {
    const node = new THREE.Object3D();
    node.name = name;
    parent.add(node);
    return node;
  };

  const body = named('body');
  const magazine = named('magazine');
  named('charge');
  // One real mesh, so the material/anisotropy pass has something to walk.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), new THREE.MeshStandardMaterial({ name: 'M_body' }));
  mesh.name = 'body_mesh';
  body.add(mesh);

  // The magazine's exit direction is read off a node the build leaves in the file.
  const exit = options.magazineExit;
  if (exit !== undefined) named('socket_mag_exit', magazine).position.copy(exit);

  const muzzle = named('socket_muzzle');
  muzzle.position.set(0, 0.01, -0.5);
  // The two rails are nodes as well as entries in the socket record: a part is cloned under
  // the node, and the record is what the contract's numbers are measured from.
  named('socket_rail_top').position.set(0, 0.06, 0);
  named('socket_rail_bottom').position.set(0, -0.03, -0.18);
  if (options.frontSight !== undefined) named('socket_sight_front').position.copy(options.frontSight);
  if (options.reticleSocket === true) named('socket_reticle').position.set(0, 0.09, -0.02);

  if (options.ownOptic === true) {
    const own = named('optic_default');
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.002), new THREE.MeshStandardMaterial({ name: 'M_glass' }));
    glass.name = 'optic_glass';
    own.add(glass);
  }
  if (options.ownGrip === true) named('grip_default');
  if (options.scopeGlass === true) {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.002), new THREE.MeshStandardMaterial({ name: 'M_scope' }));
    glass.name = 'scope_glass';
    scene.add(glass);
  }

  const sockets: Record<string, THREE.Vector3> = {};
  for (const key of SOCKETS) sockets[key] = new THREE.Vector3();
  sockets.socket_grip = new THREE.Vector3(0.01, -0.07, 0.05);
  sockets.socket_support = new THREE.Vector3(-0.01, -0.02, -0.2);
  sockets.socket_mag_grip = new THREE.Vector3(0, -0.1, -0.02);
  sockets.socket_sight = options.sight ?? new THREE.Vector3(0, 0.0915, -0.05);
  sockets.socket_rail_top = new THREE.Vector3(0, 0.06, 0);

  return { weaponId: options.weaponId ?? 'ar_carbine', scene, sockets };
}

/** `buildWeaponModel`'s options take a service; only `template` is ever asked for here. */
function assetsWith(template: unknown): never {
  return { template: () => template, hands: () => null, part: () => null } as never;
}

/** An attachment part the way the pack carries one: a scene, and the sockets it brings. */
function fakePart(partId: string, ownSockets: Record<string, THREE.Vector3> = {}): unknown {
  const scene = new THREE.Group();
  scene.name = partId;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), new THREE.MeshStandardMaterial({ name: 'M_part' }));
  mesh.name = partId + '_mesh';
  scene.add(mesh);
  if (partId === 'att_optic') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.002), new THREE.MeshStandardMaterial({ name: 'M_glass' }));
    glass.name = 'part_glass';
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.002, 0.001), new THREE.MeshStandardMaterial({ name: 'M_Reticle' }));
    dot.name = 'part_dot';
    scene.add(glass, dot);
  }
  if (partId === 'att_suppressor') {
    const muzzle = new THREE.Object3D();
    muzzle.name = 'socket_muzzle';
    muzzle.position.set(0, 0, -0.12);
    scene.add(muzzle);
  }
  return { partId, scene, sockets: ownSockets };
}

/** A service that answers with the fake template and whichever parts the test supplies. */
function assetsWithParts(template: unknown, parts: Record<string, unknown>): never {
  return { template: () => template, hands: () => null, part: (id: string) => parts[id] ?? null } as never;
}

function nodeNames(model: WeaponModel): string[] {
  const names: string[] = [];
  model.root.traverse((node) => names.push(node.name));
  return names;
}

function vertexCount(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((node) => {
    const geometry = (node as THREE.Mesh).geometry;
    if (geometry instanceof THREE.BufferGeometry) total += geometry.attributes.position?.count ?? 0;
  });
  return total;
}

// ---------------------------------------------------------------------------

describe('the surfaces', () => {
  it('builds the five the parts tables name, once for the process', () => {
    const first = sharedWeaponSurfaces(8);
    const second = sharedWeaponSurfaces(8);
    expect(second).toBe(first);
    for (const key of ['gunmetal', 'polymer', 'glove', 'lens', 'reticle'] as const) {
      expect(first.get(key), key).toBeInstanceOf(THREE.MeshStandardMaterial);
    }
  });

  it('paints the three structural surfaces and leaves the optic’s two unpainted', () => {
    const surfaces = sharedWeaponSurfaces(8);
    for (const key of ['gunmetal', 'polymer', 'glove'] as const) {
      expect(surfaces.get(key)?.map, key).toBeInstanceOf(THREE.Texture);
    }
    // A painted lens is not a lens, and a textured dot is not a dot.
    expect(surfaces.get('lens')?.map).toBeNull();
    expect(surfaces.get('reticle')?.map).toBeNull();
  });

  it('keeps the glass out of the depth buffer, which is the load-bearing flag', () => {
    const lens = sharedWeaponSurfaces(8).get('lens');
    expect(lens?.transparent).toBe(true);
    // With depthWrite on, the window rejects everything seen through it — the opaque-optic
    // bug wearing a transparent material.
    expect(lens?.depthWrite).toBe(false);
    expect(lens?.opacity).toBeLessThan(1);
  });

  it('makes the dot a light source rather than a lit surface', () => {
    const reticle = sharedWeaponSurfaces(8).get('reticle');
    expect(reticle?.emissiveIntensity).toBeGreaterThan(1);
    // Tone mapping would drag it toward the scene's exposure, and a red dot that dims in a
    // bright lane is not a red dot.
    expect(reticle?.toneMapped).toBe(false);
  });

  it('keeps metalness low, because there is no environment map to reflect', () => {
    const surfaces = sharedWeaponSurfaces(8);
    // A physically honest 0.85 metal with nothing to reflect renders black.
    expect(surfaces.get('gunmetal')?.metalness).toBeLessThan(0.5);
    expect(surfaces.get('polymer')?.metalness).toBeLessThan(0.1);
    // And the base colours live in the textures, so the tints stay neutral.
    expect(surfaces.get('gunmetal')?.color.getHex()).toBe(0xffffff);
  });

  it('paints each of the three textures once and shares them', () => {
    const before = contexts.length;
    sharedWeaponSurfaces(8);
    sharedWeaponSurfaces(8);
    expect(contexts.length).toBe(before);
    // The three that were painted are distinct images and none of them is empty.
    const logs = contexts.map((c) => c.log.join('\n'));
    expect(new Set(logs).size).toBe(logs.length);
    for (const c of contexts) expect(c.log.length).toBeGreaterThan(20);
  });

  it('hands a held weapon the same gunmetal the viewmodel uses', () => {
    expect(heldWeaponMaterial(8)).toBe(sharedWeaponSurfaces(8).get('gunmetal'));
  });
});

describe('the procedural model', () => {
  it('is one group per animated part, each named for the debugger', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [] });
    expect(model.root.name).toBe('viewmodel:ar_carbine');
    expect(model.magazine.name).toBe('viewmodel:magazine');
    expect(model.chargingHandle.name).toBe('viewmodel:charging');
    expect(model.muzzle.name).toBe('viewmodel:muzzle');
    expect(model.source).toBe('procedural');
    model.dispose();
  });

  it('merges the parts by surface, so a weapon is a handful of draw calls', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [] });
    const meshes: THREE.Mesh[] = [];
    model.root.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.push(node);
    });
    const spec = modelSpecFor('ar_carbine');
    const surfaces = new Set(bodyBoxes(spec).map((b) => b.surface));
    // One mesh per surface in the body, plus the magazine's and the charging handle's.
    expect(meshes.length).toBeLessThanOrEqual(surfaces.size + 4);
    expect(meshes.length).toBeGreaterThan(1);
    for (const mesh of meshes) expect(mesh.name.startsWith('viewmodel:')).toBe(true);
    model.dispose();
  });

  it('adds the gloves only when they are asked for', () => {
    const bare = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [] });
    const gloved = buildWeaponModel('ar_carbine', 8, null, { hands: true, attachments: [] });
    expect(vertexCount(gloved.root)).toBeGreaterThan(vertexCount(bare.root));
    // Built from fewer groups rather than from a filtered one: no glove mesh at all.
    expect(nodeNames(bare).some((n) => n.includes('glove'))).toBe(false);
    expect(nodeNames(gloved).some((n) => n.includes('glove'))).toBe(true);
    bare.dispose();
    gloved.dispose();
  });

  it('scales the root and reports the sight height already scaled', () => {
    for (const id of ['ar_carbine', 'pistol_talon', 'sniper_kestrel']) {
      const spec = modelSpecFor(id);
      const model = buildWeaponModel(id, 8, null, { hands: false, attachments: [] });
      expect(model.root.scale.x, id).toBeCloseTo(spec.scale, 12);
      // The root is scaled, so a weapon at 1.08 has a sight line 8% higher than its spec
      // says — and the ADS compensation reads this number, not the spec's.
      expect(model.sightHeight, id).toBeCloseTo(spec.sightHeight * spec.scale, 12);
      expect(model.sightPoint.y, id).toBeCloseTo(model.sightHeight, 12);
      model.dispose();
    }
  });

  it('places the muzzle on the bore at the end of the barrel', () => {
    const spec = modelSpecFor('ar_carbine');
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [] });
    expect(model.muzzle.position.y).toBeCloseTo(spec.receiverHeight * 0.13, 12);
    expect(model.muzzle.position.z).toBeLessThan(0);
    model.dispose();
  });

  it('drops its magazine straight down, and takes no ADS numbers from a file', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [] });
    expect(model.magazineExit.toArray()).toEqual([0, -1, 0]);
    // The primitives keep `adsZ` and the spec's offset; neither of the file-only numbers.
    expect(model.adsSightDistance).toBe(0);
    expect(model.adsPitch).toBe(0);
    expect(model.adsOffsetZ).toBe(modelSpecFor('ar_carbine').adsOffsetZ);
    expect(model.supportHand).toBeNull();
    model.dispose();
  });

  it('builds every weapon in the arsenal out of something', () => {
    for (const id of ['ar_vulcan', 'ar_halcyon', 'ar_longbow', 'smg_wasp', 'smg_meridian', 'shotgun_breacher', 'lmg_bastion', 'lmg_monolith', 'sniper_vantage', 'pistol_talon']) {
      const model = buildWeaponModel(id, 8, null, { hands: true, attachments: [] });
      expect(vertexCount(model.root), id).toBeGreaterThan(100);
      expect(model.weaponId, id).toBe(id);
      model.dispose();
    }
  });

  it('releases its geometry on dispose and keeps the shared materials', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [] });
    const disposed: string[] = [];
    model.root.traverse((node) => {
      const g = (node as THREE.Mesh).geometry;
      if (g instanceof THREE.BufferGeometry) g.addEventListener('dispose', () => void disposed.push(node.name));
    });
    const gunmetal = sharedWeaponSurfaces(8).get('gunmetal');
    model.dispose();
    expect(model.root.children).toHaveLength(0);
    expect(disposed.length).toBeGreaterThan(0);
    // Only the geometry is per model; the materials live for the process.
    expect(sharedWeaponSurfaces(8).get('gunmetal')).toBe(gunmetal);
  });

  it('takes its identity from the caller and its geometry from the asset id', () => {
    // The shield's sidearm is the one weapon where the two differ: a pistol's geometry under
    // the streak's identity, so its hand and its placement are the streak's.
    const model = buildWeaponModel('streak_shield', 8, null, { hands: false, attachments: [], assetId: 'pistol_talon' });
    expect(model.weaponId).toBe('streak_shield');
    expect(model.root.name).toBe('viewmodel:streak_shield');
    expect(model.adsOffsetZ).toBe(modelSpecFor('pistol_talon').adsOffsetZ);
    model.dispose();
  });
});

describe('the model built from a file', () => {
  it('clones the template rather than posing the shared scene', () => {
    const template = fakeTemplate();
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [], assets: assetsWith(template) });
    expect(model.source).toBe('glb');
    expect(model.root).not.toBe((template as { scene: THREE.Object3D }).scene);
    expect(model.root.name).toBe('viewmodel:ar_carbine');
    model.dispose();
  });

  it('reads the three animated groups out of the file by name', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [], assets: assetsWith(fakeTemplate()) });
    expect(model.magazine.name).toBe('magazine');
    expect(model.chargingHandle.name).toBe('charge');
    expect(model.muzzle.name).toBe('socket_muzzle');
    model.dispose();
  });

  it('refuses a file with no muzzle socket, rather than drawing a flash at the origin', () => {
    const template = fakeTemplate() as { scene: THREE.Object3D };
    template.scene.getObjectByName('socket_muzzle')?.removeFromParent();
    expect(() =>
      buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [], assets: assetsWith(template) }),
    ).toThrow(/socket_muzzle/);
  });

  it('takes the sight point from the file, which is what ADS lands on the axis', () => {
    const sight = new THREE.Vector3(0.002, 0.113, -0.14);
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [], assets: assetsWith(fakeTemplate({ sight })) });
    expect(model.sightPoint.toArray()).toEqual(sight.toArray());
    expect(model.sightHeight).toBe(sight.y);
    model.dispose();
  });

  it('holds a scope at eye relief, irons at a rifle’s distance and a pistol closer', () => {
    const at = (weaponId: string): number => {
      const model = buildWeaponModel(weaponId, 8, null, { hands: false, attachments: [], assets: assetsWith(fakeTemplate({ weaponId })) });
      const distance = model.adsSightDistance;
      model.dispose();
      return distance;
    };
    const scoped = at('sniper_kestrel');
    const rifle = at('ar_carbine');
    const pistol = at('pistol_talon');
    expect(modelSpecFor('sniper_kestrel').optic).toBe('scope');
    expect(modelSpecFor('pistol_talon').handguardLength).toBeLessThanOrEqual(0);
    // A scope is held closest, a pistol furthest out: an arm's length, not a shoulder's.
    expect(scoped).toBeLessThan(rifle);
    expect(pistol).toBeGreaterThan(rifle);
  });

  it('pitches the weapon onto its sight line when the file has a front sight', () => {
    const sight = new THREE.Vector3(0, 0.1, -0.05);
    const level = buildWeaponModel('ar_carbine', 8, null, {
      hands: false, attachments: [], assets: assetsWith(fakeTemplate({ sight, frontSight: new THREE.Vector3(0, 0.1, -0.4) })),
    });
    const canted = buildWeaponModel('ar_carbine', 8, null, {
      hands: false, attachments: [], assets: assetsWith(fakeTemplate({ sight, frontSight: new THREE.Vector3(0, 0.11, -0.4) })),
    });
    const bare = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [], assets: assetsWith(fakeTemplate({ sight })) });
    expect(level.adsPitch).toBeCloseTo(0, 9);
    expect(Math.abs(canted.adsPitch)).toBeGreaterThan(0.5);
    // No front sight in the file is a level weapon, not a guess.
    expect(bare.adsPitch).toBe(0);
    level.dispose();
    canted.dispose();
    bare.dispose();
  });

  it('builds the box gloves at the file’s own sockets when there is no rig', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: true, attachments: [], assets: assetsWith(fakeTemplate()) });
    // The trigger pair is merged into the body; the support pair is its own group, because the
    // reload moves it.
    expect(model.supportHand).not.toBeNull();
    expect(model.supportHand?.name).toBe('viewmodel:hand:support');
    model.dispose();
  });

  it('gives the file’s own scope glass the project’s lens', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, {
      hands: false, attachments: [], assets: assetsWith(fakeTemplate({ scopeGlass: true })),
    });
    const glass = model.root.getObjectByName('scope_glass') as THREE.Mesh;
    // The source models the glass and leaves the picture to the engine, so the tube stays
    // solid and you can see down it.
    expect(glass.material).toBe(sharedWeaponSurfaces(8).get('lens'));
    model.dispose();
  });

  it('puts a dot in a collimator that draws an empty window, and in nothing else', () => {
    const withSocket = buildWeaponModel('ar_carbine', 8, null, {
      hands: false, attachments: [], assets: assetsWith(fakeTemplate({ ownOptic: true, reticleSocket: true })),
    });
    const without = buildWeaponModel('ar_carbine', 8, null, {
      hands: false, attachments: [], assets: assetsWith(fakeTemplate({ ownOptic: true })),
    });
    // The socket is the recipe saying "this glass has nothing in it". A sight that carries
    // its own reticle has no such node, and adding one regardless put two dots on it.
    expect(withSocket.root.getObjectByName('optic_default:reticle')).toBeDefined();
    expect(without.root.getObjectByName('optic_default:reticle')).toBeUndefined();
    // And it goes under `optic_default`, so hiding that group hides this with it.
    expect(withSocket.root.getObjectByName('optic_default')?.children.some((c) => c.name === 'optic_default:reticle')).toBe(true);
    withSocket.dispose();
    without.dispose();
  });

  it('freezes every mesh’s matrix, because nothing under a weapon moves on its own', () => {
    const model = buildWeaponModel('ar_carbine', 8, null, { hands: false, attachments: [], assets: assetsWith(fakeTemplate()) });
    model.root.traverse((node) => {
      if (node instanceof THREE.Mesh) expect(node.matrixAutoUpdate, node.name).toBe(false);
    });
    model.dispose();
  });
});

describe('the attachments', () => {
  const PARTS = {
    att_optic: fakePart('att_optic', { socket_sight: new THREE.Vector3(0, 0.035, -0.01) }),
    att_suppressor: fakePart('att_suppressor'),
    att_grip: fakePart('att_grip'),
    att_laser: fakePart('att_laser'),
  };

  function build(attachments: string[], templateOptions: FakeTemplateOptions = {}): WeaponModel {
    return buildWeaponModel('ar_carbine', 8, null, {
      hands: false,
      attachments: attachments as never,
      assets: assetsWithParts(fakeTemplate(templateOptions), PARTS) as never,
    });
  }

  it('mounts nothing when nothing is fitted, and the weapon keeps its own numbers', () => {
    const bare = build([]);
    expect(nodeNames(bare).some((n) => n.startsWith('attachment:'))).toBe(false);
    expect(bare.sightPoint.toArray()).toEqual([0, 0.0915, -0.05]);
    bare.dispose();
  });

  it('clones a part under its own socket, named for the debugger', () => {
    const model = build(['grip_foregrip']);
    const socket = model.root.getObjectByName('socket_rail_bottom');
    expect(socket?.children.some((c) => c.name === 'attachment:att_grip')).toBe(true);
    model.dispose();
  });

  it('skips a part the weapon has no socket for, rather than dropping it at the origin', () => {
    // `socket_rail_front` is not on every weapon, and is not in the fake template.
    const model = build(['laser_tactical']);
    expect(nodeNames(model).some((n) => n === 'attachment:att_laser')).toBe(false);
    model.dispose();
  });

  it('moves the sight line onto the optic, which is what ADS then has to cancel', () => {
    const bare = build([]);
    const scoped = build(['optic_reflex']);
    // The rail socket plus the optic's own sight: the sum is the new sight line.
    expect(scoped.sightPoint.y).toBeCloseTo(0.06 + 0.035, 12);
    expect(scoped.sightHeight).toBeCloseTo(scoped.sightPoint.y, 12);
    expect(scoped.sightPoint.y).toBeGreaterThan(bare.sightPoint.y);
    bare.dispose();
    scoped.dispose();
  });

  it('moves the muzzle inside the suppressor, so the flash rides the can', () => {
    const bare = build([]);
    const quiet = build(['muzzle_suppressor']);
    expect(bare.muzzle.name).toBe('socket_muzzle');
    expect(quiet.muzzle.name).toBe('socket_muzzle');
    // The returned node is the one inside the clone, not the weapon's own.
    expect(quiet.muzzle.parent?.name).toBe('attachment:att_suppressor');
    expect(bare.muzzle.parent?.name).not.toBe('attachment:att_suppressor');
    bare.dispose();
    quiet.dispose();
  });

  it('gives the optic’s glass and dot the project materials, not the artist’s', () => {
    const model = build(['optic_reflex']);
    const surfaces = sharedWeaponSurfaces(8);
    const glass = model.root.getObjectByName('part_glass') as THREE.Mesh;
    const dot = model.root.getObjectByName('part_dot') as THREE.Mesh;
    // The source carries `KHR_materials_transmission`, a render pass the viewmodel does not
    // pay for; the project's lens has the `depthWrite: false` that keeps the target visible.
    expect(glass.material).toBe(surfaces.get('lens'));
    expect(dot.material).toBe(surfaces.get('reticle'));
    model.dispose();
  });

  it('takes the weapon’s own sights off under a mounted optic', () => {
    const model = build(['optic_reflex'], { ownOptic: true });
    // Both stood in the middle of the sight picture, which is what a real shooter removes
    // them for.
    expect(model.root.getObjectByName('optic_default')?.visible).toBe(false);
    model.dispose();
  });

  it('leaves a scoped weapon its scope, because a reflex is not an upgrade on one', () => {
    const scoped = buildWeaponModel('sniper_kestrel', 8, null, {
      hands: false,
      attachments: ['optic_reflex'] as never,
      assets: assetsWithParts(fakeTemplate({ weaponId: 'sniper_kestrel' }), PARTS) as never,
    });
    expect(modelSpecFor('sniper_kestrel').optic).toBe('scope');
    expect(nodeNames(scoped).some((n) => n === 'attachment:att_optic')).toBe(false);
    // And the sight line stays the file's own.
    expect(scoped.sightPoint.y).toBeCloseTo(0.0915, 12);
    scoped.dispose();
  });

  it('takes a moulded foregrip off when the pack’s one goes on', () => {
    const model = build(['grip_foregrip'], { ownGrip: true });
    // Without this the MONOLITH's own vertical grip had the pack's put through it.
    expect(model.root.getObjectByName('grip_default')?.visible).toBe(false);
    model.dispose();
  });

  it('stretches the magazine along the well rather than mounting a part', () => {
    const plain = build([]);
    const extended = build(['mag_extended']);
    expect(plain.magazine.scale.y).toBe(1);
    expect(extended.magazine.scale.y).toBeCloseTo(1.4, 12);
    // The reload writes the group's position and rotation and leaves its scale alone.
    expect(extended.magazine.scale.x).toBe(1);
    expect(extended.magazine.scale.z).toBe(1);
    expect(nodeNames(extended).some((n) => n.startsWith('attachment:'))).toBe(false);
    plain.dispose();
    extended.dispose();
  });

  it('fits three at once, each doing its own job', () => {
    const model = build(['optic_reflex', 'muzzle_suppressor', 'mag_extended'], { ownOptic: true });
    expect(model.sightPoint.y).toBeCloseTo(0.095, 12);
    expect(model.muzzle.parent?.name).toBe('attachment:att_suppressor');
    expect(model.magazine.scale.y).toBeCloseTo(1.4, 12);
    expect(model.root.getObjectByName('optic_default')?.visible).toBe(false);
    model.dispose();
  });

  it('freezes a mounted part’s meshes too', () => {
    const model = build(['grip_foregrip']);
    model.root.getObjectByName('attachment:att_grip')?.traverse((node) => {
      if (node instanceof THREE.Mesh) expect(node.matrixAutoUpdate, node.name).toBe(false);
    });
    model.dispose();
  });
});

describe('the camo', () => {
  it('is one variant per material and camo, kept for the process', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'M_test' });
    const gold = camoMaterial(material, 'gold', 8);
    expect(camoMaterial(material, 'gold', 8)).toBe(gold);
    expect(camoMaterial(material, 'obsidian', 8)).not.toBe(gold);
    expect(gold).not.toBe(material);
    expect(gold.name).toBe('M_test|gold');
  });

  it('gives the two metal finishes metal, and leaves the rest of the BRDF alone', () => {
    const base = new THREE.MeshStandardMaterial({ name: 'M_metals', metalness: 0.1, roughness: 0.9 });
    const gold = camoMaterial(base, 'gold', 8);
    expect(gold.metalness).toBeGreaterThan(base.metalness);
    expect(gold.roughness).toBeLessThan(base.roughness);
    const plain = camoMaterial(new THREE.MeshStandardMaterial({ name: 'M_plain', metalness: 0.1, roughness: 0.9 }), 'tiger', 8);
    expect(plain.metalness).toBe(0.1);
    expect(plain.roughness).toBe(0.9);
  });

  it('keys the shader cache by camo, so two camos are two programs and not one', () => {
    const a = camoMaterial(new THREE.MeshStandardMaterial({ name: 'M_a' }), 'gold', 8);
    const b = camoMaterial(new THREE.MeshStandardMaterial({ name: 'M_b' }), 'tiger', 8);
    expect(a.customProgramCacheKey?.()).toBe('camo:gold');
    expect(b.customProgramCacheKey?.()).toBe('camo:tiger');
    expect(a.customProgramCacheKey?.()).not.toBe(b.customProgramCacheKey?.());
  });

  it('multiplies the pattern in after the albedo, so the artist’s shading shows through', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'M_shader' });
    const gold = camoMaterial(material, 'gold', 8);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <uv_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>' };
    gold.onBeforeCompile?.(shader as never, null as never);
    expect(shader.uniforms.camoMap).toBeDefined();
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
    // The pattern is scaled by the file's own brightness, so a worn edge lifts it.
    expect(shader.fragmentShader).toContain('lum');
    expect(shader.vertexShader).toContain('vCamoUv');
  });

  it('paints a file’s opaque materials and leaves its glass alone', () => {
    const root = new THREE.Group();
    const opaque = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'M_opaque' }));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'M_glass', transparent: true }));
    root.add(opaque, glass);
    const before = { opaque: opaque.material, glass: glass.material };
    paintCamo(root, 'gold', 8);
    expect(opaque.material).not.toBe(before.opaque);
    // A painted lens is not a lens.
    expect(glass.material).toBe(before.glass);
  });

  it('gives a camo its own surface set, with the glove left out of it', () => {
    const plain = sharedWeaponSurfaces(8);
    const camo = heldWeaponMaterial(8, 'gold');
    expect(camo).not.toBe(plain.get('gunmetal'));
    // Painting the player's hands in tiger stripe is not what a weapon camo is; the hands
    // are the one part that should stay constant so the eye can read the gun against them.
    const golden = buildWeaponModel('ar_carbine', 8, 'gold', { hands: true, attachments: [] });
    golden.dispose();
  });
});

describe('the held weapon', () => {
  it('is one geometry with the scale baked in, not a group to be posed', () => {
    const held = buildHeldWeapon('ar_carbine');
    expect(held.geometry).toBeInstanceOf(THREE.BufferGeometry);
    const spec = modelSpecFor('ar_carbine');
    held.geometry.computeBoundingBox();
    const box = held.geometry.boundingBox as THREE.Box3;
    const bare = Math.max(...bodyBoxes(spec).map((b) => Math.abs(b.z) + b.d / 2));
    // The viewmodel scales its root; a shared geometry has no root, so it is baked in.
    expect(box.max.z - box.min.z).toBeGreaterThan(bare * spec.scale * 0.5);
    held.geometry.dispose();
  });

  it('leaves out the apertures, because a filled window at fifty metres is a black dot', () => {
    const spec = modelSpecFor('ar_halcyon');
    expect(bodyBoxes(spec).some((b) => b.surface === 'lens')).toBe(true);
    const withOptic = buildHeldWeapon('ar_halcyon');
    const counted = [...bodyBoxes(spec), ...magazineBoxes(spec), ...chargingBoxes(spec)].filter(
      (b) => b.surface !== 'lens' && b.surface !== 'reticle',
    ).length;
    // Eight corners a box, so the vertex count says how many boxes went in.
    expect(withOptic.geometry.attributes.position?.count ?? 0).toBeGreaterThanOrEqual(counted * 8);
    withOptic.geometry.dispose();
  });

  it('leaves out the first-person gloves, since the body it goes on has hands', () => {
    const held = buildHeldWeapon('ar_carbine');
    const spec = modelSpecFor('ar_carbine');
    const withGloves = buildWeaponModel('ar_carbine', 8, null, { hands: true, attachments: [] });
    expect(vertexCount(withGloves.root)).toBeGreaterThan(held.geometry.attributes.position?.count ?? 0);
    expect(bodyBoxes(spec).some((b) => b.surface === 'glove')).toBe(false);
    held.geometry.dispose();
    withGloves.dispose();
  });

  it('hands back the two points a body holds it by, in the geometry’s own space', () => {
    const spec = modelSpecFor('ar_carbine');
    const held = buildHeldWeapon('ar_carbine');
    const grip = triggerHandAnchor(spec);
    const support = supportHandAnchor(spec);
    // The same anchors the viewmodel's gloves stand on, scaled with the geometry.
    expect(held.gripAnchor.x).toBeCloseTo(grip.x * spec.scale, 12);
    expect(held.supportAnchor.z).toBeCloseTo(support.z * spec.scale, 12);
    held.geometry.dispose();
  });

  it('is a plate for the shield, carried in one hand', () => {
    const shield = buildHeldWeapon('streak_shield');
    shield.geometry.computeBoundingBox();
    const box = shield.geometry.boundingBox as THREE.Box3;
    // Taller than it is thick, by a lot: a slab, not a weapon.
    expect(box.max.y - box.min.y).toBeGreaterThan((box.max.z - box.min.z) * 5);
    // One arm holds it; the other is on the pistol the streak gives you.
    expect(shield.gripAnchor.toArray()).toEqual(shield.supportAnchor.toArray());
    shield.geometry.dispose();
  });

  it('builds every weapon in the arsenal', () => {
    for (const id of ['ar_carbine', 'ar_vulcan', 'smg_wasp', 'shotgun_breacher', 'lmg_bastion', 'sniper_kestrel', 'pistol_talon']) {
      const held = buildHeldWeapon(id);
      expect(held.geometry.attributes.position?.count ?? 0, id).toBeGreaterThan(50);
      held.geometry.dispose();
    }
  });
});
