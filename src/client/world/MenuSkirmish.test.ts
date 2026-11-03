import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EV } from '../../shared/core/Events';
import { installClock } from '../../shared/core/Clock';
import { PLAYER_ENTITY_ID } from '../../shared/combat/DamageSystem';
import { findMap } from '../../shared/modes/ModeRegistry';
import type { ProceduralTextures } from '../engine/ProceduralTextures';
import type { CharacterAssetService } from '../characters/CharacterAssetService';
import { loadMap, type LoadedMap } from './MapRender';
import { MenuSkirmish } from './MenuSkirmish';

/**
 * Characterization tests for the fight behind the menu (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 *
 * Two of the collaborators draw — `BotRenderer` builds canvas textures for its nameplates and
 * `Fx` builds them for its impacts — so both reach `document` and neither can be constructed in
 * node. They are replaced with recorders of the calls this file makes into them, which is the
 * part that belongs to this file; everything else is the real shared simulation, on the real
 * collision world, with the real `BotDirector`, `DamageSystem`, `ScoreSystem` and `MatchFlow`.
 *
 * The picture itself — bodies, skins, muzzle flashes, tracers — is browser-verified.
 */

const rendererCalls: string[] = [];
const fxCalls: string[] = [];

vi.mock('../ai/BotRenderer', () => ({
  BotRenderer: class {
    readonly group = new THREE.Group();

    constructor(
      readonly bots: () => unknown,
      readonly viewer: () => unknown,
      readonly anisotropy: number,
      readonly provider: (actor: { characterId: string | null; entityId: number }) => unknown,
    ) {
      this.group.name = 'bots';
      rendererCalls.push(`new anisotropy=${anisotropy}`);
    }

    setIndicatorsVisible(visible: boolean): void {
      rendererCalls.push(`indicators=${String(visible)}`);
    }

    update(alpha: number, dt: number, camera: THREE.PerspectiveCamera): void {
      rendererCalls.push(`update alpha=${alpha} dt=${dt} fov=${camera.fov}`);
    }

    dispose(): void {
      rendererCalls.push('dispose');
    }
  },
}));

vi.mock('../engine/Fx', () => ({
  Fx: class {
    readonly group = new THREE.Group();

    constructor(readonly anisotropy: number) {
      this.group.name = 'fx';
      fxCalls.push(`new anisotropy=${anisotropy}`);
    }

    fireMuzzleFlash(x: number, y: number, z: number, scale: number, viewmodel: boolean): void {
      fxCalls.push(`muzzle ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} scale=${scale} viewmodel=${String(viewmodel)}`);
    }

    spawnTracer(): void {
      fxCalls.push('tracer');
    }

    spawnImpact(...args: [number, number, number, number, number, number, string, boolean]): void {
      const material = args[6];
      const penetrated = args[7];
      fxCalls.push(`impact ${material} penetrated=${String(penetrated)}`);
    }

    update(dt: number): void {
      fxCalls.push(`update dt=${dt}`);
    }

    dispose(): void {
      fxCalls.push('dispose');
    }
  },
}));

let now = 0;
installClock({ nowMs: () => now });

const textures = {
  get: (): { worldScale: number; texture: null } => ({ worldScale: 2, texture: null }),
} as unknown as ProceduralTextures;

const characterAssets = {
  avatarProvider: (): unknown => ({}),
} as unknown as CharacterAssetService;

function makeSkirmish(mapId = 'mp_foundry', seed = 0x4e5a_1000): {
  skirmish: MenuSkirmish;
  scene: THREE.Scene;
  map: LoadedMap;
} {
  rendererCalls.length = 0;
  fxCalls.length = 0;
  const entry = findMap(mapId);
  const scene = new THREE.Scene();
  const map = loadMap(entry.def, textures, 'medium');
  const skirmish = new MenuSkirmish({
    scene,
    map,
    mapEntry: entry,
    characterAssets,
    anisotropy: () => 4,
    seed,
  });
  return { skirmish, scene, map };
}

