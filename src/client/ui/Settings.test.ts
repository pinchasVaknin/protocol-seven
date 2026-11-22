import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIONS, defaultBindings, inputLabel, type ActionId } from '../../shared/core/Keybinds';
import { COLORBLIND_MODES, defaultSettings, SHADOW_QUALITIES, type SettingsV1 } from '../../shared/meta/SaveData';
import { Profile } from '../meta/Profile';
import { CHARACTER_CREDIT, MODEL_CREDITS, CREDITS_NOTE } from './CreditsData';
import { Settings } from './Settings';

/**
 * Characterization tests for the settings screen (refactor unit C17, written before the
 * refactor).
 *
 * The document is a double and everything else is the product's own: a real `Profile` over a
 * map-backed `localStorage`, the real `ACTIONS` table and `inputLabel`, the real credits data,
 * a real `PlayerCard` and `ProfilePanel`. There is no WebGL anywhere under this screen, so
 * unlike C16 there is nothing here that has to stay browser-verified — the rebinding capture
 * included, which registers on `window` and is driven below by firing that registry.
 *
 * Two asymmetries are worth knowing before reading the assertions. `paint()` rebuilds the
 * whole viewport, so every element reference goes stale on any change — the helpers re-query.
 * And a **slider** or a **toggle** writes its own read-out and does *not* repaint, while a
 * **picker** does; that is deliberate (a repaint mid-drag would drop the pointer) and is
 * pinned both ways.
 */

// ---------------------------------------------------------------------------- the DOM double

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
    code?: string;
    button?: number;
    deltaY?: number;
    preventDefault: () => void;
    stopPropagation: () => void;
}

class FakeElement {
    readonly tokens = new Set<string>();
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Listener[]>();
    readonly dataset: Record<string, string> = {};
    readonly style: Record<string, string> & { setProperty: (name: string, value: string) => void } = Object.assign(
        {} as Record<string, string>,
        {
            setProperty: (name: string, value: string): void => {
                this.style[name] = value;
            },
        },
    );

    textContent = '';
    hidden = false;
    disabled = false;
    tabIndex = -1;
    spellcheck = true;
    autocomplete = '';
    type = '';
    value = '';
    min = '';
    max = '';
    step = '';
    maxLength = -1;
    readOnly = false;
    draggable = true;
    src = '';
    alt = '';
    href = '';
    target = '';
    rel = '';
    placeholder = '';
    parent: FakeElement | null = null;
    focusCount = 0;
    blurCount = 0;

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

    get firstElementChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    remove(): void {
        const siblings = this.parent?.children;
        if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
        this.parent = null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
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

    /** One class selector, which is all this screen asks for (`.st-sec__head`). */
    querySelector(selector: string): FakeElement | null {
        const token = selector.replace(/^\./, '');
        let found: FakeElement | null = null;
        const walk = (el: FakeElement): void => {
            if (found !== null) return;
            if (el.tokens.has(token)) {
                found = el;
                return;
            }
            for (const child of el.children) walk(child);
        };
        for (const child of this.children) walk(child);
        return found;
    }

    getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    focus(): void {
        this.focusCount++;
    }

    blur(): void {
        this.blurCount++;
    }

    cloneNode(_deep?: boolean): FakeElement {
        const copy = new FakeElement(this.tag);
        for (const [key, value] of this.attributes) copy.setAttribute(key, value);
        for (const child of this.children) copy.appendChild(child.cloneNode(true));
        return copy;
    }
}

function fire(el: FakeElement, type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined, ...over };
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
}

// ---------------------------------------------------------------------------- the environment

let storage: Map<string, string>;
/** The capture-phase registry. The rebinding rows are the only thing in the project that uses it. */
let windowListeners: Map<string, Listener[]>;

function installEnvironment(): void {
    storage = new Map();
    windowListeners = new Map();
    const store = {
        getItem: (key: string): string | null => storage.get(key) ?? null,
        setItem: (key: string, value: string): void => {
            storage.set(key, value);
        },
        removeItem: (key: string): void => {
            storage.delete(key);
        },
        clear: (): void => storage.clear(),
        key: (index: number): string | null => [...storage.keys()][index] ?? null,
        get length(): number {
            return storage.size;
        },
    };
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        documentElement: { style: new FakeElement('html').style },
        activeElement: null,
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        setTimeout: (): number => 1,
        clearTimeout: (): void => undefined,
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
}

/** Fire one of the three capture handlers, the way a raw event would reach them. */
function fireWindow(type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined, ...over };
    for (const fn of [...(windowListeners.get(type) ?? [])]) fn(event);
}

function windowCount(type: string): number {
    return windowListeners.get(type)?.length ?? 0;
}

beforeEach(() => {
    installEnvironment();
});

afterEach(() => {
    for (const key of ['document', 'HTMLElement', 'localStorage', 'window']) {
        delete (globalThis as Record<string, unknown>)[key];
    }
});

// ---------------------------------------------------------------------------- the rig

const FALLBACK = defaultSettings('TDM', 'mp_foundry', 90);

type Tab = 'CONTROLS' | 'BINDINGS' | 'AUDIO' | 'VIDEO' | 'INFO';

