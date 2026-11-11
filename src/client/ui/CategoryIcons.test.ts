import { describe, expect, it } from 'vitest';
import { categoryIcon, CATEGORY_VIEWBOX, type CategoryIconId } from './CategoryIcons';

/**
 * Characterization tests for the category glyphs (refactor unit C20, written before the
 * refactor).
 *
 * A table of ten SVG paths and one lookup. There is no DOM here at all, which is why this
 * file carries no double: what is pinned is that every id the type names has a path, that no
 * two of them are the same drawing, and that each is well-formed path data inside the 24-box
 * the comment promises -- a glyph that strays outside it is a glyph clipped by its own
 * viewBox, which no test of the editor would catch.
 */

// ---------------------------------------------------------------------------- the rig

const IDS: readonly CategoryIconId[] = [
    'lethal',
    'tactical',
    'smoke',
    'perk',
    'streak',
    'field',
    'camo',
    'attachment',
    'equipment',
    'lock',
];

/** Every number in a path, in order. */
function numbersIn(path: string): number[] {
    return [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

// ---------------------------------------------------------------------------- the table

describe('the table', () => {
    it('draws every kind a class can hold', () => {
        for (const id of IDS) expect(categoryIcon(id).length).toBeGreaterThan(10);
    });

    it('draws ten, and no two the same', () => {
        const paths = IDS.map((id) => categoryIcon(id));
        expect(paths).toHaveLength(10);
        expect(new Set(paths).size).toBe(10);
    });

    it('answers the same path every time: the table is not rebuilt', () => {
        expect(categoryIcon('perk')).toBe(categoryIcon('perk'));
    });

    it('shares the box the menu\'s glyphs are drawn in', () => {
        expect(CATEGORY_VIEWBOX).toBe('0 0 24 24');
    });
});

// ---------------------------------------------------------------------------- the drawings

describe('every drawing', () => {
    it('starts with a move, as path data must', () => {
        for (const id of IDS) expect(categoryIcon(id).startsWith('M')).toBe(true);
    });

    it('uses only the commands an SVG path takes', () => {
        for (const id of IDS) {
            const letters = [...categoryIcon(id)].filter((c) => /[a-zA-Z]/.test(c));
            for (const letter of letters) expect('MmLlHhVvCcSsQqTtAaZz').toContain(letter);
        }
    });

    /** Outside the 24-box is outside the viewBox, which is a glyph clipped by its own frame. */
    it('stays inside the 24-box it is drawn for', () => {
        for (const id of IDS) {
            for (const n of numbersIn(categoryIcon(id))) {
                expect(n).toBeGreaterThanOrEqual(-24);
                expect(n).toBeLessThanOrEqual(24);
            }
        }
    });

    it('closes every subpath it opens', () => {
        for (const id of IDS) {
            const opens = (categoryIcon(id).match(/M/g) ?? []).length;
            const closes = (categoryIcon(id).match(/[Zz]/g) ?? []).length;
            expect(closes).toBeGreaterThan(0);
            expect(opens).toBeGreaterThanOrEqual(closes);
        }
    });
});

// ---------------------------------------------------------------------------- the lock

describe('the padlock', () => {
    /** It stands before a locked bar's requirement, so it is the one glyph a player reads as a word. */
    it('is a shackle, a body and a keyhole: three subpaths', () => {
        expect((categoryIcon('lock').match(/M/g) ?? []).length).toBe(3);
    });

    it('is not the same drawing as any other', () => {
        for (const id of IDS) {
            if (id !== 'lock') expect(categoryIcon(id)).not.toBe(categoryIcon('lock'));
        }
    });
});
