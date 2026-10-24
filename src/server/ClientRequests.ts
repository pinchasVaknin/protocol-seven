/**
 * The five things a client may ask for, and what the server answers (B7).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import {
  CheatOutcome,
  describeCheatMask,
  parseCheatCode,
  toggleCheat,
} from '../shared/cheats/Cheats';
import { nowMs } from '../shared/core/Clock';
import { logger } from '../shared/core/Log';
import { sanitiseNetLoadout } from '../shared/net/Skirmish';
import { STREAK_DEFS } from '../shared/streaks/StreakDefs';
import type { ServerConfig } from './Config';
import { metric } from './log';
import type { MatchHandle } from './MatchAllocator';
import type { Session } from './net/Session';
import type { Router } from './Router';
import type { VoteCycle } from './instance/VoteCycle';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface ClientRequestDeps {
  readonly cfg: ServerConfig;
  readonly router: Router;
  readonly voteCycle: VoteCycle;
  /** The live match, or null. A handle rather than an instance: `onReady` names its id. */
  readonly liveHandle: () => MatchHandle | null;
  /** A vote changed, so the next tick's broadcast goes out early. See `Server.onVote`. */
  readonly noteVoteChanged: () => void;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const log = logger('server');
//#endregion

// ==================================== CLASS ClientRequests ==================================== \\
//#region Class ClientRequests
/**
 * Everything a seated client can ask of the server, and the §4.16 answer to each.
 *
 * The five are a group because they share one rule — *"the client is fully untrusted"* — and
 * none of them is about scheduling: a streak is spent, a cheat is typed, a class is sent, a
 * vote is cast, a background build reports ready. Each decides for itself, from this process's
 * own state, and none of them may take anything from the message that the server can answer
 * instead.
 *
 * Which instance a request lands in is **always** the router's answer and never the client's,
 * so a request from somebody in the arena cannot reach into the live match.
 */
export class ClientRequests {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly deps: ClientRequestDeps;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: ClientRequestDeps) {
    this.deps = deps;
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * A client asked to spend a streak (M11 Gate B, §8.22).
   *
   * A **request**, and every part of granting it is the server's. §4.16: *"The client is fully
   * untrusted."* So the three things that could be lied about are each answered here rather than
   * taken from the message:
   *
   * - **Which instance.** The router, never the client. A request from somebody in the arena
   *   cannot reach into the live match.
   * - **Whether they may buy it, and whether they can pay.** Two questions since round 4's B9,
   *   because a balance answers only the second. The class check is here: `pricesFor` is the
   *   list the server offered this seat, and a request for anything outside it is a client
   *   asking for a streak it never had a key for. Everything else is inside
   *   `StreakSystem.activate`, which debits through the one door that also refuses a streak
   *   still cooling down and one whose previous instance is still in the world — and it is the
   *   same door a bot would come through, which is what stops there being two economies.
   * - **Where it goes.** At the player's own body, from the *server's* copy of their position.
   *   The only coordinates taken from the client are the mortar's marked point, which is a
   *   genuine choice the player makes on the map overlay and is clamped to the map by
   *   `MortarStrike` itself.
   *
   * A refused request is logged at debug and otherwise silent. It is the ordinary consequence of
   * a double keypress arriving either side of a death, and answering it would mean a message
   * whose only reader is a HUD that the next `Streaks` frame corrects anyway.
   */
  onStreakRequest(session: Session, kind: number, x: number, z: number): void {
    const instance = this.deps.router.instanceOf(session.playerId);
    const player = session.player;
    if (instance === null || player === null) return;

    const def = STREAK_DEFS[kind];
    if (def === undefined) {
      // A kind index outside the table is malformed rather than merely wrong, and §4.16 puts
      // the response to malformed input at the boundary: count it, drop it, never throw.
      session.warn(`${session.displayName} asked for streak kind ${kind}, which does not exist.`);
      return;
    }

    const streaks = instance.match.streaks;
    if (!streaks.pricesFor(player.entityId).some((p) => p.id === def.id)) {
      session.warn(`${session.displayName} asked for ${def.id}, which is not in their class.`);
      return;
    }

    const sim = player.controller.sim;
    // The mortar is marked on the map overlay; everything else is placed where the caller
    // stands. `MortarStrike` clamps the mark to the playable area.
    const isMortar = def.id === 'mortar';
    const granted = streaks.activate(
      player.entityId,
      def.id,
      isMortar ? x : sim.x,
      isMortar ? 0 : sim.y,
      isMortar ? z : sim.z,
      sim.yaw,
    );
    if (granted === null) {
      // Cannot pay, still cooling, or their last one is still up. Which of the three is in the
      // economy report's refusal counters; here it is one line, because the next `Streaks`
      // frame tells the client the same thing more precisely than a reply could.
      log.debug(`${session.displayName} asked for ${def.id} and was refused.`);
      return;
    }
    log.info(`${session.displayName} called in ${def.id} in instance ${instance.id}.`);
  }

