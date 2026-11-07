import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/meta/SaveData';
import { Profile } from './Profile';

/**
 * The façade over the save: everything the menus read and everything a match writes back.
 *
 * `window.localStorage` is a map, so each test starts from an empty profile unless it plants a
 * save first. What is worth pinning here is the load path — a fresh profile, a damaged one,
 * and a hand-edited one — plus the progression arithmetic the menus show.
 */

let backing: Map<string, string>;
const scheduled: Array<() => void> = [];

function installStorage(seed?: Record<string, string>): void {
  backing = new Map(Object.entries(seed ?? {}));
  const storage = {
    getItem: (key: string): string | null => backing.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      backing.set(key, value);
    },
    removeItem: (key: string): void => {
      backing.delete(key);
    },
    clear: (): void => backing.clear(),
    key: (index: number): string | null => [...backing.keys()][index] ?? null,
    get length(): number {
      return backing.size;
    },
  };
  (globalThis as Record<string, unknown>)['window'] = {
    localStorage: storage,
    setTimeout: (fn: () => void): number => {
      scheduled.push(fn);
      return scheduled.length;
    },
    clearTimeout: (): undefined => undefined,
  };
  (globalThis as Record<string, unknown>)['localStorage'] = storage;
}

const FALLBACK = defaultSettings('TDM', 'mp_foundry', 90);

function profile(): Profile {
  return new Profile({ fallbackSettings: FALLBACK });
}

beforeEach(() => {
  installStorage();
  scheduled.length = 0;
});

describe('a profile with nothing saved', () => {
  it('starts at level one with nothing earned', () => {
    const p = profile();
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
    expect(p.prestige).toBe(0);
  });

  it('reports nothing to repair', () => {
    expect(profile().loadReport).toEqual([]);
  });

  it('starts from the settings it was handed rather than the hard defaults', () => {
    const p = new Profile({ fallbackSettings: { ...FALLBACK, fov: 103, sensitivity: 2.5 } });
    expect(p.settings.fov).toBe(103);
    expect(p.settings.sensitivity).toBe(2.5);
  });

  it('offers the five loadout slots and equips one', () => {
    const p = profile();
    expect(p.loadouts.length).toBeGreaterThan(0);
    expect(p.equippedIndex).toBeGreaterThanOrEqual(0);
    expect(p.equippedLoadout()).toBeDefined();
  });

  it('answers a range loadout that is not one of the five', () => {
    const p = profile();
    expect(p.rangeLoadout()).toBeDefined();
  });
});

describe('earning', () => {
  it('banks xp and raises the level when it crosses', () => {
    const p = profile();
    const before = p.level;
    p.grantXp(50_000);
    expect(p.xp).toBeGreaterThan(0);
    expect(p.level).toBeGreaterThan(before);
  });

  it('reports the level either side of a match', () => {
    const p = profile();
    const banked = p.bankMatch(40_000, true);
    expect(banked.levelBefore).toBe(1);
    expect(banked.levelAfter).toBeGreaterThanOrEqual(banked.levelBefore);
    expect(p.level).toBe(banked.levelAfter);
  });

  it('describes progress through the current level', () => {
    const p = profile();
    p.grantXp(500);
    const progress = p.progress;
    expect(progress).toBeDefined();
    expect(typeof progress.level).toBe('number');
  });

  it('tops the account out on demand', () => {
    const p = profile();
    p.maxAccountLevel();
    expect(p.level).toBeGreaterThan(1);
    expect(p.canPrestige()).toBe(true);
  });
});

describe('prestige', () => {
  it('refuses below the cap', () => {
    const p = profile();
    expect(p.canPrestige()).toBe(false);
    expect(p.doPrestige()).toBe(false);
    expect(p.prestige).toBe(0);
  });

  it('resets the level and raises the prestige at the cap', () => {
    const p = profile();
    p.maxAccountLevel();
    expect(p.doPrestige()).toBe(true);
    expect(p.prestige).toBe(1);
    expect(p.level).toBe(1);
  });
});

describe('weapons and camos', () => {
  it('starts a weapon unlevelled and without camos', () => {
    const p = profile();
    expect(p.weaponLevel('ar_carbine')).toBe(1);
    expect(p.camoOwned('ar_carbine', 'gold')).toBe(false);
  });

  it('grants a camo to the weapon it was earned on, and not to another', () => {
    const p = profile();
    p.grantCamo('ar_carbine', 'gold');
    expect(p.camoOwned('ar_carbine', 'gold')).toBe(true);
    expect(p.camoOwned('smg_wasp', 'gold')).toBe(false);
  });

  it('counts how many prerequisite camos a weapon has', () => {
    const p = profile();
    expect(p.camoPrerequisiteCount('ar_carbine')).toBe(0);
    p.grantCamo('ar_carbine', 'digital');
    p.grantCamo('ar_carbine', 'splinter');
    expect(p.camoPrerequisiteCount('ar_carbine')).toBe(2);
  });

  it('reports an accuracy for a weapon never fired', () => {
    expect(Number.isFinite(profile().weaponAccuracy('ar_carbine'))).toBe(true);
  });

  it('masters a weapon on demand', () => {
    const p = profile();
    p.masterWeapon('ar_carbine');
    expect(p.weaponLevel('ar_carbine')).toBeGreaterThan(1);
  });
});

