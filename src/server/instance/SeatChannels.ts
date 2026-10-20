/**
 * The mode-state channels one instance sends on a snapshot tick (B5).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Cheat } from '../../shared/cheats/Cheats';
import {
  hashModeState,
  hashModeStateSections,
  makeModeStateScratch,
  modeStateFacts,
  type ModeStateFacts,
} from '../../shared/debug/ModeStateHash';
import type { BombInfo, MutableBombInfo } from '../../shared/modes/GameMode';
import {
  MAX_PROJECTILES,
  MAX_SMOKE,
  MAX_STREAK_ENTITIES,
  MAX_STREAK_OFFERS,
  MAX_UAV_CONTACTS,
  ownerCode,
  PEFlag,
  type ObjectiveState,
  type ProjectileState,
  type SmokeState,
  type StreakEntityState,
  type StreakOfferState,
  type UavContactState,
} from '../../shared/net/Skirmish';
import type { Uav } from '../../shared/streaks/Uav';
import type { ReplicatedScoreRow } from '../../shared/combat/ScoreSystem';
import { visibilityAuditTotals } from '../net/VisibilityAudit';
import type { ServerMatch } from '../Match';
import type { SeatRoster, SeatSlot } from './SeatRoster';
import { describeStreak, equipmentKindIndex, streakKindIndex } from './SnapshotRecords';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Ticks between two boards to one seat when the board keeps changing: four a second. */
const SCOREBOARD_MIN_TICKS = 15;

/** Ticks after which a seat is sent the board again regardless: two seconds. */
const SCOREBOARD_KEEPALIVE_TICKS = 120;
//#endregion

// ===================================== CLASS SeatChannels ===================================== \\
//#region Class SeatChannels
/**
 * Everything an instance replicates as **state** on a snapshot tick, other than the snapshot.
 *
 * §6.8: *"The instance owns every piece of mode state; clients render what they are told and
 * hold no authoritative timers."* That rule produced seven channels — objectives, the
 * scoreboard, dog tags, the bomb, killstreaks, grenades and smoke, and the §7 state hash — each
 * with its own scratch buffer, its own emptiness rule and, for three of them, its own per-seat
 * filter. Together they were well over a third of `MatchInstance`, and none of them is about
 * what that class is otherwise for: stepping a world and encoding snapshots of it.
 *
 * It owns no seats and no lifecycle. It is handed the match and the roster, it is called by
 * `MatchInstance.step` in the order the comment there explains, and the one thing it remembers
 * between ticks is whether the last tags and projectiles frames were empty.
 *
 * ## Nothing here allocates per tick
 *
 * Every channel fills a scratch array it owns and hands that same array to each seat (S4.7).
 * The sessions write the bytes synchronously, so one buffer serves every recipient — which is
 * also why none of these arrays may be held by a caller after the call.
 */
