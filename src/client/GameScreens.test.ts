import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../shared/meta/SaveData';
import { Profile } from './meta/Profile';
import { GameScreens, type GameScreensDeps } from './GameScreens';

/**
 * Characterization tests for the front end's composition root (refactor unit C21, written
 * before the refactor).
 *
 * **The screens raise intents, `Game` decides what state to go to.** Nothing here calls
 * `transitionTo` -- every button is a callback the state machine supplies -- which is what
 * keeps the legal-transition table the only description of how the application moves. So the
 * assertions are about which intent each control raises, and about the one piece of logic
 * that stayed: the Continue button acts on the **first** press, because a button labelled
 * "Return to lobby" that does something else is a button that lies.
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

    getAttributeNames(): string[] {
        return [...this.attributes.keys()];
    }

    hasAttribute(name: string): boolean {
        return this.attributes.has(name);
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

/** A keydown or a click dispatched at one element. */
function fire(el: FakeElement, type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined, ...over };
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
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
    readonly screens: GameScreens;
    readonly host: FakeElement;
    readonly intents: string[];
}

function rig(over: Partial<GameScreensDeps> = {}): Rig {
    const host = new FakeElement('div');
    const intents: string[] = [];
    const note = (name: string) => (...args: unknown[]): void => {
        intents.push(args.length === 0 ? name : `${name}(${args.join(', ')})`);
    };
    const profile = new Profile({ fallbackSettings: defaultSettings('TDM', 'mp_foundry', 90) });
    const screens = new GameScreens({
        host: host as unknown as HTMLElement,
        profile,
        audio: new Proxy({}, { get: () => () => undefined }) as never,
        selection: { modeId: 'TDM', mapId: 'mp_foundry', difficulty: 'MIX' } as never,
        onLaunch: note('launch'),
        onPlayMultiplayer: note('multiplayer'),
        serverConfigured: () => false,
        onDisplayName: note('displayName'),
        onLoadout: note('loadout'),
        onSettings: note('settings'),
        onLoadoutSaveAndExit: note('saveAndExit'),
        onQuitToMenu: note('quit'),
        onResume: note('resume'),
        onToggleOverlay: note('overlay'),
        onCheatCode: note('cheat'),
        onLeaveSummary: note('leaveSummary'),
        onExitSummary: note('exitSummary'),
        pauseStatusLine: () => 'OFFLINE',
        anisotropy: () => 4,
        characterAssets: {
            avatarProvider: () => ({ isReady: false, create: (): null => null, dispose: (): void => undefined }),
        } as never,
        weaponAssets: null,
        ...over,
    });
    return { screens, host, intents };
}

// ---------------------------------------------------------------------------- the five

