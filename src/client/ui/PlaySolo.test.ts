
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOT_DIFFICULTIES } from '../../shared/ai/DifficultyTiers';
import { MAPS, MODES, modesForMap } from '../../shared/modes/ModeRegistry';
import { paintPlaySolo, testbedMode, type PlaySoloDeps } from './PlaySolo';

/**
 * Characterization tests for the Play Solo page (refactor unit C19, written before the
 * refactor).
 *
 * The page is a module of pure painters: `paintPlaySolo` hands back a root and the element to
 * focus, and every click goes out through `deps`. So the whole surface is one call and a tree
 * walk, and what is pinned here is the structure the reference drew -- two columns and a bar,
 * `01 MAP` / `02 GAME MODE` / `03 BOT DIFFICULTY`, the pager's wrap-around, the TESTBED
 * plate's two doors -- together with what the testbed locks and what it says instead.
 *
 * The maps, the modes and the difficulty tiers are the registry's own, read through it rather
 * than restated, so a sixth mode or a fifth map does not make these tests lie. Only the
 * document is a double.
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

interface Calls {
    readonly maps: string[];
    readonly modes: string[];
    readonly diffs: string[];
    readonly launches: number[];
    readonly rangeClasses: number[];
    readonly backs: number[];
    /** Every call in one list, in the order it arrived -- the plate's order is load-bearing. */
    readonly order: string[];
}

interface Rig {
    readonly root: FakeElement;
    readonly focus: FakeElement;
    readonly calls: Calls;
}

const REAL_MAPS = MAPS.filter((m) => !m.testbed);
const TESTBED = MAPS.find((m) => m.testbed)!;
/** The modes that are cards: the range is the testbed's door, not one of them. */
const CARD_MODES = MODES.filter((m) => m.forcedMapId === null);

function paint(mapId = 'mp_foundry', modeId = 'TDM', difficulty = 'REGULAR'): Rig {
    const calls: Calls = { maps: [], modes: [], diffs: [], launches: [], rangeClasses: [], backs: [], order: [] };
    const deps: PlaySoloDeps = {
        selection: { modeId, mapId, difficulty } as never,
        onPickMap: (id) => {
            calls.maps.push(id);
            calls.order.push(`map:${id}`);
        },
        onPickMode: (id) => {
            calls.modes.push(id);
            calls.order.push(`mode:${id}`);
        },
        onPickDifficulty: (d) => {
            calls.diffs.push(d);
            calls.order.push(`diff:${d}`);
        },
        onLaunch: () => {
            calls.launches.push(1);
            calls.order.push('launch');
        },
        onRangeClass: () => {
            calls.rangeClasses.push(1);
            calls.order.push('range-class');
        },
        onBack: () => {
            calls.backs.push(1);
            calls.order.push('back');
        },
    };
    const out = paintPlaySolo(deps);
    return { root: out.root as unknown as FakeElement, focus: out.focus as unknown as FakeElement, calls };
}

function find(root: FakeElement, token: string): FakeElement {
    const hit = root.querySelector(`.${token}`);
    if (hit === null) throw new Error(`no .${token}`);
    return hit;
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    return root.querySelectorAll(`.${token}`);
}

function textOf(root: FakeElement, token: string): string {
    return find(root, token).textContent;
}

/** The three `ps-sec` blocks of the right column, in order. */
function sections(r: Rig): FakeElement[] {
    return findAll(r.root, 'ps-sec');
}

function click(el: FakeElement): void {
    fire(el, 'click');
}

// ---------------------------------------------------------------------------- the shape

describe('the page it paints', () => {
    it('is a section with two columns and a bar', () => {
        const r = paint();
        expect(r.root.tag).toBe('section');
        expect(r.root.className).toBe('ps');
        expect(r.root.children.map((c) => c.className)).toEqual([
            'ps-left',
            'ps-right',
            'op-actionbar ps-bar',
        ]);
    });

    it('focuses START MATCH: the one button that starts a match', () => {
        const r = paint();
        expect(r.focus.className).toBe('op-cta op-cta--primary ps-launch');
        expect(r.focus.children[1]!.textContent).toBe('START MATCH');
    });

    it('is not the testbed on a real map', () => {
        expect(paint().root.classList.contains('ps--testbed')).toBe(false);
    });

    it('is the testbed on the greybox', () => {
        expect(paint(TESTBED.id, 'RANGE').root.classList.contains('ps--testbed')).toBe(true);
    });

    it('falls back to the first mode when the selection names none of them', () => {
        const r = paint('mp_foundry', 'NOPE');
        expect(textOf(r.root, 'ps-fact__value')).toBe('FOUNDRY');
        expect(findAll(r.root, 'ps-fact__value')[1]!.textContent).toBe(MODES[0]!.name);
    });
});

