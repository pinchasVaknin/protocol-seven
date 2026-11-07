import { beforeEach, describe, expect, it } from 'vitest';
import { STREAK_DEFS } from '../../shared/streaks/StreakDefs';
import type { StreakView } from '../../shared/net/Skirmish';
import { ReplicatedStreaks } from './ReplicatedStreaks';

/**
 * A pure replica: everything it answers was put there by the last `apply`, and nothing in it
 * advances on its own. The tests are mostly about that second half — what it refuses to do.
 */

const KIND = Object.fromEntries(STREAK_DEFS.map((def, index) => [def.id, index])) as Record<string, number>;

function view(overrides: Partial<StreakView> = {}): StreakView {
  return {
    offers: [],
    balance: 0,
    nextKind: -1,
    nextPrice: 0,
    scrambled: false,
    sweepAngle: -1,
    contacts: [],
    entities: [],
    ...overrides,
  } as StreakView;
}

function entity(instanceId: number, kind: number, ownerId: number): Record<string, number> {
  return { instanceId, kind, ownerId, team: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 255 };
}

let streaks: ReplicatedStreaks;

beforeEach(() => {
  streaks = new ReplicatedStreaks();
});

describe('before any frame has arrived', () => {
  it('says so, and answers empty for everything', () => {
    expect(streaks.hasState).toBe(false);
    expect(streaks.balance).toBe(0);
    expect(streaks.offers).toEqual([]);
    expect(streaks.scrambled).toBe(false);
    expect(streaks.sweepAngle).toBe(-1);
    expect(streaks.contacts).toEqual([]);
    expect(streaks.entities).toEqual([]);
    expect(streaks.next).toBeNull();
  });

  it('prices nothing and affords nothing', () => {
    expect(streaks.priceOf('uav')).toBe(0);
    expect(streaks.lockoutSeconds('uav')).toBe(0);
    expect(streaks.canAfford('uav')).toBe(false);
  });
});

describe('apply', () => {
  it('records that a frame arrived', () => {
    streaks.apply(view());
    expect(streaks.hasState).toBe(true);
  });

  it('resolves the wire’s kind index to a streak id', () => {
    streaks.apply(view({ offers: [{ kind: KIND['uav'] ?? 0, price: 3, lockoutCs: 0 }] } as Partial<StreakView>));
    expect(streaks.offers.map((o) => o.id)).toEqual(['uav']);
  });

  it('drops an offer whose kind the client does not know', () => {
    streaks.apply(view({ offers: [{ kind: 999, price: 3, lockoutCs: 0 }] } as Partial<StreakView>));
    expect(streaks.offers).toEqual([]);
  });

  it('turns the wire’s centiseconds into seconds, once', () => {
    streaks.apply(view({ offers: [{ kind: KIND['uav'] ?? 0, price: 3, lockoutCs: 450 }] } as Partial<StreakView>));
    expect(streaks.offers[0]?.lockoutSeconds).toBeCloseTo(4.5, 10);
    expect(streaks.lockoutSeconds('uav')).toBeCloseTo(4.5, 10);
  });

  it('replaces the whole picture rather than merging into it', () => {
    streaks.apply(view({ balance: 9, scrambled: true, sweepAngle: 2, entities: [entity(1, 0, 100)] } as unknown as Partial<StreakView>));
    streaks.apply(view());
    expect(streaks.balance).toBe(0);
    expect(streaks.scrambled).toBe(false);
    expect(streaks.sweepAngle).toBe(-1);
    expect(streaks.entities).toEqual([]);
  });

  it('keeps the entities and contacts it was handed', () => {
    const entities = [entity(1, KIND['sentry'] ?? 0, 100), entity(2, KIND['care_package'] ?? 0, 101)];
    streaks.apply(view({ entities, contacts: [{ x: 1, z: 2 }] } as unknown as Partial<StreakView>));
    expect(streaks.entities).toHaveLength(2);
    expect(streaks.contacts).toHaveLength(1);
  });
});

