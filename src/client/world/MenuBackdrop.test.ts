import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MAPS, findMap, type MapEntry } from '../../shared/modes/ModeRegistry';
import type { LaneDef, MapDef, MaterialKey } from '../../shared/world/maps/types';
import type { CharacterAssetService } from '../characters/CharacterAssetService';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import { MenuBackdrop } from './MenuBackdrop';

/**
 * The orbit, the hold and the laneless fallback cannot be reached from a shipped map — all four
 * of them run a lane — so they are reached through the registry, which is the one door the
 * backdrop opens a map by. Only `findMap` is replaced, and only for the ids made here.
 */
const cases = new Map<string, MapEntry>();
vi.mock('../../shared/modes/ModeRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/modes/ModeRegistry')>();
  return {
    ...actual,
    findMap: (id: string): MapEntry => cases.get(id) ?? actual.findMap(id),
  };
});

/** A map of nothing but a floor, the boxes asked for, and one key light. */
function caseMap(
  id: string,
  blocks: ReadonlyArray<{ x: number; y: number; z: number; sx: number; sy: number; sz: number }>,
  lanes?: readonly LaneDef[],
): MapEntry {
  const def = {
    id,
    name: id.toUpperCase(),
    brushes: [
      { position: { x: 0, y: -0.5, z: 0 }, size: { x: 80, y: 1, z: 80 }, rotationY: 0, material: 'concrete' as MaterialKey },
      ...blocks.map((b) => ({
        position: { x: b.x, y: b.y, z: b.z },
        size: { x: b.sx, y: b.sy, z: b.sz },
        rotationY: 0,
        material: 'metal' as MaterialKey,
      })),
    ],
    props: [],
    spawns: [{ position: { x: -12, y: 0, z: 0 }, radius: 2, team: 'A' }],
    lights: [{ kind: 'hemisphere', skyColor: 0x8899aa, groundColor: 0x333333, intensity: 1 }],
    ambient: {
      fogColor: 0x202020,
      fogNear: 20,
      fogFar: 120,
      sky: { zenith: 0x303040, falloff: 1, disc: { color: 0xffffff, sizeDeg: 1, glowDeg: 1, intensity: 0 } },
    },
    coverPoints: [],
    navBounds: { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 10, z: 20 } },
    ...(lanes === undefined ? {} : { lanes }),
  } as unknown as MapDef;
  const entry = { id, name: def.name, def, teamSize: 2, tierMix: ['REGULAR'] } as unknown as MapEntry;
  cases.set(id, entry);
  return entry;
}

/**
 * Characterization tests for the menu's backdrop (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 *
 * `combat` is off throughout: the fight behind the menu is `MenuSkirmish`, which builds a
 * `BotRenderer` and an `Fx` and therefore needs a document. Everything this file decides on its
 * own — which lane the camera runs, from which end, whether it dollies, orbits or holds, and
 * where the map's picture is taken from — is geometry against the map's own collision world and
 * is pinned here exactly.
 */

const textures = {
  get: (): { worldScale: number; texture: null } => ({ worldScale: 2, texture: null }),
} as unknown as ProceduralTextures;

function makeBackdrop(): { backdrop: MenuBackdrop; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const backdrop = new MenuBackdrop({
    scene,
    textures,
    shadowQuality: () => 'medium',
    characterAssets: null as unknown as CharacterAssetService,
    anisotropy: () => 4,
  });
  backdrop.combat = false;
  return { backdrop, scene };
}

/** Prepare a map and pump frames until the chunked build has landed. */
function build(backdrop: MenuBackdrop, mapId: string): THREE.PerspectiveCamera {
  backdrop.prepare(mapId);
  let camera = backdrop.frame(1 / 60, 16 / 9);
  let guard = 0;
  while (camera === null && guard < 100_000) {
    camera = backdrop.frame(1 / 60, 16 / 9);
    guard++;
  }
  if (camera === null) throw new Error(`${mapId} never finished building`);
  return camera;
}

function fixed(value: number): string {
  return (Object.is(value, -0) ? 0 : value).toFixed(6);
}

function describeCamera(camera: THREE.PerspectiveCamera): string {
  return [
    `pos=${fixed(camera.position.x)},${fixed(camera.position.y)},${fixed(camera.position.z)}`,
    `rot=${fixed(camera.rotation.x)},${fixed(camera.rotation.y)},${fixed(camera.rotation.z)}`,
  ].join(' ');
}

