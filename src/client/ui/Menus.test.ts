
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHEAT_CODE_MAX } from '../../shared/cheats/Cheats';
import { defaultSettings } from '../../shared/meta/SaveData';
import { DEFAULT_MODE_ID } from '../../shared/modes/ModeRegistry';
import { Profile } from '../meta/Profile';
import { Menus, type MenuSelection } from './Menus';

/**
 * Characterization tests for the front end (refactor unit C19, written before the refactor).
 *
 * Five screens come out of one class: the boot line, the device gate, the main page, the Play
 * Solo page and the profile panel over any of them. All five are reachable from the public
 * methods, with a real `Profile`, a real `PlayerCard` and a real `ProfilePanel` behind them --
 * nothing of this surface is browser-only.
 *
 * ## What is pinned about the layout, and why
 *
 * The chrome mounts on the **viewport** and the page in the **frame** (`Frame.ts`), and the
 * order is header, frame, footer, panel. The gate is the one screen that takes the frame's
 * zoom off its layer, which is why `op-screen--gate` and `ungate` are asserted by name: a
 * menu painted under the gate's viewport would be laid out in window pixels.
 *
 * ## The testbed's rule
 *
 * Picking the greybox forces the Shooting Range and picking a real map again restores the mode
 * the player had before -- a remembered mode, held on the instance, which no public method
 * exposes. It is pinned through the summary the Play Solo page prints.
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

const FALLBACK = defaultSettings('TDM', 'mp_foundry', 90);

interface Calls {
    readonly launches: number[];
    readonly multiplayer: number[];
    readonly loadouts: boolean[];
    readonly settings: number[];
    readonly codes: string[];
    readonly names: string[];
}

interface Rig {
    readonly menus: Menus;
    readonly host: FakeElement;
    readonly layer: FakeElement;
    readonly selection: MenuSelection;
    readonly calls: Calls;
}

interface Options {
    readonly configured?: boolean;
    readonly foreign?: string | null;
    readonly selection?: Partial<MenuSelection>;
}

function rig(options: Options = {}): Rig {
    const host = new FakeElement('div');
    const calls: Calls = { launches: [], multiplayer: [], loadouts: [], settings: [], codes: [], names: [] };
    const selection: MenuSelection = {
        modeId: 'TDM',
        mapId: 'mp_foundry',
        difficulty: 'MIX',
        ...options.selection,
    } as MenuSelection;
    const profile = new Profile({ fallbackSettings: FALLBACK });
    const menus = new Menus({
        host: host as unknown as HTMLElement,
        selection,
        onLaunch: () => calls.launches.push(1),
        onPlayMultiplayer: () => calls.multiplayer.push(1),
        serverConfigured: () => options.configured ?? false,
        foreignServer: options.foreign === undefined ? undefined : () => options.foreign ?? null,
        profile,
        onDisplayName: (name) => calls.names.push(name),
        onLoadout: (range) => calls.loadouts.push(range),
        onSettings: () => calls.settings.push(1),
        onCheatCode: (code) => calls.codes.push(code),
    });
    return { menus, host, layer: host.children[0]!, selection, calls };
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

/** The window-sized box the chrome mounts on. */
function viewportOf(r: Rig): FakeElement {
    return r.layer.children[0]!;
}

/** The 1920x1080 box the page is painted into. */
function frameOf(r: Rig): FakeElement {
    return find(r.layer, 'op-frame');
}

function navLabels(r: Rig): string[] {
    return findAll(r.layer, 'op-nav__label').map((l) => l.children[0]?.textContent ?? l.textContent);
}

function navButtons(r: Rig): FakeElement[] {
    return findAll(r.layer, 'op-nav');
}

function click(el: FakeElement): void {
    fire(el, 'click');
}

function submit(form: FakeElement): void {
    fire(form, 'submit');
}

/** What the Play Solo page's OPERATION SUMMARY reads: map, mode, difficulty. */
function summary(r: Rig): string[] {
    return findAll(r.layer, 'ps-fact__value').map((v) => v.textContent);
}

// ---------------------------------------------------------------------------- the screen

