/**
 * Application root and the top-level state machine (S6.3): BOOT -> MENU -> MATCH -> SUMMARY.
 *
 * ## The world is per-match, and it lives next door
 *
 * M1-M3 built the map, the player and the match once at boot and kept them for the life of
 * the page, because there was only ever one of each. M4 has a map *choice* and a summary
 * screen you come back from, so the world is built on entering MATCH and **fully disposed on
 * leaving SUMMARY** — S6.3's "loading a map twice must not double anything".
 *
 * M4 put that in this file as `buildWorld` / `teardownWorld` plus six nullable fields, and by
 * M6 those fields were threaded through `simulate`, `draw`, five state handlers and eight
 * getters. M7 moved the whole lifecycle to `MatchWorld`, so the six fields that were always
 * null together became one field that is sometimes null. Every method below asks once, at the
 * top.
 *
 * What survives a match is what is genuinely process-wide: the renderer, the textures, the
 * audio graph, the input listener, the frame-stats buffer, the profile and the config objects
 * the tuning panel holds references to. All of them are fields here and are handed to
 * `MatchWorld` rather than owned by it. `MatchHarness` runs the build/teardown cycle
 * repeatedly and logs the heap at each boundary, which is the test that the split is honest.
 *
 * ## What is left here, and what went next door (C23)
 *
 * Three collaborators, each named for the thing it decides, and this class owns the screen the
 * player is on and the world they are in:
 *
 * - `GameSession` — the dial, the seat and every transition a server starts (C23a).
 * - `GameSurfaces` — every HUD surface decided once a frame, and the two client-side stores
 *   they read: the debug-overlay request and this process's offline entitlements (C23b).
 * - `GameFrame` — whose eye the camera is at, which lens it looks through, and which of the
 *   three passes draws it (C23b).
 *
 * The loop still belongs here, because the loop is the thing that drives all three: `simulate`
 * takes the local step and hands the networked one to the session, and `draw` pumps the front
 * end and hands the picture to the frame.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import { DEFAULT_SCHEDULER, type SchedulerConfig } from '../shared/ai/AiScheduler';
import {
  BOT_DIFFICULTY_NAMES,
  cloneTierTable,
  DEFAULT_PERCEPTION,
  DEFAULT_TIERS,
  type PerceptionConfig,
  type TierTable,
} from '../shared/ai/DifficultyTiers';
import { EV, createGameBus, type GameBus } from '../shared/core/Events';
import { Input } from './input/Input';
import type { BindingMap } from '../shared/core/Keybinds';
import type { InputCommand } from '../shared/core/InputCommand';
import { MAX_STEPS_PER_FRAME, type FrameSample } from '../shared/core/Loop';
import { Loop } from './engine/FrameLoop';
import { IntroCamera } from './cinematic/IntroCamera';
import { Rng } from '../shared/core/Rng';
import { LocalBotTransport, type ICommandQueue } from '../shared/net/Transport';
import { foreignServerHost, isServerConfigured } from './net/JoinOptions';
import { logger } from '../shared/core/Log';
import { applyFrameScale } from './ui/Frame';
import { viewport } from './ui/Viewport';
import { LoadingScreen } from './ui/LoadingScreen';
import { VoteOverlay } from './ui/VoteOverlay';
import { QuickLoadout } from './ui/QuickLoadout';
import { MapBuildQueue } from './world/MapBuildQueue';
import { MenuBackdrop } from './world/MenuBackdrop';
import { CameraRig } from './engine/CameraRig';
import { ProceduralAudio } from './engine/ProceduralAudio';
import { ProceduralTextures } from './engine/ProceduralTextures';
import { Renderer } from './engine/Renderer';
import { gpuWarmup } from './engine/GpuWarmup';
import { parseHarnessOptions } from './debug/BotHarness';
import type { BotHarness } from './debug/BotHarness';
import type { DebugSuite } from './debug/DebugSuite';
import { FrameStats } from './debug/FrameStats';
import { installConsoleApi } from './debug/ConsoleApi';
import { airPoseWatchWanted, setAirPoseWatch } from './characters/AirPoseWatch';
import { consoleApiWanted } from './debug/ConsoleGate';
import { Harness } from './debug/Harness';
import { MatchHarness } from './debug/MatchHarness';
import { Speedometer } from './debug/Speedometer';
import { isLegalGameTransition, type GameStateId } from '../shared/core/GameStates';
import { playability } from '../shared/ui/Capabilities';
import { readDeviceCapabilities } from './input/DeviceCapabilities';
import type { Match } from './ClientMatch';
import type { MatchResult } from '../shared/modes/GameMode';
import { wonBy } from '../shared/modes/MatchOutcome';
import type { XpReport } from '../shared/meta/XpRules';
import { MatchWorld, type MatchWorldDeps } from './MatchWorld';
import { GameSession } from './GameSession';
import { GameSurfaces } from './GameSurfaces';
import { GameFrame } from './GameFrame';
import { CharacterAssetService } from './characters/CharacterAssetService';
import { WeaponAssetService } from './weapons/WeaponAssetService';
import {
  characterDefinition,
  DEFAULT_CHARACTER_ID,
  type CharacterId,
} from './characters/CharacterCatalog';
import { RandomCharacterSelector } from './characters/RandomCharacterSelector';
import type { LineupSource } from './ui/EndOfMatch';
import { GameScreens } from './GameScreens';
import { applyEquippedLoadout, asModeId } from './GameLoadout';
import type { ResolvedLoadout } from '../shared/meta/Loadouts';
import { Profile } from './meta/Profile';
import { defaultSettings, type SettingsV1 } from '../shared/meta/SaveData';
import {
  DEFAULT_MAP_ID,
  DEFAULT_MODE_ID,
  findMap,
  findMode,
  resolveMapId,
  resolveModeId,
  rollBackdropMap,
} from '../shared/modes/ModeRegistry';
import { DEFAULT_CAMERA_CONFIG, FOV_MAX, FOV_MIN, type CameraConfig } from './player/CameraConfig';
import { DEFAULT_HEALTH_CONFIG, type HealthConfig } from '../shared/player/Health';
import { DEFAULT_MOVEMENT_CONFIG, cloneMovementConfig, type MovementConfig } from '../shared/player/MovementConfig';
import type { PlayerController } from '../shared/player/PlayerController';
import { ViewmodelLayer } from './player/Viewmodel';
import type { MenuSelection } from './ui/Menus';
import { FpsCounter } from './ui/FpsCounter';
import { palette } from './ui/Palette';
import { Settings } from './ui/Settings';
import { Splash, splashWanted } from './ui/Splash';
import {
  cloneEquipmentConfig,
  DEFAULT_EQUIPMENT_CONFIG,
  type EquipmentConfig,
} from '../shared/equipment/EquipmentConfig';
import { ALL_WEAPONS, AR_DEFAULT, cloneWeaponDef, PISTOL_DEFAULT, type WeaponDef } from '../shared/weapons/WeaponDefs';
import { ALL_EQUIPMENT } from '../shared/equipment/EquipmentDefs';
import { STREAK_WEAPON_IDS } from '../shared/streaks/StreakWeapons';
import { preloadSentry } from './streaks/SentryModel';
import { preloadStation } from './world/PropModels';
import { cloneViewmodelConfig, DEFAULT_VIEWMODEL_CONFIG, type ViewmodelConfig } from '../shared/weapons/ViewmodelConfig';
import type { LoadedMap } from './world/MapRender';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
interface StateHandlers {
  enter?: (from: GameStateId) => void;
  exit?: (to: GameStateId) => void;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const stateChangePayload = { from: 'BOOT' as GameStateId, to: 'BOOT' as GameStateId };

const netLog = logger('join');

/** Keys the skin deck's RNG apart from every other seeded stream in the client. */
const CHARACTER_DECK_SALT = 0x5c1a_9e77;
//#endregion

// ========================================= CLASS Game ========================================= \\
//#region Class Game
export class Game {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly bus: GameBus = createGameBus();
  readonly movementConfig: MovementConfig = cloneMovementConfig(DEFAULT_MOVEMENT_CONFIG);
  readonly cameraConfig: CameraConfig = { ...DEFAULT_CAMERA_CONFIG };
  /**
   * The live primary and secondary.
   *
   * These are *mutable clones* the tuning panel writes into, which is why they are fields
   * rather than the shipped defs. M5's weapon picker replaces their contents wholesale by
   * copying a different `WeaponDef` over them (`setPrimary`), so the tuning panel keeps
   * pointing at the same two objects across a weapon change and nothing has to resubscribe.
   */
  readonly weaponDef: WeaponDef = cloneWeaponDef(AR_DEFAULT);
  readonly secondaryDef: WeaponDef = cloneWeaponDef(PISTOL_DEFAULT);
  /**
   * The base of the player's primary: the resolved loadout with attachments and perks
   * stripped back off. Read by the M6 modifier panel; see `MatchDeps.playerBaseDef`.
   */
  readonly playerBaseDef: WeaponDef = cloneWeaponDef(AR_DEFAULT);
  readonly viewmodelConfig: ViewmodelConfig = cloneViewmodelConfig(DEFAULT_VIEWMODEL_CONFIG);
  readonly healthConfig: HealthConfig = { ...DEFAULT_HEALTH_CONFIG };
  readonly equipmentConfig: EquipmentConfig = cloneEquipmentConfig(DEFAULT_EQUIPMENT_CONFIG);
  readonly tiers: TierTable = cloneTierTable(DEFAULT_TIERS);
  readonly perceptionConfig: PerceptionConfig = { ...DEFAULT_PERCEPTION };
  readonly schedulerConfig: SchedulerConfig = { ...DEFAULT_SCHEDULER };

  /**
   * Frame statistics and the speedometer outlive a match deliberately: the three-match heap
   * run needs one continuous frame-time history across the boundaries it is measuring.
   */
  readonly stats = new FrameStats();
  readonly speedo = new Speedometer();
  /**
   * M8. Process-wide, like `stats`: a player who turns on an FPS counter expects it on the
   * menu as well as in a match, and the HUD is torn down between rounds.
   */
  private readonly fpsCounter: FpsCounter;
  /** M8. The settings screen. Built at boot and kept, like every other front-end screen. */
  private readonly settingsScreen: Settings;

