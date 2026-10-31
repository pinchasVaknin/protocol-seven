/**
 * Where every primitive goes, as a function of a `WeaponModelSpec`.
 *
 * Split out of `WeaponMesh.ts` under S3's size rule: that file is now the *assembly* — merge
 * by material, build the shared surfaces, hand back a `WeaponModel` — and this is the
 * layout. Twelve weapons' worth of proportions is content, and content and machinery had
 * grown into one 800-line file.
 *
 * Coordinates are metres in viewmodel space: +X right, +Y up, **-Z forward**, origin at the
 * centre of the receiver.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { WeaponModelSpec } from './WeaponModelSpecs';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * `lens` and `reticle` are M7's.
 *
 * A red dot's window used to be a `gunmetal` box sitting exactly on the sight line, which is
 * why the M6 playtest reported the SMG optic as "rendering opaque, blocking the target
 * entirely" — it was not a material bug, it was a solid plate across the aperture. The window
 * is glass now and the dot is its own emissive speck, which is the part you actually aim with.
 */
export type SurfaceKey = 'gunmetal' | 'polymer' | 'glove' | 'lens' | 'reticle';

export interface BoxPart {
  readonly surface: SurfaceKey;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
}

export interface TubePart {
  readonly surface: SurfaceKey;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly length: number;
  readonly sides?: number;
  /** Runs along Z by default; set for a tube standing on Y. */
  readonly vertical?: boolean;
}

/** A point in weapon-local metres. */
export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A part group as a function of the spec: the shape of every entry in the tables below. */
type PartShape = (spec: WeaponModelSpec) => BoxPart[];
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * A stock per kind (section 4.4), in place of the switch these four were a case of.
 *
 * `satisfies Record<…>` is what makes it exhaustive: a stock added to `WeaponModelSpec`
 * without a shape here is a compile error rather than a weapon that is drawn without one.
 * The same is true of the two tables below.
 */
const STOCK_SHAPES = {
  full: (spec): BoxPart[] => {
    const back = spec.receiverLength * 0.5;
    return [
      {
        surface: 'polymer',
        x: 0,
        y: -spec.receiverHeight * 0.15,
        z: back + spec.stockLength * 0.5,
        w: spec.receiverWidth * 0.86,
        h: spec.receiverHeight * 1.15,
        d: spec.stockLength,
      },
      {
        surface: 'polymer',
        x: 0,
        y: spec.receiverHeight * 0.37,
        z: back + spec.stockLength * 0.35,
        w: spec.receiverWidth * 0.62,
        h: spec.receiverHeight * 0.36,
        d: spec.stockLength * 0.7,
      },
    ];
  },
  /** Two rails and a cheek piece. Reads as lightweight rather than as missing. */
  skeleton: (spec): BoxPart[] => {
    const back = spec.receiverLength * 0.5;
    return [
      {
        surface: 'gunmetal',
        x: 0,
        y: spec.receiverHeight * 0.3,
        z: back + spec.stockLength * 0.5,
        w: spec.receiverWidth * 0.5,
        h: 0.012,
        d: spec.stockLength,
      },
      {
        surface: 'gunmetal',
        x: 0,
        y: -spec.receiverHeight * 0.35,
        z: back + spec.stockLength * 0.5,
        w: spec.receiverWidth * 0.5,
        h: 0.012,
        d: spec.stockLength,
      },
      {
        surface: 'polymer',
        x: 0,
        y: 0,
        z: back + spec.stockLength * 0.95,
        w: spec.receiverWidth * 0.8,
        h: spec.receiverHeight * 1.2,
        d: 0.03,
      },
    ];
  },
  /** Folded along the right side of the receiver. */
  folding: (spec): BoxPart[] => [
    {
      surface: 'gunmetal',
      x: spec.receiverWidth * 0.66,
      y: spec.receiverHeight * 0.1,
      z: spec.receiverLength * 0.5 * 0.2,
      w: 0.014,
      h: 0.028,
      d: spec.stockLength,
    },
  ],
  none: (): BoxPart[] => [],
} satisfies Record<WeaponModelSpec['stock'], PartShape>;

