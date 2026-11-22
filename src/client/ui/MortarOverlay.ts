/**
 * The mortar targeting overlay (M7, brief S6.1).
 *
 * *"The player marks a zone on a map overlay… The overlay is drawn from `MapDef`, reusing the
 * minimap renderer."*
 *
 * Both halves of that are load-bearing. **From `MapDef`** means the thing you aim at is the
 * geometry you collide with — a wall that moves in the map file moves here, and the strike
 * cannot land somewhere the picture said was open. **Reusing the minimap renderer** means the
 * same brush-classification and footprint code, so the overlay and the minimap agree about
 * what a wall is; two rasterisers would eventually disagree and the disagreement would be
 * invisible until somebody called a strike into a building that was not there.
 *
 * **All of it is literally `Minimap`'s** as of 2026-11-22: the footprint, the brush raster, the
 * prop raster and the classification, which this file no longer has a copy of. Until then it
 * kept its own `classify` without the minimap's pitched-brush rule, so a ramp below 3 m was a
 * wall here and a deck there — a real disagreement of exactly the kind the paragraph above says
 * must not exist, filed as BACKLOG #69 rather than fixed, because which of the two was right is
 * a decision about what the player sees.
 *
 * The minimap's reading won, and the four things that decided it are written out above
 * `Minimap.classify`. The short version: this file's own header already promised the two agree,
 * both carried the same three hex colours, the colour here **gates nothing** — `moveBy` clamps
 * to the map's bounds and `confirm` tests no terrain, so it never meant "can I drop shells
 * here" — and a shell called onto a ramp lands on the ramp, because `MortarStrike.groundAt`
 * casts straight down and takes whatever surface it finds. A ramp drawn as a wall told the
 * player it was neither a place to hit nor a place anyone could be standing, and it is both.
 *
 * What is left here is what this screen alone has: its scale, its cursor, its grid and its
 * input. The one picture is drawn by one piece of code at two scales.
 *
 * The raster is built once when the overlay is first opened rather than at match start,
 * because most matches never call in a mortar and a 300 x 250 px canvas is not free.
 *
 * ## Input
 *
 * Mouse move steers the cursor and click confirms, but the cursor is *also* driven by the
 * player's look direction while pointer lock is held — under lock there is no mouse position
 * to read, and taking the lock away to open a map would drop the player's aim. So the overlay
 * accepts a relative nudge each frame and the click is the confirm.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { el } from './Dom';
import { clamp } from '../../shared/core/MathUtil';
import type { MapDef } from '../../shared/world/maps/types';
import { drawBrushes, drawProps } from './Minimap';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface MortarOverlayDeps {
  readonly host: HTMLElement;
  readonly mapDef: MapDef;
  /** Called with world coordinates when the player confirms a target. */
  readonly onConfirm: (x: number, z: number) => void;
  readonly onCancel: () => void;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Pixels per metre in the overlay raster. Denser than the minimap: this is a big canvas. */
const PX_PER_M = 9;

/**
 * The wall, edge and deck hexes left with the raster (BACKLOG #69): `Minimap` holds the one
 * copy, which is the point — they were the same three values in both files, which is what said
 * out loud that these are one picture at two scales.
 */
const COLOR_CURSOR = '#e8604c';
const COLOR_GRID = 'rgba(232, 234, 238, 0.06)';
//#endregion

// ==================================== CLASS MortarOverlay ===================================== \\
//#region Class MortarOverlay
export class MortarOverlay {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly element: HTMLElement;

  /** World-space cursor. Read by `Match` so a confirm lands where the ring is. */
  markX = 0;
  markZ = 0;

