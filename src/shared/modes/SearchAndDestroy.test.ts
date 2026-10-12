import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { FOUNDRY_MAP } from '../world/maps/foundry';
import type { Combatant } from '../ai/Combatant';
import type { ModeDeps } from './GameMode';
import { SND_CONFIG, SND_SKIRMISH_CONFIG, SearchAndDestroy } from './SearchAndDestroy';

/**
 * Search & Destroy, pinned.
 *
 * The mode the base class's round abstraction exists for: one life, a best-of-three, a side
 * swap, and a bomb that is an object in the world whether it is on the floor or in somebody's
 * hands. Four things decide a round and all four are pinned — the bomb exploding, a defuse, a
 * side being wiped, and the clock running out with nothing planted.
 *
 * The details that look arbitrary and are not:
 *
 *  - **Team B attacks first.** `attackers` is `round > swapAfterRound ? 'A' : 'B'`, so round one
 *    is B's attack and round two is A's. In a best-of-three each side attacks once before a
 *    decider.
 *  - **The pickup grace.** For four seconds nobody is auto-handed the bomb, so the opening
 *    belongs to whoever presses the key. Without it a lobby of bots stands around a bomb
 *    nobody picks up.
 *  - **Only the carrier plants.** Anyone else on the site is just standing on the site, and a
 *    plant whose actor stops carrying is cancelled rather than finished.
 *  - **Post-plant, the clock is irrelevant.** Only a defuse, the timer or the defenders being
 *    wiped can end it — the round clock stops deciding anything the moment the bomb goes down.
 *
 * Foundry, because S&D needs authored `bombsite` objectives and the greybox has none.
 */

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function body(entityId: number, team: 'A' | 'B', x = 0, y = 0, z = 0): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(x, y, z, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: x,
    py: y,
    pz: z,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

/** A body that is down: on the roster, out of the round. One life means this is permanent. */
function fallen(entityId: number, team: 'A' | 'B'): Combatant {
  return { ...body(entityId, team), participating: false };
}

interface Rig {
  readonly mode: SearchAndDestroy;
  readonly score: ScoreSystem;
  readonly bus: GameBus;
  readonly roster: Combatant[];
}

function rig(roster: Combatant[], config = SND_CONFIG, over: Partial<ModeDeps> = {}): Rig {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  for (const c of roster) score.register(c.entityId, c.displayName, c.team);
  const deps: ModeDeps = { bus, score, roster, mapDef: FOUNDRY_MAP, ...over };
  const mode = new SearchAndDestroy(deps, config);
  mode.onRoundStart(1);
  return { mode, score, bus, roster };
}

/** One attacker and one defender, both alive, standing far apart. Round one: B attacks. */
function pair(): Rig {
  return rig([body(100, 'B', 60, 0, 60), body(200, 'A', -60, 0, -60)]);
}

/** Put `c` on the bomb and hand it to them, past the pickup grace. */
function takeBomb(r: Rig, c: Combatant): Combatant {
  const ticks = Math.round(SND_CONFIG.pickupGraceSeconds / DT) + 1;
  for (let tick = 1; tick <= ticks; tick++) r.mode.onTick(tick);
  const onBomb = body(c.entityId, c.team, r.mode.bombInfo?.x ?? 0, 0, r.mode.bombInfo?.z ?? 0);
  const at = r.roster.findIndex((m) => m.entityId === c.entityId);
  r.roster[at] = onBomb;
  expect(r.mode.tryPickup(onBomb)).toBe(true);
  return onBomb;
}

/** Walk `c` onto the first bombsite and run the plant to completion. */
function plant(r: Rig, carrier: Combatant): void {
  const site = r.mode.objectiveZones[0];
  expect(site).toBeDefined();
  if (site === undefined) return;
  const p = site.def.position;
  const onSite = body(carrier.entityId, carrier.team, p.x, p.y, p.z);
  const at = r.roster.findIndex((m) => m.entityId === carrier.entityId);
  r.roster[at] = onSite;
  r.mode.beginInteract(onSite, false);
  const ticks = Math.ceil(SND_CONFIG.plantSeconds / DT) + 1;
  for (let tick = 1; tick <= ticks && r.mode.bomb !== 'PLANTED'; tick++) r.mode.onTick(tick);
}

describe('what Search & Destroy declares it is', () => {
  it('is a best of three, one life, swapping sides after round one', () => {
    const { mode } = pair();
    expect(mode.id).toBe('SND');
    expect(mode.roundsToWin).toBe(2);
    expect(mode.swapSidesAfterRound).toBe(1);
    expect(mode.livesPerRound).toBe(1);
    expect(mode.roundSeconds).toBe(150);
    // No score limit: rounds decide it, not points.
    expect(mode.scoreLimit).toBe(0);
  });

  it('shortens the round end, because a one-life round should not wait four seconds', () => {
    const { mode } = pair();
    expect(mode.roundEndSeconds).toBe(1.5);
  });

  it('runs a best of five on the skirmish ballot, swapping at round two', () => {
    const { mode } = rig([body(100, 'B'), body(200, 'A')], SND_SKIRMISH_CONFIG);
    expect(mode.roundsToWin).toBe(3);
    expect(mode.swapSidesAfterRound).toBe(2);
    // Everything else is SND_CONFIG verbatim: the bomb timer and the windows are gunplay feel.
    expect(SND_SKIRMISH_CONFIG.bombTimerSeconds).toBe(SND_CONFIG.bombTimerSeconds);
    expect(SND_SKIRMISH_CONFIG.plantSeconds).toBe(SND_CONFIG.plantSeconds);
  });

  it('takes its bombsites from the map, and refuses a map with none', () => {
    const { mode } = pair();
    expect(mode.objectiveZones.length).toBeGreaterThanOrEqual(2);

    const bus = createGameBus();
    const bare = { ...FOUNDRY_MAP, objectives: [] };
    expect(
      () => new SearchAndDestroy({ bus, score: new ScoreSystem(bus), roster: [], mapDef: bare }),
    ).toThrow(/bombsite/i);
  });

  it('shows plants and defuses on the board', () => {
    const { mode } = pair();
    expect(mode.getScoreboardColumns().map((c) => c.key)).toEqual([
      'score',
      'kills',
      'deaths',
      'plants',
      'defuses',
      'kd',
      'acc',
    ]);
  });

  it('scores a side by rounds won, not by points', () => {
    const { mode, score } = pair();
    expect(mode.teamScore('A')).toBe(score.team('A').rounds);
  });
});

describe('the sides', () => {
  it('has B attacking first, so each side attacks once before a decider', () => {
    const { mode } = pair();
    expect(mode.attackers).toBe('B');
    expect(mode.defenders).toBe('A');
  });

  it('swaps after the round the config names', () => {
    const { mode } = pair();
    mode.onRoundStart(2);
    expect(mode.attackers).toBe('A');
    mode.onRoundStart(3);
    expect(mode.attackers).toBe('A');
  });
});

describe('the bomb on the floor', () => {
  it('starts carried-by-nobody at the point the map names', () => {
    const { mode } = pair();
    expect(mode.bomb).toBe('CARRIED');
    expect(mode.isCarrier(100)).toBe(false);
    const spawn = FOUNDRY_MAP.objectives.find((o) => o.kind === 'bombspawn');
    if (spawn !== undefined) {
      expect(mode.bombInfo?.x).toBe(spawn.position.x);
      expect(mode.bombInfo?.z).toBe(spawn.position.z);
    }
  });

  it('is not auto-handed to anybody during the pickup grace', () => {
    // The opening seconds belong to whoever presses the key.
    const r = rig([body(100, 'B', 0, 0, 0), body(200, 'A', -60, 0, -60)]);
    const onBomb = body(100, 'B', r.mode.bombInfo?.x ?? 0, 0, r.mode.bombInfo?.z ?? 0);
    r.roster[0] = onBomb;
    for (let tick = 1; tick <= Math.round(SND_CONFIG.pickupGraceSeconds / DT) - 1; tick++) {
      r.mode.onTick(tick);
    }
    expect(r.mode.isCarrier(100)).toBe(false);
  });

  it('is picked up automatically once the grace is over', () => {
    const r = rig([body(100, 'B', 0, 0, 0), body(200, 'A', -60, 0, -60)]);
    const onBomb = body(100, 'B', r.mode.bombInfo?.x ?? 0, 0, r.mode.bombInfo?.z ?? 0);
    r.roster[0] = onBomb;
    for (let tick = 1; tick <= Math.round(SND_CONFIG.pickupGraceSeconds / DT) + 2; tick++) {
      r.mode.onTick(tick);
    }
    expect(r.mode.isCarrier(100)).toBe(true);
  });

  it('can only be taken by a living attacker standing on it', () => {
    const r = pair();
    const far = body(100, 'B', 500, 0, 500);
    expect(r.mode.tryPickup(far)).toBe(false);

    const bx = r.mode.bombInfo?.x ?? 0;
    const bz = r.mode.bombInfo?.z ?? 0;
    expect(r.mode.tryPickup(body(200, 'A', bx, 0, bz))).toBe(false);
    expect(r.mode.tryPickup({ ...body(100, 'B', bx, 0, bz), participating: false })).toBe(false);
    expect(r.mode.tryPickup(body(100, 'B', bx, 0, bz))).toBe(true);
  });

  it('answers the prompt without taking it', () => {
    const r = pair();
    const bx = r.mode.bombInfo?.x ?? 0;
    const bz = r.mode.bombInfo?.z ?? 0;
    const near = body(100, 'B', bx, 0, bz);
    expect(r.mode.tryPickupPrompt(near)).toBe(true);
    expect(r.mode.isCarrier(100)).toBe(false);
  });

  it('refuses a second carrier', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    expect(r.mode.isCarrier(carrier.entityId)).toBe(true);
    const bx = r.mode.bombInfo?.x ?? 0;
    expect(r.mode.tryPickup(body(101, 'B', bx, 0, r.mode.bombInfo?.z ?? 0))).toBe(false);
  });

  it('follows the carrier, so a plant reads this tick’s position', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const moved = body(carrier.entityId, carrier.team, 11, 0, 22);
    r.roster[0] = moved;
    r.mode.onTick(99);
    expect(r.mode.bombInfo?.x).toBe(11);
    expect(r.mode.bombInfo?.z).toBe(22);
  });

  it('stays where it was when the carrier stops existing', () => {
    // A disconnect, or a bot removed to make room for a human: the bomb does not follow a ghost.
    const r = pair();
    takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const where = { x: r.mode.bombInfo?.x ?? 0, z: r.mode.bombInfo?.z ?? 0 };
    r.roster.splice(0, 1);
    r.mode.onTick(99);
    expect(r.mode.bombInfo?.x).toBe(where.x);
    expect(r.mode.isCarrier(100)).toBe(false);
  });
});

