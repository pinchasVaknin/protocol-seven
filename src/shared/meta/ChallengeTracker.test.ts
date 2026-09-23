import { describe, expect, it } from 'vitest';
import { ChallengeTracker } from './ChallengeTracker';
import type { CamoId } from './Camos';
import type { ChallengeId } from './Challenges';
import { defaultSettings, defaultSave, makeWeaponSave, type ChallengeSaveData, type SaveV2, type WeaponSaveData } from './SaveData';
import type { ProgressionStore } from './ProgressionStore';

/**
 * The two awards a camo challenge pays, and who each belongs to (playtest, 2026-09-23).
 *
 * The **challenge** is the account's: "25 kills with a single weapon" completes once and pays
 * its XP once, however many weapons go on to do it. The **camo** is the weapon's: every weapon
 * whose own counters reach the bar wears it, and no weapon wears one it did not earn. Those two
 * sentences used to be one, which is the bug — one gun's 25 kills painted the whole armoury.
 */
class FakeStore implements ProgressionStore {
  readonly save: SaveV2;

  constructor(weapons: Record<string, Partial<WeaponSaveData>>) {
    this.save = defaultSave(defaultSettings('TDM', 'mp_foundry', 90));
    this.save.weapons = {};
    for (const [id, stats] of Object.entries(weapons)) {
      this.save.weapons[id] = { ...makeWeaponSave(), ...stats, camos: { ...(stats.camos ?? {}) } };
    }
  }

  get xp(): number {
    return this.save.profile.xp;
  }

  get prestige(): number {
    return this.save.profile.prestige;
  }

  weapon(weaponId: string): WeaponSaveData {
    const existing = this.save.weapons[weaponId];
    if (existing !== undefined) return existing;
    const fresh = makeWeaponSave();
    this.save.weapons[weaponId] = fresh;
    return fresh;
  }

  challenge(id: ChallengeId): ChallengeSaveData {
    const existing = this.save.challenges[id];
    if (existing !== undefined) return existing;
    const fresh: ChallengeSaveData = { progress: 0, completed: false };
    this.save.challenges[id] = fresh;
    return fresh;
  }

  camoOwned(weaponId: string, id: CamoId): boolean {
    return this.weapon(weaponId).camos[id] === true;
  }

  grantCamo(weaponId: string, id: CamoId): void {
    this.weapon(weaponId).camos[id] = true;
  }

  bankMatch(): { levelBefore: number; levelAfter: number } {
    return { levelBefore: 1, levelAfter: 1 };
  }

  refreshUnlocks(): void {
    /* nothing here reads unlocks */
  }

  flush(): void {
    /* nothing here persists */
  }
}

describe('ChallengeTracker camos', () => {
  it('gives the camo to the weapon that earned it and to no other', () => {
    const store = new FakeStore({ ar_carbine: { kills: 30 }, smg_wasp: { kills: 9 } });
    new ChallengeTracker(store).refreshAbsolute();
    expect(store.camoOwned('ar_carbine', 'digital')).toBe(true);
    expect(store.camoOwned('smg_wasp', 'digital')).toBe(false);
  });

  it('gives it to every weapon that reaches the bar, not only the first', () => {
    const store = new FakeStore({ ar_carbine: { kills: 30 }, smg_wasp: { kills: 25 }, pistol_talon: { kills: 24 } });
    new ChallengeTracker(store).refreshAbsolute();
    expect(store.camoOwned('ar_carbine', 'digital')).toBe(true);
    expect(store.camoOwned('smg_wasp', 'digital')).toBe(true);
    expect(store.camoOwned('pistol_talon', 'digital')).toBe(false);
  });

  it('pays the challenge once, to the account, however many weapons earn the camo', () => {
    const store = new FakeStore({ ar_carbine: { kills: 30 }, smg_wasp: { kills: 30 } });
    const tracker = new ChallengeTracker(store);
    tracker.refreshAbsolute();
    const digital = tracker.awardsThisMatch.filter((a) => a.camo === 'digital');
    expect(digital).toHaveLength(1);
    expect(store.challenge('camo_digital').completed).toBe(true);
  });

  it('reports each grant with the weapon that earned it, once', () => {
    const store = new FakeStore({ ar_carbine: { kills: 30 }, smg_wasp: { kills: 30 } });
    const tracker = new ChallengeTracker(store);
    tracker.refreshAbsolute();
    expect(tracker.camoGrantsThisMatch).toEqual([
      { weaponId: 'ar_carbine', camo: 'digital' },
      { weaponId: 'smg_wasp', camo: 'digital' },
    ]);
    // Idempotent: a second refresh has nothing new to say.
    const before = tracker.camoGrantsThisMatch.length;
    tracker.refreshAbsolute();
    expect(tracker.camoGrantsThisMatch).toHaveLength(before);
  });

  it('earns OBSIDIAN on the weapon holding the other five, and not on a weapon holding four', () => {
    const store = new FakeStore({
      ar_carbine: { kills: 100, headshots: 15, longshots: 10, multikills: 5 },
      smg_wasp: { kills: 100, headshots: 15, longshots: 10, multikills: 4 },
    });
    new ChallengeTracker(store).refreshAbsolute();
    expect(store.camoOwned('ar_carbine', 'obsidian')).toBe(true);
    expect(store.camoOwned('smg_wasp', 'obsidian')).toBe(false);
    expect(store.camoOwned('smg_wasp', 'gold')).toBe(true);
  });

  it('leaves a camo in place when the weapon is later reset', () => {
    const store = new FakeStore({ ar_carbine: { kills: 30 } });
    const tracker = new ChallengeTracker(store);
    tracker.refreshAbsolute();
    store.weapon('ar_carbine').kills = 0;
    tracker.refreshAbsolute();
    expect(store.camoOwned('ar_carbine', 'digital')).toBe(true);
  });
});
