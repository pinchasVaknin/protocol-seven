import * as THREE from 'three';
import { lerp } from '../../shared/core/MathUtil';
import type { AttachmentId } from '../../shared/weapons/Attachments';
import { DEFAULT_VIEWMODEL_CONFIG } from '../../shared/weapons/ViewmodelConfig';
import { ALL_WEAPONS, WEAPON_DEFS } from '../../shared/weapons/WeaponDefs';
import { DEFAULT_CAMERA_CONFIG } from '../player/CameraConfig';
import { ViewmodelLayer } from '../player/Viewmodel';
import { handPoseFor, handPoseSource, type HandPose, type HandSide } from '../weapons/HandPoses';
import { buildKnifeModel, type KnifeModel } from '../weapons/KnifeMesh';
import { FINGERS, holdCurlSource, KNIFE_HOLD_CURL, type FingerCurl, type FingerName } from '../weapons/ViewmodelHands';
import {
  KNIFE_SWING,
  knifeSwingSource,
  makeViewmodelDrive,
  ViewmodelAnim,
  type KnifePose,
  type KnifeSwing,
} from '../weapons/ViewmodelAnim';
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
 * **The knife is in the menu too** (stage 5). It is held in one hand, so the page shows one
 * hand's sliders; and it has no hip, ADS or reload — it has a *swing*, so hip/ADS/reload give
 * way to READY, WIND-UP and STRIKE, the three keyframes `ViewmodelAnim` blends, with a slider
 * for anywhere between them. Both halves are editable and both are printed: the hold on the
 * handle in `HAND_POSES`' shape, and the three keyframes in the shape of the `KnifePose`
 * constants they are, ready to paste back into `ViewmodelAnim.ts`.
 *
 * Edits persist in this browser (localStorage) per weapon until copied out; the output box
 * prints each weapon's entry in `HAND_POSES`' own shape, and every change is logged to the
 * console as well.
 */

type Pose = 'hip' | 'ads' | 'reload';
/** The knife's three keyframes, which take the place of hip/ADS/reload when it is up. */
type Swing = 'ready' | 'windup' | 'strike';
type View = 'eye' | 'right' | 'left' | 'above' | 'below' | 'front';

/**
 * The knife in the weapon menu (M19, stage 5).
 *
 * It is not a `WeaponDef` — melee is a thing you do, not a weapon you carry (`weapons/Melee.ts`)
 * — so it is named here rather than found in `ALL_WEAPONS`, and everything downstream asks
 * `isKnife` rather than looking it up. Its hand pose lives in `HAND_POSES` under the same id the
 * build gives its file, so the table needs no special case for it.
 */
const KNIFE_ID = 'knife';
const isKnife = (id: string): boolean => id === KNIFE_ID;

/** Where in the swing each keyframe is exactly — `ViewmodelAnim`'s own WINDUP_AT and STRIKE_AT. */
const SWING_T: Readonly<Record<Swing, number>> = { ready: 0, windup: 0.13, strike: 0.222 };
const SWING_LABEL: Readonly<Record<Swing, string>> = {
  ready: 'READY — where the swing starts and ends',
  windup: 'WIND-UP — cocked back, t 0.13',
  strike: 'STRIKE — the frame the hitbox is tested on, t 0.222',
};

const STORE_KEY = 'protocolSeven.handTuner.v1';
const SIDES: readonly HandSide[] = ['grip', 'support', 'reload'];
const SIDE_LABEL: Readonly<Record<HandSide, string>> = {
  grip: 'RIGHT HAND — socket_grip',
  support: 'LEFT HAND — socket_support',
  reload: 'LEFT HAND ON THE MAGAZINE — reload',
};
/** The node each pose's hand is put on, under the weapon's root (`WeaponMesh.handTarget`). */
const TARGET: Readonly<Record<HandSide, string>> = {
  grip: 'viewmodel:hand-target:grip',
  support: 'viewmodel:hand-target:support',
  reload: 'viewmodel:hand-target:magazine',
};
/** A moment of a tactical reload when the support hand is wholly on the magazine. */
const ON_MAGAZINE_T = 0.42;

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

type Edits = Record<
  string,
  Partial<Record<HandSide, HandPose>> &
    Record<'grip' | 'support', HandPose> & { swing?: KnifeSwing; wrap?: Record<FingerName, FingerCurl> }
>;

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

