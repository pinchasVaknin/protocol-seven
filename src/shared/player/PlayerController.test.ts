import { describe, expect, it } from 'vitest';
import { createGameBus, EV } from '../core/Events';
import { Btn, type MutableInputCommand } from '../core/InputCommand';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { DEFAULT_MOVEMENT_CONFIG } from './MovementConfig';
import { PlayerController } from './PlayerController';
import { makePlayerSimState, savePlayerSim } from './PlayerState';

/**
 * One InputCommand in, one tick of a player out.
 *
 * Everything that decides *what* the player is doing is in this class, and all of it runs on
 * every tick for the local player, for every bot, on the server, and again inside `Prediction`
 * when a correction replays. So the risk here is not that a rule is wrong — the rules are
 * asserted below — it is that the **order** of the rules changes. Gravity before the stance
 * machine, the speed cap before acceleration, the air cap latched before the collision pass
 * rather than after: each of those orderings is load-bearing, none of them is visible in a
 * single rule's test, and getting one wrong is a desync that only shows up as a correction
 * that will not converge.
 *
 * Hence the last test in this file. A fixed four-hundred-tick script through a built world,
 * pinning every field of the final `PlayerSimState` and a running hash of the pose. It is the
 * local, fast version of what `npm run hashrun` does for the whole simulation, and it is the
 * assertion that the seventeen steps of `step()` still happen in the order they happen in.
 */

const CFG = DEFAULT_MOVEMENT_CONFIG;

/** A world with a 400 m floor whose top is exactly y = 0, plus whatever the case adds. */
function rig(build: (set: ColliderSet) => void = () => {}) {
  const set = new ColliderSet(6);
  set.add({ x: 0, y: -1, z: 0 }, { x: 400, y: 2, z: 400 }, 0, 0, 0, 'concrete');
  build(set);
  const world = new CollisionWorld(
    set,
    { min: { x: -200, y: -8, z: -200 }, max: { x: 200, y: 24, z: 200 } },
    8,
  );
  world.configure(CFG.maxSlopeDeg, CFG.collisionSkin);

  const bus = createGameBus();
  const events: string[] = [];
  bus.on(EV.PlayerSpawned, () => events.push('spawn'));
  bus.on(EV.PlayerJumped, () => events.push('jump'));
  bus.on(EV.PlayerLanded, (p) => events.push(`land:${p.impactSpeed.toFixed(3)}`));
  bus.on(EV.PlayerStanceChanged, (p) => events.push(`stance:${p.from}>${p.to}`));
  bus.on(EV.PlayerFootstep, (p) =>
    events.push(`step:${p.heavy ? 'h' : '-'}${p.quiet ? 'q' : '-'}`),
  );
  bus.on(EV.PlayerSlideStarted, () => events.push('slide+'));
  bus.on(EV.PlayerSlideEnded, (p) => events.push(`slide-${p.reason}`));
  bus.on(EV.PlayerMantleStarted, () => events.push('mantle+'));
  bus.on(EV.PlayerMantleEnded, () => events.push('mantle-'));

  const player = new PlayerController({ ...CFG }, world, bus);
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

  /** One tick. `moveZ: 1` is forward, and a yaw of 0 means forward is -z. */
  const step = (buttons = 0, moveZ = 0, moveX = 0, yaw = 0): void => {
    cmd.seq = tick;
    cmd.tickIndex = tick;
    cmd.buttons = buttons;
    cmd.moveZ = moveZ;
    cmd.moveX = moveX;
    cmd.yaw = yaw;
    cmd.sampledAtMs = tick * (1000 / 60);
    player.step(cmd);
    tick++;
  };
  const hold = (ticks: number, buttons = 0, moveZ = 0, moveX = 0, yaw = 0): void => {
    for (let i = 0; i < ticks; i++) step(buttons, moveZ, moveX, yaw);
  };
  /** Spawn, fall the 20 cm onto the floor, settle, and forget the events it took. */
  const settle = (): void => {
    player.spawn(0, 0.2, 0, 0);
    hold(10);
    events.length = 0;
  };
  const footsteps = (): number => events.filter((e) => e.startsWith('step')).length;

  return { player, step, hold, settle, footsteps, events, sim: player.sim };
}

