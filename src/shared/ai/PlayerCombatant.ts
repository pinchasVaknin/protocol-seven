import { HitboxRig, HUMANOID_RIG, rigLayoutFor } from '../combat/HitboxRig';
import { PLAYER_ENTITY_ID } from '../combat/DamageSystem';
import type { Health } from '../player/Health';
import type { PlayerController } from '../player/PlayerController';
import type { BotTeam, Combatant } from './Combatant';

/**
 * The local player, seen from the AI's side of the fence.
 *
 * M2 already registered the player as a `Damageable` with a rig that follows the capsule;
 * this adds the three things perception and spawn safety need on top — a team, a facing and
 * a stance — and nothing else. It is a view over `PlayerController`, not a copy of it, so
 * there is no second pose to fall out of sync.
 *
 * `participating` is what makes the AFK bot-match harness possible: a spectating player is
 * still registered, still has a rig, and is simply not a combatant, so no bot looks for it
 * and no spawn is scored against it.
 */
export class PlayerCombatant implements Combatant {
  /**
   * Which entity this body **is** (M11 Gate B playtest).
   *
   * `PLAYER_ENTITY_ID` — zero — was hard-coded here, and over the network that is not merely
   * a cosmetic mismatch: it is the id `Ballistics.nearestTarget` compares its `excludeId`
   * against. A connected human shoots as entity 1 or above, so their **own rig was a legal
   * target for their own bullets**, and `raySlab` starts its interval at `tmin = 0` — a ray
   * that begins inside a box hits it at t = 0. Every shot therefore terminated on the
   * shooter, at point-blank range, before it had travelled a millimetre.
   *
   * Three separately reported faults were that one line:
   *
   *  - a hitmarker (and, on the head box, a *kill* marker) on the first shot of a life,
   *    aimed at nothing;
   *  - the local health bar driven to zero and stuck there, red, because a networked client
   *    does not step its own `Health` and `setReplicated` only ran when the **server's**
   *    value changed — which it does not while the server thinks you are unhurt;
   *  - target dummies and lobby bots that could not be shot, because the round never got
   *    past the shooter's own chest.
   *
   * Defaulted so every single-player call site keeps the identity it has had since M2.
   */
  readonly entityId: number;
  /**
   * The name the killfeed and the damage report call this body by (M17, C2).
   *
   * A constant `'OPERATOR'` until then, which was the report "the player's name resets to
   * Operator in a solo match": the callsign is a profile setting, and the client-side match
   * is the one place the profile's owner is also a combatant on a local roster. Defaulted for
   * the harnesses and the audits, which have no profile to read one from.
   */
  readonly displayName: string;
  readonly rig = new HitboxRig(HUMANOID_RIG);

  /** Cleared for the AFK harness, where the human is a spectator. */
  active = true;
  /**
   * True while the player is flying a Chopper Gunner (M7 playtest).
   *
   * Clearing `active` alone is not enough: it takes the body out of *perception* and spawn
   * scoring, but a grenade or a mortar already in the air still resolves against the rig.
   * This is read at the damage door.
   */
  invulnerable = false;

  /**
   * Written once a tick by `Match` from the player's own weapon system.
   *
   * A field rather than a getter because `PlayerCombatant` is built before the weapon is —
   * the weapon needs the damage system, which needs this registered first — and a lazy
   * back-reference to break that order would be a cycle for one boolean.
   */
  glinting = false;

  /**
   * Whether the player is holding a sidearm, which `syncRig` needs because a crouching body with
   * one is drawn in a half-squat 10.9 cm above the kneel and wears its own layout (M13 decision
   * 11, settled 2026-09-25).
   *
   * A field written once a tick, for the reason `glinting` above is one: this object is
   * constructed before the weapon system that would answer the question. It is the local player's
   * half of what `weaponIndex` tells the server about everybody else.
   */
  pistol = false;

  constructor(
    readonly health: Health,
    readonly team: BotTeam,
    private readonly player: PlayerController,
    entityId: number = PLAYER_ENTITY_ID,
    displayName = 'OPERATOR',
  ) {
    this.entityId = entityId;
    this.displayName = displayName;
  }

  get px(): number {
    return this.player.sim.x;
  }
  get py(): number {
    return this.player.sim.y;
  }
  get pz(): number {
    return this.player.sim.z;
  }
  get yaw(): number {
    return this.player.sim.yaw;
  }
  get vx(): number {
    return this.player.sim.vx;
  }
  get vz(): number {
    return this.player.sim.vz;
  }
  get eyeHeight(): number {
    return this.player.sim.eyeHeight;
  }
  get aimHeight(): number {
    return this.rig.layout.aimY;
  }
  get quiet(): boolean {
    const stance = this.player.sim.stance;
    return stance === 'CROUCH' || stance === 'SLIDE';
  }
  get participating(): boolean {
    return this.active && this.health.alive;
  }

  /**
   * Keep the rig on the capsule. Called from the sim tick, never the render pass: a shot
   * is resolved on a tick, so it has to be resolved against where the player was on it.
   */
  syncRig(): void {
    const sim = this.player.sim;
    this.rig.setLayout(rigLayoutFor(sim.stance, sim.vx, sim.vz, this.pistol));
    this.rig.setTransform(sim.x, sim.y, sim.z, sim.yaw);
  }
}
