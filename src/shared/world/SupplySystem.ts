import { equipmentDef } from '../equipment/EquipmentDefs';
import type { EquipmentInventory } from '../equipment/EquipmentSystem';
import type { StanceId } from '../player/Stance';
import type { Weapon } from '../weapons/WeaponBase';
import type { SupplyPointDef } from './maps/types';

/**
 * Resupply stations: the rule that turns kneeling at a crate into ammunition.
 *
 * ## Why it is shared, and why it replicates nothing
 *
 * A weapon's reserve and a hand's grenade count are **not on the wire**. The server runs a
 * `WeaponSystem` and a `ThrowController` per player and the client runs its own, both stepped
 * from the same `InputCommand` stream — that is how firing and reloading have stayed in
 * agreement since M10, and it is the whole reason a magazine has never needed a byte in a
 * snapshot. A crate that granted ammunition on one side only would be the first thing to break
 * that agreement.
 *
 * So this is a *rule*, not a system with state to replicate: given a body's position and stance,
 * the use button, and the two containers it is allowed to fill, it decides the same thing on the
 * client and on the server on the same tick. Both call it; neither tells the other.
 *
 * ## Why it counts ticks rather than seconds
 *
 * S4.1: gameplay runs on the fixed 60 Hz tick and never on a frame delta. Four rounds a second
 * is one round every fifteen ticks, exactly, on both sides — a seconds accumulator would drift
 * apart on two machines with different frame rates and hand out a different number of rounds.
 *
 * ## What it will not do
 *
 * It fills the weapon **in the player's hands** and nothing else: not the holstered one, not a
 * teammate's, and not a bot's — a bot has no `Weapon` of this kind to hand it and giving one to
 * `BotThrower` is a separate decision about bot behaviour, not about crates.
 */

/** Where a body is, for the reach test. Satisfied by `PlayerSim` and by the server's own sim. */
export interface SupplyBody {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly stance: StanceId;
}

export interface SupplyConfig {
  /** Sim ticks per round handed to the held weapon. 15 at 60 Hz is four a second. */
  readonly ticksPerRound: number;
  /** Sim ticks per grenade. Deliberately long — see `SUPPLY_CONFIG`. */
  readonly ticksPerGrenade: number;
  /**
   * Metres of height difference between the body's feet and the crate's base that still counts
   * as standing at it. A crate under a catwalk must not resupply the deck above it.
   */
  readonly reachY: number;
}

/**
 * The shipped rates.
 *
 * Four rounds a second refills a 30-round magazine in 7.5 s and a full 240-round pouch in a
 * minute, which is the trade the station exists to offer: a player who wants to be whole again
 * has to give the map a minute of standing still in one place, kneeling, with their gun down.
 *
 * A grenade every four seconds is the same trade priced for a thing that wins a fight on its
 * own. Two frags and two flashes is 16 seconds — long enough that topping up the lethal slot is
 * a decision about the round rather than a reflex on the way past.
 */
export const SUPPLY_CONFIG: SupplyConfig = {
  ticksPerRound: 15,
  ticksPerGrenade: 240,
  reachY: 1.6,
};

/** No crate. Distinct from a crate whose id is the empty string, which the schema forbids. */
export const NO_SUPPLY_POINT = '';

/**
 * What the crate is doing for one body this tick.
 *
 * One record per entity, rewritten in place: this is read by the HUD every frame and stepped
 * every tick, and a fresh object per body per tick is exactly the allocation S4 asks the
 * per-tick path not to make.
 */
export interface SupplyState {
  /** The crate this body is standing at, or `NO_SUPPLY_POINT`. */
  pointId: string;
  /** In range, but the body is not kneeling — the prompt that teaches the rule. */
  needsCrouch: boolean;
  /** Taking something right now. */
  working: boolean;
  /** Kneeling and holding, with nothing left to give. */
  full: boolean;
  /** The held weapon's reserve as a fraction of what it can carry, for the HUD ring. */
  stock: number;
  /** Given at this station since the body arrived, for the debug panel and the tests. */
  roundsTaken: number;
  grenadesTaken: number;
}

function makeState(): SupplyState {
  return {
    pointId: NO_SUPPLY_POINT,
    needsCrouch: false,
    working: false,
    full: false,
    stock: 0,
    roundsTaken: 0,
    grenadesTaken: 0,
  };
}

interface Progress {
  pointId: string;
  roundTicks: number;
  grenadeTicks: number;
}

export class SupplySystem {
  private readonly states = new Map<number, SupplyState>();
  private readonly progress = new Map<number, Progress>();

  constructor(
    private readonly points: readonly SupplyPointDef[],
    private readonly cfg: SupplyConfig = SUPPLY_CONFIG,
  ) {}

  /** Whether this map has any stations at all. The HUD asks before it looks. */
  get any(): boolean {
    return this.points.length > 0;
  }

  /** The last state stepped for this body, without stepping it. Built on demand. */
  stateOf(entityId: number): SupplyState {
    let state = this.states.get(entityId);
    if (state === undefined) {
      state = makeState();
      this.states.set(entityId, state);
    }
    return state;
  }