describe('spawning', () => {
  it('puts the body down, announces it, and primes both snapshots', () => {
    const r = rig();
    r.player.spawn(3, 1, -4, 1.5);
    expect(r.events).toEqual(['spawn']);
    expect([r.sim.x, r.sim.y, r.sim.z, r.sim.yaw]).toEqual([3, 1, -4, 1.5]);
    expect(r.sim.stance).toBe('STAND');
    // `prev` and `curr` both describe the spawn, so the first frame interpolates from rest
    // rather than from wherever the last life ended.
    expect(r.player.curr.x).toBe(3);
    expect(r.player.prev.x).toBe(3);
    expect(r.player.curr.stance).toBe('STAND');
  });

  it('lands and settles on the floor without drifting', () => {
    const r = rig();
    r.settle();
    expect(r.sim.y).toBe(7.979727989493313e-17);
    expect(r.sim.stance).toBe('STAND');
    expect(r.sim.grounded).toBe(true);
  });
});

describe('walking and jumping', () => {
  it('walks forward at the walk cap', () => {
    const r = rig();
    r.settle();
    r.hold(5, 0, 1);
    // A yaw of 0 looks down -z, so forward is -z.
    expect(r.sim.z).toBe(-0.24333333333333335);
    expect(r.sim.speed).toBe(CFG.walkSpeed);
    // Walking, so the cap for the tick is the walk cap: the sprint cap is only offered to a
    // body that is holding sprint and moving forward.
    expect(r.player.currentSpeedCap).toBe(CFG.walkSpeed);
  });

  it('jumps on the press, leaves the ground, and latches the air cap', () => {
    const r = rig();
    r.settle();
    r.hold(5, 0, 1);
    r.step(Btn.Jump, 1);
    // The impulse less one tick of gravity, which is applied in the same tick.
    expect(r.sim.vy).toBe(5.548076606885378);
    expect(r.sim.grounded).toBe(false);
    expect(r.sim.stance).toBe('AIRBORNE');
    expect(r.sim.jumpedThisTick).toBe(true);
    // Latched at take-off at no less than sprint speed, which is what stops the Quake
    // air-strafe from compounding speed every jump.
    expect(r.sim.airSpeedCap).toBe(CFG.sprintSpeed);
  });

  it('lands once, back on its feet, and reports the impact', () => {
    const r = rig();
    r.settle();
    r.hold(5, 0, 1);
    r.step(Btn.Jump, 1);
    let landTick = -1;
    let landings = 0;
    for (let i = 0; i < 90; i++) {
      r.step(0, 1);
      if (r.sim.justLanded) {
        landings++;
        if (landTick < 0) landTick = i;
      }
    }
    expect(landTick).toBe(37);
    expect(landings).toBe(1);
    expect(r.sim.stance).toBe('STAND');
    expect(r.sim.landImpact).toBe(5.851923393114618);
    expect(r.events.slice(0, 4)).toEqual([
      'stance:STAND>AIRBORNE',
      'jump',
      'stance:AIRBORNE>STAND',
      'land:5.852',
    ]);
  });

  it('keeps a coyote window after the ground goes away', () => {
    const r = rig((set) => set.add({ x: 0, y: 0.5, z: -3 }, { x: 8, y: 1, z: 4 }, 0, 0, 0, 'concrete'));
    r.settle();
    r.hold(40, 0, 1);
    // Walked onto the deck and then off it, still attached by ground snap, so the window is
    // full rather than counting down.
    expect(r.sim.grounded).toBe(true);
    expect(r.sim.coyote).toBe(CFG.coyoteTime);
  });
});

