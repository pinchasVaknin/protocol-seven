/**
 * Per-weapon corrections to the first-person hands (M19, stage 4, after the arms' first
 * playtest).
 *
 * `ViewmodelHands` puts each glove on its socket with one hold for every weapon — the trigger
 * hand's on a pistol grip, the support hand's on a handguard — and one hold does not fit ten
 * weapons' furniture: the playtest found the hands crooked and off their handguards, and in the
 * way on some. A pose here moves a hand on one weapon — `grip` the trigger hand on
 * `socket_grip` and `support` the support hand on `socket_support`, both in the weapon's own
 * space, and `reload` the support hand on the magazine during a reload (`socket_mag_grip`), in
 * the magazine's own space so it rides the magazine out and back:
 *
 * - `position`, metres added to the socket (x right, y up, z back toward the eye);
 * - `rotation`, degrees — pitch about x, yaw about y, roll about z, in that order — turning
 *   the whole hold (the hand, its knuckles' place, its fingers) about the socket;
 * - `curl`, a multiplier on every finger's bend: below 1 opens the hand, above closes it.
 *
 * The numbers come from the hand tuner (`probes/hand-tuner.html`), which edits these live on
 * the real viewmodel and prints entries in exactly this shape. A weapon with no entry holds
 * with the defaults.
 */

export type HandSide = 'grip' | 'support' | 'reload';

export interface HandPose {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly curl: number;
}

export const NEUTRAL_HAND_POSE: HandPose = { position: [0, 0, 0], rotation: [0, 0, 0], curl: 1 };

/**
 * Posed by the human in the hand tuner (2026-09-23): hip and ADS on the two sockets, and the
 * support hand on the magazine through a reload. The two LMGs are not in it and hold with the
 * defaults until their models are replaced.
 *
 * `knife` is the odd row and the only one with a single hand (2026-09-24): a blade is held in a
 * fist, the other arm is not drawn, and there is no magazine — so its entry is `grip` alone,
 * a correction on the handle's middle, which is where the file's origin is.
 *
 * The **equipment** rows (`eq_frag`, `eq_flashbang`, `eq_smoke`, `eq_claymore`) key on the id
 * the build gives each file, like every other row, and use two of the three sides: `grip` is
 * the throwing hand on `socket_grip` and `support` is the other hand on `socket_pin`, the ring
 * of the pin — a target that rides the pin itself, so the correction is in the pin's space and
 * the hand travels with the ring once the pull starts. There is no `reload`, and the claymore
 * has no `support`: it has no pin to pull.
 */