describe('planting', () => {
  it('needs the carrier, on a site, for the authored window', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const site = r.mode.objectiveZones[0];
    expect(site).toBeDefined();
    if (site === undefined) return;

    const p = site.def.position;
    const onSite = body(carrier.entityId, carrier.team, p.x, p.y, p.z);
    r.roster[0] = onSite;
    r.mode.beginInteract(onSite, false);
    expect(r.mode.interactingEntity).toBe(-1);

    // Part way through: started, not finished.
    for (let tick = 1; tick <= 60; tick++) r.mode.onTick(tick);
    expect(r.mode.bomb).toBe('CARRIED');
    expect(r.mode.interactingEntity).toBe(carrier.entityId);
    expect(r.mode.interactIsDefusing).toBe(false);

    for (let tick = 61; tick <= 400 && r.mode.bomb !== 'PLANTED'; tick++) r.mode.onTick(tick);
    expect(r.mode.bomb).toBe('PLANTED');
    expect(r.mode.plantedSite?.id).toBe(site.id);
  });

  it('announces the plant, credits it, and starts the bomb timer', () => {
    const r = pair();
    const seen: Array<{ entityId: number; label: string }> = [];
    r.bus.on(EV.BombPlanted, (p) => seen.push({ entityId: p.entityId, label: p.label }));
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);

    expect(r.mode.bomb).toBe('PLANTED');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.entityId).toBe(carrier.entityId);
    expect(r.score.row(carrier.entityId)?.plants).toBe(1);
    expect(r.score.row(carrier.entityId)?.score).toBeGreaterThanOrEqual(250);
    expect(r.mode.bombSecondsLeft).toBeCloseTo(45, 2);
    // The carrier no longer carries it: the bomb is in the ground.
    expect(r.mode.isCarrier(carrier.entityId)).toBe(false);
  });

  it('is cancelled when the actor is not the carrier', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const site = r.mode.objectiveZones[0];
    if (site === undefined) return;
    const p = site.def.position;

    // A second attacker on the site is just standing on the site.
    const other = body(101, 'B', p.x, p.y, p.z);
    r.roster.push(other);
    r.mode.beginInteract(other, false);
    for (let tick = 1; tick <= 400; tick++) r.mode.onTick(tick);
    expect(r.mode.bomb).toBe('CARRIED');
    expect(r.mode.isCarrier(carrier.entityId)).toBe(true);
  });

  it('is cancelled when the carrier walks off the site', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const site = r.mode.objectiveZones[0];
    if (site === undefined) return;
    const p = site.def.position;
    const onSite = body(carrier.entityId, carrier.team, p.x, p.y, p.z);
    r.roster[0] = onSite;
    r.mode.beginInteract(onSite, false);
    for (let tick = 1; tick <= 60; tick++) r.mode.onTick(tick);
    expect(r.mode.interactingEntity).toBe(carrier.entityId);

    r.roster[0] = body(carrier.entityId, carrier.team, 500, 0, 500);
    r.mode.onTick(61);
    expect(r.mode.interactingEntity).toBe(-1);
    expect(r.mode.bomb).toBe('CARRIED');
  });

  it('holds the first interaction until that body is down', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const site = r.mode.objectiveZones[0];
    if (site === undefined) return;
    const p = site.def.position;
    const onSite = body(carrier.entityId, carrier.team, p.x, p.y, p.z);
    r.roster[0] = onSite;
    r.mode.beginInteract(onSite, false);
    r.mode.onTick(1);
    expect(r.mode.interactingEntity).toBe(carrier.entityId);

    // Somebody else cannot steal the interaction while the first is still up.
    const other = body(101, 'B', p.x, p.y, p.z);
    r.mode.beginInteract(other, false);
    expect(r.mode.interactingEntity).toBe(carrier.entityId);
  });
});

