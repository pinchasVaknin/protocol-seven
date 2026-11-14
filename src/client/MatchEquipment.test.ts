import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGameBus } from '../shared/core/Events';
import { PEFlag, type ProjectileState } from '../shared/net/Skirmish';
import { MatchEquipment } from './MatchEquipment';

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
 * Characterization tests for the grenade half of a match (refactor unit C21, written before
 * the refactor).
 *
 * What is pinned is the replication: the server's grenades are adopted **into** the pool the
 * renderer already walks, rather than the renderer being taught a second source -- the same
 * move the objectives, the tags and the bomb make. The local player's own are skipped, because
 * they are predicted and already on screen, and drawing the authoritative copy beside them is
 * the double-render §8.24 is about.
 *
 * Nothing here needs a renderer: the scene is a real `THREE.Scene` and every system under it
 * is the product's own.
 */

// ---------------------------------------------------------------------------- the rig

const LOCAL = 7;

function spy(): Record<string, unknown> {
    return new Proxy({}, { get: () => () => undefined }) as Record<string, unknown>;
}

interface Rig {
    readonly equipment: MatchEquipment;
    readonly scene: THREE.Scene;
}

function rig(): Rig {
    const scene = new THREE.Scene();
    const equipment = new MatchEquipment({
        bus: createGameBus(),
        scene,
        world: spy() as never,
        damage: spy() as never,
        bots: spy() as never,
        audio: spy() as never,
        cameraRig: { camera: new THREE.PerspectiveCamera(), shake: { add: (): void => undefined } } as never,
        hud: spy() as never,
        cfg: {} as never,
        tiers: {} as never,
        localTeam: 'A' as never,
        localId: LOCAL,
        seed: 1234,
        freeForAll: false,
    });
    return { equipment, scene };
}

function state(over: Partial<ProjectileState> = {}): ProjectileState {
    return { serial: 1, kind: 0, ownerId: 99, x: 1, y: 2, z: 3, yaw: 0.5, flags: 0, ...over };
}

/** Every live replicated grenade in the pool. */
function replicated(r: Rig): { serial: number; tx: number; ty: number; tz: number; yaw: number; resting: boolean; phase: string }[] {
    const pool = (r.equipment.system as unknown as { projectiles: { items: Record<string, unknown>[] } }).projectiles;
    return pool.items
        .filter((p) => p['active'] === true && p['replicated'] === true)
        .map((p) => ({
            serial: p['serial'] as number,
            tx: p['tx'] as number,
            ty: p['ty'] as number,
            tz: p['tz'] as number,
            yaw: p['yaw'] as number,
            resting: p['resting'] as boolean,
            phase: p['phase'] as string,
        }));
}

// ---------------------------------------------------------------------------- the pool

describe('what it builds', () => {
    it('starts with nothing replicated in the pool', () => {
        expect(replicated(rig())).toEqual([]);
    });

    it('puts its own objects in the scene', () => {
        const r = rig();
        expect(r.scene.children.length).toBeGreaterThan(0);
    });

    it('survives a simulate with nothing happening', () => {
        const r = rig();
        expect(() => r.equipment.simulate({} as never, { x: 0, y: 0, z: 0, eyeHeight: 1.6 } as never, true)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------- adoption

describe('adopting the server\u2019s grenades', () => {
    it('takes one it has not seen before', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial)).toEqual([5]);
    });

    /** Predicted, already in this pool and already on screen: the authoritative copy is the double. */
    it('skips the local player\u2019s own', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, ownerId: LOCAL })], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    it('takes several at once, keyed by serial', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 1 }), state({ serial: 2 }), state({ serial: 3 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it('adopts a serial once, however many snapshots name it', () => {
        const r = rig();
        for (let i = 0; i < 10; i++) r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        expect(replicated(r)).toHaveLength(1);
    });

    it('ignores a kind the equipment table does not have', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, kind: 999 })], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    /**
     * The *target*, not the drawn position: `easeReplicated` closes the gap over the frames
     * until the next snapshot, so a grenade crosses the room rather than stepping across it
     * twenty times a second.
     */
    it('writes the snapshot into the target rather than the drawn position', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, x: 10, y: 11, z: 12 })], [], LOCAL);
        const [p] = replicated(r);
        expect([p!.tx, p!.ty, p!.tz]).toEqual([10, 11, 12]);
    });

    it('follows a grenade as the server moves it', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, x: 0 })], [], LOCAL);
        r.equipment.applyReplicated([state({ serial: 5, x: 9 })], [], LOCAL);
        expect(replicated(r)[0]!.tx).toBe(9);
        expect(replicated(r)).toHaveLength(1);
    });

    it('carries the spin', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, yaw: 1.25 })], [], LOCAL);
        expect(replicated(r)[0]!.yaw).toBe(1.25);
    });
});

// ---------------------------------------------------------------------------- the flags

describe('the flags on the wire', () => {
    it('reads the resting bit', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: 0 })], [], LOCAL);
        expect(replicated(r)[0]!.resting).toBe(false);
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Resting })], [], LOCAL);
        expect(replicated(r)[0]!.resting).toBe(true);
    });

    it('reads the armed bit as the phase', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: 0 })], [], LOCAL);
        expect(replicated(r)[0]!.phase).toBe('LIVE');
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Armed })], [], LOCAL);
        expect(replicated(r)[0]!.phase).toBe('ARMED');
    });

    it('reads both at once', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Resting | PEFlag.Armed })], [], LOCAL);
        expect(replicated(r)[0]).toMatchObject({ resting: true, phase: 'ARMED' });
    });

    it('ignores a bit it does not read', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Stuck })], [], LOCAL);
        expect(replicated(r)[0]).toMatchObject({ resting: false, phase: 'LIVE' });
    });
});

// ---------------------------------------------------------------------------- release

describe('letting go of what stopped being sent', () => {
    /** The bang arrives as `EV.EquipmentExploded`; this only has to stop drawing the body. */
    it('releases a grenade the server no longer lists', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        expect(replicated(r)).toHaveLength(1);
        r.equipment.applyReplicated([], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    it('releases only the ones that went', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 1 }), state({ serial: 2 })], [], LOCAL);
        r.equipment.applyReplicated([state({ serial: 2 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial)).toEqual([2]);
    });

    it('releases everything for an empty snapshot', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 1 }), state({ serial: 2 }), state({ serial: 3 })], [], LOCAL);
        r.equipment.applyReplicated([], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    it('can take a serial back after releasing it', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        r.equipment.applyReplicated([], [], LOCAL);
        r.equipment.applyReplicated([state({ serial: 5, x: 50 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial)).toEqual([5]);
        expect(replicated(r)[0]!.tx).toBe(50);
    });

    it('is safe with nothing to do at all', () => {
        const r = rig();
        expect(() => r.equipment.applyReplicated([], [], LOCAL)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------- teardown

describe('disposal', () => {
    it('takes its objects out of the scene', () => {
        const r = rig();
        r.equipment.dispose();
        expect(r.scene.children).toHaveLength(0);
    });

    it('is safe twice', () => {
        const r = rig();
        r.equipment.dispose();
        r.equipment.dispose();
        expect(r.scene.children).toHaveLength(0);
    });
});