interface Rig {
    readonly settings: Settings;
    readonly profile: Profile;
    readonly host: FakeElement;
    readonly layer: FakeElement;
    /** Every record handed to `onPreview`, in order. */
    readonly previews: SettingsV1[];
    readonly commits: SettingsV1[];
    readonly backs: number[];
    readonly resets: number[];
}

function rig(): Rig {
    const host = new FakeElement('div');
    const profile = new Profile({ fallbackSettings: FALLBACK });
    const previews: SettingsV1[] = [];
    const commits: SettingsV1[] = [];
    const backs: number[] = [];
    const resets: number[] = [];
    const settings = new Settings({
        host: host as unknown as HTMLElement,
        read: () => profile.settings,
        onPreview: (s) => previews.push(s),
        onCommit: (s) => commits.push(s),
        onBack: () => backs.push(1),
        onResetProgress: () => resets.push(1),
        profile,
        serverConfigured: () => true,
        onDisplayName: () => undefined,
    });
    const layer = host.children[0];
    if (layer === undefined) throw new Error('the settings screen mounted nothing');
    return { settings, profile, host, layer, previews, commits, backs, resets };
}

function classOf(el: FakeElement): string {
    return el.className !== '' ? el.className : (el.getAttribute('class') ?? '');
}

function has(el: FakeElement, token: string): boolean {
    return classOf(el).split(' ').includes(token);
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
        if (has(el, token)) out.push(el);
        for (const child of el.children) walk(child);
    };
    walk(root);
    return out;
}

function find(root: FakeElement, token: string): FakeElement {
    const found = findAll(root, token)[0];
    if (found === undefined) throw new Error(`no element carrying .${token}`);
    return found;
}

function viewport(r: Rig): FakeElement {
    return find(r.layer, 'op-viewport');
}

function panel(r: Rig): FakeElement {
    return find(viewport(r), 'st-panel');
}

function rail(r: Rig): FakeElement[] {
    return findAll(viewport(r), 'st-rail__item');
}

function main(r: Rig): FakeElement {
    return find(panel(r), 'st-main');
}

function foot(r: Rig): { back: FakeElement; apply: FakeElement } {
    const bar = find(panel(r), 'st-foot');
    const [back, apply] = bar.children;
    if (back === undefined || apply === undefined) throw new Error('the panel foot is missing a button');
    return { back, apply };
}

function sections(r: Rig): FakeElement[] {
    return findAll(main(r), 'st-sec');
}

/** One control row, read back as the pieces its builder made. */
function row(r: Rig, label: string) {
    const found = findAll(panel(r), 'st-row').find((el) => el.children[0]?.textContent === label);
    if (found === undefined) throw new Error(`no row labelled ${label}`);
    const range = findAll(found, 'st-range')[0];
    const toggle = findAll(found, 'st-toggle')[0];
    const choices = findAll(found, 'st-choice');
    const readout = findAll(found, 'st-row__value')[0];
    const help = findAll(found, 'st-row__help')[0];
    return {
        el: found,
        kind: found.className,
        range,
        toggle,
        choices,
        readout: readout?.textContent,
        help: help?.textContent,
    };
}

/** Move a slider the way a pointer does: set the value, then fire `input`. */
function slide(r: Rig, label: string, value: number): void {
    const range = row(r, label).range;
    if (range === undefined) throw new Error(`row ${label} has no slider`);
    range.value = String(value);
    fire(range, 'input');
}

function bindRows(r: Rig): FakeElement[] {
    return findAll(panel(r), 'st-bind');
}

function keysOf(rowEl: FakeElement): FakeElement[] {
    return findAll(rowEl, 'st-key');
}

function bindRowFor(r: Rig, actionId: ActionId): FakeElement {
    const action = ACTIONS.find((a) => a.id === actionId);
    if (action === undefined) throw new Error(`no action ${actionId}`);
    const found = bindRows(r).find((el) => el.children[0]?.textContent === action.label);
    if (found === undefined) throw new Error(`no binding row for ${actionId}`);
    return found;
}

function notes(r: Rig): string[] {
    return findAll(panel(r), 'st-note').map((el) => el.textContent);
}

/**
 * The BINDINGS status line, found by its own class rather than by counting (BACKLOG #76).
 *
 * The cases below used `notes(r)[0]` for this, which was the complaint that opened the entry:
 * four paragraphs shared one class and position was the only thing that told them apart.
 */
function statusNote(r: Rig): FakeElement {
    return find(panel(r), 'st-note--status');
}

function pager(r: Rig): { el: FakeElement; prev: FakeElement; next: FakeElement; count: string } {
    const el = find(panel(r), 'st-pager');
    const [prev, count, next] = el.children;
    if (prev === undefined || count === undefined || next === undefined) throw new Error('the pager is missing a part');
    return { el, prev, next, count: count.textContent };
}

const ALL_CREDITS = [...MODEL_CREDITS, CHARACTER_CREDIT];
const CREDIT_PAGES = Math.max(1, Math.ceil(ALL_CREDITS.length / 14));
const TABS: readonly Tab[] = ['CONTROLS', 'BINDINGS', 'AUDIO', 'VIDEO', 'INFO'];

// ---------------------------------------------------------------------------- the screen

