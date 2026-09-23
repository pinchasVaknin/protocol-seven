import * as THREE from 'three';
import { lerp } from '../../shared/core/MathUtil';
import type { AttachmentId } from '../../shared/weapons/Attachments';
import { DEFAULT_VIEWMODEL_CONFIG } from '../../shared/weapons/ViewmodelConfig';
import { ALL_WEAPONS, WEAPON_DEFS } from '../../shared/weapons/WeaponDefs';
import { DEFAULT_CAMERA_CONFIG } from '../player/CameraConfig';
import { ViewmodelLayer } from '../player/Viewmodel';
import { handPoseFor, handPoseSource, type HandPose, type HandSide } from '../weapons/HandPoses';
import { makeViewmodelDrive, ViewmodelAnim } from '../weapons/ViewmodelAnim';
import { WeaponAssetService } from '../weapons/WeaponAssetService';
import { buildWeaponModel, type WeaponModel } from '../weapons/WeaponMesh';

/**
 * The hand tuner (M19, stage 4): a dev page for posing the first-person hands weapon by weapon.
 *
 * The arms' first playtest found one hold for every weapon crooked on some and in the way on
 * others, and asked for a way to pose them by eye rather than by guesswork. This is it: the
 * real viewmodel — `WeaponAssetService`, `buildWeaponModel`, `ViewmodelAnim` and the viewmodel
 * camera, exactly what a match draws — with every correction `HandPoses` holds on a slider,
 * applied live through `ViewmodelHands.adjust`.
 *
 * A page of its own rather than a panel in the Testbed because the Testbed cannot hold a free
 * cursor and the view at once: the sliders would only work on the pause screen, behind the
 * pause menu, and a match holds two weapons, so posing ten would be ten match restarts. Here
 * the weapon is a menu, the pose is hip, ADS or any moment of a reload, and the camera can be
 * the eye or orbit the gun.
 *
 * Edits persist in this browser (localStorage) per weapon until copied out; the output box
 * prints each weapon's entry in `HAND_POSES`' own shape, and every change is logged to the
 * console as well.
 */

type Pose = 'hip' | 'ads' | 'reload';
type View = 'eye' | 'right' | 'left' | 'above' | 'below' | 'front';

const STORE_KEY = 'protocolSeven.handTuner.v1';
const SIDES: readonly HandSide[] = ['grip', 'support'];
const SIDE_LABEL: Readonly<Record<HandSide, string>> = { grip: 'RIGHT HAND — socket_grip', support: 'LEFT HAND — socket_support' };

/** Orbit presets: azimuth and elevation, radians, around the weapon; the eye is the viewmodel camera. */
const VIEWS: Readonly<Record<Exclude<View, 'eye'>, { theta: number; phi: number }>> = {
  right: { theta: Math.PI / 2, phi: 0.12 },
  left: { theta: -Math.PI / 2, phi: 0.12 },
  above: { theta: 0.2, phi: 1.25 },
  below: { theta: 0.3, phi: -1.1 },
  front: { theta: Math.PI, phi: 0.15 },
};

interface Slider {
  readonly key: 'x' | 'y' | 'z' | 'pitch' | 'yaw' | 'roll' | 'curl';
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const SLIDERS: readonly Slider[] = [
  { key: 'x', label: 'X (m)', min: -0.12, max: 0.12, step: 0.001 },
  { key: 'y', label: 'Y (m)', min: -0.12, max: 0.12, step: 0.001 },
  { key: 'z', label: 'Z (m)', min: -0.12, max: 0.12, step: 0.001 },
  { key: 'pitch', label: 'Pitch°', min: -180, max: 180, step: 0.5 },
  { key: 'yaw', label: 'Yaw°', min: -180, max: 180, step: 0.5 },
  { key: 'roll', label: 'Roll°', min: -180, max: 180, step: 0.5 },
  { key: 'curl', label: 'Curl ×', min: 0.2, max: 1.8, step: 0.01 },
];

type Edits = Record<string, Record<HandSide, HandPose>>;

function loadEdits(): Edits {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Edits) : {};
  } catch {
    return {};
  }
}

function saveEdits(edits: Edits): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(edits));
  } catch {
    // A private window: the session keeps its edits, the next one starts from the table.
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Partial<HTMLElementTagNameMap[K]> = {}, text?: string): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), attrs);
  if (text !== undefined) el.textContent = text;
  return el;
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`hand tuner: the page has no #${id}`);
  return el;
}
const viewHost = requireElement('view');
const panel = requireElement('panel');
const hint = requireElement('hint');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x3d434d);
viewHost.prepend(renderer.domElement);