export const HAND_POSES: Readonly<Record<string, Partial<Record<HandSide, HandPose>>>> = {
  ar_carbine: {
    grip: { position: [-0.006, 0.004, 0.0], rotation: [0.0, -12.0, -21.0], curl: 0.83 },
    support: { position: [0.01, 0.0, -0.017], rotation: [-161.5, -180.0, -138.0], curl: 1.0 },
    reload: { position: [-0.029, -0.041, -0.009], rotation: [27.0, 23.5, 13.0], curl: 1.01 },
  },
  ar_halcyon: {
    grip: { position: [0.027, 0.016, 0.091], rotation: [0.0, -9.5, 2.0], curl: 0.9 },
    support: { position: [0.034, 0.02, 0.073], rotation: [-129.5, -180.0, -138.0], curl: 1.0 },
    reload: { position: [-0.003, -0.066, 0.0], rotation: [29.0, 25.5, 36.0], curl: 0.84 },
  },
  ar_longbow: {
    grip: { position: [0.0, -0.015, 0.05], rotation: [4.0, -28.0, -19.0], curl: 1.01 },
    support: { position: [0.017, -0.013, 0.055], rotation: [-161.5, 167.5, -138.0], curl: 1.8 },
    reload: { position: [-0.003, -0.085, 0.0], rotation: [20.0, 29.0, 34.0], curl: 1.0 },
  },
  ar_vulcan: {
    grip: { position: [-0.003, 0.007, 0.025], rotation: [0.0, -12.0, -21.0], curl: 0.9 },
    support: { position: [0.006, 0.0, -0.021], rotation: [-158.0, -180.0, -138.0], curl: 1.0 },
    reload: { position: [-0.02, -0.049, 0.005], rotation: [32.5, 22.0, 18.0], curl: 0.89 },
  },
  /**
   * The four pieces of equipment, posed by the human in the tuner (2026-09-24).
   *
   * Two hands each, doing different jobs, which is what makes these rows unlike every other
   * one in this table: `grip` is the hand the grenade sits in and `support` is the hand hooked
   * through the ring, corrected **in the pin's own space** so it travels with the ring.
   */
  eq_frag: {
    grip: { position: [0.003, -0.003, -0.034], rotation: [87.5, -6.5, -78.0], curl: 1.0 },
    support: { position: [-0.083, 0.003, -0.003], rotation: [50.0, -65.5, 62.5], curl: 1.0 },
  },
  /** One hand: a charge is armed by being thrown and there is no ring. */
  eq_semtex: {
    grip: { position: [-0.036, 0.024, 0.043], rotation: [6.0, -62.0, 80.5], curl: 1.0 },
  },
  eq_flashbang: {
    grip: { position: [-0.02, 0.003, -0.035], rotation: [-28.0, -180.0, -3.0], curl: 0.2 },
    support: { position: [0.035, 0.011, -0.007], rotation: [98.0, 52.0, -159.5], curl: 1.0 },
  },
  eq_smoke: {
    grip: { position: [-0.027, -0.02, -0.02], rotation: [-28.0, -180.0, -3.0], curl: 0.2 },
    support: { position: [0.035, 0.011, -0.007], rotation: [98.0, 52.0, -159.5], curl: 1.0 },
  },
  /** One hand: a mine is carried, not thrown, and there is no ring. */
  eq_claymore: {
    grip: { position: [0.116, -0.004, -0.026], rotation: [23.5, -10.0, -12.0], curl: 1.0 },
  },
  pistol_talon: {
    grip: { position: [-0.009, -0.039, 0.03], rotation: [18.0, -6.5, 0.0], curl: 0.2 },
    support: { position: [0.015, -0.028, -0.067], rotation: [22.0, 29.0, 36.0], curl: 0.92 },
    reload: { position: [-0.003, -0.048, 0.05], rotation: [0.0, 0.0, 0.0], curl: 1.04 },
  },
  shotgun_breacher: {
    grip: { position: [-0.003, 0.0, 0.042], rotation: [13.0, -30.0, -12.0], curl: 0.93 },
    support: { position: [0.0, 0.0, 0.0], rotation: [-154.0, -180.0, -138.0], curl: 1.0 },
    reload: { position: [0.0, 0.0, 0.0], rotation: [-154.0, -180.0, -138.0], curl: 1.0 },
  },
  smg_meridian: {
    grip: { position: [0.018, -0.036, 0.005], rotation: [14.5, -14.0, 0.0], curl: 1.0 },
    support: { position: [0.016, 0.0, -0.074], rotation: [-165.0, -180.0, -138.0], curl: 1.06 },
    reload: { position: [-0.02, 0.0, 0.0], rotation: [110.5, -54.5, 36.0], curl: 1.0 },
  },
  smg_wasp: {
    grip: { position: [0.0, 0.0, 0.017], rotation: [0.0, -51.0, 0.0], curl: 1.0 },
    support: { position: [0.016, -0.033, 0.0], rotation: [-154.0, -180.0, -138.0], curl: 1.55 },
    reload: { position: [-0.015, -0.077, 0.016], rotation: [43.0, 0.0, 4.0], curl: 0.85 },
  },
  sniper_kestrel: {
    grip: { position: [0.042, 0.02, 0.018], rotation: [9.5, 0.0, 0.0], curl: 1.0 },
    support: { position: [0.019, 0.01, 0.0], rotation: [-156.0, -180.0, -138.0], curl: 1.0 },
    reload: { position: [0.0, 0.0, 0.057], rotation: [0.0, 0.0, 0.0], curl: 1.0 },
  },
  sniper_vantage: {
    grip: { position: [0.0, 0.0, 0.0], rotation: [20.0, -40.5, 0.0], curl: 1.0 },
    support: { position: [0.0, 0.0, -0.057], rotation: [-156.0, -180.0, -138.0], curl: 1.0 },
    reload: { position: [0.0, -0.09, 0.013], rotation: [-3.0, 27.0, 43.0], curl: 1.14 },
  },
  knife: {
    grip: { position: [0.007, -0.017, -0.026], rotation: [105.5, -26.0, -97.5], curl: 1.25 },
  },
};

/** A weapon's pose for one hand: its entry, or the neutral pose. */
export function handPoseFor(weaponId: string, side: HandSide): HandPose {
  return HAND_POSES[weaponId]?.[side] ?? NEUTRAL_HAND_POSE;
}

/**
 * One finger's three segments from straight, knuckle first, in degrees — the same shape
 * `ViewmodelHands.FingerCurl` is, declared here so the wrap table below needs no import from
 * the module that reads it.
 */
export type FingerWrap = readonly [number, number, number];
export type HandWrap = Readonly<Record<'thumb' | 'index' | 'middle' | 'ring' | 'pink', FingerWrap>>;

