import { describe, expect, it } from 'vitest';
import { CheatState } from '../shared/cheats/Cheats';
import { DamageSystem } from '../shared/combat/DamageSystem';
import { installClock } from '../shared/core/Clock';
import { createGameBus, EV } from '../shared/core/Events';
import { Btn, type MutableInputCommand } from '../shared/core/InputCommand';
import { NO_SKIN_INDEX } from '../shared/meta/Skins';
import { NO_PERKS } from '../shared/perks/PerkState';
import { DEFAULT_HEALTH_CONFIG } from '../shared/player/Health';
import { DEFAULT_MOVEMENT_CONFIG } from '../shared/player/MovementConfig';
import { DEFAULT_VIEWMODEL_CONFIG } from '../shared/weapons/ViewmodelConfig';
import { AR_DEFAULT, requireWeapon } from '../shared/weapons/WeaponDefs';
import { ColliderSet } from '../shared/world/ColliderSet';
import { CollisionWorld } from '../shared/world/CollisionWorld';
import { NetPlayer } from './NetPlayer';

/**
 * A connected player's rifle, on the machine whose hits count (2026-09-28).
 *
 * The fire button pulls a grenade's pin and throws it, and until this was fixed the server stepped
 * every human's rifle with nothing blocking it — a player cooking a frag was also emptying a hidden
 * rifle at whatever they looked at, and it was the server that dealt the damage. These drive a real
 * `NetPlayer` through its real input buffer and count the rounds its weapon puts on the bus.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const ID = 7;

function rig() {
  const bus = createGameBus();
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(set, { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } }, 8);
  const player = new NetPlayer(ID, 'P', 'A', {
    world,
    bus,
    damage: new DamageSystem(bus),
    movement: DEFAULT_MOVEMENT_CONFIG,
    healthConfig: DEFAULT_HEALTH_CONFIG,
    viewmodelConfig: DEFAULT_VIEWMODEL_CONFIG,
    weaponDef: AR_DEFAULT,
    secondaryDef: requireWeapon('pistol_talon'),
    perks: NO_PERKS,
    cheats: new CheatState(),
    characterIndex: NO_SKIN_INDEX,
  });
  player.spawn(0, 0, 0, 0);

  let shots = 0;
  bus.on(EV.WeaponFired, (p) => {
    if (p.sourceId === ID) shots++;
  });

  let tick = 0;
  let seq = 0;
  /** `count` ticks with these buttons, through the input buffer as a client's commands arrive. */
  const hold = (buttons: number, count = 1): void => {
    for (let i = 0; i < count; i++) {
      tick++;
      const cmd: MutableInputCommand = {
        seq: seq++,
        tickIndex: tick,
        moveX: 0,
        moveZ: 0,
        yaw: 0,
        pitch: 0,
        buttons,
        sampledAtMs: 0,
      };
      player.input.accept(cmd, tick);
      player.step(tick, false);
    }
  };
  // The rifle comes up after the spawn before it can fire at all.
  hold(0, 90);
  return { player, hold, shots: () => shots };
}

describe('a connected player’s rifle', () => {
  it('fires on the trigger when nothing else has the hands', () => {
    const r = rig();
    r.hold(Btn.Fire, 30);
    expect(r.shots()).toBeGreaterThan(0);
  });

  it('does not fire while a grenade is in the hand, however long the button is held', () => {
    const r = rig();
    // `ServerMatch.stepThrowers` writes this from the thrower every tick: drawn, cooking, thrown.
    r.player.handBusy = true;
    r.hold(Btn.Fire, 120);
    expect(r.shots()).toBe(0);
    // And the hand coming back gives the trigger back.
    r.player.handBusy = false;
    r.hold(0, 2);
    r.hold(Btn.Fire, 30);
    expect(r.shots()).toBeGreaterThan(0);
  });

  it('does not fire on the tick the grenade is reached for, before the thrower has said so', () => {
    const r = rig();
    // The thrower steps after the weapon, so on this tick `handBusy` is still false.
    r.hold(Btn.Lethal | Btn.Fire);
    r.hold(Btn.Tactical | Btn.Fire);
    expect(r.shots()).toBe(0);
  });

  it('does not fire through a knife swing', () => {
    const r = rig();
    r.hold(Btn.Melee | Btn.Fire);
    expect(r.shots()).toBe(0);
    r.player.meleeSeconds = 0.3;
    r.hold(Btn.Fire, 10);
    expect(r.shots()).toBe(0);
  });
});
