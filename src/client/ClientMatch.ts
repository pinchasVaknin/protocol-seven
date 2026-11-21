/**
 * Composition root for the MATCH state.
 *
 * `Game.ts` is the state machine; this is everything a match is made of, in one place, so
 * that neither file drifts past the size the architecture allows. It owns the wiring — and
 * wiring is all it does. Every connection here is an EventBus subscription, because S3 says
 * systems must not reach into each other, and the systems that fire, resolve and present a
 * shot genuinely do not know about one another:
 *
 *   WeaponSystem --weapon.fired--> flash, tracer, gunshot, camera shake, latency probe
 *   Ballistics   --bullet.impact-> debris, decal, impact report
 *   DamageSystem --damage.dealt--> hitmarker, hit audio, damage numbers, target read-out
 *   MatchFlow    --killfeed/score/announcer--> the HUD
 *
 * That is also what lets the headless harness run a full match with no renderer, no audio
 * context and no DOM: nothing downstream of the sim is required for the sim to run.
 *
 * M4 added the mode above it. `ScoreSystem`, the `GameMode` and `MatchFlow` are constructed
 * here and the flow's respawn gate is handed to both the bot director and the player's own
 * respawn timer, so "nobody comes back once the match is over" is one rule.
 *
 * ## What it still is, after C24
 *
 * The wiring, and five collaborators it hands the rest to: `MatchArsenal` for every mesh the
 * hands can hold, `MatchLife` for being alive, dead or on the way back, `MatchStreakLedger`
 * for whose killstreaks these are, `MatchSurfaces` for everything the HUD is told once a
 * frame, and `MatchObjectives` for what the mode puts in the world. What is left here is the
 * order they are built in, the tick, the frame, and the questions only a composition root can
 * answer — which kind of match this is, and where the bodies are.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import type { ViewerContext } from '../shared/ui/TeamColour';
import type { SchedulerConfig } from '../shared/ai/AiScheduler';
import { BotDirector } from '../shared/ai/BotDirector';
import { BotRenderer } from './ai/BotRenderer';
import type { CharacterAvatarProviderResolver } from './characters/CharacterAvatarProvider';
import type { RenderableActor } from '../shared/ai/BotVisualState';
import type { BotTeam } from '../shared/ai/Combatant';
import { tiersFor, type BotDifficulty, type PerceptionConfig, type TierTable } from '../shared/ai/DifficultyTiers';
import { PlayerCombatant } from '../shared/ai/PlayerCombatant';
import { Cheat } from '../shared/cheats/Cheats';
import { DamageSystem, makeDamageRequest, type DamageRequest } from '../shared/combat/DamageSystem';
import { LocalIdentity } from '../shared/combat/LocalIdentity';
import { ScoreSystem } from '../shared/combat/ScoreSystem';
import { Rng } from '../shared/core/Rng';
import { insideDrawnBody } from './combat/BodyVolume';
import { TargetRange } from './combat/TargetRange';
import { EV, type GameBus } from '../shared/core/Events';
import type { Input } from './input/Input';
import { Btn, isDown, justPressed, type InputCommand } from '../shared/core/InputCommand';
import { angleDelta, DEG2RAD } from '../shared/core/MathUtil';
import type { CameraRig } from './engine/CameraRig';
import type { CameraConfig } from './player/CameraConfig';
import { FlameFx } from './engine/FlameFx';
import { Fx } from './engine/Fx';
import type { ProceduralAudio } from './engine/ProceduralAudio';
import { LatencyProbe } from './debug/LatencyProbe';
import type { EquipmentConfig } from '../shared/equipment/EquipmentConfig';
import { EquipmentSystem } from '../shared/equipment/EquipmentSystem';
import { MatchEquipment } from './MatchEquipment';
import { MatchFeedback, type BodyPose } from './MatchFeedback';
import { MatchMeta } from './MatchMeta';
import { MatchArsenal } from './MatchArsenal';
import { MatchLife } from './MatchLife';
import { MatchObjectives } from './MatchObjectives';
import { MatchStreakLedger } from './MatchStreakLedger';
import { MatchSurfaces } from './MatchSurfaces';
import { MortarOverlay } from './ui/MortarOverlay';
import { SearchAndDestroy } from '../shared/modes/SearchAndDestroy';
import { StreakAudio } from './streaks/StreakAudio';
import { ClientStreakPresentation } from './streaks/ClientStreakPresentation';
import { StreakRenderer } from './streaks/StreakRenderer';
import { preloadSentry } from './streaks/SentryModel';
import { StreakSystem, type StreakSystemDeps } from '../shared/streaks/StreakSystem';
import type { ProjectileState, SmokeState, StreakView } from '../shared/net/Skirmish';
import {
    ALL_STREAK_IDS,
    DEFAULT_STREAK_CONFIG,
    type StreakConfig,
    type StreakId,
} from '../shared/streaks/StreakDefs';
import type { CamoId } from '../shared/meta/Camos';
import type { ResolvedLoadout } from '../shared/meta/Loadouts';
import type { Profile } from './meta/Profile';
import type { XpReport } from '../shared/meta/XpRules';
import type { GameMode, HeaderSlot } from '../shared/modes/GameMode';
import { isObjectiveProvider } from '../shared/ai/ObjectiveIntent';
import { MatchFlow } from '../shared/modes/MatchFlow';
import { matchStartSeconds } from '../shared/cinematic/IntroPlan';
import type { MapEntry, ModeEntry } from '../shared/modes/ModeRegistry';
import { Health, type HealthConfig } from '../shared/player/Health';
import type { MovementConfig } from '../shared/player/MovementConfig';
import type { PlayerController } from '../shared/player/PlayerController';
import { SupplySystem, type SupplyState } from '../shared/world/SupplySystem';
import { BurnSystem } from '../shared/combat/BurnSystem';
import { burnWeapon } from '../shared/streaks/StreakWeapons';
import type { ViewmodelLayer } from './player/Viewmodel';
import { LOW_HEALTH_THRESHOLD } from './ui/Hud';
import { MatchHud } from './ui/MatchHud';
import type { CollisionWorld } from '../shared/world/CollisionWorld';
import { makeRayHit, type RayHit } from '../shared/world/Geometry';
import type { RoundBlocker } from '../shared/weapons/Ballistics';
import type { ViewmodelConfig } from '../shared/weapons/ViewmodelConfig';
import { WeaponAudio } from './weapons/WeaponAudio';
import { Melee } from '../shared/weapons/Melee';
import type { WeaponDef } from '../shared/weapons/WeaponDefs';
import type { WeaponAssetService } from './weapons/WeaponAssetService';
import type { AttachmentId } from '../shared/weapons/Attachments';
import { handsOffWeapon, WeaponSystem, type WeaponSnapshot } from '../shared/weapons/WeaponSystem';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * Where a dead player's camera goes and what eye it looks through (M11 Gate B, 6.8).
 *
 * Named rather than inline because `Game` composes a `PlayerSnapshot` out of it every frame, and
 * the eye height is the field that used to be missing: an anonymous shape made it easy to hand
 * over three numbers and leave the fourth at whatever `makeSnapshot` had put there.
 */
export interface SpectatorView {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly yaw: number;
    /** Metres above the feet, from the stance the watched body is drawn in. */
    readonly eyeHeight: number;
}

export interface MatchDeps {
    readonly bus: GameBus;
    readonly scene: THREE.Scene;
    /** Resolves Match-scoped factory handles over Game's long-lived parsed character assets. */
    readonly characterAvatarProvider: CharacterAvatarProviderResolver;
    /**
     * Game's long-lived weapon templates (M19). Null where a match has no use for a file — the
     * harnesses — and every weapon is then the primitives, as it was before M19.
     */
    readonly weaponAssets: WeaponAssetService | null;
    readonly viewmodel: ViewmodelLayer;
    readonly cameraRig: CameraRig;
    readonly cameraConfig: CameraConfig;
    readonly audio: ProceduralAudio;
    readonly input: Input;
    readonly world: CollisionWorld;
    readonly player: PlayerController;
    readonly movementConfig: MovementConfig;
    /**
     * The player's live primary — resolved from the loadout, so it already carries the
     * attachments and the perks. The tuning panel writes into this object.
     */
    readonly weaponDef: WeaponDef;
    /** M5: the player's sidearm. Bots do not carry one — see `WeaponSystem`. */
    readonly secondaryDef: WeaponDef;
    /**
     * The *base* of the player's primary: no attachments, no perks.
     *
     * M6 introduced this as `botWeaponDef` to stop the enemy team being issued the player's
     * Quickdraw, and M7 renamed it because the name was describing a bug. Bots never read it —
     * they draw their own weapons in `BotArsenal` — and its one remaining job is the M6
     * modifier panel, which shows perks and attachments as a before-and-after and must read
     * the *same* base the match was built from rather than looking one up in the registry.
     */
    readonly playerBaseDef: WeaponDef;
    readonly viewmodelConfig: ViewmodelConfig;
    readonly healthConfig: HealthConfig;
    readonly equipmentConfig: EquipmentConfig;
    readonly uiHost: HTMLElement;
    readonly anisotropy: number;
    /** M4: the map and mode this match is. The director bakes a navmesh from the map def. */
    readonly map: MapEntry;
    readonly mode: ModeEntry;
    readonly tiers: TierTable;
    /**
     * How hard the bots are in a **local** match (playtest round 4, F1).
     *
     * The player's menu choice, straight from the save. It is read in exactly one place —
     * `populateDefault` — and it is deliberately not consulted on a networked client, which
     * populates no roster at all: over the wire the bots are the server's and their difficulty is
     * the operator's `BOT_DIFFICULTY`, not this player's preference. A client that applied its own
     * would be a client with an opinion about somebody else's simulation.
     */
    readonly difficulty: BotDifficulty;
    readonly perceptionConfig: PerceptionConfig;
    readonly schedulerConfig: SchedulerConfig;
    readonly seed: number;
    /** M6: the equipped class, already resolved and sanitised by `Profile`. */
    readonly loadout: ResolvedLoadout;
    readonly profile: Profile;
    /** False in the Shooting Range: a testbed does not write to the save. */
    readonly banksProgress: boolean;

    /**
     * The match is driven by a server (M10).
     *
     * A flag rather than a subclass, and deliberately narrow: it turns off the three things
     * this file does that a **dedicated server owns instead** (S4.9), and touches nothing else.
     *
     * 1. **No local bot roster.** The server has the bots. `BotDirector` is still constructed —
     *    the navmesh it bakes is what the spawn selector and the debug tools read — it is
     *    simply never populated and never stepped.
     * 2. **No local mode clock.** Score, round state and the match result arrive replicated.
     * 3. **No local respawn.** The server decides when a body comes back and where.
     *
     * Everything else runs exactly as it does in single-player: the weapon, the viewmodel, the
     * camera, the HUD, the audio, the hitmarkers. That is the point of S3's *"a networked event
     * and a local one must be indistinguishable to the client"* — the presentation layer never
     * learns which kind of match it is in.
     */
    readonly networked?: boolean;

    /**
     * This world is the permanent warmup arena (M11 §6.3; playtest round 4, F7 and F12).
     *
     * Derived by `MatchWorld` through `isArenaInstance`, from an id that has been on the
     * wire since v3 — the arena is not a mode and cannot be read off the registry, because a
     * ballot can elect Free-for-All and a live Free-for-All must kill and score as it always has.
     *
     * Three things read it and all three are the room's own rules: nobody is killable, nothing is
     * recorded, and the caption over the crosshair says what you are doing there. Absent — and
     * therefore false — in single-player, which has no arena at all.
     */
    readonly warmupArena?: boolean;

    /** Whether the arena's ballot is open, for the caption over the crosshair. Absent offline. */
    readonly ballotOpen?: () => boolean;

    /**
     * Ask the server to spend a streak (M11 Gate B, §8.22).
     *
     * Supplied only by a networked match; single-player activates locally and never calls it.
     * The coordinates are the mortar's marked point — every other streak is placed by the server
     * from its own copy of where this player is standing, because the position a streak lands at
     * is not a thing an untrusted client gets to choose (§4.16).
     */
    readonly onStreakRequest?: ((id: StreakId, markX: number, markZ: number) => void) | undefined;

    /**
     * This client's cheat entitlements, read every tick (playtest round 4, F14).
     *
     * A supplier rather than a value because the mask outlives this object: it comes from the
     * replicated owner block on a networked client and from `Game`'s own store offline, and both
     * survive the world being torn down and rebuilt by a rotation. `Game.cheatMask` is the one
     * expression that merges the two authorities; nothing here needs to know which it is reading.
     */
    readonly cheats: () => number;

