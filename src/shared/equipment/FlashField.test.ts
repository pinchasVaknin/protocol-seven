import { describe, expect, it } from 'vitest';
import type { Combatant } from '../ai/Combatant';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { HitboxRig } from '../combat/HitboxRig';
import { DEFAULT_EQUIPMENT_CONFIG } from './EquipmentConfig';
import { FlashField } from './FlashField';

/**
 * Who is flashed, and how badly — pinned.
 *
 * The brief's requirement is that the effect is **scaled by angle and by line of sight**, and the
 * design claim is that *one* number drives all three consequences: the player's white-out, a
 * bot's inability to acquire, and a bot's aim error. So the curve itself is what matters most
 * here, and `intensityFor` is also what `public/verify/arsenal.js` prints for criterion 7 — the
 * table below is that measurement, held still.
 *
 * The hold-then-fade shape is the second thing worth pinning: a flash that started fading
 * immediately reads as a bright light rather than as being blinded.
 */

const CFG = DEFAULT_EQUIPMENT_CONFIG;
const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };

/** A body at `(x, 0, z)` facing yaw 0, which looks down -Z everywhere in this project. */
function combatant(entityId: number, x = 0, z = 0, yaw = 0): Combatant {
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig: new HitboxRig(),
    team: 'B',
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
  };
}

interface Arena {
  readonly bus: GameBus;
  readonly field: FlashField;
  readonly flashed: Array<Record<string, unknown>>;
}

function arena(): Arena {
  const bus = createGameBus();
  const field = new FlashField(bus, CFG);
  const flashed: Array<Record<string, unknown>> = [];
  // The payload is a module-level singleton, so a copy is taken as each one arrives.
  bus.on(EV.EquipmentFlashed, (p) => flashed.push({ ...p }));
  return { bus, field, flashed };
}

describe('the scaling curve', () => {
  it('is the criterion 7 table: full in the face, a real reprieve facing away', () => {
    const { field } = arena();
    const row = (angleDeg: number): string =>
      angleDeg + ' deg: ' + field.intensityFor(angleDeg, 0, 11, true).toFixed(4);
    expect([row(0), row(45), row(90), row(180)].join('\n')).toMatchInlineSnapshot(`
      "0 deg: 1.0000
      45 deg: 0.6964
      90 deg: 0.4032
      180 deg: 0.2133"
    `);
  });

  it('is exactly one straight down the barrel at point blank', () => {
    const { field } = arena();
    expect(field.intensityFor(0, 0, 11, true)).toBe(1);
  });

  it('is half way down to the floor at the half angle', () => {
    const { field } = arena();
    const at = field.intensityFor(CFG.flashHalfAngleDeg, 0, 11, true);
    expect(at).toBe(CFG.flashRearFraction + (1 - CFG.flashRearFraction) * 0.5);
  });

  it('falls with the angle and never below the rear floor', () => {
    const { field } = arena();
    let last = Infinity;
    for (const angle of [0, 30, 60, 90, 120, 150, 180]) {
      const value = field.intensityFor(angle, 0, 11, true);
      expect(value).toBeLessThan(last);
      expect(value).toBeGreaterThan(CFG.flashRearFraction * 0.99);
      last = value;
    }
  });

  it('falls linearly with the distance, to nothing at the radius', () => {
    const { field } = arena();
    expect(field.intensityFor(0, 5.5, 11, true)).toBe(0.5);
    expect(field.intensityFor(0, 11, 11, true)).toBe(0);
    expect(field.intensityFor(0, 20, 11, true)).toBe(0);
  });

  it('is cut to a quarter with no line of sight', () => {
    const { field } = arena();
    expect(field.intensityFor(0, 0, 11, false)).toBe(CFG.flashNoLosFraction);
    expect(field.intensityFor(0, 0, 11, false)).toBeLessThan(field.intensityFor(0, 0, 11, true));
  });

  it('divides by neither a zero radius nor a zero half angle', () => {
    const { field } = arena();
    expect(Number.isFinite(field.intensityFor(0, 0, 0, true))).toBe(true);
    expect(Number.isFinite(field.intensityFor(90, 1, 0, true))).toBe(true);
  });
});

