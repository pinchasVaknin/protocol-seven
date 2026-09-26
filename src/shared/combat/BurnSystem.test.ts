import { describe, expect, it } from 'vitest';
import { createGameBus, EV, type GameBus } from '../core/Events';
import { installClock } from '../core/Clock';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { HitboxRig } from './HitboxRig';
import { burnWeapon, flamethrowerWeapon } from '../streaks/StreakWeapons';
import { AR_DEFAULT } from '../weapons/WeaponDefs';
import { BurnSystem } from './BurnSystem';
import { DamageSystem, type Damageable } from './DamageSystem';
import { ScoreSystem } from './ScoreSystem';
import { MatchFlow } from '../modes/MatchFlow';
import { MAPS, MODES } from '../modes/ModeRegistry';
import type { BotTeam, Combatant } from '../ai/Combatant';

/**
 * What the fire does after the jet has moved on.
 *
 * The burn is lit by an *event* rather than by a call, which is the property worth asserting:
 * every rule that guards the damage door — the friendly gate, the invulnerable check, a body
 * already dead — guards this too, automatically and without a line of its own. So these tests
 * light fires by dealing damage, the way the game does, rather than by reaching for a method.
 */

// `DamageSystem` stamps its last-hit report with the runtime's clock; a test runs in
// neither runtime, so it installs one that counts.
let fakeNow = 0;
installClock({ nowMs: () => fakeNow++ });

const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };

function body(entityId: number, team: 'A' | 'B'): Damageable {
  const rig = new HitboxRig();
  rig.setTransform(0, 0, 0, 0);
  return { entityId, displayName: `E${entityId}`, health: new Health(HEALTH), rig, team };
}

/**
 * The same body, as the roster sees it. `MatchFlow` resolves a kill against `Combatant`s and
 * refuses to score one whose victim it cannot find, so a scoring test has to supply the pose
 * half of the interface even though nothing here reads a metre of it.
 */
