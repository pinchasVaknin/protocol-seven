// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Cheat } from '../../shared/cheats/Cheats';
import { nowMs } from '../../shared/core/Clock';
import { EV } from '../../shared/core/Events';
import { logger } from '../../shared/core/Log';
import {
  makeSnapshotHeader,
  phaseIndex,
  SFlag,
  type SnapshotHeader,
} from '../../shared/net/Messages';
import {
  InstanceState,
  type InstanceStateId,
  type MatchId,
} from '../../shared/net/Skirmish';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import type { LoadoutSlot } from '../../shared/meta/Loadouts';
import type { ReclaimedSeat, ServerMatch } from '../Match';
import type { NetPlayer } from '../NetPlayer';
import type { EventCollector } from '../net/EventCollector';
import type { RelevanceContext } from '../net/Relevance';
import type { SeatContext, SeatEvents } from '../net/SeatEvents';
import type { Session } from '../net/Session';
import { visibilityAuditEnabled, visibilityAuditTotals } from '../net/VisibilityAudit';
import { InstanceClock } from './InstanceClock';
import { SeatChannels } from './SeatChannels';
import { SeatRoster, type SeatSlot } from './SeatRoster';
import { writeBot, writePlayer } from './SnapshotRecords';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface MatchInstanceDeps {
  readonly id: MatchId;
  /** Position in the snapshot stagger (§4.19). The arena is 0; a live match is 1. */
  readonly instanceIndex: number;
  readonly match: ServerMatch;
  readonly snapshotHz: number;
  readonly interpolationDelayMs: number;
  readonly startTick: number;
}

/**
 * Why a seat is being released.
 *
 * `'migrated'` is a player who is still connected and is being seated elsewhere in the same
 * call; `'disconnected'` is a player who is gone. The bot-replacement rule in §6.7 applies to
 * exactly one of them.
 */
export type UnseatCause = 'disconnected' | 'migrated';

/** What the router needs to know about a seat without reaching into the simulation. */
export interface Seat {
  readonly session: Session;
  readonly player: NetPlayer;
}

/**
 * The relevance question's inputs, as one scratch record rather than a literal per seat.
 *
 * `RelevanceContext` is read-only because nothing downstream may change it, and this is the
 * same record with the locks off so one instance can serve every seat of every tick — the
 * pattern `Relevance.ts` already uses for its own per-pair struct, and for the same reason:
 * this is *"the one place in this file R7 actually bites"*. Derived from the real type so the
 * two cannot drift apart.
 */
type RelevanceScratch = { -readonly [K in keyof RelevanceContext]: RelevanceContext[K] };
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const log = logger('instance');
//#endregion

// ==================================== CLASS MatchInstance ===================================== \\
//#region Class MatchInstance
/**
 * One running world, and everything the process needs to talk to it (M11, §4.18).
 *
 * M10's `GameServer` was a match, a loop, a socket listener and a rotation policy in one
 * class. This is the match half, lifted out so that two of them can exist: the permanent
 * warmup arena and, when a vote resolves, one live match.
 *
 * ## What an instance owns, and what it does not
 *
 * **Owns**: a `ServerMatch` (the authoritative simulation), a `SeatRoster` of who is seated
 * here and the per-seat state that goes with them, a `SeatChannels` for the mode state they are
 * told about, a clock, and its own lifecycle state. All of this is per-instance and none of it
 * is shared — §4.19: *"A single shared mutable object between two matches is a correctness
 * failure that will present as an unreproducible desync."*
 *
 * **Does not own**: the loop, the sockets, the routing decision, or the map bake. It is
 * stepped by the master loop, it is handed sessions by `Migration`, and its world geometry is
 * baked once at boot and shared read-only.
 *
 * ## What is left here, after B5
 *
 * The three subjects that are genuinely this class's: **seating** a connection and taking it
 * out again, **stepping** the world in the order the channels depend on, and **the snapshot**
 * — the entity list, each seat's cut of it and the event stream that goes with it. The roster's
 * bookkeeping is `SeatRoster`, the seven state channels are `SeatChannels`, and turning a body
 * into wire records is `SnapshotRecords`.
 *
 * ## The step is wrapped by the caller, not here
 *
 * §4.18: *"An exception inside one instance must not take down the process."* The wrapping
 * lives in `Server.tick` rather than in `step()`, because the two subclasses need different
 * recoveries — a `LiveMatch` migrates its players out and is destroyed, a `WarmupMatch` must
 * be rebuilt in place because there is nowhere to migrate anyone *to*. A base class that
 * swallowed its own exceptions would have to guess which.
 */