describe('defusing', () => {
  it('needs a living defender on the planted site for the authored window', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    const site = r.mode.plantedSite;
    expect(site).toBeDefined();
    if (site === undefined || site === null) return;

    const p = site.def.position;
    const defuser = body(200, 'A', p.x, p.y, p.z);
    r.roster[1] = defuser;
    r.mode.beginInteract(defuser, true);

    const seen: number[] = [];
    r.bus.on(EV.BombDefused, (e) => seen.push(e.entityId));
    for (let tick = 1; tick <= 600 && r.mode.bomb === 'PLANTED'; tick++) r.mode.onTick(tick);

    expect(r.mode.bomb).toBe('DEFUSED');
    expect(seen).toEqual([200]);
    expect(r.score.row(200)?.defuses).toBe(1);
    const result = r.mode.checkWinCondition();
    expect(result?.kind).toBe('round');
    expect(result?.winner).toBe('A');
    expect(result?.reason).toBe('Bomb defused');
  });

  it('refuses an attacker trying to defuse their own bomb', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    const site = r.mode.plantedSite;
    if (site === null || site === undefined) return;
    const p = site.def.position;
    const attacker = body(carrier.entityId, carrier.team, p.x, p.y, p.z);
    r.roster[0] = attacker;
    r.mode.beginInteract(attacker, true);
    for (let tick = 1; tick <= 100; tick++) r.mode.onTick(tick);
    expect(r.mode.bomb).toBe('PLANTED');
  });

  it('is cancelled when the defuser leaves the site', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    const site = r.mode.plantedSite;
    if (site === null || site === undefined) return;
    const p = site.def.position;
    r.roster[1] = body(200, 'A', p.x, p.y, p.z);
    r.mode.beginInteract(r.roster[1] ?? body(200, 'A'), true);
    r.mode.onTick(1);
    expect(r.mode.interactIsDefusing).toBe(true);

    r.roster[1] = body(200, 'A', 500, 0, 500);
    r.mode.onTick(2);
    expect(r.mode.interactingEntity).toBe(-1);
    expect(r.mode.bomb).toBe('PLANTED');
  });
});

