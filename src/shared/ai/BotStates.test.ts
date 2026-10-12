import { describe, expect, it } from 'vitest';
import { isFiringState, isLegalBotTransition, isTravellingState, type BotState } from './BotStates';

/**
 * The bot state machine's vocabulary and its transition table, pinned.
 *
 * `LEGAL` is not exported, and that is the point of the file: the only way to ask whether a
 * bot may go from SUPPRESS to FLANK is to ask `isLegalBotTransition`. So the table is pinned
 * the way a caller sees it — edge by edge for the edges that carry a decision, and by
 * out-degree for the shape of the whole thing, so a row that gains or loses a destination
 * fails here rather than three minutes into a match.
 *
 * The three maps below are typed `Record<BotState, …>`, which makes the compiler the twelfth
 * assertion: a state added to `BOT_STATES` and forgotten here does not type-check.
 */

const ALL_STATES = [
  'IDLE',
  'PATROL',
  'INVESTIGATE',
  'ENGAGE',
  'SUPPRESS',
  'RELOAD',
  'SEEK_COVER',
  'FLANK',
  'PUSH',
  'OBJECTIVE',
  'DEAD',
] as const satisfies readonly BotState[];

/** How many *other* states each state may legally reach. The shape of `LEGAL`, as one record. */
const OUT_DEGREE = {
  IDLE: 6,
  PATROL: 6,
  INVESTIGATE: 8,
  ENGAGE: 8,
  SUPPRESS: 8,
  RELOAD: 10,
  SEEK_COVER: 9,
  FLANK: 9,
  PUSH: 9,
  OBJECTIVE: 10,
  DEAD: 1,
} satisfies Record<BotState, number>;

function outDegree(from: BotState): number {
  return ALL_STATES.filter((to) => to !== from && isLegalBotTransition(from, to)).length;
}

describe('the legal edges of the bot state machine', () => {
  it('has the out-degree it has, for every state', () => {
    const measured: Record<string, number> = {};
    for (const from of ALL_STATES) measured[from] = outDegree(from);
    expect(measured).toEqual(OUT_DEGREE);
  });

  it('always allows a state to stay where it is', () => {
    for (const state of ALL_STATES) expect(isLegalBotTransition(state, state)).toBe(true);
  });

  it('lets every living state die', () => {
    for (const from of ALL_STATES) {
      if (from === 'DEAD') continue;
      expect(isLegalBotTransition(from, 'DEAD')).toBe(true);
    }
  });

  it('makes the respawn the single door back into the machine', () => {
    expect(isLegalBotTransition('DEAD', 'IDLE')).toBe(true);
    for (const to of ALL_STATES) {
      if (to === 'IDLE' || to === 'DEAD') continue;
      expect(isLegalBotTransition('DEAD', to)).toBe(false);
    }
  });

  it('lets a bot that spawned with a low magazine reload (M7)', () => {
    // Without this edge the bot asks for RELOAD on every decision, is refused, and never
    // leaves IDLE. Nine bots stood still for a whole match.
    expect(isLegalBotTransition('IDLE', 'RELOAD')).toBe(true);
  });

  it('refuses the tactical states to a bot that has just spawned', () => {
    expect(isLegalBotTransition('IDLE', 'SUPPRESS')).toBe(false);
    expect(isLegalBotTransition('IDLE', 'SEEK_COVER')).toBe(false);
    expect(isLegalBotTransition('IDLE', 'FLANK')).toBe(false);
    expect(isLegalBotTransition('IDLE', 'PUSH')).toBe(false);
  });

  it('refuses a patrolling bot the states that need a target', () => {
    expect(isLegalBotTransition('PATROL', 'SUPPRESS')).toBe(false);
    expect(isLegalBotTransition('PATROL', 'SEEK_COVER')).toBe(false);
    expect(isLegalBotTransition('PATROL', 'FLANK')).toBe(false);
    expect(isLegalBotTransition('PATROL', 'PUSH')).toBe(false);
    expect(isLegalBotTransition('PATROL', 'ENGAGE')).toBe(true);
    expect(isLegalBotTransition('PATROL', 'INVESTIGATE')).toBe(true);
  });

  it('lets an objective be abandoned for anything at all', () => {
    for (const to of ALL_STATES) expect(isLegalBotTransition('OBJECTIVE', to)).toBe(true);
  });

  it('lets every living state take the objective', () => {
    for (const from of ALL_STATES) {
      if (from === 'DEAD') continue;
      expect(isLegalBotTransition(from, 'OBJECTIVE')).toBe(true);
    }
  });

  it('keeps the fight and the reload mutually reachable', () => {
    expect(isLegalBotTransition('ENGAGE', 'RELOAD')).toBe(true);
    expect(isLegalBotTransition('RELOAD', 'ENGAGE')).toBe(true);
    expect(isLegalBotTransition('SUPPRESS', 'RELOAD')).toBe(true);
    expect(isLegalBotTransition('RELOAD', 'SUPPRESS')).toBe(true);
  });

  it('refuses ENGAGE straight out of SEEK_COVER only in the direction it refuses', () => {
    // SEEK_COVER can go back to the fight; ENGAGE can ask for cover. Both ways are open.
    expect(isLegalBotTransition('SEEK_COVER', 'ENGAGE')).toBe(true);
    expect(isLegalBotTransition('ENGAGE', 'SEEK_COVER')).toBe(true);
  });
});

describe('the states in which a bot is shooting', () => {
  const FIRING = {
    IDLE: false,
    PATROL: false,
    INVESTIGATE: false,
    ENGAGE: true,
    SUPPRESS: true,
    RELOAD: false,
    SEEK_COVER: false,
    FLANK: true,
    PUSH: true,
    // A defender sent to a bomb with its trigger disabled walked through a firefight,
    // five S&D rounds out of five.
    OBJECTIVE: true,
    DEAD: false,
  } satisfies Record<BotState, boolean>;

  it('is exactly the five', () => {
    const measured: Record<string, boolean> = {};
    for (const state of ALL_STATES) measured[state] = isFiringState(state);
    expect(measured).toEqual(FIRING);
  });
});

describe('the states in which a bot is walking somewhere specific', () => {
  const TRAVELLING = {
    IDLE: false,
    PATROL: true,
    INVESTIGATE: true,
    ENGAGE: false,
    SUPPRESS: false,
    RELOAD: false,
    SEEK_COVER: true,
    FLANK: true,
    PUSH: true,
    // Missing from this predicate was the "bots strafe to the flag" report: the look branch
    // in `BotBrain.steer` is keyed on it, so the bot never faced the way it was walking.
    OBJECTIVE: true,
    DEAD: false,
  } satisfies Record<BotState, boolean>;

  it('is exactly the six', () => {
    const measured: Record<string, boolean> = {};
    for (const state of ALL_STATES) measured[state] = isTravellingState(state);
    expect(measured).toEqual(TRAVELLING);
  });

  it('overlaps the firing states only where a bot both walks and shoots', () => {
    const both = ALL_STATES.filter((s) => isFiringState(s) && isTravellingState(s));
    expect(both).toEqual(['FLANK', 'PUSH', 'OBJECTIVE']);
  });
});
