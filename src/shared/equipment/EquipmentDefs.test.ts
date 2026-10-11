import { describe, expect, it } from 'vitest';
import { damageAtRange } from '../combat/DamageSystem';
import {
  ALL_EQUIPMENT,
  EQUIPMENT_DEFS,
  SMOKE,
  equipmentDef,
  type EquipmentId,
} from './EquipmentDefs';

/**
 * The arsenal's five records, pinned.
 *
 * The claim this file makes is that **an explosion is a `WeaponDef`** — radial damage goes
 * through `DamageSystem.apply` unchanged, so the number a grenade does to you is computed by the
 * same code as the number a rifle does. That is a claim about the shape of `damageProfile` and
 * about three multipliers being 1, and it is what the assertions below hold still.
 *
 * The authored numbers themselves are pinned because they are balance: S6.3's figures doubled
 * with the health pool (2026-09-23), and a silent edit to one of them is a lethal that stops
 * being lethal.
 */

const IDS: readonly EquipmentId[] = ['frag', 'semtex', 'flashbang', 'smoke', 'claymore'];

describe('the table', () => {
  it('holds the five pieces, and the list and the record agree', () => {
    expect(ALL_EQUIPMENT.map((d) => d.id)).toEqual(['frag', 'semtex', 'flashbang', 'smoke', 'claymore']);
    expect(Object.keys(EQUIPMENT_DEFS)).toEqual(IDS);
    for (const id of IDS) {
      expect(equipmentDef(id).id).toBe(id);
      expect(ALL_EQUIPMENT).toContain(equipmentDef(id));
    }
  });

  it('names the smoke directly as well, which is what spawns a cloud', () => {
    expect(SMOKE).toBe(equipmentDef('smoke'));
  });

  it('splits the slots the way a loadout does', () => {
    expect(ALL_EQUIPMENT.filter((d) => d.slot === 'lethal').map((d) => d.id)).toEqual([
      'frag',
      'semtex',
      'claymore',
    ]);
    expect(ALL_EQUIPMENT.filter((d) => d.slot === 'tactical').map((d) => d.id)).toEqual([
      'flashbang',
      'smoke',
    ]);
  });

  it('gates the bots two-sidedly, by tier index', () => {
    expect(equipmentDef('frag').minBotTier).toBe(1);
    expect(equipmentDef('flashbang').minBotTier).toBe(1);
    expect(equipmentDef('semtex').minBotTier).toBe(2);
    expect(equipmentDef('smoke').minBotTier).toBe(2);
    expect(equipmentDef('claymore').minBotTier).toBe(3);
  });
});

describe('what each piece asks of the thrower', () => {
  it('cooks only the frag and the flashbang, each under its own limit', () => {
    expect(ALL_EQUIPMENT.filter((d) => d.cookable).map((d) => d.id)).toEqual(['frag', 'flashbang']);
    expect(equipmentDef('frag').cookLimit).toBe(3.4);
    expect(equipmentDef('frag').fuseSeconds).toBe(3.5);
    expect(equipmentDef('flashbang').cookLimit).toBe(1.8);
    expect(equipmentDef('flashbang').fuseSeconds).toBe(1.9);
  });

  it('gives the claymore no fuse at all, because a trigger arms it instead', () => {
    const claymore = equipmentDef('claymore');
    expect(claymore.fuseSeconds).toBe(-1);
    expect(claymore.impact).toBe('plant');
    expect(claymore.armSeconds).toBe(1.1);
    expect(claymore.triggerArcDeg).toBe(90);
    expect(claymore.triggerRadius).toBe(3.6);
    expect(claymore.count).toBe(1);
  });

  it('trades the semtex cook for the certainty of where it lands', () => {
    const semtex = equipmentDef('semtex');
    expect(semtex.cookable).toBe(false);
    expect(semtex.impact).toBe('stick');
    expect(semtex.restitution).toBe(0);
    expect(semtex.friction).toBe(0);
    expect(semtex.fuseSeconds).toBe(2.4);
  });

  it('lets the frag roll round a corner, which is the point of it', () => {
    const frag = equipmentDef('frag');
    expect(frag.impact).toBe('bounce');
    expect(frag.restitution).toBeGreaterThan(0);
    expect(frag.friction).toBeGreaterThan(0);
  });

  it('carries two of everything but the claymore', () => {
    for (const def of ALL_EQUIPMENT) {
      expect(def.count).toBe(def.id === 'claymore' ? 1 : 2);
    }
  });
});

