import type { BotTeam } from '../ai/Combatant';
import { Btn, isDown, justPressed, justReleased, type InputCommand } from '../core/InputCommand';
import { DT } from '../core/Loop';
import type { PlayerSim } from '../player/PlayerState';
import type { EquipmentConfig } from './EquipmentConfig';
import type { EquipmentDef, EquipmentSlot } from './EquipmentDefs';
import { EquipmentSystem, type EquipmentInventory } from './EquipmentSystem';
import { simCos, simSin } from '../core/SimMath';

/**
 * The player's half of throwing: drawing, cooking, releasing and running out (brief S6.3).
 *
 * Split out of `EquipmentSystem` because that class is the *world's* view of equipment —
 * what is in the air and what it does — and this is one entity's input handling. A bot's
 * equivalent is `BotThrower`, and both end at the same `throwFrom` call, which is what
 * makes a bot's frag and a player's frag the same object with the same arc.
 *
 * **A grenade is drawn, not thrown** (2026-09-24, the human's brief §2). The equipment key
 * takes one out and leaves it in the hand: the player can walk, turn and look with it, and
 * nothing has been spent. The **fire button** is what pulls the pin and what throws — held, it
 * pulls and cocks; released, it throws. Pressing the equipment key again puts the grenade back,
 * and so does reaching for a weapon.
 *
 * The four phases, and every one of them is a state the player chose:
 *
 * | phase | what the player is doing | what ends it |
 * |---|---|---|
 * | `IDLE` | holding a weapon | the lethal or tactical key |
 * | `READY` | a grenade in the hand, pin in | the fire button, the same key again, or 1/2 |
 * | `COOKING` | the pin is out and the fuse is burning | letting the fire button go, or `cookLimit` |
 * | `THROWING` | the arm is swinging, the grenade still in the hand | `THROW_RELEASE_TIME` |
 *
 * **Cooking is a single clock.** The fuse starts when the pin comes out, not when the grenade
 * leaves the hand, so a frag held for two seconds detonates a second and a half after it lands.
 * Hold it past `cookLimit` and it goes off in your hand — which is the only reason cooking is a
 * decision rather than a free upgrade.
 *
 * **The grenade leaves the hand at the end of the animation, not at the button.** `THROWING`
 * is that gap, and the number is here rather than in `ViewmodelAnim` on purpose: the simulation
 * owns when a grenade exists, the animation owns what it looks like, and a server that spawned
 * a projectile on the button while a client drew it a sixth of a second later would be two
 * answers to one question.
 *
 * Runs on sim ticks and reads only the `InputCommand` bitfield (S4.2).
 */

export type ThrowPhase = 'IDLE' | 'READY' | 'COOKING' | 'THROWING';

/** Looking down past this angle drops it at your feet instead of lobbing it. */
const UNDERHAND_PITCH_RAD = -0.6;

/**
 * Seconds from the fire button coming up to the grenade leaving the hand (2026-09-24).
 *
 * The release animation's length, owned here because it is the length of a *state*: the arm is
 * swinging, the grenade is still in the hand, and nothing else may happen yet.
 * `ViewmodelAnim` reads how far through it the arm is and blends WIND-UP to RELEASE over
 * exactly this, so the frame the hand opens on is the frame the projectile appears.
 */
export const THROW_RELEASE_TIME = 0.18;

/**
 * Seconds after the grenade has left the hand before the weapon is back in the fight.
 *
 * Matches the viewmodel's raise so the gun is visibly up again on the tick firing is allowed.
 * 0.24 rather than the 0.42 it was: the release now takes 0.18 s of its own in front of it, and
 * the two together are the same 0.42 s of being defenceless the balance was tuned against.
 * Exported because the throw animation reads `followThrough` as a fraction of it: it is how far
 * the arm is through its recovery, and the sim is where that number lives.
 */
export const THROW_FOLLOW_THROUGH = 0.24;

/**
 * Where a thrown object leaves the hand, relative to the eye.
 *
 * Spawning exactly at the eye is why the throw read as coming out of the player's chest: the
 * grenade appeared at the camera and travelled away from it, with nothing to suggest an arm.
 * Forward, right and slightly down puts it where the hand is.
 */