const layer = new ViewmodelLayer(DEFAULT_CAMERA_CONFIG);
const orbitCamera = new THREE.PerspectiveCamera(32, 1, 0.005, 20);
layer.camera.add(orbitCamera);

/** Where the sockets are, drawn in the orbit views: green the grip, orange the support. */
const markerGeometry = new THREE.SphereGeometry(0.006, 12, 8);
const markers: Record<HandSide, THREE.Mesh> = {
  grip: new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: 0x4dff88, depthTest: false })),
  support: new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: 0xffa640, depthTest: false })),
};
for (const m of Object.values(markers)) {
  m.renderOrder = 10;
  layer.camera.add(m);
}

const assets = new WeaponAssetService();
const edits = loadEdits();
const params = new URLSearchParams(window.location.search);
const state = {
  weaponId: params.get('weapon') ?? (WEAPON_DEFS['ar_carbine'] !== undefined ? 'ar_carbine' : ALL_WEAPONS[0]!.id),
  pose: 'hip' as Pose,
  reload: 0.4,
  view: 'eye' as View,
  optic: false,
  sockets: true,
  orbit: { theta: Math.PI / 2, phi: 0.12, radius: 0.75 },
};
let model: WeaponModel | null = null;
let anim: ViewmodelAnim | null = null;
let loading = 0;

// -- the panel ----------------------------------------------------------------------------

panel.append(element('h1', {}, 'HAND TUNER'));
const weaponSelect = element('select');
for (const def of ALL_WEAPONS) weaponSelect.append(element('option', { value: def.id }, `${def.name} — ${def.id}`));
weaponSelect.value = state.weaponId;
weaponSelect.addEventListener('change', () => void load(weaponSelect.value));
const opticBox = element('input', { type: 'checkbox' });
opticBox.addEventListener('change', () => {
  state.optic = opticBox.checked;
  void load(state.weaponId);
});
const socketsBox = element('input', { type: 'checkbox', checked: true });
socketsBox.addEventListener('change', () => (state.sockets = socketsBox.checked));
const weaponBar = element('div', { className: 'bar' });
weaponBar.append(weaponSelect);
const optionsBar = element('div', { className: 'bar' });
const opticLabel = element('label', { className: 'check' });
opticLabel.append(opticBox, 'HYBRID OPTIC');
const socketsLabel = element('label', { className: 'check' });
socketsLabel.append(socketsBox, 'show sockets (orbit views)');
optionsBar.append(opticLabel, socketsLabel);
panel.append(weaponBar, optionsBar);

function buttonGroup<T extends string>(title: string, options: readonly T[], get: () => T, set: (v: T) => void): HTMLElement {
  const box = element('div');
  box.append(element('h2', {}, title));
  const bar = element('div', { className: 'bar' });
  const buttons = options.map((o) => {
    const b = element('button', { type: 'button' }, o.toUpperCase());
    b.addEventListener('click', () => {
      set(o);
      refresh();
    });
    bar.append(b);
    return [o, b] as const;
  });
  const refresh = (): void => {
    for (const [o, b] of buttons) b.classList.toggle('on', o === get());
  };
  refresh();
  box.append(bar);
  return box;
}