    /**
     * Where the drawable bodies come from (M10, S6.5).
     *
     * Defaults to the local bot roster, which is what single-player has always drawn. A
     * networked match supplies the remote actors rebuilt from snapshots instead — same mesh,
     * same animations, same renderer, because both satisfy `RenderableActor`.
     */
    readonly actors?: (() => Iterable<RenderableActor>) | undefined;
    /**
     * The bodies the player's own predicted round stops in (2026-10-18).
     *
     * Supplied only by a networked match, and the asymmetry with `actors` above is the whole
     * point: single-player draws the same bodies it shoots, because a local bot is registered
     * in this match's `DamageSystem` and a round stops in it by taking damage. A remote player
     * is drawn and never registered — the server owns hit registration (S4.13) — so the two
     * roles come apart, and this is the second one. See `Ballistics.blockers`.
     */
    readonly roundBlockers?: (() => readonly RoundBlocker[]) | undefined;
    /** M7: killstreak tuning. Live-editable from the debug panel. */
    readonly streakConfig?: StreakConfig;

    /**
     * Which entity this client is (M10, playtest round 2).
     *
     * Absent in single-player, where it is `PLAYER_ENTITY_ID` and always was. On a dedicated
     * server the seat is assigned in the `Welcome` and is 1 or above, and every "was that me?"
     * test in this file and in `MatchFeedback` reads it — see `LocalIdentity` for the list of
     * things that silently did nothing while they were all comparing against 0.
     */
    readonly identity?: LocalIdentity;

    /**
     * The side the server put this client on. Single-player is always `PLAYER_TEAM`.
     *
     * It decides whether the announcer calls the result a victory or a defeat, which is the one
     * place a networked client would otherwise congratulate the player for losing.
     */
    readonly localTeam?: BotTeam;

    /**
     * The name this client is known by; `PLAYER_NAME` when absent.
     *
     * The scoreboard registers the local row before the first snapshot arrives, so without this
     * the player's own row read `OPERATOR` while every other client — and the killfeed, which
     * resolves names from the snapshot — called them by the name they joined with. Single-player
     * passes the profile's callsign here too since M17 C2: the local roster's `PlayerCombatant`
     * and the score row both take it, so the killfeed and the board say what the card says.
     */
    readonly localName?: string;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Shared empties, so clearing replicated equipment allocates nothing. */
const EMPTY_PROJECTILES: readonly ProjectileState[] = [];

const EMPTY_SMOKE: readonly SmokeState[] = [];

/** Seconds between puffs on a burning body, and how far up them they are drawn. */
const BURN_FX_INTERVAL = 0.25;

const BURN_FX_HEIGHT = 1.1;

/** The player's side. Bots added to 'A' fight alongside them, 'B' against. */
const PLAYER_TEAM: BotTeam = 'A';

/** Reused every frame by the objective-bearing bridge below (S4.7: no render allocation). */
const bombBearingScratch = { active: false, x: 0, z: 0 };

/**
 * Standing eye height, for a remote body whose exact stance eye is not on the wire.
 *
 * Matches `PlayerSimState`'s standing value. Only ever used to lift a positional sound off
 * the floor, never for anything the simulation reads.
 */
const DEFAULT_EYE_HEIGHT = 1.65;

/** Reused by `bodyAt`; the callers read it during the call and never keep it. */
const bodyScratch: BodyPose = { x: 0, y: 0, z: 0, eyeHeight: DEFAULT_EYE_HEIGHT };

const PLAYER_NAME = 'OPERATOR';

/** Radius the mortar overlay draws its strike zone at. Matches the streak's own scatter. */
const MORTAR_MARK_RADIUS = DEFAULT_STREAK_CONFIG.mortarScatter;

/**
 * Metres the mortar mark travels per radian of look.
 *
 * Tuned so a quarter-turn crosses Foundry's long axis: precise enough to pick a doorway,
 * quick enough that marking does not feel like dragging.
 */
const MORTAR_STEER_M_PER_RAD = 42;
//#endregion

// ======================================== CLASS Match ========================================= \\
//#region Class Match
export class Match {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
    readonly damage: DamageSystem;

    readonly weapons: WeaponSystem;

    /**
     * The knife (post-M8). Alongside the weapon rather than inside it — see `weapons/Melee.ts`
     * for why a melee is not an inventory slot.
     */
    readonly melee: Melee;

    /** Only on the grey-box testbed: a firing range does not belong on a TDM map. */
    readonly range: TargetRange | null;

    readonly fx: Fx;

    /** The flamethrower's jet. See `engine/FlameFx`. */
    readonly flame: FlameFx;

    readonly weaponAudio: WeaponAudio;

    /** Every mesh the player's own hands can hold. See `MatchArsenal`. */
    private readonly arsenal: MatchArsenal;

    readonly latency = new LatencyProbe();

    readonly playerHealth: Health;

    readonly playerCombatant: PlayerCombatant;

    readonly bots: BotDirector;

    /** The bodies. Client-only from M9 — the director owns the roster, not the meshes. */
    readonly botRenderer: BotRenderer;

    // ---- M4: the match, as opposed to the firefight -------------------------
    readonly score: ScoreSystem;

    /**
     * Which entity this client is. `PLAYER_ENTITY_ID` unless a server said otherwise.
     *
     * Read through `localId` at the point of use rather than copied into a field, because the
     * assignment arrives over a socket and may land after any given object was constructed.
     */
    private readonly identity: LocalIdentity;

    readonly mode: GameMode;

    readonly flow: MatchFlow;

    readonly ui: MatchHud;

    /** Turns the events a shot produces into what the player sees and hears. */
    readonly feedback: MatchFeedback;

    /** M5: grenades, smoke, flashes and the bots that throw them. */
    readonly equipment: MatchEquipment;

    /** M6: XP, challenges, perks and the field upgrade. */
    readonly meta: MatchMeta;

    /** M7: killstreaks. Owns every streak entity in the world. */
    readonly streaks: StreakSystem;

    /** The sentry and care-package bodies. Client-only from M9 — see `StreakRenderer`. */
    readonly streakRenderer: StreakRenderer;

    /** M7: flags, capture rings, dog tags and the bomb, as things in the world. */
    readonly objectives: MatchObjectives;

    /** M7: the mortar targeting map. Built once; only rasterises when first opened. */
    readonly mortarOverlay: MortarOverlay;

    /** Interpolated weapon state for this frame. Read by Game for the camera. */
    readonly visual: WeaponSnapshot = {
        raise: 1,
        adsFraction: 0,
        visualPunch: 0,
        visualLateral: 0,
        aimPitch: 0,
        aimYaw: 0,
        reloadFraction: 0,
        swapFraction: 1,
    };

    /** Wall time inside the last `flow.simulate`, ms. Reported in F1 (S7). */
    lastModeMs = 0;

    private readonly deps: MatchDeps;

    private readonly residual = { yaw: 0, pitch: 0 };

    private readonly selfDamage: DamageRequest;

    private readonly occlusionRay: RayHit = makeRayHit();

    private readonly listenerAt = { x: 0, y: 0, z: 0 };

    private swapSubscription: (() => void) | null = null;

    private active = false;

    /** Previous tick's buttons, for edge detection in the sim (S4.2). */
    private prevButtons = 0;

    /**
     * The command this tick, for the Chopper Gunner (M11 Gate B).
     *
     * `StreakSystem` pulls per-owner commands now rather than being handed one, so that a server
     * with two gunners does not fly both off the same stick. The client's answer is the local
     * player's current command, stashed here immediately before `simulate`.
     */
    private lastStreakCommand: InputCommand | null = null;

    /**
     * The map's resupply stations, and the rule that spends time at one (this session).
     *
     * Stepped on **both** sides of a networked match, unlike the bomb. A plant timer is the mode's
     * and the mode runs on the server, so a client that ran one as well would be a second
     * authority over it. A magazine is not like that: the client and the server each own a copy of
     * the weapon and step it from the same commands, and have since M10 — nothing about ammunition
     * is on the wire at all. So the crate is a rule both sides apply, and the two agree because
     * their inputs do.
     */
    private readonly supply: SupplySystem;

    /**
     * Bodies still alight after the jet moved on (2026-09-26).
     *
     * Stepped **only in a solo match**, unlike the resupply station and for the opposite reason:
     * a burn is damage, damage is health, and health is the server's in a networked match. A
     * client that ticked its own burns would be a second opinion about a bar it does not own. In
     * a networked match this object still exists and still answers `isBurning` — from the
     * replicated `EFlag.Burning` rather than from a timer of its own, which is what the renderer
     * asks and all it needs.
     */
    private readonly burn: BurnSystem;

    /** Seconds until the next puff of fire on every burning body. See `renderBurns`. */
    private burnFxTimer = 0;

    /** Everything about being alive, dead or on the way back. See `MatchLife`. */
    private readonly life: MatchLife;

    /**
     * Whose streaks these are, and everything that follows: the balance, the price, the lockout,
     * the carried weapon and the server's own entity list. See `MatchStreakLedger`.
     */
    private readonly ledger: MatchStreakLedger;

    /**
     * Where a mortar will land if one is called in.
     *
     * Defaults to the map centre and is moved by the targeting overlay. Held here rather than in
     * the overlay so a mortar called from the console — or, later, by a bot — still has a mark.
     */
    mortarMarkX = 0;

    mortarMarkZ = 0;

    /** Every surface the HUD is told about once a frame. See `MatchSurfaces`. */
    private readonly surfaces: MatchSurfaces;

    /** Look angles when the overlay opened, so the mark is steered by the delta. */
    private overlayYaw = 0;

    private overlayPitch = 0;

    private rosterRegistered = false;

    /**
     * Which seat is looking at the HUD, as one value (playtest round 4, B12).
     *
     * `localTeam` alone is not enough to decide a colour, because Free-for-All keeps the
     * two-team substrate and half of an FFA lobby therefore shares the viewer's side without
     * being on their team. Both facts travel together or the killfeed paints four opponents
     * green, which is the seam post-M8 closed in the minimap and left open everywhere else.
     */
    private cachedViewer: ViewerContext | null = null;

    /**
     * Replicated freeze state, written by the net session from the snapshot header.
     *
     * Held here rather than read from the session because `inputFrozen` is consulted from the
     * sampler in `Game.simulate`, which has a `Match` and no reason to learn about sockets.
     */
    netFrozen = false;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
    constructor(deps: MatchDeps) {
        this.deps = deps;
        // First, because almost everything below is handed it.
        this.identity = deps.identity ?? new LocalIdentity();

        this.damage = new DamageSystem(deps.bus);
        this.playerHealth = new Health(deps.healthConfig);
        this.playerCombatant = this.createCombatant(deps);
        this.damage.register(this.playerCombatant);
        this.selfDamage = this.createSelfDamageRequest(deps);
        this.weapons = this.createWeapons(deps);
        this.melee = this.createMelee(deps);
        this.range = this.spawnRange(deps);
        this.bots = this.createBots(deps);
        this.supply = new SupplySystem(deps.map.def.supply ?? []);
        this.burn = new BurnSystem(deps.bus, this.damage, burnWeapon());
        this.botRenderer = this.createBotRenderer(deps);
        deps.scene.add(this.botRenderer.group);

        // ---- the mode ---------------------------------------------------------
        this.score = this.createScore(deps);
        this.mode = deps.mode.create({
            bus: deps.bus,
            score: this.score,
            roster: this.bots.roster,
            mapDef: deps.map.def,
        });
        this.flow = this.createFlow(deps);
        this.applyModeRules(deps);

        this.fx = new Fx(deps.anisotropy);
        /**
         * No bullet hole inside a body, whichever impact path asked for it (2026-10-18).
         *
         * Installed here because this is the object that holds both halves: the field that
         * places the holes and the roster that knows where the bodies are drawn. `Fx` dies with
         * this match — it is built and disposed here — so the closure needs no teardown of its
         * own. See `Fx.decalVeto` for what is vetoed and `combat/BodyVolume` for the shape.
         */
        this.fx.decalVeto = (x, y, z) => this.insideBody(x, y, z);
        deps.scene.add(this.fx.group);
        this.flame = new FlameFx();
        deps.scene.add(this.flame.group);

        // Every mesh the hands can hold, built in one place and in one order. See `MatchArsenal`:
        // the weapons are built up front because a swap must not stutter, and everything else —
        // the knife, a grenade, the slot a streak lends you, the shield — has a rule of its own.
        this.arsenal = this.createArsenal(deps);
        this.ui = this.createHud(deps);
        this.weaponAudio = new WeaponAudio(deps.audio);
        this.feedback = this.createFeedback(deps);
        this.life = this.createLife(deps);
        this.swapSubscription = this.subscribeToSwaps(deps);
        this.equipment = this.createEquipment(deps);
        this.fillEquipmentFromLoadout(deps);
        this.meta = this.createMeta(deps);
        this.streaks = this.createStreaks(deps);
        this.ledger = this.createStreakLedger(deps);
        this.streakRenderer = this.createStreakRenderer();
        deps.scene.add(this.streakRenderer.group);
        this.applyStreakRules(deps);
        this.objectives = this.createObjectives(deps);
        this.mortarOverlay = this.createMortarOverlay(deps);
        this.applyMinimapObjectives();
        this.surfaces = this.createSurfaces(deps);
        this.installAudioForMap(deps);
    }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
    /**
     * Bring the match up. Builds the roster on the first activation, registers everybody with
     * the score system, and starts the flow's clock.
     */
    setActive(on: boolean): void {
        this.active = on;
        this.ui.setVisible(on);
        if (!on) return;
        this.arsenal.reset(this.deps.input.yaw, this.deps.input.pitch);
        // Deferred to the first time a match actually starts rather than done at construction:
        // the harness wants a different roster and gets to set it before anyone spawns.
        // The range populates nothing: S9's testbed has no enemies by design, and the
        // registry says so rather than this file guessing from the map.
        // A networked match's roster lives on the server (S4.15). Populating one here would put
        // ten bots in the world that only this client can see, fighting nobody.
        if (!this.isNetworked && this.bots.botCount === 0 && this.deps.mode.populatesRoster) {
            this.populateDefault();
        }
        this.registerRoster();
        if (this.flow.currentPhase === 'WARMUP' && this.flow.round === 1 && this.score.rows.length > 0) {
            this.flow.start();
        }
    }

