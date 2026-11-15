/**
 * This client's relationship with a server: the dial, the seat it can get back, and every
 * transition the server starts.
 *
 * ## Why it is its own object
 *
 * `Game` is the top-level state machine, and M10-M11 grew a second machine inside it — a
 * connection with its own states (dialling, live, rotating, migrating, reconnecting, held on
 * a summary), its own deferred work, and nineteen fields that only ever mean anything when
 * there is a server. C23a moved that machine here. What is left on `Game` is the screen the
 * player is on and the world they are in, which is what that class was always about.
 *
 * **Everything here is deferred on purpose.** A rotation, a migration and a summary all arrive
 * inside a snapshot decode, and tearing the world down from there is a null dereference in the
 * middle of an event dispatch. So each one sets a field and `servicePendingTransitions` cashes
 * it — from the render pass, or from the hidden-tab heartbeat when there is no render pass.
 * That is the one rule this file has, and it is why `pendingRotation`, `pendingMigration`,
 * `pendingSummary` and `pendingNetSummary` are four fields rather than four method calls.
 *
 * The three front-end surfaces it drives — the ballot, the loading screen and the background
 * build — are **constructed by `Game` and handed over**, not built here. They are app-lifetime
 * DOM appended to the one host in a fixed order, and the order they are appended in is the
 * order they paint in; a collaborator that built its own would have moved them in the stack.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { DT } from '../shared/core/Loop';
import { logger } from '../shared/core/Log';
import { BYE_IDLE } from '../shared/net/Protocol';
import { handshake, HandshakeError, type HandshakeOptions } from './net/Handshake';
import { multiplayerJoinOptions } from './net/JoinOptions';
import type { SummaryInfo, WelcomeInfo } from '../shared/net/Messages';
import type { SkirmishSink } from '../shared/net/NetClient';
import { isArenaInstance, toNetLoadout, type NetLoadout } from '../shared/net/Skirmish';
import { skinIndexOf } from '../shared/meta/Skins';
import type { GameStateId } from '../shared/core/GameStates';
import type { MatchResult } from '../shared/modes/GameMode';
import {
  matchFloorLine,
  xpSourceAt,
  type XpLine,
  type XpLines,
  type XpReport,
} from '../shared/meta/XpRules';
import type { findMode } from '../shared/modes/ModeRegistry';
import type { Profile } from './meta/Profile';
import type { FrameStats } from './debug/FrameStats';
import type { Input } from './input/Input';
import type { GameScreens } from './GameScreens';
import type { LoadingScreen } from './ui/LoadingScreen';
import type { VoteOverlay } from './ui/VoteOverlay';
import type { MapBuildQueue, BuildReport } from './world/MapBuildQueue';
import type { MatchWorld, NetworkedMatchOptions } from './MatchWorld';
import type { NetSession } from './net/NetSession';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * What this object needs from the application root.
 *
 * The three surfaces are objects because they are built once at boot and never replaced; the
 * rest are suppliers because the world they describe is rebuilt under them, which is the
 * whole subject of this file.
 */
export interface GameSessionDeps {
  readonly screens: GameScreens;
  readonly profile: Profile;
  readonly stats: FrameStats;
  readonly input: Input;
  readonly loadingScreen: LoadingScreen;
  readonly voteOverlay: VoteOverlay;
  readonly buildQueue: MapBuildQueue;
  /** The live world, or null outside a match. Rebuilt by `applyRotation`. */
  readonly world: () => MatchWorld | null;
  readonly currentState: () => GameStateId;
  readonly transitionTo: (next: GameStateId) => void;
  readonly buildWorld: () => void;
  readonly teardownWorld: (options?: { keepConnection?: boolean }) => void;
  /** The mode, the server's when connected. Read by `netLoadout` for its unlock rule. */
  readonly modeEntry: () => ReturnType<typeof findMode>;
  /** The page's query string, for the join options. */
  readonly locationSearch: () => string;
  /**
   * The server's answer to a cheat code (playtest round 4, F14).
   *
   * Only the sentence reaches this client: the entitlements are already in
   * `NetClient.cheatMask` — replicated state, applied before this fires — so there is
   * nothing here to write and nothing that could disagree with the simulation. `Game` owns
   * the caption and the code that was sent, which is why the handler is its.
   */
  readonly onCheatsAnswered: (outcome: number) => void;
  /** The instant cheat's caption, discarded with everything else from an instance we left. */
  readonly onMigrationDiscard: () => void;
}

/** One window of post-migration mispredictions, for the §7 panel. */
interface MigrationWindow {
  matchId: number;
  tick: number;
  mispredictions: number;
}

/** The window currently open, and what it is counting against. */
interface OpenWindow {
  readonly untilTick: number;
  readonly baseline: number;
  readonly index: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const netLog = logger('join');

/**
 * Milliseconds of building per frame once the loading screen is up (§4.18).
 *
 * Two orders of magnitude above the background budget, and deliberately: the match has already
 * started without this client, the screen is covering the world, and every frame spent
 * trickling chunks is a frame they are not playing. The background path optimises for not being
 * noticed; this one optimises for being over.
 */
const LOADING_DRAIN_BUDGET_MS = 200;

/** The §7 window: *"misprediction count in the first 60 ticks after migration"*. */
const POST_MIGRATION_WINDOW_TICKS = 60;

/** Windows kept for the panel. A long session migrates twice a minute; this is an hour of them. */
const MAX_MIGRATION_WINDOWS = 120;
//#endregion

// ===================================== CLASS GameSession ====================================== \\
//#region Class GameSession
export class GameSession {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /**
   * The connection and the `Welcome`, once the handshake has completed (M10, playtest
   * round 2).
   *
   * `Game.buildWorld` reads the map and the mode **out of this** rather than out of the menu
   * selection. That inversion is the fix for the reported map/mode desync: the client
   * used to load whatever the front end had selected and then dial a server that was running
   * something else, and every consequence of the two disagreeing — spawning outside the
   * world, walking through walls, a rubber-band on every step — looked like a netcode fault
   * and was a loading fault.
   *
   * Null in single-player and while nothing is connected.
   */
  server: NetworkedMatchOptions | null = null;

