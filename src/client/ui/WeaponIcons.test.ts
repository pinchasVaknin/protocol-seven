
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_WEAPONS } from '../../shared/weapons/WeaponDefs';
import { weaponSilhouettePath } from '../weapons/WeaponSilhouette';
import { HEADSHOT_PATH, HEADSHOT_VIEWBOX, ICON_VIEWBOX, iconFor, makeIconSvg } from './WeaponIcons';
import { FakeElement, installFakeDom, type FakeDom } from './testing/dom';

/**
 * Characterization tests for the killfeed icons (refactor unit C20, written before the
 * refactor).
 *
 * The property F15 bought is the one worth pinning: **the icon is the gun**. `iconFor` is
 * `weaponSilhouettePath` over the same `WeaponModelSpec` the viewmodel is built from, so a
 * test that compares the two is a test that the feed and the hands cannot drift -- and a test
 * that every shipped weapon has an outline is a test that nothing falls back to printing its
 * name, which eleven of the twelve used to do.
 *
 * `makeIconSvg` is the project's one SVG builder; every glyph in the game goes through it, so
 * its namespace and its `aria-hidden` are load-bearing far outside this file.
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

function svg(path: string, viewBox = ICON_VIEWBOX, className = 'kf-row__icon'): FakeElement {
    return makeIconSvg(path, viewBox, className) as unknown as FakeElement;
}

// ---------------------------------------------------------------------------- the outlines

describe('the weapon outlines', () => {
    it('gives every shipped weapon an outline, so none prints its name', () => {
        for (const def of ALL_WEAPONS) expect(iconFor(def.id).length).toBeGreaterThan(20);
    });

    /** The whole of F15: one source for what a weapon looks like. */
    it('is the silhouette of the model the viewmodel is built from', () => {
        for (const def of ALL_WEAPONS) expect(iconFor(def.id)).toBe(weaponSilhouettePath(def.id));
    });

    it('draws an SMG and an LMG as different shapes, which is what keying by id bought', () => {
        expect(iconFor('smg_wasp')).not.toBe(iconFor('lmg_bastion'));
        expect(iconFor('pistol_talon')).not.toBe(iconFor('sniper_kestrel'));
    });

    /** No null any more: an unknown id gets `AR_BASE`, which is what the hands would draw too. */
    it('answers for an id it has never heard of, rather than returning nothing', () => {
        const unknown = iconFor('not_a_weapon');
        expect(unknown.length).toBeGreaterThan(20);
        expect(unknown).toBe(weaponSilhouettePath('not_a_weapon'));
    });

    it('memoises, so a feed row costs a lookup', () => {
        expect(iconFor('ar_carbine')).toBe(iconFor('ar_carbine'));
    });

    it('draws in its own long box, barrel pointing right', () => {
        expect(ICON_VIEWBOX).toBe('0 0 48 16');
    });
});

// ---------------------------------------------------------------------------- the headshot

describe('the headshot badge', () => {
    it('has a box of its own, because it is a badge and not a silhouette', () => {
        expect(HEADSHOT_VIEWBOX).toBe('0 0 12 12');
        expect(HEADSHOT_VIEWBOX).not.toBe(ICON_VIEWBOX);
    });

    it('is a skull with two eyes: three subpaths', () => {
        expect((HEADSHOT_PATH.match(/M/g) ?? []).length).toBe(3);
    });

    it('stays inside its own twelve', () => {
        for (const m of HEADSHOT_PATH.matchAll(/-?\d+(?:\.\d+)?/g)) {
            expect(Number(m[0])).toBeLessThanOrEqual(12);
        }
    });
});

// ---------------------------------------------------------------------------- the builder

describe('makeIconSvg', () => {
    it('builds an svg with one path inside it', () => {
        const el = svg('M0 0 h1 v1 Z');
        expect(el.tag).toBe('svg');
        expect(el.children).toHaveLength(1);
        expect(el.children[0]!.tag).toBe('path');
    });

    it('puts the drawing on the path and the box on the svg', () => {
        const el = svg('M0 0 h1 v1 Z');
        expect(el.getAttribute('viewBox')).toBe('0 0 48 16');
        expect(el.children[0]!.getAttribute('d')).toBe('M0 0 h1 v1 Z');
    });

    it('classes the svg by attribute, which is the only way an SVG element can be classed', () => {
        expect(svg('M0 0', ICON_VIEWBOX, 'ps-opt__glyph').getAttribute('class')).toBe('ps-opt__glyph');
    });

    /** Every glyph in the game: none of them is read out, because each sits beside its name. */
    it('keeps every glyph out of the accessibility tree', () => {
        expect(svg('M0 0').getAttribute('aria-hidden')).toBe('true');
    });

    it('takes whatever box it is handed', () => {
        expect(svg(HEADSHOT_PATH, HEADSHOT_VIEWBOX, 'kf-row__head').getAttribute('viewBox')).toBe('0 0 12 12');
    });

    it('builds a fresh element every call', () => {
        expect(svg('M0 0')).not.toBe(svg('M0 0'));
    });
});
