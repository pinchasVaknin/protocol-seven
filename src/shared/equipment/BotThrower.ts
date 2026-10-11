/**
 * Bots throwing grenades, gated by difficulty tier, without blowing themselves up
 * (brief S6.3).
 *
 * Two things make this honest rather than a dice roll:
 *
 * **The safety check runs the real integration.** `previewTrajectory` steps the same arc
 * through the same collision world the thrown object will use, and `solveLaunch` puts it in the
 * air from the same point `throwFrom` will — so "where would this land" is answered by the
 * thing that decides where it lands. A closed-form parabola would be right in the open and
 * wrong in exactly the situation that matters: a bot throwing at a doorway from behind a crate,
 * where the grenade bounces back off the lip.
 *
 * **The tier gate is two-sided.** `TierConfig.grenadeChance` decides whether a tier throws
 * at all, and `EquipmentDef.minBotTier` decides what it is allowed to carry. A Recruit
 * throws nothing; only a Veteran plants claymores.
 *
 * This lives outside `BotBrain` deliberately. The brain is a 4 Hz decision loop over ten
 * states and is already the largest file in `ai/`; grenade policy is an independent, much
 * slower decision that needs the collision world and the equipment system, neither of
 * which the brain has. It is driven from `BotDirector` at its own rate.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { Combatant } from '../ai/Combatant';
import { isHostile } from '../combat/Hostility';
import type { BotTier, TierConfig } from '../ai/DifficultyTiers';
import { BOT_TIERS } from '../ai/DifficultyTiers';
import { DT } from '../core/Loop';
import { DEG2RAD } from '../core/MathUtil';
import type { Rng } from '../core/Rng';
import type { CollisionWorld, MoveOutput } from '../world/CollisionWorld';
import { makeMoveOutput } from '../world/CollisionWorld';
import type { EquipmentConfig } from './EquipmentConfig';
import { ALL_EQUIPMENT, type EquipmentDef } from './EquipmentDefs';
import type { EquipmentSystem } from './EquipmentSystem';
import { LAUNCH, previewTrajectory, solveLaunch } from './Projectile';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
interface ThrowerState {
  cooldown: number;
  /** How many of each slot this bot has left this life. */
  lethal: number;
  tactical: number;
}

/** What a bot is holding right now. Read by the per-life audit; never mutated through this. */
export interface BotStock {
  readonly lethal: number;
  readonly tactical: number;
}

export interface ThrowIntent {
  /** Last known enemy position. Not necessarily visible right now. */
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  readonly sinceSeen: number;
  readonly hasTarget: boolean;
}

/**
 * The writable face of `ThrowIntent`, for the single instance a caller rewrites each tick.
 *
 * Shared rather than redeclared per composition root (M11 Gate B): `MatchEquipment` had a
 * private copy and `ServerMatch` needed the same thing, which is one more pair of declarations
 * that can drift when a field is added.
 */
export type MutableThrowIntent = { -readonly [K in keyof ThrowIntent]: ThrowIntent[K] };
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** How long a bot's grenade intent is worth acting on after last seeing the target. */
const STALE_TARGET_SECONDS = 3.0;

/** Minimum range: closer than this and a grenade is slower than shooting. */
const MIN_THROW_RANGE = 7;

/** Seconds of arc to simulate when checking where one would land. */
const PREVIEW_SECONDS = 4.0;

/**
 * The launch angles the aim solver tries, in degrees, flattest first.
 *
 * A ladder through the real integrator rather than a closed-form solution, because a closed
 * form would ignore the wall in the way. At module level so the loop does not build the list
 * again on every evaluation.
 */
const THROW_PITCH_LADDER: readonly number[] = [4, 10, 16, 24, 34];

/**
 * What a bot carries at the start of a life, and the four seconds before it may throw.
 *
 * Named rather than repeated, because the per-life audit (playtest round 4, B3) has to ask
 * *"is this bot's stock full"* and a full stock spelled out in a second place is a full stock
 * that can disagree with the one `respawn` hands out.
 */
const BOT_LOADOUT: Readonly<ThrowerState> = { cooldown: 4, lethal: 1, tactical: 1 };
//#endregion

