import { beforeAll, describe, expect, it } from 'vitest';
import { installLogSink } from '../core/Log';
import { camosEarnedBy } from './Challenges';
import { levelForXp, xpAtLevelStart } from './Levels';
import { DEFAULT_SKIN_ID } from './Skins';
import { defaultBindings } from '../core/Keybinds';
import { PRESTIGE_MAX } from './Levels';
import { defaultLoadouts, LOADOUT_SLOT_COUNT } from './Loadouts';
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

/**
 * The repair, block by block (A19).
 *
 * `normaliseSave` is the **one door** a stored save comes through, and A19 breaks its 145 lines
 * into seven named blocks. Two things make that riskier than it looks.
 *
 * The first is that no oracle sees it: nothing in the SIM set loads a save with junk in it, so
 * these tests are the whole of the protection.
 *
 * The second is that **the loss lines are observable output**, not diagnostics —
 * `Profile.loadReport` shows them to the player and `SaveInspector` returns them — so the exact
 * wording is behaviour under R1. Every assertion below that matches a string is matching it on
 * purpose, word for word.
 *
 * The saves are hand-written records rather than `defaultSave` output, for the reason the suite
 * above gives: the point is the shape some *other* build, or a hand-edit, wrote.
 */

/** A legal save, as `normaliseSave` would leave it, to be broken one field at a time. */
function wholeSave(): Record<string, unknown> {
  return {
    version: SAVE_VERSION,
    profile: {
      level: LEVEL,
      xp: XP,
      prestige: 1,
      unlockTokens: 2,
      permanentUnlocks: ['ar_vulcan'],
      matchesPlayed: 40,
      matchesWon: 21,
    },
    weapons: {},
    loadouts: [{}, {}, {}, {}, {}],
    equippedLoadout: 0,
    challenges: {},
    settings: {},
  };
}

/** The five slots a clean save holds, with `first` in slot one. */
function slots(first: Record<string, unknown>): Record<string, unknown>[] {
  return [first, {}, {}, {}, {}];
}

/** Repair `raw` and hand back both halves. */
function repair(raw: unknown) {
  return normaliseSave(raw, fallback());
}

