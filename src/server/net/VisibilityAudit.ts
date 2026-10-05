import type { BombInfo } from '../../shared/modes/GameMode';
import { decodeHeader, readEvents, Ev, type EventSink } from '../../shared/net/Messages';
import { EFlag, type EntitySnapshot } from '../../shared/net/Snapshot';
import { ByteReader } from '../../shared/net/Wire';
import { makeRayHit } from '../../shared/world/Geometry';
import type { EventCollector } from './EventCollector';
import { clearLine, isAlive, NEAR_RADIUS_M, teamOf, type RelevanceContext } from './Relevance';
import { HEARING_RADIUS_M, isSound, type SeatContext } from './SeatEvents';
import type { SeatView } from './SeatView';

/**
 * Proof that culling never costs a player a body they should have seen (anti-wallhack phase 1,
 * part 3; docs/VISIBILITY.md, "Proving it").
 *
 * The server knows where everybody really is, so it can grade its own decisions. For every seat
 * and every living enemy beyond R2's radius, each snapshot:
 *
 * - **visible** — a clear line from the viewer's eye *now* to the body *now*, no look-ahead, no
 *   linger: what the player could see this instant if the client drew the present;
 * - **hard miss** — visible, and this snapshot sent the body dormant. Must be zero;
 * - **appearance** — the snapshot a body goes from not visible to visible;
 * - **late wake** — an appearance at which the body had been relevant for less than the time the
 *   client draws behind the server (half the round trip plus the interpolation delay): the client
 *   has not yet drawn the moment it came into view, so it appears late on screen. Counted once per
 *   appearance, not per snapshot. A respawn of either end in that window is not counted — a body
 *   that spawns in view appears however it is sent;
 * - **hurt from dormant** — the seat was hit by a body its last snapshot sent dormant (a round
 *   through a wall, a shooter whose eye line was blocked): how often the client's chevron has to
 *   wait for R9's wake. **Still dormant** — such a shooter dormant again in the very next snapshot:
 *   R9 failed and the chevron has nothing to point at. Must be zero;
 * - **sounds** (test 2, phase 2 part 2) — every enemy footstep, jump and landing of a tick, held
 *   against the frame this seat was actually sent, decoded: one an enemy could hear (within
 *   `HEARING_RADIUS_M` of where the seat listens, not crouched, not Dead Silence) and was not sent
 *   is **missing**; one it could not hear and was sent is a **leak** — a position on the wire that
 *   the game never gave the player. Both must be zero;
 * - **shots, hits and kills** (test 2, part 3) — the same, against `SeatEvents`'s rules for them:
 *   see `observeEvents`. Missing and leaked must be zero;
 * - **the bomb** (part 4) — a carried bomb sent to a seat whose snapshot has its carrier dormant
 *   must be where that snapshot put the carrier, not where the carrier is. Leaks must be zero.
 *
 * Off unless a harness turns it on: it costs a line test per pair on top of culling's own, and
 * nothing in a match reads it.
 */

let enabled = false;

/** Turn the audit on for every instance this process builds. Harnesses only. */
export function enableVisibilityAudit(): void {
  enabled = true;
}

export function visibilityAuditEnabled(): boolean {
  return enabled;
}

