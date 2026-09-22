/**
 * The weapons that have a GLB (M19, stage 1).
 *
 * `public/models/weapons/` holds what `scripts/weapon-build.mjs` built, and this is the client's
 * list of which weapon ids that covers. Two descriptions of one folder, held to each other by
 * `check:weapons` the way `check:skins` holds `CharacterCatalog` to its folder: a recipe with no
 * entry here is a file nothing loads, and an entry with no recipe is a fetch that 404s at match
 * time. The set grows one weapon at a time as stage 3 lands them; everything not in it keeps
 * the procedural viewmodel from `WeaponModelSpecs`, which is also every weapon's fallback when
 * the file fails to arrive.
 *
 * The URLs carry a version for the same reason the skins' do: `public/` files are not hashed
 * by the build, so a client holding last week's bytes keeps them until the version moves. Bump
 * it after a rebuild that changes a file.
 */

export const WEAPON_ASSET_VERSION = '2026-09-22-m19-stage-1';

const WEAPON_ROOT = '/models/weapons';

/** Weapon ids with a built file. The order is the arsenal's; the set is what matters. */
export const WEAPON_ASSET_IDS: ReadonlySet<string> = new Set(['ar_carbine']);

export function hasWeaponAsset(weaponId: string): boolean {
  return WEAPON_ASSET_IDS.has(weaponId);
}

export function weaponAssetUrl(weaponId: string): string {
  return `${WEAPON_ROOT}/${weaponId}.glb?v=${encodeURIComponent(WEAPON_ASSET_VERSION)}`;
}

/**
 * The nodes a built weapon file carries, by name — the authoring contract in
 * `scripts/weapon-build.mjs` and rule 5 of `check-weapons.mjs`, restated where the loader reads
 * them. `charge` may be an empty group (the M4 kit's charging handle is part of its upper);
 * the reload pulls an empty group and nothing moves, which is the honest picture.
 */
export const WEAPON_GROUP_NODES = ['body', 'magazine', 'charge'] as const;
export const WEAPON_SOCKET_NODES = [
  'socket_muzzle',
  'socket_rail_top',
  'socket_rail_bottom',
  'socket_rail_front',
  'socket_sight',
  'socket_grip',
  'socket_support',
] as const;

export type WeaponGroupNode = (typeof WEAPON_GROUP_NODES)[number];
export type WeaponSocketNode = (typeof WEAPON_SOCKET_NODES)[number];