// ====================================== CLASS BotThrower ====================================== \\
//#region Class BotThrower
export class BotThrower {
  // ========================================== STATIC ========================================== \\
  //#region Static
  /** A full life's worth, for a caller asking whether a stock is partial. */
  static get fullStock(): BotStock {
    return BOT_LOADOUT;
  }
  //#endregion

  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Diagnostics for the F1 panel. */
  throws = 0;
  rejectedUnsafe = 0;

  private readonly states = new Map<number, ThrowerState>();
  private readonly preview = new Float32Array(3 * 256);
  private readonly move: MoveOutput = makeMoveOutput();

  /**
   * The best arc the ladder found, and where it put the grenade down.
   *
   * On the instance between `bestPitchFor` and the two gates that read it, rather than returned
   * as a record: this runs inside a sim tick and must not allocate, and four numbers is more
   * than a return value should be.
   */
  private aimError = Infinity;
  private aimLandX = 0;
  private aimLandY = 0;
  private aimLandZ = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(
    private readonly system: EquipmentSystem,
    private readonly world: CollisionWorld,
    private readonly cfg: EquipmentConfig,
  ) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  reset(): void {
    this.states.clear();
    this.throws = 0;
    this.rejectedUnsafe = 0;
  }

  /** Refill a bot's equipment. Called on spawn, exactly as the player's is. */
  respawn(entityId: number): void {
    this.states.set(entityId, { ...BOT_LOADOUT });
  }

  /**
   * What this bot is holding, without creating a state for one that has never thrown.
   *
   * A bot with no row has not been asked for a grenade yet and would be handed a full loadout
   * the moment it was, so an absent row reads as full. Deliberately not `stateFor`: a probe
   * that allocates the thing it is measuring measures itself.
   */
  stockOf(entityId: number): BotStock {
    return this.states.get(entityId) ?? BOT_LOADOUT;
  }

