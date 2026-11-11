
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOT_CHARACTER_IDS } from '../characters/CharacterCatalog';
import { CharacterAssetService } from '../characters/CharacterAssetService';
import { SKIP_FAST_FORWARD } from '../../shared/ui/SkipGesture';
import { PODIUM_STEPS, PODIUM_X, podiumSlots } from './Lineup';
import { CharacterStage, EDITOR_STAGE, PODIUM_STAGE, STAGE_HEIGHT, STAGE_WIDTH } from './CharacterStage';

/**
 * Characterization tests for the stage (refactor unit C20, written before the refactor).
 *
 * ## Where the GPU boundary is, exactly
 *
 * One method. `tick` ends on `ensureRenderer()` and `renderer.render`, and
 * `new THREE.WebGLRenderer` cannot be built in node -- but **everything before that line has
 * already run by the time it throws**. So `turn` below drives a frame and swallows that one
 * throw, and the idle spin, the fling's decay and the whole walk-in are measured through it.
 * That is a pin and not a workaround: move `ensureRenderer` above the turn and these tests go
 * quiet, which is the signal wanted.
 *
 * What the stage does is read back through `projectToCanvas`, which is deliberately pure lens
 * arithmetic -- *"it needs no renderer and no tick, so it answers on a page that never
 * draws"* -- so a turntable angle is a number here rather than a picture.
 *
 * ## The avatars
 *
 * A figure becomes a body only when its provider is ready, and the provider is
 * `CharacterAssetService`'s, over a repository this file doubles. A repository that never
 * answers leaves the disc empty for good, which is one of the states worth pinning; one that
 * answers gives the real `ActorAvatar` path, which needs a GLB and is the live check's.
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
    readonly stage: CharacterStage;
    readonly canvas: FakeElement;
    /** Every weapon id `preload` was asked for, in order. */
    readonly asked: string[];
    /** The bodies that have been created, in the order the stage created them. */
    readonly bodies: Placed[];
    settle(weaponId: string): void;
    weaponStatus(weaponId: string, to: 'idle' | 'loading' | 'ready' | 'error' | 'none'): void;
}

interface Options {
    readonly podium?: boolean;
    readonly withWeaponAssets?: boolean;
    /** Hand every figure a body at once, so where it stands and what it holds is readable. */
    readonly bodiesArrive?: boolean;
}

/** Where one body was last put, and what it was last handed. */
interface Placed {
    x: number;
    y: number;
    z: number;
    yaw: number;
    visible: boolean;
    weapon: string | null;
    /** How many times `setWeapon` was called on it. */
    weaponWrites: number;
    frames: number;
    disposed: boolean;
}

/** A repository that never answers: no provider is ever ready, so the disc stays empty. */
const QUIET_REPOSITORY = {
    preload: (): Promise<never> => new Promise(() => undefined),
    dispose: (): void => undefined,
} as never;

/**
 * An avatar that records rather than renders.
 *
 * `ActorAvatar` is an interface, and the stage only ever calls four things on one: `update`
 * with a pose and a place, `setWeapon`, `setVisible` and `dispose`. A double of those four is
 * what turns *"the stage did not throw"* into *"bronze stood at x = 1.9 facing 2.933 radians
 * and was handed the carbine once"*, which is the whole of the walk-in and the hand-over.
 */
function recordingProvider(into: Placed[]): {
    readonly isReady: boolean;
    create: () => unknown;
    dispose: () => void;
} {
    return {
        isReady: true,
        create: (): unknown => {
            const placed: Placed = {
                x: Number.NaN,
                y: Number.NaN,
                z: Number.NaN,
                yaw: Number.NaN,
                visible: true,
                weapon: null,
                weaponWrites: 0,
                frames: 0,
                disposed: false,
            };
            into.push(placed);
            return {
                group: { position: { set: (): void => undefined }, rotation: { y: 0 } },
                update: (_pose: unknown, x: number, y: number, z: number, yaw: number): void => {
                    placed.x = x;
                    placed.y = y;
                    placed.z = z;
                    placed.yaw = yaw;
                    placed.frames++;
                },
                setWeapon: (asset: { weaponId: string } | null): void => {
                    placed.weapon = asset?.weaponId ?? null;
                    placed.weaponWrites++;
                },
                setVisible: (on: boolean): void => {
                    placed.visible = on;
                },
                dispose: (): void => {
                    placed.disposed = true;
                },
            };
        },
        dispose: (): void => undefined,
    };
}

