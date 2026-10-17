import { describe, expect, it } from 'vitest';
import { navBakeOptionsFor } from '../ai/BotDirector';
import { angleDelta } from '../core/MathUtil';
import { installClock } from '../core/Clock';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { bakeNavmesh } from '../world/NavBake';
import { loadMapCollision } from '../world/MapLoader';
import { FOUNDRY_MAP } from '../world/maps/foundry';
import {
  APPROACH_MAX_SECONDS,
  collidingSamples,
  COUNTDOWN_SECONDS,
  EYE_RADIUS,
  introSeconds,
  matchStartSeconds,
  objectivesFor,
  OVERVIEW_HOLD_SECONDS,
  planIntro,
  sampleIntro,
  PULLBACK_SECONDS,
  RETURN_SECONDS,
  type IntroPlan,
  type IntroPose,
} from './IntroPlan';

/**
 * The match intro's plan (M15, Phase C), on one map: the arithmetic `npm run intro` holds
 * every map × mode × spawn to, pinned here on Foundry so a change to the planner's budgets
 * or its geometry is a red test before it is a red harness.
 */

let fakeNow = 0;
// The navmesh bake reads the clock for its own timing; installed before the describe body
// bakes, which vitest runs at collection time.
installClock({ nowMs: () => fakeNow++ });

function foundry() {
  const collision = loadMapCollision(FOUNDRY_MAP);
  const nav = bakeNavmesh(collision.collision, FOUNDRY_MAP.navBounds, navBakeOptionsFor(FOUNDRY_MAP, DEFAULT_MOVEMENT_CONFIG));
  return { collision: collision.collision, nav };
}

describe('planIntro on Foundry', () => {
  const { collision, nav } = foundry();
  const spawn = FOUNDRY_MAP.spawns[0]!.position;
  const common = { def: FOUNDRY_MAP, nav, collision, movement: DEFAULT_MOVEMENT_CONFIG, spawn, fovDeg: 60 };

  it('fills the freeze less the return and the countdown, phase by phase, and visits every flag', () => {
    const freeze = matchStartSeconds(FOUNDRY_MAP, 'DOM');
    expect(freeze).toBeCloseTo(introSeconds(FOUNDRY_MAP, 'DOM') + RETURN_SECONDS + COUNTDOWN_SECONDS, 9);
    const plan = planIntro({ ...common, modeId: 'DOM', freezeSeconds: freeze });
    const budget = introSeconds(FOUNDRY_MAP, 'DOM');
    expect(plan.seconds).toBeLessThanOrEqual(budget + 1e-9);
    expect(plan.seconds).toBeGreaterThan(budget - 0.25);
    const approach = plan.segments.find((s) => s.kind === 'approach')!;
    expect(approach.seconds).toBeLessThanOrEqual(APPROACH_MAX_SECONDS);
    expect(plan.segments.find((s) => s.kind === 'pullback')!.seconds).toBe(PULLBACK_SECONDS);
    // The freeze is sized for every objective (M17, C2), so every one is visited.
    expect(plan.objectives).toEqual(objectivesFor(FOUNDRY_MAP, 'DOM').map((o) => o.id));
  });

  it('sizes the freeze to the mode: the deathmatch modes shortest, Domination longest', () => {
    const tdm = matchStartSeconds(FOUNDRY_MAP, 'TDM');
    expect(tdm).toBe(APPROACH_MAX_SECONDS + PULLBACK_SECONDS + OVERVIEW_HOLD_SECONDS + RETURN_SECONDS + COUNTDOWN_SECONDS);
    expect(matchStartSeconds(FOUNDRY_MAP, 'FFA')).toBe(tdm);
    expect(matchStartSeconds(FOUNDRY_MAP, 'SND')).toBeGreaterThan(tdm);
    expect(matchStartSeconds(FOUNDRY_MAP, 'DOM')).toBeGreaterThan(matchStartSeconds(FOUNDRY_MAP, 'SND'));
    // The range flies no intro, so it holds no freeze for one (2026-10-03): it was sixteen
    // seconds of GET READY on the testbed with nobody to get ready for.
    expect(matchStartSeconds(FOUNDRY_MAP, 'RANGE')).toBe(0);
  });

  it('holds the overview for the deathmatch modes and visits both sites for Search & Destroy', () => {
    const tdm = planIntro({ ...common, modeId: 'TDM', freezeSeconds: matchStartSeconds(FOUNDRY_MAP, 'TDM') });
    expect(tdm.objectives).toEqual([]);
    // The rest on the overview, and the remainder of the budget held there after it.
    expect(tdm.segments.map((s) => s.kind).slice(0, 3)).toEqual(['approach', 'pullback', 'hold']);
    expect(tdm.segments.every((s, i) => i < 2 || s.kind === 'hold')).toBe(true);
    const snd = planIntro({ ...common, modeId: 'SND', freezeSeconds: matchStartSeconds(FOUNDRY_MAP, 'SND') });
    expect(snd.objectives).toEqual(['snd_a', 'snd_b']);
  });

  it('starts on the route out of the spawn, as far along as the trim took it, and keeps the eye clear', () => {
    const plan = planIntro({ ...common, modeId: 'SND', freezeSeconds: matchStartSeconds(FOUNDRY_MAP, 'SND') });
    const first: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    plan.poseAt(0, first);
    // A route longer than the approach's budget is trimmed from the spawn end, so the camera
    // starts up the route by the trimmed distance — never further, and at the spawn if untrimmed.
    expect(Math.hypot(first.x - spawn.x, first.z - spawn.z)).toBeLessThanOrEqual(plan.trimmedMetres + 0.5);
    expect(collidingSamples(plan, collision, 0.25, EYE_RADIUS)).toEqual([]);
  });

  it('poseAt is continuous across segment boundaries', () => {
    const plan = planIntro({ ...common, modeId: 'DOM', freezeSeconds: matchStartSeconds(FOUNDRY_MAP, 'DOM') });
    const a: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    const b: IntroPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    let t = 0;
    for (const segment of plan.segments) {
      t += segment.seconds;
      plan.poseAt(t - 1e-4, a);
      plan.poseAt(t + 1e-4, b);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.5);
    }
  });
});