export interface VisibilityAuditStats {
  /** (seat, enemy) observations beyond R2, alive. */
  pairs: number;
  /** Of those, how many were visible this instant. */
  visible: number;
  /** Bodies coming into view: visible this snapshot, not the last. */
  appearances: number;
  hardMisses: number;
  lateWakes: number;
  /** The worst late wake: how many ms short of the client's draw delay it was. */
  worstShortfallMs: number;
  /** What culling cost and what it kept off the wire, over the same snapshots. */
  seatSnapshots: number;
  relevanceMs: number;
  enemyRecords: number;
  dormantRecords: number;
  /** Late wakes by the point first seen — head, chest, feet, shoulder, shoulder — for tuning. */
  lateByPoint: number[];
  /** Late wakes where the two bodies stood more than 1.5 m apart in height (a level, a ledge). */
  lateAcrossLevels: number;
  /** Late wakes where either body moved faster than sprint speed (a slide, a tac-sprint). */
  lateFast: number;
  /** Hits on a seat from another body (not a sentry), for the denominator. */
  hurtTotal: number;
  /** Of those, from a body its last snapshot sent dormant. */
  hurtFromDormant: number;
  /** Of those, the shooter was dormant in the next snapshot too. Must be zero (R9). */
  hurtStillDormant: number;
  /** Enemy footsteps, jumps and landings, per seat that could have been sent them. */
  enemySounds: number;
  /** Of those, sent. */
  enemySoundsSent: number;
  /** Audible and not sent. Must be zero. */
  soundsMissing: number;
  /** Sent and not audible. Must be zero. */
  soundLeaks: number;
  /** Other bodies' shots, per seat; the suppressed ones; and of those, from a body the seat did not have. */
  shots: number;
  shotsSuppressed: number;
  shotsAsImpact: number;
  /** Hits between two other bodies, per seat; of those, sent. */
  hits: number;
  hitsSent: number;
  /** A shot, hit or kill the seat should have had in the form it should have had it, and did not. Must be zero. */
  eventsMissing: number;
  /** A shot, hit or kill (or a killer's health) the seat should not have had, and did. Must be zero. */
  eventLeaks: number;
  /** S&D bomb sends while carried, per seat; of those, by a carrier the seat had dormant. */
  bombCarried: number;
  bombCarrierUnseen: number;
  /** A carried bomb sent anywhere but where the seat's own snapshot put an unseen carrier. Must be zero. */
  bombLeaks: number;
}

export function emptyAuditStats(): VisibilityAuditStats {
  return {
    pairs: 0,
    visible: 0,
    appearances: 0,
    hardMisses: 0,
    lateWakes: 0,
    worstShortfallMs: 0,
    seatSnapshots: 0,
    relevanceMs: 0,
    enemyRecords: 0,
    dormantRecords: 0,
    lateByPoint: [0, 0, 0, 0, 0],
    lateAcrossLevels: 0,
    lateFast: 0,
    hurtTotal: 0,
    hurtFromDormant: 0,
    hurtStillDormant: 0,
    enemySounds: 0,
    enemySoundsSent: 0,
    soundsMissing: 0,
    soundLeaks: 0,
    shots: 0,
    shotsSuppressed: 0,
    shotsAsImpact: 0,
    hits: 0,
    hitsSent: 0,
    eventsMissing: 0,
    eventLeaks: 0,
    bombCarried: 0,
    bombCarrierUnseen: 0,
    bombLeaks: 0,
  };
}

/**
 * Every instance's observations, together. Process-wide because the instance a harness most wants
 * graded — the live match — is destroyed when it ends, before anybody reads it.
 */
export const visibilityAuditTotals: VisibilityAuditStats = emptyAuditStats();