function rig(options: Options = {}): Rig {
    const asked: string[] = [];
    const statuses = new Map<string, string>();
    const pending = new Map<string, () => void>();
    const weaponAssets = {
        statusFor: (id: string): string => statuses.get(id) ?? 'idle',
        template: (): null => null,
        preload: (id: string): Promise<void> => {
            asked.push(id);
            return new Promise<void>((resolve) => pending.set(id, resolve));
        },
    };
    const bodies: Placed[] = [];
    const living = { avatarProvider: (): unknown => recordingProvider(bodies) };
    const stage = new CharacterStage(
        {
            characterAssets:
                options.bodiesArrive === true
                    ? (living as never)
                    : new CharacterAssetService(QUIET_REPOSITORY),
            anisotropy: () => 4,
            weaponAssets: options.withWeaponAssets === true ? (weaponAssets as never) : null,
        },
        options.podium === true ? PODIUM_STAGE : EDITOR_STAGE,
    );
    return {
        stage,
        canvas: stage.canvas as unknown as FakeElement,
        bodies,
        asked,
        settle(weaponId) {
            const held = pending.get(weaponId);
            pending.delete(weaponId);
            if (held === undefined) throw new Error(`nothing pending for ${weaponId}`);
            held();
        },
        weaponStatus(weaponId, to) {
            statuses.set(weaponId, to);
        },
    };
}

/** One frame, with the renderer's own throw swallowed. Everything before it has already run. */
function turn(r: Rig, dt: number): void {
    try {
        r.stage.tick(dt);
    } catch (e) {
        expect(String((e as Error).message)).toContain('WebGL');
    }
}

/**
 * Where the turntable is, read through the lens: a point a metre off the axis projects to a
 * different place at every angle, so this is the angle in a number a test can compare.
 */
function reading(r: Rig): number {
    return r.stage.projectToCanvas(1, 1, 0).u;
}

function drag(r: Rig, from: number, to: number, overMs: number, letGoAfterMs = 0): void {
    const at = (x: number, ms: number): Record<string, unknown> => ({ clientX: x, timeStamp: ms, pointerId: 1 });
    fire(r.canvas, 'pointerdown', at(from, 0) as never);
    fire(r.canvas, 'pointermove', at(to, overMs) as never);
    fire(r.canvas, 'pointerup', at(to, overMs + letGoAfterMs) as never);
}

const SKINS = BOT_CHARACTER_IDS;

function lineup(count: number): Parameters<CharacterStage['showLineup']>[0] {
    return podiumSlots(count).map((slot, i) => ({
        characterId: SKINS[i]!,
        weaponId: null,
        x: slot.x,
        y: slot.y,
        z: slot.z,
        yaw: slot.yaw,
    }));
}

// ---------------------------------------------------------------------------- the canvas

describe('the canvas it builds', () => {
    it('is the editor\'s by default, named for a screen reader', () => {
        const r = rig();
        expect(r.canvas.tag).toBe('canvas');
        expect(r.canvas.className).toBe('lo-stage__canvas');
        expect(r.canvas.getAttribute('aria-label')).toBe('Your operator, turning. Drag to turn it yourself.');
    });

    it('is sized in design-frame pixels', () => {
        const r = rig();
        expect(r.canvas.width).toBe(STAGE_WIDTH);
        expect(r.canvas.height).toBe(STAGE_HEIGHT);
        expect([STAGE_WIDTH, STAGE_HEIGHT]).toEqual([860, 734]);
    });

    it('is the debrief\'s when the podium options are given', () => {
        const r = rig({ podium: true });
        expect(r.canvas.className).toBe('dbf-stage__canvas');
        expect(r.canvas.getAttribute('aria-label')).toBe('The three best players of the match, on the podium.');
        expect([r.canvas.width, r.canvas.height]).toEqual([1824, 694]);
    });

    it('mounts itself nowhere: the screen places it', () => {
        expect(rig().canvas.parent).toBeNull();
    });

    it('starts with nothing on it and nothing ready', () => {
        const r = rig();
        expect(r.stage.ready).toBe(false);
        expect(r.stage.flingSpeed).toBe(0);
    });
});

// ---------------------------------------------------------------------------- the two stages

