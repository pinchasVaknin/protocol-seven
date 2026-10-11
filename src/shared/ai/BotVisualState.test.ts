import { describe, expect, it } from 'vitest';
import {
  DEATH_VARIANTS,
  cosmeticVariantFor,
  deathVariantFor,
  makeBotVisualState,
  type BotVisualState,
} from './BotVisualState';

/**
 * The cosmetic side of a bot, pinned.
 *
 * Two claims matter and both are about **determinism without a stream**. S4.14 forbids drawing
 * a cosmetic variant from the bot's own `Rng`, because a free-running stream advances
 * differently when reconciliation replays a tick and every later spread and aim-error value
 * would shift. So the variant is hashed from two replicated integers instead, and the
 * properties that makes true are: the same body's third death is always the same variant, in
 * Node and in a browser, on a first run and on a replay; and two clients derive the same one
 * without anything being sent.
 *
 * The serials are counters rather than booleans because a bot can die, respawn and die again
 * between two rendered frames at a low frame rate — a missed frame cannot lose an event.
 */

describe('a fresh visual state', () => {
  it('has fired no events and points nowhere', () => {
    expect(makeBotVisualState()).toEqual({
      deathSerial: 0,
      deathDirX: 0,
      deathDirZ: 0,
      deathVariant: 0,
      spawnSerial: 0,
      flinchSerial: 0,
      flinchDirX: 0,
      flinchDirZ: 0,
    } satisfies BotVisualState);
  });

  it('is a fresh record each time', () => {
    expect(makeBotVisualState()).not.toBe(makeBotVisualState());
  });
});

describe('the cosmetic variant', () => {
  it('is the same answer every time it is asked', () => {
    for (let serial = 1; serial <= 5; serial++) {
      const once = cosmeticVariantFor(7, serial, 6);
      expect(cosmeticVariantFor(7, serial, 6)).toBe(once);
      expect(cosmeticVariantFor(7, serial, 6)).toBe(once);
    }
  });

  it('is always inside the count it was given', () => {
    for (let entity = 0; entity < 40; entity++) {
      for (let serial = 0; serial < 10; serial++) {
        for (const variants of [1, 2, 3, 6, 11]) {
          const v = cosmeticVariantFor(entity, serial, variants);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(variants);
        }
      }
    }
  });

  it('is zero when there is nothing to choose between', () => {
    expect(cosmeticVariantFor(3, 4, 0)).toBe(0);
    expect(cosmeticVariantFor(3, 4, -1)).toBe(0);
  });

  it('does not put consecutive serials on consecutive variants', () => {
    // The whole reason it is an integer hash rather than a modulo: two deaths in a row must
    // not be the next two clips in the list.
    let consecutive = 0;
    for (let serial = 1; serial < 40; serial++) {
      const a = cosmeticVariantFor(5, serial, DEATH_VARIANTS);
      const b = cosmeticVariantFor(5, serial + 1, DEATH_VARIANTS);
      if ((a + 1) % DEATH_VARIANTS === b) consecutive++;
    }
    expect(consecutive).toBeLessThan(12);
  });

  it('spreads across the whole set rather than favouring one clip', () => {
    const seen = new Set<number>();
    for (let entity = 1; entity <= 12; entity++) {
      for (let serial = 1; serial <= 12; serial++) {
        seen.add(cosmeticVariantFor(entity, serial, DEATH_VARIANTS));
      }
    }
    expect(seen.size).toBe(DEATH_VARIANTS);
  });

  it('gives two different bodies different answers for the same death count', () => {
    const variants = new Set<number>();
    for (let entity = 1; entity <= 8; entity++) variants.add(cosmeticVariantFor(entity, 1, DEATH_VARIANTS));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe('the death variant', () => {
  it('is the same hash, so the animation slots all deal the same way', () => {
    for (let serial = 1; serial <= 8; serial++) {
      expect(deathVariantFor(9, serial, DEATH_VARIANTS)).toBe(
        cosmeticVariantFor(9, serial, DEATH_VARIANTS),
      );
    }
  });

  it('counts six, which is what divides evenly by every death slot', () => {
    // Three standing falls and two kneeling ones, so the figure has to divide by both or the
    // low variants are dealt more often than the high ones. `check:animations` refuses it.
    expect(DEATH_VARIANTS).toBe(6);
    expect(DEATH_VARIANTS % 3).toBe(0);
    expect(DEATH_VARIANTS % 2).toBe(0);
  });
});