describe('the five screens', () => {
    it('builds all of them at once', () => {
        const r = rig();
        expect(r.screens.menus).toBeDefined();
        expect(r.screens.loadoutEditor).toBeDefined();
        expect(r.screens.xpSummary).toBeDefined();
        expect(r.screens.pauseMenu).toBeDefined();
        expect(r.screens.summary).toBeDefined();
    });

    /** One lifetime: built at boot and kept for the life of the page. */
    it('keeps them: a second read is the same object', () => {
        const r = rig();
        expect(r.screens.menus).toBe(r.screens.menus);
        expect(r.screens.summary).toBe(r.screens.summary);
    });

    it('mounts the summary on the host', () => {
        const r = rig();
        expect(r.host.children.some((c) => c === (r.screens.summary.element as unknown as FakeElement))).toBe(true);
    });

    /** The M4 insertion point, filled (S6.1). */
    it('puts the XP strip inside the summary\u2019s own slot', () => {
        const r = rig();
        const slot = r.screens.summary.xpSlot as unknown as FakeElement;
        const strip = r.screens.xpSummary.element as unknown as FakeElement;
        expect(strip.parent).toBe(slot);
    });

    it('raises no intent merely by being built', () => {
        expect(rig().intents).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- the summary

describe('putting the board up', () => {
    function show(r: Rig, report: unknown): void {
        r.screens.showSummary(
            {
                viewer: 7,
                localTeam: 'A',
                localId: 7,
                score: { teamA: 10, teamB: 5, rows: [] },
                mode: { getScoreboardColumns: () => [], name: 'TEAM DEATHMATCH' },
            } as never,
            { kind: 'match', winner: 'A', reason: 'Score limit', scoreA: 75, scoreB: 40, roundsA: 0, roundsB: 0 } as never,
            { mapName: 'FOUNDRY' } as never,
            report as never,
            0,
            { bodyFor: () => null } as never,
        );
    }

    /**
     * Null for a mode that does not bank progress -- the Shooting Range. The XP slot is hidden
     * rather than played empty, because an animation that counts to zero reads as a bug.
     */
    it('hides the XP slot for a mode that banks nothing', () => {
        const r = rig();
        show(r, null);
        expect((r.screens.summary.xpSlot as unknown as FakeElement).hidden).toBe(true);
    });

    it('shows it for a mode that does', () => {
        const r = rig();
        show(r, { lines: [], total: 500, xpBefore: 0, levelBefore: 1, levelAfter: 1, weaponLevelUps: [], challengesCompleted: [], camosUnlocked: [] });
        expect((r.screens.summary.xpSlot as unknown as FakeElement).hidden).toBe(false);
    });

    it('takes the board down again', () => {
        const r = rig();
        show(r, null);
        r.screens.hideSummary();
        expect((r.screens.summary.element as unknown as FakeElement).hidden).toBe(true);
    });

    it('is safe to hide twice', () => {
        const r = rig();
        r.screens.hideSummary();
        r.screens.hideSummary();
        expect((r.screens.summary.element as unknown as FakeElement).hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the one rule

describe('the Continue button', () => {
    /**
     * Acts on the first press (playtest round 4, B4). It used to swallow the first click to
     * finish the XP animation and leave only on the second -- the reported *"you have to click
     * twice"*. The XP is banked when SUMMARY is entered, so skipping the animation costs
     * nothing but the animation.
     */
    it('leaves on the first press', () => {
        const r = rig();
        const button = (r.screens.summary.element as unknown as FakeElement).querySelector('.dbf-continue');
        expect(button).not.toBeNull();
        fire(button!, 'click');
        expect(r.intents).toEqual(['leaveSummary']);
    });

    it('raises exactly one intent for one press', () => {
        const r = rig();
        const button = (r.screens.summary.element as unknown as FakeElement).querySelector('.dbf-continue');
        fire(button!, 'click');
        fire(button!, 'click');
        expect(r.intents).toEqual(['leaveSummary', 'leaveSummary']);
    });
});

// ---------------------------------------------------------------------------- the intents

describe('the intents the screens raise', () => {
    it('asks for the loadout editor on the five classes from the menu', () => {
        const r = rig();
        r.screens.menus.show('MAIN');
        const nav = (r.host.querySelectorAll('.op-nav') ?? []) as FakeElement[];
        const button = nav.find((b) => (b.querySelector('.op-nav__label')?.children[0]?.textContent
            ?? b.querySelector('.op-nav__label')?.textContent) === 'CREATE A CLASS');
        fire(button!, 'click');
        expect(r.intents).toEqual(['loadout(false)']);
    });

    it('asks for settings from the menu', () => {
        const r = rig();
        r.screens.menus.show('MAIN');
        const nav = (r.host.querySelectorAll('.op-nav') ?? []) as FakeElement[];
        fire(nav[3]!, 'click');
        expect(r.intents).toEqual(['settings']);
    });

    it('asks for a match from Play Solo', () => {
        const r = rig();
        r.screens.menus.show('PLAY');
        const launch = r.host.querySelector('.ps-launch');
        fire(launch!, 'click');
        expect(r.intents).toEqual(['launch']);
    });
});