describe('the two stages', () => {
    /** A disc that turns takes a hand; a lineup stands still and takes none. */
    it('listens for a drag on the editor\'s stage', () => {
        expect([...rig().canvas.listeners.keys()].sort()).toEqual([
            'pointercancel',
            'pointerdown',
            'pointermove',
            'pointerup',
        ]);
    });

    it('listens for nothing on the podium', () => {
        expect([...rig({ podium: true }).canvas.listeners.keys()]).toEqual([]);
    });

    /**
     * A body at yaw 0 faces -Z; a stage that opened on the operator's back would open
     * wrong, so the turntable starts at a half turn. Read through the lens: the turn
     * carries a point at +X round to -X, so it projects to the *left* of the canvas.
     */
    it('opens the editor\'s stage on a half turn, facing the lens', () => {
        const r = rig();
        expect(r.stage.projectToCanvas(1, 1, 0).u).toBeLessThan(0.5);
        expect(r.stage.projectToCanvas(-1, 1, 0).u).toBeGreaterThan(0.5);
    });

    it('opens the podium square to the lens, because the figures carry their own yaw', () => {
        const r = rig({ podium: true });
        const left = r.stage.projectToCanvas(-1, 1, 0).u;
        const right = r.stage.projectToCanvas(1, 1, 0).u;
        expect(left + right).toBeCloseTo(1, 9);
    });

    it('builds the podium\'s blocks where Lineup says they go', () => {
        const r = rig({ podium: true });
        for (let rank = 0; rank < PODIUM_X.length; rank++) {
            const onBlock = r.stage.projectToCanvas(PODIUM_X[rank]!, PODIUM_STEPS[rank]!, 0);
            expect(onBlock.u).toBeGreaterThan(0);
            expect(onBlock.u).toBeLessThan(1);
            expect(onBlock.v).toBeGreaterThan(0);
            expect(onBlock.v).toBeLessThan(1);
        }
    });
});

// ---------------------------------------------------------------------------- the lens

describe('projectToCanvas', () => {
    /** Pure lens arithmetic: no renderer, no tick, and it answers on a page that never draws. */
    it('answers with no renderer and no frame ever drawn', () => {
        const at = rig({ podium: true }).stage.projectToCanvas(0, 1, 0);
        expect(at.u).toBeCloseTo(0.5, 9);
        expect(Number.isFinite(at.v)).toBe(true);
    });

    it('puts the axis down the middle of the canvas', () => {
        expect(rig({ podium: true }).stage.projectToCanvas(0, 0, 0).u).toBeCloseTo(0.5, 9);
    });

    it('puts a higher point further up the canvas', () => {
        const r = rig({ podium: true });
        expect(r.stage.projectToCanvas(0, 2, 0).v).toBeLessThan(r.stage.projectToCanvas(0, 0, 0).v);
    });

    it('puts silver to the viewer\'s left of gold and bronze to the right', () => {
        const r = rig({ podium: true });
        const u = PODIUM_X.map((x, i) => r.stage.projectToCanvas(x, PODIUM_STEPS[i]!, 0).u);
        expect(u[1]).toBeLessThan(u[0]!);
        expect(u[2]).toBeGreaterThan(u[0]!);
    });

    it('turns with the turntable', () => {
        const r = rig();
        const before = reading(r);
        turn(r, 1);
        expect(reading(r)).not.toBe(before);
    });

    it('does not turn on the podium, which stands still', () => {
        const r = rig({ podium: true });
        const before = reading(r);
        turn(r, 5);
        expect(reading(r)).toBe(before);
    });
});

// ---------------------------------------------------------------------------- the idle turn

describe('the idle turn', () => {
    it('turns the disc on its own, a tenth of a radian a second', () => {
        const r = rig();
        const before = reading(r);
        turn(r, 1);
        const after = reading(r);
        expect(after).not.toBe(before);
        const second = rig();
        turn(second, 0.5);
        turn(second, 0.5);
        expect(second.stage.projectToCanvas(1, 1, 0).u).toBeCloseTo(after, 9);
    });

    it('does not turn while a hand is on it', () => {
        const r = rig();
        fire(r.canvas, 'pointerdown', { clientX: 100, timeStamp: 0, pointerId: 1 } as never);
        const before = reading(r);
        turn(r, 1);
        expect(reading(r)).toBe(before);
    });

    it('does not turn while a script is holding it', () => {
        const r = rig();
        r.stage.hold(0.4);
        const before = reading(r);
        turn(r, 2);
        expect(reading(r)).toBe(before);
    });
});

// ---------------------------------------------------------------------------- the drag