describe('the screen it builds', () => {
    it('mounts one hidden layer on the host and paints nothing into it', () => {
        const { host, layer } = rig();
        expect(host.children).toHaveLength(1);
        expect(layer.className).toBe('op-screen st');
        expect(layer.hidden).toBe(true);
        expect(findAll(layer, 'st-rail__item')).toEqual([]);
    });

    it('unhides and paints the whole screen on show', () => {
        const r = rig();
        r.settings.show();
        expect(r.layer.hidden).toBe(false);
        expect(r.settings.isVisible).toBe(true);
        expect(rail(r)).toHaveLength(5);
    });

    it('puts the chrome on the viewport and the body in the frame', () => {
        const r = rig();
        r.settings.show();
        expect(viewport(r).children.map((c) => c.className.split(' ')[0])).toEqual([
            'op-head',
            'op-frame',
            'op-foot',
            'op-profile',
        ]);
        expect(find(viewport(r), 'op-frame').children.map((c) => c.className)).toEqual(['st-body']);
        expect(find(viewport(r), 'st-body').children.map((c) => c.className)).toEqual(['st-rail', 'st-panel']);
    });

    it('titles itself SYSTEM CONTROL in both the header and the footer', () => {
        const r = rig();
        r.settings.show();
        const text = findAll(viewport(r), 'op-head__title')
            .concat(findAll(viewport(r), 'op-head__sub'))
            .map((el) => el.textContent);
        expect(text).toContain('SYSTEM CONTROL');
        expect(text).toContain('CONFIGURE OPERATIVE PARAMETERS');
    });

    it('hides the screen on hide, and reports itself invisible', () => {
        const r = rig();
        r.settings.show();
        r.settings.hide();
        expect(r.layer.hidden).toBe(true);
        expect(r.settings.isVisible).toBe(false);
    });

    it('takes the layer off the host when disposed of', () => {
        const r = rig();
        r.settings.show();
        r.settings.dispose();
        expect(r.host.children).toEqual([]);
    });
});

describe('the rail', () => {
    it('is a labelled nav of the five categories, numbered', () => {
        const r = rig();
        r.settings.show();
        expect(find(viewport(r), 'st-rail').getAttribute('aria-label')).toBe('Settings categories');
        expect(rail(r).map((b) => findAll(b, 'st-rail__name')[0]?.textContent)).toEqual([...TABS]);
        expect(rail(r).map((b) => findAll(b, 'st-rail__num')[0]?.textContent)).toEqual(['01', '02', '03', '04', '05']);
    });

    it('lights the open one and tells a reader which page it is', () => {
        const r = rig();
        r.settings.show();
        expect(rail(r).map((b) => b.classList.contains('is-on'))).toEqual([true, false, false, false, false]);
        expect(rail(r).map((b) => b.getAttribute('aria-current'))).toEqual(['page', 'false', 'false', 'false', 'false']);
    });

    it('opens a category on a click, and the light follows', () => {
        const r = rig();
        r.settings.show();
        fire(rail(r)[3] as FakeElement, 'click');
        expect(rail(r).map((b) => b.classList.contains('is-on'))).toEqual([false, false, false, true, false]);
        expect(find(panel(r), 'st-panel__title').textContent).toBe('VIDEO');
    });

    it('opens one directly for the layout probe', () => {
        const r = rig();
        r.settings.show();
        for (const tab of TABS) {
            r.settings.openTab(tab);
            expect(find(panel(r), 'st-panel__title').textContent).toBe(tab);
        }
    });

    it('gives each category its own glyph and its own subtitle', () => {
        const r = rig();
        r.settings.show();
        const subtitles: string[] = [];
        for (const tab of TABS) {
            r.settings.openTab(tab);
            subtitles.push(find(panel(r), 'st-panel__sub').textContent);
        }
        expect(subtitles).toEqual([
            'OPERATIVE INPUT CONFIGURATION',
            'KEY ASSIGNMENTS',
            'MIX AND LEVELS',
            'DISPLAY AND RENDERING',
            'REFERENCE AND ACCOUNT',
        ]);
    });

    it('keeps the category across a hide and a show, but resets the screen-local state', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        r.settings.hide();
        r.settings.show();
        expect(find(panel(r), 'st-panel__title').textContent).toBe('VIDEO');
    });
});

