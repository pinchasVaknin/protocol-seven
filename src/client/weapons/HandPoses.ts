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
