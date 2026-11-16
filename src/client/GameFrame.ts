/**
 * One frame's picture: whose eye the camera is at, which lens it looks through, and which of
 * the three passes draws it.
 *
 * Everything here runs **per frame** (R7), so nothing in it allocates: the drive objects, the
 * spectated pose and the gunship's two body lists are built once and rewritten in place, and
 * the three cameras belong to the rig, the chopper and the intro rather than to this frame.
 *
 * ## The lens is asked for, never pushed
 *
 * The Chopper Gunner hands back a camera while it is running and null once it has been
 * restored, and the match intro answers for the round-one freeze and for nothing else. Both
 * are *asked* every frame, so there is nothing here to undo and no state that could disagree
 * with the streak about whose camera it is. That is what makes M7's acceptance criterion 2 —
 * *"returns control cleanly, including if the player is killed or the match ends"* — a
 * property of one method rather than of four call sites.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import { DEG2RAD } from '../shared/core/MathUtil';
import { isHostile } from '../shared/combat/Hostility';
import { makeSnapshot, type PlayerSnapshot } from '../shared/player/PlayerState';
import type { WeaponDef } from '../shared/weapons/WeaponDefs';
import { ChopperCamera } from './streaks/ChopperCamera';
import { IntroCamera } from './cinematic/IntroCamera';
import { gpuWarmup } from './engine/GpuWarmup';
import type { CameraRig, CameraDrive } from './engine/CameraRig';
import type { Renderer } from './engine/Renderer';
import type { ProceduralAudio } from './engine/ProceduralAudio';
import type { Input } from './input/Input';
import type { CameraConfig } from './player/CameraConfig';
import type { ViewmodelLayer } from './player/Viewmodel';
import type { MenuBackdrop } from './world/MenuBackdrop';
import type { MatchWorld } from './MatchWorld';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** What this object needs from the application root. Every one of them outlives a match. */
export interface GameFrameDeps {
  readonly scene: THREE.Scene;
  readonly renderer: Renderer;
  readonly cameraRig: CameraRig;
  readonly viewmodel: ViewmodelLayer;
  readonly audio: ProceduralAudio;
  readonly input: Input;
  readonly backdrop: MenuBackdrop;
  readonly cameraConfig: CameraConfig;
  /** The live primary, whose ADS scales drive the camera's. */
  readonly weaponDef: WeaponDef;
  /** The intro camera's movement config, read once when it is built. */
  readonly introCamera: IntroCamera;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** The gunship pass's two body lists, reused per frame so the takeover allocates nothing. */
const gunshipHot: THREE.Object3D[] = [];
const gunshipCold: THREE.Object3D[] = [];
//#endregion

// ====================================== CLASS GameFrame ======================================= \\
//#region Class GameFrame
export class GameFrame {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /**
   * The pose handed to the rig while spectating (§6.8).
   *
   * One object, rewritten each frame. Every motion field is left at rest: a spectated body's bob
   * and lean are *its* owner's, arriving interpolated in its mesh, and driving the camera from
   * them as well would double the motion the viewer sees.
   */
  private readonly spectatePose: PlayerSnapshot = makeSnapshot();

  /**
   * The camera drive while spectating: everything off.
   *
   * A spectator is not sprinting, not sliding and not aiming down sights, whatever the body they
   * are watching is doing — those drive *this* camera's FOV and roll, and inheriting them would
   * make the view lurch on somebody else's input.
   */
  private readonly spectateDrive: CameraDrive = {
    sprint: false,
    tacSprint: false,
    slide: false,
    adsFraction: 0,
    adsFovScale: 1,
    adsViewmodelFovScale: 1,
  };

  private readonly drive: CameraDrive = {
    sprint: false,
    tacSprint: false,
    slide: false,
    adsFraction: 0,
    adsFovScale: 1,
    adsViewmodelFovScale: 1,
  };

  /** M9. Process-wide: the takeover is per-match, the camera object need not be. */
  private readonly chopperCamera = new ChopperCamera();
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(private readonly deps: GameFrameDeps) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * No world: the front end is DOM over the menu's backdrop (M15, A3) — a rolled map on
   * a slow dolly, rendered through the backdrop's own camera with no viewmodel — or over a
   * cleared canvas while that map is still building, because a canvas that is neither drawn
   * nor cleared holds the last frame of the previous match.
   */
  renderBackdrop(dt: number, alpha: number): void {
    const backdropCam = this.deps.backdrop.frame(dt, this.deps.renderer.aspect, alpha);
    if (backdropCam === null) {
      this.deps.renderer.clear();
      return;
    }
    if (!gpuWarmup.hold(this.deps.scene, backdropCam)) {
      this.deps.renderer.render(this.deps.scene, backdropCam, null);
    }
  }