describe('the side column', () => {
    it('stands beside every category but BINDINGS, which takes the whole width', () => {
        const r = rig();
        r.settings.show();
        for (const tab of TABS) {
            r.settings.openTab(tab);
            const columns = find(panel(r), 'st-columns');
            const wide = columns.classList.contains('st-columns--wide');
            expect(wide).toBe(tab === 'BINDINGS');
            expect(findAll(columns, 'st-side')).toHaveLength(tab === 'BINDINGS' ? 0 : 1);
        }
    });

    it('names the one input device a client that reached this screen has', () => {
        const r = rig();
        r.settings.show();
        const card = find(panel(r), 'st-card');
        expect(findAll(card, 'op-label')[0]?.textContent).toBe('INPUT DEVICE');
        expect(find(card, 'st-card__value').textContent).toBe('MOUSE / KEYBOARD');
    });

    it('shows the chosen skin under the caption, with three bars', () => {
        const r = rig();
        r.settings.show();
        const plate = find(panel(r), 'st-plate');
        expect(find(plate, 'st-plate__img').src).not.toBe('');
        expect(find(plate, 'st-plate__img').draggable).toBe(false);
        expect(find(plate, 'st-plate__caption').textContent).toBe('ADJUST YOUR CONTROLS FOR MAXIMUM PERFORMANCE');
        expect(findAll(plate, 'st-plate__bar')).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------- the controls

describe('CONTROLS', () => {
    it('offers sensitivity and view, in two sections', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('CONTROLS');
        expect(sections(r).map((s) => find(s, 'st-sec__title').textContent)).toEqual(['SENSITIVITY', 'VIEW']);
    });

    it('draws the two sensitivities and the two view controls', () => {
        const r = rig();
        r.settings.show();
        expect(findAll(main(r), 'st-row').map((el) => el.children[0]?.textContent)).toEqual([
            'Look sensitivity',
            'ADS sensitivity',
            'Field of view',
            'Invert vertical look',
        ]);
    });

    it('gives each slider its own range and step, and reads the draft', () => {
        const r = rig();
        r.settings.show();
        const look = row(r, 'Look sensitivity');
        expect([look.range?.min, look.range?.max, look.range?.step]).toEqual(['0.1', '5', '0.05']);
        expect(look.range?.value).toBe(String(r.profile.settings.sensitivity));
        const ads = row(r, 'ADS sensitivity');
        expect([ads.range?.min, ads.range?.max, ads.range?.step]).toEqual(['0.1', '2', '0.05']);
        const fov = row(r, 'Field of view');
        expect([fov.range?.min, fov.range?.max, fov.range?.step]).toEqual(['60', '120', '1']);
    });

    it('formats a plain slider to two decimals and the field of view in degrees', () => {
        const r = rig();
        r.settings.show();
        expect(row(r, 'Look sensitivity').readout).toBe(r.profile.settings.sensitivity.toFixed(2));
        expect(row(r, 'Field of view').readout).toBe(`${r.profile.settings.fov.toFixed(0)}°`);
    });

    it('carries help only where there is something to explain', () => {
        const r = rig();
        r.settings.show();
        expect(row(r, 'Look sensitivity').help).toBeUndefined();
        expect(row(r, 'ADS sensitivity').help).toBe(
            'Applied in proportion to how far the sights are up, so it arrives with the picture.',
        );
    });

    it('previews a moved slider live, and writes its own read-out without a repaint', () => {
        const r = rig();
        r.settings.show();
        const before = row(r, 'Field of view').el;
        slide(r, 'Field of view', 103);
        expect(r.previews).toHaveLength(1);
        expect(r.previews[0]?.fov).toBe(103);
        // The row is the same element: a repaint here would drop a pointer mid-drag.
        expect(row(r, 'Field of view').el).toBe(before);
        expect(row(r, 'Field of view').readout).toBe('103°');
    });

    it('previews the draft itself, so every change is on one record', () => {
        const r = rig();
        r.settings.show();
        slide(r, 'Field of view', 100);
        slide(r, 'Look sensitivity', 2.5);
        expect(r.previews).toHaveLength(2);
        expect(r.previews[0]).toBe(r.previews[1]);
        expect(r.previews[1]?.fov).toBe(100);
        expect(r.previews[1]?.sensitivity).toBe(2.5);
    });

    it('leaves the saved record untouched while the draft moves', () => {
        const r = rig();
        const was = r.profile.settings.fov;
        r.settings.show();
        slide(r, 'Field of view', 118);
        expect(r.profile.settings.fov).toBe(was);
    });

    it('flips a toggle, writes its own label and previews', () => {
        const r = rig();
        r.settings.show();
        const toggle = row(r, 'Invert vertical look').toggle;
        if (toggle === undefined) throw new Error('no toggle');
        expect(toggle.textContent).toBe('OFF');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        fire(toggle, 'click');
        expect(toggle.textContent).toBe('ON');
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(toggle.classList.contains('is-on')).toBe(true);
        expect(r.previews[0]?.invertY).toBe(true);
        fire(toggle, 'click');
        expect(toggle.textContent).toBe('OFF');
        expect(r.previews[1]?.invertY).toBe(false);
    });
});

describe('AUDIO', () => {
    it('offers the four buses in one section, as percentages', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('AUDIO');
        expect(sections(r).map((s) => find(s, 'st-sec__title').textContent)).toEqual(['LEVELS']);
        expect(findAll(main(r), 'st-row').map((el) => el.children[0]?.textContent)).toEqual([
            'Master',
            'Effects',
            'Music',
            'Interface',
        ]);
        expect(row(r, 'Master').readout).toBe(`${Math.round(r.profile.settings.masterVolume * 100)}%`);
    });

    it('gives every bus the same zero-to-one range at one percent a step', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('AUDIO');
        for (const label of ['Master', 'Effects', 'Music', 'Interface']) {
            const bus = row(r, label);
            expect([bus.range?.min, bus.range?.max, bus.range?.step]).toEqual(['0', '1', '0.01']);
        }
    });

    it('explains the two buses that do something surprising and not the two that do not', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('AUDIO');
        expect(row(r, 'Master').help).toBeUndefined();
        expect(row(r, 'Music').help).toBeUndefined();
        expect(row(r, 'Effects').help).toContain('Ducks under announcer stings');
        expect(row(r, 'Interface').help).toContain('Routed around the world filter');
    });

    it('rounds a moved bus to a whole percent in the read-out', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('AUDIO');
        slide(r, 'Effects', 0.337);
        expect(row(r, 'Effects').readout).toBe('34%');
        expect(r.previews[0]?.sfxVolume).toBe(0.337);
    });
});