panel.append(
  buttonGroup<Pose>('POSE', ['hip', 'ads', 'reload'], () => state.pose, (v) => (state.pose = v)),
);
const reloadRow = element('div', { className: 'row' });
const reloadRange = element('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(state.reload) });
const reloadValue = element('span', { className: 'small' }, state.reload.toFixed(2));
reloadRange.addEventListener('input', () => {
  state.reload = Number(reloadRange.value);
  reloadValue.textContent = state.reload.toFixed(2);
});
reloadRow.append(element('span', { className: 'small' }, 'reload t'), reloadRange, reloadValue);
panel.append(reloadRow);
panel.append(
  buttonGroup<View>('VIEW', ['eye', 'right', 'left', 'above', 'below', 'front'], () => state.view, (v) => {
    state.view = v;
    if (v !== 'eye') Object.assign(state.orbit, VIEWS[v]);
  }),
);

/** The number inputs and ranges per hand and key, so a weapon change can write them all. */
const controls = new Map<string, { range: HTMLInputElement; number: HTMLInputElement }>();

function poseOf(side: HandSide): HandPose {
  const a = model?.hands?.adjust[side];
  if (a === undefined) return handPoseFor(state.weaponId, side);
  return { position: [a.position.x, a.position.y, a.position.z], rotation: [a.rotation.x, a.rotation.y, a.rotation.z], curl: a.curl };
}

function valueOf(side: HandSide, key: Slider['key']): number {
  const p = poseOf(side);
  switch (key) {
    case 'x': return p.position[0];
    case 'y': return p.position[1];
    case 'z': return p.position[2];
    case 'pitch': return p.rotation[0];
    case 'yaw': return p.rotation[1];
    case 'roll': return p.rotation[2];
    case 'curl': return p.curl;
  }
}

function write(side: HandSide, key: Slider['key'], value: number): void {
  const a = model?.hands?.adjust[side];
  if (a === undefined) return;
  if (key === 'x') a.position.x = value;
  else if (key === 'y') a.position.y = value;
  else if (key === 'z') a.position.z = value;
  else if (key === 'pitch') a.rotation.x = value;
  else if (key === 'yaw') a.rotation.y = value;
  else if (key === 'roll') a.rotation.z = value;
  else a.curl = value;
  remember();
}

function setHand(side: HandSide, pose: HandPose): void {
  const a = model?.hands?.adjust[side];
  if (a === undefined) return;
  a.position.set(...pose.position);
  a.rotation.set(...pose.rotation);
  a.curl = pose.curl;
}

for (const side of SIDES) {
  const title = element('h2', {}, SIDE_LABEL[side]);
  const reset = element('button', { type: 'button' }, 'reset');
  reset.addEventListener('click', () => {
    setHand(side, handPoseFor(state.weaponId, side));
    remember();
    syncControls();
  });
  title.append(reset);
  panel.append(title);
  for (const s of SLIDERS) {
    const row = element('div', { className: 'row' });
    const range = element('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step) });
    const number = element('input', { type: 'number', step: String(s.step) });
    range.addEventListener('input', () => {
      number.value = range.value;
      write(side, s.key, Number(range.value));
    });
    number.addEventListener('input', () => {
      const v = Number(number.value);
      if (!Number.isFinite(v)) return;
      range.value = String(v);
      write(side, s.key, v);
    });
    row.append(element('span', { className: 'small' }, s.label), range, number);
    panel.append(row);
    controls.set(`${side}.${s.key}`, { range, number });
  }
}

function syncControls(): void {
  for (const side of SIDES) {
    for (const s of SLIDERS) {
      const c = controls.get(`${side}.${s.key}`);
      if (c === undefined) continue;
      const v = valueOf(side, s.key);
      c.range.value = String(v);
      c.number.value = String(Number(v.toFixed(s.step < 0.01 ? 3 : 2)));
    }
  }
  writeOutput();
}

panel.append(element('h2', {}, 'OUTPUT — paste into HAND_POSES'));
const output = element('textarea', { readOnly: true, spellcheck: false });
panel.append(output);
const outBar = element('div', { className: 'bar' });
const copyOne = element('button', { type: 'button' }, 'copy this weapon');
const copyAll = element('button', { type: 'button' }, 'copy all tuned');
const resetWeapon = element('button', { type: 'button' }, 'reset weapon');
const clearAll = element('button', { type: 'button' }, 'forget all edits');
outBar.append(copyOne, copyAll, resetWeapon, clearAll);
panel.append(outBar);
panel.append(element('div', { className: 'small' }, 'Edits are kept in this browser per weapon. Right-drag or drag in an orbit view turns it; the wheel zooms.'));

function entryFor(weaponId: string): string {
  const e = edits[weaponId];
  if (e === undefined) return '';
  return handPoseSource(weaponId, e);
}

function writeOutput(): void {
  const mine = handPoseSource(state.weaponId, { grip: poseOf('grip'), support: poseOf('support') });
  const others = Object.keys(edits)
    .filter((id) => id !== state.weaponId)
    .sort()
    .map(entryFor);
  output.value = [`// ${state.weaponId}`, mine, ...(others.length > 0 ? ['', '// every other tuned weapon', ...others] : [])].join('\n');
}

let logTimer = 0;
function remember(): void {
  edits[state.weaponId] = { grip: poseOf('grip'), support: poseOf('support') };
  saveEdits(edits);
  writeOutput();
  window.clearTimeout(logTimer);
  logTimer = window.setTimeout(() => console.log(`[hand tuner]\n${entryFor(state.weaponId)}`), 300);
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    output.select();
  }
  console.log(`[hand tuner] copied:\n${text}`);
}
copyOne.addEventListener('click', () => void copy(handPoseSource(state.weaponId, { grip: poseOf('grip'), support: poseOf('support') })));
copyAll.addEventListener('click', () => {
  remember();
  void copy(Object.keys(edits).sort().map(entryFor).join('\n'));
});
resetWeapon.addEventListener('click', () => {
  for (const side of SIDES) setHand(side, handPoseFor(state.weaponId, side));
  delete edits[state.weaponId];
  saveEdits(edits);
  syncControls();
});
clearAll.addEventListener('click', () => {
  if (!window.confirm('Forget every weapon\'s edits in this browser?')) return;
  for (const id of Object.keys(edits)) delete edits[id];
  saveEdits(edits);
  for (const side of SIDES) setHand(side, handPoseFor(state.weaponId, side));
  syncControls();
});

// -- the weapon ----------------------------------------------------------------------------

async function load(weaponId: string): Promise<void> {
  const ticket = ++loading;
  state.weaponId = weaponId;
  hint.textContent = `loading ${weaponId}…`;
  await Promise.all([assets.preload(weaponId).catch(() => undefined), assets.preloadHands().catch(() => undefined)]);
  if (ticket !== loading) return;
  if (model !== null) {
    layer.remove(model.root);
    model.dispose();
  }
  const attachments: AttachmentId[] = state.optic ? ['optic_reflex'] : [];
  model = buildWeaponModel(weaponId, 8, null, { hands: true, assets, attachments });
  layer.add(model.root);
  anim = new ViewmodelAnim(model);
  const saved = edits[weaponId];
  if (saved !== undefined) for (const side of SIDES) setHand(side, saved[side]);
  syncControls();
  const url = new URL(window.location.href);
  url.searchParams.set('weapon', weaponId);
  window.history.replaceState(null, '', url);
  hint.textContent =
    model.hands === null
      ? 'the hands file did not load — the boxes stand in; is hands.glb built?'
      : `${weaponId} · ${model.source === 'glb' ? 'file' : 'primitives'} · drag to orbit in the side views`;
}

// -- the camera and the loop -----------------------------------------------------------------

let dragging = false;
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state.view === 'eye') return;
  dragging = true;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => (dragging = false));
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  state.orbit.theta -= e.movementX * 0.008;
  state.orbit.phi = Math.max(-1.5, Math.min(1.5, state.orbit.phi + e.movementY * 0.008));
});
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    if (state.view === 'eye') return;
    e.preventDefault();
    state.orbit.radius = Math.max(0.2, Math.min(2, state.orbit.radius * Math.exp(e.deltaY * 0.001)));
  },
  { passive: false },
);

