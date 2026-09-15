/**
 * The design frame (M15, Phase A1): every front-end screen is laid out at 1920×1080 and the
 * whole frame is scaled to the window.
 *
 * ## Why a frame rather than a responsive layout
 *
 * M15's rule is that nothing scrolls, at any window size. The responsive answer — let each
 * screen fold its columns and cap its widths, and scroll whatever is left — is what the front
 * end did through playtest round 5 (B1, B2, B11), and it is a rule per screen: every new
 * screen has to be argued into fitting again, and the argument is only ever checked at the
 * viewports somebody thought to list. A frame is one argument. A screen that fits 1920×1080
 * fits every window, because the window never sees anything but a scaled copy of the frame.
 *
 * ## `zoom`, not `transform: scale()`
 *
 * A transform is applied *after* layout: the element is laid out at its unscaled size and the
 * result is rasterised through a matrix, so text is blurred at fractional scales and every
 * `getBoundingClientRect()` still reports the unscaled box. `zoom` is applied *in* layout —
 * the used value of every length inside the frame is multiplied by it — so text is rasterised
 * at its final size, hit-testing is exact, and the layout probe measures what is on screen.
 * Chrome has always had it; Firefox since 126; it is in the CSS Viewport module now.
 *
 * ## The scale is set from the window, in one place
 *
 * `applyFrameScale` writes `--ui-scale` onto `#ui-root`, and `.op-frame` reads it. `Game`
 * calls it beside `Renderer.setSize` — the two are the same fact, "the window is this big",
 * answered for the canvas and for the DOM — and the layout probe calls it at the top of every
 * run, because a viewport it has just emulated has not fired anything's resize listener.
 *
 * The formula has no lower clamp on purpose. Below the 1280×720 floor the rule "nothing
 * scrolls" still holds — a 375-wide window gets a frame at 0.2 and everything on it — and what
 * is not promised there is legibility, which is the device gate's question, not this file's.
 *
 * ## What is *not* in the frame
 *
 * The HUD. `MatchFeedback` and `ScreenProjection` place hit markers, nameplates and the
 * direction indicators in real pixels, and a zoomed ancestor would put every one of them at
 * the wrong place by exactly `1 / scale`. So the zoom is not on `#ui-root`; it is on the
 * viewport box each front-end screen holds, and the HUD stays in the window's own pixels.
 *
 * And a screen's chrome (playtest round 3, R1.1). The frame is a 16:9 box centred in the
 * window, so a window that is wider than 16:9 — a maximised browser with its own bar above
 * the page is one — has a gutter each side of it, and a header laid out *in* the frame stood
 * 142 px from the window's edge at 1280×600 where it should have stood at the padding. The
 * answer is a third box between the layer and the frame: the **viewport**, the window's own
 * size *in frame pixels* (`--frame-w`, `--frame-h`: the window over the scale, so both are
 * at least 1920 × 1080 and one of them is exact), carrying the zoom and the frame's ramp, with
 * the frame centred inside it. A header or a footer mounts on the viewport and reaches the
 * window's edges; everything else stays in the frame and never varies with the window. At
 * 16:9 the viewport *is* the frame. The two variables are written by the same call as the
 * scale — no `vw` or `vh` in the stylesheets, which A1 forbade inside a zoom for the reason
 * that Chrome resolves them in the zoomed element's own pixels.
 */

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;

/** The largest uniform scale at which the frame fits the window. */
export function frameScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(viewportWidth / FRAME_WIDTH, viewportHeight / FRAME_HEIGHT);
}

/** The scale, and the window's size in frame pixels at it — what a full-bleed box inside the zoom measures. */
export interface FrameViewport {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The viewport box for this window: the window over the scale. At least `FRAME_WIDTH` by
 * `FRAME_HEIGHT` by construction, since the scale is the smaller of the two ratios, and
 * exact on the axis that set it. A zero window (the probe before its first emulation) is the
 * frame itself rather than a division by zero.
 */
export function frameViewport(viewportWidth: number, viewportHeight: number): FrameViewport {
  const scale = frameScale(viewportWidth, viewportHeight);
  if (scale <= 0) return { scale, width: FRAME_WIDTH, height: FRAME_HEIGHT };
  return { scale, width: viewportWidth / scale, height: viewportHeight / scale };
}

/** Write the scale and the viewport's size for this window onto the UI root, and return the scale. */
export function applyFrameScale(root: HTMLElement, viewportWidth: number, viewportHeight: number): number {
  const box = frameViewport(viewportWidth, viewportHeight);
  root.style.setProperty('--ui-scale', String(box.scale));
  root.style.setProperty('--frame-w', `${box.width}px`);
  root.style.setProperty('--frame-h', `${box.height}px`);
  return box.scale;
}

/**
 * A full-screen layer, the viewport box, and the frame inside it.
 *
 * The layer (`.op-screen`) is full-bleed: it carries the backdrop, the blur and the z-order,
 * and it is what `hidden` toggles. The viewport (`.op-viewport`) is the window's size in
 * frame pixels, zoomed by `--ui-scale`, and is where a header or a footer mounts (the class
 * comment says why). The frame (`.op-frame`) is the 1920×1080 box the screen's content lives
 * in, centred by the viewport. Screens append to the frame — or, for their chrome, to the
 * viewport — and never to the layer, so a screen cannot put anything outside the two boxes by
 * accident: there is nowhere else to put it.
 */
export function createScreen(layerClass: string): { layer: HTMLElement; viewport: HTMLElement; frame: HTMLElement } {
  const layer = document.createElement('div');
  layer.className = layerClass;
  const viewport = document.createElement('div');
  viewport.className = 'op-viewport';
  const frame = document.createElement('div');
  frame.className = 'op-frame';
  viewport.appendChild(frame);
  layer.appendChild(viewport);
  return { layer, viewport, frame };
}