describe('the drag', () => {
    it('turns the disc by the hand\'s distance', () => {
        const r = rig();
        const before = reading(r);
        fire(r.canvas, 'pointerdown', { clientX: 100, timeStamp: 0, pointerId: 1 } as never);
        fire(r.canvas, 'pointermove', { clientX: 200, timeStamp: 16, pointerId: 1 } as never);
        expect(reading(r)).not.toBe(before);
    });

    it('ignores a move with no press behind it', () => {
        const r = rig();
        const before = reading(r);
        fire(r.canvas, 'pointermove', { clientX: 900, timeStamp: 16, pointerId: 1 } as never);
        expect(reading(r)).toBe(before);
    });

    it('turns the other way for a hand going the other way', () => {
        const right = rig();
        const left = rig();
        fire(right.canvas, 'pointerdown', { clientX: 100, timeStamp: 0, pointerId: 1 } as never);
        fire(right.canvas, 'pointermove', { clientX: 300, timeStamp: 16, pointerId: 1 } as never);
        fire(left.canvas, 'pointerdown', { clientX: 100, timeStamp: 0, pointerId: 1 } as never);
        fire(left.canvas, 'pointermove', { clientX: -100, timeStamp: 16, pointerId: 1 } as never);
        expect(reading(right)).not.toBe(reading(left));
    });

    it('comes back to where it started when the hand goes back', () => {
        const r = rig();
        const before = reading(r);
        fire(r.canvas, 'pointerdown', { clientX: 100, timeStamp: 0, pointerId: 1 } as never);
        fire(r.canvas, 'pointermove', { clientX: 400, timeStamp: 16, pointerId: 1 } as never);
        expect(reading(r)).not.toBe(before);
        fire(r.canvas, 'pointermove', { clientX: 100, timeStamp: 32, pointerId: 1 } as never);
        expect(reading(r)).toBeCloseTo(before, 12);
    });

    it('is cancelled like a release: the hand is off it either way', () => {
        const r = rig();
        fire(r.canvas, 'pointerdown', { clientX: 100, timeStamp: 0, pointerId: 1 } as never);
        fire(r.canvas, 'pointercancel', { clientX: 100, timeStamp: 20, pointerId: 1 } as never);
        // Not dragging any more, so a move after it is ignored.
        const before = reading(r);
        fire(r.canvas, 'pointermove', { clientX: 900, timeStamp: 40, pointerId: 1 } as never);
        expect(reading(r)).toBe(before);
    });

    /**
     * A press that lets go without moving **pauses the disc for about a second**, and it
     * is arithmetic rather than an accident: the release hands over
     * `dragSpeed - IDLE_TURN`, which for a hand that never moved is exactly minus the
     * idle, so the frame's `(IDLE_TURN + spin)` is zero until the fling decays away. A
     * player who taps the operator gets a pause, not a nudge.
     */
    it('pauses the disc when a press lets go without moving', () => {
        const r = rig();
        fire(r.canvas, 'pointerdown', { clientX: 100, timeStamp: 0, pointerId: 1 } as never);
        fire(r.canvas, 'pointerup', { clientX: 100, timeStamp: 20, pointerId: 1 } as never);
        expect(r.stage.flingSpeed).toBeCloseTo(-0.1, 12);
        const before = reading(r);
        turn(r, 0.001);
        expect(reading(r)).toBeCloseTo(before, 9);
        for (let i = 0; i < 180; i++) turn(r, 1 / 60);
        expect(r.stage.flingSpeed).toBe(0);
        const resumed = reading(r);
        turn(r, 1);
        expect(reading(r)).not.toBe(resumed);
    });
});

// ---------------------------------------------------------------------------- the fling