//
// Everything here is placed relative to `sightHeight` rather than to the rail (M7).
//
// The rail-relative version was authored against the AR's 0.082 m receiver with absolute
// box sizes, and those sizes do not shrink with the weapon. On the pistol — receiver 0.062,
// sight line 0.042 — the front and rear sight *bases* both ended up straddling the sight
// line, so aiming meant looking into a solid block of gunmetal. That is the M6 playtest's
// "pistol viewmodel obscuring the target"; the pose was a symptom, the geometry was the bug.
//
// Derived from the sight line, the aperture is clear on all twelve weapons by construction:
// bases stop below it, posts straddle it and frame it, and only the front blade crosses it,
// which is the one piece of metal you are supposed to be looking at.
const OPTIC_SHAPES = {
  irons: (spec): BoxPart[] => {
    const back = spec.receiverLength * 0.5;
    const hgEnd = handguardEnd(spec);
    const lineY = spec.sightHeight;
    const baseTop = lineY - 0.008;
    const baseH = 0.014;
    const baseY = baseTop - baseH * 0.5;
    // Posts rise from the base and stop just past the line, so the notch reads as a notch.
    const postH = 0.012;
    const postY = baseTop + postH * 0.5;
    // The blade is the aiming reference and is allowed to reach the line.
    const bladeH = 0.011;
    const bladeY = baseTop + bladeH * 0.5;
    return [
      // Front sight: base and blade, on the barrel end.
      { surface: 'gunmetal', x: 0, y: baseY, z: hgEnd - 0.01, w: spec.receiverWidth * 0.5, h: baseH, d: 0.03 },
      { surface: 'gunmetal', x: 0, y: bladeY, z: hgEnd - 0.01, w: 0.007, h: bladeH, d: 0.007 },
      // Rear sight: base and the two notch posts, over the receiver.
      { surface: 'gunmetal', x: 0, y: baseY, z: back * 0.45, w: spec.receiverWidth * 0.56, h: baseH, d: 0.028 },
      ...[-1, 1].map((side): BoxPart => {
        const postX = Math.min(0.0135, spec.receiverWidth * 0.42);
        return { surface: 'gunmetal', x: side * postX, y: postY, z: back * 0.45, w: 0.008, h: postH, d: 0.024 };
      }),
    ];
  },
  reddot: (spec): BoxPart[] => {
    const lineY = spec.sightHeight;
    const z = spec.receiverLength * 0.5 * 0.2;
    return [
      // A U-shaped housing — floor, two walls, a hood — rather than one block. The block
      // *was* the window, and a solid window is the bug this rebuild exists to close.
      { surface: 'gunmetal', x: 0, y: lineY - 0.021, z, w: 0.036, h: 0.015, d: 0.052 },
      ...[-1, 1].map((side): BoxPart => ({ surface: 'gunmetal', x: side * 0.019, y: lineY - 0.002, z, w: 0.006, h: 0.034, d: 0.05 })),
      { surface: 'gunmetal', x: 0, y: lineY + 0.017, z, w: 0.044, h: 0.005, d: 0.05 },
      // The glass, and the dot floating behind it on the sight line.
      { surface: 'lens', x: 0, y: lineY - 0.002, z: z - 0.021, w: 0.031, h: 0.032, d: 0.002 },
      { surface: 'reticle', x: 0, y: lineY, z: z - 0.024, w: 0.0032, h: 0.0032, d: 0.0012 },
    ];
  },
  /**
   * Two rings and a tube; the objective bell is the give-away at a glance. The rings
   * bridge the rail to the tube's underside rather than floating below it.
   */
  scope: (spec): BoxPart[] => {
    const back = spec.receiverLength * 0.5;
    const railY = spec.receiverHeight * 0.73;
    const lineY = spec.sightHeight;
    const tubeBottom = lineY - 0.016;
    const ringH = Math.max(0.008, tubeBottom - railY);
    const ringY = railY + ringH * 0.5;
    return [-1, 1].map((_, index): BoxPart => {
      const dz = index === 0 ? 0 : -spec.opticLength * 0.62;
      return { surface: 'gunmetal', x: 0, y: ringY, z: back * 0.25 + dz, w: 0.026, h: ringH, d: 0.016 };
    });
  },
} satisfies Record<WeaponModelSpec['optic'], PartShape>;