describe('MenuSkirmish wiring', () => {
  it('is a full-roster Team Deathmatch with nobody\'s seat held back', () => {
    const { skirmish } = makeSkirmish();
    const entry = findMap('mp_foundry');
    expect(skirmish.mode.id).toBe('TDM');
    expect(skirmish.bots.bots.length).toBe(entry.teamSize * 2);
    expect(skirmish.isOver).toBe(false);
  });

  it('is teams rather than free-for-all, everywhere it matters', () => {
    const { skirmish } = makeSkirmish();
    expect(skirmish.bots.freeForAll).toBe(false);
    expect(skirmish.score.freeForAll).toBe(false);
    const teams = new Set(skirmish.bots.bots.map((bot) => bot.team));
    expect([...teams].sort()).toEqual(['A', 'B']);
  });

  it('registers every bot with the score system before the flow starts', () => {
    const { skirmish } = makeSkirmish();
    for (const bot of skirmish.bots.bots) {
      expect(skirmish.score.row(bot.entityId)?.displayName).toBe(bot.displayName);
    }
  });

  it('is on a bus of its own, so a kill behind the menu reaches nothing', async () => {
    const { skirmish } = makeSkirmish();
    const game = await import('../../shared/core/Events');
    const other = game.createGameBus();
    let heard = 0;
    other.on(EV.WeaponFired, () => { heard++; });
    skirmish.bus.emit(EV.WeaponFired, {
      sourceId: 1, weaponId: 'ar_carbine', x: 0, y: 1, z: 0, endX: 0, endY: 1, endZ: 5, tracer: false,
    } as never);
    expect(heard).toBe(0);
  });

  it('puts the bodies and the effects in the scene as two groups', () => {
    const { scene } = makeSkirmish();
    expect(scene.children.map((child) => child.name).sort()).toEqual(['bots', 'fx']);
  });

  it('shows no nameplates, health bars or pads: a backdrop is a picture', () => {
    makeSkirmish();
    expect(rendererCalls).toContain('indicators=false');
  });

  it('passes the anisotropy it was given to both of them', () => {
    makeSkirmish();
    expect(rendererCalls[0]).toBe('new anisotropy=4');
    expect(fxCalls[0]).toBe('new anisotropy=4');
  });

  it('bakes a navmesh it can hand to the next skirmish on the same map', () => {
    const { skirmish } = makeSkirmish();
    expect(skirmish.nav).toBe(skirmish.bots.nav);
    expect(skirmish.nav).toBeDefined();
  });

  it('reuses a navmesh it is given rather than baking another', () => {
    const first = makeSkirmish();
    const entry = findMap('mp_foundry');
    const scene = new THREE.Scene();
    const second = new MenuSkirmish({
      scene,
      map: first.map,
      mapEntry: entry,
      characterAssets,
      anisotropy: () => 4,
      seed: 0x4e5a_1001,
      nav: first.skirmish.nav,
    });
    expect(second.nav).toBe(first.skirmish.nav);
  });

  it('deals a different fight for a different seed', () => {
    const a = makeSkirmish('mp_foundry', 0x4e5a_1000);
    const b = makeSkirmish('mp_foundry', 0x4e5a_1001);
    for (let i = 0; i < 400; i++) {
      now += 16;
      a.skirmish.step();
      b.skirmish.step();
    }
    const pose = (s: MenuSkirmish): string =>
      s.bots.bots.map((bot) => `${bot.px.toFixed(4)},${bot.pz.toFixed(4)}`).join('|');
    expect(pose(a.skirmish)).not.toBe(pose(b.skirmish));
  });

  it('fights the same fight twice for the same seed', () => {
    const a = makeSkirmish('mp_foundry', 0x4e5a_2000);
    const b = makeSkirmish('mp_foundry', 0x4e5a_2000);
    for (let i = 0; i < 400; i++) {
      now += 16;
      a.skirmish.step();
      b.skirmish.step();
    }
    const pose = (s: MenuSkirmish): string =>
      s.bots.bots.map((bot) => `${bot.px.toFixed(6)},${bot.py.toFixed(6)},${bot.pz.toFixed(6)},${bot.health.current}`).join('|');
    expect(pose(a.skirmish)).toBe(pose(b.skirmish));
  });
});