/** One seat's audit memory: when each body last became relevant, and when it last respawned. */
export class SeatAudit {
  private readonly relevantSince = new Map<number, number>();
  private readonly spawnSerial = new Map<number, number>();
  private readonly spawnedAt = new Map<number, number>();
  private readonly wasVisible = new Set<number>();
  /** Shooters that hurt this seat from dormancy since the last snapshot. */
  private readonly hurtBy = new Set<number>();
  private readonly hit = makeRayHit();
  private startedMs = -1;
  /** The events in the last frame this seat was sent, decoded. */
  private readonly got: Array<{ kind: number; id: number; other: number; x: number; z: number; hp: number; used: boolean }> = [];
  private readonly reader = new ByteReader(new Uint8Array(0));
  private readonly ears: EntitySnapshot[] = [];
  private readonly sink: EventSink = {
    onFootstep: (e) => this.got.push({ kind: Ev.Footstep, id: e.entityId, other: -1, x: e.x, z: e.z, hp: 0, used: false }),
    onJump: (e) => this.got.push({ kind: Ev.Jump, id: e.entityId, other: -1, x: e.x, z: e.z, hp: 0, used: false }),
    onLand: (e) => this.got.push({ kind: Ev.Land, id: e.entityId, other: -1, x: e.x, z: e.z, hp: 0, used: false }),
    onFired: (e) => this.got.push({ kind: Ev.Fired, id: e.sourceId, other: -1, x: e.x, z: e.z, hp: 0, used: false }),
    onImpact: (e) => this.got.push({ kind: Ev.Impact, id: -1, other: -1, x: e.x, z: e.z, hp: 0, used: false }),
    onDamage: (e) => this.got.push({ kind: Ev.Damage, id: e.targetId, other: e.sourceId, x: e.x, z: e.z, hp: 0, used: false }),
    onKilled: (e) => this.got.push({ kind: Ev.Killed, id: e.targetId, other: e.sourceId, x: 0, z: 0, hp: e.killerHealth, used: false }),
  };

  /**
   * One tick's events against what this seat was actually sent (`sent`, null for nothing), decoded.
   *
   * The rules are applied here again rather than asked of `SeatEvents`, and "awake" is read off the
   * records the seat's last snapshot carried rather than off `SeatView.awake` — so a cut that drifted
   * from the rule, or from what the client has been told, shows up as a count:
   *
   * - an enemy **sound** the seat could hear (within `HEARING_RADIUS_M` of where it listens, not
   *   muted) must arrive, and one it could not must not;
   * - a **shot** must arrive whole when the seat fired it, has the shooter awake, or the shot pings
   *   the minimap; otherwise it must not arrive whole, and arrives as a bare impact (D2);
   * - a **hit** must arrive when the seat is its target or source or has the target awake, and
   *   must not otherwise;
   * - a **kill** must arrive, with the killer's health zeroed unless the seat is the victim (E3).
   */
  observeEvents(
    sent: Uint8Array | null,
    events: EventCollector,
    view: SeatView,
    seat: SeatContext,
    out: VisibilityAuditStats,
  ): void {
    this.got.length = 0;
    if (sent !== null) {
      this.reader.reuse(sent);
      const msg = decodeHeader(this.reader);
      if (msg.kind === 'events') readEvents(this.reader, msg.count, this.sink);
    }

    const { viewerId, entities, entityCount, freeForAll, seesAll, spectating, hidden } = seat;
    const byId = (id: number): EntitySnapshot | null => {
      for (let i = 0; i < entityCount; i++) if (entities[i]?.entityId === id) return entities[i] ?? null;
      return null;
    };
    const viewer = byId(viewerId);
    if (viewer === null) return;
    const awake = new Set<number>();
    for (let i = 0; i < view.count; i++) {
      const rec = view.list[i];
      if (rec !== undefined && (rec.flags & EFlag.Dormant) === 0) awake.add(rec.entityId);
    }
    this.ears.length = 0;
    for (let i = 0; i < entityCount; i++) {
      const e = entities[i];
      if (e === undefined) continue;
      const listens = spectating
        ? e.entityId !== viewerId && isAlive(e) && !freeForAll && teamOf(e) === teamOf(viewer)
        : e.entityId === viewerId;
      if (listens) this.ears.push(e);
    }
    const take = (kind: number, id: number, x: number, z: number, other = -2): (typeof this.got)[number] | undefined => {
      const g = this.got.find(
        (h) => !h.used && h.kind === kind && h.id === id && (other === -2 || h.other === other) && Math.abs(h.x - x) < 0.1 && Math.abs(h.z - z) < 0.1,
      );
      if (g !== undefined) g.used = true;
      return g;
    };

    let impactsDue = 0;
    for (let i = 0; i < events.pending; i++) {
      const kind = events.kinds[i] ?? 0;
      const subject = events.subjects[i] ?? -1;
      const object = events.objects[i] ?? -1;
      const x = events.xs[i] ?? 0;
      const z = events.zs[i] ?? 0;

      if (isSound(kind)) {
        if (subject === viewerId) continue;
        const body = byId(subject);
        if (body !== null && !freeForAll && teamOf(body) === teamOf(viewer)) continue;
        out.enemySounds++;
        const audible =
          seesAll ||
          (!hidden(subject) &&
            events.muted[i] !== 1 &&
            this.ears.some((ear) => Math.hypot(ear.x - x, ear.z - z) <= HEARING_RADIUS_M));
        const match = take(kind, subject, x, z);
        if (match !== undefined) out.enemySoundsSent++;
        if (audible && match === undefined) out.soundsMissing++;
        if (!audible && match !== undefined) out.soundLeaks++;
        continue;
      }

      if (kind === Ev.Fired) {
        if (subject === viewerId) continue;
        out.shots++;
        if (events.loud[i] !== 1) out.shotsSuppressed++;
        const whole = seesAll || (!hidden(subject) && (awake.has(subject) || events.loud[i] === 1));
        const match = take(Ev.Fired, subject, x, z);
        if (whole && match === undefined) out.eventsMissing++;
        if (!whole) {
          if (match !== undefined) out.eventLeaks++;
          out.shotsAsImpact++;
          impactsDue++;
        }
      } else if (kind === Ev.Damage) {
        if (subject === viewerId || object === viewerId) continue;
        out.hits++;
        const due = seesAll || awake.has(subject);
        const match = take(Ev.Damage, subject, x, z, object);
        if (match !== undefined) out.hitsSent++;
        if (due && match === undefined) out.eventsMissing++;
        if (!due && match !== undefined) out.eventLeaks++;
      } else if (kind === Ev.Killed) {
        const match = take(Ev.Killed, subject, 0, 0, object);
        if (match === undefined) out.eventsMissing++;
        else if (subject !== viewerId && !seesAll && match.hp !== 0) out.eventLeaks++;
      }
    }
    // A bare impact carries nothing to match it by but its place, so they are counted: as many as
    // were due, no more and no fewer.
    const impacts = this.got.filter((g) => g.kind === Ev.Impact).length;
    if (impacts < impactsDue) out.eventsMissing += impactsDue - impacts;
    if (impacts > impactsDue) out.eventLeaks += impacts - impactsDue;
  }