  /** True while the handshake is in flight, so a second click cannot start a second one. */
  private joining = false;

  // ---- M11: the skirmish flow ----------------------------------------------

  /** Set by the Play Multiplayer button. Wins over `?server=`. See `launchMatch`. */
  private multiplayerJoin: HandshakeOptions | null = null;

  /**
   * The seat this client may still be able to get back (M11 Gate B, playtest round 4, F8).
   *
   * **State that outlives the world it describes**, which is the whole reason it is a field
   * here rather than something read off the netcode when it is needed: by the time a
   * reconnect is worth attempting the socket is closed and `MatchWorld` is about to be torn
   * down, so a token fetched at that moment would be fetched from an object that is going away.
   * It is captured at the handshake and refreshed from `NetClient` — which updates it on every
   * seat assignment — while the world still exists.
   *
   * In memory only, deliberately. A page reload is the one reconnect case this does not cover,
   * and `sessionStorage` would cover it at the cost of leaving a live seat capability sitting in
   * the tab where any script on the origin can read it. That is a trade worth making
   * consciously rather than by default, and it is on the list for the human.
   */
  private reconnectToken: Uint8Array | null = null;

  /** True while a reconnect dial is in flight, so a second frame cannot start a second one. */
  private reconnecting = false;

  /** Frames the migration is held so the loading screen can paint. See the migration branch. */
  private loadingHeldFrames = 0;

  /** The last completed background build, for the §7 panel. */
  private lastBuildReport: BuildReport | null = null;

  /**
   * Post-migration misprediction windows (§7, §8.9).
   *
   * *"Misprediction count in the first 60 ticks after migration, which is the direct regression
   * test for Tier 1 #20."* One entry per migration, opened when the move lands and closed sixty
   * ticks later. Bounded, because a long session migrates twice a minute and an unbounded array
   * in a diagnostic is a slow leak in the tool built to find them.
   */
  private readonly migrationWindows: MigrationWindow[] = [];
  private openWindow: OpenWindow | null = null;

  /**
   * A migration the server has announced, acted on from the render pass.
   *
   * Same reasoning as `pendingRotation`: it arrives inside a snapshot decode, and tearing the
   * world down from there is a null dereference in the middle of an event dispatch.
   */
  private pendingMigration: WelcomeInfo | null = null;

  /** The most recent summary from a live match, held until SUMMARY renders it (§6.9). */
  private pendingNetSummary: SummaryInfo | null = null;

  /** The instance a `Prepare` named, so the readiness report is addressed to it (§6.5). */
  private pendingMatchId = -1;

  /**
   * The server tick the summary hold expires on (§6.9, playtest round 4).
   *
   * A deadline rather than a duration, and -1 for "nobody is holding this screen". The screen
   * uses it to *say* how long is left, never to act: the server migrates everybody back on its
   * own clock, and a client that decided for itself when the summary was over would leave early
   * and sit in a world that has been torn down.
   *
   * It used to be `holdSeconds`, integrated frame by frame by `EndOfMatch`. Two things were
   * wrong with that and only one of them was the arithmetic: the count started when the *client*
   * reached the screen rather than when the *server* started holding it, and it kept running
   * perfectly happily on a connection that had already been closed.
   */
  private summaryEndsTick = -1;

  /**
   * Set when the server rotates to a new match while we are in one.
   *
   * Acted on from the render pass rather than from inside the network update, for the same
   * reason `pendingSummary` is: tearing down the world from inside a callback the world is
   * currently iterating is how you get a null dereference in the middle of an event dispatch.
   */
  private pendingRotation: WelcomeInfo | null = null;

  /** True for the duration of `applyRotation`. See `Game.teardownWorld`. */
  private rotating = false;

  /** Set when the mode declares the match over; SUMMARY is entered from the render pass. */
  private pendingSummary = false;

  /**
   * Keeps the connection alive while the tab is hidden (M10).
   *
   * `requestAnimationFrame` is **completely suspended** in a background tab — not throttled,
   * suspended — so the frame loop stops, `simulate` stops, and with it every ping and every
   * command. Measured: a hidden tab sends nothing at all, and the server's 10-second
   * inactivity timeout (S6.1) drops it. Alt-tabbing for fifteen seconds would disconnect you.
   *
   * So when the page goes hidden the network gets its own timer. It pumps the same
   * `NetSession.update()` the frame loop would have — polling, acking and pinging — and the
   * commands it samples are empty, because `Input.clearHeld` fires on blur. The player stands
   * still and stays connected, which is what everyone expects alt-tab to do.
   *
   * The *simulation* deliberately does not run on this timer. The client's tick number comes
   * from the synced server clock (S4.11), so on returning it resynchronises by itself rather
   * than trying to catch up on a minute of missed ticks.
   */
  private hiddenNetTimer: ReturnType<typeof setInterval> | null = null;

  /** The summary the server sent, held between `takeNetSummary` and `bankServerXp`. */
  private netSummary: SummaryInfo | null = null;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(private readonly deps: GameSessionDeps) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** True when there is a server behind this match. Reads as "networked" everywhere it is asked. */
  get isConnected(): boolean {
    return this.server !== null;
  }

  /** The last background build, for the §7 panel. A supplier: it outlives the world. */
  get buildReport(): BuildReport | null {
    return this.lastBuildReport;
  }

