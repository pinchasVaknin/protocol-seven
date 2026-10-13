import { describe, expect, it } from 'vitest';
import type { BotDirector } from '../ai/BotDirector';
import type { BotTeam, Combatant } from '../ai/Combatant';
import { DEFAULT_TIERS } from '../ai/DifficultyTiers';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { installClock } from '../core/Clock';
import { createGameBus, EV } from '../core/Events';
import type { InputCommand } from '../core/InputCommand';
import { SIM_HZ } from '../core/Loop';
import { Rng } from '../core/Rng';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import type { MapDef } from '../world/maps/types';
import { CarePackage } from './CarePackage';
import { CarriedWeaponStreak } from './CarriedWeapon';
import { ChopperGunner } from './ChopperGunner';
import { SentryGun } from './SentryGun';
import {
  ALL_STREAK_IDS,
  STREAK_COOLDOWN_SECONDS,
  streakDef,
  type StreakId,
} from './StreakDefs';
import { SILENT_PRESENTATION } from './StreakPresentation';
import { StreakSystem } from './StreakSystem';

/**
 * The economy wired to the world, pinned (A17).
 *
 * `StreakEconomy.test.ts` holds the wallet on its own. These hold what `StreakSystem` adds to it:
 * the Hardline discount and its floor, the debit at the one door, the cooldown armed as an
 * estimate and replaced by the fact, the concurrency rule, the four events, and the care
 * package's payout in kills.
 *
 * **The part that earns the file**: which streaks a death takes down and which it leaves. That is
 * the one rule A17 moves out of two `instanceof` checks and onto `StreakDef.endsWithOwnersLife`,
 * and the four cases below are the whole of its behaviour — so they are written against the
 * original code first and must not move.
 *
 * The real `StreakLedger`, the real `ScoreSystem` and a real `DamageSystem` throughout: the
 * questions asked here are about how the three agree.
 */

// `StreakSystem.simulate` times itself, as every simulation step does.
let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const OWNER = 1;
const VICTIM = 2;

function body(entityId: number, team: BotTeam, px = 0, pz = 0) {
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

const NEUTRAL_COMMAND: InputCommand = {
  seq: 0,
  tickIndex: 0,
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: -0.35,
  buttons: 0,
  sampledAtMs: 0,
};

interface RigOptions {
  readonly discount?: (entityId: number) => number;
  readonly equipped?: (entityId: number) => readonly StreakId[];
  readonly reportProgressTo?: (entityId: number) => boolean;
}

function rig(roster: ReturnType<typeof body>[], options: RigOptions = {}) {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  for (const b of roster) score.register(b.entityId, b.displayName, b.team);

  const activated: { streakId: string; instanceId: number }[] = [];
  const expired: { streakId: string; instanceId: number }[] = [];
  const earned: { streakId: string; requirement: number }[] = [];
  const progress: { streak: number; nextId: string | null; requirement: number }[] = [];
  bus.on(EV.StreakActivated, (p) => activated.push({ streakId: p.streakId, instanceId: p.instanceId }));
  bus.on(EV.StreakExpired, (p) => expired.push({ streakId: p.streakId, instanceId: p.instanceId }));
  bus.on(EV.StreakEarned, (p) => earned.push({ streakId: p.streakId, requirement: p.requirement }));
  bus.on(EV.StreakProgress, (p) =>
    progress.push({ streak: p.streak, nextId: p.nextId, requirement: p.requirement }),
  );

  const system = new StreakSystem({
    bus,
    score,
    roster: roster as unknown as Combatant[],
    context: {
      bus,
      world: world(),
      damage: new DamageSystem(bus),
      bots: {} as BotDirector,
      present: SILENT_PRESENTATION,
      mapDef: {} as MapDef,
      cfg: DEFAULT_STREAK_CONFIG_REF,
      rng: new Rng(4),
      tiers: DEFAULT_TIERS,
      roster: roster as unknown as Combatant[],
      freeForAll: false,
    },
    targetable: () => true,
    visibleToUav: () => true,
    streakDiscount: options.discount ?? (() => 0),
    reportProgressTo: options.reportProgressTo ?? (() => true),
    commandFor: () => NEUTRAL_COMMAND,
    equippedStreaks: options.equipped ?? (() => ALL_STREAK_IDS),
  });

  let tick = 0;
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) system.simulate(++tick);
  };
  /** The tick the system last stepped, which is the clock `activate` reads. */
  const at = (): number => tick;
  return { system, bus, score, run, at, activated, expired, earned, progress };
}