  /**
   * One S&D bomb send: `sent` is what this seat was given, `truth` the mode's. A carrier the seat's
   * last snapshot sent dormant must not be placed by the bomb anywhere but where that record is.
   */
  observeBomb(sent: BombInfo, truth: BombInfo, view: SeatView, out: VisibilityAuditStats): void {
    if (truth.state !== 'CARRIED' || truth.carrierId < 0) return;
    out.bombCarried++;
    const rec = view.recordOf(truth.carrierId);
    if (rec !== null && (rec.flags & EFlag.Dormant) === 0) return;
    out.bombCarrierUnseen++;
    const x = rec?.x ?? 0;
    const z = rec?.z ?? 0;
    if (Math.abs(sent.x - x) > 1e-3 || Math.abs(sent.z - z) > 1e-3) out.bombLeaks++;
  }

  /**
   * The seat was just hurt by `sourceId`. `view` still holds the snapshot last sent, so this is
   * what the client knew at the moment of the hit.
   */
  noteHurt(view: SeatView, sourceId: number, out: VisibilityAuditStats): void {
    for (let i = 0; i < view.count; i++) {
      const rec = view.list[i];
      if (rec === undefined || rec.entityId !== sourceId) continue;
      out.hurtTotal++;
      if ((rec.flags & EFlag.Dormant) === 0) return;
      out.hurtFromDormant++;
      this.hurtBy.add(sourceId);
      return;
    }
  }

