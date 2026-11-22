
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHROME_LINE, appVersion, makeScreenFooter, makeScreenHeader } from './ScreenChrome';
import { FakeElement, installFakeDom, type FakeDom } from './testing/dom';

/**
 * Characterization tests for the shared screen chrome (refactor unit C19, written before the
 * refactor).
 *
 * Two builders and a version string: the header every full-screen surface puts its name in,
 * and the footer with the line, the stamp and the three bars. Both are pure, so the whole file
 * is one call and a tree walk.
 *
 * `appVersion` reads a build-time define, which a test run does not have -- so what is pinned
 * is the fallback the comment promises, `dev`, and that the stamp carries whatever it answers.
 */

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 290 lines of hand-grown double. It is the same double -- the file it
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

const PLACE = { title: 'MAIN MENU', subtitle: 'ARENA FPS' };

function header(modifier = 'op-head--menu', place = PLACE): FakeElement {
    const card = new FakeElement('div');
    card.className = 'op-card';
    return makeScreenHeader(modifier, place, card as unknown as HTMLElement) as unknown as FakeElement;
}

function footer(modifier = 'op-foot--menu', place = PLACE): FakeElement {
    return makeScreenFooter(modifier, place) as unknown as FakeElement;
}

function find(root: FakeElement, token: string): FakeElement {
    const hit = root.querySelector(`.${token}`);
    if (hit === null) throw new Error(`no .${token}`);
    return hit;
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    return root.querySelectorAll(`.${token}`);
}

// ---------------------------------------------------------------------------- the line

describe('the chrome line', () => {
    it('is the game\'s own three words', () => {
        expect(CHROME_LINE).toBe('FIGHT \u00b7 SURVIVE \u00b7 WIN');
    });
});

describe('appVersion', () => {
    it('falls back to dev when the build define is absent', () => {
        expect(appVersion()).toBe('dev');
    });

    it('is a non-empty string either way', () => {
        expect(appVersion().length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------- the header

describe('the header', () => {
    it('is a header element carrying the modifier it was given', () => {
        const head = header('op-head--loadout');
        expect(head.tag).toBe('header');
        expect(head.className).toBe('op-head op-head--loadout');
    });

    it('is the brand and the card, in that order', () => {
        const head = header();
        expect(head.children.map((c) => c.className)).toEqual(['op-head__brand', 'op-card']);
    });

    it('is the mark, the wordmark, a rule and the place', () => {
        const head = header();
        expect(find(head, 'op-head__brand').children.map((c) => c.className)).toEqual([
            'op-mark op-head__mark',
            'op-head__wordmark',
            'op-head__rule',
            'op-head__place',
        ]);
    });

    it('spells the game out beside the mark', () => {
        expect(find(header(), 'op-head__wordmark').textContent).toBe('PROTOCOL SEVEN');
    });

    it('names the place as a heading with its subtitle under it', () => {
        const head = header();
        const title = find(head, 'op-head__title');
        expect(title.tag).toBe('h1');
        expect(title.textContent).toBe('MAIN MENU');
        expect(find(head, 'op-head__sub').textContent).toBe('ARENA FPS');
    });

    it('takes the place it is given, whatever it is', () => {
        const head = header('op-head--x', { title: 'SETTINGS', subtitle: 'SYSTEM CONTROL' });
        expect(find(head, 'op-head__title').textContent).toBe('SETTINGS');
        expect(find(head, 'op-head__sub').textContent).toBe('SYSTEM CONTROL');
    });

    it('takes the card as it is handed, not a copy of it', () => {
        const card = new FakeElement('div');
        card.className = 'op-card';
        const head = makeScreenHeader('op-head--menu', PLACE, card as unknown as HTMLElement) as unknown as FakeElement;
        expect(head.children[1]).toBe(card);
    });

    it('has exactly one heading, so a screen has one h1', () => {
        expect(findAll(header(), 'op-head__title')).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------- the footer

describe('the footer', () => {
    it('is a footer element carrying the modifier it was given', () => {
        const foot = footer('op-foot--pause');
        expect(foot.tag).toBe('footer');
        expect(foot.className).toBe('op-foot op-foot--pause');
    });

    it('is two rows, the second the stamp', () => {
        const foot = footer();
        expect(foot.children.map((c) => c.className)).toEqual([
            'op-foot__row',
            'op-foot__row op-foot__row--stamp',
        ]);
    });

    it('puts a tick before the line', () => {
        const foot = footer();
        expect(foot.children[0]!.children.map((c) => c.className)).toEqual([
            'op-foot__tick',
            'op-label op-foot__line',
        ]);
        expect(find(foot, 'op-foot__line').textContent).toBe(CHROME_LINE);
    });

    it('stamps the protocol, the place and the version', () => {
        expect(find(footer(), 'op-foot__stamp').textContent).toBe(`PROTOCOL 7 // MAIN MENU // V ${appVersion()}`);
    });

    it('stamps the place it is given', () => {
        const foot = footer('op-foot--x', { title: 'PLAY SOLO', subtitle: 'ignored here' });
        expect(find(foot, 'op-foot__stamp').textContent).toContain('// PLAY SOLO //');
    });

    it('does not put the subtitle on the stamp', () => {
        const foot = footer('op-foot--x', { title: 'A', subtitle: 'SHOULD NOT APPEAR' });
        expect(find(foot, 'op-foot__stamp').textContent).not.toContain('SHOULD NOT APPEAR');
    });

    it('is a rule, the stamp and the bars, in that order', () => {
        const foot = footer();
        expect(foot.children[1]!.children.map((c) => c.className)).toEqual([
            'op-foot__rule',
            'op-label op-foot__stamp',
            'op-foot__bars',
        ]);
    });

    it('draws three bars with two of them lit', () => {
        const foot = footer();
        const bars = findAll(foot, 'op-foot__bar');
        expect(bars).toHaveLength(3);
        expect(bars.map((b) => b.classList.contains('is-lit'))).toEqual([true, true, false]);
    });

    it('builds a fresh footer every call', () => {
        expect(footer()).not.toBe(footer());
    });
});
