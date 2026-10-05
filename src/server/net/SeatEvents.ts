import { Ev } from '../../shared/net/Messages';
import { MAX_SERVER_FRAME_BYTES } from '../../shared/net/Protocol';
import type { EntitySnapshot } from '../../shared/net/Snapshot';
import { ByteWriter } from '../../shared/net/Wire';
import { MAX_TICK_EVENTS, type EventCollector } from './EventCollector';
import { isAlive, teamOf } from './Relevance';

/**
 * Which of a tick's events one seat is sent (anti-wallhack phase 2, part 2; docs/VISIBILITY.md).
 *
 * A footstep, a jump and a landing each carry the body's position, and every client used to be
 * sent every one of them — a radar of everything that moved, through any wall. Now a sound goes to
 * a seat only if that seat could hear it:
 *
 * - its own, never: the client plays its own steps from its own prediction and drops the server's
 *   copy (`NetSession`);
 * - a teammate's, always — nothing about a teammate is secret from its side (R1);
 * - an enemy's, only within `HEARING_RADIUS_M` of where the seat listens from (E2), and never a
 *   crouched or sliding step or one with Dead Silence (D4);
 * - an `Unseen` body's, to nobody;
 * - everything, to a free cam (R8).
 *
 * Hearing makes nobody relevant (E1): each sound carries its own position, and the client places it
 * from that, not from the body — so the body stays dormant and the sound alone is sent.
 *
 * Every other event — shots, hits, kills — still goes to everybody here; part 3 cuts those.
 */

/**
 * How far an enemy's step, jump or landing carries: S6.3's footstep radius, which is also the bots'
 * (`DifficultyTiers.footstepHearing`). Measured on the ground plane, as the bots measure it.
 */
export const HEARING_RADIUS_M = 12;

/** The events this file decides about. The rest pass. */
export function isSound(kind: number): boolean {
  return kind === Ev.Footstep || kind === Ev.Jump || kind === Ev.Land;
}

/** One seat's cut of each tick's events. */
export class SeatEvents {
  /** 1 for each event of the tick this seat is sent, after `select`. */
  readonly keep = new Uint8Array(MAX_TICK_EVENTS);
  /** This seat's own frame, when it is not sent the shared one. Never shared: see `frameFor`. */
  readonly writer = new ByteWriter(MAX_SERVER_FRAME_BYTES);
  /** Where this seat listens from this tick. */
  private readonly ears: EntitySnapshot[] = [];

  /**
   * Mark which of `events` this seat is sent; returns how many. `entities` is the last snapshot's
   * roster — where every body was at most a snapshot ago, which on a 12 m radius is close enough.
   * `spectating` is R7: a dead viewer in a one-life mode listens from every living teammate, since
   * its camera may be behind any of them.
   */
  select(
    events: EventCollector,
    viewerId: number,
    entities: readonly EntitySnapshot[],
    entityCount: number,
    freeForAll: boolean,
    hearsAll: boolean,
    spectating: boolean,
    hidden: (entityId: number) => boolean,
  ): number {
    const viewer = find(entities, entityCount, viewerId);
    this.ears.length = 0;
    if (viewer !== null) {
      if (!spectating) this.ears.push(viewer);
      else {
        const team = teamOf(viewer);
        for (let i = 0; i < entityCount; i++) {
          const e = entities[i];
          if (e === undefined || e.entityId === viewerId || !isAlive(e)) continue;
          if (!freeForAll && teamOf(e) === team) this.ears.push(e);
        }
      }
    }

    let kept = 0;
    for (let i = 0; i < events.pending; i++) {
      const sent = this.sends(events, i, viewer, viewerId, entities, entityCount, freeForAll, hearsAll, hidden);
      this.keep[i] = sent ? 1 : 0;
      if (sent) kept++;
    }
    return kept;
  }

  private sends(
    events: EventCollector,
    i: number,
    viewer: EntitySnapshot | null,
    viewerId: number,
    entities: readonly EntitySnapshot[],
    entityCount: number,
    freeForAll: boolean,
    hearsAll: boolean,
    hidden: (entityId: number) => boolean,
  ): boolean {
    if (!isSound(events.kinds[i] ?? 0)) return true;
    const subject = events.subjects[i] ?? -1;
    if (subject === viewerId) return false;
    if (hearsAll) return true;
    // A seat whose body is not in the roster yet has nowhere to listen from. Fail open, as
    // `SeatView` does: it is not a state a seat stays in.
    if (viewer === null) return true;
    if (hidden(subject)) return false;
    const body = find(entities, entityCount, subject);
    if (body !== null && !freeForAll && teamOf(body) === teamOf(viewer)) return true;
    if (events.muted[i] === 1) return false;
    const x = events.xs[i] ?? 0;
    const z = events.zs[i] ?? 0;
    for (const ear of this.ears) {
      if (Math.hypot(ear.x - x, ear.z - z) <= HEARING_RADIUS_M) return true;
    }
    return false;
  }
}

function find(entities: readonly EntitySnapshot[], count: number, entityId: number): EntitySnapshot | null {
  for (let i = 0; i < count; i++) {
    const e = entities[i];
    if (e !== undefined && e.entityId === entityId) return e;
  }
  return null;
}