// Imported through a reference so the rig reads the shipped config rather than a copy of it.
import { DEFAULT_STREAK_CONFIG as DEFAULT_STREAK_CONFIG_REF } from './StreakDefs';

describe('what a streak costs', () => {
  it('is the def’s requirement when nothing discounts it', () => {
    const r = rig([body(OWNER, 'A')]);
    expect(r.system.priceOf('uav', OWNER)).toBe(streakDef('uav').requirement);
    expect(r.system.priceOf('chopper', OWNER)).toBe(12);
  });

  it('is reduced by Hardline, and never below one', () => {
    const r = rig([body(OWNER, 'A')], { discount: () => 1 });
    expect(r.system.priceOf('uav', OWNER)).toBe(3);

    const huge = rig([body(OWNER, 'A')], { discount: () => 99 });
    // A free streak would fire on the first kill of every life, which is not what a discount is.
    expect(huge.system.priceOf('uav', OWNER)).toBe(1);
    expect(huge.system.priceOf('chopper', OWNER)).toBe(1);
  });
});

describe('buying one', () => {
  it('refuses when the balance cannot cover it, and puts nothing in the world', () => {
    const r = rig([body(OWNER, 'A')]);
    expect(r.system.activate(OWNER, 'uav', 0, 0, 0, 0)).toBe(null);
    expect(r.system.active).toHaveLength(0);
    expect(r.activated).toEqual([]);
  });

  it('refuses an entity that is not on the roster', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(99, 'uav');
    expect(r.system.activate(99, 'uav', 0, 0, 0, 0)).toBe(null);
  });

  it('debits the price, puts it in the world and announces it', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'uav');
    expect(r.system.balanceOf(OWNER)).toBe(4);

    const streak = r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    expect(streak).not.toBe(null);
    expect(r.system.balanceOf(OWNER)).toBe(0);
    expect(r.system.active).toHaveLength(1);
    expect(r.activated).toEqual([{ streakId: 'uav', instanceId: 1 }]);
  });

  it('numbers each activation, so two sentries are distinguishable', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'uav');
    r.system.debugGrant(OWNER, 'sentry');
    r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    r.system.activate(OWNER, 'sentry', 0, 0, 0, 0);
    expect(r.activated.map((a) => a.instanceId)).toEqual([1, 2]);
  });

  it('builds the right class for every shipped id', () => {
    const expected: Array<[StreakId, string]> = [
      ['uav', 'Uav'],
      ['counter_uav', 'CounterUav'],
      ['care_package', 'CarePackage'],
      ['mortar', 'MortarStrike'],
      ['sentry', 'SentryGun'],
      ['chopper', 'ChopperGunner'],
      ['minigun', 'CarriedWeaponStreak'],
      ['flamethrower', 'CarriedWeaponStreak'],
      ['shield', 'CarriedWeaponStreak'],
    ];
    for (const [id, className] of expected) {
      const r = rig([body(OWNER, 'A')]);
      r.system.debugGrant(OWNER, id);
      const streak = r.system.activate(OWNER, id, 0, 0, 0, 0);
      expect(streak?.constructor.name).toBe(className);
      expect(streak?.def.id).toBe(id);
    }
  });

  it('refuses a second of the same streak while the first is still up', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'uav');
    r.system.debugGrant(OWNER, 'uav');
    expect(r.system.activate(OWNER, 'uav', 0, 0, 0, 0)).not.toBe(null);
    // Paid for twice, and still refused: the rule is about the world, not the wallet.
    expect(r.system.balanceOf(OWNER)).toBe(4);
    expect(r.system.activate(OWNER, 'uav', 0, 0, 0, 0)).toBe(null);
    expect(r.system.active).toHaveLength(1);
    expect(r.system.economyReport().refusedLive).toBe(1);
  });

  it('counts a refusal at the one door rather than losing it', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    expect(r.system.economyReport().refusedUnaffordable).toBe(1);
  });

  it('can only buy what the entity has equipped', () => {
    const r = rig([body(OWNER, 'A')], { equipped: () => ['uav'] });
    r.system.debugGrant(OWNER, 'sentry');
    // The wallet has eight in it and the sentry is not on the keys.
    expect(r.system.canAfford(OWNER, 'sentry')).toBe(true);
    expect(r.system.nextFor(OWNER)).toBe(null);
    expect(r.system.pricesFor(OWNER).map((p) => p.id)).toEqual(['uav']);
  });
});

