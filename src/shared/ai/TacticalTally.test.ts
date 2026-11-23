import { describe, expect, it } from 'vitest';
import { simCos, simSin } from '../core/SimMath';
import type { BotState, BotTeam } from '../core/Vocabulary';
import { TacticalTally, TALLY_STATES, type TallyBody, type TallyBot, type TallyVictim } from './TacticalTally';

/**
 * The instrument, in isolation. It is built on plain records so no body, no world and no `Rng`
 * is needed: the tally reads a handful of fields and that is all a test has to supply.
 */

interface Spec {
  id: number;
  team?: BotTeam;
  x?: number;
  z?: number;
  alive?: boolean;
  hasLos?: boolean;
  targetId?: number;
  known?: boolean;
  investigate?: boolean;
  visible?: number;
}

function bot(s: Spec): TallyBot {
  return {
    entityId: s.id,
    team: s.team ?? 'A',
    px: s.x ?? 0,
    pz: s.z ?? 0,
    health: { alive: s.alive ?? true },
    blackboard: {
      hasLos: s.hasLos ?? false,
      targetId: s.targetId ?? -1,
      hasKnownTarget: s.known ?? false,
      investigateValid: s.investigate ?? false,
      visibleEnemies: s.visible ?? 0,
    },
  };
}

function victim(
  s: Spec,
  state: BotState,
  extra: { pathActive?: boolean; reloading?: boolean; magazine?: number } = {},
): TallyVictim {
  return {
    ...bot(s),
    brain: { state },
    path: { active: extra.pathActive ?? false },
    reloading: extra.reloading ?? false,
    magazine: extra.magazine ?? 30,
  };
}

const TARGET: TallyBody = { entityId: 900, px: 0, pz: 0 };