describe('the bomb going off', () => {
  it('explodes when the timer runs out, and the attackers take the round', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    const seen: string[] = [];
    r.bus.on(EV.BombExploded, (e) => seen.push(e.label));

    const ticks = Math.ceil(SND_CONFIG.bombTimerSeconds / DT) + 2;
    for (let tick = 1; tick <= ticks && r.mode.bomb === 'PLANTED'; tick++) r.mode.onTick(tick);

    expect(r.mode.bomb).toBe('EXPLODED');
    expect(seen).toHaveLength(1);
    const result = r.mode.checkWinCondition();
    expect(result?.winner).toBe('B');
    expect(result?.reason).toBe('Bomb detonated');
  });

  it('ignores the round clock once the bomb is down', () => {
    // Post-plant, only a defuse, the timer or a wipe decides it.
    const r = rig([body(100, 'B', 60, 0, 60), body(200, 'A', -60, 0, -60)], SND_CONFIG, {
      roundSecondsOverride: 6,
    });
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    for (let tick = 1; tick <= Math.round(6 / DT) + 10; tick++) {
      if (r.mode.bomb !== 'PLANTED') break;
      r.mode.onTick(tick);
    }
    expect(r.mode.bomb).toBe('PLANTED');
    expect(r.mode.checkWinCondition()).toBe(null);
  });
});