describe('the cooldown', () => {
  it('is armed at activation as the duration plus the cooldown', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'uav');
    r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    // Thirty seconds of UAV and thirty of cooldown, from the first frame.
    expect(r.system.lockoutSecondsFor(OWNER, 'uav')).toBeCloseTo(
      streakDef('uav').durationSeconds + STREAK_COOLDOWN_SECONDS,
      5,
    );
  });

  it('is nothing for a streak that has never been bought', () => {
    const r = rig([body(OWNER, 'A')]);
    expect(r.system.lockoutSecondsFor(OWNER, 'uav')).toBe(0);
    expect(r.system.lockoutsFor(OWNER)).toEqual([]);
  });

  it('is replaced by the fact when the streak leaves early', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'sentry');
    r.system.activate(OWNER, 'sentry', 0, 0, 0, 0);
    r.run(60);
    const estimate = r.system.lockoutSecondsFor(OWNER, 'sentry');
    expect(estimate).toBeGreaterThan(STREAK_COOLDOWN_SECONDS);

    // Ended now rather than in ninety seconds: the wait is the cooldown alone.
    r.system.endAll();
    expect(r.system.lockoutSecondsFor(OWNER, 'sentry')).toBeCloseTo(STREAK_COOLDOWN_SECONDS, 5);
  });

  it('is not re-armed for a streak whose effect ended at the press', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'mortar');
    r.system.activate(OWNER, 'mortar', 0, 0, 0, 0);
    // A mortar's effect is over at the keypress, so the cooldown is the thirty seconds alone
    // and retiring the barrage sixty seconds later must not restart it.
    const atActivation = r.system.lockoutSecondsFor(OWNER, 'mortar');
    expect(atActivation).toBeCloseTo(STREAK_COOLDOWN_SECONDS, 5);
    r.run(30);
    r.system.endAll();
    expect(r.system.lockoutSecondsFor(OWNER, 'mortar')).toBeLessThan(STREAK_COOLDOWN_SECONDS);
  });

  it('lists what is locked out for the debug panel, in seconds', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'uav');
    r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    const locked = r.system.lockoutsFor(OWNER);
    expect(locked).toHaveLength(1);
    expect(locked[0]?.id).toBe('uav');
    expect(locked[0]?.seconds).toBeGreaterThan(0);
  });
});

describe('what the next streak is', () => {
  it('is the cheapest thing the balance cannot reach yet', () => {
    const r = rig([body(OWNER, 'A')]);
    expect(r.system.nextFor(OWNER)?.def.id).toBe('uav');
    r.system.debugGrant(OWNER, 'uav');
    // Four banked: the UAV and the shield are both affordable, so the next is the five.
    expect(r.system.nextFor(OWNER)?.def.id).toBe('counter_uav');
  });

  it('goes back up after a purchase, because the money is gone', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'sentry');
    const before = r.system.nextFor(OWNER);
    r.system.activate(OWNER, 'sentry', 0, 0, 0, 0);
    const after = r.system.nextFor(OWNER);
    expect(r.system.balanceOf(OWNER)).toBe(0);
    expect(after?.price).toBeLessThan(before?.price ?? Infinity);
    expect(after?.def.id).toBe('uav');
  });

  it('does not skip a streak that is only on cooldown', () => {
    const r = rig([body(OWNER, 'A')], { equipped: () => ['uav'] });
    r.system.debugGrant(OWNER, 'uav');
    r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    // Cooling, unaffordable, and still the thing progress is measured toward.
    expect(r.system.nextFor(OWNER)?.def.id).toBe('uav');
  });

  it('is null when everything equipped is already affordable', () => {
    const r = rig([body(OWNER, 'A')], { equipped: () => ['uav'] });
    r.system.debugGrant(OWNER, 'uav');
    expect(r.system.nextFor(OWNER)).toBe(null);
  });
});