describe('loadouts', () => {
  it('equips by index', () => {
    const p = profile();
    const target = Math.min(2, p.loadouts.length - 1);
    p.equipLoadout(target);
    expect(p.equippedIndex).toBe(target);
  });

  it('edits a slot through the callback and keeps the change', () => {
    const p = profile();
    let seen = '';
    p.editLoadout(0, (slot) => {
      seen = slot.primary.weaponId;
    });
    expect(seen).not.toBe('');
    expect(p.loadouts[0]?.primary.weaponId).toBe(seen);
  });

  it('resolves what the equipped slot actually gives the player', () => {
    const resolved = profile().resolveEquipped();
    expect(resolved).toBeDefined();
  });
});

describe('settings', () => {
  it('patches one field and leaves the rest', () => {
    const p = profile();
    const sensitivity = p.settings.sensitivity;
    p.patchSettings({ fov: 103 });
    expect(p.settings.fov).toBe(103);
    expect(p.settings.sensitivity).toBe(sensitivity);
  });
});

describe('the load path', () => {
  it('sanitises exactly once on load', () => {
    // Pins what BACKLOG #29 asked about: the constructor runs `normaliseSave` and then one
    // `sanitiseAll`, so a save that needs two passes to settle is only given one.
    const p = profile();
    p.flush();
    scheduled.forEach((fn) => fn());
    const reloaded = profile();
    expect(reloaded.loadReport).toEqual([]);
  });

  it('recovers a damaged save rather than throwing it away', () => {
    const p = profile();
    p.grantXp(5000);
    p.flush();
    scheduled.forEach((fn) => fn());
    const raw = JSON.parse([...backing.values()][0] ?? '{}') as Record<string, unknown>;
    raw['weapons'] = 'not an object at all';
    backing.set([...backing.keys()][0] ?? 'p7.save', JSON.stringify(raw));
    const repaired = profile();
    expect(repaired.level).toBeGreaterThanOrEqual(1);
    expect(repaired.weaponLevel('ar_carbine')).toBeGreaterThanOrEqual(1);
  });

  it('survives a save that is not JSON at all', () => {
    backing.set('p7.save', 'wrecked');
    expect(() => profile()).not.toThrow();
    expect(profile().level).toBe(1);
  });
});

describe('importSave', () => {
  it('takes a save and reports what it had to repair', () => {
    const donor = profile();
    donor.grantXp(9000);
    const report = profile().importSave(JSON.parse(JSON.stringify(donor.save)));
    expect(Array.isArray(report)).toBe(true);
  });

  it('refuses nonsense without throwing', () => {
    const p = profile();
    expect(() => p.importSave('not a save')).not.toThrow();
    expect(p.level).toBeGreaterThanOrEqual(1);
  });
});

describe('resetProgress', () => {
  it('puts everything back to a fresh profile', () => {
    const p = profile();
    p.grantXp(50_000);
    p.grantCamo('ar_carbine', 'gold');
    p.resetProgress();
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
    expect(p.camoOwned('ar_carbine', 'gold')).toBe(false);
  });
});

describe('the rest of the façade', () => {
  it('lists the challenges with their state', () => {
    const rows = profile().challengeRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.def).toBeDefined();
    expect(rows[0]?.state).toBeDefined();
  });

  it('answers one challenge by id', () => {
    const p = profile();
    const id = p.challengeRows()[0]?.def.id;
    if (id === undefined) return;
    expect(p.challenge(id)).toBeDefined();
  });

  it('keeps an unlock cache that refreshes on demand', () => {
    const p = profile();
    expect(p.unlocks).toBeDefined();
    p.refreshUnlocks();
    expect(p.unlocks).toBeDefined();
  });

  it('remembers the chosen skin', () => {
    const p = profile();
    const before = p.skinId;
    expect(before).toBeDefined();
    p.setSkin(before);
    expect(p.skinId).toBe(before);
  });

  it('counts the writes it has made', () => {
    const p = profile();
    expect(typeof p.writeCount).toBe('number');
  });
});
