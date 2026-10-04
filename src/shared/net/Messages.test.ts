import { describe, expect, it } from 'vitest';
import { ALL_WEAPONS } from '../weapons/WeaponDefs';
import { STREAK_WEAPON_IDS } from '../streaks/StreakWeapons';
import {
  readEvents,
  writeDamage,
  writeFired,
  writeKilled,
  type DamageEvent,
  type FiredEvent,
  type KilledEvent,
} from './Messages';
import { weaponIdAt, weaponIndexOf } from './Snapshot';
import { ByteReader, ByteWriter } from './Wire';

/**
 * The two halves of protocol v19 (2026-09-24), each one a place where a wrong bit is silent.
 *
 * The damage message's zone byte now carries three things — the zone, `lethal` and
 * `autonomous` — and a mask that is one bit wide in the wrong place reads a torso hit as a
 * head hit, or a sentry's burst as the player's own. The weapon table gained a tail, and a
 * tail that shifts the head renames every weapon in every killfeed at once.
 */

function roundTripDamage(e: DamageEvent): DamageEvent {
  const w = new ByteWriter(64);
  writeDamage(w, e);
  const bytes = w.bytes();
  const r = new ByteReader(bytes);
  let seen: DamageEvent | null = null;
  const ok = readEvents(r, 1, {
    onDamage: (got) => {
      // The reader hands back a reused scratch record, so it is copied before it is kept.
      seen = { ...got };
    },
  });
  expect(ok).toBe(true);
  if (seen === null) throw new Error('no damage event decoded');
  return seen;
}

describe('the damage message', () => {
  const base: DamageEvent = {
    sourceId: 3,
    targetId: 7,
    amount: 42.5,
    zone: 'torso',
    lethal: false,
    autonomous: false,
    x: 1.5,
    y: 2.25,
    z: -3.75,
  };

  it('round-trips every combination of the three things packed into one byte', () => {
    for (const zone of ['head', 'torso', 'arm', 'leg'] as const) {
      for (const lethal of [false, true]) {
        for (const autonomous of [false, true]) {
          const got = roundTripDamage({ ...base, zone, lethal, autonomous });
          expect({ zone: got.zone, lethal: got.lethal, autonomous: got.autonomous }).toEqual({
            zone,
            lethal,
            autonomous,
          });
        }
      }
    }
  });

  it('carries the rest of the record across unchanged', () => {
    const got = roundTripDamage({ ...base, zone: 'head', lethal: true, autonomous: true });
    expect(got.sourceId).toBe(base.sourceId);
    expect(got.targetId).toBe(base.targetId);
    expect(got.amount).toBeCloseTo(base.amount, 2);
    expect(got.x).toBeCloseTo(base.x, 2);
    expect(got.y).toBeCloseTo(base.y, 2);
    expect(got.z).toBeCloseTo(base.z, 2);
  });

  it('costs no more bytes than it did before the flag', () => {
    const w = new ByteWriter(64);
    writeDamage(w, base);
    // 1 kind + 2 ids + 2 amount + 1 packed zone + 6 position.
    expect(w.bytes().length).toBe(12);
  });
});

describe('the wire weapon table', () => {
  it('names every loadout weapon at the index it always had', () => {
    ALL_WEAPONS.forEach((def, index) => {
      expect(weaponIndexOf(def.id)).toBe(index);
      expect(weaponIdAt(index)).toBe(def.id);
    });
  });

  it('names the killstreak weapons in the tail, so a sentry kill is not "no weapon"', () => {
    for (const id of STREAK_WEAPON_IDS) {
      const index = weaponIndexOf(id);
      expect(index).toBeGreaterThanOrEqual(ALL_WEAPONS.length);
      expect(index).toBeLessThan(255);
      expect(weaponIdAt(index)).toBe(id);
    }
  });

  it('still answers 255 for a stranger, and the table fits under it', () => {
    expect(weaponIndexOf('no_such_weapon')).toBe(255);
    expect(weaponIdAt(255)).toBeNull();
    expect(ALL_WEAPONS.length + STREAK_WEAPON_IDS.length).toBeLessThan(255);
  });

  it('carries a streak weapon through the killed message', () => {
    const e: KilledEvent = {
      targetId: 4,
      sourceId: 1,
      weaponIndex: weaponIndexOf('streak_sentry'),
      zone: 'torso',
      killerHealth: 100,
    };
    const w = new ByteWriter(32);
    writeKilled(w, e);
    const r = new ByteReader(w.bytes());
    let index = -1;
    readEvents(r, 1, { onKilled: (got) => void (index = got.weaponIndex) });
    expect(weaponIdAt(index)).toBe('streak_sentry');
  });
});

/**
 * Protocol v27: whether a shot pings the minimap rides bit 7 of the byte the tracer and the
 * connected count already share. A wrong mask here would read a suppressed shot as eight more
 * pellets, or a sixteen-pellet hit as silent.
 */
describe('the fired message', () => {
  const base: FiredEvent = {
    sourceId: 4,
    weaponIndex: 2,
    x: 1,
    y: 1.5,
    z: -2,
    endX: 10,
    endY: 1.2,
    endZ: 7.5,
    material: 3,
    tracer: false,
    pelletsHit: 0,
    minimapPing: true,
  };

  function roundTripFired(e: FiredEvent): FiredEvent {
    const w = new ByteWriter(64);
    writeFired(w, e);
    let seen: FiredEvent | null = null;
    const ok = readEvents(new ByteReader(w.bytes()), 1, {
      onFired: (got) => {
        seen = { ...got };
      },
    });
    expect(ok).toBe(true);
    if (seen === null) throw new Error('no fired event decoded');
    return seen;
  }

  it('round-trips the minimap ping beside every tracer and pellet count the byte holds', () => {
    for (const minimapPing of [true, false]) {
      for (const tracer of [false, true]) {
        for (const pelletsHit of [0, 1, 8, 16]) {
          const got = roundTripFired({ ...base, minimapPing, tracer, pelletsHit });
          expect({ minimapPing: got.minimapPing, tracer: got.tracer, pelletsHit: got.pelletsHit }).toEqual({
            minimapPing,
            tracer,
            pelletsHit,
          });
        }
      }
    }
  });
});