describe('VIDEO', () => {
    it('offers rendering and accessibility, in two sections', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        expect(sections(r).map((s) => find(s, 'st-sec__title').textContent)).toEqual(['RENDERING', 'ACCESSIBILITY']);
    });

    it('draws the render scale as a percentage slider with its warning', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        const scale = row(r, 'Render scale');
        expect([scale.range?.min, scale.range?.max, scale.range?.step]).toEqual(['0.5', '1', '0.05']);
        expect(scale.readout).toBe(`${Math.round(r.profile.settings.renderScale * 100)}%`);
        expect(scale.help).toContain('integrated graphics');
    });

    it('offers the four shadow tiers with the sizes they mean', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        const picker = row(r, 'Shadow quality');
        expect(picker.el.className).toBe('st-row st-row--stack');
        expect(picker.choices.map((c) => c.textContent)).toEqual([
            'Off',
            'Low — 1024, hard',
            'Medium — 2048',
            'High — 4096, soft',
        ]);
        expect(picker.choices).toHaveLength(SHADOW_QUALITIES.length);
    });

    it('marks the chosen tier and nothing else', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        const at = SHADOW_QUALITIES.indexOf(r.profile.settings.shadowQuality);
        expect(row(r, 'Shadow quality').choices.map((c) => c.classList.contains('is-on'))).toEqual(
            SHADOW_QUALITIES.map((_q, i) => i === at),
        );
        expect(row(r, 'Shadow quality').choices[at]?.getAttribute('aria-pressed')).toBe('true');
    });

    it('repaints the screen when a picker is used, unlike a slider', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        const before = row(r, 'Shadow quality').el;
        const choices = row(r, 'Shadow quality').choices;
        const last = choices[choices.length - 1];
        if (last === undefined) throw new Error('no shadow tiers');
        fire(last, 'click');
        expect(r.previews[0]?.shadowQuality).toBe(SHADOW_QUALITIES[SHADOW_QUALITIES.length - 1]);
        expect(row(r, 'Shadow quality').el).not.toBe(before);
        expect(row(r, 'Shadow quality').choices[SHADOW_QUALITIES.length - 1]?.classList.contains('is-on')).toBe(true);
    });

    it('names the four colourblind modes by the pair each one gives', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        const picker = row(r, 'Colourblind mode');
        expect(picker.choices.map((c) => c.textContent)).toEqual([
            'Off — green / red',
            'Deuteranopia — blue / orange',
            'Protanopia — blue / orange',
            'Tritanopia — teal / magenta',
        ]);
        expect(picker.choices).toHaveLength(COLORBLIND_MODES.length);
        expect(picker.help).toContain('not a filter over the picture');
    });

    it('picks a colourblind mode into the draft', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        const tritanopia = row(r, 'Colourblind mode').choices[3];
        if (tritanopia === undefined) throw new Error('no tritanopia');
        fire(tritanopia, 'click');
        expect(r.previews[0]?.colorblind).toBe('tritanopia');
    });

    it('offers motion blur with its warning and the FPS counter without one', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('VIDEO');
        expect(row(r, 'Motion blur').help).toContain('nauseating');
        expect(row(r, 'FPS counter').help).toBeUndefined();
        const fps = row(r, 'FPS counter').toggle;
        if (fps === undefined) throw new Error('no toggle');
        fire(fps, 'click');
        expect(r.previews[0]?.showFps).toBe(!FALLBACK.showFps);
    });
});

// ---------------------------------------------------------------------------- bindings

describe('BINDINGS', () => {
    it('stands the groups in three columns, Equipment and Interface sharing the third', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        const columns = findAll(main(r), 'st-bindings__column');
        expect(columns).toHaveLength(3);
        expect(columns.map((c) => findAll(c, 'st-sec__title').map((t) => t.textContent))).toEqual([
            ['MOVEMENT'],
            ['COMBAT'],
            ['EQUIPMENT', 'INTERFACE'],
        ]);
    });

    it('draws every action in the table exactly once', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        expect(bindRows(r)).toHaveLength(ACTIONS.length);
        expect(bindRows(r).map((el) => el.children[0]?.textContent).sort()).toEqual(
            ACTIONS.map((a) => a.label).sort(),
        );
    });

    it('offers two slots on every action, whatever is bound to it', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        expect(bindRows(r).every((el) => keysOf(el).length === 2)).toBe(true);
    });

    it('labels a bound slot through `inputLabel` and an empty one with a dash', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        for (const action of ACTIONS) {
            const bound = r.profile.settings.bindings[action.id] ?? [];
            const keys = keysOf(bindRowFor(r, action.id));
            expect(keys[0]?.textContent).toBe(bound[0] === undefined ? '—' : inputLabel(bound[0]));
            expect(keys[1]?.textContent).toBe(bound[1] === undefined ? '—' : inputLabel(bound[1]));
            expect(keys[1]?.classList.contains('is-empty')).toBe(bound[1] === undefined);
        }
    });

    it('explains itself when nothing is armed', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        expect(statusNote(r).textContent).toBe('Click a binding to change it. A key taken from another action is removed from it.');
        expect(notes(r)[1]).toBe('F11 for fullscreen — required to capture Ctrl+W (crouch + forward)');
    });

    /**
     * BACKLOG #76, fixed 2026-11-22. Four paragraphs on this screen carry `st-note` and until
     * now position was the only thing that told them apart — which is tolerable in a test and
     * wrong on the screen, because one of the four is the only piece of *state* here that is
     * not a control.
     */
    it('announces the status line, and marks only that one of the four', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        const status = statusNote(r);
        expect(status.getAttribute('aria-live')).toBe('polite');
        // It is still an `st-note`: the modifier is an identity, not a different kind of thing.
        expect(status.classList.contains('st-note')).toBe(true);

        // And it is the only one. The fullscreen hint beside it is prose and says so by not
        // being announced; a reader told about both would be told about neither.
        const marked = findAll(panel(r), 'st-note--status');
        expect(marked.length).toBe(1);
        expect(notes(r).length).toBe(2);
    });

    it('does not announce the two notes on INFO, which are prose', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        expect(findAll(panel(r), 'st-note--status').length).toBe(0);
        expect(notes(r).length).toBeGreaterThan(0);
    });

    it('takes the whole width and tightens the panel', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        expect(main(r).classList.contains('st-main--bindings')).toBe(true);
        expect(main(r).classList.contains('st-main--tight')).toBe(true);
    });

    it('restores the defaults and says APPLY keeps them', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        fire(find(panel(r), 'st-reset'), 'click');
        expect(r.previews[0]?.bindings).toEqual(defaultBindings());
        expect(statusNote(r).textContent).toBe('Bindings restored to defaults — APPLY keeps them.');
    });
});

