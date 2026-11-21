import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ScoreSystem } from '../shared/combat/ScoreSystem';
import { createGameBus } from '../shared/core/Events';
import { defaultSettings } from '../shared/meta/SaveData';
import { Profile } from './meta/Profile';
import { MatchMeta } from './MatchMeta';

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
 * Characterization tests for the progression half of a match (refactor unit C21, written
 * before the refactor).
 *
 * The four perk hooks are the whole design: a perk does not get a special case anywhere, it
 * sets one number or one predicate on the system that already owns the behaviour. So what is
 * pinned here is that the hooks are applied to the systems handed in, and that `banksProgress`
 * is honoured -- a testbed must not move the account, and the Shooting Range is the one mode
 * where that is false.
 */

// ---------------------------------------------------------------------------- the rig

function spy(): Record<string, unknown> {
    return new Proxy({}, { get: () => () => undefined }) as Record<string, unknown>;
}

interface Rig {
    readonly meta: MatchMeta;
    readonly profile: Profile;
    readonly player: { speedScale: number; sim: Record<string, number> };
    readonly bots: { silentFootsteps: boolean };
    readonly scene: THREE.Scene;
}

function rig(banksProgress = true): Rig {
    const bus = createGameBus();
    const profile = new Profile({ fallbackSettings: defaultSettings('TDM', 'mp_foundry', 90) });
    const scene = new THREE.Scene();
    const player = { speedScale: 1, sim: { x: 0, y: 0, z: 0, eyeHeight: 1.6 } };
    const bots = { silentFootsteps: false };
    const meta = new MatchMeta({
        bus,
        scene,
        profile,
        loadout: profile.resolveEquipped(false),
        score: new ScoreSystem(bus),
        player: player as never,
        playerHealth: { max: 100 } as never,
        weapons: spy() as never,
        bots: bots as never,
        equipment: spy() as never,
        equipmentInventory: {} as never,
        localTeam: 'A' as never,
        localId: 7,
        banksProgress,
    });
    return { meta, profile, player, bots, scene };
}

// ---------------------------------------------------------------------------- what it composes

describe('what it composes', () => {
    it('owns a tracker, a progression, the perks and the field upgrade', () => {
        const r = rig();
        expect(r.meta.tracker).toBeDefined();
        expect(r.meta.progression).toBeDefined();
        expect(r.meta.perks).toBeDefined();
        expect(r.meta.perksRenderer).toBeDefined();
        expect(r.meta.fieldUpgrade).toBeDefined();
    });

    it('puts the perks\u2019 own group in the scene', () => {
        const r = rig();
        expect(r.scene.children.length).toBeGreaterThan(0);
    });

    it('reports a perk state from the first frame', () => {
        expect(rig().meta.state).toBeDefined();
    });
});

// ---------------------------------------------------------------------------- the hooks

describe('the four hooks', () => {
    /**
     * A perk sets one number on the system that already owns the behaviour -- and the default
     * class already carries one, so the number is 1.07 rather than 1. That is the hook
     * working, not a perk-free baseline.
     */
    it('writes the class\u2019s own move speed onto the player', () => {
        const r = rig();
        expect(r.player.speedScale).toBe(r.meta.state.moveSpeedMult);
        expect(r.player.speedScale).toBeCloseTo(1.07, 10);
    });

    /** Null is the hook's "nobody is quiet": a predicate only exists when a perk asks for one. */
    it('hands the bots no footstep predicate without Dead Silence', () => {
        const r = rig();
        expect(r.meta.state.audibleFootsteps).toBe(true);
        expect(r.bots.silentFootsteps).toBeNull();
    });

    it('re-applies them when the class changes', () => {
        const r = rig();
        r.player.speedScale = 99;
        r.meta.setLoadout(r.profile.resolveEquipped(false));
        expect(r.player.speedScale).toBe(r.meta.state.moveSpeedMult);
    });
});

// ---------------------------------------------------------------------------- the frame

