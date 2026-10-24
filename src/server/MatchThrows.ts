/**
 * Who is holding a pin in this match, and what every life started with (B6).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { BotDirector } from '../shared/ai/BotDirector';
import type { TierTable } from '../shared/ai/DifficultyTiers';
import type { Rng } from '../shared/core/Rng';
import { BotThrower, type MutableThrowIntent } from '../shared/equipment/BotThrower';
import type { EquipmentConfig } from '../shared/equipment/EquipmentConfig';
import { equipmentDef } from '../shared/equipment/EquipmentDefs';
import {
  EquipmentSystem,
  makeEquipmentInventory,
  type EquipmentInventory,
} from '../shared/equipment/EquipmentSystem';
import { LifeStockAudit, type LifeStockReport } from '../shared/equipment/LifeStockAudit';
import { ThrowController } from '../shared/equipment/ThrowController';
import type { ResolvedLoadout } from '../shared/meta/Loadouts';
import { DT } from '../shared/core/Loop';
import type { CollisionWorld } from '../shared/world/CollisionWorld';
import type { NetPlayer } from './NetPlayer';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface MatchThrowsDeps {
  readonly equipment: EquipmentSystem;
  readonly world: CollisionWorld;
  readonly cfg: EquipmentConfig;
  readonly tiers: TierTable;
  readonly bots: BotDirector;
  /** Seeded off the match's own seed, so a bot's throw decisions replay. */
  readonly rng: Rng;
  /** This entity's resolved class, for the grenades a new hand is filled from. */
  readonly classOf: (entityId: number) => ResolvedLoadout | null;
}

/** One player's grenade hand: what they are holding, and how far the cook has burned. */
interface PlayerHand {
  readonly thrower: ThrowController;
  readonly inventory: EquipmentInventory;
}
//#endregion

// ===================================== CLASS MatchThrows ====================================== \\
//#region Class MatchThrows
/**
 * The throwing half of an authoritative match (M11 Gate B, §8.24).
 *
 * Every piece here is the shared M5 code driven from a different place than the client drives
 * it: one `ThrowController` **per connected human** — the client has a single controller for
 * its single local player, and a server needs one per hand holding a pin — and one
 * `BotThrower` for the whole AI roster, which holds its own stock per bot.
 *
 * ## Why it is one object rather than nine fields on the match
 *
 * The nine were `hands`, `botThrower`, `equipmentRng`, `throwCursor`, `throwIntent`,
 * `lifeStock` and `pendingLifeStarts`, plus the five methods over them. They are one subject —
 * *who is holding a grenade, and what did each life start with* — and they answer one question
 * the match asks per tick and two the harnesses ask at the end. `ClientMatch` reached the same
 * conclusion first: its copy is `client/MatchEquipment.ts`, and `stepBotThrows` below is
 * verbatim from it.
 *
 * ## The life audit is here because the refill is here
 *
 * `beginLife` is the per-life reset — a human's hand and a bot's stock — and `sampleLifeStarts`
 * is the measurement of what that reset produced (round 4, B3). Keeping them apart would be
 * two places that have to agree about what "a full slot" means.
 */
