import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { requireWeapon } from '../weapons/WeaponDefs';
import { drawBotWeapon } from './BotArsenal';
import { BOT_TIERS, type BotTier } from './DifficultyTiers';

/**
 * What a bot brings to the fight, pinned.
 *
 * Three properties, and each one closed a real bug or guards against reopening one:
 *
 *  - **The pools are what they are.** The file's whole reason to exist is that a bot's weapon
 *    is a property of the bot and not of the player's class; the M6 symptom was that equipping
 *    a sniper armed all nine bots with snipers. So the set of ids a tier can draw is asserted,
 *    and so is the fact that no tier can draw a launcher.
 *  - **One draw costs exactly one `Rng` value.** `drawBotWeapon` runs inside
 *    `BotDirector.createBot`, on the director's own stream, once per bot. A second call to
 *    `rng.float()` here would move every bot's weapon *and* every spawn point after it, which
 *    is a determinism failure that reads as "the bots feel different" three minutes later.
 *  - **It returns a clone.** `WeaponSystem` writes into the def it is given — M5 attachments
 *    and M2 ammunition both do — so two bots sharing one object would share a magazine.
 *
 * The weights are pinned by distribution over a fixed seed rather than by reading the table:
 * a test that re-states the table is a copy of it, while a test that draws two thousand
 * weapons and finds four carbines for every shotgun is a statement about what the table does.
 */

/** Every id each tier can draw, by drawing until the pool is exhausted. */
function poolOf(tier: BotTier): string[] {
  const rng = new Rng(20_260_012);
  const seen = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    const id = drawBotWeapon(tier, rng).id;
    if (id !== null) seen.add(id);
  }
  return [...seen].sort();
}

function drawCounts(tier: BotTier, draws: number, seed = 7): Map<string, number> {
  const rng = new Rng(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < draws; i++) {
    const id = drawBotWeapon(tier, rng).id ?? '?';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

describe('the pool each tier draws from', () => {
  it('runs from forgiving to punishing', () => {
    expect(poolOf('RECRUIT')).toEqual(['ar_carbine', 'shotgun_breacher', 'smg_wasp']);
    expect(poolOf('REGULAR')).toEqual([
      'ar_carbine',
      'ar_vulcan',
      'shotgun_breacher',
      'smg_meridian',
      'smg_wasp',
    ]);
    expect(poolOf('HARDENED')).toEqual([
      'ar_halcyon',
      'ar_vulcan',
      'lmg_bastion',
      'smg_meridian',
      'sniper_kestrel',
    ]);
    expect(poolOf('VETERAN')).toEqual([
      'ar_halcyon',
      'ar_longbow',
      'lmg_monolith',
      'sniper_kestrel',
      'sniper_vantage',
    ]);
  });

  it('gives a Recruit nothing that punishes a player at range, and a Veteran nothing that does not', () => {
    const classOf = (id: string): string => requireWeapon(id).class;
    expect(poolOf('RECRUIT').map(classOf).sort()).toEqual(['AR', 'SHOTGUN', 'SMG']);
    expect(poolOf('VETERAN').map(classOf).sort()).toEqual(['AR', 'AR', 'LMG', 'SNIPER', 'SNIPER']);
  });

  it('never deals a launcher to anybody', () => {
    // Nothing in `ai/` understands a projectile arc, and a bot that fires a rocket at its own
    // feet is worse than a bot with a rifle.
    for (const tier of BOT_TIERS) {
      for (const id of poolOf(tier)) expect(requireWeapon(id).class).not.toBe('LAUNCHER');
    }
  });

  it('draws every tier from a real shipped weapon', () => {
    for (const tier of BOT_TIERS) {
      for (const id of poolOf(tier)) expect(() => requireWeapon(id)).not.toThrow();
    }
  });
});

describe('the weights', () => {
  it('deals a Recruit four carbines for every shotgun', () => {
    const counts = drawCounts('RECRUIT', 8000);
    const carbine = counts.get('ar_carbine') ?? 0;
    const shotgun = counts.get('shotgun_breacher') ?? 0;
    const wasp = counts.get('smg_wasp') ?? 0;
    expect(carbine + shotgun + wasp).toBe(8000);
    // 4 : 3 : 1 out of eight. Wide bands: this pins the table's shape, not the seed's noise.
    expect(carbine / 8000).toBeGreaterThan(0.45);
    expect(carbine / 8000).toBeLessThan(0.55);
    expect(shotgun / 8000).toBeGreaterThan(0.1);
    expect(shotgun / 8000).toBeLessThan(0.16);
  });

  it('is deterministic: the same seed deals the same roster', () => {
    const first = new Rng(4242);
    const second = new Rng(4242);
    for (let i = 0; i < 20; i++) {
      expect(drawBotWeapon('REGULAR', first).id).toBe(drawBotWeapon('REGULAR', second).id);
    }
  });

  it('spends exactly one random value per draw', () => {
    // The director's stream feeds spawn selection after this, so an extra draw here moves
    // every spawn point in the match as well as every bot's weapon.
    const drawing = new Rng(99);
    const counting = new Rng(99);
    for (let i = 0; i < 25; i++) {
      drawBotWeapon('VETERAN', drawing);
      counting.float();
    }
    expect(drawing.float()).toBe(counting.float());
  });
});

describe('the def that comes back', () => {
  it('is a clone, so two bots cannot share a magazine', () => {
    const rng = new Rng(1);
    const mine = drawBotWeapon('REGULAR', rng);
    const shared = requireWeapon(mine.id ?? 'ar_carbine');
    expect(mine).not.toBe(shared);
    expect(mine.id).toBe(shared.id);
    expect(mine.magSize).toBe(shared.magSize);
  });

  it('is a fresh clone every time, even for the same weapon', () => {
    const rng = new Rng(1);
    const first = drawBotWeapon('RECRUIT', rng);
    let second = drawBotWeapon('RECRUIT', rng);
    for (let i = 0; i < 50 && second.id !== first.id; i++) second = drawBotWeapon('RECRUIT', rng);
    expect(second.id).toBe(first.id);
    expect(second).not.toBe(first);
  });
});
