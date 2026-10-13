import { describe, expect, it } from 'vitest';
import { PLAYER_ENTITY_ID } from '../combat/DamageSystem';
import { ScoreSystem } from '../combat/ScoreSystem';
import { createGameBus, EV, type GameBus } from '../core/Events';
import { ChallengeTracker } from './ChallengeTracker';
import type { CamoId } from './Camos';
import type { ChallengeId } from './Challenges';
import { MatchProgression } from './MatchProgression';
import type { ProgressionStore } from './ProgressionStore';
import {
  defaultSave,
  defaultSettings,
  makeWeaponSave,
  type ChallengeSaveData,
  type SaveV2,
  type WeaponSaveData,
} from './SaveData';
import { xpSource } from './XpRules';

/**
 * Closing out a match (A19).
 *
 * `finish` is the one place a match reaches the profile, and the property that matters most is
 * that it is **idempotent**: `Game` enters SUMMARY from the render pass a frame after the mode
 * declares the match over, and a harness ending two matches back to back must not bank one
 * twice. The file is explicit that a second call returns *what the first produced* rather than
 * a report of zeroes — the note where `emptyXpReport` used to be — so both halves of that are
 * pinned here.
 *
 * The order inside `finish` is also behaviour: match-level challenges are evaluated and weapon
 * levels banked **before** the XP lines are built, so a challenge completed by the final
 * scoreline pays out in the summary that shows it.
 */

/** A profile that records what was banked, and nothing else. */
class FakeStore implements ProgressionStore {
  readonly save: SaveV2;
  banked: { xp: number }[] = [];
  refreshes = 0;
  flushes = 0;

  constructor() {
    this.save = defaultSave(defaultSettings('TDM', 'mp_foundry', 90));
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

  bankMatch(xp: number): { levelBefore: number; levelAfter: number } {
    this.banked.push({ xp });
    const before = this.save.profile.level;
    this.save.profile.xp += xp;
    return { levelBefore: before, levelAfter: before };
  }

  refreshUnlocks(): void {
    this.refreshes++;
  }

  flush(): void {
    this.flushes++;
  }
}

function rig() {
  const bus: GameBus = createGameBus();
  const score = new ScoreSystem(bus);
  score.register(PLAYER_ENTITY_ID, 'ME', 'A');
  score.register(2, 'THEM', 'B');
  const profile = new FakeStore();
  const tracker = new ChallengeTracker(profile);
  const progression = new MatchProgression({ bus, profile, score, tracker });

  const xpEvents: { total: number }[] = [];
  bus.on(EV.MetaXpAwarded, (p) => xpEvents.push({ total: p.total }));

  /** A kill by the player, the way the match announces one. */
  const kill = (weaponId = 'ar_carbine'): void => {
    bus.emit(EV.EntityKilled, {
      targetId: 2,
      sourceId: PLAYER_ENTITY_ID,
      weaponId,
      zone: 'torso',
      killerHealth: 200,
    });
  };
  return { bus, score, profile, tracker, progression, xpEvents, kill };
}

describe('live totals', () => {
  it('start at the floor and nothing else', () => {
    const r = rig();
    expect(r.progression.killCount).toBe(0);
    expect(r.progression.liveXp).toBe(xpSource('matchComplete').value);
  });

  it('count the kills the ledger watched', () => {
    const r = rig();
    r.kill();
    r.kill();
    expect(r.progression.killCount).toBe(2);
    expect(r.progression.liveXp).toBe(
      xpSource('matchComplete').value + 2 * xpSource('kill').value,
    );
  });

  it('take an objective scored by hand', () => {
    const r = rig();
    r.progression.noteObjective(2);
    expect(r.progression.liveXp).toBe(
      xpSource('matchComplete').value + 2 * xpSource('objective').value,
    );
  });
});

describe('finishing a match', () => {
  it('banks the total into the profile, once', () => {
    const r = rig();
    r.kill();
    const report = r.progression.finish(true, false);
    expect(report.total).toBeGreaterThan(0);
    expect(r.profile.banked).toHaveLength(1);
    expect(r.profile.banked[0]?.xp).toBe(report.total);
  });

  it('is idempotent, and answers with what the first call produced', () => {
    const r = rig();
    r.kill();
    const first = r.progression.finish(true, true);
    const second = r.progression.finish(true, true);
    // The same report, not a fresh one of zeroes: the match did pay something, and a caller
    // asking twice is told the same thing twice.
    expect(second).toBe(first);
    expect(r.profile.banked).toHaveLength(1);
  });

  it('does not bank a second time even when asked with a different outcome', () => {
    const r = rig();
    const first = r.progression.finish(false, false);
    const second = r.progression.finish(true, true);
    expect(second).toBe(first);
    expect(r.profile.banked).toHaveLength(1);
  });

  it('pays the win and the MVP when they are claimed', () => {
    const won = rig().progression.finish(true, true);
    const lost = rig().progression.finish(false, false);
    expect(won.total).toBeGreaterThan(lost.total);
    expect(won.lines.some((l) => l.id === 'win')).toBe(true);
    expect(lost.lines.some((l) => l.id === 'win')).toBe(false);
  });

  it('always reports the floor line, so the summary is never an empty box', () => {
    const report = rig().progression.finish(false, false);
    expect(report.lines[0]?.id).toBe('matchComplete');
    expect(report.total).toBeGreaterThanOrEqual(xpSource('matchComplete').value);
  });

  it('evaluates the match challenges before building the lines', () => {
    const r = rig();
    const row = r.score.row(PLAYER_ENTITY_ID);
    if (row === undefined) throw new Error('no score row');
    row.kills = 30;
    r.profile.weapon('ar_carbine').kills = 30;

    const report = r.progression.finish(true, false);
    // A camo earned by the final scoreline is on the weapon by the time the report exists.
    expect(r.profile.camoOwned('ar_carbine', 'digital')).toBe(true);
    expect(report.camosUnlocked.some((c) => c.camo === 'digital')).toBe(true);
  });

  it('announces the award on the bus', () => {
    const r = rig();
    r.kill();
    const report = r.progression.finish(true, false);
    expect(r.xpEvents).toHaveLength(1);
    expect(r.xpEvents[0]?.total).toBe(report.total);
  });

  it('writes the profile to storage once the match is closed', () => {
    const r = rig();
    r.progression.finish(true, false);
    expect(r.profile.flushes).toBeGreaterThan(0);
  });

  it('sums the report’s own lines into its total', () => {
    const r = rig();
    r.kill();
    r.kill();
    const report = r.progression.finish(true, true);
    let sum = 0;
    for (const line of report.lines) sum += line.xp;
    expect(report.total).toBe(sum);
  });
});
