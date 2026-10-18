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
 * ## Two kinds of body, and why
 *
 * A round stops in the nearest *body*, and whether that body can be hurt is a separate
 * question asked afterwards. `DamageSystem.list` holds the ones this runtime resolves hits on;
 * `blockers` holds the ones it must not — a networked client's remote players, whose hits the
 * server owns (S4.13). The split exists because the two facts came as one and only one of them
 * was ever the client's: *where the round stops* is presentation, drawn as a tracer and an
 * impact on this machine, while *what the round cost* is replicated. See `blockers`.
 *
 * Allocation free: every record here is owned by the instance and reused.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { DamageRequest, DamageSystem, Damageable } from '../combat/DamageSystem';
import { isHostile } from '../combat/Hostility';
import { makeRigHit, type HitboxRig, type HitZone, type RigHit } from '../combat/HitboxRig';
import { EV, type GameBus } from '../core/Events';
import type { CollisionWorld } from '../world/CollisionWorld';
import { makeRayHit, rayBoxExit, type RayHit } from '../world/Geometry';
import { surfaceAtIndex } from '../world/maps/materials';
import { materialIndex } from '../world/maps/types';
import type { WeaponDef } from './WeaponDefs';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * A body that stops a round without anybody deciding it was hit (2026-10-18).
 *
 * The networked client's own shot, and nothing else so far. Its remote players are drawn from
 * snapshots and carry a `HitboxRig` kept in step with the drawn pose, but they are **not**
 * `Damageable` — a client that registered them would be a client resolving hits on them, and
 * the server owns hit registration (S4.13). Without them in any list at all the predicted
 * round went straight through the enemy it had just hit: the tracer carried on past them, and
 * the spark, the hole and the surface click landed on whatever was behind.
 *
 * So this is the half of a target the client is entitled to: the rig and the side, and no
 * health. **That is the authority property, and it is structural rather than remembered** —
 * there is no health here to take, so no path through `Ballistics` can reach `DamageSystem`
 * with one of these, and `hitTarget` stays false for a round that stopped in one. What a body
 * hit should present already arrives from the server's `damage.dealt`: the flesh impact, the
 * hitmarker, the debris and the number.
 */
export interface RoundBlocker {
  readonly entityId: number;
  /** Which side this body is on. Read for the same reason `Damageable.team` is. */
  readonly team?: Damageable['team'];
  readonly rig: HitboxRig;
  /**
   * False while this body must not stop a round.
   *
   * The two cases are a dead one and a body the server is not placing for this viewer
   * (`EFlag.Dormant`, protocol 28). The first is the rule `nearestTarget` applies to a
   * `Damageable` — *"if (!entity.health.alive) continue"* — and the client has to apply the
   * same one or it would stop a round the server passes through a corpse; the second is a body
   * frozen where it was last seen, which is not drawn and must not be measured from.
   */
  readonly stopsRounds: boolean;
}

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

  /**
   * The round stopped in a body this runtime may not resolve a hit on. See `RoundBlocker`.
   *
   * Deliberately *not* `hitTarget`. That bit means "this runtime decided a hit", and it is read
   * as one: `WeaponSystem` counts it into `pelletsHit`, which is the accuracy figure the
   * scoreboard is built from, and the shotgun's hit count on the wire. A predicted stop is
   * neither — the hit it suggests may not have happened, and the one that did is replicated —
   * so this is the bit, and `hitTarget`, `targetId`, `damage` and `lethal` all stay as they
   * are for a round that found nobody to hurt.
   */
  hitBlocker: boolean;

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

/** Nobody, for every runtime that resolves its own hits. See `Ballistics.blockers`. */
const NO_BLOCKERS: readonly RoundBlocker[] = [];
//#endregion

// ====================================== CLASS Ballistics ====================================== \\
//#region Class Ballistics
export class Ballistics {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Diagnostics: rig tests performed by the last shot. */
  lastRigTests = 0;

