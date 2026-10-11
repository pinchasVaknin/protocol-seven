import { describe, expect, it } from 'vitest';
import { PLAYER_ENTITY_ID } from '../combat/DamageSystem';
import { HUMANOID_RIG, rigLayoutFor } from '../combat/HitboxRig';
import { Health } from '../player/Health';
import type { PlayerController } from '../player/PlayerController';
import type { StanceId } from '../player/Stance';
import { PlayerCombatant } from './PlayerCombatant';

/**
 * The local player, seen from the AI's side of the fence — pinned.
 *
 * It is a **view** over `PlayerController`, not a copy of it, so there is no second pose to
 * fall out of sync. That is the property the getters below are asserted for: move the sim and
 * the combatant moves, with nothing to refresh.
 *
 * `entityId` has its own section because hard-coding it to zero was three separately reported
 * faults at once. Over the network a connected human shoots as entity 1 or above, and
 * `Ballistics.nearestTarget` compares its `excludeId` against this — so the player's own rig
 * was a legal target for their own bullets and every shot terminated on the shooter.
 */

const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };

interface Sim {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  eyeHeight: number;
  stance: StanceId;
}

/**
 * A controller stub carrying only the `sim` the combatant reads through.
 *
 * Narrowed deliberately: `PlayerController` owns movement, mantling and stance transitions,
 * none of which this class touches — it reads eight fields off `sim` and nothing else.
 */
function controllerWith(over: Partial<Sim> = {}): { player: PlayerController; sim: Sim } {
  const sim: Sim = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    stance: 'STAND',
    ...over,
  };
  return { player: { sim } as unknown as PlayerController, sim };
}

function combatant(over: Partial<Sim> = {}): { body: PlayerCombatant; sim: Sim } {
  const { player, sim } = controllerWith(over);
  return { body: new PlayerCombatant(new Health(HEALTH), 'A', player), sim };
}

describe('which entity the body is', () => {
  it('is the single-player seat by default, which every call site has had since M2', () => {
    const { body } = combatant();
    expect(body.entityId).toBe(PLAYER_ENTITY_ID);
    expect(body.displayName).toBe('OPERATOR');
  });

  it('is whatever a server seated this client as', () => {
    const { player } = controllerWith();
    const body = new PlayerCombatant(new Health(HEALTH), 'B', player, 7, 'CINDER');
    expect(body.entityId).toBe(7);
    expect(body.displayName).toBe('CINDER');
    expect(body.team).toBe('B');
  });
});

describe('the pose', () => {
  it('is a view through the controller, not a copy of it', () => {
    const { body, sim } = combatant();
    expect(body.px).toBe(0);
    sim.x = 4;
    sim.y = 2;
    sim.z = -6;
    sim.yaw = 1.25;
    sim.vx = 3;
    sim.vz = -1;
    sim.eyeHeight = 1.1;
    // Nothing was refreshed: there is no second pose to go stale.
    expect(body.px).toBe(4);
    expect(body.py).toBe(2);
    expect(body.pz).toBe(-6);
    expect(body.yaw).toBe(1.25);
    expect(body.vx).toBe(3);
    expect(body.vz).toBe(-1);
    expect(body.eyeHeight).toBe(1.1);
  });

  it('aims where its own rig layout says, so aiming and hitting agree', () => {
    const { body } = combatant();
    expect(body.aimHeight).toBe(HUMANOID_RIG.aimY);
    expect(body.aimHeight).toBe(body.rig.layout.aimY);
  });
});

describe('whether a bot should notice it', () => {
  it('is quiet while crouched or sliding, and not while standing', () => {
    expect(combatant({ stance: 'CROUCH' }).body.quiet).toBe(true);
    expect(combatant({ stance: 'SLIDE' }).body.quiet).toBe(true);
    expect(combatant({ stance: 'STAND' }).body.quiet).toBe(false);
    expect(combatant({ stance: 'AIRBORNE' }).body.quiet).toBe(false);
    expect(combatant({ stance: 'MANTLE' }).body.quiet).toBe(false);
  });

  it('is in the fight while alive and active', () => {
    const { body } = combatant();
    expect(body.participating).toBe(true);
  });

  it('is out of it once dead, which is what stops a bot looking for a corpse', () => {
    const { body } = combatant();
    body.health.alive = false;
    expect(body.participating).toBe(false);
  });

  it('is out of it while spectating, which is what the AFK harness needs', () => {
    const { body } = combatant();
    body.active = false;
    expect(body.participating).toBe(false);
    expect(body.health.alive).toBe(true);
  });

  it('starts holding no glint and no sidearm, both written once a tick by the match', () => {
    const { body } = combatant();
    expect(body.glinting).toBe(false);
    expect(body.pistol).toBe(false);
    expect(body.invulnerable).toBe(false);
  });
});

describe('keeping the rig on the capsule', () => {
  it('puts the boxes where the body is, on the tick a shot resolves', () => {
    const { body, sim } = combatant();
    sim.x = 3;
    sim.y = 1;
    sim.z = -2;
    sim.yaw = 0.5;
    body.syncRig();
    expect(body.rig.x).toBe(3);
    expect(body.rig.y).toBe(1);
    expect(body.rig.z).toBe(-2);
    expect(body.rig.yaw).toBe(0.5);
  });

  it('wears the layout the stance and the speed choose', () => {
    const standing = combatant({ stance: 'STAND' });
    standing.body.syncRig();
    expect(standing.body.rig.layout).toBe(rigLayoutFor('STAND', 0, 0, false));

    const sliding = combatant({ stance: 'SLIDE', vx: 6 });
    sliding.body.syncRig();
    expect(sliding.body.rig.layout.id).toBe('humanoid-slide');
  });

  it('wears the half-squat when it is holding a sidearm', () => {
    const rifle = combatant({ stance: 'CROUCH' });
    rifle.body.syncRig();
    expect(rifle.body.rig.layout.id).toBe('humanoid-crouch');

    const pistol = combatant({ stance: 'CROUCH' });
    pistol.body.pistol = true;
    pistol.body.syncRig();
    expect(pistol.body.rig.layout.id).toBe('humanoid-crouch-pistol');
  });

  it('follows the body as it moves, every tick', () => {
    const { body, sim } = combatant();
    body.syncRig();
    sim.x = 9;
    expect(body.rig.x).toBe(0);
    body.syncRig();
    expect(body.rig.x).toBe(9);
  });
});
