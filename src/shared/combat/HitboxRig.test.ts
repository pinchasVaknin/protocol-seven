import { describe, expect, it } from 'vitest';
import { simCos, simSin } from '../core/SimMath';
import { LOCOMOTION_IDLE_SPEED, LOCOMOTION_RUN_SPEED } from '../player/Stance';
import {
  buildLayout,
  HIT_ZONES,
  HitboxRig,
  HUMANOID_LAYOUTS,
  HUMANOID_RIG,
  makeRigHit,
  rigLayoutFor,
  type HitboxDef,
  type RigHit,
  type RigLayout,
} from './HitboxRig';

/**
 * The rig, pinned: the boxes, the choice of boxes, and the ray that tests them.
 *
 * Three things are being held still here, and they fail in three different ways.
 *
 * The **box tables** are measured joints run through `segmentBox`/`jointsBox` and rounded to
 * three decimals, so they are a function of arithmetic rather than of a literal — a digest per
 * layout is what notices if any of that drifts by a millimetre.
 *
 * **`rigLayoutFor`** is the rule that decides which of the six a body wears, and the defect it
 * exists to prevent is a round passing over a head that is drawn outside its own box. Every
 * branch and both speed thresholds are covered, including the equality at each one.
 *
 * **`raycast`** is the path every bullet in the game takes. The distances asserted below are at
 * yaw 0, where the arithmetic is the box table's own decimals; the rotated cases assert which
 * box was hit rather than how far away it was, because the transform goes through `simSin` and
 * `simCos` and the number is theirs rather than the rig's.
 */

/** One box as one line: enough to notice a millimetre, short enough to read. */
function digest(layout: RigLayout): string {
  return layout.boxes
    .map(
      (b) =>
        b.name +
        ' ' +
        b.zone +
        (b.upper === true ? ' upper' : '') +
        ' o ' +
        [b.ox, b.oy, b.oz].join(',') +
        ' s ' +
        [b.sx, b.sy, b.sz].join(','),
    )
    .join('\n');
}

/** A rig at the world origin, facing yaw 0 — which looks down -Z everywhere in this project. */
function rig(yaw = 0, layout: RigLayout = HUMANOID_RIG): HitboxRig {
  const r = new HitboxRig(layout);
  r.setTransform(0, 0, 0, yaw);
  return r;
}

/** One shot at a rig, from `(x, y, z)` along `(dx, dy, dz)`. Returns the hit, or null. */
function shoot(
  r: HitboxRig,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  maxT = 100,
): RigHit | null {
  const out = makeRigHit();
  return r.raycast(x, y, z, dx, dy, dz, maxT, out) ? out : null;
}

/** The crown of a layout: the top of its head box, which is what C1 measured. */
function crownOf(id: string): number {
  const layout = HUMANOID_LAYOUTS.find((l) => l.id === id);
  const head = layout?.boxes.find((b) => b.name === 'head');
  return (head?.oy ?? 0) + (head?.sy ?? 0) * 0.5;
}

describe('the zones', () => {
  it('are the four the damage table prices', () => {
    expect(HIT_ZONES).toEqual(['head', 'torso', 'arm', 'leg']);
  });
});

describe('a fresh hit record', () => {
  it('names no box and no surface', () => {
    expect(makeRigHit()).toEqual({
      t: 0,
      zone: 'torso',
      boxIndex: -1,
      upper: false,
      nx: 0,
      ny: 0,
      nz: 0,
    });
  });
});

describe('the standing layout', () => {
  it('is the 1.8 m humanoid M2 verified its multipliers against', () => {
    expect(digest(HUMANOID_RIG)).toMatchInlineSnapshot(`
      "head head o 0,1.645,0 s 0.22,0.25,0.23
      neck head o 0,1.5,0 s 0.13,0.1,0.13
      chest torso upper o 0,1.26,0 s 0.46,0.4,0.27
      abdomen torso o 0,0.94,0 s 0.4,0.28,0.24
      armL arm o -0.31,1.16,0 s 0.14,0.62,0.16
      armR arm o 0.31,1.16,0 s 0.14,0.62,0.16
      legL leg o -0.11,0.42,0 s 0.18,0.84,0.2
      legR leg o 0.11,0.42,0 s 0.18,0.84,0.2"
    `);
  });

  it('aims at the centre of the chest, so aiming and hitting agree', () => {
    const chest = HUMANOID_RIG.boxes.find((b) => b.upper === true);
    expect(chest?.name).toBe('chest');
    expect(HUMANOID_RIG.aimY).toBe(chest?.oy);
    expect(HUMANOID_RIG.aimY).toBe(1.26);
  });

  it('is as tall as its highest box and bounded by a sphere around all of them', () => {
    const head = HUMANOID_RIG.boxes[0];
    expect(head?.name).toBe('head');
    expect(HUMANOID_RIG.height).toBe((head?.oy ?? 0) + (head?.sy ?? 0) * 0.5);
    expect(HUMANOID_RIG.boundY).toBe(HUMANOID_RIG.height * 0.5);
    expect(HUMANOID_RIG.boundRadius).toMatchInlineSnapshot(`0.9623610634484806`);
  });
});

