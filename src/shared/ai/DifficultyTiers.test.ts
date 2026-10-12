import { describe, expect, it } from 'vitest';
import {
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_BLURBS,
  BOT_DIFFICULTY_NAMES,
  BOT_TIERS,
  DEFAULT_PERCEPTION,
  DEFAULT_TIERS,
  PERCEPTION_CONFIG_KEYS,
  PERCEPTION_TUNABLES,
  TIER_CONFIG_KEYS,
  TIER_TUNABLES,
  cloneTierTable,
  isBotDifficulty,
  perceptionConfigToSource,
  tierTableToSource,
  tiersFor,
  type BotTier,
  type TierConfig,
} from './DifficultyTiers';

/**
 * The difficulty table, pinned.
 *
 * Four things here are load-time facts rather than functions, and they are the ones worth
 * pinning hardest:
 *
 *  - **`TIER_CONFIG_KEYS` and `PERCEPTION_CONFIG_KEYS` are `Object.keys` of a literal**, read
 *    while the module loads. Their *order* is the order the tuning panel lists sliders in and
 *    the order `tierTableToSource` writes a pasteable table in, so it is observable and it is
 *    pinned.
 *  - **Every field has slider metadata.** The file's own claim is that
 *    `Record<keyof TierConfig, TunableMeta>` makes a field without metadata a compile error.
 *    The runtime half — that no metadata describes a field that no longer exists, and that
 *    every bound actually contains the shipped value — is asserted here. That second half is
 *    how the Kestrel's two out-of-range values were found (backlog #11), so the same check is
 *    applied to the tiers.
 *  - **Health is not in the table and never will be.** A bot that takes more bullets than its
 *    silhouette says it should is the single most-hated thing in bot FPS design, and the way
 *    that never happens by accident is that the number is absent from the only file allowed
 *    to differ per tier. A test is how "never will be" survives the next contributor.
 *  - **The tiers are monotonic where a difficulty has to be.** Reaction time falls and the aim
 *    cone narrows from Recruit to Veteran. Nothing enforces that but the author's care, and
 *    a difficulty picker whose middle entry is the hardest one is a bug nobody reports.
 */

describe('the tier vocabulary', () => {
  it('is authored weakest first, which every other file reads as the strength order', () => {
    expect(BOT_TIERS).toEqual(['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN']);
  });

  it('offers MIX alongside the four, and names and describes every entry', () => {
    expect(BOT_DIFFICULTIES).toEqual(['RECRUIT', 'REGULAR', 'HARDENED', 'VETERAN', 'MIX']);
    for (const difficulty of BOT_DIFFICULTIES) {
      expect(BOT_DIFFICULTY_NAMES[difficulty].length).toBeGreaterThan(0);
      expect(BOT_DIFFICULTY_BLURBS[difficulty].length).toBeGreaterThan(0);
    }
  });

  it('recognises its own spellings and nothing else', () => {
    for (const difficulty of BOT_DIFFICULTIES) expect(isBotDifficulty(difficulty)).toBe(true);
    expect(isBotDifficulty('mix')).toBe(false);
    expect(isBotDifficulty('VETERAN ')).toBe(false);
    expect(isBotDifficulty('')).toBe(false);
    expect(isBotDifficulty('IMPOSSIBLE')).toBe(false);
  });
});

describe('choosing the mix a match is dealt from', () => {
  const authored: readonly BotTier[] = ['REGULAR', 'HARDENED', 'RECRUIT', 'REGULAR', 'VETERAN'];

  it('hands back the map’s own spread for MIX', () => {
    expect(tiersFor('MIX', authored)).toBe(authored);
  });

  it('collapses a chosen tier to a one-entry mix, which the deal then cycles', () => {
    expect(tiersFor('VETERAN', authored)).toEqual(['VETERAN']);
    expect(tiersFor('RECRUIT', authored)).toEqual(['RECRUIT']);
  });

  it('ignores the authored spread entirely when a tier was chosen', () => {
    // Until the session that added this, the choice was dropped whenever it was not MIX.
    expect(tiersFor('HARDENED', [])).toEqual(['HARDENED']);
    expect(tiersFor('HARDENED', authored)).toEqual(['HARDENED']);
  });
});