describe('the screen it builds', () => {
    it('mounts one hidden layer on the host', () => {
        const r = rig();
        expect(r.host.children).toHaveLength(1);
        expect(r.layer.className).toBe('op-screen op-screen--menu');
        expect(r.layer.hidden).toBe(true);
    });

    it('is a layer with a viewport and a frame inside it', () => {
        const r = rig();
        expect(viewportOf(r).className).toContain('op-viewport');
        expect(frameOf(r).parent).toBe(viewportOf(r));
    });

    it('paints nothing before it is shown', () => {
        const r = rig();
        expect(navButtons(r)).toHaveLength(0);
    });

    it('reports whether it is visible', () => {
        const r = rig();
        expect(r.menus.isVisible).toBe(false);
        r.menus.show();
        expect(r.menus.isVisible).toBe(true);
        r.menus.hide();
        expect(r.menus.isVisible).toBe(false);
    });

    it('builds the card and the panel once, in the constructor', () => {
        const r = rig();
        r.menus.show();
        const card = find(r.layer, 'op-card');
        r.menus.show('PLAY');
        r.menus.show('MAIN');
        expect(find(r.layer, 'op-card')).toBe(card);
    });
});

// ---------------------------------------------------------------------------- the main page

describe('the main page', () => {
    it('is the chrome on the viewport and the stage in the frame, in that order', () => {
        const r = rig();
        r.menus.show();
        const children = viewportOf(r).children;
        expect(children).toHaveLength(4);
        expect(children[0]!.className).toContain('op-head');
        expect(children[1]!.className).toContain('op-frame');
        expect(children[2]!.className).toContain('op-foot');
        expect(children[3]!.className).toContain('op-profile');
    });

    it('names the place in the header and on the footer stamp', () => {
        const r = rig();
        r.menus.show();
        expect(textOf(r.layer, 'op-head__title')).toBe('MAIN MENU');
        expect(textOf(r.layer, 'op-head__sub')).toBe('ARENA FPS');
        expect(textOf(r.layer, 'op-foot__stamp')).toContain('MAIN MENU');
    });

    it('is the four buttons, in the brief\'s order', () => {
        const r = rig();
        r.menus.show();
        expect(navLabels(r)).toEqual(['PLAY', 'PLAY SOLO', 'CREATE A CLASS', 'SETTINGS']);
    });

    it('marks PLAY primary', () => {
        const r = rig();
        r.menus.show();
        expect(navButtons(r)[0]!.classList.contains('op-nav--primary')).toBe(true);
        expect(navButtons(r)[1]!.classList.contains('op-nav--primary')).toBe(false);
    });

    it('leads each button with its own glyph and ends it with a chevron', () => {
        const r = rig();
        r.menus.show();
        for (const button of navButtons(r)) {
            expect(button.children[0]!.className).toBe('op-nav__icon');
            expect(button.children[1]!.className).toBe('op-nav__label');
            expect(button.children[2]!.className).toBe('op-nav__chevron');
        }
        const icons = navButtons(r).map((b) => b.children[0]!.children[0]!.getAttribute('d'));
        expect(new Set(icons).size).toBe(4);
    });

    it('carries the code field under the nav', () => {
        const r = rig();
        r.menus.show();
        const nav = find(r.layer, 'op-menu__nav');
        expect(nav.children[4]!.className).toBe('op-code op-code--menu');
    });

    it('takes the boot or gate classes off the frame', () => {
        const r = rig();
        r.menus.showBoot('CONNECTING');
        r.menus.show();
        expect(frameOf(r).classList.contains('op-boot')).toBe(false);
        expect(frameOf(r).classList.contains('op-menu')).toBe(true);
    });

    it('opens CREATE A CLASS on the five classes, not the range\'s', () => {
        const r = rig();
        r.menus.show();
        click(navButtons(r)[2]!);
        expect(r.calls.loadouts).toEqual([false]);
    });

    it('opens SETTINGS', () => {
        const r = rig();
        r.menus.show();
        click(navButtons(r)[3]!);
        expect(r.calls.settings).toEqual([1]);
    });
});

// ---------------------------------------------------------------------------- the PLAY button

