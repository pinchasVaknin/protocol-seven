/**
 * The cycle a dedicated server runs between matches, as a state machine (B7).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { nowMs } from '../shared/core/Clock';
import { logger } from '../shared/core/Log';
import type { VoteInfo } from '../shared/net/Messages';
import {
  InstanceState,
  instanceStateName,
  MAP_BALLOT,
  MODE_BALLOT,
  WARMUP_MATCH_ID,
} from '../shared/net/Skirmish';
import type { ServerConfig } from './Config';
import type { LiveMatch } from './instance/LiveMatch';
import type { VoteCycle, VoteResolution } from './instance/VoteCycle';
import type { WarmupMatch } from './instance/WarmupMatch';
import { metric } from './log';
import {
  AllocationError,
  type IMatchAllocator,
  type MatchHandle,
  type PlayerSlot,
} from './MatchAllocator';
import type { Migration } from './Migration';
import type { ReconnectRegistry } from './net/ReconnectRegistry';
import type { Session } from './net/Session';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface SkirmishFlowDeps {
  readonly cfg: ServerConfig;
  readonly allocator: IMatchAllocator;
  readonly migration: Migration;
  readonly reconnects: ReconnectRegistry;
  readonly voteCycle: VoteCycle;
  /**
   * The arena, asked for rather than held.
   *
   * `Server.rebuildWarmup` replaces the instance when the room throws (§4.18), so a flow that
   * held the object would be holding a world that no longer exists — the same use-after-free
   * `bots.perception.occluder` is cleared for, one level down.
   */
  readonly arena: () => WarmupMatch;
  /** The master tick. The flow is stepped with it, and also reads it outside a step. */
  readonly currentTick: () => number;
  /** A line for every connected player, wherever they are seated. See `SessionDesk.noticeAll`. */
  readonly noticeAll: (text: string) => void;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const log = logger('server');

/** How often the vote state goes out. See `broadcastVoteStatePeriodically`. */
const VOTE_BROADCAST_HZ = 4;
//#endregion

// ===================================== CLASS SkirmishFlow ===================================== \\
//#region Class SkirmishFlow
/**
 * Vote, allocate, wait, migrate, play, end, go home — and recover when any of it fails.
 *
 * §4.9 caps the process at one live match, and this owns it: the handle, whether an allocation
 * is in flight, and the single `switch` over that instance's state which decides what the next
 * tick does with it. `Server` steps this once per tick — after the instances and before the
 * reap, for the reason its own tick comment gives — and asks it for the live match whenever a
 * connection needs seating.
 *
 * ## Why it is its own class (B7)
 *
 * It is the newest and most intricate code in the milestone — allocation continuations, the
 * readiness handshake, the named-tick migration, the summary hold and the teardown — and it sat
 * in the same class as the socket desk and the five request handlers, which share nothing with
 * it but a tick. Three of the bugs its own comments record are mistakes about *this* state
 * machine rather than about the process around it: a flow left with `this.live` set and no
 * instance able to reach `ENDED`, a cycle that cancelled itself the moment the arena emptied
 * *successfully*, and a match that kept simulating ten bots after its last human had left.
 *
 * ## Everything it can fail at leaves the players somewhere playable
 *
 * §4.17: *"never by dropping them, stranding them, or leaking a half-built instance."* Every
 * path out of every catch here puts the players in the arena with a message and resumes the
 * cycle into free play, because a server that has quietly stopped starting matches is a much
 * worse outcome than one cycle lost.
 */
export class SkirmishFlow {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly deps: SkirmishFlowDeps;

  private live: MatchHandle | null = null;
  /** True between asking the allocator and hearing back. Stops a second ask. */
  private allocating = false;

