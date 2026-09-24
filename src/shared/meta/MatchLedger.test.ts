import { describe, expect, it } from 'vitest';
import { ScoreSystem } from '../combat/ScoreSystem';
import { createGameBus, EV } from '../core/Events';
import type { KillFact } from './Challenges';
import { MatchLedger } from './MatchLedger';

/**
 * Which weapon a kill belongs to, when the thing that fired was not in the player's hands.
 *
 * The sentry began crediting its owner on 2026-09-24, and that made this question load
 * bearing: `buildKillFact` resolved anything that was not `eq_*` to `heldWeaponId`, so ninety
 * seconds of turret fire would have counted as kills **with whatever rifle the player was
 * holding** — levelling it, moving its camo challenges and paying its per-weapon XP for shots
 * they did not take. The mortar and the Chopper Gunner have credited their owner since M7 and
 * were doing exactly that, silently, which is why these cases name all three.
 */

const ME = 1;
const THEM = 2;
const HELD = 'ar_carbine';

function ledgerWithKill(weaponId: string): { fact: KillFact; tallies: Map<string, { kills: number }> } {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  score.register(ME, 'ME', 'A');
  score.register(THEM, 'THEM', 'B');

  let fact: KillFact | null = null;
  const ledger = new MatchLedger({ bus, score, entityId: ME, onKill: (f) => void (fact = f) });
  // `heldWeaponId` is normally written by `sample` once a frame. Set it the way a match would,
  // because the whole question is whether the held weapon gets the credit.
  (ledger as unknown as { heldWeaponId: string }).heldWeaponId = HELD;

  bus.emit(EV.EntityKilled, {
    targetId: THEM,
    sourceId: ME,
    weaponId,
    zone: 'torso',
    killerHealth: 100,
  });
  ledger.dispose();
  if (fact === null) throw new Error('no kill fact');
  return { fact, tallies: ledger.weaponTallies };
}

describe('a kill from something the player did not hold', () => {
  it('credits the held weapon when the player did hold it', () => {
    const { fact, tallies } = ledgerWithKill(HELD);
    expect(fact.weaponId).toBe(HELD);
    expect(fact.weaponClass).toBe('AR');
    expect(tallies.get(HELD)?.kills).toBe(1);
  });

  it('credits the killstreak, never the rifle in your hands', () => {
    for (const id of ['streak_sentry', 'streak_mortar', 'streak_chopper']) {
      const { fact, tallies } = ledgerWithKill(id);
      expect(fact.weaponId).toBe(id);
      expect(tallies.get(HELD)).toBeUndefined();
      expect(tallies.get(id)?.kills).toBe(1);
    }
  });

  it('gives a killstreak kill a class no mastery challenge tests', () => {
    // The six mastery challenges each name one of AR, SMG, LMG, SNIPER, SHOTGUN, PISTOL.
    const { fact } = ledgerWithKill('streak_sentry');
    expect(fact.weaponClass).toBe('LAUNCHER');
    // And it is not equipment either, so DEMOLITION does not quietly pay out for a turret.
    expect(fact.equipment).toBe(false);
  });

  it('does not advance the magazine counter, which a turret does not share', () => {
    const { fact } = ledgerWithKill('streak_sentry');
    expect(fact.killsThisMag).toBe(0);
    const grenade = ledgerWithKill('eq_frag');
    expect(grenade.fact.killsThisMag).toBe(0);
    expect(grenade.fact.equipment).toBe(true);
  });
});
