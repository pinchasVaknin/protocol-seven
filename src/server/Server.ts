// ========================================== IMPORTS =========================================== \\
//#region Imports
import { nowMs } from '../shared/core/Clock';
import { logger } from '../shared/core/Log';
// Importing this module is also what runs its boot-time check that both ballots name things
// the registry actually has — see the bottom of `Skirmish.ts`.
import { InstanceState } from '../shared/net/Skirmish';
import { describeConfig, type ServerConfig } from './Config';
import { LiveMatch } from './instance/LiveMatch';
import type { MatchInstance } from './instance/MatchInstance';
import { VoteCycle } from './instance/VoteCycle';
import { WarmupMatch } from './instance/WarmupMatch';
import { ServerLoop, type TickJitter } from './Loop';
import { metric } from './log';
import { MapBakery, type BootBakeReport } from './MapBakery';
import {
  FaultyMatchAllocator,
  InProcessMatchAllocator,
  type IMatchAllocator,
} from './MatchAllocator';
import { Migration, seatInfo } from './Migration';
import { ReconnectRegistry, type ReconnectStats } from './net/ReconnectRegistry';
import { Router } from './Router';
import { Session, type JoinResult, type LeaveCause } from './net/Session';
import type { NetPlayer } from './NetPlayer';
import { ClientRequests } from './ClientRequests';
import { SessionDesk } from './SessionDesk';
import { SkirmishFlow } from './SkirmishFlow';
import { WsServer, type WsLink } from './net/WsServer';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * What a reconnect claim came to (M11 Gate B, playtest round 4, F8).
 *
 * Two fields rather than a nullable seat, because a refused claim still has something to say
 * and the two answers are independent: a returning player who got their seat back needs no
 * message, and one who did not needs a *different* message depending on why. Folding them into
 * one nullable return meant parking the reason on the session — a field with exactly one read,
 * one write and a lifetime of three lines.
 */
interface ReclaimOutcome {
  readonly seat: JoinResult | null;
  /** What to tell the player, sent after the identity frame. Null when there is nothing to say. */
  readonly notice: string | null;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const log = logger('server');

/** Not a returning player. The common case, and it says nothing to anybody. */
const NO_RECLAIM: ReclaimOutcome = { seat: null, notice: null };
//#endregion

// ======================================== CLASS Server ======================================== \\
//#region Class Server
/**
 * The process: one loop, one arena, at most one live match (M11, §4.9).
 *
 * Replaces M10's `GameServer`, which was a match, a loop, a listener and a rotation policy in
 * one class. The rotation is gone — a dedicated server that walks a fixed map list is a
 * different product from one where the players vote — and what is left is a scheduler.
 *
 * ## The tick, and why it is in this order
 *
 * ```
 *   1. receive     drain every socket into the input buffers
 *   2. instances   step the arena, then the live match, each wrapped
 *   3. flow        vote cycle, allocation, readiness, migration, teardown
 *   4. flush       release anything the condition simulator is holding
 *   5. reap        time out silent connections, drop closed ones
 * ```
 *
 * Receive before simulate, because a command that arrived during the last frame is for a tick
 * that has not run yet. The **flow runs after the instances**, which is the ordering that
 * matters most here: a migration that ran before the step would move a player out of a world
 * midway through the tick that world was about to simulate them in, and the forced snapshot in
 * Tier 2 §A depends on the ending instance having been stepped first.
 *
 * ## Two instances, one loop
 *
 * §4.19: *"One loop, not N. The drift-corrected loop in §4.10 exists once, at master level,
 * and steps every `RUNNING` instance."* `ServerLoop` is unchanged from M9; the only difference
 * is that its `tick` callback now steps a list.
 */

export class Server {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly loop: ServerLoop;

  private readonly wss: WsServer;

  private readonly bakery = new MapBakery();

  private readonly router = new Router();

  private readonly migration: Migration;

  private readonly allocator: IMatchAllocator;

