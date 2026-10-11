import { describe, expect, it } from 'vitest';
import type { Combatant } from '../ai/Combatant';
import { DamageSystem } from '../combat/DamageSystem';
import { HitboxRig } from '../combat/HitboxRig';
import { installClock } from '../core/Clock';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { DEG2RAD } from '../core/MathUtil';
import { simCos, simSin } from '../core/SimMath';
import { Health } from '../player/Health';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import { DEFAULT_EQUIPMENT_CONFIG } from './EquipmentConfig';
import { equipmentDef } from './EquipmentDefs';
import { EquipmentSystem, makeEquipmentInventory, type EquipmentInventory } from './EquipmentSystem';

/**
 * Everything thrown, and everything it does — pinned.
 *
 * Four claims are held still here, and each of them is a decision the file argues for at length.
 *
 * **One throw door.** A bot's frag and a player's frag are the same object with the same arc,
 * because both end at `throwFrom`; so the launch point and the launch velocity are pinned
 * exactly, down to the inherited fraction of the thrower's own speed.
 *
 * **One damage door.** Blast damage goes through `DamageSystem.apply` with the equipment's
 * `damageProfile`, so a grenade kill needs no special case anywhere.
 *
 * **One process decides.** `authoritative` false — a networked client — still spawns the cloud
 * and still fires the event that draws the bang, and resolves no damage, no death and no flash.
 *
 * **A claymore watches an arc.** Six separate reasons it will not fire, each of which was once a
 * way to delete your own equipment or to be killed through a wall.
 */

let fakeNow = 1000;
installClock({ nowMs: () => fakeNow });

const CFG = DEFAULT_EQUIPMENT_CONFIG;
const FRAG = equipmentDef('frag');
const FLASHBANG = equipmentDef('flashbang');
const SMOKE_DEF = equipmentDef('smoke');
const CLAYMORE = equipmentDef('claymore');
const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };

const BOUNDS = { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 12, z: 40 } };

/** A world with a floor whose top face is y = 0, plus whatever else the test asks for. */
function world(...boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>) {
  const set = new ColliderSet(boxes.length + 2);
  set.add({ x: 0, y: -0.5, z: 0 }, { x: 80, y: 1, z: 80 }, 0, 0, 0, 'floor');
  for (const [x, y, z, sx, sy, sz] of boxes) {
    set.add({ x, y, z }, { x: sx, y: sy, z: sz }, 0, 0, 0, 'concrete');
  }
  return new CollisionWorld(set, BOUNDS, 4);
}

/** A body at `(x, 0, z)` on `team`, facing yaw 0 — which looks down -Z. */
function combatant(
  entityId: number,
  team: 'A' | 'B',
  x = 0,
  z = 0,
  yaw = 0,
  over: Partial<Combatant> = {},
): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(x, 0, z, yaw);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: x,
    py: 0,
    pz: z,
    yaw,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
    ...over,
  };
}

interface Arena {
  readonly bus: GameBus;
  readonly system: EquipmentSystem;
  readonly damage: DamageSystem;
  readonly roster: Combatant[];
  readonly events: Record<string, Array<Record<string, unknown>>>;
}

function arena(
  opts: {
    roster?: Combatant[];
    authoritative?: boolean;
    freeForAll?: boolean;
    cw?: CollisionWorld;
  } = {},
): Arena {
  const bus = createGameBus();
  const damage = new DamageSystem(bus);
  const roster = opts.roster ?? [];
  for (const c of roster) damage.register(c);
  const system = new EquipmentSystem({
    bus,
    world: opts.cw ?? world(),
    damage,
    roster,
    cfg: CFG,
    authoritative: opts.authoritative,
    freeForAll: opts.freeForAll ?? false,
  });
  // Every payload on this bus is a module-level singleton, so a copy is taken as each arrives.
  const events: Record<string, Array<Record<string, unknown>>> = {
    thrown: [],
    bounced: [],
    armed: [],
    exploded: [],
    smoke: [],
    flashed: [],
  };
  bus.on(EV.EquipmentThrown, (p) => events.thrown?.push({ ...p }));
  bus.on(EV.EquipmentBounced, (p) => events.bounced?.push({ ...p }));
  bus.on(EV.EquipmentArmed, (p) => events.armed?.push({ ...p }));
  bus.on(EV.EquipmentExploded, (p) => events.exploded?.push({ ...p }));
  bus.on(EV.SmokeSpawned, (p) => events.smoke?.push({ ...p }));
  bus.on(EV.EquipmentFlashed, (p) => events.flashed?.push({ ...p }));
  return { bus, system, damage, roster, events };
}