  /**
   * One sim tick for one body.
   *
   * `holdingUse` is the use button as the command carried it — held, not an edge, exactly as the
   * bomb reads it. Everything else is what the body is and what it may be given.
   */
  step(
    entityId: number,
    body: SupplyBody,
    alive: boolean,
    holdingUse: boolean,
    weapon: Weapon,
    inventory: EquipmentInventory,
  ): SupplyState {
    const state = this.stateOf(entityId);
    state.working = false;
    state.needsCrouch = false;
    state.full = false;
    state.stock = stockFraction(weapon);

    const point = alive ? this.pointNear(body) : null;
    if (point === null) {
      this.forget(entityId, state);
      return state;
    }

    // Arriving at a different crate is arriving: nothing carries over from the last one.
    const progress = this.progressAt(entityId, point.id, state);
    state.pointId = point.id;

    /**
     * Kneeling is the price, and it is checked before the button rather than beside it.
     *
     * A player who is standing at the crate holding the key is not resupplying and must be told
     * why, which is a different prompt from "hold this key" — so the two states are separate
     * here rather than folded into one `if` that produces silence.
     */
    if (body.stance !== 'CROUCH') {
      state.needsCrouch = true;
      progress.roundTicks = 0;
      progress.grenadeTicks = 0;
      return state;
    }
    if (!holdingUse) {
      progress.roundTicks = 0;
      progress.grenadeTicks = 0;
      return state;
    }

    const roundRoom = weapon.definition.reserveAmmo - weapon.reserve > 0;
    const grenadeRoom = missingSlot(inventory) !== null;
    if (!roundRoom && !grenadeRoom) {
      state.full = true;
      progress.roundTicks = 0;
      progress.grenadeTicks = 0;
      return state;
    }

    state.working = true;

    if (roundRoom) {
      progress.roundTicks++;
      if (progress.roundTicks >= this.cfg.ticksPerRound) {
        progress.roundTicks = 0;
        // `addReserve` caps at the weapon's own carry and reports what it actually took, so a
        // round that had nowhere to go is not counted as one that was given.
        state.roundsTaken += weapon.addReserve(1);
        state.stock = stockFraction(weapon);
      }
    } else {
      progress.roundTicks = 0;
    }

    if (grenadeRoom) {
      progress.grenadeTicks++;
      if (progress.grenadeTicks >= this.cfg.ticksPerGrenade) {
        progress.grenadeTicks = 0;
        // The lethal slot first: it is the one that wins a fight, and a player who wanted the
        // other one can stop when the count they are watching goes up.
        const slot = missingSlot(inventory);
        if (slot === 'lethal') inventory.lethalCount++;
        else if (slot === 'tactical') inventory.tacticalCount++;
        if (slot !== null) state.grenadesTaken++;
      }
    } else {
      progress.grenadeTicks = 0;
    }

    return state;
  }

  /** A life ended, or the match did. The next one starts at a crate it has not been to. */
  reset(entityId: number): void {
    this.progress.delete(entityId);
    const state = this.states.get(entityId);
    if (state !== undefined) this.forget(entityId, state);
  }

  clear(): void {
    this.states.clear();
    this.progress.clear();
  }

  // -- internals ----------------------------------------------------------------

  private forget(entityId: number, state: SupplyState): void {
    state.pointId = NO_SUPPLY_POINT;
    state.roundsTaken = 0;
    state.grenadesTaken = 0;
    this.progress.delete(entityId);
  }

  /**
   * The crate this body is standing at, or null.
   *
   * The nearest one, so two crates whose volumes overlap resolve the same way on both machines
   * — a rule that picked the first in authoring order would be a rule about the map file.
   */
  private pointNear(body: SupplyBody): SupplyPointDef | null {
    let best: SupplyPointDef | null = null;
    let bestSq = Infinity;
    for (const point of this.points) {
      const dx = point.position.x - body.x;
      const dz = point.position.z - body.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > point.radius * point.radius) continue;
      if (Math.abs(point.position.y - body.y) > this.cfg.reachY) continue;
      if (distanceSq >= bestSq) continue;
      bestSq = distanceSq;
      best = point;
    }
    return best;
  }

  private progressAt(entityId: number, pointId: string, state: SupplyState): Progress {
    const existing = this.progress.get(entityId);
    if (existing !== undefined && existing.pointId === pointId) return existing;
    const fresh: Progress = { pointId, roundTicks: 0, grenadeTicks: 0 };
    this.progress.set(entityId, fresh);
    state.roundsTaken = 0;
    state.grenadesTaken = 0;
    return fresh;
  }
}

/** The slot that is short of its loadout count, lethal first, or null when both are full. */
function missingSlot(inventory: EquipmentInventory): 'lethal' | 'tactical' | null {
  if (inventory.lethalCount < equipmentDef(inventory.lethal).count) return 'lethal';
  if (inventory.tacticalCount < equipmentDef(inventory.tactical).count) return 'tactical';
  return null;
}

function stockFraction(weapon: Weapon): number {
  const max = weapon.definition.reserveAmmo;
  if (max <= 0) return 1;
  const stock = weapon.reserve / max;
  return stock < 0 ? 0 : stock > 1 ? 1 : stock;
}
