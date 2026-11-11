
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FpsCounter } from './FpsCounter';

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

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
    key?: string;
    code?: string;
    repeat?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
}

/** One move handed back by `element.animate`, with the hooks the splash uses on it. */
class FakeAnimation {
    onfinish: null | (() => void) = null;
    oncancel: null | (() => void) = null;
    playbackRate = 1;
    cancelled = false;
    finished = false;

    constructor(
        readonly el: FakeElement,
        readonly frames: readonly Record<string, unknown>[],
        readonly options: Record<string, unknown>,
    ) {}

    /** What `skip` does to a move already running: run it out, do not throw it away. */
    finish(): void {
        this.finished = true;
        this.onfinish?.();
    }

    cancel(): void {
        this.cancelled = true;
        this.oncancel?.();
    }
}

class FakeElement {
    readonly tokens = new Set<string>();
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Listener[]>();
    readonly dataset: Record<string, string> = {};
    readonly anims: FakeAnimation[] = [];
    readonly style: Record<string, string> & { setProperty: (n: string, v: string) => void } = Object.assign(
        {} as Record<string, string>,
        {
            setProperty: (n: string, v: string): void => {
                this.style[n] = v;
            },
        },
    );

    textContent = '';
    hidden = false;
    disabled = false;
    type = '';
    value = '';
    title = '';
    src = '';
    alt = '';
    draggable = true;
    width = 0;
    height = 0;
    offsetWidth = 200;
    offsetHeight = 40;
    /** `Splash.skullShift` measures the box with this; 0 unless a test sets it. */
    clientWidth = 0;
    clientHeight = 0;
    parent: FakeElement | null = null;
    rect = { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 };

    constructor(readonly tag: string) {}

    get className(): string {
        return [...this.tokens].join(' ');
    }

    set className(value: string) {
        this.tokens.clear();
        for (const token of value.split(' ')) if (token !== '') this.tokens.add(token);
    }

    readonly classList = {
        add: (...tokens: string[]): void => {
            for (const token of tokens) this.tokens.add(token);
        },
        remove: (...tokens: string[]): void => {
            for (const token of tokens) this.tokens.delete(token);
        },
        toggle: (token: string, on?: boolean): void => {
            if (on ?? !this.tokens.has(token)) this.tokens.add(token);
            else this.tokens.delete(token);
        },
        contains: (token: string): boolean => this.tokens.has(token),
    };

    /** The Web Animations API. Every move the splash makes lands in `anims`, in order. */
    animate(frames: readonly Record<string, unknown>[], options: Record<string, unknown>): FakeAnimation {
        const anim = new FakeAnimation(this, frames, options);
        this.anims.push(anim);
        allAnimations.push(anim);
        return anim;
    }

    appendChild(child: FakeElement): FakeElement {
        child.parent = this;
        this.children.push(child);
        return child;
    }

    append(...nodes: FakeElement[]): void {
        for (const node of nodes) this.appendChild(node);
    }

    replaceChildren(...nodes: FakeElement[]): void {
        for (const child of this.children) child.parent = null;
        this.children.length = 0;
        this.append(...nodes);
    }

    remove(): void {
        const siblings = this.parent?.children;
        if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
        this.parent = null;
    }

    get childElementCount(): number {
        return this.children.length;
    }

