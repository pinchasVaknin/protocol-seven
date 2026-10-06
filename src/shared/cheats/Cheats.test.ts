import { describe, expect, it } from 'vitest';
import {
  Cheat,
  CHEAT_CODE_MAX,
  CHEAT_FULL_SPECTATOR,
  CHEAT_NOTICE_SECONDS,
  CHEAT_SIMULATION,
  type CheatCode,
  bitsClearing,
  cheatCaption,
  cheatCodeToggling,
  CheatOutcome,
  cheatOutcomeText,
  CheatState,
  describeCheatMask,
  instantCheatLabel,
  isSurfaceCheat,
  isUnlockCheat,
  parseCheatCode,
  toggleCheat,
} from './Cheats';

/**
 * A code is input; an entitlement is state (M11 Gate B, playtest round 4, F14).
 *
 * ## Why this file never writes a code down
 *
 * `scripts/check-cheats.mjs` scans every `.ts` under `src/` and refuses a code string anywhere
 * but `Cheats.ts` and the skirmish harness — a test file included, and rightly, since a code
 * copied into a test is a second place the table has to be kept in step with. So the codes used
 * below are fetched through the door built for exactly this, `cheatCodeToggling(bits)`, which is
 * what the QA panel and the console already use; and the two kind predicates are given
 * structurally built `CheatCode` records with a placeholder string, which is also how they prove
 * they read the effect and not the text.
 *
 * Naming a code in a comment is fine, and `Unlocks.test.ts` does.
 *
 * ## What is pinned
 *
 * The arithmetic, mostly. `toggleCheat` cannot express *off* for a multi-bit code, and the four
 * rows of its JSDoc table are the whole of the regression that cost a player a mask of 14; the
 * clearing path `bitsClearing` is asserted over **all eight masks**, which is the same property
 * `check-cheats.mjs` proves against the shipped function on every harness run.
 */

const ALL_BITS: readonly number[] = [Cheat.God, Cheat.Unseen, Cheat.NoClip];
const EVERY_MASK: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7].map(
  (n) => (n & 1 ? Cheat.God : 0) | (n & 2 ? Cheat.Unseen : 0) | (n & 4 ? Cheat.NoClip : 0),
);

/** A code string without writing one: the toggle that flips exactly these bits. */
function codeFor(bits: number): string {
  const code = cheatCodeToggling(bits);
  if (code === null) throw new Error('no toggle code for those bits');
  return code;
}

describe('the entitlement bits', () => {
  it('are three distinct bits, and every one of them is in CHEAT_SIMULATION', () => {
    expect(new Set(ALL_BITS).size).toBe(3);
    for (const bit of ALL_BITS) {
      expect(CHEAT_SIMULATION & bit).toBe(bit);
    }
  });

  it('full spectator is all three, which is what SPEC[]4 means', () => {
    expect(CHEAT_FULL_SPECTATOR).toBe(Cheat.God | Cheat.Unseen | Cheat.NoClip);
    expect(CHEAT_SIMULATION).toBe(CHEAT_FULL_SPECTATOR);
  });

  it('fit in the byte the wire carries', () => {
    expect(CHEAT_SIMULATION & 0xff).toBe(CHEAT_SIMULATION);
  });
});

describe('cheatCodeToggling', () => {
  it('finds the code for each single bit, and they are all different codes', () => {
    const codes = ALL_BITS.map(codeFor);

    expect(new Set(codes).size).toBe(3);
  });

  it('finds the one multi-bit code for the full set', () => {
    expect(codeFor(CHEAT_FULL_SPECTATOR)).not.toBe(codeFor(Cheat.God));
  });

  it('is exact, not a subset match: a pair that no code flips has no code', () => {
    expect(cheatCodeToggling(Cheat.God | Cheat.Unseen)).toBeNull();
  });

  it('has no code for nothing, and none for a bit that does not exist', () => {
    expect(cheatCodeToggling(0)).toBeNull();
    expect(cheatCodeToggling(1 << 20)).toBeNull();
  });
});

