import { describe, expect, it } from 'vitest';
import { createGameBus, EV, type SlideEndReason } from '../core/Events';
import { Btn, type MutableInputCommand } from '../core/InputCommand';
import { DT } from '../core/Loop';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { DEFAULT_MOVEMENT_CONFIG } from './MovementConfig';
import { PlayerController } from './PlayerController';

/**
 * The committed slide (2026-09-28).
 *
 * A slide used to last exactly as long as the crouch key was held: a tap was a 50 ms slide that
 * read as a dropped input and still paid the whole cooldown. It is one press now, the full
 * `slideDuration`, ended early only by a jump, by leaving the ground, or by the world — and these
 * are that rule, run through the real controller against real collision. The wall is the case the
 * old rule hid: the key was the only way out of a slide pressed into one.
 */

const CFG = DEFAULT_MOVEMENT_CONFIG;
/** The wall's centre, far enough ahead that the slide and not the sprint reaches it. */
const WALL_Z = -9;

function rig(withWall = false) {
  const set = new ColliderSet(2);
  set.add({ x: 0, y: -1, z: 0 }, { x: 200, y: 2, z: 200 }, 0, 0, 0, 'concrete');
  // Three metres tall, so it is a wall and not a ledge the sprint could vault.
  if (withWall) set.add({ x: 0, y: 1.5, z: WALL_Z }, { x: 20, y: 3, z: 0.4 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(set, { min: { x: -100, y: -8, z: -100 }, max: { x: 100, y: 24, z: 100 } }, 8);
  world.configure(CFG.maxSlopeDeg, CFG.collisionSkin);

  const bus = createGameBus();
  const ends: SlideEndReason[] = [];
  bus.on(EV.PlayerSlideEnded, (p) => ends.push(p.reason));

  const player = new PlayerController({ ...CFG }, world, bus);
  player.spawn(0, 0.2, 0, 0);

  const cmd: MutableInputCommand = {
    seq: 0,
    tickIndex: 0,
    moveX: 0,
    moveZ: 1,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    sampledAtMs: 0,
  };
  let tick = 0;
  /** One tick holding W and whatever else `buttons` says. */
  const step = (buttons: number): void => {
    cmd.seq = tick;
    cmd.tickIndex = tick;
    cmd.buttons = buttons;
    cmd.sampledAtMs = tick * DT * 1000;
    player.step(cmd);
    tick++;
  };

  /**
   * A second of sprint, then the crouch press that starts the slide, then `during` every tick
   * until it ends. Returns how many ticks the slide lasted and how far it went.
   */
  const slide = (during: (slideTick: number) => number): { ticks: number; metres: number } => {
    for (let i = 0; i < 60; i++) step(Btn.Sprint);
    step(Btn.Sprint | Btn.Crouch);
    expect(player.sim.slideActive, 'the press starts a slide').toBe(true);
    const x0 = player.sim.x;
    const z0 = player.sim.z;
    let ticks = 1;
    while (player.sim.slideActive && ticks < 300) {
      step(during(ticks));
      ticks++;
    }
    return { ticks, metres: Math.hypot(player.sim.x - x0, player.sim.z - z0) };
  };

  return { player, ends, step, slide };
}

const FULL_TICKS = Math.round(CFG.slideDuration / DT);

describe('a slide is committed', () => {
  it('runs its whole length from a tap', () => {
    const r = rig();
    const tapped = r.slide(() => Btn.Sprint);
    expect(r.ends).toEqual(['expired']);
    // Two ticks either side: the count includes the press and the tick the exit is taken on, and
    // `slideElapsed` reaches 0.85 by summing 1/60 in floating point.
    expect(Math.abs(tapped.ticks - FULL_TICKS)).toBeLessThanOrEqual(2);
    expect(tapped.metres).toBeGreaterThan(4);
    // Nothing held at the end: the body stands up out of it.
    expect(r.player.sim.stance).toBe('STAND');
  });

  it('is the same slide held as tapped, and ends in a crouch when the key is still down', () => {
    const tap = rig().slide(() => Btn.Sprint);
    const r = rig();
    const held = r.slide(() => Btn.Sprint | Btn.Crouch);
    expect(held.ticks).toBe(tap.ticks);
    // The last tick differs and nothing else: it is the one the body leaves the slide on, into a
    // crouch's speed cap in one run and a walk's in the other.
    expect(Math.abs(held.metres - tap.metres)).toBeLessThan(0.01);
    expect(r.player.sim.stance).toBe('CROUCH');
  });

  it('still jump-cancels, carrying the slide speed into the air', () => {
    const r = rig();
    let speedAtJump = 0;
    const cancelled = r.slide((t) => {
      if (t === 10) {
        speedAtJump = r.player.sim.speed;
        return Btn.Sprint | Btn.Jump;
      }
      return Btn.Sprint;
    });
    expect(r.ends).toEqual(['jumpCancel']);
    expect(cancelled.ticks).toBeLessThan(FULL_TICKS);
    expect(speedAtJump).toBeGreaterThan(CFG.sprintSpeed);
    expect(r.player.sim.speed).toBeGreaterThan(CFG.sprintSpeed);
    expect(r.player.sim.stance).toBe('AIRBORNE');
  });

  it('ends against a wall instead of pressing into it for the rest of its length', () => {
    const r = rig(true);
    const stopped = r.slide(() => Btn.Sprint);
    expect(r.ends).toEqual(['blocked']);
    // It reaches the wall about a third of the way in; the old rule held it there to the end.
    expect(stopped.ticks).toBeLessThan(FULL_TICKS - 10);
  });
});
