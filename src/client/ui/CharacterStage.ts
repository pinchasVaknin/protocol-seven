import * as THREE from 'three';
import type { ActorAnimationInput } from '../../shared/ai/BotVisualState';
import type { ActorAvatar, HeldWeaponAsset } from '../characters/ActorAvatar';
import type { CharacterAvatarProvider } from '../characters/CharacterAvatarProvider';
import { characterDefinition, type CharacterId } from '../characters/CharacterCatalog';
import type { CharacterAssetService } from '../characters/CharacterAssetService';
import type { CamoId } from '../../shared/meta/Camos';
import { buildHeldWeapon, heldWeaponMaterial } from '../weapons/WeaponMesh';
import { PODIUM_STEPS, PODIUM_X } from './Lineup';

/**
 * The stage (M15, B1): the player's skin on a lit disc, holding the class's primary, turning.
 * And (M15, D1; the podium, M18) the same stage with a lineup on it — the three best of the
 * match on a podium after it, each in the body the match dealt them.
 *
 * ## The same body, the same hands, the same call
 *
 * A figure is an `ActorAvatar` from `CharacterAssetService.avatarProvider(def).create()` —
 * the exact object `BotRenderer` makes for a body in a match — driven by `update` with a
 * standing, armed, idle `ActorAnimationInput`, which the selector answers with
 * `idleWeaponReady`. The weapon in its hands is `buildHeldWeapon` with the shared gunmetal,
 * the same asset a bot carries. So the operator on this screen is the operator other players
 * see, by construction rather than by a second model kept in step with the first.
 *
 * It shows the camo too (playtest round 3, R4.4): a held weapon is one mesh in one shared
 * material, and with a finish that material is the camo set's gunmetal — the pattern — from
 * the cache the viewmodel fills. A match body stays plain: the wire carries no camo.
 *
 * ## One class, one figure or five
 *
 * The editor's stage is one body on a disc that turns; the debrief's is three on a podium
 * that does not. They are the same lights, the same lens, the same loading rule and the
 * same disposal, so they are one class with a list of figures rather than two classes kept
 * in step: `show` is the one-figure API the editor and the thumbnail script use, and
 * `showLineup` is the same list with more than one entry. `StageOptions` names what differs —
 * the canvas, the camera, the platform under the feet, and whether it turns.
 *
 * ## Its own renderer, on the first tick
 *
 * As `WeaponPreview` does: its own scene, camera and `WebGLRenderer` on its own canvas, built
 * the first time `tick` runs and disposed with the screen — the main renderer is drawing the
 * menu's backdrop under this screen and a second context costs less than a second render
 * target and a viewport dance. The canvas's backing store follows its on-screen size, so a
 * frame at 0.58 does not rasterise 860×734 to show 500×426.
 *
 * ## Loading is a state, not a wait
 *
 * A skin arrives when it arrives (B0 made the wait a fraction of a second on a warm cache;
 * `echo` is preloaded at boot). Until the provider is ready the disc stands empty and the
 * caller's label says so; `create()` is asked once per tick and succeeds exactly once. A
 * skin that fails to load leaves the disc empty for good and logs where the service logs.
 */

export interface CharacterStageDeps {
  readonly characterAssets: CharacterAssetService;
  readonly anisotropy: () => number;
}

/** What one stage differs from another in. The editor's is the default; the debrief's is `PODIUM_STAGE`. */
export interface StageOptions {
  /** Design-frame pixels; the backing store is sized from the on-screen rect. */
  readonly width: number;
  readonly height: number;
  readonly canvasClass: string;
  readonly ariaLabel: string;
  /** The lens: height, distance along +Z, and the height it looks at on the axis. */
  readonly camera: { readonly y: number; readonly z: number; readonly lookY: number };
  /**
   * B1's disc and ring under one body, or the podium (M18): three blocks under three bodies,
   * the centre's the tallest, each `steps[i]` metres high at `x = slotX[i]`, each `width` by
   * `depth` — the figures' own `y` says where they stand on them.
   */
  readonly platform:
    | 'disc'
    | { readonly podium: true; readonly steps: readonly number[]; readonly slotX: readonly number[]; readonly width: number; readonly depth: number };
  /** Whether the stage turns on its own and can be dragged. A lineup stands still. */
  readonly turntable: boolean;
}