const HAND_FORWARD = 0.42;
const HAND_RIGHT = 0.22;
const HAND_DOWN = 0.12;

export class ThrowController {
  phase: ThrowPhase = 'IDLE';
  /** Seconds the current cook has burned. */
  cook = 0;
  /** Which slot is being cooked. */
  slot: EquipmentSlot = 'lethal';
  /**
   * Seconds left of the throw follow-through.
   *
   * The release is instantaneous in the sim, but the *arm* is not: the weapon is off screen
   * and the hand is still coming back. Firing during that window was reported as a bug and it
   * is one — you cannot shoot a rifle you are not holding.
   */
  followThrough = 0;

  /** Seconds left of the release: the arm is swinging and the grenade is still in the hand. */
  release = 0;

  private prevButtons = 0;

  constructor(
    private readonly system: EquipmentSystem,
    private readonly cfg: EquipmentConfig,
  ) {}

  reset(): void {
    this.phase = 'IDLE';
    this.cook = 0;
    this.release = 0;
    this.followThrough = 0;
    this.prevButtons = 0;
  }

  /**
   * True while the hand is on a grenade rather than on the weapon.
   *
   * The one authority for "can this player shoot right now" as far as equipment is concerned:
   * `WeaponSystem.fireBlocked` reads it, and so does `ViewmodelAnim` to decide whether the
   * weapon is on screen at all. One flag, so what you see and what you can do agree.
   */
  get busy(): boolean {
    return this.phase !== 'IDLE' || this.followThrough > 0;
  }

  /**
   * How far the arm is through the release, 0..1 — what `ViewmodelAnim` poses the second half
   * of the throw from.
   *
   * It stays at 1 through the follow-through, because by then the grenade has gone and the
   * hand is coming back from the pose it threw in rather than travelling to a new one.
   */
  get releaseFraction(): number {
    if (this.phase === 'THROWING') {
      return THROW_RELEASE_TIME <= 0 ? 1 : Math.min(1, 1 - this.release / THROW_RELEASE_TIME);
    }
    return this.followThrough > 0 ? 1 : 0;
  }

  /** Seconds of fuse left if it were released right now, for the HUD. */
  remainingFuse(inv: EquipmentInventory): number {
    if (this.phase !== 'COOKING' && this.phase !== 'THROWING') return 0;
    const def = EquipmentSystem.slotDef(inv, this.slot);
    return Math.max(0, def.fuseSeconds - this.cook);
  }