describe('earning and announcing', () => {
  it('banks the score’s own count and announces what it just made affordable', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    for (let i = 0; i < 4; i++) {
      r.score.recordKill(OWNER, VICTIM, false, 100);
      r.bus.emit(EV.EntityKilled, {
        targetId: VICTIM,
        sourceId: OWNER,
        weaponId: 'ar_default',
        zone: 'torso',
        killerHealth: 200,
      });
    }
    expect(r.system.balanceOf(OWNER)).toBe(4);
    expect(r.earned.map((e) => e.streakId)).toContain('uav');
    expect(r.earned.filter((e) => e.streakId === 'uav')).toHaveLength(1);
  });

  it('announces a streak once per purchase cycle, not once per kill', () => {
    const r = rig([body(OWNER, 'A'), body(VICTIM, 'B')]);
    for (let i = 0; i < 6; i++) {
      r.score.recordKill(OWNER, VICTIM, false, 100);
      r.bus.emit(EV.EntityKilled, {
        targetId: VICTIM,
        sourceId: OWNER,
        weaponId: 'ar_default',
        zone: 'torso',
        killerHealth: 200,
      });
    }
    // Six kills, the UAV affordable from the fourth: announced once.
    expect(r.earned.filter((e) => e.streakId === 'uav')).toHaveLength(1);
  });

  it('announces the discounted price, so nothing downstream knows about a perk', () => {
    const r = rig([body(OWNER, 'A'), body(VICTIM, 'B')], { discount: () => 1 });
    for (let i = 0; i < 3; i++) {
      r.score.recordKill(OWNER, VICTIM, false, 100);
      r.bus.emit(EV.EntityKilled, {
        targetId: VICTIM,
        sourceId: OWNER,
        weaponId: 'ar_default',
        zone: 'torso',
        killerHealth: 200,
      });
    }
    expect(r.earned.find((e) => e.streakId === 'uav')?.requirement).toBe(3);
  });

  it('publishes the balance and what it is short of', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.creditKills(OWNER, 2);
    const last = r.progress[r.progress.length - 1];
    expect(last?.streak).toBe(2);
    expect(last?.nextId).toBe('uav');
    expect(last?.requirement).toBe(4);
  });

  it('publishes nothing for an entity nobody is watching', () => {
    const r = rig([body(OWNER, 'A')], { reportProgressTo: () => false });
    r.system.creditKills(OWNER, 2);
    expect(r.progress).toEqual([]);
  });

  it('credits nobody for killing themselves', () => {
    const r = rig([body(OWNER, 'A')]);
    r.bus.emit(EV.EntityKilled, {
      targetId: OWNER,
      sourceId: OWNER,
      weaponId: 'ar_default',
      zone: 'torso',
      killerHealth: 0,
    });
    expect(r.system.balanceOf(OWNER)).toBe(0);
  });

  it('drops a credit aimed at a body that is already dead', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner]);
    owner.health.setReplicated(0, false);
    r.system.creditKills(OWNER, 5);
    expect(r.system.balanceOf(OWNER)).toBe(0);
    expect(r.system.economyReport().postMortemKills).toBe(5);
  });
});