/**
 * A magazine per kind, in place of the switch these five were a case of.
 *
 * The well's place along the receiver is each shape's own: behind it on a pistol, whose
 * magazine *is* the grip, and in front of it on everything else.
 */
const MAGAZINE_SHAPES = {
  curved: (spec): BoxPart[] => {
    const wellZ = -spec.receiverLength * 0.04;
    return [
      {
        surface: 'polymer',
        x: 0,
        y: -spec.receiverHeight * 0.55 - spec.magazineLength * 0.5,
        z: wellZ,
        w: 0.03,
        h: spec.magazineLength,
        d: 0.078,
        rx: 0.12,
      },
      {
        surface: 'polymer',
        x: 0,
        y: -spec.receiverHeight * 0.55 - spec.magazineLength - 0.006,
        z: wellZ + 0.01,
        w: 0.036,
        h: 0.014,
        d: 0.086,
        rx: 0.12,
      },
    ];
  },
  box: (spec): BoxPart[] => [
    {
      surface: 'polymer',
      x: 0,
      y: -spec.receiverHeight * 0.55 - spec.magazineLength * 0.5,
      z: -spec.receiverLength * 0.04,
      w: 0.034,
      h: spec.magazineLength,
      d: 0.07,
    },
  ],
  /** A drum is drawn as a wide flat box plus a cylinder below; the box is the housing. */
  drum: (spec): BoxPart[] => [
    {
      surface: 'polymer',
      x: 0,
      y: -spec.receiverHeight * 0.55 - spec.magazineLength * 0.3,
      z: -spec.receiverLength * 0.04,
      w: 0.05,
      h: spec.magazineLength * 0.5,
      d: 0.09,
    },
  ],
  /** The tube lives under the barrel, so there is no box. */
  tube: (): BoxPart[] => [],
  /**
   * A pistol's magazine is the grip. Drawn as the grip's front face so the reload has
   * something visible to drop.
   */
  grip: (spec): BoxPart[] => [
    {
      surface: 'polymer',
      x: 0,
      y: -spec.receiverHeight * 1.05,
      z: spec.receiverLength * 0.24,
      w: spec.receiverWidth * 0.9,
      h: spec.magazineLength,
      d: 0.038,
      rx: -0.16,
    },
  ],
} satisfies Record<WeaponModelSpec['magazine'], PartShape>;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** Height of the bore above the origin. Everything barrel-shaped hangs off this. */
export function barrelY(spec: WeaponModelSpec): number {
  return spec.receiverHeight * 0.13;
}

export function muzzleZ(spec: WeaponModelSpec): number {
  return handguardEnd(spec) - spec.barrelLength - spec.muzzleLength * 0.5;
}

/**
 * Centre of the trigger hand in unscaled weapon-local metres. Both the first-person gloves
 * and a third-person character socket use this, so a weapon's grip has one source of truth.
 */
export function triggerHandAnchor(spec: WeaponModelSpec): Readonly<{ x: number; y: number; z: number }> {
  const back = spec.receiverLength * 0.5;
  return {
    x: 0.006,
    y: -spec.receiverHeight * 0.88,
    z: back * 0.48,
  };
}

/**
 * Centre of the support palm in unscaled weapon-local metres. Third-person IK and the
 * first-person glove block deliberately share this datum, so one weapon cannot acquire two
 * incompatible handguard locations.
 */
export function supportHandAnchor(spec: WeaponModelSpec): Readonly<{ x: number; y: number; z: number }> {
  const back = spec.receiverLength * 0.5;
  if (spec.handguardLength <= 0) {
    return {
      x: -0.03,
      y: -spec.receiverHeight * 0.92,
      z: back * 0.42,
    };
  }

  return {
    x: 0,
    y: barrelY(spec) - spec.handguardHeight * 0.62 - 0.006,
    z: receiverFront(spec) - spec.handguardLength * 0.45,
  };
}