function combatant(target: Damageable): Combatant {
  return {
    ...target,
    team: target.team as BotTeam,
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.65,
    aimHeight: 1.2,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

/** A match with one shooter on A, one enemy on B, and a teammate on A. */
function arena(): {
  bus: GameBus;
  damage: DamageSystem;
  burn: BurnSystem;
  enemy: Damageable;
  mate: Damageable;
} {
  const bus = createGameBus();
  const damage = new DamageSystem(bus);
  const shooter = body(1, 'A');
  const mate = body(2, 'A');
  const enemy = body(3, 'B');
  damage.register(shooter);
  damage.register(mate);
  damage.register(enemy);
  const burn = new BurnSystem(bus, damage, burnWeapon());
  return { bus, damage, burn, enemy, mate };
}

/** One tick of flame from entity 1 onto `target`, through the one door. */
function jet(damage: DamageSystem, targetId: number): number {
  return damage.apply({
    sourceId: 1,
    targetId,
    zone: 'torso',
    upperTorso: false,
    weapon: flamethrowerWeapon(),
    autonomous: false,
    distance: 1,
    penetrationRetain: 1,
    x: 0,
    y: 1,
    z: 0,
    // A metre in front of the body, looking down -Z: the jet arrives from somewhere, which is
    // what tells a shield apart from a burn. Nothing in this file is shielded.
    originX: 0,
    originY: 1,
    originZ: 1,
  });
}

function run(burn: BurnSystem, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) burn.simulate();
}

describe('a body that has been in the jet', () => {
  it('keeps burning after the fire stops, then stops', () => {
    const { damage, burn, enemy } = arena();
    jet(damage, enemy.entityId);
    expect(burn.isBurning(enemy.entityId)).toBe(true);

    const seconds = flamethrowerWeapon().flame?.burnSeconds ?? 0;
    run(burn, seconds - 0.2);
    expect(burn.isBurning(enemy.entityId)).toBe(true);
    run(burn, 0.4);
    expect(burn.isBurning(enemy.entityId)).toBe(false);
  });

  it('loses about the damage per second the profile states', () => {
    const { damage, burn, enemy } = arena();
    const flame = flamethrowerWeapon().flame;
    jet(damage, enemy.entityId);
    const afterJet = enemy.health.current;
    run(burn, 1);
    const lost = afterJet - enemy.health.current;
    expect(lost).toBeCloseTo(flame?.burnDps ?? 0, 0);
  });

  it('is refreshed by more fire, not stacked', () => {
    const { damage, burn, enemy } = arena();
    const flame = flamethrowerWeapon().flame;
    const seconds = flame?.burnSeconds ?? 0;
    // Half a second of contact — five ticks — then out of the fire. Twenty would be 140
    // damage and the body would be dead before the burn had anything to do.
    for (let i = 0; i < 5; i++) jet(damage, enemy.entityId);
    const afterJet = enemy.health.current;
    run(burn, seconds + 1);
    const lostToBurn = afterJet - enemy.health.current;
    // One burn's worth, not twenty.
    expect(lostToBurn).toBeCloseTo((flame?.burnDps ?? 0) * seconds, 0);
    expect(burn.isBurning(enemy.entityId)).toBe(false);
  });

  it('cannot be lit on a teammate, because the door refused the damage', () => {
    const { damage, burn, mate } = arena();
    expect(jet(damage, mate.entityId)).toBe(0);
    expect(burn.isBurning(mate.entityId)).toBe(false);
  });

  it('is not lit by a weapon that is not fire', () => {
    const { damage, burn, enemy } = arena();
    damage.apply({
      sourceId: 1,
      targetId: enemy.entityId,
      zone: 'torso',
      upperTorso: false,
      weapon: AR_DEFAULT,
      autonomous: false,
      distance: 5,
      penetrationRetain: 1,
      x: 0,
      y: 1,
      z: 0,
      originX: 0,
      originY: 1,
      originZ: 5,
    });
    expect(burn.isBurning(enemy.entityId)).toBe(false);
  });

  it('goes out when the body does, and does not follow it into the next life', () => {
    const { bus, damage, burn, enemy } = arena();
    jet(damage, enemy.entityId);
    expect(burn.isBurning(enemy.entityId)).toBe(true);
    bus.emit(EV.EntityKilled, {
      targetId: enemy.entityId,
      sourceId: 1,
      weaponId: 'streak_flamethrower',
      zone: 'torso',
      killerHealth: 100,
    });
    expect(burn.isBurning(enemy.entityId)).toBe(false);
  });

  /**
   * The kill belongs to whoever was holding the flamethrower, the same rule the sentry's kills
   * settled: the fire is theirs, so the kill is theirs — and the feed says `BURNING` rather
   * than naming a weapon the victim walked away from two seconds earlier.
   */
  it('credits the killer and names the fire when it finishes somebody', () => {
    const { bus, damage, burn, enemy } = arena();
    // Lit first, then left on a sliver: the *burn* has to be what finishes them, not the tick
    // of jet that lit it.
    jet(damage, enemy.entityId);
    enemy.health.applyDamage(enemy.health.current - 1);
    let killerId = -1;
    let weaponId = '';
    bus.on(EV.EntityKilled, (p) => {
      killerId = p.sourceId;
      weaponId = p.weaponId;
    });
    run(burn, 2);
    expect(killerId).toBe(1);
    expect(weaponId).toBe('streak_burn');
    expect(enemy.health.alive).toBe(false);
  });
});

/**
 * The same kill, seen from the scoreboard.
 *
 * The test above asserts the *event*: a burn that finishes somebody emits `EntityKilled` with
 * the lighter as the source. That is not the same claim as "the kill is on the board", and the
 * difference is where a kill can be lost without a single line of `BurnSystem` being wrong —
 * `MatchFlow` scores nothing outside `LIVE`, nothing whose victim is off the roster, and
 * nothing at all on a replicated client. A burn is the one kill in the game that arrives from
 * a system rather than from a trigger, so it is the one most likely to arrive somewhere the
 * scoring path is not listening.
 *
 * The killstreak wallet is deliberately *not* wired in here. `StreakLedger.foldKills` banks the
 * delta of `PlayerScore.kills` — the score is the arbiter for the economy as well — so a kill
 * that lands on the board is a kill in the wallet, and asserting it twice would only assert the
 * ledger's arithmetic a second time.
 */
describe('a kill the fire finished', () => {
  function match(): {
    damage: DamageSystem;
    burn: BurnSystem;
    score: ScoreSystem;
    flow: MatchFlow;
    enemy: Damageable;
  } {
    const bus = createGameBus();
    const damage = new DamageSystem(bus);
    const shooter = body(1, 'A');
    const enemy = body(3, 'B');
    damage.register(shooter);
    damage.register(enemy);

    const roster = [combatant(shooter), combatant(enemy)];
    const score = new ScoreSystem(bus);
    score.register(1, 'SHOOTER', 'A');
    score.register(3, 'ENEMY', 'B');

    const map = MAPS[0];
    if (map === undefined) throw new Error('no maps');
    const entry = MODES.find((m) => m.id === 'TDM');
    if (entry === undefined) throw new Error('no TDM');
    const mode = entry.create({ bus, score, roster, mapDef: map.def });
    const flow = new MatchFlow({
      bus,
      score,
      roster,
      mode,
      mapId: map.id,
      mapName: map.name,
      localTeam: 'A',
      authoritative: true,
      // No intro freeze: the first tick is live, and every tick after it is one the burn
      // could be finishing somebody on.
      matchStartSeconds: 0,
      onSidesSwapped: () => {},
    });
    const burn = new BurnSystem(bus, damage, burnWeapon());
    // Without this the mode has no clock, and its first live tick ends the match on a round
    // that was already over before it began.
    flow.start();
    return { damage, burn, score, flow, enemy };
  }

  it('is on the board, credited to whoever was holding the flamethrower', () => {
    const { damage, burn, score, flow, enemy } = match();
    flow.simulate(0);
    expect(flow.currentPhase).toBe('LIVE');

    // Lit, then left on a sliver — the burn is what finishes them, as in the test above.
    jet(damage, enemy.entityId);
    enemy.health.applyDamage(enemy.health.current - 1);

    let tick = 1;
    for (let t = 0; t < 2; t += DT) {
      burn.simulate();
      flow.simulate(tick++);
    }

    expect(enemy.health.alive).toBe(false);
    expect(score.row(1)?.kills).toBe(1);
    expect(score.row(1)?.streak).toBe(1);
    expect(score.row(3)?.deaths).toBe(1);
    // TDM's team score is a kill count, and a burn kill counts.
    expect(score.team('A').kills).toBe(1);
  });

  /**
   * A body that walks out of the jet during the warmup of the next round is not scoring a kill
   * two seconds after the round it was lit in ended. `MatchFlow` already refuses this for every
   * other weapon; the assertion is here because the burn is the only damage in the game that can
   * *cross* that boundary on its own.
   */
  it('scores nothing once the round is no longer live', () => {
    const { damage, burn, score, flow, enemy } = match();
    jet(damage, enemy.entityId);
    enemy.health.applyDamage(enemy.health.current - 1);
    // Never gone live: `flow.simulate` is not called, so the phase is still WARMUP.
    expect(flow.currentPhase).toBe('WARMUP');
    run(burn, 2);
    expect(enemy.health.alive).toBe(false);
    expect(score.row(1)?.kills).toBe(0);
  });
});