/** Where the sockets are, drawn in the orbit views: green the grip, orange the support, cyan the magazine's grip. */
const markerGeometry = new THREE.SphereGeometry(0.006, 12, 8);
const markers: Record<HandSide, THREE.Mesh> = {
  grip: new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: 0x4dff88, depthTest: false })),
  support: new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: 0xffa640, depthTest: false })),
  reload: new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: 0x40e0ff, depthTest: false })),
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
  swing: 'ready' as Swing,
  /** Anywhere in the swing, so the hold can be read between the keyframes as well as on them. */
  swingT: 0,
  reload: 0.4,
  view: 'eye' as View,
  optic: false,
  sockets: true,
  orbit: { theta: Math.PI / 2, phi: 0.12, radius: 0.75 },
};
let model: WeaponModel | null = null;
let knife: KnifeModel | null = null;
let anim: ViewmodelAnim | null = null;
let loading = 0;

/** Whichever rig is on screen: the weapon's hands, or the knife's one hand. */
function hands(): {
  adjust: Record<HandSide, { position: THREE.Vector3; rotation: THREE.Vector3; curl: number }>;
  curl: Record<HandSide, Record<FingerName, FingerCurl>>;
} | null {
  return isKnife(state.weaponId) ? knife?.hands ?? null : model?.hands ?? null;
}

// -- the panel ----------------------------------------------------------------------------

panel.append(element('h1', {}, 'HAND TUNER'));
const weaponSelect = element('select');
for (const def of ALL_WEAPONS) weaponSelect.append(element('option', { value: def.id }, `${def.name} — ${def.id}`));
weaponSelect.append(element('option', { value: KNIFE_ID }, 'KNIFE — knife'));
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

function buttonGroup<T extends string>(title: string, options: readonly T[], get: () => T, set: (v: T) => void): HTMLElement & { refresh(): void } {
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
  return Object.assign(box, { refresh });
}

const poseButtons = buttonGroup<Pose>('POSE', ['hip', 'ads', 'reload'], () => state.pose, (v) => (state.pose = v));
panel.append(poseButtons);

/** The knife's own row: the three keyframes, and a slider for anywhere between them. */
const swingButtons = buttonGroup<Swing>('SWING', ['ready', 'windup', 'strike'], () => state.swing, (v) => {
  state.swing = v;
  state.swingT = SWING_T[v];
  swingRange.value = String(state.swingT);
  swingValue.textContent = state.swingT.toFixed(3);
  syncSwing();
});
const swingRow = element('div', { className: 'row' });
const swingRange = element('input', { type: 'range', min: '0', max: '1', step: '0.002', value: '0' });
const swingValue = element('span', { className: 'small' }, '0.000');
swingRange.addEventListener('input', () => {
  state.swingT = Number(swingRange.value);
  swingValue.textContent = state.swingT.toFixed(3);
});
swingRow.append(element('span', { className: 'small' }, 'swing t'), swingRange, swingValue);
panel.append(swingButtons, swingRow);