export class SeatChannels {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Reused per tick. Nothing in the per-tick send path allocates (S4.7). */
  private readonly objectiveScratch: ObjectiveState[] = [];
  private readonly streakScratch: StreakEntityState[] = [];
  private readonly contactScratch: UavContactState[] = [];
  private readonly offerScratch: StreakOfferState[] = [];
  private readonly projectileScratch: ProjectileState[] = [];
  private readonly smokeScratch: SmokeState[] = [];
  /** Reused per send. Nothing in the per-tick send path allocates (S4.7). */
  private readonly boardScratch: ReplicatedScoreRow[] = [];
  /** A carried bomb as a seat that does not see its carrier is sent it. See `sendBomb`. */
  private readonly bombScratch: MutableBombInfo = {
    state: 'CARRIED',
    carrierId: -1,
    attackers: 'A',
    x: 0,
    y: 0,
    z: 0,
    secondsLeft: 0,
    interactFraction: 0,
    interactEntity: -1,
    plantedSiteIndex: -1,
  };
  /** Scratch for the §7 hash. Nothing on the per-tick send path allocates (S4.7). */
  private readonly hashScratch = makeModeStateScratch();
  private readonly hashSections: number[] = [0, 0, 0, 0];
  /** Whether the last projectile frame was empty. See `sendProjectiles`. */
  private projectilesWereEmpty = false;
  /** Whether the last dog-tags frame was empty. See `sendTags`. */
  private tagsWereEmpty = false;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(
    private readonly match: ServerMatch,
    private readonly roster: SeatRoster,
  ) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Replicate the mode's objective zones (M11 Gate B, §6.8).
   *
   * Domination is the case that made this necessary: the server captured flags correctly all
   * along, and the client drew its own copy — permanently neutral, because a networked client's
   * `Domination` has an empty roster and counts nobody standing on anything. The flags worked
   * and were invisible.
   *
   * Skipped entirely for a mode with no objectives, which is TDM, FFA and the arena — three of
   * the five, and the ones that would otherwise pay a frame for a message of length zero.
   */
  sendObjectives(): void {
    const zones = this.match.mode.objectiveZones;
    if (zones.length === 0) return;

    this.objectiveScratch.length = 0;
    for (const zone of zones) {
      this.objectiveScratch.push({
        owner: ownerCode(zone.owner),
        capturing: ownerCode(zone.capturingTeam),
        // 0..1 to a byte. A flag takes several seconds to capture, so 1/255 is far finer than
        // the eye or the capture ring can show.
        progress: Math.max(0, Math.min(255, Math.round(zone.progress * 255))),
        countA: zone.countA,
        countB: zone.countB,
      });
    }

    for (const seat of this.roster.all()) {
      if (!seat.session.closed) seat.session.sendObjectives(this.objectiveScratch);
    }
  }

  /**
   * The scoreboard, as state (M13 Phase B, bug 4.3). See `MsgS.Scoreboard`.
   *
   * The rows are built once per send from the live rows and shared by every seat; the per-seat
   * part is only the decision, which is `isBoardDue`'s three rules and the fourth that
   * overrides them.
   */
  sendScoreboard(tickIndex: number, ending: boolean): void {
    const score = this.match.score;
    let built = false;
    for (const seat of this.roster.all()) {
      const { session, board } = seat;
      if (session.closed) continue;
      if (!isBoardDue(board, score.serial, tickIndex, ending)) continue;
      if (!built) {
        this.buildBoardRows();
        built = true;
      }
      session.sendScoreboard(score.serial, this.boardScratch);
      board.serial = score.serial;
      board.tick = tickIndex;
    }
  }

  /**
   * Replicate Kill Confirmed's dog tags (M11 Gate B, §6.8).
   *
   * Sent **including when the list is empty**, which is why the seam returns `null` for a mode
   * with no tags rather than an empty array: the transition from one tag to none is exactly as
   * much news as the transition from none to one, and a channel that only reported non-empty
   * lists would leave the last tag of every firefight lying on the client's floor for ever.
   *
   * Authoritative pickup is already the server's, and §6.8's *"two players reaching a tag on the
   * same tick resolves once, deterministically"* is a property of `KillConfirmed.onTick`: it
   * walks the roster in a fixed order, takes the first collector it finds and splices the tag
   * out in the same pass, so a second collector on the same tick finds nothing to collect. What
   * this adds is that the *client* no longer has an opinion — it runs no pickup test at all.
   */
  sendTags(): void {
    const tags = this.match.mode.dogTags;
    if (tags === null) return;
    const empty = tags.length === 0;
    if (empty && this.tagsWereEmpty) return;
    this.tagsWereEmpty = empty;
    for (const seat of this.roster.all()) {
      if (!seat.session.closed) seat.session.sendTags(tags);
    }
  }