describe('deciding a round', () => {
  it('is undecided while both sides are up and the clock runs', () => {
    const { mode } = pair();
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('goes to the defenders when every attacker is down', () => {
    const r = rig([fallen(100, 'B'), body(200, 'A')]);
    const result = r.mode.checkWinCondition();
    expect(result?.winner).toBe('A');
    expect(result?.reason).toBe('Attackers eliminated');
  });

  it('goes to the attackers when every defender is down', () => {
    const r = rig([body(100, 'B'), fallen(200, 'A')]);
    const result = r.mode.checkWinCondition();
    expect(result?.winner).toBe('B');
    expect(result?.reason).toBe('Defenders eliminated');
  });

  it('goes to the defenders when the clock runs out with nothing planted', () => {
    const r = rig([body(100, 'B'), body(200, 'A')], SND_CONFIG, { roundSecondsOverride: 2 * DT });
    r.mode.onRoundStart(1);
    r.mode.onTick(1);
    r.mode.onTick(2);
    const result = r.mode.checkWinCondition();
    expect(result?.winner).toBe('A');
    expect(result?.reason).toBe('Time — bomb not planted');
  });

  it('still goes to the attackers if the defenders are wiped after the plant', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    r.roster[1] = fallen(200, 'A');
    const result = r.mode.checkWinCondition();
    expect(result?.winner).toBe('B');
    expect(result?.reason).toBe('Defenders eliminated');
  });

  it('reports a decided round exactly once', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    const ticks = Math.ceil(SND_CONFIG.bombTimerSeconds / DT) + 2;
    for (let tick = 1; tick <= ticks && r.mode.bomb === 'PLANTED'; tick++) r.mode.onTick(tick);
    expect(r.mode.checkWinCondition()?.reason).toBe('Bomb detonated');
    // Latched, then cleared. `MatchFlow` asks once a tick, and a round reported twice would
    // advance the series twice for one detonation.
    expect(r.mode.checkWinCondition()).toBe(null);
  });
});