describe('normaliseSave: the profile block', () => {
  it('keeps a profile that agrees with itself, and reports nothing about it', () => {
    const { save, losses } = repair(wholeSave());
    expect(save.profile.xp).toBe(XP);
    expect(save.profile.level).toBe(LEVEL);
    expect(save.profile.prestige).toBe(1);
    expect(save.profile.unlockTokens).toBe(2);
    expect(save.profile.matchesPlayed).toBe(40);
    expect(save.profile.matchesWon).toBe(21);
    expect(save.profile.permanentUnlocks).toEqual(['ar_vulcan']);
    expect(losses.filter((l) => l.startsWith('profile'))).toEqual([]);
  });

  it('reports a non-numeric xp and resets it, naming what it found', () => {
    const raw = wholeSave();
    (raw['profile'] as Record<string, unknown>)['xp'] = 'lots';
    const { save, losses } = repair(raw);
    expect(save.profile.xp).toBe(0);
    expect(losses).toContain('profile.xp was "lots"; reset to 0');
  });

  it('reports an xp of NaN the same way, because NaN is not a finite number', () => {
    const raw = wholeSave();
    (raw['profile'] as Record<string, unknown>)['xp'] = Number.NaN;
    const { save, losses } = repair(raw);
    expect(save.profile.xp).toBe(0);
    expect(losses).toContain('profile.xp was null; reset to 0');
  });

  it('floors a negative xp at zero', () => {
    const raw = wholeSave();
    (raw['profile'] as Record<string, unknown>)['xp'] = -5000;
    expect(repair(raw).save.profile.xp).toBe(0);
  });

  it('derives the level from the XP and never trusts the claim', () => {
    const raw = wholeSave();
    (raw['profile'] as Record<string, unknown>)['level'] = 55;
    (raw['profile'] as Record<string, unknown>)['xp'] = 0;
    const { save, losses } = repair(raw);
    expect(save.profile.level).toBe(1);
    expect(losses).toContain('profile.level 55 disagreed with 0 XP; corrected to 1');
  });

  it('says nothing when the claim happens to be right', () => {
    const { losses } = repair(wholeSave());
    expect(losses.some((l) => l.includes('disagreed'))).toBe(false);
  });

  it('caps the prestige at PRESTIGE_MAX and rounds it', () => {
    const raw = wholeSave();
    (raw['profile'] as Record<string, unknown>)['prestige'] = 99;
    expect(repair(raw).save.profile.prestige).toBe(PRESTIGE_MAX);

    const fractional = wholeSave();
    (fractional['profile'] as Record<string, unknown>)['prestige'] = 2.6;
    expect(repair(fractional).save.profile.prestige).toBe(3);
  });

  it('rounds the counters and floors them at zero', () => {
    const raw = wholeSave();
    Object.assign(raw['profile'] as Record<string, unknown>, {
      unlockTokens: -3,
      matchesPlayed: 12.7,
      matchesWon: -1,
    });
    const { save } = repair(raw);
    expect(save.profile.unlockTokens).toBe(0);
    expect(save.profile.matchesPlayed).toBe(13);
    expect(save.profile.matchesWon).toBe(0);
  });

  it('keeps only the strings out of permanentUnlocks', () => {
    const raw = wholeSave();
    (raw['profile'] as Record<string, unknown>)['permanentUnlocks'] = ['ar_vulcan', 7, null, 'smg_wasp'];
    expect(repair(raw).save.profile.permanentUnlocks).toEqual(['ar_vulcan', 'smg_wasp']);
  });

  it('leaves permanentUnlocks alone when it is not an array at all', () => {
    const raw = wholeSave();
    (raw['profile'] as Record<string, unknown>)['permanentUnlocks'] = 'ar_vulcan';
    expect(repair(raw).save.profile.permanentUnlocks).toEqual([]);
  });

  it('reports a missing profile block and starts at level 1', () => {
    const raw = wholeSave();
    delete raw['profile'];
    const { save, losses } = repair(raw);
    expect(save.profile.level).toBe(1);
    expect(save.profile.xp).toBe(0);
    expect(losses).toContain('profile block missing or malformed; reset to level 1');
  });

  it('reports an array in the profile’s place, which is not a record', () => {
    const raw = wholeSave();
    raw['profile'] = [1, 2, 3];
    expect(repair(raw).losses).toContain('profile block missing or malformed; reset to level 1');
  });
});