/**
 * The planner's own geometry (A24), pinned before `planIntro` came apart into its phases.
 *
 * `npm run intro` compares every map × mode byte for byte, which is the net under all of this;
 * what these add is the *shape* of a plan — the segments' order, what each one hands to the
 * next, and that two identical inputs produce identical samples. A refactor that moved a
 * closure or reordered an arithmetic step would show up here before the harness.
 */
describe('the plan’s shape', () => {
  const { collision, nav } = foundry();
  const spawn = FOUNDRY_MAP.spawns[0]!.position;
  const common = { def: FOUNDRY_MAP, nav, collision, movement: DEFAULT_MOVEMENT_CONFIG, spawn, fovDeg: 60 };
  const planFor = (modeId: 'TDM' | 'DOM' | 'SND'): IntroPlan =>
    planIntro({ ...common, modeId, freezeSeconds: matchStartSeconds(FOUNDRY_MAP, modeId) });

  const pose = (): IntroPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  const poseOf = (segment: { at(u: number, out: IntroPose): void }, u: number): IntroPose => {
    const out = pose();
    segment.at(u, out);
    return out;
  };
  const apart = (a: IntroPose, b: IntroPose): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  it('plans the same path twice from the same input, sample for sample', () => {
    const a = sampleIntro(planFor('DOM'), 0.5);
    const b = sampleIntro(planFor('DOM'), 0.5);
    expect(a.length).toBe(b.length);
    // Exact equality: the planner is pure `shared/` maths with no clock and no RNG, and the
    // harness compares its output byte for byte on every map.
    expect(a).toEqual(b);
  });

  it('carries one waypoint list per segment, filled for the travelling ones only', () => {
    const plan = planFor('DOM');
    expect(plan.waypoints.length).toBe(plan.segments.length);
    for (const [i, segment] of plan.segments.entries()) {
      const points = plan.waypoints[i] ?? [];
      if (segment.kind === 'approach' || segment.kind === 'whip') expect(points.length).toBeGreaterThan(1);
      else expect(points).toEqual([]);
    }
  });

  it('measures the approach by its own spline and starts and ends on it', () => {
    const plan = planFor('TDM');
    const approach = plan.segments.find((s) => s.kind === 'approach')!;
    expect(approach.metres).toBe(plan.approachMetres);
    expect(approach.metres).toBeGreaterThan(5);
    // The pitch is the fixed few degrees down for the whole approach, not a look-at.
    const start = poseOf(approach, 0);
    const mid = poseOf(approach, 0.5);
    expect(start.pitch).toBe(mid.pitch);
    expect(start.pitch).toBeLessThan(0);
    expect(apart(start, mid)).toBeGreaterThan(1);
  });

  it('pulls back from where the approach ended to the overview, and reports that distance', () => {
    const plan = planFor('TDM');
    const approach = plan.segments.find((s) => s.kind === 'approach')!;
    const pullback = plan.segments.find((s) => s.kind === 'pullback')!;
    const end = poseOf(approach, 1);
    const top = poseOf(pullback, 1);
    expect(apart(poseOf(pullback, 0), end)).toBeLessThan(1e-6);
    expect(pullback.metres).toBe(plan.overviewDistance);
    expect(apart(end, top)).toBeCloseTo(plan.overviewDistance, 6);
    // Away and up: the camera rises off what it was looking at.
    expect(top.y).toBeGreaterThan(end.y + 1);
  });

  it('ends the pull-back looking at the map rather than past it', () => {
    const plan = planFor('TDM');
    const top = poseOf(plan.segments.find((s) => s.kind === 'pullback')!, 1);
    const b = FOUNDRY_MAP.navBounds;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    // three's yaw: 0 faces -Z. The 2026-09-20 report was 30 to 150 degrees off-axis.
    const wanted = Math.atan2(-(cx - top.x), -(cz - top.z));
    const off = Math.abs(angleDelta(top.yaw, wanted));
    expect(off).toBeLessThan((25 * Math.PI) / 180);
    expect(top.pitch).toBeLessThan(0);
  });

  it('holds the overview motionless, then pulls back in along the way it came', () => {
    const plan = planFor('DOM');
    const kinds = plan.segments.map((s) => s.kind);
    expect(kinds.slice(0, 4)).toEqual(['approach', 'pullback', 'hold', 'snap']);

    const hold = plan.segments[2]!;
    expect(apart(poseOf(hold, 0), poseOf(hold, 1))).toBe(0);
    expect(hold.metres).toBe(0);

    const top = poseOf(plan.segments[1]!, 1);
    const pullIn = plan.segments[3]!;
    expect(apart(poseOf(pullIn, 0), top)).toBeLessThan(1e-6);
    // The pull-in is the pull-back reversed, so it lands back where the approach ended.
    const end = poseOf(plan.segments[0]!, 1);
    expect(apart(poseOf(pullIn, 1), end)).toBeLessThan(0.01);
    expect(pullIn.metres).toBe(plan.overviewDistance);
  });

  it('hands every whip to the hold that follows it, and every hold stands still', () => {
    const plan = planFor('DOM');
    for (const [i, segment] of plan.segments.entries()) {
      if (segment.kind !== 'whip') continue;
      const hold = plan.segments[i + 1]!;
      expect(hold.kind).toBe('hold');
      expect(hold.label).toBe(segment.label);
      expect(apart(poseOf(segment, 1), poseOf(hold, 0))).toBeLessThan(1e-6);
      expect(apart(poseOf(hold, 0), poseOf(hold, 1))).toBe(0);
      expect(segment.metres).toBeGreaterThan(0);
    }
  });

  it('blends each whip off the hold it left and onto the objective it arrives at', () => {
    // The two angle blends are what the shortest-signed-difference helper is here for: the
    // heading leaves the previous hold's exactly and arrives on the stand-off's exactly, and
    // in between it is the route's own averaged heading, which on a 30 m whip at whip speed
    // swings hard (measured: up to 2.0 rad between two thousandths of the segment). The ends
    // are the contract; the middle is the route's.
    const plan = planFor('DOM');
    for (const [i, segment] of plan.segments.entries()) {
      if (segment.kind !== 'whip') continue;
      const left = poseOf(plan.segments[i - 1]!, 1);
      const arrived = poseOf(plan.segments[i + 1]!, 0);
      expect(poseOf(segment, 0).yaw).toBeCloseTo(left.yaw, 9);
      expect(poseOf(segment, 1).yaw).toBeCloseTo(arrived.yaw, 9);
      expect(poseOf(segment, 0).pitch).toBeCloseTo(left.pitch, 9);
      expect(poseOf(segment, 1).pitch).toBeCloseTo(arrived.pitch, 9);
    }
  });

  it('visits the objectives in label order and routes to all of them', () => {
    const plan = planFor('DOM');
    const labels = plan.segments.filter((s) => s.kind === 'whip').map((s) => s.label);
    expect(labels).toEqual(objectivesFor(FOUNDRY_MAP, 'DOM').map((o) => o.label));
    expect([...labels].sort()).toEqual(labels);
    // Every leg found a route on this map: the arc is the fallback for a grid that cannot.
    expect(plan.arcs).toEqual([]);
    for (const id of plan.arcs) expect(plan.objectives).toContain(id);
  });

  it('adds up to the seconds it reports, inside the budget it was given', () => {
    for (const modeId of ['TDM', 'DOM', 'SND'] as const) {
      const plan = planFor(modeId);
      const sum = plan.segments.reduce((total, s) => total + s.seconds, 0);
      expect(plan.seconds).toBeCloseTo(sum, 9);
      expect(plan.seconds).toBeLessThanOrEqual(introSeconds(FOUNDRY_MAP, modeId) + 1e-6);
      expect(plan.objectiveSeconds).toBeLessThanOrEqual(plan.seconds);
    }
  });

  it('holds the last pose for whatever the budget did not spend', () => {
    const plan = planFor('DOM');
    const last = plan.segments[plan.segments.length - 1]!;
    expect(last.kind).toBe('hold');
    const held = poseOf(last, 1);
    const atEnd = pose();
    plan.poseAt(plan.seconds, atEnd);
    expect(apart(held, atEnd)).toBeLessThan(1e-6);
    // Past the end it holds, rather than running off the last segment.
    const beyond = pose();
    plan.poseAt(plan.seconds + 5, beyond);
    expect(apart(held, beyond)).toBeLessThan(1e-6);
  });

  it('starts at the first pose for t at or before zero', () => {
    const plan = planFor('TDM');
    const first = poseOf(plan.segments[0]!, 0);
    const atZero = pose();
    plan.poseAt(0, atZero);
    const before = pose();
    plan.poseAt(-1, before);
    expect(apart(first, atZero)).toBeLessThan(1e-6);
    expect(apart(first, before)).toBeLessThan(1e-6);
  });

  it('keeps the approach and the overview even when the freeze is far too short', () => {
    // The budget gates the objective tour and the remainder hold; the approach has a minimum
    // because shorter than that reads as a cut rather than a move.
    const plan = planIntro({ ...common, modeId: 'DOM', freezeSeconds: RETURN_SECONDS + COUNTDOWN_SECONDS + 1 });
    expect(plan.segments.map((s) => s.kind).slice(0, 3)).toEqual(['approach', 'pullback', 'hold']);
    expect(plan.objectives).toEqual([]);
    expect(plan.seconds).toBeGreaterThan(2.5);
  });

  it('samples every segment, and lands exactly on each one’s ends', () => {
    const plan = planFor('SND');
    const samples = sampleIntro(plan, 0.5);
    const kinds = new Set(samples.map((s) => s.segment));
    for (const segment of plan.segments) expect(kinds.has(segment.kind)).toBe(true);
    // At least 65 per segment, so a motionless hold is still visited.
    for (const segment of plan.segments) {
      expect(samples.filter((s) => s.segment === segment.kind).length).toBeGreaterThanOrEqual(65);
    }
    const first = samples[0]!;
    const start = poseOf(plan.segments[0]!, 0);
    expect(first.t).toBe(0);
    expect(Math.hypot(first.x - start.x, first.y - start.y, first.z - start.z)).toBeLessThan(1e-9);
  });

  it('keeps the eye clear of the world in every mode', () => {
    for (const modeId of ['TDM', 'FFA', 'KC', 'DOM', 'SND'] as const) {
      const plan = planIntro({ ...common, modeId, freezeSeconds: matchStartSeconds(FOUNDRY_MAP, modeId) });
      expect(collidingSamples(plan, collision, 0.25, EYE_RADIUS)).toEqual([]);
      expect(plan.nudged).toBeGreaterThanOrEqual(0);
    }
  });

  it('names no objectives for the modes that have none', () => {
    for (const modeId of ['TDM', 'FFA', 'KC', 'RANGE'] as const) {
      expect(objectivesFor(FOUNDRY_MAP, modeId)).toEqual([]);
    }
    expect(objectivesFor(FOUNDRY_MAP, 'DOM').length).toBeGreaterThan(1);
    expect(objectivesFor(FOUNDRY_MAP, 'SND').length).toBe(2);
  });
});