describe('the PLAY button', () => {
    it('drops straight into the warmup arena when a server is configured', () => {
        const r = rig({ configured: true });
        r.menus.show();
        expect(navButtons(r)[0]!.disabled).toBe(false);
        click(navButtons(r)[0]!);
        expect(r.calls.multiplayer).toEqual([1]);
    });

    it('is disabled with a reason when no address is configured', () => {
        const r = rig({ configured: false });
        r.menus.show();
        const play = navButtons(r)[0]!;
        expect(play.disabled).toBe(true);
        expect(play.title).toBe('No server address configured \u2014 set VITE_SERVER_URL or ?server=');
    });

    it('focuses PLAY SOLO instead when PLAY cannot be pressed', () => {
        const disabled = rig({ configured: false });
        disabled.menus.show();
        // The focused element is the one the page hands back; with PLAY out it is PLAY SOLO,
        // which is the only other way into a match.
        expect(navButtons(disabled)[1]!.className).toBe('op-nav');
        expect(navButtons(disabled)[0]!.disabled).toBe(true);
    });

    it('says where a link is pointing PLAY, when it is not this site', () => {
        const r = rig({ configured: true, foreign: 'someone-else.example' });
        r.menus.show();
        const play = navButtons(r)[0]!;
        expect(textOf(play, 'op-nav__note')).toBe('SERVER \u00b7 someone-else.example');
        expect(play.title).toBe("This link points PLAY at someone-else.example, not at this site's own server.");
    });

    it('says nothing when the link points at this site\'s own server', () => {
        const r = rig({ configured: true, foreign: null });
        r.menus.show();
        expect(navButtons(r)[0]!.querySelector('.op-nav__note')).toBeNull();
    });

    it('does not ask where a disabled button points', () => {
        const r = rig({ configured: false, foreign: 'someone-else.example' });
        r.menus.show();
        expect(navButtons(r)[0]!.querySelector('.op-nav__note')).toBeNull();
        expect(navButtons(r)[0]!.title).toBe('No server address configured \u2014 set VITE_SERVER_URL or ?server=');
    });
});

// ---------------------------------------------------------------------------- the code field

describe('the code field', () => {
    it('is an input, a submit and the result line', () => {
        const r = rig();
        r.menus.show();
        const form = find(r.layer, 'op-code');
        expect(form.tag).toBe('form');
        expect(form.children.map((c) => c.className)).toEqual([
            'op-code__input',
            'op-btn op-btn--quiet op-code__go',
            'op-screen__sub op-code__result',
        ]);
    });

    it('caps the code at the length the shared module allows', () => {
        const r = rig();
        r.menus.show();
        expect((find(r.layer, 'op-code__input') as unknown as { maxLength: number }).maxLength).toBe(CHEAT_CODE_MAX);
    });

    it('sends a typed code through the one door, trimmed', () => {
        const r = rig();
        r.menus.show();
        const input = find(r.layer, 'op-code__input');
        input.value = '  open-sesame  ';
        submit(find(r.layer, 'op-code'));
        expect(r.calls.codes).toEqual(['open-sesame']);
    });

    it('clears the field after a code is sent', () => {
        const r = rig();
        r.menus.show();
        const input = find(r.layer, 'op-code__input');
        input.value = 'half-typed';
        submit(find(r.layer, 'op-code'));
        expect(input.value).toBe('');
    });

    it('sends nothing for an empty field, and does not clear it', () => {
        const r = rig();
        r.menus.show();
        const input = find(r.layer, 'op-code__input');
        input.value = '   ';
        submit(find(r.layer, 'op-code'));
        expect(r.calls.codes).toEqual([]);
        expect(input.value).toBe('   ');
    });

    it('writes the reply on the result line', () => {
        const r = rig();
        r.menus.show();
        r.menus.setCodeResult('NOT A CODE');
        expect(textOf(r.layer, 'op-code__result')).toBe('NOT A CODE');
    });

    /**
     * The reason the form is built once: the reply arrives after a repaint would have thrown
     * the element away, so the form -- the input, its listener and the result line -- is the
     * same node on every page.
     */
    it('is the same form node across a repaint', () => {
        const r = rig();
        r.menus.show();
        const form = find(r.layer, 'op-code');
        const input = find(r.layer, 'op-code__input');
        r.menus.show('PLAY');
        r.menus.show('MAIN');
        expect(find(r.layer, 'op-code')).toBe(form);
        expect(find(r.layer, 'op-code__input')).toBe(input);
    });

    it('keeps a half-typed code across a repaint', () => {
        const r = rig();
        r.menus.show();
        find(r.layer, 'op-code__input').value = 'half-typ';
        r.menus.show('PLAY');
        r.menus.show('MAIN');
        expect(find(r.layer, 'op-code__input').value).toBe('half-typ');
    });

    it('keeps the result line across a repaint', () => {
        const r = rig();
        r.menus.show();
        r.menus.setCodeResult('LEVEL SET');
        r.menus.show('PLAY');
        r.menus.show('MAIN');
        expect(textOf(r.layer, 'op-code__result')).toBe('LEVEL SET');
    });

    it('turns the browser\'s own helpers off', () => {
        const r = rig();
        r.menus.show();
        const input = find(r.layer, 'op-code__input') as unknown as { autocomplete: string; spellcheck: boolean };
        expect(input.autocomplete).toBe('off');
        expect(input.spellcheck).toBe(false);
    });
});