describe('the shipped tiers', () => {
  it('has no health field, and never will', () => {
    for (const tier of BOT_TIERS) {
      expect(Object.keys(DEFAULT_TIERS[tier])).not.toContain('health');
      expect(Object.keys(DEFAULT_TIERS[tier])).not.toContain('maxHealth');
      expect(Object.keys(DEFAULT_TIERS[tier])).not.toContain('healthMultiplier');
    }
  });

  it('reacts faster and aims tighter the harder it gets', () => {
    let previousReaction = Infinity;
    let previousCone = Infinity;
    for (const tier of BOT_TIERS) {
      const cfg = DEFAULT_TIERS[tier];
      expect(cfg.reactionMin).toBeLessThan(previousReaction);
      expect(cfg.aimConeDeg).toBeLessThan(previousCone);
      previousReaction = cfg.reactionMin;
      previousCone = cfg.aimConeDeg;
      // S6.3 fixes the band the whole table lives in.
      expect(cfg.reactionMin).toBeGreaterThanOrEqual(0.15);
      expect(cfg.reactionMax).toBeLessThanOrEqual(0.6);
      expect(cfg.reactionMax).toBeGreaterThanOrEqual(cfg.reactionMin);
    }
  });

  it('opens the first burst wider than the settled cone, for every tier', () => {
    // The miss-first-burst rule: a bot that is accurate from the first round is a bot that
    // kills you before you know it is there.
    for (const tier of BOT_TIERS) {
      const cfg = DEFAULT_TIERS[tier];
      expect(cfg.firstBurstConeDeg).toBeGreaterThan(cfg.aimConeDeg);
      expect(cfg.firstBurstHold).toBeGreaterThan(0);
    }
  });

  it('gives a Recruit no grenades at all, which is the gate the tier owns', () => {
    expect(DEFAULT_TIERS.RECRUIT.grenadeChance).toBe(0);
    expect(DEFAULT_TIERS.VETERAN.grenadeChance).toBeGreaterThan(0);
  });
});

describe('the slider metadata', () => {
  it('describes exactly the fields the config has, in the order the panel lists them', () => {
    expect(TIER_CONFIG_KEYS).toEqual(Object.keys(DEFAULT_TIERS.REGULAR));
    expect(Object.keys(TIER_TUNABLES).sort()).toEqual([...TIER_CONFIG_KEYS].sort());
    expect(PERCEPTION_CONFIG_KEYS).toEqual(Object.keys(DEFAULT_PERCEPTION));
    expect(Object.keys(PERCEPTION_TUNABLES).sort()).toEqual([...PERCEPTION_CONFIG_KEYS].sort());
  });

  it('gives every slider a usable range', () => {
    for (const key of TIER_CONFIG_KEYS) {
      const meta = TIER_TUNABLES[key];
      expect(meta.max).toBeGreaterThan(meta.min);
      expect(meta.step).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.group.length).toBeGreaterThan(0);
    }
  });

  it('contains every shipped value, so a slider cannot snap a tier away from its own figure', () => {
    // The failure this guards is backlog #11, found on the Kestrel: a base value outside its
    // own slider's bounds cannot be restored through the panel once touched.
    for (const tier of BOT_TIERS) {
      for (const key of TIER_CONFIG_KEYS) {
        const value = DEFAULT_TIERS[tier][key];
        const meta = TIER_TUNABLES[key];
        expect(value).toBeGreaterThanOrEqual(meta.min);
        expect(value).toBeLessThanOrEqual(meta.max);
      }
    }
  });

  it('contains every shipped perception value too', () => {
    for (const key of PERCEPTION_CONFIG_KEYS) {
      const value = DEFAULT_PERCEPTION[key];
      const meta = PERCEPTION_TUNABLES[key];
      expect(value).toBeGreaterThanOrEqual(meta.min);
      expect(value).toBeLessThanOrEqual(meta.max);
    }
  });
});

