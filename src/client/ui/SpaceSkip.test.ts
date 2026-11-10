
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    SKIP_FAST_FORWARD,
    SKIP_HOLD_SECONDS,
    SKIP_TAPS_TO_LEAVE,
    SKIP_TAP_WINDOW_SECONDS,
} from '../../shared/ui/SkipGesture';
import { SpaceSkip } from './SpaceSkip';

/**
 * Characterization tests for the Space key adapter (refactor unit C19, written before the
 * refactor).
 *
 * `SkipGesture` holds the rule and has its own tests; this file is the half that touches the
 * browser -- three window listeners, the key test that takes `key` as well as `code`, the
 * repeat that is not a press, and the `enabled` gate that the debrief's second of grace is.
 *
 * The clock is `performance.now`, which is the rig's: a hold is `nowMs += 200`, not a wait.
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

    getContext(): unknown {
        return null;
    }

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

/** A keydown on `window`. Not a `KeyboardEvent` instance -- use `fireKey` for that. */
function fireWindow(type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined, ...over };
    for (const fn of [...(windowListeners.get(type) ?? [])]) fn(event);
}

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
    readonly skip: SpaceSkip;
    readonly leaves: number[];
    enabled: boolean;
}

function rig(onLeave: boolean = true): Rig {
    const leaves: number[] = [];
    const state = { enabled: true };
    const skip = new SpaceSkip({
        enabled: () => state.enabled,
        onLeave: onLeave
            ? (): void => {
                  leaves.push(nowMs);
              }
            : null,
    });
    return {
        skip,
        leaves,
        get enabled(): boolean {
            return state.enabled;
        },
        set enabled(value: boolean) {
            state.enabled = value;
        },
    };
}

/** Advance the clock by seconds. */
function wait(seconds: number): void {
    nowMs += seconds * 1000;
}

function down(over: Partial<FakeEvent> = { code: 'Space' }): void {
    fireWindow('keydown', over);
}

function up(over: Partial<FakeEvent> = { code: 'Space' }): void {
    fireWindow('keyup', over);
}

/** One tap: down, a moment, up. Shorter than the hold threshold. */
function tap(): void {
    down();
    wait(0.05);
    up();
}

// ---------------------------------------------------------------------------- listening

