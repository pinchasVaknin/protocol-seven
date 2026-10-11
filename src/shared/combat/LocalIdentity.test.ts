import { describe, expect, it } from 'vitest';
import { PLAYER_ENTITY_ID } from './DamageSystem';
import { LocalIdentity } from './LocalIdentity';

/**
 * Which entity is this client, pinned.
 *
 * The behaviour worth holding still is the single-player default — a holder nobody ever calls
 * `adopt` on reads 0 and behaves exactly as M1-M8 did — and the notification, which exists only
 * for the readers that have already *stored* the answer.
 */

describe('a holder a server never spoke to', () => {
  it('is the single-player seat', () => {
    const identity = new LocalIdentity();
    expect(identity.entityId).toBe(PLAYER_ENTITY_ID);
    expect(PLAYER_ENTITY_ID).toBe(0);
    expect(identity.is(0)).toBe(true);
    expect(identity.is(1)).toBe(false);
  });
});

describe('a holder that took the server\'s assignment', () => {
  it('answers for the new id and no longer for the old one', () => {
    const identity = new LocalIdentity();
    identity.adopt(7);
    expect(identity.entityId).toBe(7);
    expect(identity.is(7)).toBe(true);
    expect(identity.is(PLAYER_ENTITY_ID)).toBe(false);
  });

  it('goes back to the single-player seat on reset', () => {
    const identity = new LocalIdentity();
    identity.adopt(7);
    identity.reset();
    expect(identity.entityId).toBe(PLAYER_ENTITY_ID);
  });
});

describe('the readers that cannot ask on demand', () => {
  it('are told the new id once per change', () => {
    const identity = new LocalIdentity();
    const seen: number[] = [];
    identity.onChange((id) => seen.push(id));
    identity.adopt(4);
    expect(seen).toEqual([4]);
  });

  it('are not told when the assignment did not change', () => {
    const identity = new LocalIdentity();
    const seen: number[] = [];
    identity.onChange((id) => seen.push(id));
    identity.adopt(PLAYER_ENTITY_ID);
    identity.adopt(4);
    identity.adopt(4);
    expect(seen).toEqual([4]);
  });

  it('are told in the order they subscribed, and can stop being told', () => {
    const identity = new LocalIdentity();
    const seen: string[] = [];
    const stop = identity.onChange(() => seen.push('first'));
    identity.onChange(() => seen.push('second'));
    identity.adopt(3);
    expect(seen).toEqual(['first', 'second']);

    stop();
    identity.adopt(5);
    expect(seen).toEqual(['first', 'second', 'second']);
  });

  it('survive a second call to the same unsubscribe', () => {
    const identity = new LocalIdentity();
    const seen: number[] = [];
    const stop = identity.onChange((id) => seen.push(id));
    stop();
    stop();
    identity.adopt(9);
    expect(seen).toEqual([]);
  });
});