describe('a flash applied to somebody', () => {
  it('blinds them, reports the angle and the distance, and says so on the bus', () => {
    const { field, flashed } = arena();
    const target = combatant(2);
    // Two metres dead ahead of a body looking down -Z, at eye height.
    const intensity = field.apply(target, 1, 0, 1.6, -2, 11, 3, true);
    expect(intensity).toBeGreaterThan(0.8);
    expect(field.affectedCount).toBe(1);
    expect(field.blindness(2)).toBe(1);
    expect(flashed.length).toBe(1);
    expect(flashed[0]?.targetId).toBe(2);
    expect(flashed[0]?.sourceId).toBe(1);
    expect(flashed[0]?.hadLos).toBe(true);
    expect(flashed[0]?.angleDeg).toBe(0);
    expect(flashed[0]?.distance).toBe(2);
    expect(flashed[0]?.intensity).toBe(intensity);
  });

  it('measures the angle in the horizontal plane, so one on the floor is still in your eyes', () => {
    const { field } = arena();
    const ahead = field.apply(combatant(2), 1, 0, 0, -2, 11, 3, true);
    const atEye = field.apply(combatant(3), 1, 0, 1.6, -2, 11, 3, true);
    // The blast on the floor is further away, so not identical — but it is still a full-angle
    // flash rather than one scaled down for being below the view.
    expect(ahead).toBeGreaterThan(atEye * 0.8);
  });

  it('scales down for a body looking away from it', () => {
    const { field } = arena();
    const facing = field.apply(combatant(2), 1, 0, 1.6, -2, 11, 3, true);
    const away = field.apply(combatant(3, 0, 0, Math.PI), 1, 0, 1.6, -2, 11, 3, true);
    expect(away).toBeLessThan(facing);
    expect(away).toBeGreaterThan(0);
  });

  it('does nothing at all beyond the radius', () => {
    const { field, flashed } = arena();
    expect(field.apply(combatant(2, 0, -40), 1, 0, 1.6, 0, 11, 3, true)).toBe(0);
    expect(field.affectedCount).toBe(0);
    expect(flashed).toEqual([]);
  });

  it('does nothing when the effect would be a flicker', () => {
    const { field, flashed } = arena();
    // At the very edge of the radius the distance term is near zero.
    expect(field.apply(combatant(2, 0, -10.95), 1, 0, 1.6, 0, 11, 3, true)).toBe(0);
    expect(field.affectedCount).toBe(0);
    expect(flashed).toEqual([]);
  });

  it('is as long as the full seconds times the intensity', () => {
    const { field } = arena();
    const intensity = field.apply(combatant(2), 1, 0, 1.6, -2, 11, 3, true);
    expect(field.samples[0]?.seconds).toBe(3 * intensity);
  });

  it('never shortens a flash already burning, and does lengthen one', () => {
    const { field } = arena();
    const target = combatant(2);
    field.apply(target, 1, 0, 1.6, -2, 11, 3, true);
    const strong = field.samples[0]?.seconds ?? 0;

    // A weaker one on top must not replace it.
    field.apply(target, 1, 0, 1.6, -9, 11, 3, true);
    expect(field.samples.length).toBe(2);
    expect(field.blindness(2)).toBe(1);
    field.step();
    const afterWeak = field.blindness(2);

    const second = arena();
    second.field.apply(target, 1, 0, 1.6, -2, 11, 3, true);
    second.field.step();
    expect(afterWeak).toBe(second.field.blindness(2));
    expect(strong).toBeGreaterThan(0);
  });

  it('keeps the last thirty-two applications for the debug panel and no more', () => {
    const { field } = arena();
    for (let i = 0; i < 40; i++) field.apply(combatant(100 + i), 1, 0, 1.6, -2, 11, 3, true);
    expect(field.samples.length).toBe(32);
    expect(field.samples[31]?.targetId).toBe(139);
    expect(field.samples[0]?.targetId).toBe(108);
  });
});

describe('the perk that resists one', () => {
  it('scales the one number, so the screen and the AI agree about it', () => {
    const { field } = arena();
    const plain = field.apply(combatant(2), 1, 0, 1.6, -2, 11, 3, true);

    const hardened = arena();
    hardened.field.resistance = (id) => (id === 2 ? 0.5 : 1);
    const resisted = hardened.field.apply(combatant(2), 1, 0, 1.6, -2, 11, 3, true);
    expect(resisted).toBe(plain * 0.5);
    expect(hardened.flashed[0]?.intensity).toBe(resisted);
    expect(hardened.field.samples[0]?.intensity).toBe(resisted);
  });

  it('applies to nobody when nothing resists, which is every M5 measurement', () => {
    const { field } = arena();
    expect(field.resistance).toBe(null);
  });

  it('can refuse a flash outright', () => {
    const { field } = arena();
    field.resistance = () => 0;
    expect(field.apply(combatant(2), 1, 0, 1.6, -2, 11, 3, true)).toBe(0);
    expect(field.affectedCount).toBe(0);
  });
});

describe('a flash over its life', () => {
  it('holds at full, then fades, then is gone', () => {
    const { field } = arena();
    field.apply(combatant(2), 1, 0, 1.6, -2, 11, 1, true);
    const total = field.samples[0]?.seconds ?? 0;
    const hold = total * CFG.flashHoldFraction;

    // Through the hold it is exactly 1: being blinded, not looking at a bright light.
    for (let t = 0; t < hold - DT; t += DT) {
      field.step();
      expect(field.blindness(2)).toBe(1);
    }

    // Then it comes down, monotonically, and the state is dropped when it runs out.
    let last = 1;
    let guard = 0;
    while (field.affectedCount > 0 && guard++ < 1000) {
      field.step();
      const now = field.blindness(2);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
    expect(field.blindness(2)).toBe(0);
    expect(field.affectedCount).toBe(0);
  });

  it('reads as nothing for a body that was never flashed', () => {
    const { field } = arena();
    expect(field.blindness(99)).toBe(0);
  });

  it('forgets everything on clear', () => {
    const { field } = arena();
    field.apply(combatant(2), 1, 0, 1.6, -2, 11, 3, true);
    field.clear();
    expect(field.affectedCount).toBe(0);
    expect(field.samples.length).toBe(0);
    expect(field.blindness(2)).toBe(0);
  });
});
