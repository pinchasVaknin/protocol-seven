/**
 * Where somebody comes back (brief S6.9).
 *
 * The rule is "never spawn within 15 m of a living enemy or inside their view cone", and
 * the interesting part of S6.9 is the second half: *score candidates, pick the best, fall
 * back to the least-bad rather than failing.* A spawn selector that can return "no" is a
 * spawn selector that will, at which point a bot stops existing. So this never fails, and
 * instead reports which of three tiers it had to settle for:
 *
 *   1. **Safe.** Beyond 15 m and outside every living enemy's cone. What should happen.
 *   2. **Hidden.** Beyond 15 m, technically inside a cone, but with no line of sight — an
 *      enemy facing a wall you happen to be behind.
 *   3. **Least bad.** Nothing qualified. Maximise distance, penalise being seen heavily,
 *      and take it.
 *
 * Both counters are reported separately because acceptance criterion 5 asks specifically
 * how many spawns landed inside a cone, and the honest answer distinguishes "inside a cone
 * we could not avoid" from "visible to somebody".
 *
 * Candidates come from the map's own `spawns`, jittered inside each zone's radius and
 * snapped to the navmesh, so a zone the map author put half inside a pillar still yields
 * usable points instead of one broken one. M4 keeps this code and changes only the data.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { isHostile } from '../combat/Hostility';
import { DEG2RAD } from '../core/MathUtil';
import type { Rng } from '../core/Rng';
import type { NavGrid } from '../world/Navmesh';
import type { SpawnZone } from '../world/maps/types';
import { opposingTeam, type BotTeam, type Combatant } from './Combatant';
import type { PerceptionConfig } from './DifficultyTiers';
import type { Perception } from './Perception';
import { simCos, simSin } from '../core/SimMath';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
type SpawnTier = 'safe' | 'hidden' | 'leastBad';

export interface SpawnChoice {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tier: SpawnTier;
  /** Distance to the nearest living enemy at the moment of selection, metres. */
  nearestEnemy: number;
  /** True if any living enemy had this point inside its view cone and in range. */
  insideCone: boolean;
  /** True if any living enemy could actually have seen it. */
  visible: boolean;
}

/** Running totals, for the acceptance report. */
export interface SpawnStats {
  selections: number;
  safe: number;
  hidden: number;
  leastBad: number;
  /** Spawns that were inside an enemy cone. Expected: zero. */
  coneViolations: number;
  /** Spawns an enemy could actually have seen. Expected: zero. */
  visibleViolations: number;
  /** Smallest enemy distance any selection produced, metres. */
  minEnemyDistance: number;
}

interface Candidate {
  x: number;
  y: number;
  z: number;
  yaw: number;
  team: BotTeam | 'FFA';
  /** Ticks-since-used bookkeeping so consecutive spawns are not stacked. */
  lastUsedTick: number;
}

/** One candidate, scored, for the debug visualisation. Reused; never allocated per point. */
export interface SpawnInspection {
  x: number;
  y: number;
  z: number;
  /** False when this candidate belongs to the other team's zones. */
  eligible: boolean;
  score: number;
  distance: number;
  cone: boolean;
  visible: boolean;
  tier: SpawnTier;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const MIN_ENEMY_DISTANCE = 15;

/**
 * Jittered points generated per authored zone.
 *
 * Raised from 5 to 9 after measurement: at 3v4 in the grey-box room every candidate
 * clearing 15 m was sometimes *visible* to an enemy, forcing three spawns in fifty into
 * the least-bad tier in front of somebody. Spawn selection runs on death, a handful of
 * times a minute, so a wider candidate pool costs nothing that matters and it is the
 * only lever that reliably finds a point behind cover.
 *
 * Raised again to 14 post-M8, for the same reason one step further out: eight-player
 * Free-for-All asks the selector to seat twice as many people as the 5v5 the number was
 * tuned against, and the tier a thin pool degrades into is the one that spawns you on
 * somebody. The whole loop is a few hundred candidate scorings on a death — it does not
 * run on a frame, and it is nowhere near anything with a budget.
 */
const SAMPLES_PER_ZONE = 14;

/** Where `measure` leaves its answer: module scratch, so a measurement allocates nothing. */
let measuredDistance = Infinity;
let measuredFriendly = Infinity;
let measuredCone = false;
let measuredVisible = false;
//#endregion

// ==================================== CLASS SpawnSelector ===================================== \\
//#region Class SpawnSelector
export class SpawnSelector {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /**
   * Free-for-All: score a candidate spawn against *every* other combatant.
   *
   * With teams, a spawn only has to be far from the other side. With seven independent
   * hostiles there is no such thing as a safe direction, so the nearest-enemy term has to
   * consider everybody or the mode spawns people on top of each other.
   */
  freeForAll = false;