  /** The §7 panel's windows, as `MatchWorld` asks for them. */
  get windows(): readonly MigrationWindow[] {
    return this.migrationWindows;
  }

  /**
   * Play Multiplayer (M11, §6.1).
   *
   * One click to shooting. There is no server picker, no ready-up and no lobby — the address
   * is configuration (§4.9), the callsign is prefilled, and the only screen between the button
   * and the arena is the word "connecting". Everything a traditional flow does in a static menu
   * this one does later, while the player is holding a gun.
   *
   * It reuses `launchMatch` rather than duplicating the connect path, so the map/mode desync
   * fix from M10's playtest — *build nothing until the server has said what it is running* —
   * covers this entry too by construction.
   */
  async playMultiplayer(): Promise<void> {
    const join = multiplayerJoinOptions(this.deps.locationSearch(), this.deps.profile.settings.callsign);
    if (join === null) {
      // The button is disabled in this case, so reaching here means the config changed under
      // us. Say so rather than failing silently.
      this.deps.screens.menus.showBoot('NO SERVER CONFIGURED — SET VITE_SERVER_URL OR ?SERVER=');
      window.setTimeout(() => {
        if (this.deps.currentState() === 'MENU') this.deps.screens.menus.show();
      }, 3000);
      return;
    }
    this.multiplayerJoin = join;
    await this.launchMatch();
  }

  /**
   * Start a match: connect first if there is a server, and only then build a world (M10,
   * playtest round 2).
   *
   * The ordering is the entire fix for the map/mode desync. `MatchWorld`'s constructor loads
   * a map and spawns the player into it, and it used to run *before* anything was dialled —
   * so the map came from the local menu selection and could not possibly have been the
   * server's. Now nothing is built until the server has said what it is running.
   *
   * A failed join stays in the menu with the reason on screen. It deliberately does **not**
   * fall back to single-player: a player who asked to join a server and silently got a bot
   * match instead would have no way to tell, and would report it as "the server is empty".
   */
  async launchMatch(): Promise<void> {
    /**
     * **Only the Play Multiplayer button connects** (M11 playtest, §6.2).
     *
     * This used to fall back to `this.joinOptions`, which is non-null whenever `?server=` is on
     * the URL or `VITE_SERVER_URL` is baked in — so on any build configured for multiplayer,
     * **Play Solo connected to the server too**. The player got a warmup arena and a vote cycle
     * from a button that promised neither.
     *
     * §6.2 is explicit that Play Solo is *"the existing local path: the client drives the shared
     * simulation locally, exactly as it did before M9"*. So the address is now configuration for
     * the multiplayer button and nothing else: `?server=` decides where that button dials and
     * whether it is enabled, and never what Play Solo does.
     */
    const join = this.multiplayerJoin;
    if (join === null || this.server !== null) {
      // Single-player, or a connection that is already up (resuming, or a rotation).
      this.deps.transitionTo('MATCH');
      return;
    }
    if (this.joining) return;

    this.joining = true;
    this.deps.screens.menus.showBoot(`CONNECTING TO ${hostOf(join.url)}…`);
    try {
      await this.adoptHandshake(join);
    } catch (err) {
      this.reportFailedJoin(join.url, err);
    }
  }

  /** Play Solo. Clears the options a previous multiplayer session left behind. */
  forgetMultiplayerJoin(): void {
    this.multiplayerJoin = null;
  }

  /**
   * The server-to-client skirmish messages (§6.4, §6.5, §6.9).
   *
   * Every one of these is deferred to the render pass or handed to a screen; none of them
   * touches the world directly, because all of them arrive inside a snapshot decode.
   */
  skirmishSink(): SkirmishSink {
    return {
      onVoteState: (info) => this.deps.voteOverlay.apply(info),
      onPrepare: (matchId, mapId) => {
        this.pendingMatchId = matchId;
        /**
         * Start building the chosen map now, while the player is still shooting (§6.5).
         *
         * This is the mechanism that removes the loading screen. The server has nothing to
         * load — its maps were baked at boot — so the whole cost of a map transition is this,
         * and it is paid during warmup rather than at the transition.
         */
        this.deps.buildQueue.start(mapId);
      },
      onMigrated: (welcome) => this.onMigrated(welcome),
      onSummary: (info) => {
        this.pendingNetSummary = info;
      },
      onCheats: (outcome) => this.deps.onCheatsAnswered(outcome),
      onNotice: (text) => {
        /**
         * A line the server wants the player to read: allocation failed, the arena was
         * rebuilt (§4.17, §4.18).
         *
         * Emitted onto the bus rather than drawn here, so it reaches the HUD's existing
         * announcement channel and obeys the same timing and styling as every other piece of
         * feedback. S3's rule that *"a networked event and a local one must be
         * indistinguishable to the client"* applies to this too.
         */
        this.deps.voteOverlay.notice(text);
        netLog.info(`server notice: ${text}`);
      },
    };
  }

