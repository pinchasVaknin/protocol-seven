import { describe, expect, it } from 'vitest';
import { cleanDisplayText, uniqueDisplayName } from './DisplayText';
import { readIncomingName, resolveDisplayName } from './UrlFlags';

/**
 * A callsign as other players see it (security audit 2026-10-04, S9).
 *
 * Every case is a name the previous sanitiser let through unchanged — it removed the C0 controls
 * and nothing else.
 */
describe('cleanDisplayText', () => {
  it('removes direction overrides, so a name cannot render backwards', () => {
    expect(cleanDisplayText('ALICE‮etis', 20)).toBe('ALICEetis');
    expect(cleanDisplayText('⁧BOB⁩', 20)).toBe('BOB');
  });

  it('removes zero-width and other format characters', () => {
    expect(cleanDisplayText('AL​I‍CE﻿­', 20)).toBe('ALICE');
  });

  it('leaves nothing of a name made only of invisible or blank characters', () => {
    expect(cleanDisplayText('​​​', 20)).toBe('');
    expect(cleanDisplayText('ㅤㅤ', 20)).toBe('');
    expect(cleanDisplayText('⠀', 20)).toBe('');
    // And the name ladder then falls back, as it does for an empty one.
    expect(resolveDisplayName('​ㅤ', 'OPERATOR-013')).toBe('OPERATOR-013');
  });

  it('keeps a name on one line: C1 controls and line separators go, spaces collapse', () => {
    expect(cleanDisplayText('A\u0085B C D', 20)).toBe('ABCD');
    expect(cleanDisplayText('  RED 　  FIVE  ', 20)).toBe('RED FIVE');
  });

  it('keeps two combining marks per letter — Hebrew points survive, a tower of marks does not', () => {
    expect(cleanDisplayText('שָׁלוֹם', 20)).toBe('שָׁלוֹם'.normalize('NFC'));
    // NFC folds the first accent into the letter (Á), and two more marks may sit on it.
    const zalgo = `A${'́'.repeat(40)}`;
    expect(cleanDisplayText(zalgo, 20)).toBe('Á́́');
  });

  it('is the same name however it was composed', () => {
    expect(cleanDisplayText('Rémy', 20)).toBe(cleanDisplayText('Rémy', 20));
  });

  it('caps the length, and the server reads the rewind suffix before it does', () => {
    expect(cleanDisplayText('A'.repeat(40), 20)).toBe('A'.repeat(20));
    expect(readIncomingName(`${'B'.repeat(20)}#rw`, 'OPERATOR')).toEqual({ name: 'B'.repeat(20), wantsRewindDebug: true });
  });

  it('leaves an ordinary callsign alone', () => {
    for (const name of ['OPERATOR-462', 'Ghost 7', 'אבי', 'Søren', 'ナナシ', 'xX_sniper_Xx']) {
      expect(cleanDisplayText(name, 20)).toBe(name);
    }
  });
});

describe('uniqueDisplayName', () => {
  it('keeps a name nobody has', () => {
    expect(uniqueDisplayName('ALICE', ['BOB'], 20)).toBe('ALICE');
  });

  it('numbers the second and third, without regard to case', () => {
    expect(uniqueDisplayName('ALICE', ['alice'], 20)).toBe('ALICE (2)');
    expect(uniqueDisplayName('ALICE', ['ALICE', 'ALICE (2)'], 20)).toBe('ALICE (3)');
  });

  it('cuts a long name to make room for the number, never through an emoji', () => {
    const long = 'ABCDEFGHIJKLMNOPQRST';
    expect(uniqueDisplayName(long, [long], 20)).toBe('ABCDEFGHIJKLMNOP (2)');
    const emoji = `ABCDEFGHIJKLMNO\u{1F600}XX`;
    const out = uniqueDisplayName(emoji, [emoji], 20);
    expect(out).toBe('ABCDEFGHIJKLMNO (2)');
    expect(out.length).toBeLessThanOrEqual(20);
  });
});

/**
 * The branches A20's split of `cleanDisplayText` moves — the cap landing in the middle of a
 * mark, a mark with no base, an owed space the cap then refuses, and a non-string.
 */
describe('cleanDisplayText, at the edges', () => {
  it('drops a combining mark that has nothing to sit on', () => {
    expect(cleanDisplayText('́ALICE', 20)).toBe('ALICE');
    expect(cleanDisplayText('́', 20)).toBe('');
  });

  it('drops a mark that would not fit, while the cap still holds', () => {
    // A Hebrew point rather than an acute, which NFC would have composed into the A it sits on.
    expect(cleanDisplayText(`${'A'.repeat(5)}ְ`, 5)).toBe('AAAAA');
  });

  it('never ends on the space it was owed', () => {
    expect(cleanDisplayText('ALICE   ', 20)).toBe('ALICE');
    expect(cleanDisplayText('   ALICE', 20)).toBe('ALICE');
    expect(cleanDisplayText('A   B', 20)).toBe('A B');
  });

  it('stops before a character the owed space cannot fit beside', () => {
    // 'AB' plus a space plus 'C' is four units against a cap of three, so 'C' never lands —
    // and neither does the space, which was only ever owed.
    expect(cleanDisplayText('AB C', 3)).toBe('AB');
  });

  it('is empty for anything that is not a string', () => {
    expect(cleanDisplayText(null as never, 20)).toBe('');
    expect(cleanDisplayText(undefined as never, 20)).toBe('');
    expect(cleanDisplayText(7 as never, 20)).toBe('');
  });

  it('restarts the mark budget on each new base character', () => {
    expect(cleanDisplayText('á̂b́̂', 20)).toBe('á̂b́̂'.normalize('NFC'));
  });
});
