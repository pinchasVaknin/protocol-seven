import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The prop tuner (2026-09-27): a dev page for laying out a station by eye.
 *
 * The first resupply station was arranged in a Blender script — four placements written as
 * numbers by someone who could not see the result until it was built — and the human would
 * rather do it the way the weapons were done: look at it, move it, copy the numbers out. This
 * is that page.
 *
 * ## What it is, and what it is not
 *
 * It loads the **pieces** `scripts/prop-build.mjs` writes: each Sketchfab crate normalised to
 * life size, upright, standing on its own origin. So every number here is placement and nothing
 * else — a piece at `[0, 0, 0]` with scale 1 sits on the ground at the mark, at the size its
 * author drew it. `scale` is therefore a *correction*, and a piece left at 1 is a piece nobody
 * had to argue with.
 *
 * It is not the game's renderer. A station is scenery: it has no viewmodel, no hands and no
 * animation, so there is nothing to reproduce faithfully and a plain orbit view over a ground
 * grid is a better instrument than a first-person camera would be. The one thing it does share
 * with the match is the **scale**: a 1.8 m capsule stands beside the pile, because "is this
 * crate too big" is a question about a person.
 *
 * ## The output
 *
 * A `STATION_PIECES` array, in the shape `scripts/prop-assemble.mjs` reads: for each item, the
 * piece it is built from and its position, rotation and scale. The assembler welds the model
 * from exactly those numbers and derives the collision boxes from the same ones, so what is
 * arranged here and what a player walks into cannot drift apart.
 */

// -- the pieces ---------------------------------------------------------------------------

const PIECES_ROOT = '/models/props';

/** The files `prop-build` writes, by the id it writes them under. */
const PIECE_FILES = ['crate_stand', 'crate_open', 'ammo_can'] as const;
type PieceId = (typeof PIECE_FILES)[number];

/**
 * One thing standing in the station, and the piece it is drawn from.
 *
 * Two entries share `ammo_can`, which is the whole reason an item has an id of its own: the
 * station has two cans and they are in different places.
 */
interface Item {
  readonly id: string;
  readonly piece: PieceId;
  position: [number, number, number];
  /** Degrees, applied YXZ — yaw first, because yaw is the one a crate on a floor mostly needs. */
  rotation: [number, number, number];
  scale: number;
}

/** Where the four start: the arrangement the human asked for, unrefined. */
const DEFAULT_ITEMS: readonly Item[] = [
  { id: 'stand', piece: 'crate_stand', position: [0, 0, -0.45], rotation: [0, 4, 0], scale: 1 },
  { id: 'open', piece: 'crate_open', position: [0.5, 0, 0.3], rotation: [0, -19, 0], scale: 1 },
  { id: 'can_a', piece: 'ammo_can', position: [-0.5, 0, 0.15], rotation: [0, 24, 0], scale: 1 },
  { id: 'can_b', piece: 'ammo_can', position: [-0.58, 0, -0.15], rotation: [0, -11, 0], scale: 1 },
];

const STORE_KEY = 'protocolSeven.propTuner.v1';

function loadItems(): Item[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Item[];
  } catch {
    /* a browser with storage off is a browser that starts from the defaults */
  }
  return DEFAULT_ITEMS.map((i) => ({ ...i, position: [...i.position] as [number, number, number], rotation: [...i.rotation] as [number, number, number] }));
}

function saveItems(items: readonly Item[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(items));
  } catch {
    /* nothing to do: the output box is the real record, and it is on screen */
  }
}

// -- the page -----------------------------------------------------------------------------

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  if (text !== undefined) el.textContent = text;
  return el;
}

const viewHost0 = document.getElementById('view');
const panel0 = document.getElementById('panel');
const hint0 = document.getElementById('hint');
if (viewHost0 === null || panel0 === null || hint0 === null) throw new Error('prop tuner: the page is missing #view, #panel or #hint');
// Bound to non-null names so the closures below do not each have to re-prove it.
const viewHost: HTMLElement = viewHost0;
const panel: HTMLElement = panel0;
const hint: HTMLElement = hint0;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
const orbit = { theta: Math.PI * 0.25, phi: 0.45, radius: 5.0, target: new THREE.Vector3(0, 0.35, 0) };