// ---------------------------------------------------------------------------- Play Solo

describe('the Play Solo page', () => {
    it('is the page the Play Solo button opens', () => {
        const r = rig();
        r.menus.show();
        click(navButtons(r)[1]!);
        expect(find(r.layer, 'ps')).toBeDefined();
        expect(navButtons(r)).toHaveLength(0);
    });

    it('names its own place in the chrome', () => {
        const r = rig();
        r.menus.show('PLAY');
        expect(textOf(r.layer, 'op-head__title')).toBe('PLAY SOLO');
        expect(textOf(r.layer, 'op-head__sub')).toBe('SELECT COMBAT SCENARIO');
    });

    it('reads the selection it was given', () => {
        const r = rig({ selection: { mapId: 'mp_depot', modeId: 'DOM', difficulty: 'HARDENED' } });
        r.menus.show('PLAY');
        expect(summary(r)).toEqual(['DEPOT', 'DOMINATION', 'HARDENED']);
    });

    it('writes a picked mode into the selection and repaints', () => {
        const r = rig();
        r.menus.show('PLAY');
        click(findAll(r.layer, 'ps-opt')[1]!);
        expect(r.selection.modeId).toBe('DOM');
        expect(summary(r)[1]).toBe('DOMINATION');
    });

    it('writes a picked difficulty into the selection', () => {
        const r = rig();
        r.menus.show('PLAY');
        const diffs = findAll(find(r.layer, 'ps-cards--diffs'), 'ps-opt');
        click(diffs[3]!);
        expect(r.selection.difficulty).toBe('VETERAN');
        expect(summary(r)[2]).toBe('VETERAN');
    });

    it('starts the match', () => {
        const r = rig();
        r.menus.show('PLAY');
        click(find(r.layer, 'ps-launch'));
        expect(r.calls.launches).toEqual([1]);
    });

    it('opens the range\'s own class from the plate', () => {
        const r = rig();
        r.menus.show('PLAY');
        click(find(r.layer, 'ps-testbed__class'));
        expect(r.calls.loadouts).toEqual([true]);
    });

    it('goes back to the main page by the BACK button, the selection kept', () => {
        const r = rig();
        r.menus.show('PLAY');
        click(findAll(r.layer, 'ps-opt')[1]!);
        click(find(r.layer, 'ps-back'));
        expect(navLabels(r)).toHaveLength(4);
        expect(r.selection.modeId).toBe('DOM');
    });
});

// ---------------------------------------------------------------------------- the testbed rule

