/**
 * What a frame hands the viewmodel animation, and nothing else.
 *
 * Split out of `ViewmodelAnim.ts` so the record sits on its own: `ClientMatch` fills one of
 * these every frame and four separate stages read it, and none of them needs to see the
 * animator to know what a frame is. Every field is a fact the simulation already holds — this
 * file invents nothing and decides nothing, which is the line S6.6 draws between what the
 * player can do and what the player sees.
 */

// =========================================== TYPES ============================================ \\
//#region Types
export interface ViewmodelDrive {
  /** 0 = fully lowered, 1 = ready. The authority for both pose and fireability. */
  raise: number;
  /** 0 = hip, 1 = aimed. Linear in time; the easing happens here. */
  adsFraction: number;

  reloading: boolean;
  reloadFraction: number;
  reloadEmpty: boolean;

  /** Degrees of accumulated visual recoil. Separate from the aim change (S6.2). */
  visualPunch: number;
  visualLateral: number;

  tacSprint: boolean;
  slide: boolean;
  /**
   * A grenade is being cooked or has just been released (M7 playtest).
   *
   * Lowers the weapon off screen for the duration. The throw used to read as the grenade
   * leaving the player's chest, because the rifle stayed up the whole time and the projectile
   * simply appeared beside it. `ThrowController.busy` is the same flag that blocks firing, so
   * what you see and what you can do cannot disagree.
   */
  throwing: boolean;
  /**
   * Seconds the current cook has burned, or **-1** when nothing is being cooked
   * (`ThrowController.cook` and `phase`).
   *
   * The grenade in the hand is posed from this and `throwRelease` and from nothing else, which
   * is the line F17 draws: `ThrowController` decides when the grenade leaves the hand, this
   * class decides what that looks like. No clock of its own, so a cook the server shortened
   * cannot leave the animation holding a grenade that is already gone.
   */
  throwCook: number;
  /** 0..1 through the release's follow-through (`ThrowController.followThrough`), 0 when idle. */
  throwRelease: number;
  /**
   * A weapon swap is under way (M5, S6.4).
   *
   * `raise` already carries the *timing* of a put-away and a take-out, because `Inventory`
   * drives it. This says which lowered pose to use: a sprint carries the weapon across the
   * body diagonally, a swap drops it straight down and rolls it out of frame. Same value,
   * two keyframed destinations.
   */
  swapping: boolean;
  /**
   * 0..1 through a knife swing, or 0 (post-M8).
   *
   * A single arc rather than a phase enum, for the same reason `reloadFraction` is a number:
   * the pose is a continuous function of how far through the animation the sim says it is,
   * so the picture cannot disagree with the state machine about whether the blade is out.
   */
  melee: number;

  /** Head-bob phase from the player sim, so the gun and the camera share a footfall. */
  bobPhase: number;
  /** Horizontal speed, m/s, and the speed that counts as "full bob". */
  speed: number;
  speedRef: number;
  grounded: boolean;

  /** Absolute view angles this frame; sway is derived from how fast they change. */
  yaw: number;
  pitch: number;
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/** The rest state a weapon is carried in: ready, nothing cooking, standing still. */
export function makeViewmodelDrive(): ViewmodelDrive {
  return {
    raise: 1,
    throwing: false,
    throwCook: -1,
    throwRelease: 0,
    adsFraction: 0,
    reloading: false,
    reloadFraction: 0,
    reloadEmpty: false,
    visualPunch: 0,
    visualLateral: 0,
    tacSprint: false,
    slide: false,
    swapping: false,
    melee: 0,
    bobPhase: 0,
    speed: 0,
    speedRef: 6.9,
    grounded: true,
    yaw: 0,
    pitch: 0,
  };
}
//#endregion
