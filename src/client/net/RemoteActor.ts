// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { BotTeam, StanceId } from '../../shared/core/Vocabulary';
import {
  makeBotVisualState,
  type ActorAnimationInput,
  type BotVisualState,
  type RenderableActor,
} from '../../shared/ai/BotVisualState';
import { DEATH_VARIANTS, deathVariantFor } from '../../shared/ai/BotVisualState';
import { HitboxRig, HUMANOID_RIG, rigLayoutFor } from '../../shared/combat/HitboxRig';
import { angleDelta } from '../../shared/core/MathUtil';
import {
  makeInterpolatedPose,
  type EntityInterpolator,
  type InterpolatedPose,
} from '../../shared/net/Interpolation';
import { EFlag, equipmentIdAt, THROW_PHASES, weaponIdAt, type EntitySnapshot } from '../../shared/net/Snapshot';
import type { EquipmentId } from '../../shared/equipment/EquipmentDefs';
import type { ThrowPhase } from '../../shared/equipment/ThrowController';
import { skinIdAt, type SkinId } from '../../shared/meta/Skins';
import type { RoundBlocker } from '../../shared/weapons/Ballistics';
import { WEAPON_DEFS } from '../../shared/weapons/WeaponDefs';
//#endregion

// ===================================== CLASS RemoteActor ====================================== \\
//#region Class RemoteActor
/**
 * Another player, drawn from snapshots (M10, S6.5).
 *
 * A `RenderableActor`, so `BotRenderer` draws it with the M3 bot mesh, the M3 stance
 * handling and the M3 fall animations — S6.5 forbids a second player model and this is how
 * that is satisfied: there is no second model, only a second *source of poses*.
 *
 * ## Interpolated, never predicted
 *
 * S4.12 splits the two code paths and this is the interpolated one. The pose comes out of an
 * `EntityInterpolator` at a render time ~100 ms in the past; nothing here extrapolates from
 * inputs, because a remote player's inputs are not knowable. The consequence — that everyone
 * else is drawn slightly in the past — is not a defect to be corrected: the server rewinds to
 * exactly this time when resolving shots (S4.13), so what the player aims at is what the
 * server tests against.
 *
 * ## The rig follows the drawn pose
 *
 * A `HitboxRig` is kept in step with what is on screen, and it is used for **nothing
 * authoritative** — the server owns hit registration. It exists so the client's own predicted
 * trace stops where the player can see a body (`RoundBlocker`, which this satisfies), and so
 * the rewind debug panel has something to draw a box around. The hitmarker is not its work: it
 * comes from the server's `damage.dealt` like every other thing a hit announces.
 */
export class RemoteActor implements RenderableActor, RoundBlocker {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly rig = new HitboxRig(HUMANOID_RIG);
  readonly visual: BotVisualState = makeBotVisualState();

  team: BotTeam = 'A';
  displayName = '';
  health = 100;
  weaponId: string | null = null;
  /** Protocol 24: the grenade in the hand, from the draw to the release. See `RenderableActor`. */
  heldEquipmentId: EquipmentId | null = null;
  /** Protocol 24: how far through the throw that hand is. See `ActorAnimationInput.throwPhase`. */
  throwPhase: ThrowPhase = 'IDLE';
  /** The body the server says this player wears (M16, B6); null until the first snapshot, and for one who declared none. */
  characterId: SkinId | null = null;
  flags = 0;

  /** True when this actor's pose is being extrapolated because the buffer starved (S4.12). */
  extrapolated = false;
  /** True when extrapolation hit its cap and the body is frozen. */
  frozen = false;

  private readonly pose: InterpolatedPose = makeInterpolatedPose();
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevYaw = 0;
  private prevScale = 1;
  private seeded = false;
  /** Reused presentation DTO; the renderer reads it synchronously once per frame. */
  private readonly animation_ = {
    stance: 'STAND' as StanceId,
    aiming: false,
    sprinting: false,
    reloading: false,
    reloadSeconds: 0,
    firing: false,
    throwing: false,
    throwPhase: 'IDLE' as ThrowPhase,
    meleeing: false,
  };

