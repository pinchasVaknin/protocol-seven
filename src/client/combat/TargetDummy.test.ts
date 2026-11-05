import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DT } from '../../shared/core/Loop';
import { HUMANOID_RIG } from '../../shared/combat/HitboxRig';
import { DEFAULT_HEALTH_CONFIG } from '../../shared/player/Health';
import {
  buildDummyMaterials,
  TargetDummy,
  type DummyBehaviour,
  type DummyMaterials,
  type DummySpec,
} from './TargetDummy';

/**
 * The read-out is a `CanvasTexture`, so this file needs a canvas — but only a recording one.
 * What it paints is then pinned exactly, which is the part a screenshot cannot hold.
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
  for (const op of ['clearRect', 'fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke']) {
    ctx[op] = record(op);
  }
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

/** `drawLabel` opens with exactly one `clearRect`, so this counts repaints. */
function repaints(): number {
  return calls.filter((c) => c.op === 'clearRect').length;
}

function textsDrawn(): string[] {
  return calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
}

let materials: DummyMaterials & { dispose(): void };

function spec(overrides: Partial<DummySpec> = {}): DummySpec {
  return {
    id: 10001,
    name: 'TARGET',
    behaviour: 'static',
    x: 2,
    y: 0.5,
    z: -3,
    yaw: Math.PI / 2,
    ...overrides,
  };
}

function dummy(overrides: Partial<DummySpec> = {}): TargetDummy {
  return new TargetDummy(spec(overrides), DEFAULT_HEALTH_CONFIG, materials);
}

/** A hit as the range sees it: the damage system applies it, then the read-out is told. */
function hit(target: TargetDummy, amount: number, zone: 'head' | 'torso' | 'arm' | 'leg' = 'torso', distance = 12): void {
  target.health.applyDamage(amount);
  target.noteHit(amount, zone, distance);
}

function stepFor(target: TargetDummy, seconds: number): void {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) target.step();
}

beforeEach(() => {
  installCanvasRecorder();
  materials = buildDummyMaterials();
});

describe('buildDummyMaterials', () => {
  it('builds the two grey-box surfaces and disposes both', () => {
    const built = buildDummyMaterials();
    expect((built.body as THREE.MeshLambertMaterial).color.getHex()).toBe(0x59616e);
    expect((built.head as THREE.MeshLambertMaterial).color.getHex()).toBe(0x8a6a3c);
    let disposed = 0;
    built.body.addEventListener('dispose', () => disposed++);
    built.head.addEventListener('dispose', () => disposed++);
    built.dispose();
    expect(disposed).toBe(2);
  });
});