describe('the low layouts', () => {
  it('are the five drawn poses, in the order anything enumerating them sees', () => {
    expect(HUMANOID_LAYOUTS.map((l) => l.id)).toEqual([
      'humanoid',
      'humanoid-crouch',
      'humanoid-crouch-pistol',
      'humanoid-crouch-walk',
      'humanoid-crouch-run',
      'humanoid-slide',
    ]);
  });

  it('put the crown where the clip puts it, which is the whole reason they exist', () => {
    // C1's measured crowns, plus the head pad: the kneel at 1.11, the crouch walk at 1.26,
    // the crouch run at 1.38, the pistol half-squat at 1.23 and the slide at 0.50.
    expect(crownOf('humanoid-crouch')).toMatchInlineSnapshot(`1.12`);
    expect(crownOf('humanoid-crouch-pistol')).toMatchInlineSnapshot(`1.24`);
    expect(crownOf('humanoid-crouch-walk')).toMatchInlineSnapshot(`1.27`);
    expect(crownOf('humanoid-crouch-run')).toMatchInlineSnapshot(`1.3900000000000001`);
    expect(crownOf('humanoid-slide')).toMatchInlineSnapshot(`0.58`);
  });

  it('are built from the joints by segmentBox, to the millimetre', () => {
    expect(digest(HUMANOID_LAYOUTS[1] as RigLayout)).toMatchInlineSnapshot(`
      "head head o 0.105,1.02,-0.195 s 0.31,0.2,0.29
      neck head o 0.045,0.915,-0.095 s 0.16,0.07,0.16
      chest torso upper o 0,0.765,-0.02 s 0.52,0.37,0.34
      abdomen torso o -0.015,0.52,0.01 s 0.43,0.27,0.28
      upperArmL arm o -0.145,0.76,-0.195 s 0.17,0.28,0.31
      foreArmL arm o -0.04,0.705,-0.345 s 0.32,0.17,0.31
      upperArmR arm o 0.245,0.745,0.06 s 0.27,0.29,0.18
      foreArmR arm o 0.26,0.68,-0.035 s 0.24,0.16,0.37
      thighL leg o -0.09,0.39,-0.295 s 0.2,0.16,0.59
      shinL leg o -0.11,0.265,-0.405 s 0.24,0.41,0.37
      thighR leg o 0.195,0.165,0.075 s 0.37,0.45,0.21
      shinR leg o 0.225,0.085,0.22 s 0.31,0.29,0.48"
    `);
    expect(digest(HUMANOID_LAYOUTS[2] as RigLayout)).toMatchInlineSnapshot(`
      "head head o 0.015,1.13,-0.05 s 0.25,0.22,0.22
      neck head o 0,1.015,0 s 0.13,0.07,0.13
      chest torso upper o 0.01,0.865,-0.005 s 0.48,0.37,0.27
      abdomen torso o 0.01,0.605,-0.015 s 0.42,0.3,0.25
      upperArmL arm o -0.175,0.86,-0.16 s 0.17,0.2,0.4
      foreArmL arm o -0.12,0.89,-0.355 s 0.28,0.26,0.31
      upperArmR arm o 0.16,0.96,-0.035 s 0.14,0.1,0.43
      foreArmR arm o 0.1,0.985,-0.285 s 0.26,0.15,0.39
      thighL leg o -0.06,0.465,-0.23 s 0.24,0.11,0.6
      shinL leg o -0.08,0.295,-0.38 s 0.28,0.45,0.3
      thighR leg o 0.11,0.245,-0.02 s 0.22,0.49,0.28
      shinR leg o 0.135,0.12,0.12 s 0.19,0.24,0.56"
    `);
    expect(digest(HUMANOID_LAYOUTS[3] as RigLayout)).toMatchInlineSnapshot(`
      "head head o 0.165,1.175,-0.385 s 0.29,0.19,0.31
      neck head o 0.115,1.08,-0.275 s 0.16,0.06,0.16
      chest torso upper o 0.055,0.97,-0.15 s 0.55,0.3,0.44
      abdomen torso o 0.005,0.76,-0.03 s 0.41,0.27,0.28
      upperArmL arm o -0.085,0.93,-0.365 s 0.15,0.28,0.29
      foreArmL arm o 0.005,0.845,-0.51 s 0.31,0.11,0.32
      upperArmR arm o 0.285,0.925,-0.095 s 0.21,0.31,0.19
      foreArmR arm o 0.29,0.825,-0.195 s 0.2,0.11,0.39
      thighL leg o -0.095,0.48,-0.185 s 0.23,0.32,0.47
      shinL leg o -0.08,0.265,-0.23 s 0.2,0.31,0.38
      thighR leg o 0.15,0.475,-0.07 s 0.26,0.33,0.46
      shinR leg o 0.165,0.255,-0.11 s 0.23,0.31,0.38"
    `);
    expect(digest(HUMANOID_LAYOUTS[4] as RigLayout)).toMatchInlineSnapshot(`
      "head head o 0.1,1.3,-0.47 s 0.26,0.18,0.32
      neck head o 0.075,1.21,-0.35 s 0.14,0.06,0.17
      chest torso upper o 0.05,1.11,-0.2 s 0.5,0.28,0.48
      abdomen torso o 0.015,0.92,-0.045 s 0.43,0.25,0.31
      upperArmL arm o -0.065,1.085,-0.495 s 0.17,0.19,0.37
      foreArmL arm o 0.015,1.04,-0.705 s 0.27,0.1,0.37
      upperArmR arm o 0.3,1.06,-0.275 s 0.22,0.3,0.21
      foreArmR arm o 0.275,0.975,-0.4 s 0.27,0.13,0.36
      thighL leg o -0.12,0.6,-0.13 s 0.2,0.42,0.4
      shinL leg o -0.1,0.315,-0.12 s 0.2,0.35,0.42
      thighR leg o 0.13,0.59,-0.02 s 0.2,0.44,0.34
      shinR leg o 0.13,0.295,0.015 s 0.2,0.35,0.41"
    `);
  });

  it('box a body lying down by jointsBox instead, which pads every axis', () => {
    expect(digest(HUMANOID_LAYOUTS[5] as RigLayout)).toMatchInlineSnapshot(`
      "head head o 0.575,0.485,0.02 s 0.35,0.19,0.32
      neck head o 0.455,0.485,0.11 s 0.15,0.13,0.12
      chest torso upper o 0.29,0.465,0.135 s 0.44,0.27,0.49
      abdomen torso o 0.045,0.28,-0.01 s 0.37,0.42,0.38
      upperArmL arm o 0.195,0.525,-0.06 s 0.35,0.13,0.18
      foreArmL arm o -0.04,0.525,-0.105 s 0.36,0.13,0.15
      upperArmR arm o 0.335,0.405,0.41 s 0.19,0.19,0.34
      foreArmR arm o 0.315,0.27,0.565 s 0.15,0.32,0.21
      thighL leg o -0.025,0.28,-0.305 s 0.23,0.28,0.53
      shinL leg o -0.02,0.17,-0.66 s 0.2,0.24,0.48
      thighR leg o 0.115,0.09,-0.06 s 0.45,0.28,0.4
      shinR leg o 0.085,0.035,-0.195 s 0.49,0.15,0.17"
    `);
  });

  it('carry every other layout zone set and its one upper chest', () => {
    for (const layout of HUMANOID_LAYOUTS) {
      expect(layout.boxes.filter((b) => b.upper === true).map((b) => b.name)).toEqual(['chest']);
      for (const box of layout.boxes) expect(HIT_ZONES).toContain(box.zone);
    }
  });
});