    /**
     * The default firefight: the map's team size, the player counting as one of their side.
     *
     * A mode may override the roster size (M7): Free-for-All is eight operators on any map, and
     * they are split evenly across the two substrate sides so perception, spawn safety and the
     * aim model keep working — see `modes/FreeForAll.ts` for why the two-team substrate stays.
     */
    populateDefault(): void {
        /**
         * The tiers, from the menu's difficulty rather than from the map alone (round 4, F1).
         *
         * `tiersFor` is the same function `ServerMatch` resolves with, which is what makes "Recruit"
         * mean the same roster in a solo match and on a server started with `BOT_DIFFICULTY=RECRUIT`.
         * `MIX` returns the map's authored spread unchanged, so every measurement taken before this
         * session still describes the default.
         */
        const mix = tiersFor(this.deps.difficulty, this.deps.map.tierMix);
        const override = this.deps.mode.rosterSize;
        if (override !== undefined) {
            const bots = Math.max(0, override - 1);
            const teamB = Math.ceil(bots / 2);
            this.bots.populate(bots - teamB, teamB, mix);
            return;
        }
        const size = this.deps.map.teamSize;
        this.bots.populate(Math.max(0, size - 1), size, mix);
    }

    /**
     * Put every roster member on the scoreboard.
     *
     * Deferred until the roster exists and done once: the bots are built by `populate`, which
     * the harness may call with its own numbers before the match goes live.
     */
    registerRoster(): void {
        if (this.rosterRegistered) return;
        this.rosterRegistered = true;
        this.score.register(this.localId, this.deps.localName ?? PLAYER_NAME, this.deps.localTeam ?? PLAYER_TEAM);
        for (const bot of this.bots.bots) this.score.register(bot.entityId, bot.displayName, bot.team);
    }

    /**
     * Is this world the permanent arena? See `HudSurfaceState.inWarmupArena`.
     *
     * A world is built per instance and rebuilt on migration, so this is a constant for the life
     * of the object rather than something to re-derive per frame.
     */
    get inWarmupArena(): boolean {
        return this.deps.warmupArena === true;
    }

    /** The score banner, the Tab board and the streak strip. One predicate decides all three (F7). */
    setResultSurfacesVisible(on: boolean): void {
        this.ui.setResultSurfacesVisible(on);
    }

    get isPlayerDead(): boolean {
        return this.life.isDead;
    }

    /** The mortar's targeting map has the input: what `Btn.Targeting` tells the server. */
    get targeting(): boolean {
        return this.mortarOverlay.isOpen;
    }

    /**
     * The side the server put this client on; `PLAYER_TEAM` in single-player.
     *
     * A getter rather than the `deps.localTeam ?? PLAYER_TEAM` expression repeated at each use,
     * because "which team am I" being answered by a constant is precisely how the alive counter
     * came to label a team-B player's own side as the enemy.
     */
    get localTeam(): BotTeam {
        return this.deps.localTeam ?? PLAYER_TEAM;
    }

    get viewer(): ViewerContext {
        this.cachedViewer ??= { team: this.localTeam, freeForAll: this.deps.mode.freeForAll === true };
        return this.cachedViewer;
    }

    /**
     * How many of a side are still standing, from whichever body source this match has.
     *
     * Single-player holds `Bot`s on a roster; a networked match holds `RemoteActor`s rebuilt from
     * snapshots. A caller that wants a number should not have to know which — and
     * `SearchAndDestroy.aliveCount` walks `ModeDeps.roster`, which on a networked client is
     * **empty**, so it returned 0 for both sides for the whole match. The local player is counted
     * separately because they are in neither list.
     */
    countAlive(team: BotTeam): number {
        return this.isNetworked ? this.countAliveActors(team) : this.countAliveRoster(team);
    }

    /**
     * The entity id this client's own player occupies.
     *
     * `PLAYER_ENTITY_ID` in single-player and the server's assignment in a networked match.
     * Everything that used to compare against the constant compares against this.
     */
    get localId(): number {
        return this.identity.entityId;
    }

    /**
     * The bodies this match draws, whichever kind of match it is (M15, D1).
     *
     * The same supplier `BotRenderer` was handed — the director's roster in single-player, the
     * snapshot's remote set when networked — so the summary's lineup asks the one list the
     * renderer draws from for what each entity is holding, rather than a second answer to it.
     */
    actorsForRender(): Iterable<RenderableActor> {
        return this.deps.actors?.() ?? this.bots.bots;
    }

    /**
     * Nobody may move or shoot right now (post-M8 playtest).
     *
     * True through the 3-2-1 and through the hold between rounds. The brief asks for movement
     * and shooting to be locked during the countdown and for the camera to stay free, which is
     * exactly the split `Input.sampleSpectating` already produces — it zeroes the axes and the
     * buttons and stamps the live view angles — so `Game` reads this and picks that sampler
     * rather than a fourth one being written.
     *
     * `ROUND_END` is included on purpose. It is the same situation as the warm-up with the
     * clock running the other way: the round is decided, and letting people keep shooting into
     * it is how a Search & Destroy round that has already been won produces another death on
     * the scoreboard.
     */
    get inputFrozen(): boolean {
        // Networked: the server says so, through the snapshot header. Its own `MatchFlow` is the
        // one running, and this client's is inert.
        if (this.isNetworked) return this.netFrozen;
        const phase = this.flow.currentPhase;
        return phase === 'WARMUP' || phase === 'ROUND_END';
    }

    /**
     * Whether the player's command should be neutered this tick. Read by both samplers.
     *
     * It used to be `uiFocus || inputFrozen`, where `uiFocus` meant *a front-end surface has the
     * keyboard and the cursor* — built for the Create-a-Class overlay, which was opened over a
     * running match because there is no pausing a dedicated server. Playtest round 4 (B8) made
     * the editor a front-end screen again, and that left `uiFocus` a boolean with **no writer**:
     * dead state sitting in the input path, indistinguishable from a flag somebody forgot to
     * set. The quick class selector never needed it — it is offered only in the two windows
     * where the body is already frozen, which is what `inputFrozen` says.
     */
    get inputSuppressed(): boolean {
        return this.inputFrozen;
    }

    /** True when this match is driven by a server. See `MatchDeps.networked`. */
    get isNetworked(): boolean {
        return this.deps.networked === true;
    }

    /**
     * Adopt the local player's replicated health and liveness (M10 playtest fix).
     *
     * The server owns whether this player is alive; before this the client decided for itself
     * and got it wrong in the only way that matters. `onPlayerKilled` keys on
     * `PLAYER_ENTITY_ID`, which is entity **0** — the server's empty spectator seat — while a
     * connected human is entity 1 or above. So the death path never fired, the death screen
     * never appeared, and `stepPlayerRespawn` (the only thing that clears `playerDead`) is
     * skipped in networked matches anyway. Three separate notions of "am I dead", one of them
     * authoritative and none of them talking to each other.
     *
     * Now there is one: this. Called on every change to the replicated health or alive bit.
     */
    applyReplicatedSelf(health: number, alive: boolean, spawnSerial: number): void {
        if (!this.isNetworked) return;
        this.life.applyReplicatedSelf(health, alive, spawnSerial);
    }

    /**
     * Debug spectator state (post-M8, `debug/Spectator.ts`).
     *
     * Held here rather than in the debug suite because two of the three things it does are
     * facts about the *match* — whether the player can be hurt and whether anybody is looking
     * for them — and both are already expressed on `PlayerCombatant`. The suite owns the
     * toggle and the panel; this owns what the toggle means.
     */
    /**
     * `SPEC[]1` and `SPEC[]2`, read from the entitlement rather than stored (round 4, F14).
     *
     * These were two fields, written by `debug/Spectator.ts`. They are getters now because the
     * entitlement is the store and a field beside it would be a second copy of it — and, over a
     * network, a copy the client had written for itself while the server disagreed. `Spectator`
     * still owns the *toggle*; what it toggles is the entitlement, through the same door a typed
     * code goes through.
     */
    get godMode(): boolean {
        return (this.deps.cheats() & Cheat.God) !== 0;
    }

    get hiddenFromBots(): boolean {
        return (this.deps.cheats() & Cheat.Unseen) !== 0;
    }

    get playerRespawnSeconds(): number {
        return this.life.respawnSeconds;
    }

    /**
     * Held Tab, as of the last command this match consumed (S4.2, playtest round 4).
     *
     * Derived from `prevButtons` rather than latched into a field of its own: the bit is already
     * kept for edge detection, and a second copy of it would be the second writer this session
     * exists to remove. The scoreboard's visibility is a pure function of this and the screen —
     * see `shared/ui/HudSurfaces.ts`.
     */
    get scoreboardHeld(): boolean {
        return isDown(this.prevButtons, Btn.Scoreboard);
    }

    /** The scoreboard's one writer, called once per frame from `Game.updateHudSurfaces`. */
    setScoreboardOpen(on: boolean): void {
        this.ui.setScoreboardOpen(on);
    }

    /**
     * The cheat tag's one writer, from the same per-frame pass (round 4, F14).
     *
     * Routed through the match rather than written on the HUD from `Game`, because the HUD belongs
     * to the match and `Game` is not allowed to hold a reference that outlives a rotation — the
     * same argument `setScoreboardOpen` is here for.
     */
    setCheatTag(text: string): void {
        this.ui.hud.setCheatTag(text);
    }

    /** B8's aim warning. One writer, `Game.updateHudSurfaces`, like every other HUD surface. */
    setAimWarning(text: string): void {
        this.ui.hud.setAimWarning(text);
    }

    /** F8's mode header. Same one writer; the slots are the mode's, drawn without interpretation. */
    setHeaderSlots(slots: readonly HeaderSlot[]): void {
        // The viewer context is this match's, so a cell is coloured by what its owner is *to this
        // client* — the `(viewer, subject)` invariant round 4's B12 established.
        this.ui.hud.setHeaderSlots(this.viewer, slots);
    }

    /** What this mode wants in the header this frame. Empty for a mode with nothing to say. */
    get headerSlots(): readonly HeaderSlot[] {
        return this.mode.headerSlots;
    }

    get isActive(): boolean {
        return this.active;
    }

    /** The live player simulation, for tooling that needs a pose and a facing. */
    get playerSim(): PlayerController['sim'] {
        return this.deps.player.sim;
    }

    /** The collision world this match is being played in. */
    get world(): CollisionWorld {
        return this.deps.world;
    }

    /** The unmodified base of the player's primary. See `MatchDeps.playerBaseDef`. */
    get playerBaseDef(): WeaponDef {
        return this.deps.playerBaseDef;
    }

    /** The class this match was built with. */
    get loadout(): ResolvedLoadout {
        return this.deps.loadout;
    }