describe('normaliseSave: the weapons block', () => {
  it('keeps every counter a known weapon holds', () => {
    const raw = wholeSave();
    raw['weapons'] = {
      ar_carbine: {
        xp: 1200,
        kills: 88,
        headshots: 9,
        shotsFired: 500,
        shotsHit: 210,
        longestShot: 61.5,
        timeUsed: 900,
        longshots: 4,
        multikills: 2,
      },
    };
    const { save, losses } = repair(raw);
    const weapon = save.weapons['ar_carbine'];
    expect(weapon?.xp).toBe(1200);
    expect(weapon?.kills).toBe(88);
    expect(weapon?.headshots).toBe(9);
    expect(weapon?.shotsFired).toBe(500);
    expect(weapon?.shotsHit).toBe(210);
    expect(weapon?.longestShot).toBe(61.5);
    expect(weapon?.timeUsed).toBe(900);
    expect(weapon?.longshots).toBe(4);
    expect(weapon?.multikills).toBe(2);
    expect(losses).toEqual([]);
  });

  it('drops a weapon the build does not ship, and names it', () => {
    const raw = wholeSave();
    raw['weapons'] = { ar_retired: { kills: 10 } };
    const { save, losses } = repair(raw);
    expect(save.weapons['ar_retired']).toBe(undefined);
    expect(losses).toContain('dropped stats for unknown weapon "ar_retired"');
  });

  it('resets a weapon whose record is not a record, and says what it held', () => {
    const raw = wholeSave();
    raw['weapons'] = { ar_carbine: 42 };
    const { save, losses } = repair(raw);
    expect(save.weapons['ar_carbine']?.kills).toBe(0);
    expect(losses).toContain('weapon "ar_carbine" held 42 instead of a record; stats reset');
  });

  it('rounds the whole-number counters and floors every one at zero', () => {
    const raw = wholeSave();
    raw['weapons'] = { ar_carbine: { kills: 8.6, headshots: -2, xp: -100, longestShot: -3 } };
    const { save } = repair(raw);
    const weapon = save.weapons['ar_carbine'];
    expect(weapon?.kills).toBe(9);
    expect(weapon?.headshots).toBe(0);
    expect(weapon?.xp).toBe(0);
    expect(weapon?.longestShot).toBe(0);
  });

  it('keeps only camos it owns as true, and drops an unknown one by name', () => {
    const raw = wholeSave();
    raw['weapons'] = {
      ar_carbine: { camos: { gold: true, digital: false, chrome: true } },
    };
    const { save, losses } = repair(raw);
    expect(save.weapons['ar_carbine']?.camos.gold).toBe(true);
    expect(save.weapons['ar_carbine']?.camos.digital).toBe(undefined);
    expect(losses).toContain('dropped unknown camo "chrome" on ar_carbine');
  });

  it('keeps the attachments it knows and drops the rest by name', () => {
    const raw = wholeSave();
    raw['weapons'] = { ar_carbine: { unlockedAttachments: ['optic_reflex', 'raygun', 7] } };
    const { save, losses } = repair(raw);
    expect(save.weapons['ar_carbine']?.unlockedAttachments).toEqual(['optic_reflex']);
    expect(losses).toContain('dropped unknown attachment "raygun" on ar_carbine');
    expect(losses).toContain('dropped unknown attachment "7" on ar_carbine');
  });

  it('reports a missing weapons block', () => {
    const raw = wholeSave();
    delete raw['weapons'];
    expect(repair(raw).losses).toContain('weapons block missing or malformed; weapon progress reset');
  });
});

describe('normaliseSave: the challenges block', () => {
  it('keeps the progress of a live challenge', () => {
    const raw = wholeSave();
    raw['challenges'] = { first_blood: { progress: 1, completed: true } };
    const { save, losses } = repair(raw);
    expect(save.challenges['first_blood']).toEqual({ progress: 1, completed: true });
    expect(losses).toEqual([]);
  });

  it('drops a challenge the build has retired, and names it', () => {
    const raw = wholeSave();
    raw['challenges'] = { old_challenge: { progress: 3 } };
    const { save, losses } = repair(raw);
    expect(save.challenges['old_challenge']).toBe(undefined);
    expect(losses).toContain('dropped progress for retired challenge "old_challenge"');
  });

  it('rounds the progress, floors it, and treats anything but true as not completed', () => {
    const raw = wholeSave();
    raw['challenges'] = { first_blood: { progress: -4, completed: 'yes' } };
    const { save } = repair(raw);
    expect(save.challenges['first_blood']?.progress).toBe(0);
    expect(save.challenges['first_blood']?.completed).toBe(false);
  });

  it('leaves a challenge alone when its value is not a record, without a loss line', () => {
    const raw = wholeSave();
    raw['challenges'] = { first_blood: 'done' };
    const { save, losses } = repair(raw);
    expect(save.challenges['first_blood']?.progress).toBe(0);
    expect(losses).toEqual([]);
  });
});

