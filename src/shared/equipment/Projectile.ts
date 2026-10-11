/**
 * A thrown object in flight (brief S6.3).
 *
 * The arc is an integrated ballistic curve stepped through the *existing* swept collision —
 * `CollisionWorld.moveCapsule` with a capsule whose height is twice its radius, which is a
 * sphere. No physics library, no second collision scheme, and the contact normals the
 * capsule solver already produces are exactly what a bounce needs (S4.3, S6.3).
 *
 * Everything is pooled and the pool never grows: a match can have a few dozen live objects
 * and each one is a fixed record written in place, so the per-tick path allocates nothing.
 *
 * ## One launch, one integration
 *
 * `solveLaunch` and the two helpers at the bottom are shared on purpose. A thrown object has to
 * leave the hand from the same point whether the caller is `EquipmentSystem.throwFrom` or
 * `BotThrower`'s safety check, and it has to fly the same arc whether it is being stepped or
 * previewed — otherwise the bot aims at a place its grenade will not land, which is a defect
 * nobody can see from outside. They were written out twice each, and they are written once now.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { BotTeam } from '../ai/Combatant';
import { DT } from '../core/Loop';
import { DEG2RAD } from '../core/MathUtil';
import { simCos, simSin } from '../core/SimMath';
import type { CollisionWorld, MoveOutput } from '../world/CollisionWorld';
import { makeMoveOutput } from '../world/CollisionWorld';
import type { EquipmentConfig } from './EquipmentConfig';
import type { EquipmentDef } from './EquipmentDefs';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
type ProjectilePhase =
  /** In the air or rolling. */
  | 'LIVE'
  /** Stuck to geometry or to somebody (semtex). */
  | 'STUCK'
  /** Planted and counting down to armed (claymore). */
  | 'ARMING'
  /** Planted, armed, watching its arc. */
  | 'ARMED'
  /** Fuse expired or trigger tripped; the system will detonate it this tick. */
  | 'DETONATE';

export interface Projectile {
  active: boolean;
  serial: number;
  def: EquipmentDef;
  ownerId: number;
  team: BotTeam | 'NONE';

  phase: ProjectilePhase;

  /** Centre of the sphere. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;

  /** Previous-tick centre, for render interpolation. */
  px: number;
  py: number;
  pz: number;

  /** Seconds until detonation, or -1 for trigger-armed equipment. */
  fuse: number;
  /** Seconds since it left the hand. */
  age: number;
  /** Facing, for a claymore's arc and for drawing an oriented mesh. */
  yaw: number;
  /** Seconds until the next proximity poll. */
  pollTimer: number;
  /** True once it has stopped moving. Still fused. */
  resting: boolean;
  /** Entity it is stuck to, or -1 for geometry. */
  stuckTo: number;
  /** Material index of the last surface hit, for the bounce sound. */
  material: number;

  /**
   * This is somebody else's grenade, replicated (M11 Gate B, §8.24).
   *
   * A **display-only** projectile. The server owns its flight, its fuse and its blast, so
   * `EquipmentSystem.simulate` steps none of those — integrating it here as well would be the
   * client re-deriving a trajectory that has already been decided, and the two would part
   * company the first time one of them bounced off a corner the other missed.
   *
   * False for everything the local process threw, which on a server is everything and on a
   * client is the local player's own predicted throw. See `MatchEquipment.applyReplicated`.
   */
  replicated: boolean;
  /** Where replication last said it was. The drawn position eases toward this. */
  tx: number;
  ty: number;
  tz: number;
}

/** What one integration tick did, so the caller can turn it into sound and light. */
export interface StepResult {
  bounced: boolean;
  stuck: boolean;
  planted: boolean;
  impactSpeed: number;
}

