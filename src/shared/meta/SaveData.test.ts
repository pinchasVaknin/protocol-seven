import { beforeAll, describe, expect, it } from 'vitest';
import { installLogSink } from '../core/Log';
import { camosEarnedBy } from './Challenges';
import { levelForXp, xpAtLevelStart } from './Levels';
import { DEFAULT_SKIN_ID } from './Skins';
import {
  defaultSettings,
  makeSyntheticV0Save,
  migrateSave,
  normaliseSave,
  SAVE_VERSION,
  type SettingsV1,
} from './SaveData';

/**
 * Characterisation of the migration: a hand-written v1 and v2 save reach `SAVE_VERSION` with
 * the level and the XP they had, the v2 binding repairs happen exactly once, and the synthetic
 * v0 payload `verify/progression.js` migrates in the browser migrates the same way here.
 *
 * The saves are written by hand rather than generated from `defaultSave`, because the point
 * is the shape an *older* build wrote — the fields that did not exist yet are the migration.
 */

/**
 * A level and an XP total that agree on the shipped table, so nothing gets repaired.
 *
 * Read off `Levels.ts` rather than written down here: the pair was `42_000` and `15`, which
 * agreed until the curve was re-priced (2026-09-23) and then described level 9 — three
 * migration tests failing on a number that was never what they were about.
 */
const LEVEL = 15;
const XP = xpAtLevelStart(LEVEL) + 1_000;

function fallback(): SettingsV1 {
  return defaultSettings('TDM', 'mp_foundry', 90);
}

/** The M6/M7 layout: a profile block, but the seven-field settings of M1-M7 and no bindings. */
function saveV1(): Record<string, unknown> {
  return {
    version: 1,
    profile: { level: LEVEL, xp: XP, prestige: 0, unlockTokens: 0, permanentUnlocks: [], matchesPlayed: 12, matchesWon: 7 },
    weapons: { ar_carbine: { xp: 1200, kills: 88, headshots: 9, unlockedAttachments: [] } },
    loadouts: [],
    equippedLoadout: 2,
    challenges: {},
    camos: {},
    settings: { fov: 103, sensitivity: 1.4, invertY: true, masterVolume: 0.3, renderScale: 0.75, modeId: 'DOM', mapId: 'mp_dunes' },
  };
}

/** The M8 layout: the eleven new settings and a binding table, with ADS on the button M8 shipped wrong. */
function saveV2(): Record<string, unknown> {
  return {
    ...saveV1(),
    version: 2,
    settings: {
      fov: 95, sensitivity: 2, invertY: false, masterVolume: 0.7, renderScale: 1, modeId: 'KC', mapId: 'mp_foundry',
      adsSensitivity: 0.6, sfxVolume: 0.5, musicVolume: 0.2, uiVolume: 0.4,
      shadowQuality: 'high', showFps: true, motionBlur: false, colorblind: 'deuteranopia',
      bindings: { ads: ['Mouse1'], use: ['KeyE', 'KeyP'], jump: ['Space'] },
    },
  };
}

beforeAll(() => {
  // The migration reports through the logger; a test run does not want it on the console.
  installLogSink({ log() {} });
});