describe('MenuBackdrop before a map is asked for', () => {
  it('has no map, draws no frame and offers no picture', () => {
    const { backdrop, scene } = makeBackdrop();
    expect(backdrop.mapId).toBe('');
    expect(backdrop.ready).toBe(false);
    expect(backdrop.frame(1 / 60, 16 / 9)).toBe(null);
    expect(backdrop.vistaCamera(16 / 9)).toBe(null);
    expect(scene.children).toEqual([]);
  });

  it('steps the fight without a map without throwing', () => {
    const { backdrop } = makeBackdrop();
    expect(() => backdrop.simulate()).not.toThrow();
  });

  it('is safe to dispose with nothing built', () => {
    const { backdrop } = makeBackdrop();
    expect(() => backdrop.dispose()).not.toThrow();
    expect(backdrop.mapId).toBe('');
  });
});

describe('MenuBackdrop.prepare', () => {
  it('names the map it was asked for before the build has finished', () => {
    const { backdrop } = makeBackdrop();
    backdrop.prepare('mp_foundry');
    expect(backdrop.mapId).toBe('mp_foundry');
    expect(backdrop.ready).toBe(false);
  });

  it('logs and ignores a map the registry does not know, rather than taking the menu down', () => {
    const { backdrop } = makeBackdrop();
    expect(() => backdrop.prepare('mp_nowhere')).not.toThrow();
    expect(backdrop.mapId).toBe('');
    expect(backdrop.ready).toBe(false);
  });

  it('keeps the map it already has when a bad id arrives', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    backdrop.prepare('mp_nowhere');
    expect(backdrop.mapId).toBe('mp_foundry');
    expect(backdrop.ready).toBe(true);
    expect(scene.children.length).toBe(1);
  });

  it('is idempotent for the map already shown', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    const root = scene.children[0];
    backdrop.prepare('mp_foundry');
    expect(scene.children[0]).toBe(root);
    expect(backdrop.ready).toBe(true);
  });

  it('replaces the map in the scene when a different one is asked for', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    const first = scene.children[0];
    build(backdrop, 'mp_depot');
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]).not.toBe(first);
    expect(backdrop.mapId).toBe('mp_depot');
    expect((first as THREE.Group).children).toEqual([]);
  });

  it('puts exactly one map root in the scene and applies the map\'s ambient', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_dunes');
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]?.name).toBe('map:mp_dunes');
    expect((scene.background as THREE.Color).getHex()).toBe(findMap('mp_dunes').def.ambient.fogColor);
    expect((scene.fog as THREE.Fog).near).toBe(findMap('mp_dunes').def.ambient.fogNear);
  });
});

describe('MenuBackdrop particulate', () => {
  it('hangs the map\'s motes off the map root, where dispose will find them', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_dunes');
    const root = scene.children[0] as THREE.Group;
    const motes = root.children.find((child) => child.name === 'particulate');
    expect(motes).toBeDefined();
  });

  it('adds none for a map that has no atmosphere pass', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    const root = scene.children[0] as THREE.Group;
    expect(root.children.some((child) => child.name === 'particulate')).toBe(false);
  });

  it('drifts the motes on the render clock', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_dunes');
    const root = scene.children[0] as THREE.Group;
    const motes = root.children.find((child) => child.name === 'particulate') as THREE.Points;
    const positions = motes.geometry.getAttribute('position');
    const before = [...(positions.array as Float32Array)];
    for (let i = 0; i < 30; i++) backdrop.frame(1 / 60, 16 / 9);
    expect([...(positions.array as Float32Array)]).not.toEqual(before);
  });
});