  /**
   * A client typed a cheat code (playtest round 4, F14).
   *
   * **The server decides, and always answers.** God mode, invisibility and free cam are facts
   * about the simulation, so a client that granted itself one would either be ignored or be
   * exploiting a hole; and thirty unearned kills is a purchase nobody made. So the code arrives
   * as text, is parsed against *this* process's copy of the table, and is honoured only if
   * `ServerConfig.cheatsEnabled` says so — which is off unless an operator set
   * `CHEATS_ENABLED=1`.
   *
   * Four things are worth reading in the order they happen:
   *
   * - **An unknown code is answered before the flag is consulted**, because it is a typo rather
   *   than an attempt at anything, and telling somebody "cheats are disabled" about a string
   *   that is not a code would send them looking for an operator they do not need.
   * - **The flag is checked before the seat**, so a server with cheats off gives one answer to
   *   everybody and never reveals whether the code would have worked.
   * - **`DEBUG666` never arrives here.** It is `CHEAT_LOCAL`, the client authors it, and if a
   *   crafted frame sends it anyway the toggle lands in a mask the simulation does not read.
   *   Written down rather than guarded, because the guard is the partition.
   * - **Every grant, revoke and refusal is logged with the resulting mask.** That is the second
   *   half of F14's *"make it visible"*: a bug report from a player who had god mode on is
   *   otherwise indistinguishable from one from a player who did not, and nobody can go back
   *   and ask.
   */
  onCheatRequest(session: Session, code: string): void {
    const entry = parseCheatCode(code);
    if (entry === null) {
      session.sendCheats(CheatOutcome.RefusedUnknown, session.cheats.mask);
      return;
    }
    if (!this.deps.cfg.cheatsEnabled) {
      session.warn(`${session.displayName} typed a cheat code and this server has cheats disabled.`);
      session.sendCheats(CheatOutcome.RefusedDisabled, session.cheats.mask);
      return;
    }

    const instance = this.deps.router.instanceOf(session.playerId);
    const player = session.player;
    if (instance === null || player === null) {
      session.sendCheats(CheatOutcome.RefusedNoSeat, session.cheats.mask);
      return;
    }

    if (entry.effect.kind === 'instant') {
      /**
       * `MO951357`, and it is the test P7 said it would be for P4's separation.
       *
       * It needs no compensating deduction anywhere, because the balance is **not** a read of
       * `PlayerScore.kills` — P4 built `credit` as a second door precisely so unearned kills can
       * buy streaks without appearing in the match results. `creditKills` is that door, and it
       * already applies the aliveness rule every other unearned credit does.
       *
       * **Nothing is latched.** F14 set a `Wallet` bit here so the payment would leave a trace on
       * screen, and that bit outlived its own subject: the ledger row it described is destroyed
       * by the next migration (`removePlayer` runs `StreakSystem.onOwnerRemoved`), so the tag
       * went on claiming an audit trail for a balance that no longer existed. An instant is
       * *announced* by the client for a display duration — see the kinds on `CheatEffect` in
       * `shared/cheats/Cheats.ts` — and the durable
       * record of it is this log line and `StreakEconomyReport.credited`, which is where a
       * transaction's record belongs.
       */
      instance.match.streaks.creditKills(player.entityId, entry.effect.kills);
      log.warn(
        `CHEAT: ${session.displayName} (player ${session.playerId}) took ` +
          `${entry.effect.kills} kills into their streak balance in instance ${instance.id}; ` +
          `entitlements unchanged at ${describeCheatMask(session.cheats.mask)}.`,
      );
      session.sendCheats(CheatOutcome.InstantApplied, session.cheats.mask);
      return;
    }

    if (entry.effect.kind !== 'toggle') {
      /**
       * A `'surface'` code reaching the server is a client that should never have sent it.
       *
       * `DEBUG666` is the only one, it grants no entitlement, and `Game.requestCheat` returns
       * before the send. So this is unreachable from the shipped client and is refused rather
       * than asserted: §4.16 answers a frame that makes no sense at the boundary, and the type
       * system knowing it cannot happen is not the same as the socket knowing.
       */
      session.warn(`${session.displayName} sent a client-side code to the server. Refused.`);
      session.sendCheats(CheatOutcome.RefusedUnknown, session.cheats.mask);
      return;
    }

    const before = session.cheats.mask;
    const after = toggleCheat(before, entry.effect.bits);
    session.cheats.set(after);
    const granted = (after & entry.effect.bits) !== 0;
    log.warn(
      `CHEAT: ${session.displayName} (player ${session.playerId}) ` +
        `${granted ? 'enabled' : 'cleared'} a cheat in instance ${instance.id}; ` +
        `mask now ${describeCheatMask(after)}.`,
    );
    session.sendCheats(granted ? CheatOutcome.Granted : CheatOutcome.Revoked, after);
  }

