/**
 * Per-weapon corrections to the first-person hands (M19, stage 4, after the arms' first
 * playtest).
 *
 * `ViewmodelHands` puts each glove on its socket with one hold for every weapon — the trigger
 * hand's on a pistol grip, the support hand's on a handguard — and one hold does not fit ten
 * weapons' furniture: the playtest found the hands crooked and off their handguards, and in the
 * way on some. A pose here moves a hand on one weapon, in that weapon's own space:
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

export type HandSide = 'grip' | 'support';

export interface HandPose {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly curl: number;
}

export const NEUTRAL_HAND_POSE: HandPose = { position: [0, 0, 0], rotation: [0, 0, 0], curl: 1 };

/**
 * Posed by the human in the hand tuner, hip and ADS (2026-09-23). The two LMGs are not in it
 * yet and hold with the defaults.
 */
export const HAND_POSES: Readonly<Record<string, Partial<Record<HandSide, HandPose>>>> = {
  ar_carbine: {
    grip: { position: [-0.006, 0.004, 0.0], rotation: [0.0, -12.0, -21.0], curl: 0.83 },
    support: { position: [0.01, 0.0, -0.017], rotation: [-161.5, -180.0, -138.0], curl: 1.01 },
  },
  ar_halcyon: {
    grip: { position: [0.027, 0.016, 0.091], rotation: [0.0, -9.5, 2.0], curl: 0.9 },
    support: { position: [0.034, 0.02, 0.073], rotation: [-129.5, -180.0, -138.0], curl: 1.0 },
  },
  ar_longbow: {
    grip: { position: [0.0, -0.015, 0.05], rotation: [4.0, -28.0, -19.0], curl: 1.01 },
    support: { position: [0.017, -0.013, 0.055], rotation: [-161.5, 167.5, -138.0], curl: 1.8 },
  },
  ar_vulcan: {
    grip: { position: [-0.003, 0.007, 0.025], rotation: [0.0, -12.0, -21.0], curl: 0.9 },
    support: { position: [0.006, 0.0, -0.021], rotation: [-158.0, -180.0, -138.0], curl: 1.0 },
  },
  pistol_talon: {
    grip: { position: [-0.009, -0.039, 0.03], rotation: [18.0, -6.5, 0.0], curl: 0.2 },
    support: { position: [0.015, -0.028, -0.067], rotation: [22.0, 29.0, 36.0], curl: 0.92 },
  },
  shotgun_breacher: {
    grip: { position: [-0.003, 0.0, 0.042], rotation: [13.0, -30.0, -12.0], curl: 0.93 },
    support: { position: [0.0, 0.0, 0.0], rotation: [-154.0, -180.0, -138.0], curl: 1.0 },
  },
  smg_meridian: {
    grip: { position: [0.018, -0.036, 0.005], rotation: [14.5, -14.0, 0.0], curl: 1.0 },
    support: { position: [0.016, 0.0, -0.074], rotation: [-165.0, -180.0, -138.0], curl: 1.06 },
  },
  smg_wasp: {
    grip: { position: [0.0, 0.0, 0.017], rotation: [0.0, -51.0, 0.0], curl: 1.0 },
    support: { position: [0.016, -0.033, 0.0], rotation: [-154.0, -180.0, -138.0], curl: 1.55 },
  },
  sniper_kestrel: {
    grip: { position: [0.042, 0.02, 0.018], rotation: [9.5, 0.0, 0.0], curl: 1.0 },
    support: { position: [0.019, 0.01, 0.0], rotation: [-156.0, -180.0, -138.0], curl: 1.0 },
  },
  sniper_vantage: {
    grip: { position: [0.0, 0.0, 0.0], rotation: [20.0, -40.5, 0.0], curl: 1.0 },
    support: { position: [0.0, 0.0, -0.057], rotation: [-156.0, -180.0, -138.0], curl: 1.0 },
  },
};

/** A weapon's pose for one hand: its entry, or the neutral pose. */
export function handPoseFor(weaponId: string, side: HandSide): HandPose {
  return HAND_POSES[weaponId]?.[side] ?? NEUTRAL_HAND_POSE;
}

/** One weapon's entry as source, in `HAND_POSES`' own shape: what the tuner prints. */
export function handPoseSource(weaponId: string, poses: Readonly<Record<HandSide, HandPose>>): string {
  const n = (v: number, digits: number): string => {
    const s = v.toFixed(digits);
    return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
  };
  const one = (p: HandPose): string =>
    `{ position: [${p.position.map((v) => n(v, 3)).join(', ')}], rotation: [${p.rotation.map((v) => n(v, 1)).join(', ')}], curl: ${n(p.curl, 2)} }`;
  return `  ${weaponId}: {\n    grip: ${one(poses.grip)},\n    support: ${one(poses.support)},\n  },`;
}
