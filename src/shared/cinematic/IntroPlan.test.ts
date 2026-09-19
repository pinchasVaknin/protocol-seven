import { describe, expect, it } from 'vitest';
import { navBakeOptionsFor } from '../ai/BotDirector';
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
  PULLBACK_SECONDS,
  RETURN_SECONDS,
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