  readonly stats: SpawnStats = {
    selections: 0,
    safe: 0,
    hidden: 0,
    leastBad: 0,
    coneViolations: 0,
    visibleViolations: 0,
    minEnemyDistance: Infinity,
  };

  private readonly candidateList: Candidate[] = [];
  /**
   * When set, each team draws from the other team's zones (M4).
   *
   * This is what a mode's `swapSidesAfterRound` actually *does* in this build: spawns are the
   * only side-dependent thing a match owns, so changing ends means changing which set of
   * candidates a team is scored against. TDM never triggers it; `MatchFlow.swapSides` does.
   */
  private swapped = false;
  /**
   * The three candidates in the running, one slot per tier (S6.9).
   *
   * On the instance rather than as locals threaded through the scorer, for the reason
   * `Raycaster`'s ray and `SmokeField`'s sight line are: a selection spans `offerCandidate`
   * and `resolveBest`, and two selectors in one process — a menu skirmish beside a match —
   * must not be able to read each other's running best. `resetBests` clears all of it before
   * anything reads it, so nothing survives a call.
   *
   * `bestAny` is the least-bad slot and holds the *penalised* score, which is the post-M8 fix:
   * comparing an unpenalised candidate against a penalised best made "best" collapse into
   * "very nearly the last one examined".
   */
  private bestSafe = -Infinity;
  private bestSafeAt = -1;
  private bestSafeDistance = 0;
  private bestHidden = -Infinity;
  private bestHiddenAt = -1;
  private bestHiddenDistance = 0;
  private bestHiddenCone = false;
  private bestAny = -Infinity;
  private bestAnyAt = -1;
  private bestAnyDistance = 0;
  private bestAnyCone = false;
  private bestAnyVisible = false;

