/**
 * A camo over a file's own materials: the pattern multiplied into the albedo after
 * `map_fragment`, so the shading the artist painted shows through the paint.
 *
 * The procedural weapons take a camo differently — a whole surface set whose base map *is*
 * the pattern, which is `WeaponSurfaces`' job. This file is the other half: a weapon that
 * came out of a GLB keeps its normal map, its roughness and its baked wear, and the paint
 * goes on over them.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import { camoTexture } from '../meta/CamoTextures';
import type { CamoId } from '../../shared/meta/Camos';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * How many times the 256 px pattern tiles across a file's UV square. The procedural boxes
 * carry the pattern at two tiles per face, a few centimetres each; a file's atlas covers the
 * whole weapon in one square, and six tiles across it lands the pattern at about the size
 * the boxes wear it.
 */
const CAMO_OVERLAY_REPEAT = 6;

/**
 * The camo variants of the files' materials (decision 4), one per material and camo, kept
 * for the process like `cachedSurfaces` — a match and every loadout change ask for the same
 * few, and a variant is a compiled program. A disposed template's variants stay in the map;
 * the service is disposed once, at the end.
 */
const camoVariants = new Map<THREE.MeshStandardMaterial, Map<CamoId, THREE.MeshStandardMaterial>>();
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Paint a file's weapon in a camo: every opaque material under `root` becomes its
 * `camoMaterial` variant. Transparent materials — the glass of a file's own optic — are
 * left, for the reason `addOpticSurfaces` gives: a painted lens is not a lens.
 */
export function paintCamo(root: THREE.Object3D, camo: CamoId, anisotropy: number): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (material === undefined) return;
    const paint = (m: THREE.Material): THREE.Material =>
      m instanceof THREE.MeshStandardMaterial && !m.transparent ? camoMaterial(m, camo, anisotropy) : m;
    mesh.material = Array.isArray(material) ? material.map(paint) : paint(material);
  });
}

/**
 * A file material in a camo: the same material — its normal map, its roughness, its baked
 * wear — with the pattern multiplied into the albedo after `map_fragment`, so the shading
 * the artist painted shows through the paint. The pattern is scaled by the file's own
 * brightness (`lum`: a black albedo keeps the paint dark, a worn edge lifts it), and GOLD
 * and OBSIDIAN take the metalness the procedural set gives them, through the file's
 * metalness map where it has one. The sampler reads the mesh's `uv` through a varying of
 * its own, so a material with no map of its own — a plain-colour part — paints the same.
 */
export function camoMaterial(material: THREE.MeshStandardMaterial, camo: CamoId, anisotropy: number): THREE.MeshStandardMaterial {
  let byCamo = camoVariants.get(material);
  if (byCamo === undefined) {
    byCamo = new Map();
    camoVariants.set(material, byCamo);
  }
  const existing = byCamo.get(camo);
  if (existing !== undefined) return existing;
  const variant = material.clone();
  variant.name = `${material.name}|${camo}`;
  const metallic = camo === 'gold' || camo === 'obsidian';
  if (metallic) {
    variant.metalness = Math.max(variant.metalness, 0.55);
    variant.roughness = Math.min(variant.roughness, 0.3);
  }
  const texture = camoTexture(camo, anisotropy);
  variant.onBeforeCompile = (shader) => {
    shader.uniforms.camoMap = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCamoUv;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvCamoUv = uv * ${CAMO_OVERLAY_REPEAT.toFixed(1)};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D camoMap;\nvarying vec2 vCamoUv;')
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          '{',
          '  vec3 camo = texture2D(camoMap, vCamoUv).rgb;',
          '  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));',
          '  diffuseColor.rgb = camo * clamp(0.6 + 1.4 * lum, 0.0, 1.5);',
          '}',
        ].join('\n'),
      );
  };
  variant.customProgramCacheKey = () => `camo:${camo}`;
  byCamo.set(camo, variant);
  return variant;
}
//#endregion
