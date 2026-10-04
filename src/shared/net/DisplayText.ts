/**
 * Text a player chose, made fit to put in front of other players (security audit 2026-10-04, S9).
 *
 * A callsign and a class name cross the trust boundary: one client writes them, every other
 * client draws them. They are drawn through `textContent`, never parsed as markup, so the danger
 * is not script — it is text that *looks* like something it is not. The sanitiser this replaces
 * removed the C0 controls and nothing else, and that left four ways to do it:
 *
 * - **Direction overrides.** U+202E turns `ALICE‮etis` into a name that renders backwards
 *   from the override on, and the isolates and embeddings do the same more quietly. Every
 *   format character (`Cf`) goes: the bidi controls, the zero-widths, the soft hyphen, the BOM,
 *   the invisible tag characters.
 * - **Blank names.** A name of zero-width spaces, or of the Hangul fillers and the blank braille
 *   cell — letters by category that draw nothing — is a player with no name on the board.
 * - **Breaking the row.** The C1 controls and the line and paragraph separators (`Zl`, `Zp`);
 *   and any run of spaces, of any width, becomes one ordinary space.
 * - **Stacked marks.** A letter can carry any number of combining marks, and fifty of them draw a
 *   column that runs over every row above and below it. Two per letter are kept — Hebrew points
 *   and Arabic harakat need that many, and nothing legible needs more.
 *
 * NFC first, so a precomposed letter and its decomposed spelling are one name. The result never
 * starts or ends with a space and is at most `cap` UTF-16 units, the same measure the cap always
 * used. Shared: the client cleans its own name with it before sending, and the server cleans what
 * arrives, so the two can only agree.
 */

/** Characters that draw nothing or reshape what is around them. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** Letters (and one symbol) by category that render as blank space. */
const BLANK_LETTERS: ReadonlySet<string> = new Set(['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '⠀']);
const SPACE = /\p{Zs}/u;
const MARK = /\p{M}/u;
/** Combining marks kept on one base character. */
const MAX_MARKS = 2;

/**
 * `name`, or `name (2)`, `name (3)` … — the first that none of `taken` already is (S9).
 *
 * Compared without case, because `alice` beside `ALICE` is the same impersonation. The suffix
 * fits inside `cap`: the name is cut to make room, never at half a surrogate pair. Terminates —
 * each attempt is a different suffix, and `taken` is finite.
 */
export function uniqueDisplayName(name: string, taken: Iterable<string>, cap: number): string {
  const used = new Set<string>();
  for (const t of taken) used.add(t.toUpperCase());
  if (!used.has(name.toUpperCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const head = name
      .slice(0, Math.max(0, cap - suffix.length))
      .replace(/[\uD800-\uDBFF]$/, '')
      .trimEnd();
    const candidate = `${head}${suffix}`;
    if (!used.has(candidate.toUpperCase())) return candidate;
  }
}

export function cleanDisplayText(raw: string, cap: number): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  let marks = 0;
  let spaceOwed = false;
  for (const ch of raw.normalize('NFC')) {
    if (INVISIBLE.test(ch) || BLANK_LETTERS.has(ch)) continue;
    if (SPACE.test(ch)) {
      // Owed rather than written, so a run collapses to one and a trailing one never lands.
      spaceOwed = out !== '';
      continue;
    }
    if (MARK.test(ch)) {
      // A mark with nothing to sit on, or one past the limit, is dropped.
      if (out === '' || marks >= MAX_MARKS || out.length + ch.length > cap) continue;
      marks++;
      out += ch;
      continue;
    }
    const next = spaceOwed ? ` ${ch}` : ch;
    if (out.length + next.length > cap) break;
    out += next;
    spaceOwed = false;
    marks = 0;
  }
  return out;
}