export abstract class MatchInstance {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly id: MatchId;
  readonly match: ServerMatch;
  readonly clock: InstanceClock;

  /**
   * Is this the permanent warmup arena (playtest round 4, F7)?
   *
   * A property of the **instance kind**, declared by the two subclasses, rather than a
   * comparison against `WARMUP_MATCH_ID` performed wherever the answer is wanted. `WarmupMatch`
   * is the arena because of what it is, not because of the id it happens to hold — the id is
   * fixed at 0 only so a client can name the same instance on the wire.
   *
   * The room's rules already read it through `ServerMatch`'s `variant`; this is the same fact
   * at the level the *instance* is chosen, and it is what the harness asks rather than
   * re-deriving the arena by scanning ids.
   */
  abstract readonly isArena: boolean;

  /**
   * What this instance is running, for the clients that have to build it (round 5, F13).
   *
   * `LiveMatch` has carried both since M11 and `WarmupMatch` did not, which is why the arena
   * could not be named in a `Prepare` — the one message that starts a client's background build
   * takes a map id, and the only instance nobody could ask was the one everybody returns to. On
   * the base rather than tested for with `instanceof`, for the same reason `objectiveZones` is:
   * the caller wants to prepare *an instance*, not a kind of one.
   */
  abstract readonly mapId: string;
  abstract readonly modeId: string;

  protected state_: InstanceStateId = InstanceState.BOOTING;

  /** Who is seated here, and the encoder, view, event cut, audit and board state of each. */
  protected readonly roster = new SeatRoster();

  /** The mode state these seats are told about on a snapshot tick. */
  private readonly channels: SeatChannels;

  /** ms spent deciding relevance since the metrics last read it, and the enemy records it produced. */
  relevanceMs = 0;
  relevanceEnemies = 0;
  relevanceDormant = 0;
  /** ms spent cutting the event stream per seat since the metrics last read it (phase 2). */
  eventCutMs = 0;
  /** The R9 subscription on the match's bus. */
  private readonly offHurt: () => void;
  /** `Unseen`: a body relevant to, and heard by, nobody but itself. */
  private readonly unseen = (entityId: number): boolean =>
    this.seatByEntity(entityId)?.session.cheats.has(Cheat.Unseen) === true;
  /** Reused per seat per tick by `sendEvents`. Nothing on the send path allocates (S4.7). */
  private readonly seatContext: SeatContext = {
    viewerId: -1,
    entities: [],
    entityCount: 0,
    freeForAll: false,
    seesAll: false,
    spectating: false,
    hidden: () => false,
    awake: new Set<number>(),
  };
  /** Reused per seat per tick by `sendSnapshots`. See `RelevanceScratch`. */
  private readonly relevanceCtx: RelevanceScratch;

  private readonly header: SnapshotHeader = makeSnapshotHeader();
  private readonly entities: EntitySnapshot[] = [];
  private entityCount = 0;

  /** Milliseconds the last step took. Per-instance half of the §7 instance panel. */
  lastStepMs = 0;
  meanStepMs = 0;
  private stepSamples = 0;

