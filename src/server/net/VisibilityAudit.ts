import { EFlag, type EntitySnapshot } from '../../shared/net/Snapshot';
import { makeRayHit } from '../../shared/world/Geometry';
import { clearLine, isAlive, NEAR_RADIUS_M, teamOf, type RelevanceContext } from './Relevance';
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
 *   R9 failed and the chevron has nothing to point at. Must be zero.
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