describe('the fling', () => {
    it('keeps the hand\'s speed when it lets go moving', () => {
        const r = rig();
        drag(r, 100, 400, 16);
        expect(r.stage.flingSpeed).toBeGreaterThan(0);
    });

    /** A hand that stopped and then let go has no speed to hand over: the last move is stale. */
    it('hands over nothing when the hand stopped first', () => {
        const r = rig();
        drag(r, 100, 400, 16, 200);
        expect(r.stage.flingSpeed).toBe(0);
    });

    it('takes the stale test at eighty milliseconds', () => {
        const quick = rig();
        drag(quick, 100, 400, 16, 79);
        expect(quick.stage.flingSpeed).toBeGreaterThan(0);
        const slow = rig();
        drag(slow, 100, 400, 16, 81);
        expect(slow.stage.flingSpeed).toBe(0);
    });

    it('clamps a pointer that jumped the canvas in one event', () => {
        const r = rig();
        drag(r, 0, 100000, 1);
        expect(r.stage.flingSpeed).toBe(12);
    });

    /** `exp(-2.2 t)`: a 12 rad/s fling is 7.7284 after a fifth of a second. */
    it('decays as the damping says, frame by frame', () => {
        const r = rig();
        drag(r, 0, 100000, 1);
        turn(r, 0.1);
        turn(r, 0.1);
        expect(r.stage.flingSpeed).toBeCloseTo(12 * Math.exp(-2.2 * 0.2), 9);
    });

    /** The comment's own worked example: a 6 rad/s fling is under the idle in about 1.9 s. */
    it('is under the idle rate in about one and nine tenths seconds', () => {
        expect(6 * Math.exp(-2.2 * 1.9)).toBeLessThan(0.1);
        expect(6 * Math.exp(-2.2 * 1.7)).toBeGreaterThan(0.1);
        const r = rig();
        drag(r, 0, 10000, 1);
        for (let i = 0; i < 180; i++) turn(r, 1 / 60);
        expect(Math.abs(r.stage.flingSpeed)).toBeLessThan(0.1);
    });

    it('stops dead rather than crawling for ever', () => {
        const r = rig();
        drag(r, 0, 10000, 1);
        for (let i = 0; i < 300; i++) turn(r, 1 / 60);
        expect(r.stage.flingSpeed).toBe(0);
    });

    /** Thrown against the idle direction it decays through zero and the idle takes over. */
    it('can be thrown backwards and lets the idle win in the end', () => {
        const r = rig();
        drag(r, 10000, 0, 1);
        expect(r.stage.flingSpeed).toBeLessThan(0);
        for (let i = 0; i < 300; i++) turn(r, 1 / 60);
        expect(r.stage.flingSpeed).toBe(0);
        const before = reading(r);
        turn(r, 1);
        expect(reading(r)).not.toBe(before);
    });

    it('a fresh press throws away whatever was left of the last fling', () => {
        const r = rig();
        drag(r, 0, 10000, 1);
        expect(r.stage.flingSpeed).toBe(12);
        fire(r.canvas, 'pointerdown', { clientX: 10, timeStamp: 500, pointerId: 1 } as never);
        expect(r.stage.flingSpeed).toBe(0);
    });

    /** The gesture's own fast-forward is six; the fling's clamp is twelve. Two numbers, two jobs. */
    it('clamps at twice the timeline fast-forward, which is a different number', () => {
        expect(SKIP_FAST_FORWARD).toBe(6);
        const r = rig();
        drag(r, 0, 100000, 1);
        expect(r.stage.flingSpeed).toBe(2 * SKIP_FAST_FORWARD);
    });
});

// ---------------------------------------------------------------------------- holding

describe('holding it still', () => {
    it('puts the turntable at the angle it is given', () => {
        const a = rig();
        const b = rig();
        a.stage.hold(0);
        b.stage.hold(Math.PI);
        expect(reading(a)).not.toBe(reading(b));
    });

    it('throws away a fling', () => {
        const r = rig();
        drag(r, 0, 10000, 1);
        r.stage.hold(0.3);
        expect(r.stage.flingSpeed).toBe(0);
    });

    /** Closer for a portrait: the stage's own distance leaves a thumbnail half air. */
    it('brings the lens in for a thumbnail', () => {
        const far = rig();
        const near = rig();
        far.stage.hold(0, 4.4);
        near.stage.hold(0, 3.0);
        const wide = Math.abs(far.stage.projectToCanvas(1, 1, 0).u - 0.5);
        const tight = Math.abs(near.stage.projectToCanvas(1, 1, 0).u - 0.5);
        expect(tight).toBeGreaterThan(wide);
    });

    it('leaves the stage held through any number of frames', () => {
        const r = rig();
        r.stage.hold(0.75);
        const before = reading(r);
        for (let i = 0; i < 60; i++) turn(r, 1 / 60);
        expect(reading(r)).toBe(before);
    });
});

// ---------------------------------------------------------------------------- the figures

