/**
 * Hitscan ballistics (brief S4.4).
 *
 * All weapons are hitscan. At 800 m/s across a 50 m lane a simulated round takes 60 ms
 * to arrive, and players read that as "my shots aren't registering" — so the round lands
 * on the tick it is fired and the tracer is a visual that catches up afterwards.
 *
 * The trace walks the same 4 m spatial hash the collision broadphase uses (S4.3), never
 * `THREE.Raycaster`, and interleaves world geometry with damageable rigs so a round that
 * punches through a thin wall goes on to hit whatever is standing behind it.
 *
 * Allocation free: every record here is owned by the instance and reused.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { DamageRequest, DamageSystem } from '../combat/DamageSystem';
import { isHostile } from '../combat/Hostility';
import { makeRigHit, type HitZone, type RigHit } from '../combat/HitboxRig';
import { EV, type GameBus } from '../core/Events';
import type { CollisionWorld } from '../world/CollisionWorld';
import { makeRayHit, rayBoxExit, type RayHit } from '../world/Geometry';
import { surfaceAtIndex } from '../world/maps/materials';
import { materialIndex } from '../world/maps/types';
import type { WeaponDef } from './WeaponDefs';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface ShotTrace {
  /** Total path length from muzzle to termination, metres. */
  distance: number;
  endX: number;
  endY: number;
  endZ: number;

  hitWorld: boolean;
  /** Surface normal at the terminating world impact. */
  nx: number;
  ny: number;
  nz: number;
  /** Material index of the terminating world impact. */
  material: number;

  hitTarget: boolean;
  targetId: number;
  zone: HitZone;
  /** The torso hit was on the chest rather than the abdomen. */
  upperTorso: boolean;
  damage: number;
  lethal: boolean;

  surfacesPenetrated: number;
  /** Surviving damage fraction after penetration, 0..1. */
  penetrationRetain: number;
  /** Accumulated penetration cost, metres of concrete equivalent. */
  penetrationCost: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Range beyond which a round is simply gone. Larger than any M4 map lane. */
const MAX_RANGE = 300;
/** Surfaces a single round may attempt to punch through before it is spent. */
const MAX_PENETRATIONS = 4;
/** Nudge past an exit face so the next cast does not re-hit the surface it just left. */
const EXIT_EPSILON = 1e-3;

const evImpact = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, material: 0, penetrated: false };

/**
 * The surface a range dummy is made of, for the decal and the impact click (post-M8).
 *
 * Resolved through `materialIndex` rather than written as a literal so it survives anybody
 * reordering `MATERIAL_KEYS` — the index is a wire value between the map format and the
 * material table, and hard-coding one here would be the one place that does not move with it.
 */
const DUMMY_IMPACT_MATERIAL = materialIndex('metal');
//#endregion

// ====================================== CLASS Ballistics ====================================== \\
//#region Class Ballistics
export class Ballistics {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Diagnostics: rig tests performed by the last shot. */
  lastRigTests = 0;

  private readonly rayHit: RayHit = makeRayHit();
  private readonly rigHit: RigHit = makeRigHit();
  private readonly bestRig: RigHit = makeRigHit();