describe('parseCheatCode', () => {
  it('recognises a real code and hands back its effect', () => {
    const entry = parseCheatCode(codeFor(Cheat.God));

    expect(entry).not.toBeNull();
    expect(entry?.code).toBe(codeFor(Cheat.God));
    expect(entry?.effect.kind).toBe('toggle');
  });

  it('is case-insensitive, because the input is a text field', () => {
    const code = codeFor(Cheat.NoClip);

    expect(parseCheatCode(code.toLowerCase())?.code).toBe(code);
    expect(parseCheatCode(code.toUpperCase())?.code).toBe(code);
  });

  it('trims surrounding whitespace', () => {
    const code = codeFor(Cheat.Unseen);

    expect(parseCheatCode(`  ${code}  `)?.code).toBe(code);
  });

  it('refuses anything that is not in the table', () => {
    expect(parseCheatCode('NOT-A-CODE')).toBeNull();
    expect(parseCheatCode('')).toBeNull();
  });

  it('refuses a raw string over the wire cap before it looks at the table', () => {
    const code = codeFor(Cheat.God);
    const padded = code + ' '.repeat(CHEAT_CODE_MAX);

    expect(padded.length).toBeGreaterThan(CHEAT_CODE_MAX);
    // It would trim to a real code, and is still refused: the cap is on what arrived.
    expect(parseCheatCode(padded)).toBeNull();
  });

  it('accepts a code padded up to exactly the cap', () => {
    const code = codeFor(Cheat.God);
    const padded = code.padEnd(CHEAT_CODE_MAX, ' ');

    expect(padded).toHaveLength(CHEAT_CODE_MAX);
    expect(parseCheatCode(padded)?.code).toBe(code);
  });
});

describe('isSurfaceCheat and isUnlockCheat', () => {
  /** Built structurally, with a placeholder code: the predicates read the effect, not the text. */
  const surface: CheatCode = { code: 'PLACEHOLDER', effect: { kind: 'surface' } };
  const unlock: CheatCode = { code: 'PLACEHOLDER', effect: { kind: 'unlock' } };
  const toggle: CheatCode = { code: 'PLACEHOLDER', effect: { kind: 'toggle', bits: Cheat.God } };
  const instant: CheatCode = { code: 'PLACEHOLDER', effect: { kind: 'instant', kills: 30 } };

  it('separate the two client-owned kinds from each other', () => {
    expect(isSurfaceCheat(surface)).toBe(true);
    expect(isUnlockCheat(surface)).toBe(false);
    expect(isUnlockCheat(unlock)).toBe(true);
    expect(isSurfaceCheat(unlock)).toBe(false);
  });

  it('say no to the two kinds the server owns or applies', () => {
    for (const entry of [toggle, instant]) {
      expect(isSurfaceCheat(entry)).toBe(false);
      expect(isUnlockCheat(entry)).toBe(false);
    }
  });

  it('read the effect and not the text: the same placeholder answers both ways', () => {
    expect(surface.code).toBe(unlock.code);
    expect(isSurfaceCheat(surface)).not.toBe(isSurfaceCheat(unlock));
  });
});

describe('bitsClearing', () => {
  it('is empty when there is nothing to clear, so calling it is always safe', () => {
    expect(bitsClearing(0, CHEAT_FULL_SPECTATOR)).toEqual([]);
    expect(bitsClearing(Cheat.God, Cheat.Unseen)).toEqual([]);
  });

  it('returns one single-bit toggle per bit that is actually set', () => {
    expect(bitsClearing(Cheat.God, CHEAT_FULL_SPECTATOR)).toEqual([Cheat.God]);
    expect(bitsClearing(Cheat.God | Cheat.NoClip, CHEAT_FULL_SPECTATOR)).toEqual([
      Cheat.God,
      Cheat.NoClip,
    ]);
    expect(bitsClearing(CHEAT_FULL_SPECTATOR, CHEAT_FULL_SPECTATOR)).toEqual(ALL_BITS);
  });

  it('never returns the multi-bit code, which is the thing that cannot express off', () => {
    for (const mask of EVERY_MASK) {
      for (const bit of bitsClearing(mask, CHEAT_FULL_SPECTATOR)) {
        expect(bit & (bit - 1)).toBe(0);
      }
    }
  });

  it('clears every one of the eight masks to exactly zero when folded back through toggleCheat', () => {
    // The property check-cheats.mjs proves against the shipped function on every harness run:
    // one bit in must not become three bits out.
    for (const mask of EVERY_MASK) {
      let result = mask;
      for (const bit of bitsClearing(mask, CHEAT_FULL_SPECTATOR)) {
        result = toggleCheat(result, bit);
      }
      expect(result).toBe(0);
    }
  });

  it('clears only the bits it was asked for, leaving the rest of the mask standing', () => {
    let result = CHEAT_FULL_SPECTATOR;
    for (const bit of bitsClearing(result, Cheat.God)) {
      result = toggleCheat(result, bit);
    }

    expect(result).toBe(Cheat.Unseen | Cheat.NoClip);
  });
});