describe('which layout a body wears', () => {
  it('is the standing one for every stance that is not low', () => {
    expect(rigLayoutFor('STAND', 0, 0, false).id).toBe('humanoid');
    expect(rigLayoutFor('STAND', 9, 9, true).id).toBe('humanoid');
    expect(rigLayoutFor('AIRBORNE', 0, 0, false).id).toBe('humanoid');
  });

  it('is the slide own layout, from its first tick to its last and in either hand', () => {
    expect(rigLayoutFor('SLIDE', 0, 0, false).id).toBe('humanoid-slide');
    expect(rigLayoutFor('SLIDE', 6, 6, true).id).toBe('humanoid-slide');
  });

  it('is the kneel for a still crouch, and the half-squat with a sidearm', () => {
    expect(rigLayoutFor('CROUCH', 0, 0, false).id).toBe('humanoid-crouch');
    expect(rigLayoutFor('CROUCH', 0, 0, true).id).toBe('humanoid-crouch-pistol');
  });

  it('counts a mantle as a low stance, like the animation selector does', () => {
    expect(rigLayoutFor('MANTLE', 0, 0, false).id).toBe('humanoid-crouch');
  });

  it('is the crouch walk above the idle dead zone, whatever is in the hands', () => {
    const justOver = LOCOMOTION_IDLE_SPEED + 0.01;
    expect(rigLayoutFor('CROUCH', justOver, 0, false).id).toBe('humanoid-crouch-walk');
    expect(rigLayoutFor('CROUCH', justOver, 0, true).id).toBe('humanoid-crouch-walk');
    expect(rigLayoutFor('CROUCH', 0, justOver, false).id).toBe('humanoid-crouch-walk');
  });

  it('stays in the idle layout exactly at the dead zone, which is a > and not a >=', () => {
    expect(rigLayoutFor('CROUCH', LOCOMOTION_IDLE_SPEED, 0, false).id).toBe('humanoid-crouch');
    expect(rigLayoutFor('CROUCH', LOCOMOTION_IDLE_SPEED, 0, true).id).toBe(
      'humanoid-crouch-pistol',
    );
  });

  it('is the crouch run at the run threshold, which is a >= and not a >', () => {
    expect(rigLayoutFor('CROUCH', LOCOMOTION_RUN_SPEED, 0, false).id).toBe('humanoid-crouch-run');
    expect(rigLayoutFor('CROUCH', LOCOMOTION_RUN_SPEED + 1, 0, true).id).toBe(
      'humanoid-crouch-run',
    );
  });

  it('reads the speed as a square, so the two axes together reach a threshold', () => {
    const half = LOCOMOTION_RUN_SPEED * Math.SQRT1_2;
    expect(rigLayoutFor('CROUCH', half, half, false).id).toBe('humanoid-crouch-run');
  });
});

