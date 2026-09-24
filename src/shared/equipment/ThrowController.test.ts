import { describe, expect, it, vi } from 'vitest';
import { Btn, type InputCommand } from '../core/InputCommand';
import { DT } from '../core/Loop';
import type { PlayerSim } from '../player/PlayerState';
import { equipmentDef } from './EquipmentDefs';
import type { EquipmentConfig } from './EquipmentConfig';
import type { EquipmentSystem } from './EquipmentSystem';
import { makeEquipmentInventory } from './EquipmentSystem';
import { ThrowController, THROW_FOLLOW_THROUGH, THROW_RELEASE_TIME } from './ThrowController';

/**
 * The grenade's state machine (the human's brief §2, 2026-09-24).
 *
 * The mechanic it replaced was one button: press to cook, release to throw, and the projectile
 * existed on the frame the button came up. The one below is four states and two buttons, and
 * three of its rules are the kind that are true until somebody edits the file next door:
 *
 *  - **drawing costs nothing.** A grenade taken out and put away is still in the inventory.
 *  - **the grenade leaves the hand `THROW_RELEASE_TIME` after the button, not on it** — the
 *    animation's length is a state in the simulation, because the server and the client have
 *    to agree about when a projectile exists.
 *  - **the fuse does not pause for the release.** It burns from the pin, through the swing,
 *    into the air; a frag cooked to the edge goes off in the hand rather than at the target.
 *
 * `EquipmentSystem` is a stub here on purpose. This is the input half of throwing, and what it
 * is being held to is *when* it calls `throwFrom` and with what cook — not what the projectile
 * then does, which `Projectile` and the harnesses own.
 */

function cmdWith(buttons: number): InputCommand {
  return { seq: 0, tickIndex: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons, sampledAtMs: 0 };
}

/** Only the six fields a throw reads off the body: where the hand is and how fast it is going. */
const SIM = { x: 0, y: 0, z: 0, vx: 0, vz: 0, eyeHeight: 1.6 } as PlayerSim;

function harness(lethal: 'frag' | 'smoke' = 'frag') {
  const thrown: { cooked: number; at: number }[] = [];
  let ticks = 0;
  const system = {
    throwFrom: vi.fn((_def, _id, _team, _x, _y, _z, _yaw, _pitch, _vx, _vz, cooked: number) => {
      thrown.push({ cooked, at: ticks });
      return {} as never;
    }),
  } as unknown as EquipmentSystem;
  const controller = new ThrowController(system, { beepInterval: 0.25 } as EquipmentConfig);
  const inv = makeEquipmentInventory(lethal, 'flashbang');
  const step = (buttons: number, count = 1): void => {
    for (let i = 0; i < count; i++) {
      controller.step(cmdWith(buttons), SIM, 1, inv, 'A', true);
      ticks++;
    }
  };
  return { controller, inv, step, thrown, seconds: (): number => ticks * DT };
}

const TICKS = (seconds: number): number => Math.ceil(seconds / DT);