describe('crouching', () => {
  it('shrinks the capsule, drops the cap, and damps the eye down', () => {
    const r = rig();
    r.settle();
    r.step(Btn.Crouch);
    expect(r.sim.stance).toBe('CROUCH');
    expect(r.sim.capsuleHeight).toBe(CFG.crouchHeight);
    expect(r.player.currentSpeedCap).toBe(CFG.crouchSpeed);
    // The eye chases rather than snapping, so one tick is most of the way there and not all.
    expect(r.sim.eyeHeight).toBe(1.486149836855254);
    expect(r.sim.eyeHeight).toBeGreaterThan(CFG.crouchEye);
    expect(r.sim.eyeHeight).toBeLessThan(CFG.standEye);
  });

  it('stands straight back up in the open', () => {
    const r = rig();
    r.settle();
    r.step(Btn.Crouch);
    r.step(0);
    expect(r.sim.stance).toBe('STAND');
    expect(r.sim.capsuleHeight).toBe(CFG.standHeight);
  });

  it('refuses to stand up inside a vent, and refuses to jump out of one', () => {
    // A soffit from 1.4 m up: blocked, not clipped (S5.3).
    const r = rig((set) => set.add({ x: 0, y: 1.7, z: -4 }, { x: 6, y: 0.6, z: 4 }, 0, 0, 0, 'concrete'));
    r.settle();
    r.hold(100, Btn.Crouch, 1);
    expect(r.sim.z).toBe(-4.623333333333343);
    expect(r.sim.stance).toBe('CROUCH');

    // Crouch released, and the body stays down because the taller capsule does not fit.
    r.step(0, 0);
    expect(r.sim.stance).toBe('CROUCH');
    // And a jump is refused for the same reason, rather than launching through the ceiling.
    r.step(Btn.Jump, 0);
    expect(r.sim.stance).toBe('CROUCH');
    expect(r.sim.vy).toBe(0);
    expect(r.sim.grounded).toBe(true);
    expect(r.events).not.toContain('jump');
  });

  it('is held down by an interaction as well as by the key', () => {
    // Planting and defusing use `forceCrouch`: folded into the *held* test, so every rule that
    // governs crouching still applies.
    const r = rig();
    r.settle();
    r.player.forceCrouch = true;
    r.step(0, 0);
    expect(r.sim.stance).toBe('CROUCH');
    expect(r.player.currentSpeedCap).toBe(CFG.crouchSpeed);
    r.player.forceCrouch = false;
    r.step(0, 0);
    expect(r.sim.stance).toBe('STAND');
  });
});

describe('sprinting', () => {
  it('runs at the sprint cap while forward is held', () => {
    const r = rig();
    r.settle();
    r.hold(40, Btn.Sprint, 1);
    expect(r.sim.sprintActive).toBe(true);
    expect(r.sim.sprintHeldTime).toBe(0.6666666666666671);
    expect(r.player.currentSpeedCap).toBe(CFG.sprintSpeed);
    expect(r.sim.speed).toBe(CFG.sprintSpeed);
  });

  it('is not a sprint backwards', () => {
    const r = rig();
    r.settle();
    r.hold(30, Btn.Sprint, -1);
    expect(r.sim.sprintActive).toBe(false);
    expect(r.player.currentSpeedCap).toBe(CFG.walkSpeed);
    // The hold timer never starts either, so no slide can be requested out of it.
    expect(r.sim.sprintHeldTime).toBe(0);
  });

  it('ends on the trigger and on the sights, which is what starts the sprint-to-fire timer', () => {
    const ads = rig();
    ads.settle();
    ads.hold(30, Btn.Sprint, 1);
    ads.step(Btn.Sprint | Btn.Ads, 1);
    expect(ads.sim.sprintActive).toBe(false);
    expect(ads.player.currentSpeedCap).toBe(CFG.adsSpeed);

    const fire = rig();
    fire.settle();
    fire.hold(30, Btn.Sprint, 1);
    fire.step(Btn.Sprint | Btn.Fire, 1);
    expect(fire.sim.sprintActive).toBe(false);
    // Holding shift into a gunfight is not free: the cap drops back to walking.
    expect(fire.player.currentSpeedCap).toBe(CFG.walkSpeed);
  });
});

