import type { BotTeam } from '../ai/Combatant';
import { DT } from '../core/Loop';
import { Killstreak, type StreakContext } from './KillstreakBase';
import type { StreakDef } from './StreakDefs';
import type { WeaponDef } from '../weapons/WeaponDefs';

/**
 * A killstreak that is a **weapon in the owner's hands** for as long as it lasts.
 *
 * ## What this class does, and why it is so small
 *
 * Nothing but exist, age, and say whose hands and which weapon. It puts nothing in anybody's
 * inventory, because the moment a streak reaches into a `WeaponSystem` there are two runtimes
 * that have to be told and one of them will eventually not be.
 *
 * Both runtimes **ask** instead, every tick: *is a carried streak live for this body, and what
 * is it holding?* The client asks its own `StreakSystem` in a solo match and the replicated
 * entity list in a networked one — §4.15 puts activation on the replicated side, and a
 * networked client is told about its own streak the same way it is told about a sentry. The
 * server asks the one it owns. Neither pushes, so there is no edge to miss and nothing to
 * unwind: a body with no live carried streak is a body holding its loadout, every tick,
 * unarguably. That is `ChopperGunner`'s single-exit rule applied to a thing that has no exit at
 * all — `Inventory.holdStreakWeapon` is idempotent and is handed the answer rather than a verb.
 *
 * It also means **no wire change**. `StreakEntityState` already carries `kind` and `ownerId`
 * for every live streak, including the ones with no body — the note on `describeStreak`
 * promises exactly that for "anything added later".
 *
 * ## Where the weapon itself lives
 *
 * `StreakWeapons.ts`, with the mortar's and the sentry's, under the same `streak_` prefix — so
 * a kill with one is already tagged in the killfeed, already attributed to the streak rather
 * than to the gun in the loadout, and already unable to move a camo challenge. All three were
 * settled when the sentry's kills were, and none of them needed a line here.
 */
export class CarriedWeaponStreak extends Killstreak {
  constructor(
    def: StreakDef,
    ownerId: number,
    ownerTeam: BotTeam,
    instanceId: number,
    context: StreakContext,
    /** The `streak_` weapon this streak puts in the owner's hands — `carriedStreakWeapon`. */
    readonly carriedWeapon: WeaponDef,
  ) {
    super(def, ownerId, ownerTeam, instanceId, context);
  }

  override onActivate(): void {
    /* Nothing to build: the weapon is not an object in the world, it is an answer. */
  }

  override onTick(_tick: number): boolean {
    this.age += DT;
    return this.age < this.def.durationSeconds;
  }

  override onExpire(): void {
    /* Nothing to unwind either — see the class comment. The hands are asked, not told. */
  }

  override describe(): string {
    return `${this.def.name} #${this.instanceId} owner=${this.ownerId} ${this.secondsRemaining.toFixed(1)}s left`;
  }
}
