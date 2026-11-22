/**
 * The canvas three painters paint their tiles on, and the texture all three wrap it in.
 *
 * `WeaponSurfaces`, `ProceduralTextures` and `CamoTextures` each opened with the same five
 * lines — a square canvas, a 2D context, and a throw naming what could not be built — and each
 * closed by wrapping the result in a `CanvasTexture` with the same three sRGB-tiling properties
 * (BACKLOG #58). Three units wrote it, none of them naming the others, and the three were still
 * in step when they were counted; a fourth painter copying the nearest one is how that ends.
 *
 * **What is shared is the opening and the wrapper, not the whole of either end.** The three
 * tails are genuinely different and are deliberately left at the call sites: a weapon's tile
 * sets a `repeat` per surface, a camo's sets a fixed two, and the world's sets a mipmap chain
 * and its filters instead of a repeat. Folding those together would need a flags argument that
 * each caller passes a different value of, which is the duplication wearing a hat.
 *
 * It lives in `engine/` because that is where the renderer's own texture code is and because
 * two of the three importers are outside it; it imports nothing of the project's, so nothing
 * here can become a cycle.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * A square `size` by `size` 2D context to paint a tile on.
 *
 * `what` completes the sentence "2D canvas context unavailable; cannot build …", so it names
 * the thing the caller was about to make — `weapon textures`, `camo textures`, `textures` —
 * and each caller keeps the words it threw before this was one function.
 */
export function paintedTile(size: number, what: string): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error(`2D canvas context unavailable; cannot build ${what}.`);
  return ctx;
}

/**
 * The painted canvas as a tiling sRGB texture, with the caller's anisotropy.
 *
 * Repeat-wrapped on both axes and tagged sRGB, which is what every one of these is: a small
 * square painted once and tiled across a surface. The caller sets whatever else it needs — a
 * `repeat`, or a mipmap chain and its filters — and then `needsUpdate`, because the texture is
 * not finished until that caller says so.
 */
export function tiledTexture(canvas: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}
//#endregion