    /**
     * Put a different weapon in a slot (M5).
     *
     * Rebuilds that slot's mesh, because a weapon is its silhouette as much as its numbers.
     * Used by the debug weapon picker; M6's loadout editor is the real caller.
     */
    equip(slotIndex: number, def: WeaponDef, camo?: CamoId | null, attachments?: readonly AttachmentId[]): void {
        // The mesh first, then the mechanics, then the mesh back on screen — in that order,
        // because `showSlot` has to run against an inventory that already holds the new weapon.
        const wasVisible = this.arsenal.replaceSlotMesh(slotIndex, def, camo, attachments);
        if (wasVisible === null) return;
        this.weapons.equip(slotIndex, def);
        if (wasVisible) this.arsenal.showSlot(slotIndex);
        this.arsenal.upgradeWhenLoaded(slotIndex);
    }

    /**
     * Swap the whole class over on a live match (M6).
     *
     * Called when the player edits their loadout from the pause screen, which is S6.3's
     * "reachable… between spawns". Both weapons are rebuilt (a class change is a different
     * silhouette as much as different numbers), the grenades are replaced and refilled, and
     * the perks are re-derived. Ammunition resets with the weapons, which is the honest
     * behaviour: you did not keep the magazine, you picked up a different gun.
     */
    applyLoadout(loadout: ResolvedLoadout): void {
        this.life.applyLoadout(loadout);
    }

    /** Debug hook: run real damage at the player so regeneration is exercised, not faked. */
    applySelfDamage(amount: number): void {
        const def = this.weapons.definition;
        this.selfDamage.weapon = def;
        this.selfDamage.zone = 'torso';
        // Solve for the request that produces exactly `amount` at the torso.
        this.selfDamage.distance = 0;
        this.selfDamage.penetrationRetain = Math.max(0, Math.min(1, amount / Math.max(def.damage.near, 1)));
        const sim = this.deps.player.sim;
        this.selfDamage.x = sim.x;
        this.selfDamage.y = sim.y + sim.eyeHeight;
        this.selfDamage.z = sim.z;
        this.damage.apply(this.selfDamage);
    }

    // -- loop -----------------------------------------------------------------

    /** One sim tick. Called from Game.simulate after the player has stepped. */
    simulate(cmd: InputCommand): void {
        // Health is server-owned in a networked match (S4.15) and arrives replicated. Stepping it
        // here as well would run a *second* regeneration curve against the authoritative one and
        // the bar would visibly disagree with the damage the player is taking.
        if (!this.isNetworked) this.playerHealth.step();
        // The rig follows the capsule on the *tick*, and before anything resolves a shot
        // against it, so a bot's round is tested against where the player was when it fired.
        this.playerCombatant.syncRig();

        // The targeting map owns the input while it is up — firing confirms the mark rather
        // than pulling the trigger.
        const mortarOpen = this.stepMortarOverlay(cmd);
        /**
         * A live Chopper Gunner takes the player's weapon out of the loop entirely (post-M8).
         *
         * Until now the takeover consumed the command *and left the rifle consuming it too*, so
         * holding the trigger in the gunship emptied the magazine on the ground below — reported
         * as "the chopper drains my primary ammo". It also meant the ADS button drove the rifle's
         * `adsFraction` up while the player was a kilometre away from it, which is what hid the
         * crosshair: the scope overlay saw a scoped sniper and took the reticle away.
         *
         * Both are the same bug and this is the one fix. The chopper has always had its own
         * `Ballistics` and its own `WeaponDef` — an infinite pool by construction, because it
         * spends no magazine — and now nothing else is spending one on its behalf.
         */
        const flyingChopper = this.streaks.activeChopperFor(this.localId) !== null;

        this.stepPlayerHands(cmd, mortarOpen, flyingChopper);
        this.stepWorldSystems(cmd);
        this.stepPlayerIntent(cmd);
        this.stepLifeAndClocks(cmd);

        /**
         * The scoreboard used to be written from here, and that was the whole of B6.
         *
         * A tick is not a frame. `Game.simulate` stops calling this the moment the screen leaves
         * `MATCH`, so the board kept whatever the last tick had put there — up, over the pause
         * screen, holding a key `Input.clearHeld` had already dropped into a loop that was no
         * longer running. It is derived once per frame in `Game.updateHudSurfaces` now, from
         * `scoreboardHeld` below and from state that outlives the tick.
         */
        this.prevButtons = cmd.buttons;
        this.latency.expire(performance.now());
    }

    /**
     * The body this dead player is watching, or null (M11 Gate B, §6.8).
     *
     * Only in a **one-life** mode, which is what makes this a spectator rather than a death cam:
     * in Team Deathmatch a corpse is looking at the floor for four seconds and then playing again,
     * and taking the camera somewhere else would be a worse experience than the wait. In Search &
     * Destroy the wait is the rest of the round.
     *
     * Recomputed every frame rather than latched on death. A target can die, disconnect or be
     * replaced by a bot at any moment, and a latch would have to be invalidated correctly on all
     * three — asked every frame, there is nothing to get stuck.
     */
    get spectatorTargetId(): number {
        return this.life.spectatorTargetId;
    }

    /**
     * Where the spectator camera should sit, or null to leave it on the local body.
     *
     * The followed body's **feet**, its facing, and the eye height the stance it is drawn in
     * actually has. A first-person framing rather than a chase camera, deliberately: a
     * third-person spectator needs collision of its own, and one that clips through a wall while
     * the player is already waiting out a round is a worse answer than looking through a
     * teammate's eyes.
     *
     * Two things were wrong with the first version and both arrived as one report — *"the head of
     * the body you are watching cuts into the camera"*.
     *
     * **The roster it looked in.** `deps.actors` is the *networked* supplier and is undefined in
     * single-player, so every solo Search & Destroy death landed on `?? []` and returned null: the
     * camera stayed at the eye the dead player left behind, while `BotRenderer` — told through
     * `setEyesOf` that the camera was inside a teammate — dutifully hid that teammate. A frozen
     * view of the room you died in with one of your own side invisible in it, and every other body
     * in the match free to walk through the camera. `actorsForRender` is the supplier that answers
     * both kinds of match, and it is the one the renderer itself draws from, which is what makes
     * the body that is hidden and the body the camera is inside provably the same body.
     *
     * **The eye it used.** `PlayerSnapshot`'s own default is a standing 1.65 m and a spectated body
     * is not always standing: a teammate who crouches drops their eyes to 0.95 m and a sliding one
     * to 0.55 m, and the camera stayed a metre above their head with the body hidden under it.
     * `eyeHeightFor` is the rule the living player's own camera is composed with, applied here to
     * the stance the body is *drawn* in, so the spectator's eye is where that body's eyes are.
     */
    spectatorView(alpha: number): SpectatorView | null {
        return this.life.spectatorView(alpha);
    }

    /**
     * Whether this body is on fire, whichever kind of match this is (2026-09-26).
     *
     * The same split every other per-body fact makes here: in a solo match the burn system is the
     * authority and is asked directly; over the network the answer arrived on the snapshot as
     * `EFlag.Burning`, because the burn ticks where health lives and this client never saw the
     * jet. One question, two routes, and the renderer is told neither of them.
     */
    isBurning(entityId: number): boolean {
        if (!this.isNetworked) return this.burn.isBurning(entityId);
        for (const actor of this.actorsForRender()) {
            if (actor.entityId !== entityId) continue;
            const remote = actor as { burning?: boolean };
            return remote.burning === true;
        }
        return false;
    }

    /** What the station under the player is doing this tick, for the HUD. */
    get supplyState(): SupplyState {
        return this.supply.stateOf(this.localId);
    }

    /** Cycle to the next living teammate. Bound to the fire key while dead (M7's verb). */
    cycleSpectatorTarget(): void {
        this.life.cycleSpectatorTarget();
    }

    /** Adopt one `Projectiles` frame (§8.24). Own grenades are skipped — they are predicted. */
    applyReplicatedProjectiles(
        projectiles: readonly ProjectileState[],
        smoke: readonly SmokeState[],
    ): void {
        this.equipment.applyReplicated(projectiles, smoke, this.localId);
    }

    /** Drop every replicated grenade. Called on migration, per §4.18's obligation list. */
    clearReplicatedProjectiles(): void {
        this.equipment.applyReplicated(EMPTY_PROJECTILES, EMPTY_SMOKE, this.localId);
    }

    /** Adopt one `Streaks` frame (§8.22). Called by `MatchWorld` from the net session. */
    applyReplicatedStreaks(view: StreakView): void {
        this.ledger.applyReplicated(view);
    }

    /** Drop every replicated streak. Called on migration, per §4.18's obligation list. */
    clearReplicatedStreaks(): void {
        this.ledger.clearReplicated();
    }

    /**
     * Interpolate the weapon's visual state. Called before the camera is composed, because
     * the aim-recoil offset it produces is part of where the camera points.
     */
    sampleVisual(alpha: number): void {
        this.weapons.sample(alpha, this.visual);
    }

    /** Render pass. `yaw`/`pitch` already include the interpolated recoil offset. */
    render(alpha: number, camera: THREE.PerspectiveCamera, dt: number, yaw: number, pitch: number): void {
        this.placeListener(camera);
        this.arsenal.updateDrive(dt, yaw, pitch);
        this.renderWorld(alpha, camera, dt);
        this.arsenal.updateVisibility();
        this.fillPlayerState();
        this.surfaces.fillTacticalState();
        this.surfaces.fillStreakHud();
        this.surfaces.fillMinimapStreaks();
        this.objectives.update(dt);
        // Straight from the pass that just decided where the bomb mesh goes, so the arrow and
        // the object it points at are the same frame's answer (round 4, F2).
        this.objectives.readBombBearing(bombBearingScratch);
        this.ui.hud.setObjectiveBearing(bombBearingScratch.active, bombBearingScratch.x, bombBearingScratch.z);
        this.mortarOverlay.update(dt, MORTAR_MARK_RADIUS);
        const sim = this.deps.player.sim;
        this.ui.update(this.flow, sim.x, sim.z, sim.yaw, dt);
        this.feedback.render(camera);
    }

    /**
     * Take the match apart.
     *
     * Everything constructed in the constructor is undone here, in the reverse order, and
     * every subscription is dropped — this is the method acceptance criterion 1 and the heap
     * harness are really testing. Anything added to `Match` that is not released here shows up
     * as a step in `usedJSHeapSize` at the next match boundary.
     */
    /**
     * Close progression out and hand back the summary's XP report.
     *
     * Called by `Game` on the way into SUMMARY rather than from the mode, because banking a
     * match is a *state machine* event: the mode declares a winner, and the profile is
     * written once the match is genuinely over and nothing else is going to change.
     */
    bankProgression(won: boolean): XpReport {
        return this.meta.finish(won);
    }

    dispose(): void {
        // First: a live Chopper Gunner has the camera, and nothing else may run until it is back.
        this.streaks.dispose();
        // The streaks are gone, so the body is unconditionally back in play.
        this.playerCombatant.active = true;
        this.playerCombatant.invulnerable = false;
        this.objectives.dispose();
        this.mortarOverlay.dispose();
        this.meta.dispose();
        this.equipment.dispose();
        // The fire, for the same reason the server puts it out (2026-10-18): four handlers per
        // match on a bus that outlives it, and a player who plays ten of them without reloading
        // the page is forty listeners into a leak nothing else reports.
        this.burn.dispose();
        this.feedback.dispose();
        this.flow.dispose();
        this.score.dispose();
        this.ui.dispose();
        this.bots.dispose();
        this.botRenderer.dispose();
        this.streakRenderer.dispose();
        if (this.range !== null) {
            this.range.dispose();
            this.deps.scene.remove(this.range.group);
        }
        this.fx.dispose();
        this.deps.scene.remove(this.fx.group);
        this.flame.dispose();
        this.deps.scene.remove(this.flame.group);
        this.swapSubscription?.();
        this.swapSubscription = null;
        this.life.dispose();
        this.arsenal.dispose();
        this.deps.audio.setOccluder(null);
        this.deps.audio.resetMatchState();
    }

    /** Radians of interpolated aim recoil, for the camera. */
    get aimYawRad(): number {
        return this.visual.aimYaw * DEG2RAD;
    }

    get aimPitchRad(): number {
        return this.visual.aimPitch * DEG2RAD;
    }

