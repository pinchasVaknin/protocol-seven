
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FpsCounter } from './FpsCounter';
import { FakeElement, installFakeDom, type FakeDom } from './testing/dom';

/**
 * Characterization tests for the frame-rate read-out (refactor unit C20, written before the
 * refactor).
 *
 * The widget's whole justification is that it costs nothing, and both halves of that are
 * pinned here rather than described: it writes **four times a second and not sixty**, and it
 * does not write at all when the number has not changed -- an unchanged `textContent` is
 * still a layout invalidation. A test that only checked the text would pass with either of
 * those broken, so the counting is done by watching the element.
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

interface Rig {
    readonly counter: FpsCounter;
    readonly host: FakeElement;
    readonly element: FakeElement;
    /** How many times `textContent` has been written since the rig was built. */
    writes: number;
    fps: number;
}

function rig(): Rig {
    const host = new FakeElement('div');
    const state = { fps: 60 };
    const counter = new FpsCounter(host as unknown as HTMLElement, {
        get fps(): number {
            return state.fps;
        },
    } as never);
    const element = counter.element as unknown as FakeElement;
    let writes = 0;
    let text = element.textContent;
    Object.defineProperty(element, 'textContent', {
        get: () => text,
        set: (value: string) => {
            writes++;
            text = value;
        },
        configurable: true,
    });
    return {
        counter,
        host,
        element,
        get writes(): number {
            return writes;
        },
        set writes(value: number) {
            writes = value;
        },
        get fps(): number {
            return state.fps;
        },
        set fps(value: number) {
            state.fps = value;
        },
    };
}

/** Feed it `seconds` of frames at 60 Hz. */
function run(r: Rig, seconds: number): void {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) r.counter.update(1 / 60);
}

function bands(r: Rig): string[] {
    return [...r.element.tokens].filter((t) => t.startsWith('op-fps--'));
}

// ---------------------------------------------------------------------------- the element

describe('the element it builds', () => {
    it('mounts one hidden read-out on the host', () => {
        const r = rig();
        expect(r.host.children).toHaveLength(1);
        expect(r.element.className).toBe('op-fps op-num');
        expect(r.element.hidden).toBe(true);
    });

    it('shows a dash before it has anything to say', () => {
        expect(rig().element.textContent).toBe('\u2014');
    });

    it('starts invisible', () => {
        expect(rig().counter.isVisible).toBe(false);
    });
});

// ---------------------------------------------------------------------------- turning it on