/**
 * Light it like a thing on the ground outdoors: one sun that casts, one fill that does not.
 * The shadow matters — a crate floating a centimetre over the floor is invisible without one,
 * and floating crates are exactly what this page exists to catch.
 */
const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
sun.position.set(3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3;
sun.shadow.camera.top = 3;
sun.shadow.camera.bottom = -3;
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 20;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9fb4cc, 0x2a2622, 1.1));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(8, 32, 0x5fc3ff, 0x2a2f37);
(grid.material as THREE.Material).opacity = 0.35;
(grid.material as THREE.Material).transparent = true;
scene.add(grid);

/**
 * A person, for scale. 1.8 m standing, at the edge of the pile rather than in it: the question
 * a station has to answer at a glance is "can I see over that, and can I get to it".
 */
const figure = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.22, 1.36, 4, 12),
  new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.9 }),
);
// Off the back corner: near enough to measure against, far enough not to stand in the shot.
figure.position.set(1.45, 0.9, -1.15);
figure.castShadow = true;
scene.add(figure);

// -- loading ------------------------------------------------------------------------------

const loader = new GLTFLoader();
const templates = new Map<PieceId, THREE.Object3D>();
const items: Item[] = loadItems();
const roots = new Map<string, THREE.Object3D>();
let selected = items[0]?.id ?? '';

async function loadPieces(): Promise<void> {
  hint.textContent = 'loading the pieces…';
  const results = await Promise.allSettled(
    PIECE_FILES.map(async (id) => {
      const gltf = await loader.loadAsync(`${PIECES_ROOT}/${id}.glb`);
      templates.set(id, gltf.scene);
    }),
  );
  const missing = PIECE_FILES.filter((id) => !templates.has(id));
  if (missing.length > 0) {
    hint.textContent = `missing ${missing.join(', ')} — run \`node scripts/prop-build.mjs\``;
    // Not fatal: the ones that did arrive are still worth placing.
    for (const r of results) if (r.status === 'rejected') console.warn('[prop tuner]', r.reason);
  } else {
    hint.textContent = 'drag to orbit · wheel to zoom · right-drag to pan';
  }
  rebuild();
}

/** Put every item's clone in the scene, replacing whatever was there. */
function rebuild(): void {
  for (const root of roots.values()) scene.remove(root);
  roots.clear();
  for (const item of items) {
    const template = templates.get(item.piece);
    if (template === undefined) continue;
    const clone = template.clone(true);
    clone.name = `item:${item.id}`;
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    scene.add(clone);
    roots.set(item.id, clone);
  }
  applyTransforms();
}

const DEG2RAD = Math.PI / 180;

function applyTransforms(): void {
  for (const item of items) {
    const root = roots.get(item.id);
    if (root === undefined) continue;
    root.position.set(item.position[0], item.position[1], item.position[2]);
    root.rotation.set(item.rotation[0] * DEG2RAD, item.rotation[1] * DEG2RAD, item.rotation[2] * DEG2RAD, 'YXZ');
    root.scale.setScalar(item.scale);
  }
}

// -- the panel ----------------------------------------------------------------------------

panel.append(element('h1', {}, 'PROP TUNER — resupply station'));
panel.append(
  element(
    'div',
    { className: 'small' },
    'The pieces are life size and stand on their own origin, so these are placements. Scale is a correction: 1 is the size the artist drew.',
  ),
);

const itemBar = element('div', { className: 'bar' });
panel.append(element('h2', {}, 'PIECE'));
panel.append(itemBar);

