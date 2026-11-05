import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeBotVisualState, type ActorAnimationInput, type RenderableActor } from '../../shared/ai/BotVisualState';
import type { BotTeam } from '../../shared/ai/Combatant';
import { NO_SPECTATOR_TARGET } from '../../shared/modes/SpectatorTarget';
import type { ViewerContext } from '../../shared/ui/TeamColour';
import type { ActorAvatar } from '../characters/ActorAvatar';
import type { CharacterAvatarProvider } from '../characters/CharacterAvatarProvider';
import { palette } from '../ui/Palette';
import { BotRenderer } from './BotRenderer';

/**
 * `BotRenderer` reaches `document` only through `ActorIndicator`'s canvases, so the same
 * recording stand-in that pins the label pins the whole renderer — reconciliation, the
 * serial edges, the weapon cache and the spectator rules all run in node.
 */

function installCanvasRecorder(): void {
  const ctx: Record<string, unknown> = {};
  for (const op of ['clearRect', 'fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'save', 'restore', 'drawImage']) {
    ctx[op] = (): undefined => undefined;
  }
  ctx['createRadialGradient'] = (): unknown => ({ addColorStop: (): undefined => undefined });
  ctx['createLinearGradient'] = (): unknown => ({ addColorStop: (): undefined => undefined });
  ctx['getImageData'] = (): unknown => ({ data: new Uint8ClampedArray(4) });
  ctx['measureText'] = (): unknown => ({ width: 10 });
  (globalThis as Record<string, unknown>)['document'] = {
    createElement: (): unknown => ({ width: 0, height: 0, getContext: (): unknown => ctx }),
    documentElement: { style: { setProperty: (): undefined => undefined } },
  };
}

const DT = 1 / 60;

const ANIM: ActorAnimationInput = {
  stance: 'STAND',
  aiming: false,
  sprinting: false,
  reloading: false,
  reloadSeconds: 0,
  firing: false,
  throwing: false,
  throwPhase: 'IDLE',
  meleeing: false,
};

interface ActorOptions {
  readonly team?: BotTeam;
  readonly participating?: boolean;
  readonly dormant?: boolean;
  readonly weaponId?: string | null;
  readonly healthFraction?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly yaw?: number;
  readonly scale?: number;
  readonly throwing?: boolean;
  readonly deathSerial?: number;
  readonly spawnSerial?: number;
  readonly flinchSerial?: number;
  readonly deathVariant?: number;
  readonly deathDirX?: number;
  readonly deathDirZ?: number;
}

function actor(entityId: number, options: ActorOptions = {}): RenderableActor {
  const visual = makeBotVisualState();
  visual.deathSerial = options.deathSerial ?? 0;
  visual.spawnSerial = options.spawnSerial ?? 1;
  visual.flinchSerial = options.flinchSerial ?? 0;
  visual.deathVariant = options.deathVariant ?? 0;
  visual.deathDirX = options.deathDirX ?? 1;
  visual.deathDirZ = options.deathDirZ ?? 0;
  return {
    entityId,
    displayName: `ACTOR-${entityId}`,
    team: options.team ?? 'A',
    visual,
    participating: options.participating !== false,
    dormant: options.dormant,
    weaponId: options.weaponId === undefined ? null : options.weaponId,
    heldEquipmentId: null,
    characterId: null,
    animation: { ...ANIM, throwing: options.throwing === true },
    healthFraction: options.healthFraction ?? 1,
    renderX: () => options.x ?? 0,
    renderY: () => options.y ?? 0,
    renderZ: () => options.z ?? -5,
    renderYaw: () => options.yaw ?? 0,
    renderScale: () => options.scale ?? 1,
  };
}

interface Harness {
  readonly renderer: BotRenderer;
  readonly camera: THREE.PerspectiveCamera;
  setRoster(next: readonly RenderableActor[]): void;
  setViewer(next: ViewerContext): void;
  /** Every provider handed out, in the order it was asked for. */
  readonly providers: StubProvider[];
  /** Flip to make every provider claim a GLB is ready. */
  setReady(ready: boolean): void;
  /** What `create()` should hand back; null is "not usable yet". */
  setCreated(make: (() => ActorAvatar | null) | null): void;
  frame(): void;
  indicatorLayer(): THREE.Object3D;
  bodies(): THREE.Object3D[];
}

interface StubProvider extends CharacterAvatarProvider {
  disposed: boolean;
  creates: number;
}

function harness(weaponAssets: null = null): Harness {
  let roster: readonly RenderableActor[] = [];
  let viewer: ViewerContext = { team: 'A', freeForAll: false };
  let ready = false;
  let make: (() => ActorAvatar | null) | null = null;
  const providers: StubProvider[] = [];
  const renderer = new BotRenderer(
    () => roster,
    () => viewer,
    1,
    () => {
      const provider: StubProvider = {
        disposed: false,
        creates: 0,
        get isReady(): boolean {
          return ready;
        },
        create(): ActorAvatar | null {
          provider.creates++;
          return make === null ? null : make();
        },
        dispose(): void {
          provider.disposed = true;
        },
      };
      providers.push(provider);
      return provider;
    },
    weaponAssets,
  );
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
  camera.position.set(0, 1.6, 0);
  camera.updateMatrixWorld(true);
  return {
    renderer,
    camera,
    providers,
    setRoster: (next) => {
      roster = next;
    },
    setViewer: (next) => {
      viewer = next;
    },
    setReady: (value) => {
      ready = value;
    },
    setCreated: (value) => {
      make = value;
    },
    frame: () => renderer.update(0.5, DT, camera),
    indicatorLayer: () => renderer.group.children[2] as THREE.Object3D,
    bodies: () => [...renderer.groupA.children, ...renderer.groupB.children],
  };
}

beforeEach(() => {
  installCanvasRecorder();
  palette.set('off');
});

describe('BotRenderer construction', () => {
  it('holds two thermal body groups and one indicator layer, named', () => {
    const h = harness();
    expect(h.renderer.group.name).toBe('bots');
    expect(h.renderer.group.children.map((c) => c.name)).toEqual(['bots:A', 'bots:B', 'actor-indicators']);
    h.renderer.dispose();
  });

  it('answers groupFor for both sides', () => {
    const h = harness();
    expect(h.renderer.groupFor('A')).toBe(h.renderer.groupA);
    expect(h.renderer.groupFor('B')).toBe(h.renderer.groupB);
    h.renderer.dispose();
  });

  it('starts with no bodies and no indicators', () => {
    const h = harness();
    h.frame();
    expect(h.bodies()).toHaveLength(0);
    expect(h.indicatorLayer().children).toHaveLength(0);
    h.renderer.dispose();
  });
});

describe('BotRenderer reconciliation', () => {
  it('makes a body and an indicator for every actor, on the right side', () => {
    const h = harness();
    h.setRoster([actor(1, { team: 'A' }), actor(2, { team: 'B' }), actor(3, { team: 'B' })]);
    h.frame();
    expect(h.renderer.groupA.children).toHaveLength(1);
    expect(h.renderer.groupB.children).toHaveLength(2);
    expect(h.indicatorLayer().children.map((c) => c.name)).toEqual([
      'actor-indicator:1',
      'actor-indicator:2',
      'actor-indicator:3',
    ]);
    h.renderer.dispose();
  });

  it('reuses the same body across frames', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    const body = h.renderer.groupA.children[0];
    h.frame();
    h.frame();
    expect(h.renderer.groupA.children[0]).toBe(body);
    expect(h.renderer.groupA.children).toHaveLength(1);
    h.renderer.dispose();
  });

  it('applies the interpolated pose it is handed', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 4, y: 1.25, z: -9, yaw: 0.6 })]);
    h.frame();
    const body = h.renderer.groupA.children[0];
    expect(body?.position.toArray()).toEqual([4, 1.25, -9]);
    h.renderer.dispose();
  });

  it('hands the indicator the viewer-relative relation', () => {
    const h = harness();
    h.setRoster([actor(1, { team: 'A' }), actor(2, { team: 'B' })]);
    h.frame();
    const [friendly, hostile] = h.indicatorLayer().children;
    // Only a hostile body wears the pads.
    expect(friendly?.children[1]?.visible).toBe(false);
    expect(hostile?.children[1]?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('re-reads the viewer every frame', () => {
    const h = harness();
    h.setRoster([actor(2, { team: 'B' })]);
    h.frame();
    expect(h.indicatorLayer().children[0]?.children[1]?.visible).toBe(true);
    h.setViewer({ team: 'B', freeForAll: false });
    h.frame();
    expect(h.indicatorLayer().children[0]?.children[1]?.visible).toBe(false);
    h.renderer.dispose();
  });

  it('makes everybody hostile in a free-for-all', () => {
    const h = harness();
    h.setRoster([actor(1, { team: 'A' })]);
    h.setViewer({ team: 'A', freeForAll: true });
    h.frame();
    expect(h.indicatorLayer().children[0]?.children[1]?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('adopts the actor serials rather than replaying its history', () => {
    const h = harness();
    // A renderer built mid-match sees a body that has already died four times.
    h.setRoster([actor(1, { deathSerial: 4, spawnSerial: 4 })]);
    h.frame();
    const avatar = h.renderer.groupA.children[0];
    expect(avatar?.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    h.renderer.dispose();
  });

  it('shows the layer flag on both sides', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    expect(h.indicatorLayer().visible).toBe(true);
    h.renderer.setIndicatorsVisible(false);
    expect(h.indicatorLayer().visible).toBe(false);
    h.frame();
    expect(h.indicatorLayer().visible).toBe(false);
    h.renderer.setIndicatorsVisible(true);
    expect(h.indicatorLayer().visible).toBe(true);
    h.renderer.dispose();
  });
});

describe('BotRenderer animation serials', () => {
  it('starts a fall when the death serial moves', () => {
    const h = harness();
    const a = actor(1);
    h.setRoster([a]);
    h.frame();
    const avatar = h.renderer.groupA.children[0];
    expect(avatar?.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const dying = actor(1, { deathSerial: 1, participating: false });
    h.setRoster([dying]);
    for (let i = 0; i < 30; i++) h.frame();
    expect(avatar?.quaternion.toArray()).not.toEqual([0, 0, 0, 1]);
    h.renderer.dispose();
  });

  it('clears the fall and shows the body when the spawn serial moves', () => {
    const h = harness();
    h.setRoster([actor(1, { deathSerial: 1, participating: false })]);
    for (let i = 0; i < 30; i++) h.frame();
    const avatar = h.renderer.groupA.children[0];
    h.setRoster([actor(1, { deathSerial: 1, spawnSerial: 2, participating: true })]);
    h.frame();
    expect(avatar?.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(avatar?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('leans the body when the flinch serial moves', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    const avatar = h.renderer.groupA.children[0];
    const upright = avatar?.quaternion.clone();
    h.setRoster([actor(1, { flinchSerial: 1 })]);
    h.frame();
    expect(avatar?.quaternion.angleTo(upright ?? new THREE.Quaternion())).toBeGreaterThan(0);
    h.renderer.dispose();
  });

  it('lets the authoritative bit overrule a stale death serial', () => {
    const h = harness();
    h.setRoster([actor(1, { deathSerial: 1, participating: false })]);
    for (let i = 0; i < 30; i++) h.frame();
    const avatar = h.renderer.groupA.children[0];
    // Alive again, with the same death serial the fall was started from.
    h.setRoster([actor(1, { deathSerial: 1, participating: true })]);
    h.frame();
    expect(avatar?.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(avatar?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('drops a body that is not participating even with no death serial change', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    const avatar = h.renderer.groupA.children[0];
    h.setRoster([actor(1, { participating: false })]);
    for (let i = 0; i < 30; i++) h.frame();
    expect(avatar?.quaternion.toArray()).not.toEqual([0, 0, 0, 1]);
    h.renderer.dispose();
  });

  it('ends a frame alive when both edges arrive together and the actor is alive', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    const avatar = h.renderer.groupA.children[0];
    h.setRoster([actor(1, { deathSerial: 1, spawnSerial: 2, participating: true })]);
    h.frame();
    expect(avatar?.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    h.renderer.dispose();
  });

  it('ends a frame dead when both edges arrive together and the actor is dead', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    const avatar = h.renderer.groupA.children[0];
    h.setRoster([actor(1, { deathSerial: 1, spawnSerial: 2, participating: false })]);
    for (let i = 0; i < 30; i++) h.frame();
    expect(avatar?.quaternion.toArray()).not.toEqual([0, 0, 0, 1]);
    h.renderer.dispose();
  });

  it('starts a body that arrives already dead in its fall', () => {
    const h = harness();
    h.setRoster([actor(1, { participating: false, deathVariant: 3 })]);
    for (let i = 0; i < 40; i++) h.frame();
    const avatar = h.renderer.groupA.children[0];
    expect(avatar?.quaternion.toArray()).not.toEqual([0, 0, 0, 1]);
    h.renderer.dispose();
  });
});

describe('BotRenderer held weapon', () => {
  it('leaves the hands empty for a null weapon id', () => {
    const h = harness();
    h.setRoster([actor(1, { weaponId: null })]);
    h.frame();
    expect(h.renderer.groupA.children[0]?.children).toHaveLength(8);
    h.renderer.dispose();
  });

  it('builds a weapon once and shares it between two bodies carrying it', () => {
    const h = harness();
    h.setRoster([actor(1, { weaponId: 'ar_carbine' }), actor(2, { team: 'B', weaponId: 'ar_carbine' })]);
    h.frame();
    const one = h.renderer.groupA.children[0]?.children;
    const two = h.renderer.groupB.children[0]?.children;
    const heldOne = one?.[one.length - 1] as THREE.Mesh | undefined;
    const heldTwo = two?.[two.length - 1] as THREE.Mesh | undefined;
    expect(heldOne?.geometry).toBe(heldTwo?.geometry);
    h.renderer.dispose();
  });

  it('swaps the mesh when a body changes weapon, and keeps the body', () => {
    const h = harness();
    h.setRoster([actor(1, { weaponId: 'ar_carbine' })]);
    h.frame();
    const body = h.renderer.groupA.children[0];
    const first = body?.children[body.children.length - 1];
    h.setRoster([actor(1, { weaponId: 'smg_wasp' })]);
    h.frame();
    expect(h.renderer.groupA.children[0]).toBe(body);
    expect(body?.children[body.children.length - 1]).not.toBe(first);
    h.renderer.dispose();
  });

  it('does not rebuild the weapon on a frame where nothing moved', () => {
    const h = harness();
    h.setRoster([actor(1, { weaponId: 'ar_carbine' })]);
    h.frame();
    const body = h.renderer.groupA.children[0];
    const held = body?.children[body.children.length - 1];
    for (let i = 0; i < 10; i++) h.frame();
    expect(body?.children[body.children.length - 1]).toBe(held);
    h.renderer.dispose();
  });

  it('takes the weapon out of the hand for a throw and gives it back', () => {
    const h = harness();
    h.setRoster([actor(1, { weaponId: 'ar_carbine', throwing: true })]);
    h.frame();
    const body = h.renderer.groupA.children[0];
    const held = body?.children[body.children.length - 1];
    expect(held?.visible).toBe(false);
    h.setRoster([actor(1, { weaponId: 'ar_carbine', throwing: false })]);
    h.frame();
    expect(held?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('never asks for a grenade when there is no asset service', () => {
    const h = harness(null);
    h.setRoster([actor(1, { weaponId: 'ar_carbine', throwing: true })]);
    expect(() => h.frame()).not.toThrow();
    h.renderer.dispose();
  });

  it('disposes its cached weapon geometry on dispose', () => {
    const h = harness();
    h.setRoster([actor(1, { weaponId: 'ar_carbine' })]);
    h.frame();
    const body = h.renderer.groupA.children[0];
    const held = body?.children[body.children.length - 1] as THREE.Mesh;
    let disposed = false;
    held.geometry.addEventListener('dispose', () => {
      disposed = true;
    });
    h.renderer.dispose();
    expect(disposed).toBe(true);
  });
});

describe('BotRenderer spectator clearance', () => {
  it('hides nothing while the player is not spectating, however close a body is', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 0, y: 0, z: 0 })]);
    h.frame();
    expect(h.renderer.groupA.children[0]?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('hides the body the camera is inside', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 40, y: 0, z: 40 })]);
    h.renderer.setEyesOf(1);
    h.frame();
    expect(h.renderer.groupA.children[0]?.visible).toBe(false);
    expect(h.indicatorLayer().children[0]?.visible).toBe(false);
    h.renderer.dispose();
  });

  it('hides another body within the clearance of the spectator eye', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 20, z: 20 }), actor(2, { team: 'B', x: 0.3, y: 0, z: 0.2 })]);
    h.renderer.setEyesOf(1);
    h.frame();
    expect(h.renderer.groupB.children[0]?.visible).toBe(false);
    h.renderer.dispose();
  });

  it('leaves a body beyond the clearance alone', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 20, z: 20 }), actor(2, { team: 'B', x: 3, y: 0, z: 3 })]);
    h.renderer.setEyesOf(1);
    h.frame();
    expect(h.renderer.groupB.children[0]?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('leaves a body on another floor alone, even in the same column of air', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 20, z: 20 }), actor(2, { team: 'B', x: 0, y: 8, z: 0 })]);
    h.renderer.setEyesOf(1);
    h.frame();
    expect(h.renderer.groupB.children[0]?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('sits the distance rule out on a pass that hands no camera', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 20, z: 20 }), actor(2, { team: 'B', x: 0.1, y: 0, z: 0.1 })]);
    h.renderer.setEyesOf(1);
    h.renderer.update(0.5, DT);
    expect(h.renderer.groupB.children[0]?.visible).toBe(true);
    // The body the camera is inside is still hidden: that rule needs no camera.
    expect(h.renderer.groupA.children[0]?.visible).toBe(false);
    h.renderer.dispose();
  });

  it('shows a body again the frame it leaves the camera lap', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 20, z: 20 }), actor(2, { team: 'B', x: 0.2, y: 0, z: 0.2 })]);
    h.renderer.setEyesOf(1);
    h.frame();
    expect(h.renderer.groupB.children[0]?.visible).toBe(false);
    h.setRoster([actor(1, { x: 20, z: 20 }), actor(2, { team: 'B', x: 9, y: 0, z: 9 })]);
    h.frame();
    expect(h.renderer.groupB.children[0]?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('stops hiding anything once spectating ends', () => {
    const h = harness();
    h.setRoster([actor(1, { x: 0, y: 0, z: 0 })]);
    h.renderer.setEyesOf(1);
    h.frame();
    expect(h.renderer.groupA.children[0]?.visible).toBe(false);
    h.renderer.setEyesOf(NO_SPECTATOR_TARGET);
    h.frame();
    expect(h.renderer.groupA.children[0]?.visible).toBe(true);
    h.renderer.dispose();
  });
});