describe('capturing a key', () => {
    function arm(r: Rig, action: ActionId, slot: number): void {
        r.settings.show();
        r.settings.openTab('BINDINGS');
        const key = keysOf(bindRowFor(r, action))[slot];
        if (key === undefined) throw new Error('no slot');
        fire(key, 'click');
    }

    it('arms the slot, says so, and asks the window for the raw event', () => {
        const r = rig();
        arm(r, 'moveForward', 0);
        expect(keysOf(bindRowFor(r, 'moveForward'))[0]?.textContent).toBe('PRESS…');
        expect(keysOf(bindRowFor(r, 'moveForward'))[0]?.classList.contains('is-armed')).toBe(true);
        expect(statusNote(r).textContent).toBe('Press any key or mouse button. Escape cancels.');
        expect(windowCount('keydown')).toBe(1);
        expect(windowCount('mousedown')).toBe(1);
        expect(windowCount('wheel')).toBe(1);
    });

    it('arms one slot at a time', () => {
        const r = rig();
        arm(r, 'moveForward', 0);
        fire(keysOf(bindRowFor(r, 'jump'))[0] as FakeElement, 'click');
        expect(windowCount('keydown')).toBe(1);
        expect(keysOf(bindRowFor(r, 'moveForward'))[0]?.textContent).not.toBe('PRESS…');
        expect(keysOf(bindRowFor(r, 'jump'))[0]?.textContent).toBe('PRESS…');
    });

    it('writes the key into the draft, previews it and lets the window go', () => {
        const r = rig();
        arm(r, 'jump', 1);
        fireWindow('keydown', { code: 'KeyJ' });
        expect(r.previews[0]?.bindings['jump']).toContain('KeyJ');
        expect(keysOf(bindRowFor(r, 'jump'))[1]?.textContent).toBe(inputLabel('KeyJ'));
        expect(windowCount('keydown')).toBe(0);
        expect(windowCount('mousedown')).toBe(0);
        expect(windowCount('wheel')).toBe(0);
    });

    it('takes the key off whatever else held it, and says which', () => {
        const r = rig();
        const forward = r.profile.settings.bindings['moveForward']?.[0];
        if (forward === undefined) throw new Error('forward is unbound');
        arm(r, 'jump', 1);
        fireWindow('keydown', { code: forward });
        const next = r.previews[0]?.bindings;
        expect(next?.['jump']).toContain(forward);
        expect(next?.['moveForward']).not.toContain(forward);
        expect(notes(r)[0]).toBe(
            `${inputLabel(forward)} was taken off "Move forward", which is now unbound on that key.`,
        );
    });

    it('says nothing when the key was free', () => {
        const r = rig();
        arm(r, 'jump', 1);
        fireWindow('keydown', { code: 'F9' });
        expect(statusNote(r).textContent).toBe('Click a binding to change it. A key taken from another action is removed from it.');
    });

    it('moves a key between an action’s own two slots rather than duplicating it', () => {
        const r = rig();
        const own = r.profile.settings.bindings['jump']?.[0];
        if (own === undefined) throw new Error('jump is unbound');
        arm(r, 'jump', 1);
        fireWindow('keydown', { code: own });
        expect(r.previews[0]?.bindings['jump']).toEqual([own]);
    });

    it('cancels on Escape, consuming it, and leaves the draft alone', () => {
        const r = rig();
        arm(r, 'jump', 0);
        fireWindow('keydown', { code: 'Escape' });
        expect(r.previews).toEqual([]);
        expect(windowCount('keydown')).toBe(0);
        expect(keysOf(bindRowFor(r, 'jump'))[0]?.textContent).not.toBe('PRESS…');
    });

    it('binds a mouse button', () => {
        const r = rig();
        arm(r, 'jump', 1);
        fireWindow('mousedown', { button: 3 });
        expect(r.previews[0]?.bindings['jump']).toContain('Mouse3');
    });

    it('binds the wheel in whichever direction it turned, and ignores a flat one', () => {
        const r = rig();
        arm(r, 'jump', 1);
        fireWindow('wheel', { deltaY: 0 });
        expect(r.previews).toEqual([]);
        fireWindow('wheel', { deltaY: -120 });
        expect(r.previews[0]?.bindings['jump']).toContain('WheelUp');
        arm(r, 'jump', 1);
        fireWindow('wheel', { deltaY: 120 });
        expect(r.previews[1]?.bindings['jump']).toContain('WheelDown');
    });

    it('hands the binding change down the same path a slider uses', () => {
        const r = rig();
        arm(r, 'jump', 1);
        fireWindow('keydown', { code: 'KeyJ' });
        // One record, previewed: the binding map is a field of the draft like any other.
        expect(r.previews).toHaveLength(1);
        expect(r.previews[0]?.fov).toBe(r.profile.settings.fov);
    });

    it('rebinds on a copy, so the saved map is untouched until APPLY', () => {
        const r = rig();
        const before = JSON.stringify(r.profile.settings.bindings);
        arm(r, 'jump', 1);
        fireWindow('keydown', { code: 'KeyJ' });
        expect(JSON.stringify(r.profile.settings.bindings)).toBe(before);
    });

    it('drops the capture when the screen is hidden', () => {
        const r = rig();
        arm(r, 'jump', 0);
        r.settings.hide();
        expect(windowCount('keydown')).toBe(0);
    });

    it('drops the capture when another category is opened', () => {
        const r = rig();
        arm(r, 'jump', 0);
        fire(rail(r)[2] as FakeElement, 'click');
        expect(windowCount('keydown')).toBe(0);
    });

    it('drops the capture when the screen is disposed of', () => {
        const r = rig();
        arm(r, 'jump', 0);
        r.settings.dispose();
        expect(windowCount('keydown')).toBe(0);
    });
});

