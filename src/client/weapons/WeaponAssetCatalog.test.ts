import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_PARTS,
  ATTACHMENT_PART_IDS,
  ATTACHMENT_PART_OWN_SOCKETS,
  ATTACHMENT_PART_SOCKETS,
  EQUIPMENT_ASSET_IDS,
  EQUIPMENT_GROUP_NODES,
  EQUIPMENT_SOCKET_NODES,
  equipmentAssetId,
  HANDS_ASSET_ID,
  hasWeaponAsset,
  hasWeaponTemplate,
  KNIFE_ASSET_ID,
  MAGAZINE_EXTENDED_STRETCH,
  SHIELD_ASSET_ID,
  SHIELD_SOCKET_NODES,
  WEAPON_ASSET_IDS,
  WEAPON_ASSET_VERSION,
  WEAPON_GROUP_NODES,
  WEAPON_SOCKET_NODES,
  weaponAssetUrl,
  weaponLodUrl,
} from './WeaponAssetCatalog';

/**
 * The client's description of `public/models/weapons/`, pinned.
 *
 * Two things are checked here and they are not the same thing: that the *lists* say what they
 * say — `check:weapons` holds them to the recipes and would catch an id going missing, but it
 * reads the file as text and says nothing about what the module exports — and that the three
 * questions asked of them answer the way the loader depends on. The shield is the whole reason
 * the second question exists: it has a file, and it is not a weapon template.
 */

const WEAPONS = [
  'ar_carbine',
  'ar_vulcan',
  'ar_halcyon',
  'ar_longbow',
  'smg_wasp',
  'smg_meridian',
  'shotgun_breacher',
  'lmg_bastion',
  'lmg_monolith',
  'sniper_kestrel',
  'sniper_vantage',
  'pistol_talon',
] as const;

const STREAK_WEAPONS = ['streak_minigun', 'streak_flamethrower', 'streak_shield'] as const;

describe('the asset list', () => {
  it('names the arsenal and the three killstreak weapons, in the arsenal order', () => {
    expect([...WEAPON_ASSET_IDS]).toEqual([...WEAPONS, ...STREAK_WEAPONS]);
  });

  it('carries a version, which is what lets a bumped file past a cache', () => {
    expect(WEAPON_ASSET_VERSION).toBe('2026-09-28-lods');
  });

  it('answers for every listed id and for nothing else', () => {
    for (const id of [...WEAPONS, ...STREAK_WEAPONS]) expect(hasWeaponAsset(id)).toBe(true);
    for (const id of ['knife', 'hands', 'att_optic', 'frag', '', 'AR_CARBINE']) {
      expect(hasWeaponAsset(id)).toBe(false);
    }
  });
});

describe('the template question, which is not the asset question', () => {
  it('is true for the twelve loadout weapons and the two streak firearms', () => {
    for (const id of [...WEAPONS, 'streak_minigun', 'streak_flamethrower']) {
      expect(hasWeaponTemplate(id)).toBe(true);
    }
  });

  it('is false for the shield, which has a file and is not a firearm', () => {
    expect(hasWeaponAsset(SHIELD_ASSET_ID)).toBe(true);
    expect(hasWeaponTemplate(SHIELD_ASSET_ID)).toBe(false);
  });

  it('is false for an id with no file at all', () => {
    expect(hasWeaponTemplate('knife')).toBe(false);
    expect(hasWeaponTemplate('nothing_like_it')).toBe(false);
  });
});

describe('the urls', () => {
  it('put the full template and the lod in the same folder, under the same version', () => {
    expect(weaponAssetUrl('ar_carbine')).toBe('/models/weapons/ar_carbine.glb?v=2026-09-28-lods');
    expect(weaponLodUrl('ar_carbine')).toBe('/models/weapons/ar_carbine.lod1.glb?v=2026-09-28-lods');
  });

  it('escape the version rather than paste it, so a bump cannot break the query', () => {
    expect(weaponAssetUrl(SHIELD_ASSET_ID)).toBe('/models/weapons/streak_shield.glb?v=2026-09-28-lods');
    expect(weaponAssetUrl(KNIFE_ASSET_ID)).toBe('/models/weapons/knife.glb?v=2026-09-28-lods');
    expect(weaponAssetUrl(HANDS_ASSET_ID)).toBe('/models/weapons/hands.glb?v=2026-09-28-lods');
  });

  it('ask the same way for an id that has no file; the list is what refuses it, not the url', () => {
    expect(weaponAssetUrl('nothing_like_it')).toBe('/models/weapons/nothing_like_it.glb?v=2026-09-28-lods');
  });
});