    /** The threshold the low-health state begins at. Exposed for the debug read-out. */
    get lowHealthThreshold(): number {
        return LOW_HEALTH_THRESHOLD;
    }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
    /**
     * The player's own rig, registered with the damage door as a body like any other.
     *
     * The seat it carries is the **server's**, not the constant (M11 Gate B playtest). The same
     * eighth-argument fix `createWeapons` documents, applied to the body the weapon shoots
     * *past*: `Ballistics.nearestTarget` excludes the shooter by id, so a rig registered as
     * entity 0 while the weapon fires as entity 3 is a rig the shooter's own rounds are entitled
     * to hit — and they hit it at t = 0, because the muzzle ray starts inside it. See
     * `PlayerCombatant.entityId` for the three faults that produced.
     */
    private createCombatant(deps: MatchDeps): PlayerCombatant {
        return new PlayerCombatant(
            this.playerHealth,
            deps.localTeam ?? PLAYER_TEAM,
            deps.player,
            this.identity.entityId,
            deps.localName ?? PLAYER_NAME,
        );
    }

    /** The debug lever's request, pre-addressed. See `applySelfDamage`. */
    private createSelfDamageRequest(deps: MatchDeps): DamageRequest {
        const request = makeDamageRequest(deps.weaponDef);
        // Both ends are this client's own seat: `applySelfDamage` is the debug lever that runs
        // real damage at the player, and a request addressed to entity 0 would land on nobody.
        request.targetId = this.identity.entityId;
        request.sourceId = this.identity.entityId;
        return request;
    }

    /**
     * The weapon in the player's hands, and the two rules that are about *this* client's copy.
     *
     * The player holds the *resolved* loadout — base plus attachments plus perks — which `Game`
     * has already copied into `weaponDef` so the tuning panel keeps its reference.
     *
     * The **eighth** argument, and it is the whole fix. `WeaponSystem` defaults `sourceId` to
     * `PLAYER_ENTITY_ID`, which is 0 — right in single-player, wrong the moment a server assigns
     * an entity id. `Inventory` stamps that id onto `EV.WeaponSwapped` and the subscription
     * filters on `identity.is(sourceId)`, so over the network the swap event announced entity 0,
     * the filter rejected it, and `showSlot` never ran: the mechanics changed weapon and the
     * model in your hands did not.
     *
     * Captured at construction rather than read per event, which is safe because a reassignment
     * tears the world down and builds a fresh `Match` around the new identity.
     */
    private createWeapons(deps: MatchDeps): WeaponSystem {
        const weapons = new WeaponSystem(
            deps.weaponDef,
            deps.secondaryDef,
            deps.world,
            this.damage,
            deps.bus,
            deps.viewmodelConfig,
            deps.movementConfig.walkSpeed,
            this.identity.entityId,
        );
        // The range is an instrument, not a fight: its guns never run out of spare magazines
        // (2026-10-03). See `Weapon.infiniteReserve`.
        weapons.inventory.infiniteReserve = deps.mode.id === 'RANGE';
        /**
         * The player's own rounds stop on the bodies they can see (2026-10-18).
         *
         * Set on this one `Ballistics` instance and no other. The knife, the grenades, the
         * flamethrower's cone and both killstreaks all resolve against `DamageSystem.list`
         * alone, which over the network holds nobody but this player — and that is correct and
         * stays: the server resolves every one of those (S4.15), and a client that predicted
         * them would be predicting damage. What is different about a round is that the player
         * *watches where it ends*. The tracer, the spark, the hole and the surface click are
         * drawn on this machine from the trace's terminus, so a terminus behind the enemy is a
         * picture of a miss over a hit that is already on its way. See `Ballistics.blockers`
         * for why these bodies carry no health.
         */
        if (deps.roundBlockers !== undefined) weapons.ballistics.blockers = deps.roundBlockers;
        return weapons;
    }

    private createMelee(deps: MatchDeps): Melee {
        return new Melee({
            world: deps.world,
            damage: this.damage,
            bus: deps.bus,
            // The knife swings as whoever this client is, for the same reason the rifle fires as
            // them: the swing excludes its own source, and a mismatch stabs the swinger.
            sourceId: this.identity.entityId,
        });
    }

    /**
     * The firing range, put into the world, or null where this map has none.
     *
     * Only on the grey-box testbed: a firing range does not belong on a TDM map. The world is
     * handed over so each dummy is dropped onto the geometry actually beneath it rather than
     * trusting the authored `y` (post-M8; see `TargetRange`).
     */
    private spawnRange(deps: MatchDeps): TargetRange | null {
        if (!deps.map.targetRange) return null;
        const range = new TargetRange(
            this.damage,
            deps.bus,
            deps.healthConfig,
            deps.world,
            // A dummy that vanishes takes its own bullet holes with it (BACKLOG #33). `Fx` is
            // built *below* this and is read through `this` when a dummy dies, which is long
            // after the constructor — the range is built early because the director wants it.
            (x, y, z, radius, height) => void this.fx.clearDecalsIn(x, y, z, radius, height),
        );
        deps.scene.add(range.group);
        return range;
    }

    /**
     * The roster and the navmesh it bakes, built once here rather than per match.
     *
     * No weapon is handed over: each bot draws its own (M7, `ai/BotArsenal.ts`).
     */
    private createBots(deps: MatchDeps): BotDirector {
        return new BotDirector({
            world: deps.world,
            mapDef: deps.map.def,
            bus: deps.bus,
            damage: this.damage,
            movement: deps.movementConfig,
            healthConfig: deps.healthConfig,
            viewmodelConfig: deps.viewmodelConfig,
            tiers: deps.tiers,
            perceptionConfig: deps.perceptionConfig,
            scheduler: deps.schedulerConfig,
            player: this.playerCombatant,
            seed: deps.seed,
        });
    }

    /**
     * The bodies. Client-only from M9 — the director owns the roster, not the meshes, and this
     * reconciles its mesh set against that roster each frame.
     */
    private createBotRenderer(deps: MatchDeps): BotRenderer {
        return new BotRenderer(
            deps.actors ?? (() => this.bots.bots),
            // Colour is a relation to this viewer, not an absolute A/B property. That keeps an
            // enemy red from either side of a networked match and makes every FFA opponent hostile.
            () => this.viewer,
            // Round 5, F4: the bodies carry the weapon they were dealt, drawn with the viewmodel's
            // own shared gunmetal, so the filtering setting reaches them the way it reaches the gun
            // in the player's hands.
            deps.anisotropy,
            // Composition root: the renderer resolves a synchronous provider for each actor. Each
            // handle reads the app-level GLB cache and exposes a factory only when it is safe to
            // create instances; the procedural body remains the non-blocking fallback.
            deps.characterAvatarProvider,
            deps.weaponAssets,
        );
    }

    /**
     * The board. A networked client's is the server's, delivered whole; it counts nothing for
     * itself (M13 Phase B). See `ScoreSystem.authoritative`.
     */
    private createScore(deps: MatchDeps): ScoreSystem {
        const score = new ScoreSystem(deps.bus, this.identity, deps.networked !== true);
        // See `ScoreSystem.freeForAll`. The replicated path records kills here too, so a client
        // that dropped same-side kills showed a personal counter that stalled while the server's
        // ladder moved — which is the FFA scoreboard the playtest reported as "not working".
        score.freeForAll = deps.mode.freeForAll === true;
        return score;
    }

    private createFlow(deps: MatchDeps): MatchFlow {
        return new MatchFlow({
            bus: deps.bus,
            score: this.score,
            roster: this.bots.roster,
            mode: this.mode,
            mapId: deps.map.id,
            mapName: deps.map.name,
            // The server put us on a side; in single-player there is only one to be on.
            localTeam: deps.localTeam ?? PLAYER_TEAM,
            identity: this.identity,
            /**
             * A networked client's flow is **replicated, not simulated** (M10, playtest round 2).
             *
             * `simulate` is already skipped for it, so the mode was never going to score — but the
             * kill subscription inside `MatchFlow` ran regardless and resolved against an empty
             * roster, which is why the killfeed was silently blank all milestone. Saying so here
             * makes the two drive modes a property of the object rather than an accident of which
             * methods the caller remembers not to invoke.
             */
            authoritative: deps.networked !== true,
            // The freeze the intro is sized to (M17, C2) — the same number the server computes.
            matchStartSeconds: matchStartSeconds(deps.map.def, this.mode.id),
            onSidesSwapped: (swapped) => this.bots.spawns.setSideSwap(swapped),
        });
    }

    /**
     * Every fact about *which game this is*, pushed at the systems that branch on it.
     *
     * One place rather than five, because they are one fact: a client whose copy disagreed with
     * the server's would be a client predicting a different game.
     */
    private applyModeRules(deps: MatchDeps): void {
        this.bots.respawnPolicy = {
            allowed: (id) => this.flow.respawnAllowed(id),
            noted: (id) => this.flow.noteRespawn(id),
        };
        // M7: if the mode has objectives, hand the director the provider. `ai/` asks and the
        // mode answers; nothing in `ai/` knows a flag from a bomb site (see `ObjectiveIntent`).
        this.bots.objectives = isObjectiveProvider(this.mode) ? this.mode : null;
        // Post-M8: the player collects the bomb with the Use key rather than by walking over it.
        // The mode is told *which* entity drives itself; it never learns that one of them is human.
        if (this.mode instanceof SearchAndDestroy) {
            this.mode.manualPickup = (id) => id === this.localId;
        }
        this.bots.freeForAll = deps.mode.freeForAll === true;
        // There is no such thing as a teammate in FFA, so the friendly-fire gate at the damage
        // door has to come off or half the lobby is unkillable by the other half.
        this.damage.freeForAll = deps.mode.freeForAll === true;
        /**
         * The waiting room's two rules, from the one fact (playtest round 4, F7).
         *
         * The same pair `ServerMatch` sets from `variant`, and set here for the same reason
         * `damage.freeForAll` is set in both runtimes: they are one fact about the match, and a client
         * whose copy disagreed with the server's would be a client predicting a different game.
         *
         * Over the network neither is load-bearing today — the server resolves every shot at a
         * person and owns every row — and both are still set, because "the client happens not to
         * reach this path" is the reasoning that left the damage door's FFA flag (then called
         * `friendlyFire`) unset on the server for four milestones. `combatantsInvulnerable` does
         * reach one path here: the debug self-damage.
         */
        if (deps.warmupArena === true) {
            this.damage.combatantsInvulnerable = true;
            this.score.records = false;
        }
        this.bots.pushAggressionScale = deps.mode.pushAggressionScale ?? 1;
    }

    private createArsenal(deps: MatchDeps): MatchArsenal {
        return new MatchArsenal({
            match: this,
            viewmodel: deps.viewmodel,
            weaponAssets: deps.weaponAssets,
            anisotropy: deps.anisotropy,
            viewmodelConfig: deps.viewmodelConfig,
            movementConfig: deps.movementConfig,
            fx: this.fx,
            flame: this.flame,
            loadout: deps.loadout,
            primary: deps.weaponDef,
            secondary: deps.secondaryDef,
        });
    }

    private createHud(deps: MatchDeps): MatchHud {
        return new MatchHud({
            bus: deps.bus,
            uiHost: deps.uiHost,
            mapDef: deps.map.def,
            mapName: deps.map.name,
            modeName: this.mode.name,
            // F10. Asked of the mode once, here, where every other fact about it is assembled.
            modeBrief: this.mode.brief,
            columns: this.mode.getScoreboardColumns(),
            score: this.score,
            audio: deps.audio,
            localTeam: this.localTeam,
            roster: this.bots.roster,
            teamSize: deps.map.teamSize,
            freeForAll: deps.mode.freeForAll === true,
            warmupArena: deps.warmupArena === true,
            ballotOpen: () => deps.ballotOpen?.() === true,
            cameraRig: deps.cameraRig,
        });
    }

    private createFeedback(deps: MatchDeps): MatchFeedback {
        return new MatchFeedback({
            bus: deps.bus,
            cameraRig: deps.cameraRig,
            cameraConfig: deps.cameraConfig,
            audio: deps.audio,
            input: deps.input,
            player: deps.player,
            playerHealth: this.playerHealth,
            weaponAudio: this.weaponAudio,
            fx: this.fx,
            flame: this.flame,
            hud: this.ui.hud,
            bots: this.bots,
            latency: this.latency,
            identity: this.identity,
            bodyAt: (entityId) => this.bodyAt(entityId),
            onPlayerKilled: () => this.life.onPlayerKilled(),
            listener: () => this.listenerAt,
        });
    }

    /**
     * Built where the death subscription used to be registered, so every handler on
     * `EV.EntityKilled` and `EV.RoundStarted` keeps the order it had.
     *
     * The ledger arrives as a supplier because the streak system it wraps is built further down.
     */
    private createLife(deps: MatchDeps): MatchLife {
        return new MatchLife({
            match: this,
            arsenal: this.arsenal,
            ledger: () => this.ledger,
            bus: deps.bus,
            player: deps.player,
            input: deps.input,
            audio: deps.audio,
            cameraRig: deps.cameraRig,
            movementConfig: deps.movementConfig,
            usesRoundReset: deps.mode.usesRoundReset === true,
            actors: deps.actors,
            bodyAt: (entityId) => this.bodyAt(entityId),
        });
    }