  /** What the background build reported, and who to tell. Bound by `Game`'s queue. */
  onBackgroundBuildComplete(mapId: string, report: BuildReport): void {
    this.lastBuildReport = report;
    // Report ready the moment the build lands, which is what `READY_WAIT` is waiting on.
    // The map itself is held by the queue until the migration that needs it arrives.
    const client = this.deps.world()?.net?.client;
    /**
     * Addressed to the match being prepared, not the one we are seated in — the whole point
     * is that we are still in the arena while this builds. The server rejects and logs a
     * `Ready` for any other instance (§8.15).
     *
     * **Except when the thing being prepared is the arena** (playtest round 5, F13). Round
     * five gave the return trip its own `Prepare` so the arena is built during the summary
     * hold instead of at the migration, and reporting readiness for it would be exactly the
     * rejection that paragraph describes: `Router.mayAddress` counts a message addressed to
     * an instance you are not seated in as **misrouted**, and `npm run skirmish` asserts
     * that count is zero. There is also nothing to tell — the arena is `RUNNING` from boot
     * and has no `READY_WAIT` to satisfy. A build with no reader is the whole difference
     * between the two paths, and it is one condition rather than a second code path.
     */
    if (!isArenaInstance(this.pendingMatchId)) client?.sendReady(this.pendingMatchId);
    netLog.info(
      `background build for ${mapId}: ${report.elapsedMs}ms wall, ${report.workMs}ms work, ` +
        `${report.chunks} chunks, worst chunk ${report.worstChunkMs}ms.`,
    );
  }

  /** The mode declared the match over. SUMMARY is entered from the render pass. */
  noteMatchEnded(): void {
    this.pendingSummary = true;
  }

  /**
   * Apply state changes that were requested from inside a callback, now that the callback
   * has returned.
   *
   * Both of these tear down or replace the world, and both are raised from deep inside
   * something that is currently iterating it — a bus dispatch for the match ending, a
   * snapshot decode for the rotation. Doing the work in place is how you get a null
   * dereference half-way through an event dispatch, so they are flags, and this is where
   * they are cashed.
   */
  servicePendingTransitions(): void {
    // The match ended during a sim tick. A paused match cannot end, so the flag simply
    // survives until the match resumes.
    if (this.pendingSummary && this.deps.currentState() === 'MATCH') {
      this.pendingSummary = false;
      this.deps.transitionTo('SUMMARY');
    }

    /**
     * The server started a new match on this connection. Rebuild.
     *
     * Deliberately after the summary transition and not before: a rotation follows a match
     * ending, and the player should get to see the result of the one they just played rather
     * than have it replaced by the next map loading underneath them. The post-match hold on
     * the server (`MATCH_END_HOLD_SECONDS`) is what buys the time for that.
     */
    const rotation = this.pendingRotation;
    if (rotation !== null) {
      this.pendingRotation = null;
      this.applyRotation(rotation);
    }

    /**
     * A migration (M11, §4.18, §6.7).
     *
     * Handled through `applyRotation`, because from this class's point of view the two are the
     * same event: *"the server has put you in a different world; rebuild."* Sharing the path is
     * what guarantees a migration also does the things a rotation learned to do — keep the
     * socket, clear the prediction state, adopt the new entity id — rather than a second
     * implementation that has to remember all of them.
     *
     * What is different is the map: a migration usually has one waiting from the background
     * build, and `applyRotation` picks it up through `takePrebuilt`.
     */
    const migration = this.pendingMigration;
    if (migration !== null) this.serviceMigration(migration);
  }

  /**
   * The networked half of a sim tick, once the session has been pumped.
   *
   * Everything here is about the *connection* rather than the simulation: the seat token the
   * next reconnect will present, and the two ways a link ends.
   */
  afterNetworkUpdate(net: NetSession): void {
    // Refreshed every frame from the netcode, which rewrites it on every seat assignment.
    // Read here rather than at the moment of the drop, because by then the world holding the
    // netcode is the thing being torn down. See `reconnectToken`.
    const seatToken = net.client.reconnectToken;
    if (seatToken !== null) this.reconnectToken = seatToken;

    /**
     * The connection died. Try to get back in; failing that, leave.
     *
     * Without either, a dropped client keeps its map, its HUD and its last snapshot on screen
     * forever: the local flow is inert by design, so nothing ticks, nothing changes, and it is
     * indistinguishable from a frozen game.
     *
     * **`rejected` is not tried again** (round 4, F8). A rejection is the server answering —
     * wrong protocol version, server full — and re-dialling into the same answer is a loop
     * with a loading screen on it. A `disconnected` is the server *not* answering, which is
     * exactly the case a reconnect exists for.
     */
    if (net.state === 'rejected') {
      netLog.warn(`connection refused: ${net.client.closeReason}`);
      this.deps.transitionTo('MENU');
      return;
    }
    if (net.state === 'disconnected') this.onConnectionEnded(net);
  }

  /**
   * Start or stop the background-tab network heartbeat. Bound to `visibilitychange`.
   */
  onVisibilityChanged(): void {
    const hidden = document.hidden;
    if (hidden && this.hiddenNetTimer === null) {
      this.hiddenNetTimer = setInterval(() => this.pumpNetworkWhileHidden(), 50);
      return;
    }
    if (!hidden && this.hiddenNetTimer !== null) {
      clearInterval(this.hiddenNetTimer);
      this.hiddenNetTimer = null;
    }
  }

  /** Close the migration window once it has run its sixty ticks. Called from the render pass. */
  pumpMigrationWindow(): void {
    const open = this.openWindow;
    const client = this.deps.world()?.net?.client;
    if (open === null || client === undefined) return;
    const entry = this.migrationWindows[open.index];
    if (entry === undefined) {
      this.openWindow = null;
      return;
    }
    entry.mispredictions = client.prediction.stats.mispredictions - open.baseline;
    if (client.stats.clientTick >= open.untilTick) this.openWindow = null;
  }

  /**
   * One frame's chunk of the next map (§6.5).
   *
   * A small fixed budget that yields, so a frame that was already expensive simply does one
   * chunk fewer. The §4.18 drain under the loading screen is the other caller and takes two
   * orders of magnitude more, for the reason `LOADING_DRAIN_BUDGET_MS` gives.
   */
  pumpBackgroundBuild(): void {
    const buildMs = this.deps.buildQueue.pump();
    if (buildMs > 0) this.deps.stats.noteBackgroundBuildMs(buildMs);
  }