describe('starting a round over', () => {
  it('puts the bomb, the sites, the clock and the interaction back', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    expect(r.mode.bomb).toBe('PLANTED');

    r.mode.onRoundStart(2);
    expect(r.mode.bomb).toBe('CARRIED');
    expect(r.mode.plantedSite).toBe(null);
    expect(r.mode.bombSecondsLeft).toBe(0);
    expect(r.mode.interactingEntity).toBe(-1);
    expect(r.mode.isCarrier(carrier.entityId)).toBe(false);
    for (const site of r.mode.objectiveZones) expect(site.owner).toBe('NONE');
  });

  it('cancels an interaction when the round ends', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const site = r.mode.objectiveZones[0];
    if (site === undefined) return;
    const p = site.def.position;
    r.roster[0] = body(carrier.entityId, carrier.team, p.x, p.y, p.z);
    r.mode.beginInteract(r.roster[0] ?? carrier, false);
    r.mode.onTick(1);
    expect(r.mode.interactingEntity).toBe(carrier.entityId);

    r.mode.onRoundEnd({ kind: 'round', round: 1, winner: 'A', reason: 'Time' });
    expect(r.mode.interactingEntity).toBe(-1);
  });
});

describe('adopting the server’s bomb', () => {
  it('takes the replicated state wholesale', () => {
    // The wire carries the site as an **index** into the mode's own list rather than as an id:
    // both sides built their sites from the same map, so the index is the cheaper handle.
    const r = pair();
    const site = r.mode.objectiveZones[1];
    expect(site).toBeDefined();
    if (site === undefined) return;

    r.mode.applyReplicatedBomb({
      state: 'PLANTED',
      plantedSiteIndex: 1,
      carrierId: -1,
      secondsLeft: 12.5,
      attackers: 'B',
      x: 1,
      y: 2,
      z: 3,
      interactFraction: 0.5,
      interactEntity: 200,
    });
    expect(r.mode.bomb).toBe('PLANTED');
    expect(r.mode.plantedSite?.id).toBe(site.id);
    expect(r.mode.bombSecondsLeft).toBeCloseTo(12.5, 6);
    expect(r.mode.bombInfo?.x).toBe(1);
    expect(r.mode.interactingEntity).toBe(200);
  });

  it('reads a negative index as no site at all', () => {
    const r = pair();
    r.mode.applyReplicatedBomb({
      state: 'CARRIED',
      plantedSiteIndex: -1,
      carrierId: 100,
      secondsLeft: 0,
      attackers: 'B',
      x: 0,
      y: 0,
      z: 0,
      interactFraction: 0,
      interactEntity: -1,
    });
    expect(r.mode.plantedSite).toBe(null);
    expect(r.mode.isCarrier(100)).toBe(true);
  });
});

describe('counting the living', () => {
  it('counts a side, and only the participating', () => {
    const r = rig([body(100, 'B'), body(101, 'B'), fallen(102, 'B'), body(200, 'A')]);
    expect(r.mode.aliveCount('B')).toBe(2);
    expect(r.mode.aliveCount('A')).toBe(1);
  });
});