describe('the figures', () => {
    it('is not ready with nothing asked for', () => {
        expect(rig().stage.ready).toBe(false);
    });

    it('is not ready while a skin is still loading', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        turn(r, 0.016);
        expect(r.stage.ready).toBe(false);
    });

    it('takes a lineup of three', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        expect(r.stage.ready).toBe(false);
    });

    it('replaces whatever was on the stage', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        r.stage.showLineup(lineup(1));
        expect(r.stage.ready).toBe(false);
    });

    it('takes one skin through the one-figure door', () => {
        const r = rig();
        r.stage.show(SKINS[0]!);
        expect(r.stage.ready).toBe(false);
    });

    it('ignores a second show of the skin already asked for', () => {
        const r = rig();
        r.stage.show(SKINS[0]!);
        r.stage.show(SKINS[0]!);
        expect(r.stage.ready).toBe(false);
    });

    it('empties the stage on release', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        r.stage.release();
        expect(r.stage.ready).toBe(false);
    });

    it('leaves the disc empty for good when no skin ever arrives', () => {
        const r = rig();
        r.stage.show(SKINS[0]!);
        for (let i = 0; i < 120; i++) turn(r, 1 / 60);
        expect(r.stage.ready).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the walk-in

describe('the walk-in', () => {
    /** `back / WALK_IN_SPEED` seconds each, the last figure first, `stagger` apart. */
    it('says how long the whole entrance takes', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        expect(r.stage.walkIn(2.4, 0.3)).toBeCloseTo(2 * 0.3 + 2.4 / 2.4, 9);
    });

    it('is one walk long for one figure', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(1));
        expect(r.stage.walkIn(2.4, 0.3)).toBeCloseTo(1, 9);
    });

    it('scales with how far back they start', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        expect(r.stage.walkIn(4.8, 0)).toBeCloseTo(2, 9);
    });

    it('is nothing at all with nobody on the stage', () => {
        const r = rig({ podium: true });
        expect(r.stage.walkIn(2.4, 0.3)).toBeCloseTo(-0.3 + 1, 9);
    });

    it('can be settled at once: every figure on its mark', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        r.stage.walkIn(2.4, 0.3);
        r.stage.settle();
        for (let i = 0; i < 10; i++) turn(r, 1 / 60);
        expect(r.stage.ready).toBe(false);
    });

    it('settles safely with nobody walking', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        r.stage.settle();
        expect(r.stage.ready).toBe(false);
    });

    it('runs the clock through the frames, and ends', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        const until = r.stage.walkIn(2.4, 0.3);
        for (let i = 0; i < Math.ceil(until * 60) + 10; i++) turn(r, 1 / 60);
        expect(r.stage.ready).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the weapon

describe('the weapon in its hands', () => {
    it('is held before a skin is asked for, and kept for it', () => {
        const r = rig();
        r.stage.setWeapon('ar_carbine', null, []);
        r.stage.show(SKINS[0]!);
        expect(r.stage.ready).toBe(false);
    });

    it('is set after a skin just as well', () => {
        const r = rig();
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, []);
        expect(r.stage.ready).toBe(false);
    });

    it('ignores a setting that has not changed', () => {
        const r = rig({ withWeaponAssets: true });
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, ['optic_reflex']);
        const asked = r.asked.length;
        r.stage.setWeapon('ar_carbine', null, ['optic_reflex']);
        expect(r.asked).toHaveLength(asked);
    });

    /**
     * Reordering the same attachments is not a change, and the body must not be handed its
     * weapon again for it -- which is only visible once there is a body to hand it to.
     */
    it('reads attachments as a set, not as a list', () => {
        const r = rig({ bodiesArrive: true });
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, ['optic_reflex', 'mag_extended']);
        turn(r, 1 / 60);
        const writes = r.bodies[0]!.weaponWrites;
        r.stage.setWeapon('ar_carbine', null, ['mag_extended', 'optic_reflex']);
        expect(r.bodies[0]!.weaponWrites).toBe(writes);
        r.stage.setWeapon('ar_carbine', null, ['mag_extended']);
        expect(r.bodies[0]!.weaponWrites).toBe(writes + 1);
    });

    it('empties the hands for null', () => {
        const r = rig();
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, []);
        r.stage.setWeapon(null);
        expect(r.stage.ready).toBe(false);
    });

    it('asks for the file once per weapon, however many figures hold it', () => {
        const r = rig({ withWeaponAssets: true });
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, []);
        expect(r.asked).toEqual(['ar_carbine']);
    });

    it('asks for nothing when there is no asset service', () => {
        const r = rig();
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, []);
        expect(r.asked).toEqual([]);
    });

    it('asks for nothing for an id the catalogue has no file for', () => {
        const r = rig({ withWeaponAssets: true });
        r.weaponStatus('not_a_weapon', 'none');
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('not_a_weapon', null, []);
        expect(r.asked).toEqual([]);
    });

    /** A finish is its own asset: the same weapon in two camos is two entries. */
    it('keys the asset on the weapon, the finish and the attachments', () => {
        const r = rig({ withWeaponAssets: true });
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, []);
        r.stage.setWeapon('ar_carbine', 'tiger', []);
        r.stage.setWeapon('ar_carbine', 'tiger', ['optic_reflex']);
        expect(r.asked).toEqual(['ar_carbine', 'ar_carbine', 'ar_carbine']);
    });

    it('carries the lineup\'s own weapons rather than the one-figure setting', () => {
        const r = rig({ podium: true, withWeaponAssets: true });
        r.stage.setWeapon('ar_carbine', null, []);
        r.stage.showLineup([
            { characterId: SKINS[0]!, weaponId: 'smg_wasp', x: 0, z: 0, yaw: Math.PI },
            { characterId: SKINS[1]!, weaponId: null, x: -1.9, z: 0, yaw: Math.PI },
        ]);
        expect(r.asked).toEqual(['smg_wasp']);
    });
});