    get firstElementChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    /**
     * `setAttribute('class', …)` writes the token set, as a real element's does.
     *
     * This is how `makeIconSvg` names its icons: an SVG element has no settable `className`,
     * so every glyph in the project is classed by attribute, and a double that did not
     * reflect it would hide every icon from `querySelector`.
     */
    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === 'class') this.className = value;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    addEventListener(type: string, fn: Listener): void {
        const held = this.listeners.get(type);
        if (held === undefined) this.listeners.set(type, [fn]);
        else held.push(fn);
    }

    removeEventListener(type: string, fn: Listener): void {
        const held = this.listeners.get(type);
        if (held === undefined) return;
        const at = held.indexOf(fn);
        if (at >= 0) held.splice(at, 1);
    }

    /**
     * A 2D context that refuses nothing: the camo and weapon textures are drawn into one.
     *
     * The lesson from C18 -- `CharacterAssetService` throws *2D canvas context unavailable*
     * without it, and the throw happens deep inside a weapon build rather than at the call.
     */
    getContext(kind: string): unknown {
        if (kind !== '2d') return null;
        const target: Record<string, unknown> = {
            canvas: this,
            createLinearGradient: () => ({ addColorStop: (): void => undefined }),
            createRadialGradient: () => ({ addColorStop: (): void => undefined }),
            createPattern: () => null,
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
            getImageData: (_x: number, _y: number, w: number, h: number) => ({
                data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
                width: w,
                height: h,
            }),
            measureText: () => ({ width: 10 }),
        };
        return new Proxy(target, {
            get: (t, key) => (key in t ? t[key as string] : () => undefined),
            set: (t, key, value) => {
                t[key as string] = value;
                return true;
            },
        });
    }

    toDataURL(): string {
        return 'data:image/png;base64,x';
    }

    setPointerCapture(): void {}
    releasePointerCapture(): void {}

    getBoundingClientRect(): FakeElement['rect'] {
        return this.rect;
    }

    focus(): void {}
    blur(): void {}

    querySelector(selector: string): FakeElement | null {
        return this.queryAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        return this.queryAll(selector);
    }

    private queryAll(selector: string): FakeElement[] {
        const token = selector.replace(/^\./, '');
        const out: FakeElement[] = [];
        const walk = (el: FakeElement): void => {
            if (el.tokens.has(token)) out.push(el);
            for (const child of el.children) walk(child);
        };
        for (const child of this.children) walk(child);
        return out;
    }
}

// ---------------------------------------------------------------------------- the environment

let windowListeners: Map<string, Listener[]>;
let timers: { readonly at: number; readonly fn: () => void; cancelled: boolean }[];
let allAnimations: FakeAnimation[];
let nowMs = 0;
/** What `window.matchMedia('(prefers-reduced-motion: reduce)')` answers. */
let reducedMotion = false;

class FakeKeyboardEvent {}

beforeEach(() => {
    windowListeners = new Map();
    timers = [];
    allAnimations = [];
    nowMs = 100_000;
    const storage = new Map<string, string>();
    const store = {
        getItem: (k: string): string | null => storage.get(k) ?? null,
        setItem: (k: string, v: string): void => {
            storage.set(k, v);
        },
        removeItem: (k: string): void => {
            storage.delete(k);
        },
        clear: (): void => storage.clear(),
        key: (i: number): string | null => [...storage.keys()][i] ?? null,
        get length(): number {
            return storage.size;
        },
    };
    const setTimer = (fn: () => void, ms = 0): number => {
        timers.push({ at: nowMs + ms, fn, cancelled: false });
        return timers.length;
    };
    const clearTimer = (id: number): void => {
        const timer = timers[id - 1];
        if (timer !== undefined) timer.cancelled = true;
    };
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        documentElement: new FakeElement('html'),
        activeElement: null,
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['KeyboardEvent'] = FakeKeyboardEvent;
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['setTimeout'] = setTimer;
    (globalThis as Record<string, unknown>)['clearTimeout'] = clearTimer;
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        matchMedia: (query: string) => ({ matches: reducedMotion, media: query }),
        addEventListener: (type: string, fn: Listener): void => {
            const held = windowListeners.get(type);
            if (held === undefined) windowListeners.set(type, [fn]);
            else held.push(fn);
        },
        removeEventListener: (type: string, fn: Listener): void => {
            const held = windowListeners.get(type);
            if (held === undefined) return;
            const at = held.indexOf(fn);
            if (at >= 0) held.splice(at, 1);
        },
    };
    (globalThis as Record<string, unknown>)['performance'] = { now: () => nowMs };
    (globalThis as Record<string, unknown>)['requestAnimationFrame'] = (): number => 1;
    (globalThis as Record<string, unknown>)['cancelAnimationFrame'] = (): void => undefined;
});

afterEach(() => {
    reducedMotion = false;
    for (const key of [
        'document',
        'HTMLElement',
        'KeyboardEvent',
        'localStorage',
        'setTimeout',
        'clearTimeout',
        'window',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ]) {
        delete (globalThis as Record<string, unknown>)[key];
    }
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
