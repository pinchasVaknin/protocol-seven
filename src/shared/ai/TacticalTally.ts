// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { BotState, BotTeam } from '../core/Vocabulary';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** What the tally reads of a bot. `Bot` satisfies it; a test can build one without a body. */
export interface TallyBot {
  readonly entityId: number;
  readonly team: BotTeam;
  readonly px: number;
  readonly pz: number;
  readonly health: { readonly alive: boolean };
  readonly blackboard: {
    readonly hasLos: boolean;
    readonly targetId: number;
    readonly hasKnownTarget: boolean;
    readonly investigateValid: boolean;
    readonly visibleEnemies: number;
  };
}

/** What the tally reads of a bot that has just died. */
export interface TallyVictim extends TallyBot {
  readonly brain: { readonly state: BotState };
  readonly path: { readonly active: boolean };
  readonly reloading: boolean;
  readonly magazine: number;
}

/** Anyone a bot can target: a bot, or a human on the roster. */
export interface TallyBody {
  readonly entityId: number;
  readonly px: number;
  readonly pz: number;
}

/** The counters as plain numbers, ready for JSON. Every key is a raw count, never a ratio. */
export interface TacticalSummary {
  decisions: number;
  rejected: number;
  losDecisions: number;
  idleLosDecisions: number;
  hurtDecisions: number;
  hurtInCover: number;
  steerTicks: number;
  coverNoPathTicks: number;
  stateTicks: Record<string, number>;
  stuckLive: number;
  stuckFrozen: number;
  knownTargetTicks: number;
  deadTargetTicks: number;
  seenTargets: number;
  multiTargets: number;
  crossTargets: number;
  closeSamples: number;
  closeBots: number;
  uninformed: number;
  livingSamples: number;
  deaths: number;
  deathsObjective: number;
  deathsObjOutnumbered: number;
  deathsReloadSeeing: number;
  deathsEmpty: number;
  deathsRunToCover: number;
  deathsInCover: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** The eleven states in `BotStates.test.ts` order. Index into `TacticalTally.stateTicks`. */
export const TALLY_STATES = [
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

/** Most attackers on one target the cross measurement looks at. */
const MAX_ATTACKERS = 16;
/** Most bots `sampleTeams` walks. A match has ten; this is a bound, not a limit anyone meets. */
const MAX_BOTS = 64;
/** Two attackers this far apart, seen from the target, count as a crossfire. 45 degrees. */
const CROSS_ANGLE = Math.PI / 4;
/** A bot with a team-mate closer than this is "close", metres. */
const CLOSE_RADIUS = 3;
/** A team-mate this near who can see an enemy makes an unaware bot "uninformed", metres. */
const INFORMED_RADIUS = 30;
/** Team-mates this near count against an objective death, metres. */
const ALLY_RADIUS = 15;
const TWO_PI = Math.PI * 2;
//#endregion

// ==================================== CLASS TacticalTally ===================================== \\
//#region Class TacticalTally
/**
 * The measuring instrument (bot AI plan, S0).
 *
 * Counts what the bots do, so a change to the AI can be judged by a number rather than by a
 * feeling. It reads and never writes: no bot is touched, no `Rng` is drawn, and nothing here
 * can change a decision. That is the whole contract — the oracles must not move.
 *
 * It also reads where an enemy really is (the cross measurement and the death tally look a
 * target up on the roster). The plan's R6 allows that exception for exactly this class, because
 * the figures it counts are never fed back to a bot.
 */
export class TacticalTally {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  decisions = 0;
  rejected = 0;
  losDecisions = 0;
  idleLosDecisions = 0;
  hurtDecisions = 0;
  hurtInCover = 0;
  steerTicks = 0;
  coverNoPathTicks = 0;
  stuckLive = 0;
  stuckFrozen = 0;
  knownTargetTicks = 0;
  deadTargetTicks = 0;
  seenTargets = 0;
  multiTargets = 0;
  crossTargets = 0;
  closeSamples = 0;
  closeBots = 0;
  uninformed = 0;
  livingSamples = 0;
  deaths = 0;
  deathsObjective = 0;
  deathsObjOutnumbered = 0;
  deathsReloadSeeing = 0;
  deathsEmpty = 0;
  deathsRunToCover = 0;
  deathsInCover = 0;

  /** Bot-ticks per state, indexed like `TALLY_STATES`. */
  readonly stateTicks = new Float64Array(TALLY_STATES.length);

  private readonly done = new Uint8Array(MAX_BOTS);
  private readonly bearing = new Float64Array(MAX_ATTACKERS);
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** One `decide` on a living bot. `state` is the one it began in, before the decision. */
  noteDecision(state: BotState, hasLos: boolean, hurt: boolean): void {
    this.decisions++;
    if (hasLos) {
      this.losDecisions++;
      if (state === 'IDLE' || state === 'PATROL' || state === 'INVESTIGATE') this.idleLosDecisions++;
    }
    if (hurt) {
      this.hurtDecisions++;
      if (state === 'SEEK_COVER') this.hurtInCover++;
    }
  }

  /** One `transition` the legal table refused. */
  noteRejected(): void {
    this.rejected++;
  }

  /** One `steer` call. */
  noteTick(state: BotState, pathActive: boolean): void {
    this.steerTicks++;
    const at = TALLY_STATES.indexOf(state);
    this.stateTicks[at] = (this.stateTicks[at] ?? 0) + 1;
    if (state === 'SEEK_COVER' && !pathActive) this.coverNoPathTicks++;
  }

  /** A stuck event, split by whether the bot was allowed to move at all. */
  noteStuck(frozen: boolean): void {
    if (frozen) this.stuckFrozen++;
    else this.stuckLive++;
  }

  /** One living bot that believes in a target; `dead` when that target is a dead bot. */
  noteKnownTarget(dead: boolean): void {
    this.knownTargetTicks++;
    if (dead) this.deadTargetTicks++;
  }

  /**
   * A bot has just died. Call it before the bot's own `onKilled`, which overwrites its state.
   * `bots` is the roster of bots, for the team-mates standing near the victim.
   */
  noteDeath(victim: TallyVictim, bots: readonly TallyBot[]): void {
    this.deaths++;
    const state = victim.brain.state;
    if (state === 'OBJECTIVE') {
      this.deathsObjective++;
      if (victim.blackboard.visibleEnemies > 1 + this.alliesWithin(victim, bots, ALLY_RADIUS)) {
        this.deathsObjOutnumbered++;
      }
    }
    if (victim.reloading && victim.blackboard.hasLos) this.deathsReloadSeeing++;
    if (victim.magazine <= 0) this.deathsEmpty++;
    if (state === 'SEEK_COVER') {
      if (victim.path.active) this.deathsRunToCover++;
      else this.deathsInCover++;
    }
  }

  /**
   * The team measurements, once per call (the director calls it every 30 ticks).
   *
   * Per side: how many targets are seen by two or more of its bots and how many of those are
   * seen from at least 45 degrees apart, how close its bots stand to each other, and how many
   * know nothing while a team-mate within 30 m can see an enemy. In Free-for-All the same two
   * nominal sides are used, which is what keeps the figures comparable with a team match.
   */
  sampleTeams(bots: readonly TallyBot[], roster: readonly TallyBody[]): void {
    this.sampleSide('A', bots, roster);
    this.sampleSide('B', bots, roster);
  }

  reset(): void {
    this.decisions = 0;
    this.rejected = 0;
    this.losDecisions = 0;
    this.idleLosDecisions = 0;
    this.hurtDecisions = 0;
    this.hurtInCover = 0;
    this.steerTicks = 0;
    this.coverNoPathTicks = 0;
    this.stuckLive = 0;
    this.stuckFrozen = 0;
    this.knownTargetTicks = 0;
    this.deadTargetTicks = 0;
    this.seenTargets = 0;
    this.multiTargets = 0;
    this.crossTargets = 0;
    this.closeSamples = 0;
    this.closeBots = 0;
    this.uninformed = 0;
    this.livingSamples = 0;
    this.deaths = 0;
    this.deathsObjective = 0;
    this.deathsObjOutnumbered = 0;
    this.deathsReloadSeeing = 0;
    this.deathsEmpty = 0;
    this.deathsRunToCover = 0;
    this.deathsInCover = 0;
    this.stateTicks.fill(0);
  }

  /** Plain numbers. Allocates; it is for the end-of-match report, never for a tick. */
  summary(): TacticalSummary {
    const stateTicks: Record<string, number> = {};
    for (let i = 0; i < TALLY_STATES.length; i++) {
      stateTicks[TALLY_STATES[i] as string] = this.stateTicks[i] ?? 0;
    }
    return {
      decisions: this.decisions,
      rejected: this.rejected,
      losDecisions: this.losDecisions,
      idleLosDecisions: this.idleLosDecisions,
      hurtDecisions: this.hurtDecisions,
      hurtInCover: this.hurtInCover,
      steerTicks: this.steerTicks,
      coverNoPathTicks: this.coverNoPathTicks,
      stateTicks,
      stuckLive: this.stuckLive,
      stuckFrozen: this.stuckFrozen,
      knownTargetTicks: this.knownTargetTicks,
      deadTargetTicks: this.deadTargetTicks,
      seenTargets: this.seenTargets,
      multiTargets: this.multiTargets,
      crossTargets: this.crossTargets,
      closeSamples: this.closeSamples,
      closeBots: this.closeBots,
      uninformed: this.uninformed,
      livingSamples: this.livingSamples,
      deaths: this.deaths,
      deathsObjective: this.deathsObjective,
      deathsObjOutnumbered: this.deathsObjOutnumbered,
      deathsReloadSeeing: this.deathsReloadSeeing,
      deathsEmpty: this.deathsEmpty,
      deathsRunToCover: this.deathsRunToCover,
      deathsInCover: this.deathsInCover,
    };
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private sampleSide(team: BotTeam, bots: readonly TallyBot[], roster: readonly TallyBody[]): void {
    const n = Math.min(bots.length, MAX_BOTS);
    this.done.fill(0);
    for (let i = 0; i < n; i++) {
      const bot = bots[i];
      if (bot === undefined || bot.team !== team || !bot.health.alive) continue;
      this.sampleCloseness(bot, bots, n);
      this.sampleInformed(bot, bots, n);
      if (this.done[i] === 1 || !bot.blackboard.hasLos) continue;
      this.sampleTarget(i, team, bots, n, roster);
    }
  }

  /** Nearest living team-mate under 3 m, over the bots that have a living team-mate. */
  private sampleCloseness(bot: TallyBot, bots: readonly TallyBot[], n: number): void {
    let nearest = Infinity;
    for (let j = 0; j < n; j++) {
      const mate = bots[j];
      if (mate === undefined || mate === bot || mate.team !== bot.team || !mate.health.alive) continue;
      const d = Math.hypot(mate.px - bot.px, mate.pz - bot.pz);
      if (d < nearest) nearest = d;
    }
    if (nearest === Infinity) return;
    this.closeSamples++;
    if (nearest < CLOSE_RADIUS) this.closeBots++;
  }

  /** A living bot with no target and no noise to follow while a team-mate nearby can see. */
  private sampleInformed(bot: TallyBot, bots: readonly TallyBot[], n: number): void {
    this.livingSamples++;
    if (bot.blackboard.hasKnownTarget || bot.blackboard.investigateValid) return;
    for (let j = 0; j < n; j++) {
      const mate = bots[j];
      if (mate === undefined || mate === bot || mate.team !== bot.team || !mate.health.alive) continue;
      if (!mate.blackboard.hasLos) continue;
      if (Math.hypot(mate.px - bot.px, mate.pz - bot.pz) > INFORMED_RADIUS) continue;
      this.uninformed++;
      return;
    }
  }

  /** Gather every bot of `team` that sees the same target as bot `first`, and score the group. */
  private sampleTarget(
    first: number,
    team: BotTeam,
    bots: readonly TallyBot[],
    n: number,
    roster: readonly TallyBody[],
  ): void {
    const firstBot = bots[first];
    if (firstBot === undefined) return;
    const targetId = firstBot.blackboard.targetId;
    const target = this.find(roster, targetId);
    let count = 0;
    for (let j = first; j < n; j++) {
      const b = bots[j];
      if (b === undefined || b.team !== team || !b.health.alive) continue;
      if (!b.blackboard.hasLos || b.blackboard.targetId !== targetId) continue;
      this.done[j] = 1;
      if (target === undefined || count >= MAX_ATTACKERS) continue;
      this.bearing[count++] = Math.atan2(b.pz - target.pz, b.px - target.px);
    }
    if (target === undefined) return;
    this.seenTargets++;
    if (count < 2) return;
    this.multiTargets++;
    if (this.widestPair(count) >= CROSS_ANGLE) this.crossTargets++;
  }

  private widestPair(count: number): number {
    let widest = 0;
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        let d = Math.abs((this.bearing[a] ?? 0) - (this.bearing[b] ?? 0));
        if (d > Math.PI) d = TWO_PI - d;
        if (d > widest) widest = d;
      }
    }
    return widest;
  }

  private find(roster: readonly TallyBody[], entityId: number): TallyBody | undefined {
    for (let i = 0; i < roster.length; i++) {
      const c = roster[i];
      if (c !== undefined && c.entityId === entityId) return c;
    }
    return undefined;
  }

  private alliesWithin(victim: TallyBot, bots: readonly TallyBot[], radius: number): number {
    let count = 0;
    for (let j = 0; j < bots.length; j++) {
      const mate = bots[j];
      if (mate === undefined || mate === victim || mate.team !== victim.team || !mate.health.alive) continue;
      if (Math.hypot(mate.px - victim.px, mate.pz - victim.pz) <= radius) count++;
    }
    return count;
  }
  //#endregion
}
//#endregion
