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

export const WEAPON_ASSET_VERSION = '2026-09-22-m19-playtest-4';

const WEAPON_ROOT = '/models/weapons';

/** Weapon ids with a built file. The order is the arsenal's; the set is what matters. */
export const WEAPON_ASSET_IDS: ReadonlySet<string> = new Set([
  'ar_carbine',
  'ar_vulcan',
  'ar_halcyon',
  'ar_longbow',
  'smg_wasp',
  'smg_meridian',
  'shotgun_breacher',
  'sniper_kestrel',
  'sniper_vantage',
  'pistol_talon',
]);

export function hasWeaponAsset(weaponId: string): boolean {
  return WEAPON_ASSET_IDS.has(weaponId);
}

/** The bodies' file for a weapon (stage 3): the same weapon joined per material under 10k triangles. */
export function weaponLodUrl(weaponId: string): string {
  return `${WEAPON_ROOT}/${weaponId}.lod1.glb?v=${encodeURIComponent(WEAPON_ASSET_VERSION)}`;
}

/** The knife's file (stage 3): a root and a `body`, no sockets, loaded beside the weapons. */
export const KNIFE_ASSET_ID = 'knife';

export function weaponAssetUrl(weaponId: string): string {
  return `${WEAPON_ROOT}/${weaponId}.glb?v=${encodeURIComponent(WEAPON_ASSET_VERSION)}`;
}

/**
 * The attachment pack (stage 2): one part per attachment that is a thing on the gun, built
 * with its origin on its mating face so mounting is `socket.add(part)`. The extended
 * magazine is not a part — it is the weapon's own magazine stretched, because a magazine is
 * the one attachment that cannot be shared across calibres — and so it has no file.
 */
export const ATTACHMENT_PARTS = {
  optic_reflex: 'att_optic',
  muzzle_suppressor: 'att_suppressor',
  grip_foregrip: 'att_grip',
  laser_tactical: 'att_laser',
} as const;

export type AttachmentPartId = (typeof ATTACHMENT_PARTS)[keyof typeof ATTACHMENT_PARTS];

export const ATTACHMENT_PART_IDS: readonly AttachmentPartId[] = Object.values(ATTACHMENT_PARTS);

/** Where each part mounts, by the weapon's socket name. */
export const ATTACHMENT_PART_SOCKETS: Readonly<Record<AttachmentPartId, WeaponSocketNode>> = {
  att_optic: 'socket_rail_top',
  att_suppressor: 'socket_muzzle',
  att_grip: 'socket_rail_bottom',
  att_laser: 'socket_rail_front',
};

/** The sockets a part carries of its own: the optic's sight line, the suppressor's new muzzle. */
export const ATTACHMENT_PART_OWN_SOCKETS: Readonly<Record<AttachmentPartId, readonly ('socket_sight' | 'socket_muzzle')[]>> = {
  att_optic: ['socket_sight'],
  att_suppressor: ['socket_muzzle'],
  att_grip: [],
  att_laser: [],
};

/** How much longer an extended magazine draws than the standard one, along the well. */
export const MAGAZINE_EXTENDED_STRETCH = 1.4;

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