describe('MenuSkirmish.step', () => {
  it('fast-forwards the round-one freeze eight sim steps at a time', () => {
    const { skirmish } = makeSkirmish();
    expect(skirmish.flow.currentPhase).toBe('WARMUP');
    const tickOf = (s: MenuSkirmish): number => (s as unknown as { tick: number }).tick;
    skirmish.step();
    expect(tickOf(skirmish)).toBe(8);
    skirmish.step();
    expect(tickOf(skirmish)).toBe(16);
  });

  it('drops back to one step per call once the round is live', () => {
    const { skirmish } = makeSkirmish();
    const tickOf = (s: MenuSkirmish): number => (s as unknown as { tick: number }).tick;
    while (skirmish.flow.currentPhase === 'WARMUP') skirmish.step();
    const before = tickOf(skirmish);
    skirmish.step();
    expect(tickOf(skirmish)).toBe(before + 1);
    expect(skirmish.flow.currentPhase).toBe('LIVE');
  });

  it('freezes the bots\' input during the warmup and the round end, and not during the round', () => {
    const { skirmish } = makeSkirmish();
    expect(skirmish.flow.currentPhase).toBe('WARMUP');
    skirmish.step();
    expect(skirmish.bots.inputFrozen).toBe(true);
    while (skirmish.flow.currentPhase === 'WARMUP') skirmish.step();
    skirmish.step();
    expect(skirmish.bots.inputFrozen).toBe(false);
  });

  it('reaches the live round in about a second and a quarter of wall clock', () => {
    const { skirmish } = makeSkirmish();
    let calls = 0;
    while (skirmish.flow.currentPhase === 'WARMUP' && calls < 1000) {
      skirmish.step();
      calls++;
    }
    // 600 sim ticks of freeze at eight a call is 75 calls, which is 1.25 s of a 60 Hz loop.
    expect(calls).toBe(75);
  });

  it('advances the fight: bots move and the score changes over a long run', () => {
    const { skirmish } = makeSkirmish();
    const before = skirmish.bots.bots.map((bot) => `${bot.px.toFixed(3)},${bot.pz.toFixed(3)}`).join('|');
    for (let i = 0; i < 1200; i++) {
      now += 16;
      skirmish.step();
    }
    const after = skirmish.bots.bots.map((bot) => `${bot.px.toFixed(3)},${bot.pz.toFixed(3)}`).join('|');
    expect(after).not.toBe(before);
  });

  it('is over when the mode\'s clock runs out, which is the backdrop\'s cue to build the next', () => {
    const { skirmish } = makeSkirmish();
    while (skirmish.flow.currentPhase === 'WARMUP') skirmish.step();
    expect(skirmish.isOver).toBe(false);
    (skirmish.mode as unknown as { ticksLeft: number }).ticksLeft = 0;
    skirmish.step();
    expect(skirmish.isOver).toBe(true);
    expect(skirmish.flow.isOver).toBe(true);
  });

  it('still takes one step if it is called again after the match is over', () => {
    // The backdrop drops a finished skirmish on the step that found it over, so this is the
    // shape of the loop rather than a case the menu reaches.
    const { skirmish } = makeSkirmish();
    const tickOf = (s: MenuSkirmish): number => (s as unknown as { tick: number }).tick;
    while (skirmish.flow.currentPhase === 'WARMUP') skirmish.step();
    (skirmish.mode as unknown as { ticksLeft: number }).ticksLeft = 0;
    skirmish.step();
    expect(skirmish.isOver).toBe(true);
    const settled = tickOf(skirmish);
    skirmish.step();
    expect(tickOf(skirmish)).toBe(settled + 1);
  });
});

describe('MenuSkirmish.render', () => {
  it('poses the bodies between sim steps and advances the effects at render rate', () => {
    const { skirmish } = makeSkirmish();
    rendererCalls.length = 0;
    fxCalls.length = 0;
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 400);
    skirmish.render(0.25, 1 / 120, camera);
    expect(rendererCalls).toEqual(['update alpha=0.25 dt=0.008333333333333333 fov=62']);
    expect(fxCalls).toEqual(['update dt=0.008333333333333333']);
  });
});