  /**
   * The round in flight, in the same spirit as the hit records above: per-instance scratch,
   * written by `fire` and read by the passes it runs, so splitting the trace into its phases
   * costs no allocation and no eleven-parameter signatures.
   *
   * `muzzle*` is where the shot was fired from and never moves. `p*` is where the current pass
   * starts, which advances past each surface the round crosses — and the distinction is the
   * point: the damage request carries the *muzzle*, because a round that came through a wall
   * still came from where it was fired, and that is the side of the target it arrived on.
   */
  private muzzleX = 0;
  private muzzleY = 0;
  private muzzleZ = 0;
  private dirX = 0;
  private dirY = 0;
  private dirZ = -1;
  private px = 0;
  private py = 0;
  private pz = 0;
  /** Path length already behind the round, metres, and the penetration budget spent so far. */
  private travelled = 0;
  private cost = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(
    private readonly world: CollisionWorld,
    private readonly damage: DamageSystem,
    private readonly bus: GameBus,
  ) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Trace one round. `dx,dy,dz` must be normalised. `request` is the caller's reusable
   * damage record; its `weapon` field selects the ballistics.
   */
  fire(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    def: WeaponDef,
    request: DamageRequest,
    out: ShotTrace,
  ): void {
    resetTrace(out, ox + dx * MAX_RANGE, oy + dy * MAX_RANGE, oz + dz * MAX_RANGE);
    this.lastRigTests = 0;

    this.muzzleX = ox;
    this.muzzleY = oy;
    this.muzzleZ = oz;
    this.dirX = dx;
    this.dirY = dy;
    this.dirZ = dz;
    this.px = ox;
    this.py = oy;
    this.pz = oz;
    this.travelled = 0;
    this.cost = 0;

    for (let pass = 0; pass <= MAX_PENETRATIONS; pass++) {
      if (!this.tracePass(pass, def, request, out)) return;
    }
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * One pass of the round: from where it is now to whatever stops it next. Returns true when
   * the round crossed a surface and should carry on, false when the trace is finished.
   */
  private tracePass(
    pass: number,
    def: WeaponDef,
    request: DamageRequest,
    out: ShotTrace,
  ): boolean {
    const remaining = MAX_RANGE - this.travelled;
    if (remaining <= EXIT_EPSILON) return false;

    const targetId = this.nearestTarget(remaining, request.sourceId);
    const targetT = targetId >= 0 ? this.bestRig.t : Infinity;
    const worldFound = this.world.raycast(
      this.px,
      this.py,
      this.pz,
      this.dirX,
      this.dirY,
      this.dirZ,
      remaining,
      this.rayHit,
    );
    const worldT = worldFound ? this.rayHit.t : Infinity;

    // ---- a body stops the round -----------------------------------------
    if (targetId >= 0 && targetT <= worldT) {
      this.writeEnd(out, targetT, this.travelled + targetT);
      this.landOnTarget(out, request, targetId);
      return false;
    }

    // ---- nothing left to hit ---------------------------------------------
    if (!worldFound) {
      this.writeEnd(out, remaining, MAX_RANGE);
      return false;
    }

    // ---- world geometry ---------------------------------------------------
    const hitT = this.rayHit.t;
    this.writeEnd(out, hitT, this.travelled + hitT);
    return this.crossSurface(out, def.penetration, pass);
  }

  /**
   * Nearest damageable rig along the ray, or -1. The winning hit is left in
   * `this.bestRig`. Linear over the registered list, which is the right structure while
   * a match holds tens of actors rather than thousands; the static hash is built once at
   * load and must not have moving actors bolted into it (see PLAN.md).
   */
  private nearestTarget(maxT: number, excludeId: number): number {
    const list = this.damage.list;
    // A round passes *through* a teammate rather than stopping harmlessly in one, so the
    // filter belongs in target selection and not only in `DamageSystem.apply`. The shooter's
    // side is resolved once per pass, not once per candidate; a shooter on no side (a sentry
    // is on one, a range dummy never fires) skips nobody.
    const shooterTeam = this.damage.get(excludeId)?.team;
    const freeForAll = this.damage.freeForAll;
    let bestT = maxT;
    let bestId = -1;
    for (let i = 0; i < list.length; i++) {
      const entity = list[i];
      if (entity === undefined) continue;
      if (entity.entityId === excludeId) continue;
      if (!entity.health.alive) continue;
      if (
        shooterTeam !== undefined &&
        entity.team !== undefined &&
        !isHostile(shooterTeam, entity.team, freeForAll)
      ) {
        continue;
      }
      this.lastRigTests++;
      if (!entity.rig.raycast(this.px, this.py, this.pz, this.dirX, this.dirY, this.dirZ, bestT, this.rigHit)) {
        continue;
      }
      if (this.rigHit.t >= bestT) continue;
      bestT = this.rigHit.t;
      bestId = entity.entityId;
      this.bestRig.t = this.rigHit.t;
      this.bestRig.zone = this.rigHit.zone;
      this.bestRig.boxIndex = this.rigHit.boxIndex;
      this.bestRig.upper = this.rigHit.upper;
      this.bestRig.nx = this.rigHit.nx;
      this.bestRig.ny = this.rigHit.ny;
      this.bestRig.nz = this.rigHit.nz;
    }
    return bestId;
  }

  /** Where this pass ended: `t` along the current ray, `distance` from the muzzle. */
  private writeEnd(out: ShotTrace, t: number, distance: number): void {
    out.distance = distance;
    out.endX = this.px + this.dirX * t;
    out.endY = this.py + this.dirY * t;
    out.endZ = this.pz + this.dirZ * t;
  }

  /** The round stopped in a body. Hand the hit to the damage door and report what it did. */
  private landOnTarget(out: ShotTrace, request: DamageRequest, targetId: number): void {
    out.hitTarget = true;
    out.targetId = targetId;
    out.zone = this.bestRig.zone;
    out.upperTorso = this.bestRig.upper;
    out.nx = this.bestRig.nx;
    out.ny = this.bestRig.ny;
    out.nz = this.bestRig.nz;

    request.targetId = targetId;
    request.zone = this.bestRig.zone;
    request.upperTorso = this.bestRig.upper;
    request.distance = out.distance;
    request.penetrationRetain = out.penetrationRetain;
    request.x = out.endX;
    request.y = out.endY;
    request.z = out.endZ;
    // The muzzle, not the last penetration point: a round that came through a wall still
    // came from where it was fired, and that is the side of the target it arrived on.
    request.originX = this.muzzleX;
    request.originY = this.muzzleY;
    request.originZ = this.muzzleZ;
    out.damage = this.damage.apply(request);
    const target = this.damage.get(targetId);
    out.lethal = target !== undefined && !target.health.alive;
    /**
     * A hole in a target board (post-M8). Only for rigs that ask for it — see
     * `Damageable.decals`, and `TargetDummy.decals` for why people do not.
     *
     * Emitted as an ordinary `bullet.impact` rather than through a new channel, so the
     * decal, the debris and the impact click all come from the code that already handles
     * every other surface in the game. `metal` is the surface: the range's boards are
     * steel plate, and it is the material the audio and the spark colour should match.
     */
    if (target?.decals === true) emitImpact(this.bus, out, DUMMY_IMPACT_MATERIAL, false);
  }

  /**
   * The round reached a surface. Record it, announce the impact, and spend the penetration
   * budget crossing it — returning true only when there was enough budget to carry on, in
   * which case the round is advanced past the exit face.
   */
  private crossSurface(out: ShotTrace, budget: number, pass: number): boolean {
    const hitT = this.rayHit.t;
    const colliderIndex = this.rayHit.index;
    out.hitWorld = true;
    out.nx = this.rayHit.nx;
    out.ny = this.rayHit.ny;
    out.nz = this.rayHit.nz;
    const material = this.world.colliders.materialAt(colliderIndex);
    out.material = material;

    // How much material is actually in the way, and what it costs to cross.
    const exitT = rayBoxExit(
      this.world.colliders,
      colliderIndex,
      this.px,
      this.py,
      this.pz,
      this.dirX,
      this.dirY,
      this.dirZ,
    );
    const thickness = exitT > hitT ? exitT - hitT : 0;
    const surface = surfaceAtIndex(material);
    const stepCost = thickness * surface.penetrationDensity;

    const canPass = pass < MAX_PENETRATIONS && budget > 0 && this.cost + stepCost < budget;
    emitImpact(this.bus, out, material, canPass);

    if (!canPass) {
      out.penetrationCost = this.cost + stepCost;
      return false;
    }

    this.cost += stepCost;
    out.surfacesPenetrated++;
    out.penetrationCost = this.cost;
    out.penetrationRetain = 1 - this.cost / budget;

    const advance = exitT + EXIT_EPSILON;
    this.travelled += advance;
    this.px += this.dirX * advance;
    this.py += this.dirY * advance;
    this.pz += this.dirZ * advance;
    return true;
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function makeShotTrace(): ShotTrace {
  return {
    distance: 0,
    endX: 0,
    endY: 0,
    endZ: 0,
    hitWorld: false,
    nx: 0,
    ny: 1,
    nz: 0,
    material: 0,
    hitTarget: false,
    targetId: -1,
    zone: 'torso',
    upperTorso: false,
    damage: 0,
    lethal: false,
    surfacesPenetrated: 0,
    penetrationRetain: 1,
    penetrationCost: 0,
  };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * A round that has not hit anything yet, aimed at the far end of its range.
 *
 * Every field, every shot: a trace is a reused record, and a field left over from the last
 * round is a hit report about a round that did not happen.
 */
function resetTrace(out: ShotTrace, endX: number, endY: number, endZ: number): void {
  out.distance = 0;
  out.endX = endX;
  out.endY = endY;
  out.endZ = endZ;
  out.hitWorld = false;
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  out.material = 0;
  out.hitTarget = false;
  out.targetId = -1;
  out.zone = 'torso';
  out.upperTorso = false;
  out.damage = 0;
  out.lethal = false;
  out.surfacesPenetrated = 0;
  out.penetrationRetain = 1;
  out.penetrationCost = 0;
}

/**
 * One `bullet.impact`, from the point and normal the trace is already holding.
 *
 * The same record serves a wall and a target board, which is what keeps the decal, the debris
 * and the click coming from one place for every surface in the game.
 */
function emitImpact(bus: GameBus, out: ShotTrace, material: number, penetrated: boolean): void {
  evImpact.x = out.endX;
  evImpact.y = out.endY;
  evImpact.z = out.endZ;
  evImpact.nx = out.nx;
  evImpact.ny = out.ny;
  evImpact.nz = out.nz;
  evImpact.material = material;
  evImpact.penetrated = penetrated;
  bus.emit(EV.BulletImpact, evImpact);
}
//#endregion
