
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLockup, makeMark, teamEmblemUrl } from './Emblem';
import { FakeElement, installFakeDom, type FakeDom } from './testing/dom';

/**
 * Characterization tests for the brand (refactor unit C20, written before the refactor).
 *
 * Three builders over the project's only image assets. What is pinned is what every other
 * screen depends on: the two layers of the mark in the order the stylesheet breathes them,
 * the exact file names -- they were cut by a one-off Pillow pass that is not in the build, so
 * a renamed file is a broken screen with no test to say so -- and the relative side rule,
 * which is the reason a colourblind palette never recolours an emblem.
 */

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 323 lines of hand-grown double. It is the same double -- the file it
 * moved to was written from this one -- so nothing this suite sees has changed.
 */

let env: FakeDom;

beforeEach(() => {
    env = installFakeDom();
});

afterEach(() => {
    env.restore();
});

// ---------------------------------------------------------------------------- the rig

function mark(className = 'op-head__mark'): FakeElement {
    return makeMark(className) as unknown as FakeElement;
}

function lockup(): FakeElement {
    return makeLockup() as unknown as FakeElement;
}

// ---------------------------------------------------------------------------- the mark

describe('the mark', () => {
    it('is a span carrying the class it was given, after its own', () => {
        expect(mark().tag).toBe('span');
        expect(mark().className).toBe('op-mark op-head__mark');
        expect(mark('op-card__mark').className).toBe('op-mark op-card__mark');
    });

    it('is out of the accessibility tree: the name beside it says it', () => {
        expect(mark().getAttribute('aria-hidden')).toBe('true');
    });

    it('is two layers, the face then the eyes', () => {
        expect(mark().children.map((c) => c.className)).toEqual(['op-mark__face', 'op-mark__eyes']);
    });

    /** The eyes are a second image the stylesheet breathes; one file would not glow. */
    it('cuts both layers from the brand folder', () => {
        expect(mark().children.map((c) => c.src)).toEqual(['/brand/mark.png', '/brand/mark-eyes.png']);
    });

    it('lets neither layer be dragged off the screen, and names neither', () => {
        for (const layer of mark().children) {
            expect(layer.draggable).toBe(false);
            expect(layer.alt).toBe('');
            expect(layer.tag).toBe('img');
        }
    });

    it('builds a fresh element every call', () => {
        expect(mark()).not.toBe(mark());
    });
});

// ---------------------------------------------------------------------------- the lockup

describe('the lockup', () => {
    it('is the whole logo, one image', () => {
        expect(lockup().tag).toBe('img');
        expect(lockup().className).toBe('op-lockup');
        expect(lockup().src).toBe('/brand/logo.png');
    });

    /** Unlike the mark, this one *is* named: on the boot screen it is the only thing there. */
    it('names the game, because on the boot screen it is the whole content', () => {
        expect(lockup().alt).toBe('PROTOCOL SEVEN');
    });

    it('cannot be dragged', () => {
        expect(lockup().draggable).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the emblems

describe('the team emblems', () => {
    /**
     * Relative, not absolute: the wolf is always the viewer's own side and the demon always
     * the other, so a colourblind palette recolours the plate around them and never these.
     */
    it('gives the viewer\'s own side the wolf and the other the demon', () => {
        expect(teamEmblemUrl('FRIENDLY')).toBe('/brand/team-allies.png');
        expect(teamEmblemUrl('HOSTILE')).toBe('/brand/team-axis.png');
    });

    it('answers the two relations and nothing else', () => {
        expect(new Set([teamEmblemUrl('FRIENDLY'), teamEmblemUrl('HOSTILE')]).size).toBe(2);
    });

    it('is under the same brand root as the mark', () => {
        expect(teamEmblemUrl('FRIENDLY').startsWith('/brand/')).toBe(true);
        expect(teamEmblemUrl('HOSTILE').startsWith('/brand/')).toBe(true);
    });
});