/** The system stepped with no local player to report a threat to, as a server does. */
function serverTick(system: EquipmentSystem, ticks = 1): void {
  for (let i = 0; i < ticks; i++) system.simulate(0, 0, 0, 'A', -1, false);
}

describe('an inventory', () => {
  it('starts full in both slots, from the authored counts', () => {
    const inv = makeEquipmentInventory('frag', 'smoke');
    expect(inv).toEqual({
      lethal: 'frag',
      tactical: 'smoke',
      lethalCount: FRAG.count,
      tacticalCount: SMOKE_DEF.count,
    } satisfies EquipmentInventory);
  });

  it('answers which def and how many are in a slot', () => {
    const inv = makeEquipmentInventory('claymore', 'flashbang');
    expect(EquipmentSystem.slotDef(inv, 'lethal')).toBe(CLAYMORE);
    expect(EquipmentSystem.slotDef(inv, 'tactical')).toBe(FLASHBANG);
    expect(EquipmentSystem.slotCount(inv, 'lethal')).toBe(1);
    expect(EquipmentSystem.slotCount(inv, 'tactical')).toBe(2);
  });

  it('spends a slot without going below nothing', () => {
    const inv = makeEquipmentInventory('frag', 'flashbang');
    EquipmentSystem.spendSlot(inv, 'lethal');
    expect(inv.lethalCount).toBe(1);
    EquipmentSystem.spendSlot(inv, 'lethal');
    EquipmentSystem.spendSlot(inv, 'lethal');
    expect(inv.lethalCount).toBe(0);
    expect(inv.tacticalCount).toBe(2);
  });

  it('is refilled whole on respawn, because equipment is per life', () => {
    const inv = makeEquipmentInventory('frag', 'flashbang');
    EquipmentSystem.spendSlot(inv, 'lethal');
    EquipmentSystem.spendSlot(inv, 'tactical');
    EquipmentSystem.refill(inv);
    expect(inv.lethalCount).toBe(FRAG.count);
    expect(inv.tacticalCount).toBe(FLASHBANG.count);
  });
});