describe('normaliseSave: the loadout slots', () => {
  it('reports a save holding the wrong number of slots, and resizes it', () => {
    const raw = wholeSave();
    raw['loadouts'] = [{}, {}];
    const { save, losses } = repair(raw);
    expect(save.loadouts).toHaveLength(LOADOUT_SLOT_COUNT);
    expect(losses).toContain(`save held 2 loadouts; resized to ${LOADOUT_SLOT_COUNT}`);
  });

  it('reports loadouts that are missing entirely', () => {
    const raw = wholeSave();
    delete raw['loadouts'];
    const { save, losses } = repair(raw);
    expect(save.loadouts).toHaveLength(LOADOUT_SLOT_COUNT);
    expect(losses).toContain('loadouts missing or malformed; restored the shipped five');
  });

  it('truncates a slot name at sixteen characters', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ name: 'A VERY LONG CLASS NAME INDEED' });
    expect(repair(raw).save.loadouts[0]?.name).toBe('A VERY LONG CLAS');
  });

  it('names the slot it is complaining about, one-based', () => {
    const raw = wholeSave();
    raw['loadouts'] = [{}, {}, { lethal: 'rocket' }, {}, {}];
    expect(repair(raw).losses).toContain('loadout 3 lethal "rocket" unknown');
  });

  it('reports an unknown lethal, tactical and field upgrade, each in its own words', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ lethal: 'rocket', tactical: 'siren', fieldUpgrade: 'jetpack' });
    const { losses } = repair(raw);
    expect(losses).toContain('loadout 1 lethal "rocket" unknown');
    expect(losses).toContain('loadout 1 tactical "siren" unknown');
    expect(losses).toContain('loadout 1 field upgrade "jetpack" unknown');
  });

  it('keeps a legal lethal, tactical and field upgrade', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ lethal: 'semtex', tactical: 'smoke', fieldUpgrade: 'stim' });
    const { save, losses } = repair(raw);
    expect(save.loadouts[0]?.lethal).toBe('semtex');
    expect(save.loadouts[0]?.tactical).toBe('smoke');
    expect(save.loadouts[0]?.fieldUpgrade).toBe('stim');
    expect(losses).toEqual([]);
  });

  it('says nothing about equipment the save simply does not mention', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ name: 'PLAIN' });
    expect(repair(raw).losses).toEqual([]);
  });

  it('drops an unknown killstreak and reports it', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ streaks: ['uav', 'nuke', null] });
    const { save, losses } = repair(raw);
    expect(save.loadouts[0]?.streaks).toEqual(['uav', null, null]);
    expect(losses).toContain('loadout 1 killstreak "nuke" unknown');
  });

  it('keeps the first of a killstreak on two keys and reports the second', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ streaks: ['uav', 'uav', 'sentry'] });
    const { save, losses } = repair(raw);
    expect(save.loadouts[0]?.streaks).toEqual(['uav', null, 'sentry']);
    expect(losses).toContain('loadout 1 had uav on two keys; removed the second');
  });

  it('leaves the class default when the streak array is absent, because an upgrade is not a loss', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ name: 'PRE-STREAKS' });
    const { save, losses } = repair(raw);
    expect(save.loadouts[0]?.streaks).toEqual(defaultLoadouts()[0]?.streaks);
    expect(losses).toEqual([]);
  });

  it('removes a perk saved in the wrong tier and names it', () => {
    const raw = wholeSave();
    // GHOST is tier 2; here it sits in the tier-1 slot.
    raw['loadouts'] = slots({ perks: ['ghost', null, null] });
    const { save, losses } = repair(raw);
    expect(save.loadouts[0]?.perks).toEqual([null, null, null]);
    expect(losses).toContain('loadout 1 had GHOST in tier 1; removed');
  });

  it('keeps a perk in its own tier', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ perks: ['lightweight', 'ghost', 'quickdraw'] });
    const { save, losses } = repair(raw);
    expect(save.loadouts[0]?.perks).toEqual(['lightweight', 'ghost', 'quickdraw']);
    expect(losses).toEqual([]);
  });

  it('drops an unknown perk and names what it was', () => {
    const raw = wholeSave();
    raw['loadouts'] = slots({ perks: ['juggernaut', null, null] });
    const { losses } = repair(raw);
    expect(losses).toContain('loadout 1 perk "juggernaut" unknown');
  });

  it('repairs the Shooting Range’s own class through the same door', () => {
    const raw = wholeSave();
    raw['rangeLoadout'] = { lethal: 'rocket', perks: ['lightweight', null, null] };
    const { save, losses } = repair(raw);
    expect(save.rangeLoadout?.name).toBe('RANGE');
    expect(save.rangeLoadout?.perks).toEqual(['lightweight', null, null]);
    // Reported against slot 1, because it goes through `normaliseSlot` with index 0.
    expect(losses).toContain('loadout 1 lethal "rocket" unknown');
  });

  it('lets a stored range name win over the RANGE label', () => {
    // Pins current behaviour; suspected bug: the range class's RANGE label is overwritten by
    // the save. `normaliseSave` assigns `slot.name = 'RANGE'` and then calls `normaliseSlot`,
    // which takes `source['name']` whenever the save has one — so the label only survives for
    // a save that stored no name. Harmless for a save this build wrote (it stores 'RANGE'),
    // and wrong for any other.
    const raw = wholeSave();
    raw['rangeLoadout'] = { name: 'IGNORED' };
    expect(repair(raw).save.rangeLoadout?.name).toBe('IGNORED');
  });

  it('leaves the range class absent when the save has none', () => {
    const { save } = repair(wholeSave());
    expect(save.rangeLoadout).toBe(undefined);
  });

  it('clamps the equipped index into the five slots', () => {
    for (const [given, expected] of [
      [0, 0],
      [4, 4],
      [9, LOADOUT_SLOT_COUNT - 1],
      [-3, 0],
      [2.7, 3],
    ] as const) {
      const raw = wholeSave();
      raw['equippedLoadout'] = given;
      expect(repair(raw).save.equippedLoadout, `given ${given}`).toBe(expected);
    }
  });

  it('falls back to the first slot when the index is not a number', () => {
    const raw = wholeSave();
    raw['equippedLoadout'] = 'second';
    expect(repair(raw).save.equippedLoadout).toBe(0);
  });
});