  /**
   * The spawn serial the *interpolator* has been snapped for.
   *
   * Separate from `visual.spawnSerial`, which `applyLatest` maintains for the renderer's
   * animation triggers, because the two are consumed at different points in the frame — this one
   * has to be acted on **before** the buffer is sampled and that one after. -1 so the first
   * sighting counts as a spawn.
   */
  private spawnSnapped = -1;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(
    readonly entityId: number,
    /**
     * Presentation reads the live Match config; the snapshot remains the authority for HP.
     *
     * Required, with no default. A `() => 100` fallback here would be a client-side copy of a
     * gameplay number — the thing the config rule forbids — and it would be the copy that
     * silently disagreed the day the config moved.
     */
    private readonly healthMax: () => number,
  ) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Pull this frame's pose out of the buffer.
   *
   * `renderMs` is server time minus the interpolation delay. Called once per rendered frame,
   * before the renderer reads any of the accessors below.
   */
  update(interp: EntityInterpolator, renderMs: number): void {
    this.snapOnRespawn(interp, renderMs);
    this.rememberPose();

    interp.sample(renderMs, this.pose);
    this.extrapolated = this.pose.extrapolated;
    this.frozen = this.pose.frozen;

    if (!this.seeded) {
      // First frame: collapse the blend so a new body does not fly in from wherever the
      // previous pose happened to be zero-initialised.
      this.rememberPose();
      this.seeded = true;
    }

    this.applyLatest(interp.latest);

    // The same layout rule as the server's (`rigLayoutFor`), from the replicated stance,
    // velocity and weapon: this rig is what the hitbox overlay draws, so it has to wear what the
    // authority wears. The weapon is `weaponIndex`, which has been on the wire since M10.
    this.rig.setLayout(rigLayoutFor(this.pose.stance, interp.latest.vx, interp.latest.vz, this.pistol));
    this.rig.setTransform(this.pose.x, this.pose.y, this.pose.z, this.pose.yaw);
  }

  get participating(): boolean {
    return (this.flags & EFlag.Alive) !== 0;
  }

  /**
   * The server is not telling this client where this body is (protocol 28, anti-wallhack phase 1).
   * Everything about its place is frozen where it was last seen; it is not drawn, not named and
   * not measured from. `participating` stays true to the body's life, which is public.
   */
  get dormant(): boolean {
    return (this.flags & EFlag.Dormant) !== 0;
  }

  /**
   * Whether this body stops the local player's predicted round. See `RoundBlocker.stopsRounds`.
   *
   * Alive and placed, which is the pair the two getters above already are: `participating` is
   * this body's life, which is public even while the body is not, and `dormant` is the server
   * declining to say where it is. A corpse is excluded to match the authority — a round goes
   * through one there, and `Fx.decalVeto` is what keeps the hole out of it — and a dormant body
   * is excluded because it is frozen where it was last seen and is not on screen to be hit.
   */
  get stopsRounds(): boolean {
    return this.participating && !this.dormant;
  }

  get healthFraction(): number {
    const max = this.healthMax();
    if (!Number.isFinite(max) || max <= 0) return 0;
    return Math.max(0, Math.min(1, this.health / max));
  }

  get isBot(): boolean {
    return (this.flags & EFlag.Bot) !== 0;
  }

  get firing(): boolean {
    return (this.flags & EFlag.Firing) !== 0;
  }

  /** S6.5: *"A remote player mid-reload must look mid-reload."* */
  get reloading(): boolean {
    return (this.flags & EFlag.Reloading) !== 0;
  }

  get ads(): boolean {
    return (this.flags & EFlag.Ads) !== 0;
  }

  get sprinting(): boolean {
    return (this.flags & EFlag.Sprinting) !== 0;
  }

  /** Protocol 20: the server's `NetPlayer.handBusy`, which `EFlag.Firing` used to lie about. */
  get throwing(): boolean {
    return (this.flags & EFlag.Throwing) !== 0;
  }

  /** Protocol 20: derived on the server from this body's own melee button (`EFlag.Melee`). */
  get meleeing(): boolean {
    return (this.flags & EFlag.Melee) !== 0;
  }

