/**
 * What each seated human is carrying, and what they will carry from their next spawn (B6).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { resolveLoadout, type LoadoutSlot, type ResolvedLoadout } from '../shared/meta/Loadouts';
import { NO_PERKS, type PerkState } from '../shared/perks/PerkState';
import { ALL_STREAK_IDS, type StreakId } from '../shared/streaks/StreakDefs';
//#endregion

// ==================================== CLASS PlayerClasses ===================================== \\
//#region Class PlayerClasses
/**
 * The resolved class of every entity in one match, and the queue of changes waiting for a spawn.
 *
 * Two maps, and the whole reason they are two is the §6.6 rule they encode: `current` is what
 * each player is **carrying**, `pending` is what they have **asked for**. Merging them would
 * mean `perksOf` started answering with a class that has not been applied yet — and `perksOf`
 * is what the Dead Silence hook and the streak system read, so they would act on a loadout the
 * player is not yet using.
 *
 * Keyed by entity id rather than held on the player, because the consumers take a *predicate
 * over an entity id* — and those are asked about bots too, which have no loadout. Every
 * question therefore has a neutral answer rather than a special case: `NO_PERKS` is already
 * what "this body has no class" means, and the full streak list is what a bot has always had.
 *
 * It decides nothing about *when* a class changes. The match owns the spawn, which is the one
 * discontinuity both runtimes already agree on, and it calls `takePending` there.
 */
export class PlayerClasses {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Each seated human's resolved class, by entity id. Null for a seat that sent none. */
  private readonly current = new Map<number, ResolvedLoadout | null>();
  /** Class changes waiting for their owner's next spawn (M11, §6.6). */
  private readonly pending = new Map<number, ResolvedLoadout>();
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Record what a seat arrived carrying.
   *
   * The resolution is the caller's, because it happens as the body is created — which is what
   * makes §6.6's *"locked at the moment of migration, not at spawn time"* true rather than
   * aspirational.
   */
  seat(entityId: number, resolved: ResolvedLoadout | null): void {
    this.current.set(entityId, resolved);
  }

  /** The resolved class an entity brought, or null. */
  loadoutOf(entityId: number): ResolvedLoadout | null {
    return this.current.get(entityId) ?? null;
  }

  /**
   * The perks an entity is carrying. `NO_PERKS` for bots and for anyone without a loadout.
   *
   * Bots deliberately get the neutral state rather than a special case: "a bot has no loadout"
   * is already what `NO_PERKS` means.
   */
  perksOf(entityId: number): PerkState {
    return this.current.get(entityId)?.perkState ?? NO_PERKS;
  }

  /**
   * The three streaks an entity may earn (M7 playtest, §6.8).
   *
   * Six shipped streaks against three keys means a player who reached twelve kills would hold
   * six things and be able to spend three, so the class decides which three — exactly as it
   * decides which three perks. A bot has no class and keeps the full list, which is what it
   * has always had.
   */
  equippedStreaksOf(entityId: number): readonly StreakId[] {
    const resolved = this.current.get(entityId);
    if (resolved == null) return ALL_STREAK_IDS;
    return resolved.streaks.filter((id): id is StreakId => id !== null);
  }

  /** Queue a class change for this entity's next spawn. The resolution happens here. */
  queue(entityId: number, slot: LoadoutSlot): void {
    this.pending.set(entityId, resolveLoadout(slot, 0));
  }

  hasPending(entityId: number): boolean {
    return this.pending.has(entityId);
  }

  /**
   * Cash a queued class, if there is one: it becomes what this entity is carrying.
   *
   * Taken rather than read, because a class applied twice would be applied to a body that has
   * already adopted it — and the caller's next act is the spawn that makes it true.
   */
  takePending(entityId: number): ResolvedLoadout | null {
    const pending = this.pending.get(entityId);
    if (pending === undefined) return null;
    this.pending.delete(entityId);
    this.current.set(entityId, pending);
    return pending;
  }

  /** Forget an entity entirely, in both maps. Part of releasing a seat. */
  forget(entityId: number): void {
    this.current.delete(entityId);
    this.pending.delete(entityId);
  }
  //#endregion
}
//#endregion