  private readonly deps: MortarOverlayDeps;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private raster: HTMLCanvasElement | null = null;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly spanX: number;
  private readonly spanZ: number;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private open = false;
  private phase = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: MortarOverlayDeps) {
    this.deps = deps;
    const bounds = deps.mapDef.navBounds;
    this.minX = bounds.min.x;
    this.minZ = bounds.min.z;
    this.spanX = bounds.max.x - bounds.min.x;
    this.spanZ = bounds.max.z - bounds.min.z;
    this.widthPx = Math.round(this.spanX * PX_PER_M);
    this.heightPx = Math.round(this.spanZ * PX_PER_M);

    this.element = document.createElement('div');
    this.element.className = 'hud-mortar';
    this.element.hidden = true;

    const frame = el('div', 'hud-mortar__frame');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-mortar__canvas';
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) throw new Error('Mortar overlay needs a 2D context');
    this.ctx = ctx;
    frame.appendChild(this.canvas);

    const hint = el('p', 'hud-mortar__hint', 'MOVE TO AIM · FIRE TO CONFIRM · ESC TO CANCEL');
    frame.appendChild(hint);

    this.element.appendChild(frame);
    deps.host.appendChild(this.element);
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get isOpen(): boolean {
    return this.open;
  }

  /** Open over the player's own position, which is the least surprising starting cursor. */
  show(playerX: number, playerZ: number): void {
    if (this.raster === null) this.raster = this.buildRaster();
    this.markX = playerX;
    this.markZ = playerZ;
    this.open = true;
    this.element.hidden = false;
  }

  hide(): void {
    this.open = false;
    this.element.hidden = true;
  }

  /**
   * Nudge the cursor. `dx`/`dz` are metres, already scaled by the caller from the look delta.
   *
   * Clamped to the map bounds, because a mark outside the navmesh is a strike on nothing.
   */
  moveBy(dx: number, dz: number): void {
    this.markX = clamp(this.markX + dx, this.minX, this.minX + this.spanX);
    this.markZ = clamp(this.markZ + dz, this.minZ, this.minZ + this.spanZ);
  }

  confirm(): void {
    this.deps.onConfirm(this.markX, this.markZ);
    this.hide();
  }

  cancel(): void {
    this.deps.onCancel();
    this.hide();
  }

  /** One frame. Only runs while open, so a closed overlay costs nothing. */
  update(dt: number, scatterRadius: number): void {
    if (!this.open || this.raster === null) return;
    this.phase = (this.phase + dt * 2.4) % (Math.PI * 2);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.widthPx, this.heightPx);
    ctx.fillStyle = 'rgba(9, 11, 14, 0.88)';
    ctx.fillRect(0, 0, this.widthPx, this.heightPx);
    ctx.drawImage(this.raster, 0, 0);

    // The strike zone, at the real scatter radius — what you see is what lands.
    const cx = (this.markX - this.minX) * PX_PER_M;
    const cz = (this.markZ - this.minZ) * PX_PER_M;
    const r = scatterRadius * PX_PER_M;

    this.drawStrikeZone(cx, cz, r);
    this.drawCrosshairs(cx, cz);
  }

  dispose(): void {
    this.element.remove();
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * Rasterise the map once, the same way `Minimap` does.
   *
   * Same footprint projection for pitched brushes, through the same function. The
   * classification thresholds are this file's own — see the header, and BACKLOG #69.
   */
  private buildRaster(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.widthPx;
    canvas.height = this.heightPx;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Mortar overlay raster needs a 2D context');

    ctx.setTransform(PX_PER_M, 0, 0, PX_PER_M, -this.minX * PX_PER_M, -this.minZ * PX_PER_M);
    ctx.lineWidth = 0.1;

    this.drawGrid(ctx);
    drawBrushes(ctx, this.deps.mapDef);
    drawProps(ctx, this.deps.mapDef);
    return canvas;
  }

  /** A ten-metre grid, so distances are readable rather than guessed. */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLOR_GRID;
    for (let x = Math.ceil(this.minX / 10) * 10; x < this.minX + this.spanX; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, this.minZ);
      ctx.lineTo(x, this.minZ + this.spanZ);
      ctx.stroke();
    }
    for (let z = Math.ceil(this.minZ / 10) * 10; z < this.minZ + this.spanZ; z += 10) {
      ctx.beginPath();
      ctx.moveTo(this.minX, z);
      ctx.lineTo(this.minX + this.spanX, z);
      ctx.stroke();
    }
  }

  /** The disc the shells will land in, and the pulsing ring that makes it findable. */
  private drawStrikeZone(cx: number, cz: number, r: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = COLOR_CURSOR;
    ctx.fillStyle = 'rgba(232, 96, 76, 0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cz, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // A pulsing inner ring, so the cursor is findable on a busy map.
    ctx.globalAlpha = 0.45 + Math.sin(this.phase) * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cz, r * 0.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Crosshairs out to the frame edge: precise placement needs a reference line. */
  private drawCrosshairs(cx: number, cz: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, this.heightPx);
    ctx.moveTo(0, cz);
    ctx.lineTo(this.widthPx, cz);
    ctx.strokeStyle = 'rgba(232, 96, 76, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** Every solid brush, walls first, in this file's own classification. */
//#endregion