const reloadRow = element('div', { className: 'row' });
const reloadRange = element('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(state.reload) });
const reloadValue = element('span', { className: 'small' }, state.reload.toFixed(2));
reloadRange.addEventListener('input', () => {
  state.reload = Number(reloadRange.value);
  reloadValue.textContent = state.reload.toFixed(2);
});
reloadRow.append(element('span', { className: 'small' }, 'reload t'), reloadRange, reloadValue);
panel.append(reloadRow);

/** Show the reload with the hand on the magazine: what the magazine sliders pose. */
function showMagazineGrip(): void {
  if (state.pose === 'reload' && state.reload >= 0.2 && state.reload <= 0.64) return;
  state.pose = 'reload';
  state.reload = ON_MAGAZINE_T;
  reloadRange.value = String(ON_MAGAZINE_T);
  reloadValue.textContent = ON_MAGAZINE_T.toFixed(2);
  poseButtons.refresh();
}
panel.append(
  buttonGroup<View>('VIEW', ['eye', 'right', 'left', 'above', 'below', 'front'], () => state.view, (v) => {
    state.view = v;
    if (v !== 'eye') Object.assign(state.orbit, VIEWS[v]);
  }),
);

/** The number inputs and ranges per hand and key, so a weapon change can write them all. */
const controls = new Map<string, { range: HTMLInputElement; number: HTMLInputElement }>();

function poseOf(side: HandSide): HandPose {
  const a = hands()?.adjust[side];
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
  const a = hands()?.adjust[side];
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
  const a = hands()?.adjust[side];
  if (a === undefined) return;
  a.position.set(...pose.position);
  a.rotation.set(...pose.rotation);
  a.curl = pose.curl;
}

/** Each hand's heading and rows, so knife mode can leave the two it has no use for out. */
const handBlocks = new Map<HandSide, HTMLElement[]>();

for (const side of SIDES) {
  const owned: HTMLElement[] = [];
  const title = element('h2', {}, SIDE_LABEL[side]);
  owned.push(title);
  const reset = element('button', { type: 'button' }, 'reset');
  reset.addEventListener('click', () => {
    setHand(side, handPoseFor(state.weaponId, side));
    remember();
    syncControls();
  });
  title.append(reset);
  panel.append(title);
  if (side === 'reload') {
    const note = element(
      'div',
      { className: 'small' },
      "In the magazine's own space; the hand is on it from about t 0.2 to 0.64 of a reload. Touching these jumps to that moment.",
    );
    owned.push(note);
    panel.append(note);
  }
  for (const s of SLIDERS) {
    const row = element('div', { className: 'row' });
    const range = element('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step) });
    const number = element('input', { type: 'number', step: String(s.step) });
    range.addEventListener('input', () => {
      if (side === 'reload') showMagazineGrip();
      number.value = range.value;
      write(side, s.key, Number(range.value));
    });
    number.addEventListener('input', () => {
      const v = Number(number.value);
      if (!Number.isFinite(v)) return;
      if (side === 'reload') showMagazineGrip();
      range.value = String(v);
      write(side, s.key, v);
    });
    row.append(element('span', { className: 'small' }, s.label), range, number);
    panel.append(row);
    owned.push(row);
    controls.set(`${side}.${s.key}`, { range, number });
  }
  handBlocks.set(side, owned);
}

/**
 * The knife's swing: the three keyframes, six numbers each, edited live on `anim.knifeSwing`.
 *
 * These are the blade's own pose in viewmodel space — where the fist is and how the knife is
 * turned in it — not a correction on a socket, which is why they are metres and degrees on the
 * camera's axes and why the output prints them as the `KnifePose` constants they are.
 */
const SWING_SLIDERS: readonly Slider[] = [
  { key: 'x', label: 'X (m)', min: -0.6, max: 0.6, step: 0.005 },
  { key: 'y', label: 'Y (m)', min: -0.6, max: 0.6, step: 0.005 },
  { key: 'z', label: 'Z (m)', min: -0.8, max: 0.2, step: 0.005 },
  { key: 'pitch', label: 'Pitch°', min: -180, max: 180, step: 1 },
  { key: 'yaw', label: 'Yaw°', min: -180, max: 180, step: 1 },
  { key: 'roll', label: 'Roll°', min: -180, max: 180, step: 1 },
];
const SWINGS: readonly Swing[] = ['ready', 'windup', 'strike'];
const swingControls = new Map<string, { range: HTMLInputElement; number: HTMLInputElement }>();
const swingBlocks: HTMLElement[] = [];

function swingPose(which: Swing): KnifePose | null {
  return anim?.knifeSwing[which] ?? null;
}

function writeSwing(which: Swing, key: Slider['key'], value: number): void {
  const pose = swingPose(which);
  if (pose === null || key === 'curl') return;
  pose[key] = value;
  // Look at what is being edited: a number for the strike means nothing at the ready pose.
  if (state.swing !== which) {
    state.swing = which;
    state.swingT = SWING_T[which];
    swingRange.value = String(state.swingT);
    swingValue.textContent = state.swingT.toFixed(3);
    swingButtons.refresh();
  }
  remember();
}

for (const which of SWINGS) {
  const title = element('h2', {}, SWING_LABEL[which]);
  const reset = element('button', { type: 'button' }, 'reset');
  reset.addEventListener('click', () => {
    const pose = swingPose(which);
    if (pose !== null) Object.assign(pose, KNIFE_SWING[which]);
    remember();
    syncSwing();
  });
  title.append(reset);
  panel.append(title);
  swingBlocks.push(title);
  for (const s of SWING_SLIDERS) {
    const row = element('div', { className: 'row' });
    const range = element('input', { type: 'range', min: String(s.min), max: String(s.max), step: String(s.step) });
    const number = element('input', { type: 'number', step: String(s.step) });
    range.addEventListener('input', () => {
      number.value = range.value;
      writeSwing(which, s.key, Number(range.value));
    });
    number.addEventListener('input', () => {
      const v = Number(number.value);
      if (!Number.isFinite(v)) return;
      range.value = String(v);
      writeSwing(which, s.key, v);
    });
    row.append(element('span', { className: 'small' }, s.label), range, number);
    panel.append(row);
    swingBlocks.push(row);
    swingControls.set(`${which}.${s.key}`, { range, number });
  }
}

/**
 * The wrap: how far each finger closes round the handle, in degrees, segment by segment.
 *
 * `Curl ×` above scales the whole hand at once, which is the right dial for "this weapon needs
 * a looser fist" and the wrong one for "the index goes through the guard and the thumb floats".
 * A knife is held in a closed fist rather than on a trigger, so the shape of that fist is the
 * thing being tuned here — knuckle, middle, tip — and it prints as the `curl` line of the
 * `knife` hold in `ViewmodelHands.ts`.
 */
const SEGMENTS = ['knuckle', 'middle', 'tip'] as const;
const curlControls = new Map<string, HTMLInputElement>();
const curlBlocks: HTMLElement[] = [];

{
  const title = element('h2', {}, 'FINGERS — the wrap, degrees');
  const reset = element('button', { type: 'button' }, 'reset');
  reset.addEventListener('click', () => {
    const rig = hands();
    if (rig !== null) for (const f of FINGERS) rig.curl.grip[f] = [...KNIFE_HOLD_CURL[f]] as FingerCurl;
    remember();
    syncCurl();
  });
  title.append(reset);
  panel.append(title);
  curlBlocks.push(title);
  const legend = element('div', { className: 'small' }, 'knuckle · middle · tip — 0 is straight, 90 is folded');
  panel.append(legend);
  curlBlocks.push(legend);
  for (const f of FINGERS) {
    const row = element('div', { className: 'row' });
    row.append(element('span', { className: 'small' }, f));
    SEGMENTS.forEach((seg, i) => {
      const number = element('input', { type: 'number', step: '1', min: '-20', max: '140' });
      number.addEventListener('input', () => {
        const v = Number(number.value);
        if (!Number.isFinite(v)) return;
        const rig = hands();
        if (rig === null) return;
        rig.curl.grip[f][i] = v;
        remember();
      });
      row.append(number);
      curlControls.set(`${f}.${seg}`, number);
    });
    panel.append(row);
    curlBlocks.push(row);
  }
}

function syncCurl(): void {
  const rig = hands();
  for (const f of FINGERS) {
    SEGMENTS.forEach((seg, i) => {
      const input = curlControls.get(`${f}.${seg}`);
      if (input === undefined) return;
      input.value = String(Math.round(rig?.curl.grip[f][i] ?? 0));
    });
  }
  writeOutput();
}

function syncSwing(): void {
  for (const which of SWINGS) {
    const pose = swingPose(which);
    if (pose === null) continue;
    for (const s of SWING_SLIDERS) {
      const c = swingControls.get(`${which}.${s.key}`);
      if (c === undefined || s.key === 'curl') continue;
      const v = pose[s.key];
      c.range.value = String(v);
      c.number.value = String(Number(v.toFixed(3)));
    }
  }
  writeOutput();
}

/** Knife mode shows one hand and the swing; a weapon shows two hands, the reload and ADS. */
function applyMode(): void {
  const isBlade = isKnife(state.weaponId);
  for (const [side, block] of handBlocks) {
    const show = !isBlade || side === 'grip';
    for (const el of block) el.style.display = show ? '' : 'none';
  }
  for (const el of swingBlocks) el.style.display = isBlade ? '' : 'none';
  for (const el of curlBlocks) el.style.display = isBlade ? '' : 'none';
  swingButtons.style.display = isBlade ? '' : 'none';
  swingRow.style.display = isBlade ? '' : 'none';
  poseButtons.style.display = isBlade ? 'none' : '';
  reloadRow.style.display = isBlade ? 'none' : '';
  optionsBar.style.display = isBlade ? 'none' : '';
  const grip = handBlocks.get('grip')?.[0];
  if (grip !== undefined) grip.firstChild!.textContent = isBlade ? 'RIGHT HAND — the handle' : SIDE_LABEL.grip;
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
  syncCurl();
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

function currentPoses(): Record<HandSide, HandPose> {
  return { grip: poseOf('grip'), support: poseOf('support'), reload: poseOf('reload') };
}

function entryFor(weaponId: string): string {
  const e = edits[weaponId];
  if (e === undefined) return '';
  return handPoseSource(weaponId, { grip: e.grip, support: e.support, reload: e.reload ?? handPoseFor(weaponId, 'reload') });
}

function writeOutput(): void {
  if (isKnife(state.weaponId)) {
    const swing = anim?.knifeSwing;
    const rig = hands();
    output.value = [
      '// HAND_POSES — the hand on the handle',
      handPoseSource(KNIFE_ID, currentPoses(), ['grip']),
      '',
      "// ViewmodelHands.ts — the knife hold's wrap",
      rig === null ? '// (no knife loaded)' : holdCurlSource('the fist round the handle', rig.curl.grip),
      '',
      '// ViewmodelAnim.ts — the swing itself',
      swing === undefined ? '// (no knife loaded)' : knifeSwingSource(swing),
    ].join('\n');
    return;
  }
  const mine = handPoseSource(state.weaponId, currentPoses());
  const others = Object.keys(edits)
    .filter((id) => id !== state.weaponId)
    .sort()
    .map(entryFor);
  output.value = [`// ${state.weaponId}`, mine, ...(others.length > 0 ? ['', '// every other tuned weapon', ...others] : [])].join('\n');
}

let logTimer = 0;
function remember(): void {
  const swing = anim?.knifeSwing;
  const rig = hands();
  if (isKnife(state.weaponId) && swing !== undefined && rig !== null) {
    const wrap = {} as Record<FingerName, FingerCurl>;
    for (const f of FINGERS) wrap[f] = [...rig.curl.grip[f]] as FingerCurl;
    edits[state.weaponId] = {
      ...currentPoses(),
      swing: { ready: { ...swing.ready }, windup: { ...swing.windup }, strike: { ...swing.strike } },
      wrap,
    };
  } else edits[state.weaponId] = currentPoses();
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
copyOne.addEventListener('click', () => {
  // The knife's answer is two blocks, the hold and the swing, and the output box is both.
  void copy(isKnife(state.weaponId) ? output.value : handPoseSource(state.weaponId, currentPoses()));
});
copyAll.addEventListener('click', () => {
  remember();
  void copy(Object.keys(edits).sort().map(entryFor).join('\n'));
});
resetWeapon.addEventListener('click', () => {
  for (const side of SIDES) setHand(side, handPoseFor(state.weaponId, side));
  if (anim !== null) for (const which of SWINGS) Object.assign(anim.knifeSwing[which], KNIFE_SWING[which]);
  delete edits[state.weaponId];
  saveEdits(edits);
  syncControls();
  syncSwing();
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
  const blade = isKnife(weaponId);
  await Promise.all([
    (blade ? assets.preloadKnife() : assets.preload(weaponId)).catch(() => undefined),
    assets.preloadHands().catch(() => undefined),
  ]);
  if (ticket !== loading) return;
  if (model !== null) {
    layer.remove(model.root);
    model.dispose();
    model = null;
  }
  if (knife !== null) {
    layer.remove(knife.root);
    if (knife.arm !== null) layer.remove(knife.arm);
    knife.dispose();
    knife = null;
  }
  if (blade) {
    /**
     * The knife needs a weapon under the animator — `ViewmodelAnim` is built around one and
     * poses it every frame — so the carbine stands in, hidden and without hands, while the
     * blade and its one gloved hand are what is drawn. Exactly the arrangement a match has
     * while a swing runs, which is the point of tuning here rather than in a viewer.
     */
    const carrier = buildWeaponModel('ar_carbine', 8, null, { hands: false, assets, attachments: [] });
    carrier.root.visible = false;
    layer.add(carrier.root);
    model = carrier;
    knife = buildKnifeModel(8, assets.knife(), assets.hands());
    layer.add(knife.root);
    if (knife.arm !== null) layer.add(knife.arm);
    anim = new ViewmodelAnim(carrier);
    anim.setKnife(knife.root, knife.arm, knife.hands);
    const savedKnife = edits[KNIFE_ID];
    if (savedKnife !== undefined) {
      setHand('grip', savedKnife.grip);
      if (savedKnife.wrap !== undefined && knife.hands !== null) {
        for (const f of FINGERS) knife.hands.curl.grip[f] = [...savedKnife.wrap[f]] as FingerCurl;
      }
      // The swing survives a refresh too: it is the half of this page that is not in `HAND_POSES`.
      if (savedKnife.swing !== undefined) {
        for (const which of SWINGS) Object.assign(anim.knifeSwing[which], savedKnife.swing[which]);
      }
    }
    applyMode();
    syncControls();
    syncSwing();
    const knifeUrl = new URL(window.location.href);
    knifeUrl.searchParams.set('weapon', KNIFE_ID);
    window.history.replaceState(null, '', knifeUrl);
    hint.textContent =
      knife.hands === null
        ? 'the hands file did not load — the box fist stands in; is hands.glb built?'
        : 'knife · the swing is READY / WIND-UP / STRIKE, or anywhere on the t slider';
    return;
  }
  const attachments: AttachmentId[] = state.optic ? ['optic_reflex'] : [];
  applyMode();
  model = buildWeaponModel(weaponId, 8, null, { hands: true, assets, attachments });
  layer.add(model.root);
  anim = new ViewmodelAnim(model);
  const saved = edits[weaponId];
  // Edits kept before the reload pose existed have no `reload`: the table's stands.
  if (saved !== undefined) for (const side of SIDES) setHand(side, saved[side] ?? handPoseFor(weaponId, side));
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

/**
 * The eye view is framed as the game frames it, not as this page happens to be shaped.
 *
 * The panel takes the right-hand third, so the canvas here is usually **portrait** — and a
 * perspective camera's FOV is vertical, so a tall narrow viewport crops the sides. The knife's
 * READY pose sits 26 cm to the right of the axis and simply fell off the edge: the pose looked
 * wrong on a page that was showing two thirds of it. The eye view therefore renders into a
 * 16:9 box inside the canvas, which is the shape a player's screen is; the orbit views use the
 * whole canvas, because there nothing is being judged against a frame.
 */
const EYE_ASPECT = 16 / 9;
const eyeBox = { x: 0, y: 0, w: 1, h: 1 };

function resize(): void {
  const w = viewHost.clientWidth;
  const h = viewHost.clientHeight;
  renderer.setSize(w, h, false);
  const boxW = Math.min(w, h * EYE_ASPECT);
  const boxH = boxW / EYE_ASPECT;
  eyeBox.x = (w - boxW) / 2;
  eyeBox.y = (h - boxH) / 2;
  eyeBox.w = boxW;
  eyeBox.h = boxH;
  layer.resize(EYE_ASPECT);
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
    const blade = isKnife(state.weaponId) && knife !== null;
    const ads = !blade && state.pose === 'ads' ? 1 : 0;
    drive.adsFraction = ads;
    drive.reloading = !blade && state.pose === 'reload';
    drive.reloadFraction = state.reload;
    // The knife is posed by where the swing is, exactly as a match poses it from `Melee`.
    drive.melee = blade ? state.swingT : 0;
    anim.update(drive, DEFAULT_VIEWMODEL_CONFIG, dt);
    const def = WEAPON_DEFS[model.weaponId];
    layer.setFov(DEFAULT_CAMERA_CONFIG.viewmodelFov * lerp(1, def?.adsViewmodelFovScale ?? 1, ads));
    layer.resize(EYE_ASPECT);
    layer.scene.updateMatrixWorld(true);

    const outside = state.view !== 'eye';
    const posedRoot = blade && knife !== null ? knife.root : model.root;
    for (const side of SIDES) {
      const target = posedRoot.getObjectByName(TARGET[side]);
      const m = markers[side];
      m.visible = outside && state.sockets && target !== undefined && (!blade || side === 'grip');
      if (target !== undefined) m.position.copy(layer.camera.worldToLocal(target.getWorldPosition(socketAt)));
    }
    if (outside) {
      renderer.setViewport(0, 0, viewHost.clientWidth, viewHost.clientHeight);
      renderer.setScissorTest(false);
      const pivot = posedRoot.position;
      const { theta, phi, radius } = state.orbit;
      orbitCamera.position.set(
        pivot.x + radius * Math.cos(phi) * Math.sin(theta),
        pivot.y + radius * Math.sin(phi),
        pivot.z + radius * Math.cos(phi) * Math.cos(theta),
      );
      orbitCamera.lookAt(layer.camera.localToWorld(pivot.clone()));
      renderer.render(layer.scene, orbitCamera);
    } else {
      // The 16:9 box, and the rest of the canvas left as the clear colour.
      renderer.setViewport(eyeBox.x, eyeBox.y, eyeBox.w, eyeBox.h);
      renderer.setScissor(eyeBox.x, eyeBox.y, eyeBox.w, eyeBox.h);
      renderer.setScissorTest(true);
      renderer.render(layer.scene, layer.camera);
    }
  }
  requestAnimationFrame(frame);
}

void load(state.weaponId);
requestAnimationFrame(frame);