describe('what a key costs and whether it works', () => {
  beforeEach(() => {
    streaks.apply(
      view({
        balance: 4,
        offers: [
          { kind: KIND['uav'] ?? 0, price: 3, lockoutCs: 0 },
          { kind: KIND['care_package'] ?? 0, price: 4, lockoutCs: 0 },
          { kind: KIND['sentry'] ?? 0, price: 5, lockoutCs: 0 },
          { kind: KIND['mortar'] ?? 0, price: 2, lockoutCs: 300 },
        ],
      } as Partial<StreakView>),
    );
  });

  it('prices each offer, and zero for one not offered', () => {
    expect(streaks.priceOf('uav')).toBe(3);
    expect(streaks.priceOf('chopper')).toBe(0);
  });

  it('affords what the balance covers', () => {
    expect(streaks.canAfford('uav')).toBe(true);
    expect(streaks.canAfford('care_package')).toBe(true);
  });

  it('refuses what costs more than the balance', () => {
    expect(streaks.canAfford('sentry')).toBe(false);
  });

  it('refuses an affordable key that is still locked out', () => {
    expect(streaks.priceOf('mortar')).toBe(2);
    expect(streaks.lockoutSeconds('mortar')).toBeCloseTo(3, 10);
    expect(streaks.canAfford('mortar')).toBe(false);
  });

  it('refuses a key that was never offered', () => {
    expect(streaks.canAfford('chopper')).toBe(false);
  });
});

describe('the next streak', () => {
  it('reports the def and the price the server named', () => {
    streaks.apply(view({ nextKind: KIND['sentry'] ?? 0, nextPrice: 7 } as Partial<StreakView>));
    expect(streaks.next?.def.id).toBe('sentry');
    expect(streaks.next?.price).toBe(7);
  });

  it('is null when the server named no kind', () => {
    streaks.apply(view({ nextKind: -1, nextPrice: 7 } as Partial<StreakView>));
    expect(streaks.next).toBeNull();
  });

  it('is null for a kind the client does not know', () => {
    streaks.apply(view({ nextKind: 999, nextPrice: 7 } as Partial<StreakView>));
    expect(streaks.next).toBeNull();
  });
});

describe('the weapon a body is carrying', () => {
  it('resolves it from the live streak list', () => {
    const carried = STREAK_DEFS.findIndex((d) => d.id === 'minigun');
    if (carried < 0) return;
    streaks.apply(view({ entities: [entity(1, carried, 100)] } as unknown as Partial<StreakView>));
    expect(streaks.carriedWeaponFor(100)).not.toBeNull();
  });

  it('answers null for a body with no streak of its own', () => {
    streaks.apply(view({ entities: [entity(1, KIND['sentry'] ?? 0, 100)] } as unknown as Partial<StreakView>));
    expect(streaks.carriedWeaponFor(999)).toBeNull();
  });

  it('answers null for a streak that carries no weapon', () => {
    streaks.apply(view({ entities: [entity(1, KIND['uav'] ?? 0, 100)] } as unknown as Partial<StreakView>));
    expect(streaks.carriedWeaponFor(100)).toBeNull();
  });

  it('stops answering the moment the record stops arriving', () => {
    const carried = STREAK_DEFS.findIndex((d) => d.id === 'minigun');
    if (carried < 0) return;
    streaks.apply(view({ entities: [entity(1, carried, 100)] } as unknown as Partial<StreakView>));
    expect(streaks.carriedWeaponFor(100)).not.toBeNull();
    streaks.apply(view());
    expect(streaks.carriedWeaponFor(100)).toBeNull();
  });
});

describe('clear', () => {
  it('forgets everything, including that a frame ever arrived', () => {
    streaks.apply(
      view({
        balance: 9,
        scrambled: true,
        sweepAngle: 2.5,
        nextKind: 0,
        nextPrice: 4,
        offers: [{ kind: KIND['uav'] ?? 0, price: 3, lockoutCs: 0 }],
        entities: [entity(1, KIND['sentry'] ?? 0, 100)],
        contacts: [{ x: 1, z: 2 }],
      } as unknown as Partial<StreakView>),
    );
    streaks.clear();
    expect(streaks.hasState).toBe(false);
    expect(streaks.balance).toBe(0);
    expect(streaks.offers).toEqual([]);
    expect(streaks.scrambled).toBe(false);
    expect(streaks.sweepAngle).toBe(-1);
    expect(streaks.contacts).toEqual([]);
    expect(streaks.entities).toEqual([]);
    expect(streaks.next).toBeNull();
  });
});

describe('what it deliberately does not do', () => {
  it('does not advance a lockout between frames', () => {
    streaks.apply(view({ offers: [{ kind: KIND['uav'] ?? 0, price: 1, lockoutCs: 500 }] } as Partial<StreakView>));
    const first = streaks.lockoutSeconds('uav');
    for (let i = 0; i < 1000; i++) expect(streaks.lockoutSeconds('uav')).toBe(first);
  });

  it('does not advance the sweep between frames', () => {
    streaks.apply(view({ sweepAngle: 1.25 } as Partial<StreakView>));
    for (let i = 0; i < 100; i++) expect(streaks.sweepAngle).toBeCloseTo(1.25, 10);
  });
});
