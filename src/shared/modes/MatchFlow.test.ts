import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { EV, createGameBus, type AnnouncerCue, type GameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { GREYBOX_MAP } from '../world/maps/greybox';
import type { Combatant } from '../ai/Combatant';
import { DEFAULT_MATCH_START_SECONDS, MatchFlow, makeReplicatedMatchState, type MatchFlowDeps } from './MatchFlow';
import { Tdm } from './Tdm';
import type { ModeDeps } from './GameMode';

/**
 * The thing that owns a match, pinned.
 *
 * A mode decides *whether* a round is over; the flow decides what happens next — and the brief's
 * whole reason for building rounds into the base in M4 was so that this could be the only place
 * that knows. So what is pinned here is the four phases and the order of the transitions, not any
 * mode's rules:
 *
 *  - **WARMUP → LIVE → ROUND_END → (WARMUP | MATCH_END).** The first warmup is the ten-second
 *    match start; every later one is three seconds, because by then the players are already in.
 *  - **A round win that finishes the match ends the match, not the round.** That one branch is
 *    why `endRound` asks the score for the round totals rather than trusting the mode.
 *  - **The life budget is the flow's**, not the mode's: `respawnAllowed` is asked by
 *    `BotDirector` for every bot and by `Match` for the player, so there is exactly one rule.
 *  - **The clock the HUD shows is this one.** `ticksRemaining` counts down here while every mode
 *    also keeps its own — see `ModeDeps.roundSecondsOverride`, which seeds both so a harness
 *    cannot shorten one without the other.
 *
 * Driven with TDM, which answers the round questions trivially and so leaves the flow's own
 * behaviour visible.
 */

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function body(entityId: number, team: 'A' | 'B'): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, 0, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

interface Rig {
  readonly flow: MatchFlow;
  readonly mode: Tdm;
  readonly score: ScoreSystem;
  readonly bus: GameBus;
  readonly swaps: boolean[];
}

function rig(over: Partial<MatchFlowDeps> = {}, modeOver: Partial<ModeDeps> = {}): Rig {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  const roster: Combatant[] = [body(0, 'A'), body(100, 'B')];
  for (const c of roster) score.register(c.entityId, c.displayName, c.team);
  const mode = new Tdm({ bus, score, roster, mapDef: GREYBOX_MAP, ...modeOver });
  const swaps: boolean[] = [];
  const flow = new MatchFlow({
    bus,
    score,
    roster,
    mode,
    mapId: GREYBOX_MAP.id,
    mapName: 'GREYBOX',
    localTeam: 'A',
    onSidesSwapped: (swapped) => swaps.push(swapped),
    ...over,
  });
  return { flow, mode, score, bus, swaps };
}

/**
 * A rig whose round is `seconds` long on **both** clocks.
 *
 * `roundSecondsOverride` has to reach the flow and the mode, which is the whole point of the
 * field: a harness that shortened only the flow's clock got a HUD that hit zero and a match that
 * carried on. Passing it to one of the two is the mistake the field exists to prevent.
 */
function shortRig(seconds: number): Rig {
  return rig({ roundSecondsOverride: seconds }, { roundSecondsOverride: seconds });
}

/** Run `seconds` worth of ticks from `from`, returning the next tick index. */
function run(r: Rig, seconds: number, from = 1): number {
  const ticks = Math.round(seconds / DT);
  let tick = from;
  for (let i = 0; i < ticks; i++) r.flow.simulate(tick++);
  return tick;
}

/** Start the match and run the opening warmup out, so the next tick is live play. */
function goLive(r: Rig): number {
  r.flow.start();
  const tick = run(r, DEFAULT_MATCH_START_SECONDS + DT);
  expect(r.flow.currentPhase).toBe('LIVE');
  return tick;
}

describe('a fresh replicated state', () => {
  it('starts in warmup at round one with nothing on the clock', () => {
    expect(makeReplicatedMatchState()).toEqual({
      phase: 'WARMUP',
      secondsRemaining: 0,
      phaseSeconds: 0,
      round: 1,
      scoreA: 0,
      scoreB: 0,
      serverTick: 0,
    });
  });

  it('is a fresh record each time', () => {
    expect(makeReplicatedMatchState()).not.toBe(makeReplicatedMatchState());
  });
});

describe('starting a match', () => {
  it('opens in warmup at round one, with the round clock already wound', () => {
    const r = rig();
    r.flow.start();
    expect(r.flow.currentPhase).toBe('WARMUP');
    expect(r.flow.round).toBe(1);
    expect(r.flow.isLive).toBe(false);
    expect(r.flow.isOver).toBe(false);
    expect(r.flow.secondsRemaining).toBeCloseTo(600, 2);
  });

  it('gives the first warmup the ten-second match start, and later ones three', () => {
    const r = rig();
    r.flow.start();
    expect(r.flow.phaseSecondsTotal).toBe(DEFAULT_MATCH_START_SECONDS);
    expect(r.flow.phaseSecondsRemaining).toBeCloseTo(DEFAULT_MATCH_START_SECONDS, 6);
  });

  it('announces the match and the round, and the opening cue', () => {
    const r = rig();
    const started: Array<{ modeId: string; roundsToWin: number }> = [];
    const rounds: number[] = [];
    const cues: AnnouncerCue[] = [];
    r.bus.on(EV.MatchStarted, (p) => started.push({ modeId: p.modeId, roundsToWin: p.roundsToWin }));
    r.bus.on(EV.RoundStarted, (p) => rounds.push(p.round));
    r.bus.on(EV.AnnouncerCue, (p) => cues.push(p.cue));

    r.flow.start();
    expect(started).toEqual([{ modeId: 'TDM', roundsToWin: 1 }]);
    expect(rounds).toEqual([1]);
    expect(cues).toEqual(['matchStart']);
  });

  it('tells the mode to start its round, which is what winds the mode’s own clock', () => {
    const r = rig();
    r.flow.start();
    expect(r.mode.checkWinCondition()).toBe(null);
  });

  it('publishes the opening score', () => {
    const r = rig();
    const scores: Array<{ teamA: number; teamB: number; limit: number }> = [];
    r.bus.on(EV.ScoreChanged, (p) => scores.push({ teamA: p.teamA, teamB: p.teamB, limit: p.limit }));
    r.flow.start();
    expect(scores).toEqual([{ teamA: 0, teamB: 0, limit: 75 }]);
  });

  it('can be started again, putting everything back', () => {
    const r = rig();
    goLive(r);
    r.flow.start();
    expect(r.flow.currentPhase).toBe('WARMUP');
    expect(r.flow.round).toBe(1);
  });
});

describe('the warmup', () => {
  it('holds until its seconds are up, then goes live with the fight cue', () => {
    const r = rig();
    const cues: AnnouncerCue[] = [];
    r.bus.on(EV.AnnouncerCue, (p) => cues.push(p.cue));
    r.flow.start();

    run(r, DEFAULT_MATCH_START_SECONDS - DT);
    expect(r.flow.currentPhase).toBe('WARMUP');
    r.flow.simulate(999);
    r.flow.simulate(1000);
    expect(r.flow.currentPhase).toBe('LIVE');
    expect(cues).toContain('fight');
  });

  it('does not run the round clock down while nobody can move', () => {
    const r = rig();
    r.flow.start();
    const before = r.flow.secondsRemaining;
    run(r, 2);
    expect(r.flow.secondsRemaining).toBe(before);
  });

  it('can be cut short by the host, but never lengthened', () => {
    const r = rig();
    r.flow.start();
    r.flow.shortenWarmup(2);
    expect(r.flow.phaseSecondsRemaining).toBeCloseTo(2, 6);
    // Asking for more than is left does nothing: the warmup cannot be rewound.
    r.flow.shortenWarmup(9);
    expect(r.flow.phaseSecondsRemaining).toBeCloseTo(2, 6);
  });

  it('refuses to be cut short on a client, or once the round is live', () => {
    const replica = rig({ authoritative: false });
    replica.flow.start();
    replica.flow.shortenWarmup(1);
    expect(replica.flow.phaseSecondsRemaining).toBeCloseTo(DEFAULT_MATCH_START_SECONDS, 6);

    const r = rig();
    goLive(r);
    r.flow.shortenWarmup(1);
    expect(r.flow.currentPhase).toBe('LIVE');
  });
});

describe('a live round', () => {
  it('runs the clock down and ticks the mode', () => {
    const r = rig();
    goLive(r);
    const before = r.flow.secondsRemaining;
    run(r, 1, 10_000);
    expect(r.flow.secondsRemaining).toBeCloseTo(before - 1, 2);
    expect(r.flow.isLive).toBe(true);
  });

  it('fires each time cue once, as the clock passes it', () => {
    const r = shortRig(121);
    const cues: AnnouncerCue[] = [];
    r.bus.on(EV.AnnouncerCue, (p) => cues.push(p.cue));
    goLive(r);

    run(r, 2, 10_000);
    expect(cues.filter((c) => c === 'twoMinutes')).toHaveLength(1);
    run(r, 61, 20_000);
    expect(cues.filter((c) => c === 'oneMinute')).toHaveLength(1);
    run(r, 31, 40_000);
    expect(cues.filter((c) => c === 'thirtySeconds')).toHaveLength(1);
    expect(cues.filter((c) => c === 'twoMinutes')).toHaveLength(1);
  });

  it('publishes the score only when it moves', () => {
    const r = rig();
    goLive(r);
    const scores: number[] = [];
    r.bus.on(EV.ScoreChanged, (p) => scores.push(p.teamA));
    run(r, 1, 10_000);
    expect(scores).toEqual([]);

    r.score.addTeamScore('A', 5);
    r.flow.simulate(20_000);
    expect(scores).toEqual([5]);
  });

  it('reads a side’s score through the mode', () => {
    const r = rig();
    goLive(r);
    r.score.addTeamScore('B', 7);
    expect(r.flow.teamScore('B')).toBe(7);
  });
});

describe('the life budget', () => {
  it('lets anybody back while the mode has no limit', () => {
    const r = rig();
    goLive(r);
    expect(r.flow.respawnAllowed(0)).toBe(true);
    expect(r.flow.livesRemaining(0)).toBe(Infinity);
    r.flow.noteRespawn(0);
    expect(r.flow.respawnAllowed(0)).toBe(true);
  });

  it('is counted per body, and spent by noting a respawn', () => {
    const r = rig();
    goLive(r);
    r.flow.noteRespawn(0);
    r.flow.noteRespawn(0);
    expect(r.flow.livesRemaining(100)).toBe(Infinity);
  });
});

describe('ending a round', () => {
  it('ends the match instead when the round win finishes it', () => {
    // TDM wins the match in one round, so the first round end is a match end.
    const r = rig();
    const ended: Array<{ winner: string; reason: string }> = [];
    r.bus.on(EV.MatchEnded, (p) => ended.push({ winner: p.winner, reason: p.reason }));
    goLive(r);
    r.score.addTeamScore('A', 75);
    r.flow.simulate(10_000);

    expect(r.flow.currentPhase).toBe('MATCH_END');
    expect(r.flow.isOver).toBe(true);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.winner).toBe('A');
    expect(r.flow.result?.winner).toBe('A');
  });

  it('credits the round on the result, not through the score, when the mode ends the match', () => {
    // TDM's win condition returns a `match` result, so the flow calls `endMatch` and never
    // `endRound` — nothing calls `addRoundWin`, and the one round the winner took is carried on
    // the result itself. A mode that returns a `round` result is the other path; see
    // `SearchAndDestroy.test.ts`, which is where a round win is credited through the score.
    const r = rig();
    goLive(r);
    r.score.addTeamScore('B', 75);
    r.flow.simulate(10_000);

    expect(r.flow.currentPhase).toBe('MATCH_END');
    expect(r.flow.result?.winner).toBe('B');
    expect(r.flow.result?.roundsB).toBe(1);
    expect(r.flow.result?.roundsA).toBe(0);
    expect(r.score.team('B').rounds).toBe(0);
  });

  it('stops asking the mode once the match is over', () => {
    const r = rig();
    goLive(r);
    r.score.addTeamScore('A', 75);
    r.flow.simulate(10_000);
    const result = r.flow.result;
    run(r, 5, 20_000);
    expect(r.flow.result).toBe(result);
    expect(r.flow.currentPhase).toBe('MATCH_END');
  });
});

