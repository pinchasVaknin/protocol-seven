/**
 * The roster and the killstreaks, flattened into the records the wire carries (B5).
 *
 * Lifted verbatim from M10's `GameServer`, and lifted again here out of `MatchInstance.ts`. The
 * only change either time is where it lives: an entity list is a property of a world, there are
 * two worlds now, and *how a body becomes bytes* is a different subject from *which bodies a
 * seat is told about*, which is what the instance decides.
 *
 * Nothing here holds state beyond the two index tables, and nothing here allocates: every
 * writer fills a record the caller already owns, because they run per entity per snapshot tick
 * (S4.7).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { Bot } from '../../shared/ai/Bot';
import { Btn, isDown } from '../../shared/core/InputCommand';
import { ALL_EQUIPMENT, type EquipmentId } from '../../shared/equipment/EquipmentDefs';
import { NO_SKIN_INDEX } from '../../shared/meta/Skins';
import { ownerCode, SEFlag, type StreakEntityState } from '../../shared/net/Skirmish';
import type { PlayerSim } from '../../shared/player/PlayerState';
import { EFlag, THROW_PHASES, weaponIndexOf, type EntitySnapshot } from '../../shared/net/Snapshot';
import { CarePackage } from '../../shared/streaks/CarePackage';
import { ChopperGunner } from '../../shared/streaks/ChopperGunner';
import type { Killstreak } from '../../shared/streaks/KillstreakBase';
import { MortarStrike } from '../../shared/streaks/MortarStrike';
import { SentryGun } from '../../shared/streaks/SentryGun';
import { STREAK_DEFS, type StreakId } from '../../shared/streaks/StreakDefs';
import { Uav } from '../../shared/streaks/Uav';
import type { NetPlayer } from '../NetPlayer';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * An id to its index, for the two tables whose order *is* their identity.
 *
 * Both runtimes build them from the same module in the same order, so an index costs one byte
 * where `'chopper_gunner'` costs fifteen and no mapping has to be agreed. A `Map` built once at
 * load rather than a scan per call, because both lookups run per entity per snapshot tick —
 * which is also what closed the call site of BACKLOG #30.
 */
const EQUIPMENT_INDEX = new Map<EquipmentId, number>(ALL_EQUIPMENT.map((d, i) => [d.id, i]));

const STREAK_INDEX = new Map<StreakId, number>(STREAK_DEFS.map((d, i) => [d.id, i]));
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** One seated human, as the wire sees them. Fills `e`; allocates nothing. */
export function writePlayer(e: EntitySnapshot, p: NetPlayer): void {
  const sim = p.controller.sim;
  const weapon = p.weapons.weapon;
  e.entityId = p.entityId;
  e.displayName = p.displayName;
  writePose(e, sim);
  e.heightScale = p.capsuleScale;
  e.health = clampByte(p.health.current);
  e.weaponIndex = weaponIndexOf(p.weapons.definition.id);
  e.characterIndex = p.characterIndex;
  e.flags =
    (p.alive ? EFlag.Alive : 0) |
    (isDown(p.lastButtons, Btn.Fire) && !p.handBusy ? EFlag.Firing : 0) |
    (weapon.reloading ? EFlag.Reloading : 0) |
    (weapon.adsFraction > 0.5 ? EFlag.Ads : 0) |
    (sim.sprintActive || sim.tacSprintActive ? EFlag.Sprinting : 0) |
    (sim.grounded ? EFlag.Grounded : 0) |
    (p.handBusy ? EFlag.Throwing : 0) |
    (p.meleeSeconds > 0 ? EFlag.Melee : 0) |
    (p.team === 'B' ? EFlag.TeamB : 0);
  e.heldEquipment = heldEquipmentIndex(p.heldEquipment);
  e.throwPhase = THROW_PHASES.indexOf(p.throwPhase);
  copyVisual(e, p.visual);
}

/**
 * One bot, as the wire sees it.
 *
 * Deliberately a second writer rather than one over both, although the pose, the health, the
 * weapon and five of the nine flags are written identically. The two records come off a
 * `NetPlayer` and a `Bot`, and a single writer taking either would make every field read on
 * this path polymorphic — per entity per snapshot tick, which is exactly the shape R7 forbids.
 * What *is* shared is `writePose`, because both reach it through a `PlayerController` and the
 * call stays monomorphic.
 */
export function writeBot(e: EntitySnapshot, b: Bot): void {
  const sim = b.controller.sim;
  const weapon = b.weapons.weapon;
  e.entityId = b.entityId;
  e.displayName = b.displayName;
  writePose(e, sim);
  e.heightScale = b.capsuleScale;
  e.health = clampByte(b.health.current);
  e.weaponIndex = weaponIndexOf(b.weapons.definition.id);
  // The server has no opinion about a bot's body (M16 decision 4): every client deals one.
  e.characterIndex = NO_SKIN_INDEX;
  e.flags =
    (b.health.alive ? EFlag.Alive : 0) |
    (isDown(b.lastCommand.buttons, Btn.Fire) ? EFlag.Firing : 0) |
    (weapon.reloading ? EFlag.Reloading : 0) |
    (weapon.adsFraction > 0.5 ? EFlag.Ads : 0) |
    (sim.sprintActive || sim.tacSprintActive ? EFlag.Sprinting : 0) |
    (sim.grounded ? EFlag.Grounded : 0) |
    EFlag.Bot |
    (b.team === 'B' ? EFlag.TeamB : 0);
  // A bot's throw has no arm (`BotThrower`), and the record is pooled: a slot a player's cook
  // left behind must not put a grenade in the next bot's hand.
  e.heldEquipment = 255;
  e.throwPhase = 0;
  copyVisual(e, b.visual);
}