/** One body on the stage: which skin, what it holds, and where it stands. */
export interface StageFigure {
  readonly characterId: CharacterId;
  readonly weaponId: string | null;
  /** The weapon's finish; a lineup's bodies carry none (the wire has none to give them). */
  readonly camo?: CamoId | null;
  /** Metres from the stage's centre; +Z is toward the camera. */
  readonly x: number;
  readonly z: number;
  /** Radians. A body at yaw 0 faces −Z, away from the camera; π faces it. */
  readonly yaw: number;
  /** Metres above the platform's top the figure stands: a podium step (M18). Ground when absent. */
  readonly y?: number;
}

/** Design-frame pixels of the editor's stage (734 since the action row, M17 C5); the backing store is sized from the on-screen rect. */
export const STAGE_WIDTH = 860;
export const STAGE_HEIGHT = 734;

/**
 * The editor's stage (B1). Chest height, a little in front of the eye line, looking at the
 * sternum: the full body fills the frame with the disc under its feet and air over its head.
 */
export const EDITOR_STAGE: StageOptions = {
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT,
  canvasClass: 'lo-stage__canvas',
  ariaLabel: 'Your operator, turning. Drag to turn it yourself.',
  camera: { y: 1.35, z: 4.4, lookY: 0.95 },
  platform: 'disc',
  turntable: true,
};

/**
 * The debrief's stage (M18; it was D1's lineup of five on one platform, 5.3 m back): three
 * bodies on three blocks, the lens further back and higher, tilted down so the feet land in
 * the upper two thirds of the canvas — the plates and the stat cards hang under them in the
 * lower third — with the blocks' fronts in frame and air over the tallest block's occupant.
 */
export const PODIUM_STAGE: StageOptions = {
  width: 1824,
  height: 694,
  canvasClass: 'dbf-stage__canvas',
  ariaLabel: 'The three best players of the match, on the podium.',
  camera: { y: 1.9, z: 6.4, lookY: 0.78 },
  platform: { podium: true, steps: PODIUM_STEPS, slotX: PODIUM_X, width: 1.5, depth: 1.5 },
  turntable: false,
};

/** Radians per second when nobody is holding it. */
const IDLE_TURN = 0.1;
/** Radians of turn per pixel of drag, in frame pixels. */
const DRAG_RADIANS_PER_PX = 0.008;
/**
 * The fling (playtest round 3, R3.7). A drag that lets go at speed keeps that speed and loses
 * it as `exp(-FLING_DAMPING · t)`: at 2.2 a 6 rad/s fling is under the idle rate in about
 * 1.9 s, and one thrown against the idle direction decays through zero and the idle takes
 * over — *"until it resets to its regular track"*. The hand's speed is read from the last
 * move, blended so a hand that stalled before letting go reads as stalled, and clamped so a
 * pointer that jumped across the canvas in one event does not spin the disc for a minute.
 */
const FLING_DAMPING = 2.2;
const FLING_MAX = 12;
const FLING_BLEND = 0.3;

const STANDING_ARMED: ActorAnimationInput = {
  stance: 'STAND',
  aiming: true,
  sprinting: false,
  reloading: false,
  reloadSeconds: 0,
  firing: false,
};

interface Slot {
  readonly figure: StageFigure;
  readonly provider: CharacterAvatarProvider;
  weapon: HeldWeaponAsset | null;
  avatar: ActorAvatar | null;
  /** The walk-in (M18): when this figure starts, from how far behind, and how long it takes. Null stands still. */
  entrance: { readonly startsAt: number; readonly back: number; readonly seconds: number } | null;
}

