import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  readIncomingName,
  resolveDisplayName,
  UNDOCUMENTED_URL_KEYS,
  URL_FLAGS,
  withRewindSuffix,
} from './UrlFlags';

/**
 * The join's name rules, pinned before A20 touched this file — it had no test at all.
 *
 * Two of them are fixes that a refactor could undo without any other signal: the precedence
 * ladder `?name` -> profile -> `OPERATOR` (playtest round 5, B9), and stripping the `#rw`
 * suffix *before* the cap rather than after it, which is what made `?rewinddebug=1` work for
 * a callsign of eighteen characters or more.
 */
describe('resolveDisplayName', () => {
  it('prefers the URL name over the profile', () => {
    expect(resolveDisplayName('ALICE', 'BOB')).toBe('ALICE');
  });

  it('falls back to the profile when the URL carries no name', () => {
    expect(resolveDisplayName(null, 'BOB')).toBe('BOB');
  });

  it('falls back to OPERATOR when neither does', () => {
    expect(resolveDisplayName(null, '')).toBe('OPERATOR');
    expect(resolveDisplayName('', '')).toBe('OPERATOR');
  });

  it('falls through a URL name that cleans down to nothing, to the profile', () => {
    expect(resolveDisplayName('​​', 'BOB')).toBe('BOB');
  });

  it('falls all the way through when the profile cleans down to nothing too', () => {
    expect(resolveDisplayName('​', '‮')).toBe('OPERATOR');
  });

  it('cleans and caps both sides at MAX_NAME_LENGTH', () => {
    expect(MAX_NAME_LENGTH).toBe(20);
    expect(resolveDisplayName('A‮LICE', 'BOB')).toBe('ALICE');
    expect(resolveDisplayName('A'.repeat(30), 'BOB')).toBe('A'.repeat(20));
    expect(resolveDisplayName(null, 'B'.repeat(30))).toBe('B'.repeat(20));
  });
});

describe('the rewind-feed suffix', () => {
  it('is attached only when the feed was asked for', () => {
    expect(withRewindSuffix('ALICE', true)).toBe('ALICE#rw');
    expect(withRewindSuffix('ALICE', false)).toBe('ALICE');
  });

  it('is read back off the name, and the name arrives clean', () => {
    expect(readIncomingName('ALICE#rw', 'OPERATOR')).toEqual({
      name: 'ALICE',
      wantsRewindDebug: true,
    });
    expect(readIncomingName('ALICE', 'OPERATOR')).toEqual({
      name: 'ALICE',
      wantsRewindDebug: false,
    });
  });

  it('survives a full-length callsign, because it is stripped before the cap', () => {
    const long = 'A'.repeat(20);
    const incoming = readIncomingName(withRewindSuffix(long, true), 'OPERATOR');
    expect(incoming.wantsRewindDebug).toBe(true);
    expect(incoming.name).toBe(long);
  });

  it('substitutes the fallback for a name that was nothing but the suffix', () => {
    expect(readIncomingName('#rw', 'OPERATOR')).toEqual({
      name: 'OPERATOR',
      wantsRewindDebug: true,
    });
    expect(readIncomingName('', 'OPERATOR').name).toBe('OPERATOR');
  });

  it('is matched at the end and nowhere else', () => {
    expect(readIncomingName('#rwALICE', 'OPERATOR')).toEqual({
      name: '#rwALICE',
      wantsRewindDebug: false,
    });
  });
});

describe('the flag tables', () => {
  it('declares every documented flag with all three cells filled', () => {
    expect(URL_FLAGS.length).toBeGreaterThan(0);
    for (const flag of URL_FLAGS) {
      expect(flag.key).not.toBe('');
      expect(flag.syntax).toContain(flag.key);
      expect(flag.effect).not.toBe('');
    }
  });

  it('gives every undocumented key a reason, which is what makes it a decision', () => {
    expect(UNDOCUMENTED_URL_KEYS.size).toBeGreaterThan(0);
    for (const [key, reason] of UNDOCUMENTED_URL_KEYS) {
      expect(key).not.toBe('');
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it('keeps a key out of both tables or in exactly one of them', () => {
    for (const flag of URL_FLAGS) expect(UNDOCUMENTED_URL_KEYS.has(flag.key)).toBe(false);
  });
});