// ---------------------------------------------------------------------------- the hero

describe('the hero', () => {
    it('shows the chosen map large, with its own picture', () => {
        const r = paint('mp_dunes');
        expect(find(r.root, 'ps-hero__img').src).toBe('/maps/mp_dunes.jpg');
        expect(textOf(r.root, 'ps-hero__name')).toBe('DUNES');
        expect(textOf(r.root, 'ps-hero__tagline')).toBe('DESERT VILLAGE // THREE-LANE');
    });

    it('calls a real map a combat map and the greybox a training map', () => {
        expect(textOf(paint('mp_foundry').root, 'ps-hero__label')).toBe('COMBAT MAP');
        expect(textOf(paint(TESTBED.id).root, 'ps-hero__label')).toBe('TRAINING MAP');
    });

    it('draws every tag the map has, each with its mark', () => {
        const r = paint('mp_depot');
        const tags = findAll(r.root, 'ps-tag');
        expect(tags.map((t) => t.children[1]!.textContent)).toEqual(['MIXED RANGE', 'MEDIUM SIZE', 'DENSE COVER']);
        for (const tag of tags) expect(tag.children[0]!.className).toBe('ps-tag__mark');
    });

    it('never lets the hero picture be dragged', () => {
        const r = paint();
        expect(find(r.root, 'ps-hero__img').draggable).toBe(false);
        expect(find(r.root, 'ps-hero__img').alt).toBe('');
    });

    it('lays the shade and the pager over the picture, the body last', () => {
        const r = paint();
        expect(find(r.root, 'ps-hero').children.map((c) => c.className)).toEqual([
            'ps-hero__img',
            'ps-hero__shade',
            'ps-pager',
            'ps-hero__body',
        ]);
    });
});

// ---------------------------------------------------------------------------- the pager

describe('the pager', () => {
    it('counts the chosen map out of all of them, padded to two digits', () => {
        expect(textOf(paint('mp_foundry').root, 'ps-pager__count')).toBe(`01 / ${String(MAPS.length).padStart(2, '0')}`);
        expect(textOf(paint('mp_depot').root, 'ps-pager__count')).toBe(`03 / ${String(MAPS.length).padStart(2, '0')}`);
    });

    it('steps forward to the next map', () => {
        const r = paint('mp_foundry');
        click(findAll(r.root, 'ps-pager__arrow')[1]!);
        expect(r.calls.maps).toEqual(['mp_dunes']);
    });

    it('steps back to the previous map', () => {
        const r = paint('mp_dunes');
        click(findAll(r.root, 'ps-pager__arrow')[0]!);
        expect(r.calls.maps).toEqual(['mp_foundry']);
    });

    it('wraps round at both ends', () => {
        const first = paint(MAPS[0]!.id);
        click(findAll(first.root, 'ps-pager__arrow')[0]!);
        expect(first.calls.maps).toEqual([MAPS[MAPS.length - 1]!.id]);
        const last = paint(MAPS[MAPS.length - 1]!.id);
        click(findAll(last.root, 'ps-pager__arrow')[1]!);
        expect(last.calls.maps).toEqual([MAPS[0]!.id]);
    });

    it('names both arrows for a screen reader and for a hover', () => {
        const r = paint();
        const [prev, next] = findAll(r.root, 'ps-pager__arrow');
        expect(prev!.title).toBe('Previous map');
        expect(prev!.getAttribute('aria-label')).toBe('Previous map');
        expect(next!.title).toBe('Next map');
        expect(next!.getAttribute('aria-label')).toBe('Next map');
    });

    it('gives each arrow a glyph, and the two are not the same one', () => {
        const r = paint();
        const glyphs = findAll(r.root, 'ps-pager__glyph');
        expect(glyphs).toHaveLength(2);
        expect(glyphs[0]!.children[0]!.getAttribute('d')).not.toBe(glyphs[1]!.children[0]!.getAttribute('d'));
    });
});

// ---------------------------------------------------------------------------- the strip

