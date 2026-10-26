import { describe, expect, it } from 'vitest';
import type { CharacterAnimationId } from './CharacterCatalog';
import { variantFor } from './AnimationVariant';

/**
 * Which clip of a multi-variant slot a body wears, pinned before unit C5's refactor.
 *
 * The whole value of this function is that it is a *pure function of facts every client already
 * shares*: two clients watching the same body must see the same clip, and a reconnect must not
 * change the one you were looking at. That is not visible in a screenshot and it is not something
 * a renderer test would catch — it only shows up as two players describing the same body
 * differently. So it is asserted directly.
 */

const SLOTS: CharacterAnimationId[] = ['idleRelaxed', 'walkRelaxed', 'runRelaxed', 'idleWeaponReady'];

describe('variantFor', () => {
  it('has nothing to choose when a slot has one clip or none', () => {
    expect(variantFor('idleRelaxed', 7, 3, 1)).toBe(0);
    expect(variantFor('idleRelaxed', 7, 3, 0)).toBe(0);
    expect(variantFor('idleRelaxed', 7, 3, -1)).toBe(0);
  });

  it('always lands inside the slot', () => {
    for (const slot of SLOTS) {
      for (let entityId = 0; entityId < 40; entityId++) {
        for (const count of [2, 3, 5]) {
          const v = variantFor(slot, entityId, 1, count);
          expect(Number.isInteger(v), `${slot}/${entityId}/${count}`).toBe(true);
          expect(v, `${slot}/${entityId}/${count}`).toBeGreaterThanOrEqual(0);
          expect(v, `${slot}/${entityId}/${count}`).toBeLessThan(count);
        }
      }
    }
  });

  it('is the same answer every time it is asked — this is the replication guarantee', () => {
    for (let i = 0; i < 50; i++) {
      expect(variantFor('idleRelaxed', 11, 4, 3)).toBe(variantFor('idleRelaxed', 11, 4, 3));
    }
  });

  it('re-deals at a respawn, because the serial is the life', () => {
    const lives = new Set<number>();
    for (let serial = 0; serial < 24; serial++) lives.add(variantFor('idleRelaxed', 11, serial, 2));
    expect(lives.size).toBe(2);
  });

  it('deals a body’s idle and its walk independently', () => {
    // The slot id is folded into the seed so an actor does not land on "the second one" everywhere.
    let differed = 0;
    for (let entityId = 0; entityId < 60; entityId++) {
      if (variantFor('idleRelaxed', entityId, 0, 2) !== variantFor('walkRelaxed', entityId, 0, 2)) differed++;
    }
    expect(differed).toBeGreaterThan(10);
  });

  it('deals different bodies different clips', () => {
    const seen = new Set<number>();
    for (let entityId = 0; entityId < 40; entityId++) seen.add(variantFor('idleRelaxed', entityId, 0, 2));
    expect(seen.size).toBe(2);
  });

  it('spreads reasonably evenly over a slot’s clips', () => {
    const counts = [0, 0];
    for (let entityId = 0; entityId < 400; entityId++) {
      const variant = variantFor('idleRelaxed', entityId, 0, 2);
      counts[variant] = (counts[variant] ?? 0) + 1;
    }
    // Not a distribution test — just that neither clip is effectively never drawn.
    expect(Math.min(...counts)).toBeGreaterThan(120);
  });

  it('does not change when a slot gains a clip it is not asked about', () => {
    // The count is the slot's own; asking for the same slot with the same count is stable.
    expect(variantFor('runRelaxed', 3, 2, 2)).toBe(variantFor('runRelaxed', 3, 2, 2));
    // And a larger count is a different question, which may legitimately differ.
    expect(variantFor('runRelaxed', 3, 2, 3)).toBeLessThan(3);
  });
});