  /**
   * The world, through whichever lens owns the view this frame.
   *
   * Returns with the debug overlay's own clock advanced either way, because the GPU warm-up
   * can swallow the picture and must not swallow that.
   */
  renderWorld(world: MatchWorld, alpha: number, dt: number): void {
    const match = world.match;
    // Sampled before the camera is composed: the interpolated aim-recoil offset is part
    // of where the camera points, so it cannot be produced after the fact (S6.2).
    match.sampleVisual(alpha);
    const yaw = this.deps.input.yaw + match.visual.aimYaw * DEG2RAD;
    const pitch = this.deps.input.pitch + match.visual.aimPitch * DEG2RAD;

    this.updateDrive(world, match.visual.adsFraction);
    this.updateCamera(world, alpha, dt, yaw, pitch);

    const cam = this.deps.cameraRig.camera;
    this.updateListener(world, cam, yaw);

    match.render(alpha, cam, dt, yaw, pitch);
    // M8: dust and haze ride the render clock, not the sim tick — they drive no gameplay
    // value, so S4.1's constant-dt rule does not apply and a fixed step would make the
    // cloud stutter at frame rates that are not 60.
    world.particulate?.update(cam.position.x, cam.position.y, cam.position.z, dt);
    world.debug.render(cam, alpha, dt);

    this.drawThroughLens(world, cam, dt);
    world.debug.update(dt);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** This frame's camera drive, from the player's own stance and their weapon's sights. */
  private updateDrive(world: MatchWorld, adsFraction: number): void {
    const sim = world.player.sim;
    const def = this.deps.weaponDef;
    this.drive.sprint = sim.sprintActive;
    this.drive.tacSprint = sim.tacSprintActive;
    this.drive.slide = sim.slideActive;
    this.drive.adsFraction = adsFraction;
    // M8: the ADS sensitivity multiplier is blended by how far the sights are up, so the
    // look speed changes with the picture rather than on the button edge.
    this.deps.input.setAdsFraction(adsFraction);
    this.drive.adsFovScale = def.adsFovScale;
    this.drive.adsViewmodelFovScale = def.adsViewmodelFovScale;
  }

  /**
   * A dead player in a one-life round watches a teammate (M11 Gate B, §6.8).
   *
   * Applied here rather than inside the rig because the rig's job is to turn a *pose* into a
   * camera — bob, sway, shake, ADS blend — and it should not have to know that the pose
   * sometimes belongs to somebody else. The rig is handed the spectated eye instead of the
   * local one and does exactly what it always does.
   *
   * Null in every other case, which is every mode except Search & Destroy and every moment
   * the player is alive, so the ordinary path is unchanged.
   */
  private updateCamera(world: MatchWorld, alpha: number, dt: number, yaw: number, pitch: number): void {
    const spectated = world.match.spectatorView(alpha);
    if (spectated === null) {
      const player = world.player;
      this.deps.cameraRig.update(
        player.prev,
        player.curr,
        alpha,
        yaw,
        pitch,
        this.drive,
        this.deps.cameraConfig,
        dt,
        this.deps.viewmodel,
      );
      return;
    }

    // `alpha` is 1 below because the pose handed over is already interpolated by the actor.
    this.spectatePose.x = spectated.x;
    this.spectatePose.y = spectated.y;
    this.spectatePose.z = spectated.z;
    // The watched body's own eye, not a standing one: `makeSnapshot` leaves this at 1.65 m and
    // a crouching teammate's eyes are at 0.95. See `ClientMatch.spectatorView`.
    this.spectatePose.eyeHeight = spectated.eyeHeight;
    this.deps.cameraRig.update(
      this.spectatePose,
      this.spectatePose,
      1,
      // Their facing, not the dead player's mouse. A spectator who could look around
      // independently of the body they are inside is a floating camera with extra steps.
      spectated.yaw,
      0,
      this.spectateDrive,
      this.deps.cameraConfig,
      dt,
      this.deps.viewmodel,
    );
  }

  /** Where the ears are, and the one sustained source driven per frame rather than by an event. */
  private updateListener(world: MatchWorld, cam: THREE.PerspectiveCamera, yaw: number): void {
    const audio = this.deps.audio;
    const sim = world.player.sim;
    if (audio.isRunning) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      audio.setListener(cam.position.x, cam.position.y, cam.position.z, fx, 0, fz, 0, 1, 0);
      // The slide scrape is a sustained source, so it is driven per frame from the
      // stance rather than fired from an event (see PLAN.md, M1 playtest note).
      audio.setSlide(sim.slideActive, sim.x, sim.y, sim.z, sim.speed, sim.groundMaterial);
    }
    // Recycling runs whatever the context is doing. Skipping it while suspended is how
    // voices used to accumulate: nothing was freeing them, and something still had to.
    audio.update();
  }

