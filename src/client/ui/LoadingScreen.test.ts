
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoadingScreen } from './LoadingScreen';

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
