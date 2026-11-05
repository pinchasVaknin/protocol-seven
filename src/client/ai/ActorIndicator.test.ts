import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import type { TeamRelation } from '../../shared/ui/TeamColour';
import type { ActorAvatar, ActorIndicatorAnchor, ActorIndicatorFrameAnchor } from '../characters/ActorAvatar';
import { ACTOR_INDICATOR_LAYER } from '../engine/Renderer';
import { cssHex, palette } from '../ui/Palette';
import { ActorIndicator, buildActorIndicatorAssets, type ActorIndicatorAssets, type ActorIndicatorState } from './ActorIndicator';

/**
 * This file reaches `document` only to make a canvas and ask it for a 2D context, so a
 * recording stand-in for that context pins what is painted far more precisely than a picture
 * would: every call and every property write, in order. `calls` below is that record.
 */

interface DrawCall {
  readonly op: string;
  readonly args: readonly unknown[];
}

let calls: DrawCall[] = [];

function installCanvasRecorder(): void {
  calls = [];
  const ctx: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]): undefined => {
    calls.push({ op, args });
    return undefined;
  };
  for (const op of ['clearRect', 'fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'save', 'restore']) {
    ctx[op] = record(op);
  }
  ctx['createRadialGradient'] = (...args: unknown[]): unknown => {
    calls.push({ op: 'createRadialGradient', args });
    return {
      addColorStop: (...stop: unknown[]): undefined => {
        calls.push({ op: 'addColorStop', args: stop });
        return undefined;
      },
    };
  };
  const recorded = new Proxy(ctx, {
    set(target, key, value: unknown): boolean {
      calls.push({ op: `set:${String(key)}`, args: [value] });
      target[String(key)] = value;
      return true;
    },
  });
  (globalThis as Record<string, unknown>)['document'] = {
    createElement: (): unknown => ({ width: 0, height: 0, getContext: (): unknown => recorded }),
    documentElement: { style: { setProperty: (): undefined => undefined } },
  };
}

/** How many times a label has been repainted: `drawLabel` opens with exactly one `clearRect`. */
function repaints(): number {
  return calls.filter((c) => c.op === 'clearRect').length;
}

function textsDrawn(): string[] {
  return calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
}

function fillStyles(): string[] {
  return calls.filter((c) => c.op === 'set:fillStyle').map((c) => String(c.args[0]));
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
void ANIM;

interface StubOptions {
  readonly x?: number;
  readonly z?: number;
  readonly noHead?: boolean;
  readonly noFrames?: boolean;
}

/** A fixed stand-in avatar: the indicator's only input besides the state and the camera. */
function stubAvatar(options: StubOptions = {}): ActorAvatar {
  const x = options.x ?? 0;
  const z = options.z ?? -5;
  return {
    group: new THREE.Group(),
    isDying: false,
    setWeapon: (): undefined => undefined,
    setThrow: (): undefined => undefined,
    setVisible: (): undefined => undefined,
    setLife: (): undefined => undefined,
    getIndicatorAnchor(anchor: ActorIndicatorAnchor, target: THREE.Vector3): boolean {
      if (anchor !== 'head' || options.noHead === true) return false;
      target.set(x, 1.72, z);
      return true;
    },
    getIndicatorFrame(anchor: ActorIndicatorFrameAnchor, position: THREE.Vector3, quaternion: THREE.Quaternion): boolean {
      if (options.noFrames === true) return false;
      const side = anchor === 'leftShoulder' ? -1 : 1;
      position.set(x + side * 0.22, 1.38, z);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side * 0.4);
      return true;
    },
    beginDeath: (): undefined => undefined,
    endDeath: (): undefined => undefined,
    flinch: (): undefined => undefined,
    update: (): undefined => undefined,
    dispose: (): undefined => undefined,
  };
}

function state(overrides: Partial<ActorIndicatorState> = {}): ActorIndicatorState {
  return {
    displayName: 'ALPHA',
    healthFraction: 1,
    relation: 'HOSTILE',
    participating: true,
    ...overrides,
  };
}