  /**
   * A class arrived (Tier 1 #20).
   *
   * Validated here and applied on the **next spawn** rather than to the standing body, per the
   * handover's rule 3: *"Applying a class change live to a standing networked world
   * reintroduced the same divergence by another door. Deferring to next spawn is CoD behaviour
   * anyway."* §6.6 says the same thing from the player's side.
   *
   * The stored value is what gets locked into the `MatchRequest` at migration, so a class sent
   * at any point during warmup is the class carried into the match.
   */
  onLoadout(session: Session, raw: Parameters<typeof sanitiseNetLoadout>[0]): void {
    const corrected: string[] = [];
    const clean = sanitiseNetLoadout(raw, corrected);
    if (clean === null) {
      // Never a disconnect: a class the server cannot read is a client one build ahead or
      // behind, and the M10 defaults are a working game.
      session.warn(`${session.displayName} sent an unusable loadout; keeping the previous one.`);
      return;
    }
    if (corrected.length > 0) session.noteCorrectedClass(corrected);
    session.loadout = clean;

    /**
     * Queue it on whichever instance holds this player, for their next spawn (§6.6).
     *
     * Two things happen and both matter. The session copy is what gets **locked into the
     * `MatchRequest` at migration** (§4.18) — that is Tier 1 #20's fix and it is why the class
     * lives on the connection rather than in a world. The instance copy is what takes effect
     * *now*, on the next respawn in the arena, so a player who edits their class sees it in
     * their hands before the match starts.
     *
     * A player with no instance is mid-migration; the session copy still lands, so the class
     * travels with them and applies on their first spawn in the destination.
     */
    const instance = this.deps.router.instanceOf(session.playerId);
    const player = session.player;
    const queued =
      instance !== null && player !== null
        ? instance.match.setPendingLoadout(player.entityId, clean)
        : false;
    /**
     * During the pre-match countdown it applies **now** rather than on the next spawn.
     *
     * That is what makes the quick class selector mean what it says — see
     * `ServerMatch.applyPendingLoadoutNow` for why the freeze is the one window where an
     * immediate change cannot cost a misprediction. Everywhere else this returns false and the
     * ordinary §6.6 deferral stands.
     */
    const immediate =
      queued && player !== null && instance !== null
        ? instance.match.applyPendingLoadoutNow(player.entityId)
        : false;

    log.info(
      `${session.displayName} set class "${clean.name}" — ` +
        `${clean.primary.weaponId}/${clean.secondary.weaponId}, ` +
        `perks [${clean.perks.filter((p) => p !== null).join(', ')}]. ` +
        (immediate
          ? 'Applied now (pre-match countdown).'
          : queued
            ? 'Applies on next spawn.'
            : 'Applies when they next exist in a world.'),
    );
  }

  /** A vote was cast. The cycle decides whether it counts; this only reports it. */
  onVote(session: Session, phase: number, option: number): void {
    const before = this.deps.voteCycle.voteOf(session.playerId);
    const accepted = this.deps.voteCycle.castVote(session.playerId, phase, option);
    if (!accepted) {
      // §8.6 requires a vote outside its window to be demonstrably rejected. Logged rather
      // than answered: the tally not moving is the client's feedback, and a reply would be a
      // message a hostile client could make the server send at will.
      session.warn(
        `${session.displayName} voted ${option} in phase ${phase}; ` +
          `the server is in phase ${this.deps.voteCycle.phase} — rejected.`,
      );
      return;
    }
    /**
     * Sent this tick, so the voter sees their own vote land rather than waiting up to a quarter
     * of a second for the next scheduled tally — but **once per tick, and only for a change**
     * (security audit S3).
     *
     * This used to broadcast from here, per vote, to every seat in the arena. A vote is legal to
     * repeat and to change, so one client sending the same vote in a loop made the server send
     * that many frames to every other player: an amplifier with a fan-out of the room. The
     * flag is drained by `broadcastVoteStatePeriodically` later in the same tick.
     */
    if (option !== before) this.deps.noteVoteChanged();
  }

  /** A client has finished building the map and is ready to be migrated into it (§6.5). */
  onReady(session: Session, matchId: number): void {
    const target = this.deps.liveHandle();
    if (target === null || target.id !== matchId) {
      this.deps.router.mayAddress(session, matchId);
      return;
    }
    target.instance.noteReady(session.playerId);
    const waited = session.prepareSentAtMs === 0 ? 0 : nowMs() - session.prepareSentAtMs;
    log.info(
      `${session.displayName} ready for match ${matchId} after ${Math.round(waited)}ms of background build.`,
    );
    metric('migration', 'ready', {
      playerId: session.playerId,
      name: session.displayName,
      matchId,
      buildMs: Math.round(waited),
    });
  }
  //#endregion
}
//#endregion