describe('a throw', () => {
  it('leaves the hand at the release offset, along the lofted aim', () => {
    const { system } = arena();
    const pitch = 0;
    const p = system.throwFrom(FRAG, 7, 'A', 1, 2, 3, 0, pitch, 0, 0, 0, false);
    expect(p).not.toBe(null);
    if (p === null) return;

    // The whole launch, written out the way the system computes it: loft the pitch by the def's
    // own angle, take the unit direction from that, and step one release offset along it.
    const loft = pitch + FRAG.throwLoftDeg * DEG2RAD;
    const cp = simCos(loft);
    const dx = -simSin(0) * cp;
    const dy = simSin(loft);
    const dz = -simCos(0) * cp;
    expect(p.x).toBe(1 + dx * CFG.throwOffsetForward);
    expect(p.y).toBe(2 + CFG.throwOffsetUp + dy * CFG.throwOffsetForward);
    expect(p.z).toBe(3 + dz * CFG.throwOffsetForward);
    // The inherited term is added whether or not the thrower is moving, which is why this is
    // written out rather than compared against `dx * throwSpeed` alone.
    expect(p.vx).toBe(dx * FRAG.throwSpeed + 0 * CFG.throwInheritVelocity);
    expect(p.vy).toBe(dy * FRAG.throwSpeed);
    expect(p.vz).toBe(dz * FRAG.throwSpeed + 0 * CFG.throwInheritVelocity);
    // Yaw 0 looks down -Z, and the loft is above the aim.
    expect(p.vz).toBeLessThan(0);
    expect(p.vy).toBeGreaterThan(0);
  });

  it('inherits half the thrower own speed, horizontally only', () => {
    const { system } = arena();
    const still = system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, false);
    const running = system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 6, -4, 0, false);
    expect(still).not.toBe(null);
    expect(running).not.toBe(null);
    if (still === null || running === null) return;
    expect(running.vx).toBe(still.vx + 6 * CFG.throwInheritVelocity);
    expect(running.vz).toBe(still.vz + -4 * CFG.throwInheritVelocity);
    expect(running.vy).toBe(still.vy);
  });

  it('drops it at your feet underhand instead of lobbing it', () => {
    const { system } = arena();
    const lob = system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, false);
    const drop = system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, true);
    expect(lob).not.toBe(null);
    expect(drop).not.toBe(null);
    if (lob === null || drop === null) return;
    // `dropScale` multiplies the *speed*, before the direction is applied — a different
    // grouping from scaling the finished velocity, and so a different last bit.
    expect(drop.vz).toBeCloseTo(lob.vz * FRAG.dropScale, 12);
    expect(drop.vy).toBeCloseTo(lob.vy * FRAG.dropScale, 12);
    expect(Math.hypot(drop.vx, drop.vy, drop.vz)).toBeCloseTo(
      Math.hypot(lob.vx, lob.vy, lob.vz) * FRAG.dropScale,
      12,
    );
    // Same release point: only the speed changes.
    expect(drop.x).toBe(lob.x);
    expect(drop.y).toBe(lob.y);
    expect(drop.z).toBe(lob.z);
  });

  it('carries the fuse the cook already burned, and never a spent one', () => {
    const { system } = arena();
    expect(system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, false)?.fuse).toBe(
      FRAG.fuseSeconds,
    );
    expect(system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 1.5, false)?.fuse).toBe(
      FRAG.fuseSeconds - 1.5,
    );
    // Cooked past the fuse: a floor rather than a negative, which would read as trigger-armed.
    expect(system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 99, false)?.fuse).toBe(0.05);
  });

  it('gives a claymore no fuse at all, which is what arms it by trigger instead', () => {
    const { system } = arena();
    expect(system.throwFrom(CLAYMORE, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, false)?.fuse).toBe(-1);
  });

  it('says so on the bus, and counts itself', () => {
    const { system, events } = arena();
    const p = system.throwFrom(FRAG, 7, 'A', 1, 2, 3, 0, 0, 0, 0, 0.4, false);
    expect(system.thrownTotal).toBe(1);
    expect(events.thrown).toEqual([
      { equipmentId: 'frag', sourceId: 7, x: p?.x, y: p?.y, z: p?.z, cooked: 0.4 },
    ]);
  });

  it('refuses rather than silently eating a grenade when the pool is full', () => {
    const { system, events } = arena();
    for (let i = 0; i < 32; i++) {
      expect(system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, false)).not.toBe(null);
    }
    expect(system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, false)).toBe(null);
    expect(system.thrownTotal).toBe(32);
    expect(events.thrown?.length).toBe(32);
  });
});

describe('a grenade in the air', () => {
  it('burns its fuse a tick a tick and goes off when it runs out', () => {
    const { system, events } = arena();
    const p = system.throwFrom(FRAG, 7, 'A', 0, 5, 0, 0, Math.PI * 0.5, 0, 0, 0, false);
    expect(p).not.toBe(null);
    if (p === null) return;
    // Two ticks of fuse left. Doubling and halving a float is exact, so the second tick takes it
    // to exactly zero rather than to a hair above.
    p.fuse = DT * 2;
    serverTick(system);
    expect(p.fuse).toBe(DT);
    expect(events.exploded?.length).toBe(0);
    serverTick(system);
    expect(events.exploded?.length).toBe(1);
    expect(p.active).toBe(false);
    expect(system.detonatedTotal).toBe(1);
  });

  it('says where it bounced, how hard, and off what', () => {
    const { system, events } = arena();
    system.throwFrom(FRAG, 7, 'A', 0, 0.3, 0, 0, -Math.PI * 0.5, 0, 0, 0, false);
    for (let i = 0; i < 20 && (events.bounced?.length ?? 0) === 0; i++) serverTick(system);
    expect(events.bounced?.length).toBeGreaterThan(0);
    expect(events.bounced?.[0]?.equipmentId).toBe('frag');
    expect(events.bounced?.[0]?.stuck).toBe(false);
    expect(events.bounced?.[0]?.speed).toBeGreaterThan(0);
  });

  it('is left entirely alone when it is somebody else grenade, replicated', () => {
    const { system, events } = arena();
    const p = system.throwFrom(FRAG, 7, 'A', 0, 5, 0, 0, 0, 0, 0, 0, false);
    expect(p).not.toBe(null);
    if (p === null) return;
    p.replicated = true;
    p.fuse = -0.5;
    const y = p.y;
    serverTick(system, 10);
    // No flight, no fuse, no detonation: the server owns all three.
    expect(p.y).toBe(y);
    expect(p.fuse).toBe(-0.5);
    expect(p.active).toBe(true);
    expect(events.exploded?.length).toBe(0);
  });

  it('is cleared away wholesale without hurting anybody', () => {
    const victim = combatant(2, 'B');
    const { system, events } = arena({ roster: [victim] });
    system.throwFrom(FRAG, 7, 'A', 0, 2, 0, 0, 0, 0, 0, 0, false);
    system.smoke.spawn(0, 0, 0, 4, 12, 1.6);
    system.clear();
    expect(system.projectiles.liveCount).toBe(0);
    expect(system.smoke.liveCount).toBe(0);
    expect(system.threat.active).toBe(false);
    expect(events.exploded?.length).toBe(0);
    expect(victim.health.current).toBe(HEALTH.max);
  });
});