describe('a claimed care package', () => {
  it('pays its contents’ price into the claimant’s wallet', () => {
    const r = rig([body(OWNER, 'A')]);
    r.bus.emit(EV.CarePackageClaimed, {
      packageId: 1,
      entityId: OWNER,
      team: 'A',
      streakId: 'sentry',
      name: 'SENTRY GUN',
    });
    // The roll's price in kills, not the streak itself: one currency, no dead drops.
    expect(r.system.balanceOf(OWNER)).toBe(streakDef('sentry').requirement);
  });
});

describe('what a death takes down, and what it leaves', () => {
  /** Kill `entityId` the way the match does: the health first, then the event. */
  function kill(r: ReturnType<typeof rig>, victim: ReturnType<typeof body>): void {
    victim.health.setReplicated(0, false);
    r.bus.emit(EV.EntityKilled, {
      targetId: victim.entityId,
      sourceId: VICTIM,
      weaponId: 'ar_default',
      zone: 'torso',
      killerHealth: 200,
    });
  }

  it('zeroes the balance', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    r.system.creditKills(OWNER, 9);
    kill(r, owner);
    expect(r.system.balanceOf(OWNER)).toBe(0);
  });

  it('brings the owner’s chopper down', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    r.system.debugGrant(OWNER, 'chopper');
    const chopper = r.system.activate(OWNER, 'chopper', 0, 0, 0, 0);
    expect(chopper).toBeInstanceOf(ChopperGunner);

    kill(r, owner);
    expect(r.system.active).toHaveLength(0);
    expect((chopper as ChopperGunner).isRestored).toBe(true);
    expect(r.expired.map((e) => e.streakId)).toEqual(['chopper']);
  });

  it('takes the weapon out of the owner’s hands', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    r.system.debugGrant(OWNER, 'minigun');
    const held = r.system.activate(OWNER, 'minigun', 0, 0, 0, 0);
    expect(held).toBeInstanceOf(CarriedWeaponStreak);
    expect(r.system.carriedWeaponFor(OWNER)?.id).toBe('streak_minigun');

    kill(r, owner);
    // It does not drop, and it is not waiting in the hands of the life that comes next.
    expect(r.system.carriedWeaponFor(OWNER)).toBe(null);
    expect(r.system.active).toHaveLength(0);
  });

  it('leaves a sentry the owner placed standing', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    r.system.debugGrant(OWNER, 'sentry');
    r.system.activate(OWNER, 'sentry', 0, 0, 0, 0);

    kill(r, owner);
    // A placed object outlives its owner's death: it does not care who put it there.
    expect(r.system.active).toHaveLength(1);
    expect(r.system.sentries()).toHaveLength(1);
    expect(r.expired).toEqual([]);
  });

  it('leaves a care package the owner dropped on the floor', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    r.system.debugGrant(OWNER, 'care_package');
    r.system.activate(OWNER, 'care_package', 0, 0, 0, 0);

    kill(r, owner);
    expect(r.system.packages()).toHaveLength(1);
    expect(r.expired).toEqual([]);
  });

  it('leaves a UAV, a Counter-UAV and a mortar running', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    for (const id of ['uav', 'counter_uav', 'mortar'] as StreakId[]) {
      r.system.debugGrant(OWNER, id);
      r.system.activate(OWNER, id, 0, 0, 0, 0);
    }
    expect(r.system.active).toHaveLength(3);

    kill(r, owner);
    expect(r.system.active).toHaveLength(3);
    expect(r.expired).toEqual([]);
  });

  it('touches nobody else’s streaks', () => {
    const owner = body(OWNER, 'A');
    const other = body(VICTIM, 'B');
    const r = rig([owner, other]);
    r.system.debugGrant(VICTIM, 'chopper');
    r.system.activate(VICTIM, 'chopper', 0, 0, 0, 0);

    kill(r, owner);
    expect(r.system.active).toHaveLength(1);
  });
});