describe('the maps strip', () => {
    it('is one card per map, under a MAPS label', () => {
        const r = paint();
        expect(textOf(r.root, 'ps-sec__label')).toBe('MAPS');
        expect(findAll(r.root, 'ps-card')).toHaveLength(MAPS.length);
    });

    it('is a listbox with every card an option', () => {
        const r = paint();
        const strip = find(r.root, 'ps-maps__strip');
        expect(strip.getAttribute('role')).toBe('listbox');
        expect(strip.getAttribute('aria-label')).toBe('Maps');
        for (const card of findAll(r.root, 'ps-card')) expect(card.getAttribute('role')).toBe('option');
    });

    it('marks the chosen card, and only it', () => {
        const r = paint('mp_depot');
        const cards = findAll(r.root, 'ps-card');
        expect(cards.map((c) => c.classList.contains('is-on'))).toEqual([false, false, true, false]);
        expect(cards.map((c) => c.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false']);
    });

    it('badges the greybox card and no other', () => {
        const r = paint();
        const cards = findAll(r.root, 'ps-card');
        expect(cards.map((c) => c.classList.contains('ps-card--testbed'))).toEqual([false, false, false, true]);
        expect(findAll(r.root, 'ps-card__badge')).toHaveLength(1);
    });

    it('names every map on its card and shows its picture', () => {
        const r = paint();
        expect(findAll(r.root, 'ps-card__name').map((n) => n.textContent)).toEqual(MAPS.map((m) => m.name));
        expect(findAll(r.root, 'ps-card__img').map((i) => i.src)).toEqual(MAPS.map((m) => m.picture));
    });

    it('picks the map the card is for', () => {
        const r = paint();
        click(findAll(r.root, 'ps-card')[2]!);
        expect(r.calls.maps).toEqual(['mp_depot']);
    });

    it('offers the greybox from the strip as well as from the plate', () => {
        const r = paint();
        click(findAll(r.root, 'ps-card')[3]!);
        expect(r.calls.maps).toEqual([TESTBED.id]);
        expect(r.calls.launches).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- 01 MAP

describe('01 MAP', () => {
    it('is the first numbered section', () => {
        const r = paint();
        const sec = sections(r)[0]!;
        expect(find(sec, 'ps-sec__num').textContent).toBe('01');
        expect(find(sec, 'ps-sec__label').textContent).toBe('MAP');
    });

    it('is a row naming the chosen map, that steps to the next one', () => {
        const r = paint('mp_dunes');
        const row = find(r.root, 'ps-maprow');
        expect(row.title).toBe('Next map');
        expect(find(row, 'ps-maprow__name').textContent).toBe('DUNES');
        expect(find(row, 'ps-maprow__img').src).toBe('/maps/mp_dunes.jpg');
        click(row);
        expect(r.calls.maps).toEqual(['mp_depot']);
    });

    it('wraps the row round the end of the list', () => {
        const r = paint(MAPS[MAPS.length - 1]!.id);
        click(find(r.root, 'ps-maprow'));
        expect(r.calls.maps).toEqual([MAPS[0]!.id]);
    });

    it('is never locked, not even on the testbed', () => {
        const r = paint(TESTBED.id, 'RANGE');
        expect(sections(r)[0]!.classList.contains('is-locked')).toBe(false);
    });
});

// ---------------------------------------------------------------------------- 02 GAME MODE

describe('02 GAME MODE', () => {
    it('is a card per mode, the range excluded', () => {
        const r = paint();
        const cards = findAll(find(r.root, 'ps-cards--modes'), 'ps-opt');
        expect(cards).toHaveLength(CARD_MODES.length);
        expect(findAll(find(r.root, 'ps-cards--modes'), 'ps-opt__name').map((n) => n.textContent)).toEqual(
            CARD_MODES.map((m) => m.name),
        );
    });

    it('is a listbox, and marks the chosen mode', () => {
        const r = paint('mp_foundry', 'KC');
        const modes = find(r.root, 'ps-cards--modes');
        expect(modes.getAttribute('role')).toBe('listbox');
        expect(modes.getAttribute('aria-label')).toBe('Game mode');
        const on = findAll(modes, 'ps-opt').filter((c) => c.classList.contains('is-on'));
        expect(on).toHaveLength(1);
        expect(find(on[0]!, 'ps-opt__name').textContent).toBe('KILL CONFIRMED');
    });

    it('carries each mode its own blurb as a hover', () => {
        const r = paint();
        const titles = findAll(find(r.root, 'ps-cards--modes'), 'ps-opt').map((c) => c.title);
        expect(titles).toEqual(CARD_MODES.map((m) => m.blurb));
        expect(new Set(titles).size).toBe(titles.length);
    });

    it('picks the mode the card is for', () => {
        const r = paint();
        click(findAll(find(r.root, 'ps-cards--modes'), 'ps-opt')[1]!);
        expect(r.calls.modes).toEqual([CARD_MODES[1]!.id]);
    });

    it('disables a mode the map cannot hold', () => {
        const r = paint('mp_foundry');
        const playable = new Set(modesForMap('mp_foundry').map((m) => m.id));
        const cards = findAll(find(r.root, 'ps-cards--modes'), 'ps-opt');
        cards.forEach((card, i) => {
            expect(card.disabled).toBe(!playable.has(CARD_MODES[i]!.id));
        });
    });

    it('locks the whole section on the testbed, and says why', () => {
        const r = paint(TESTBED.id, 'RANGE');
        const sec = sections(r)[1]!;
        expect(sec.classList.contains('is-locked')).toBe(true);
        expect(find(sec, 'ps-sec__note').textContent).toBe('SHOOTING RANGE ONLY');
        for (const card of findAll(sec, 'ps-opt')) expect(card.disabled).toBe(true);
    });

    it('has no note at all on a real map', () => {
        const r = paint();
        expect(sections(r)[1]!.querySelector('.ps-sec__note')).toBeNull();
    });
});

// ---------------------------------------------------------------------------- 03 DIFFICULTY

describe('03 BOT DIFFICULTY', () => {
    it('is a card per tier, in the registry\'s order', () => {
        const r = paint();
        const names = findAll(find(r.root, 'ps-cards--diffs'), 'ps-opt__name').map((n) => n.textContent);
        expect(names).toHaveLength(BOT_DIFFICULTIES.length);
        expect(names[0]).toBe('RECRUIT');
        expect(names[names.length - 1]).toBe('MIXED');
    });

    it('marks the chosen tier and puts its line beneath', () => {
        const r = paint('mp_foundry', 'TDM', 'VETERAN');
        const on = findAll(find(r.root, 'ps-cards--diffs'), 'ps-opt').filter((c) => c.classList.contains('is-on'));
        expect(on).toHaveLength(1);
        expect(find(on[0]!, 'ps-opt__name').textContent).toBe('VETERAN');
        expect(textOf(r.root, 'ps-blurb')).toBe('Short controlled bursts, leads a moving target, grenades often.');
    });

    it('picks the tier the card is for', () => {
        const r = paint();
        click(findAll(find(r.root, 'ps-cards--diffs'), 'ps-opt')[3]!);
        expect(r.calls.diffs).toEqual([BOT_DIFFICULTIES[3]]);
    });

    it('enables every tier on a real map', () => {
        const r = paint();
        for (const card of findAll(find(r.root, 'ps-cards--diffs'), 'ps-opt')) expect(card.disabled).toBe(false);
    });

    it('locks the section on the testbed and explains that there is nobody to describe', () => {
        const r = paint(TESTBED.id, 'RANGE');
        const sec = sections(r)[2]!;
        expect(sec.classList.contains('is-locked')).toBe(true);
        expect(find(sec, 'ps-sec__note').textContent).toBe('NO BOTS IN THE RANGE');
        expect(textOf(r.root, 'ps-blurb')).toBe('The range fills no roster; there is nobody for a difficulty to describe.');
        for (const card of findAll(sec, 'ps-opt')) expect(card.disabled).toBe(true);
    });

    it('is the listbox a screen reader is told about', () => {
        const r = paint();
        expect(find(r.root, 'ps-cards--diffs').getAttribute('aria-label')).toBe('Bot difficulty');
    });
});

// ---------------------------------------------------------------------------- the plate

describe('the TESTBED plate', () => {
    it('names itself and the facility', () => {
        const r = paint();
        expect(textOf(r.root, 'ps-testbed__title')).toBe('TESTBED');
        expect(textOf(r.root, 'ps-testbed__sub')).toBe('WEAPON TEST FACILITY');
    });

    it('is off on a real map and on in the range', () => {
        expect(find(paint().root, 'ps-testbed').classList.contains('is-on')).toBe(false);
        expect(find(paint(TESTBED.id, 'RANGE').root, 'ps-testbed').classList.contains('is-on')).toBe(true);
    });

    /**
     * The order is the feature: `onLaunch` starts a match from the selection, and the
     * selection is what `onPickMap` has just written. Launching first starts the old map.
     */
    it('enters the testbed: picks the greybox and only then launches', () => {
        const r = paint();
        click(find(r.root, 'ps-testbed__enter'));
        expect(r.calls.order).toEqual([`map:${TESTBED.id}`, 'launch']);
    });

    it('opens the range\'s own class from the plate, and launches nothing', () => {
        const r = paint();
        click(find(r.root, 'ps-testbed__class'));
        expect(r.calls.rangeClasses).toEqual([1]);
        expect(r.calls.maps).toEqual([]);
        expect(r.calls.launches).toEqual([]);
    });

    it('says what the map is for', () => {
        const r = paint();
        const note = find(r.root, 'ps-testbed__note');
        expect(note.children[0]!.className).toBe('ps-testbed__info');
        expect(note.children[1]!.textContent).toBe(
            'This map is for training and experimentation only. Game modes and bot difficulty are disabled.',
        );
    });

    it('stands after the three sections, at the foot of the right column', () => {
        const r = paint();
        const right = r.root.children[1]!;
        expect(right.children).toHaveLength(4);
        expect(right.children[3]!.className).toContain('ps-testbed');
    });
});

// ---------------------------------------------------------------------------- the bar

describe('the bar', () => {
    it('is BACK, the summary and START MATCH, in that order', () => {
        const r = paint();
        expect(r.root.children[2]!.children.map((c) => c.className)).toEqual([
            'op-cta op-cta--quiet ps-back',
            'op-actionbar__lead ps-summary',
            'op-cta op-cta--primary ps-launch',
        ]);
    });

    it('leaves the page by BACK', () => {
        const r = paint();
        click(find(r.root, 'ps-back'));
        expect(r.calls.backs).toEqual([1]);
    });

    it('heads the summary OPERATION SUMMARY', () => {
        const r = paint();
        expect(textOf(r.root, 'ps-summary__title')).toBe('OPERATION SUMMARY');
        expect(find(r.root, 'ps-summary__icon')).toBeDefined();
    });

    it('reads the map, the mode and the difficulty back', () => {
        const r = paint('mp_depot', 'DOM', 'HARDENED');
        expect(findAll(r.root, 'ps-fact__label').map((l) => l.textContent)).toEqual(['MAP', 'MODE', 'DIFFICULTY']);
        expect(findAll(r.root, 'ps-fact__value').map((v) => v.textContent)).toEqual(['DEPOT', 'DOMINATION', 'HARDENED']);
    });

    it('has no difficulty to read in the range', () => {
        const r = paint(TESTBED.id, 'RANGE', 'VETERAN');
        expect(findAll(r.root, 'ps-fact__value').map((v) => v.textContent)).toEqual(['TESTBED', 'SHOOTING RANGE', '\u2014']);
    });

    it('starts the match', () => {
        const r = paint();
        click(find(r.root, 'ps-launch'));
        expect(r.calls.launches).toEqual([1]);
    });

    it('calls the button ENTER TESTBED in the range', () => {
        const r = paint(TESTBED.id, 'RANGE');
        expect(find(r.root, 'ps-launch').children[1]!.textContent).toBe('ENTER TESTBED');
    });

    it('leads BACK and START MATCH with a glyph each', () => {
        const r = paint();
        expect(findAll(r.root, 'op-cta__lead')).toHaveLength(2);
        expect(find(r.root, 'ps-back').children[0]!.className).toBe('op-cta__lead');
        expect(find(r.root, 'ps-launch').children[0]!.className).toBe('op-cta__lead');
    });
});

// ---------------------------------------------------------------------------- the testbed door

describe('testbedMode', () => {
    it('is the one mode with a forced map', () => {
        expect(testbedMode().id).toBe('RANGE');
        expect(testbedMode().forcedMapId).toBe(TESTBED.id);
    });

    it('is the only mode that is not a card', () => {
        expect(MODES.filter((m) => m.forcedMapId !== null)).toHaveLength(1);
        expect(CARD_MODES).toHaveLength(MODES.length - 1);
    });
});

// ---------------------------------------------------------------------------- every button

describe('every control', () => {
    it('is a button of type button, so none of them submits anything', () => {
        const r = paint();
        const buttons = [
            ...findAll(r.root, 'ps-pager__arrow'),
            ...findAll(r.root, 'ps-card'),
            ...findAll(r.root, 'ps-opt'),
            find(r.root, 'ps-maprow'),
            find(r.root, 'ps-testbed__enter'),
            find(r.root, 'ps-testbed__class'),
            find(r.root, 'ps-back'),
            find(r.root, 'ps-launch'),
        ];
        expect(buttons.length).toBeGreaterThan(20);
        for (const b of buttons) expect(b.type).toBe('button');
    });

    it('paints the page again from a different selection without touching the first', () => {
        const first = paint('mp_foundry', 'TDM');
        const second = paint('mp_dunes', 'DOM');
        expect(textOf(first.root, 'ps-hero__name')).toBe('FOUNDRY');
        expect(textOf(second.root, 'ps-hero__name')).toBe('DUNES');
    });

    it('reaches every real map from the strip', () => {
        const r = paint();
        for (let i = 0; i < REAL_MAPS.length; i++) click(findAll(r.root, 'ps-card')[i]!);
        expect(r.calls.maps).toEqual(REAL_MAPS.map((m) => m.id));
    });
});