describe('listening', () => {
    it('listens on nothing until asked', () => {
        rig();
        expect(windowListeners.size).toBe(0);
    });

    it('takes keydown, keyup and blur', () => {
        const r = rig();
        r.skip.listen();
        expect(windowListeners.get('keydown')).toHaveLength(1);
        expect(windowListeners.get('keyup')).toHaveLength(1);
        expect(windowListeners.get('blur')).toHaveLength(1);
    });

    it('listens once however often it is asked', () => {
        const r = rig();
        r.skip.listen();
        r.skip.listen();
        expect(windowListeners.get('keydown')).toHaveLength(1);
    });

    it('gives all three back', () => {
        const r = rig();
        r.skip.listen();
        r.skip.unlisten();
        expect(windowListeners.get('keydown')).toHaveLength(0);
        expect(windowListeners.get('keyup')).toHaveLength(0);
        expect(windowListeners.get('blur')).toHaveLength(0);
    });

    it('is safe to unlisten twice, and before listening', () => {
        const r = rig();
        r.skip.unlisten();
        r.skip.listen();
        r.skip.unlisten();
        r.skip.unlisten();
        expect(windowListeners.get('keydown')).toHaveLength(0);
    });

    it('forgets whatever was held when it stops listening', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.holding).toBe(true);
        r.skip.unlisten();
        expect(r.skip.holding).toBe(false);
    });

    it('forgets whatever was held when it starts listening', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        r.skip.unlisten();
        r.skip.listen();
        expect(r.skip.holding).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the key

describe('which key it takes', () => {
    it('takes Space by code', () => {
        const r = rig();
        r.skip.listen();
        down({ code: 'Space' });
        wait(0.3);
        expect(r.skip.holding).toBe(true);
    });

    it('takes a synthetic press that carries key and not code', () => {
        const r = rig();
        r.skip.listen();
        down({ key: ' ' });
        wait(0.3);
        expect(r.skip.holding).toBe(true);
    });

    it('takes the old Spacebar spelling', () => {
        const r = rig();
        r.skip.listen();
        down({ key: 'Spacebar' });
        wait(0.3);
        expect(r.skip.holding).toBe(true);
    });

    it('takes no other key', () => {
        const r = rig();
        r.skip.listen();
        for (const over of [{ code: 'KeyW' }, { key: 'w' }, { code: 'Enter', key: 'Enter' }]) {
            down(over);
            wait(0.3);
            expect(r.skip.holding).toBe(false);
            up(over);
        }
    });

    it('claims the key whether or not the screen wants it', () => {
        const r = rig();
        r.skip.listen();
        r.enabled = false;
        let prevented = 0;
        let stopped = 0;
        fireWindow('keydown', {
            code: 'Space',
            preventDefault: () => {
                prevented++;
            },
            stopPropagation: () => {
                stopped++;
            },
        });
        expect(prevented).toBe(1);
        expect(stopped).toBe(1);
    });

    it('claims nothing for a key that is not Space', () => {
        const r = rig();
        r.skip.listen();
        let prevented = 0;
        fireWindow('keydown', {
            code: 'KeyW',
            preventDefault: () => {
                prevented++;
            },
        });
        expect(prevented).toBe(0);
    });
});

// ---------------------------------------------------------------------------- the hold

describe('holding', () => {
    it('is not a hold before the threshold', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(SKIP_HOLD_SECONDS - 0.01);
        expect(r.skip.holding).toBe(false);
    });

    it('is a hold at the threshold', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(SKIP_HOLD_SECONDS);
        expect(r.skip.holding).toBe(true);
    });

    it('is not a hold once the key is up', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        up();
        expect(r.skip.holding).toBe(false);
    });

    it('boosts a frame by the fast-forward, less the one times it already had', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.boost(0.016)).toBeCloseTo(0.016 * (SKIP_FAST_FORWARD - 1), 10);
    });

    it('boosts nothing before the threshold', () => {
        const r = rig();
        r.skip.listen();
        down();
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('boosts nothing when nobody is touching it', () => {
        const r = rig();
        r.skip.listen();
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('boosts nothing from a negative frame', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.boost(-1)).toBe(0);
    });

    it('treats a repeat as the same press, not another', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        down({ code: 'Space', repeat: true });
        expect(r.skip.holding).toBe(true);
        expect(r.skip.boost(0.016)).toBeGreaterThan(0);
    });

    it('does not leave on a hold, however long', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(5);
        up();
        expect(r.leaves).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- the taps

describe('the taps', () => {
    it('leaves on the third quick tap and no sooner', () => {
        const r = rig();
        r.skip.listen();
        tap();
        expect(r.leaves).toEqual([]);
        tap();
        expect(r.leaves).toEqual([]);
        tap();
        expect(r.leaves).toHaveLength(1);
    });

    it('needs the taps that the shared rule names', () => {
        const r = rig();
        r.skip.listen();
        for (let i = 0; i < SKIP_TAPS_TO_LEAVE - 1; i++) tap();
        expect(r.leaves).toEqual([]);
        tap();
        expect(r.leaves).toHaveLength(1);
    });

    it('starts a new run when a tap comes too late', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        wait(SKIP_TAP_WINDOW_SECONDS + 0.1);
        tap();
        expect(r.leaves).toEqual([]);
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
    });

    it('a hold between taps ends the run', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        down();
        wait(0.3);
        up();
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('starts a fresh run after leaving', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
        tap();
        expect(r.leaves).toHaveLength(2);
    });

    it('is nothing at all on a screen with nowhere to go', () => {
        const r = rig(false);
        r.skip.listen();
        tap();
        tap();
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('does not count a keyup with no press behind it', () => {
        const r = rig();
        r.skip.listen();
        up();
        up();
        up();
        expect(r.leaves).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- the gate

describe('the enabled gate', () => {
    it('records no press while the screen is not taking the key', () => {
        const r = rig();
        r.skip.listen();
        r.enabled = false;
        down();
        wait(0.3);
        expect(r.skip.holding).toBe(false);
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('reports no hold while the screen is not taking the key, even with one recorded', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        r.enabled = false;
        expect(r.skip.holding).toBe(false);
        expect(r.skip.boost(0.016)).toBe(0);
    });

    /** The debrief's second of grace: a hand still on jump must not be taps into leaving. */
    it('clears the run on a release the screen was not taking', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        r.enabled = false;
        down();
        wait(0.05);
        up();
        r.enabled = true;
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('takes the key normally once the screen wants it', () => {
        const r = rig();
        r.skip.listen();
        r.enabled = false;
        down();
        up();
        r.enabled = true;
        tap();
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------- focus

describe('losing focus', () => {
    it('forgets a key that was down, so the screen does not scrub on its own', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.holding).toBe(true);
        fireWindow('blur');
        expect(r.skip.holding).toBe(false);
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('ends the run of taps as well', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        fireWindow('blur');
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('does not leave when the keyup went somewhere else', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        down();
        fireWindow('blur');
        up();
        expect(r.leaves).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- reset

describe('reset', () => {
    it('is the same as losing focus', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        r.skip.reset();
        expect(r.skip.holding).toBe(false);
    });

    it('ends the run of taps', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        r.skip.reset();
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('leaves the listeners alone', () => {
        const r = rig();
        r.skip.listen();
        r.skip.reset();
        expect(windowListeners.get('keydown')).toHaveLength(1);
    });
});