describe('an owner who leaves the match', () => {
  it('goes down the same path as a death, and forgets the row as well', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    r.system.debugGrant(OWNER, 'chopper');
    r.system.activate(OWNER, 'chopper', 0, 0, 0, 0);
    r.system.creditKills(OWNER, 5);

    r.system.onOwnerRemoved(OWNER);
    expect(r.system.active).toHaveLength(0);
    expect(r.system.balanceOf(OWNER)).toBe(0);
    // The row goes too: a departed player is not coming back and needs no anchor.
    expect(r.system.lockoutSecondsFor(OWNER, 'chopper')).toBe(0);
  });

  it('leaves what they placed, exactly as a death does', () => {
    const owner = body(OWNER, 'A');
    const r = rig([owner, body(VICTIM, 'B')]);
    r.system.debugGrant(OWNER, 'sentry');
    r.system.activate(OWNER, 'sentry', 0, 0, 0, 0);
    r.system.onOwnerRemoved(OWNER);
    expect(r.system.sentries()).toHaveLength(1);
  });
});

describe('the loop and the world queries', () => {
  it('retires a streak the tick its duration runs out, and says so', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'uav');
    r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    r.run(Math.round(streakDef('uav').durationSeconds * SIM_HZ));
    expect(r.system.active).toHaveLength(1);
    r.run(1);
    expect(r.system.active).toHaveLength(0);
    expect(r.expired).toEqual([{ streakId: 'uav', instanceId: 1 }]);
  });

  it('marks a retired streak expired before its own hook runs', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'care_package');
    const pack = r.system.activate(OWNER, 'care_package', 0, 0, 0, 0);
    r.system.endAll();
    expect(pack?.phase).toBe('EXPIRED');
    // An expired package stops offering itself to bots.
    expect((pack as CarePackage).objectiveTarget()).toBe(null);
  });

  it('steps every live streak without the loop skipping a neighbour', () => {
    const r = rig([body(OWNER, 'A')]);
    for (const id of ['uav', 'counter_uav', 'sentry'] as StreakId[]) {
      r.system.debugGrant(OWNER, id);
      r.system.activate(OWNER, id, 0, 0, 0, 0);
    }
    r.run(5);
    expect(r.system.active).toHaveLength(3);
    for (const streak of r.system.active) expect(streak.age).toBeGreaterThan(0);
  });

  it('times itself', () => {
    const r = rig([body(OWNER, 'A')]);
    r.run(1);
    expect(r.system.lastMs).toBeGreaterThanOrEqual(0);
  });

  it('answers the per-tick world questions off the live list', () => {
    const r = rig([body(OWNER, 'A')]);
    expect(r.system.uavFor('A')).toBe(null);
    expect(r.system.minimapScrambledFor('A')).toBe(false);
    expect(r.system.activeChopperFor(OWNER)).toBe(null);
    expect(r.system.carriedWeaponFor(OWNER)).toBe(null);

    r.system.debugGrant(OWNER, 'uav');
    r.system.activate(OWNER, 'uav', 0, 0, 0, 0);
    expect(r.system.uavFor('A')).not.toBe(null);
    // A UAV benefits its owner's team and nobody else's.
    expect(r.system.uavFor('B')).toBe(null);

    r.system.debugGrant(OWNER, 'counter_uav');
    r.system.activate(OWNER, 'counter_uav', 0, 0, 0, 0);
    // A Counter-UAV scrambles the other side, not its own.
    expect(r.system.minimapScrambledFor('B')).toBe(true);
    expect(r.system.minimapScrambledFor('A')).toBe(false);
  });

  it('reports the UAV contact fade from the config', () => {
    const r = rig([body(OWNER, 'A')]);
    expect(r.system.contactFadeSeconds).toBe(DEFAULT_STREAK_CONFIG_REF.uavContactFadeSeconds);
  });

  it('ends everything on the end of a match', () => {
    const r = rig([body(OWNER, 'A')]);
    for (const id of ['uav', 'sentry'] as StreakId[]) {
      r.system.debugGrant(OWNER, id);
      r.system.activate(OWNER, id, 0, 0, 0, 0);
    }
    r.bus.emit(EV.MatchEnded, {
      reason: 'scoreLimit',
      winner: 'A',
      scoreA: 1,
      scoreB: 0,
      localWon: true,
    });
    expect(r.system.active).toHaveLength(0);
    expect(r.expired).toHaveLength(2);
  });
});