export class MatchThrows {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly deps: MatchThrowsDeps;
  private readonly botThrower: BotThrower;
  /** One grenade hand per connected human. See `handOf`. */
  private readonly hands = new Map<number, PlayerHand>();
  /** One cursor into the bot list, so one bot is considered per tick. See `stepBotThrows`. */
  private throwCursor = 0;
  private readonly throwIntent: MutableThrowIntent = {
    hasTarget: false,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    sinceSeen: 0,
  };
  /** What every life started holding (round 4, B3). See `sampleLifeStarts`. */
  private readonly lifeStock = new LifeStockAudit();
  /** Entities spawned this tick, sampled at the end of it. See `sampleLifeStarts`. */
  private readonly pendingLifeStarts: number[] = [];
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: MatchThrowsDeps) {
    this.deps = deps;
    this.botThrower = new BotThrower(deps.equipment, deps.world, deps.cfg);
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Every connected human's grenade hand (M11 Gate B, §8.24).
   *
   * Driven from the command the player's body just consumed, so a pin pulled on tick N is the
   * pin the client predicted pulling on tick N — the throw is a *consequence* of the same
   * command, not a separate message that could arrive a tick either side of it.
   */
  stepThrowers(players: readonly NetPlayer[]): void {
    for (const player of players) {
      const cmd = player.lastCommand;
      if (cmd === null) continue;
      const hand = this.handOf(player.entityId);
      hand.thrower.step(
        cmd,
        player.controller.sim,
        player.entityId,
        hand.inventory,
        player.team,
        player.alive,
      );
      // What the snapshot needs to know: the fire button means "pull the pin" while this is
      // true, and nobody watching should see a muzzle flash for it. See `NetPlayer.handBusy`.
      player.handBusy = hand.thrower.busy;
      // And what is in that hand: the grenade while it is there, nothing once it has gone.
      const phase = hand.thrower.phase;
      player.throwPhase = phase;
      player.heldEquipment = phase === 'IDLE' ? null : EquipmentSystem.slotDef(hand.inventory, hand.thrower.slot).id;
    }
  }

  /**
   * One bot's throw evaluation per tick, round robin (M5).
   *
   * Verbatim from `MatchEquipment.stepBotThrows`, including the cursor: the trajectory check
   * runs the real integrator and is the most expensive thing in `ai/` per call, so spreading
   * it across ticks is what keeps it inside the §4.7 budget. At one bot per tick with a
   * 12-30 s cooldown each, a ten-bot match spends a few dozen of them a minute.
   */
  stepBotThrows(): void {
    const bots = this.deps.bots.bots;
    if (bots.length === 0) return;
    this.throwCursor = (this.throwCursor + 1) % bots.length;
    const bot = bots[this.throwCursor];
    if (bot === undefined || !bot.participating) return;

    const bb = bot.blackboard;
    this.throwIntent.hasTarget = bb.targetId >= 0;
    this.throwIntent.targetX = bb.lastKnownX;
    this.throwIntent.targetY = bb.lastKnownFeetY;
    this.throwIntent.targetZ = bb.lastKnownZ;
    this.throwIntent.sinceSeen = bb.sinceLos;

    this.botThrower.consider(
      bot,
      bot.tierName,
      this.deps.tiers[bot.tierName],
      this.throwIntent,
      this.deps.bots.roster,
      this.deps.rng,
      // One evaluation per bot every `bots.length` ticks.
      DT * bots.length,
    );
  }

  /** This player's inventory, for the crate that refills it. Created on first use. */
  inventoryOf(entityId: number): EquipmentInventory {
    return this.handOf(entityId).inventory;
  }

  /**
   * The per-life equipment reset, for whoever just spawned.
   *
   * The branch is the same one `MatchEquipment.onSpawned` makes on the client — a hand for the
   * body you own, a thrower state for everybody else — and not an `if (networked)`: it asks
   * *which kind of combatant this is*, which is a question the server has to answer anyway
   * because humans and bots hold their grenades in different places.
   *
   * `handOf` rather than a lookup: the hand is created on demand, and a life that starts before
   * its owner has ever thrown is exactly the life a lookup would skip.
   */
  beginLife(entityId: number, human: boolean): void {
    this.pendingLifeStarts.push(entityId);

    if (human) {
      const hand = this.handOf(entityId);
      hand.thrower.reset();
      EquipmentSystem.refill(hand.inventory);
      return;
    }

    /**
     * A bot's grenades, which over the network nothing gave back (round 4, B3).
     *
     * `BotThrower.respawn` had exactly one caller in the project and it was on the client, so
     * a bot in a dedicated-server match threw the one lethal and the one tactical it starts
     * with and was unarmed for the rest of the match — `pickEquipment` skips a slot at zero,
     * silently, and a bot that stops throwing looks like a bot that decided not to. The same
     * authority migration as the entity id: the simulation moved to the server and the reset
     * stayed behind on the client.
     */
    this.botThrower.respawn(entityId);
  }

  /**
   * Sample the stock of every life that started this tick.
   *
   * Deferred to the end of the tick rather than read inside the spawn event, and that is the
   * whole reason it is honest: the refill above is another subscriber to the same event, so a
   * probe reading during the emit would be measuring subscription order. At the end of the tick
   * the life has been through every system that could have handed it anything, which is the
   * state the player actually wakes up in.
   */
  sampleLifeStarts(human: (entityId: number) => boolean): void {
    if (this.pendingLifeStarts.length === 0) return;

    for (const entityId of this.pendingLifeStarts) {
      if (human(entityId)) {
        const inv = this.handOf(entityId).inventory;
        this.lifeStock.note(
          'human',
          inv.lethalCount,
          equipmentDef(inv.lethal).count,
          inv.tacticalCount,
          equipmentDef(inv.tactical).count,
        );
        continue;
      }
      const stock = this.botThrower.stockOf(entityId);
      const full = BotThrower.fullStock;
      this.lifeStock.note('bot', stock.lethal, full.lethal, stock.tactical, full.tactical);
    }
    this.pendingLifeStarts.length = 0;
  }

  /**
   * Their hand goes with them.
   *
   * A controller left in the map is a cook timer advancing for an entity that no longer
   * exists — the same shape as the orphaned chopper `removePlayer` brings down beside this.
   */
  forget(entityId: number): void {
    this.hands.delete(entityId);
  }

  /**
   * What every life in this match started holding (playtest round 4, B3).
   *
   * `partialStock` must be 0. Read by both harnesses; safe to take mid-match, because the
   * audit is a running total rather than a walk of the roster.
   */
  report(): LifeStockReport {
    return this.lifeStock.report();
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * This player's grenade hand, created on first use.
   *
   * Lazily rather than as the seat is granted, so a seat that never throws costs nothing — and
   * so that the map cannot be left holding a controller for an entity that has been removed,
   * which `forget` guarantees by deleting it.
   */
  private handOf(entityId: number): PlayerHand {
    let hand = this.hands.get(entityId);
    if (hand === undefined) {
      const resolved = this.deps.classOf(entityId);
      hand = {
        thrower: new ThrowController(this.deps.equipment, this.deps.cfg),
        // The class's grenades, not the M5 defaults — the same read `ClientMatch` does when it
        // hands the inventory its loadout.
        inventory: makeEquipmentInventory(resolved?.lethal ?? 'frag', resolved?.tactical ?? 'flashbang'),
      };
      this.hands.set(entityId, hand);
    }
    return hand;
  }
  //#endregion
}
//#endregion
