import { describe, expect, it } from 'vitest';
import { installClock } from '../core/Clock';
import { createGameBus, EV } from '../core/Events';
import { Btn, type MutableInputCommand } from '../core/InputCommand';
import { DamageSystem, type Damageable } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { DEFAULT_HEALTH_CONFIG, Health } from '../player/Health';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { PlayerSim } from '../player/PlayerState';
import { flamethrowerWeapon } from '../streaks/StreakWeapons';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { DEFAULT_VIEWMODEL_CONFIG } from './ViewmodelConfig';
import { AR_DEFAULT, requireWeapon } from './WeaponDefs';
import { handsOffWeapon, WeaponSystem, type WeaponSnapshot } from './WeaponSystem';

/**
 * The seam between "the player pressed a button" and "a round landed".
 *
 * `step` reads one command and drives six machines in a fixed order — the swap, the weapon,
 * the idle, the recoil, the scope, the spread — and then fires whatever the trigger queued.
 * The order is load-bearing and invisible: the swap runs first so the weapon that steps is the
 * right one, the spread is computed before the shots so every pellet of a tick shares it, and
 * the recoil is sampled *before* this shot's kick so the first round out of a rested weapon is
 * dead on the crosshair.
 *
 * The gating is the other half, and it is where a bug costs a match rather than a frame.
 * `fireBlocked` behaves exactly like a trigger nobody pulled — no dry click, no auto reload,
 * and releasing during the block does not queue a shot for when it lifts — because the
 * alternative shipped once: a player cooking a grenade with the fire button was also emptying
 * a hidden rifle at whatever they were looking at, on the machine whose hits count.
 *
 * The last test is a three-hundred-tick script. Nothing in it is a rule; it asserts that the
 * rules still compose, which is what a decomposition of `step` and `fireOne` can break without
 * breaking any single rule.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const CFG = DEFAULT_MOVEMENT_CONFIG;
const SHOOTER = 1;
const PISTOL = requireWeapon('pistol_talon');

function dummy(entityId: number, x: number, z: number, team?: 'A' | 'B'): Damageable {
  const rig = new HitboxRig();
  rig.setTransform(x, 0, z, 0);
  return {
    entityId,
    displayName: `t${entityId}`,
    health: new Health({ ...DEFAULT_HEALTH_CONFIG }),
    rig,
    team,
  };
}

function rig(
  def = AR_DEFAULT,
  secondary: typeof AR_DEFAULT | null = PISTOL,
  build: (set: ColliderSet) => void = () => {},
) {
  const set = new ColliderSet(6);
  set.add({ x: 0, y: -1, z: 0 }, { x: 400, y: 2, z: 400 }, 0, 0, 0, 'concrete');
  build(set);
  const world = new CollisionWorld(set, { min: { x: -200, y: -8, z: -200 }, max: { x: 200, y: 24, z: 200 } }, 8);
  world.configure(CFG.maxSlopeDeg, CFG.collisionSkin);

  const bus = createGameBus();
  const fired: string[] = [];
  /** Where each round actually went, which is what a different seed changes. */
  const ends: number[] = [];
  const events: string[] = [];
  bus.on(EV.WeaponFired, (p) =>
    fired.push(
      `${p.weaponId}/${p.shotIndex}/${p.spreadDeg.toFixed(4)}/${p.tracer ? 't' : '-'}/${
        p.hitTarget ? 'h' : '-'
      }/${p.pellets}/${p.pelletsHit}`,
    ),
  );
  bus.on(EV.WeaponFired, (p) => ends.push(p.endX));
  bus.on(EV.WeaponDryFired, () => events.push('dry'));
  bus.on(EV.WeaponReloadStarted, (p) => events.push(`reload+${p.empty ? 'e' : 't'}`));
  bus.on(EV.WeaponReloadFinished, () => events.push('reload-'));
  bus.on(EV.WeaponAdsChanged, (p) => events.push(`ads:${p.aiming}`));

  const damage = new DamageSystem(bus);
  damage.register(dummy(SHOOTER, 0, 0, 'A'));
  const system = new WeaponSystem(
    def,
    secondary,
    world,
    damage,
    bus,
    DEFAULT_VIEWMODEL_CONFIG,
    CFG.walkSpeed,
    SHOOTER,
  );
  system.reseed(0x51e5_0b0a);

  const sim = new PlayerSim();
  sim.eyeHeight = 1.65;
  sim.grounded = true;

  const cmd: MutableInputCommand = {
    seq: 0,
    tickIndex: 0,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    sampledAtMs: 0,
  };
  let tick = 0;
  const step = (buttons = 0): void => {
    cmd.seq = tick;
    cmd.tickIndex = tick;
    cmd.buttons = buttons;
    cmd.sampledAtMs = tick * (1000 / 60);
    system.step(cmd, sim);
    tick++;
  };
  const hold = (ticks: number, buttons = 0): void => {
    for (let i = 0; i < ticks; i++) step(buttons);
  };
  /** Let the weapon come up and forget the events it took. */
  const raise = (): void => {
    hold(30);
    events.length = 0;
    fired.length = 0;
    ends.length = 0;
  };
  return { system, step, hold, raise, fired, ends, events, sim, damage };
}