/** A body's own walk: metres per second, under the run threshold so the selector answers with the walk. */
const WALK_IN_SPEED = 2.4;

export class CharacterStage {
  readonly canvas: HTMLCanvasElement;

  private readonly deps: CharacterStageDeps;
  private readonly options: StageOptions;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly turntable = new THREE.Group();
  private readonly platform: THREE.Group;

  private renderer: THREE.WebGLRenderer | null = null;
  private slots: Slot[] = [];
  /** The one-figure API's weapon and its finish, so `setWeapon` before or after `show` means the same thing. */
  private weaponId: string | null = null;
  private camo: CamoId | null = null;
  /** Keyed by weapon and finish: a camo'd weapon is a different asset with the same geometry. */
  private readonly weapons = new Map<string, HeldWeaponAsset>();

  /**
   * Where the turntable is. Starts at a half turn: a body at yaw 0 faces -Z, the camera stands
   * on +Z, and a stage that opens on the operator's back is a stage that opens wrong.
   */
  private angle = Math.PI;
  private dragging = false;
  private dragLastX = 0;
  private dragLastMs = 0;
  /** The hand's angular speed while it drags, and what the disc keeps when it lets go. Radians per second, over the idle. */
  private dragSpeed = 0;
  private spin = 0;
  /** A held pose: no idle turn, no easing. The thumbnail renderer's, and nothing else's. */
  private held = false;
  private lastSeenWidth = 0;
  private lastSeenHeight = 0;
  private readonly projected = new THREE.Vector3();
  /** Seconds this stage has ticked; the walk-in is timed on it. */
  private clock = 0;

  constructor(deps: CharacterStageDeps, options: StageOptions = EDITOR_STAGE) {
    this.deps = deps;
    this.options = options;

    this.canvas = document.createElement('canvas');
    this.canvas.className = options.canvasClass;
    this.canvas.width = options.width;
    this.canvas.height = options.height;
    this.canvas.setAttribute('aria-label', options.ariaLabel);

    // A key from the front-left and above, a cool rim from behind, and a soft fill: the shop
    // lighting `WeaponPreview` settled on, scaled up for a body.
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-2.2, 4.0, 3.0);
    const rim = new THREE.DirectionalLight(0x9ec4ff, 1.6);
    rim.position.set(2.5, 2.5, -3.5);
    const fill = new THREE.HemisphereLight(0x9fb0c8, 0x22252b, 1.1);
    this.scene.add(key, key.target, rim, rim.target, fill);

    this.platform =
      options.platform === 'disc'
        ? buildDisc()
        : buildPodium(options.platform.steps, options.platform.slotX, options.platform.width, options.platform.depth);
    this.turntable.add(this.platform);
    this.scene.add(this.turntable);

    this.camera = new THREE.PerspectiveCamera(30, options.width / options.height, 0.1, 30);
    this.camera.position.set(0, options.camera.y, options.camera.z);
    this.camera.lookAt(0, options.camera.lookY, 0);
    this.camera.updateMatrixWorld();