describe('a layout built from boxes of some other shape', () => {
  it('aims at the first torso box when nothing is marked as the chest', () => {
    const boxes: HitboxDef[] = [
      { name: 'hull', zone: 'torso', ox: 0, oy: 0.5, oz: 0, sx: 0.4, sy: 0.4, sz: 0.4 },
      { name: 'cap', zone: 'head', ox: 0, oy: 0.9, oz: 0, sx: 0.2, sy: 0.2, sz: 0.2 },
    ];
    const layout = buildLayout('sentry', boxes);
    expect(layout.id).toBe('sentry');
    expect(layout.height).toBe(1);
    expect(layout.aimY).toBe(0.5);
    expect(layout.boundY).toBe(0.5);
  });

  it('aims at the middle of the silhouette when there is no torso at all', () => {
    const layout = buildLayout('board', [
      { name: 'plate', zone: 'head', ox: 0, oy: 1, oz: 0, sx: 1, sy: 2, sz: 0.1 },
    ]);
    expect(layout.height).toBe(2);
    expect(layout.aimY).toBe(1);
    expect(layout.boundY).toBe(1);
  });

  it('prefers the box flagged upper over the first torso box', () => {
    const layout = buildLayout('two-torsos', [
      { name: 'low', zone: 'torso', ox: 0, oy: 0.4, oz: 0, sx: 0.4, sy: 0.4, sz: 0.4 },
      { name: 'high', zone: 'torso', ox: 0, oy: 1.2, oz: 0, sx: 0.4, sy: 0.4, sz: 0.4, upper: true },
    ]);
    expect(layout.aimY).toBe(1.2);
  });
});

