import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODE_ID, findMode, MODES } from '../shared/modes/ModeRegistry';
import { defaultSettings } from '../shared/meta/SaveData';
import { cloneWeaponDef, WEAPON_DEFS } from '../shared/weapons/WeaponDefs';
import { Profile } from './meta/Profile';
import { applyEquippedLoadout, asModeId, type LoadoutTargets } from './GameLoadout';

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

/**
 * Characterization tests for the bridge between the profile and the match (refactor unit C21,
 * written before the refactor).
 *
 * Two free functions and one subtlety. `Game` owns three long-lived `WeaponDef` objects that
 * the tuning panel, the weapon system and the bot director captured references to when the
 * match was built, so a class change **copies into** them: replacing one would leave three
 * systems pointing at the previous loadout. That is what every assertion about identity below
 * is for -- "equal" and "the same" are different claims and only one of them is checkable.
 */

// ---------------------------------------------------------------------------- the rig

function profile(): Profile {
    return new Profile({ fallbackSettings: defaultSettings('TDM', 'mp_foundry', 90) });
}

function targets(): LoadoutTargets {
    return {
        primary: cloneWeaponDef(WEAPON_DEFS['ar_carbine']!),
        secondary: cloneWeaponDef(WEAPON_DEFS['pistol_talon']!),
        playerBase: cloneWeaponDef(WEAPON_DEFS['ar_carbine']!),
    };
}

// ---------------------------------------------------------------------------- the mode id

describe('asModeId', () => {
    it('takes every mode the registry knows', () => {
        for (const mode of MODES) expect(asModeId(mode.id)).toBe(mode.id);
    });

    /** A stored mode id that no longer exists falls back rather than throwing. */
    it('falls back to the default for an id that no longer exists', () => {
        expect(asModeId('OBJECTIVE_RUSH')).toBe(DEFAULT_MODE_ID);
        expect(asModeId('')).toBe(DEFAULT_MODE_ID);
    });

    it('is case-sensitive, because the ids are', () => {
        expect(asModeId('dom')).toBe(DEFAULT_MODE_ID);
    });
});

// ---------------------------------------------------------------------------- the copy

describe('applying the equipped class', () => {
    it('hands back the resolved loadout the match will be given', () => {
        const t = targets();
        const loadout = applyEquippedLoadout(profile(), 'TDM', t);
        expect(loadout.primary.id).toBe(t.primary.id);
        expect(loadout.secondary.id).toBe(t.secondary.id);
    });

    /**
     * The same object, not an equal one: two resolves of the same slot are equal, and "equal"
     * and "the same" are different claims.
     */
    it('keeps the three destination objects, rather than replacing them', () => {
        const t = targets();
        const before = [t.primary, t.secondary, t.playerBase];
        applyEquippedLoadout(profile(), 'TDM', t);
        expect([t.primary, t.secondary, t.playerBase]).toEqual(before);
    });

    it('writes the equipped class into them', () => {
        const p = profile();
        const t = targets();
        const loadout = applyEquippedLoadout(p, 'TDM', t);
        expect(t.primary.id).toBe(loadout.primary.id);
        expect(t.primary.damage).toEqual(loadout.primary.damage);
        expect(t.playerBase.id).toBe(loadout.primaryBase.id);
    });

    /** Writing to a live weapon must never reach back into the registry. */
    it('shares no nested record with the loadout it came from', () => {
        const t = targets();
        const loadout = applyEquippedLoadout(profile(), 'TDM', t);
        expect(t.primary.damage).not.toBe(loadout.primary.damage);
        expect(t.primary.spread).not.toBe(loadout.primary.spread);
        expect(t.primary.recoil).not.toBe(loadout.primary.recoil);
        expect(t.primary.attachmentSlots).not.toBe(loadout.primary.attachmentSlots);
    });

    it('shares nothing with the registry either', () => {
        const t = targets();
        applyEquippedLoadout(profile(), 'TDM', t);
        const registry = WEAPON_DEFS[t.primary.id]!;
        expect(t.primary).not.toBe(registry);
        expect(t.primary.damage).not.toBe(registry.damage);
        const was = registry.damage.near;
        t.primary.damage.near = was + 999;
        expect(registry.damage.near).toBe(was);
    });

    /** A scope is optional, so it is deleted rather than left over from the last class. */
    it('clears a scope the new class does not have', () => {
        const t = targets();
        t.primary.scope = { magnification: 4, glint: false } as never;
        applyEquippedLoadout(profile(), 'TDM', t);
        const hasScope = WEAPON_DEFS[t.primary.id]!.scope !== undefined;
        expect(t.primary.scope === undefined).toBe(!hasScope);
    });

    /** `unrestricted` is the mode's: the range lets a class carry what a match would not. */
    it('asks the mode whether the class is unrestricted', () => {
        const p = profile();
        for (const mode of MODES) {
            const t = targets();
            const loadout = applyEquippedLoadout(p, mode.id, t);
            expect(loadout.primary.id).toBe(p.resolveEquipped(findMode(mode.id).unrestricted).primary.id);
        }
    });

    it('can be applied twice onto the same objects', () => {
        const p = profile();
        const t = targets();
        applyEquippedLoadout(p, 'TDM', t);
        const first = t.primary;
        applyEquippedLoadout(p, 'DOM', t);
        expect(t.primary).toBe(first);
    });
});