  /** What `resolveBest` settled on, for `writeChoice` and the stats to read. */
  private chosenTier: SpawnTier = 'safe';
  private chosenDistance = 0;
  private chosenCone = false;
  private chosenVisible = false;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(
    zones: readonly SpawnZone[],
    nav: NavGrid,
    rng: Rng,
    private readonly perception: Perception,
    private readonly perceptionConfig: PerceptionConfig,
  ) {
    for (const zone of zones) {
      for (let s = 0; s < SAMPLES_PER_ZONE; s++) {
        // Sample 0 is the authored position itself, so a hand-placed spawn is always
        // among the candidates rather than being jittered away from.
        const angle = rng.float() * Math.PI * 2;
        const radius = s === 0 ? 0 : Math.sqrt(rng.float()) * zone.radius;
        const x = zone.position.x + simCos(angle) * radius;
        const z = zone.position.z + simSin(angle) * radius;
        const cell = nav.nearestCell(x, zone.position.y, z, 6);
        if (cell < 0) continue;
        this.candidateList.push({
          x: nav.centerX(nav.indexOfX(cell)),
          y: nav.heightAt(cell),
          z: nav.centerZ(nav.indexOfZ(cell)),
          yaw: zone.facingYaw,
          team: zone.team,
          lastUsedTick: -9999,
        });
      }
    }
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get candidateCount(): number {
    return this.candidateList.length;
  }

  setSideSwap(on: boolean): void {
    this.swapped = on;
  }

  get sidesSwapped(): boolean {
    return this.swapped;
  }

  /** Read-only view of the candidate pool, for the S7 spawn visualisation. */
  get candidates(): readonly Readonly<Candidate>[] {
    return this.candidateList;
  }

  /**
   * Choose a spawn for `team`. Writes into `out` and always succeeds as long as the map
   * produced at least one navmesh-valid candidate.
   *
   * Three passes rather than one function: offer every eligible candidate to the three tier
   * slots, settle on the best tier that has one, then write it out. The tiers are what S6.9
   * asks for and the fallback order is the whole behaviour, so it is one named step.
   */
  select(
    team: BotTeam,
    roster: readonly Combatant[],
    selfId: number,
    tick: number,
    out: SpawnChoice,
  ): boolean {
    this.resetBests();
    // Which end this team is playing from. Identical to `team` unless sides have swapped.
    const drawFrom = this.swapped ? opposingTeam(team) : team;

    for (let i = 0; i < this.candidateList.length; i++) {
      const c = this.candidateList[i];
      if (c === undefined) continue;
      if (!this.eligible(c, drawFrom)) continue;

      this.measure(c, roster, selfId, team);
      this.offerCandidate(i, recencyPenalty(c, tick));
    }

    const at = this.resolveBest();
    if (at < 0) return false;
    const chosen = this.candidateList[at];
    if (chosen === undefined) return false;
    chosen.lastUsedTick = tick;

    this.writeChoice(chosen, out);
    this.recordSelection();
    return true;
  }

  /**
   * Score one candidate exactly as `select` would, without selecting it (S7).
   *
   * Deliberately the same `measure` call and the same arithmetic: a visualisation that
   * recomputed the score its own way would be a picture of a second spawn selector. Writes
   * into `out` and returns it.
   */
  inspect(
    index: number,
    team: BotTeam,
    roster: readonly Combatant[],
    selfId: number,
    tick: number,
    out: SpawnInspection,
  ): boolean {
    const c = this.candidateList[index];
    if (c === undefined) return false;
    const drawFrom = this.swapped ? opposingTeam(team) : team;
    out.eligible = this.eligible(c, drawFrom);
    out.x = c.x;
    out.y = c.y;
    out.z = c.z;
    if (!out.eligible) {
      out.score = 0;
      out.distance = 0;
      out.cone = false;
      out.visible = false;
      out.tier = 'leastBad';
      return true;
    }

    this.measure(c, roster, selfId, team);
    out.distance = measuredDistance;
    out.cone = measuredCone;
    out.visible = measuredVisible;
    out.score = scoreOf(measuredDistance, recencyPenalty(c, tick), measuredFriendly);
    out.tier = tierOf(measuredDistance, measuredCone, measuredVisible);
    return true;
  }

  resetStats(): void {
    this.stats.selections = 0;
    this.stats.safe = 0;
    this.stats.hidden = 0;
    this.stats.leastBad = 0;
    this.stats.coneViolations = 0;
    this.stats.visibleViolations = 0;
    this.stats.minEnemyDistance = Infinity;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * May this candidate be considered for a spawn on `drawFrom`?
   *
   * **Free-for-All opens the whole map** (post-M8 playtest). FFA keeps the two-team substrate
   * so that perception and spawn safety keep working — see `modes/FreeForAll.ts` — but the
   * *spawn zones* were an unintended casualty of that: eight independent hostiles were being
   * confined to whichever half of the map their substrate side owned, so half the arena was
   * unreachable and the remaining half had to seat four people who all wanted 15 m of space.
   * On Foundry that is not possible, so every FFA spawn fell to the least-bad tier and landed
   * next to somebody. There are no sides in FFA, so there is no reason to hold half the
   * candidates back, and opening them up roughly doubles the pool the scorer gets to choose
   * from before any of the scoring changes are considered.
   */
  private eligible(candidate: Candidate, drawFrom: BotTeam): boolean {
    if (this.freeForAll) return true;
    return candidate.team === drawFrom || candidate.team === 'FFA';
  }

  /** Nothing in the running. Called before the scorer so no selection can read the last one's. */
  private resetBests(): void {
    this.bestSafe = -Infinity;
    this.bestSafeAt = -1;
    this.bestSafeDistance = 0;
    this.bestHidden = -Infinity;
    this.bestHiddenAt = -1;
    this.bestHiddenDistance = 0;
    this.bestHiddenCone = false;
    this.bestAny = -Infinity;
    this.bestAnyAt = -1;
    this.bestAnyDistance = 0;
    this.bestAnyCone = false;
    this.bestAnyVisible = false;
  }

  /**
   * Offer one measured candidate to the three tier slots.
   *
   * Reads the measurement out of the module scratch `measure` just wrote. The least-bad slot
   * takes every candidate, penalised; the other two take only those clearing
   * `MIN_ENEMY_DISTANCE`, which is what makes the fallback a fallback.
   */
  private offerCandidate(index: number, recent: number): void {
    const distance = measuredDistance;
    const cone = measuredCone;
    const visible = measuredVisible;

    // Distance to the nearest enemy is the whole point, but only up to a point: 40 m
    // away in an empty corner is not better than 22 m near a teammate.
    const base = scoreOf(distance, recent, measuredFriendly);

    /**
     * The least-bad fallback, scored correctly (post-M8 playtest).
     *
     * This compared the *unpenalised* `base` against a `bestAny` that had already had the
     * visibility and cone penalties subtracted from it — two different scales on either
     * side of one `>`. Because a penalised best is around -100, essentially every later
     * candidate cleared it, so "best" collapsed into "very nearly the last one examined"
     * and the fallback returned an effectively arbitrary point. That is the spawn that
     * puts you on top of somebody, and it is the tier that runs most often in Free-for-All
     * — where seven hostiles on a 5v5 map mean the 15 m rule frequently cannot be met by
     * *any* candidate and every spawn comes through here.
     *
     * Both sides are the penalised score now, so the fallback genuinely maximises distance
     * and genuinely prefers not being looked at.
     */
    const scored = base - (visible ? 100 : 0) - (cone ? 30 : 0);
    if (scored > this.bestAny) {
      this.bestAny = scored;
      this.bestAnyAt = index;
      this.bestAnyDistance = distance;
      this.bestAnyCone = cone;
      this.bestAnyVisible = visible;
    }
    if (distance < MIN_ENEMY_DISTANCE) return;

    if (!cone) {
      if (base <= this.bestSafe) return;
      this.bestSafe = base;
      this.bestSafeAt = index;
      this.bestSafeDistance = distance;
      return;
    }
    if (visible) return;
    if (base <= this.bestHidden) return;
    this.bestHidden = base;
    this.bestHiddenAt = index;
    this.bestHiddenDistance = distance;
    this.bestHiddenCone = cone;
  }

  /**
   * The best tier that found a candidate, as an index into the pool, or -1.
   *
   * Safe, then hidden, then least-bad: S6.9's own order, and the reason this never fails. A
   * selector that can return "no" is one that will, at which point a bot stops existing.
   */
  private resolveBest(): number {
    if (this.bestSafeAt >= 0) {
      this.chosenTier = 'safe';
      this.chosenDistance = this.bestSafeDistance;
      this.chosenCone = false;
      this.chosenVisible = false;
      return this.bestSafeAt;
    }
    if (this.bestHiddenAt >= 0) {
      this.chosenTier = 'hidden';
      this.chosenDistance = this.bestHiddenDistance;
      this.chosenCone = this.bestHiddenCone;
      this.chosenVisible = false;
      return this.bestHiddenAt;
    }
    this.chosenTier = 'leastBad';
    this.chosenDistance = this.bestAnyDistance;
    this.chosenCone = this.bestAnyCone;
    this.chosenVisible = this.bestAnyVisible;
    return this.bestAnyAt;
  }

  private writeChoice(chosen: Candidate, out: SpawnChoice): void {
    out.x = chosen.x;
    out.y = chosen.y;
    out.z = chosen.z;
    out.yaw = chosen.yaw;
    out.tier = this.chosenTier;
    out.nearestEnemy = this.chosenDistance;
    out.insideCone = this.chosenCone;
    out.visible = this.chosenVisible;
  }

  /**
   * The running totals acceptance criterion 5 reads.
   *
   * Both violations are counted separately because the honest answer distinguishes "inside a
   * cone we could not avoid" from "visible to somebody".
   */
  private recordSelection(): void {
    const s = this.stats;
    s.selections++;
    if (this.chosenTier === 'safe') s.safe++;
    else if (this.chosenTier === 'hidden') s.hidden++;
    else s.leastBad++;
    if (this.chosenCone) s.coneViolations++;
    if (this.chosenVisible) s.visibleViolations++;
    if (this.chosenDistance < s.minEnemyDistance) s.minEnemyDistance = this.chosenDistance;
  }

  /**
   * Distance to the nearest living enemy, whether any of them has this point in its cone,
   * and whether any could see it. Results land in the module scratch below rather than in
   * an allocated record — respawns are rare, but the harness runs fifty in a row.
   */
  private measure(c: Candidate, roster: readonly Combatant[], selfId: number, team: BotTeam): void {
    const cfg = this.perceptionConfig;
    const halfCone = simCos(cfg.visionConeDeg * 0.5 * DEG2RAD);
    measuredDistance = Infinity;
    measuredFriendly = Infinity;
    measuredCone = false;
    measuredVisible = false;

    for (const other of roster) {
      if (other.entityId === selfId) continue;
      if (!other.participating || !other.health.alive) continue;
      this.measureAgainst(c, other, halfCone, team);
    }
    if (measuredFriendly === Infinity) measuredFriendly = 9;
  }

  /**
   * One body's contribution to the measurement, folded into the module scratch.
   *
   * The raycast is the expensive half and is paid only once the cone test says this enemy is
   * looking this way, and only until something can see the point — after that the answer
   * cannot change.
   */
  private measureAgainst(
    c: Candidate,
    other: Combatant,
    halfCone: number,
    team: BotTeam,
  ): void {
    const cfg = this.perceptionConfig;
    const dx = c.x - other.px;
    const dz = c.z - other.pz;
    const dist = Math.hypot(dx, dz);

    // FFA scores against everybody: seven hostiles rather than one hostile team.
    if (!isHostile(team, other.team, this.freeForAll)) {
      if (dist < measuredFriendly) measuredFriendly = dist;
      return;
    }

    if (dist < measuredDistance) measuredDistance = dist;
    if (dist > cfg.visionRange || dist < 1e-4) return;
    const fx = -simSin(other.yaw);
    const fz = -simCos(other.yaw);
    if ((dx * fx + dz * fz) / dist < halfCone) return;
    measuredCone = true;
    if (measuredVisible) return;
    // Only worth a raycast once the cone test says the enemy is looking this way.
    if (
      this.perception.clearLine(
        other.px,
        other.py + other.eyeHeight,
        other.pz,
        c.x,
        c.y + 1.2,
        c.z,
      )
    ) {
      measuredVisible = true;
    }
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function makeSpawnChoice(): SpawnChoice {
  return { x: 0, y: 0, z: 0, yaw: 0, tier: 'safe', nearestEnemy: Infinity, insideCone: false, visible: false };
}

export function makeSpawnInspection(): SpawnInspection {
  return {
    x: 0,
    y: 0,
    z: 0,
    eligible: false,
    score: 0,
    distance: 0,
    cone: false,
    visible: false,
    tier: 'safe',
  };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * How good a candidate is, before the cone and visibility penalties.
 *
 * One function, called by `select` and by `inspect`, so the debug visualisation is drawing
 * the selector's own arithmetic rather than a second implementation of it — which is what the
 * comment on `inspect` has always promised and is now structurally true.
 *
 * The `crowding` term is the post-M8 change. Distance was capped at 40 m and otherwise
 * linear, which meant a 3 m spawn scored 3 and a 12 m one scored 12: a nine-point gap, easily
 * swamped by the 9-point recency penalty. Being *close enough to be shot immediately* is not
 * a little worse than being far away, it is categorically worse, so proximity inside the
 * 15 m rule is penalised at four points a metre. A 3 m candidate now scores -45 against a
 * 12 m candidate's 0, and nothing else in the score can outvote that.
 */
function scoreOf(distance: number, recent: number, friendly: number): number {
  const crowding = distance < MIN_ENEMY_DISTANCE ? (MIN_ENEMY_DISTANCE - distance) * 4 : 0;
  return Math.min(distance, 40) - recent - Math.abs(friendly - 9) * 0.25 - crowding;
}

/**
 * The penalty for a point somebody spawned on recently, so consecutive spawns are not stacked.
 *
 * Four seconds of ticks, and nine points — which is deliberately the same order as the gap
 * between a 3 m and a 12 m candidate used to be, and is why `scoreOf`'s crowding term had to
 * stop competing with it.
 */
function recencyPenalty(candidate: Candidate, tick: number): number {
  return tick - candidate.lastUsedTick < 240 ? 9 : 0;
}

/**
 * Which tier one measured candidate belongs to, for the visualisation.
 *
 * `select` does not use this: it learns the tier from *which slot won*, which is not the same
 * question — a candidate can be safe on its own and still lose to a safer one.
 */
function tierOf(distance: number, cone: boolean, visible: boolean): SpawnTier {
  if (distance < MIN_ENEMY_DISTANCE) return 'leastBad';
  if (!cone) return 'safe';
  return visible ? 'leastBad' : 'hidden';
}
//#endregion