describe('tactical sprint', () => {
  it('starts on a double tap inside the window', () => {
    const r = rig();
    r.settle();
    r.step(Btn.Sprint, 1);
    r.step(0, 1);
    r.step(Btn.Sprint, 1);
    expect(r.sim.tacSprintActive).toBe(true);
    expect(r.player.currentSpeedCap).toBe(CFG.tacSprintSpeed);
  });

  it('does not start on a second press outside the window', () => {
    const r = rig();
    r.settle();
    r.step(Btn.Sprint, 1);
    r.hold(30, 0, 1);
    r.step(Btn.Sprint, 1);
    expect(r.sim.tacSprintActive).toBe(false);
  });

  it('holds its speed for the duration, then decays back to sprint and takes a cooldown', () => {
    const r = rig();
    r.settle();
    r.step(Btn.Sprint, 1);
    r.step(0, 1);
    r.step(Btn.Sprint, 1);
    r.hold(80, Btn.Sprint, 1);
    expect(r.sim.tacSprintActive).toBe(true);
    expect(r.sim.speed).toBe(CFG.tacSprintSpeed);

    r.hold(40, Btn.Sprint, 1);
    expect(r.sim.tacSprintActive).toBe(false);
    expect(r.sim.tacSprintCooldown).toBe(4.8500000000000005);
    expect(r.player.currentSpeedCap).toBe(CFG.sprintSpeed);
  });
});

describe('sliding', () => {
  it('starts on crouch pressed while sprinting, above the start speed', () => {
    const r = rig();
    r.settle();
    r.hold(30, Btn.Sprint, 1);
    r.step(Btn.Sprint | Btn.Crouch, 1);
    expect(r.sim.slideActive).toBe(true);
    expect(r.sim.stance).toBe('SLIDE');
    // A burst above sprint speed, which is the point of it.
    expect(r.sim.slideSpeed).toBe(8);
    expect(r.player.currentSpeedCap).toBe(8);
    expect(r.player.currentSpeedCap).toBeGreaterThan(CFG.sprintSpeed);
  });

  it('bleeds off and ends on its own, paying both penalties', () => {
    const r = rig();
    r.settle();
    r.hold(30, Btn.Sprint, 1);
    r.step(Btn.Sprint | Btn.Crouch, 1);
    r.hold(5, Btn.Sprint, 1);
    expect(r.sim.slideActive).toBe(true);
    expect(r.sim.speed).toBe(7.942329873125721);

    r.hold(60, Btn.Sprint, 1);
    expect(r.sim.slideActive).toBe(false);
    expect(r.sim.stance).toBe('STAND');
    // Both LOCKED penalties, applied by the one exit route.
    expect(r.sim.tacLockout).toBe(1.033333333333334);
    expect(r.sim.slideCooldown).toBe(0.983333333333334);
    expect(r.events).toContain('slide+');
    expect(r.events).toContain('slide-expired');
  });

  it('is quiet, and its footsteps say so', () => {
    const r = rig();
    r.settle();
    r.hold(30, Btn.Sprint, 1);
    r.step(Btn.Sprint | Btn.Crouch, 1);
    r.hold(20, Btn.Sprint, 1);
    // Heavy because it is fast, quiet because the body is low: both flags on one footstep.
    expect(r.events).toContain('step:hq');
  });
});

describe('free-cam', () => {
  it('flies where it is looking, collides with nothing, and makes no noise', () => {
    const r = rig();
    r.settle();
    r.player.noclip = true;
    r.step(0, 1);
    expect(r.sim.z).toBe(-0.16666666666666666);
    expect(r.sim.grounded).toBe(false);
    // Velocity is written even though nothing integrates it, because the speedometer, the
    // overlay and the audio listener all read `sim.speed`.
    expect(r.sim.speed).toBe(10);
    expect(r.sim.eyeHeight).toBe(CFG.standEye);

    r.step(Btn.Sprint, 1);
    expect(r.sim.speed).toBe(40);
    r.step(Btn.Ads, 1);
    expect(r.sim.speed).toBe(2.5);

    // Up and down are the world vertical regardless of pitch.
    r.step(Btn.Jump, 0);
    expect(r.sim.vy).toBe(10);
    r.step(Btn.Crouch, 0);
    expect(r.sim.vy).toBe(-10);

    // A spectator makes no noise: no footsteps, no landings, no stance changes.
    expect(r.events).toEqual([]);
  });
});