describe('ThrowController', () => {
  it('draws on the equipment key without throwing or spending', () => {
    const h = harness();
    h.step(Btn.Lethal);
    expect(h.controller.phase).toBe('READY');
    expect(h.controller.busy).toBe(true);
    h.step(0, 30);
    expect(h.controller.phase).toBe('READY');
    expect(h.thrown).toHaveLength(0);
    expect(h.inv.lethalCount).toBe(equipmentDef('frag').count);
  });

  it('puts it away on the same key again, and on a weapon slot, costing nothing', () => {
    for (const away of [Btn.Lethal, Btn.Slot1, Btn.Slot2]) {
      const h = harness();
      h.step(Btn.Lethal);
      h.step(0);
      h.step(away);
      expect(h.controller.phase).toBe('IDLE');
      expect(h.controller.busy).toBe(false);
      expect(h.thrown).toHaveLength(0);
      expect(h.inv.lethalCount).toBe(equipmentDef('frag').count);
    }
  });

  it('swaps to the other slot rather than putting the first one away', () => {
    const h = harness();
    h.step(Btn.Lethal);
    h.step(0);
    h.step(Btn.Tactical);
    expect(h.controller.phase).toBe('READY');
    expect(h.controller.slot).toBe('tactical');
  });

  it('pulls the pin on the fire button and throws on its release, not before', () => {
    const h = harness();
    h.step(Btn.Lethal);
    h.step(0);
    h.step(Btn.Fire);
    expect(h.controller.phase).toBe('COOKING');
    h.step(Btn.Fire, 10);
    expect(h.thrown).toHaveLength(0);

    h.step(0);
    expect(h.controller.phase).toBe('THROWING');
    // Still in the hand: the arm is swinging.
    expect(h.thrown).toHaveLength(0);
    h.step(0, TICKS(THROW_RELEASE_TIME) - 2);
    expect(h.thrown).toHaveLength(0);
    h.step(0, 2);
    expect(h.thrown).toHaveLength(1);
    expect(h.controller.phase).toBe('IDLE');
  });

  it('runs the release fraction from 0 to 1 and holds it through the follow-through', () => {
    const h = harness();
    h.step(Btn.Lethal);
    h.step(Btn.Fire, 5);
    expect(h.controller.releaseFraction).toBe(0);
    // Zero on the tick the button comes up: the arm has not moved yet, and the pose on that
    // frame is still the wind-up.
    h.step(0);
    expect(h.controller.releaseFraction).toBe(0);
    h.step(0);
    const early = h.controller.releaseFraction;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    h.step(0, TICKS(THROW_RELEASE_TIME));
    expect(h.controller.releaseFraction).toBe(1);
    expect(h.controller.busy).toBe(true);
    h.step(0, TICKS(THROW_FOLLOW_THROUGH) + 1);
    expect(h.controller.releaseFraction).toBe(0);
    expect(h.controller.busy).toBe(false);
  });

  it('burns the fuse through the release, not only up to the button', () => {
    const h = harness();
    h.step(Btn.Lethal);
    const cookTicks = 20;
    h.step(Btn.Fire, cookTicks);
    h.step(0, TICKS(THROW_RELEASE_TIME) + 1);
    expect(h.thrown).toHaveLength(1);
    // Every tick from the pin to the hand opening, and no fewer.
    expect(h.thrown[0]!.cooked).toBeGreaterThan(cookTicks * DT);
  });

  it('detonates in the hand at the cook limit, without waiting for a release', () => {
    const h = harness();
    const def = equipmentDef('frag');
    h.step(Btn.Lethal);
    // A few ticks over: `cook` is 204 additions of 1/60 and lands a float's breadth under 3.4.
    h.step(Btn.Fire, TICKS(def.cookLimit) + 4);
    expect(h.thrown).toHaveLength(1);
    expect(h.thrown[0]!.cooked).toBe(def.fuseSeconds);
    expect(h.controller.phase).toBe('IDLE');
  });

  it('gives equipment that cannot be cooked the same two-button flow and a full fuse', () => {
    const h = harness('smoke');
    expect(equipmentDef('smoke').cookable).toBe(false);
    h.step(Btn.Lethal);
    h.step(Btn.Fire, 40);
    // Held for two thirds of a second and still in the hand: no shortcut for non-cookables.
    expect(h.thrown).toHaveLength(0);
    h.step(0, TICKS(THROW_RELEASE_TIME) + 1);
    expect(h.thrown).toHaveLength(1);
    expect(h.thrown[0]!.cooked).toBe(0);
  });

  it('drops everything on death, so a cook cannot survive into the next life', () => {
    const h = harness();
    h.step(Btn.Lethal);
    h.step(Btn.Fire, 5);
    h.controller.step(cmdWith(Btn.Fire), SIM, 1, h.inv, 'A', false);
    expect(h.controller.phase).toBe('IDLE');
    expect(h.controller.busy).toBe(false);
    expect(h.thrown).toHaveLength(0);
  });

  it('refuses to draw a slot that is empty', () => {
    const h = harness();
    h.inv.lethalCount = 0;
    h.step(Btn.Lethal);
    expect(h.controller.phase).toBe('IDLE');
  });
});