describe('migrateSave', () => {
  it('lifts a v1 save to SAVE_VERSION with its level and XP intact', () => {
    const out = migrateSave(saveV1(), 1, fallback());
    expect(out).not.toBeNull();
    expect(out?.version).toBe(SAVE_VERSION);
    expect(out?.profile.xp).toBe(XP);
    expect(out?.profile.level).toBe(LEVEL);
    expect(out?.profile.matchesWon).toBe(7);
    expect(out?.weapons['ar_carbine']?.kills).toBe(88);
    expect(out?.equippedLoadout).toBe(2);
  });

  it('derives the v2 audio buses from a v1 master volume and lifts master to 1', () => {
    const out = migrateSave(saveV1(), 1, fallback());
    expect(out?.settings.sfxVolume).toBeCloseTo(0.3, 12);
    expect(out?.settings.musicVolume).toBeCloseTo(0.18, 12);
    expect(out?.settings.uiVolume).toBeCloseTo(0.3, 12);
    expect(out?.settings.masterVolume).toBe(1);
    expect(out?.settings.fov).toBe(103);
    expect(out?.settings.invertY).toBe(true);
    expect(out?.settings.modeId).toBe('DOM');
  });

  it('a v1 save with no bindings gets the shipped defaults, ADS on Mouse2', () => {
    const out = migrateSave(saveV1(), 1, fallback());
    expect(out?.settings.bindings.ads).toEqual(['Mouse2']);
    expect(out?.settings.bindings.use).toEqual(['KeyT', 'KeyE']);
  });

  it('lifts a v2 save to SAVE_VERSION with its level and XP intact and its settings kept', () => {
    const out = migrateSave(saveV2(), 2, fallback());
    expect(out?.version).toBe(SAVE_VERSION);
    expect(out?.profile.xp).toBe(XP);
    expect(out?.profile.level).toBe(LEVEL);
    expect(out?.settings.fov).toBe(95);
    expect(out?.settings.sfxVolume).toBe(0.5);
    expect(out?.settings.masterVolume).toBe(0.7);
    expect(out?.settings.shadowQuality).toBe('high');
    expect(out?.settings.colorblind).toBe('deuteranopia');
    expect(out?.settings.showFps).toBe(true);
  });

  it('v2 -> v3 moves ADS from Mouse1 to Mouse2 and puts KeyT first on use', () => {
    const out = migrateSave(saveV2(), 2, fallback());
    expect(out?.settings.bindings.ads).toEqual(['Mouse2']);
    expect(out?.settings.bindings.use).toEqual(['KeyT', 'KeyE']);
    expect(out?.settings.bindings.jump).toEqual(['Space']);
  });

  it('the v2 -> v3 repair is applied only when coming from below v3', () => {
    const v3 = { ...saveV2(), version: 3 };
    const out = migrateSave(v3, 3, fallback());
    expect(out?.settings.bindings.ads).toEqual(['Mouse1']);
    expect(out?.settings.bindings.use).toEqual(['KeyE', 'KeyP']);
  });

  it('v3 -> v4 dresses the save in the skin it was always shown, and keeps everything else', () => {
    const v3 = { ...saveV2(), version: 3 };
    const out = migrateSave(v3, 3, fallback());
    expect(out?.version).toBe(SAVE_VERSION);
    expect(out?.settings.skin).toBe(DEFAULT_SKIN_ID);
    expect(out?.settings.fov).toBe(95);
    expect(out?.profile.xp).toBe(XP);
  });

  it('a v4 save keeps the skin it names; shared/ checks only that it is a name', () => {
    const v4 = { ...saveV2(), version: 4, settings: { ...(saveV2()['settings'] as object), skin: 'viper' } };
    const out = migrateSave(v4, 4, fallback());
    expect(out?.settings.skin).toBe('viper');
    const blank = { ...v4, settings: { ...(v4.settings as object), skin: '' } };
    expect(migrateSave(blank, 4, fallback())?.settings.skin).toBe(fallback().skin);
  });

  it('migrates the synthetic v0 the way verify/progression.js expects', () => {
    const v0 = makeSyntheticV0Save();
    const out = migrateSave(v0, 0, fallback());
    expect(out?.profile.xp).toBe(42_000);
    expect(out?.profile.level).toBe(levelForXp(42_000));
    expect(out?.profile.prestige).toBe(1);
    expect(out?.weapons['ar_carbine']?.kills).toBe(312);
    expect(out?.weapons['ar_retired_prototype']).toBeUndefined();
    expect(out?.settings.fov).toBe(103);
    expect(out?.loadouts[1]?.primary.weaponId).toBe('smg_wasp');
  });

  it('returns null for something that is not an object', () => {
    expect(migrateSave('nope', 1, fallback())).toBeNull();
    expect(migrateSave(null, 1, fallback())).toBeNull();
  });
});

describe('normaliseSave', () => {
  it('corrects a level the XP does not support and says so', () => {
    const damaged = { ...saveV2(), version: 3, profile: { level: 55, xp: XP } };
    const { save, losses } = normaliseSave(damaged, fallback());
    expect(save.profile.level).toBe(LEVEL);
    expect(losses.some((l) => l.startsWith('profile.level 55 disagreed'))).toBe(true);
  });

  it('drops an unknown weapon and reports it', () => {
    const damaged = { ...saveV2(), version: 3, weapons: { weapon_that_never_existed: { kills: 9 } } };
    const { save, losses } = normaliseSave(damaged, fallback());
    expect(save.weapons['weapon_that_never_existed']).toBeUndefined();
    expect(losses).toContain('dropped stats for unknown weapon "weapon_that_never_existed"');
  });

  it('starts a fresh profile, with a loss line, when handed a non-object', () => {
    const { save, losses } = normaliseSave(42, fallback());
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.profile.level).toBe(1);
    expect(losses).toEqual(['save was not an object; started a fresh profile']);
  });
});

