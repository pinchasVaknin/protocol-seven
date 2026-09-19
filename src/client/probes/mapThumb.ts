import * as THREE from 'three';
import { findMap, MAPS } from '../../shared/modes/ModeRegistry';
import { CharacterAssetService } from '../characters/CharacterAssetService';
import { ProceduralTextures } from '../engine/ProceduralTextures';
import { Renderer } from '../engine/Renderer';
import { MenuBackdrop } from '../world/MenuBackdrop';

/**
 * The map picture page (M17, C3): one map, drawn the way the menu draws it behind itself,
 * read back as a JPEG by `scripts/map-thumbs.mjs`.
 *
 * Play Solo shows the chosen map large and every map as a card, and the project has no map
 * pictures — no pictures of anything, M12's first paragraph — so they are made here, once,
 * by the same `MenuBackdrop` the menu stands over: the same map build, the same ambient,
 * the fight off, through its **vista** camera — on the spine lane a little before the
 * centre, looking through it, so the centre and what stands beyond it are the picture (the
 * human's note on Dunes, whose dolly runs up a side street). Committed as
 * `public/maps/<id>.jpg` and re-made when a map changes.
 *
 * `?map=<id>` picks the map. `window.__mapThumb.render()` resolves to the data URL once the
 * build has landed and a few frames have run the dolly a little way in from its end.
 */

const wanted = new URLSearchParams(window.location.search).get('map') ?? '';
let entry;
try {
  entry = findMap(wanted);
} catch {
  throw new Error(`map picture: no map "${wanted}". Try one of: ${MAPS.map((m) => m.id).join(', ')}`);
}
const mapId = entry.id;

/** The picture's size. The hero panel shows it at 1 536 wide on the frame; the cards crop it. */
const WIDTH = 1536;
const HEIGHT = 864;
/** Seconds into the dolly the picture is taken: a little way in from the lane's end. */
const ELAPSED_SECONDS = 6;
/** JPEG quality: the pictures are a few hundred kilobytes each at this, not a few megabytes. */
const QUALITY = 0.86;
const DT = 1 / 60;

const canvas = document.createElement('canvas');
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.style.width = `${WIDTH}px`;
canvas.style.height = `${HEIGHT}px`;
document.body.appendChild(canvas);

const renderer = new Renderer(canvas);
renderer.setSize(WIDTH, HEIGHT, 1);
const scene = new THREE.Scene();
// The map is built at 'high' below; the renderer's tier follows once it is in the scene.
renderer.setShadowQuality('high', scene);
const textures = new ProceduralTextures(renderer.three);
const backdrop = new MenuBackdrop({
  scene,
  textures,
  shadowQuality: () => 'high',
  characterAssets: new CharacterAssetService(),
  anisotropy: () => 1,
});
// The picture is the map: no bodies, no fight.
backdrop.combat = false;
backdrop.prepare(mapId);

async function render(): Promise<string> {
  const deadline = performance.now() + 60_000;
  let cam = backdrop.frame(DT, WIDTH / HEIGHT);
  while (cam === null) {
    if (performance.now() > deadline) throw new Error(`map picture: "${mapId}" did not build within 60 s`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    cam = backdrop.frame(DT, WIDTH / HEIGHT);
  }
  // The vista — before the centre, looking through it — rather than the dolly's frame; a few
  // frames first so the particulate has drifted off its seed, then draw once and read in the
  // same task.
  const frames = Math.round(ELAPSED_SECONDS / DT);
  for (let i = 0; i < frames; i++) cam = backdrop.frame(DT, WIDTH / HEIGHT) ?? cam;
  const vista = backdrop.vistaCamera(WIDTH / HEIGHT) ?? cam;
  renderer.render(scene, vista, null);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

declare global {
  interface Window {
    __mapThumb?: { mapId: string; render: () => Promise<string> };
  }
}

window.__mapThumb = { mapId, render };