describe('what the mode tells a bot to do', () => {
  it('sends the nearest attacker for the bomb and the rest to a site', () => {
    const near = body(100, 'B', FOUNDRY_MAP.objectives[0]?.position.x ?? 0, 0, 0);
    const far = body(101, 'B', 500, 0, 500);
    const r = rig([near, far, body(200, 'A')]);
    const forNear = r.mode.assign(near);
    const forFar = r.mode.assign(far);
    expect(forNear?.action).toBe('plant');
    expect(forFar?.action).toBe('plant');
    // One of them is sent to the bomb itself; the other to a site it will need.
    expect([forNear?.priority, forFar?.priority]).toContain(0.6);
  });

  it('tells the carrier to plant at a priority that breaks off a firefight', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const target = r.mode.assign(carrier);
    expect(target?.action).toBe('plant');
    expect(target?.priority).toBe(0.9);
  });

  it('tells an escort to head for the site without breaking off a fight', () => {
    const r = pair();
    takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const escort = body(101, 'B', 10, 0, 10);
    r.roster.push(escort);
    const target = r.mode.assign(escort);
    expect(target?.action).toBe('defend');
    expect(target?.priority).toBe(0.45);
  });

  it('holds the attackers around the site after the plant rather than on it', () => {
    // Pinned to the bomb they were a lethal blob no defuse survived — five rounds out of five.
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    const target = r.mode.assign(r.roster[0] ?? carrier);
    expect(target?.action).toBe('defend');
    expect(target?.priority).toBe(0.45);
  });

  it('sends exactly one defuser, and tells the rest to converge', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    plant(r, carrier);
    const site = r.mode.plantedSite;
    if (site === null || site === undefined) return;
    const p = site.def.position;

    const closest = body(200, 'A', p.x + 1, p.y, p.z);
    const further = body(201, 'A', p.x + 50, p.y, p.z);
    r.roster[1] = closest;
    r.roster.push(further);

    expect(r.mode.assign(closest)?.priority).toBe(0.95);
    expect(r.mode.assign(closest)?.action).toBe('defuse');
    expect(r.mode.assign(further)?.priority).toBe(0.4);
  });

  it('splits the defenders across the sites before the plant, stably', () => {
    const r = rig([body(100, 'B'), body(200, 'A'), body(201, 'A')]);
    const first = r.mode.assign(r.roster[1] ?? body(200, 'A'));
    const again = r.mode.assign(r.roster[1] ?? body(200, 'A'));
    expect(first?.id).toBe(again?.id);
    expect(first?.action).toBe('defend');
    expect(first?.priority).toBe(0.45);
    // The id picks the site, so two defenders with different ids can land on different sites.
    const other = r.mode.assign(r.roster[2] ?? body(201, 'A'));
    expect(other?.action).toBe('defend');
  });

  it('starts a bot’s plant or defuse when it arrives', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const site = r.mode.objectiveZones[0];
    if (site === undefined) return;
    const p = site.def.position;
    const onSite = body(carrier.entityId, carrier.team, p.x, p.y, p.z);
    r.roster[0] = onSite;

    const target = r.mode.assign(onSite);
    expect(target).not.toBe(null);
    if (target === null) return;
    r.mode.onArrived(onSite, target);
    // `interactingEntity` only reports a body once the bar has moved, so the arrival is
    // observed on the tick after it — which is also when a player's own plant becomes visible.
    expect(r.mode.interactingEntity).toBe(-1);
    r.mode.onTick(1);
    expect(r.mode.interactingEntity).toBe(onSite.entityId);
    expect(r.mode.interactIsDefusing).toBe(false);
  });

  it('ignores an arrival from a body that is down', () => {
    const r = pair();
    const carrier = takeBomb(r, r.roster[0] ?? body(100, 'B'));
    const target = r.mode.assign(carrier);
    if (target === null) return;
    r.mode.onArrived({ ...carrier, participating: false }, target);
    expect(r.mode.interactingEntity).toBe(-1);
  });
});