describe('TargetDummy construction', () => {
  it('takes its identity from the spec', () => {
    const target = dummy({ id: 4242, name: 'BULLSEYE' });
    expect(target.entityId).toBe(4242);
    expect(target.displayName).toBe('BULLSEYE');
    expect(target.group.name).toBe('dummy:BULLSEYE');
  });

  it('holds a body, a head and a read-out, in that order', () => {
    const target = dummy();
    expect(target.group.children).toHaveLength(3);
    expect(target.group.children[0]).toBeInstanceOf(THREE.Mesh);
    expect(target.group.children[2]?.position.y).toBeCloseTo(HUMANOID_RIG.height + 0.34, 10);
  });

  it('stands where the spec put it, facing the authored way', () => {
    const target = dummy({ x: 7, y: 1.5, z: -11, yaw: 1.2 });
    expect(target.group.position.toArray()).toEqual([7, 1.5, -11]);
    expect(target.group.rotation.y).toBeCloseTo(1.2, 10);
  });

  it('puts the rig where the mesh is', () => {
    const target = dummy({ x: 7, y: 1.5, z: -11, yaw: 1.2 });
    expect(target.rig.x).toBe(7);
    expect(target.rig.y).toBe(1.5);
    expect(target.rig.z).toBe(-11);
    expect(target.rig.yaw).toBeCloseTo(1.2, 10);
  });

  it('builds the body from the torso, arm and leg zones and the head from its own', () => {
    const target = dummy();
    const body = target.group.children[0] as THREE.Mesh;
    const head = target.group.children[1] as THREE.Mesh;
    const zones = HUMANOID_RIG.boxes.filter((b) => b.zone === 'torso' || b.zone === 'arm' || b.zone === 'leg');
    // Twelve vertices per box in an indexed merge of `BoxGeometry`.
    expect(body.geometry.getAttribute('position').count).toBe(zones.length * 24);
    expect(head.geometry.getAttribute('position').count).toBe(HUMANOID_RIG.boxes.filter((b) => b.zone === 'head').length * 24);
  });

  it('casts shadows from the body and the head', () => {
    const target = dummy();
    expect(target.group.children[0]?.castShadow).toBe(true);
    expect(target.group.children[1]?.castShadow).toBe(true);
  });

  it('starts at full health, alive and exposed', () => {
    const target = dummy();
    expect(target.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
    expect(target.health.alive).toBe(true);
    expect(target.exposed).toBe(true);
  });

  it('paints the read-out once on construction', () => {
    calls = [];
    const target = dummy();
    void target;
    expect(repaints()).toBe(1);
  });

  it('starts the read-out empty', () => {
    calls = [];
    const target = dummy({ name: 'BULLSEYE' });
    void target;
    expect(textsDrawn()).toContain('BULLSEYE');
    expect(textsDrawn()).toContain('NO HITS');
    expect(textsDrawn()).toContain('—');
  });
});

describe('TargetDummy classification', () => {
  it('reports its own behaviour', () => {
    for (const behaviour of ['static', 'popup', 'strafe', 'infinite', 'faller'] as DummyBehaviour[]) {
      expect(dummy({ behaviour }).behaviour).toBe(behaviour);
    }
  });

  it('calls only the infinite dummy infinite', () => {
    expect(dummy({ behaviour: 'infinite' }).isInfinite).toBe(true);
    for (const behaviour of ['static', 'popup', 'strafe', 'faller'] as DummyBehaviour[]) {
      expect(dummy({ behaviour }).isInfinite).toBe(false);
    }
  });

  it('allows holes only on the two that never move while alive', () => {
    // The surface BACKLOG #33 is about: a dead `static` dummy's mesh goes away and its
    // world-space decals do not. Pinned as it is today.
    expect(dummy({ behaviour: 'static' }).decals).toBe(true);
    expect(dummy({ behaviour: 'infinite' }).decals).toBe(true);
    expect(dummy({ behaviour: 'popup' }).decals).toBe(false);
    expect(dummy({ behaviour: 'strafe' }).decals).toBe(false);
    expect(dummy({ behaviour: 'faller' }).decals).toBe(false);
  });
});

describe('TargetDummy hits and the read-out', () => {
  it('accumulates total damage and remembers the last hit', () => {
    const target = dummy();
    hit(target, 30, 'torso', 12.5);
    hit(target, 45.5, 'head', 21);
    expect(target.totalDamage).toBeCloseTo(75.5, 10);
    expect(target.lastDamage).toBeCloseTo(45.5, 10);
    expect(target.lastZone).toBe('head');
    expect(target.lastDistance).toBeCloseTo(21, 10);
  });

  it('repaints the read-out on the next render after a hit', () => {
    const target = dummy();
    target.updateVisual(1, 0, 1.6, 0);
    calls = [];
    hit(target, 30);
    target.updateVisual(1, 0, 1.6, 0);
    expect(repaints()).toBe(1);
    target.updateVisual(1, 0, 1.6, 0);
    expect(repaints()).toBe(1);
  });

  it('prints the last damage, the zone and the range while alive', () => {
    const target = dummy();
    hit(target, 37.5, 'head', 21.5);
    calls = [];
    target.updateVisual(1, 0, 1.6, 0);
    expect(textsDrawn()).toContain('37.5');
    expect(textsDrawn()).toContain('HEAD');
    expect(textsDrawn()).toContain('21.5 m');
  });

  it('prints HP for an ordinary dummy and DPS for the infinite one', () => {
    const plain = dummy();
    hit(plain, 20);
    calls = [];
    plain.updateVisual(1, 0, 1.6, 0);
    expect(textsDrawn().some((t) => t.startsWith('HP '))).toBe(true);
    expect(textsDrawn().some((t) => t.startsWith('DPS '))).toBe(false);

    const dps = dummy({ behaviour: 'infinite' });
    hit(dps, 20);
    dps.step();
    calls = [];
    dps.updateVisual(1, 0, 1.6, 0);
    expect(textsDrawn().some((t) => t.startsWith('DPS '))).toBe(true);
  });

  it('prints DOWN and the total once the target is dead', () => {
    const target = dummy();
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    target.step();
    calls = [];
    target.updateVisual(1, 0, 1.6, 0);
    expect(textsDrawn()).toContain('DOWN');
    expect(textsDrawn().some((t) => t.startsWith('TOTAL '))).toBe(true);
  });

  it('marks the read-out dirty on demand', () => {
    const target = dummy();
    target.updateVisual(1, 0, 1.6, 0);
    calls = [];
    target.updateVisual(1, 0, 1.6, 0);
    expect(repaints()).toBe(0);
    target.markLabelDirty();
    target.updateVisual(1, 0, 1.6, 0);
    expect(repaints()).toBe(1);
  });

  it('does not repaint while regeneration moves health by less than a printed point', () => {
    const target = dummy();
    hit(target, 30);
    stepFor(target, 6);
    target.updateVisual(1, 0, 1.6, 0);
    calls = [];
    // Health is climbing, but only a whole printed HP counts as a change.
    let ticks = 0;
    while (ticks < 6) {
      target.step();
      ticks++;
    }
    target.updateVisual(1, 0, 1.6, 0);
    expect(repaints()).toBeLessThanOrEqual(1);
  });
});

describe('TargetDummy time to kill', () => {
  it('measures from the first round on a full target to the one that drops it', () => {
    const target = dummy();
    expect(target.lastTtkSeconds).toBe(-1);
    expect(target.lastShotsToKill).toBe(0);
    const perShot = DEFAULT_HEALTH_CONFIG.max / 4;
    hit(target, perShot);
    target.step();
    target.step();
    hit(target, perShot);
    target.step();
    hit(target, perShot);
    target.step();
    hit(target, perShot);
    expect(target.health.alive).toBe(false);
    expect(target.lastShotsToKill).toBe(4);
    expect(target.lastTtkSeconds).toBeCloseTo(4 * DT, 12);
  });

  it('counts sim ticks, so the figure cannot vary with frame rate', () => {
    const target = dummy();
    hit(target, 10);
    stepFor(target, 0.5);
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    expect(target.lastTtkSeconds).toBeCloseTo(Math.round(0.5 / DT) * DT, 12);
  });

  it('keeps the result across the respawn', () => {
    const target = dummy();
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    const ttk = target.lastTtkSeconds;
    const shots = target.lastShotsToKill;
    stepFor(target, 4);
    expect(target.health.alive).toBe(true);
    expect(target.lastTtkSeconds).toBe(ttk);
    expect(target.lastShotsToKill).toBe(shots);
  });

  it('stops the clock when a burst fails and health comes all the way back', () => {
    const target = dummy();
    hit(target, 40);
    stepFor(target, 30);
    expect(target.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
    expect(target.lastTtkSeconds).toBe(-1);
    // The next shot starts a fresh clock rather than inheriting a stale start.
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    expect(target.lastShotsToKill).toBe(1);
    expect(target.lastTtkSeconds).toBeCloseTo(0, 12);
  });

  it('does not restart the clock mid-burst', () => {
    const target = dummy();
    hit(target, 20);
    target.step();
    hit(target, 20);
    target.step();
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    expect(target.lastShotsToKill).toBe(3);
  });
});

describe('TargetDummy respawn', () => {
  it('stands back up two and a half seconds after it dies', () => {
    const target = dummy();
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    target.step();
    expect(target.health.alive).toBe(false);
    stepFor(target, 2.4);
    expect(target.health.alive).toBe(false);
    stepFor(target, 0.2);
    expect(target.health.alive).toBe(true);
    expect(target.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('clears the damage tally but not the measured result', () => {
    const target = dummy();
    hit(target, 50);
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    stepFor(target, 4);
    expect(target.totalDamage).toBe(0);
    expect(target.lastDamage).toBe(0);
    expect(target.lastTtkSeconds).toBeGreaterThanOrEqual(0);
  });

  it('resets on demand', () => {
    const target = dummy();
    hit(target, 60);
    target.reset();
    expect(target.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
    expect(target.totalDamage).toBe(0);
    expect(target.lastDamage).toBe(0);
  });
});

describe('TargetDummy behaviours', () => {
  it('keeps a static dummy exactly where it was put', () => {
    const target = dummy({ behaviour: 'static' });
    const start = target.group.position.toArray();
    stepFor(target, 10);
    target.updateVisual(1, 0, 1.6, 0);
    expect(target.group.position.toArray()).toEqual(start);
  });

  it('keeps an infinite dummy where it was put, and alive under fire', () => {
    const target = dummy({ behaviour: 'infinite' });
    const start = target.group.position.toArray();
    for (let i = 0; i < 200; i++) {
      hit(target, 500);
      target.step();
      expect(target.health.alive).toBe(true);
    }
    target.updateVisual(1, 0, 1.6, 0);
    expect(target.group.position.toArray()).toEqual(start);
    expect(target.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('measures sustained damage from the first round of the burst', () => {
    const target = dummy({ behaviour: 'infinite' });
    expect(target.dps).toBe(0);
    for (let i = 0; i < 60; i++) {
      hit(target, 30);
      target.step();
    }
    expect(target.dps).toBeGreaterThan(0);
  });

  it('restarts the DPS window after a second and a half of quiet', () => {
    const target = dummy({ behaviour: 'infinite' });
    for (let i = 0; i < 60; i++) {
      hit(target, 30);
      target.step();
    }
    expect(target.dps).toBeGreaterThan(0);
    stepFor(target, 1.6);
    expect(target.dps).toBe(0);
  });

  it('sinks a popup target out of sight and brings it back on its cycle', () => {
    const target = dummy({ behaviour: 'popup', upTime: 1, downTime: 1 });
    const heights: number[] = [];
    for (let i = 0; i < Math.round(2 / DT); i++) {
      target.step();
      target.updateVisual(1, 0, 1.6, 0);
      heights.push(target.group.position.y);
    }
    expect(Math.max(...heights)).toBeCloseTo(0.5, 6);
    expect(Math.min(...heights)).toBeCloseTo(0.5 - 2, 6);
  });

  it('calls a sunk popup target unexposed', () => {
    const target = dummy({ behaviour: 'popup', upTime: 0.2, downTime: 2 });
    stepFor(target, 1.2);
    expect(target.exposed).toBe(false);
    // Back round the cycle and far enough up its rise to clear the three-quarter mark.
    stepFor(target, 1.3);
    expect(target.exposed).toBe(true);
  });

  it('holds a downed popup target down rather than running its cycle', () => {
    const target = dummy({ behaviour: 'popup', upTime: 3, downTime: 2 });
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    for (let i = 0; i < 60; i++) {
      target.step();
      target.updateVisual(1, 0, 1.6, 0);
      expect(target.group.position.y).toBeCloseTo(0.5 - 2, 6);
      expect(target.exposed).toBe(false);
    }
  });

  it('walks a strafe target between its two limits and turns round', () => {
    const target = dummy({ behaviour: 'strafe', travel: 2, speed: 4, yaw: 0 });
    const offsets: number[] = [];
    for (let i = 0; i < Math.round(4 / DT); i++) {
      target.step();
      offsets.push(target.rig.x - 2);
    }
    expect(Math.max(...offsets)).toBeCloseTo(2, 6);
    expect(Math.min(...offsets)).toBeCloseTo(-2, 6);
  });

  it('runs a strafe path along the target own right vector', () => {
    const target = dummy({ behaviour: 'strafe', travel: 3, speed: 2, yaw: Math.PI / 2, x: 0, z: 0 });
    stepFor(target, 1);
    // yaw = PI/2 means cos is zero and sin is one: the path runs along -Z.
    expect(target.rig.x).toBeCloseTo(0, 6);
    expect(target.rig.z).toBeLessThan(0);
  });

  it('tips a faller flat when it dies and stands it back up', () => {
    const target = dummy({ behaviour: 'faller' });
    expect(target.group.rotation.x).toBe(0);
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    stepFor(target, 1);
    expect(target.group.rotation.x).toBeCloseTo(-Math.PI / 2, 2);
    stepFor(target, 3);
    expect(target.health.alive).toBe(true);
    expect(target.group.rotation.x).toBeCloseTo(0, 2);
  });

  it('sinks a faller a little as it goes over', () => {
    const target = dummy({ behaviour: 'faller', y: 1 });
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    stepFor(target, 1);
    target.updateVisual(1, 0, 1.6, 0);
    expect(target.group.position.y).toBeLessThan(1);
    expect(target.group.position.y).toBeGreaterThan(1 - 0.06);
  });
});

describe('TargetDummy render pass', () => {
  it('interpolates between the last two sim poses', () => {
    const target = dummy({ behaviour: 'strafe', travel: 9, speed: 6, yaw: 0, x: 0, z: 0 });
    target.step();
    const first = target.rig.x;
    target.step();
    const second = target.rig.x;
    target.updateVisual(0, 0, 1.6, 0);
    expect(target.group.position.x).toBeCloseTo(first, 10);
    target.updateVisual(1, 0, 1.6, 0);
    expect(target.group.position.x).toBeCloseTo(second, 10);
    target.updateVisual(0.5, 0, 1.6, 0);
    expect(target.group.position.x).toBeCloseTo((first + second) * 0.5, 10);
  });

  it('snaps rather than interpolating across a teleport', () => {
    const target = dummy();
    target.step();
    target.setPosition(-7.5, 1.5, 12.25);
    for (const alpha of [0, 0.5, 1]) {
      target.updateVisual(alpha, 0, 1.6, 0);
      expect(target.group.position.toArray()).toEqual([-7.5, 1.5, 12.25]);
    }
  });

  it('moves the rig with a teleport and clears the strafe offset', () => {
    const target = dummy({ behaviour: 'strafe', travel: 3, speed: 3, yaw: 0, x: 0, z: 0 });
    stepFor(target, 0.5);
    expect(target.rig.x).not.toBeCloseTo(0, 6);
    target.setPosition(10, 0, 10);
    expect(target.rig.x).toBe(10);
    expect(target.rig.z).toBe(10);
    target.step();
    // The walk restarts from the new base rather than carrying its old offset over.
    expect(target.rig.x).toBeCloseTo(10 + 3 * DT, 6);
  });

  it('hides the body and the head while the target is down, and brings them back', () => {
    const target = dummy();
    target.updateVisual(1, 0, 1.6, 0);
    expect(target.group.children[0]?.visible).toBe(true);
    hit(target, DEFAULT_HEALTH_CONFIG.max);
    target.step();
    target.updateVisual(1, 0, 1.6, 0);
    expect(target.group.children[0]?.visible).toBe(false);
    expect(target.group.children[1]?.visible).toBe(false);
    stepFor(target, 3);
    target.updateVisual(1, 0, 1.6, 0);
    expect(target.group.children[0]?.visible).toBe(true);
    expect(target.group.children[1]?.visible).toBe(true);
  });

  it('turns the read-out toward the camera, undoing the dummy own yaw', () => {
    const target = dummy({ x: 0, y: 0, z: 0, yaw: 0 });
    const label = target.group.children[2];
    target.updateVisual(1, 0, 1.6, 10);
    expect(label?.rotation.y).toBeCloseTo(0, 6);
    target.updateVisual(1, 10, 1.6, 0);
    expect(label?.rotation.y).toBeCloseTo(Math.PI / 2, 6);
    target.updateVisual(1, 0, 1.6, -10);
    expect(Math.abs(label?.rotation.y ?? 0)).toBeCloseTo(Math.PI, 6);
  });

  it('subtracts the dummy own yaw from the billboard', () => {
    const straight = dummy({ x: 0, y: 0, z: 0, yaw: 0 });
    const turned = dummy({ x: 0, y: 0, z: 0, yaw: 1.1 });
    straight.updateVisual(1, 5, 1.6, 5);
    turned.updateVisual(1, 5, 1.6, 5);
    expect((turned.group.children[2]?.rotation.y ?? 0) + 1.1).toBeCloseTo(straight.group.children[2]?.rotation.y ?? 0, 10);
  });

  it('tilts the read-out toward a camera above or below it', () => {
    const target = dummy({ x: 0, y: 0, z: 0, yaw: 0 });
    const label = target.group.children[2];
    target.updateVisual(1, 0, 20, 10);
    expect(label?.rotation.x).toBeGreaterThan(0);
    target.updateVisual(1, 0, -20, 10);
    expect(label?.rotation.x).toBeLessThan(0);
  });
});

describe('TargetDummy dispose', () => {
  it('empties the group and releases what it owns', () => {
    const target = dummy();
    const body = target.group.children[0] as THREE.Mesh;
    let disposed = 0;
    body.geometry.addEventListener('dispose', () => disposed++);
    target.dispose();
    expect(target.group.children).toHaveLength(0);
    expect(disposed).toBe(1);
  });

  it('leaves the shared materials alone', () => {
    const target = dummy();
    let disposed = false;
    materials.body.addEventListener('dispose', () => {
      disposed = true;
    });
    target.dispose();
    expect(disposed).toBe(false);
  });
});
