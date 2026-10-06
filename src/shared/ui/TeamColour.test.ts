import { describe, expect, it } from 'vitest';
import type { ScoreTeam } from '../combat/ScoreSystem';
import {
  relationClass,
  relationTo,
  relationToSelf,
  teamLabel,
  teamsInViewOrder,
  type TeamRelation,
  type ViewerContext,
} from './TeamColour';

/**
 * Colour and position as functions of the pair (viewer, subject), never of the team id alone
 * (playtest round 4, B12).
 *
 * The defect this pins is one a type cannot catch on its own: every answer here is asserted
 * from **both seats**, because the whole report was three surfaces that happened to be right
 * for the player on team A. A rule only ever checked from seat A is the rule that shipped.
 */

const SEAT_A: ViewerContext = { team: 'A', freeForAll: false };
const SEAT_B: ViewerContext = { team: 'B', freeForAll: false };
const FFA_A: ViewerContext = { team: 'A', freeForAll: true };
const FFA_B: ViewerContext = { team: 'B', freeForAll: true };

const TEAMS: readonly ScoreTeam[] = ['A', 'B'];

describe('relationTo', () => {
  it('your own side is friendly from either seat', () => {
    expect(relationTo(SEAT_A, 'A')).toBe('FRIENDLY');
    expect(relationTo(SEAT_B, 'B')).toBe('FRIENDLY');
  });

  it('the other side is hostile from either seat', () => {
    expect(relationTo(SEAT_A, 'B')).toBe('HOSTILE');
    expect(relationTo(SEAT_B, 'A')).toBe('HOSTILE');
  });

  it('answers every pair of teams the same way round', () => {
    for (const viewer of TEAMS) {
      for (const subject of TEAMS) {
        const seat: ViewerContext = { team: viewer, freeForAll: false };
        expect(relationTo(seat, subject)).toBe(viewer === subject ? 'FRIENDLY' : 'HOSTILE');
      }
    }
  });

  it('NONE is a real subject and reads neutral, not missing', () => {
    expect(relationTo(SEAT_A, 'NONE')).toBe('NEUTRAL');
    expect(relationTo(SEAT_B, 'NONE')).toBe('NEUTRAL');
    expect(relationTo(FFA_A, 'NONE')).toBe('NEUTRAL');
  });

  it('in Free-for-All everybody is hostile, including the side the viewer shares', () => {
    expect(relationTo(FFA_A, 'A')).toBe('HOSTILE');
    expect(relationTo(FFA_A, 'B')).toBe('HOSTILE');
    expect(relationTo(FFA_B, 'A')).toBe('HOSTILE');
    expect(relationTo(FFA_B, 'B')).toBe('HOSTILE');
  });
});

describe('relationToSelf', () => {
  it('is friendly, which is the answer the substrate cannot give in Free-for-All', () => {
    expect(relationToSelf()).toBe('FRIENDLY');
    // The viewer own row in FFA: relationTo calls it hostile, which is why this exists.
    expect(relationTo(FFA_A, 'A')).toBe('HOSTILE');
  });
});

describe('relationClass', () => {
  it('is the only door from a relation to a stylesheet suffix', () => {
    expect(relationClass('FRIENDLY')).toBe('friendly');
    expect(relationClass('HOSTILE')).toBe('hostile');
    expect(relationClass('NEUTRAL')).toBe('neutral');
  });

  it('answers every relation, so no caller has to invent a fallback', () => {
    const relations: readonly TeamRelation[] = ['FRIENDLY', 'HOSTILE', 'NEUTRAL'];
    for (const relation of relations) {
      expect(relationClass(relation).length).toBeGreaterThan(0);
    }
  });
});

describe('teamsInViewOrder', () => {
  it('puts the viewer first, from either seat', () => {
    expect(teamsInViewOrder(SEAT_A)).toEqual(['A', 'B']);
    expect(teamsInViewOrder(SEAT_B)).toEqual(['B', 'A']);
  });

  it('is viewer-first in Free-for-All too', () => {
    expect(teamsInViewOrder(FFA_A)).toEqual(['A', 'B']);
    expect(teamsInViewOrder(FFA_B)).toEqual(['B', 'A']);
  });

  it('the first slot is always the viewer, which is what B12 asked for', () => {
    for (const viewer of TEAMS) {
      expect(teamsInViewOrder({ team: viewer, freeForAll: false })[0]).toBe(viewer);
    }
  });
});

describe('teamLabel', () => {
  it('is relative, so neither seat is told it is the Axis', () => {
    expect(teamLabel('FRIENDLY')).toBe('ALLIES');
    expect(teamLabel('HOSTILE')).toBe('AXIS');
    expect(teamLabel('NEUTRAL')).toBe('NEUTRAL');
  });

  it('a player on either side reads ALLIES over their own block', () => {
    expect(teamLabel(relationTo(SEAT_A, 'A'))).toBe('ALLIES');
    expect(teamLabel(relationTo(SEAT_B, 'B'))).toBe('ALLIES');
  });
});