  /**
   * Replicate Search & Destroy's bomb, per seat (M11 Gate B, §6.8; anti-wallhack phase 2, part 4).
   *
   * The fuse is the reason this is not optional. §6.8: *"a client-side timer will drift and will
   * decide a round wrongly."* On a networked client it does not drift — `onTick` never runs, so
   * it does not move at all.
   *
   * Carried, the bomb's place is its carrier's place, and it used to go to every seat every
   * snapshot — the attackers' bomb carrier on every defender's wire, through any wall. The client
   * draws no arrow to a carried bomb for exactly that reason (`MatchObjectives`), but the
   * coordinates arrived regardless. Now a seat that does not have the carrier awake is sent the
   * bomb where its own snapshot says the carrier is — the dormant record, frozen where it was last
   * seen, or the origin if it never was — and the client hides a bomb whose carrier it does not
   * see. On the floor or planted, the bomb is a public object and goes as it is.
   */
  sendBomb(): void {
    const info = this.match.mode.bombInfo;
    if (info === null) return;
    const carried = info.state === 'CARRIED' && info.carrierId >= 0;
    for (const seat of this.roster.all()) {
      const { session, view } = seat;
      if (session.closed) continue;
      const hide = carried && !view.awake.has(info.carrierId) && !session.cheats.has(Cheat.NoClip);
      const out: BombInfo = hide ? this.bombWhereTheSeatLastSaw(seat, info) : info;
      session.sendBomb(out);
      seat.audit?.observeBomb(out, info, view, visibilityAuditTotals);
    }
  }

  /**
   * Killstreaks, per recipient (M11 Gate B, §6.8, §8.22).
   *
   * The only message in the protocol built per seat rather than broadcast, because three of its
   * four parts are private and one of them is the whole value of a killstreak.
   *
   * ## The two filters, and why they are different
   *
   * **Bodies are common.** A sentry and a care package are physical objects that both teams can
   * see, walk into and shoot. The entity list is built once and every seat gets the same one.
   *
   * **Intel is not.** A UAV's contacts go only to the team whose UAV recorded them. Broadcasting
   * them and trusting the client to ignore the other team's would put a UAV's entire value in
   * the untrusted half of the system (§4.16) — and "trust the client to not look" is precisely
   * the shape of bug a wallhack is.
   *
   * **Ghost is inside the intel filter, not beside it.** `Uav.onTick` already declines to record
   * a contact for anyone whose `visibleToUav` is false, so a Ghost player never enters this list
   * in the first place. Note what is *not* happening: their entity stays in `buildEntities` and
   * their body is drawn normally. Ghost hides you from UAV intel; it does not make you invisible,
   * and an entity filter — the obvious reading of §8.22's *"absent from the snapshot"* — would
   * ship a different perk from the one M6 designed.
   */
  sendStreaks(): void {
    const streaks = this.match.streaks;
    this.fillStreakEntities();

    for (const seat of this.roster.all()) {
      const { session, player } = seat;
      if (session.closed) continue;

      this.fillStreakOffers(player.entityId);
      const next = streaks.nextFor(player.entityId);
      const uav = streaks.uavFor(player.team);
      this.fillUavContacts(uav);

      session.sendStreaks({
        offers: this.offerScratch,
        balance: streaks.balanceOf(player.entityId),
        nextKind: next === null ? -1 : streakKindIndex(next.def.id),
        nextPrice: next?.price ?? 0,
        scrambled: streaks.minimapScrambledFor(player.team),
        sweepAngle: uav === null ? -1 : uav.sweepAngle,
        contacts: this.contactScratch,
        entities: this.streakScratch,
      });
    }
  }

  /**
   * Grenades in flight and smoke on the ground (M11 Gate B, §6.8, §8.24).
   *
   * Broadcast, unlike the streak view: a grenade is a physical object with no secrets, so there
   * is one payload and everybody gets it. What differs per client is how it is *used* — your own
   * grenade is a correction to something you predicted, everybody else's is the only copy you
   * have — and that is a decision the client makes with the entity id it already knows is its
   * own.
   *
   * Skipped entirely when nothing is in the air and no smoke is burning, which is most ticks of
   * most matches. The alternative is a two-byte frame at 20 Hz per client forever, for a message
   * whose whole content is "still nothing".
   */
  sendProjectiles(): void {
    this.fillProjectiles();
    this.fillSmoke();

    /**
     * The empty case is a real state and is sent **once**, not never.
     *
     * A client told only about non-empty frames would keep drawing the last grenade of every
     * firefight for ever — the same trap the dog tags set, and avoided the same way. So the
     * frame is skipped only while the previous one was *also* empty.
     */
    const empty = this.projectileScratch.length === 0 && this.smokeScratch.length === 0;
    if (empty && this.projectilesWereEmpty) return;
    this.projectilesWereEmpty = empty;

    for (const seat of this.roster.all()) {
      if (!seat.session.closed) {
        seat.session.sendProjectiles(this.projectileScratch, this.smokeScratch);
      }
    }
  }

