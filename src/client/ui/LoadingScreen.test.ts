
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoadingScreen } from './LoadingScreen';
import { FakeElement, installFakeDom, type FakeDom } from './testing/dom';

/**
 * Characterization tests for the loading screen (refactor unit C19, written before the
 * refactor).
 *
 * The fallback for a client that missed the readiness timeout: it exists so a slow machine
 * sees a screen rather than a frozen frame, and the design is arranged so it never appears.
 * What is pinned here is the one promise it makes -- the bar is the real chunk count and
 * nothing else -- together with what it does with the counts it should not get: null, a zero
 * total, and a done past the total.
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

interface Rig {
    readonly screen: LoadingScreen;
    readonly host: FakeElement;
    readonly root: FakeElement;
}

function rig(): Rig {
    const host = new FakeElement('div');
    const screen = new LoadingScreen(host as unknown as HTMLElement);
    return { screen, host, root: host.children[0]! };
}

function find(root: FakeElement, token: string): FakeElement {
    const hit = root.querySelector(`.${token}`);
    if (hit === null) throw new Error(`no .${token}`);
    return hit;
}

function width(r: Rig): string {
    return find(r.root, 'op-loading__fill').style['width']!;
}

// ---------------------------------------------------------------------------- the surface

describe('the surface it builds', () => {
    it('mounts one hidden screen on the host', () => {
        const r = rig();
        expect(r.host.children).toHaveLength(1);
        expect(r.root.className).toBe('op-loading');
        expect(r.root.hidden).toBe(true);
        expect(r.screen.visible).toBe(false);
    });

    it('is a title, a track and a detail line', () => {
        const r = rig();
        expect(r.root.children.map((c) => c.className)).toEqual([
            'op-loading__title',
            'op-loading__track',
            'op-loading__detail',
        ]);
    });

    it('puts the fill inside the track', () => {
        const r = rig();
        const track = find(r.root, 'op-loading__track');
        expect(track.children.map((c) => c.className)).toEqual(['op-loading__fill']);
    });

    it('says nothing before it is shown', () => {
        const r = rig();
        expect(find(r.root, 'op-loading__title').textContent).toBe('');
        expect(find(r.root, 'op-loading__detail').textContent).toBe('');
    });
});

// ---------------------------------------------------------------------------- showing

describe('showing', () => {
    it('names the map and says the match has already started', () => {
        const r = rig();
        r.screen.show('mp_dunes');
        expect(r.root.hidden).toBe(false);
        expect(r.screen.visible).toBe(true);
        expect(find(r.root, 'op-loading__title').textContent).toBe('DUNES');
        expect(find(r.root, 'op-loading__detail').textContent).toBe(
            'BUILDING THE MAP \u2014 THE MATCH HAS ALREADY STARTED',
        );
    });

    it('starts the bar at nothing', () => {
        const r = rig();
        r.screen.show('mp_foundry');
        expect(width(r)).toBe('0%');
    });

    it('resets the bar on a second show', () => {
        const r = rig();
        r.screen.show('mp_foundry');
        r.screen.update({ done: 5, total: 10 } as never);
        expect(width(r)).toBe('50%');
        r.screen.show('mp_depot');
        expect(width(r)).toBe('0%');
    });

    it('falls back to the raw id for a map this build does not know', () => {
        const r = rig();
        r.screen.show('mp_nowhere');
        expect(find(r.root, 'op-loading__title').textContent).toBe('mp_nowhere');
    });

    it('names each map in the registry', () => {
        const r = rig();
        for (const [id, name] of [
            ['mp_foundry', 'FOUNDRY'],
            ['mp_dunes', 'DUNES'],
            ['mp_depot', 'DEPOT'],
            ['mp_testbed', 'TESTBED'],
        ]) {
            r.screen.show(id!);
            expect(find(r.root, 'op-loading__title').textContent).toBe(name);
        }
    });
});

// ---------------------------------------------------------------------------- the bar

describe('the bar', () => {
    it('is the real chunk count, rounded', () => {
        const r = rig();
        r.screen.show('mp_foundry');
        r.screen.update({ done: 1, total: 3 } as never);
        expect(width(r)).toBe('33%');
        r.screen.update({ done: 2, total: 3 } as never);
        expect(width(r)).toBe('67%');
        r.screen.update({ done: 3, total: 3 } as never);
        expect(width(r)).toBe('100%');
    });

    it('never goes past a hundred', () => {
        const r = rig();
        r.screen.show('mp_foundry');
        r.screen.update({ done: 40, total: 10 } as never);
        expect(width(r)).toBe('100%');
    });

    it('leaves the bar alone for null', () => {
        const r = rig();
        r.screen.show('mp_foundry');
        r.screen.update({ done: 5, total: 10 } as never);
        r.screen.update(null);
        expect(width(r)).toBe('50%');
    });

    it('leaves the bar alone for a total of zero, rather than dividing by it', () => {
        const r = rig();
        r.screen.show('mp_foundry');
        r.screen.update({ done: 5, total: 10 } as never);
        r.screen.update({ done: 0, total: 0 } as never);
        expect(width(r)).toBe('50%');
    });

    it('leaves the bar alone for a negative total', () => {
        const r = rig();
        r.screen.show('mp_foundry');
        r.screen.update({ done: 1, total: -1 } as never);
        expect(width(r)).toBe('0%');
    });

    it('can be driven before the screen is up, and keeps the figure', () => {
        const r = rig();
        r.screen.update({ done: 1, total: 4 } as never);
        expect(width(r)).toBe('25%');
        expect(r.root.hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('hiding and disposal', () => {
    it('hides without forgetting what it said', () => {
        const r = rig();
        r.screen.show('mp_dunes');
        r.screen.hide();
        expect(r.root.hidden).toBe(true);
        expect(r.screen.visible).toBe(false);
        expect(find(r.root, 'op-loading__title').textContent).toBe('DUNES');
    });

    it('can be shown again after hiding', () => {
        const r = rig();
        r.screen.show('mp_dunes');
        r.screen.hide();
        r.screen.show('mp_depot');
        expect(r.screen.visible).toBe(true);
        expect(find(r.root, 'op-loading__title').textContent).toBe('DEPOT');
    });

    it('takes itself off the host on disposal', () => {
        const r = rig();
        r.screen.show('mp_dunes');
        r.screen.dispose();
        expect(r.host.children).toHaveLength(0);
    });

    it('is safe to dispose twice', () => {
        const r = rig();
        r.screen.dispose();
        r.screen.dispose();
        expect(r.host.children).toHaveLength(0);
    });
});