  /**
   * One evaluation for one bot. Called from the AI scheduler's own rate, not per tick.
   *
   * `elapsed` is the wall gap since this bot's previous evaluation, so the cooldown
   * advances correctly under a staggered scheduler.
   */
  consider(
    self: Combatant,
    tier: BotTier,
    tierCfg: TierConfig,
    intent: ThrowIntent,
    roster: readonly Combatant[],
    rng: Rng,
    elapsed: number,
  ): boolean {
    const state = this.stateFor(self.entityId);
    state.cooldown -= elapsed > 0 ? elapsed : DT;
    if (state.cooldown > 0) return false;
    if (tierCfg.grenadeChance <= 0) return false;
    if (!intent.hasTarget || intent.sinceSeen > STALE_TARGET_SECONDS) return false;

    const range = Math.hypot(intent.targetX - self.px, intent.targetZ - self.pz);
    if (range < MIN_THROW_RANGE || range > tierCfg.grenadeRange) return false;

    // Re-armed on every evaluation whether or not it throws, so a bot that keeps failing
    // the safety check does not spend the whole match testing arcs.
    state.cooldown = tierCfg.grenadeCooldown;
    if (!rng.chance(tierCfg.grenadeChance)) return false;

    const def = this.pickEquipment(tier, state, rng);
    if (def === null) return false;

    const yaw = Math.atan2(-(intent.targetX - self.px), -(intent.targetZ - self.pz));
    const pitch = this.bestPitchFor(def, self, intent, yaw);

    // A throw that lands more than half a blast radius off the mark is a wasted grenade.
    if (this.aimError > def.effectRadius * 0.75) return false;

    // The hard rule: never near yourself, and never near a teammate.
    if (!this.isSafe(self, roster, this.aimLandX, this.aimLandY, this.aimLandZ, tierCfg.grenadeSafeRadius)) {
      this.rejectedUnsafe++;
      return false;
    }

    if (!this.throwAt(def, self, yaw, pitch)) return false;

    if (def.slot === 'lethal') state.lethal--;
    else state.tactical--;
    this.throws++;
    return true;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private stateFor(entityId: number): ThrowerState {
    let state = this.states.get(entityId);
    if (state === undefined) {
      state = { ...BOT_LOADOUT };
      this.states.set(entityId, state);
    }
    return state;
  }

  private pickEquipment(tier: BotTier, state: ThrowerState, rng: Rng): EquipmentDef | null {
    const tierIndex = BOT_TIERS.indexOf(tier);
    let best: EquipmentDef | null = null;
    let count = 0;
    for (const def of ALL_EQUIPMENT) {
      if (tierIndex < def.minBotTier) continue;
      if (def.impact === 'plant') continue; // planted equipment is not a thrown answer
      const have = def.slot === 'lethal' ? state.lethal : state.tactical;
      if (have <= 0) continue;
      // Reservoir sample so the choice does not depend on declaration order.
      count++;
      if (rng.float() < 1 / count) best = def;
    }
    return best;
  }

  /**
   * The launch angle that lands nearest the target, out of the ladder.
   *
   * Solved by trying each angle through the real integrator and keeping the first that lands
   * nearer than the rest; how near, and where, are left in `aimError` and `aimLandX/Y/Z` for
   * the two gates that read them.
   */
  private bestPitchFor(
    def: EquipmentDef,
    self: Combatant,
    intent: ThrowIntent,
    yaw: number,
  ): number {
    const eyeX = self.px;
    const eyeY = self.py + self.eyeHeight;
    const eyeZ = self.pz;

    let bestPitch = 0;
    this.aimError = Infinity;
    this.aimLandX = 0;
    this.aimLandY = 0;
    this.aimLandZ = 0;

    for (const pitchDeg of THROW_PITCH_LADDER) {
      const pitch = pitchDeg * DEG2RAD;
      const landed = this.simulateThrow(def, eyeX, eyeY, eyeZ, yaw, pitch);
      if (landed === 0) continue;
      const lx = this.preview[(landed - 1) * 3] ?? 0;
      const ly = this.preview[(landed - 1) * 3 + 1] ?? 0;
      const lz = this.preview[(landed - 1) * 3 + 2] ?? 0;
      const miss = Math.hypot(lx - intent.targetX, lz - intent.targetZ);
      if (miss >= this.aimError) continue;
      this.aimError = miss;
      bestPitch = pitch;
      this.aimLandX = lx;
      this.aimLandY = ly;
      this.aimLandZ = lz;
    }
    return bestPitch;
  }

  /** Where a throw would land. Returns the number of preview points written. */
  private simulateThrow(
    def: EquipmentDef,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
  ): number {
    solveLaunch(def, this.cfg, x, y, z, yaw, pitch, false);
    return previewTrajectory(
      def,
      this.cfg,
      this.world,
      LAUNCH.x,
      LAUNCH.y,
      LAUNCH.z,
      LAUNCH.vx,
      LAUNCH.vy,
      LAUNCH.vz,
      PREVIEW_SECONDS,
      this.preview,
      this.move,
    );
  }

  /**
   * "They must not grenade themselves" (S6.3), checked against the predicted landing
   * point and the whole friendly side rather than against the thrower alone — a bot that
   * kills its own team is the same bug with a better disguise.
   */
  private isSafe(
    self: Combatant,
    roster: readonly Combatant[],
    x: number,
    y: number,
    z: number,
    safeRadius: number,
  ): boolean {
    if (Math.hypot(x - self.px, y - (self.py + 1), z - self.pz) < safeRadius) return false;
    for (const c of roster) {
      if (c === self) continue;
      if (!c.participating) continue;
      // Only a teammate makes a landing spot unsafe. In Free-for-All nobody is one, so a bot
      // throws at whoever is there — half the lobby used to be spared by its substrate side.
      if (isHostile(self.team, c.team, this.system.freeForAll)) continue;
      if (Math.hypot(x - c.px, y - (c.py + 1), z - c.pz) < safeRadius * 0.7) return false;
    }
    return true;
  }

  /** Through the one throw door, with the one thing a bot never does: cooking. */
  private throwAt(def: EquipmentDef, self: Combatant, yaw: number, pitch: number): boolean {
    const thrown = this.system.throwFrom(
      def,
      self.entityId,
      self.team,
      self.px,
      self.py + self.eyeHeight,
      self.pz,
      yaw,
      pitch,
      self.vx,
      self.vz,
      // Bots do not cook. Judging a fuse by eye is a human skill and a cooking bot is
      // indistinguishable from an unfair one.
      0,
      false,
    );
    return thrown !== null;
  }
  //#endregion
}
//#endregion
