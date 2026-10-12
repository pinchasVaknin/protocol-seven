import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { BotTeam, Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { installClock } from '../core/Clock';
import { createGameBus } from '../core/Events';
import { Btn, type InputCommand } from '../core/InputCommand';
import { DT } from '../core/Loop';
import { DEG2RAD } from '../core/MathUtil';
import { Rng } from '../core/Rng';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import { ChopperGunner, makeChopperView } from './ChopperGunner';
import type { StreakContext } from './KillstreakBase';
import { DEFAULT_STREAK_CONFIG, streakDef } from './StreakDefs';
import { SILENT_PRESENTATION, type StreakPresentation } from './StreakPresentation';

/**
 * The takeover: the belt, the barrels, the optic and the one exit (A16).
 *
 * `step` is four machines in one method — the look, the optic, the feed and the spin — and the
 * refactor gives each a name. Everything about the belt is pinned here because its whole point
 * is *when* the feed starts: on the round that empties it rather than on the next trigger pull,
 * which is the difference between a gun that reloads and one that eats a click.
 *
 * `onExpire` is the single exit the class comment insists on, so its idempotency is pinned too.
 */

// `DamageSystem` stamps its last-hit read-out with the clock; any monotonic one will do.
let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const OWNER = 1;

/** A body that is only a position, a team and a participation flag. */
function body(entityId: number, team: BotTeam, px: number, pz: number) {
  return {
    entityId,
    displayName: `P${entityId}`,
    team,
    health: new Health(DEFAULT_HEALTH_CONFIG),
    rig: new HitboxRig(),
    px,
    py: 0,
    pz,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.65,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

function world(): CollisionWorld {
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 160, y: 2, z: 160 }, 0, 0, 0, 'concrete');
  return new CollisionWorld(set, { min: { x: -80, y: -8, z: -80 }, max: { x: 80, y: 48, z: 80 } }, 8);
}

function command(buttons: number, yaw = 0, pitch = -0.35): InputCommand {
  return { seq: 0, tickIndex: 0, moveX: 0, moveZ: 0, yaw, pitch, buttons, sampledAtMs: 0 };
}

function rig(ownerTeam: BotTeam = 'A') {
  const spins: number[] = [];
  const shots: number[] = [];
  const shakes: number[] = [];
  const present: StreakPresentation = {
    ...SILENT_PRESENTATION,
    chopperSpin: (spin) => spins.push(spin),
    chopperShot: () => shots.push(1),
    shake: (amount) => shakes.push(amount),
  };
  const bus = createGameBus();
  const context: StreakContext = {
    bus,
    world: world(),
    damage: new DamageSystem(bus),
    bots: {} as BotDirector,
    present,
    mapDef: {} as MapDef,
    cfg: DEFAULT_STREAK_CONFIG,
    rng: new Rng(3),
    tiers: DEFAULT_TIERS,
    roster: [body(OWNER, 'A', 0, 0)] as unknown as Combatant[],
    freeForAll: false,
    targetable: () => true,
    visibleToUav: () => true,
    nextEntityId: () => 900,
  };
  const chopper = new ChopperGunner(streakDef('chopper'), OWNER, ownerTeam, 5, context);
  chopper.onActivate();
  /** `ticks` of the command, stepped the way `StreakSystem` steps it: `step` then `onTick`. */
  const hold = (buttons: number, ticks: number): boolean => {
    let live = true;
    for (let i = 0; i < ticks; i++) {
      chopper.step(command(buttons));
      live = chopper.onTick(i);
    }
    return live;
  };
  return { chopper, hold, spins, shots, shakes };
}

describe('the gunship’s belt', () => {
  it('starts full, and a streak always begins able to shoot', () => {
    const r = rig();
    expect(r.chopper.mag).toBe(DEFAULT_STREAK_CONFIG.chopperMagSize);
    expect(r.chopper.magSize).toBe(DEFAULT_STREAK_CONFIG.chopperMagSize);
    expect(r.chopper.reloading).toBe(false);
    expect(r.chopper.reloadFraction).toBe(0);
  });

  it('spends a round per shot and feeds on the one that empties it', () => {
    const r = rig();
    r.hold(Btn.Fire, 600);
    // Not waiting to be asked: the gun is already feeding, not sitting empty on a full belt.
    expect(r.chopper.shotsFired).toBeGreaterThanOrEqual(DEFAULT_STREAK_CONFIG.chopperMagSize);
    expect(r.chopper.reloading || r.chopper.mag > 0).toBe(true);
  });

  it('refuses the trigger while the belt is being fed, and comes back full', () => {
    const r = rig();
    // Fire until the feed starts.
    let guard = 0;
    while (!r.chopper.reloading && guard++ < 2000) r.hold(Btn.Fire, 1);
    expect(r.chopper.reloading).toBe(true);
    expect(r.chopper.mag).toBe(0);

    const firedAtFeed = r.chopper.shotsFired;
    r.hold(Btn.Fire, 30);
    // Half a second of held trigger inside a 2.4-second feed sends nothing.
    expect(r.chopper.shotsFired).toBe(firedAtFeed);
    expect(r.chopper.reloadFraction).toBeGreaterThan(0);
    expect(r.chopper.reloadFraction).toBeLessThan(1);

    r.hold(0, Math.ceil(DEFAULT_STREAK_CONFIG.chopperReloadSeconds / DT));
    expect(r.chopper.reloading).toBe(false);
    expect(r.chopper.mag).toBe(DEFAULT_STREAK_CONFIG.chopperMagSize);
    expect(r.chopper.reloadFraction).toBe(0);
  });

  it('bleeds the spin off while it feeds, so the round after costs the spin-up again', () => {
    const r = rig();
    let guard = 0;
    while (!r.chopper.reloading && guard++ < 2000) r.hold(Btn.Fire, 1);
    const atFeed = r.chopper.spin;
    r.hold(Btn.Fire, 60);
    expect(r.chopper.spin).toBeLessThan(atFeed);
  });
});

describe('the barrels', () => {
  it('wind up while the trigger is held and unwind faster when it is let go', () => {
    const r = rig();
    const spinUpTicks = Math.ceil(DEFAULT_STREAK_CONFIG.chopperSpinUpSeconds / DT);
    r.hold(Btn.Fire, spinUpTicks);
    expect(r.chopper.spin).toBe(1);

    // Released: 1.6 times the rate up, so well under half the spin-up gets it to zero.
    r.hold(0, Math.ceil(spinUpTicks / 1.6) + 1);
    expect(r.chopper.spin).toBe(0);
  });

  it('does not shoot until the barrels are turning', () => {
    const r = rig();
    // The gate is spin > 0.2, which takes a fifth of the spin-up.
    r.hold(Btn.Fire, 2);
    expect(r.chopper.spin).toBeLessThan(0.2);
    expect(r.chopper.shotsFired).toBe(0);
    r.hold(Btn.Fire, Math.ceil(DEFAULT_STREAK_CONFIG.chopperSpinUpSeconds / DT));
    expect(r.chopper.shotsFired).toBeGreaterThan(0);
  });

  it('shakes the camera with the spin, and only once it is turning', () => {
    const quiet = rig();
    quiet.hold(0, 10);
    expect(quiet.shakes).toEqual([]);

    const firing = rig();
    firing.hold(Btn.Fire, 60);
    expect(firing.shakes.length).toBeGreaterThan(0);
    for (const amount of firing.shakes) expect(amount).toBeGreaterThanOrEqual(0.02);
  });
});

describe('the optic', () => {
  it('eases toward the zoom while ADS is held rather than cutting to it', () => {
    const r = rig();
    r.hold(Btn.Ads, 1);
    const afterOne = r.chopper.zoom;
    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThan(1);
    r.hold(Btn.Ads, 120);
    expect(r.chopper.zoom).toBeCloseTo(1, 5);
  });

  it('eases back when the button is let go: held, not toggled', () => {
    const r = rig();
    r.hold(Btn.Ads, 120);
    r.hold(0, 1);
    expect(r.chopper.zoom).toBeLessThan(1);
    r.hold(0, 200);
    expect(r.chopper.zoom).toBeCloseTo(0, 5);
  });

  it('reports the lens through the view, between the wide and the zoomed FOV', () => {
    const r = rig();
    const view = makeChopperView();
    expect(r.chopper.activeView(view)).toBe(true);
    expect(view.fov).toBe(55);

    r.hold(Btn.Ads, 200);
    r.chopper.activeView(view);
    expect(view.fov).toBeCloseTo(22, 3);
  });
});

describe('the view and the orbit', () => {
  it('starts on the owner’s side of the map, at the configured height and radius', () => {
    const a = rig('A');
    const b = rig('B');
    expect(a.chopper.y).toBe(DEFAULT_STREAK_CONFIG.chopperHeight);
    expect(Math.hypot(a.chopper.x, a.chopper.z)).toBeCloseTo(
      DEFAULT_STREAK_CONFIG.chopperOrbitRadius,
      6,
    );
    // Opposite halves: the two start a half-turn apart.
    expect(Math.sign(a.chopper.x)).not.toBe(Math.sign(b.chopper.x));
  });

  it('keeps to the orbit radius as it goes round', () => {
    const r = rig();
    r.hold(0, 120);
    expect(Math.hypot(r.chopper.x, r.chopper.z)).toBeCloseTo(
      DEFAULT_STREAK_CONFIG.chopperOrbitRadius,
      6,
    );
    expect(r.chopper.y).toBe(DEFAULT_STREAK_CONFIG.chopperHeight);
  });

  it('adopts the command’s yaw and clamps the pitch to a downward cone', () => {
    const r = rig();
    r.chopper.step(command(0, 1.2, 0.9));
    expect(r.chopper.yaw).toBe(1.2);
    // A gunship gun cannot point at the sky, nor straight down.
    expect(r.chopper.pitch).toBe(-6 * DEG2RAD);
    r.chopper.step(command(0, 1.2, -3));
    expect(r.chopper.pitch).toBe(-80 * DEG2RAD);
  });

  it('fills the view with its own pose', () => {
    const r = rig();
    r.hold(0, 30);
    const view = makeChopperView();
    expect(r.chopper.activeView(view)).toBe(true);
    expect(view.x).toBe(r.chopper.x);
    expect(view.y).toBe(r.chopper.y);
    expect(view.z).toBe(r.chopper.z);
    expect(view.yaw).toBe(r.chopper.yaw);
    expect(view.pitch).toBe(r.chopper.pitch);
  });
});

describe('the single exit', () => {
  it('stops reporting a view, and is idempotent', () => {
    const r = rig();
    r.hold(Btn.Fire | Btn.Ads, 60);
    expect(r.chopper.isRestored).toBe(false);

    r.chopper.onExpire();
    expect(r.chopper.isRestored).toBe(true);
    expect(r.chopper.spin).toBe(0);
    expect(r.chopper.zoom).toBe(0);
    expect(r.chopper.reloadTimer).toBe(0);
    expect(r.chopper.activeView(makeChopperView())).toBe(false);

    // Called again from any of the four situations `StreakSystem` calls it in: no second undo.
    r.chopper.onExpire();
    expect(r.chopper.isRestored).toBe(true);
    expect(r.chopper.activeView(makeChopperView())).toBe(false);
  });

  it('lives its def’s duration', () => {
    const r = rig();
    const ticks = Math.round(streakDef('chopper').durationSeconds / DT);
    expect(r.hold(0, ticks)).toBe(true);
    expect(r.hold(0, 1)).toBe(false);
  });

  it('reports the belt, the spin and the hit rate for the debug panel', () => {
    const r = rig();
    expect(r.chopper.describe()).toContain('50/50');
    expect(r.chopper.describe()).toContain('(—%)');
    expect(r.chopper.describe()).toContain('spin 0%');

    let guard = 0;
    while (!r.chopper.reloading && guard++ < 2000) r.hold(Btn.Fire, 1);
    expect(r.chopper.describe()).toContain('FEED');
  });
});