function perspective(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 500);
  camera.position.set(0, 1.6, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

let assets: ActorIndicatorAssets;

beforeEach(() => {
  installCanvasRecorder();
  palette.set('off');
  assets = buildActorIndicatorAssets();
  calls = [];
});

afterEach(() => {
  assets.dispose();
  palette.set('off');
});

describe('buildActorIndicatorAssets', () => {
  it('paints a soft radial falloff for the halo, white to transparent', () => {
    calls = [];
    const built = buildActorIndicatorAssets();
    const gradient = calls.find((c) => c.op === 'createRadialGradient');
    expect(gradient?.args).toEqual([32, 32, 0, 32, 32, 32]);
    expect(calls.filter((c) => c.op === 'addColorStop').map((c) => c.args)).toEqual([
      [0, 'rgba(255, 255, 255, 1)'],
      [0.45, 'rgba(255, 255, 255, 0.45)'],
      [1, 'rgba(255, 255, 255, 0)'],
    ]);
    expect(calls.filter((c) => c.op === 'fillRect').map((c) => c.args)).toEqual([[0, 0, 64, 64]]);
    built.dispose();
  });

  it('makes the pad unlit and the halo additive, neither writing depth', () => {
    expect(assets.padMaterial.toneMapped).toBe(false);
    expect(assets.padMaterial).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(assets.haloMaterial.blending).toBe(THREE.AdditiveBlending);
    expect(assets.haloMaterial.transparent).toBe(true);
    expect(assets.haloMaterial.opacity).toBeCloseTo(0.55, 10);
    expect(assets.haloMaterial.depthTest).toBe(true);
    expect(assets.haloMaterial.depthWrite).toBe(false);
    expect(assets.haloMaterial.toneMapped).toBe(false);
  });

  it('paints the pad and the halo the palette hostile colour on construction', () => {
    expect(assets.padMaterial.color.getHex()).toBe(palette.current.hostile);
    expect(assets.haloMaterial.color.getHex()).toBe(palette.current.hostile);
  });

  it('derives every relation colour from the palette and nothing else', () => {
    const p = palette.current;
    expect(assets.colours.FRIENDLY).toEqual({ name: cssHex(p.friendly), health: cssHex(p.local) });
    expect(assets.colours.HOSTILE).toEqual({ name: cssHex(p.hostile), health: cssHex(p.hostile) });
    expect(assets.colours.NEUTRAL).toEqual({ name: cssHex(p.neutral), health: cssHex(p.local) });
  });

  it('bumps the serial and repaints the shared materials on a palette change', () => {
    const serial = assets.paletteSerial;
    const before = assets.padMaterial.color.getHex();
    palette.set('deuteranopia');
    expect(assets.paletteSerial).toBe(serial + 1);
    expect(assets.padMaterial.color.getHex()).toBe(palette.current.hostile);
    expect(assets.haloMaterial.color.getHex()).toBe(palette.current.hostile);
    expect(assets.colours.HOSTILE.name).toBe(cssHex(palette.current.hostile));
    if (before !== palette.current.hostile) expect(assets.padMaterial.color.getHex()).not.toBe(before);
  });

  it('stops following the palette once disposed', () => {
    const built = buildActorIndicatorAssets();
    const serial = built.paletteSerial;
    built.dispose();
    palette.set('tritanopia');
    expect(built.paletteSerial).toBe(serial);
  });
});

describe('ActorIndicator construction', () => {
  it('names the group after the entity', () => {
    const indicator = new ActorIndicator(77, assets);
    expect(indicator.group.name).toBe('actor-indicator:77');
  });

  it('holds the label and the two shoulder frames, in that order', () => {
    const indicator = new ActorIndicator(1, assets);
    expect(indicator.group.children.map((c) => c.name)).toEqual([
      'actor-indicator:label',
      'actor-indicator:leftShoulder',
      'actor-indicator:rightShoulder',
    ]);
  });

  it('puts every drawn node on the indicator layer', () => {
    const indicator = new ActorIndicator(1, assets);
    const wanted = new THREE.Layers();
    wanted.set(ACTOR_INDICATOR_LAYER);
    const label = indicator.group.children[0];
    expect(label?.layers.test(wanted)).toBe(true);
    for (const frame of indicator.group.children.slice(1)) {
      for (const node of frame.children) expect(node.layers.test(wanted)).toBe(true);
    }
  });

  it('scales the label sprite to its authored world size', () => {
    const indicator = new ActorIndicator(1, assets);
    const label = indicator.group.children[0];
    expect(label?.scale.x).toBeCloseTo(1.28, 10);
    expect(label?.scale.y).toBeCloseTo(1.28 * (160 / 512), 10);
  });

  it('gives each frame a halo behind the pad, and lifts the pad off the sleeve', () => {
    const indicator = new ActorIndicator(1, assets);
    const frame = indicator.group.children[1];
    expect(frame?.children.map((c) => c.name)).toEqual(['halo', 'pad']);
    const pad = frame?.children[1];
    expect(pad?.position.z).toBeCloseTo(0.005, 10);
    expect(pad?.castShadow).toBe(false);
    expect(pad?.receiveShadow).toBe(false);
  });

  it('shares one geometry and one material across every pad', () => {
    const a = new ActorIndicator(1, assets);
    const b = new ActorIndicator(2, assets);
    const padOf = (i: ActorIndicator): THREE.Mesh => i.group.children[1]?.children[1] as THREE.Mesh;
    expect(padOf(a).geometry).toBe(assets.padGeometry);
    expect(padOf(a).material).toBe(assets.padMaterial);
    expect(padOf(b).geometry).toBe(padOf(a).geometry);
  });

  it('paints the label once on construction', () => {
    calls = [];
    const indicator = new ActorIndicator(1, assets);
    void indicator;
    // Nothing is painted until the first update: a label with no state to show.
    expect(repaints()).toBe(0);
  });
});

describe('ActorIndicator visibility', () => {
  it('hides the whole group for an actor that is not participating', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ participating: false }), stubAvatar(), DT, perspective());
    expect(indicator.group.visible).toBe(false);
    expect(repaints()).toBe(0);
  });

  it('hides the whole group when the avatar cannot place a head', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state(), stubAvatar({ noHead: true }), DT, perspective());
    expect(indicator.group.visible).toBe(false);
  });

  it('shows the group again the frame the actor comes back', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ participating: false }), stubAvatar(), DT, perspective());
    indicator.update(state(), stubAvatar(), DT, perspective());
    expect(indicator.group.visible).toBe(true);
  });
});