  /**
   * Bodies that stop a round without taking damage, asked once per pass (2026-10-18).
   *
   * **Asked, never told**, and the same shape `DamageSystem.shieldOf` argues for: the set
   * changes as players join, die, respawn and go dormant, several times a second, and a list
   * this object was *pushed* would eventually be holding a body that had left. The client
   * already rebuilds a flat array of its remote actors per frame for the renderer; this reads
   * that array rather than keeping a second copy of it.
   *
   * Default: nobody. A runtime that resolves its own hits — the server, both killstreaks,
   * single-player — never sets it and behaves exactly as it did before blockers existed. One
   * instance in the game sets it, the player's own `WeaponSystem` on a networked client, which
   * is the one trace whose terminus a player watches and whose hits are somebody else's to
   * decide. See `RoundBlocker`.
   */
  blockers: () => readonly RoundBlocker[] = () => NO_BLOCKERS;

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
    /**
     * The blocker scan is bounded by whatever the target scan found, so a blocker wins only by
     * being **strictly nearer** — which is what lets the two share one `bestRig` and keeps the
     * record holding the hit that actually stopped the round.
     */
    const blocked = this.nearestBlocker(
      targetId >= 0 ? this.bestRig.t : remaining,
      request.sourceId,
    );
    const foundBody = blocked || targetId >= 0;
    const targetT = foundBody ? this.bestRig.t : Infinity;
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
    if (foundBody && targetT <= worldT) {
      this.writeEnd(out, targetT, this.travelled + targetT);
      /**
       * A blocker is the end of the round and nothing else: no damage request, no door, no
       * `bullet.impact`.
       *
       * The silence is the fix, not a side effect of it. A person leaves no hole — see
       * `Damageable.decals` — so a round that stops in one has never emitted an impact, and
       * everything the player should see and hear comes from the replicated `damage.dealt`
       * instead. The bug was the wall *behind* the enemy getting the spark, the hole and the
       * click that the enemy's own hit was about to be announced with.
       *
       * No penetration either, for the same reason the damageable branch below has none: a
       * body is a full stop on both sides of the wire, so there is no cost to cross and no
       * second pass to spend it on.
       */
      if (blocked) {
        out.hitBlocker = true;
        return false;
      }
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
    // The shooter's side is resolved once per pass, not once per candidate; a shooter on no
    // side (a sentry is on one, a range dummy never fires) skips nobody.
    const shooterTeam = this.damage.get(excludeId)?.team;
    let bestT = maxT;
    let bestId = -1;
    for (let i = 0; i < list.length; i++) {
      const entity = list[i];
      if (entity === undefined) continue;
      if (entity.entityId === excludeId) continue;
      if (!entity.health.alive) continue;
      if (this.passesThrough(shooterTeam, entity.team)) continue;
      this.lastRigTests++;
      if (!entity.rig.raycast(this.px, this.py, this.pz, this.dirX, this.dirY, this.dirZ, bestT, this.rigHit)) {
        continue;
      }
      if (this.rigHit.t >= bestT) continue;
      bestT = this.rigHit.t;
      bestId = entity.entityId;
      adoptRigHit(this.bestRig, this.rigHit);
    }
    return bestId;
  }

  /**
   * Nearest blocker along the ray within `maxT`, as `nearestTarget` is for a damageable one and
   * leaving its hit in the same `this.bestRig`. Returns whether one was found, which — because
   * `maxT` is the nearer of the damageable body and the remaining range — means "a blocker
   * stopped this round".
   *
   * Every rule the scan above applies is applied here, and that is the requirement rather than
   * tidiness: the client stops its round where the server stops it or the two disagree about
   * what the player just watched. The shooter's own body, a corpse, a dormant one and a
   * teammate are all passed through on both sides of the wire.
   *
   * Nothing to do when nobody set the list, which is every runtime but one — and the early
   * return is what keeps the cost of this at one call per pass for all of them.
   */
  private nearestBlocker(maxT: number, excludeId: number): boolean {
    const list = this.blockers();
    if (list.length === 0) return false;
    const shooterTeam = this.damage.get(excludeId)?.team;
    let bestT = maxT;
    let found = false;
    for (let i = 0; i < list.length; i++) {
      const body = list[i];
      if (body === undefined) continue;
      if (body.entityId === excludeId) continue;
      if (!body.stopsRounds) continue;
      if (this.passesThrough(shooterTeam, body.team)) continue;
      this.lastRigTests++;
      if (!body.rig.raycast(this.px, this.py, this.pz, this.dirX, this.dirY, this.dirZ, bestT, this.rigHit)) {
        continue;
      }
      if (this.rigHit.t >= bestT) continue;
      bestT = this.rigHit.t;
      found = true;
      adoptRigHit(this.bestRig, this.rigHit);
    }
    return found;
  }

  /**
   * Whether a round from `shooterTeam` goes *through* a body on `subjectTeam` rather than
   * stopping in it.
   *
   * A round passes through a teammate rather than stopping harmlessly in one, so the filter
   * belongs in body selection and not only in `DamageSystem.apply` — a free body block is a
   * worse bug than a wasted round. One method for both scans because it is one rule: the day
   * FFA or the hostility table changes, a client that kept its own copy of this would stop
   * rounds the server lets past.
   */
  private passesThrough(shooterTeam: Damageable['team'], subjectTeam: Damageable['team']): boolean {
    return (
      shooterTeam !== undefined &&
      subjectTeam !== undefined &&
      !isHostile(shooterTeam, subjectTeam, this.damage.freeForAll)
    );
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
    hitBlocker: false,
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
  out.hitBlocker = false;
  out.surfacesPenetrated = 0;
  out.penetrationRetain = 1;
  out.penetrationCost = 0;
}

/** The winning hit, into the record the pass reports from. Two scans, one record. */
function adoptRigHit(best: RigHit, hit: RigHit): void {
  best.t = hit.t;
  best.zone = hit.zone;
  best.boxIndex = hit.boxIndex;
  best.upper = hit.upper;
  best.nx = hit.nx;
  best.ny = hit.ny;
  best.nz = hit.nz;
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
