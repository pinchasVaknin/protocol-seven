import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem } from '../combat/DamageSystem';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Rng } from '../core/Rng';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import { minigunWeapon } from './StreakWeapons';
import { CarriedWeaponStreak } from './CarriedWeapon';
import { CounterUav } from './CounterUav';
import { Killstreak, type StreakContext } from './KillstreakBase';
import { DEFAULT_STREAK_CONFIG, streakDef, type StreakDef } from './StreakDefs';
import { SILENT_PRESENTATION, type StreakPresentation } from './StreakPresentation';

/**
 * The contract every streak shares, and the two streaks that are almost nothing but it (A16).
 *
 * `Killstreak` is four hooks and one derived number, and the two defaults are load-bearing:
 * `onEarn` does nothing because earning and spending are different moments, and `onRender` does
 * nothing because most streaks have no per-frame presentation. A subclass that stopped being
 * able to rely on either would be a behaviour change nothing else would catch, so both are
 * pinned through a minimal subclass rather than through one of the real streaks.
 */

function context(present: StreakPresentation = SILENT_PRESENTATION): StreakContext {
  const bus = createGameBus();
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  return {
    bus,
    world: new CollisionWorld(set, { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } }, 8),
    damage: new DamageSystem(bus),
    bots: {} as BotDirector,
    present,
    mapDef: {} as MapDef,
    cfg: DEFAULT_STREAK_CONFIG,
    rng: new Rng(1),
    tiers: DEFAULT_TIERS,
    roster: [] as unknown as Combatant[],
    freeForAll: false,
    targetable: () => true,
    visibleToUav: () => true,
    nextEntityId: () => 900,
  };
}

/** The smallest thing the base class will accept: it ages and says so. */
class Probe extends Killstreak {
  activated = 0;
  expired = 0;

  override onActivate(): void {
    this.activated++;
  }

  override onTick(_tick: number): boolean {
    this.age += DT;
    return this.age < this.def.durationSeconds;
  }

  override onExpire(): void {
    this.expired++;
  }

  override describe(): string {
    return 'PROBE';
  }
}

function probe(durationSeconds: number): Probe {
  const def: StreakDef = { ...streakDef('uav'), durationSeconds };
  return new Probe(def, 7, 'B', 11, context());
}

describe('what every streak carries', () => {
  it('keeps the four facts it was handed, and starts live at age zero', () => {
    const p = probe(30);
    expect(p.ownerId).toBe(7);
    expect(p.ownerTeam).toBe('B');
    expect(p.instanceId).toBe(11);
    expect(p.phase).toBe('ACTIVE');
    expect(p.age).toBe(0);
  });

  it('counts down the seconds remaining, and never reports a negative one', () => {
    const p = probe(2);
    expect(p.secondsRemaining).toBe(2);
    for (let i = 0; i < 60; i++) p.onTick(i);
    expect(p.secondsRemaining).toBeCloseTo(1, 10);
    for (let i = 0; i < 300; i++) p.onTick(i);
    expect(p.secondsRemaining).toBe(0);
  });

  it('reports Infinity for a streak that ends on its own terms', () => {
    expect(probe(0).secondsRemaining).toBe(Infinity);
    expect(probe(-1).secondsRemaining).toBe(Infinity);
  });

  it('has nothing to say when it is earned, and nothing to draw per frame', () => {
    const p = probe(30);
    expect(() => p.onEarn()).not.toThrow();
    expect(() => p.onRender(0.016, 0.5)).not.toThrow();
    // Neither default may have become a lifecycle step of its own.
    expect(p.activated).toBe(0);
    expect(p.expired).toBe(0);
    expect(p.age).toBe(0);
  });
});

describe('a Counter-UAV', () => {
  it('announces itself once and then only ages', () => {
    const counters: number[] = [];
    const present: StreakPresentation = { ...SILENT_PRESENTATION, counterUav: () => counters.push(1) };
    const streak = new CounterUav(streakDef('counter_uav'), 1, 'A', 2, context(present));
    streak.onActivate();
    expect(counters).toEqual([1]);

    const ticks = Math.round(streakDef('counter_uav').durationSeconds / DT);
    let live = true;
    for (let i = 0; i < ticks; i++) live = streak.onTick(i);
    expect(live).toBe(true);
    expect(streak.onTick(ticks)).toBe(false);
    // Nothing owned: expiry is a no-op and the flag goes with the instance.
    expect(() => streak.onExpire()).not.toThrow();
    expect(counters).toEqual([1]);
  });

  it('names the team it is scrambling', () => {
    const a = new CounterUav(streakDef('counter_uav'), 1, 'A', 2, context());
    const b = new CounterUav(streakDef('counter_uav'), 1, 'B', 3, context());
    expect(a.describe()).toContain('scrambling team B');
    expect(b.describe()).toContain('scrambling team A');
  });
});

describe('a carried streak', () => {
  it('holds the weapon it was handed and puts it nowhere', () => {
    const weapon = minigunWeapon();
    const streak = new CarriedWeaponStreak(
      streakDef('minigun'),
      4,
      'A',
      6,
      context(),
      weapon,
    );
    expect(streak.carriedWeapon).toBe(weapon);
    // Both halves of the contract are deliberately empty: the hands are asked, never told.
    expect(() => streak.onActivate()).not.toThrow();
    expect(() => streak.onExpire()).not.toThrow();
  });

  it('ages on the sim tick and expires on its def’s duration', () => {
    const streak = new CarriedWeaponStreak(
      streakDef('minigun'),
      4,
      'A',
      6,
      context(),
      minigunWeapon(),
    );
    const ticks = Math.round(streakDef('minigun').durationSeconds / DT);
    let live = true;
    for (let i = 0; i < ticks; i++) live = streak.onTick(i);
    expect(live).toBe(true);
    expect(streak.onTick(ticks)).toBe(false);
  });

  it('reports its name, instance and owner', () => {
    const streak = new CarriedWeaponStreak(
      streakDef('minigun'),
      4,
      'A',
      6,
      context(),
      minigunWeapon(),
    );
    expect(streak.describe()).toBe(
      `${streakDef('minigun').name} #6 owner=4 ${streak.secondsRemaining.toFixed(1)}s left`,
    );
  });
});