describe('the weapon in the hands and the perk on the legs', () => {
  it('multiplies both scales into every ground cap', () => {
    const r = rig();
    r.settle();
    r.player.weaponSpeedScale = 0.8;
    r.player.speedScale = 1.07;
    r.hold(40, Btn.Sprint, 1);
    // 6.9 * 1.07 * 0.8. Multiplied, never added.
    expect(r.player.currentSpeedCap).toBe(5.9064000000000005);
    expect(r.sim.speed).toBe(5.9064000000000005);
  });

  it('floors the airborne cap at sprint speed in the weapon, and not in the perk', () => {
    const r = rig();
    r.settle();
    r.player.weaponSpeedScale = 0.8;
    r.player.speedScale = 2;
    r.step(Btn.Jump, 0);
    // Air control can reach the floor from a standstill, so without it a jump would be the way
    // out from under a heavy weapon. The perk is deliberately not in it.
    expect(r.sim.airSpeedCap).toBe(CFG.sprintSpeed * 0.8);
  });
});

describe('footstep cadence', () => {
  it('tracks distance travelled, so faster is more often and crouching is fewer', () => {
    const walk = rig();
    walk.settle();
    walk.hold(120, 0, 1);

    const sprint = rig();
    sprint.settle();
    sprint.hold(120, Btn.Sprint, 1);

    const crouch = rig();
    crouch.settle();
    crouch.hold(120, Btn.Crouch, 1);

    // Two seconds at each: the cadence is distance over stride, and a crouch takes a longer
    // stride at a lower speed.
    expect(walk.footsteps()).toBe(8);
    expect(sprint.footsteps()).toBe(11);
    expect(crouch.footsteps()).toBe(3);
  });
});