describe('the sentry tally', () => {
  it('keeps a sentry’s counters after it has left the world', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'sentry');
    const sentry = r.system.activate(OWNER, 'sentry', 0, 0, 0, 0) as SentryGun;
    r.run(5);
    expect(r.system.sentryReport().placed).toBe(1);

    r.system.endAll();
    // Folded at retire, so the harness can sample it long after the sentry expired.
    const report = r.system.sentryReport();
    expect(report.placed).toBe(1);
    expect(report.shotsFired).toBe(sentry.shotsFired);
    expect(r.system.sentries()).toHaveLength(0);
  });

  it('adds the live ones to the retired ones', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'sentry');
    r.system.activate(OWNER, 'sentry', 0, 0, 0, 0);
    r.system.endAll();
    // Past the cooldown the retire armed, or the second one is refused rather than placed.
    r.run(Math.round(STREAK_COOLDOWN_SECONDS * SIM_HZ) + 1);
    r.system.debugGrant(OWNER, 'sentry');
    expect(r.system.activate(OWNER, 'sentry', 20, 0, 0, 0)).not.toBe(null);
    expect(r.system.sentryReport().placed).toBe(2);
  });
});

describe('care packages as objectives', () => {
  it('offers nothing when there is no crate down', () => {
    const r = rig([body(OWNER, 'A')]);
    expect(r.system.assign(body(VICTIM, 'B') as unknown as Combatant)).toBe(null);
  });

  it('offers a landed crate to a bot near it', () => {
    // The owner stands well clear: at the drop point they would claim their own crate.
    const r = rig([body(OWNER, 'A', 50, 50)]);
    r.system.debugGrant(OWNER, 'care_package');
    r.system.activate(OWNER, 'care_package', 0, 0, 0, 0);
    // Still falling: a bot sprinting to stand under a crate is standing in the open for nothing.
    expect(r.system.assign(body(VICTIM, 'B', 2, 2) as unknown as Combatant)).toBe(null);

    r.run(400);
    const target = r.system.assign(body(VICTIM, 'B', 2, 2) as unknown as Combatant);
    expect(target?.label).toBe('PACKAGE');
    expect(target?.action).toBe('collect');
  });

  it('is not worth crossing a map for', () => {
    const r = rig([body(OWNER, 'A', 50, 50)]);
    r.system.debugGrant(OWNER, 'care_package');
    r.system.activate(OWNER, 'care_package', 0, 0, 0, 0);
    r.run(400);
    expect(r.system.assign(body(VICTIM, 'B', 60, 60) as unknown as Combatant)).toBe(null);
  });

  it('offers the nearest of two', () => {
    // Two owners, because the concurrency rule is per owner: one player cannot have two crates
    // on the floor at once however long they wait, and that is a rule about the world.
    const second = 3;
    const r = rig([body(OWNER, 'A', 50, 50), body(second, 'A', 50, -50)]);
    r.system.debugGrant(OWNER, 'care_package');
    r.system.activate(OWNER, 'care_package', 0, 0, 0, 0);
    r.system.debugGrant(second, 'care_package');
    expect(r.system.activate(second, 'care_package', 20, 0, 0, 0)).not.toBe(null);
    r.run(400);
    expect(r.system.packages()).toHaveLength(2);
    const target = r.system.assign(body(VICTIM, 'B', 18, 0) as unknown as Combatant);
    expect(target?.x).toBe(20);
  });
});

describe('disposal', () => {
  it('ends every streak and clears the ledger', () => {
    const r = rig([body(OWNER, 'A')]);
    r.system.debugGrant(OWNER, 'chopper');
    r.system.activate(OWNER, 'chopper', 0, 0, 0, 0);
    r.system.dispose();
    expect(r.system.active).toHaveLength(0);
    expect(r.system.balanceOf(OWNER)).toBe(0);
  });
});
