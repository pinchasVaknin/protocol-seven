/**
 * The character skins, as the wire names them (M16, B6.1).
 *
 * Until this file `shared/` knew one skin fact — the default's name — and the client's
 * `CharacterCatalog` held the list, the files and the rigs. A skin on the wire is an index
 * (M16 B6.2: `EntitySnapshot.characterIndex`, one byte, the shape `weaponIndex` has over
 * `ALL_WEAPONS`), and an index needs a table both halves read in the same order. This is
 * that table, and **the order is the wire**: a new skin goes on the end, and a skin is never
 * removed from the middle without a protocol bump, because a client and a server disagreeing
 * about position 3 is a player shown as the wrong person.
 *
 * The catalogue still owns everything about a skin that is the client's business — the file,
 * the rig, the thumbnail, the clips — keyed by `SkinId`, so a skin added here without a
 * definition, or defined there without a row here, is a type error rather than a runtime
 * 255. `check:skins` holds the folder to both.
 */

export const SKIN_IDS = ['apex', 'echo', 'hazard', 'pulse', 'rhino', 'sentry', 'viper'] as const;

export type SkinId = (typeof SKIN_IDS)[number];

/**
 * The skin every player has worn since M13 — the default that preloads at boot, the body the
 * stage showed before there was a picker, and what a v3 save is upgraded to.
 */
export const DEFAULT_SKIN_ID: SkinId = 'echo';

/**
 * The wire's "declared none": a body the server has no opinion about, which the client deals
 * from its own deck. The same value `weaponIndex` uses for "no weapon", for the same reason —
 * a byte that can never be a real index.
 */
export const NO_SKIN_INDEX = 255;

export function isSkinId(id: string): id is SkinId {
  return (SKIN_IDS as readonly string[]).includes(id);
}

/** Skin id to wire index. A name not in the table is `NO_SKIN_INDEX`, never a guess. */
export function skinIndexOf(id: string): number {
  const at = (SKIN_IDS as readonly string[]).indexOf(id);
  return at < 0 ? NO_SKIN_INDEX : at;
}

/** Wire index to skin id. Null for `NO_SKIN_INDEX` and for anything past the table's end. */
export function skinIdAt(index: number): SkinId | null {
  return SKIN_IDS[index] ?? null;
}
