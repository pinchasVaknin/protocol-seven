import { copyEntitySnapshot, EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import { isAlive, RelevanceTracker, teamOf, type RelevanceContext } from './Relevance';

/**
 * One seat's picture of the world: the entity list its snapshot is encoded from (anti-wallhack
 * phase 1; docs/VISIBILITY.md).
 *
 * The instance builds one list of every body per snapshot and used to hand that same list to
 * every seat. Now each seat gets its own: a body relevant to this viewer goes in as it is — the
 * shared record, not a copy — and every other body goes in **dormant** (D1): the record it had
 * the last time it was relevant to this viewer, frozen, with `EFlag.Dormant` set. Nothing in a
 * dormant record moves while it is dormant, so the delta encoder sends it once and then nothing.
 *
 * What stays live in a dormant record is what the game already makes public: whether the body is
 * alive (the alive strip counts it and the killfeed announces the change), that it died (its
 * death serial), its team, whether it is a bot, its name and its character. What freezes is
 * everything that says where it is or what it is doing — position, view, velocity, stance,
 * height, weapon, health, the hand, the respawn serial — and the transient flags (firing, ADS,
 * reloading, sprinting, throwing, melee, burning) are cleared. A body this seat has never been
 * told about has no frozen record and goes out from a blank one: at the origin, standing, empty.
 */
export class SeatView {
  readonly tracker = new RelevanceTracker();
  /** The list the encoder reads. Shared records for relevant bodies, this seat's for dormant ones. */
  readonly list: EntitySnapshot[] = [];
  count = 0;

  /**
   * Every body the last list sent awake, the seat's own included: what this seat's client has been
   * told the place of. The event stream asks it (`SeatEvents`), so an event never places a body the
   * snapshot did not.
   */
  readonly awake = new Set<number>();

  /** Enemy records in the last list, and how many of them went out dormant. For the metrics. */
  enemies = 0;
  dormantSent = 0;

  private readonly frozen = new Map<number, EntitySnapshot>();
  private readonly dormant = new Map<number, EntitySnapshot>();
  private readonly teammates: EntitySnapshot[] = [];
  private readonly present = new Set<number>();

  /**
   * Fill `list` for this snapshot.
   *
   * `seesAll` is R8 — a free cam on this seat. `hidden(id)` is `Unseen`: a body that is relevant
   * to nobody but itself. `spectating` is R7 — a dead viewer in a one-life mode, who sees what any
   * living teammate sees (P1).
   */
  build(
    nowMs: number,
    viewerId: number,
    entities: readonly EntitySnapshot[],
    entityCount: number,
    ctx: RelevanceContext,
    seesAll: boolean,
    spectating: boolean,
    hidden: (entityId: number) => boolean,
  ): void {
    let viewer: EntitySnapshot | null = null;
    this.present.clear();
    for (let i = 0; i < entityCount; i++) {
      const e = entities[i];
      if (e === undefined) continue;
      this.present.add(e.entityId);
      if (e.entityId === viewerId) viewer = e;
    }

    this.teammates.length = 0;
    if (spectating && viewer !== null) {
      const team = teamOf(viewer);
      for (let i = 0; i < entityCount; i++) {
        const e = entities[i];
        if (e === undefined || e.entityId === viewerId || !isAlive(e)) continue;
        if (!ctx.freeForAll && teamOf(e) === team) this.teammates.push(e);
      }
    }

    this.count = 0;
    this.enemies = 0;
    this.dormantSent = 0;
    this.awake.clear();
    for (let i = 0; i < entityCount; i++) {
      const e = entities[i];
      if (e === undefined) continue;
      if (e.entityId === viewerId) {
        this.put(e);
        this.awake.add(e.entityId);
        continue;
      }
      const enemy = viewer === null || ctx.freeForAll || teamOf(e) !== teamOf(viewer);
      if (enemy) this.enemies++;

      let relevant: boolean;
      if (seesAll) relevant = true;
      else if (hidden(e.entityId)) relevant = false;
      // A seat whose own body is not in the list has nothing to see from. Fail open rather than
      // blind: it is not a state a seat stays in, and a blank world is a broken game.
      else if (viewer === null) relevant = true;
      else if (spectating) relevant = this.tracker.relevantToAny(nowMs, ctx, this.teammates, e);
      else relevant = this.tracker.relevant(nowMs, ctx, viewer, e);

      if (relevant) {
        this.put(e);
        this.awake.add(e.entityId);
        let frozen = this.frozen.get(e.entityId);
        if (frozen === undefined) {
          frozen = makeEntitySnapshot();
          this.frozen.set(e.entityId, frozen);
        }
        copyEntitySnapshot(e, frozen);
        continue;
      }

      let rec = this.dormant.get(e.entityId);
      if (rec === undefined) {
        rec = makeEntitySnapshot();
        this.dormant.set(e.entityId, rec);
      }
      writeDormant(rec, this.frozen.get(e.entityId) ?? null, e);
      this.put(rec);
      if (enemy) this.dormantSent++;
    }

    // A body that has left: its id may be handed to somebody else, who must not inherit a linger,
    // a ray hint or a frozen record from it.
    if (this.frozen.size + this.dormant.size > 0) {
      for (const id of this.frozen.keys()) if (!this.present.has(id)) this.forget(id);
      for (const id of this.dormant.keys()) if (!this.present.has(id)) this.forget(id);
    }
  }

  /**
   * R9, the hurt-by rule (anti-wallhack phase 2, part 1): a body that has just hurt this seat is
   * relevant to it for the linger, seen or not.
   *
   * The client points its hit-direction chevron at the shooter's body, and a dormant body has no
   * place to point at — so with culling alone, a round through a wall or from a shooter whose eye
   * line was blocked hurt the player from nowhere. The chevron tells the player the bearing anyway;
   * this tells the client the body. Only bodies already in this seat's world: an id the seat has
   * never been sent is nothing to reveal.
   */
  reveal(entityId: number, nowMs: number): void {
    if (this.present.has(entityId)) this.tracker.reveal(entityId, nowMs);
  }

  private put(e: EntitySnapshot): void {
    this.list[this.count++] = e;
  }

  private forget(id: number): void {
    this.frozen.delete(id);
    this.dormant.delete(id);
    this.tracker.forget(id);
  }
}

/** The flags a dormant record carries from the live body: the public ones. */
const LIVE_FLAGS = EFlag.Alive | EFlag.TeamB | EFlag.Bot;

const BLANK = makeEntitySnapshot();

/**
 * A dormant record: the frozen one (or a blank one), with the public facts brought up to date.
 * Exported for the tests, which hold the line between what freezes and what stays live.
 */
export function writeDormant(out: EntitySnapshot, frozen: EntitySnapshot | null, live: EntitySnapshot): void {
  copyEntitySnapshot(frozen ?? BLANK, out);
  out.entityId = live.entityId;
  out.displayName = live.displayName;
  out.characterIndex = live.characterIndex;
  out.deathSerial = live.deathSerial;
  out.flags = (live.flags & LIVE_FLAGS) | EFlag.Dormant;
}
