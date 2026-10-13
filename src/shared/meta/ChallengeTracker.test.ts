import { describe, expect, it } from 'vitest';
import { ChallengeTracker } from './ChallengeTracker';
import type { CamoId } from './Camos';
import { CHALLENGES, type ChallengeId, type KillFact, type MatchFact } from './Challenges';
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

/**
 * The rest of the tracker (A18).
 *
 * The suite above is about the two awards a camo challenge pays. These cover what the tracker
 * does with every other kind of rule, and in particular the two branches of `absoluteValue` —
 * which A18 splits into `bestCamoSetCount` and `bestWeaponStat`. Both branches answer "the best
 * weapon's number", and the camo-set one is the nested loop that pushed the function to depth 4.
 */

/** A kill with nothing special about it, overridden as a test needs. */
function kill(over: Partial<KillFact> = {}): KillFact {
  return {
    weaponId: 'ar_carbine',
    weaponClass: 'AR',
    zone: 'torso',
    headshot: false,
    distance: 10,
    ads: false,
    sliding: false,
    airborne: false,
    equipment: false,
    killsThisMag: 1,
    killsInWindow: 1,
    streak: 1,
    revenge: false,
    ...over,
  };
}

function matchFact(over: Partial<MatchFact> = {}): MatchFact {
  return { won: true, kills: 10, deaths: 5, score: 1000, bestStreak: 4, ...over };
}

describe('the tracker’s absolute rules', () => {
  it('reads the best weapon’s counter, not the sum over the armoury', () => {
    // Three weapons at 10 kills each is not thirty: "25 kills with a single weapon" is one gun.
    const spread = new FakeStore({ a: { kills: 10 }, b: { kills: 10 }, c: { kills: 10 } });
    new ChallengeTracker(spread).refreshAbsolute();
    expect(spread.challenge('camo_digital').progress).toBe(10);
    expect(spread.challenge('camo_digital').completed).toBe(false);

    const one = new FakeStore({ a: { kills: 26 }, b: { kills: 1 } });
    new ChallengeTracker(one).refreshAbsolute();
    // Completed, and the stored progress is pinned to the target rather than to the 26 the
    // weapon actually has: `checkComplete` writes `def.target`, so the bar can never read
    // past full.
    expect(one.challenge('camo_digital').completed).toBe(true);
    expect(one.challenge('camo_digital').progress).toBe(25);
  });

  it('reads each counter independently', () => {
    const store = new FakeStore({ a: { headshots: 9 }, b: { longshots: 7 }, c: { multikills: 3 } });
    new ChallengeTracker(store).refreshAbsolute();
    expect(store.challenge('camo_splinter').progress).toBe(9);
    expect(store.challenge('camo_tiger').progress).toBe(7);
    expect(store.challenge('camo_fractal').progress).toBe(3);
  });

  it('counts the camo set on the best single weapon, which is the other branch', () => {
    // Two weapons holding two prerequisites each is not four: OBSIDIAN is earned on one gun.
    const split = new FakeStore({
      a: { camos: { digital: true, splinter: true } },
      b: { camos: { tiger: true, fractal: true } },
    });
    new ChallengeTracker(split).refreshAbsolute();
    expect(split.challenge('camo_obsidian').progress).toBe(2);
    expect(split.challenge('camo_obsidian').completed).toBe(false);
  });

  it('completes the camo set once one weapon holds all five', () => {
    const store = new FakeStore({
      a: { camos: { digital: true, splinter: true, tiger: true, fractal: true, gold: true } },
    });
    new ChallengeTracker(store).refreshAbsolute();
    expect(store.challenge('camo_obsidian').progress).toBe(5);
    expect(store.challenge('camo_obsidian').completed).toBe(true);
  });

  it('reports nothing above zero for an empty armoury', () => {
    const store = new FakeStore({});
    new ChallengeTracker(store).refreshAbsolute();
    expect(store.challenge('camo_digital').progress).toBe(0);
    expect(store.challenge('camo_obsidian').progress).toBe(0);
  });

  it('is idempotent: a second refresh neither double-pays nor regresses', () => {
    const store = new FakeStore({ a: { kills: 30 } });
    const tracker = new ChallengeTracker(store);
    tracker.refreshAbsolute();
    const awards = tracker.awardsThisMatch.length;
    const xp = tracker.xpThisMatch;
    tracker.refreshAbsolute();
    expect(tracker.awardsThisMatch).toHaveLength(awards);
    expect(tracker.xpThisMatch).toBe(xp);
  });
});