/**
 * Every box a weapon's body is drawn from, in the order the sections are built.
 *
 * Six groups, each its own function: the sections this was written with as `// -- receiver --`
 * dividers, which is how it grew to 185 lines. The three that vary by kind — the stock, the
 * optic, the magazine — are tables rather than switches, so adding a kind to the spec is a
 * compile error here rather than a weapon that draws without one.
 */
export function bodyBoxes(spec: WeaponModelSpec): BoxPart[] {
  return [
    ...receiverBoxes(spec),
    ...handguardBoxes(spec),
    ...gripBoxes(spec),
    ...STOCK_SHAPES[spec.stock](spec),
    ...OPTIC_SHAPES[spec.optic](spec),
    ...bipodBoxes(spec),
  ];
}

/**
 * The first-person gloves: a trigger hand and forearm, and a support hand and forearm.
 *
 * A separate part group rather than a tail on `bodyBoxes`, because only one of the builders
 * that read the layout wants them. The viewmodel does — a viewmodel with no hands reads as a
 * floating prop. The held weapon on a third-person body does not, since that body has hands
 * of its own and a second pair floating beside them was the "overlapping limbs" report. The
 * loadout preview and the killfeed silhouette are pictures of the *weapon*, and a glove is
 * not part of a weapon. Keeping the hands out of `bodyBoxes` means none of them has to
 * filter by surface, and there is no flag to forget.
 *
 * Both hands sit on the same anchors a third-person character socket uses
 * (`triggerHandAnchor`, `supportHandAnchor`), so the two views cannot disagree about where
 * a weapon is held.
 */
export function handBoxes(spec: WeaponModelSpec): BoxPart[] {
  // Grey-box, but a viewmodel with no hands reads as a floating prop.
  //
  // A weapon with no handguard is held in two hands *on the grip*, not with a support hand
  // reaching for furniture that does not exist. That distinction is not cosmetic: the
  // rifle's support arm is a 0.2 m forearm box placed forward of the receiver, and on a
  // 0.17 m pistol it ended up between the sights and the camera, filling most of the screen
  // at ADS. See the M5 hotfix note in PLAN.md.
  const twoHandedGrip = spec.handguardLength <= 0;
  return [
    ...triggerHandBoxes(spec),
    ...(twoHandedGrip ? tuckedSupportBoxes(spec) : reachingSupportBoxes(spec)),
  ];
}

/**
 * The same gloves on a weapon whose grip is somewhere else (M19, stage 1).
 *
 * A GLB weapon carries its own hand sockets, measured from its mesh, and its receiver is not
 * the spec's box: the M4 kit's upper and lower stand 16.6 cm tall where `AR_BASE` is 8.2, so
 * the spec's trigger hand lands inside the receiver. The gloves are still built from the spec
 * — the forearm's length and angle are what make them read as arms — and then each pair is
 * carried to the socket by the difference between the socket and the anchor the pair was
 * built on. `handBoxes` lists the trigger hand and its forearm first, the support pair second;
 * this relies on that order rather than on a flag per box.
 */
export function handBoxesAt(spec: WeaponModelSpec, grip: Anchor, support: Anchor): BoxPart[] {
  const boxes = handBoxes(spec);
  const trigger = triggerHandAnchor(spec);
  const palm = supportHandAnchor(spec);
  return boxes.map((box, index) => {
    const from = index < 2 ? trigger : palm;
    const to = index < 2 ? grip : support;
    return { ...box, x: box.x + (to.x - from.x), y: box.y + (to.y - from.y), z: box.z + (to.z - from.z) };
  });
}