describe('MenuBackdrop camera', () => {
  it('is a cinematic lens, re-projected only when the aspect changes', () => {
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'mp_foundry');
    expect(camera.fov).toBe(62);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(400);
    expect(camera.aspect).toBeCloseTo(16 / 9, 10);

    const projection = camera.projectionMatrix.elements.slice();
    backdrop.frame(1 / 60, 16 / 9);
    expect([...camera.projectionMatrix.elements]).toEqual([...projection]);

    backdrop.frame(1 / 60, 1);
    expect(camera.aspect).toBe(1);
    expect([...camera.projectionMatrix.elements]).not.toEqual([...projection]);
  });

  it('hands back the same camera object every frame', () => {
    const { backdrop } = makeBackdrop();
    const first = build(backdrop, 'mp_foundry');
    expect(backdrop.frame(1 / 60, 16 / 9)).toBe(first);
    expect(backdrop.vistaCamera(16 / 9)).toBe(first);
  });

  it('runs the dolly from the lane end and comes back, without stopping at either end', () => {
    const { backdrop } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    const samples: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const camera = backdrop.frame(1 / 60, 16 / 9);
      if (camera !== null && i % 60 === 0) samples.push(camera.position.z);
    }
    const span = Math.max(...samples) - Math.min(...samples);
    expect(span).toBeGreaterThan(1);
  });

  it('sways the heading either side of the lane', () => {
    const { backdrop } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    const yaws: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const camera = backdrop.frame(1 / 60, 16 / 9);
      if (camera !== null) yaws.push(camera.rotation.y);
    }
    const spread = Math.max(...yaws) - Math.min(...yaws);
    // 2.5 degrees either side is 5 degrees of travel, which is 0.0873 rad.
    expect(spread).toBeGreaterThan(0.04);
    expect(spread).toBeLessThanOrEqual((2 * 2.5 * Math.PI) / 180 + 1e-9);
  });

  it('holds the camera a little below the horizontal, which reads as a person', () => {
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'mp_foundry');
    expect(camera.rotation.x).toBeCloseTo(-0.035, 10);
    expect(camera.rotation.order).toBe('YXZ');
  });

  it('starts the sweep at the beginning however long the build took', () => {
    const slow = makeBackdrop();
    const fast = makeBackdrop();
    build(slow.backdrop, 'mp_foundry');
    build(fast.backdrop, 'mp_foundry');
    // Both have adopted; the elapsed clock is reset on adoption, so the next frame matches.
    const a = slow.backdrop.frame(1 / 60, 16 / 9);
    const b = fast.backdrop.frame(1 / 60, 16 / 9);
    expect(describeCamera(a as THREE.PerspectiveCamera)).toBe(describeCamera(b as THREE.PerspectiveCamera));
  });

  it('pins the sweep over each shipped map', () => {
    const rows = MAPS.map((entry) => {
      const { backdrop } = makeBackdrop();
      build(backdrop, entry.id);
      const samples: string[] = [];
      for (let i = 0; i < 900; i++) {
        const camera = backdrop.frame(1 / 60, 16 / 9);
        if (camera !== null && i % 180 === 0) samples.push(describeCamera(camera));
      }
      return `${entry.id} :: ${samples.join(' | ')}`;
    });
    expect(rows).toMatchInlineSnapshot(`
      [
        "mp_foundry :: pos=0.000000,1.700000,21.499961 rot=-0.035000,0.000653,0.000000 | pos=0.000000,1.700000,21.182155 rot=-0.035000,0.042680,0.000000 | pos=0.000000,1.700000,20.260873 rot=-0.035000,0.018342,0.000000 | pos=0.000000,1.700000,18.789409 rot=-0.035000,-0.034517,0.000000 | pos=0.000000,1.700000,16.852884 rot=-0.035000,-0.033703,0.000000",
        "mp_dunes :: pos=-26.000000,1.700000,32.999975 rot=-0.035000,0.000653,0.000000 | pos=-26.000000,1.700000,32.792328 rot=-0.035000,0.042680,0.000000 | pos=-26.000000,1.700000,32.183510 rot=-0.035000,0.018342,0.000000 | pos=-26.000000,1.700000,31.188511 rot=-0.035000,-0.034517,0.000000 | pos=-26.000000,1.700000,29.831833 rot=-0.035000,-0.033703,0.000000",
        "mp_depot :: pos=0.000000,1.700000,26.999969 rot=-0.035000,0.000653,0.000000 | pos=0.000000,1.700000,26.746442 rot=-0.035000,0.042680,0.000000 | pos=0.000000,1.700000,26.006166 rot=-0.035000,0.018342,0.000000 | pos=0.000000,1.700000,24.806342 rot=-0.035000,-0.034517,0.000000 | pos=0.000000,1.700000,23.191060 rot=-0.035000,-0.033703,0.000000",
        "mp_testbed :: pos=-19.999899,1.700000,-13.999930 rot=-0.035000,-2.180870,0.000000 | pos=-19.207540,1.700000,-13.445278 rot=-0.035000,-2.138843,0.000000 | pos=-17.308005,1.700000,-12.115604 rot=-0.035000,-2.163181,0.000000 | pos=-15.367543,1.700000,-10.757280 rot=-0.035000,-2.216039,0.000000 | pos=-14.475374,1.700000,-10.132762 rot=-0.035000,-2.215225,0.000000",
      ]
    `);
  });
});