    /**
     * The mesh follows the inventory. `weapon.swapped` fires at the hand-over, which is the
     * exact tick the old weapon has finished going down and the new one starts coming up.
     */
    private subscribeToSwaps(deps: MatchDeps): () => void {
        return deps.bus.on(EV.WeaponSwapped, (p) => {
            if (!this.identity.is(p.sourceId)) return;
            this.arsenal.showSlot(this.weapons.inventory.activeSlotIndex);
        });
    }

    /**
     * M5. Built after the HUD because it pushes the flash and the threat indicator into it,
     * and after the director because it hands the smoke field to `Perception` as an occluder.
     */
    private createEquipment(deps: MatchDeps): MatchEquipment {
        return new MatchEquipment({
            bus: deps.bus,
            scene: deps.scene,
            world: deps.world,
            damage: this.damage,
            bots: this.bots,
            audio: deps.audio,
            cameraRig: deps.cameraRig,
            hud: this.ui.hud,
            cfg: deps.equipmentConfig,
            tiers: deps.tiers,
            localTeam: this.localTeam,
            localId: this.identity.entityId,
            // The equipment's own files (2026-09-24). The loadout's two are warmed below; anything
            // else the world throws is fetched by `EquipmentFx` the first time it sees one.
            weaponAssets: deps.weaponAssets,
            // The same fact `bots.freeForAll` carries, from the same registry flag (M13 Phase A).
            freeForAll: deps.mode.freeForAll === true,
            seed: deps.seed,
            // The server resolves every blast in a networked match (S4.15). This system stays for
            // the prediction and the drawing of the player's own throw.
            authoritative: deps.networked !== true,
        });
    }

    /**
     * The loadout's grenades, not the M5 defaults. Set before the first refill so a spawning
     * player is handed what their class actually carries.
     */
    private fillEquipmentFromLoadout(deps: MatchDeps): void {
        this.equipment.inventory.lethal = deps.loadout.lethal;
        this.equipment.inventory.tactical = deps.loadout.tactical;
        EquipmentSystem.refill(this.equipment.inventory);
        for (const id of [deps.loadout.lethal, deps.loadout.tactical]) {
            void deps.weaponAssets?.preloadEquipment(id).catch(() => undefined);
        }
    }

    /**
     * M6, last of the systems: it hooks into the bots, the flash field and the player
     * controller, all of which have to exist first.
     */
    private createMeta(deps: MatchDeps): MatchMeta {
        return new MatchMeta({
            bus: deps.bus,
            scene: deps.scene,
            profile: deps.profile,
            loadout: deps.loadout,
            score: this.score,
            player: deps.player,
            playerHealth: this.playerHealth,
            weapons: this.weapons,
            bots: this.bots,
            equipment: this.equipment.system,
            equipmentInventory: this.equipment.inventory,
            localTeam: this.localTeam,
            localId: this.identity.entityId,
            banksProgress: deps.banksProgress,
        });
    }

    /**
     * M7, last of all: it asks `MatchMeta` for perk state and `MatchEquipment` for its blast,
     * so both have to exist first.
     *
     * The three predicates below are the whole of the M6 hook activation. `streaks/` never
     * learns what a perk is — it asks three questions and this is where they are answered:
     * Cold-Blooded refuses to be targeted, Ghost refuses to appear on a sweep, and Hardline
     * discounts every requirement.
     */
    private createStreaks(deps: MatchDeps): StreakSystem {
        return new StreakSystem({
            bus: deps.bus,
            score: this.score,
            roster: this.bots.roster,
            // One HUD, one player: the client's answer to both of these is "is this me" (M11 Gate B).
            reportProgressTo: (id) => this.identity.is(id),
            commandFor: (id) => (this.identity.is(id) ? this.lastStreakCommand : null),
            targetable: (id) => (this.identity.is(id) ? this.meta.state.targetedByStreaks : true),
            visibleToUav: (id) => (this.identity.is(id) ? this.meta.state.visibleToUav : true),
            streakDiscount: (id) => (this.identity.is(id) ? this.meta.state.streakDiscount : 0),
            // The player earns only what their class equips; bots have no class, so they keep the
            // full list and behave exactly as they did before.
            equippedStreaks: (id) => (this.identity.is(id) ? this.ledger.equippedStreakIds : ALL_STREAK_IDS),
            context: this.streakContext(deps),
        });
    }

    /** The world a streak acts in: one port instead of a scene, an Fx pool, a rig and a graph. */
    private streakContext(deps: MatchDeps): StreakSystemDeps['context'] {
        return {
            bus: deps.bus,
            world: deps.world,
            damage: this.damage,
            bots: this.bots,
            // M9: one port instead of a scene, an Fx pool, a camera rig and an audio graph.
            // The server hands the same streaks `SILENT_PRESENTATION` and they do not notice.
            present: new ClientStreakPresentation(
                new StreakAudio(deps.audio),
                this.fx,
                deps.cameraRig,
                (x, y, z, radius, bright) => this.equipment.fx.spawnBlast(x, y, z, radius, bright),
            ),
            mapDef: deps.map.def,
            cfg: deps.streakConfig ?? DEFAULT_STREAK_CONFIG,
            rng: new Rng(deps.seed ^ 0x5bd1_e995),
            tiers: deps.tiers,
            roster: this.bots.roster,
            // The same fact `bots.freeForAll` carries, from the same registry flag (M13 Phase A).
            freeForAll: deps.mode.freeForAll === true,
        };
    }

    /** Built after the system above, because it is handed it. */
    private createStreakLedger(deps: MatchDeps): MatchStreakLedger {
        return new MatchStreakLedger({
            streaks: this.streaks,
            identity: this.identity,
            networked: deps.networked === true,
        });
    }

    /** The sentry and care-package bodies. Client-only from M9 — see `StreakRenderer`. */
    private createStreakRenderer(): StreakRenderer {
        return new StreakRenderer(
            this.streaks,
            // The same relation every other surface paints by, and the same "is this me" (M13 A).
            () => this.viewer,
            (id) => this.identity.is(id),
        );
    }

    /** The four things that are true of streaks once both lists exist. */
    private applyStreakRules(deps: MatchDeps): void {
        // The turret's model, started now and awaited by nobody: a sentry costs a killstreak, so
        // the file has the opening of the match to arrive, and `SentryMesh` draws the old box
        // turret for any that beats it. The same bargain `PropModels` makes for the station.
        void preloadSentry();
        /**
         * The riot shield, from whichever streak list this match believes in.
         *
         * The same expression `syncCarriedStreakWeapon` uses and for the same reason: a solo client
         * owns its streaks and a networked one is told about them, and there is exactly one place
         * that has to know the difference. The damage door then asks, every hit, without knowing
         * that either kind of match exists.
         *
         * Set on a networked client too, although the server owns health there: the two simulations
         * are supposed to reach the same answer from the same command stream (S4.15), and a client
         * whose door refused nothing would predict a hitmarker on a body the server never moved.
         */
        this.damage.shieldOf = (id) => this.ledger.carriedWeaponFor(id)?.shield ?? null;
        // Care packages are contestable in every mode, so they ride the second provider slot
        // rather than the mode's (see `BotDirector.streakObjectives`).
        this.bots.streakObjectives = this.streaks;
        this.ledger.setStreakLoadout(deps.loadout.streaks);
    }

    private createObjectives(deps: MatchDeps): MatchObjectives {
        return new MatchObjectives({
            bus: deps.bus,
            scene: deps.scene,
            mode: this.mode,
            localTeam: this.localTeam,
            dormant: (entityId) => this.isDormant(entityId),
        });
    }

    /** M7: the mortar targeting map. Built once; only rasterises when first opened. */
    private createMortarOverlay(deps: MatchDeps): MortarOverlay {
        return new MortarOverlay({
            host: deps.uiHost,
            mapDef: deps.map.def,
            onConfirm: (x, z) => {
                this.mortarMarkX = x;
                this.mortarMarkZ = z;
                /**
                 * Through `spendStreak`, not straight into the local system (M11 Gate B playtest).
                 *
                 * This called `streaks.activate` directly, which on a networked client fires a streak
                 * into the copy of `StreakSystem` that is deliberately never simulated — so the mark
                 * was confirmed, the streak left the pending list, and no shell ever fell. The server
                 * was never asked. `spendStreak` is the one door that knows which of the two a match is.
                 */
                this.spendStreak('mortar', x, z);
            },
            onCancel: () => {
                /* The streak stays pending: cancelling a mark must not spend it. */
            },
        });
    }

    /** Last of the collaborators, because it reads the ledger, the HUD and the mode. */
    private createSurfaces(deps: MatchDeps): MatchSurfaces {
        return new MatchSurfaces({
            match: this,
            ledger: this.ledger,
            keybinds: deps.input.keybinds,
            streakConfig: deps.streakConfig ?? DEFAULT_STREAK_CONFIG,
        });
    }

    /**
     * Flags and bomb sites are worth drawing on the minimap; a TDM map is not (M4's note).
     *
     * The *kinds* matter too: Foundry authors flags and bomb sites together, so a mode that
     * does not filter shows both at once.
     */
    private applyMinimapObjectives(): void {
        const kinds = MatchSurfaces.objectiveKindsFor(this.mode);
        this.ui.hud.minimap.objectiveKinds = kinds;
        this.ui.hud.minimap.showObjectives = kinds.length > 0;
    }

    /** What this room sounds like: the occlusion low-pass and the convolver's response. */
    private installAudioForMap(deps: MatchDeps): void {
        // Occlusion low-pass through the same spatial-hash raycaster the sim uses (S6.7).
        deps.audio.setOccluder((x, y, z) =>
            !deps.world.segmentClear(
                x,
                y,
                z,
                this.listenerAt.x,
                this.listenerAt.y,
                this.listenerAt.z,
                this.occlusionRay,
            ),
        );
        // The room, into the one convolver that already exists (S6.6).
        deps.audio.setReverb(deps.map.def.reverb ?? null);
    }

    /** Over the network: the remote bodies, plus this client, which is not among them. */
    private countAliveActors(team: BotTeam): number {
        let n = 0;
        const actors = this.deps.actors;
        if (actors !== undefined) {
            for (const actor of actors()) {
                if (actor.team === team && actor.participating) n++;
            }
        }
        // A client's own entity is not among its remote actors, so it is never double-counted.
        if (this.localTeam === team && !this.isPlayerDead) n++;
        return n;
    }

    /** Single-player: the director's roster, which already holds the local player's combatant. */
    private countAliveRoster(team: BotTeam): number {
        let n = 0;
        for (const c of this.bots.roster) {
            if (c.team === team && c.participating) n++;
        }
        return n;
    }

    /** A remote body this client is not told the place of (protocol 28). Never true offline. */
    private isDormant(entityId: number): boolean {
        const actors = this.deps.actors;
        if (actors === undefined) return false;
        for (const actor of actors()) {
            if (actor.entityId === entityId) return actor.dormant === true;
        }
        return false;
    }

    /**
     * Find a body by entity id, whichever kind of match this is (M10, playtest round 2).
     *
     * Single-player has one place to look and a networked match has another: the roster holds
     * `Bot`s here and `RemoteActor`s there, and only one of the two is ever populated. Callers
     * that want to put a sound on a body or point a chevron at one should not have to know
     * which — that is exactly the knowledge that leaked into `MatchFeedback` and made every
     * positional cue silent over the network.
     *
     * The remote pose is sampled at `alpha` 1, the newest interpolated position. A sound is a
     * one-shot placed at the instant it fires; blending it against the previous frame would
     * buy nothing audible.
     */
    private bodyAt(entityId: number): Readonly<BodyPose> | null {
        const bot = this.bots.get(entityId);
        if (bot !== undefined) {
            bodyScratch.x = bot.px;
            bodyScratch.y = bot.py;
            bodyScratch.z = bot.pz;
            bodyScratch.eyeHeight = bot.eyeHeight;
            return bodyScratch;
        }

        const actors = this.deps.actors;
        if (actors !== undefined) {
            for (const actor of actors()) {
                if (actor.entityId !== entityId) continue;
                // A dormant body's place is frozen, or a blank origin — not a place to measure from.
                if (actor.dormant === true) return null;
                bodyScratch.x = actor.renderX(1);
                bodyScratch.y = actor.renderY(1);
                bodyScratch.z = actor.renderZ(1);
                // The rig's own eye height is not replicated; the standing default is close enough
                // for a sound and is what the local case uses for a standing bot.
                bodyScratch.eyeHeight = DEFAULT_EYE_HEIGHT;
                return bodyScratch;
            }
        }
        return null;
    }

