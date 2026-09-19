import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIN_ID, NO_SKIN_INDEX, isSkinId, SKIN_IDS, skinIdAt, skinIndexOf } from './Skins';

/**
 * The table is the wire (M16, B6.1): every id round-trips through its index, a stranger is
 * `NO_SKIN_INDEX` and not a neighbour, and the table can never grow into the byte that means
 * "none".
 */
describe('the skin table', () => {
  it('round-trips every id through its index, in table order', () => {
    SKIN_IDS.forEach((id, index) => {
      expect(skinIndexOf(id)).toBe(index);
      expect(skinIdAt(index)).toBe(id);
    });
  });

  it('answers NO_SKIN_INDEX for a name it does not know, and null for that index', () => {
    expect(skinIndexOf('operator')).toBe(NO_SKIN_INDEX);
    expect(skinIndexOf('')).toBe(NO_SKIN_INDEX);
    expect(skinIdAt(NO_SKIN_INDEX)).toBeNull();
    expect(skinIdAt(SKIN_IDS.length)).toBeNull();
    expect(skinIdAt(-1)).toBeNull();
  });

  it('holds the default, and fits in the byte below the "none" value', () => {
    expect(isSkinId(DEFAULT_SKIN_ID)).toBe(true);
    expect(isSkinId('Echo')).toBe(false);
    expect(SKIN_IDS.length).toBeLessThan(NO_SKIN_INDEX);
    expect(new Set(SKIN_IDS).size).toBe(SKIN_IDS.length);
  });
});