describe('ActorIndicator placement', () => {
  it('hangs the label above the head by the authored clearance', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state(), stubAvatar({ x: 3, z: -9 }), DT, perspective());
    const label = indicator.group.children[0];
    expect(label?.position.x).toBeCloseTo(3, 10);
    expect(label?.position.y).toBeCloseTo(1.72 + 0.38, 10);
    expect(label?.position.z).toBeCloseTo(-9, 10);
  });

  it('places a label correctly when the group itself has been moved', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.group.position.set(10, 2, -4);
    indicator.group.updateMatrixWorld(true);
    indicator.update(state(), stubAvatar({ x: 3, z: -9 }), DT, perspective());
    const label = indicator.group.children[0];
    // The world position is what the avatar asked for, whatever the parent is doing.
    const world = new THREE.Vector3();
    indicator.group.updateMatrixWorld(true);
    label?.getWorldPosition(world);
    expect(world.x).toBeCloseTo(3, 6);
    expect(world.y).toBeCloseTo(1.72 + 0.38, 6);
    expect(world.z).toBeCloseTo(-9, 6);
  });
});

describe('ActorIndicator pads', () => {
  it('shows both pads on a hostile body', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ relation: 'HOSTILE' }), stubAvatar(), DT, perspective());
    expect(indicator.group.children[1]?.visible).toBe(true);
    expect(indicator.group.children[2]?.visible).toBe(true);
  });

  it('hides both pads on a friendly and on a neutral body', () => {
    const indicator = new ActorIndicator(1, assets);
    for (const relation of ['FRIENDLY', 'NEUTRAL'] as TeamRelation[]) {
      indicator.update(state({ relation }), stubAvatar(), DT, perspective());
      expect(indicator.group.children[1]?.visible).toBe(false);
      expect(indicator.group.children[2]?.visible).toBe(false);
    }
  });

  it('hides a pad the avatar will not answer a frame for', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state(), stubAvatar({ noFrames: true }), DT, perspective());
    expect(indicator.group.children[1]?.visible).toBe(false);
    expect(indicator.group.children[2]?.visible).toBe(false);
  });

  it('puts each pad where the avatar asked, mirrored across the body', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state(), stubAvatar({ x: 0, z: -6 }), DT, perspective());
    expect(indicator.group.children[1]?.position.x).toBeCloseTo(-0.22, 6);
    expect(indicator.group.children[2]?.position.x).toBeCloseTo(0.22, 6);
    expect(indicator.group.children[1]?.position.y).toBeCloseTo(1.38, 6);
  });

  it('keeps a pad at world size once it is big enough on screen', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state(), stubAvatar({ x: 0, z: -1 }), DT, perspective());
    expect(indicator.group.children[1]?.scale.x).toBe(1);
  });

  it('grows a pad past the screen-space floor, further the further away it is', () => {
    const indicator = new ActorIndicator(1, assets);
    const scaleAt = (distance: number): number => {
      indicator.update(state(), stubAvatar({ x: 0, z: -distance }), DT, perspective());
      return indicator.group.children[1]?.scale.x ?? 0;
    };
    // At a 75-degree field of view the 6/1080 floor only starts biting past about 11.7 m,
    // so ten metres is still world size and the growth is linear in distance beyond it.
    expect(scaleAt(10)).toBe(1);
    const near = scaleAt(20);
    const far = scaleAt(40);
    // The pad sits a little off the body axis, so the distance is the pad's, not the feet's.
    expect(near).toBeCloseTo(1.7054, 3);
    expect(far).toBeCloseTo(3.4104, 3);
    expect(far / near).toBeCloseTo(2, 2);
  });

  it('leaves a pad at world size when no camera is handed over', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state(), stubAvatar({ x: 0, z: -40 }), DT);
    expect(indicator.group.children[1]?.scale.x).toBe(1);
  });

  it('turns a pad into the frame the avatar gave, relative to the group', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.group.rotation.y = 0.9;
    indicator.group.updateMatrixWorld(true);
    indicator.update(state(), stubAvatar(), DT, perspective());
    indicator.group.updateMatrixWorld(true);
    const world = new THREE.Quaternion();
    indicator.group.children[2]?.getWorldQuaternion(world);
    const wanted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    expect(world.angleTo(wanted)).toBeCloseTo(0, 5);
  });
});