    /**
     * Whether a point in the world is inside a body that is drawn right now (2026-10-18).
     *
     * The veto `Fx` asks before it stamps a bullet hole; `combat/BodyVolume` holds the shape,
     * and `Fx.decalVeto` the impact paths that need asking. It lives here for the same reason
     * `bodyAt` does: the roster holds `Bot`s in single-player and `RemoteActor`s over the
     * network, and a caller that wants to know whether a point is in somebody should not have
     * to know which kind of match it is in.
     *
     * A dead body is in the list on purpose. A hole punched into a corpse is the same picture
     * as one punched into a standing operator, a metre lower, and it is the one the human
     * reported: `Ballistics.nearestTarget` skips a rig that is not alive, so a round fired at
     * a body on the floor goes through it and marks whatever is behind.
     *
     * The body at this keyboard is not in the list, and does not need to be: first person
     * never looks at it, and a cylinder around your own feet would eat the marks you put on
     * the floor in front of you.
     *
     * Linear over the roster and asked once per impact — per *pellet*, for a shotgun — which
     * is the same structure and the same order of magnitude as the rig scan `Ballistics` runs
     * for the shot that produced the impact in the first place. Nothing here is per frame.
     */
    private insideBody(x: number, y: number, z: number): boolean {
        for (const actor of this.actorsForRender()) {
            if (insideDrawnBody(actor, x, y, z)) return true;
        }
        return false;
    }

    /**
     * What the player's own hands do this tick: the rifle, the knife, and what blocks each.
     *
     * The presses are part of every test here and not just the busy flags, because
     * `equipment.simulate` and `melee.step` both run *after* the weapon this tick — so on the
     * very first tick of a cook `busy` is still last tick's answer, and exactly one round
     * escaped. Measured, not theorised. The rule is shared with the server's `NetPlayer`, which
     * is the one whose hits count: see `handsOffWeapon`.
     */
    private stepPlayerHands(cmd: InputCommand, mortarOpen: boolean, flyingChopper: boolean): void {
        /**
         * Reaching for something else cancels a reload (post-M8 playtest).
         *
         * The report was that grenades can be thrown mid-reload, and the fix the brief allows is
         * either blocking the throw or cancelling the reload. Cancelling is the right one: a
         * blocked throw is an input the player made that the game silently ate, and the magazine
         * is not lost either way — `Weapon` only banks ammunition on completion, so an interrupted
         * reload leaves the count exactly as it was. It is the same rule a swap already follows.
         *
         * Tested on the *press edge* rather than on `busy`, so it fires once, on the tick the hand
         * leaves the rifle, and a held cook does not keep re-cancelling nothing.
         */
        const meleePressed = justPressed(cmd.buttons, this.prevButtons, Btn.Melee);
        const reachedThisTick =
            justPressed(cmd.buttons, this.prevButtons, Btn.Lethal) ||
            justPressed(cmd.buttons, this.prevButtons, Btn.Tactical) ||
            meleePressed;
        if (!this.isPlayerDead && reachedThisTick) this.weapons.weapon.cancelReload();

        this.weapons.fireBlocked = handsOffWeapon(
            cmd.buttons,
            this.prevButtons,
            this.equipment.thrower.busy,
            this.melee.busy,
        );
        /**
         * In the gunship, or with the mortar's map up, the rifle is not the player's (2026-09-28).
         *
         * The map used to skip the weapon's step outright. That kept the rifle quiet here and nowhere
         * else — the server never knew the map was up, and fired the confirming click as a round — and
         * it froze the weapon's own record of the trigger, so the map closing under a held click handed
         * the rifle a fresh press. The map is `Btn.Targeting` on the command now, read here exactly as
         * `NetPlayer` reads it, and the weapon steps suspended: no trigger, no sights, no reload, and a
         * trigger held through it stays dead until it is let go (`WeaponSystem.triggerHeldOff`).
         */
        this.weapons.suspended = flyingChopper || isDown(cmd.buttons, Btn.Targeting);

        if (!this.isPlayerDead) {
            const sim = this.deps.player.sim;
            this.weapons.step(cmd, sim);

            // The residual half of each recoil kick is a real aim change, so it goes where mouse
            // movement goes rather than into a separate offset the player cannot fight.
            if (this.weapons.takeViewResidual(this.residual)) {
                this.deps.input.addViewOffset(this.residual.yaw, this.residual.pitch);
            }
        }

        /**
         * The knife (post-M8). Edge-detected here, in the sim, from the bitfield — S4.2, and the
         * reason there is no DOM handler anywhere near it.
         *
         * Blocked while a grenade is in hand or the gunship has the camera, both of which are
         * "something else owns the hands" cases the weapon already respects.
         */
        const swing = meleePressed && !mortarOpen && !flyingChopper && !this.equipment.thrower.busy;
        this.melee.step(swing, this.deps.player.sim, !this.isPlayerDead);

        // The glint an enemy can see is a property of the weapon, and `PlayerCombatant` is
        // built before the weapon exists — so it is stamped here, once a tick, before
        // perception runs against it. The weapon's class rides the same mechanism for the same
        // reason: `syncRig` needs it to pick the crouched layout, and a sidearm kneels differently.
        this.playerCombatant.glinting = !this.isPlayerDead && this.weapons.glinting;
        this.playerCombatant.pistol = this.weapons.definition.class === 'PISTOL';
    }

    /**
     * The systems that step themselves, in the one order they may be stepped in.
     *
     * Streaks tick after the bots that may have just shot one down, and before the flow that may
     * declare the match over and end them all.
     */
    private stepWorldSystems(cmd: InputCommand): void {
        this.range?.step();
        this.equipment.simulate(cmd, this.deps.player.sim, !this.isPlayerDead);
        this.meta.simulate(cmd, this.deps.player.sim, !this.isPlayerDead);
        // Nobody moves or shoots during the 3-2-1 (post-M8). The player's half is handled at the
        // sampler in `Game.simulate`; this is the other half, and both sides freezing is the
        // point — a countdown one side can use to take an angle is not a countdown.
        this.bots.inputFrozen = this.inputFrozen;
        if (!this.isNetworked) this.bots.simulate(cmd.tickIndex, cmd.sampledAtMs);
        /**
         * The server owns every live streak in a networked match (S4.15).
         *
         * Simulating here as well would put a second sentry, with its own aim and its own damage,
         * on top of the one the server is already resolving shots against — the Domination flag bug
         * with a trigger. The client keeps the object because the HUD and the renderer are written
         * against it, and feeds them from the replicated list instead.
         */
        if (!this.isNetworked) {
            this.lastStreakCommand = cmd;
            this.streaks.simulate(cmd.tickIndex);
        }
    }

    /**
     * What the player is doing with the world this tick, re-derived from state every time.
     *
     * Every one of these is asked rather than latched, which is why nothing here can get stuck:
     * the body is in play if there is no chopper, the hands hold what the streak list says they
     * hold, and the kneel over a bomb is the mode's answer and not a flag somebody set.
     */
    private stepPlayerIntent(cmd: InputCommand): void {
        this.syncChopperBody();
        this.syncCarriedStreakWeapon();
        if (!this.isPlayerDead && !this.mortarOverlay.isOpen) this.stepStreakInput(cmd);
        // Local matches only (M11 Gate B). A networked client's Use key is already in the command
        // it just sent, and `ServerMatch.stepBombInteractions` acts on it there; running this as
        // well would make the client a second authority over a plant timer the server owns, and
        // §6.8 gives that to exactly one of them.
        if (!this.isNetworked && !this.isPlayerDead) this.stepBombInteraction(cmd);
        // Both kinds of match, deliberately — see the `supply` field. After the bomb, so a station
        // authored too near an objective cannot take the tick the plant wanted.
        this.stepSupply();
        this.stepInteractPose();
    }

    /**
     * The three timers, and the one rule they share: a server runs them where there is one.
     *
     * The mode clock is a gameplay timer and runs on ticks like everything else (S4.1) — except
     * when a server is running it, in which case score and round state arrive replicated and a
     * second clock here would disagree with the first one that matters. Burns are health, and
     * health is the server's over the network, so they are on the same line for the same reason;
     * see the `burn` field.
     */
    private stepLifeAndClocks(cmd: InputCommand): void {
        // The server owns when and where a body comes back (S4.15); the client is told. But
        // `stepPlayerRespawn` also *decrements the display timer*, and skipping the whole method
        // left the death screen frozen on the number `onPlayerKilled` set — see
        // `stepRespawnDisplay`.
        if (!this.isNetworked) this.life.stepPlayerRespawn();
        else this.life.stepRespawnDisplay();
        this.life.stepLowHealthAudio();

        if (!this.isNetworked) this.burn.simulate();

        const t0 = performance.now();
        if (!this.isNetworked) this.flow.simulate(cmd.tickIndex);
        this.lastModeMs = performance.now() - t0;
    }

    /**
     * Take the player's body out of play while they are flying a Chopper Gunner, and put it
     * back the moment they are not (M7 playtest).
     *
     * Driven from the live streak rather than from the activate/expire events, so there is no
     * state to get stuck: if there is no chopper, the body is in play, every tick, unarguably.
     * That is the same reasoning the chopper's single-exit rule uses.
     *
     * Both flags are needed and they do different jobs. `active` false removes the body from
     * perception, spawn scoring and bot target selection — nobody comes looking. `invulnerable`
     * is checked at the damage door and stops anything already in flight (a grenade, a mortar,
     * a sentry burst) from resolving against a player who is not there.
     *
     * This reverses M7's original reading of S6.1's "not invulnerable to a lucky mortar":
     * playtesting found being killed by something you cannot see, react to or avoid reads as
     * broken rather than as risk.
     */
    private syncChopperBody(): void {
        const flying = this.streaks.activeChopperFor(this.localId) !== null;
        /**
         * `SPEC[]3` — free cam — is written from here too (round 4, F14).
         *
         * Not because it is a combat flag, but because this is already the one place that re-applies
         * the body's state from state every tick, and `PlayerController.spawn` does not clear
         * `noclip`. A latch set once by the toggle would survive a revoke into the next life. The
         * server writes the same bit from `NetPlayer.step`, from the same replicated mask, which is
         * what makes flying predictable rather than a running argument with collision.
         */
        this.deps.player.noclip = (this.deps.cheats() & Cheat.NoClip) !== 0;
        // Post-M8: the QA spectator uses the same two levers, so it is folded in here rather
        // than written from a second place. Driven from state every tick means there is still
        // nothing to get stuck — turning god mode off puts the body back on the next tick,
        // unarguably, which is the property this method was built for.
        this.playerCombatant.active = !flying && !this.hiddenFromBots;
        this.playerCombatant.invulnerable = flying || this.godMode;
    }

    /**
     * Hold to plant, hold to defuse (M7 playtest).
     *
     * Held rather than tapped, and re-tested every tick: stepping off the site, releasing the
     * key or dying all cancel, which is what makes a plant something the other side can
     * interrupt. The mode owns the timer and the rules; this only reports that the player is
     * standing in the right place with the key down.
     */
    private stepBombInteraction(cmd: InputCommand): void {
        const mode = this.mode;
        if (!(mode instanceof SearchAndDestroy)) return;

        const holding = isDown(cmd.buttons, Btn.Use);
        if (!holding) {
            // Only cancel what *this* player started; a bot's plant is not the player's to stop.
            if (mode.interactEntity === this.localId) mode.cancelInteract();
            return;
        }

        const me = this.playerCombatant;
        if (mode.bomb === 'PLANTED') {
            if (me.team !== mode.defenders) return;
            const site = mode.plantedSite;
            if (site === null || !site.contains(me)) return;
            mode.beginInteract(me, true);
            return;
        }
        if (mode.bomb !== 'CARRIED') return;
        if (me.team !== mode.attackers) return;
        // Picking the bomb up is now the same key as planting it (post-M8 playtest): walking
        // over it does nothing. Tested before the plant branch because you cannot plant a bomb
        // you are not carrying, and one press should be able to do the first of the two.
        if (!mode.isCarrier(this.localId)) {
            mode.tryPickup(me);
            return;
        }
        if (mode.siteContaining(me) === null) return;
        mode.beginInteract(me, false);
    }