  /**
   * Seconds left on the server's summary hold, or null when nobody is holding it.
   *
   * `(endsTick - currentTick) * DT` against the synced server clock — the same expression
   * `VoteOverlay.tick` uses for the ballot, deliberately, so the two countdowns on this client
   * cannot mean different things. Null in single-player and null while `stats.clientTick` is
   * still zero, which is a client that has not been told what tick it is rather than one whose
   * hold has expired.
   */
  summaryRemainingSeconds(): number | null {
    const endsTick = this.summaryEndsTick;
    if (endsTick < 0) return null;
    const now = this.syncedServerTick();
    if (now <= 0) return null;
    return Math.max(0, (endsTick - now) * DT);
  }

  /** The tick this client is simulating, from the synced server clock. Zero with no session. */
  syncedServerTick(): number {
    return this.deps.world()?.net?.client.stats.clientTick ?? 0;
  }

  /**
   * The result and the XP the SUMMARY screen renders, and the hold it counts down.
   *
   * **The server's result wins over the local one** (M11, §6.9). Over the network the
   * authoritative outcome arrives as `MsgS.Summary`, built by the instance from its own
   * `ScoreSystem` **before teardown**; where it and the client's reconstruction disagree the
   * server is right by definition — §4.15 puts scores and match flow on the replicated side
   * of the table. Null hands the screen back to the local result, because single-player has
   * no other.
   */
  takeNetSummary(): MatchResult | null {
    const net = this.pendingNetSummary;
    this.pendingNetSummary = null;
    this.summaryEndsTick = net?.endsTick ?? -1;
    this.netSummary = net;
    return net !== null ? netMatchResult(net) : null;
  }

  /**
   * Bank the server's XP award, and shape it for the M6 summary bar (§6.9).
   *
   * The lines come from the instance, which built them from authoritative events before it was
   * torn down. Everything else — the level before and after, the lifetime total the bar
   * animates from — is local, because progression is client-side and there is no account on the
   * server to ask (§6.9: *"no accounts, no server-side database"*).
   *
   * That trade-off is deliberate and is documented in `README.md`: a player can edit their own
   * unlocks, and it affects only them.
   */
  bankServerXp(won: boolean): XpReport | null {
    const net = this.netSummary;
    if (net === null) return null;
    const decoded: XpLine[] = [];
    for (const line of net.xp) {
      // The row is named by its index into `XP_SOURCES` (M13 Phase B): id, label and kind come
      // from the table this client compiled, count and amount from the server's ledger. A byte
      // outside the table is a server one build ahead; the row is dropped rather than drawn as
      // something it is not.
      const source = xpSourceAt(line.source);
      if (source === undefined) continue;
      decoded.push({ id: source.id, label: source.label, count: line.count, xp: line.amount, kind: source.kind });
    }
    /**
     * The floor, on this path too (playtest round 5, B6).
     *
     * A live instance always sends a `MATCH COMPLETE` line, so in practice the fallback never
     * fires — but `net.xp` is decoded from bytes this client did not write, and B6's fix is that
     * a summary *cannot* be handed an empty tally rather than that it copes with one. The
     * fallback is the same row single-player builds, from the same table, so the two paths
     * cannot disagree about what an unplayable-to-zero match is worth.
     */
    const [head, ...rest] = decoded;
    const lines: XpLines = head === undefined ? [matchFloorLine()] : [head, ...rest];
    // Summed from the lines rather than from the wire, so what the bar animates and what the
    // profile banks are the same arithmetic over the same list.
    const total = lines.reduce((sum, line) => sum + line.xp, 0);
    const xpBefore = this.deps.profile.xp;
    const { levelBefore, levelAfter } = this.deps.profile.bankMatch(total, won);
    return {
      lines,
      total,
      xpBefore,
      levelBefore,
      levelAfter,
      // Weapon levels, challenges and camos stay client-side and are not awarded over the wire.
      // The server tracks no per-weapon progression, and inventing one here would be a number
      // with no authority behind it.
      weaponLevelUps: [],
      challengesCompleted: [],
      camosUnlocked: [],
    };
  }

  /**
   * This client's class, as ids on the wire (Tier 1 #20).
   *
   * Read from the profile every time rather than cached, so a class edited in the loadout
   * editor is the class the next connection sends. The ids are the same ones `resolveLoadout`
   * takes locally, which is what makes the server's resolution and the client's agree.
   */
  netLoadout(): NetLoadout | null {
    /**
     * Sanitise **before** copying to the wire (M11 playtest).
     *
     * `resolveEquipped` sanitises the slot in place against the player's unlocks — a class
     * carrying something they have not earned has it stripped — and it does that at *resolve*
     * time, which is when the world is built. `toNetLoadout` reads the same slot at *handshake*
     * time, which is earlier.
     *
     * So the raw slot went over the wire and the stripped slot was resolved locally, and the
     * two sides ran different classes. If the difference touched a movement perk, client and
     * server disagreed about speed on every tick for the whole session.
     *
     * Resolving first collapses that: the slot is sanitised, and the copy that crosses the wire
     * is the one the client will itself resolve. The return value is discarded on purpose —
     * what is wanted is the side effect on the slot, and the caller that needs the resolved
     * form has `Game.applyLoadout` for it.
     */
    this.deps.profile.resolveEquipped(this.deps.modeEntry().unrestricted);
    return toNetLoadout(this.deps.profile.equippedLoadout());
  }

  /**
   * Everything a teardown has to forget before the world goes, and the answer to whether the
   * socket goes with it.
   *
   * A rotation keeps the socket no matter which teardown runs: the SUMMARY state tears the
   * world down on its way out and has no way to know a rotation is why it is leaving.
   */
  forgetPendingTransitions(keepConnection: boolean): boolean {
    this.pendingSummary = false;
    this.pendingRotation = null;
    return keepConnection || this.rotating;
  }