  /** Non-null only when fault injection is configured. §8.14 drives this. */
  readonly faulty: FaultyMatchAllocator | null;

  private warmup: WarmupMatch;

  private readonly voteCycle: VoteCycle;

  /** Every live connection, and the five passes a tick makes over them. */
  private readonly desk = new SessionDesk();

  /** The five things a client may ask for (§4.16). Built after the pieces they read. */
  private readonly requests: ClientRequests;

  /** Vote, allocate, migrate, end, go home — and recover when any of it fails (§4.17). */
  private readonly flow: SkirmishFlow;

  /**
   * Seats held open for players who have dropped (round 4, F8).
   *
   * On the server rather than on an instance, because it has to outlive the connection that
   * made it and be readable by the next one — which is a fact about the *process*, not about a
   * world. Bounded by the live match's teardown; see `ReconnectRegistry`.
   */
  private readonly reconnects = new ReconnectRegistry();

  private bootReport: BootBakeReport | null = null;

  private lastMetricsMs = 0;

  private stopping = false;

  /** Total ms across every instance for the most recent tick. §8.28's number. */
  totalStepMs = 0;

  meanTotalStepMs = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(private readonly cfg: ServerConfig) {
    /**
     * Bake every map before anything else (§4.19).
     *
     * Before the listener opens, before the arena is built, before a single connection is
     * accepted. The arena itself is built over this cache, so even the greybox room's bake is
     * inside the boot report rather than hidden in a constructor.
     */
    this.bootReport = this.bakery.bakeAll();

    this.warmup = this.buildWarmup(0);
    const inProcess = this.createInProcessAllocator();
    this.faulty = cfg.faultInjection ? new FaultyMatchAllocator(inProcess) : null;
    this.allocator = this.faulty ?? inProcess;
    if (this.faulty !== null) {
      log.warn('FAULT_INJECTION=1 — the allocator can be made to stall and fail. Diagnostic only.');
    }
    if (cfg.rewindDisabled) {
      log.warn('REWIND_DISABLED=1 — lag compensation is OFF. Diagnostic only (S8.6).');
    }

    this.migration = new Migration(this.router);
    this.voteCycle = this.createVoteCycle();
    this.flow = this.createFlow();
    this.requests = this.createClientRequests();
    this.loop = new ServerLoop({
      tick: (tickIndex) => this.tick(tickIndex),
      shouldContinue: () => !this.stopping,
    });
    this.wss = this.createListener();
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  async start(): Promise<void> {
    await this.wss.listen();
    log.info(`listening — ${describeConfig(this.cfg)}`);
    this.lastMetricsMs = nowMs();
    this.loop.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.loop.stop();
    this.desk.closeAll('server shutting down');
    await this.flow.stop();
    this.reconnects.clear();
    this.warmup.dispose();
    await this.wss.close();
  }

  get jitter(): TickJitter {
    return this.loop.jitter();
  }

  get boot(): BootBakeReport | null {
    return this.bootReport;
  }

  /** Both instances, for the §7 instance panel and for the leak harness. */
  get instances(): readonly MatchInstance[] {
    const live = this.flow.instance;
    return live === null ? [this.warmup] : [this.warmup, live];
  }

  get liveMatch(): LiveMatch | null {
    return this.flow.instance;
  }

  get vote(): VoteCycle {
    return this.voteCycle;
  }

  get migrationLog(): Migration {
    return this.migration;
  }

  get misroutedMessages(): number {
    return this.router.misroutedMessages;
  }

  /** Held seats, and what has happened to them (round 4, F8). Read by the flow harness. */
  get reconnectStats(): ReconnectStats {
    return this.reconnects.stats;
  }

  /**
   * Allocate a live match and destroy it again, with nobody in it (§8.13).
   *
   * The teardown leak harness's one operation. It deliberately bypasses the vote cycle: the
   * question is whether `LiveMatch` construction and `dispose` balance, and routing a hundred
   * of them through a hundred sixty-second ballots would take an hour and a half to answer it.
   *
   * It does **not** bypass the allocator, because the allocator holds a reference to the handle
   * and *"every reference held by the router, the session layer and the allocator"* is on
   * §4.18's list of things `destroy()` must release.
   *
   * Rotates the map and mode across calls, so a leak that only appears on one map — a bigger
   * navmesh, a mode with objective state — is not missed by a hundred repetitions of the
   * cheapest one.
   */
  async allocateAndDestroyForLeakTest(): Promise<void> {
    await this.flow.allocateAndDestroy();
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  // -- housekeeping -----------------------------------------------------------

  private createInProcessAllocator(): InProcessMatchAllocator {
    const cfg = this.cfg;
    return new InProcessMatchAllocator({
      bakery: this.bakery,
      snapshotHz: cfg.snapshotHz,
      interpolationDelayMs: cfg.interpolationDelayMs,
      readyTimeoutMs: cfg.readyTimeoutMs,
      summaryHoldSeconds: cfg.summaryHoldSeconds,
      currentTick: () => this.loop.currentTick,
      seed: cfg.seed,
      roundSecondsOverride: cfg.matchRoundSeconds,
    });
  }

  private createVoteCycle(): VoteCycle {
    return new VoteCycle({
      /**
       * Humans **connected to the server**, not humans standing in the arena.
       *
       * §4.20's rule is *"if every human leaves during a vote phase, the cycle cancels"*, and
       * "leaves" means leaves the server. Counting arena occupancy instead made a successful
       * migration look identical to a mass disconnect: the moment everybody moved into the
       * live match the arena was empty, the cycle cancelled itself to `IDLE`, and no further
       * ballot ever opened — the match played out and the players came back to a server that
       * had quietly stopped asking them what to play next.
       *
       * Found by the flow harness, which observed exactly one cycle across a two-cycle run.
       */
      humanCount: () => this.router.playerCount,
      // `this.flow` is read when a ballot resolves, long after the constructor assigned it:
      // the cycle and the flow each need the other, at a different moment.
      onResolved: (resolution) => void this.flow.onVoteResolved(resolution),
      onAborted: (reason) => this.noticeAll(reason),
      seed: this.cfg.seed,
      config: this.cfg.voteCycle,
    });
  }

  private createFlow(): SkirmishFlow {
    return new SkirmishFlow({
      cfg: this.cfg,
      allocator: this.allocator,
      migration: this.migration,
      reconnects: this.reconnects,
      voteCycle: this.voteCycle,
      arena: () => this.warmup,
      currentTick: () => this.loop.currentTick,
      noticeAll: (text) => this.noticeAll(text),
    });
  }

  private createClientRequests(): ClientRequests {
    return new ClientRequests({
      cfg: this.cfg,
      router: this.router,
      voteCycle: this.voteCycle,
      liveHandle: () => this.flow.handle,
      noteVoteChanged: () => this.flow.noteVoteChanged(),
    });
  }

  private createListener(): WsServer {
    const cfg = this.cfg;
    return new WsServer({
      port: cfg.port,
      host: cfg.host,
      tlsCertPath: cfg.tlsCertPath,
      tlsKeyPath: cfg.tlsKeyPath,
      conditions: cfg.conditions,
      // One origin for the page and the socket. See `WsServerOptions.staticDir`.
      staticDir: cfg.staticDir,
      // The door (security audit, part 3). See the fields on `ServerConfig`.
      clientIpHeader: cfg.clientIpHeader,
      maxConnections: cfg.maxConnections,
      maxConnectionsPerIp: cfg.maxConnectionsPerIp,
      allowedOrigins: cfg.allowedOrigins,
      onConnection: (link) => this.accept(link),
    });
  }

  private buildWarmup(startTick: number): WarmupMatch {
    return new WarmupMatch({
      bakery: this.bakery,
      snapshotHz: this.cfg.snapshotHz,
      interpolationDelayMs: this.cfg.interpolationDelayMs,
      seed: this.cfg.seed,
      startTick,
      bots: this.cfg.warmupBots,
      difficulty: this.cfg.botDifficulty,
    });
  }

  // -- connections ------------------------------------------------------------

  private accept(link: WsLink): void {
    const session = new Session(
      link,
      {
        // The name is already on the session by the time this runs — `Session.handleHello`
        // sanitises it and assigns it before calling — so it is taken from there rather than
        // from the parameter, and there is one sanitised copy rather than two.
        onJoin: (s, _name, claim) => this.onJoin(s, claim),
        onLeave: (s, reason, cause) => this.onLeave(s, reason, cause),
        onLoadout: (s, raw) => this.requests.onLoadout(s, raw),
        onVote: (s, phase, option) => this.requests.onVote(s, phase, option),
        onReady: (s, matchId) => this.requests.onReady(s, matchId),
        onStreakRequest: (s, kind, x, z) => this.requests.onStreakRequest(s, kind, x, z),
        onCheatRequest: (s, code) => this.requests.onCheatRequest(s, code),
      },
      () => this.loop.currentTick,
      // Security audit S6: an idle seat is freed. See `Session.checkIdle`.
      { idleKickMs: this.cfg.idleKickSeconds * 1000 },
    );
    this.desk.add(session);
  }

  /**
   * A `Hello` was accepted: decide where this connection sits (§6.7, and round 4's F8).
   *
   * Three outcomes, in the order they are tried, and the order is the whole policy:
   *
   * 1. **A returning player with a live reservation** goes back to the seat they left — same
   *    instance, same entity id, same side, same scoreboard row. This is F8's *"reconnect"*.
   * 2. **Anybody else, while a match is actually running**, joins that match. This is F8's
   *    *"join a match that is already running"*, and it **reverses §6.7** — see below.
   * 3. **Everybody else** enters through the arena, exactly as before. It is still the entry
   *    point whenever there is no running match to enter, which is most of a cycle.
   *
   * ## Reversing §6.7, deliberately
   *
   * §6.7 said *"a player who joins the server while a live match is running goes to the warmup
   * arena, not into the match, and joins at the next cycle. Warmup is always the entry point."*
   * The fourth playtest asks for the opposite and the amended clause is in PLAN.md, so the spec
   * and the code say the same thing.
   *
   * What the old rule bought was one seating path. What it cost is the whole of F8: a player
   * who dropped out of a five-minute match spent the rest of it in the arena watching a ballot,
   * and so did anybody who arrived while a match was on. The cost of reversing it is smaller
   * than it looks, because the piece that made the arena the safe entry point — the background
   * map build — is about **migration**, not about joining: a fresh connection has not built
   * anything yet either way, and `handshake` already tells it which map before a world exists.
   * A direct join is the arena's own path with a different `mapId`.
   *
   * `RUNNING` only. A match in `READY_WAIT` has not started and its players are still in the
   * arena waiting to be migrated as one; dropping a newcomer straight into it would seat them in
   * a world nobody else is in yet, and `maybeStartLive` counts the arena's sessions to decide
   * when to begin.
   */
  private onJoin(session: Session, claim: Uint8Array | null): JoinResult | null {
    // Before anything is seated, so the seat, the scoreboard row and every log line carry it.
    session.displayName = this.desk.uniqueNameFor(session);

    /**
     * The token is minted here, before anything is seated.
     *
     * On the connection rather than on the seat, because it identifies *this socket's right to
     * come back* and has to survive the migrations that reassign everything else about the seat.
     * `Session.sendSeat` stamps it into every assignment, so there is no call site that can
     * forget it.
     */
    session.reconnectToken = this.reconnects.mint();

    const returning = this.reclaimSeat(session, claim);
    if (returning.seat !== null) return returning.seat;
    // Carried into `afterIdentity` as a local rather than parked on the session: it belongs to
    // this one handshake, and a field would be a second place holding a fact with one use.
    const rejoinNotice = returning.notice;

    const destination = this.destinationFor();

    // The claim goes in with the seat even though it opened nothing (M13 Phase B): past the
    // grace it is still the token the live match recorded against this player's row, and the
    // row follows them. The arena ignores it.
    const player = destination.seat(session, session.loadout, null, claim);
    if (player === null) return this.arenaFallback(session, destination, rejoinNotice);
    this.router.admit(session, destination);

    /**
     * The seat assignment goes out in `afterIdentity`, not here (Tier 2 §D).
     *
     * *"Any side effect of a reconnect that sends a frame must not run inside the hello
     * handler, or its frame overtakes the `Identity` it is a reply to."* In this flow the seat
     * assignment **is** the identity frame, so what has to be deferred is everything downstream
     * of it: the vote state and, if a match is being prepared, the `Prepare` that starts a
     * background build. Sent from inside `onJoin`, either would reach the client before the
     * `Welcome` that tells it who it is, and the handshake drops frames it has no context for.
     */
    return { player, afterIdentity: this.afterIdentityFor(session, destination, player, rejoinNotice) };
  }

  /**
   * Where a fresh connection sits: the running match if there is one, the arena otherwise.
   *
   * `RUNNING` only. A match in `READY_WAIT` has not started and its players are still in the
   * arena waiting to be migrated as one; dropping a newcomer straight into it would seat them
   * in a world nobody else is in yet, and `maybeStartLive` counts the arena's sessions to
   * decide when to begin.
   */
  private destinationFor(): MatchInstance {
    const live = this.liveMatch;
    return live !== null && live.state === InstanceState.RUNNING ? live : this.warmup;
  }

  /**
   * The live match refused, so fall back to the arena rather than to the connection.
   *
   * §4.20's shape applied one stage earlier: a player who cannot be given the seat they asked
   * for is left somewhere playable with a message, never dropped. The arena is the destination
   * of last resort and always exists — so a refusal *from* the arena is the one case with
   * nowhere left to go, and the connection is turned away.
   */
  private arenaFallback(
    session: Session,
    destination: MatchInstance,
    rejoinNotice: string | null,
  ): JoinResult | null {
    if (destination === this.warmup) return null;
    const fallback = this.warmup.seat(session, session.loadout);
    if (fallback === null) return null;
    this.router.admit(session, this.warmup);
    return {
      player: fallback,
      afterIdentity: () => {
        this.sendSeatTo(session, this.warmup, fallback.entityId, fallback.team, false);
        if (rejoinNotice !== null) session.notice(rejoinNotice);
        session.notice('The match is full — you are in the arena until the next one.');
        this.flow.sendVoteStateTo(session);
        this.flow.sendPrepareIfBuilding(session);
      },
    };
  }

  /**
   * What goes out after the seat assignment, which is this connection's identity frame.
   *
   * A player who joined a match in progress is deliberately told **nothing** about the ballot:
   * the cycle belongs to the arena and they are not in it, and a vote state would put a ballot
   * on screen for a cycle they cannot take part in — round three's stale-overlay bug, arriving
   * by the one door that was left.
   */
  private afterIdentityFor(
    session: Session,
    destination: MatchInstance,
    player: NetPlayer,
    rejoinNotice: string | null,
  ): () => void {
    return () => {
      this.sendSeatTo(session, destination, player.entityId, player.team, false);
      if (rejoinNotice !== null) session.notice(rejoinNotice);
      if (destination !== this.warmup) {
        log.info(`${session.displayName} joined match ${destination.id} in progress.`);
        return;
      }
      this.flow.sendVoteStateTo(session);
      this.flow.sendPrepareIfBuilding(session);
    };
  }

  /**
   * Give a returning player their seat back, or explain why not (round 4, F8).
   *
   * Returns null for *"this is not a returning player"*, which includes a claim that named
   * nothing and a claim whose grace had run out — the difference between those two is what the
   * player is told, and nothing else. A refused claim always falls through to an ordinary join
   * rather than to a refused connection: somebody whose seat has gone still wants to play.
   */
  private reclaimSeat(session: Session, claim: Uint8Array | null): ReclaimOutcome {
    if (claim === null) return NO_RECLAIM;
    const result = this.reconnects.claim(claim);
    if (!result.ok) {
      /**
       * Silence for an unrecognised token, a line for one that ran out.
       *
       * They are genuinely different events and only one of them is worth interrupting somebody
       * for: an *expired* claim means this player had a seat and the grace elapsed, which is
       * the failure F8 asks to be told about. An *unknown* one is the ordinary case — a token
       * from a match that ended cleanly, or from an arena seat that never reserved anything —
       * and nothing was lost, so there is nothing to say.
       */
      return {
        seat: null,
        notice: result.why === 'expired' ? 'Your seat was given away — welcome back.' : null,
      };
    }

    const held = result.reservation;
    const live = this.liveMatch;
    /**
     * The instance has to still be there, and still be the one the seat is in.
     *
     * A reservation names a `matchId` rather than holding the instance, on purpose: an object
     * reference would keep a destroyed world alive for the length of the grace, which is the
     * shape §4.18's teardown list exists to prevent. `forgetMatch` drops these at teardown, so
     * reaching here with a dead id means a match that ended inside the grace — the player
     * genuinely has no seat to return to, and the arena is the right answer.
     */
    if (live === null || live.id !== held.matchId || live.state !== InstanceState.RUNNING) {
      return { seat: null, notice: 'That match has finished — you are in the arena.' };
    }

    const player = live.seat(
      session,
      held.loadout ?? session.loadout,
      { entityId: held.entityId, team: held.team },
      claim,
    );
    if (player === null) {
      return { seat: null, notice: 'Your seat could not be restored — back to the arena.' };
    }
    // The class they were playing, restored onto the connection as well as the body: it is what
    // the next migration locks into the `MatchRequest` (§4.18), and a returning player who then
    // migrated home with the server's defaults would lose their class one cycle later.
    if (held.loadout !== null) session.loadout = held.loadout;
    this.router.admit(session, live);
    log.info(
      `${session.displayName} reconnected into match ${live.id} as entity ${player.entityId} ` +
        `on team ${player.team} — the seat player ${held.playerId} left.`,
    );
    metric('reconnect', 'restored', {
      playerId: session.playerId,
      previousPlayerId: held.playerId,
      matchId: live.id,
      entityId: player.entityId,
      team: player.team,
    });
    return {
      seat: {
        player,
        afterIdentity: () => {
          this.sendSeatTo(session, live, player.entityId, player.team, false);
          session.notice('Reconnected — welcome back.');
        },
      },
      notice: null,
    };
  }

  /**
   * A connection ended. Free the seat, and hold it open if it is worth holding (§6.7, F8).
   *
   * The reservation is made **before** `router.release`, and the order is the whole of it: the
   * release is what removes the entity, replaces it with a bot and takes the seat out of the
   * instance, so by the time it returns there is nothing left to describe. Everything the
   * reservation needs — which instance, which entity, which side, which class — is read while
   * the seat still exists.
   *
   * Only a **lost** connection is held, and only a seat in a **running live match**. A `Bye` is
   * the player saying they are done — see `LeaveCause` — and an arena seat is worth nothing to
   * hold: it
   * records no score (F7), carries no objective state and is handed out instantly to anybody who
   * asks, so a reservation for one would be a map entry protecting nothing. That is also what
   * bounds the registry — see `ReconnectRegistry`.
   */
  private onLeave(session: Session, reason: string, cause: LeaveCause): void {
    if (cause === 'lost') this.holdSeatForReturn(session);
    this.router.release(session.playerId);
    this.voteCycle.forget(session.playerId);
    session.player = null;
    log.info(`connection from ${session.link.remoteAddress} closed: ${reason}`);
  }

  private holdSeatForReturn(session: Session): void {
    const token = session.reconnectToken;
    const player = session.player;
    if (token === null || player === null) return;
    const instance = this.router.instanceOf(session.playerId);
    const live = this.liveMatch;
    if (instance === null || live === null || instance !== live) return;
    if (live.state !== InstanceState.RUNNING) return;
    this.reconnects.reserve(token, {
      playerId: session.playerId,
      displayName: session.displayName,
      matchId: live.id,
      entityId: player.entityId,
      team: player.team,
      loadout: session.loadout,
    });
  }

  // -- the tick ---------------------------------------------------------------

  private tick(tickIndex: number): void {
    /**
     * 1. Drain sockets. Commands land in input buffers before anything simulates.
     *
     * Wrapped **per session** (M11 playtest). S4.16 requires that *"malformed input must never
     * crash the server"*, and the decode paths honour that — `ByteReader` does not throw and
     * `decodeHeader` returns `bad` rather than raising. What was unguarded is the layer above:
     * the *handlers*. `onLoadout` runs `resolveLoadout` over a class a client chose, and a
     * throw there escaped the tick entirely, taking the rest of the drain, the whole
     * simulation step and the flow with it.
     *
     * Per session rather than around the loop, so one client's bad frame costs that client its
     * frame and nobody else theirs. The connection is dropped rather than left in an unknown
     * state — S4.16's answer to anything the server does not like is to close the link.
     */
    this.desk.receiveAll((s, err) => this.onReceiveFault(s, err));

    // 2. Step every RUNNING instance, each wrapped (§4.18).
    let total = 0;
    this.stepInstance(this.warmup, tickIndex);
    total += this.warmup.lastStepMs;

    const live = this.flow.instance;
    if (live !== null) {
      this.stepInstance(live, tickIndex);
      total += live.lastStepMs;
    }
    this.totalStepMs = total;
    this.meanTotalStepMs = this.meanTotalStepMs * 0.98 + total * 0.02;

    // 3. The flow: vote, allocate, wait for readiness, migrate, end, tear down.
    this.flow.stepFlowGuarded(tickIndex);

    // 4. Release whatever the per-link condition simulator has been holding.
    this.desk.flushOutbound();

    // 5. Reap. Done last so a connection that died this tick still had its commands applied.
    this.desk.checkTimeouts();
    this.reap();

    this.maybeLogMetrics();
  }

  /**
   * One client's frame threw inside a handler. Drop that connection and keep the tick.
   *
   * The connection is dropped rather than left in an unknown state — S4.16's answer to
   * anything the server does not like is to close the link.
   */
  private onReceiveFault(session: Session, err: unknown): void {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(
      `session ${session.playerId} (${session.displayName}) threw while receiving: ${message}`,
    );
    metric('server', 'receiveFault', { playerId: session.playerId, reason: String(err) });
    session.close('malformed message');
  }

  /**
   * Step one instance, and survive its exceptions (§4.18).
   *
   * *"An exception inside one instance must not take down the process. Each instance's step is
   * wrapped. A throwing `LiveMatch` is marked failed, its players are migrated back to warmup,
   * and it is destroyed. A throwing `WarmupMatch` is the one case that cannot be recovered by
   * migration — it must be rebuilt in place, and every connected player told."*
   *
   * The two recoveries are genuinely different and that is why the wrapping is here rather
   * than inside `MatchInstance.step`: the base class would have to guess which of its
   * subclasses it was.
   */
  private stepInstance(instance: MatchInstance, tickIndex: number): void {
    if (!instance.running) return;
    try {
      instance.step(tickIndex);
    } catch (err) {
      // The stack goes into the message rather than a second argument: `logger` takes one
      // string, so that a structured sink and a text sink cannot disagree about what a log
      // line contains. It is written to our log and never to a client (S4.16).
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      if (instance === this.warmup) {
        this.rebuildWarmup(tickIndex, message);
      } else if (instance === this.flow.instance) {
        this.flow.onLiveMatchThrew(tickIndex, message);
      }
    }
  }

  /**
   * The arena threw. Rebuild it in place and tell everybody (§4.18).
   *
   * There is nowhere to migrate to — the arena is the destination of last resort — so the only
   * options are to rebuild or to take the process down with every connected player on it. The
   * rebuild is not free: players lose their position and their streak, and are re-seated into a
   * fresh world. It is a bad outcome and it is much better than the alternative.
   */
  private rebuildWarmup(tickIndex: number, message: string): void {
    log.error(`the warmup arena threw: ${message}. Rebuilding it in place.`);

    const seated = [...this.warmup.sessions].map((seat) => seat.session);
    for (const session of seated) this.router.release(session.playerId);
    this.warmup.dispose();
    this.warmup = this.buildWarmup(tickIndex);

    for (const session of seated) {
      if (session.closed) continue;
      const player = this.warmup.seat(session, session.loadout);
      if (player === null) {
        session.close('arena rebuild could not seat this connection');
        continue;
      }
      session.player = player;
      this.router.admit(session, this.warmup);
      this.sendSeatTo(session, this.warmup, player.entityId, player.team, true);
      session.notice('The arena was rebuilt after a server fault.');
    }
    metric('server', 'warmupRebuilt', { tick: tickIndex, reason: message, reseated: seated.length });
  }

  /**
   * Take the connections that have closed out of everything that still names them.
   *
   * The desk drops the session object; what it is dropped *from* is this server's business —
   * the router's one-instance map and the ballot's tally.
   */
  private reap(): void {
    this.desk.reap((session) => {
      this.router.release(session.playerId);
      this.voteCycle.forget(session.playerId);
      session.player = null;
    });
  }

  /**
   * A line for **every connected player**, wherever they are seated.
   *
   * Distinct from `instance.broadcast`, which reaches one world. An aborted transition is
   * exactly the case where "one world" is the wrong set: the players are in the arena, the
   * instance that failed may not exist, and §4.17 requires all of them to be told.
   */
  private noticeAll(text: string): void {
    this.desk.noticeAll(text);
  }

  private sendSeatTo(
    session: Session,
    instance: MatchInstance,
    entityId: number,
    team: 'A' | 'B',
    migrated: boolean,
  ): void {
    session.sendSeat(
      seatInfo(instance, entityId, team, this.loop.currentTick, this.cfg.snapshotHz, migrated),
    );
  }

  private maybeLogMetrics(): void {
    if (this.cfg.metricsSeconds <= 0) return;
    const now = nowMs();
    if (now - this.lastMetricsMs < this.cfg.metricsSeconds * 1000) return;
    this.lastMetricsMs = now;

    const j = this.loop.jitter();
    metric('server', 'metrics', {
      tick: this.loop.currentTick,
      jitterP50: j.p50,
      jitterP99: j.p99,
      ticksLate: j.late,
      ticksDropped: j.dropped,
      hz: j.hz,
      sessions: this.desk.count,
      // §4.19: per-instance and total, separately. The total is what the event loop absorbs
      // and is the number that decides the real concurrency cap (§8.28).
      totalStepMs: round(this.totalStepMs),
      meanTotalStepMs: round(this.meanTotalStepMs),
      instances: this.instances.map((i) => {
        // Anti-wallhack phase 1: what deciding who sees whom cost over this window, and how much
        // of the enemy roster it kept off the wire.
        const relevance = i.takeRelevanceStats();
        return {
          id: i.id,
          state: i.state,
          players: i.playerCount,
          bots: i.botCount,
          stepMs: round(i.lastStepMs),
          meanStepMs: round(i.meanStepMs),
          relevanceMs: round(relevance.ms),
          dormantPct: relevance.dormantPct,
          // Phase 2: what cutting the event stream per seat cost over the same window.
          eventCutMs: round(relevance.eventCutMs),
        };
      }),
      vote: {
        cycle: this.voteCycle.cycle,
        phase: this.voteCycle.phase,
        endsTick: this.voteCycle.endsTick,
      },
      misroutedMessages: this.router.misroutedMessages,
    });
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function round(v: number): number {
  return Math.round(v * 100) / 100;
}
//#endregion