  /**
   * Protocol 22: this body is on fire, as the server's `BurnSystem` has it.
   *
   * Replicated rather than derived, and it is the one thing about a burn that is: the damage
   * is applied where health lives and a client watching from across the map never saw the jet
   * that lit them.
   */
  get burning(): boolean {
    return (this.flags & EFlag.Burning) !== 0;
  }

  /**
   * Whether this body is holding a sidearm — the one thing the weapon decides about a pose.
   *
   * Read by the hitbox layout here and, separately, by the avatar off `HeldWeaponAsset`. Two
   * readers of one replicated field rather than two facts: a dead body's `weaponIndex` is 255 and
   * resolves to null, so it is false, which is what the standing fall clips want.
   */
  get pistol(): boolean {
    return this.weaponId !== null && WEAPON_DEFS[this.weaponId]?.class === 'PISTOL';
  }

  get stance(): StanceId {
    return this.pose.stance;
  }

  /**
   * The same narrow animation contract a local `Bot` exposes, sourced from snapshots.
   *
   * **`AIRBORNE` is dropped on a frozen body** (BACKLOG #87). `frozen` means the buffer starved
   * past `MAX_EXTRAPOLATION_MS` and the interpolator stopped predicting: the pose it hands back
   * is the last one it was told, held still. Every other field survives that honestly — a body
   * that was crouching still *is* crouching as far as anyone knows — but `AIRBORNE` is not a
   * state, it is a moment, and the animation reads it as one. `jumpLaunch` clamps on its last
   * frame **on purpose**, so a body frozen mid-jump holds the air pose, knees up, for as long as
   * the silence lasts. On an external server that is seconds, and it is what #87 reported.
   *
   * Reproduced exactly: one snapshot carrying `AIRBORNE`, then nothing, and the body is still in
   * `jumpLaunch` ten seconds later with `frozen` true.
   *
   * `STAND` and not the stance before it, because nothing here remembers one, and not a guess at
   * a landing either: the point is only to stop asserting a transient the client can no longer
   * see the end of. `isLowStance` is false for both `AIRBORNE` and `STAND`, so the hitbox layout
   * this body wears does not move — `get stance()` below is untouched and still reports what the
   * wire last said, which is what `rigLayoutFor` and anything else wanting the raw fact reads.
   */
  get animation(): ActorAnimationInput {
    // `AIRBORNE` is a moment, not a state, and `jumpLaunch` clamps on the air pose by design —
    // so a stale record asserting it holds a body knees-up for as long as the staleness lasts
    // (BACKLOG #87). Two kinds of record are stale, and both have to be refused here:
    //
    // - `frozen`: the buffer starved past `MAX_EXTRAPOLATION_MS` and is holding its last sample.
    // - `dormant`: the server has stopped placing this body (protocol 28) and is repeating the
    //   record it had when the body was last relevant — `SeatView` names the stance among the
    //   fields that freeze. Nothing starves, so `frozen` is false and snapshots keep arriving;
    //   `Interpolation.sample` takes the stance from the newest sample unblended, which is right
    //   for a live record and is how a frozen one gets through. This was the reported bug.
    //
    // Neither can see the landing, so neither gets to claim the body is still in the air.
    this.animation_.stance =
      (this.frozen || this.dormant) && this.pose.stance === 'AIRBORNE' ? 'STAND' : this.pose.stance;
    this.animation_.aiming = this.ads;
    this.animation_.sprinting = this.sprinting;
    this.animation_.reloading = this.reloading;
    // The wire carries the flag, not the duration: the def's tactical reload is the estimate.
    this.animation_.reloadSeconds =
      this.reloading && this.weaponId !== null ? (WEAPON_DEFS[this.weaponId]?.reloadTime ?? 0) : 0;
    this.animation_.firing = this.firing;
    this.animation_.throwing = this.throwing;
    this.animation_.throwPhase = this.throwPhase;
    this.animation_.meleeing = this.meleeing;
    return this.animation_;
  }

  get x(): number {
    return this.pose.x;
  }
  get y(): number {
    return this.pose.y;
  }
  get z(): number {
    return this.pose.z;
  }
  get yaw(): number {
    return this.pose.yaw;
  }
  /** Aim pitch, replicated so a remote looking up the catwalk reads as looking up (S6.5). */
  get pitch(): number {
    return this.pose.pitch;
  }