// ---------------------------------------------------------------------------- info

describe('INFO', () => {
    it('offers the credits and the progress control, in that order', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        expect(sections(r).map((s) => find(s, 'st-sec__title').textContent)).toEqual(['CREDITS', 'PROGRESS']);
        expect(main(r).classList.contains('st-main--tight')).toBe(true);
    });

    it('says once, over the whole list, that every model was modified', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        expect(notes(r)[0]).toContain('used under the licence they published it under');
        expect(notes(r)[0]).toContain('have been modified for PROTOCOL SEVEN');
        expect(notes(r)[1]).toBe(CREDITS_NOTE);
    });

    it('pages the list fourteen at a time, the character credit last', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        expect(pager(r).count).toBe(`1 / ${CREDIT_PAGES}`);
        const shown = findAll(panel(r), 'st-credit__used').map((el) => el.textContent);
        expect(shown).toEqual(ALL_CREDITS.slice(0, 14).map((c) => c.used));
    });

    it('gives every credit its source, its author, its licence and what it is', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        const first = ALL_CREDITS[0];
        if (first === undefined) throw new Error('no credits');
        const source = findAll(panel(r), 'st-credit__source')[0];
        expect(findAll(source as FakeElement, 'st-credit__link')[0]?.textContent).toBe(first.title);
        expect(findAll(source as FakeElement, 'st-credit__by')[0]?.textContent).toBe(` by ${first.author}`);
        const licence = findAll(panel(r), 'st-credit__licence')[0];
        expect(findAll(licence as FakeElement, 'st-credit__link')[0]?.textContent).toBe(first.license);
    });

    it('opens every link in a new tab, with no referrer', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        const links = findAll(panel(r), 'st-credit__link');
        expect(links.length).toBeGreaterThan(0);
        expect(links.every((a) => a.target === '_blank')).toBe(true);
        expect(links.every((a) => a.rel === 'noreferrer noopener')).toBe(true);
        expect(links.every((a) => a.href !== '')).toBe(true);
    });

    it('turns the page, and disables the arrow at each end', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        expect(pager(r).prev.disabled).toBe(true);
        expect(pager(r).next.disabled).toBe(CREDIT_PAGES <= 1);
        fire(pager(r).next, 'click');
        expect(pager(r).count).toBe(`2 / ${CREDIT_PAGES}`);
        expect(pager(r).prev.disabled).toBe(false);
        const shown = findAll(panel(r), 'st-credit__used').map((el) => el.textContent);
        expect(shown).toEqual(ALL_CREDITS.slice(14, 28).map((c) => c.used));
    });

    it('labels its arrows for a reader', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        expect(pager(r).prev.getAttribute('aria-label')).toBe('Previous page of credits');
        expect(pager(r).next.getAttribute('aria-label')).toBe('Next page of credits');
        expect(pager(r).el.className).toBe('lo-pager st-pager');
    });

    it('goes back to the first page on a category change and on a fresh show', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        fire(pager(r).next, 'click');
        fire(rail(r)[0] as FakeElement, 'click');
        r.settings.openTab('INFO');
        expect(pager(r).count).toBe(`1 / ${CREDIT_PAGES}`);
        fire(pager(r).next, 'click');
        r.settings.show();
        r.settings.openTab('INFO');
        expect(pager(r).count).toBe(`1 / ${CREDIT_PAGES}`);
    });

    it('arms the reset on the first click and spells out what goes', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        const reset = find(find(panel(r), 'st-danger'), 'st-reset');
        expect(reset.children[0]?.textContent).toBe('RESET PROGRESS');
        expect(reset.classList.contains('op-cta--danger')).toBe(false);
        fire(reset, 'click');
        const armed = find(find(panel(r), 'st-danger'), 'st-reset');
        expect(armed.children[0]?.textContent).toBe('CONFIRM — ERASE ALL PROGRESS');
        expect(armed.classList.contains('op-cta--danger')).toBe(true);
        expect(find(panel(r), 'st-danger__warn').textContent).toBe(
            'LEVEL, UNLOCKS, CAMOS AND CLASSES. SETTINGS ARE KEPT.',
        );
        expect(r.resets).toEqual([]);
    });

    it('wipes on the second click, and disarms itself', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        fire(find(find(panel(r), 'st-danger'), 'st-reset'), 'click');
        fire(find(find(panel(r), 'st-danger'), 'st-reset'), 'click');
        expect(r.resets).toEqual([1]);
        expect(find(find(panel(r), 'st-danger'), 'st-reset').children[0]?.textContent).toBe('RESET PROGRESS');
        expect(findAll(panel(r), 'st-danger__warn')).toEqual([]);
    });

    it('disarms when the player goes somewhere else and comes back', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        fire(find(find(panel(r), 'st-danger'), 'st-reset'), 'click');
        fire(rail(r)[0] as FakeElement, 'click');
        r.settings.openTab('INFO');
        expect(find(find(panel(r), 'st-danger'), 'st-reset').children[0]?.textContent).toBe('RESET PROGRESS');
    });

    it('disarms on a fresh show', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('INFO');
        fire(find(find(panel(r), 'st-danger'), 'st-reset'), 'click');
        r.settings.show();
        r.settings.openTab('INFO');
        expect(find(find(panel(r), 'st-danger'), 'st-reset').children[0]?.textContent).toBe('RESET PROGRESS');
    });
});