describe('normaliseSave: the settings block', () => {
  it('falls back field by field, which is what lets an old save gain new settings', () => {
    const raw = wholeSave();
    raw['settings'] = { fov: 100 };
    const { save } = repair(raw);
    const defaults = fallback();
    expect(save.settings.fov).toBe(100);
    expect(save.settings.sensitivity).toBe(defaults.sensitivity);
    expect(save.settings.shadowQuality).toBe(defaults.shadowQuality);
    expect(save.settings.botDifficulty).toBe(defaults.botDifficulty);
    expect(save.settings.colorblind).toBe(defaults.colorblind);
  });

  it('clamps the numeric settings into their own ranges', () => {
    const raw = wholeSave();
    raw['settings'] = {
      fov: 400,
      sensitivity: 99,
      renderScale: 0.1,
      adsSensitivity: 50,
      masterVolume: 5,
      sfxVolume: -1,
    };
    const { save } = repair(raw);
    expect(save.settings.fov).toBe(120);
    expect(save.settings.sensitivity).toBe(10);
    expect(save.settings.renderScale).toBe(0.5);
    expect(save.settings.adsSensitivity).toBe(2);
    expect(save.settings.masterVolume).toBe(1);
    expect(save.settings.sfxVolume).toBe(0);
  });

  it('clamps from the other side too', () => {
    const raw = wholeSave();
    raw['settings'] = { fov: 10, sensitivity: 0, renderScale: 4, adsSensitivity: 0 };
    const { save } = repair(raw);
    expect(save.settings.fov).toBe(60);
    expect(save.settings.sensitivity).toBe(0.05);
    expect(save.settings.renderScale).toBe(1);
    expect(save.settings.adsSensitivity).toBe(0.1);
  });

  it('takes a closed-list setting only from its own list', () => {
    const raw = wholeSave();
    raw['settings'] = { shadowQuality: 'ultra', colorblind: 'none', botDifficulty: 'nightmare' };
    const { save } = repair(raw);
    const defaults = fallback();
    expect(save.settings.shadowQuality).toBe(defaults.shadowQuality);
    expect(save.settings.colorblind).toBe(defaults.colorblind);
    expect(save.settings.botDifficulty).toBe(defaults.botDifficulty);
  });

  it('keeps a legal closed-list value', () => {
    const raw = wholeSave();
    raw['settings'] = { shadowQuality: 'off', colorblind: 'tritanopia' };
    const { save } = repair(raw);
    expect(save.settings.shadowQuality).toBe('off');
    expect(save.settings.colorblind).toBe('tritanopia');
  });

  it('treats the booleans as true only when they are literally true', () => {
    const raw = wholeSave();
    raw['settings'] = { invertY: 'yes', showFps: 1, motionBlur: true };
    const { save } = repair(raw);
    expect(save.settings.invertY).toBe(false);
    expect(save.settings.showFps).toBe(false);
    expect(save.settings.motionBlur).toBe(true);
  });

  it('generates a callsign rather than leaving a pre-M11 save blank', () => {
    // One settings object, reused: `generateCallsign` takes its entropy from the clock, so two
    // calls to `fallback()` only agree inside the same millisecond.
    const defaults = fallback();
    const blank = wholeSave();
    blank['settings'] = { callsign: '   ' };
    expect(normaliseSave(blank, defaults).save.settings.callsign).toBe(defaults.callsign);

    const missing = wholeSave();
    missing['settings'] = {};
    expect(normaliseSave(missing, defaults).save.settings.callsign).toBe(defaults.callsign);
  });

  it('truncates a callsign at twenty characters and a skin at thirty-two', () => {
    const raw = wholeSave();
    raw['settings'] = { callsign: 'X'.repeat(40), skin: 'Y'.repeat(60) };
    const { save } = repair(raw);
    expect(save.settings.callsign).toHaveLength(20);
    expect(save.settings.skin).toHaveLength(32);
  });

  it('keeps the mode and map only when they are strings', () => {
    const raw = wholeSave();
    raw['settings'] = { modeId: 'SND', mapId: 7 };
    const { save } = repair(raw);
    expect(save.settings.modeId).toBe('SND');
    expect(save.settings.mapId).toBe(fallback().mapId);
  });

  it('restores every binding the save never heard of', () => {
    const raw = wholeSave();
    raw['settings'] = { bindings: { jump: ['KeyJ'] } };
    const { save } = repair(raw);
    expect(save.settings.bindings.jump).toEqual(['KeyJ']);
    // A pre-M8 save comes back fully bound rather than with dead killstreak keys.
    expect(Object.keys(save.settings.bindings).sort()).toEqual(Object.keys(defaultBindings()).sort());
  });

  it('leaves the fallbacks in place when the settings block is missing', () => {
    const defaults = fallback();
    const raw = wholeSave();
    delete raw['settings'];
    const { save } = normaliseSave(raw, defaults);
    expect(save.settings.fov).toBe(defaults.fov);
    expect(save.settings.callsign).toBe(defaults.callsign);
  });
});

describe('normaliseSave as a whole', () => {
  it('is idempotent: repairing a repaired save changes nothing and reports nothing', () => {
    const first = repair({ profile: { xp: 'junk' }, weapons: { nope: {} }, loadouts: [{}] });
    const second = normaliseSave(first.save, fallback());
    expect(second.losses).toEqual([]);
    expect(second.save).toEqual(first.save);
  });

  it('reports every repair it made, in one list', () => {
    const { losses } = repair({
      profile: { xp: 'junk', level: 40 },
      weapons: { ar_retired: {} },
      challenges: { gone: {} },
      loadouts: slots({ lethal: 'rocket' }),
    });
    expect(losses.length).toBeGreaterThan(3);
    for (const line of losses) expect(typeof line).toBe('string');
  });

  it('never throws, whatever it is handed', () => {
    for (const raw of [null, undefined, 7, 'save', [], [1, 2], { profile: null }, {}]) {
      expect(() => repair(raw), JSON.stringify(raw ?? null)).not.toThrow();
    }
  });
});