  // -- RenderableActor --------------------------------------------------------

  renderX(alpha: number): number {
    return this.prevX + (this.pose.x - this.prevX) * alpha;
  }
  renderY(alpha: number): number {
    return this.prevY + (this.pose.y - this.prevY) * alpha;
  }
  renderZ(alpha: number): number {
    return this.prevZ + (this.pose.z - this.prevZ) * alpha;
  }
  renderYaw(alpha: number): number {
    return this.prevYaw + angleDelta(this.prevYaw, this.pose.yaw) * alpha;
  }
  renderScale(alpha: number): number {
    return this.prevScale + (this.pose.heightScale - this.prevScale) * alpha;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * A respawn is a cut, not a move.
   *
   * Detected **before** sampling, which is the whole point: `applyLatest` below already
   * notices the spawn serial, but it runs *after* `interp.sample` has drawn this frame's pose
   * out of a buffer still holding samples from where the body died. Collapsing the render
   * blend there hides the last few milliseconds of the slide and none of the rest of it —
   * reported as "their model is rapidly pulled across the map from their death position to
   * their new spawn location".
   *
   * The first sighting counts as a spawn too, so a body that has just joined appears where it
   * is rather than travelling there from the origin.
   */
  private snapOnRespawn(interp: EntityInterpolator, renderMs: number): void {
    const spawnSerial = interp.latest.spawnSerial;
    if (spawnSerial !== this.spawnSnapped) {
      this.spawnSnapped = spawnSerial;
      interp.snapTo(renderMs);
      this.seeded = false;
    }
  }

  /**
   * Keep the drawn pose as the one the next frame blends out of.
   *
   * The previous pose is kept so the renderer's own `alpha` blend has two states to work
   * between. It is a second, much shorter interpolation on top of the buffer's — the buffer
   * places the body on the server's timeline, this smooths across the display's refresh.
   */
  private rememberPose(): void {
    this.prevX = this.pose.x;
    this.prevY = this.pose.y;
    this.prevZ = this.pose.z;
    this.prevYaw = this.pose.yaw;
    this.prevScale = this.pose.heightScale;
  }

  /**
   * Adopt the discrete fields from the newest snapshot.
   *
   * Discrete on purpose — health, weapon, flags and the visual serials are facts that take
   * effect when they arrive, not quantities to blend. Interpolating a weapon index between
   * two values would name a third weapon.
   */
  private applyLatest(latest: EntitySnapshot): void {
    this.team = (latest.flags & EFlag.TeamB) !== 0 ? 'B' : 'A';
    this.health = latest.health;
    this.flags = latest.flags;
    this.weaponId = weaponIdAt(latest.weaponIndex);
    this.heldEquipmentId = equipmentIdAt(latest.heldEquipment);
    this.throwPhase = THROW_PHASES[latest.throwPhase] ?? 'IDLE';
    this.characterId = skinIdAt(latest.characterIndex);
    if (latest.displayName !== '') this.displayName = latest.displayName;

    const v = this.visual;
    // Serials are replicated verbatim, so the renderer's existing "start an animation when a
    // serial moves" logic works on a remote player with no change at all. The death variant
    // is *derived* rather than sent, from the same `(entityId, deathSerial)` hash the server
    // used — S4.14's per-event seeding paying for itself: both sides pick the same fall
    // without a byte on the wire.
    if (latest.deathSerial !== v.deathSerial) {
      v.deathSerial = latest.deathSerial;
      v.deathDirX = Math.sin(latest.deathAngle);
      v.deathDirZ = Math.cos(latest.deathAngle);
      v.deathVariant = deathVariantFor(this.entityId, latest.deathSerial, DEATH_VARIANTS);
    }
    if (latest.spawnSerial !== v.spawnSerial) {
      v.spawnSerial = latest.spawnSerial;
      this.seeded = false;
    }
    if (latest.flinchSerial !== v.flinchSerial) {
      v.flinchSerial = latest.flinchSerial;
      v.flinchDirX = Math.sin(latest.flinchAngle);
      v.flinchDirZ = Math.cos(latest.flinchAngle);
    }
  }
  //#endregion
}
//#endregion