  observe(
    nowMs: number,
    view: SeatView,
    viewerId: number,
    entities: readonly EntitySnapshot[],
    entityCount: number,
    ctx: RelevanceContext,
    drawDelayMs: number,
    out: VisibilityAuditStats,
  ): void {
    let viewer: EntitySnapshot | null = null;
    for (let i = 0; i < entityCount; i++) {
      const e = entities[i];
      if (e === undefined) continue;
      if (e.entityId === viewerId) viewer = e;
      // Respawns, for the exemption: a serial that moved is a body that just appeared somewhere.
      const last = this.spawnSerial.get(e.entityId);
      if (last !== undefined && last !== e.spawnSerial) this.spawnedAt.set(e.entityId, nowMs);
      this.spawnSerial.set(e.entityId, e.spawnSerial);
    }

    // R9's check comes before the viewer's own life: the hit that hurt it may have killed it, and
    // the death report wants the killer's place as much as the chevron does.
    if (this.hurtBy.size > 0) {
      for (let i = 0; i < view.count; i++) {
        const rec = view.list[i];
        if (rec !== undefined && this.hurtBy.has(rec.entityId) && (rec.flags & EFlag.Dormant) !== 0) out.hurtStillDormant++;
      }
      this.hurtBy.clear();
    }

    if (viewer === null || !isAlive(viewer)) return;
    // A seat that has just appeared — a join, a migration — has everything in view "new" at once.
    // That is arriving, not culling; the first draw delay of a seat's life is not graded.
    if (this.startedMs < 0) this.startedMs = nowMs;
    const settling = nowMs - this.startedMs < drawDelayMs;

    // What this seat was sent, by id: dormant or not.
    const sentDormant = new Map<number, boolean>();
    for (let i = 0; i < view.count; i++) {
      const rec = view.list[i];
      if (rec !== undefined) sentDormant.set(rec.entityId, (rec.flags & EFlag.Dormant) !== 0);
    }

    for (let i = 0; i < entityCount; i++) {
      const e = entities[i];
      if (e === undefined || e.entityId === viewerId) continue;
      const dormant = sentDormant.get(e.entityId) ?? true;
      if (dormant) this.relevantSince.delete(e.entityId);
      else if (!this.relevantSince.has(e.entityId)) this.relevantSince.set(e.entityId, nowMs);

      const counted =
        isAlive(e) &&
        (ctx.freeForAll || teamOf(e) !== teamOf(viewer)) &&
        Math.hypot(e.x - viewer.x, e.y - viewer.y, e.z - viewer.z) > NEAR_RADIUS_M;
      if (!counted) {
        this.wasVisible.delete(e.entityId);
        continue;
      }
      out.pairs++;
      const ray = clearLine(ctx.world, viewer, e, 0, -1, this.hit);
      if (ray < 0) {
        this.wasVisible.delete(e.entityId);
        continue;
      }
      out.visible++;
      if (dormant) out.hardMisses++;
      const appearing = !this.wasVisible.has(e.entityId);
      this.wasVisible.add(e.entityId);
      if (!appearing || settling) continue;
      out.appearances++;
      if (dormant) continue;
      const since = this.relevantSince.get(e.entityId) ?? nowMs;
      const shown = nowMs - since;
      if (shown >= drawDelayMs) continue;
      const spawned = Math.max(this.spawnedAt.get(e.entityId) ?? -Infinity, this.spawnedAt.get(viewerId) ?? -Infinity);
      if (nowMs - spawned < drawDelayMs) continue;
      out.lateWakes++;
      out.worstShortfallMs = Math.max(out.worstShortfallMs, drawDelayMs - shown);
      // With no look-ahead only the five now-to-now rays are live, so the index is the point.
      if (ray < out.lateByPoint.length) out.lateByPoint[ray] = (out.lateByPoint[ray] ?? 0) + 1;
      if (Math.abs(e.y - viewer.y) > 1.5) out.lateAcrossLevels++;
      if (Math.hypot(e.vx, e.vz) > 7 || Math.hypot(viewer.vx, viewer.vz) > 7) out.lateFast++;
    }
  }
}