describe('toggleCheat', () => {
  it('turns a single bit on and off again', () => {
    expect(toggleCheat(0, Cheat.God)).toBe(Cheat.God);
    expect(toggleCheat(Cheat.God, Cheat.God)).toBe(0);
  });

  it('leaves the other bits alone', () => {
    expect(toggleCheat(Cheat.Unseen, Cheat.God)).toBe(Cheat.Unseen | Cheat.God);
    expect(toggleCheat(Cheat.Unseen | Cheat.God, Cheat.God)).toBe(Cheat.Unseen);
  });

  it('completes the set from any subset, and clears only from the full set', () => {
    // The four rows of the JSDoc table, which is the regression that produced a mask of 14.
    expect(toggleCheat(0, CHEAT_FULL_SPECTATOR)).toBe(CHEAT_FULL_SPECTATOR);
    expect(toggleCheat(Cheat.God, CHEAT_FULL_SPECTATOR)).toBe(CHEAT_FULL_SPECTATOR);
    expect(toggleCheat(Cheat.God | Cheat.Unseen, CHEAT_FULL_SPECTATOR)).toBe(CHEAT_FULL_SPECTATOR);
    expect(toggleCheat(CHEAT_FULL_SPECTATOR, CHEAT_FULL_SPECTATOR)).toBe(0);
  });

  it('cannot express off for a multi-bit code, which is why bitsClearing exists', () => {
    const widened = EVERY_MASK.filter(
      (mask) => mask !== CHEAT_FULL_SPECTATOR && toggleCheat(mask, CHEAT_FULL_SPECTATOR) !== 0,
    );

    expect(widened).toHaveLength(7);
  });
});

describe('CHEAT_NOTICE_SECONDS', () => {
  it('is a display duration, long enough to read and short enough to go away', () => {
    expect(CHEAT_NOTICE_SECONDS).toBe(4);
  });
});

describe('cheatCaption', () => {
  it('is empty with nothing on', () => {
    expect(cheatCaption(0, '')).toBe('');
  });

  it('names each toggle that is on', () => {
    expect(cheatCaption(Cheat.God, '')).toBe('CHEATS · GOD');
    expect(cheatCaption(Cheat.Unseen, '')).toBe('CHEATS · UNSEEN');
    expect(cheatCaption(Cheat.NoClip, '')).toBe('CHEATS · NOCLIP');
  });

  it('lists them in bit order, not in the order they were granted', () => {
    expect(cheatCaption(CHEAT_FULL_SPECTATOR, '')).toBe('CHEATS · GOD · UNSEEN · NOCLIP');
    expect(cheatCaption(Cheat.NoClip | Cheat.God, '')).toBe('CHEATS · GOD · NOCLIP');
  });

  it('composes the two lifetimes rather than one hiding the other', () => {
    expect(cheatCaption(Cheat.God, '+30 KILLS')).toBe('CHEATS · GOD · +30 KILLS');
    expect(cheatCaption(0, '+30 KILLS')).toBe('CHEATS · +30 KILLS');
  });

  it('ignores a bit that is not an entitlement', () => {
    expect(cheatCaption(1 << 20, '')).toBe('');
  });

  it('answers every mask', () => {
    for (const mask of EVERY_MASK) {
      const caption = cheatCaption(mask, '');
      expect(caption === '').toBe(mask === 0);
    }
  });
});