describe('per frame', () => {
    it('simulates without a complaint', () => {
        const r = rig();
        expect(() => r.meta.simulate({} as never, { x: 0, y: 0, z: 0 } as never, true)).not.toThrow();
    });

    it('simulates for a dead player too', () => {
        const r = rig();
        expect(() => r.meta.simulate({} as never, { x: 0, y: 0, z: 0 } as never, false)).not.toThrow();
    });

    it('renders without a renderer', () => {
        const r = rig();
        expect(() => r.meta.render(1 / 60)).not.toThrow();
    });

    it('takes a hundred frames', () => {
        const r = rig();
        for (let i = 0; i < 100; i++) {
            r.meta.simulate({} as never, { x: 0, y: 0, z: 0 } as never, true);
            r.meta.render(1 / 60);
        }
        expect(r.meta.state).toBeDefined();
    });
});

// ---------------------------------------------------------------------------- the report

describe('the XP report', () => {
    it('reports the shape the summary screen reads', () => {
        const report = rig().meta.finish(true);
        expect(Object.keys(report).sort()).toEqual([
            'camosUnlocked',
            'challengesCompleted',
            'levelAfter',
            'levelBefore',
            'lines',
            'total',
            'weaponLevelUps',
            'xpBefore',
        ]);
    });

    it('reports a different total for a win and a loss', () => {
        expect(rig().meta.finish(true).total).not.toBe(rig().meta.finish(false).total);
    });

    /**
     * A testbed must not move the account, and that is now what happens rather than what the
     * comment said (BACKLOG #83, fixed 2026-11-22). This case asserted the opposite of the one
     * below it: that a range reported a *loss*, because `finish` forced the won flag down --
     * and then banked the loss, which is what made the forcing look like caution.
     *
     * The report tells the truth about the session now and the account does not move; the
     * summary's XP strip is still hidden for a range, which is correct, because there is no
     * longer any XP to show.
     */
    it('reports a range by what happened in it, and banks none of it', () => {
        const won = rig(true).meta.finish(true);
        const range = rig(false).meta.finish(true);
        expect(range.total).toBe(won.total);
    });

    /**
     * Pins current behaviour; suspected bug: a range match banks XP onto the account.
     *
     * `MatchMeta.finish` says of the range that *"it simply never writes any of it"*, and the
     * path it takes writes all of it: `progression.finish(false, false)` reaches
     * `profile.bankMatch` and `profile.flush()` like any other match, and only the *won* flag
     * is forced down. `Game` then uses `banksProgress` to decide whether to **show** the XP
     * strip -- `banks ? report : null` -- so a Shooting Range session silently moves the
     * account by a loss's worth of XP and the screen says nothing.
     *
     * These are the numbers today. See the backlog entry this opened.
     */
    it('leaves the account where it was for a range, and still reports the total', () => {
        const r = rig(false);
        expect(r.profile.xp).toBe(0);
        const report = r.meta.finish(true);
        expect(report.total).toBeGreaterThan(0);
        expect(r.profile.xp).toBe(0);
    });

    /** Deltas, not totals: two profiles in one test share the save the double gives them. */
    it('banks nothing where a lost match banks its 500', () => {
        const range = rig(false);
        const rangeBefore = range.profile.xp;
        range.meta.finish(true);
        expect(range.profile.xp - rangeBefore).toBe(0);

        // The control, which is what makes the zero above mean something: the same rig that
        // banks does bank, and a loss is what a range used to be paid.
        const lost = rig(true);
        const lostBefore = lost.profile.xp;
        lost.meta.finish(false);
        expect(lost.profile.xp - lostBefore).toBeGreaterThan(0);
    });

    it('starts from the level the profile is on', () => {
        const r = rig();
        const report = r.meta.finish(true);
        expect(report.levelBefore).toBe(r.profile.level);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('disposal', () => {
    it('takes the perks\u2019 group out of the scene', () => {
        const r = rig();
        r.meta.dispose();
        expect(r.scene.children).toHaveLength(0);
    });

    it('is safe twice', () => {
        const r = rig();
        r.meta.dispose();
        r.meta.dispose();
        expect(r.scene.children).toHaveLength(0);
    });
});