  /**
   * The three passes, and the warm-up that can take the frame from all of them.
   *
   * Everything above ran — the bodies were built and posed, the weapons put in their hands — and
   * now, if the GPU has programs to compile for this scene, they are compiled instead of drawn
   * (part 5). The canvas keeps the last picture for those few frames; the simulation and the
   * network do not wait, which is the half of a stall that used to cost a resync. See
   * `GpuWarmup`.
   */
  private drawThroughLens(world: MatchWorld, cam: THREE.PerspectiveCamera, dt: number): void {
    const match = world.match;
    // This client's seat, not the single-player constant: over the network the local player is
    // entity 1 or above, so asking for entity 0's gunship found nobody's and the camera never
    // took over — the streak flew and the player watched it from the ground.
    const chopper = match.streaks.activeChopperFor(match.localId);
    // M9: the streak reports a pose and a lens; `ChopperCamera` keeps the actual camera.
    const takeover = this.chopperCamera.cameraFor(chopper, this.deps.renderer.aspect);
    /**
     * The match intro (M15, Phase C), asked the same way and first: it answers for the
     * round-one freeze and for nothing else, and while it does the world is drawn through
     * its lens with no viewmodel — the player is not holding anything the camera can see —
     * and the HUD's instruments come down. It is client-only presentation over a world the
     * server already froze; nothing about it is on the wire.
     */
    const intro = this.deps.introCamera.cameraFor(world, cam, this.deps.renderer.aspect, dt);
    match.ui.hud.setIntro(intro !== null);
    const viewmodel = this.deps.viewmodel;
    if (gpuWarmup.hold(this.deps.scene, intro ?? takeover ?? cam, { scene: viewmodel.scene, camera: viewmodel.camera })) {
      // Nothing drawn this frame; the debug overlay's own clock still runs.
      return;
    }
    if (intro !== null) {
      this.deps.renderer.render(this.deps.scene, intro, null);
      return;
    }
    if (takeover !== null) {
      this.renderGunship(match, takeover);
      return;
    }
    this.deps.renderer.render(this.deps.scene, cam, viewmodel);
  }

  /**
   * A grey render pass over the world with the bodies drawn by side, not a filter over
   * the ordinary image (S6.1). No viewmodel: the player is not holding anything.
   *
   * Post-M8 the two body groups are handed over separately so the pass can tell friend
   * from foe. Which is which is decided *here*, because the local team is a fact about
   * the match and `engine/` has no business knowing what a team is — it is given a cold
   * group and a hot one.
   */
  private renderGunship(match: MatchWorld['match'], takeover: THREE.PerspectiveCamera): void {
    // From the side the *server* assigned, not the single-player constant: a networked gunner
    // on team B had the thermal pass draw their own side hot and the enemy cold — the optic
    // reading exactly backwards, in the one streak whose entire value is telling friend from
    // foe. And through `isHostile` rather than "the other side" (M13 Phase A): in
    // Free-for-All both substrate groups are hot and nothing is cold, where the pass used to
    // draw the half of the lobby sharing the gunner's side near-black — the reported "black
    // hit indicator". The gunner's own body is never in either group (see `NetSession
    // .syncActors`), so hot-everything is exactly right there.
    const viewer = match.viewer;
    gunshipHot.length = 0;
    gunshipCold.length = 0;
    for (const team of ['A', 'B'] as const) {
      const group = match.botRenderer.groupFor(team);
      (isHostile(viewer.team, team, viewer.freeForAll) ? gunshipHot : gunshipCold).push(group);
    }
    this.deps.renderer.renderGunship(this.deps.scene, takeover, gunshipHot, gunshipCold);
  }
  //#endregion
}
//#endregion