// ---------------------------------------------------------------------------- the bodies

describe('the bodies, once they arrive', () => {
    it('adopts one body per figure, on the first frame after they are asked for', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        expect(r.bodies).toHaveLength(0);
        turn(r, 1 / 60);
        expect(r.bodies).toHaveLength(3);
        expect(r.stage.ready).toBe(true);
    });

    it('adopts each body once, however many frames run', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        for (let i = 0; i < 20; i++) turn(r, 1 / 60);
        expect(r.bodies).toHaveLength(3);
    });

    /** Gold centre on the tallest block, silver to the viewer's left, bronze to the right. */
    it('stands each body where Lineup says, on the block of its own height', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        const slots = podiumSlots(3);
        r.bodies.forEach((body, rank) => {
            expect(body.x).toBeCloseTo(slots[rank]!.x, 12);
            expect(body.y).toBeCloseTo(slots[rank]!.y, 12);
            expect(body.z).toBeCloseTo(slots[rank]!.z, 12);
            expect(body.yaw).toBeCloseTo(slots[rank]!.yaw, 12);
        });
    });

    it('puts every body on its mark on every frame, so its own speed reads zero', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        for (let i = 0; i < 10; i++) turn(r, 1 / 60);
        for (const body of r.bodies) {
            expect(body.frames).toBeGreaterThan(5);
            expect(body.x).toBeCloseTo(podiumSlots(3)[r.bodies.indexOf(body)]!.x, 12);
        }
    });

    it('hands each body the weapon its figure carries', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup([
            { characterId: SKINS[0]!, weaponId: 'ar_carbine', x: 0, z: 0, yaw: Math.PI },
            { characterId: SKINS[1]!, weaponId: null, x: -1.9, z: 0, yaw: Math.PI },
        ]);
        turn(r, 1 / 60);
        expect(r.bodies.map((b) => b.weapon)).toEqual(['ar_carbine', null]);
    });

    it('throws every body away when the stage is released', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        r.stage.release();
        expect(r.bodies.map((b) => b.disposed)).toEqual([true, true, true]);
        expect(r.stage.ready).toBe(false);
    });

    it('throws them away on a new lineup too', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        r.stage.showLineup(lineup(1));
        expect(r.bodies.slice(0, 3).every((b) => b.disposed)).toBe(true);
        turn(r, 1 / 60);
        expect(r.bodies).toHaveLength(4);
    });
});

// ---------------------------------------------------------------------------- the walk, seen

