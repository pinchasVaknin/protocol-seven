import { EV, type GameBus } from '../core/Events';
import { Disposable } from '../core/Disposable';
import { DT } from '../core/Loop';
import { anyWeaponDef } from '../weapons/AnyWeapon';
import type { WeaponDef } from '../weapons/WeaponDefs';
import { makeDamageRequest, type DamageRequest, type DamageSystem } from './DamageSystem';

/**
 * Bodies that are still burning after the jet has moved on (2026-09-26, the human).
 *
 * ## Why it is a system and not a field on the weapon
 *
 * The flamethrower's damage stops when the trigger does; the *burn* is the half that outlives
 * the contact, and it has to be owned by something that ticks whether or not the player who lit
 * it is still alive, still holding the weapon, or still in the match. That is the same argument
 * `PerksRuntime` makes for Scavenger's pickups, and it lands in the same place: a small system
 * built and destroyed with the match, subscribed to the bus, owning nothing else.
 *
 * ## It is lit by damage, not by the weapon
 *
 * Nothing calls `ignite`. This listens for `damage.dealt`, and a hit whose weapon carries a
 * `flame` profile starts or refreshes a burn — so the *only* way to catch fire is to have taken
 * fire damage, which means every rule that guards the damage door already guards this one. A
 * teammate cannot be lit, because the door refused the damage that would have lit them. An
 * invulnerable body cannot be lit for the same reason, and neither can a corpse.
 *
 * ## Authority
 *
 * Burn damage is damage, so it belongs to whoever owns health: the server in a networked match,
 * the client in a solo one. `ServerMatch` steps this and `ClientMatch` steps it **only when it
 * is not networked**, the same line `flow.simulate` is on. A client that ticked burns of its own
 * would be a second opinion about a health bar it does not own.
 *
 * The **owner keeps the kill**. `sourceId` on the burn is whoever was holding the flamethrower
 * when the body was last touched, so a burn that finishes somebody off credits them, their team
 * and their streak — the same rule the sentry's kills settled (2026-09-24) and for the same
 * reason: the machine is theirs, the kill is theirs.
 */

/** One body, on fire. */
interface Burn {
  entityId: number;
  /** Who lit it, and who gets the kill if it finishes. */
  sourceId: number;
  /** Seconds left. Refreshed — not stacked — every time the jet touches them again. */
  secondsLeft: number;
}

export class BurnSystem extends Disposable {
  private readonly burning = new Map<number, Burn>();
  private readonly request: DamageRequest;

  /**
   * `burnDef` is handed in rather than imported: the def belongs to `streaks/`, which depends on
   * `combat/` and must not be depended on back — the same rule that keeps `Damageable` from
   * importing `BotTeam`. Its damage is already the per-tick figure.
   */
  constructor(bus: GameBus, private readonly damage: DamageSystem, burnDef: WeaponDef) {
    super();
    this.request = makeDamageRequest(burnDef);

    this.own(
      bus.on(EV.DamageDealt, (p) => {
        // The weapon that dealt it decides. Anything without a `flame` profile leaves nothing
        // behind, which is every weapon in the game but one.
        const flame = anyWeaponDef(p.weaponId)?.flame;
        if (flame === undefined) return;
        this.light(p.targetId, p.sourceId, flame.burnSeconds);
      }),
    );

    // A body that respawns is not still on fire from its last life.
    this.own(bus.on(EV.BotSpawned, (p) => this.burning.delete(p.entityId)));
    this.own(bus.on(EV.PlayerSpawned, (p) => this.burning.delete(p.entityId)));
    this.own(bus.on(EV.EntityKilled, (p) => this.burning.delete(p.targetId)));
  }

  /** Whether this body is on fire, for the HUD, the wire and the renderer. */
  isBurning(entityId: number): boolean {
    return this.burning.has(entityId);
  }

  /** How many bodies are alight. Read by the debug panel and the tests. */
  get count(): number {
    return this.burning.size;
  }

  /**
   * One sim tick: burn everything that is alight, then drop whatever went out.
   *
   * The damage goes through `DamageSystem.apply` like everything else, with the *lighter* as
   * the source — so a burn that kills is a kill in the feed, in the score and in the streak
   * ledger, and the friendly gate applies to it exactly as it applied to the jet.
   */
  simulate(): void {
    if (this.burning.size === 0) return;
    for (const burn of [...this.burning.values()]) {
      const target = this.damage.get(burn.entityId);
      if (target === undefined || !target.health.alive) {
        this.burning.delete(burn.entityId);
        continue;
      }

      this.request.sourceId = burn.sourceId;
      this.request.targetId = burn.entityId;
      this.request.zone = 'torso';
      this.request.upperTorso = false;
      this.request.autonomous = true;
      // No falloff and no penetration loss: the fire is on them, not travelling to them.
      this.request.distance = 0;
      this.request.penetrationRetain = 1;
      this.request.x = target.rig.x;
      this.request.y = target.rig.y + target.rig.layout.aimY;
      this.request.z = target.rig.z;
      // `burnWeapon`'s damage is already the per-tick figure, so this is one plain application
      // through the one door — no borrowed numbers, no arithmetic here.
      this.damage.apply(this.request);

      burn.secondsLeft -= DT;
      if (burn.secondsLeft <= 0) this.burning.delete(burn.entityId);
    }
  }

  /** Everything goes out at once — a round reset, a match ending. */
  clear(): void {
    this.burning.clear();
  }

  // -- internals ----------------------------------------------------------------

  /**
   * Refreshed rather than stacked.
   *
   * Two seconds in a jet is already 140 damage through the cone; if each of those twenty ticks
   * also added three seconds of burn to a pile, walking out of the fire would be a death
   * sentence decided a second earlier. The burn is a *timer the fire keeps resetting*, so what
   * it costs is the same three seconds whether the contact was one tick or twenty — the jet is
   * where the damage is, and the burn is what stops a body simply walking away from it.
   */
  private light(entityId: number, sourceId: number, seconds: number): void {
    const existing = this.burning.get(entityId);
    if (existing !== undefined) {
      existing.sourceId = sourceId;
      existing.secondsLeft = seconds;
      return;
    }
    this.burning.set(entityId, { entityId, sourceId, secondsLeft: seconds });
  }
}
