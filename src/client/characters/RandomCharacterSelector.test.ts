import { describe, expect, it } from 'vitest';
import { Rng } from '../../shared/core/Rng';
import { BOT_CHARACTER_IDS } from './CharacterCatalog';
import { RandomCharacterSelector } from './RandomCharacterSelector';

/**
 * Which skin each body wears for a match, pinned before unit C5's refactor.
 *
 * Two rules, and both are about *not* flickering: a body keeps its skin for the whole match even
 * when its procedural fallback is replaced by a GLB, and the first cycle of the roster shows every
 * skin once rather than dealing the same one twice by chance. The second is what the deck is for.
 */

function selector(seed = 0x1234_5678): RandomCharacterSelector {
  return new RandomCharacterSelector(new Rng(seed));
}

describe('RandomCharacterSelector', () => {
  it('keeps a body on the skin it was dealt', () => {
    const pick = selector();
    const first = pick.characterIdFor(42);
    for (let i = 0; i < 20; i++) expect(pick.characterIdFor(42)).toBe(first);
  });

  it('deals every skin once before it deals any of them twice', () => {
    const pick = selector();
    const dealt = new Set<string>();
    for (let entityId = 0; entityId < BOT_CHARACTER_IDS.length; entityId++) {
      dealt.add(pick.characterIdFor(entityId));
    }
    expect(dealt.size).toBe(BOT_CHARACTER_IDS.length);
    expect([...dealt].sort()).toEqual([...BOT_CHARACTER_IDS].sort());
  });

  it('reshuffles a fresh deck once the first is spent', () => {
    const pick = selector();
    const n = BOT_CHARACTER_IDS.length;
    for (let entityId = 0; entityId < n; entityId++) pick.characterIdFor(entityId);
    const second = new Set<string>();
    for (let entityId = n; entityId < n * 2; entityId++) second.add(pick.characterIdFor(entityId));
    expect(second.size).toBe(n);
  });

  it('only ever deals skins the catalogue admits', () => {
    const pick = selector();
    for (let entityId = 0; entityId < 60; entityId++) {
      expect(BOT_CHARACTER_IDS).toContain(pick.characterIdFor(entityId));
    }
  });

  it('is reproducible from its seed, which is what makes a match replayable', () => {
    const a = selector(99);
    const b = selector(99);
    for (let entityId = 0; entityId < 30; entityId++) {
      expect(b.characterIdFor(entityId)).toBe(a.characterIdFor(entityId));
    }
  });

  it('deals a different match a different roster', () => {
    const a = selector(1);
    const b = selector(2);
    let differed = 0;
    for (let entityId = 0; entityId < BOT_CHARACTER_IDS.length; entityId++) {
      if (a.characterIdFor(entityId) !== b.characterIdFor(entityId)) differed++;
    }
    expect(differed).toBeGreaterThan(0);
  });

  it('does not care what order the entity ids arrive in', () => {
    const forwards = selector(7);
    const backwards = selector(7);
    const ids = [5, 1, 9, 3];
    const first = ids.map((id) => forwards.characterIdFor(id));
    const second = [...ids].reverse().map((id) => backwards.characterIdFor(id));
    // The deck is dealt in call order, so the *set* is what is stable, not the pairing.
    expect(new Set(first)).toEqual(new Set(second.reverse()));
  });
});