// ---------------------------------------------------------------------------- the two buttons

describe('APPLY and BACK', () => {
    it('stand on the panel’s foot, BACK quiet and APPLY primary', () => {
        const r = rig();
        r.settings.show();
        const { back, apply } = foot(r);
        expect(back.className).toBe('op-cta op-cta--quiet st-back');
        expect(apply.className).toBe('op-cta op-cta--primary st-apply');
        expect(back.children[1]?.textContent).toBe('BACK');
        expect(apply.children[1]?.textContent).toBe('APPLY');
    });

    it('APPLY hands the draft over and leaves', () => {
        const r = rig();
        r.settings.show();
        slide(r, 'Field of view', 111);
        fire(foot(r).apply, 'click');
        expect(r.commits).toHaveLength(1);
        expect(r.commits[0]?.fov).toBe(111);
        expect(r.backs).toEqual([1]);
    });

    it('BACK previews the saved record again, then leaves', () => {
        const r = rig();
        r.settings.show();
        slide(r, 'Field of view', 111);
        fire(foot(r).back, 'click');
        expect(r.commits).toEqual([]);
        expect(r.previews[r.previews.length - 1]).toBe(r.profile.settings);
        expect(r.previews[r.previews.length - 1]?.fov).toBe(FALLBACK.fov);
        expect(r.backs).toEqual([1]);
    });

    it('is a fresh draft on the next show, so a reverted change is gone', () => {
        const r = rig();
        r.settings.show();
        slide(r, 'Field of view', 111);
        fire(foot(r).back, 'click');
        r.settings.show();
        expect(row(r, 'Field of view').range?.value).toBe(String(FALLBACK.fov));
    });

    it('copies the binding lists into the draft, not just the record', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        const key = keysOf(bindRowFor(r, 'jump'))[1];
        if (key === undefined) throw new Error('no slot');
        fire(key, 'click');
        fireWindow('keydown', { code: 'KeyJ' });
        const draft = r.previews[0];
        expect(draft?.bindings).not.toBe(r.profile.settings.bindings);
        expect(draft?.bindings['jump']).not.toBe(r.profile.settings.bindings['jump']);
    });
});

describe('Escape', () => {
    it('cancels an armed capture and reports itself consumed', () => {
        const r = rig();
        r.settings.show();
        r.settings.openTab('BINDINGS');
        fire(keysOf(bindRowFor(r, 'jump'))[0] as FakeElement, 'click');
        expect(r.settings.handleEscape()).toBe(true);
        expect(windowCount('keydown')).toBe(0);
        expect(r.previews).toEqual([]);
    });

    it('reverts and reports itself unconsumed when nothing is armed, so the caller leaves', () => {
        const r = rig();
        r.settings.show();
        slide(r, 'Field of view', 115);
        expect(r.settings.handleEscape()).toBe(false);
        expect(r.previews[r.previews.length - 1]).toBe(r.profile.settings);
        expect(r.backs).toEqual([]);
    });

    it('reverts without committing anything', () => {
        const r = rig();
        r.settings.show();
        slide(r, 'Field of view', 115);
        r.settings.handleEscape();
        expect(r.commits).toEqual([]);
        expect(r.profile.settings.fov).toBe(FALLBACK.fov);
    });
});