    if (!options.turntable) {
      // Still, facing the lens: the figures carry their own yaw.
      this.angle = 0;
      this.turntable.rotation.y = 0;
      return;
    }

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragLastX = e.clientX;
      this.dragLastMs = e.timeStamp;
      this.dragSpeed = 0;
      this.spin = 0;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const scale = this.canvas.getBoundingClientRect().width / options.width || 1;
      const dx = (e.clientX - this.dragLastX) / scale;
      const dt = Math.max(1, e.timeStamp - this.dragLastMs) / 1000;
      this.dragLastX = e.clientX;
      this.dragLastMs = e.timeStamp;
      const turned = dx * DRAG_RADIANS_PER_PX;
      this.angle += turned;
      this.dragSpeed = this.dragSpeed * (1 - FLING_BLEND) + (turned / dt) * FLING_BLEND;
    });
    const release = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      // A hand that stopped and then let go has no speed to hand over: the last move is stale.
      const held = e.timeStamp - this.dragLastMs > 80;
      this.spin = held ? 0 : Math.max(-FLING_MAX, Math.min(FLING_MAX, this.dragSpeed - IDLE_TURN));
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  /** The surplus over the idle turn the disc is carrying from a fling, radians per second. For the record's measurement. */
  get flingSpeed(): number {
    return this.spin;
  }

  /** Whether every figure asked for is on the stage. False while any is still loading, and with none asked for. */
  get ready(): boolean {
    return this.slots.length > 0 && this.slots.every((s) => s.avatar !== null);
  }

  /** Put this skin on the disc, alone. Idempotent for the skin already there or already asked for. */
  show(characterId: CharacterId): void {
    const only = this.slots.length === 1 ? this.slots[0] : undefined;
    if (only !== undefined && only.figure.characterId === characterId) return;
    this.showLineup([{ characterId, weaponId: this.weaponId, camo: this.camo, x: 0, z: 0, yaw: 0 }]);
  }

  /** The weapon in the one figure's hands, in its finish. Null empties them. */
  setWeapon(weaponId: string | null, camo: CamoId | null = null): void {
    if (weaponId === this.weaponId && camo === this.camo) return;
    this.weaponId = weaponId;
    this.camo = camo;
    const only = this.slots.length === 1 ? this.slots[0] : undefined;
    if (only === undefined) return;
    only.weapon = weaponId === null ? null : this.heldWeapon(weaponId, camo);
    only.avatar?.setWeapon(only.weapon);
  }

  /**
   * Put these figures on the stage, replacing whatever was there (D1). Each loads through
   * its own provider — a skin the match already drew is a warm cache, a skin it did not is a
   * fetch — and stands where the figure says, holding what it says, as soon as it arrives.
   */
  showLineup(figures: readonly StageFigure[]): void {
    this.dropAll();
    this.slots = figures.map((figure) => ({
      figure,
      provider: this.deps.characterAssets.avatarProvider(characterDefinition(figure.characterId)),
      weapon: figure.weaponId === null ? null : this.heldWeapon(figure.weaponId, figure.camo ?? null),
      avatar: null,
      entrance: null,
    }));
  }

  /**
   * Walk the figures in (M18): each starts `back` metres behind its mark, facing the lens,
   * and walks onto it over `back / WALK_IN_SPEED` seconds, the last figure first and the
   * first last, `stagger` seconds apart — so the podium fills bronze, silver, gold. The walk
   * is the body's own: the avatar reads its planar speed from where it is put each frame
   * and its selector answers with the walk clip, exactly as a bot walking a lane does.
   * Returns when the last figure is on its mark, seconds from now.
   */
  walkIn(back: number, stagger: number): number {
    const seconds = back / WALK_IN_SPEED;
    const count = this.slots.length;
    this.slots.forEach((slot, index) => {
      slot.entrance = { startsAt: this.clock + (count - 1 - index) * stagger, back, seconds };
    });
    return (count - 1) * stagger + seconds;
  }

  /** Every figure on its mark, now: the layout probe's, and the skip's. */
  settle(): void {
    for (const slot of this.slots) {
      slot.entrance = null;
      slot.avatar?.setVisible(true);
    }
  }

  /**
   * Where a point on the stage lands on the canvas, as fractions of its width and height from
   * the top left — for a nameplate under a figure's feet. Pure lens arithmetic: it needs no
   * renderer and no tick, so it answers on a page that never draws.
   */
  projectToCanvas(x: number, y: number, z: number): { readonly u: number; readonly v: number } {
    const point = this.projected.set(x, y, z);
    point.applyAxisAngle(UP, this.angle);
    point.project(this.camera);
    return { u: (point.x + 1) / 2, v: (1 - point.y) / 2 };
  }

  /**
   * Hold the turntable at an angle and stop it turning (M15, B5: `scripts/skin-thumbs.mjs`
   * renders every skin at one pose so the strip's thumbnails match). Radians, 0 facing -Z.
   */
  hold(angle: number, distance = 4.4): void {
    this.held = true;
    this.angle = angle;
    this.spin = 0;
    // Closer for a portrait: the stage's own distance leaves a 320×400 thumbnail half air.
    this.camera.position.set(0, 1.35 - (4.4 - distance) * 0.09, distance);
    this.camera.lookAt(0, 0.95, 0);
    this.camera.updateMatrixWorld();
  }

  /** The canvas as a PNG data URL, read right after a `tick` in the same task — the buffer is not preserved past it. */
  snapshot(): string {
    return this.canvas.toDataURL('image/png');
  }

  /**
   * One frame: adopt the bodies that have arrived, turn, animate, draw.
   *
   * Driven from `Game.draw` through the screen, so it stops with the frame loop.
   */
  tick(dt: number): void {
    for (const slot of this.slots) {
      if (slot.avatar !== null || !slot.provider.isReady) continue;
      const made = slot.provider.create();
      if (made === null) continue;
      slot.avatar = made;
      made.setWeapon(slot.weapon);
      this.turntable.add(made.group);
    }

    if (this.dragging || this.held || !this.options.turntable) {
      // The hand is on it, a script is, or it does not turn: no idle turn, no fling.
    } else {
      this.angle += (IDLE_TURN + this.spin) * dt;
      this.spin *= Math.exp(-FLING_DAMPING * dt);
      if (Math.abs(this.spin) < 1e-3) this.spin = 0;
    }
    this.turntable.rotation.y = this.angle;

    // A body's own yaw is the figure's — 0 on the editor's stage, where the turntable carries
    // it — and its position is where the figure stands, so `update`'s planar speed reads 0
    // and the selector answers with the idle. A figure walking in (M18) is put a little
    // further along its line each frame, facing the lens until the last step turns it onto
    // the figure's own yaw, and the same call reads that as a walk.
    this.clock += dt;
    for (const slot of this.slots) {
      const f = slot.figure;
      const y = f.y ?? 0;
      const e = slot.entrance;
      if (e === null) {
        slot.avatar?.update(STANDING_ARMED, f.x, y, f.z, f.yaw, 1, dt);
        continue;
      }
      const u = Math.max(0, Math.min(1, (this.clock - e.startsAt) / e.seconds));
      // Out of sight until its turn: a body waiting in the dark behind the blocks is a body
      // the eye finds before the walk gives it to them.
      slot.avatar?.setVisible(this.clock >= e.startsAt);
      // One speed for most of the way — a walk has one speed — and the last of it eased to
      // a stop, so the body arrives rather than hits its mark.
      const tail = Math.max(0, (u - 0.8) / 0.2);
      const s = u < 0.8 ? 0.94 * (u / 0.8) : 0.94 + 0.06 * (1 - (1 - tail) * (1 - tail));
      const z = f.z - e.back * (1 - s);
      const yaw = Math.PI + (f.yaw - Math.PI) * tail;
      slot.avatar?.update(STANDING_ARMED, f.x, y, z, yaw, 1, dt);
      if (u >= 1) slot.entrance = null;
    }

    const renderer = this.ensureRenderer();
    this.fitBackingStore(renderer);
    renderer.render(this.scene, this.camera);
  }

  /** Take every body off the stage and forget the skins; the next `show` loads afresh. */
  release(): void {
    this.dropAll();
  }

  dispose(): void {
    this.release();
    for (const asset of this.weapons.values()) asset.geometry.dispose();
    this.weapons.clear();
    disposePlatform(this.platform);
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas.remove();
  }

  // -- internals -------------------------------------------------------------

  private dropAll(): void {
    for (const slot of this.slots) {
      const avatar = slot.avatar;
      if (avatar !== null) {
        this.turntable.remove(avatar.group);
        avatar.dispose();
      }
      slot.provider.dispose();
    }
    this.slots = [];
  }

  /** The held weapon for an id and a finish, built once and kept — `BotRenderer.heldWeapon`'s shape. */
  private heldWeapon(weaponId: string, camo: CamoId | null): HeldWeaponAsset {
    const key = `${weaponId}|${camo ?? ''}`;
    const existing = this.weapons.get(key);
    if (existing !== undefined) return existing;
    const built = buildHeldWeapon(weaponId);
    const asset: HeldWeaponAsset = {
      weaponId,
      geometry: built.geometry,
      material: heldWeaponMaterial(this.deps.anisotropy(), camo),
      gripAnchor: built.gripAnchor,
      supportAnchor: built.supportAnchor,
    };
    this.weapons.set(key, asset);
    return asset;
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    const existing = this.renderer;
    if (existing !== null) return existing;
    const made = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    // The same colour pipeline as `Renderer`, or the skin here is a different colour from the
    // skin in the match. Exposure included: ACES without it is a different curve.
    made.outputColorSpace = THREE.SRGBColorSpace;
    made.toneMapping = THREE.ACESFilmicToneMapping;
    made.toneMappingExposure = 1.25;
    this.renderer = made;
    return made;
  }

  /**
   * Size the backing store to what is on screen: the canvas's CSS box is in frame pixels
   * and the frame is zoomed, so the rect is the truth and the attribute is not.
   */
  private fitBackingStore(renderer: THREE.WebGLRenderer): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (width === this.lastSeenWidth && height === this.lastSeenHeight) return;
    this.lastSeenWidth = width;
    this.lastSeenHeight = height;
    // `false`: the CSS size is the stylesheet's, not the renderer's to set.
    renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