describe('the contracts the loader validates against', () => {
  it('names three groups and eight sockets on a weapon file', () => {
    expect(WEAPON_GROUP_NODES).toEqual(['body', 'magazine', 'charge']);
    expect(WEAPON_SOCKET_NODES).toEqual([
      'socket_muzzle',
      'socket_rail_top',
      'socket_rail_bottom',
      'socket_rail_front',
      'socket_sight',
      'socket_grip',
      'socket_support',
      'socket_mag_grip',
    ]);
  });

  it('names two hand points on the shield and nothing else', () => {
    expect(SHIELD_SOCKET_NODES).toEqual(['socket_grip', 'socket_support']);
  });

  it('names a body, a pin and a lever on a piece of equipment, and its two hand points', () => {
    expect(EQUIPMENT_GROUP_NODES).toEqual(['body', 'pin', 'lever']);
    expect(EQUIPMENT_SOCKET_NODES).toEqual(['socket_grip', 'socket_pin']);
  });
});

describe('the attachment pack', () => {
  it('has a part for every attachment that is a thing on the gun', () => {
    expect(ATTACHMENT_PARTS).toEqual({
      optic_reflex: 'att_optic',
      muzzle_suppressor: 'att_suppressor',
      grip_foregrip: 'att_grip',
      laser_tactical: 'att_laser',
    });
    expect(ATTACHMENT_PART_IDS).toEqual(['att_optic', 'att_suppressor', 'att_grip', 'att_laser']);
  });

  it('mounts each part on a socket the weapon contract carries', () => {
    for (const partId of ATTACHMENT_PART_IDS) {
      expect(WEAPON_SOCKET_NODES).toContain(ATTACHMENT_PART_SOCKETS[partId]);
    }
    expect(ATTACHMENT_PART_SOCKETS).toEqual({
      att_optic: 'socket_rail_top',
      att_suppressor: 'socket_muzzle',
      att_grip: 'socket_rail_bottom',
      att_laser: 'socket_rail_front',
    });
  });

  it('gives the optic and the suppressor a socket of their own, and the other two none', () => {
    expect(ATTACHMENT_PART_OWN_SOCKETS).toEqual({
      att_optic: ['socket_sight'],
      att_suppressor: ['socket_muzzle'],
      att_grip: [],
      att_laser: [],
    });
  });

  it('stretches an extended magazine rather than giving it a part', () => {
    expect(MAGAZINE_EXTENDED_STRETCH).toBe(1.4);
    expect(ATTACHMENT_PART_IDS).not.toContain('att_magazine');
  });
});

describe('the equipment map', () => {
  it('names all five, by the id EquipmentDefs uses', () => {
    expect(EQUIPMENT_ASSET_IDS).toEqual({
      frag: 'eq_frag',
      semtex: 'eq_semtex',
      flashbang: 'eq_flashbang',
      smoke: 'eq_smoke',
      claymore: 'eq_claymore',
    });
  });

  it('answers null for a piece of equipment with no file, so the primitive stands in', () => {
    expect(equipmentAssetId('frag')).toBe('eq_frag');
    expect(equipmentAssetId('claymore')).toBe('eq_claymore');
    expect(equipmentAssetId('nothing_like_it')).toBeNull();
    expect(equipmentAssetId('')).toBeNull();
  });

  // Pins current behaviour; suspected bug: BACKLOG #61 (a plain-object lookup answers for
  // Object.prototype's keys). No production caller can reach it: every id comes from
  // `ALL_EQUIPMENT`, and the loader would ask for a url built out of a function.
  it('answers with a function for a key off the prototype chain, rather than null', () => {
    expect(typeof equipmentAssetId('toString')).toBe('function');
    expect(typeof equipmentAssetId('constructor')).toBe('function');
    expect(equipmentAssetId('hasOwnProperty')).not.toBeNull();
  });
});