  private readonly scene = new THREE.Scene();
  private readonly renderer: Renderer;
  private readonly textures: ProceduralTextures;
  /** The map behind the main menu (M15, A3). Exists only while `world` is null. */
  /** The map behind the menu (A3) and, on it, the fight (E). Public for the console's switch. */
  readonly backdrop: MenuBackdrop;
  /** Parsed GLB templates survive MatchWorld teardown and are shared by every mode. */
  private readonly characterAssets = new CharacterAssetService();
  /** The weapons' templates (M19), on the same terms: the application's, never a match's. */
  private readonly weaponAssets = new WeaponAssetService();
  /** Worlds built this session. Moves the skin deck between matches — see `buildWorld`. */
  private worldsBuilt = 0;
  /**
   * The menu's own dice (M17, C2): the map behind the menu is rolled from these, seeded on the
   * clock at boot — the one draw in the client that nothing gameplay reads, and the reason it
   * may be seeded on the clock where every other `Rng` is seeded on a fact.
   */
  private readonly backdropDice = new Rng(Date.now() >>> 0);
  /** The map last drawn behind the menu, so the next roll is a different one. */
  private lastBackdropMapId: string | null = null;
  private readonly viewmodel: ViewmodelLayer;
  private readonly cameraRig: CameraRig;
  private readonly audio = new ProceduralAudio();
  private readonly screens: GameScreens;
  private readonly uiHost: HTMLElement;
  private readonly debugHost: HTMLElement;
  /** M6: the one save object. Owns settings, progression, loadouts and challenges. */
  readonly profile: Profile;
  private readonly transport: ICommandQueue = new LocalBotTransport(64);

  /**
   * Everything about having a server: the dial, the seat, and the transitions it starts
   * (C23a).
   *
   * Built last of the fields it reads, and handed the three app-lifetime surfaces this
   * constructor builds rather than building them itself — they are DOM appended to one host
   * and the order they are appended in is the order they paint in.
   */
  private readonly session: GameSession;

  /**
   * Every HUD surface this class owns, and the two client-side stores they read (C23b).
   *
   * The debug-overlay request and this process's offline entitlements live there rather than
   * here because the object that decides from them is the object that should hold them —
   * and the cheat door, which is their only writer, went with them.
   */
  private readonly surfaces: GameSurfaces;

  /** One frame's camera and picture (C23b). Everything per-frame, and nothing allocating. */
  private readonly frame: GameFrame;

  /** The non-blocking vote overlay (§4.20). Built at boot, shown only while balloting. */
  private readonly voteOverlay: VoteOverlay;

  /**
   * The quick class selector (M11 Gate B), on keys 1-5.
   *
   * Process-wide like every other front-end surface, and for the same reason: it outlives the
   * world it is drawn over, so a migration cannot dispose the panel out from under the player
   * mid-countdown.
   */
  private readonly quickLoadout: QuickLoadout;

  /** The chunked background map build (§6.5). Pumped from the render pass. */
  private readonly buildQueue: MapBuildQueue;

  /** The §4.18 fallback, for a client whose build did not finish before the migration. */
  private readonly loadingScreen: LoadingScreen;

  /**
   * Which class the editor opens on: the range's, from the testbed plate, or the five, from the
   * main menu. Set by the door that was used, never by the mode selection — see
   * `LoadoutEditor.show` for the playtest report that read it off the selection.
   */
  private loadoutRange = false;

  /** The menu page the next MENU entry opens at. Play Solo once, after the range's editor. */
  private menuReturnPage: 'MAIN' | 'PLAY' = 'MAIN';

  private readonly input: Input;
  private readonly loop: Loop;
  private readonly selection: MenuSelection;
  /** The match intro's camera (M15, Phase C): asked for once per render frame, before the chopper's. */
  private readonly introCamera: IntroCamera;
  /** The splash over the boot (M17, C6), while it plays; null before and after. */
  private splash: Splash | null = null;

  /**
   * The per-match world: the map, the player, the match and its debug tooling.
   *
   * One nullable field rather than six, because they were only ever all present or all
   * absent. Null outside a match; `MatchWorld` itself has no optional members.
   */
  private world: MatchWorld | null = null;
  /**
   * The skin deck the current world was dealt from (M15, D1): the summary's lineup asks it
   * which body each entity wore, so the body on the platform is the body the player shot.
   * Null between worlds.
   */
  private characterSelector: RandomCharacterSelector | null = null;

  // ---- process-wide -------------------------------------------------------
  private readonly harness: Harness;
  private readonly matchHarness: MatchHarness;

  private readonly states = new Map<GameStateId, StateHandlers>();
  private state: GameStateId = 'BOOT';

  private readonly drainBuffer: InputCommand[] = [];
  private lastRenderMs = performance.now();
  /** Where the settings screen's Back button goes. Captured on entry (M8). */
  private settingsReturn: GameStateId = 'MENU';
  /** The binding table last handed to `Input`, so `previewSettings` swaps it only when it is a new one. */
  private appliedBindings: BindingMap | null = null;

  /**
   * Start or stop the background-tab network heartbeat. Bound to `visibilitychange`.
   */
  private readonly onVisibility = (): void => {
    this.session.onVisibilityChanged();
  };

  private readonly onResize = (): void => {
    viewport.set(window.innerWidth, window.innerHeight);
    this.renderer.setSize(viewport.width, viewport.height, this.profile.settings.renderScale);
    applyFrameScale(this.uiHost, viewport.width, viewport.height);
    this.cameraRig.resize(this.renderer.aspect);
    this.viewmodel.resize(this.renderer.aspect);
  };

  private readonly onPageHide = (): void => {
    this.profile.patchSettings({
      modeId: this.selection.modeId,
      mapId: this.selection.mapId,
      botDifficulty: this.selection.difficulty,
    });
    this.profile.flush();
    this.audio.suspend();
  };
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(canvas: HTMLCanvasElement, uiHost: HTMLElement, debugHost: HTMLElement) {
    // M6: one save object for everything (S6.6). Settings used to live in their own store;
    // `Profile` carries the old blob across on first load so nobody's FOV resets.
    this.profile = new Profile({
      fallbackSettings: defaultSettings(DEFAULT_MODE_ID, DEFAULT_MAP_ID, DEFAULT_CAMERA_CONFIG.fov),
    });
    const settings = this.profile.settings;
    this.cameraConfig.fov = clampFov(settings.fov);
    this.selection = resolveSelection(settings);

    // The shader-error check costs four synchronous GPU round trips per program on its first
    // draw, so it follows the debug gate rather than shipping on. See `Renderer`'s constructor.
    this.renderer = new Renderer(canvas, consoleApiWanted(window.location.search, import.meta.env.DEV));
    // One measurement of the window, for the three things that are the same fact: the canvas,
    // the front end's frame, and the HUD's own pixels. Everything downstream reads `viewport`
    // rather than the window, so nothing forces a reflow mid-frame — see `ui/Viewport.ts`.
    viewport.set(window.innerWidth, window.innerHeight);
    this.renderer.setSize(viewport.width, viewport.height, settings.renderScale);
    this.introCamera = new IntroCamera({ movement: this.movementConfig });
    // The same fact for the DOM: the front end's 1920x1080 frame scales to this window (M15, A1).
    applyFrameScale(uiHost, viewport.width, viewport.height);
    this.textures = new ProceduralTextures(this.renderer.three);
    this.backdrop = this.createBackdrop();
    // Warm one representative bundle while BOOT/MENU are visible. Other skins load only when
    // an actor receives them, so a match does not reserve the whole cosmetic catalogue on the
    // GPU just because those files exist in public/.
    void this.characterAssets.preload(characterDefinition(DEFAULT_CHARACTER_ID)).catch(() => undefined);
    this.uiHost = uiHost;
    this.debugHost = debugHost;
    this.viewmodel = new ViewmodelLayer(this.cameraConfig);
    this.viewmodel.resize(this.renderer.aspect);
    // The capsule radius is what bounds how close the eye can get to a wall, and therefore
    // how far out the near plane may sit before it clips one. See `CameraRig.nearFor`.
    this.cameraRig = new CameraRig(this.cameraConfig, this.renderer.aspect, this.movementConfig.capsuleRadius);
    // Shaders and textures ahead of the frame that needs them (part 5). See `GpuWarmup`.
    gpuWarmup.attach(this.renderer.three, this.scene, this.cameraRig.camera);

    // The front end, in the order it is appended to the one host: that order is the order it
    // paints in, and three of these overlay each other.
    this.screens = this.createScreens(uiHost);
    this.input = this.createInput(canvas, settings);
    this.fpsCounter = new FpsCounter(uiHost, this.stats);
    this.loadingScreen = new LoadingScreen(uiHost);
    this.quickLoadout = this.createQuickLoadout(uiHost);
    this.voteOverlay = this.createVoteOverlay(uiHost);
    this.buildQueue = this.createBuildQueue();
    this.settingsScreen = this.createSettingsScreen(uiHost);

    this.surfaces = this.createSurfaces();
    this.frame = this.createFrame();
    this.session = this.createSession();

    this.loop = new Loop({
      sim: (tick) => this.simulate(tick),
      render: (alpha) => this.draw(alpha),
      onFrame: (sample) => this.onFrame(sample),
    });

    this.harness = new Harness(this.movementConfig);
    this.matchHarness = new MatchHarness({ game: this, loop: this.loop, stats: this.stats });

    this.registerStates();
    // M8: push the loaded settings through the one apply path, so what is on screen at boot
    // is what the save says and there is no separate "initial" wiring to drift from it.
    this.applySettings({});
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibility);
    // The page may already be hidden when the game boots — an unfocused tab, or a headless
    // run. Evaluating once at construction rather than waiting for a change that has already
    // happened is what makes that case work rather than silently never connecting.
    this.onVisibility();
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get currentState(): GameStateId {
    return this.state;
  }

  get activeMatch(): Match | null {
    return this.world?.match ?? null;
  }

  get menuSelection(): MenuSelection {
    return this.selection;
  }

  /**
   * The loaded map, or null outside a match.
   *
   * Public because `public/verify/*.js` reach for `game.map` and `game.player` to drive the
   * real collision world and the real controller. Until M7 those were private fields the
   * scripts read anyway — TypeScript's `private` is compile-time only — so the refactor that
   * moved them into `MatchWorld` would have silently broken six shipped acceptance suites.
   * They are getters now, which is what they always were in practice.
   */
  get map(): LoadedMap | null {
    return this.world?.map ?? null;
  }