interface Slider {
  key: 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 'scale';
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: readonly Slider[] = [
  { key: 'x', label: 'X (m)', min: -2.5, max: 2.5, step: 0.005 },
  { key: 'y', label: 'Y (m)', min: -0.5, max: 2.5, step: 0.005 },
  { key: 'z', label: 'Z (m)', min: -2.5, max: 2.5, step: 0.005 },
  { key: 'rx', label: 'Pitch°', min: -180, max: 180, step: 0.5 },
  { key: 'ry', label: 'Yaw°', min: -180, max: 180, step: 0.5 },
  { key: 'rz', label: 'Roll°', min: -180, max: 180, step: 0.5 },
  { key: 'scale', label: 'Scale ×', min: 0.2, max: 3, step: 0.01 },
];

function read(item: Item, key: Slider['key']): number {
  switch (key) {
    case 'x': return item.position[0];
    case 'y': return item.position[1];
    case 'z': return item.position[2];
    case 'rx': return item.rotation[0];
    case 'ry': return item.rotation[1];
    case 'rz': return item.rotation[2];
    case 'scale': return item.scale;
  }
}

function write(item: Item, key: Slider['key'], v: number): void {
  switch (key) {
    case 'x': item.position[0] = v; break;
    case 'y': item.position[1] = v; break;
    case 'z': item.position[2] = v; break;
    case 'rx': item.rotation[0] = v; break;
    case 'ry': item.rotation[1] = v; break;
    case 'rz': item.rotation[2] = v; break;
    case 'scale': item.scale = v; break;
  }
}

const controls = new Map<string, { range: HTMLInputElement; number: HTMLInputElement }>();

/**
 * One block per item, all on screen at once.
 *
 * Not a "selected item" panel with one set of sliders: arranging a pile is a conversation
 * between the things in it, and nudging the can means looking at the crate beside it. The
 * PIECE buttons only say which one the camera frames and which one is lit up.
 */
for (const item of items) {
  const title = element('h2', {}, `${item.id.toUpperCase()} — ${item.piece}`);
  const reset = element('button', { type: 'button' }, 'reset');
  reset.addEventListener('click', () => {
    const base = DEFAULT_ITEMS.find((d) => d.id === item.id);
    if (base === undefined) return;
    item.position = [...base.position] as [number, number, number];
    item.rotation = [...base.rotation] as [number, number, number];
    item.scale = base.scale;
    sync();
  });
  title.append(reset);
  title.addEventListener('click', () => {
    selected = item.id;
    sync();
  });
  panel.append(title);
  for (const s of SLIDERS) {
    const row = element('div', { className: 'row' });
    const range = element('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step) });
    const number = element('input', { type: 'number', step: String(s.step) });
    const set = (v: number): void => {
      if (!Number.isFinite(v)) return;
      write(item, s.key, v);
      selected = item.id;
      applyTransforms();
      saveItems(items);
      writeOutput();
      syncButtons();
    };
    range.addEventListener('input', () => {
      number.value = range.value;
      set(Number(range.value));
    });
    number.addEventListener('input', () => {
      range.value = number.value;
      set(Number(number.value));
    });
    row.append(element('span', { className: 'small' }, s.label), range, number);
    panel.append(row);
    controls.set(`${item.id}.${s.key}`, { range, number });
  }
}

for (const item of items) {
  const b = element('button', { type: 'button' }, item.id.toUpperCase());
  b.addEventListener('click', () => {
    selected = item.id;
    const root = roots.get(item.id);
    if (root !== undefined) orbit.target.set(root.position.x, root.position.y + 0.25, root.position.z);
    sync();
  });
  itemBar.append(b);
}
const frameAll = element('button', { type: 'button' }, 'FRAME ALL');
frameAll.addEventListener('click', () => {
  orbit.target.set(0, 0.35, 0);
  orbit.radius = 5.0;
});
itemBar.append(frameAll);

const showFigure = element('input', { type: 'checkbox', checked: true });
showFigure.addEventListener('change', () => (figure.visible = showFigure.checked));
const showGrid = element('input', { type: 'checkbox', checked: true });
showGrid.addEventListener('change', () => (grid.visible = showGrid.checked));
const optionsBar = element('div', { className: 'bar' });
const figureLabel = element('label', { className: 'check' });
figureLabel.append(showFigure, document.createTextNode('1.8 m figure'));
const gridLabel = element('label', { className: 'check' });
gridLabel.append(showGrid, document.createTextNode('grid (25 cm)'));
optionsBar.append(figureLabel, gridLabel);
panel.append(optionsBar);

// -- output -------------------------------------------------------------------------------

panel.append(element('h2', {}, 'OUTPUT — paste into STATION_PIECES'));
const output = element('textarea', { readOnly: true });
panel.append(output);
const outBar = element('div', { className: 'bar' });
const copyAll = element('button', { type: 'button' }, 'copy');
const resetAll = element('button', { type: 'button' }, 'reset all');
outBar.append(copyAll, resetAll);
panel.append(outBar);

const n = (v: number, digits: number): string => {
  const s = v.toFixed(digits);
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
};

function sourceFor(): string {
  const rows = items.map(
    (i) =>
      `  { id: '${i.id}', piece: '${i.piece}', position: [${i.position.map((v) => n(v, 3)).join(', ')}], ` +
      `rotation: [${i.rotation.map((v) => n(v, 1)).join(', ')}], scale: ${n(i.scale, 3)} },`,
  );
  return ['// scripts/prop-assemble.mjs — STATION_PIECES', 'export const STATION_PIECES = [', ...rows, '];'].join('\n');
}

function writeOutput(): void {
  output.value = sourceFor();
}

copyAll.addEventListener('click', () => {
  const text = sourceFor();
  void navigator.clipboard?.writeText(text).catch(() => undefined);
  console.log(`[prop tuner] copied:\n${text}`);
});
resetAll.addEventListener('click', () => {
  for (const item of items) {
    const base = DEFAULT_ITEMS.find((d) => d.id === item.id);
    if (base === undefined) continue;
    item.position = [...base.position] as [number, number, number];
    item.rotation = [...base.rotation] as [number, number, number];
    item.scale = base.scale;
  }
  sync();
});

function syncButtons(): void {
  const buttons = [...itemBar.querySelectorAll('button')];
  for (const b of buttons) b.classList.toggle('on', b.textContent === selected.toUpperCase());
  for (const h of panel.querySelectorAll('h2')) {
    h.classList.toggle('sel', h.textContent?.startsWith(`${selected.toUpperCase()} —`) === true);
  }
}

function sync(): void {
  for (const item of items) {
    for (const s of SLIDERS) {
      const c = controls.get(`${item.id}.${s.key}`);
      if (c === undefined) continue;
      const v = read(item, s.key);
      c.range.value = String(v);
      c.number.value = String(Number(v.toFixed(3)));
    }
  }
  applyTransforms();
  saveItems(items);
  writeOutput();
  syncButtons();
}

// -- the camera and the loop ---------------------------------------------------------------

let dragging: 'orbit' | 'pan' | null = null;
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => (dragging = null));
renderer.domElement.addEventListener('pointermove', (e) => {
  if (dragging === null) return;
  if (dragging === 'orbit') {
    orbit.theta -= e.movementX * 0.006;
    orbit.phi = Math.max(0.02, Math.min(1.5, orbit.phi + e.movementY * 0.006));
    return;
  }
  // Pan across the ground, in the camera's own left/forward, so a drag goes where it looks.
  const right = new THREE.Vector3(Math.cos(orbit.theta), 0, -Math.sin(orbit.theta));
  const forward = new THREE.Vector3(Math.sin(orbit.theta), 0, Math.cos(orbit.theta));
  const k = orbit.radius * 0.0016;
  orbit.target.addScaledVector(right, -e.movementX * k);
  orbit.target.addScaledVector(forward, e.movementY * k);
});
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    orbit.radius = Math.max(0.6, Math.min(14, orbit.radius * Math.exp(e.deltaY * 0.001)));
  },
  { passive: false },
);

function resize(): void {
  const w = viewHost.clientWidth;
  const h = viewHost.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function frame(): void {
  camera.position.set(
    orbit.target.x + orbit.radius * Math.cos(orbit.phi) * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * Math.sin(orbit.phi),
    orbit.target.z + orbit.radius * Math.cos(orbit.phi) * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

sync();
void loadPieces();
requestAnimationFrame(frame);
