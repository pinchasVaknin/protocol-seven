import { beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { RECONNECT_GRACE_MS, RECONNECT_TOKEN_BYTES } from '../../shared/net/Protocol';
import { ReconnectRegistry, type Reservation } from './ReconnectRegistry';

/**
 * The seats held open for a player who dropped (B1).
 *
 * The class comment states three security properties and each one is a test here, because each
 * is a property of *when entries exist* rather than a check somebody has to remember to write:
 * a token cannot be guessed, a live session's token opens nothing (a reservation exists only
 * after `onLeave`), and a token is good exactly once.
 *
 * The fourth thing under test is the bound. `forgetMatch` is what keeps this map from growing
 * by an entry per player per match, which is the shape §8.13's leak run exists to catch, so
 * "held comes back to zero" is asserted rather than assumed.
 */

/** The harness clock, so the grace can be stepped over without waiting 30 seconds. */
let now = 1_000;

installClock({ nowMs: () => now });

function seat(overrides: Partial<Omit<Reservation, 'expiresAtMs'>> = {}): Omit<Reservation, 'expiresAtMs'> {
  return {
    playerId: 1,
    displayName: 'OP1',
    matchId: 1,
    entityId: 4,
    team: 'A',
    loadout: null,
    ...overrides,
  };
}

describe('ReconnectRegistry', () => {
  beforeEach(() => {
    now = 1_000;
  });

  it('mints a token of the protocol\'s length, and not the same one twice', () => {
    const registry = new ReconnectRegistry();
    const first = registry.mint();
    const second = registry.mint();

    expect(first.length).toBe(RECONNECT_TOKEN_BYTES);
    expect([...first]).not.toEqual([...second]);
  });

  it('holds nothing until a seat is reserved, so a live session\'s token opens nothing', () => {
    const registry = new ReconnectRegistry();
    const token = registry.mint();

    expect(registry.size).toBe(0);
    expect(registry.claim(token)).toEqual({ ok: false, why: 'unknown' });
  });

  it('gives back the seat the player left', () => {
    const registry = new ReconnectRegistry();
    const token = registry.mint();
    registry.reserve(token, seat({ entityId: 7, team: 'B', playerId: 3, displayName: 'OP3' }));

    const result = registry.claim(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reservation).toMatchObject({
      playerId: 3,
      displayName: 'OP3',
      matchId: 1,
      entityId: 7,
      team: 'B',
    });
    expect(result.reservation.expiresAtMs).toBe(1_000 + RECONNECT_GRACE_MS);
  });

  it('is good exactly once: the same token a second time is unknown', () => {
    const registry = new ReconnectRegistry();
    const token = registry.mint();
    registry.reserve(token, seat());

    expect(registry.claim(token).ok).toBe(true);
    expect(registry.claim(token)).toEqual({ ok: false, why: 'unknown' });
    expect(registry.size).toBe(0);
  });

  it('tells a grace that ran out apart from a token it has never seen', () => {
    const registry = new ReconnectRegistry();
    const token = registry.mint();
    registry.reserve(token, seat());

    now += RECONNECT_GRACE_MS + 1;
    expect(registry.claim(token)).toEqual({ ok: false, why: 'expired' });
    // Consumed on expiry too, so a client cannot retry it until the match ends.
    expect(registry.size).toBe(0);
    expect(registry.claim(token)).toEqual({ ok: false, why: 'unknown' });
  });

  it('still honours a claim on the last millisecond of the grace', () => {
    const registry = new ReconnectRegistry();
    const token = registry.mint();
    registry.reserve(token, seat());

    now += RECONNECT_GRACE_MS;
    expect(registry.claim(token).ok).toBe(true);
  });

  it('refuses a token that is not one: absent, or the wrong length', () => {
    const registry = new ReconnectRegistry();
    const token = registry.mint();
    registry.reserve(token, seat());

    expect(registry.claim(null)).toEqual({ ok: false, why: 'unknown' });
    expect(registry.claim(new Uint8Array(RECONNECT_TOKEN_BYTES - 1))).toEqual({ ok: false, why: 'unknown' });
    // A short token is refused before it can match anything, so the real seat is untouched.
    expect(registry.size).toBe(1);
  });

  it('reserves nothing for a token that is not one', () => {
    const registry = new ReconnectRegistry();
    registry.reserve(new Uint8Array(3), seat());

    expect(registry.size).toBe(0);
    expect(registry.stats.reserved).toBe(0);
  });

  it('releases the seats of a match that is gone, and only those', () => {
    const registry = new ReconnectRegistry();
    const inOne = registry.mint();
    const alsoOne = registry.mint();
    const inTwo = registry.mint();
    registry.reserve(inOne, seat({ matchId: 1, entityId: 4 }));
    registry.reserve(alsoOne, seat({ matchId: 1, entityId: 5, playerId: 2 }));
    registry.reserve(inTwo, seat({ matchId: 2, entityId: 6, playerId: 3 }));
    expect(registry.size).toBe(3);

    registry.forgetMatch(1);
    expect(registry.size).toBe(1);
    expect(registry.claim(inOne)).toEqual({ ok: false, why: 'unknown' });
    expect(registry.claim(alsoOne)).toEqual({ ok: false, why: 'unknown' });
    expect(registry.claim(inTwo).ok).toBe(true);
  });

  it('comes back to an empty map once its match is gone, which is what the leak run watches', () => {
    const registry = new ReconnectRegistry();
    for (let player = 1; player <= 10; player++) {
      registry.reserve(registry.mint(), seat({ playerId: player, entityId: player }));
    }

    registry.forgetMatch(1);
    expect(registry.stats.held).toBe(0);
    expect(registry.stats.reserved).toBe(10);
  });

  it('counts reservations, claims and both refusals, each with its denominator', () => {
    const registry = new ReconnectRegistry();
    const claimed = registry.mint();
    const expired = registry.mint();
    registry.reserve(claimed, seat());
    registry.reserve(expired, seat({ playerId: 2, entityId: 5 }));

    registry.claim(claimed);
    registry.claim(registry.mint());
    now += RECONNECT_GRACE_MS + 1;
    registry.claim(expired);

    expect(registry.stats).toEqual({ held: 0, reserved: 2, claimed: 1, expired: 1, unknown: 1 });
  });

  it('drops everything on a shutdown, counters kept', () => {
    const registry = new ReconnectRegistry();
    registry.reserve(registry.mint(), seat());

    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.stats.reserved).toBe(1);
  });

  it('keeps the class the player was playing, so the body is rebuilt with its perks', () => {
    const registry = new ReconnectRegistry();
    const token = registry.mint();
    const loadout = { primary: { weaponId: 'ar_carbine' } } as unknown as Reservation['loadout'];
    registry.reserve(token, seat({ loadout }));

    const result = registry.claim(token);
    expect(result.ok && result.reservation.loadout).toBe(loadout);
  });
});