describe('a rig transform', () => {
  it('puts the bounding sphere and the silhouette where the feet are', () => {
    const r = new HitboxRig();
    expect(r.layout).toBe(HUMANOID_RIG);
    r.setTransform(3, 2, -1, 0);
    expect(r.x).toBe(3);
    expect(r.y).toBe(2);
    expect(r.z).toBe(-1);
    expect(r.boundCenterY).toBe(2 + HUMANOID_RIG.boundY);
    expect(r.standingHeight).toBe(HUMANOID_RIG.height);
  });

  it('follows the layout it is given', () => {
    const r = new HitboxRig();
    const slide = HUMANOID_LAYOUTS[5] as RigLayout;
    r.setLayout(slide);
    expect(r.layout).toBe(slide);
    expect(r.standingHeight).toBe(slide.height);
  });
});

describe('a round sent at a standing body', () => {
  it('finds the chest, and reports it as the upper torso', () => {
    const chest = HUMANOID_RIG.boxes[2];
    const hit = shoot(rig(), 0, 1.26, -5, 0, 0, 1);
    expect(hit?.zone).toBe('torso');
    expect(hit?.upper).toBe(true);
    expect(hit?.boxIndex).toBe(2);
    expect(hit?.t).toBe(5 - (chest?.sz ?? 0) * 0.5);
  });

  it('finds the head, which is not the upper torso', () => {
    const hit = shoot(rig(), 0, 1.645, -5, 0, 0, 1);
    expect(hit?.zone).toBe('head');
    expect(hit?.upper).toBe(false);
    expect(hit?.boxIndex).toBe(0);
  });

  it('finds the abdomen, which is the torso without the chest multiplier', () => {
    const hit = shoot(rig(), 0, 0.94, -5, 0, 0, 1);
    expect(hit?.zone).toBe('torso');
    expect(hit?.upper).toBe(false);
    expect(hit?.boxIndex).toBe(3);
  });

  it('finds an arm on the silhouette edge', () => {
    const hit = shoot(rig(), -0.31, 1.16, -5, 0, 0, 1);
    expect(hit?.zone).toBe('arm');
    expect(hit?.boxIndex).toBe(4);
  });

  it('finds a leg', () => {
    const hit = shoot(rig(), -0.11, 0.42, -5, 0, 0, 1);
    expect(hit?.zone).toBe('leg');
    expect(hit?.boxIndex).toBe(6);
  });

  it('reports the nearest box when the line crosses three of them', () => {
    // Across the shoulders: the near arm, the chest and the far arm all lie on this line.
    const armR = HUMANOID_RIG.boxes[5];
    const hit = shoot(rig(), 5, 1.16, 0, -1, 0, 0);
    expect(hit?.zone).toBe('arm');
    expect(hit?.boxIndex).toBe(5);
    expect(hit?.t).toBe(5 - ((armR?.ox ?? 0) + (armR?.sx ?? 0) * 0.5));
  });

  it('reports a surface normal facing back down the ray', () => {
    const hit = shoot(rig(), 0, 1.26, -5, 0, 0, 1);
    expect(hit?.nx).toBe(0);
    expect(hit?.ny).toBe(0);
    expect(hit?.nz).toBe(-1);
  });

  it('reports the face it entered through when the round comes from above', () => {
    const hit = shoot(rig(), 0, 5, 0, 0, -1, 0);
    expect(hit?.zone).toBe('head');
    expect(hit?.nx).toBe(0);
    expect(hit?.ny).toBe(1);
    expect(hit?.nz).toBe(0);
  });
});

describe('a round that finds nothing', () => {
  it('misses beside the silhouette', () => {
    expect(shoot(rig(), 1.5, 1.26, -5, 0, 0, 1)).toBe(null);
  });

  it('misses over the crown', () => {
    expect(shoot(rig(), 0, 2.4, -5, 0, 0, 1)).toBe(null);
  });

  it('misses when it is pointing away from the body', () => {
    expect(shoot(rig(), 0, 1.26, -5, 0, 0, -1)).toBe(null);
  });

  it('misses when the body is further away than the round travels', () => {
    expect(shoot(rig(), 0, 1.26, -5, 0, 0, 1, 2)).toBe(null);
    expect(shoot(rig(), 0, 1.26, -5, 0, 0, 1, 4.9)).not.toBe(null);
  });

  it('leaves the caller record alone, so a miss cannot be read as a hit', () => {
    const out = makeRigHit();
    out.t = 42;
    out.boxIndex = 3;
    expect(rig().raycast(1.5, 1.26, -5, 0, 0, 1, 100, out)).toBe(false);
    expect(out.t).toBe(42);
    expect(out.boxIndex).toBe(3);
  });

  it('misses a body whose boxes it passes between', () => {
    // Between the legs: inside the bounding sphere, outside every box.
    expect(shoot(rig(), 0, 0.2, -5, 0, 0, 1)).toBe(null);
  });
});