describe('a blast', () => {
  it('goes through the one damage door, so a grenade kill needs no special case', () => {
    const victim = combatant(2, 'B');
    const { system, damage, events } = arena({ roster: [victim] });
    const p = system.throwFrom(FRAG, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, FRAG.fuseSeconds, false);
    expect(p).not.toBe(null);
    if (p === null) return;
    p.phase = 'DETONATE';
    serverTick(system);

    expect(victim.health.current).toBeLessThan(HEALTH.max);
    expect(damage.lastHit.valid).toBe(true);
    expect(damage.lastHit.targetName).toBe('E2');
    expect(damage.lastHit.zone).toBe('torso');
    expect(events.exploded?.[0]?.victims).toBe(1);
    expect(events.exploded?.[0]?.radius).toBe(FRAG.effectRadius);
    expect(events.exploded?.[0]?.sourceId).toBe(1);
  });

  it('spares anybody beyond its radius', () => {
    const near = combatant(2, 'B', 1, 0);
    const far = combatant(3, 'B', 30, 0);
    const { system, events } = arena({ roster: [near, far] });
    const p = system.throwFrom(FRAG, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, FRAG.fuseSeconds, false);
    if (p === null) return;
    p.phase = 'DETONATE';
    serverTick(system);
    expect(near.health.current).toBeLessThan(HEALTH.max);
    expect(far.health.current).toBe(HEALTH.max);
    expect(events.exploded?.[0]?.victims).toBe(1);
  });

  it('is stopped by cover, which is the entire reason to be behind it', () => {
    const victim = combatant(2, 'B', 3, 0);
    // A thick wall between the blast at the origin and the body at x = 3.
    const { system } = arena({ roster: [victim], cw: world([1.5, 2, 0, 1, 6, 10]) });
    const p = system.throwFrom(FRAG, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, FRAG.fuseSeconds, false);
    if (p === null) return;
    p.x = 0;
    p.y = 1.2;
    p.z = 0;
    p.phase = 'DETONATE';
    serverTick(system);
    expect(victim.health.current).toBe(HEALTH.max);
  });

  it('skips a body that is not in the match', () => {
    const out = combatant(2, 'B', 0, 0, 0, { participating: false });
    const { system, events } = arena({ roster: [out] });
    const p = system.throwFrom(FRAG, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, FRAG.fuseSeconds, false);
    if (p === null) return;
    p.phase = 'DETONATE';
    serverTick(system);
    expect(out.health.current).toBe(HEALTH.max);
    expect(events.exploded?.[0]?.victims).toBe(0);
  });

  it('blinds rather than hurts when it is a flashbang', () => {
    const victim = combatant(2, 'B', 1, 0);
    const { system, events } = arena({ roster: [victim] });
    const p = system.throwFrom(FLASHBANG, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, FLASHBANG.fuseSeconds, false);
    if (p === null) return;
    p.phase = 'DETONATE';
    serverTick(system);
    expect(victim.health.current).toBe(HEALTH.max);
    expect(system.flash.blindness(2)).toBeGreaterThan(0);
    expect(events.flashed?.length).toBe(1);
    expect(events.exploded?.[0]?.victims).toBe(0);
  });

  it('leaves a cloud rather than a crater when it is a smoke', () => {
    const victim = combatant(2, 'B', 1, 0);
    const { system, events } = arena({ roster: [victim] });
    const p = system.throwFrom(SMOKE_DEF, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, SMOKE_DEF.fuseSeconds, false);
    if (p === null) return;
    p.x = 0;
    p.y = 0;
    p.z = 0;
    p.phase = 'DETONATE';
    serverTick(system);
    expect(victim.health.current).toBe(HEALTH.max);
    expect(system.smoke.liveCount).toBe(1);
    expect(events.smoke).toEqual([
      { x: 0, y: 0.6, z: 0, radius: SMOKE_DEF.smokeRadius, seconds: SMOKE_DEF.smokeSeconds },
    ]);
  });
});