/** Where a thrown object leaves the hand, and how fast. See `LAUNCH`. */
export interface Launch {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const RESULT: StepResult = { bounced: false, stuck: false, planted: false, impactSpeed: 0 };

/** A bounce quieter than this is a roll, and rolling should not click. */
const MIN_BOUNCE_SPEED = 1.2;

/**
 * The launch `solveLaunch` last worked out. Read it immediately; the next call overwrites it.
 *
 * One reused record rather than a returned object, for the reason `RESULT` above is one: both
 * throw paths run inside a sim tick and must not allocate. The two callers consume it
 * synchronously, in the same statement that asked for it.
 */
export const LAUNCH: Launch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

/** The averaged contact normal `averageContactNormal` wrote, unit length. */
let normalX = 0;
let normalY = 0;
let normalZ = 0;

/** The velocity `reflectOffSurface` wrote. */
let bounceVx = 0;
let bounceVy = 0;
let bounceVz = 0;
//#endregion

// ==================================== CLASS ProjectilePool ==================================== \\
//#region Class ProjectilePool
export class ProjectilePool {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly items: Projectile[] = [];
  private nextSerial = 1;
  private readonly move: MoveOutput = makeMoveOutput();
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(capacity: number, seedDef: EquipmentDef) {
    for (let i = 0; i < capacity; i++) this.items.push(makeProjectile(seedDef));
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get liveCount(): number {
    let n = 0;
    for (const p of this.items) if (p.active) n++;
    return n;
  }

  /**
   * Claim a slot, or null when the pool is exhausted.
   *
   * Returning null rather than growing is the same decision M3 made about audio voices:
   * a bounded pool that occasionally refuses is a frame budget you can reason about, and
   * an unbounded one is a leak nobody notices until a soak run.
   */
  spawn(
    def: EquipmentDef,
    ownerId: number,
    team: BotTeam | 'NONE',
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    fuse: number,
  ): Projectile | null {
    for (const p of this.items) {
      if (p.active) continue;
      p.active = true;
      p.serial = this.nextSerial++;
      p.def = def;
      p.ownerId = ownerId;
      p.team = team;
      p.phase = 'LIVE';
      p.x = x;
      p.y = y;
      p.z = z;
      p.px = x;
      p.py = y;
      p.pz = z;
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      p.fuse = fuse;
      p.age = 0;
      p.yaw = Math.atan2(-vx, -vz);
      p.pollTimer = 0;
      p.resting = false;
      p.stuckTo = -1;
      p.material = 0;
      // A pooled slot must never come back wearing the last tenant's replication state.
      p.replicated = false;
      p.tx = p.x;
      p.ty = p.y;
      p.tz = p.z;
      return p;
    }
    return null;
  }

  release(p: Projectile): void {
    p.active = false;
    p.phase = 'LIVE';
    p.stuckTo = -1;
  }

  releaseAll(): void {
    for (const p of this.items) p.active = false;
  }

  /**
   * One tick of flight for one projectile.
   *
   * Returns a reused record; copy anything you keep. The fuse is *not* advanced here —
   * `EquipmentSystem` owns that, because a cooked grenade's fuse started before it was
   * thrown and the two clocks must not be in two places.
   */
  step(p: Projectile, world: CollisionWorld, cfg: EquipmentConfig): StepResult {
    RESULT.bounced = false;
    RESULT.stuck = false;
    RESULT.planted = false;
    RESULT.impactSpeed = 0;

    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.age += DT;

    if (p.phase !== 'LIVE' || p.resting) return RESULT;

    const speedIn = this.integrate(p, cfg, world);
    if (this.move.contactCount === 0) return RESULT;
    // A contact whose normals cancel out is no surface to reflect about.
    if (!averageContactNormal(this.move)) return RESULT;

    if (this.move.groundIndex >= 0) p.material = world.colliders.materialAt(this.move.groundIndex);
    RESULT.impactSpeed = speedIn;

    if (settleOnImpact(p)) return RESULT;
    bounceOffSurface(p, speedIn);
    return RESULT;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * Gravity, drag and one swept move, written into the projectile. Returns the speed it was
   * travelling at when it arrived, which is what a bounce sound is scaled by.
   *
   * Drag is a fraction of speed per second, which is enough to stop a hard throw carrying half
   * the map without needing a real drag model.
   */
  private integrate(p: Projectile, cfg: EquipmentConfig, world: CollisionWorld): number {
    const r = p.def.radius;

    p.vy -= cfg.gravity * DT;
    const decay = Math.max(0, 1 - cfg.drag * DT);
    p.vx *= decay;
    p.vy *= decay;
    p.vz *= decay;

    const speedIn = Math.hypot(p.vx, p.vy, p.vz);

    // The sphere is a capsule of height 2r; `moveCapsule` takes feet, so subtract r.
    world.moveCapsule(p.x, p.y - r, p.z, p.vx * DT, p.vy * DT, p.vz * DT, r, r * 2, this.move);
    p.x = this.move.x;
    p.y = this.move.y + r;
    p.z = this.move.z;

    return speedIn;
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Where a thrown object leaves the hand and how fast, into `LAUNCH`.
 *
 * The one launch solution, shared by `EquipmentSystem.throwFrom` and by `BotThrower`'s safety
 * check. It was written out in both, identically, and that is the one piece of the throw a
 * preview could silently disagree with: `previewTrajectory` already guarantees the *arc* is the
 * same, so a release offset edited on one side alone would have the bot aiming its real grenade
 * from a point its test grenade never left.
 *
 * `underhand` drops it at the thrower's feet rather than lobbing it, which is what a bot must
 * never do into its own cover and what a player wants when smoking a doorway they stand in.
 */
export function solveLaunch(
  def: EquipmentDef,
  cfg: EquipmentConfig,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  yaw: number,
  pitch: number,
  underhand: boolean,
): void {
  const loft = pitch + def.throwLoftDeg * DEG2RAD;
  const cp = simCos(loft);
  const sp = simSin(loft);
  const sy = simSin(yaw);
  const cy = simCos(yaw);
  const dx = -sy * cp;
  const dy = sp;
  const dz = -cy * cp;

  const speed = def.throwSpeed * (underhand ? def.dropScale : 1);
  LAUNCH.x = eyeX + dx * cfg.throwOffsetForward;
  LAUNCH.y = eyeY + cfg.throwOffsetUp + dy * cfg.throwOffsetForward;
  LAUNCH.z = eyeZ + dz * cfg.throwOffsetForward;
  LAUNCH.vx = dx * speed;
  LAUNCH.vy = dy * speed;
  LAUNCH.vz = dz * speed;
}

/**
 * Where a throw would land, as a polyline (S7's trajectory preview).
 *
 * Runs the *same* integration as `step` against the same collision world, so the preview
 * cannot disagree with the throw — a preview computed with its own closed-form parabola
 * would be a picture of a grenade this game does not have.
 *
 * Writes `x,y,z` triples into `out` and returns how many points it produced.
 */
export function previewTrajectory(
  def: EquipmentDef,
  cfg: EquipmentConfig,
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  maxSeconds: number,
  out: Float32Array,
  /** Caller-owned scratch. The bot safety check runs this inside a sim tick. */
  move: MoveOutput,
): number {
  const r = def.radius;
  let cx = x;
  let cy = y;
  let cz = z;
  let dvx = vx;
  let dvy = vy;
  let dvz = vz;
  let w = 0;
  const steps = Math.min(Math.round(maxSeconds / DT), Math.floor(out.length / 3));

  for (let i = 0; i < steps; i++) {
    dvy -= cfg.gravity * DT;
    const decay = Math.max(0, 1 - cfg.drag * DT);
    dvx *= decay;
    dvy *= decay;
    dvz *= decay;

    world.moveCapsule(cx, cy - r, cz, dvx * DT, dvy * DT, dvz * DT, r, r * 2, move);
    cx = move.x;
    cy = move.y + r;
    cz = move.z;

    out[w++] = cx;
    out[w++] = cy;
    out[w++] = cz;

    if (move.contactCount === 0) continue;
    if (!averageContactNormal(move)) continue;
    if (def.impact !== 'bounce') break;

    reflectOffSurface(dvx, dvy, dvz, normalX, normalY, normalZ, def.restitution, def.friction);
    dvx = bounceVx;
    dvy = bounceVy;
    dvz = bounceVz;
    if (Math.hypot(dvx, dvy, dvz) < def.restSpeed && normalY > 0.55) break;
  }
  return w / 3;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function makeProjectile(def: EquipmentDef): Projectile {
  return {
    active: false,
    serial: 0,
    def,
    ownerId: -1,
    team: 'NONE',
    phase: 'LIVE',
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    px: 0,
    py: 0,
    pz: 0,
    fuse: 0,
    age: 0,
    yaw: 0,
    pollTimer: 0,
    resting: false,
    stuckTo: -1,
    material: 0,
    replicated: false,
    tx: 0,
    ty: 0,
    tz: 0,
  };
}

/**
 * The mean of this move's contact normals, into `normalX/Y/Z`. False when they cancel out.
 *
 * A grenade in a concave corner has two or three, and reflecting about any single one of them
 * sends it back into the other. Written out in full in both `step` and `previewTrajectory`,
 * which is fourteen lines each of the same loop; module-level state and a module-level function
 * allocate nothing, which is the reason the two copies gave for being copies.
 */
function averageContactNormal(move: MoveOutput): boolean {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < move.contactCount; i++) {
    nx += move.normals[i * 3] ?? 0;
    ny += move.normals[i * 3 + 1] ?? 0;
    nz += move.normals[i * 3 + 2] ?? 0;
  }
  const nlen = Math.hypot(nx, ny, nz);
  if (nlen < 1e-6) return false;
  normalX = nx / nlen;
  normalY = ny / nlen;
  normalZ = nz / nlen;
  return true;
}

/**
 * Reflect a velocity about a surface, into `bounceVx/Vy/Vz`.
 *
 * The component along the normal loses `restitution`, the component across it loses `friction`.
 * That single split is the whole difference between a grenade that rolls round a corner and one
 * that sticks where it lands.
 */
function reflectOffSurface(
  vx: number,
  vy: number,
  vz: number,
  nx: number,
  ny: number,
  nz: number,
  restitution: number,
  friction: number,
): void {
  const vn = vx * nx + vy * ny + vz * nz;
  const tx = vx - vn * nx;
  const ty = vy - vn * ny;
  const tz = vz - vn * nz;
  const bounce = -vn * restitution;
  bounceVx = tx * friction + nx * bounce;
  bounceVy = ty * friction + ny * bounce;
  bounceVz = tz * friction + nz * bounce;
}

/**
 * The two impacts that end a flight: a semtex sticking and a claymore planting. True once the
 * object has settled, false when it should carry on and bounce.
 */
function settleOnImpact(p: Projectile): boolean {
  switch (p.def.impact) {
    case 'stick':
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.phase = 'STUCK';
      p.resting = true;
      // Face out of the surface it landed on, so the charge reads as attached.
      p.yaw = Math.atan2(-normalX, -normalZ);
      RESULT.stuck = true;
      return true;

    case 'plant':
      // A claymore only plants on something walkable; off a wall it drops and keeps
      // going, which is what stops one being stuck to a ceiling above a doorway.
      if (normalY < 0.6) return false;
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.phase = 'ARMING';
      p.resting = true;
      p.fuse = p.def.armSeconds;
      RESULT.planted = true;
      return true;

    case 'bounce':
      return false;
  }
}

/** Reflect off the contact and come to rest if that left it slow enough on level ground. */
function bounceOffSurface(p: Projectile, speedIn: number): void {
  reflectOffSurface(p.vx, p.vy, p.vz, normalX, normalY, normalZ, p.def.restitution, p.def.friction);
  p.vx = bounceVx;
  p.vy = bounceVy;
  p.vz = bounceVz;

  RESULT.bounced = speedIn > MIN_BOUNCE_SPEED;

  const speedOut = Math.hypot(p.vx, p.vy, p.vz);
  if (speedOut < p.def.restSpeed && normalY > 0.55) {
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.resting = true;
  }
}
//#endregion