export function bodyTubes(spec: WeaponModelSpec): TubePart[] {
  const out: TubePart[] = [];
  const by = barrelY(spec);
  const hgEnd = handguardEnd(spec);

  if (spec.barrelLength > 0) {
    out.push({
      surface: 'gunmetal',
      x: 0,
      y: by,
      z: hgEnd - spec.barrelLength * 0.5,
      radius: spec.barrelRadius,
      length: spec.barrelLength,
    });
  }
  out.push({
    surface: 'gunmetal',
    x: 0,
    y: by,
    z: muzzleZ(spec),
    radius: spec.muzzleRadius,
    length: spec.muzzleLength,
    sides: 10,
  });

  if (spec.optic === 'scope') {
    out.push({
      surface: 'gunmetal',
      x: 0,
      y: spec.sightHeight,
      z: spec.receiverLength * 0.5 * 0.25 - spec.opticLength * 0.3,
      radius: 0.016,
      length: spec.opticLength,
      sides: 12,
    });
    // Objective bell.
    out.push({
      surface: 'gunmetal',
      x: 0,
      y: spec.sightHeight,
      z: spec.receiverLength * 0.5 * 0.25 - spec.opticLength * 0.85,
      radius: 0.024,
      length: spec.opticLength * 0.22,
      sides: 12,
    });
  }

  return out;
}

/** The magazine group. Animated independently, so it is built on its own. */
export function magazineBoxes(spec: WeaponModelSpec): BoxPart[] {
  return MAGAZINE_SHAPES[spec.magazine](spec);
}

export function magazineTubes(spec: WeaponModelSpec): TubePart[] {
  if (spec.magazine === 'drum') {
    return [
      {
        surface: 'polymer',
        x: 0,
        y: -spec.receiverHeight * 0.55 - spec.magazineLength * 0.85,
        z: -spec.receiverLength * 0.04,
        radius: spec.magazineLength * 0.42,
        length: 0.06,
        sides: 14,
      },
    ];
  }
  if (spec.magazine === 'tube') {
    return [
      {
        surface: 'gunmetal',
        x: 0,
        y: barrelY(spec) - spec.barrelRadius - 0.014,
        z: handguardEnd(spec) - spec.magazineLength * 0.5 + spec.handguardLength * 0.5,
        radius: 0.013,
        length: spec.magazineLength,
        sides: 10,
      },
    ];
  }
  return [];
}