const PLINTH_MATERIAL = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.65, metalness: 0.2 });
const ACCENT_MATERIAL = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: 0x3fa9c7, toneMapped: false });

/**
 * The lit disc: a low cylinder in a dark surface with an emissive ring at its edge — the
 * reference's platform, built from two primitives and no texture.
 */
function buildDisc(): THREE.Group {
  const group = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.12, 64), PLINTH_MATERIAL());
  plinth.position.y = -0.06;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.018, 12, 96), ACCENT_MATERIAL());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.002;
  group.add(plinth, ring);
  return group;
}

/**
 * The podium (M18; D1's one slab under a lineup of five became three): the disc's plinth as
 * a block, one per body and each its own height, with the accent as a frame around every
 * top edge — four thin bars in the ring's material, so the two stages read as the same
 * furniture. Gold's block at `slotX[0]`, silver's at `slotX[1]`, bronze's at `slotX[2]`.
 */
function buildPodium(steps: readonly number[], slotX: readonly number[], width: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  const bar = 0.036;
  const accent = ACCENT_MATERIAL();
  steps.forEach((height, index) => {
    const x = slotX[index] ?? 0;
    const block = new THREE.Mesh(new THREE.BoxGeometry(width, height + 0.12, depth), PLINTH_MATERIAL());
    block.position.set(x, (height - 0.12) / 2, 0);
    group.add(block);
    const along = new THREE.BoxGeometry(width, bar, bar);
    const across = new THREE.BoxGeometry(bar, bar, depth);
    for (const sign of [-1, 1]) {
      const front = new THREE.Mesh(along, accent);
      front.position.set(x, height + 0.002, (sign * (depth - bar)) / 2);
      const side = new THREE.Mesh(across, accent);
      side.position.set(x + (sign * (width - bar)) / 2, height + 0.002, 0);
      group.add(front, side);
    }
  });
  return group;
}

function disposePlatform(platform: THREE.Group): void {
  const seen = new Set<object>();
  platform.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry !== undefined && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const material = mesh.material as THREE.Material | undefined;
    if (material !== undefined && typeof material.dispose === 'function' && !seen.has(material)) {
      seen.add(material);
      material.dispose();
    }
  });
}
