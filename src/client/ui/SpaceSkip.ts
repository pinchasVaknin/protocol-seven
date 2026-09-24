import { SkipGesture } from '../../shared/ui/SkipGesture';

/**
 * Space, on a screen that is playing something (the human's brief, §8 and §9, 2026-09-24).
 *
 * The adapter half of `shared/ui/SkipGesture`: two window listeners, a clock, and nothing
 * else. Every rule about what a press *means* is in the gesture, where it is tested without
 * a browser; what is here is the part that cannot be — which key, whose clock, and the
 * three ways a keyup can fail to arrive.
 *
 * ## Why it takes the key rather than the screen's own handler
 *
 * Both screens already listen for keys, and both could have grown a `keyup` branch. They
 * would then have grown two copies of "was that a tap", which is precisely the thing the
 * old code got wrong in two different ways — the intro skipped on any key, the debrief left
 * on a single Space. One object owns Space on both screens now, so the gesture is learned
 * once and the screens keep only what is theirs: Escape and Tab on the debrief, nothing on
 * the intro.
 *
 * Captured and prevented, both deliberately. Captured because a focused button would
 * otherwise take the press first — the debrief has PLAY AGAIN under the pointer half the
 * time, and Space on a focused `<button>` is a click. Prevented because Space scrolls a
 * page, and the frame is a page.
 */
export interface SpaceSkipDeps {
  /**
   * Whether the screen wants the key at all right now. The debrief's second of grace is
   * this: a hand still on jump when the match ended must not be three taps into leaving.
   */
  readonly enabled: () => boolean;
  /** Three quick taps. Null on a screen with nowhere to go — the intro. */
  readonly onLeave: (() => void) | null;
}

/** Seconds, from the same clock the render frame uses. */
function nowSeconds(): number {
  return performance.now() / 1000;
}

export class SpaceSkip {
  private readonly gesture = new SkipGesture();
  private listening = false;

  constructor(private readonly deps: SpaceSkipDeps) {}

  /**
   * Extra seconds for this frame's timeline, on top of `dt`.
   *
   * Zero unless the key is held past the gesture's threshold, so a caller adds it
   * unconditionally and a screen nobody is touching runs at exactly one times speed.
   */
  boost(dt: number): number {
    if (!this.deps.enabled()) return 0;
    return this.gesture.boost(nowSeconds(), dt);
  }

  /** Whether the timeline is being scrubbed this frame. The debrief dresses itself for it. */
  get holding(): boolean {
    return this.deps.enabled() && this.gesture.holding(nowSeconds());
  }

  listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.gesture.reset();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    this.gesture.reset();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
  }

  /** The screen is done with it. Same as losing focus: whatever was held is not held now. */
  reset(): void {
    this.gesture.reset();
  }

  // -- the events ---------------------------------------------------------------

  /**
   * By `key` as well as `code`, which is the debrief's own note: a synthetic press — the
   * browser pane's, a probe's — may carry one and not the other.
   */
  private isSpace(e: KeyboardEvent): boolean {
    return e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isSpace(e)) return;
    // The key is ours whether or not the screen is taking it: a Space that scrolls the page
    // during the second of grace is still a Space that scrolled the page.
    e.preventDefault();
    e.stopPropagation();
    // A repeat is the keyboard describing one press, not reporting another.
    if (e.repeat || !this.deps.enabled()) return;
    this.gesture.press(nowSeconds());
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!this.isSpace(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.deps.enabled()) {
      // The press it would close was never recorded; clear the run rather than count it.
      this.gesture.reset();
      return;
    }
    if (this.gesture.release(nowSeconds())) this.deps.onLeave?.();
  };

  /**
   * Focus left with the key down, so the keyup goes to somebody else.
   *
   * Without this the gesture stays "held" and the screen fast-forwards on its own the
   * moment the player comes back — a bug that only ever happens to somebody who alt-tabbed,
   * which is to say a bug nobody reproduces.
   */
  private readonly onBlur = (): void => {
    this.gesture.reset();
  };
}