describe('MenuBackdrop when no lane runs', () => {
  const SHORT_LANE: readonly LaneDef[] = [
    { name: 'BLOCKED', a: { x: 0, y: 0, z: -5 }, b: { x: 0, y: 0, z: 5 }, center: { x: 0, y: 0, z: 0 } },
  ];

  it('orbits above the lane centre at the first free ring', () => {
    // A six-metre pillar on the lane: neither end runs four free metres at eye height, and the
    // first ring — five up and seven out — clears it all the way round.
    caseMap('case_orbit', [{ x: 0, y: 3, z: 0, sx: 6, sy: 6, sz: 6 }], SHORT_LANE);
    const { backdrop } = makeBackdrop();
    build(backdrop, 'case_orbit');
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 2700; i++) {
      const camera = backdrop.frame(1 / 60, 16 / 9);
      if (camera !== null && i % 300 === 0) positions.push(camera.position.clone());
    }
    for (const position of positions) {
      expect(position.y).toBeCloseTo(5, 6);
      expect(Math.hypot(position.x, position.z)).toBeCloseTo(7, 6);
    }
    // A slow circle rather than a hold: the camera is somewhere else by the end of a sweep.
    expect(positions[0]?.distanceTo(positions[positions.length - 1] ?? new THREE.Vector3())).toBeGreaterThan(1);
  });

  it('looks down at the lane rather than out at the sky while it orbits', () => {
    caseMap('case_orbit_look', [{ x: 0, y: 3, z: 0, sx: 6, sy: 6, sz: 6 }], SHORT_LANE);
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'case_orbit_look');
    backdrop.frame(1 / 60, 16 / 9);
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    expect(direction.y).toBeLessThan(0);
  });

  it('takes the next ring up when the first is blocked', () => {
    // Twelve metres across and eight tall: the five-up ring at seven out cuts its corners, and
    // the seven-up ring at ten out clears them.
    caseMap('case_ring2', [{ x: 0, y: 4, z: 0, sx: 12, sy: 8, sz: 12 }], SHORT_LANE);
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'case_ring2');
    backdrop.frame(1 / 60, 16 / 9);
    expect(camera.position.y).toBeCloseTo(7, 6);
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(10, 6);
  });

  it('holds and sways when no lane runs and no circle is free either', () => {
    caseMap('case_hold', [{ x: 0, y: 14, z: 0, sx: 60, sy: 28, sz: 60 }], SHORT_LANE);
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'case_hold');
    const positions: string[] = [];
    const yaws: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const frame = backdrop.frame(1 / 60, 16 / 9);
      if (frame === null) continue;
      positions.push(`${fixed(frame.position.x)},${fixed(frame.position.y)},${fixed(frame.position.z)}`);
      yaws.push(frame.rotation.y);
    }
    expect(new Set(positions).size).toBe(1);
    expect(camera.position.y).toBeCloseTo(1.65, 6);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(0.04);
  });

  it('makes a lane from the first spawn and the bounds centre on a map with none', () => {
    caseMap('case_nolanes', []);
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'case_nolanes');
    backdrop.frame(1 / 60, 16 / 9);
    // The spawn is at x = -12 and the bounds centre is the origin, so the run is along +x.
    expect(camera.position.x).toBeGreaterThanOrEqual(-12);
    expect(camera.position.x).toBeLessThan(0);
    expect(camera.position.y).toBeCloseTo(1.65, 6);
  });

  it('prefers the spine lane while either of its ends runs', () => {
    const lanes: readonly LaneDef[] = [
      { name: 'WEST', a: { x: -18, y: 0, z: -18 }, b: { x: -18, y: 0, z: 18 }, center: { x: -18, y: 0, z: 0 } },
      { name: 'SPINE', a: { x: 0, y: 0, z: -18 }, b: { x: 0, y: 0, z: 18 }, center: { x: 0, y: 0, z: 0 } },
      { name: 'EAST', a: { x: 18, y: 0, z: -18 }, b: { x: 18, y: 0, z: 18 }, center: { x: 18, y: 0, z: 0 } },
    ];
    caseMap('case_spine', [], lanes);
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'case_spine');
    backdrop.frame(1 / 60, 16 / 9);
    // Three lanes, and the middle one is the one the camera runs.
    expect(camera.position.x).toBeCloseTo(0, 6);
  });

  it('falls back to the longest run on any lane when the spine is blocked from both ends', () => {
    const lanes: readonly LaneDef[] = [
      { name: 'WEST', a: { x: -18, y: 0, z: -18 }, b: { x: -18, y: 0, z: 18 }, center: { x: -18, y: 0, z: 0 } },
      { name: 'SPINE', a: { x: 0, y: 0, z: -5 }, b: { x: 0, y: 0, z: 5 }, center: { x: 0, y: 0, z: 0 } },
      { name: 'EAST', a: { x: 18, y: 0, z: -18 }, b: { x: 18, y: 0, z: 18 }, center: { x: 18, y: 0, z: 0 } },
    ];
    caseMap('case_offspine', [{ x: 0, y: 3, z: 0, sx: 6, sy: 6, sz: 6 }], lanes);
    const { backdrop } = makeBackdrop();
    const camera = build(backdrop, 'case_offspine');
    backdrop.frame(1 / 60, 16 / 9);
    expect(Math.abs(camera.position.x)).toBeCloseTo(18, 6);
  });
});