/**
 * How far each finger closes, per hand, **per thing held** (2026-09-24).
 *
 * `HAND_POSES` above moves and turns a whole hold; this is the shape of the hand inside it.
 * The two are separate because they answer different questions — *where is the hand* and *what
 * is it doing* — and because `curl` in `HAND_POSES` is one multiplier over the lot, which is
 * the right dial for "this weapon wants a looser fist" and the wrong one for "the index goes
 * through the ring and the thumb floats".
 *
 * It exists because the equipment needed it. A weapon's two holds are a trigger hand and a hand
 * under a handguard, and one shape of each fits every weapon in the game; four grenades are
 * four different objects — a 6 cm lemon, a 4 cm can, a 6 cm can and a flat mine — and the human
 * shaped a fist for each. A weapon or a hold with no row here uses its hold's own `curl` in
 * `ViewmodelHands`, which is still where the shipped shapes live.
 *
 * Keyed by the file's id and the hand, like `HAND_POSES`. Written by the hand tuner.
 */
export const HAND_WRAPS: Readonly<Record<string, Partial<Record<'grip' | 'support', HandWrap>>>> = {
  eq_frag: {
    grip: { thumb: [20, 15, 0], index: [14, 11, 23], middle: [25, 20, 25], ring: [40, 25, 25], pink: [60, 25, 25] },
    support: { thumb: [0, 0, 0], index: [21, 41, 110], middle: [35, 60, 78], ring: [45, 66, 60], pink: [51, 59, 48] },
  },
  eq_semtex: {
    grip: { thumb: [0, 50, 0], index: [0, 10, 11], middle: [0, 20, 11], ring: [0, 20, 11], pink: [0, 20, 20] },
  },
  eq_flashbang: {
    grip: { thumb: [150, 0, 0], index: [-15, 130, 90], middle: [27, 150, 90], ring: [32, 140, 140], pink: [-20, 118, 140] },
    support: { thumb: [22, 0, 0], index: [40, 40, 100], middle: [50, 40, 81], ring: [54, 40, 67], pink: [75, 5, 64] },
  },
  /**
   * The smoke's left hand is the flashbang's, and that is a repair rather than a copy
   * (2026-09-24).
   *
   * What the tuner first produced for it was the flashbang's five triples each rotated one
   * place left — `[22,0,0]` as `[0,0,22]`, `[40,40,100]` as `[40,100,40]`, and so for the other
   * three. Five out of five is not a hand posed by eye, and the two grenades share the hold it
   * belongs to: their `support` entries above are the same numbers, because the ring sits in
   * the same place on both fuzes. The rotation is undone here; the *right* hand below is the
   * human's own and is left alone, because a fat can is not a thin one.
   */
  eq_smoke: {
    grip: { thumb: [150, 0, 150], index: [16, 140, 132], middle: [150, 90, 27], ring: [140, 140, 32], pink: [16, 140, 100] },
    support: { thumb: [22, 0, 0], index: [40, 40, 100], middle: [50, 40, 81], ring: [54, 40, 67], pink: [75, 5, 64] },
  },
  eq_claymore: {
    grip: { thumb: [60, 0, 0], index: [9, 31, 35], middle: [9, 31, 49], ring: [9, 31, 47], pink: [9, 1, 53] },
  },
};

/** This thing's wrap for one hand, or null: the hold's own shape stands. */
export function handWrapFor(weaponId: string, side: 'grip' | 'support'): HandWrap | null {
  return HAND_WRAPS[weaponId]?.[side] ?? null;
}

/** A wrap as source, in `HAND_WRAPS`' own shape: what the tuner prints. */
export function handWrapSource(weaponId: string, wraps: Partial<Record<'grip' | 'support', HandWrap>>): string {
  const fingers = ['thumb', 'index', 'middle', 'ring', 'pink'] as const;
  const one = (w: HandWrap): string => `{ ${fingers.map((f) => `${f}: [${w[f].map((v) => Math.round(v)).join(', ')}]`).join(', ')} }`;
  const rows = (['grip', 'support'] as const)
    .filter((side) => wraps[side] !== undefined)
    .map((side) => `    ${side}: ${one(wraps[side]!)},`)
    .join('\n');
  return `  ${weaponId}: {\n${rows}\n  },`;
}

/** One weapon's entry as source, in `HAND_POSES`' own shape: what the tuner prints. */
export function handPoseSource(
  weaponId: string,
  poses: Readonly<Record<HandSide, HandPose>>,
  /** Which hands to print. The knife holds with one, and the other two would be noise. */
  sides: readonly HandSide[] = ['grip', 'support', 'reload'],
): string {
  const n = (v: number, digits: number): string => {
    const s = v.toFixed(digits);
    return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
  };
  const one = (p: HandPose): string =>
    `{ position: [${p.position.map((v) => n(v, 3)).join(', ')}], rotation: [${p.rotation.map((v) => n(v, 1)).join(', ')}], curl: ${n(p.curl, 2)} }`;
  const rows = sides.map((side) => `    ${side}: ${one(poses[side])},`).join('\n');
  return `  ${weaponId}: {\n${rows}\n  },`;
}