describe('BotRenderer dormancy', () => {
  it('does not draw a dormant body or its nameplate', () => {
    const h = harness();
    h.setRoster([actor(1, { dormant: true })]);
    h.frame();
    expect(h.renderer.groupA.children[0]?.visible).toBe(false);
    expect(h.indicatorLayer().children[0]?.visible).toBe(false);
    h.renderer.dispose();
  });

  it('keeps the avatar, so a body coming back into view is not rebuilt', () => {
    const h = harness();
    h.setRoster([actor(1, { dormant: true })]);
    h.frame();
    const avatar = h.renderer.groupA.children[0];
    h.setRoster([actor(1, { dormant: false })]);
    h.frame();
    expect(h.renderer.groupA.children[0]).toBe(avatar);
    expect(avatar?.visible).toBe(true);
    h.renderer.dispose();
  });

  it('draws a body whose dormant flag is absent', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    expect(h.renderer.groupA.children[0]?.visible).toBe(true);
    h.renderer.dispose();
  });
});

describe('BotRenderer GLB avatars', () => {
  function skin(): ActorAvatar {
    const group = new THREE.Group();
    group.name = 'skin';
    let dying = false;
    return {
      group,
      get isDying(): boolean {
        return dying;
      },
      setWeapon: (): undefined => undefined,
      setThrow: (): undefined => undefined,
      setVisible: (on: boolean): undefined => {
        group.visible = on;
        return undefined;
      },
      setLife: (): undefined => undefined,
      getIndicatorAnchor: (): boolean => false,
      getIndicatorFrame: (): boolean => false,
      beginDeath: (): undefined => {
        dying = true;
        return undefined;
      },
      endDeath: (): undefined => {
        dying = false;
        return undefined;
      },
      flinch: (): undefined => undefined,
      update: (): undefined => undefined,
      dispose: (): undefined => undefined,
    };
  }

  it('falls back to a BotMesh while no GLB is usable', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    // A procedural body is the one carrying the rig's own landmark nodes.
    expect(h.renderer.groupA.children[0]?.children.map((c) => c.name)).toContain('indicator-anchor:head');
    h.renderer.dispose();
  });

  it('creates at most two GLB avatars in one frame', () => {
    const h = harness();
    h.setReady(true);
    h.setCreated(() => skin());
    h.setRoster([actor(1), actor(2), actor(3), actor(4), actor(5)]);
    h.frame();
    expect(h.bodies().filter((b) => b.name === 'skin')).toHaveLength(2);
    h.frame();
    expect(h.bodies().filter((b) => b.name === 'skin')).toHaveLength(4);
    h.frame();
    expect(h.bodies().filter((b) => b.name === 'skin')).toHaveLength(5);
    h.renderer.dispose();
  });

  it('swaps a fallback for a GLB once the provider is ready, and unparents the fallback', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    const fallback = h.renderer.groupA.children[0];
    h.setReady(true);
    h.setCreated(() => skin());
    h.frame();
    expect(h.renderer.groupA.children[0]?.name).toBe('skin');
    expect(fallback?.parent).toBeNull();
    h.renderer.dispose();
  });

  it('keeps the fallback when a ready provider still cannot build one', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    const fallback = h.renderer.groupA.children[0];
    h.setReady(true);
    h.frame();
    expect(h.renderer.groupA.children[0]).toBe(fallback);
    h.renderer.dispose();
  });

  it('puts a GLB body that arrives dead into its fall, exactly once', () => {
    const h = harness();
    h.setReady(true);
    let began = 0;
    h.setCreated(() => {
      const made = skin();
      const original = made.beginDeath.bind(made);
      return {
        ...made,
        get isDying(): boolean {
          return made.isDying;
        },
        beginDeath(dx: number, dz: number, variant: number, animation: ActorAnimationInput): void {
          began++;
          original(dx, dz, variant, animation);
        },
      };
    });
    h.setRoster([actor(1, { participating: false })]);
    h.frame();
    // Created dead, so `avatarFor` starts the fall; `applyEvents` then sees a body that is
    // already dying and leaves it alone.
    expect(began).toBe(1);
    h.renderer.dispose();
  });

  it('keeps one provider per actor for its whole rendered life', () => {
    const h = harness();
    h.setRoster([actor(1)]);
    h.frame();
    h.frame();
    h.frame();
    expect(h.providers).toHaveLength(1);
    h.renderer.dispose();
  });
});