describe('MenuBackdrop.vistaCamera', () => {
  it('stands back from the spine lane\'s centre and looks through it', () => {
    const { backdrop } = makeBackdrop();
    build(backdrop, 'mp_dunes');
    const vista = backdrop.vistaCamera(16 / 9);
    expect(vista).not.toBe(null);
    const direction = new THREE.Vector3();
    vista?.getWorldDirection(direction);
    expect(direction.length()).toBeCloseTo(1, 6);
  });

  it('re-projects on an aspect it has not seen', () => {
    const { backdrop } = makeBackdrop();
    build(backdrop, 'mp_dunes');
    backdrop.vistaCamera(16 / 9);
    const vista = backdrop.vistaCamera(1);
    expect(vista?.aspect).toBe(1);
  });

  it('pins the picture taken of each shipped map', () => {
    const rows = MAPS.map((entry) => {
      const { backdrop } = makeBackdrop();
      build(backdrop, entry.id);
      const vista = backdrop.vistaCamera(16 / 9);
      if (vista === null) throw new Error('no vista');
      return `${entry.id} :: ${describeCamera(vista)}`;
    });
    expect(rows).toMatchInlineSnapshot(`
      [
        "mp_foundry :: pos=0.000000,2.250000,14.000000 rot=-0.021425,0.000000,0.000000",
        "mp_dunes :: pos=0.000000,2.250000,3.000000 rot=-0.066568,0.000000,0.000000",
        "mp_depot :: pos=0.000000,2.250000,14.000000 rot=-0.021425,0.000000,0.000000",
        "mp_testbed :: pos=0.000000,2.300000,0.000000 rot=-0.099669,0.000000,0.000000",
      ]
    `);
  });
});

describe('MenuBackdrop.dispose', () => {
  it('takes the map out of the scene and off the GPU', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_dunes');
    const root = scene.children[0] as THREE.Group;
    backdrop.dispose();
    expect(scene.children).toEqual([]);
    expect(root.children).toEqual([]);
    expect(backdrop.ready).toBe(false);
    expect(backdrop.mapId).toBe('');
  });

  it('stops drawing and stops offering a picture', () => {
    const { backdrop } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    backdrop.dispose();
    expect(backdrop.frame(1 / 60, 16 / 9)).toBe(null);
    expect(backdrop.vistaCamera(16 / 9)).toBe(null);
  });

  it('leaves the backdrop able to prepare another map', () => {
    const { backdrop, scene } = makeBackdrop();
    build(backdrop, 'mp_foundry');
    backdrop.dispose();
    build(backdrop, 'mp_depot');
    expect(backdrop.mapId).toBe('mp_depot');
    expect(scene.children.length).toBe(1);
  });

  it('drops a build that was still in flight', () => {
    const { backdrop, scene } = makeBackdrop();
    backdrop.prepare('mp_foundry');
    backdrop.frame(1 / 60, 16 / 9);
    backdrop.dispose();
    for (let i = 0; i < 200; i++) backdrop.frame(1 / 60, 16 / 9);
    expect(backdrop.ready).toBe(false);
    expect(scene.children).toEqual([]);
  });
});