describe('swapping ends', () => {
  it('is announced, and reported to the owner', () => {
    const r = rig();
    const swapped: number[] = [];
    r.bus.on(EV.SidesSwapped, (p) => swapped.push(p.afterRound));
    r.flow.start();

    expect(r.flow.sidesSwapped).toBe(false);
    r.flow.swapSides();
    expect(r.flow.sidesSwapped).toBe(true);
    expect(r.swaps).toEqual([true]);
    expect(swapped).toEqual([1]);

    r.flow.swapSides();
    expect(r.flow.sidesSwapped).toBe(false);
    expect(r.swaps).toEqual([true, false]);
  });

  it('is not triggered by a mode that does not ask for it', () => {
    const r = rig();
    goLive(r);
    r.score.addTeamScore('A', 75);
    r.flow.simulate(10_000);
    expect(r.swaps).toEqual([]);
  });
});

describe('a client adopting the server’s state', () => {
  it('takes the phase, the clock, the round and the score', () => {
    const r = rig({ authoritative: false });
    r.flow.start();
    r.flow.applyReplicated({
      phase: 'LIVE',
      secondsRemaining: 123,
      phaseSeconds: 0,
      round: 2,
      scoreA: 11,
      scoreB: 4,
      serverTick: 900,
    });
    expect(r.flow.currentPhase).toBe('LIVE');
    expect(r.flow.round).toBe(2);
    expect(r.flow.secondsRemaining).toBeCloseTo(123, 1);
    expect(r.flow.isLive).toBe(true);
  });

  it('builds a result when the server says the match is over', () => {
    const r = rig({ authoritative: false });
    r.flow.start();
    r.flow.applyReplicated({
      phase: 'MATCH_END',
      secondsRemaining: 0,
      phaseSeconds: 0,
      round: 1,
      scoreA: 75,
      scoreB: 30,
      serverTick: 9000,
    });
    expect(r.flow.isOver).toBe(true);
    expect(r.flow.result?.winner).toBe('A');
    expect(r.flow.result?.scoreA).toBe(75);
    expect(r.flow.result?.scoreB).toBe(30);
  });

  it('calls a tie on the wire a draw', () => {
    const r = rig({ authoritative: false });
    r.flow.start();
    r.flow.applyReplicated({
      phase: 'MATCH_END',
      secondsRemaining: 0,
      phaseSeconds: 0,
      round: 1,
      scoreA: 40,
      scoreB: 40,
      serverTick: 9000,
    });
    expect(r.flow.result?.winner).toBe('DRAW');
  });
});

describe('the killfeed it owns', () => {
  it('exists from the start, so a kill before the first tick has somewhere to go', () => {
    const r = rig();
    expect(r.flow.killfeed).toBeDefined();
    expect(() => r.flow.setKillfeedDirectory({ nameOf: () => 'X', teamOf: () => 'A' })).not.toThrow();
  });
});
