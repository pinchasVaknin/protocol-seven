/**
 * One key, two intentions: hold it to run a cinematic fast, tap it three times to leave
 * (the human's brief, §8 and §9, 2026-09-24).
 *
 * ## Why there is a state machine at all
 *
 * Both screens that play a timeline — the match intro's flyover and the debrief's
 * choreography — used to answer *any* key and *any* click with the same thing: cut to the
 * end, now. Three problems with that, and the third is the one that decided this file. It
 * is indiscriminate (the hand still on the jump key at the whistle skipped the intro); it
 * is all-or-nothing (a player who wants to see the podium but not wait for it has no middle
 * setting); and it means the two screens each spell their own rule, so *"press space to
 * play again"* on one of them and *"any key to skip"* on the other are two answers a player
 * has to learn separately.
 *
 * So: **Space, and nothing else.** Held, it is a fast-forward — the timeline runs at
 * `SKIP_FAST_FORWARD`× for as long as the key is down, which is a scrub the player steers
 * rather than a cut that happens to them. Tapped three times, it is *leave* — on the
 * debrief that is the next match.
 *
 * ## The two readings cannot collide, and that is what the threshold buys
 *
 * A press is a tap or the start of a hold and there is no way to know which until it ends,
 * so the rule is a duration: a press shorter than `SKIP_HOLD_SECONDS` was a tap, and one
 * longer has already been fast-forwarding for a while by the time it is released. The
 * threshold is small enough (180 ms) that a fast-forward feels immediate and large enough
 * that three deliberate taps never accumulate any boost worth seeing — at 180 ms the most a
 * tap could leak is nothing at all, because `boost` pays out only *past* the threshold.
 *
 * A release that was a hold also **clears the tap run**, which is the case a naive counter
 * gets wrong: hold, release, tap, tap would otherwise be three presses and would leave the
 * screen the player was scrubbing.
 *
 * ## Pure, and therefore tested
 *
 * Nothing here touches a keyboard, a clock or the DOM — every method takes the time it
 * should use. `client/ui/SpaceSkip.ts` is the adapter that binds the two events and reads
 * `performance.now()`, the same split `Capabilities` and `input/DeviceCapabilities` have,
 * and `SkipGesture.test.ts` is why: the timing rules are the whole of the feature and a
 * rule that needs a browser to check is a rule nobody checks.
 */

/** How long Space must be down before it is a hold rather than a tap. Seconds. */
export const SKIP_HOLD_SECONDS = 0.18;

/** Longest gap between two taps of one run. A slower fourth tap starts a new run. Seconds. */
export const SKIP_TAP_WINDOW_SECONDS = 0.6;

/** Taps that mean *leave*. Three: two is a double-click, which a player does by accident. */
export const SKIP_TAPS_TO_LEAVE = 3;

/**
 * How much faster than real time a held key runs the timeline.
 *
 * Six, against the debrief's 8.2 s of choreography: a hold of about a second and a third
 * covers all of it, which is short enough to be worth doing and long enough that the
 * player sees the podium go by rather than a cut. The intro's flyover is the same number
 * because a second speed to learn is a second speed to be surprised by.
 */
export const SKIP_FAST_FORWARD = 6;

/**
 * The state of one skip key.
 *
 * Time is passed in rather than read, and in seconds — the unit both consumers already
 * hold, since each one is driven from a render frame's `dt`.
 */
export class SkipGesture {
  /** When the key went down, or -1 while it is up. */
  private downAt = -1;
  /** Taps in the current run. */
  private taps = 0;
  /** When the last tap of the run landed, or -1 when there is no run. */
  private lastTapAt = -1;

  /**
   * The key went down. A repeat is not a press — the caller drops those, and a second
   * `press` with no release between is ignored here as well, because a key that is already
   * down cannot go down again and a browser that says so is describing a lost keyup.
   */
  press(now: number): void {
    if (this.downAt >= 0) return;
    this.downAt = now;
  }

  /**
   * The key came up. True when this completed a run of taps — *leave*.
   *
   * A release with no press behind it (the window took the keyup, or focus returned with
   * the key already down) is not a tap: it is nothing, and counting it would let a player
   * leave a screen with two presses.
   */
  release(now: number): boolean {
    const down = this.downAt;
    this.downAt = -1;
    if (down < 0) return false;
    if (now - down >= SKIP_HOLD_SECONDS) {
      // That was a hold. It ends the run as well, so a scrub followed by two taps is two.
      this.taps = 0;
      this.lastTapAt = -1;
      return false;
    }
    if (this.lastTapAt >= 0 && now - this.lastTapAt > SKIP_TAP_WINDOW_SECONDS) {
      this.taps = 0;
    }
    this.taps++;
    this.lastTapAt = now;
    if (this.taps < SKIP_TAPS_TO_LEAVE) return false;
    this.taps = 0;
    this.lastTapAt = -1;
    return true;
  }

  /** Whether the key has been down long enough to be a fast-forward. */
  holding(now: number): boolean {
    return this.downAt >= 0 && now - this.downAt >= SKIP_HOLD_SECONDS;
  }

  /**
   * The *extra* seconds a timeline should gain this frame, on top of `dt`.
   *
   * Extra rather than a multiplier, so a caller adds it to the clock it was already going
   * to advance and a gesture that is doing nothing costs the caller nothing to ask.
   */
  boost(now: number, dt: number): number {
    if (!this.holding(now)) return 0;
    return Math.max(0, dt) * (SKIP_FAST_FORWARD - 1);
  }

  /**
   * Forget everything: the screen went away, or the window lost focus with the key down.
   *
   * The focus case is the one that needs it — a keyup delivered to another window never
   * arrives here, and a gesture left holding would fast-forward the next screen it is
   * asked about without anybody touching the keyboard.
   */
  reset(): void {
    this.downAt = -1;
    this.taps = 0;
    this.lastTapAt = -1;
  }
}