describe('a round that starts inside the body', () => {
  it('lands at zero distance, on a face pointing back at the shooter', () => {
    const hit = shoot(rig(), 0, 1.26, 0, 0, 0, 1);
    expect(hit?.t).toBe(0);
    expect(hit?.zone).toBe('torso');
    expect(hit?.boxIndex).toBe(2);
    // No slab narrowed the interval, so the axis is the x default and the sign is the
    // "started inside" +1.
    expect(hit?.nx).toBe(1);
    expect(hit?.ny).toBe(0);
    expect(hit?.nz).toBe(0);
  });
});

describe('a body that has turned', () => {
  it('turns its boxes with it', () => {
    const quarter = Math.PI * 0.5;
    const turned = rig(quarter);
    expect(simSin(quarter)).toBeGreaterThan(0.999);
    expect(Math.abs(simCos(quarter))).toBeLessThan(0.001);

    // The chest is 0.46 wide and 0.27 deep. At 0.2 m off centre a round along +Z finds it
    // when the body faces the shooter and misses once the body has turned side on.
    expect(shoot(rig(), 0.2, 1.26, -5, 0, 0, 1)?.zone).toBe('torso');
    expect(shoot(turned, 0.2, 1.26, -5, 0, 0, 1)).toBe(null);

    // And the round that now finds the same chest arrives along the other axis.
    const side = shoot(turned, -5, 1.26, 0, 1, 0, 0);
    expect(side?.zone).toBe('torso');
    expect(side?.boxIndex).toBe(2);
    expect(side?.t).toBeCloseTo(5 - 0.135, 9);
  });

  it('does not recompute its rotation when the yaw has not moved', () => {
    const r = rig(0.7);
    const first = shoot(r, 0, 1.26, -5, 0, 0, 1);
    r.setTransform(0, 0, 0, 0.7);
    const second = shoot(r, 0, 1.26, -5, 0, 0, 1);
    expect(second).toEqual(first);
  });
});

describe('a body somewhere other than the origin', () => {
  it('is hit relative to its own feet', () => {
    const r = new HitboxRig();
    r.setTransform(10, 3, -4, 0);
    expect(shoot(r, 10, 3 + 1.26, -9, 0, 0, 1)?.zone).toBe('torso');
    expect(shoot(r, 0, 1.26, -5, 0, 0, 1)).toBe(null);
  });
});

describe('the debug visualiser corners', () => {
  it('writes eight corners of three floats for every box', () => {
    const out = new Float32Array(HUMANOID_RIG.boxes.length * 24);
    expect(rig().writeWorldCorners(out)).toBe(HUMANOID_RIG.boxes.length * 24);
  });

  it('starts at the low corner of the first box', () => {
    const head = HUMANOID_RIG.boxes[0] as HitboxDef;
    const out = new Float32Array(24);
    rig().writeWorldCorners(out);
    expect(out[0]).toBeCloseTo(head.ox - head.sx * 0.5, 6);
    expect(out[1]).toBeCloseTo(head.oy - head.sy * 0.5, 6);
    expect(out[2]).toBeCloseTo(head.oz - head.sz * 0.5, 6);
  });

  it('stops on the last corner that fits rather than running over', () => {
    const out = new Float32Array(10);
    expect(rig().writeWorldCorners(out)).toBe(9);
  });

  it('offsets every corner by the rig position', () => {
    const atOrigin = new Float32Array(24);
    rig().writeWorldCorners(atOrigin);
    const moved = new Float32Array(24);
    const r = new HitboxRig();
    r.setTransform(2, 5, -3, 0);
    r.writeWorldCorners(moved);
    expect(moved[0]).toBeCloseTo((atOrigin[0] ?? 0) + 2, 5);
    expect(moved[1]).toBeCloseTo((atOrigin[1] ?? 0) + 5, 5);
    expect(moved[2]).toBeCloseTo((atOrigin[2] ?? 0) - 3, 5);
  });
});