describe('the explosion as a weapon', () => {
  it('is absent for anything that does no damage', () => {
    expect(equipmentDef('flashbang').damageProfile).toBe(null);
    expect(equipmentDef('smoke').damageProfile).toBe(null);
  });

  it('cares about no limb, which is why crouching is never worse', () => {
    for (const def of ALL_EQUIPMENT) {
      const profile = def.damageProfile;
      if (profile === null) continue;
      expect(profile.headshotMult).toBe(1);
      expect(profile.limbMult).toBe(1);
      expect(profile.upperTorsoMult).toBe(1);
    }
  });

  it('is a pressure wave, so a riot shield only halves it', () => {
    for (const def of ALL_EQUIPMENT) {
      if (def.damageProfile === null) continue;
      expect(def.damageProfile.explosive).toBe(true);
    }
  });

  it('falls off from the centre to the blast radius through the one damage curve', () => {
    const frag = equipmentDef('frag');
    const profile = frag.damageProfile;
    expect(profile).not.toBe(null);
    if (profile === null) return;
    expect(profile.id).toBe('eq_frag');
    expect(profile.damage).toEqual({ near: 240, far: 12 });
    expect(profile.damageFalloff).toEqual({ start: 0.6, end: frag.effectRadius });
    // The same `damageAtRange` a rifle goes through, with no second damage model.
    expect(damageAtRange(profile, 0)).toBe(240);
    expect(damageAtRange(profile, frag.effectRadius)).toBe(12);
    expect(damageAtRange(profile, 99)).toBe(12);
    expect(damageAtRange(profile, 3)).toBeLessThan(240);
  });

  it('prices the three lethals as the health pool asks', () => {
    expect(equipmentDef('semtex').damageProfile?.damage).toEqual({ near: 260, far: 16 });
    expect(equipmentDef('claymore').damageProfile?.damage).toEqual({ near: 300, far: 40 });
    expect(equipmentDef('frag').effectRadius).toBe(6);
    expect(equipmentDef('semtex').effectRadius).toBe(5.2);
    expect(equipmentDef('claymore').effectRadius).toBe(4.5);
  });

  it('matches each profile radius to the piece it belongs to', () => {
    for (const def of ALL_EQUIPMENT) {
      if (def.damageProfile === null) continue;
      expect(def.damageProfile.damageFalloff.end).toBe(def.effectRadius);
    }
  });

  it('is never held, so nothing about it can reach a player feet or recoil', () => {
    for (const def of ALL_EQUIPMENT) {
      const profile = def.damageProfile;
      if (profile === null) continue;
      expect(profile.moveSpeedMult).toBe(1);
      expect(profile.recoil.kicks).toEqual([]);
      expect(profile.penetration).toBe(0);
      expect(profile.pellets).toBe(1);
      expect(profile.class).toBe('LAUNCHER');
    }
  });
});

describe('the two pieces that are not damage', () => {
  it('blinds for S6.3 three seconds at point blank', () => {
    const flash = equipmentDef('flashbang');
    expect(flash.flashSeconds).toBe(3);
    expect(flash.effectRadius).toBe(11);
    expect(flash.smokeSeconds).toBe(0);
  });

  it('makes a cloud that blooms, and nothing else', () => {
    expect(SMOKE.smokeSeconds).toBe(12);
    expect(SMOKE.smokeRadius).toBe(4.2);
    expect(SMOKE.smokeBloom).toBe(1.6);
    expect(SMOKE.flashSeconds).toBe(0);
    expect(SMOKE.effectRadius).toBe(0);
  });

  it('is the only two with no flash and no smoke anywhere else', () => {
    expect(ALL_EQUIPMENT.filter((d) => d.flashSeconds > 0).map((d) => d.id)).toEqual(['flashbang']);
    expect(ALL_EQUIPMENT.filter((d) => d.smokeSeconds > 0).map((d) => d.id)).toEqual(['smoke']);
  });
});