describe('turning it on and off', () => {
    it('unhides the element', () => {
        const r = rig();
        r.counter.setVisible(true);
        expect(r.counter.isVisible).toBe(true);
        expect(r.element.hidden).toBe(false);
    });

    it('hides it again', () => {
        const r = rig();
        r.counter.setVisible(true);
        r.counter.setVisible(false);
        expect(r.counter.isVisible).toBe(false);
        expect(r.element.hidden).toBe(true);
    });

    it('does nothing for a setting that has not changed', () => {
        const r = rig();
        r.counter.setVisible(false);
        expect(r.element.hidden).toBe(true);
        r.counter.setVisible(true);
        r.counter.setVisible(true);
        expect(r.element.hidden).toBe(false);
    });

    /** The dash must not survive a second visit with the same number behind it. */
    it('writes the number again after being turned off and on', () => {
        const r = rig();
        r.counter.setVisible(true);
        run(r, 1);
        r.counter.setVisible(false);
        r.counter.setVisible(true);
        r.writes = 0;
        run(r, 1);
        expect(r.writes).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------- the cost

describe('what it costs', () => {
    it('writes nothing at all while it is hidden, however many frames run', () => {
        const r = rig();
        run(r, 10);
        expect(r.writes).toBe(0);
        expect(r.element.textContent).toBe('\u2014');
    });

    /**
     * Four a second, not sixty: the number is unreadable faster and the write is not free.
     *
     * Three in sixty frames rather than four, and the arithmetic is worth saying because it
     * looks like an off-by-one and is not: the gate is `accumulator < 0.25` and the
     * accumulator is sixteen additions of `1/60`, since fifteen of them come to
     * 0.24999999999999994 in binary floating point. Sixteen frames a write, so sixty frames
     * hold three. A number that updates every 267 ms rather than every 250 ms is the same
     * widget; this pins what it does, not what the comment rounds it to.
     */
    it('writes three times in sixty frames: sixteen frames to a write', () => {
        const r = rig();
        r.counter.setVisible(true);
        const at: number[] = [];
        for (let i = 0; i < 60; i++) {
            r.fps = 50 + i;
            const before = r.writes;
            r.counter.update(1 / 60);
            if (r.writes > before) at.push(i);
        }
        expect(at).toEqual([15, 31, 47]);
    });

    it('writes about four times a second on a real frame budget', () => {
        const r = rig();
        r.counter.setVisible(true);
        let shown = 0;
        for (let i = 0; i < 64; i++) {
            r.fps = 50 + i;
            const before = r.writes;
            r.counter.update(0.016);
            if (r.writes > before) shown++;
        }
        expect(shown).toBe(4);
    });

    it('does not write an unchanged number, because that is still an invalidation', () => {
        const r = rig();
        r.counter.setVisible(true);
        run(r, 1);
        const after = r.writes;
        run(r, 5);
        expect(r.writes).toBe(after);
    });

    it('writes again the moment the number moves', () => {
        const r = rig();
        r.counter.setVisible(true);
        run(r, 1);
        const after = r.writes;
        r.fps = 30;
        run(r, 1);
        expect(r.writes).toBeGreaterThan(after);
    });
});

// ---------------------------------------------------------------------------- the reading

describe('what it reads', () => {
    it('rounds the frame rate and names the unit', () => {
        const r = rig();
        r.counter.setVisible(true);
        r.fps = 59.6;
        run(r, 1);
        expect(r.element.textContent).toBe('60 FPS');
    });

    it('rounds down as well as up', () => {
        const r = rig();
        r.counter.setVisible(true);
        r.fps = 59.4;
        run(r, 1);
        expect(r.element.textContent).toBe('59 FPS');
    });

    it('reads a stalled frame rate as zero rather than as nothing', () => {
        const r = rig();
        r.counter.setVisible(true);
        r.fps = 0;
        run(r, 1);
        expect(r.element.textContent).toBe('0 FPS');
    });
});

// ---------------------------------------------------------------------------- the bands

describe('the three bands', () => {
    /** The question is "is this smooth", and that has three answers, not a gradient. */
    it('calls 58 and over good', () => {
        const r = rig();
        r.counter.setVisible(true);
        r.fps = 58;
        run(r, 1);
        expect(bands(r)).toEqual(['op-fps--good']);
    });

    it('calls 40 to 57 fair', () => {
        for (const fps of [40, 50, 57]) {
            const r = rig();
            r.counter.setVisible(true);
            r.fps = fps;
            run(r, 1);
            expect(bands(r)).toEqual(['op-fps--fair']);
        }
    });

    it('calls under 40 poor', () => {
        const r = rig();
        r.counter.setVisible(true);
        r.fps = 39;
        run(r, 1);
        expect(bands(r)).toEqual(['op-fps--poor']);
    });

    it('wears exactly one band at a time', () => {
        const r = rig();
        r.counter.setVisible(true);
        for (const fps of [120, 58, 57, 40, 39, 1]) {
            r.fps = fps;
            run(r, 1);
            expect(bands(r)).toHaveLength(1);
        }
    });

    it('keeps the base classes under the band', () => {
        const r = rig();
        r.counter.setVisible(true);
        run(r, 1);
        expect(r.element.classList.contains('op-fps')).toBe(true);
        expect(r.element.classList.contains('op-num')).toBe(true);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('disposal', () => {
    it('takes the read-out off the host', () => {
        const r = rig();
        r.counter.dispose();
        expect(r.host.children).toHaveLength(0);
    });

    it('is safe twice', () => {
        const r = rig();
        r.counter.dispose();
        r.counter.dispose();
        expect(r.host.children).toHaveLength(0);
    });
});