describe('perception, which is a property of the world and not of skill', () => {
  it('fixes the cone and both hearing radii at S6.3’s figures', () => {
    expect(DEFAULT_PERCEPTION.visionConeDeg).toBe(110);
    expect(DEFAULT_PERCEPTION.gunfireHearing).toBe(40);
    expect(DEFAULT_PERCEPTION.footstepHearing).toBe(12);
  });

  it('hears gunfire further than footsteps, and sees further than it hears', () => {
    expect(DEFAULT_PERCEPTION.gunfireHearing).toBeGreaterThan(DEFAULT_PERCEPTION.footstepHearing);
    expect(DEFAULT_PERCEPTION.visionRange).toBeGreaterThan(DEFAULT_PERCEPTION.gunfireHearing);
  });
});

describe('cloning the table, which the tuning panel edits', () => {
  it('copies every tier into a new object', () => {
    const copy = cloneTierTable(DEFAULT_TIERS);
    expect(copy).toEqual(DEFAULT_TIERS);
    expect(copy).not.toBe(DEFAULT_TIERS);
    for (const tier of BOT_TIERS) expect(copy[tier]).not.toBe(DEFAULT_TIERS[tier]);
  });

  it('leaves the shipped table untouched when the copy is edited', () => {
    const shipped = DEFAULT_TIERS.REGULAR.aimConeDeg;
    const copy = cloneTierTable(DEFAULT_TIERS);
    copy.REGULAR.aimConeDeg = 99;
    expect(DEFAULT_TIERS.REGULAR.aimConeDeg).toBe(shipped);
  });
});

describe('serialising a tuned table back out as source (COPY CONFIG)', () => {
  it('produces a declaration that names every tier and every key', () => {
    const source = tierTableToSource(DEFAULT_TIERS);
    expect(source.startsWith('export const DEFAULT_TIERS: TierTable = {')).toBe(true);
    expect(source.endsWith('};')).toBe(true);
    for (const tier of BOT_TIERS) expect(source).toContain(`  ${tier}: {`);
    for (const key of TIER_CONFIG_KEYS) expect(source).toContain(`    ${key}: `);
  });

  it('keeps the key order and the group blank lines the panel is laid out in', () => {
    const body = tierTableToSource(DEFAULT_TIERS)
      .split('\n')
      .filter((line) => line.startsWith('    '))
      .map((line) => line.trim().split(':')[0]);
    // Four tiers, every key, in declaration order each time.
    expect(body).toEqual(BOT_TIERS.flatMap(() => [...TIER_CONFIG_KEYS]));
    expect(tierTableToSource(DEFAULT_TIERS)).toContain('\n\n');
  });

  it('rounds to four places, so a dragged slider does not paste seventeen digits', () => {
    const tuned = cloneTierTable(DEFAULT_TIERS);
    tuned.REGULAR.convergeRate = 1 / 3;
    expect(tierTableToSource(tuned)).toContain('convergeRate: 0.3333,');
  });

  it('round-trips the shipped values it was given', () => {
    const source = tierTableToSource(DEFAULT_TIERS);
    for (const tier of BOT_TIERS) {
      for (const key of TIER_CONFIG_KEYS) {
        const rounded = Math.round(DEFAULT_TIERS[tier][key] * 1e4) / 1e4;
        expect(source).toContain(`    ${key}: ${rounded},`);
      }
    }
  });

  it('does the same for the perception block, flat and without groups', () => {
    const source = perceptionConfigToSource(DEFAULT_PERCEPTION);
    expect(source.startsWith('export const DEFAULT_PERCEPTION: PerceptionConfig = {')).toBe(true);
    expect(source.endsWith('};')).toBe(true);
    expect(source).not.toContain('\n\n');
    for (const key of PERCEPTION_CONFIG_KEYS) {
      const rounded = Math.round(DEFAULT_PERCEPTION[key] * 1e4) / 1e4;
      expect(source).toContain(`  ${key}: ${rounded},`);
    }
  });
});

describe('the shape of a tier config', () => {
  it('is all numbers, which is what makes every field a slider', () => {
    for (const tier of BOT_TIERS) {
      for (const key of TIER_CONFIG_KEYS) {
        const value: TierConfig[keyof TierConfig] = DEFAULT_TIERS[tier][key];
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