describe('a networked client', () => {
  it('draws the bang and the cloud and decides none of it', () => {
    const victim = combatant(2, 'B', 1, 0);
    const { system, events } = arena({ roster: [victim], authoritative: false });
    const p = system.throwFrom(FLASHBANG, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, FLASHBANG.fuseSeconds, false);
    if (p === null) return;
    p.phase = 'DETONATE';
    serverTick(system);
    // The event still fires: it is what drives the bang, the shake and the scorch.
    expect(events.exploded?.length).toBe(1);
    expect(events.exploded?.[0]?.victims).toBe(0);
    // Damage, death and blinding arrive replicated instead.
    expect(victim.health.current).toBe(HEALTH.max);
    expect(system.flash.blindness(2)).toBe(0);
    expect(events.flashed?.length).toBe(0);
  });

  it('still spawns the cloud it has to draw', () => {
    const { system, events } = arena({ authoritative: false });
    const p = system.throwFrom(SMOKE_DEF, 1, 'A', 0, 1.2, 0, 0, 0, 0, 0, SMOKE_DEF.fuseSeconds, false);
    if (p === null) return;
    p.phase = 'DETONATE';
    serverTick(system);
    expect(system.smoke.liveCount).toBe(1);
    expect(events.smoke?.length).toBe(1);
  });
});

describe('a claymore', () => {
  /** A planted, armed charge at the origin facing down -Z, with its poll due. */
  function planted(a: Arena): void {
    const p = a.system.throwFrom(CLAYMORE, 1, 'A', 0, 0.2, 0, 0, 0, 0, 0, 0, false);
    expect(p).not.toBe(null);
    if (p === null) return;
    p.x = 0;
    p.y = 0.2;
    p.z = 0;
    p.yaw = 0;
    p.phase = 'ARMED';
    p.pollTimer = 0;
    p.resting = true;
  }

  it('arms itself after its arm time, and says so', () => {
    const { system, events } = arena();
    const p = system.throwFrom(CLAYMORE, 1, 'A', 0, 0.2, 0, 0, -Math.PI * 0.5, 0, 0, 0, false);
    if (p === null) return;
    for (let i = 0; i < 30 && p.phase === 'LIVE'; i++) serverTick(system);
    expect(p.phase).toBe('ARMING');
    // One tick short of the authored arm time: the tick that plants it also runs the ARMING
    // case, because `step` and the fuse switch are the same pass over the same projectile.
    expect(p.fuse).toBe(CLAYMORE.armSeconds - DT);
    for (let i = 0; i < 200 && p.phase === 'ARMING'; i++) serverTick(system);
    expect(p.phase).toBe('ARMED');
    expect(events.armed?.length).toBe(1);
    expect(events.armed?.[0]?.equipmentId).toBe('claymore');
    expect(events.armed?.[0]?.sourceId).toBe(1);
  });

  it('fires on an enemy inside its arc, after the trigger delay', () => {
    const enemy = combatant(2, 'B', 0, -2);
    const a = arena({ roster: [enemy] });
    planted(a);
    serverTick(a.system);
    const p = a.system.projectiles.items[0];
    expect(p?.phase).toBe('LIVE');
    expect(p?.fuse).toBe(CFG.triggerDelay);
    for (let i = 0; i < 60 && (a.events.exploded?.length ?? 0) === 0; i++) serverTick(a.system);
    expect(a.events.exploded?.length).toBe(1);
  });

  it('ignores an enemy behind it, outside the cone', () => {
    const behind = combatant(2, 'B', 0, 2);
    const a = arena({ roster: [behind] });
    planted(a);
    serverTick(a.system, 5);
    expect(a.system.projectiles.items[0]?.phase).toBe('ARMED');
  });

  it('ignores an enemy beyond its trigger radius', () => {
    const far = combatant(2, 'B', 0, -20);
    const a = arena({ roster: [far] });
    planted(a);
    serverTick(a.system, 5);
    expect(a.system.projectiles.items[0]?.phase).toBe('ARMED');
  });

  it('ignores an enemy on a different floor', () => {
    const above = combatant(2, 'B', 0, -2, 0, { py: 8 });
    const a = arena({ roster: [above] });
    planted(a);
    serverTick(a.system, 5);
    expect(a.system.projectiles.items[0]?.phase).toBe('ARMED');
  });

  it('ignores an enemy behind a wall, so it cannot kill through one', () => {
    const enemy = combatant(2, 'B', 0, -3);
    const a = arena({ roster: [enemy], cw: world([0, 2, -1.5, 10, 6, 0.6]) });
    planted(a);
    serverTick(a.system, 5);
    expect(a.system.projectiles.items[0]?.phase).toBe('ARMED');
  });

  it('never fires on its own owner, or on a team-mate', () => {
    const owner = combatant(1, 'A', 0, -2);
    const mate = combatant(3, 'A', 0, -2.2);
    const a = arena({ roster: [owner, mate] });
    planted(a);
    serverTick(a.system, 5);
    expect(a.system.projectiles.items[0]?.phase).toBe('ARMED');
  });

  it('does fire on a substrate-mate once there are no team-mates', () => {
    const other = combatant(3, 'A', 0, -2);
    const a = arena({ roster: [other], freeForAll: true });
    expect(a.system.freeForAll).toBe(true);
    planted(a);
    serverTick(a.system);
    expect(a.system.projectiles.items[0]?.phase).toBe('LIVE');
  });

  it('still spares its own owner in free-for-all, because that is an id not a side', () => {
    const owner = combatant(1, 'A', 0, -2);
    const a = arena({ roster: [owner], freeForAll: true });
    planted(a);
    serverTick(a.system, 5);
    expect(a.system.projectiles.items[0]?.phase).toBe('ARMED');
  });

  it('polls on its own interval rather than every tick', () => {
    const enemy = combatant(2, 'B', 0, -2);
    const a = arena({ roster: [enemy] });
    planted(a);
    const p = a.system.projectiles.items[0];
    if (p === undefined) return;
    p.pollTimer = CFG.triggerInterval;
    serverTick(a.system);
    expect(p.phase).toBe('ARMED');
    serverTick(a.system, Math.ceil(CFG.triggerInterval / DT));
    expect(p.phase).toBe('LIVE');
  });
});