  /**
   * The session half of a teardown, once the world itself is gone.
   *
   * Under `!keep` because a teardown that keeps the connection — a rotation, a reconnect — is
   * not a session exit.
   */
  leaveSession(keep: boolean): void {
    if (!keep) this.server = null;
    /**
     * The ballot goes with the socket (2026-09-14, reported as "NEXT VOTE IN 447.4" over a solo
     * match).
     *
     * The vote overlay is app-lifetime — one instance, built with the UI host, hidden on
     * migration by `onMigrated` — and the arena's 4 Hz broadcast is the only writer of its
     * state. Quitting to the menu tore the world and the session down here and left the last
     * `PLAY` broadcast on the overlay: still on screen, still saying NEXT VOTE IN, and every
     * frame `tick()` computed `(phaseEndsTick - syncedServerTick()) * DT` with no session behind
     * `syncedServerTick()`, which is zero. So the clock showed `phaseEndsTick / 60` — 26 844
     * ticks is the reported 447.4 s — through the whole of the next single-player match.
     *
     * Same rule as `onMigrated`'s: state from an instance you have left is discarded. A
     * teardown that keeps the connection (a rotation, a reconnect) is not a session exit, and
     * the arena will re-state the ballot within a broadcast anyway; a notice up during one must
     * survive it, which is why this is under `!keep` rather than unconditional.
     */
    if (!keep) this.deps.voteOverlay.hide();
    /**
     * Leaving on purpose gives up the seat as well as the socket (round 4, F8).
     *
     * The server already refuses to hold a seat for a clean `Bye` — see `LeaveCause` — and this
     * is the same rule stated on the side that knows *why* the world is going away. Without it,
     * quitting to the menu and pressing Play Multiplayer again inside the grace would present a
     * claim on the match just quit; with only the server's half, the client would be asking for
     * something it should not want.
     *
     * `reconnecting` is the exception and is the whole reason the flag exists: `tryReconnect`
     * tears the world down through this very path on its way to dialling back in, and clearing
     * the token there would throw away the thing it is about to present. Same shape as
     * `rotating` two lines above.
     */
    if (!keep && !this.reconnecting) this.reconnectToken = null;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** Dial, adopt the answer, and enter MATCH on the map the server named. */
  private async adoptHandshake(join: HandshakeOptions): Promise<void> {
    // The class goes with the `Hello`, not after it. See `handshake` and Tier 1 #20.
    const result = await handshake({
      ...join,
      loadout: this.netLoadout(),
      // The body too (M16, B6): the profile's pick, as the table's index. Once per
      // connection; a pick made after this is the next connection's.
      skinIndex: skinIndexOf(this.deps.profile.skinId),
      // Present whatever seat this client last held. Null on a first join, and a token the
      // server does not recognise is an ordinary join rather than a refusal — see
      // `ReconnectRegistry.claim`.
      reconnectToken: this.reconnectToken,
    });
    this.reconnectToken = result.reconnectToken;
    this.server = {
      link: result.link,
      welcome: result.welcome,
      receivedAtMs: result.receivedAtMs,
      pending: result.pending,
      reconnectToken: result.reconnectToken,
      displayName: join.displayName,
      wantRewindDebug: join.wantRewindDebug,
      onNewMatch: (welcome) => {
        this.pendingRotation = welcome;
      },
      // The class rides the handshake so the seat is built with it (Tier 1 #20). By this
      // point `handshake` has already sent the `Hello`, so this copy is what a *rebuilt*
      // session — a rotation or a migration — will send if it ever reconnects.
      loadout: this.netLoadout(),
      skinIndex: skinIndexOf(this.deps.profile.skinId),
      skirmish: this.skirmishSink(),
      prebuiltMap: null,
    };
    this.joining = false;
    this.deps.transitionTo('MATCH');
  }

  /** A join that did not land: say why, and give the player a usable menu back. */
  private reportFailedJoin(url: string, err: unknown): void {
    this.joining = false;
    const reason = err instanceof HandshakeError ? err.message : String(err);
    netLog.error(`could not join ${url}: ${reason}`);
    this.deps.screens.menus.showBoot(`COULD NOT JOIN — ${reason.toUpperCase()}`);
    // Back to a usable menu rather than leaving the player on a dead screen.
    window.setTimeout(() => {
      if (this.deps.currentState() === 'MENU') this.deps.screens.menus.show();
    }, 4000);
  }

  /**
   * The socket died mid-match: dial back in and present the seat we held (round 4, F8).
   *
   * Returns whether an attempt was started. False means there is nothing to try — a
   * single-player match, a client that never got a token, or a dial already in flight — and the
   * caller falls back to the menu, which is what happened unconditionally before this.
   *
   * ## Why it reuses `launchMatch` rather than doing anything of its own
   *
   * Because a reconnect is a join. The server decides whether it is a *return* — that is what
   * the token is for — and every step on this side is identical either way: handshake, learn
   * which map and mode are running, build that world, enter `MATCH`. Writing a second path
   * would be writing a second copy of the ordering fix from M10's playtest, which is exactly
   * the class of duplication that produced the map/mode desync in the first place.
   *
   * The world is torn down **completely**, socket included, through the ordinary `MATCH -> MENU`
   * exit handler rather than by hand — it describes an instance this client has already been
   * thrown out of, and the returning `Welcome` may name a different map (the arena's, if the
   * grace has expired). Clearing `this.server` is what that teardown does and what makes
   * `launchMatch` dial rather than return early, so the transition is doing three jobs and none
   * of them is duplicated here.
   */
  private tryReconnect(): boolean {
    if (this.reconnecting || this.joining) return false;
    if (this.multiplayerJoin === null || this.reconnectToken === null) return false;

    this.reconnecting = true;
    netLog.info('lost the connection mid-match — dialling back in with the seat we held.');
    this.deps.transitionTo('MENU');
    this.deps.screens.menus.showBoot('RECONNECTING…');
    void this.launchMatch().finally(() => {
      this.reconnecting = false;
    });
    return true;
  }

  /** A link that closed. An idle kick is the server's decision and is not dialled back. */
  private onConnectionEnded(net: NetSession): void {
    netLog.warn(`connection ended: ${net.client.closeReason}`);
    /**
     * Freed for inactivity (security audit S6): the server's decision about the player, not
     * a lost connection, so it is **not** dialled back — a reconnect would seat the idle tab
     * again and repeat this at the next timeout. Said on screen, then the menu, the same way a
     * failed join is.
     */
    if (net.client.closeReason === BYE_IDLE) {
      this.reconnectToken = null;
      this.deps.transitionTo('MENU');
      this.deps.screens.menus.showBoot('DISCONNECTED FOR INACTIVITY');
      window.setTimeout(() => {
        if (this.deps.currentState() === 'MENU') this.deps.screens.menus.show();
      }, 4000);
      return;
    }
    if (!this.tryReconnect()) this.deps.transitionTo('MENU');
  }

  /** The server has put this seat in another instance. Discard what belonged to the old one. */
  private onMigrated(welcome: WelcomeInfo): void {
    /**
     * Discard the streaks the instance we are leaving told us about (Gate B, §4.18).
     *
     * §4.18's obligation list on a migration is flush, discard, resync, clear — and this is
     * the same rule applied to a channel that did not exist when it was written. The
     * replica is overwritten wholesale by the next frame from the new instance, but "the
     * next frame" is up to a snapshot interval away, and a sentry from the arena standing
     * in the live match's opening frames is exactly the stale-state artefact the list is
     * there to prevent.
     */
    const world = this.deps.world();
    world?.match.clearReplicatedStreaks();
    world?.match.clearReplicatedProjectiles();
    /**
     * And the ballot, for the same §4.18 reason (playtest round 3).
     *
     * The vote cycle is the **arena's**, and the server broadcasts its state to arena
     * sessions only. A migrated player is therefore never told the ballot closed: the
     * overlay kept the last phase it heard and stayed on screen through the whole match,
     * still answering for keys 1-5. Discard on migration, exactly like the streaks and the
     * projectiles above — it is the same rule about state from an instance you have left.
     */
    this.deps.voteOverlay.hide();
    /**
     * And the instant cheat's caption, for the third time and the same reason (F14 fix).
     *
     * It is *"state from an instance you have left"* exactly as the streaks and the ballot
     * above are. The payment it announces was made against a streak ledger row that
     * `removePlayer` has just forgotten, so a caption that crossed the migration would be
     * describing a balance that no longer exists — which is what the regression looked like
     * on screen.
     *
     * The toggles need nothing here: the server clears them at `unseat` and
     * `NetClient.onWelcome` discards its replica, so by the time this runs there is no
     * simulation bit left to drop. `debugRequest` is deliberately **not** cleared — it is a
     * client surface with a session lifetime, and it survives a migration for the same
     * reason it survives a rotation.
     */
    this.deps.onMigrationDiscard();
    this.pendingMigration = welcome;
    this.openMigrationWindow(welcome.matchId);
  }

  /**
   * Open the sixty-tick misprediction window for a migration that has just landed (§7).
   *
   * The baseline is the running misprediction total at the moment of the move, so what is
   * reported is what happened *inside* the window rather than the count since the page loaded.
   * See `SkirmishPanel` for what a non-zero value means.
   */
  private openMigrationWindow(matchId: number): void {
    const client = this.deps.world()?.net?.client;
    if (client === undefined) return;
    const tick = client.effectiveTick;
    this.migrationWindows.push({ matchId, tick, mispredictions: 0 });
    if (this.migrationWindows.length > MAX_MIGRATION_WINDOWS) this.migrationWindows.shift();
    this.openWindow = {
      untilTick: client.stats.clientTick + POST_MIGRATION_WINDOW_TICKS,
      baseline: client.prediction.stats.mispredictions,
      index: this.migrationWindows.length - 1,
    };
  }

  /** The migration rung reached this frame: move now, show the screen, hold, drain, or move. */
  private serviceMigration(migration: WelcomeInfo): void {
    /**
     * The background build won: adopt it and move, all in this frame (§6.5).
     *
     * This is the path the whole design exists to produce — a brief fade and you are in the
     * new map, with no loading screen and no stall, because the meshing happened while you
     * were still shooting in the arena.
     */
    if (this.deps.buildQueue.hasReady(migration.mapId) || migration.mapId === this.currentMapId()) {
      this.pendingMigration = null;
      this.applyRotation(migration);
      return;
    }

    /**
     * The background build did not finish: show the screen, **then** build (§4.18).
     *
     * The migration is held for one frame rather than acted on now. That frame is what lets
     * the browser paint the loading screen; showing it and building in the same task paints
     * nothing, and the player gets a frozen frame of the world they have already left — which
     * is indistinguishable from a crash.
     *
     * `loadingHeldFrames` is the deferral. One frame is enough for a paint and is the least
     * this can cost.
     */
    if (!this.deps.loadingScreen.visible) {
      this.deps.loadingScreen.show(migration.mapId);
      this.loadingHeldFrames = 1;
      return;
    }
    this.deps.loadingScreen.update(this.deps.buildQueue.progress);
    if (this.loadingHeldFrames > 0) {
      this.loadingHeldFrames--;
      return;
    }

    /**
     * Drain whatever is left of the build in one go, then move.
     *
     * A large budget on purpose: the match has already started without this client and every
     * further frame spent trickling chunks is a frame they are not in it. The screen is up,
     * so a long task here costs nothing visually — which is exactly the trade the chunked
     * path refuses to make during warmup and the right one to make here.
     */
    if (this.deps.buildQueue.building) {
      this.deps.buildQueue.pump(LOADING_DRAIN_BUDGET_MS);
      this.deps.loadingScreen.update(this.deps.buildQueue.progress);
      return;
    }

    this.pendingMigration = null;
    this.applyRotation(migration);
    this.deps.loadingScreen.hide();
  }

  /**
   * The server rotated to another match on the connection we already hold.
   *
   * Called from the render pass, never from inside the network update — see
   * `pendingRotation`. The world is destroyed and rebuilt because the *map may have changed*,
   * and a client that merely reset its state would keep the previous map's colliders. That is
   * the same desync as joining the wrong map, arriving by a different route.
   *
   * The link survives the teardown (`keepConnection`), because the server has not disconnected
   * us — it has reseated us in a new match and told us so with a second `Welcome`.
   */
  private applyRotation(welcome: WelcomeInfo): void {
    const previous = this.server;
    if (previous === null) return;
    netLog.info(`server rotated to ${welcome.modeId} on ${welcome.mapId} — rebuilding the world.`);

    /**
     * `rotating` makes every teardown on this path keep the socket, including the one the
     * SUMMARY state runs on its way out, which has no idea a rotation is why it is leaving.
     */
    this.rotating = true;
    try {
      this.adoptRotation(welcome, previous);
      this.deps.teardownWorld({ keepConnection: true });
      this.rebuildForRotation();
      this.deps.input.clearHeld();
    } finally {
      this.rotating = false;
    }
  }

  /**
   * The new match, adopted *before* anything rebuilds — `Game.buildWorld` reads the map and
   * mode straight off it, and the MATCH state's own enter handler is one of the callers.
   *
   * `pending` is cleared rather than carried: it belongs to the drain that produced the
   * *first* welcome, and replaying those frames into a new match would apply state from
   * the previous one. A rotation's own welcome arrives through `NetClient.receive`, which
   * never drops what follows it.
   */
  private adoptRotation(welcome: WelcomeInfo, previous: NetworkedMatchOptions): void {
    /**
     * Adopt the background build, if it is for the map we are moving to (§6.5).
     *
     * `take` hands over ownership and clears the queue, so the map is disposed by the world
     * that adopts it rather than by two owners or none. A miss — no build, or a build for a
     * different map — leaves this null and `MatchWorld` builds synchronously, which is the
     * §4.18 slow-client path: a visible hitch instead of a seamless transition, and correct.
     */
    const prebuiltMap = this.deps.buildQueue.take(welcome.mapId);
    if (prebuiltMap === null && welcome.mapId !== previous.welcome.mapId) {
      netLog.warn(
        `no background build ready for ${welcome.mapId}; building it now (expect a hitch).`,
      );
    }
    this.server = {
      ...previous,
      welcome,
      receivedAtMs: performance.now(),
      pending: undefined,
      prebuiltMap,
    };
  }

  /** In MATCH the world is rebuilt in place; from SUMMARY or PAUSED the state's own handler does it. */
  private rebuildForRotation(): void {
    if (this.deps.currentState() === 'MATCH') {
      this.deps.buildWorld();
      this.deps.world()?.match.setActive(true);
      return;
    }
    // From SUMMARY (the usual case — a rotation follows a match ending) or from PAUSED.
    // Re-entering MATCH builds the world through the state's own enter handler rather
    // than duplicating it here.
    this.deps.transitionTo('MATCH');
  }

  /** The map the world is currently built on, or '' when there is none. */
  private currentMapId(): string {
    return this.deps.world()?.map.def.id ?? '';
  }

  private pumpNetworkWhileHidden(): void {
    const world = this.deps.world();
    if (world === null) return;
    const net = world.net;
    if (net === null) return;
    world.match.netFrozen = net.frozen;
    net.update();
    /**
     * Serviced here as well as in the render pass, because the render pass is not running.
     *
     * `requestAnimationFrame` is *suspended* in a hidden tab, so `draw` — where these
     * transitions used to be handled and nowhere else — simply never happens. The network
     * keeps running on this timer by design, which means a client could be told the server
     * had rotated to a different map, acknowledge it, and then sit on the previous map's
     * world indefinitely: alt-tab through the post-match hold and you come back to a client
     * playing Foundry against a server running Depot. That is the same desync the handshake
     * fix removed, arriving by a different route.
     */
    this.servicePendingTransitions();
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * The server's authoritative summary, in the shape the M6 summary screen already renders.
 *
 * A projection and nothing more: no number is recomputed, no winner is re-derived. The point
 * is that the screen built in M6 for single-player renders a networked result without knowing
 * it is one, which is the same seam S3 asks for on the event bus.
 */
function netMatchResult(net: SummaryInfo): MatchResult {
  return {
    kind: 'match',
    winner: net.winner as MatchResult['winner'],
    winnerEntityId: net.winnerEntityId,
    reason: net.reason,
    scoreA: net.scoreA,
    scoreB: net.scoreB,
    roundsA: 0,
    roundsB: 0,
  };
}

/** Just the host, for a "connecting to…" line. A whole `ws://` URL is noise on a title card. */
function hostOf(url: string): string {
  const withoutScheme = url.replace(/^wss?:\/\//i, '');
  const end = withoutScheme.indexOf('/');
  return (end < 0 ? withoutScheme : withoutScheme.slice(0, end)).toUpperCase();
}
//#endregion