/** A wall 20 m down the lane, so a miss terminates somewhere knowable. */
const backstop = (set: ColliderSet): void => {
  set.add({ x: 0, y: 1.5, z: -20 }, { x: 40, y: 3, z: 0.5 }, 0, 0, 0, 'concrete');
};

describe('the weapon coming up', () => {
  it('starts raised, and a sprint is what takes it down', () => {
    const r = rig();
    // `raise` is the single authority for whether the weapon can fire, and a spawned weapon
    // is up: there is no separate "animation finished" flag to be out of step with it.
    expect(r.system.weapon.raise).toBe(1);
    expect(r.system.weapon.canFire).toBe(true);
    r.step(Btn.Fire);
    expect(r.fired.length).toBe(1);

    r.sim.sprintActive = true;
    r.hold(30);
    expect(r.system.weapon.raise).toBe(0);
    expect(r.system.weapon.canFire).toBe(false);
    r.fired.length = 0;
    r.hold(10, Btn.Fire);
    expect(r.fired).toEqual([]);
  });
});

describe('what the trigger is allowed to do', () => {
  it('behaves exactly like a trigger nobody pulled while the hands are busy', () => {
    const r = rig();
    r.raise();
    r.system.fireBlocked = true;
    r.hold(10, Btn.Fire);
    // No round, no dry click, no auto reload, and the magazine untouched.
    expect(r.fired).toEqual([]);
    expect(r.events).toEqual([]);
    expect(r.system.weapon.mag).toBe(30);
  });

  it('takes the sights too when the player is absent, which a busy hand does not', () => {
    const r = rig();
    r.raise();
    r.system.suspended = true;
    r.hold(10, Btn.Fire | Btn.Ads);
    expect(r.fired).toEqual([]);
    expect(r.system.weapon.adsFraction).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('does not resume a held trigger when the block lifts', () => {
    const r = rig();
    r.raise();
    r.system.suspended = true;
    r.hold(5, Btn.Fire);
    r.system.suspended = false;
    r.hold(5, Btn.Fire);
    // The trigger was down when the block began, so it stays off until it is let go.
    expect(r.fired).toEqual([]);
    r.hold(2, 0);
    r.hold(5, Btn.Fire);
    expect(r.fired.length).toBe(1);
  });
});

describe('the reload input', () => {
  it('is refused while a sprint has the hands, and taken once it does not', () => {
    const r = rig();
    r.raise();
    r.hold(10, Btn.Fire);
    r.events.length = 0;

    r.sim.sprintActive = true;
    r.hold(2, Btn.Reload);
    // A refused reload looks like a key nobody pressed: no event, no viewmodel twitch, and no
    // snapshot carrying `EFlag.Reloading` to everybody else.
    expect(r.events).toEqual([]);
    expect(r.system.weapon.reloading).toBe(false);

    r.sim.sprintActive = false;
    r.hold(2, 0);
    r.hold(2, Btn.Reload);
    expect(r.events).toEqual(['reload+t']);
    expect(r.system.weapon.reloading).toBe(true);
    expect(r.system.weapon.mag).toBe(28);

    r.hold(200, 0);
    expect(r.events).toEqual(['reload+t', 'reload-']);
    expect(r.system.weapon.mag).toBe(30);
    expect(r.system.weapon.reserve).toBe(238);
  });

  it('is blocked by a slide too, which does not lower the weapon', () => {
    const r = rig();
    r.raise();
    r.hold(10, Btn.Fire);
    r.events.length = 0;
    r.sim.slideActive = true;
    r.hold(2, Btn.Reload);
    expect(r.events).toEqual([]);
    // Firing mid-slide is legal, which is the whole reason the reload needed its own flag.
    expect(r.system.weapon.raise).toBe(1);
  });
});

describe('aiming', () => {
  it('comes up to the sights and announces it once', () => {
    const r = rig();
    r.raise();
    r.hold(30, Btn.Ads);
    expect(r.system.weapon.adsFraction).toBe(1);
    expect(r.events).toEqual(['ads:true']);
  });

  it('is dropped by a sprint, along with the weapon', () => {
    const r = rig();
    r.raise();
    r.hold(30, Btn.Ads);
    r.sim.sprintActive = true;
    r.hold(30, Btn.Ads);
    expect(r.system.weapon.adsFraction).toBe(0);
    expect(r.system.weapon.raise).toBe(0);
  });
});

describe('the swap machine', () => {
  it('runs first, so the weapon that steps is the one the keys chose', () => {
    const r = rig();
    r.raise();
    expect(r.system.definition.id).toBe('ar_carbine');
    r.step(Btn.SwapWeapon);
    r.hold(60);
    expect(r.system.definition.id).toBe('pistol_talon');
    expect(r.system.weapon.raise).toBe(1);
    // The slot keys reach the same machine.
    r.step(Btn.Slot1);
    r.hold(60);
    expect(r.system.definition.id).toBe('ar_carbine');
  });

  it('will not let a carried killstreak weapon be put away', () => {
    // It is not in the loadout, and the keys that reach the loadout must not reach it: a
    // player who could swap back would be holding a streak in a slot of their choosing.
    const r = rig(flamethrowerWeapon(), PISTOL);
    r.raise();
    expect(r.system.definition.id).toBe('streak_flamethrower');
    r.step(Btn.SwapWeapon);
    r.hold(60);
    // Pinned as it stands: the flamethrower's belt is already spent in this harness, which is
    // what `streakWeaponSpent` opens the keys back up for.
    expect(r.system.streakWeaponHeld).toBe(false);
    expect(r.system.definition.id).toBe('pistol_talon');
  });
});

describe('firing', () => {
  it('fires at the weapon rate, spending the magazine', () => {
    const r = rig(AR_DEFAULT, null, backstop);
    r.raise();
    r.hold(30, Btn.Fire);
    // 700 RPM is 5.14 ticks a shot, which is six rounds in thirty ticks and not five or seven.
    expect(r.fired.length).toBe(6);
    expect(r.system.weapon.mag).toBe(24);
    expect(r.system.spreadDeg).toBe(1.9);
  });

  it('walks the recoil pattern and draws a tracer about every third round', () => {
    const r = rig(AR_DEFAULT, null, backstop);
    r.raise();
    r.hold(30, Btn.Fire);
    expect(r.fired.slice(0, 3)).toEqual([
      'ar_carbine/0/1.9000/-/-/1/0',
      'ar_carbine/1/1.9000/-/-/1/0',
      'ar_carbine/2/1.9000/t/-/1/0',
    ]);
    // Counted rather than diced, so the spacing is even instead of clumping.
    expect(r.fired.filter((f) => f.includes('/t/')).length).toBe(2);
  });

  it('hands the unrecovered kick to the caller exactly once', () => {
    const r = rig(AR_DEFAULT, null, backstop);
    r.raise();
    r.hold(30, Btn.Fire);
    const residual = { yaw: 0, pitch: 0 };
    expect(r.system.takeViewResidual(residual)).toBe(true);
    expect(residual.yaw).toBe(-0.0005026548245743672);
    expect(residual.pitch).toBe(0.010251016828663497);
    // Taken means taken: the same kick must not reach the view twice.
    expect(r.system.takeViewResidual(residual)).toBe(false);
  });

  it('reports the zone and the damage of what it hit', () => {
    const r = rig(AR_DEFAULT, null, backstop);
    r.damage.register(dummy(7, 0, -10, 'B'));
    r.raise();
    r.hold(30, Btn.Fire);
    expect(r.system.lastPellets.count).toBe(1);
    expect(r.system.lastPellets.hits).toBe(1);
    expect(r.system.lastPellets.damage).toBe(51);
    expect(r.system.lastPellets.zones[0]).toBe('head');
  });

  it('runs the pellet loop for a shotgun, from one trigger pull', () => {
    const sg = rig(requireWeapon('shotgun_breacher'), null, backstop);
    sg.damage.register(dummy(7, 0, -6, 'B'));
    sg.raise();
    sg.step(Btn.Fire);
    // Eight pellets out of one round, five of which found the body six metres away.
    expect(sg.fired).toEqual(['shotgun_breacher/0/0.9000/-/h/8/5']);
    expect(sg.system.lastPellets.count).toBe(8);
    expect(sg.system.lastPellets.hits).toBe(5);
  });
});

describe('per-event seeding', () => {
  it('gives the same tick, the same salt and the same shot the same spread', () => {
    const a = rig(AR_DEFAULT, null, backstop);
    const b = rig(AR_DEFAULT, null, backstop);
    a.raise();
    b.raise();
    a.hold(5, Btn.Fire);
    b.hold(5, Btn.Fire);
    // S4.14: everything random about a shot is decided from one seed, so a client replaying a
    // correction and the server that sent it produce the same round.
    expect(a.fired).toEqual(b.fired);
    expect(a.ends).toEqual(b.ends);
    expect(a.fired.length).toBe(1);
  });

  it('gives a different salt a different shot', () => {
    const a = rig(AR_DEFAULT, null, backstop);
    const c = rig(AR_DEFAULT, null, backstop);
    c.system.reseed(999);
    a.raise();
    c.raise();
    a.hold(5, Btn.Fire);
    c.hold(5, Btn.Fire);
    // The spread cone is the same; where the round inside it went is not.
    expect(c.fired).toEqual(a.fired);
    expect(c.ends).not.toEqual(a.ends);
  });
});

describe('the flamethrower', () => {
  it('burns what is in the cone and nothing past a wall', () => {
    const f = rig(flamethrowerWeapon(), null, (set) =>
      set.add({ x: 0, y: 1.5, z: -4 }, { x: 40, y: 3, z: 0.4 }, 0, 0, 0, 'concrete'),
    );
    const near = dummy(7, 0, -2, 'B');
    const behind = dummy(8, 0, -6, 'B');
    f.damage.register(near);
    f.damage.register(behind);
    f.hold(40);
    f.fired.length = 0;
    f.hold(10, Btn.Fire);

    expect(f.fired.length).toBe(2);
    expect(near.health.current).toBe(172);
    // The segment test is a plain line of sight: fire stops at the wall.
    expect(behind.health.current).toBe(DEFAULT_HEALTH_CONFIG.max);
  });

  it('emits a jet rather than a bullet: no tracer, one pellet, the cone as the spread', () => {
    const f = rig(flamethrowerWeapon(), null, (set) =>
      set.add({ x: 0, y: 1.5, z: -4 }, { x: 40, y: 3, z: 0.4 }, 0, 0, 0, 'concrete'),
    );
    f.damage.register(dummy(7, 0, -2, 'B'));
    f.hold(40);
    f.fired.length = 0;
    f.hold(10, Btn.Fire);
    // A bullet streak through the fire would read as a second weapon firing.
    expect(f.fired[0]).toBe('streak_flamethrower/0/16.0000/-/h/1/1');
    expect(f.system.lastPellets.count).toBe(1);
    expect(f.system.lastPellets.hits).toBe(1);
  });
});

describe('the render snapshot', () => {
  it('interpolates the visual state the view poses against', () => {
    const r = rig();
    r.hold(30, Btn.Ads);
    const out: WeaponSnapshot = {
      raise: 0,
      adsFraction: 0,
      visualPunch: 0,
      visualLateral: 0,
      aimPitch: 0,
      aimYaw: 0,
      reloadFraction: 0,
      swapFraction: 0,
    };
    r.system.sample(0.5, out);
    expect(out).toEqual({
      raise: 1,
      adsFraction: 1,
      visualPunch: 0,
      visualLateral: 0,
      aimPitch: 0,
      aimYaw: 0,
      reloadFraction: 0,
      swapFraction: 1,
    });
    expect(r.system.glinting).toBe(false);
    expect(r.system.laserVisible).toBe(false);
  });
});

describe('hands off the weapon', () => {
  it('is true for a busy hand and for the press that starts one', () => {
    expect(handsOffWeapon(0, 0, false, false)).toBe(false);
    expect(handsOffWeapon(0, 0, true, false)).toBe(true);
    expect(handsOffWeapon(0, 0, false, true)).toBe(true);
    // The presses are in the test because the thrower and the knife are stepped *after* the
    // weapon, so on the first tick of either the busy flag is still last tick's answer.
    expect(handsOffWeapon(Btn.Lethal, 0, false, false)).toBe(true);
    expect(handsOffWeapon(Btn.Tactical, 0, false, false)).toBe(true);
    expect(handsOffWeapon(Btn.Melee, 0, false, false)).toBe(true);
    // The knife is its rising edge only: held is not a new swing.
    expect(handsOffWeapon(Btn.Melee, Btn.Melee, false, false)).toBe(false);
  });
});

describe('three hundred ticks of a fixed script', () => {
  /**
   * Fire, reload, aim, aim-and-fire, swap, repeat — over a lane with a backstop, a plaster
   * partition and two bodies. The hash folds the weapon's observable state on every tick, so a
   * divergence on tick 12 fails here even if tick 300 happens to agree.
   */
  it('ends with the same rounds fired and the same weapon in hand', () => {
    const r = rig(AR_DEFAULT, PISTOL, (set) => {
      set.add({ x: 0, y: 1.5, z: -24 }, { x: 60, y: 3, z: 0.5 }, 0, 0, 0, 'concrete');
      set.add({ x: 4, y: 1.5, z: -12 }, { x: 0.2, y: 3, z: 8 }, 0, 0, 0, 'plaster');
    });
    r.damage.register(dummy(7, 0, -9, 'B'));
    r.damage.register(dummy(8, 3, -14, 'B'));

    let hash = 0;
    for (let tick = 0; tick < 300; tick++) {
      const phase = tick % 75;
      let buttons = 0;
      if (phase < 20) buttons = Btn.Fire;
      else if (phase === 25) buttons = Btn.Reload;
      else if (phase < 45) buttons = Btn.Ads;
      else if (phase < 60) buttons = Btn.Ads | Btn.Fire;
      else if (phase === 65) buttons = Btn.SwapWeapon;
      r.sim.yaw = (tick % 50) * 0.004;
      r.sim.pitch = -0.02;
      r.step(buttons);
      const w = r.system.weapon;
      hash =
        (hash * 31 +
          Math.round((w.mag + w.raise * 3 + w.adsFraction * 7 + r.system.spreadDeg * 11) * 1e4)) |
        0;
    }

    expect(hash).toBe(414023794);
    expect(r.fired.length).toBe(6);
    expect(r.system.definition.id).toBe('pistol_talon');
    expect(r.system.weapon.mag).toBe(10);
    expect(r.system.weapon.reserve).toBe(72);
    expect(r.system.spreadDeg).toBe(2.6);
    // Three reloads started and none finished: each is cancelled by the aim or the swap that
    // follows it in the script, which is the rule that a magazine change needs both hands.
    const tally: Record<string, number> = {};
    for (const event of r.events) {
      const key = event.split(':')[0] ?? event;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    expect(tally).toEqual({ 'reload+t': 3, ads: 2 });
  });
});