/** The charging handle, or a shotgun's pump. Same group, different shape. */
export function chargingBoxes(spec: WeaponModelSpec): BoxPart[] {
  if (spec.pump) {
    return [
      {
        surface: 'polymer',
        x: 0,
        y: barrelY(spec) - 0.03,
        z: handguardEnd(spec) + spec.handguardLength * 0.35,
        w: spec.receiverWidth * 0.82,
        h: 0.048,
        d: spec.handguardLength * 0.55,
      },
    ];
  }
  const back = spec.receiverLength * 0.5;
  return [
    {
      surface: 'gunmetal',
      x: 0,
      y: spec.receiverHeight * 0.57,
      z: back * 0.92,
      w: spec.receiverWidth,
      h: 0.016,
      d: 0.03,
    },
    {
      surface: 'gunmetal',
      x: 0,
      y: spec.receiverHeight * 0.57,
      z: back * 0.78,
      w: 0.02,
      h: 0.012,
      d: 0.05,
    },
  ];
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** The back face of the receiver, where the handguard begins. */
function receiverFront(spec: WeaponModelSpec): number {
  return -spec.receiverLength * 0.5;
}

/** The far end of the handguard, where the barrel takes over. */
function handguardEnd(spec: WeaponModelSpec): number {
  return receiverFront(spec) - spec.handguardLength;
}

/** The receiver, its top rail and its ejection port. Every weapon has all three. */
function receiverBoxes(spec: WeaponModelSpec): BoxPart[] {
  return [
    {
      surface: 'gunmetal',
      x: 0,
      y: 0,
      z: 0,
      w: spec.receiverWidth,
      h: spec.receiverHeight,
      d: spec.receiverLength,
    },
    // Top rail. Every weapon has one; it is what the optic sits on.
    {
      surface: 'gunmetal',
      x: 0,
      y: spec.receiverHeight * 0.6,
      z: -spec.receiverLength * 0.07,
      w: spec.receiverWidth * 0.62,
      h: spec.receiverHeight * 0.26,
      d: spec.receiverLength,
    },
    // Ejection port, so the receiver has a right-hand side you can read.
    {
      surface: 'gunmetal',
      x: spec.receiverWidth * 0.53,
      y: spec.receiverHeight * 0.22,
      z: -spec.receiverLength * 0.15,
      w: 0.005,
      h: spec.receiverHeight * 0.36,
      d: spec.receiverLength * 0.24,
    },
  ];
}

/** The handguard, on a weapon that has one. */
function handguardBoxes(spec: WeaponModelSpec): BoxPart[] {
  if (spec.handguardLength <= 0) return [];
  return [
    {
      surface: 'polymer',
      x: 0,
      y: barrelY(spec),
      z: receiverFront(spec) - spec.handguardLength * 0.5,
      w: spec.receiverWidth * 0.96,
      h: spec.handguardHeight,
      d: spec.handguardLength,
    },
  ];
}

/** The grip, and the trigger inside its guard. */
function gripBoxes(spec: WeaponModelSpec): BoxPart[] {
  const back = spec.receiverLength * 0.5;
  return [
    {
      surface: 'polymer',
      x: 0,
      y: -spec.receiverHeight * 1.1,
      z: back * 0.5,
      w: spec.receiverWidth * 0.62,
      h: 0.12,
      d: 0.055,
      rx: -0.28,
    },
    {
      surface: 'gunmetal',
      x: 0,
      y: -spec.receiverHeight * 0.58,
      z: back * 0.26,
      w: 0.008,
      h: 0.024,
      d: 0.01,
    },
  ];
}

/** Two splayed legs, on a weapon that carries a bipod. */
function bipodBoxes(spec: WeaponModelSpec): BoxPart[] {
  if (!spec.bipod) return [];
  const by = barrelY(spec);
  const legZ = handguardEnd(spec) + 0.03;
  return [-1, 1].map((side): BoxPart => ({
    surface: 'gunmetal',
    x: side * 0.026,
    y: by - 0.075,
    z: legZ,
    w: 0.008,
    h: 0.11,
    d: 0.008,
    rz: side * 0.34,
  }));
}

/** The trigger hand and its forearm. Always present, and always first in the list. */
function triggerHandBoxes(spec: WeaponModelSpec): BoxPart[] {
  const back = spec.receiverLength * 0.5;
  const triggerHand = triggerHandAnchor(spec);
  return [
    {
      surface: 'glove',
      x: triggerHand.x,
      y: triggerHand.y,
      z: triggerHand.z,
      w: 0.058,
      h: 0.085,
      d: 0.088,
      rx: -0.28,
    },
    {
      surface: 'glove',
      x: 0.036,
      y: -0.166,
      z: back * 0.48 + 0.124,
      w: 0.072,
      h: 0.078,
      d: 0.2,
      rx: -0.5,
    },
  ];
}

/**
 * Support hand wrapped around the firing hand, and its forearm tucked in beside the first
 * rather than reaching forward. For a weapon with no handguard to hold.
 */
function tuckedSupportBoxes(spec: WeaponModelSpec): BoxPart[] {
  const back = spec.receiverLength * 0.5;
  const supportHand = supportHandAnchor(spec);
  return [
    {
      surface: 'glove',
      x: supportHand.x,
      y: supportHand.y,
      z: supportHand.z,
      w: 0.05,
      h: 0.082,
      d: 0.078,
      rx: -0.28,
    },
    {
      surface: 'glove',
      x: -0.05,
      y: -0.172,
      z: back * 0.42 + 0.13,
      w: 0.066,
      h: 0.072,
      d: 0.19,
      rx: -0.5,
      rz: 0.18,
    },
  ];
}

/** Support hand out on the handguard, and its forearm reaching forward to meet it. */
function reachingSupportBoxes(spec: WeaponModelSpec): BoxPart[] {
  const by = barrelY(spec);
  const supportHand = supportHandAnchor(spec);
  return [
    {
      surface: 'glove',
      x: supportHand.x,
      y: supportHand.y,
      z: supportHand.z,
      w: 0.064,
      h: 0.076,
      d: 0.1,
    },
    {
      surface: 'glove',
      x: -0.056,
      y: by - 0.15,
      z: supportHand.z + 0.094,
      w: 0.076,
      h: 0.076,
      d: 0.19,
      rx: 0.42,
      rz: -0.5,
    },
  ];
}
//#endregion
