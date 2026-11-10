
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHROME_LINE, appVersion, makeScreenFooter, makeScreenHeader } from './ScreenChrome';

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
