import { describe, expect, it } from 'vitest';
import { MAPS, PLAYABLE_MAPS, rollBackdropMap } from './ModeRegistry';

/**
 * The backdrop roll (M17, C2): the greybox never, the previous map never while there is
 * another, and every real map reachable.
 */
describe('rollBackdropMap', () => {
  it('never names the testbed', () => {
    for (let i = 0; i < 64; i++) {
      const entry = rollBackdropMap(i / 64, null);
      expect(entry.testbed).toBe(false);
    }
  });

  it('skips the previous map while there is anything else to show', () => {
    for (const previous of PLAYABLE_MAPS) {
      for (let i = 0; i < 16; i++) {
        expect(rollBackdropMap(i / 16, previous.id).id).not.toBe(previous.id);
      }
    }
  });

  it('reaches every playable map and clamps the roll', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) seen.add(rollBackdropMap(i / 64, null).id);
    expect([...seen].sort()).toEqual(PLAYABLE_MAPS.map((m) => m.id).sort());
    expect(rollBackdropMap(-1, null).testbed).toBe(false);
    expect(rollBackdropMap(2, null).testbed).toBe(false);
  });

  it('marks exactly the greybox as the testbed', () => {
    expect(MAPS.filter((m) => m.testbed).map((m) => m.id)).toEqual(['mp_testbed']);
  });
});