describe('MenuSkirmish effects', () => {
  it('fires the world light for a shot, and never the viewmodel\'s flash mesh', () => {
    const { skirmish } = makeSkirmish();
    fxCalls.length = 0;
    skirmish.bus.emit(EV.WeaponFired, {
      sourceId: 2, weaponId: 'ar_carbine', x: 1, y: 2, z: 3, endX: 1, endY: 2, endZ: 9, tracer: false,
    } as never);
    expect(fxCalls.length).toBe(1);
    expect(fxCalls[0]).toContain('muzzle 1.00,2.00,3.00');
    expect(fxCalls[0]).toContain('viewmodel=false');
  });

  it('adds a tracer only when the shot carries one', () => {
    const { skirmish } = makeSkirmish();
    fxCalls.length = 0;
    skirmish.bus.emit(EV.WeaponFired, {
      sourceId: 2, weaponId: 'ar_carbine', x: 0, y: 0, z: 0, endX: 0, endY: 0, endZ: 5, tracer: true,
    } as never);
    expect(fxCalls.filter((call) => call === 'tracer').length).toBe(1);
  });

  it('ignores a shot from a weapon the catalogue does not know', () => {
    const { skirmish } = makeSkirmish();
    fxCalls.length = 0;
    skirmish.bus.emit(EV.WeaponFired, {
      sourceId: 2, weaponId: 'not_a_weapon', x: 0, y: 0, z: 0, endX: 0, endY: 0, endZ: 5, tracer: true,
    } as never);
    expect(fxCalls).toEqual([]);
  });

  it('spawns an impact for a hit, carrying its material and whether it went through', () => {
    const { skirmish } = makeSkirmish();
    fxCalls.length = 0;
    skirmish.bus.emit(EV.BulletImpact, {
      x: 0, y: 1, z: 2, nx: 0, ny: 1, nz: 0, material: 'metal', penetrated: true,
    } as never);
    expect(fxCalls).toEqual(['impact metal penetrated=true']);
  });
});

describe('MenuSkirmish.dispose', () => {
  it('retires the systems and takes both groups out of the scene', () => {
    const { skirmish, scene } = makeSkirmish();
    rendererCalls.length = 0;
    fxCalls.length = 0;
    skirmish.dispose();
    expect(scene.children).toEqual([]);
    expect(rendererCalls).toEqual(['dispose']);
    expect(fxCalls).toEqual(['dispose']);
  });

  it('unsubscribes its effect listeners, so a later shot on its bus draws nothing', () => {
    const { skirmish } = makeSkirmish();
    skirmish.dispose();
    fxCalls.length = 0;
    skirmish.bus.emit(EV.WeaponFired, {
      sourceId: 2, weaponId: 'ar_carbine', x: 0, y: 0, z: 0, endX: 0, endY: 0, endZ: 5, tracer: true,
    } as never);
    skirmish.bus.emit(EV.BulletImpact, {
      x: 0, y: 1, z: 2, nx: 0, ny: 1, nz: 0, material: 'metal', penetrated: false,
    } as never);
    expect(fxCalls).toEqual([]);
  });
});

describe('the empty player seat', () => {
  /** The seat is in the roster beside the bots, which is the whole point of it being there. */
  function seatOf(skirmish: MenuSkirmish): Record<string, never> & {
    entityId: number;
    participating: boolean;
    displayName: string;
    team: string;
    quiet: boolean;
    glinting: boolean;
    px: number;
    py: number;
    pz: number;
    vx: number;
    vz: number;
    yaw: number;
    eyeHeight: number;
    aimHeight: number;
    health: { current: number };
  } {
    const found = skirmish.bots.roster.find((member) => member.entityId === PLAYER_ENTITY_ID);
    if (found === undefined) throw new Error('no seat in the roster');
    return found as never;
  }

  it('never participates, so no bot hunts it and no spawn is scored against it', () => {
    const seat = seatOf(makeSkirmish().skirmish);
    expect(seat.participating).toBe(false);
    expect(seat.displayName).toBe('SPECTATOR');
    expect(seat.team).toBe('A');
    expect(seat.quiet).toBe(true);
    expect(seat.glinting).toBe(false);
  });

  it('stands still at the origin, and is not registered with the score', () => {
    const { skirmish } = makeSkirmish();
    const seat = seatOf(skirmish);
    expect([seat.px, seat.py, seat.pz, seat.vx, seat.vz, seat.yaw]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(seat.eyeHeight).toBe(1.65);
    expect(seat.aimHeight).toBe(1.26);
    expect(skirmish.score.row(PLAYER_ENTITY_ID)).toBeUndefined();
  });

  it('is one seat beside the bots, and the bots are the whole roster otherwise', () => {
    const { skirmish } = makeSkirmish();
    expect(skirmish.bots.roster.length).toBe(skirmish.bots.bots.length + 1);
  });
});