describe('the testbed rule', () => {
    it('forces the Shooting Range when the greybox is picked', () => {
        const r = rig();
        r.menus.show('PLAY');
        click(findAll(r.layer, 'ps-card')[3]!);
        expect(r.selection.mapId).toBe('mp_testbed');
        expect(r.selection.modeId).toBe('RANGE');
        expect(summary(r)).toEqual(['TESTBED', 'SHOOTING RANGE', '\u2014']);
    });

    it('restores the mode the player had when a real map is picked again', () => {
        const r = rig();
        r.menus.show('PLAY');
        click(findAll(r.layer, 'ps-opt')[2]!);
        expect(r.selection.modeId).toBe('KC');
        click(findAll(r.layer, 'ps-card')[3]!);
        expect(r.selection.modeId).toBe('RANGE');
        click(findAll(r.layer, 'ps-card')[0]!);
        expect(r.selection.modeId).toBe('KC');
    });

    it('does not remember the range as a mode to come back to', () => {
        const r = rig({ selection: { mapId: 'mp_testbed', modeId: 'RANGE' } });
        r.menus.show('PLAY');
        click(findAll(r.layer, 'ps-card')[0]!);
        expect(r.selection.modeId).toBe(DEFAULT_MODE_ID);
    });

    it('enters the testbed from the plate: the map, the mode, and the launch', () => {
        const r = rig();
        r.menus.show('PLAY');
        click(find(r.layer, 'ps-testbed__enter'));
        expect(r.selection.mapId).toBe('mp_testbed');
        expect(r.selection.modeId).toBe('RANGE');
        expect(r.calls.launches).toEqual([1]);
    });
});

// ---------------------------------------------------------------------------- the boot line

describe('the boot screen', () => {
    it('is the lockup and one line, on the plain frame', () => {
        const r = rig();
        r.menus.showBoot('CONNECTING\u2026');
        expect(r.layer.hidden).toBe(false);
        expect(frameOf(r).classList.contains('op-boot')).toBe(true);
        expect(frameOf(r).classList.contains('op-menu')).toBe(false);
        expect(textOf(r.layer, 'op-screen__sub')).toBe('CONNECTING\u2026');
    });

    it('has nothing to press', () => {
        const r = rig();
        r.menus.showBoot('REFUSED');
        expect(navButtons(r)).toHaveLength(0);
        expect(r.layer.querySelector('.op-code')).toBeNull();
    });

    it('takes the chrome of a previous menu paint off the viewport', () => {
        const r = rig();
        r.menus.show();
        r.menus.showBoot('RECONNECTING');
        expect(viewportOf(r).children).toHaveLength(1);
        expect(r.layer.querySelector('.op-head')).toBeNull();
        expect(r.layer.querySelector('.op-foot')).toBeNull();
    });

    it('writes a new line over the old one', () => {
        const r = rig();
        r.menus.showBoot('FIRST');
        r.menus.showBoot('SECOND');
        expect(findAll(r.layer, 'op-screen__sub')).toHaveLength(1);
        expect(textOf(r.layer, 'op-screen__sub')).toBe('SECOND');
    });
});

// ---------------------------------------------------------------------------- the gate