  get player(): PlayerController | null {
    return this.world?.player ?? null;
  }

  /** The per-match debug tooling, or null outside a match. */
  get debugSuite(): DebugSuite | null {
    return this.world?.debug ?? null;
  }

  /**
   * The input seam, for the console API and the verification scripts.
   *
   * Read-only in practice: nothing outside `Game` drives it, and the two things a script
   * wants to know — whether the cursor is captured and whether a click would recapture it —
   * are not observable any other way.
   */
  /** Backing-buffer pixels per CSS pixel. Read by the render-scale sweep (M8). */
  get rendererPixelRatio(): number {
    return this.renderer.pixelRatio;
  }

  /**
   * The loop, for the hand-over tools (M8).
   *
   * Exposed rather than passed, because `installConsoleApi` is called from inside `BOOT`
   * and the tools it builds outlive every match. Read-only in practice: the only things
   * that drive the loop are `Game` and the two harnesses that already hold it.
   */
  get loopHandle(): Loop {
    return this.loop;
  }

  /**
   * What the GPU is holding (M15, A3): three.js's own counts of live geometries, textures and
   * linked programs.
   *
   * The instrument for a build/dispose cycle — the menu's backdrop map goes up and comes
   * down around every match now — read before and after N cycles in the pane, the way
   * `npm run leak` reads the heap and the bus count on the server.
   *
   * `programs` is the oracle for the light-count fix of 2026-10-18 (`equipment/EquipmentFx.ts`).
   * A program's cache key carries `numPointLights`, so a scene that changes how many lights it
   * has asks for a second complete set of programs; the number is expected to settle after the
   * warm-up hold and then stay put for the rest of the match, grenades included.
   */
  get gpuMemory(): { geometries: number; textures: number; programs: number } {
    const m = this.renderer.info.memory;
    return {
      geometries: m.geometries,
      textures: m.textures,
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  get inputState(): Input {
    return this.input;
  }

  get activeBotHarness(): BotHarness | null {
    return this.world?.botHarness ?? null;
  }

  /** The live player simulation state, or undefined outside a match. */
  get playerSim(): PlayerController['sim'] | undefined {
    return this.world?.player.sim;
  }

  /** Debug lever: burn this many milliseconds inside every frame (S7). */
  setSyntheticLoad(ms: number): void {
    this.loop.syntheticLoadMs = ms;
  }

  /** Kick the machine. BOOT starts the loop, then hands over to MENU. */
  start(): void {
    this.enterState('BOOT');
  }

  transitionTo(next: GameStateId): void {
    if (next === this.state) return;
    if (!isLegalGameTransition(this.state, next)) {
      throw new Error(`Illegal game transition ${this.state} -> ${next}`);
    }
    const handlers = this.states.get(next);
    if (handlers === undefined) {
      throw new Error(
        `Game state "${next}" has no handler registered. It is declared in GameStates.ts ` +
          `but not implemented in this milestone.`,
      );
    }
    const from = this.state;
    this.states.get(from)?.exit?.(next);
    this.state = next;
    // Post-M8: physical inputs only resolve to game actions inside a match. A front-end
    // screen owns the page, and the wheel and the arrow keys have to reach it — see
    // `Input.bindingsActive` for the scroll bug this closes.
    this.input.setBindingsActive(next === 'MATCH');
    handlers.enter?.(from);
    stateChangePayload.from = from;
    stateChangePayload.to = next;
    this.bus.emit(EV.GameStateChanged, stateChangePayload);
  }

  // -- state wiring --------------------------------------------------------

  /**
   * Apply a settings change, live, and persist it (M8, brief S6.3).
   *
   * **One function, called with a patch, that re-applies everything.** The alternative — a
   * switch on which key changed — is eleven branches that each have to be kept in step with
   * the screen, and the first one anybody forgets is a setting that silently does nothing,
   * which is the exact failure S6.3 opens by naming. Re-applying all of them costs a
   * handful of property writes on a user gesture and cannot drift.
   *
   * Persistence is separate and deliberately lazy: `Profile.patchSettings` marks the save
   * dirty and `SaveStore` coalesces the burst a slider drag produces into one write 250 ms
   * later. Live is immediate; written is a quarter of a second behind.
   */
  applySettings(patch: Partial<SettingsV1>): void {
    this.profile.patchSettings(patch);
    this.previewSettings(this.profile.settings);
  }

  /**
   * Apply a settings record to the live systems without persisting it (M17 C4, decision 2).
   *
   * The settings screen edits a draft and previews it here on every change, so a sensitivity
   * is felt on the frame the slider moves; APPLY hands the draft to `applySettings`, BACK
   * previews the saved record again. The one description of what a setting *does* lives here,
   * and the persisted path is that description on the saved record.
   */
  previewSettings(s: SettingsV1): void {
    // ---- look ------------------------------------------------------------
    this.input.setSensitivity(s.sensitivity);
    this.input.setAdsSensitivity(s.adsSensitivity);
    this.input.setInvertY(s.invertY);
    // By identity: a rebind hands over a new table, a slider does not, and `setBindings`
    // clears the held keys and re-arms the keyboard lock — not something to do per tick.
    if (s.bindings !== this.appliedBindings) {
      this.appliedBindings = s.bindings;
      this.input.setBindings(s.bindings);
    }
    this.cameraConfig.fov = clampFov(s.fov);

    // ---- audio -----------------------------------------------------------
    this.audio.setMasterVolume(s.masterVolume);
    this.audio.setBusVolume('sfx', s.sfxVolume);
    this.audio.setBusVolume('music', s.musicVolume);
    this.audio.setBusVolume('ui', s.uiVolume);

    // ---- video -----------------------------------------------------------
    this.renderer.setSize(window.innerWidth, window.innerHeight, s.renderScale);
    this.cameraRig.resize(this.renderer.aspect);
    this.viewmodel.resize(this.renderer.aspect);
    this.renderer.setShadowQuality(s.shadowQuality, this.scene);
    this.renderer.setMotionBlur(s.motionBlur);
    // A trail of the frame before a resolution change is a smear at the wrong size.
    this.renderer.resetMotionBlur();

    // ---- presentation ----------------------------------------------------
    // The palette writes CSS custom properties and notifies the canvases; everything that
    // draws a gameplay colour reads one of the two. See `ui/Palette.ts`.
    palette.set(s.colorblind);
    this.fpsCounter.setVisible(s.showFps);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** The map behind the menu (M15, A3), and on it the fight (E). */
  private createBackdrop(): MenuBackdrop {
    return new MenuBackdrop({
      scene: this.scene,
      textures: this.textures,
      shadowQuality: () => this.profile.settings.shadowQuality,
      // The fight behind the menu (M15, E) draws its bodies from the same service and with the
      // same filtering as a match does.
      characterAssets: this.characterAssets,
      anisotropy: () => this.textures.anisotropy,
    });
  }

  /** Every front-end screen, and the intent each of its controls raises. */
  private createScreens(uiHost: HTMLElement): GameScreens {
    return new GameScreens({
      host: uiHost,
      profile: this.profile,
      audio: this.audio,
      selection: this.selection,
      /**
       * Play Solo's Start button. Never connects — see `GameSession.launchMatch`.
       *
       * `multiplayerJoin` is cleared first because it survives a return to the menu: a player
       * who played multiplayer, quit to the menu and then chose Play Solo would otherwise be
       * dialled straight back into the arena by the leftover options.
       */
      onLaunch: () => {
        this.session.forgetMultiplayerJoin();
        void this.session.launchMatch();
      },
      onPlayMultiplayer: () => void this.session.playMultiplayer(),
      serverConfigured: () => isServerConfigured(window.location.search),
      foreignServer: () => foreignServerHost(window.location.search, window.location.host),
      onDisplayName: (name) => this.profile.patchSettings({ callsign: name }),
      onLoadout: (range) => {
        this.loadoutRange = range;
        this.transitionTo('LOADOUT');
      },
      onSettings: () => this.transitionTo('SETTINGS'),
      onLoadoutSaveAndExit: () => this.transitionTo('MENU'),
      onQuitToMenu: () => this.transitionTo('MENU'),
      onResume: () => this.resumeFromPause(),
      onToggleOverlay: () => this.toggleOverlayFromPause(),
      onCheatCode: (code) => this.surfaces.requestCheat(code),
      onLeaveSummary: () => this.leaveSummary(),
      onExitSummary: () => this.exitSummary(),
      pauseStatusLine: () => this.pauseStatusLine(),
      anisotropy: () => this.textures.anisotropy,
      characterAssets: this.characterAssets,
      weaponAssets: this.weaponAssets,
    });
  }

  /**
   * The input listener, and the two readers of the digit keys in the order they are offered
   * them.
   *
   * **Order is the rule** (M11 Gate B). A ballot is up for twenty seconds and takes the digits
   * while it is, and the quick class selector only ever appears in the pre-match freeze or on
   * the death screen — moments a ballot cannot be open. Registering the selector after the
   * overlay makes that ordering explicit rather than relying on the two windows never
   * overlapping.
   *
   * Returning true consumes the key either way, so 1-5 do not also swap weapons and call in
   * killstreaks: picking class 2 does not pull out the pistol, and picking class 5 does not
   * call in a Chopper Gunner.
   */
  private createInput(canvas: HTMLCanvasElement, settings: SettingsV1): Input {
    const input = new Input({
      canvas,
      sensitivity: settings.sensitivity,
      invertY: settings.invertY,
      bindings: settings.bindings,
    });
    input.onLockChange((locked) => this.onPointerLockChange(locked));
    input.onEscape(() => this.onEscape());
    // Digit keys vote while a ballot is open (M11, §6.4). The overlay answers false whenever
    // no ballot is open, which is every other moment of the game.
    input.onDigit((digit) => this.voteOverlay.handleDigit(digit));
    input.onDigit((digit) => this.quickLoadout.handleDigit(digit));
    return input;
  }

  /**
   * The quick class selector (M11 Gate B), on keys 1-5.
   *
   * Process-wide like every other front-end surface, and for the same reason: it outlives the
   * world it is drawn over, so a migration cannot dispose the panel out from under the player
   * mid-countdown.
   */
  private createQuickLoadout(uiHost: HTMLElement): QuickLoadout {
    return new QuickLoadout({
      host: uiHost,
      slots: () => this.profile.loadouts,
      equipped: () => this.profile.equippedIndex,
      onPick: (index) => this.pickQuickClass(index),
    });
  }

  /** The non-blocking vote overlay (§4.20), on the session's own clock. */
  private createVoteOverlay(uiHost: HTMLElement): VoteOverlay {
    return new VoteOverlay({
      host: uiHost,
      onVote: (phase, option) => this.world?.net?.client.sendVote(phase, option),
      currentTick: () => this.session.syncedServerTick(),
      audio: this.audio,
    });
  }

  /**
   * The chunked background map build (§6.5). Pumped from the render pass.
   *
   * Built at boot and kept, like every other front-end surface, and this one in particular
   * *must* be: its whole purpose is to be working on the next map while the current world is
   * still up, and a queue owned by the world would be disposed by the transition it exists to
   * make seamless.
   */
  private createBuildQueue(): MapBuildQueue {
    return new MapBuildQueue({
      textures: this.textures,
      shadowQuality: () => this.profile.settings.shadowQuality,
      // The report, and the readiness it may be worth telling the server about, are the
      // session's: the whole point of a background build is that it spans the transition.
      onComplete: (mapId, _built, report) => this.session.onBackgroundBuildComplete(mapId, report),
    });
  }

  /** M8. The settings screen. Built at boot and kept, like every other front-end screen. */
  private createSettingsScreen(uiHost: HTMLElement): Settings {
    return new Settings({
      host: uiHost,
      read: () => this.profile.settings,
      // The draft, live (M17 C4, decision 2): applied, not persisted.
      onPreview: (settings) => this.previewSettings(settings),
      // APPLY: persisted through the one apply path.
      onCommit: (settings) => this.applySettings(settings),
      onBack: () => this.transitionTo(this.settingsReturn),
      // M15 A4: the reset control lives on the INFO tab now; the wipe is still `Profile`'s.
      onResetProgress: () => this.profile.resetProgress(),
      profile: this.profile,
      serverConfigured: () => isServerConfigured(window.location.search),
      onDisplayName: (name) => this.profile.patchSettings({ callsign: name }),
    });
  }

  /** The HUD surfaces and the two stores they read (C23b). */
  private createSurfaces(): GameSurfaces {
    return new GameSurfaces({
      screens: this.screens,
      profile: this.profile,
      input: this.input,
      quickLoadout: this.quickLoadout,
      world: () => this.world,
      currentState: () => this.state,
    });
  }

  /** One frame's camera and picture (C23b). */
  private createFrame(): GameFrame {
    return new GameFrame({
      scene: this.scene,
      renderer: this.renderer,
      cameraRig: this.cameraRig,
      viewmodel: this.viewmodel,
      audio: this.audio,
      input: this.input,
      backdrop: this.backdrop,
      cameraConfig: this.cameraConfig,
      weaponDef: this.weaponDef,
      introCamera: this.introCamera,
    });
  }

  /** Everything about having a server (C23a), handed the surfaces it drives. */
  private createSession(): GameSession {
    return new GameSession({
      screens: this.screens,
      profile: this.profile,
      stats: this.stats,
      input: this.input,
      loadingScreen: this.loadingScreen,
      voteOverlay: this.voteOverlay,
      buildQueue: this.buildQueue,
      world: () => this.world,
      currentState: () => this.state,
      transitionTo: (next) => this.transitionTo(next),
      buildWorld: () => this.buildWorld(),
      teardownWorld: (options) => this.teardownWorld(options),
      modeEntry: () => this.modeEntry(),
      locationSearch: () => window.location.search,
      onCheatsAnswered: (outcome) => this.surfaces.onCheatsAnswered(outcome),
      onMigrationDiscard: () => this.surfaces.clearInstantCheat(),
    });
  }

  /**
   * The seven screens, each wired to the pair of handlers that is its whole definition.
   *
   * Wiring only, so the table of what states exist reads as a table. Every body below is a
   * named method, in the order the machine reaches them.
   */
  private registerStates(): void {
    this.states.set('BOOT', { enter: () => this.onEnterBoot() });
    this.states.set('MENU', { enter: () => this.onEnterMenu(), exit: () => this.screens.menus.hide() });
    this.states.set('LOADOUT', { enter: () => this.onEnterLoadout(), exit: () => this.onExitLoadout() });
    this.states.set('SETTINGS', { enter: (from) => this.onEnterSettings(from), exit: (to) => this.onExitSettings(to) });
    this.states.set('MATCH', { enter: () => this.onEnterMatch(), exit: (to) => this.onExitMatch(to) });
    this.states.set('PAUSED', { enter: () => this.onEnterPaused(), exit: (to) => this.onExitPaused(to) });
    this.states.set('SUMMARY', { enter: () => this.onEnterSummary(), exit: (to) => this.onExitSummary(to) });
  }

  /**
   * BOOT. The loop runs from boot so the menu is composited and the frame source is live
   * before any map exists.
   */
  private onEnterBoot(): void {
    this.screens.menus.showBoot('Loading…');
    // The loop runs from boot so the menu is composited and the frame source is live
    // before any map exists. Deliberately a timeout rather than requestAnimationFrame:
    // rAF never fires in a background tab, and booting into a tab the user has not
    // focused yet would hang forever.
    this.loop.start();
    this.transport.open();
    // Development, `?debug=1` or the bot harness only — see `consoleApiWanted`.
    if (consoleApiWanted(window.location.search, import.meta.env.DEV)) {
      installConsoleApi(this, this.harness, this.matchHarness);
    }
    // `?airpose` only, and never by default: BACKLOG #87's instrument, which costs one property
    // read per body per frame while it is off. See `AirPoseWatch` for the threshold's numbers.
    setAirPoseWatch(airPoseWatchWanted(window.location.search));
    window.setTimeout(() => this.openFrontEnd(), 32);
  }

  /**
   * One tick after boot: refuse the device, or play the splash, or land on the menu.
   *
   * ## The device gate (playtest round 5, F1)
   *
   * A phone loaded the menu, was shown a table of keyboard bindings and a note about
   * F11, and could start a match it had no way to play. The check is here rather than
   * inside the menu because *not transitioning* is the gate: there is no button to
   * disable, no state to be in, and nothing downstream has to know about it.
   *
   * The loop is left running on purpose — the screen is composited by it, and stopping
   * it would leave a message nobody can see.
   */
  private openFrontEnd(): void {
    const device = playability(readDeviceCapabilities());
    if (!device.ok) {
      netLog.warn(`refusing to start: ${device.id} — ${device.headline}`);
      this.screens.menus.showUnsupported(device.headline, device.detail);
      return;
    }
    if (splashWanted(window.location.search)) {
      this.playSplash();
      return;
    }
    this.transitionTo('MENU');
    this.startBotHarnessIfRequested();
  }

  /**
   * The splash (M17, C6), unless something is driving the page: the bot harness
   * starts its match from the menu and cannot press a key, and `?nosplash` is for
   * the developer who has seen it. The menu's map is rolled and built *behind* the
   * splash, so the menu lands on a built map rather than a bare canvas — the one
   * loading screen this project has ever needed, hiding the one build it has.
   */
  private playSplash(): void {
    this.prepareBackdrop();
    this.splash = new Splash({
      host: this.uiHost,
      audio: this.audio,
      // The key or the click is the user gesture the AudioContext needs (decision 1).
      onGesture: () => this.audio.start(),
      onReveal: () => this.transitionTo('MENU'),
      onDone: () => {
        this.splash = null;
      },
    });
    this.splash.play();
  }

  private onEnterMenu(): void {
    this.screens.menus.show(this.menuReturnPage);
    this.menuReturnPage = 'MAIN';
    this.input.clearHeld();
    /**
     * The map behind the menu (M15, A3; rolled since M17, C2): one of the real maps at
     * random, built a chunk a frame from here. It used to be the solo picker's map — so
     * the menu showed the last thing picked, across a reload, and showed the greybox
     * whenever that was it. Rolled **when there is none**: at boot, and on the way back
     * from a match, which disposed it (`buildWorld` does, so that the scene never holds
     * two maps). A return from Settings or Create-a-Class finds the one already there and
     * keeps it — a re-roll is a rebuild, and a rebuild is a few hundred frames of bare
     * canvas for a hop to a sibling screen and back.
     */
    this.prepareBackdrop();
  }

  /**
   * LOADOUT (M6). Declared in `GameStates.ts` since M1 with no handler; this is it.
   *
   * No world is built and no simulation runs — Create-a-Class is a front-end screen that
   * reads and writes the profile, and every edit persists through `Profile` as it is made
   * rather than on the way out. **Reachable from the menu and from nowhere else** since
   * playtest round 4 (B8); S6.3's "between spawns" is served by the quick class selector's
   * 1-5, which is what the report asked for. See the doctrine note further down this file.
   */
  private onEnterLoadout(): void {
    this.input.clearHeld();
    this.screens.loadoutEditor.show(this.loadoutRange);
  }

  /**
   * One exit, one destination, and the save happens here (playtest round 4, B5).
   *
   * `LEGAL_TRANSITIONS` admits `LOADOUT -> MENU` and nothing else, so this handler is the
   * whole of "no route leaves the editor without saving" — the button, Escape and anything
   * added later all pass through it. Putting the flush on the button instead would have
   * been a second writer waiting for a third route.
   *
   * `Profile.editLoadout` already persists every edit as it is made, but through
   * `SaveStore.touch`, which debounces the actual write. Leaving the screen is exactly the
   * moment that debounce stops being a kindness: a player who edits a class and closes the
   * tab a second later has made a decision, and `flush` is what makes it a saved one.
   */
  private onExitLoadout(): void {
    this.screens.loadoutEditor.hide();
    this.profile.flush();
    // Back to the page the editor was opened from: the range's class is the testbed
    // plate's, so it returns to Play Solo; the five classes return to the main page.
    this.menuReturnPage = this.loadoutRange ? 'PLAY' : 'MAIN';
  }

  /**
   * SETTINGS (M8). A front-end screen with no world, like LOADOUT.
   *
   * `settingsReturn` is where Back goes, captured on the way in — the screen is reachable
   * from the menu and from the pause screen and must come back to whichever one sent it,
   * because a player who paused a match to fix their sensitivity has a match waiting.
   */
  private onEnterSettings(from: GameStateId): void {
    this.settingsReturn = from === 'PAUSED' ? 'PAUSED' : 'MENU';
    this.input.clearHeld();
    this.settingsScreen.show();
  }

  private onExitSettings(to: GameStateId): void {
    this.settingsScreen.hide();
    if (to === 'MENU') this.teardownWorld();
  }

  private onEnterMatch(): void {
    this.audio.start();
    this.buildWorld();
    this.world?.match.setActive(true);
    // The click that started the match must not also pull the trigger.
    this.input.clearHeld();
    // The AFK harness has nobody to capture the cursor for, and asking for it without
    // a user gesture logs a rejection — which would put noise in the console the soak
    // run is there to prove is quiet.
    if (this.world?.botHarness == null && !this.matchHarness.isRunning) {
      // Armed rather than merely requested: resuming from the pause screen with Escape
      // has no user gesture, and resuming with the button can land inside Chrome's
      // post-Escape cooldown. Armed, the next click gets the cursor back either way.
      this.input.armPointerLock(true);
      // Only bites while the page is fullscreen; see Input.lockKeyboard and PLAN.md.
      this.input.lockKeyboard();
    }
  }

  private onExitMatch(to: GameStateId): void {
    this.input.unlockKeyboard();
    this.input.armPointerLock(false);
    this.audio.setSlide(false, 0, 0, 0, 0);
    // Pausing keeps the match active and the world built: it is the same match, simply
    // not advancing. Only leaving for good deactivates it.
    if (to === 'PAUSED') return;
    this.input.exitPointerLock();
    this.world?.match.setActive(false);
    // Going back to the menu without a result tears down here; going to SUMMARY keeps
    // the world alive so the scene is still behind the summary screen.
    if (to === 'MENU') this.teardownWorld();
  }

  /**
   * PAUSED (M5). The world stays built and `simulate` stops advancing it.
   *
   * Deliberately not a `Loop.stop()`: the render pass still has to run so the pause
   * screen is composited over a live scene, and `FrameStats` should keep sampling so the
   * histogram does not develop a hole every time somebody pauses.
   */
  private onEnterPaused(): void {
    this.input.clearHeld();
    // Disarmed while paused: a click belongs to the pause menu's buttons, not to
    // recapturing the cursor the player just released.
    this.input.armPointerLock(false);
    this.input.exitPointerLock();
    // The overlay is interactive DOM over a modal screen, which is exactly the clash the
    // pause menu was reported for, so it goes off for the pause — and the pause menu has
    // a button to bring it back deliberately. Nothing is written here to arrange that:
    // `debugOverlayVisible` returns false for an `'inMatch'` request on this screen, and
    // true again the moment the player resumes. The request is never touched, so there is
    // nothing for the resume to have to remember.
    this.screens.pauseMenu.show();
  }

  private onExitPaused(to: GameStateId): void {
    this.screens.pauseMenu.hide();
    if (to === 'MENU') {
      this.world?.match.setActive(false);
      this.teardownWorld();
    }
  }

  /**
   * SUMMARY. The result, the XP it is worth, and the board that shows both.
   *
   * **The server's result wins over the local one** (M11, §6.9). Over the network the
   * authoritative outcome arrives as `MsgS.Summary`, built by the instance from its own
   * `ScoreSystem` **before teardown**. The client's `MatchFlow` has a result too,
   * reconstructed from replicated state, and where they disagree the server is right by
   * definition — §4.15 puts scores and match flow on the replicated side of the table. The
   * local one is still the fallback, because single-player has no other.
   */
  private onEnterSummary(): void {
    const match = this.world?.match ?? null;
    const result = this.session.takeNetSummary() ?? match?.flow.result ?? null;
    if (match === null || result === null) {
      // Nothing to summarise: this can only happen if SUMMARY is entered by hand.
      this.transitionTo('MENU');
      return;
    }
    // Bank the match here rather than in `MatchEnded`: by this point nothing else is
    // going to change, and the profile is written exactly once (S6.6). `bankProgression`
    // is idempotent, so a harness that re-enters SUMMARY cannot double-count.
    const banks = findMode(this.selection.modeId).banksProgress;
    // "Did I win" is the server's seat — side and entity — not the single-player constant,
    // and it is `wonBy` rather than a side comparison because in Free-for-All only one
    // entity won (M13 Phase A, bug 4.4).
    const won = wonBy(result, match.localTeam, match.localId);
    /**
     * The server's XP, when there is a server (§6.9).
     *
     * *"XP and challenge progress are awarded by the instance from authoritative events and
     * delivered with the summary, **before teardown**. The client persists them to its own
     * `localStorage` save."* So the client does not compute the total over the network — it
     * receives it, animates it, and banks it. Locally it still computes its own, because in
     * single-player there is nobody else to.
     *
     * Both paths end at `Profile.bankMatch`, which is the one place XP becomes durable.
     */
    const report = this.session.bankServerXp(won) ?? match.bankProgression(won);
    this.showSummaryScreen(match, result, banks ? report : null);
  }

  /** The board itself, with what the map, the mode and the roster were called. */
  private showSummaryScreen(match: Match, result: MatchResult, report: XpReport | null): void {
    const mapEntry = this.mapEntry();
    this.screens.showSummary(
      match,
      result,
      {
        mapName: mapEntry.name,
        mapPicture: mapEntry.picture,
        modeName: this.modeEntry().name,
        // The tier is this client's choice in single-player; connected, the roster is the server's.
        difficulty: this.session.isConnected ? null : BOT_DIFFICULTY_NAMES[this.selection.difficulty],
      },
      report,
      this.profile.prestige,
      this.lineupSource(match),
      // The connection decides this, not the hold. See `GameScreens.showSummary`.
      this.session.isConnected,
    );
    this.screens.summary.setRemainingSeconds(this.session.summaryRemainingSeconds());
  }

  /**
   * Back into the game keeps the game (M11 Gate B playtest).
   *
   * The only two ways out of SUMMARY used to be "the server rotated us" and "tear
   * everything down", and the Continue button took the second one — so a player who
   * pressed it while connected did not go back to the lobby, they left the server: the
   * world was disposed, `teardownWorld` cleared `this.server`, the socket closed, and
   * they landed on the main menu. Reported as *"extra clicks throw the player completely
   * out to the Main Menu instead of the lobby"*, which is exactly what it did.
   *
   * `to === 'MATCH'` covers both remaining routes — the button, and the rotation that
   * `applyRotation` has already prepared a world for — and neither of them wants this
   * world dropped here.
   */
  private onExitSummary(to: GameStateId): void {
    this.screens.hideSummary();
    if (to === 'MATCH') return;
    this.teardownWorld();
  }

  /**
   * What the podium needs about each entity (M15, D1): the body the world's own selector
   * dealt it — the local player's is the skin they picked (B5), since nobody draws their body
   * on this client — and what it was last holding, from the list the renderer draws: the
   * local player's from the weapon in their hands, everybody else's from their actor, and
   * null for an entity the renderer never saw armed, which is an unarmed body rather than a
   * wrong one.
   */
  private lineupSource(match: Match): LineupSource {
    const selector = this.characterSelector;
    const localId = match.localId;
    return {
      characterIdFor: (entityId) => {
        if (entityId === localId) return this.profile.skinId;
        // The body the actor declared (M16, B6), or the deal for one who did not — the same
        // preference the live resolver makes, so the podium shows the player the match did.
        const declared = this.declaredCharacterId(match, entityId);
        return declared ?? (selector === null ? DEFAULT_CHARACTER_ID : selector.characterIdFor(entityId));
      },
      weaponIdFor: (entityId) => {
        if (entityId === localId) return match.weapons.definition.id;
        for (const actor of match.actorsForRender()) {
          if (actor.entityId === entityId) return actor.weaponId;
        }
        return null;
      },
    };
  }

  /**
   * The body a rendered actor declared (M16, B6), or null for one that declared none or that
   * the renderer never saw. `weaponIdFor` loops the same list; the skin is the podium's other
   * per-body fact.
   */
  private declaredCharacterId(match: Match, entityId: number): CharacterId | null {
    for (const actor of match.actorsForRender()) {
      if (actor.entityId === entityId) return actor.characterId;
    }
    return null;
  }

  // -- the loadout doctrine -------------------------------------------------

  /*
   * Where Create-a-Class went, and the two reversals behind it (playtest round 4, B5 and B8).
   *
   * There is no `openLoadout` and no `closeLoadout` any more, and that is the change. M11 §6.6 made the editor
   * reachable from inside the warmup arena; round 2 found that every route out of it was
   * costly — Back went to `MENU` and tore the world down, Escape went to `PAUSED`, and the
   * editor's own "Start match" cleared `multiplayerJoin` and launched a solo game — and fixed
   * it by making the editor an *overlay* over the live world, so there was no transition left
   * to route wrongly.
   *
   * Round 4 asks for the opposite, and it is a design decision rather than a defect: **the
   * editor is a front-end screen, and inside a match the only way to change class is keys
   * 1-5.** So the overlay is gone rather than fixed, `LEGAL_TRANSITIONS` no longer admits
   * `MATCH -> LOADOUT` or `PAUSED -> LOADOUT`, and `Menus` is the one door.
   *
   * **What survived the removal is the half that protects the surviving path.** The deferral of
   * `meta.setLoadout` (Tier 1 #20) was built for the overlay and matters more without it: a
   * class applied to a standing body re-runs the perk hooks, one of which writes
   * `PlayerController.speedScale`, so the client predicts a speed the server — which defers to
   * the next spawn — is not simulating. That is a per-tick disagreement about how fast you are
   * moving, which is what rubberbanding is. `pickQuickClass` is now the *only* caller of that
   * pair, so `ClientMatch.applyLoadout` and `ServerMatch.setPendingLoadout` are load-bearing
   * for 1-5 alone.
   *
   * What is left in this file is `pickQuickClass` below and the `LOADOUT` state above. This
   * note is here rather than on either of them because it is about the *absence* of the code
   * that used to sit between them, and a deletion has nowhere else to be documented.
   */

  // -- HUD surfaces ---------------------------------------------------------

  /**
   * Every HUD surface this class owns, decided once per frame from one place.
   *
   * This is the invariant playtest round 4 asked for, and the three reports it answers were
   * all the same defect in different costumes: a surface whose visibility was written from
   * **two** places (the debug overlay, where the × wrote one copy and the pause bookkeeping
   * the other), or from a place that **stops running** at the moment the answer had to change
   * (the scoreboard, written from the sim tick, which does not tick while paused).
   *
   * The rules themselves are pure functions in `shared/ui/HudSurfaces.ts`, which is what makes
   * them measurable: `HeadlessClient` builds no `ClientMatch` and has no DOM, so a claim about
   * a panel is a browser claim — but the rule behind it is an ordinary function the harness can
   * run over a real connection across death, respawn, round end and migration. Same reasoning,
   * and the same shape, as `pickSpectatorTarget`.
   *
   * Driven from state every frame rather than opened and closed by events, for the reason
   * `syncChopperBody` gives about the chopper: each window can end four ways — the countdown
   * expires, the player respawns, the match ends, the world is torn down — and a latch would
   * have to be cleared correctly on all of them. Asked every frame, there is nothing to get
   * stuck, and a panel stuck on screen is one eating the digit keys for the rest of the match.
   */
  /**
   * The player pressed 1-5.
   *
   * Equips the class, hands it to the local simulation and tells the server. Over the network
   * the server applies it immediately during the pre-match countdown and on the next spawn
   * otherwise — see `ServerMatch.applyPendingLoadoutNow` — which is the same rule the panel's
   * own caption states.
   */
  private pickQuickClass(index: number): void {
    const world = this.world;
    if (world === null) return;
    if (index === this.profile.equippedIndex) return;
    this.profile.equipLoadout(index);
    world.match.applyLoadout(this.applyLoadout());
    this.sendLoadoutToServer();
  }

  /** Tell the server about the equipped class. It applies on this player's next spawn (§6.6). */
  private sendLoadoutToServer(): void {
    const client = this.world?.net?.client;
    const loadout = this.session.netLoadout();
    if (client === undefined || loadout === null) return;
    client.sendLoadout(loadout);
    netLog.info(`sent class "${loadout.name}" to the server; applies on next spawn.`);
  }

  /**
   * The summary's Continue button (§6.9).
   *
   * Single-player is unchanged: the match is over, the player has read the board, and the menu
   * is where they were going. **Over the network it is a return to the game**, not a departure
   * from it — the server is still holding this seat and will migrate everybody back to the arena
   * on its own clock, so all this does is take the board off the screen and put the player back
   * behind their eyes until that lands. The connection, the world and the seat all survive.
   */
  private leaveSummary(): void {
    if (this.state !== 'SUMMARY') return;
    if (this.session.isConnected && this.world !== null) {
      this.transitionTo('MATCH');
      return;
    }
    /**
     * PLAY AGAIN (M18): the same match again, in single-player — the map, the mode and the
     * difficulty as the selection stands, which is what it stood at when this one started.
     * The world is torn down here rather than by SUMMARY's exit handler, which keeps it for
     * `to === 'MATCH'` because that route is the server's rotation; MATCH's `enter` then
     * builds a fresh one, and a fresh world is a fresh intro, a fresh deck and a fresh seed.
     */
    this.teardownWorld();
    this.transitionTo('MATCH');
  }

  /**
   * The summary's secondary button: leave the server (playtest round 4, B4).
   *
   * The genuine opposite of the primary, which is the only reason there are two of them. MENU's
   * arrival tears the world down through the SUMMARY exit handler, `teardownWorld` clears
   * `this.server`, and the socket closes — which frees the seat on the server immediately
   * rather than after a ten-second timeout.
   *
   * Offered only when connected: in single-player it would be the same button twice.
   */
  private exitSummary(): void {
    if (this.state !== 'SUMMARY') return;
    this.transitionTo('MENU');
  }

  private enterState(id: GameStateId): void {
    this.state = id;
    this.input.setBindingsActive(id === 'MATCH');
    if (id !== 'MATCH') this.warmWeaponAssets();
    this.states.get(id)?.enter?.(id);
  }

  /**
   * Fetch the equipped class's weapon and equipment files while a screen is up (M19, stage 1;
   * the grenades added 2026-09-24).
   *
   * The same reasoning as the default skin warmed at boot: the templates are the
   * application's, a match should start with them ready, and the menu is where there is time.
   * Only the two equipped weapons — never the arsenal — and `preload` is a no-op for a weapon
   * that has no file or already has its template, so this is cheap to call on every screen
   * the player passes through, which is how a class edited in the loadout editor is warm by
   * the time they press Play. A failure is logged by the service and the match falls back to
   * the primitives; nothing here waits on it.
   *
   * **The grenades have to be warmed here and not at the match's first tick**, which is where
   * they were and which is the bug the human reported: the first grenade of a match came out
   * as the old empty-handed throw and every one after it was right. `ClientMatch` asks for them
   * in its constructor, and that request queues behind the weapons, the arms, the knife, the
   * skins and the map — megabytes of it — so on a real machine the file lands seconds after the
   * player has already drawn, thrown and moved on. Asked for on the menu they are there before
   * Play is pressed. `ClientMatch` still asks, because a class edited between spawns changes
   * which two a match needs.
   */
  private warmWeaponAssets(): void {
    const slot = this.profile.equippedLoadout();
    for (const weaponId of [slot.primary.weaponId, slot.secondary.weaponId]) {
      void this.weaponAssets.preload(weaponId).catch(() => undefined);
    }
    for (const equipmentId of [slot.lethal, slot.tactical]) {
      void this.weaponAssets.preloadEquipment(equipmentId).catch(() => undefined);
    }
    void this.weaponAssets.preloadKnife().catch(() => undefined);
    void this.weaponAssets.preloadHands().catch(() => undefined);
    this.warmWorldAssets();
    this.warmArsenalViewmodels();
  }

  /**
   * The rest of the arsenal's viewmodels, behind everything above (BACKLOG #35).
   *
   * The reported symptom: land on a weapon in Create-a-Class, or carry a class edited between
   * spawns into a match, and the grey primitive fallback stands in for as long as the file
   * takes to arrive. Nothing warmed these, so the editor and the preview asked per weapon as
   * the player reached one — `LoadoutEditor.warmWeaponFile` and `WeaponPreview.showWhenLoaded`
   * — and that request is what the grey was waiting on.
   *
   * **Last, and that is the whole of the decision.** Three answers were on the table: warm the
   * arsenal at boot, warm it behind the menu once the equipped class is ready, or leave it on
   * demand and spend the fix on a better placeholder. This is the middle one. A full template
   * is roughly four times an LOD, so the arsenal is tens of megabytes — real on a connection
   * that may not want them, and fetched once a version because the cache headers keep them.
   * Asking for them *after* the two weapons the player is about to hold, the grenades, the
   * knife, the arms and the world's LODs means the queue is already satisfied by the time
   * these start, and the moment the player presses Play costs exactly what it cost before.
   *
   * `preload` is a no-op for a weapon that already has its template, so the two equipped ones
   * are not fetched twice and this is cheap to call on every screen the player passes through.
   */
  private warmArsenalViewmodels(): void {
    for (const def of ALL_WEAPONS) void this.weaponAssets.preload(def.id).catch(() => undefined);
  }

  /**
   * The files the *world* draws, fetched while a screen is up (part 5).
   *
   * Every one of these used to be asked for by the frame that first needed it: a body's weapon
   * when a bot carrying it appeared, the sentry and the station when a match began, a grenade when
   * somebody threw one. So they landed in the opening seconds of a match, each with a first frame
   * that compiled its programs — the stalls the playtest timed on entering the arena (the turret
   * and three bodies' rifles) and on entering Depot (the station and two more). The menu is where
   * there is time. This is the whole arsenal, because the bots deal from all of it, and at *LOD*
   * detail: the bodies' files are a quarter of a viewmodel's each, about nine megabytes for the
   * fifteen, fetched once a version — the cache headers keep them after that. The full
   * templates follow, in `warmArsenalViewmodels`, deliberately behind these.
   * Each one is compiled for the scene's lights as it lands (`GpuWarmup.adopt`).
   */
  private warmWorldAssets(): void {
    for (const def of ALL_WEAPONS) void this.weaponAssets.preloadLod(def.id).catch(() => undefined);
    for (const id of STREAK_WEAPON_IDS) void this.weaponAssets.preloadLod(id).catch(() => undefined);
    for (const def of ALL_EQUIPMENT) void this.weaponAssets.preloadEquipment(def.id).catch(() => undefined);
    void preloadSentry();
    void preloadStation();
  }

  // -- world ---------------------------------------------------------------

  /**
   * The map this match is played on.
   *
   * **The server's answer wins when there is one** (M10, playtest round 2). S4.9 makes the
   * server authoritative over the simulation, and the map is not a presentation choice — it
   * is the collision world every position in every snapshot is expressed against. A client
   * that loaded a different one was not "showing the wrong level", it was predicting against
   * different geometry and being corrected by a server that could see through its walls.
   */
  private mapEntry(): ReturnType<typeof findMap> {
    const server = this.session.server;
    if (server !== null) return findMap(server.welcome.mapId);
    // A mode may pin its map — the Shooting Range only exists on the grey-box testbed,
    // because that is where the target dummies are built.
    const forced = findMode(this.selection.modeId).forcedMapId;
    return findMap(forced ?? this.selection.mapId);
  }

  /** The mode. The server's when connected, for the same reason as the map. */
  private modeEntry(): ReturnType<typeof findMode> {
    const server = this.session.server;
    if (server !== null) return findMode(asModeId(server.welcome.modeId));
    return findMode(this.selection.modeId);
  }

  /**
   * Resolve the equipped class into the three long-lived weapon objects.
   *
   * **The mode is the server's when there is one** (M11 playtest). It used to be
   * `this.selection.modeId` — the *local menu* selection — and that is a divergence with teeth:
   * `applyEquippedLoadout` passes the mode's `unrestricted` flag into `resolveEquipped`, and
   * the Shooting Range lifts every unlock gate *and resolves a different slot entirely*. A
   * player whose menu was last left on the range would join a networked FFA, send the class
   * from their equipped slot, and then locally resolve the **range** slot — a different weapon,
   * different perks, and therefore a different `speedScale` from the one the server applied.
   *
   * That is Tier 1 #20 all over again, arriving from the client's side rather than the
   * server's, and it presents identically: a constant per-tick disagreement about speed that
   * reads as rubberbanding.
   */
  private applyLoadout(): ResolvedLoadout {
    return applyEquippedLoadout(this.profile, this.modeEntry().id, {
      primary: this.weaponDef,
      secondary: this.secondaryDef,
      playerBase: this.playerBaseDef,
    });
  }

  /**
   * Build the world this match is played in. Called on entering MATCH, so the map the player
   * picked is the map that loads and a second match starts from nothing rather than from
   * whatever the first one left behind.
   */
  private buildWorld(): void {
    if (this.world !== null) return;
    // One map in the scene, ever: the menu's backdrop goes before the match's map arrives.
    this.backdrop.dispose();
    const characterSelector = this.dealCharacterDeck();
    this.characterSelector = characterSelector;
    this.world = new MatchWorld(this.worldDeps(characterSelector));
    // A new map is a new light setup, and every program in the scene is compiled for one: the
    // first frame of the world prepares them instead of stalling on them. See `GpuWarmup`.
    gpuWarmup.requestScene();
    this.bindDebugOverlay();
  }

  /**
   * One cosmetic skin deck per Match, outside shared/simulation code: gameplay never depends
   * on the skin a client happened to draw.
   *
   * Seeded rather than `Math.random` (S2), from the two counters that move between matches —
   * the lifetime count in the save and the per-session build count — so consecutive matches
   * deal different decks and any one of them can be dealt again from the same save.
   */
  private dealCharacterDeck(): RandomCharacterSelector {
    this.worldsBuilt++;
    return new RandomCharacterSelector(
      new Rng(CHARACTER_DECK_SALT ^ (this.profile.save.profile.matchesPlayed << 16) ^ this.worldsBuilt),
    );
  }

  /**
   * The body the player declared (M16, B6), or the deal for one who did not — the fallback
   * the `CharacterAvatarProvider` comment promised. A bot's `characterId` is null, so the
   * whole roster still deals exactly as it did before the wire.
   */
  private avatarFor(
    actor: { characterId: CharacterId | null; entityId: number },
    characterSelector: RandomCharacterSelector,
  ): ReturnType<CharacterAssetService['avatarProvider']> {
    return this.characterAssets.avatarProvider(
      characterDefinition(actor.characterId ?? characterSelector.characterIdFor(actor.entityId)),
    );
  }

  /**
   * Everything the per-match world is built from: this process's long-lived objects, the
   * config records the tuning panel holds, and the suppliers for the three facts that outlive
   * the world itself.
   */
  private worldDeps(characterSelector: RandomCharacterSelector): MatchWorldDeps {
    const modeEntry = this.modeEntry();
    return {
      bus: this.bus,
      scene: this.scene,
      renderer: this.renderer,
      weaponAssets: this.weaponAssets,
      textures: this.textures,
      characterAvatarProvider: (actor) => this.avatarFor(actor, characterSelector),
      viewmodel: this.viewmodel,
      cameraRig: this.cameraRig,
      audio: this.audio,
      input: this.input,
      loop: this.loop,
      transport: this.transport,
      server: this.session.server,
      uiHost: this.uiHost,
      debugHost: this.debugHost,
      stats: this.stats,
      speedo: this.speedo,
      matchHarness: this.matchHarness,
      profile: this.profile,
      movementConfig: this.movementConfig,
      cameraConfig: this.cameraConfig,
      viewmodelConfig: this.viewmodelConfig,
      healthConfig: this.healthConfig,
      equipmentConfig: this.equipmentConfig,
      weaponDef: this.weaponDef,
      secondaryDef: this.secondaryDef,
      playerBaseDef: this.playerBaseDef,
      tiers: this.tiers,
      perceptionConfig: this.perceptionConfig,
      schedulerConfig: this.schedulerConfig,
      mapEntry: this.mapEntry(),
      modeEntry,
      difficulty: this.selection.difficulty,
      loadout: this.applyLoadout(),
      onMatchEnded: () => this.session.noteMatchEnded(),
      // The screen, read at the moment a command is built. See `MatchWorldDeps.inMatch`.
      inMatch: () => this.state === 'MATCH',
      // F14. The same merge every surface reads, so the simulation and the tag cannot disagree.
      cheats: () => this.surfaces.cheatMask,
      requestCheat: (bits) => this.surfaces.requestCheatBits(bits),
      onConfigChanged: () => this.onConfigChanged(),
      onWeaponConfigChanged: () => this.onWeaponConfigChanged(),
      // M11 (§7). Suppliers rather than values: all three outlive this world, which is the
      // whole point of them — the build spans the transition that replaces it.
      lastBuild: () => this.session.buildReport,
      buildProgress: () => this.buildQueue.progress,
      migrationWindows: () => this.session.windows,
    };
  }

  /**
     * The × asks; it does not decide (playtest round 4, B1).
     *
     * Bound after construction, like `PauseMenu.setOnLoadout` and `NetSession.onMatchState`,
     * and for the same reason: the panel is built by the world and the fact it is asking about
     * outlives the world. Re-bound on every build because the overlay is a new object each
     * time and `debugRequest` is not.
     */
  private bindDebugOverlay(): void {
    const overlay = this.world?.debug.overlay;
    if (overlay === undefined) return;
    overlay.onDismiss = () => this.surfaces.dismissDebugOverlay();
    // A fresh surface starts hidden; the frame pass puts it back up if the request survived a
    // rotation. Without this the new overlay would show a frame late, which is harmless, and
    // would also be a second place deciding — which is not.
    overlay.setVisible(this.surfaces.isDebugOverlayVisible());
  }

  /**
   * Drop the world. `MatchWorld.dispose` is the mirror of its own constructor.
   *
   * `keepConnection` is the map-rotation case: the server has started a new match on the same
   * socket, so the world goes and the connection stays. Everything else — leaving to the
   * menu, quitting from the pause screen, finishing the summary — is a real departure and
   * closes the link, which is what frees the seat on the server without waiting for a timeout.
   */
  private teardownWorld(options: { keepConnection?: boolean } = {}): void {
    // A rotation keeps the socket no matter which teardown runs. The SUMMARY state tears the
    // world down on its way out and has no way to know a rotation is why it is leaving.
    const keep = this.session.forgetPendingTransitions(options.keepConnection === true);
    /**
     * The offline authority's own seat boundary (round 4, F14).
     *
     * `MatchInstance.unseat` is where a *server* ends a seat's entitlements. Offline there is no
     * seat and no server, and this is the same boundary: the world the cheat was granted in is
     * going away. Without it a single-player god mode would follow the player through the menu
     * into their next match, which is the same defect the networked half was fixed for.
     *
     * Networked, this field is not read at all — see `cheatMask` — so clearing it costs nothing
     * and is not a second writer of the replicated answer.
     */
    this.surfaces.clearOfflineEntitlements();
    this.surfaces.clearInstantCheat();
    this.world?.dispose({ keepConnection: keep });
    this.world = null;
    this.characterSelector = null;
    // The intro's plan was for that world; the next one plans afresh on its first frame.
    this.introCamera.reset();
    this.speedo.reset();
    // The socket, the ballot and the seat token, which are the session's to give up.
    this.session.leaveSession(keep);
  }

  /**
   * `?harness=botmatch` boots straight into an AFK bot match (S7).
   *
   * The roster is populated *before* the flow starts so `Match.setActive` sees a non-empty
   * one and skips the default firefight — otherwise a full roster would be built and thrown
   * away on the same frame.
   */
  private startBotHarnessIfRequested(): void {
    const options = parseHarnessOptions(window.location.search);
    if (options === null) return;
    if (options.map !== null) this.selection.mapId = options.map;
    // M7: the harness can run any mode. Applied before the transition, so the world is built
    // from the same registry entry a player's choice would have produced.
    if (options.mode !== null) this.selection.modeId = options.mode;

    /**
     * M8: `?matches=N` hands the run to `MatchHarness` instead of playing one match here.
     *
     * They answer different questions and always did — `BotHarness` proves a *firefight* is
     * stable, `MatchHarness` proves a *build and teardown cycle* is — and until M8 they were
     * two tools with two entry points. One flag now picks between them, and the bot count,
     * speed, tier, map and mode from the same query string apply to both.
     */
    if (options.matches > 1) {
      void this.matchHarness.run(options.matches);
      return;
    }

    this.transitionTo('MATCH');
    this.world?.startBotHarness(options);
  }

  private onConfigChanged(): void {
    this.world?.applyMovementConfig();
    this.cameraConfig.fov = clampFov(this.cameraConfig.fov);
    this.profile.patchSettings({ fov: this.cameraConfig.fov });
  }

  /** The map behind the menu, rolled when there is none — see `MENU`'s `enter`. */
  private prepareBackdrop(): void {
    if (this.backdrop.mapId !== '') return;
    const entry = rollBackdropMap(this.backdropDice.float(), this.lastBackdropMapId);
    this.lastBackdropMapId = entry.id;
    this.backdrop.prepare(entry.id);
  }

  private onWeaponConfigChanged(): void {
    this.world?.applyWeaponConfig();
  }

  // -- loop ----------------------------------------------------------------

  private simulate(tick: number): void {
    const world = this.world;
    // No world: the fight behind the menu takes the step instead (M15, E). Same loop, same
    // fixed `DT`, so a menu is simulated the way a match is and costs what its bots cost.
    if (world === null) {
      this.backdrop.simulate();
      return;
    }

    // Input crosses the netcode boundary even in single player: the sim only ever
    // sees command data, which is what keeps the command seam real (S4.2). Which command
    // this tick is worth is `MatchWorld.sampleCommand`'s decision, for both runtimes.
    /**
     * Networked (M10): the session owns the tick.
     *
     * `NetClient` decides *which* tick to simulate from the synced server clock rather than
     * from this frame's accumulator — S4.11's rule that a client never increments its own
     * tick number — so the whole local step loop is skipped rather than adapted. It samples
     * through `MatchWorld.sampleCommand`, which applies the same three-way choice made below.
     *
     * **Serviced on every screen, and that is the round-4 fix for B4.** This call used to be
     * `if (inMatch) net.update()`, which conflated two decisions: *what the player's command
     * contains* — nothing, off the match screen — and *whether this client is still talking to
     * the server at all*. Going silent is not a neutral command. It stops the pings, stops the
     * reads, and stops `NetClient` noticing that the link has closed, because the check at the
     * top of `update` is the only place `state` becomes `'disconnected'`.
     *
     * The summary screen is held for `SUMMARY_HOLD_SECONDS` (14) and `CLIENT_TIMEOUT_MS` is
     * 10 000, so **every player who watched the post-match board was reaped four seconds before
     * the server would have migrated them home**, with the return `Welcome` sitting unread in a
     * queue nobody was draining. The pause screen had the same hole and no clock to make it
     * fire reliably. The neutral command is now `sampleCommand`'s first branch, where it says
     * what it means.
     *
     * `pumpNetworkWhileHidden` has always called this unconditionally, which is the shape this
     * follows — and is why a backgrounded tab survived the summary screen that a visible one
     * did not.
     */
    const net = world.net;
    if (net !== null) {
      world.match.netFrozen = net.frozen;
      net.update();
      world.debug.simulate(world.player, this.movementConfig);
      // The seat token and the two ways a link ends are the session's. See
      // `GameSession.afterNetworkUpdate`.
      this.session.afterNetworkUpdate(net);
      return;
    }

    // A paused match does not advance. The render pass still runs, so the pause screen is
    // composited over a live scene and the frame histogram keeps sampling.
    //
    // Below the networked branch on purpose: a pause is a local decision about a local
    // simulation, and there is no pausing a dedicated server. A networked client that stopped
    // here stopped talking, which is B4's mechanism arriving through the other door.
    if (this.state === 'PAUSED') return;

    this.transport.submit(world.sampleCommand(tick));
    const count = this.transport.drain(this.drainBuffer, MAX_STEPS_PER_FRAME);
    for (let i = 0; i < count; i++) {
      const drained = this.drainBuffer[i];
      if (drained === undefined) continue;
      world.player.weaponSpeedScale = world.weaponMoveScale(drained);
      world.player.step(drained);
      // The weapon consumes the same command the player did, one tick at a time, so
      // fire rate and reload timing are as frame-rate independent as movement is (S4.1).
      world.match.simulate(drained);
    }
    world.debug.simulate(world.player, this.movementConfig);
  }

  private draw(alpha: number): void {
    const now = performance.now();
    const dt = Math.max(0, (now - this.lastRenderMs) / 1000);
    this.lastRenderMs = now;

    this.fpsCounter.update(dt);

    /**
     * The countdown and the background build, once per frame (M11, §6.4, §6.5).
     *
     * Both before the world check, because both matter with no world: the overlay's clock must
     * keep running through a transition, and the build must keep making progress while the
     * world is being swapped underneath it — that swap is the moment it exists to cover.
     *
     * The build is pumped **after** the frame's game logic in the sense that matters: it takes
     * a small fixed budget and yields, so a frame that was already expensive simply does one
     * chunk fewer. See `MapBuildQueue`.
     */
    this.voteOverlay.tick();
    this.surfaces.update();
    // The editor's weapon preview spins from the render pass rather than from a timer of its
    // own, so it stops with the frame loop instead of running on in a background tab. It
    // early-outs when the screen is hidden, which is every frame of a match.
    this.screens.loadoutEditor.tick(dt);
    // The summary's lineup, the same way (M15, D1): it early-outs when the screen is hidden.
    this.screens.summary.tick(dt);
    /**
     * The post-match return clock, once per frame, from the server's own deadline.
     *
     * Pushed rather than integrated: `summaryRemainingSeconds` is a pure function of a tick the
     * server sent and a tick the clock sync maintains, so a client that stops hearing from the
     * server stops counting — which is the honest failure, and the one the old local `dt` could
     * not produce. Ticked from here rather than from a timer of the screen's own so it stops
     * with the frame loop rather than running on in a background tab.
     */
    if (this.state === 'SUMMARY') {
      this.screens.summary.setRemainingSeconds(this.session.summaryRemainingSeconds());
    }
    this.session.pumpMigrationWindow();
    this.session.pumpBackgroundBuild();

    const world = this.world;
    if (world === null) {
      this.frame.renderBackdrop(dt, alpha);
      return;
    }
    this.frame.renderWorld(world, alpha, dt);
    // Between frames, with nothing part-way through a dispatch. Also serviced from the
    // hidden-tab heartbeat, because this pass does not run in a background tab at all.
    this.session.servicePendingTransitions();
  }

  private onFrame(sample: FrameSample): void {
    const match = this.world?.match;
    this.stats.push(sample.frameMs, sample.simMs, sample.renderMs, sample.steps, sample.starved);
    this.stats.pushBreakdown(
      match?.lastModeMs ?? 0,
      match?.ui.lastUpdateMs ?? 0,
      match?.streaks.lastMs ?? 0,
      match?.streaks.active.length ?? 0,
    );
  }

  // -- events --------------------------------------------------------------

  /**
   * The cursor was released — almost always Esc (M5, from the M4 playtest notes).
   *
   * M4 quit the match outright here, which is why Esc lost your game. It now pauses: the
   * world stays built, the sim stops, and the pause screen goes over the top. Quitting is a
   * button on that screen rather than a side effect of a key the browser owns.
   */
  private onPointerLockChange(locked: boolean): void {
    if (locked) return;
    // Esc with the targeting map up is a *cancel*, not a pause — the overlay says so, and a
    // player who backed out of marking a mortar should be back in the fight, not on a menu.
    // The browser has taken the cursor either way; the match stays armed, so the next click
    // recaptures it. See `Input.armPointerLock`.
    if (this.cancelMortarOverlay()) return;
    if (this.state === 'MATCH') this.transitionTo('PAUSED');
  }

  /**
   * Close the mortar targeting map if it is open. Returns whether it was.
   *
   * Cancelling deliberately does **not** spend the streak: `MortarOverlay.cancel` leaves it
   * pending, so a mis-opened map costs nothing.
   */
  private cancelMortarOverlay(): boolean {
    const overlay = this.world?.match.mortarOverlay;
    if (overlay === undefined || !overlay.isOpen) return false;
    overlay.cancel();
    return true;
  }

  /**
   * Escape, when the browser did *not* consume it to release pointer lock.
   *
   * That is the paused case, and the un-paused-but-not-locked case (the AFK harness, or a
   * player who clicked away). Pausing from a locked match arrives through
   * `onPointerLockChange` instead, so exactly one of the two fires.
   */
  private onEscape(): void {
    // The Esc stack, from the M5 playtest notes: with the overlay open, Esc closes the
    // overlay and stops. It used to fall straight through to "resume", which meant a
    // player closing a panel was thrown back into a firefight.
    //
    // Asked of the predicate rather than of the panel, so "is it on screen" has one answer
    // here and in `updateHudSurfaces`. Escape writes the request, exactly as the × does.
    if (this.surfaces.isDebugOverlayVisible()) {
      this.surfaces.dismissDebugOverlay();
      return;
    }
    // Above the pause branches for the same reason the F1 overlay is: a player closing a
    // panel must not be thrown back into a firefight, and one cancelling a mortar mark must
    // not be dropped onto the pause screen.
    if (this.cancelMortarOverlay()) return;
    // The profile panel over the menu (R2.2): Escape closes it and stops, the way a panel
    // over a match closes and stops above.
    if (this.state === 'MENU' && this.screens.menus.handleEscape()) return;
    if (this.state === 'SETTINGS') {
      // A binding row that is waiting for a key eats Escape as "cancel the capture"; only
      // once nothing is armed does Escape leave the screen.
      if (this.settingsScreen.handleEscape()) return;
      this.transitionTo(this.settingsReturn);
      return;
    }
    if (this.state === 'LOADOUT') {
      // The profile panel first (R2.2); then one destination, same as the button's. The
      // state's exit handler does the saving.
      if (this.screens.loadoutEditor.handleEscape()) return;
      this.transitionTo('MENU');
      return;
    }
    if (this.state === 'PAUSED') {
      this.resumeFromPause();
      return;
    }
    if (this.state === 'MATCH' && !this.input.isLocked) this.transitionTo('PAUSED');
  }

  /**
   * The pause screen's debug button. Toggles the request; the frame pass does the showing.
   *
   * A request made here is `'onPause'`, which is what buys the overlay the one screen where
   * the cursor is free — the tuning sliders are unusable anywhere else, and that is the whole
   * reason M5 put this button on the pause menu. On resume it demotes to `'inMatch'`, which
   * is how *"once the overlay has been opened on purpose it stays open through the resume"*
   * survives without a second flag remembering it.
   */
  private toggleOverlayFromPause(): void {
    this.surfaces.toggleDebugOverlayFromPause();
  }

  private resumeFromPause(): void {
    if (this.state !== 'PAUSED') return;
    // Before the transition, so the request describes where the player is going rather than
    // where they were. See `DebugOverlayRequest`.
    this.surfaces.demoteDebugRequestOnResume();
    this.transitionTo('MATCH');
  }

  /**
   * The line under PAUSED: mode, map and the score.
   *
   * The score comes off `MatchFlow`, which prefers the replicated value, and not off the mode
   * (playtest round 5, B7). `GameMode.teamScore` is the local copy of a fact the server has
   * owned since M10 and a replicated client deliberately never scores, so this line read
   * `... · 0 – 0` in every networked match. Nobody reported it, which is the whole hazard of
   * an authority migration: the stale reader keeps returning a plausible number.
   */
  private pauseStatusLine(): string {
    const match = this.world?.match;
    if (match === undefined) return this.mapEntry().name;
    const mode = match.mode;
    const flow = match.flow;
    return `${mode.name} · ${this.mapEntry().name} · ${flow.teamScore('A')} – ${flow.teamScore('B')}`;
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * The saved selection, resolved against the registry rather than trusted.
 *
 * `normaliseSave` validates every other field of the save but stores `mapId` and `modeId` as
 * bare strings, so a save written before the map ids were prefixed carries `foundry` where the
 * registry now has `mp_foundry`. Resolving here rather than at each of the six
 * `findMap`/`findMode` call sites means the selection is *known good* from construction on,
 * and those calls keep throwing — which is correct for a code path that asks for a map that
 * does not exist.
 */
function resolveSelection(settings: SettingsV1): MenuSelection {
  return {
    modeId: resolveModeId(asModeId(settings.modeId)).id,
    mapId: resolveMapId(settings.mapId).id,
    // Already validated against the union by `normaliseSave`, which is where every other
    // enumerated setting is checked. No resolve step, because unlike a map id it has never
    // had a rename to survive.
    difficulty: settings.botDifficulty,
  };
}

function clampFov(v: number): number {
  return Math.min(FOV_MAX, Math.max(FOV_MIN, v));
}
//#endregion
