/**
 * The seats of one instance, and the per-seat state that lives exactly as long as a seat (B5).
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { NetPlayer } from '../NetPlayer';
import type { Session } from '../net/Session';
import { SeatEvents } from '../net/SeatEvents';
import { SeatView } from '../net/SeatView';
import { SeatAudit, visibilityAuditEnabled } from '../net/VisibilityAudit';
import { SnapshotEncoder } from '../net/SnapshotEncoder';
import type { Seat } from './MatchInstance';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** The board serial this seat last received, and the tick it went out. See `sendScoreboard`. */
export interface SeatBoard {
  serial: number;
  tick: number;
}

/**
 * One seat, with everything the send path needs for it.
 *
 * It extends the `Seat` the router reads, so a slot *is* a seat: `seatOf` and `sessions` hand
 * these out and nothing outside this directory can tell the difference. What the extra members
 * buy is that the five pieces of per-seat state are **one object with one lifetime** rather
 * than five map entries that have to be created and deleted in step with each other.
 */
export interface SeatSlot extends Seat {
  /** This client's delta baseline. Holds a full snapshot, which is why it dies with the seat. */
  readonly encoder: SnapshotEncoder;
  /** Who this seat is told about (anti-wallhack phase 1). */
  readonly view: SeatView;
  /** This seat's cut of the event stream (anti-wallhack phase 2). */
  readonly events: SeatEvents;
  /** Phase 1's own proof, when a harness turns it on (`enableVisibilityAudit`). */
  readonly audit: SeatAudit | null;
  readonly board: SeatBoard;
}
//#endregion

// ====================================== CLASS SeatRoster ====================================== \\
//#region Class SeatRoster
/**
 * Who is seated in one instance, by connection and by entity.
 *
 * ## Why this is a class and not five maps
 *
 * It was five maps, plus the seat map itself and the board state: seven structures keyed two
 * different ways, written together by `seat` and deleted together by `unseat`. The hazard is
 * named in `MatchInstance.releaseEntity`'s own comment — *"the half that, if forgotten, keeps a
 * destroyed instance alive through a `Seat` holding a `NetPlayer`"* — and nothing but care kept
 * the seven in step. Here a seat is created once and dropped once, and the invariant is
 * structural rather than remembered.
 *
 * Both keys are kept, for the reason they were both there: the router and the vote cycle know a
 * `playerId`, while visibility, lag compensation and the hurt reveal know an `entityId` and run
 * per tick, so neither lookup may become a scan.
 *
 * It holds no policy. Nothing here decides when to send, what a seat may see, or whether a
 * match is over — a reader looking for any of that goes to `MatchInstance` or `SeatChannels`.
 */
export class SeatRoster {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Seats keyed by the stable connection id. */
  private readonly byPlayer = new Map<number, SeatSlot>();
  /** The same seats keyed by simulation entityId, for the visibility and lag hot paths. */
  private readonly byEntity = new Map<number, SeatSlot>();
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get size(): number {
    return this.byPlayer.size;
  }

  /**
   * Open a seat for a connection that has just been given a body.
   *
   * Everything here starts empty on purpose. A new view has no memory, so this seat begins
   * told about nobody it cannot see; a new encoder has no baseline, so the next snapshot to
   * this client is a full one; and the board starts at serial -1, so the next send is the whole
   * set whatever the serial — which is the half of M13's bug 4.3 where a returning client read
   * zeros for everybody.
   */
  add(session: Session, player: NetPlayer): SeatSlot {
    const slot: SeatSlot = {
      session,
      player,
      encoder: new SnapshotEncoder(),
      view: new SeatView(),
      events: new SeatEvents(),
      audit: visibilityAuditEnabled() ? new SeatAudit() : null,
      board: { serial: -1, tick: -1 },
    };
    this.byPlayer.set(session.playerId, slot);
    this.byEntity.set(player.entityId, slot);
    return slot;
  }

  /** Close a seat, under both keys. Answers the slot that is gone, or null if there was none. */
  remove(playerId: number): SeatSlot | null {
    const slot = this.byPlayer.get(playerId);
    if (slot === undefined) return null;
    this.byPlayer.delete(playerId);
    this.byEntity.delete(slot.player.entityId);
    return slot;
  }

  slotOf(playerId: number): SeatSlot | null {
    return this.byPlayer.get(playerId) ?? null;
  }

  slotByEntity(entityId: number): SeatSlot | null {
    return this.byEntity.get(entityId) ?? null;
  }

  has(playerId: number): boolean {
    return this.byPlayer.has(playerId);
  }

  /**
   * Every seat, in the order they were seated.
   *
   * Insertion order and not a copy: the send paths iterate this once per tick and a sorted or
   * copied list would allocate per tick for no gain, while the order itself is what makes two
   * runs of the same seed send in the same sequence.
   */
  all(): IterableIterator<SeatSlot> {
    return this.byPlayer.values();
  }

  /** Forget every seat. Part of `dispose`: a held seat holds a `NetPlayer` and so a whole world. */
  clear(): void {
    this.byPlayer.clear();
    this.byEntity.clear();
  }
  //#endregion
}
//#endregion