/**
 * One live streak, as the wire sees it (M11 Gate B, §8.22).
 *
 * `instanceof` here rather than a virtual method on `Killstreak`, deliberately and against the
 * usual instinct. `streaks/` is shared code that knows nothing about a wire format, and putting
 * a `toNetState()` on the base class would push a networking concern into six gameplay classes
 * to save one switch in the one place that has the concern. The same reasoning that keeps
 * `EntitySnapshot` flattening in this file rather than on `NetPlayer`.
 *
 * The kinds that are pure intel or pure effect — UAV, Counter-UAV, Mortar — still send a record.
 * A UAV has no mesh, but the *fact that one is up* is what the HUD's "UAV ONLINE" banner and the
 * minimap sweep are drawn from, and an absent record cannot say that.
 */
export function describeStreak(streak: Killstreak): StreakEntityState {
  const base = {
    instanceId: streak.instanceId,
    kind: streakKindIndex(streak.def.id),
    ownerId: streak.ownerId,
    team: ownerCode(streak.ownerTeam),
    yaw: 0,
    pitch: 0,
    // 255 is "cannot be shot down", which is every kind except the sentry.
    health: 255,
    fraction: 0,
    flags: SEFlag.Alive,
  };

  if (streak instanceof SentryGun) {
    return {
      ...base,
      x: streak.x,
      y: streak.y,
      z: streak.z,
      yaw: streak.turretYaw,
      pitch: streak.turretPitch,
      /**
       * A share of full, not hit points (2026-09-28). It was `clampByte(current)`, which nothing
       * read until the health bar did — and a 260 HP sentry in a byte is "full" until it has taken
       * five, and "full" again for every sentry anybody tunes above 255. The bar wants the one
       * number that survives both: how much of it is left.
       */
      health: clampByte(streak.health.fraction * 255),
      // The owner's dismantle, which a networked owner's prompt fills its ring from.
      fraction: clampByte(streak.dismantleFraction * 255),
      flags: streak.health.alive ? SEFlag.Alive | SEFlag.Landed : 0,
    };
  }

  if (streak instanceof CarePackage) {
    return {
      ...base,
      x: streak.x,
      y: streak.y,
      z: streak.z,
      fraction: clampByte(streak.claimFraction * 255),
      flags:
        SEFlag.Alive |
        (streak.landed ? SEFlag.Landed : 0) |
        (streak.claimantId >= 0 ? SEFlag.Claiming : 0),
    };
  }

  if (streak instanceof ChopperGunner) {
    return { ...base, x: streak.x, y: streak.y, z: streak.z, yaw: streak.yaw, pitch: streak.pitch };
  }

  if (streak instanceof Uav) {
    // No body. The sweep bearing rides the per-recipient half of the message, where it can be
    // withheld from the other team; this record only says a UAV is up and whose it is.
    return { ...base, x: 0, y: 0, z: 0 };
  }

  if (streak instanceof MortarStrike) {
    return { ...base, x: streak.markX, y: 0, z: streak.markZ };
  }

  // Counter-UAV, and anything added later: presence, owner and team, which is all a streak with
  // no body in the world can meaningfully say.
  return { ...base, x: 0, y: 0, z: 0 };
}

/** An equipment id as its index in `ALL_EQUIPMENT`. Index is identity, as everywhere else. */
export function equipmentKindIndex(id: EquipmentId): number {
  return EQUIPMENT_INDEX.get(id) ?? 0;
}

/** A streak id as an index into `STREAK_DEFS`. */
export function streakKindIndex(id: StreakId): number {
  return STREAK_INDEX.get(id) ?? 0;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Where a body is, how it is facing and how it is moving: the ten fields both writers share.
 *
 * One helper over a `PlayerSim`, which is what a human and a bot both hold — so unlike the two
 * writers around it this call site has one shape and stays monomorphic.
 */
function writePose(e: EntitySnapshot, sim: PlayerSim): void {
  e.x = sim.x;
  e.y = sim.y;
  e.z = sim.z;
  e.yaw = sim.yaw;
  e.pitch = sim.pitch;
  e.vx = sim.vx;
  e.vz = sim.vz;
  e.stance = sim.stance;
}

/**
 * The M3 visual serials, verbatim.
 *
 * Directions become a single angle on the wire: a fall or a flinch only ever uses the
 * horizontal direction, so two components carrying a normalised vector is two bytes spent
 * saying what one angle says exactly.
 */
function copyVisual(
  e: EntitySnapshot,
  v: {
    deathSerial: number;
    deathDirX: number;
    deathDirZ: number;
    spawnSerial: number;
    flinchSerial: number;
    flinchDirX: number;
    flinchDirZ: number;
  },
): void {
  e.deathSerial = v.deathSerial;
  e.deathAngle = Math.atan2(v.deathDirX, v.deathDirZ);
  e.spawnSerial = v.spawnSerial;
  e.flinchSerial = v.flinchSerial;
  e.flinchAngle = Math.atan2(v.flinchDirX, v.flinchDirZ);
}

/**
 * A held grenade as its wire index, and 255 for an empty hand (BACKLOG #30, the call site).
 *
 * `Snapshot.equipmentIndexOf` answers the same question with `ALL_EQUIPMENT.findIndex`, which
 * allocates a closure per call — per player per snapshot — while this file already built the
 * table the weapons side has always had. Same indices, because both are `ALL_EQUIPMENT` in
 * order, and the same 255 for a miss and for nothing held.
 */
function heldEquipmentIndex(id: EquipmentId | null): number {
  if (id === null) return 255;
  return EQUIPMENT_INDEX.get(id) ?? 255;
}

function clampByte(v: number): number {
  const i = Math.round(v);
  return i < 0 ? 0 : i > 255 ? 255 : i;
}
//#endregion