  private lastVoteBroadcastTick = -1;
  /** A vote changed since the last broadcast. See `noteVoteChanged`. */
  private voteChanged = false;
  /** Which map and mode the leak harness is on. See `allocateAndDestroy`. */
  private leakCycle = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: SkirmishFlowDeps) {
    this.deps = deps;
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** The live match's handle, or null: the allocator's receipt, which names its id. */
  get handle(): MatchHandle | null {
    return this.live;
  }

  /** The live match, or null. */
  get instance(): LiveMatch | null {
    return this.live?.instance ?? null;
  }

  /** A vote changed, so this tick's broadcast goes out early (security audit S3). */
  noteVoteChanged(): void {
    this.voteChanged = true;
  }

  /**
   * The live match threw, so it is finished (§4.18).
   *
   * Its players are migrated back to the arena and told, and the instance is destroyed. Which
   * instance threw is the caller's judgement, because the caller is what wrapped the step.
   */
  onLiveMatchThrew(tickIndex: number, message: string): void {
    const live = this.live;
    if (live === null) return;
    log.error(`live match ${live.instance.id} threw: ${message}`);
    live.instance.fail(message);
    this.returnEveryoneToWarmup(tickIndex, 'The match ended unexpectedly — back to the arena.');
    void this.destroyLive();
  }

  /** Release the live match, if there is one. Part of `Server.stop`. */
  async stop(): Promise<void> {
    if (this.live === null) return;
    await this.deps.allocator.destroy(this.live);
    this.live = null;
  }

  /**
   * The flow step, wrapped — and recovered from (M11 playtest).
   *
   * §4.18 requires each *instance's* step to be wrapped so one world cannot take down the
   * process. The **scheduler** around them was not, and it is the newest and most intricate
   * code in the milestone: allocation continuations, the readiness handshake, the named-tick
   * migration and teardown all run here.
   *
   * An exception escaping this used to reach `serve.ts`'s `uncaughtException` handler, which
   * logs it and keeps the process alive — leaving the flow in a half-built state with
   * `this.live` set and no instance able to reach `ENDED`. Every subsequent cycle then hit the
   * one-live-match cap and returned everybody to the arena. From the player's side that is a
   * server which votes, counts down, and then silently does nothing, for ever, which is what
   * the playtest reported.
   *
   * So it is caught here and **recovered**: the half-built match is destroyed, everybody is put
   * back in the arena and told, and the cycle resumes. A cycle lost is a bad outcome; a server
   * that has quietly stopped starting matches is a much worse one.
   */
  stepFlowGuarded(tickIndex: number): void {
    try {
      this.stepFlow(tickIndex);
    } catch (err) {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      log.error(`the skirmish flow threw: ${message}`);
      metric('server', 'flowFault', { tick: tickIndex, reason: String(err) });
      this.recoverFlow(tickIndex);
    }
  }

  /**
   * The map vote resolved. Ask the allocator, and handle all three ways it can refuse.
   *
   * §4.17: *"The vote cycle must handle all three by leaving every player in the warmup arena
   * with a message, never by dropping them, stranding them, or leaking a half-built instance."*
   * Every path out of the catch does exactly that, and the cycle resumes into free play so the
   * next ballot opens on schedule rather than the arena sitting in `ALLOCATING` forever.
   */
  async onVoteResolved(resolution: VoteResolution): Promise<void> {
    if (this.allocating || this.live !== null) {
      this.refuseVoteWhileMatchPresent();
      return;
    }

    this.allocating = true;
    const players = this.lockedSlots();
    const startedMs = nowMs();
    try {
      const handle = await this.deps.allocator.allocate({
        modeId: resolution.modeId,
        mapId: resolution.mapId,
        players,
        botFill: { count: 10, tier: this.deps.cfg.botDifficulty },
      });
      this.live = handle;
      const elapsed = nowMs() - startedMs;
      log.info(
        `match ${handle.id} allocated in ${elapsed.toFixed(1)}ms — ` +
          `${resolution.modeId} on ${resolution.mapId}.`,
      );
      metric('allocator', 'allocated', {
        matchId: handle.id,
        modeId: resolution.modeId,
        mapId: resolution.mapId,
        ms: Math.round(elapsed * 100) / 100,
        humans: players.length,
      });
      this.sendPrepareToArena(handle, resolution);
    } catch (err) {
      this.onAllocationFailed(err, resolution);
    } finally {
      this.allocating = false;
    }
  }

  /** Move every player in the live match back to the arena. Used by the end and by faults. */
  returnEveryoneToWarmup(tickIndex: number, notice: string): void {
    const live = this.live;
    if (live === null) return;
    for (const seat of [...live.instance.sessions]) {
      const ok = this.deps.migration.move(seat.session, this.arena(), tickIndex, this.deps.cfg.snapshotHz);
      if (ok && notice !== '') seat.session.notice(notice);
    }
  }

  async destroyLive(): Promise<void> {
    const handle = this.live;
    if (handle === null) return;
    this.live = null;
    /**
     * Anybody still seated here has to come out before the instance is disposed.
     *
     * The normal path has already migrated everybody, so this is a backstop for the fault
     * paths. Releasing through the router rather than calling `unseat` keeps the "exactly one
     * instance" map honest — a player released from a destroyed instance and never re-admitted
     * is the "never zero" failure, so they are put back in the arena.
     */
    for (const seat of [...handle.instance.sessions]) {
      this.deps.migration.move(seat.session, this.arena(), this.deps.currentTick(), this.deps.cfg.snapshotHz);
    }
    /**
     * The held seats go with the world they were in (round 4, F8).
     *
     * A reservation names a `matchId`, so one that outlives its instance can never be redeemed
     * — it would be a row nobody deletes, one per player per match, in a process §8.13 measures
     * over a hundred allocate/destroy cycles. Released here rather than swept on a timer,
     * because the instance ending is the exact moment the seat stops existing.
     */
    this.deps.reconnects.forgetMatch(handle.id);
    await this.deps.allocator.destroy(handle);
  }

  sendVoteStateTo(session: Session): void {
    const info: VoteInfo = {
      phase: this.deps.voteCycle.phase,
      phaseEndsTick: this.deps.voteCycle.endsTick,
      tally: this.deps.voteCycle.tally(),
      // Per-recipient: a player sees their own vote highlighted, and cannot see anybody
      // else's. The tally is the only aggregate that crosses the wire.
      selfVote: this.deps.voteCycle.voteOf(session.playerId),
      decidedMode: this.deps.voteCycle.decided.mode,
      decidedMap: this.deps.voteCycle.decided.map,
      humans: this.arena().playerCount,
    };
    session.sendVoteState(info);
  }

  /**
   * A client that connected while a build was already in flight.
   *
   * Without this they would sit in the arena with no `Prepare`, never report ready, and be
   * migrated by the timeout into a map they had not built — the slow-client path, entered for
   * no reason. Sent from `afterIdentity`, so it cannot overtake the seat assignment.
   */
  sendPrepareIfBuilding(session: Session): void {
    const live = this.live;
    if (live === null || live.instance.state !== InstanceState.READY_WAIT) return;
    session.prepareSentAtMs = nowMs();
    session.sendPrepare(live.id, live.instance.mapId, live.instance.modeId);
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
  async allocateAndDestroy(): Promise<void> {
    if (this.live !== null) await this.destroyLive();
    const modeId = MODE_BALLOT[this.leakCycle % MODE_BALLOT.length] ?? 'TDM';
    const mapId = MAP_BALLOT[this.leakCycle % MAP_BALLOT.length] ?? 'mp_foundry';
    this.leakCycle++;

    const handle = await this.deps.allocator.allocate({
      modeId,
      mapId,
      players: [],
      botFill: { count: 10, tier: this.deps.cfg.botDifficulty },
    });
    this.live = handle;
    // One step, so the instance builds its entity list and its bots take a tick — a teardown
    // that only ever released a never-stepped instance would miss anything allocated lazily on
    // the first step, which is most of the per-tick pools.
    handle.instance.begin(this.deps.currentTick());
    handle.instance.step(this.deps.currentTick());
    await this.destroyLive();
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private stepFlow(tickIndex: number): void {
    this.deps.voteCycle.step(tickIndex);
    this.broadcastVoteStatePeriodically(tickIndex);

    const live = this.live;
    if (live === null) return;
    const instance = live.instance;

    switch (instance.state) {
      case InstanceState.READY_WAIT:
        this.maybeStartLive(instance, tickIndex);
        return;
      case InstanceState.RUNNING:
        this.maybeAbandonLive(instance, tickIndex);
        return;
      case InstanceState.ENDED:
        this.finishLive(instance, tickIndex);
        return;
      default:
        return;
    }
  }

  /**
   * Everybody is ready, or the timeout fired: migrate and start (§4.18, §6.5, §6.7).
   *
   * The migration is the named-tick move for every player at once, and the match begins on the
   * same tick — so the first tick of the live match is a tick on which every migrated player
   * already exists in it with their loadout applied. That ordering is what makes §8.9's
   * *"misprediction count in the first 60 ticks after migration: expected zero"* achievable at
   * all.
   */
  private maybeStartLive(instance: LiveMatch, tickIndex: number): void {
    const expected = [...this.arena().sessions].map((seat) => seat.session.playerId);
    if (expected.length === 0) {
      /**
       * Everybody left between allocation and readiness.
       *
       * §4.20's rule again, one stage later: no match for zero humans. The instance was built,
       * so unlike the allocation-failure path there *is* something to release.
       */
      log.warn(`match ${instance.id}: nobody left in the arena to migrate. Destroying it.`);
      this.deps.noticeAll('The match was cancelled — nobody left to play it.');
      void this.destroyLive();
      this.deps.voteCycle.resume(tickIndex);
      return;
    }

    const { settled } = instance.readinessSettled(expected);
    if (!settled) return;

    instance.begin(tickIndex);
    let moved = 0;
    for (const seat of [...this.arena().sessions]) {
      if (this.deps.migration.move(seat.session, instance, tickIndex, this.deps.cfg.snapshotHz)) moved++;
    }
    log.info(`match ${instance.id} started on tick ${tickIndex} with ${moved} human(s) migrated.`);
  }

  /**
   * Every human left a running match: shut it down (§4.9, §4.20).
   *
   * §4.20 already refuses to *start* a match for zero humans, in two places — the vote cycle
   * cancels when the last human disconnects, and `maybeStartLive` destroys an instance nobody
   * is left to migrate into. Neither of them covers the case after `RUNNING`, and until now
   * nothing did: a match whose last player pulled their cable kept simulating ten bots to a
   * win condition, held the process's single live-match slot for the whole of it, and only
   * then released it. Every ballot that resolved in the meantime hit the one-match cap and
   * sent the arena back to free play with a notice — so one disconnect could cost the *next*
   * lobby its match.
   *
   * The bots are not asked whether they mind. There is nobody to watch them, no summary to
   * deliver — `finishLive` sends one to `instance.sessions`, which is empty — and no XP to
   * bank, so the ordinary end-of-match path would do nothing but wait.
   *
   * `abandoned` rather than `playerCount === 0` on purpose: see `LiveMatch.everSeated`.
   */
  private maybeAbandonLive(instance: LiveMatch, tickIndex: number): void {
    if (!instance.abandoned) return;
    log.info(
      `match ${instance.id}: every human has left a running match. ` +
        `Destroying it and freeing the slot (${instance.botCount} bot(s) discarded).`,
    );
    metric('allocator', 'abandoned', {
      matchId: instance.id,
      tick: tickIndex,
      bots: instance.botCount,
    });
    void this.destroyLive();
    this.deps.voteCycle.resume(tickIndex);
  }

  /**
   * The match is over: send the summary, hold it, then take everybody home (§6.9).
   *
   * The summary is built and sent **before** teardown, because the scoreboard it is built from
   * lives in the `ScoreSystem` that `dispose()` releases. Sent once, then held for
   * `summaryHoldSeconds` so the M6 XP bar has time to animate, then everybody migrates back
   * and the instance is destroyed.
   */
  private finishLive(instance: LiveMatch, tickIndex: number): void {
    if (!instance.summaryAlreadySent) {
      const summary = instance.buildSummary();
      // Per seat, not broadcast (M13 Phase B, bug 4.2): the rows are everybody's, the XP lines
      // are the recipient's own ledger with the win and the MVP decided for that entity.
      for (const seat of instance.sessions) seat.session.sendSummary(instance.buildSummaryFor(seat));
      /**
       * Start the arena's background build now, with the summary (playtest round 5, F13).
       *
       * F13 was the game reporting its own broken promise: `[join] no background build ready
       * for mp_testbed; building it now (expect a hitch)`. §6.5 says a map transition costs
       * nothing because the client built the map while still playing — and every client got
       * that for the trip *into* a live match and none of them got it for the trip back, because
       * `Prepare` was only ever sent when a match was **allocated**. The arena is permanent, so
       * nobody allocates it, so nobody prepared it. A missing case rather than a race.
       *
       * Here rather than at the migration for the reason the outbound one is sent at
       * allocation: the build has to start *before* the transition, not at it. The summary hold
       * is `summaryHoldSeconds` of a screen with nothing behind it — the best window in the
       * whole cycle to be building a map, and the one this was already spending idle.
       */
      for (const seat of instance.sessions) {
        seat.session.sendPrepare(WARMUP_MATCH_ID, this.arena().mapId, this.arena().modeId);
      }
      instance.markSummarySent();
      log.info(
        `match ${instance.id} over — ${summary.winner} ${summary.scoreA}-${summary.scoreB} ` +
          `(${summary.reason}). Holding the summary until tick ${summary.endsTick}, ` +
          `${this.deps.cfg.summaryHoldSeconds}s from now.`,
      );
    }
    if (!instance.summaryElapsed(tickIndex)) return;

    this.returnEveryoneToWarmup(tickIndex, '');
    void this.destroyLive();
    this.deps.voteCycle.resume(tickIndex);
  }

  /**
   * A vote resolved while a match already exists.
   *
   * §4.9 caps the process at one live match, so this is the cap doing its job — but it is
   * also the signature of a `LiveMatch` that never reached `ENDED` and was therefore never
   * destroyed, which would silently abort every cycle from then on. Logged loudly with the
   * offending instance's state so the second reading is distinguishable from the first.
   */
  private refuseVoteWhileMatchPresent(): void {
    const state = this.live === null ? 'allocating' : instanceStateName(this.live.instance.state);
    log.warn(
      `a vote resolved while a match was already present (state ${state}); ignoring it. ` +
        'If this repeats, a live match is stuck and is holding the only slot.',
    );
    this.deps.noticeAll('The previous match has not finished — staying in the arena.');
    this.deps.voteCycle.resume(this.deps.currentTick());
  }

  /** Everybody in the arena, with the class they are holding **now** (§4.18, §6.6). */
  private lockedSlots(): PlayerSlot[] {
    return [...this.arena().sessions].map((seat) => ({
      playerId: seat.session.playerId,
      displayName: seat.session.displayName,
      // Locked here: the class as it is at the moment of the request (§4.18, §6.6).
      loadout: seat.session.loadout,
    }));
  }

  /**
   * Start every client's background build now (§6.5).
   *
   * *"The client begins building meshes and procedural textures for the chosen map
   * immediately, in the background, while the player is still playing warmup."* This is
   * the message that starts it, and the readiness reports that answer it are what
   * `READY_WAIT` waits on.
   *
   * The count is logged because it is one half of §7's per-client readiness time, and because
   * "did the start-building message actually go out" is the first question when every client
   * hits the readiness timeout.
   */
  private sendPrepareToArena(handle: MatchHandle, resolution: VoteResolution): void {
    let prepared = 0;
    for (const seat of this.arena().sessions) {
      seat.session.readyForMatch = -1;
      seat.session.prepareSentAtMs = nowMs();
      seat.session.sendPrepare(handle.id, resolution.mapId, resolution.modeId);
      prepared++;
    }
    log.info(`sent Prepare for match ${handle.id} (${resolution.mapId}) to ${prepared} client(s).`);
  }

  /**
   * The allocator refused, in one of the three ways §4.17 names.
   *
   * Every path out leaves every player in the warmup arena with a message, never dropping
   * them, stranding them, or leaking a half-built instance — nothing was built, so there is
   * nothing to leak and nobody moved. The cycle resumes into free play so the next ballot
   * opens on schedule rather than the arena sitting in `ALLOCATING` for ever.
   */
  private onAllocationFailed(err: unknown, resolution: VoteResolution): void {
    const kind = err instanceof AllocationError ? err.kind : 'failure';
    const text =
      kind === 'capacity'
        ? 'The server is at capacity — staying in the arena.'
        : 'Could not start the match — staying in the arena.';
    log.warn(`allocation failed (${kind}): ${err instanceof Error ? err.message : String(err)}`);
    for (const seat of this.arena().sessions) seat.session.notice(text);
    metric('allocator', 'failed', { kind, modeId: resolution.modeId, mapId: resolution.mapId });
    this.deps.voteCycle.resume(this.deps.currentTick());
  }

  /**
   * Put the flow back to a state it can run from.
   *
   * Deliberately blunt: whatever the live match was doing, it is now unreachable. Everybody
   * goes back to the arena — the one world that always exists — the instance is released, and
   * the cycle starts again from free play. Each step is itself guarded, because a recovery that
   * throws is a recovery that leaves the process worse than it found it.
   */
  private recoverFlow(tickIndex: number): void {
    try {
      this.returnEveryoneToWarmup(tickIndex, '');
    } catch (err) {
      log.error(`flow recovery could not return every player to the arena: ${String(err)}`);
    }
    try {
      void this.destroyLive();
    } catch (err) {
      log.error(`flow recovery could not destroy the live match: ${String(err)}`);
    }
    this.live = null;
    this.allocating = false;
    this.deps.noticeAll('The match could not be started — back to the arena.');
    this.deps.voteCycle.resume(tickIndex);
  }

  /**
   * The vote state, at 4 Hz.
   *
   * Not every tick: the phase-end tick is the only field that changes continuously and the
   * client derives its countdown from it locally, so sending it sixty times a second would be
   * sixty copies of a number that has not changed. Four is enough for a tally to feel live.
   *
   * A rate rather than a change-detector because the tally is not the only reader — a client
   * that missed a broadcast during a loss burst gets the next one 250 ms later rather than
   * waiting for somebody to vote again.
   */
  private broadcastVoteStatePeriodically(tickIndex: number): void {
    const everyTicks = Math.round(60 / VOTE_BROADCAST_HZ);
    // A vote that changed this tick goes out now, and counts as the scheduled one.
    if (!this.voteChanged && tickIndex - this.lastVoteBroadcastTick < everyTicks) return;
    this.voteChanged = false;
    this.lastVoteBroadcastTick = tickIndex;
    this.broadcastVoteState();
  }

  private broadcastVoteState(): void {
    for (const seat of this.arena().sessions) this.sendVoteStateTo(seat.session);
  }

  private arena(): WarmupMatch {
    return this.deps.arena();
  }
  //#endregion
}
//#endregion