describe('four hundred ticks of a fixed script', () => {
  /**
   * The order-of-operations test.
   *
   * A hundred-tick loop of sprint, slide, jump, strafe, crouch and fire, over a floor, a 0.3 m
   * step, a 1 m deck and a wall, run four times. Nothing here is a rule — every rule has its own
   * test above — and that is the point: this asserts that the rules still *compose* the way they
   * do, which is the property a decomposition of `step()` can break without breaking any single
   * rule.
   *
   * The hash folds the pose of every one of the four hundred ticks, so a divergence on tick 7
   * fails here even if tick 400 happens to agree. The state is every field reconciliation
   * replays from.
   */
  it('ends on the same tick, in the same place, with the same timers', () => {
    const r = rig((set) => {
      set.add({ x: 0, y: 0.15, z: -6 }, { x: 8, y: 0.3, z: 2 }, 0, 0, 0, 'concrete');
      set.add({ x: 0, y: 0.5, z: -14 }, { x: 8, y: 1.0, z: 2 }, 0, 0, 0, 'metal');
      set.add({ x: 6, y: 1.5, z: -20 }, { x: 0.5, y: 3, z: 12 }, 0, 0, 0, 'concrete');
    });
    r.settle();

    let hash = 0;
    for (let tick = 0; tick < 400; tick++) {
      const phase = tick % 100;
      let buttons = 0;
      let moveZ = 1;
      let moveX = 0;
      if (phase < 30) buttons = Btn.Sprint;
      else if (phase === 30) buttons = Btn.Sprint | Btn.Crouch;
      else if (phase < 50) buttons = Btn.Sprint;
      else if (phase === 50) buttons = Btn.Jump;
      else if (phase < 70) {
        moveX = 1;
      } else if (phase < 85) {
        buttons = Btn.Crouch;
        moveX = -1;
      } else {
        buttons = Btn.Sprint | Btn.Fire;
      }
      r.step(buttons, moveZ, moveX, (tick % 200) * 0.01);
      hash = (hash * 31 + Math.round((r.sim.x + r.sim.y * 7 + r.sim.z * 13) * 1e6)) | 0;
    }

    expect(hash).toBe(-540812349);

    const state = makePlayerSimState();
    savePlayerSim(r.sim, state);
    expect(state).toEqual({
      x: -28.615616073912438,
      y: 8.933825901280557e-17,
      z: -27.069946062692186,
      vx: -4.201701462169635,
      vy: 0,
      vz: 1.8723527506326207,
      yaw: 1.99,
      pitch: 0,
      stance: 'STAND',
      grounded: true,
      wasGrounded: true,
      groundNx: 0,
      groundNy: 1,
      groundNz: 0,
      groundMaterial: 0,
      capsuleHeight: 1.8,
      eyeHeight: 1.649998227044794,
      sprintActive: false,
      sprintHeldTime: 0.19999999999999998,
      tacSprintActive: false,
      tacSprintElapsed: 0,
      tacSprintCooldown: 0,
      tacLockout: 0.43333333333333274,
      lastSprintPressTick: 10,
      slideActive: false,
      slideElapsed: 0,
      slideCooldown: 0.3833333333333325,
      slideDirX: -0.9717869232971598,
      slideDirZ: -0.23586050052656182,
      slideSpeed: 7.077277970011534,
      slideAirTime: 0,
      coyote: 0.08,
      jumpBuffer: 0,
      jumpedThisTick: false,
      airSpeedCap: 7.077277970011534,
      mantleActive: false,
      mantleElapsed: 0,
      mantleFromX: 0,
      mantleFromY: 0,
      mantleFromZ: 0,
      mantleToX: 0,
      mantleToY: 0,
      mantleToZ: 0,
      mantleDirX: 0,
      mantleDirZ: 0,
      mantleEndStance: 'STAND',
      mantleCooldown: 0,
      prevButtons: 20,
      tick: 409,
      bobPhase: 0.9936193069844164,
      distanceSinceStep: 0.07666666666666665,
      landImpact: 5.551923393114619,
      justLanded: false,
      blockedHorizontally: false,
      steppedUp: false,
    });
  });

  it('emits the same events, in the same proportions', () => {
    const r = rig((set) => {
      set.add({ x: 0, y: 0.15, z: -6 }, { x: 8, y: 0.3, z: 2 }, 0, 0, 0, 'concrete');
      set.add({ x: 0, y: 0.5, z: -14 }, { x: 8, y: 1.0, z: 2 }, 0, 0, 0, 'metal');
      set.add({ x: 6, y: 1.5, z: -20 }, { x: 0.5, y: 3, z: 12 }, 0, 0, 0, 'concrete');
    });
    r.settle();
    for (let tick = 0; tick < 400; tick++) {
      const phase = tick % 100;
      let buttons = 0;
      let moveZ = 1;
      let moveX = 0;
      if (phase < 30) buttons = Btn.Sprint;
      else if (phase === 30) buttons = Btn.Sprint | Btn.Crouch;
      else if (phase < 50) buttons = Btn.Sprint;
      else if (phase === 50) buttons = Btn.Jump;
      else if (phase < 70) {
        moveX = 1;
      } else if (phase < 85) {
        buttons = Btn.Crouch;
        moveX = -1;
      } else {
        buttons = Btn.Sprint | Btn.Fire;
      }
      r.step(buttons, moveZ, moveX, (tick % 200) * 0.01);
    }

    const tally: Record<string, number> = {};
    for (const event of r.events) {
      const key = event.split(':')[0] ?? event;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    // Four laps, so four of everything the lap does once: a slide, a jump-cancel out of it, the
    // jump that cancelled it, and the landing.
    expect(r.events.length).toBe(48);
    expect(tally).toEqual({
      step: 24,
      'slide+': 4,
      'slide-jumpCancel': 4,
      jump: 4,
      land: 4,
      stance: 8,
    });
  });
});