    /**
     * Whoever is planting or defusing kneels over the bomb (post-M8, S6.3's visual indicator).
     *
     * Driven from mode state every tick rather than latched on start and cleared on finish,
     * for the same reason `syncChopperBody` is: an interaction can end four ways — completed,
     * stepped off, key released, killed — and a latch would have to be cleared correctly on
     * all four. Asked every tick, there is nothing to get stuck, and a player who dies
     * mid-defuse does not respawn permanently crouched.
     *
     * It applies to bots as well as the player, which is the half that actually matters: the
     * crouch is how the *other* side can tell at a glance that somebody is on the bomb.
     */
    private stepInteractPose(): void {
        const mode = this.mode;
        if (!(mode instanceof SearchAndDestroy)) return;
        const busy = mode.interactingEntity;

        this.deps.player.forceCrouch = busy === this.localId;
        for (const bot of this.bots.bots) bot.controller.forceCrouch = bot.entityId === busy;
    }

    /**
     * Spend a killstreak on the player's say-so (M7).
     *
     * Three absolute keys rather than a cycle, and edge-detected in the sim from the bitfield
     * exactly as S4.2 requires — there is no DOM handler anywhere near this.
     *
     * Where a streak lands is decided here rather than by the streak, because "in front of the
     * player" is a fact about the player: a sentry goes a couple of metres ahead so it does not
     * spawn inside them, a package drops on the spot, and a mortar marks wherever the overlay
     * left its cursor.
     */
    /**
     * Drive the mortar overlay while it is open. Returns true when it owns the input.
     *
     * Steered by the *look delta* rather than a mouse position, because pointer lock means
     * there is no cursor to read and releasing the lock to open a map would drop the player's
     * aim. The player moves the mark exactly as they would move their view.
     */
    private stepMortarOverlay(cmd: InputCommand): boolean {
        if (!this.mortarOverlay.isOpen) return false;

        const dYaw = angleDelta(this.overlayYaw, cmd.yaw);
        const dPitch = cmd.pitch - this.overlayPitch;
        this.overlayYaw = cmd.yaw;
        this.overlayPitch = cmd.pitch;
        // Yaw sweeps the mark east/west, pitch north/south. Scaled so a comfortable flick
        // crosses the map rather than nudging it a metre.
        //
        // The yaw term is **negated**: a view yaw increase turns the player left, and the map is
        // drawn in world axes rather than view axes, so passing it through unchanged sent the
        // cursor the wrong way. Reported from a live match as inverted X.
        this.mortarOverlay.moveBy(-dYaw * MORTAR_STEER_M_PER_RAD, -dPitch * MORTAR_STEER_M_PER_RAD);

        if (justPressed(cmd.buttons, this.prevButtons, Btn.Fire)) this.mortarOverlay.confirm();
        // The same key that opened it closes it, and the streak stays in hand.
        else if (justPressed(cmd.buttons, this.prevButtons, Btn.Streak1) ||
            justPressed(cmd.buttons, this.prevButtons, Btn.Streak2) ||
            justPressed(cmd.buttons, this.prevButtons, Btn.Streak3)) {
            this.mortarOverlay.cancel();
        }
        return true;
    }

    /**
     * Keys 3, 4 and 5 spend **the class's** first, second and third streak (M11 Gate B playtest).
     *
     * They used to index the *earned* list, packed from zero, so which key fired a given streak
     * depended on how many others happened to be in hand at that moment: a player who had earned
     * only their Chopper Gunner found it on key 3, and key 5 — the key the loadout editor labels
     * "Killstreak · key 5", the key it is bound to — did nothing at all. Reported as the chopper
     * not responding to 5, and it is really the mapping moving underneath the player.
     *
     * Position is now fixed by the class and the earned list only decides whether the press is
     * *honoured*, which is the same rule the HUD paints.
     */
    private stepStreakInput(cmd: InputCommand): void {
        const bits = [Btn.Streak1, Btn.Streak2, Btn.Streak3] as const;
        for (let i = 0; i < bits.length; i++) {
            const bit = bits[i];
            if (bit === undefined) continue;
            if (!justPressed(cmd.buttons, this.prevButtons, bit)) continue;
            const id = this.ledger.streakSlots[i];
            if (id === undefined || id === null) continue;
            // Affordable, cool, and not already in the sky, or the press is simply not honoured. The
            // slot has already said which — a price it cannot meet, or a fill draining — so a press
            // that does nothing is a press the player was told about before they made it.
            if (!this.ledger.canAffordStreak(id)) continue;

            const sim = this.deps.player.sim;
            // A mortar is *marked* before it is spent: the overlay opens, and the streak is only
            // consumed when the player confirms. Cancelling must not cost them the streak.
            if (id === 'mortar') {
                this.mortarOverlay.show(sim.x, sim.z);
                this.overlayYaw = cmd.yaw;
                this.overlayPitch = cmd.pitch;
                return;
            }
            this.spendStreak(id, sim.x, sim.z);
            return;
        }
    }

    /**
     * Spend a streak — locally, or by asking the server (M11 Gate B, §8.22).
     *
     * The networked path sends a **request** and changes nothing locally. There is deliberately no
     * optimistic activation: §4.15 puts killstreak activation on the replicated side, and a client
     * that put a sentry down and then had it taken away by the next frame would be showing a
     * correction for a thing that was never true. The round trip is one frame at any playable
     * ping, and a sentry that appears a frame late is not something a player can perceive — a
     * sentry that appears and vanishes is.
     *
     * The coordinates sent are the mortar's mark and nothing else; the server places every other
     * streak from its own copy of where the player is standing.
     */
    private spendStreak(id: StreakId, markX: number, markZ: number): void {
        if (this.isNetworked) {
            this.deps.onStreakRequest?.(id, markX, markZ);
            return;
        }
        const sim = this.deps.player.sim;
        // Two metres along the facing, so a sentry is placed rather than worn.
        const ahead = 2;
        const px = sim.x - Math.sin(sim.yaw) * ahead;
        const pz = sim.z - Math.cos(sim.yaw) * ahead;
        const useAhead = id === 'sentry';
        this.streaks.activate(
            this.localId,
            id,
            id === 'mortar' ? markX : useAhead ? px : sim.x,
            sim.y,
            id === 'mortar' ? markZ : useAhead ? pz : sim.z,
            sim.yaw,
        );
    }

    /**
     * Put a carried killstreak weapon in the player's hands, or take it back (2026-09-26).
     *
     * Asked every tick from whichever list is authoritative here, and pushed by nothing — the
     * same shape as `syncChopperBody` immediately above and for the same reason: with no edge to
     * miss there is no state that can get stuck holding a minigun that expired. In a solo match
     * the live streaks are this client's own; in a networked one they are the server's, arriving
     * as replicated entities, because §4.15 puts activation on that side and this client does not
     * activate its own streaks even when it asked for them.
     *
     * A dead player holds nothing: `StreakSystem.onDeath` retires a carried streak with the body
     * that called it in, so the answer here goes to null on the same tick without a second rule.
     */
    private syncCarriedStreakWeapon(): void {
        this.weapons.holdStreakWeapon(this.ledger.carriedWeaponFor(this.localId));
        this.arsenal.syncStreakModel();
    }

    /**
     * A puff of fire on every body that is alight, four times a second (2026-09-26).
     *
     * The library has no flame particle and this session was told to use what exists rather than
     * wait for one, so the burn borrows the impact puff: it is small, it is already pooled, and
     * four a second at chest height reads as *that body is burning* from across a lane. It is
     * driven from the render clock and spawns nothing on a tick, which is the rule for everything
     * in this file below the simulation.
     */
    private renderBurns(dt: number): void {
        this.burnFxTimer -= dt;
        if (this.burnFxTimer > 0) return;
        this.burnFxTimer = BURN_FX_INTERVAL;
        for (const actor of this.actorsForRender()) {
            const burning = this.isNetworked
                ? (actor as { burning?: boolean }).burning === true
                : this.burn.isBurning(actor.entityId);
            if (!burning) continue;
            const x = actor.renderX(1);
            const y = actor.renderY(1) + BURN_FX_HEIGHT;
            const z = actor.renderZ(1);
            this.fx.spawnHitPuff(x, y, z, 0, 1, 0);
        }
    }

    /**
     * One tick at a resupply station.
     *
     * Everything it needs is already here: where the body is and what stance it is in — kneeling is
     * the whole of the instruction since the use key came off it (2026-09-28) — the weapon **in the
     * hand**, since `weapons.weapon` is the active slot rather than the loadout, and the grenade
     * inventory. A dead body is passed through as not alive rather than skipped, so the state clears
     * and the prompt goes with it.
     */
    private stepSupply(): void {
        if (!this.supply.any) return;
        this.supply.step(this.localId, this.deps.player.sim, !this.isPlayerDead, this.weapons.weapon, this.equipment.inventory);
    }

    /**
     * Where the player's ears are this frame.
     *
     * Written into the one object the occlusion closure reads (see `installAudioForMap`), so a
     * positional sound is low-passed against the geometry between it and the camera rather than
     * against where the body happens to be standing.
     */
    private placeListener(camera: THREE.PerspectiveCamera): void {
        this.listenerAt.x = camera.position.x;
        this.listenerAt.y = camera.position.y;
        this.listenerAt.z = camera.position.z;
    }

    /** Everything in the world that moves on the render clock rather than on a tick. */
    private renderWorld(alpha: number, camera: THREE.PerspectiveCamera, dt: number): void {
        this.range?.updateVisuals(alpha, camera);
        // The body a dead player is watching through is not drawn (M17, C2) — see `BotRenderer.eyesOf`.
        this.botRenderer.setEyesOf(this.spectatorTargetId);
        this.botRenderer.update(alpha, dt, camera);
        this.fx.update(dt);
        this.flame.update(dt, camera);
        this.renderBurns(dt);
        this.equipment.render(alpha, dt, camera);
        this.meta.render(dt);
        /**
         * One source of streaks, chosen once (M11 Gate B).
         *
         * `streaks.render` advances presentation state on locally-owned streak objects, of which a
         * networked client has none — and `streakRenderer.update()` reconciles against that same
         * empty local list, so calling it here as well would delete every replicated mesh the line
         * above just built.
         */
        if (this.isNetworked) {
            this.streakRenderer.updateReplicated(this.ledger.replicatedEntities);
        } else {
            this.streaks.render(dt, alpha);
            this.streakRenderer.update();
        }
    }

    /**
     * The player's own numbers, into the HUD's record: the magazine, the bar, and the wait.
     *
     * Here rather than in `MatchSurfaces` because two of the three sources are this object's own
     * private collaborators — the life, for the countdown and the panel — and the third is the
     * weapon in hand, which is only *sometimes* the weapon the player is holding.
     */
    private fillPlayerState(): void {
        const state = this.ui.state;
        const weapon = this.weapons.weapon;
        /**
         * The ammunition readout follows whichever gun the player is actually holding (round 2).
         *
         * A gunship belt is the same four facts a rifle magazine is — how many, out of how many,
         * is it being fed, and how far through — so it goes through the same four fields rather
         * than growing a second ammo widget that would have to be positioned, styled and hidden.
         * The grounded rifle's numbers are *wrong* to show during a takeover for the same reason
         * `weapons.suspended` exists: the player is not holding it, and the last thing they need
         * while flying is a magazine count that never moves.
         */
        const chopper = this.streaks.activeChopperFor(this.localId);
        if (chopper !== null) {
            state.mag = chopper.mag;
            state.magSize = chopper.magSize;
            state.reserve = 0;
            state.reserveInfinite = true;
            state.reloading = chopper.reloading;
            state.reloadFraction = chopper.reloadFraction;
        } else {
            state.mag = weapon.mag;
            state.magSize = weapon.definition.magSize;
            state.reserve = weapon.reserve;
            state.reserveInfinite = weapon.infiniteReserve;
            state.reloading = weapon.reloading;
            state.reloadFraction = this.visual.reloadFraction;
        }
        state.spreadDeg = this.weapons.spreadDeg;
        state.adsFraction = this.visual.adsFraction;
        state.fovDeg = this.deps.cameraRig.fov;
        state.health = this.playerHealth.current;
        state.healthMax = this.playerHealth.max;
        state.dead = this.isPlayerDead;
        state.respawnSeconds = this.life.respawnSeconds;
        // One life: there is no timer to show, because nobody is coming back until the round does.
        state.awaitingRound = this.isPlayerDead && !this.flow.respawnAllowed(this.localId);
        // Only while dead: a report that outlived the body it describes would be a panel telling a
        // living player how they died a minute ago (round 5, F9).
        state.deathReport = this.life.reportForHud();
    }
  //#endregion
}
//#endregion