/**
 * v4 to v5: camos stop being an account-wide block and become the earning weapon's.
 *
 * The migration is the rule itself run over what the save already knows, so these are the
 * cases that make "recomputed, not spread" a sentence with a test behind it.
 */
describe('migrateSave, v4 to v5 camos', () => {
  const saveV4 = (weapons: Record<string, unknown>, camos: Record<string, boolean>): Record<string, unknown> => ({
    ...saveV2(),
    version: 4,
    weapons,
    camos,
  });

  it('gives a weapon the camos its own counters earned, and no others', () => {
    const out = migrateSave(
      saveV4({ ar_carbine: { kills: 30, headshots: 2, longshots: 0, multikills: 0 } }, {}),
      4,
      fallback(),
    );
    expect(out?.weapons['ar_carbine']?.camos['digital']).toBe(true);
    expect(out?.weapons['ar_carbine']?.camos['gold']).toBeUndefined();
    expect(out?.weapons['ar_carbine']?.camos['splinter']).toBeUndefined();
  });

  it('does not spread a camo the account owned onto a weapon that never earned it', () => {
    const out = migrateSave(
      saveV4(
        { ar_carbine: { kills: 120, headshots: 20, longshots: 12, multikills: 6 }, smg_wasp: { kills: 3 } },
        { digital: true, gold: true, tiger: true },
      ),
      4,
      fallback(),
    );
    expect(out?.weapons['ar_carbine']?.camos['gold']).toBe(true);
    expect(out?.weapons['smg_wasp']?.camos['digital']).toBeUndefined();
    expect(out?.weapons['smg_wasp']?.camos['gold']).toBeUndefined();
  });

  it('earns OBSIDIAN on the weapon that earned the five under it, and nowhere else', () => {
    const out = migrateSave(
      saveV4(
        {
          ar_carbine: { kills: 100, headshots: 15, longshots: 10, multikills: 5 },
          smg_wasp: { kills: 100, headshots: 15, longshots: 10, multikills: 4 },
        },
        {},
      ),
      4,
      fallback(),
    );
    expect(out?.weapons['ar_carbine']?.camos['obsidian']).toBe(true);
    expect(out?.weapons['smg_wasp']?.camos['obsidian']).toBeUndefined();
    expect(out?.weapons['smg_wasp']?.camos['gold']).toBe(true);
  });

  it('leaves no account-wide camo block behind', () => {
    const out = migrateSave(saveV4({ ar_carbine: { kills: 30 } }, { digital: true }), 4, fallback());
    expect((out as unknown as Record<string, unknown>)['camos']).toBeUndefined();
  });
});

describe('camosEarnedBy', () => {
  const stats = (over: Partial<Record<'kills' | 'headshots' | 'longshots' | 'multikills', number>>) => ({
    kills: 0,
    headshots: 0,
    longshots: 0,
    multikills: 0,
    ...over,
  });

  it('is empty for a weapon nobody has used', () => {
    expect(camosEarnedBy(stats({}))).toEqual([]);
  });

  it('reads each counter against its own bar', () => {
    expect(camosEarnedBy(stats({ kills: 25 }))).toEqual(['digital']);
    expect(camosEarnedBy(stats({ kills: 100 }))).toEqual(['digital', 'gold']);
    expect(camosEarnedBy(stats({ headshots: 15 }))).toEqual(['splinter']);
    expect(camosEarnedBy(stats({ longshots: 10 }))).toEqual(['tiger']);
    expect(camosEarnedBy(stats({ multikills: 5 }))).toEqual(['fractal']);
  });

  it('adds OBSIDIAN only once the five under it are all on the same weapon', () => {
    const four = camosEarnedBy(stats({ kills: 100, headshots: 15, longshots: 10, multikills: 4 }));
    expect(four).not.toContain('obsidian');
    const five = camosEarnedBy(stats({ kills: 100, headshots: 15, longshots: 10, multikills: 5 }));
    expect(five).toContain('obsidian');
  });
});