describe('the tracker’s kill rules', () => {
  it('advances every rule a kill satisfies, by one', () => {
    const store = new FakeStore({});
    const tracker = new ChallengeTracker(store);
    tracker.onKill(kill());
    expect(store.challenge('first_blood').completed).toBe(true);
    expect(store.challenge('centurion').progress).toBe(1);
  });

  it('counts a multikill by the window the kill arrived in', () => {
    const store = new FakeStore({});
    const tracker = new ChallengeTracker(store);
    tracker.onKill(kill({ killsInWindow: 2 }));
    expect(store.challenge('double_kill').progress).toBe(1);
    expect(store.challenge('triple_kill').progress).toBe(0);

    tracker.onKill(kill({ killsInWindow: 3 }));
    expect(store.challenge('triple_kill').progress).toBe(1);
    // A triple is not also a double: the rules test the exact count.
    expect(store.challenge('double_kill').progress).toBe(1);
  });

  it('stops advancing a rule once it is complete', () => {
    const store = new FakeStore({});
    const tracker = new ChallengeTracker(store);
    for (let i = 0; i < 5; i++) tracker.onKill(kill());
    expect(store.challenge('first_blood').progress).toBe(1);
    expect(store.challenge('centurion').progress).toBe(5);
  });

  it('pays each completion once, with its own XP', () => {
    const store = new FakeStore({});
    const tracker = new ChallengeTracker(store);
    tracker.onKill(kill());
    const first = tracker.awardsThisMatch.filter((a) => a.id === 'first_blood');
    expect(first).toHaveLength(1);
    expect(tracker.xpThisMatch).toBeGreaterThan(0);
    tracker.onKill(kill());
    expect(tracker.awardsThisMatch.filter((a) => a.id === 'first_blood')).toHaveLength(1);
  });
});

describe('the tracker’s other rules', () => {
  it('advances the flash rules one blinded enemy at a time', () => {
    const store = new FakeStore({});
    const tracker = new ChallengeTracker(store);
    const flashId = CHALLENGES.find((c) => c.rule.kind === 'flash')?.id;
    if (flashId === undefined) throw new Error('no flash challenge in the table');
    tracker.onFlash();
    tracker.onFlash();
    expect(store.challenge(flashId).progress).toBe(2);
  });

  it('advances the match rules on the end of a match, and refreshes the absolutes with it', () => {
    const store = new FakeStore({ a: { kills: 30 } });
    const tracker = new ChallengeTracker(store);
    tracker.onMatchEnd(matchFact({ won: true }));
    // The camo rules ran as part of the same call.
    expect(store.camoOwned('a', 'digital')).toBe(true);
  });

  it('forgets the match’s awards on reset, and keeps the progress', () => {
    const store = new FakeStore({});
    const tracker = new ChallengeTracker(store);
    tracker.onKill(kill());
    expect(tracker.awardsThisMatch.length).toBeGreaterThan(0);
    tracker.reset();
    expect(tracker.awardsThisMatch).toEqual([]);
    expect(tracker.camoGrantsThisMatch).toEqual([]);
    expect(tracker.xpThisMatch).toBe(0);
    expect(store.challenge('first_blood').completed).toBe(true);
  });

  it('reports one challenge’s live progress for the debug panel', () => {
    const store = new FakeStore({});
    const tracker = new ChallengeTracker(store);
    tracker.onKill(kill());
    expect(tracker.progressOf('centurion')).toEqual({
      progress: 1,
      target: 100,
      completed: false,
    });
    expect(tracker.progressOf('not_a_challenge')).toBe(null);
  });
});