describe('BotRenderer retirement', () => {
  it('removes the body of an actor that has left, and disposes its provider', () => {
    const h = harness();
    h.setRoster([actor(1), actor(2)]);
    h.frame();
    expect(h.bodies()).toHaveLength(2);
    h.setRoster([actor(1)]);
    h.frame();
    expect(h.bodies()).toHaveLength(1);
    expect(h.providers.filter((p) => p.disposed)).toHaveLength(1);
    h.renderer.dispose();
  });

  it('forgets the retired actor, so it comes back as a new body', () => {
    const h = harness();
    h.setRoster([actor(2)]);
    h.frame();
    const first = h.renderer.groupA.children[0];
    h.setRoster([]);
    h.frame();
    h.setRoster([actor(2)]);
    h.frame();
    expect(h.renderer.groupA.children[0]).not.toBe(first);
    h.renderer.dispose();
  });

  it('retires an absent actor even when one arrives in the same frame', () => {
    const h = harness();
    h.setRoster([actor(1), actor(2)]);
    h.frame();
    // The newcomer is added to `avatars` inside the loop, so the two counts still disagree
    // at the end of it and the retirement walk runs. A swap is never missed.
    h.setRoster([actor(1), actor(3)]);
    h.frame();
    expect(h.bodies()).toHaveLength(2);
    expect(h.indicatorLayer().children.filter((c) => c.children.length > 0).map((c) => c.name)).toEqual([
      'actor-indicator:1',
      'actor-indicator:3',
    ]);
    h.renderer.dispose();
  });

  it('skips the retirement walk on a frame where the roster did not change', () => {
    const h = harness();
    h.setRoster([actor(1), actor(2)]);
    h.frame();
    const bodies = h.bodies();
    for (let i = 0; i < 20; i++) h.frame();
    expect(h.bodies()).toEqual(bodies);
    expect(h.providers.filter((p) => p.disposed)).toHaveLength(0);
    h.renderer.dispose();
  });

  it('empties a retired indicator but leaves its group parented', () => {
    // Pins current behaviour; suspected bug: BotRenderer leaves an empty indicator group in
    // the scene for every actor that has left. See BACKLOG #66.
    const h = harness();
    h.setRoster([actor(1), actor(2)]);
    h.frame();
    expect(h.indicatorLayer().children).toHaveLength(2);
    h.setRoster([actor(1)]);
    h.frame();
    expect(h.indicatorLayer().children).toHaveLength(2);
    expect(h.indicatorLayer().children.filter((c) => c.children.length === 0)).toHaveLength(1);
    h.renderer.dispose();
  });

  it('accumulates one empty indicator group per roster turnover', () => {
    // Pins current behaviour; suspected bug: see BACKLOG #66.
    const h = harness();
    for (let wave = 0; wave < 5; wave++) {
      h.setRoster([actor(700 + wave), actor(800 + wave, { team: 'B' })]);
      h.frame();
      h.frame();
      expect(h.bodies()).toHaveLength(2);
      expect(h.indicatorLayer().children).toHaveLength((wave + 1) * 2);
      expect(h.indicatorLayer().children.filter((c) => c.children.length > 0)).toHaveLength(2);
    }
    h.renderer.dispose();
  });
});

describe('BotRenderer dispose', () => {
  it('empties everything it owns and unparents its own group', () => {
    const parent = new THREE.Group();
    const h = harness();
    parent.add(h.renderer.group);
    h.setRoster([actor(1), actor(2, { team: 'B' })]);
    h.frame();
    h.renderer.dispose();
    expect(h.renderer.group.children).toHaveLength(0);
    expect(h.renderer.group.parent).toBeNull();
    expect(h.bodies()).toHaveLength(0);
    expect(parent.children).toHaveLength(0);
  });

  it('disposes every provider it handed out', () => {
    const h = harness();
    h.setRoster([actor(1), actor(2), actor(3)]);
    h.frame();
    h.renderer.dispose();
    expect(h.providers.filter((p) => p.disposed)).toHaveLength(3);
  });
});