  protected readonly deps: MatchInstanceDeps;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: MatchInstanceDeps) {
    this.deps = deps;
    this.id = deps.id;
    this.match = deps.match;
    this.clock = new InstanceClock(deps.startTick, deps.snapshotHz, deps.instanceIndex);
    this.channels = new SeatChannels(deps.match, this.roster);
    this.relevanceCtx = { world: deps.match.world, freeForAll: false, lookAheadSec: 0 };

    // Pooled per instance, per S4.7's "pool everything recurring". Sized for the largest
    // roster any mode fields plus headroom for backfill.
    for (let i = 0; i < 64; i++) this.entities.push(makeEntitySnapshot());

    // The match asks how stale each shooter's view is; the session knows, because it owns the
    // RTT estimate. The only wire between the simulation and the network layer, and it points
    // the right way — the sim asks a question, it is not told an answer.
    this.match.viewLagMsFor = (entityId) => {
      const seat = this.seatByEntity(entityId);
      if (seat === null) return 0;
      return seat.session.rttMs * 0.5 + deps.interpolationDelayMs;
    };

    // R9 (anti-wallhack phase 2, part 1): whoever hurts a seat is told to it for the linger, so the
    // client has a body to point the hit-direction chevron at. Not a sentry's round — `sourceId` is
    // then the owner, who may be anywhere, and revealing them would be a leak pointing the wrong way.
    this.offHurt = this.match.bus.on(EV.DamageDealt, (p) => {
      if (p.autonomous || p.sourceId === p.targetId) return;
      const seat = this.seatByEntity(p.targetId);
      if (seat === null) return;
      seat.audit?.noteHurt(seat.view, p.sourceId, visibilityAuditTotals);
      seat.view.reveal(p.sourceId, nowMs());
    });
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get state(): InstanceStateId {
    return this.state_;
  }

  /** Whether the master loop should step this instance on this tick. */
  get running(): boolean {
    return this.state_ === InstanceState.RUNNING;
  }

  get playerCount(): number {
    return this.roster.size;
  }

  get botCount(): number {
    return this.match.bots.bots.length;
  }

  /** Every seated session. Iterated by the vote cycle and by broadcast paths. */
  get sessions(): Iterable<Seat> {
    return this.roster.all();
  }

  hasPlayer(playerId: number): boolean {
    return this.roster.has(playerId);
  }

  seatOf(playerId: number): Seat | null {
    return this.roster.slotOf(playerId);
  }

  /**
   * Put a connection in this world.
   *
   * The loadout is resolved **here**, as the entity is created, which is what makes §6.6's
   * *"locked at the moment of migration, not at spawn time"* true rather than aspirational:
   * `ServerMatch.addPlayer` hands it straight to `NetPlayer`, whose constructor sets
   * `controller.speedScale` from the resolved perks. There is no window in which the player
   * exists and the perks have not been applied — which is precisely the window Tier 1 #20
   * lived in.
   *
   * `reclaim` is a returning player taking back the id and the side they left with (round 4,
   * F8). It changes nothing else about seating — the encoder is fresh, the acks are reset and
   * the next snapshot is a full one, all of which a reconnect needs anyway and all of which a
   * first join already got.
   *
   * `previousToken` is the reconnect token a returning player presented **after** the grace
   * (M13 Phase B): no seat to reclaim, but `LiveMatch` still knows whose row it opens. The
   * arena ignores it — it records no rows.
   */
  seat(
    session: Session,
    loadout: LoadoutSlot | null,
    reclaim?: ReclaimedSeat | null,
    _previousToken?: Uint8Array | null,
  ): NetPlayer | null {
    // The grants are the session's, so they follow this player across every migration and die
    // with the connection rather than with the seat (playtest round 4, F14).
    const player = this.match.addPlayer(
      session.displayName,
      session.cheats,
      session.characterIndex,
      loadout,
      reclaim,
    );
    if (player === null) return null;
    this.roster.add(session, player);
    // A new encoder has no baseline, so the next snapshot to this client is a full one. Reset
    // the acks with it, or the encoder would be asked to delta against a snapshot id that
    // belonged to the instance this player just left.
    session.restartSnapshotStream();
    this.channels.onSeated();
    return player;
  }

  /**
   * Take a connection out of this world, leaving nothing of it behind.
   *
   * `cause` matters and is not cosmetic. A player who **disconnected** has left a side a body
   * down and, in a live match, is replaced by a bot (§6.7). A player who **migrated** is still
   * playing, one instance over, and replacing them would grow the roster by one on every cycle.
   * Only the caller can tell the two apart, so only the caller says which.
   */
  unseat(playerId: number, cause: UnseatCause = 'disconnected'): void {
    const seat = this.roster.remove(playerId);
    if (seat === null) return;
    this.releaseEntity(seat.player.entityId, cause);
    /**
     * The cheat entitlements go with the seat, and F14 got this wrong (round 4, and the fix).
     *
     * They were held on the `Session` on the reasoning that a grant is a fact about the
     * connection — true of `loadout`, which is deliberately re-applied to the next seat, and
     * false of an entitlement, which is granted **against an entity in this instance**. The line
     * above has just destroyed that entity, its scoreboard row's streak ledger
     * (`removePlayer` runs `StreakSystem.onOwnerRemoved`) and its encoder; an entitlement that
     * outlived all three was an entitlement against nothing.
     *
     * Cleared for **both** causes rather than only for a migration. A disconnect takes the
     * session with it, so on that path this is a no-op that costs nothing and cannot rot — and
     * the alternative is a `cause` test whose two arms would have to be kept in step with a rule
     * that has no reason to distinguish them.
     */
    seat.session.cheats.clear();
  }

  /**
   * One authoritative step, plus this instance's share of the outbound traffic.
   *
   * Ordering matches M10's `GameServer.tick` and for the same reasons: simulate, then
   * snapshot (a snapshot describes the world *after* the tick), then events.
   */
  step(absoluteTick: number): void {
    const t0 = nowMs();
    this.clock.advance(absoluteTick);

    this.match.step(absoluteTick);

    /**
     * Force a snapshot on any tick that ends the stepping (handover Tier 2 §A).
     *
     * *"The sim runs at 60 Hz and snapshots go out at 20, so `shouldSnapshot` is true on one
     * tick in three. If the deciding tick is not a snapshot tick, the header carrying
     * `phase = MATCH_END` is never sent, and the client's `MatchFlow.applyReplicated` never
     * sees the transition that fires `EV.MatchEnded`."*
     *
     * Everything downstream of a match ending hangs off that event — the summary screen, the
     * announcer, the world teardown, `Game.pendingSummary` — and none of them fire. The
     * symptom reads as three separate bugs: the bots stop, the player keeps walking, no
     * summary appears, and the menu is unreachable because the client never left `MATCH`.
     * Measured at M11: 9 of 15 matches never replicated `MATCH_END`, against the 2-in-3 the
     * theory predicts; with the guard, 15 of 15.
     *
     * This did not bite at M10 because `GameServer.tick` kept ticking after `match.isOver`
     * (endHold, then rotate), so the phase always reached a snapshot tick within ~50 ms. It
     * bites here because this is exactly the flow the handover warned about: a match that ends
     * and stops stepping on the same tick.
     */
    const ending = this.state_ === InstanceState.RUNNING && this.match.isOver;
    if (this.clock.shouldSnapshot() || ending) {
      this.buildEntities();
      this.sendSnapshots(absoluteTick);
      // Objective state rides the snapshot cadence: it is world state, not an event, and a
      // client that had entities from tick N and flags from tick N-3 would draw a capture ring
      // around a body that is no longer standing in it.
      this.channels.sendObjectives();
      this.channels.sendTags();
      this.channels.sendBomb();
      this.channels.sendStreaks();
      this.channels.sendProjectiles();
      this.channels.sendScoreboard(absoluteTick, ending);
      /**
       * Last, deliberately (§7).
       *
       * Every channel above describes tick N. The hash says "this is what tick N looked like",
       * and a client can only answer it honestly once it has applied all of them. Sent earlier,
       * it would be compared against a client still holding tick N-1 and would report a
       * mismatch on every single sample.
       */
      this.channels.sendStateHash(absoluteTick);
    }
    this.sendEvents();

    this.lastStepMs = nowMs() - t0;
    this.stepSamples++;
    // Exponential mean rather than a running average: the number that matters is what the
    // instance costs *now*, and an average over an hour of uptime cannot show a regression.
    this.meanStepMs =
      this.stepSamples === 1 ? this.lastStepMs : this.meanStepMs * 0.98 + this.lastStepMs * 0.02;
  }

  /**
   * Relevance's cost and effect since the last call, for the metrics line (anti-wallhack phase 1):
   * ms spent deciding, and the share of enemy records that went out dormant.
   */
  takeRelevanceStats(): { readonly ms: number; readonly dormantPct: number; readonly eventCutMs: number } {
    const out = {
      ms: this.relevanceMs,
      dormantPct: this.relevanceEnemies === 0 ? 0 : Math.round((100 * this.relevanceDormant) / this.relevanceEnemies),
      eventCutMs: this.eventCutMs,
    };
    this.eventCutMs = 0;
    this.relevanceMs = 0;
    this.relevanceEnemies = 0;
    this.relevanceDormant = 0;
    return out;
  }

  /** Send one pre-encoded frame to everybody seated here. */
  broadcast(frame: Uint8Array): void {
    for (const seat of this.roster.all()) {
      if (!seat.session.closed) seat.session.send(frame);
    }
  }

  /**
   * Release everything (§4.18).
   *
   * *"A `LiveMatch` is now created and destroyed on every cycle, so any per-match leak
   * accumulates continuously in a long-lived process."* The list §4.18 gives is: every
   * `EventBus` subscription, every timer and pending promise, object pools, snapshot buffers,
   * hitbox history ring buffers, bot brains, path caches, and every reference held by the
   * router, the session layer and the allocator.
   *
   * Most of that is reached through `ServerMatch.dispose`, which unsubscribes the match's own
   * bus handlers and disposes the flow, the score system and the bot director. What is added
   * here is the network half: the roster — each seat holds an encoder with a full baseline
   * snapshot, and the seat map is how the *session layer* would otherwise keep a destroyed
   * instance alive through a `Seat` holding a `NetPlayer` — and the entity pool.
   *
   * Subclasses override to add their own, and must call `super.dispose()`.
   */
  dispose(): void {
    this.match.viewLagMsFor = null;
    this.offHurt();
    this.match.dispose();
    this.roster.clear();
    // The pool is per instance and would otherwise be 64 live objects per destroyed match.
    this.entities.length = 0;
    this.entityCount = 0;
    this.state_ = InstanceState.DESTROYED;
  }
  //#endregion

  // ==================================== PROTECTED METHODS ===================================== \\
  //#region Protected Methods
  /**
   * Drop the simulation entity behind a seat. Overridden by `LiveMatch` to leave a bot behind.
   *
   * Split out so the subclass can substitute the removal without having to repeat the encoder
   * and seat-map bookkeeping around it — which is the half that, if forgotten, keeps a
   * destroyed instance alive through a `Seat` holding a `NetPlayer`.
   */
  protected releaseEntity(entityId: number, _cause: UnseatCause): void {
    this.match.removePlayer(entityId);
  }

  protected setState(next: InstanceStateId, why: string): void {
    if (this.state_ === next) return;
    log.info(`instance ${this.id}: ${stateName(this.state_)} -> ${stateName(next)} (${why})`);
    this.state_ = next;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private seatByEntity(entityId: number): SeatSlot | null {
    return this.roster.slotByEntity(entityId);
  }

  /**
   * Flatten the roster into replicable records.
   *
   * Built once per snapshot tick and shared by every client in this instance. The content is
   * the same for everyone; only the delta baseline differs. Per-recipient filtering — Ghost —
   * is applied in `sendSnapshots` against this list rather than by building it N times, so an
   * instance where nobody runs Ghost pays nothing for the feature.
   */
  private buildEntities(): void {
    let n = 0;
    for (const player of this.match.players) {
      const e = this.entities[n];
      if (e === undefined) break;
      writePlayer(e, player);
      // Whether a body is alight is the burn system's, and it is the same answer for a human and
      // for a bot — so it is asked here, once per entity, rather than threaded into two writers
      // that have no reason to know what a flamethrower is.
      if (this.match.burn.isBurning(player.entityId)) e.flags |= EFlag.Burning;
      n++;
    }
    for (const bot of this.match.bots.bots) {
      const e = this.entities[n];
      if (e === undefined) break;
      writeBot(e, bot);
      if (this.match.burn.isBurning(bot.entityId)) e.flags |= EFlag.Burning;
      n++;
    }
    this.entityCount = n;
  }

  /** This tick's world, encoded per seat against that seat's own baseline. */
  private sendSnapshots(tickIndex: number): void {
    const now = nowMs();
    // P1: only a one-life mode has a spectator, and only a spectator needs its team's eyes.
    const oneLife = this.match.modeEntry.usesRoundReset === true;
    const snapshotMs = 1000 / this.deps.snapshotHz;
    const ctx = this.relevanceCtx;
    ctx.world = this.match.world;
    ctx.freeForAll = this.match.modeEntry.freeForAll === true;

    for (const seat of this.roster.all()) {
      const { session, player } = seat;
      if (session.closed) continue;

      /**
       * How far behind the truth this client draws the world — half its round trip, the
       * interpolation delay and one snapshot interval — so a body that will round a corner
       * inside that window is sent before it does (anti-wallhack phase 1, docs/VISIBILITY.md).
       */
      const drawDelayMs = session.rttMs * 0.5 + this.deps.interpolationDelayMs;
      ctx.lookAheadSec = (drawDelayMs + snapshotMs) / 1000;
      this.buildSeatView(seat, now, drawDelayMs, oneLife);
      this.fillSnapshotHeader(tickIndex, player);

      const frame = seat.encoder.encode(
        this.header,
        session.ackedSnapshot,
        // This client's own authoritative sim state, at full precision. It is compared
        // against a prediction rather than drawn, and quantisation error in a comparison is
        // indistinguishable from a misprediction.
        player.simState,
        seat.view.list,
        seat.view.count,
        // F14: replicated as state, once per snapshot, so no dropped frame can leave the two
        // sides disagreeing about whether a wall stops this player. See `writeSnapshotOwner`.
        session.cheats.mask,
      );
      if (frame.length === 0) continue;
      // Through the session rather than onto the field: it stamps the id with the time,
      // which is what turns this client's next ack into a round-trip measurement.
      session.noteSnapshotSent(this.header.snapshotId);
      session.send(frame);
    }
  }

  /**
   * Who this seat is told about, and what deciding that cost (anti-wallhack phase 1).
   *
   * The cost is measured around `build` alone rather than around the whole seat, because the
   * number the §7 panel reports is the price of *relevance* and the encode beside it is not
   * part of that question.
   */
  private buildSeatView(seat: SeatSlot, now: number, drawDelayMs: number, oneLife: boolean): void {
    const { session, player, view } = seat;
    const ctx = this.relevanceCtx;
    const t0 = nowMs();
    view.build(
      now,
      player.entityId,
      this.entities,
      this.entityCount,
      ctx,
      session.cheats.has(Cheat.NoClip),
      oneLife && !player.alive,
      this.unseen,
    );
    const spent = nowMs() - t0;
    this.relevanceMs += spent;
    this.relevanceEnemies += view.enemies;
    this.relevanceDormant += view.dormantSent;
    if (visibilityAuditEnabled()) {
      visibilityAuditTotals.seatSnapshots++;
      visibilityAuditTotals.relevanceMs += spent;
      visibilityAuditTotals.enemyRecords += view.enemies;
      visibilityAuditTotals.dormantRecords += view.dormantSent;
    }
    seat.audit?.observe(
      now,
      view,
      player.entityId,
      this.entities,
      this.entityCount,
      ctx,
      drawDelayMs,
      visibilityAuditTotals,
    );
  }

  /** The match clock, the scores and this seat's acks, into the one header every frame carries. */
  private fillSnapshotHeader(tickIndex: number, player: NetPlayer): void {
    const flow = this.match.flow;
    const h = this.header;
    h.serverTick = tickIndex;
    h.ackSeq = player.ackSeq;
    h.ackTick = player.ackTick;
    h.scoreA = this.match.mode.teamScore('A');
    h.scoreB = this.match.mode.teamScore('B');
    h.timeLeft = Math.round(flow.secondsRemaining);
    h.flags =
      (this.match.inputFrozen ? SFlag.InputFrozen : 0) | (flow.isOver ? SFlag.MatchOver : 0);
    h.starvation = player.input.takeStarvation();
    h.phase = phaseIndex(flow.currentPhase);
    h.phaseSeconds = flow.phaseSecondsRemaining;
    h.round = flow.round;
  }

  /**
   * The tick's events, each seat its own cut (anti-wallhack phase 2, `SeatEvents`): the shared frame
   * when the seat may have all of it, a frame of its own when not, nothing when nothing is left.
   */
  private sendEvents(): void {
    const events = this.match.outgoing;
    const frame = events.finish();
    if (frame === null) return;
    const oneLife = this.match.modeEntry.usesRoundReset === true;
    const ctx = this.seatContext;
    ctx.entities = this.entities;
    ctx.entityCount = this.entityCount;
    ctx.freeForAll = this.match.modeEntry.freeForAll === true;
    ctx.hidden = this.unseen;
    for (const seat of this.roster.all()) {
      const { session, player, events: cut, view } = seat;
      if (session.closed) continue;
      ctx.viewerId = player.entityId;
      ctx.seesAll = session.cheats.has(Cheat.NoClip);
      ctx.spectating = oneLife && !player.alive;
      ctx.awake = view.awake;
      const t0 = nowMs();
      cut.select(events, ctx);
      const sent = frameForSeat(cut, events, frame);
      const spent = nowMs() - t0;
      this.eventCutMs += spent;
      if (sent !== null) session.send(sent);
      if (visibilityAuditEnabled()) {
        visibilityAuditTotals.eventSeatTicks++;
        visibilityAuditTotals.eventCutMs += spent;
        visibilityAuditTotals.eventBytesWhole += frame.length;
        visibilityAuditTotals.eventBytesSent += sent?.length ?? 0;
      }
      seat.audit?.observeEvents(sent, events, view, ctx, visibilityAuditTotals);
    }
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * One seat's event frame: the shared one, its own, or none at all.
 *
 * The shared frame is handed back **by reference** when this seat keeps everything the tick
 * produced and varies nothing, which is the common case and the whole reason the cut exists: a
 * seat that may have all of it costs no encoding at all.
 */
function frameForSeat(cut: SeatEvents, events: EventCollector, whole: Uint8Array): Uint8Array | null {
  if (cut.kept === events.pending && cut.varied === 0) return whole;
  if (cut.kept === 0) return null;
  return events.frameFor(cut.keep, cut.writer);
}

function stateName(state: InstanceStateId): string {
  for (const [name, value] of Object.entries(InstanceState)) {
    if (value === state) return name;
  }
  return String(state);
}
//#endregion