describe('describeCheatMask', () => {
  it('is never empty, so a revoke logs something', () => {
    expect(describeCheatMask(0)).toBe('none');
  });

  it('is the lower-case log form, joined with plus', () => {
    expect(describeCheatMask(Cheat.God)).toBe('god');
    expect(describeCheatMask(Cheat.Unseen)).toBe('unseen');
    expect(describeCheatMask(Cheat.NoClip)).toBe('noclip');
    expect(describeCheatMask(CHEAT_FULL_SPECTATOR)).toBe('god+unseen+noclip');
  });

  it('keeps bit order, like the caption', () => {
    expect(describeCheatMask(Cheat.NoClip | Cheat.God)).toBe('god+noclip');
  });

  it('describes the same bits the caption does, for every mask', () => {
    for (const mask of EVERY_MASK) {
      const parts = mask === 0 ? 0 : describeCheatMask(mask).split('+').length;
      const named = ALL_BITS.filter((bit) => (mask & bit) !== 0).length;
      expect(parts).toBe(named);
    }
  });
});

describe('instantCheatLabel', () => {
  it('is derived from the payload, so a second instant cheat needs no new caption', () => {
    const instant: CheatCode = { code: 'PLACEHOLDER', effect: { kind: 'instant', kills: 7 } };

    expect(instantCheatLabel(instant)).toBe('+7 KILLS');
  });

  it('is empty for every other kind, because a toggle has a tag and not an announcement', () => {
    expect(instantCheatLabel({ code: 'PLACEHOLDER', effect: { kind: 'surface' } })).toBe('');
    expect(instantCheatLabel({ code: 'PLACEHOLDER', effect: { kind: 'unlock' } })).toBe('');
    expect(instantCheatLabel({ code: 'PLACEHOLDER', effect: { kind: 'toggle', bits: 2 } })).toBe('');
  });
});

describe('cheatOutcomeText', () => {
  it('says something different for each outcome, so a refusal is never silent', () => {
    expect(cheatOutcomeText(CheatOutcome.Granted)).toBe('Code accepted.');
    expect(cheatOutcomeText(CheatOutcome.Revoked)).toBe('Code cleared.');
    expect(cheatOutcomeText(CheatOutcome.RefusedDisabled)).toBe('This server has cheats disabled.');
    expect(cheatOutcomeText(CheatOutcome.InstantApplied)).toBe(
      '30 kills added to your killstreak balance.',
    );
    expect(cheatOutcomeText(CheatOutcome.RefusedNoSeat)).toBe('Code available only during gameplay.');
    expect(cheatOutcomeText(CheatOutcome.UnlockApplied)).toBe(
      'Everything unlocked: max level, every weapon, item, attachment and camo.',
    );
  });

  it('tells Revoked and RefusedDisabled apart, which a mask alone cannot', () => {
    expect(cheatOutcomeText(CheatOutcome.Revoked)).not.toBe(
      cheatOutcomeText(CheatOutcome.RefusedDisabled),
    );
  });

  it('falls back for an unknown outcome rather than returning nothing', () => {
    expect(cheatOutcomeText(CheatOutcome.RefusedUnknown)).toBe('Unknown code.');
    expect(cheatOutcomeText(999)).toBe('Unknown code.');
  });

  it('gives every declared outcome a non-empty line', () => {
    for (const outcome of Object.values(CheatOutcome)) {
      expect(cheatOutcomeText(outcome).length).toBeGreaterThan(0);
    }
  });
});

describe('CheatState', () => {
  it('starts empty', () => {
    const state = new CheatState();

    expect(state.mask).toBe(0);
    expect(state.has(Cheat.God)).toBe(false);
  });

  it('set replaces the whole mask rather than merging', () => {
    const state = new CheatState();

    state.set(Cheat.God);
    expect(state.mask).toBe(Cheat.God);

    state.set(Cheat.Unseen);
    expect(state.mask).toBe(Cheat.Unseen);
    expect(state.has(Cheat.God)).toBe(false);
  });

  it('keeps only the byte the wire carries', () => {
    const state = new CheatState();

    state.set(0x1ff);
    expect(state.mask).toBe(0xff);
  });

  it('answers has for each bit it holds', () => {
    const state = new CheatState();
    state.set(CHEAT_FULL_SPECTATOR);

    for (const bit of ALL_BITS) {
      expect(state.has(bit)).toBe(true);
    }
    expect(state.has(1 << 20)).toBe(false);
  });

  it('clear empties it, which is the seat ending', () => {
    const state = new CheatState();
    state.set(CHEAT_FULL_SPECTATOR);

    state.clear();

    expect(state.mask).toBe(0);
    expect(describeCheatMask(state.mask)).toBe('none');
  });
});