  /**
   * One sim tick.
   *
   * `alive` is false while dead: a corpse must not keep cooking, and a cook that survived
   * a respawn would detonate in the hand of the next life.
   */
  step(
    cmd: InputCommand,
    sim: PlayerSim,
    entityId: number,
    inv: EquipmentInventory,
    team: BotTeam,
    alive: boolean,
  ): void {
    const buttons = alive ? cmd.buttons : 0;
    const prev = this.prevButtons;
    this.prevButtons = buttons;

    if (!alive) {
      this.phase = 'IDLE';
      this.cook = 0;
      this.release = 0;
      // A corpse is not following through. Without this the flag survives the respawn and
      // the weapon comes back blocked.
      this.followThrough = 0;
      return;
    }

    // Before any phase branch, deliberately. The follow-through *begins* when the grenade
    // leaves the hand and the phase returns to IDLE, so a decrement inside a phase branch can
    // never run — it left the weapon permanently blocked after a single grenade. Measured,
    // not theorised.
    if (this.followThrough > 0) this.followThrough = Math.max(0, this.followThrough - DT);

    if (this.phase === 'IDLE') {
      if (justPressed(buttons, prev, Btn.Lethal)) this.draw('lethal', inv);
      else if (justPressed(buttons, prev, Btn.Tactical)) this.draw('tactical', inv);
      return;
    }

    const def = EquipmentSystem.slotDef(inv, this.slot);

    if (this.phase === 'READY') {
      // The equipment keys: the one that is out puts it away, the other swaps to it.
      if (justPressed(buttons, prev, Btn.Lethal)) {
        if (this.slot === 'lethal') this.stow();
        else this.draw('lethal', inv);
        return;
      }
      if (justPressed(buttons, prev, Btn.Tactical)) {
        if (this.slot === 'tactical') this.stow();
        else this.draw('tactical', inv);
        return;
      }
      // Reaching for a weapon puts the grenade away; it does not throw it.
      if (justPressed(buttons, prev, Btn.Slot1) || justPressed(buttons, prev, Btn.Slot2)) {
        this.stow();
        return;
      }
      if (justPressed(buttons, prev, Btn.Fire)) {
        this.phase = 'COOKING';
        this.cook = 0;
      }
      return;
    }

    /**
     * The fuse burns from the moment the pin comes out, through the release and into the air.
     *
     * It does not pause while the arm swings, which is why `cook` keeps running in `THROWING`:
     * the 0.18 s the hand takes to open is 0.18 s of fuse, and a frag cooked to the edge goes
     * off in the hand rather than at the target if the player leaves it that late.
     */
    this.cook += DT;
    if (def.cookable && this.cook >= def.cookLimit) {
      // Held too long. It goes off where it is, and `throwFrom` with a spent fuse is how that
      // happens — no second detonation path, and the killfeed reads as a suicide the way it
      // should. Not delayed by the release: what detonates in the hand never left it.
      this.throwNow(def, sim, entityId, cmd, inv, team, def.fuseSeconds);
      return;
    }

    if (this.phase === 'COOKING') {
      if (justReleased(buttons, prev, Btn.Fire) || !isDown(buttons, Btn.Fire)) {
        this.phase = 'THROWING';
        this.release = THROW_RELEASE_TIME;
      }
      return;
    }

    // THROWING: the arm is swinging and the grenade is still in the hand.
    this.release = Math.max(0, this.release - DT);
    if (this.release <= 0) {
      this.throwNow(def, sim, entityId, cmd, inv, team, def.cookable ? this.cook : 0);
    }
  }

  /** Take one out. Nothing is spent until it is thrown, so a draw can be undone for free. */
  private draw(slot: EquipmentSlot, inv: EquipmentInventory): void {
    if (EquipmentSystem.slotCount(inv, slot) <= 0) return;
    this.slot = slot;
    this.phase = 'READY';
    this.cook = 0;
    this.release = 0;
  }

  /** Put it back. No follow-through: nothing was thrown, so the weapon comes straight back up. */
  private stow(): void {
    this.phase = 'IDLE';
    this.cook = 0;
    this.release = 0;
  }

  private throwNow(
    def: EquipmentDef,
    sim: PlayerSim,
    entityId: number,
    cmd: InputCommand,
    inv: EquipmentInventory,
    team: BotTeam,
    cooked: number,
  ): void {
    this.phase = 'IDLE';
    this.cook = 0;
    this.release = 0;
    this.followThrough = THROW_FOLLOW_THROUGH;
    if (EquipmentSystem.slotCount(inv, this.slot) <= 0) return;

    const underhand = cmd.pitch < UNDERHAND_PITCH_RAD || def.impact === 'plant';
    // Out of the hand, not out of the camera. Forward along the look, right along its
    // perpendicular, and a little below eye level.
    const cp = simCos(cmd.pitch);
    const fx = -simSin(cmd.yaw) * cp;
    const fz = -simCos(cmd.yaw) * cp;
    const rx = simCos(cmd.yaw);
    const rz = -simSin(cmd.yaw);
    const thrown = this.system.throwFrom(
      def,
      entityId,
      team,
      sim.x + fx * HAND_FORWARD + rx * HAND_RIGHT,
      sim.y + sim.eyeHeight - HAND_DOWN + simSin(cmd.pitch) * HAND_FORWARD,
      sim.z + fz * HAND_FORWARD + rz * HAND_RIGHT,
      cmd.yaw,
      cmd.pitch,
      sim.vx,
      sim.vz,
      cooked,
      underhand,
    );
    // Only spend the slot if the pool actually had room. Silently eating a grenade because
    // thirty-two were already in the air would be the worst kind of invisible failure.
    if (thrown !== null) EquipmentSystem.spendSlot(inv, this.slot);
  }

  /** Seconds between indicator beeps, exposed so the HUD and the audio agree. */
  get beepInterval(): number {
    return this.cfg.beepInterval;
  }
}