function resize(): void {
  const w = viewHost.clientWidth;
  const h = viewHost.clientHeight;
  renderer.setSize(w, h, false);
  layer.resize(w / Math.max(1, h));
  orbitCamera.aspect = w / Math.max(1, h);
  orbitCamera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewHost);
resize();

const drive = makeViewmodelDrive();
const socketAt = new THREE.Vector3();
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (model !== null && anim !== null) {
    const ads = state.pose === 'ads' ? 1 : 0;
    drive.adsFraction = ads;
    drive.reloading = state.pose === 'reload';
    drive.reloadFraction = state.reload;
    anim.update(drive, DEFAULT_VIEWMODEL_CONFIG, dt);
    const def = WEAPON_DEFS[model.weaponId];
    layer.setFov(DEFAULT_CAMERA_CONFIG.viewmodelFov * lerp(1, def?.adsViewmodelFovScale ?? 1, ads));
    layer.scene.updateMatrixWorld(true);

    const outside = state.view !== 'eye';
    for (const side of SIDES) {
      const target = model.root.getObjectByName(`viewmodel:hand-target:${side}`);
      const m = markers[side];
      m.visible = outside && state.sockets && target !== undefined;
      if (target !== undefined) m.position.copy(layer.camera.worldToLocal(target.getWorldPosition(socketAt)));
    }
    if (outside) {
      const pivot = model.root.position;
      const { theta, phi, radius } = state.orbit;
      orbitCamera.position.set(
        pivot.x + radius * Math.cos(phi) * Math.sin(theta),
        pivot.y + radius * Math.sin(phi),
        pivot.z + radius * Math.cos(phi) * Math.cos(theta),
      );
      orbitCamera.lookAt(layer.camera.localToWorld(pivot.clone()));
      renderer.render(layer.scene, orbitCamera);
    } else {
      renderer.render(layer.scene, layer.camera);
    }
  }
  requestAnimationFrame(frame);
}

void load(state.weaponId);
requestAnimationFrame(frame);