  /**
   * Hash this tick's mode state and send it (§7, §8.21).
   *
   * Built from the **same quantisation the wire uses**, not from the raw simulation values: the
   * server holds a capture progress of 0.4372 and the client holds 111/255, and hashing the raw
   * number would report a divergence on every objective in the game. That is a units bug
   * dressed as a finding, and it is the first thing a comparator like this gets wrong.
   */
  sendStateHash(tick: number): void {
    if (this.roster.size === 0) return;
    const facts = this.modeStateFacts();
    const hash = hashModeState(facts);
    // The parts too, so a client that disagrees can say in which channel (part 5).
    const sections = hashModeStateSections(facts, this.hashSections);
    for (const seat of this.roster.all()) {
      if (!seat.session.closed) seat.session.sendStateHash(tick, hash, sections);
    }
  }

  /**
   * A seat has just been granted, so the two "still nothing" latches no longer hold.
   *
   * A fresh seat has seen none of this instance's state, whatever the seats already here have
   * been told — and the empty tags and projectiles frames are state like any other.
   */
  onSeated(): void {
    this.projectilesWereEmpty = false;
    this.tagsWereEmpty = false;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** This send's rows, copied out of the live ones into the shared scratch. */
  private buildBoardRows(): void {
    this.boardScratch.length = 0;
    for (const row of this.match.score.rows) this.boardScratch.push(row);
  }

  /** The carried bomb placed where this seat's own snapshot last put its carrier. */
  private bombWhereTheSeatLastSaw(seat: SeatSlot, info: BombInfo): BombInfo {
    const known = seat.view.recordOf(info.carrierId);
    const hidden = this.bombScratch;
    Object.assign(hidden, info);
    hidden.x = known?.x ?? 0;
    hidden.y = known?.y ?? 0;
    hidden.z = known?.z ?? 0;
    return hidden;
  }

  /** The common half of the streak view: the bodies both teams can see. */
  private fillStreakEntities(): void {
    this.streakScratch.length = 0;
    for (const streak of this.match.streaks.active) {
      if (this.streakScratch.length >= MAX_STREAK_ENTITIES) break;
      this.streakScratch.push(describeStreak(streak));
    }
  }

  /**
   * The price list, not an inventory (round 4, B9 + B10 and the pivot).
   *
   * Built from `pricesFor`, which is the same accessor the ledger's own audit uses, so the
   * number on the player's HUD and the number they are charged cannot come apart. The lockout is
   * read per offer rather than sent as a second list, because a price and its availability are
   * one fact about one key and splitting them is how the two get out of step — and it is the
   * *server's* seconds, off the sim tick, because the client is not running the clock they are
   * measured on.
   */
  private fillStreakOffers(entityId: number): void {
    const streaks = this.match.streaks;
    this.offerScratch.length = 0;
    for (const priced of streaks.pricesFor(entityId)) {
      if (this.offerScratch.length >= MAX_STREAK_OFFERS) break;
      this.offerScratch.push({
        kind: streakKindIndex(priced.id),
        price: priced.price,
        lockoutCs: Math.round(streaks.lockoutSecondsFor(entityId, priced.id) * 100),
      });
    }
  }

  /** Only this player's team's UAV, and only the contacts it actually recorded. */
  private fillUavContacts(uav: Uav | null): void {
    this.contactScratch.length = 0;
    if (uav === null) return;
    for (const c of uav.contacts) {
      if (!c.active) continue;
      if (this.contactScratch.length >= MAX_UAV_CONTACTS) break;
      this.contactScratch.push({
        entityId: c.entityId,
        x: c.x,
        z: c.z,
        ageCs: Math.round(c.age * 100),
      });
    }
  }

  /** Every grenade in flight or resting, as the wire carries it. */
  private fillProjectiles(): void {
    const pool = this.match.equipment.projectiles;
    this.projectileScratch.length = 0;
    for (const p of pool.items) {
      if (!p.active) continue;
      if (this.projectileScratch.length >= MAX_PROJECTILES) break;
      this.projectileScratch.push({
        serial: p.serial,
        kind: equipmentKindIndex(p.def.id),
        ownerId: p.ownerId,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        flags:
          (p.resting ? PEFlag.Resting : 0) |
          (p.phase === 'ARMED' ? PEFlag.Armed : 0) |
          (p.stuckTo >= 0 ? PEFlag.Stuck : 0),
      });
    }
  }

  /** Every smoke volume still burning, with its remaining life in tenths. */
  private fillSmoke(): void {
    const field = this.match.equipment.smoke;
    this.smokeScratch.length = 0;
    for (const v of field.volumes) {
      if (!v.active) continue;
      if (this.smokeScratch.length >= MAX_SMOKE) break;
      this.smokeScratch.push({
        x: v.x,
        y: v.y,
        z: v.z,
        radius: v.radius,
        remainingDs: Math.round(v.remaining * 10),
      });
    }
  }

  /**
   * The authoritative mode state, flattened exactly as the channels above send it.
   *
   * The builder is `shared/debug/ModeStateHash` since round 5's B7, so the instance and the
   * browser cannot disagree about what "the state" is — two hand-kept transcriptions of one
   * quantisation rule are two rules that drift, and the browser had no copy at all.
   */
  private modeStateFacts(): ModeStateFacts {
    return modeStateFacts(this.match.mode, this.match.flow, this.hashScratch);
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Whether this seat is owed a board on this tick: three rules, and a fourth that overrides them.
 *
 *  - **Changed.** Sent when `ScoreSystem.serial` differs from the one this seat last received.
 *    A fresh seat starts at -1, so its first snapshot tick carries the whole board — which is
 *    the other half of 4.3, a returning client reading zeros for everybody.
 *  - **Rate-limited.** No sooner than `SCOREBOARD_MIN_TICKS` after the last send to that seat.
 *    Every trigger pull moves the serial, and a firefight would otherwise send a ~300-byte board
 *    twenty times a second.
 *  - **Resent anyway** every `SCOREBOARD_KEEPALIVE_TICKS`, changed or not. There is no ack on
 *    this channel; a frame lost under `--net bad` is corrected within two seconds instead of at
 *    the next change, which between fights may be a long way off.
 *
 * ## The rate limit does not apply to the last board of a match (BACKLOG #42)
 *
 * `ending` is the forced pass `step` makes on the tick the win condition fires — the one
 * `LiveMatch` is careful to order its move to `ENDED` *after*, so this channel gets its chance.
 * The rate limit used to overrule it: a seat whose previous board was less than
 * `SCOREBOARD_MIN_TICKS` (250 ms) old was skipped, and since the instance is `ENDED` from that
 * tick on there is no later pass to catch it. The client then held a board missing the last kill
 * for the whole summary hold.
 *
 * And the last kill is exactly the common case, because in a close match **it is the kill that
 * ends it**: the audit caught it as one run in five with two rows off on every client — the
 * killer's kills and the victim's deaths. So `ending` waives the rate limit. It does not waive
 * *changed*: a seat already holding the final serial is sent nothing.
 */
function isBoardDue(
  board: { readonly serial: number; readonly tick: number },
  serial: number,
  tickIndex: number,
  ending: boolean,
): boolean {
  const changed = board.serial !== serial;
  const since = tickIndex - board.tick;
  const due = board.tick < 0 || since >= SCOREBOARD_KEEPALIVE_TICKS;
  return due || (changed && (ending || since >= SCOREBOARD_MIN_TICKS));
}
//#endregion
