/**
 * The window's size in CSS pixels, measured once per resize instead of once per frame
 * (2026-10-18).
 *
 * ## What this is fixing
 *
 * `window.innerWidth` and `window.innerHeight` are layout reads. The browser answers them from
 * a clean layout tree, so a read that follows a style write in the same turn makes the browser
 * lay the document out again before it can answer — a *forced reflow*. The HUD writes to the
 * DOM every frame (the ammo counter, the crosshair gap, the health bar's transform, the hit
 * marker's opacity) and three places then read the window back: the HUD state built in
 * `ClientMatch`, the damage-number projection in `MatchFeedback`, and the AI debug labels. One
 * guaranteed reflow per frame, for a number that only changes when the window does.
 *
 * It is cheap on a quiet page and expensive on a loud one, because a reflow costs what the
 * whole document costs — including anything a browser extension has injected into it. A Chrome
 * profile of the deployed build spent 11.2% of the main thread inside one extension's
 * `isHiddenFromScreen`, which is that extension answering the same question about its own
 * nodes every time ours dirtied the tree.
 *
 * ## Why a module rather than a parameter
 *
 * One for the page, like `palette` and `gpuWarmup`: the readers are a HUD built per match, a
 * feedback bridge built with it, and a debug panel, and threading a size through three
 * constructors to hold one number that `Game` already measures is ceremony. `Game` writes it
 * where it already reads the window — at boot and in `onResize`, beside `Renderer.setSize` and
 * `applyFrameScale`, which are the same fact answered for the canvas and for the frame.
 *
 * Nothing here caches a *derived* measurement, so there is no staleness beyond the window's
 * own: a reader that runs between a resize and the resize event sees the previous size for one
 * frame, which is what `Renderer` and the frame scale already do.
 */
class Viewport {
  private w = 0;
  private h = 0;

  /** The window is this big. Called by `Game` at boot and on every resize. */
  set(width: number, height: number): void {
    this.w = Math.max(1, Math.floor(width));
    this.h = Math.max(1, Math.floor(height));
  }

  get width(): number {
    if (this.w === 0) this.measureNow();
    return this.w;
  }

  get height(): number {
    if (this.h === 0) this.measureNow();
    return this.h;
  }

  /**
   * The one place left that reads the window directly, and it runs at most once.
   *
   * A reader can be reached before `Game` has set anything — the layout probe mounts a screen
   * with no `Game` at all — and answering 0 there would be a crosshair with no gap and damage
   * numbers in the corner. So the first read measures, and every read after it is the cache.
   */
  private measureNow(): void {
    this.set(window.innerWidth, window.innerHeight);
  }
}

export const viewport = new Viewport();
