import { describe, expect, it } from 'vitest';
import { ScoreSystem } from '../combat/ScoreSystem';
import { createGameBus, EV } from '../core/Events';
import type { KillFact } from './Challenges';
import { MatchLedger } from './MatchLedger';
import { XP_SOURCES, xpSource } from './XpRules';

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

/**
 * The breakdown the summary draws (A19).
 *
 * `lines` is a loop over `XP_SOURCES` with nine `if (source.id === …)` overrides and a nested
 * ternary for the XP, at cc 36; A19 gives the count and the XP a named function each. What makes
 * it worth pinning carefully rather than loosely is that this output **is** an oracle: the five
 * seeded SIM matches print the breakdown line, so a row that moved would show up there as a
 * byte difference — and these tests say which row and why.
 *
 * Three of the fourteen are not "count times value", and each has a case below: the floor is
 * the head of the list rather than a row the loop might drop, `challenge` carries its own award
 * as data, and a `flat` source pays its value once however high the count.
 */

/** A ledger on a registered seat, with a score row the summary can read. */
function ledgerForSummary() {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  score.register(ME, 'ME', 'A');
  score.register(THEM, 'THEM', 'B');
  const ledger = new MatchLedger({ bus, score, entityId: ME });
  return { bus, score, ledger };
}

/** One line of the breakdown, by source id. */
function lineOf(lines: readonly { id: string; count: number; xp: number }[], id: string) {
  return lines.find((l) => l.id === id);
}

describe('the match breakdown', () => {
  it('always leads with the match-complete floor, even for a match that did nothing', () => {
    const { ledger } = ledgerForSummary();
    const lines = ledger.lines(false, false, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.id).toBe('matchComplete');
    expect(lines[0]?.count).toBe(1);
    expect(lines[0]?.xp).toBe(xpSource('matchComplete').value);
  });

  it('pays the time row in whole minutes of the match it is given', () => {
    const { ledger } = ledgerForSummary();
    // 150 seconds is two whole minutes; the half-minute pays nothing, as `matchMinutes` says.
    const lines = ledger.lines(false, false, 150);
    const time = lineOf(lines, 'matchTime');
    expect(time?.count).toBe(2);
    expect(time?.xp).toBe(2 * xpSource('matchTime').value);
  });

  it('drops the time row for a match under a minute rather than printing a zero', () => {
    const { ledger } = ledgerForSummary();
    expect(lineOf(ledger.lines(false, false, 59), 'matchTime')).toBe(undefined);
  });

  it('pays the win and the MVP as one flat award each, or not at all', () => {
    const { ledger } = ledgerForSummary();
    const won = ledger.lines(true, true, 0);
    expect(lineOf(won, 'win')?.xp).toBe(xpSource('win').value);
    expect(lineOf(won, 'win')?.count).toBe(1);
    expect(lineOf(won, 'mvp')?.xp).toBe(xpSource('mvp').value);

    const lost = ledger.lines(false, false, 0);
    expect(lineOf(lost, 'win')).toBe(undefined);
    expect(lineOf(lost, 'mvp')).toBe(undefined);
  });

  it('reads the assists, the best streak and the objectives off the score row', () => {
    const { score, ledger } = ledgerForSummary();
    const row = score.row(ME);
    if (row === undefined) throw new Error('no score row');
    row.assists = 3;
    row.bestStreak = 6;
    row.captures = 1;
    row.defends = 2;
    row.plants = 1;
    row.defuses = 1;
    row.tags = 4;

    const lines = ledger.lines(false, false, 0);
    expect(lineOf(lines, 'assist')?.count).toBe(3);
    expect(lineOf(lines, 'assist')?.xp).toBe(3 * xpSource('assist').value);
    expect(lineOf(lines, 'streak')?.count).toBe(6);
    // Every objective kind on the row, summed into one line.
    expect(lineOf(lines, 'objective')?.count).toBe(9);
  });

  it('takes the challenge XP as data rather than as a count times a value', () => {
    const { ledger } = ledgerForSummary();
    const lines = ledger.lines(false, false, 0, { challenges: 3, challengeXp: 1750, weaponLevels: 0 });
    const challenge = lineOf(lines, 'challenge');
    expect(challenge?.count).toBe(3);
    // The one source in the table whose XP is the sum of what completed.
    expect(challenge?.xp).toBe(1750);
  });

  it('pays the weapon-level row per level gained', () => {
    const { ledger } = ledgerForSummary();
    const lines = ledger.lines(false, false, 0, { challenges: 0, challengeXp: 0, weaponLevels: 2 });
    const row = lineOf(lines, 'weaponLevel');
    expect(row?.count).toBe(2);
    expect(row?.xp).toBe(2 * xpSource('weaponLevel').value);
  });

  it('counts the kills it watched, and pays per kill', () => {
    const { bus, ledger } = ledgerForSummary();
    for (let i = 0; i < 4; i++) {
      bus.emit(EV.EntityKilled, {
        targetId: THEM,
        sourceId: ME,
        weaponId: HELD,
        zone: 'torso',
        killerHealth: 100,
      });
    }
    const lines = ledger.lines(false, false, 0);
    expect(lineOf(lines, 'kill')?.count).toBe(4);
    expect(lineOf(lines, 'kill')?.xp).toBe(4 * xpSource('kill').value);
    ledger.dispose();
  });

  it('drops every row worth nothing, so the summary draws no empty lines', () => {
    const { ledger } = ledgerForSummary();
    const lines = ledger.lines(false, false, 0);
    for (const line of lines) expect(line.xp, line.id).toBeGreaterThan(0);
  });

  it('keeps the rows in the table’s own order, which is the order the bar fills', () => {
    const { score, ledger } = ledgerForSummary();
    const row = score.row(ME);
    if (row === undefined) throw new Error('no score row');
    row.assists = 1;
    row.bestStreak = 1;
    const lines = ledger.lines(true, true, 600);
    const order = XP_SOURCES.map((s) => s.id).filter((id) => lines.some((l) => l.id === id));
    expect(lines.map((l) => l.id)).toEqual(order);
    // And the floor is first, which is what makes the list non-empty without a renderer check.
    expect(lines[0]?.id).toBe('matchComplete');
  });

  it('labels and classifies each row off the table', () => {
    const { ledger } = ledgerForSummary();
    const lines = ledger.lines(true, false, 600);
    for (const line of lines) {
      const source = XP_SOURCES.find((s) => s.id === line.id);
      expect(source, line.id).toBeDefined();
      expect(line.label).toBe(source?.label);
      expect(line.kind).toBe(source?.kind);
    }
  });

  it('can be asked twice and answers the same', () => {
    const { ledger } = ledgerForSummary();
    expect(ledger.lines(true, true, 600)).toEqual(ledger.lines(true, true, 600));
  });
});
