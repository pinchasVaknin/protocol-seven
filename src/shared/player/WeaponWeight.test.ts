import { describe, expect, it } from 'vitest';
import { createGameBus } from '../core/Events';
import { Btn, type MutableInputCommand } from '../core/InputCommand';
import { Prediction } from '../net/Prediction';
import { flamethrowerWeapon, minigunWeapon, shieldPistolWeapon } from '../streaks/StreakWeapons';
import { heldMoveScale, requireWeapon } from '../weapons/WeaponDefs';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { DEFAULT_MOVEMENT_CONFIG } from './MovementConfig';
import { PlayerController } from './PlayerController';
import { makePlayerSimState, savePlayerSim } from './PlayerState';

/**
 * The weight of the weapon in the hands (2026-09-28).
 *
 * Three things have to hold for it to be a rule rather than a number: the table is the one that
 * was agreed, the controller turns it into the speeds a player feels, and a client correcting its
 * prediction replays with the weight each command was *stepped* with — the one input to movement
 * that lives in the weapon, which `Prediction` never replays.
 */

const CFG = DEFAULT_MOVEMENT_CONFIG;

describe('the table', () => {
  it('is the one that was agreed, class by class', () => {
    const expected: Record<string, number> = {
      pistol_talon: 1.05,
      smg_wasp: 1.05,
      smg_meridian: 1.05,
      shotgun_breacher: 1.05,
      ar_carbine: 1,
      ar_vulcan: 1,
      ar_halcyon: 1,
      ar_longbow: 1,
      sniper_vantage: 0.95,
      sniper_kestrel: 0.9,
      lmg_bastion: 0.9,
      lmg_monolith: 0.9,
    };
    for (const [id, mult] of Object.entries(expected)) {
      expect(heldMoveScale(requireWeapon(id), 0), id).toBe(mult);
    }
  });

  it('makes the killstreaks heavy, and the minigun heavier on the trigger', () => {
    expect(heldMoveScale(minigunWeapon(), 0)).toBe(0.8);
    expect(heldMoveScale(minigunWeapon(), Btn.Fire)).toBe(0.4);
    expect(heldMoveScale(flamethrowerWeapon(), 0)).toBe(0.95);
    expect(heldMoveScale(flamethrowerWeapon(), Btn.Fire)).toBe(0.95);
    expect(heldMoveScale(shieldPistolWeapon(), 0)).toBe(0.9);
    // Only a weapon that says so is slowed by firing it.
    expect(heldMoveScale(requireWeapon('lmg_monolith'), Btn.Fire)).toBe(0.9);
  });
});

function flatWorld(): CollisionWorld {
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 400, y: 2, z: 400 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(set, { min: { x: -200, y: -8, z: -200 }, max: { x: 200, y: 24, z: 200 } }, 8);
  world.configure(CFG.maxSlopeDeg, CFG.collisionSkin);
  return world;
}

function command(): MutableInputCommand {
  return { seq: 0, tickIndex: 0, moveX: 0, moveZ: 1, yaw: 0, pitch: 0, buttons: 0, sampledAtMs: 0 };
}

/** Steady speed after two seconds of holding `buttons` with `scale` in the hands. */
function steadySpeed(scale: number, buttons: number, perkScale = 1): number {
  const player = new PlayerController({ ...CFG }, flatWorld(), createGameBus());
  player.spawn(0, 0.2, 0, 0);
  player.speedScale = perkScale;
  const cmd = command();
  for (let t = 0; t < 120; t++) {
    cmd.seq = t;
    cmd.tickIndex = t;
    cmd.buttons = buttons;
    player.weaponSpeedScale = scale;
    player.step(cmd);
  }
  return player.sim.speed;
}

describe('the controller', () => {
  it('scales the walk and the sprint by the weapon, and the perk on top of it', () => {
    expect(steadySpeed(1, 0)).toBeCloseTo(CFG.walkSpeed, 3);
    expect(steadySpeed(0.9, 0)).toBeCloseTo(CFG.walkSpeed * 0.9, 3);
    expect(steadySpeed(1.05, Btn.Sprint)).toBeCloseTo(CFG.sprintSpeed * 1.05, 3);
    expect(steadySpeed(1.05, Btn.Sprint, 1.07)).toBeCloseTo(CFG.sprintSpeed * 1.05 * 1.07, 3);
  });

  it('holds a firing minigun to under a crouch', () => {
    const firing = steadySpeed(heldMoveScale(minigunWeapon(), Btn.Fire), Btn.Fire);
    expect(firing).toBeCloseTo(CFG.walkSpeed * 0.4, 3);
    expect(firing).toBeLessThan(CFG.crouchSpeed);
  });

  it('does not let a jump climb out from under the weight', () => {
    // Hop on every landing for three seconds with the minigun up. Air control used to be able to
    // reach the config's sprint speed from any walk, which made jumping the fast way to carry one.
    const player = new PlayerController({ ...CFG }, flatWorld(), createGameBus());
    player.spawn(0, 0.2, 0, 0);
    const cmd = command();
    let peak = 0;
    for (let t = 0; t < 180; t++) {
      cmd.seq = t;
      cmd.tickIndex = t;
      cmd.buttons = player.sim.grounded && t % 2 === 0 ? Btn.Jump : 0;
      player.weaponSpeedScale = 0.8;
      player.step(cmd);
      peak = Math.max(peak, player.sim.speed);
    }
    expect(peak).toBeLessThanOrEqual(CFG.sprintSpeed * 0.8 + 1e-6);
  });
});

describe('the prediction replay', () => {
  it('steps each command with the weight it was predicted with, not the one in the hands now', () => {
    const cmds: MutableInputCommand[] = [];
    for (let t = 0; t < 40; t++) cmds.push({ ...command(), seq: t, tickIndex: t });
    // A swap to the minigun ten ticks in, as both the client and the server saw it.
    const scaleAt = (t: number): number => (t < 10 ? 1 : 0.8);

    const server = new PlayerController({ ...CFG }, flatWorld(), createGameBus());
    server.spawn(0, 0.2, 0, 0);
    const client = new PlayerController({ ...CFG }, flatWorld(), createGameBus());
    client.spawn(0, 0.2, 0, 0);
    const prediction = new Prediction();

    const authoritative = makePlayerSimState();
    for (const cmd of cmds) {
      server.weaponSpeedScale = scaleAt(cmd.seq);
      server.step(cmd);
      if (cmd.seq === 5) savePlayerSim(server.sim, authoritative);
      client.weaponSpeedScale = scaleAt(cmd.seq);
      client.step(cmd);
      prediction.record(cmd, client);
    }

    // The ack for tick 5 arrives off by a centimetre, so the client must replay 6..39 — and by
    // then the hands hold something else again.
    authoritative.x += 0.01;
    client.weaponSpeedScale = 1.05;
    expect(prediction.reconcile(5, authoritative, client)).toBe(true);

    expect(client.sim.x).toBeCloseTo(server.sim.x + 0.01, 6);
    expect(client.sim.z).toBeCloseTo(server.sim.z, 6);
    expect(client.sim.speed).toBeCloseTo(server.sim.speed, 6);
    expect(client.sim.speed).toBeCloseTo(CFG.walkSpeed * 0.8, 3);
    // And the live weight is left as the caller set it, for the next real tick.
    expect(client.weaponSpeedScale).toBe(1.05);
  });
});
