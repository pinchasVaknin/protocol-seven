import { Ev } from '../../shared/net/Messages';
import { MAX_SERVER_FRAME_BYTES } from '../../shared/net/Protocol';
import type { EntitySnapshot } from '../../shared/net/Snapshot';
import { ByteWriter } from '../../shared/net/Wire';
import { MAX_TICK_EVENTS, type EventCollector } from './EventCollector';
import { isAlive, teamOf } from './Relevance';

/**
 * Which of a tick's events one seat is sent, and in which form (anti-wallhack phase 2, parts 2 and
 * 3; docs/VISIBILITY.md).
 *
 * Every client used to be sent every event, and four kinds carry a position: a modified client had
 * a radar of everything that moved or shot, through any wall. The rule now is that an event never
 * places a body the seat's own snapshot does not — or one the game makes public anyway.
 *
 * **Sounds** — a footstep, a jump, a landing — go:
 * - never to their own body: the client plays its own from its own prediction (`NetSession`);
 * - always to a teammate — nothing about a teammate is secret from its side (R1);
 * - to an enemy only within `HEARING_RADIUS_M` of where the seat listens (E2), and never a crouched
 *   or sliding step or one with Dead Silence (D4).
 * Hearing makes nobody relevant (E1): each sound carries its own position, and the client places it
 * from that, not from the body.
 *
 * **A shot** goes as it is when the seat has the shooter awake, or fired it, or when it pings the
 * minimap — the game shows everyone where an unsuppressed rifle is. A suppressed shot from a body
 * the seat does not have goes as its bare impact, `Ev.Impact` (D2): the spark and the decal where
 * the round landed, nothing about where it came from.
 *
 * **A hit** goes to its target and its source, and to anybody else only if they have the *target*
 * awake: the hit is placed on the target, so that is the body it would give away.
 *
 * **A kill** goes to everybody — the feed is public — with the killer's health zeroed for all but
 * the victim (E3).
 *
 * An `Unseen` body is heard by nobody, and its suppressed shots are bare impacts to everybody; a
 * free cam (R8) is sent everything as it is.
 */

/**
 * How far an enemy's step, jump or landing carries: S6.3's footstep radius, which is also the bots'
 * (`DifficultyTiers.footstepHearing`). Measured on the ground plane, as the bots measure it.
 */
export const HEARING_RADIUS_M = 12;

/** A footstep, a jump or a landing: the events hearing decides. */
export function isSound(kind: number): boolean {
  return kind === Ev.Footstep || kind === Ev.Jump || kind === Ev.Land;
}

/** `keep` values: not sent, sent as encoded, sent as its variant. */
export const Form = { None: 0, Whole: 1, Variant: 2 } as const;

/** One seat, as the cut needs it. The instance fills one per seat per tick and reuses it. */
export interface SeatContext {
  viewerId: number;
  /** The last snapshot's roster: where every body was at most a snapshot ago. */
  entities: readonly EntitySnapshot[];
  entityCount: number;
  freeForAll: boolean;
  /** R8: a free cam is sent everything, as it is. */
  seesAll: boolean;
  /** R7: a dead viewer in a one-life mode listens from every living teammate. */
  spectating: boolean;
  /** `Unseen`. */
  hidden: (entityId: number) => boolean;
  /** The bodies this seat's last snapshot sent awake (`SeatView.awake`). */
  awake: ReadonlySet<number>;
}

/** One seat's cut of each tick's events. */
export class SeatEvents {
  /** The form each event of the tick is sent in (`Form`), after `select`. */
  readonly keep = new Uint8Array(MAX_TICK_EVENTS);
  /** This seat's own frame, when it is not sent the shared one. Never shared: see `frameFor`. */
  readonly writer = new ByteWriter(MAX_SERVER_FRAME_BYTES);
  /** After `select`: events sent at all, and how many of those as their variant. */
  kept = 0;
  varied = 0;
  /** Where this seat listens from this tick. */
  private readonly ears: EntitySnapshot[] = [];

  /** Decide the form of each of `events` for this seat. */
  select(events: EventCollector, seat: SeatContext): void {
    const viewer = find(seat.entities, seat.entityCount, seat.viewerId);
    this.ears.length = 0;
    if (viewer !== null) {
      if (!seat.spectating) this.ears.push(viewer);
      else {
        const team = teamOf(viewer);
        for (let i = 0; i < seat.entityCount; i++) {
          const e = seat.entities[i];
          if (e === undefined || e.entityId === seat.viewerId || !isAlive(e)) continue;
          if (!seat.freeForAll && teamOf(e) === team) this.ears.push(e);
        }
      }
    }

    this.kept = 0;
    this.varied = 0;
    for (let i = 0; i < events.pending; i++) {
      const form = this.formOf(events, i, viewer, seat);
      this.keep[i] = form;
      if (form !== Form.None) this.kept++;
      if (form === Form.Variant) this.varied++;
    }
  }

  private formOf(events: EventCollector, i: number, viewer: EntitySnapshot | null, seat: SeatContext): number {
    const kind = events.kinds[i] ?? 0;
    const subject = events.subjects[i] ?? -1;
    const object = events.objects[i] ?? -1;
    const variant = events.hasVariant[i] === 1 ? Form.Variant : Form.None;

    if (isSound(kind)) {
      if (subject === seat.viewerId) return Form.None;
      if (seat.seesAll) return Form.Whole;
      // A seat whose body is not in the roster yet has nowhere to listen from. Fail open, as
      // `SeatView` does: it is not a state a seat stays in.
      if (viewer === null) return Form.Whole;
      if (seat.hidden(subject)) return Form.None;
      const body = find(seat.entities, seat.entityCount, subject);
      if (body !== null && !seat.freeForAll && teamOf(body) === teamOf(viewer)) return Form.Whole;
      if (events.muted[i] === 1) return Form.None;
      const x = events.xs[i] ?? 0;
      const z = events.zs[i] ?? 0;
      for (const ear of this.ears) {
        if (Math.hypot(ear.x - x, ear.z - z) <= HEARING_RADIUS_M) return Form.Whole;
      }
      return Form.None;
    }

    switch (kind) {
      case Ev.Fired:
        if (subject === seat.viewerId || seat.seesAll || viewer === null) return Form.Whole;
        if (seat.hidden(subject)) return variant;
        if (seat.awake.has(subject) || events.loud[i] === 1) return Form.Whole;
        return variant;
      case Ev.Damage:
        if (subject === seat.viewerId || object === seat.viewerId || seat.seesAll || viewer === null) return Form.Whole;
        return seat.awake.has(subject) ? Form.Whole : Form.None;
      case Ev.Killed:
        if (subject === seat.viewerId || seat.seesAll) return Form.Whole;
        return variant === Form.Variant ? Form.Variant : Form.Whole;
      default:
        return Form.Whole;
    }
  }
}

function find(entities: readonly EntitySnapshot[], count: number, entityId: number): EntitySnapshot | null {
  for (let i = 0; i < count; i++) {
    const e = entities[i];
    if (e !== undefined && e.entityId === entityId) return e;
  }
  return null;
}