describe('TacticalTally', () => {
  it('starts every counter at zero', () => {
    const t = new TacticalTally();
    const s = t.summary();
    for (const [key, value] of Object.entries(s)) {
      if (key === 'stateTicks') continue;
      expect(value, key).toBe(0);
    }
    for (const state of TALLY_STATES) expect(s.stateTicks[state], state).toBe(0);
  });

  it('counts a refused transition when told', () => {
    const t = new TacticalTally();
    t.noteRejected();
    expect(t.summary().rejected).toBe(1);
  });

  it('counts a decision by what the bot saw and how hurt it was, from the state it began in', () => {
    const t = new TacticalTally();
    t.noteDecision('PATROL', true, false);
    t.noteDecision('ENGAGE', true, false);
    t.noteDecision('SEEK_COVER', false, true);
    t.noteDecision('IDLE', false, true);
    const s = t.summary();
    expect(s.decisions).toBe(4);
    expect(s.losDecisions).toBe(2);
    expect(s.idleLosDecisions).toBe(1);
    expect(s.hurtDecisions).toBe(2);
    expect(s.hurtInCover).toBe(1);
  });

  it('counts steer ticks per state, and a cover bot with no path', () => {
    const t = new TacticalTally();
    t.noteTick('ENGAGE', true);
    t.noteTick('SEEK_COVER', true);
    t.noteTick('SEEK_COVER', false);
    const s = t.summary();
    expect(s.steerTicks).toBe(3);
    expect(s.stateTicks.ENGAGE).toBe(1);
    expect(s.stateTicks.SEEK_COVER).toBe(2);
    expect(s.coverNoPathTicks).toBe(1);
  });

  it('splits stuck events into frozen and live', () => {
    const t = new TacticalTally();
    t.noteStuck(true);
    t.noteStuck(true);
    t.noteStuck(false);
    expect(t.summary().stuckFrozen).toBe(2);
    expect(t.summary().stuckLive).toBe(1);
  });

  it('counts the ticks a bot believes in a dead target', () => {
    const t = new TacticalTally();
    t.noteKnownTarget(false);
    t.noteKnownTarget(true);
    expect(t.summary().knownTargetTicks).toBe(2);
    expect(t.summary().deadTargetTicks).toBe(1);
  });

  describe('crossfire', () => {
    it('two attackers 90 degrees apart around a target is one cross', () => {
      const t = new TacticalTally();
      const bots = [
        bot({ id: 1, x: 10, z: 0, hasLos: true, targetId: 900 }),
        bot({ id: 2, x: 0, z: 10, hasLos: true, targetId: 900 }),
      ];
      t.sampleTeams(bots, [TARGET]);
      const s = t.summary();
      expect(s.seenTargets).toBe(1);
      expect(s.multiTargets).toBe(1);
      expect(s.crossTargets).toBe(1);
    });

    it('two attackers on the same side is multi but not a cross', () => {
      const t = new TacticalTally();
      const bots = [
        bot({ id: 1, x: 10, z: 0, hasLos: true, targetId: 900 }),
        bot({ id: 2, x: 10, z: 2, hasLos: true, targetId: 900 }),
      ];
      t.sampleTeams(bots, [TARGET]);
      const s = t.summary();
      expect(s.multiTargets).toBe(1);
      expect(s.crossTargets).toBe(0);
    });

    it('a target seen by one bot is seen but not multi', () => {
      const t = new TacticalTally();
      t.sampleTeams([bot({ id: 1, x: 10, hasLos: true, targetId: 900 })], [TARGET]);
      expect(t.summary().seenTargets).toBe(1);
      expect(t.summary().multiTargets).toBe(0);
    });

    it('measures the angle the short way round', () => {
      const t = new TacticalTally();
      // 170 and -170 degrees are 20 apart, not 340.
      const a = (170 * Math.PI) / 180;
      const b = (-170 * Math.PI) / 180;
      const bots = [
        bot({ id: 1, x: 10 * simCos(a), z: 10 * simSin(a), hasLos: true, targetId: 900 }),
        bot({ id: 2, x: 10 * simCos(b), z: 10 * simSin(b), hasLos: true, targetId: 900 }),
      ];
      t.sampleTeams(bots, [TARGET]);
      expect(t.summary().crossTargets).toBe(0);
    });

    it('skips a target that is no longer on the roster', () => {
      const t = new TacticalTally();
      t.sampleTeams([bot({ id: 1, hasLos: true, targetId: 777 })], [TARGET]);
      expect(t.summary().seenTargets).toBe(0);
    });

    it('ignores a dead bot and a bot that cannot see', () => {
      const t = new TacticalTally();
      const bots = [
        bot({ id: 1, x: 10, hasLos: true, targetId: 900, alive: false }),
        bot({ id: 2, z: 10, hasLos: false, targetId: 900 }),
      ];
      t.sampleTeams(bots, [TARGET]);
      expect(t.summary().seenTargets).toBe(0);
    });
  });

  describe('closeness', () => {
    it('3 m is not close, 2.99 m is', () => {
      const far = new TacticalTally();
      far.sampleTeams([bot({ id: 1, x: 0 }), bot({ id: 2, x: 3 })], []);
      expect(far.summary().closeSamples).toBe(2);
      expect(far.summary().closeBots).toBe(0);

      const near = new TacticalTally();
      near.sampleTeams([bot({ id: 1, x: 0 }), bot({ id: 2, x: 2.99 })], []);
      expect(near.summary().closeBots).toBe(2);
    });

    it('a bot with no living team-mate is not sampled', () => {
      const t = new TacticalTally();
      t.sampleTeams([bot({ id: 1 }), bot({ id: 2, team: 'B', x: 1 })], []);
      expect(t.summary().closeSamples).toBe(0);
    });
  });

  describe('uninformed', () => {
    it('counts a bot that knows nothing while a team-mate within 30 m sees an enemy', () => {
      const t = new TacticalTally();
      t.sampleTeams([bot({ id: 1 }), bot({ id: 2, x: 20, hasLos: true, targetId: 900, known: true })], [TARGET]);
      expect(t.summary().uninformed).toBe(1);
      expect(t.summary().livingSamples).toBe(2);
    });

    it('does not count it past 30 m, or when the bot has a lead', () => {
      const t = new TacticalTally();
      t.sampleTeams(
        [
          bot({ id: 1 }),
          bot({ id: 2, x: 31, hasLos: true, targetId: 900, known: true }),
          bot({ id: 3, x: 40, investigate: true }),
        ],
        [TARGET],
      );
      expect(t.summary().uninformed).toBe(0);
    });
  });

  describe('deaths', () => {
    it('files each death under what the bot was doing', () => {
      const t = new TacticalTally();
      const mates = [bot({ id: 2, x: 5 }), bot({ id: 3, x: 40 })];
      t.noteDeath(victim({ id: 1, visible: 3, hasLos: true }, 'OBJECTIVE', { reloading: true }), mates);
      t.noteDeath(victim({ id: 1 }, 'SEEK_COVER', { pathActive: true, magazine: 0 }), mates);
      t.noteDeath(victim({ id: 1 }, 'SEEK_COVER'), mates);
      const s = t.summary();
      expect(s.deaths).toBe(3);
      expect(s.deathsObjective).toBe(1);
      // Three enemies in view against one friend within 15 m (the other is 40 m away).
      expect(s.deathsObjOutnumbered).toBe(1);
      expect(s.deathsReloadSeeing).toBe(1);
      expect(s.deathsEmpty).toBe(1);
      expect(s.deathsRunToCover).toBe(1);
      expect(s.deathsInCover).toBe(1);
    });

    it('two enemies against one friend is not outnumbered', () => {
      const t = new TacticalTally();
      t.noteDeath(victim({ id: 1, visible: 2 }, 'OBJECTIVE'), [bot({ id: 2, x: 5 })]);
      expect(t.summary().deathsObjOutnumbered).toBe(0);
    });
  });

  it('reset puts everything back to zero', () => {
    const t = new TacticalTally();
    t.noteRejected();
    t.noteTick('FLANK', true);
    t.noteDeath(victim({ id: 1 }, 'ENGAGE'), []);
    t.sampleTeams([bot({ id: 1 }), bot({ id: 2, x: 1 })], []);
    t.reset();
    expect(t.summary()).toEqual(new TacticalTally().summary());
  });

  it('a summary of an untouched tally has no NaN and survives JSON', () => {
    const json = JSON.stringify(new TacticalTally().summary());
    expect(json).not.toContain('null');
    expect(json).not.toContain('NaN');
  });
});