describe('the threat indicator', () => {
  it('reports the nearest live enemy lethal inside the radius', () => {
    const { system } = arena();
    const near = system.throwFrom(FRAG, 2, 'B', 3, 1.2, 0, 0, 0, 0, 0, 0, false);
    const far = system.throwFrom(FRAG, 2, 'B', 7, 1.2, 0, 0, 0, 0, 0, 0, false);
    expect(near).not.toBe(null);
    expect(far).not.toBe(null);
    system.simulate(0, 1.2, 0, 'A', 1);
    expect(system.threat.active).toBe(true);
    expect(system.threat.distance).toBeLessThan(5);
    expect(system.threat.fuse).toBeGreaterThan(0);
  });

  it('never reports your own grenade back at you', () => {
    const { system } = arena();
    system.throwFrom(FRAG, 1, 'A', 2, 1.2, 0, 0, 0, 0, 0, 0, false);
    system.simulate(0, 1.2, 0, 'A', 1);
    expect(system.threat.active).toBe(false);
  });

  it('never reports a team-mate grenade, and does report one in free-for-all', () => {
    const teams = arena();
    teams.system.throwFrom(FRAG, 2, 'A', 2, 1.2, 0, 0, 0, 0, 0, 0, false);
    teams.system.simulate(0, 1.2, 0, 'A', 1);
    expect(teams.system.threat.active).toBe(false);

    const ffa = arena({ freeForAll: true });
    ffa.system.throwFrom(FRAG, 2, 'A', 2, 1.2, 0, 0, 0, 0, 0, 0, false);
    ffa.system.simulate(0, 1.2, 0, 'A', 1);
    expect(ffa.system.threat.active).toBe(true);
  });

  it('never reports something that does no damage', () => {
    const { system } = arena();
    system.throwFrom(FLASHBANG, 2, 'B', 2, 1.2, 0, 0, 0, 0, 0, 0, false);
    system.simulate(0, 1.2, 0, 'A', 1);
    expect(system.threat.active).toBe(false);
  });

  it('never reports one further away than the indicator reaches', () => {
    const { system } = arena();
    system.throwFrom(FRAG, 2, 'B', CFG.indicatorRadius + 4, 1.2, 0, 0, 0, 0, 0, 0, false);
    system.simulate(0, 1.2, 0, 'A', 1);
    expect(system.threat.active).toBe(false);
  });

  it('is not computed at all on a server, which has no local player', () => {
    const { system } = arena();
    system.throwFrom(FRAG, 2, 'B', 1, 1.2, 0, 0, 0, 0, 0, 0, false);
    serverTick(system);
    expect(system.threat.active).toBe(false);
  });
});