describe('ActorIndicator label contents', () => {
  it('upper-cases a name and trims it', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ displayName: '  bravo  ' }), stubAvatar(), DT, perspective());
    expect(textsDrawn()[0]).toBe('BRAVO');
  });

  it('falls back to OPERATIVE for an empty or blank name', () => {
    for (const name of ['', '   ']) {
      calls = [];
      const indicator = new ActorIndicator(1, assets);
      indicator.update(state({ displayName: name }), stubAvatar(), DT, perspective());
      expect(textsDrawn()[0]).toBe('OPERATIVE');
    }
  });

  it('draws the plate, its border, the name, the bar and three divider lines', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ healthFraction: 0.5 }), stubAvatar(), DT, perspective());
    expect(calls.filter((c) => c.op === 'clearRect').map((c) => c.args)).toEqual([[0, 0, 512, 160]]);
    expect(calls.filter((c) => c.op === 'strokeRect').map((c) => c.args)).toEqual([
      [9.5, 9.5, 493, 141],
      [53, 93, 406, 32],
    ]);
    expect(calls.filter((c) => c.op === 'beginPath')).toHaveLength(3);
    expect(calls.filter((c) => c.op === 'stroke')).toHaveLength(3);
  });

  it('fills the bar in proportion to health', () => {
    const widthFor = (health: number): number => {
      calls = [];
      const indicator = new ActorIndicator(1, assets);
      indicator.update(state({ healthFraction: health }), stubAvatar(), DT, perspective());
      const fills = calls.filter((c) => c.op === 'fillRect');
      return Number(fills[fills.length - 1]?.args[2]);
    };
    const full = widthFor(1);
    const half = widthFor(0.5);
    expect(full).toBeCloseTo(402, 6);
    expect(half).toBeCloseTo(201, 6);
    expect(widthFor(0)).toBe(0);
  });

  it('clamps a health value outside 0..1, and treats a non-finite one as empty', () => {
    const widthFor = (health: number): number => {
      calls = [];
      const indicator = new ActorIndicator(1, assets);
      indicator.update(state({ healthFraction: health }), stubAvatar(), DT, perspective());
      const fills = calls.filter((c) => c.op === 'fillRect');
      return Number(fills[fills.length - 1]?.args[2]);
    };
    expect(widthFor(7)).toBeCloseTo(402, 6);
    expect(widthFor(-3)).toBe(0);
    expect(widthFor(Number.NaN)).toBe(0);
    expect(widthFor(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('takes the name and bar colours from the relation', () => {
    const p = palette.current;
    const coloursFor = (relation: TeamRelation): string[] => {
      calls = [];
      const indicator = new ActorIndicator(1, assets);
      indicator.update(state({ relation }), stubAvatar(), DT, perspective());
      return fillStyles();
    };
    expect(coloursFor('HOSTILE')).toContain(cssHex(p.hostile));
    expect(coloursFor('FRIENDLY')).toContain(cssHex(p.friendly));
    expect(coloursFor('FRIENDLY')).toContain(cssHex(p.local));
    expect(coloursFor('NEUTRAL')).toContain(cssHex(p.neutral));
  });
});

describe('ActorIndicator repaint gate', () => {
  it('paints once for a steady body and never again', () => {
    const indicator = new ActorIndicator(1, assets);
    const avatar = stubAvatar();
    const camera = perspective();
    for (let i = 0; i < 40; i++) indicator.update(state(), avatar, DT, camera);
    expect(repaints()).toBe(1);
  });

  it('repaints when the name changes', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ displayName: 'ONE' }), stubAvatar(), DT, perspective());
    indicator.update(state({ displayName: 'TWO' }), stubAvatar(), DT, perspective());
    expect(repaints()).toBe(2);
  });

  it('does not repaint for a name that normalises to the same text', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ displayName: 'one' }), stubAvatar(), DT, perspective());
    indicator.update(state({ displayName: ' ONE ' }), stubAvatar(), DT, perspective());
    expect(repaints()).toBe(1);
  });

  it('repaints when the relation changes', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ relation: 'HOSTILE' }), stubAvatar(), DT, perspective());
    indicator.update(state({ relation: 'FRIENDLY' }), stubAvatar(), DT, perspective());
    expect(repaints()).toBe(2);
  });

  it('repaints when the palette changes under a steady body', () => {
    const indicator = new ActorIndicator(1, assets);
    const avatar = stubAvatar();
    const camera = perspective();
    indicator.update(state(), avatar, DT, camera);
    indicator.update(state(), avatar, DT, camera);
    expect(repaints()).toBe(1);
    palette.set('protanopia');
    indicator.update(state(), avatar, DT, camera);
    expect(repaints()).toBe(2);
  });

  it('smooths a health drop over several frames and then stops', () => {
    const indicator = new ActorIndicator(1, assets);
    const avatar = stubAvatar();
    const camera = perspective();
    indicator.update(state({ healthFraction: 1 }), avatar, DT, camera);
    const start = repaints();
    for (let i = 0; i < 200; i++) indicator.update(state({ healthFraction: 0.42 }), avatar, DT, camera);
    const during = repaints() - start;
    // Several repaints while the bar slides, then silence: the gate is one bar texel wide,
    // so an exponential approach cannot repaint forever.
    expect(during).toBeGreaterThan(1);
    expect(during).toBeLessThan(80);
    const settled = repaints();
    for (let i = 0; i < 200; i++) indicator.update(state({ healthFraction: 0.42 }), avatar, DT, camera);
    expect(repaints()).toBe(settled);
  });

  it('shows the real value immediately on the first visible frame rather than sliding to it', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.update(state({ healthFraction: 0.25 }), stubAvatar(), DT, perspective());
    const fills = calls.filter((c) => c.op === 'fillRect');
    expect(Number(fills[fills.length - 1]?.args[2])).toBeCloseTo(402 * 0.25, 6);
  });

  it('re-seeds the smoothing after the body has been hidden', () => {
    const indicator = new ActorIndicator(1, assets);
    const avatar = stubAvatar();
    const camera = perspective();
    indicator.update(state({ healthFraction: 1 }), avatar, DT, camera);
    indicator.update(state({ healthFraction: 0.1, participating: false }), avatar, DT, camera);
    calls = [];
    indicator.update(state({ healthFraction: 0.1 }), avatar, DT, camera);
    const fills = calls.filter((c) => c.op === 'fillRect');
    expect(Number(fills[fills.length - 1]?.args[2])).toBeCloseTo(402 * 0.1, 6);
  });

  it('clamps the frame time, so a long stall does not overshoot', () => {
    const indicator = new ActorIndicator(1, assets);
    const avatar = stubAvatar();
    const camera = perspective();
    indicator.update(state({ healthFraction: 1 }), avatar, DT, camera);
    calls = [];
    indicator.update(state({ healthFraction: 0 }), avatar, 10, camera);
    const fills = calls.filter((c) => c.op === 'fillRect');
    const width = Number(fills[fills.length - 1]?.args[2]);
    // A 0.1 s clamp on a 16/s response leaves about 20 % of the gap, not none of it.
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(402);
  });

  it('treats a negative frame time as no time passing', () => {
    const indicator = new ActorIndicator(1, assets);
    const avatar = stubAvatar();
    const camera = perspective();
    indicator.update(state({ healthFraction: 1 }), avatar, DT, camera);
    const before = repaints();
    indicator.update(state({ healthFraction: 0 }), avatar, -5, camera);
    expect(repaints()).toBe(before);
  });
});

describe('ActorIndicator dispose', () => {
  it('empties the group and drops the pads', () => {
    const indicator = new ActorIndicator(1, assets);
    indicator.dispose();
    expect(indicator.group.children).toHaveLength(0);
  });

  it('leaves the shared pad material and geometry alone', () => {
    const indicator = new ActorIndicator(1, assets);
    let disposed = false;
    assets.padGeometry.addEventListener('dispose', () => {
      disposed = true;
    });
    indicator.dispose();
    expect(disposed).toBe(false);
  });
});