describe('the walk-in, with bodies on the stage', () => {
    /** The last figure first and the first last, so the podium fills bronze, silver, gold. */
    it('starts the last figure first and the first last', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        r.stage.walkIn(2.4, 0.3);
        turn(r, 1 / 60);
        expect(r.bodies.map((b) => b.visible)).toEqual([false, false, true]);
    });

    it('brings each of them in at its own moment', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        r.stage.walkIn(2.4, 0.3);
        for (let i = 0; i < 20; i++) turn(r, 1 / 60);
        expect(r.bodies.map((b) => b.visible)).toEqual([false, true, true]);
        for (let i = 0; i < 20; i++) turn(r, 1 / 60);
        expect(r.bodies.map((b) => b.visible)).toEqual([true, true, true]);
    });

    /** A body starts `back` metres behind its mark and walks onto it, facing the lens. */
    it('starts each body behind its mark and walks it on', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        r.stage.walkIn(2.4, 0);
        turn(r, 1 / 60);
        const gold = r.bodies[0]!;
        expect(gold.z).toBeLessThan(-2);
        expect(gold.yaw).toBeCloseTo(Math.PI, 9);
        for (let i = 0; i < 70; i++) turn(r, 1 / 60);
        expect(gold.z).toBeCloseTo(0, 6);
        expect(gold.yaw).toBeCloseTo(podiumSlots(3)[0]!.yaw, 6);
    });

    it('never walks a body past its mark', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        r.stage.walkIn(2.4, 0);
        for (let i = 0; i < 200; i++) {
            turn(r, 1 / 60);
            for (const body of r.bodies) expect(body.z).toBeLessThanOrEqual(1e-9);
        }
    });

    /**
     * One speed for most of the way -- a walk has one speed -- and the last fifth eased
     * to a stop. Measured **while the body is still walking**, because every curve is
     * flat once the walk is over and a test that included the end would pass on a
     * straight line too.
     */
    it('walks at one speed and eases only the last fifth of the way', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(1));
        turn(r, 1 / 60);
        r.stage.walkIn(2.4, 0);
        const steps: number[] = [];
        let last = Number.NaN;
        for (let i = 0; i < 60; i++) {
            turn(r, 1 / 60);
            const z = r.bodies[0]!.z;
            if (!Number.isNaN(last) && z < -1e-6) steps.push(z - last);
            last = z;
        }
        expect(steps.length).toBeGreaterThan(40);
        // The flat stretch: every step the same, to twelve places.
        const cruise = steps.slice(5, 40);
        for (const step of cruise) expect(step).toBeCloseTo(cruise[0]!, 12);
        // And the tail, slower than the cruise and still going forward.
        const tail = steps[steps.length - 1]!;
        expect(tail).toBeLessThan(cruise[0]! * 0.9);
        expect(tail).toBeGreaterThan(0);
    });

    it('settles every body onto its mark at once, visible', () => {
        const r = rig({ podium: true, bodiesArrive: true });
        r.stage.showLineup(lineup(3));
        turn(r, 1 / 60);
        r.stage.walkIn(2.4, 0.3);
        turn(r, 1 / 60);
        r.stage.settle();
        turn(r, 1 / 60);
        expect(r.bodies.map((b) => b.visible)).toEqual([true, true, true]);
        r.bodies.forEach((body, rank) => expect(body.z).toBeCloseTo(podiumSlots(3)[rank]!.z, 12));
    });
});

// ---------------------------------------------------------------------------- the file lands

describe('a weapon file landing', () => {
    /**
     * *"Every weapon is grey until I move something"* (playtest 5, finding 5): the swap used
     * to match on the **figure's** weapon, so the editor's operator -- whose weapon came from
     * `setWeapon` and never touched its figure -- kept the primitives until a skin change
     * rebuilt it. It matches on what the body is holding now.
     */
    it('hands the file to a body whose weapon came from setWeapon, not from its figure', async () => {
        const r = rig({ bodiesArrive: true, withWeaponAssets: true });
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('ar_carbine', null, []);
        turn(r, 1 / 60);
        const writes = r.bodies[0]!.weaponWrites;
        expect(r.asked).toEqual(['ar_carbine']);
        r.settle('ar_carbine');
        await Promise.resolve();
        await Promise.resolve();
        expect(r.bodies[0]!.weaponWrites).toBeGreaterThan(writes);
        expect(r.bodies[0]!.weapon).toBe('ar_carbine');
    });

    it('leaves a body holding something else alone', async () => {
        const r = rig({ bodiesArrive: true, withWeaponAssets: true });
        r.stage.show(SKINS[0]!);
        r.stage.setWeapon('smg_wasp', null, []);
        turn(r, 1 / 60);
        const writes = r.bodies[0]!.weaponWrites;
        r.settle('smg_wasp');
        await Promise.resolve();
        await Promise.resolve();
        expect(r.bodies[0]!.weapon).toBe('smg_wasp');
        expect(r.bodies[0]!.weaponWrites).toBeGreaterThan(writes);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('release and dispose', () => {
    it('release empties the stage and can be done twice', () => {
        const r = rig({ podium: true });
        r.stage.showLineup(lineup(3));
        r.stage.release();
        r.stage.release();
        expect(r.stage.ready).toBe(false);
    });

    it('dispose takes the canvas out of the document', () => {
        const host = new FakeElement('div');
        const r = rig();
        host.appendChild(r.canvas);
        r.stage.dispose();
        expect(host.children).toHaveLength(0);
    });

    it('dispose is safe twice', () => {
        const r = rig();
        r.stage.show(SKINS[0]!);
        r.stage.dispose();
        r.stage.dispose();
        expect(r.stage.ready).toBe(false);
    });

    it('dispose is safe on a stage that never ticked', () => {
        const r = rig({ podium: true });
        r.stage.dispose();
        expect(r.stage.ready).toBe(false);
    });

    it('can still be read through the lens after a dispose', () => {
        const r = rig({ podium: true });
        const before = r.stage.projectToCanvas(0, 1, 0).u;
        r.stage.dispose();
        expect(r.stage.projectToCanvas(0, 1, 0).u).toBe(before);
    });
});