describe('the device gate', () => {
    it('is the lockup, the headline, the detail and the chrome line', () => {
        const r = rig();
        r.menus.showUnsupported('KEYBOARD AND MOUSE REQUIRED', 'This game needs both.');
        expect(textOf(r.layer, 'op-screen__sub')).toBe('KEYBOARD AND MOUSE REQUIRED');
        expect(textOf(r.layer, 'op-gate__note')).toBe('This game needs both.');
        expect(textOf(r.layer, 'op-gate__foot')).toBe('FIGHT \u00b7 SURVIVE \u00b7 WIN');
    });

    it('is the one screen that takes the frame\'s zoom off its layer', () => {
        const r = rig();
        r.menus.showUnsupported('NO', 'why');
        expect(r.layer.classList.contains('op-screen--gate')).toBe(true);
        expect(frameOf(r).classList.contains('op-gate')).toBe(true);
    });

    it('has nothing to press and no way back', () => {
        const r = rig();
        r.menus.showUnsupported('NO', 'why');
        expect(navButtons(r)).toHaveLength(0);
        expect(r.menus.handleEscape()).toBe(false);
    });

    it('gives the zoom back when a menu is painted over it', () => {
        const r = rig();
        r.menus.showUnsupported('NO', 'why');
        r.menus.show();
        expect(r.layer.classList.contains('op-screen--gate')).toBe(false);
        expect(frameOf(r).classList.contains('op-gate')).toBe(false);
    });

    it('gives the zoom back for the boot line too', () => {
        const r = rig();
        r.menus.showUnsupported('NO', 'why');
        r.menus.showBoot('CONNECTING');
        expect(r.layer.classList.contains('op-screen--gate')).toBe(false);
        expect(frameOf(r).classList.contains('op-gate')).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the profile

describe('the profile panel', () => {
    it('is in the viewport, over the chrome, closed', () => {
        const r = rig();
        r.menus.show();
        const panel = find(r.layer, 'op-profile');
        expect(panel).toBe(viewportOf(r).children[3]);
        expect(panel.hidden).toBe(true);
    });

    it('opens on a tab, and the panel is the real one', () => {
        const r = rig();
        r.menus.show();
        r.menus.openProfile('achievements');
        expect(find(r.layer, 'op-profile').hidden).toBe(false);
        expect(findAll(r.layer, 'op-profile__body').length).toBeGreaterThan(0);
    });

    it('opens from the gear on the player card', () => {
        const r = rig();
        r.menus.show();
        click(find(r.layer, 'op-card__gear'));
        expect(find(r.layer, 'op-profile').hidden).toBe(false);
    });

    it('is closed by Escape, which consumes the key', () => {
        const r = rig();
        r.menus.show();
        r.menus.openProfile();
        expect(r.menus.handleEscape()).toBe(true);
        expect(find(r.layer, 'op-profile').hidden).toBe(true);
    });

    it('is closed by showing a page', () => {
        const r = rig();
        r.menus.show();
        r.menus.openProfile();
        r.menus.show('PLAY');
        expect(find(r.layer, 'op-profile').hidden).toBe(true);
    });

    it('is closed by hiding the menu', () => {
        const r = rig();
        r.menus.show();
        r.menus.openProfile();
        r.menus.hide();
        expect(find(r.layer, 'op-profile').hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- Escape

describe('Escape', () => {
    it('is not answered on the main page: there is nowhere further back', () => {
        const r = rig();
        r.menus.show();
        expect(r.menus.handleEscape()).toBe(false);
    });

    it('is BACK on the Play Solo page, and is consumed', () => {
        const r = rig();
        r.menus.show('PLAY');
        expect(r.menus.handleEscape()).toBe(true);
        expect(navLabels(r)).toHaveLength(4);
    });

    it('closes the panel first, even on the Play Solo page', () => {
        const r = rig();
        r.menus.show('PLAY');
        r.menus.openProfile();
        expect(r.menus.handleEscape()).toBe(true);
        expect(find(r.layer, 'op-profile').hidden).toBe(true);
        expect(find(r.layer, 'ps')).toBeDefined();
    });
});

// ---------------------------------------------------------------------------- the card

describe('the player card', () => {
    it('stands in the header', () => {
        const r = rig();
        r.menus.show();
        expect(find(r.layer, 'op-card').parent!.className).toBe('op-head op-head--menu');
    });

    it('is re-read on a page change', () => {
        const r = rig();
        r.menus.show();
        const level = textOf(r.layer, 'op-card__level');
        r.menus.show('PLAY');
        r.menus.show('MAIN');
        expect(textOf(r.layer, 'op-card__level')).toBe(level);
    });

    it('is re-read on demand, without rebuilding the page', () => {
        const r = rig();
        r.menus.show();
        const nav = find(r.layer, 'op-menu__nav');
        r.menus.refreshCard();
        expect(find(r.layer, 'op-menu__nav')).toBe(nav);
    });

    it('greys its dot when no server is configured', () => {
        const r = rig({ configured: false });
        r.menus.show();
        expect(find(r.layer, 'op-card').className).toBeDefined();
        expect(findAll(r.layer, 'op-card__dot')).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('hide and dispose', () => {
    it('hide leaves the page painted', () => {
        const r = rig();
        r.menus.show();
        r.menus.hide();
        expect(r.layer.hidden).toBe(true);
        expect(navLabels(r)).toHaveLength(4);
    });

    it('dispose takes the layer off the host', () => {
        const r = rig();
        r.menus.show();
        r.menus.dispose();
        expect(r.host.children).toHaveLength(0);
    });

    it('is safe twice', () => {
        const r = rig();
        r.menus.dispose();
        r.menus.dispose();
        expect(r.host.children).toHaveLength(0);
    });
});
