import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { camoDef } from '../../shared/meta/Camos';
import { CHALLENGES } from '../../shared/meta/Challenges';
import { prestigeLabel } from '../../shared/meta/Levels';
import { defaultSettings } from '../../shared/meta/SaveData';
import { BOT_CHARACTER_IDS, characterDefinition } from '../characters/CharacterCatalog';
import { Profile } from '../meta/Profile';
import { ProfilePanel } from './ProfilePanel';

/**
 * Characterization tests for the profile panel (refactor unit C18, written before the
 * refactor).
 *
 * Three tabs over one `Profile`, built once and repainted from the save on every `open`, so
 * what is pinned is mostly *what each tab reads* — and the two rules the panel is built on:
 * the scrim closes it and the panel does not, and the callsign is written on every keystroke
 * and never validated before entry (§6.1's rule, kept where the field moved).
 *
 * The thirty challenges are the real `CHALLENGES` table; the seven skins are the real
 * catalogue. Only the document is a double.
 */

// ---------------------------------------------------------------------------- the DOM double

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
    key?: string;
    stopPropagation: () => void;
    preventDefault: () => void;
}

class FakeElement {
    readonly tokens = new Set<string>();
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Listener[]>();
    readonly dataset: Record<string, string> = {};
    readonly style: Record<string, string> = {};
    textContent = '';
    hidden = false;
    type = '';
    value = '';
    maxLength = -1;
    spellcheck = true;
    autocomplete = '';
    title = '';
    src = '';
    alt = '';
    draggable = true;
    parent: FakeElement | null = null;
    focusCount = 0;

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

    focus(): void {
        this.focusCount++;
    }

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

function fire(el: FakeElement, type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { stopPropagation: () => undefined, preventDefault: () => undefined, ...over };
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
}

beforeEach(() => {
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
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
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        setTimeout: (): number => 1,
        clearTimeout: (): void => undefined,
    };
});

afterEach(() => {
    for (const key of ['document', 'HTMLElement', 'localStorage', 'window']) {
        delete (globalThis as Record<string, unknown>)[key];
    }
});

// ---------------------------------------------------------------------------- the rig

const FALLBACK = defaultSettings('TDM', 'mp_foundry', 90);

interface Rig {
    readonly panel: ProfilePanel;
    readonly profile: Profile;
    readonly overlay: FakeElement;
    readonly names: string[];
    readonly changes: number[];
    readonly closes: number[];
}

function rig(): Rig {
    const profile = new Profile({ fallbackSettings: FALLBACK });
    const names: string[] = [];
    const changes: number[] = [];
    const closes: number[] = [];
    const panel = new ProfilePanel({
        profile,
        onDisplayName: (n) => names.push(n),
        onChange: () => changes.push(1),
        onClose: () => closes.push(1),
    });
    return { panel, profile, overlay: panel.element as unknown as FakeElement, names, changes, closes };
}

function dialog(r: Rig): FakeElement {
    const found = r.overlay.children[0];
    if (found === undefined) throw new Error('the overlay holds no panel');
    return found;
}

function tabs(r: Rig): FakeElement[] {
    return dialog(r).querySelectorAll('.op-tab').filter((b) => b.dataset['tab'] !== undefined);
}

function body(r: Rig): FakeElement {
    return dialog(r).querySelectorAll('.op-profile__body')[0] as FakeElement;
}

function find(root: FakeElement, token: string): FakeElement {
    const found = root.querySelectorAll(token)[0];
    if (found === undefined) throw new Error(`no element carrying .${token}`);
    return found;
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    return root.querySelectorAll(token);
}

const CATEGORIES = ['COMBAT', 'PRECISION', 'MOVEMENT', 'TACTICAL', 'MASTERY', 'CAMO'] as const;

// ---------------------------------------------------------------------------- the tests

describe('the overlay it builds', () => {
    it('is a hidden scrim holding one labelled dialog', () => {
        const r = rig();
        expect(r.overlay.className).toBe('op-profile');
        expect(r.overlay.hidden).toBe(true);
        expect(dialog(r).className).toBe('op-profile__panel');
        expect(dialog(r).getAttribute('role')).toBe('dialog');
        expect(dialog(r).getAttribute('aria-label')).toBe('Player profile');
    });

    it('lays the dialog out as a head, the tabs and a body', () => {
        const r = rig();
        expect(dialog(r).children.map((c) => c.className)).toEqual([
            'op-profile__head',
            'op-tabs op-profile__tabs',
            'op-profile__body',
        ]);
    });

    it('titles itself and offers a close button', () => {
        const r = rig();
        const head = dialog(r).children[0];
        expect(head?.children[0]?.textContent).toBe('PLAYER PROFILE');
        expect(head?.children[1]?.textContent).toBe('✕');
        expect(head?.children[1]?.getAttribute('aria-label')).toBe('Close');
    });

    it('offers the three tabs, by id', () => {
        const r = rig();
        expect(tabs(r).map((b) => b.dataset['tab'])).toEqual(['overview', 'achievements', 'appearance']);
        expect(tabs(r).map((b) => b.textContent)).toEqual(['OVERVIEW', 'ACHIEVEMENTS', 'APPEARANCE']);
    });

    it('paints nothing until it is opened', () => {
        const r = rig();
        expect(body(r).children).toEqual([]);
        expect(r.panel.isOpen).toBe(false);
    });
});

describe('opening and closing it', () => {
    it('opens on the overview by default, and reports itself open', () => {
        const r = rig();
        r.panel.open();
        expect(r.overlay.hidden).toBe(false);
        expect(r.panel.isOpen).toBe(true);
        expect(findAll(body(r), 'op-profile__overview')).toHaveLength(1);
    });

    it('opens on whichever tab it is asked for, and marks it', () => {
        const r = rig();
        r.panel.open('achievements');
        expect(findAll(body(r), 'op-profile__achievements')).toHaveLength(1);
        expect(tabs(r).map((b) => b.classList.contains('op-tab--on'))).toEqual([false, true, false]);
        r.panel.open('appearance');
        expect(findAll(body(r), 'op-profile__skins')).toHaveLength(1);
        expect(tabs(r).map((b) => b.classList.contains('op-tab--on'))).toEqual([false, false, true]);
    });

    it('puts the keyboard on the open tab', () => {
        const r = rig();
        r.panel.open('appearance');
        expect(tabs(r)[2]?.focusCount).toBe(1);
    });

    it('switches tab from the row', () => {
        const r = rig();
        r.panel.open();
        fire(tabs(r)[1] as FakeElement, 'click');
        expect(findAll(body(r), 'op-profile__achievements')).toHaveLength(1);
    });

    it('closes on the scrim, and tells the host', () => {
        const r = rig();
        r.panel.open();
        fire(r.overlay, 'click');
        expect(r.overlay.hidden).toBe(true);
        expect(r.panel.isOpen).toBe(false);
        expect(r.closes).toEqual([1]);
    });

    it('does not close on a click inside the dialog', () => {
        const r = rig();
        r.panel.open();
        fire(dialog(r), 'click');
        expect(r.panel.isOpen).toBe(true);
        expect(r.closes).toEqual([]);
    });

    it('closes on the close button', () => {
        const r = rig();
        r.panel.open();
        fire(dialog(r).children[0]?.children[1] as FakeElement, 'click');
        expect(r.panel.isOpen).toBe(false);
    });

    it('tells the host once, however many times close is called', () => {
        const r = rig();
        r.panel.open();
        r.panel.close();
        r.panel.close();
        expect(r.closes).toEqual([1]);
    });

    it('consumes Escape while open and lets it through while closed', () => {
        const r = rig();
        expect(r.panel.handleEscape()).toBe(false);
        r.panel.open();
        expect(r.panel.handleEscape()).toBe(true);
        expect(r.panel.isOpen).toBe(false);
        expect(r.closes).toEqual([1]);
    });

    it('swallows every key but Escape, because a canvas owns the keyboard below', () => {
        const r = rig();
        r.panel.open();
        let stopped = 0;
        const count = (key: string): void => {
            for (const fn of [...(dialog(r).listeners.get('keydown') ?? [])]) {
                fn({ key, stopPropagation: () => stopped++, preventDefault: () => undefined });
            }
        };
        count('w');
        expect(stopped).toBe(1);
        count('Escape');
        expect(stopped).toBe(1);
    });

    it('repaints from the profile on every open', () => {
        const r = rig();
        r.panel.open();
        r.profile.patchSettings({ callsign: 'VULTURE' });
        r.panel.close();
        r.panel.open();
        expect(find(body(r), 'op-profile__name').value).toBe('VULTURE');
    });
});

describe('OVERVIEW', () => {
    it('shows the chosen skin, large and named', () => {
        const r = rig();
        r.panel.open();
        const skin = characterDefinition(r.profile.skinId);
        expect(find(body(r), 'op-profile__portrait-img').src).toBe(skin.thumbUrl);
        expect(find(body(r), 'op-profile__portrait-img').draggable).toBe(false);
        expect(find(body(r), 'op-profile__portrait').children[1]?.textContent).toBe(skin.name);
    });

    it('prefills the callsign field and caps it at twenty', () => {
        const r = rig();
        r.panel.open();
        const input = find(body(r), 'op-profile__name');
        expect(input.type).toBe('text');
        expect(input.value).toBe(r.profile.settings.callsign);
        expect(input.maxLength).toBe(20);
        expect(input.spellcheck).toBe(false);
        expect(input.autocomplete).toBe('off');
        expect(find(body(r), 'op-profile__field').children[0]?.textContent).toBe('CALLSIGN');
    });

    it('writes the callsign on every keystroke, never gating it', () => {
        const r = rig();
        r.panel.open();
        const input = find(body(r), 'op-profile__name');
        input.value = 'V';
        fire(input, 'input');
        input.value = 'VU';
        fire(input, 'input');
        input.value = '';
        fire(input, 'input');
        expect(r.names).toEqual(['V', 'VU', '']);
        expect(r.changes).toHaveLength(3);
    });

    it('draws the level, its bar and the XP to the next one', () => {
        const r = rig();
        r.panel.open();
        const progress = r.profile.progress;
        expect(find(body(r), 'op-profile__level-num').textContent).toBe(String(progress.level));
        expect(find(body(r), 'op-profile__bar').children[0]?.style['transform']).toBe(
            `scaleX(${progress.fraction.toFixed(4)})`,
        );
        expect(find(body(r), 'op-profile__dim').textContent).toBe(
            `${progress.into.toLocaleString()} / ${progress.span.toLocaleString()} XP TO ${progress.level + 1}`,
        );
    });

    it('says MAX LEVEL instead of a target once the cap is reached', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.panel.open();
        expect(find(body(r), 'op-profile__dim').textContent).toBe('MAX LEVEL · PRESTIGE AVAILABLE');
        expect(find(body(r), 'op-profile__bar').children[0]?.style['transform']).toBe('scaleX(1.0000)');
    });

    it('lists prestige, tokens, the record and the achievement count', () => {
        const r = rig();
        r.panel.open();
        const rows = find(body(r), 'op-profile__rows');
        const keys = rows.children.filter((c) => c.tag === 'dt').map((c) => c.textContent);
        const values = rows.children.filter((c) => c.tag === 'dd').map((c) => c.textContent);
        expect(keys).toEqual(['PRESTIGE', 'UNLOCK TOKENS', 'RECORD', 'ACHIEVEMENTS']);
        expect(values[0]).toBe('—');
        expect(values[1]).toBe(String(r.profile.unlockTokens));
        expect(values[2]).toBe('0 / 0 WON');
        expect(values[3]).toBe(`0 / ${CHALLENGES.length}`);
    });

    it('names the prestige once there is one', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.profile.doPrestige();
        r.panel.open();
        const rows = find(body(r), 'op-profile__rows');
        expect(rows.children.filter((c) => c.tag === 'dd')[0]?.textContent).toBe(prestigeLabel(r.profile.prestige));
    });
});

describe('ACHIEVEMENTS', () => {
    it('offers the six categories, each with its done-of-total', () => {
        const r = rig();
        r.panel.open('achievements');
        const cats = find(body(r), 'op-profile__cats');
        expect(cats.children.map((c) => c.textContent)).toEqual(
            CATEGORIES.map((c) => `${c} 0/${CHALLENGES.filter((ch) => ch.category === c).length}`),
        );
    });

    it('opens on COMBAT and lists only that category', () => {
        const r = rig();
        r.panel.open('achievements');
        const cats = find(body(r), 'op-profile__cats');
        expect(cats.children.map((c) => c.classList.contains('op-tab--on'))).toEqual([
            true,
            false,
            false,
            false,
            false,
            false,
        ]);
        expect(findAll(body(r), 'op-profile__row')).toHaveLength(
            CHALLENGES.filter((c) => c.category === 'COMBAT').length,
        );
    });

    it('switches category and keeps the tab', () => {
        const r = rig();
        r.panel.open('achievements');
        fire(find(body(r), 'op-profile__cats').children[4] as FakeElement, 'click');
        expect(findAll(body(r), 'op-profile__achievements')).toHaveLength(1);
        expect(findAll(body(r), 'op-profile__row')).toHaveLength(
            CHALLENGES.filter((c) => c.category === 'MASTERY').length,
        );
    });

    it('gives every row a name, a description, a bar, a count and the XP it pays', () => {
        const r = rig();
        r.panel.open('achievements');
        const first = CHALLENGES.find((c) => c.category === 'COMBAT');
        if (first === undefined) throw new Error('no combat challenges');
        const rowEl = findAll(body(r), 'op-profile__row')[0] as FakeElement;
        expect(find(rowEl, 'op-profile__row-name').textContent).toBe(first.name);
        expect(find(rowEl, 'op-profile__row-desc').textContent).toBe(first.description);
        expect(find(rowEl, 'op-profile__bar').children[0]?.style['transform']).toBe('scaleX(0.0000)');
        expect(findAll(rowEl, 'op-num')[0]?.textContent).toBe(`0 / ${first.target}`);
        expect(find(rowEl, 'op-profile__row-reward').children[0]?.textContent).toBe(`+${first.xp} XP`);
        expect(rowEl.classList.contains('is-done')).toBe(false);
    });

    it('draws a part-finished challenge as a fraction of its target', () => {
        const r = rig();
        const def = CHALLENGES.find((c) => c.category === 'COMBAT' && c.target >= 4);
        if (def === undefined) throw new Error('no countable combat challenge');
        r.profile.challenge(def.id).progress = Math.floor(def.target / 2);
        r.panel.open('achievements');
        const rowEl = findAll(body(r), 'op-profile__row').find((el) => find(el, 'op-profile__row-name').textContent === def.name);
        if (rowEl === undefined) throw new Error('row missing');
        const fraction = Math.min(1, Math.floor(def.target / 2) / def.target);
        expect(find(rowEl, 'op-profile__bar').children[0]?.style['transform']).toBe(`scaleX(${fraction.toFixed(4)})`);
    });

    it('says DONE and marks the row once a challenge is complete', () => {
        const r = rig();
        const def = CHALLENGES.find((c) => c.category === 'COMBAT');
        if (def === undefined) throw new Error('no combat challenges');
        const state = r.profile.challenge(def.id);
        state.progress = def.target;
        state.completed = true;
        r.panel.open('achievements');
        const rowEl = findAll(body(r), 'op-profile__row').find((el) => find(el, 'op-profile__row-name').textContent === def.name);
        if (rowEl === undefined) throw new Error('row missing');
        expect(rowEl.classList.contains('is-done')).toBe(true);
        expect(findAll(rowEl, 'op-num')[0]?.textContent).toBe('DONE');
    });

    it('counts a completed challenge on its category tab and on the overview', () => {
        const r = rig();
        const def = CHALLENGES.find((c) => c.category === 'COMBAT');
        if (def === undefined) throw new Error('no combat challenges');
        r.profile.challenge(def.id).completed = true;
        r.panel.open('achievements');
        const all = CHALLENGES.filter((c) => c.category === 'COMBAT').length;
        expect(find(body(r), 'op-profile__cats').children[0]?.textContent).toBe(`COMBAT 1/${all}`);
        r.panel.open('overview');
        const rows = find(body(r), 'op-profile__rows');
        expect(rows.children.filter((c) => c.tag === 'dd')[3]?.textContent).toBe(`1 / ${CHALLENGES.length}`);
    });

    it('shows the camo a challenge awards, with its swatch, and nothing where there is none', () => {
        const r = rig();
        const withCamo = CHALLENGES.find((c) => c.camo !== undefined);
        if (withCamo === undefined) throw new Error('no camo challenge');
        r.panel.open('achievements');
        fire(
            find(body(r), 'op-profile__cats').children[CATEGORIES.indexOf(withCamo.category)] as FakeElement,
            'click',
        );
        const rowEl = findAll(body(r), 'op-profile__row').find((el) => find(el, 'op-profile__row-name').textContent === withCamo.name);
        if (rowEl === undefined) throw new Error('row missing');
        const camo = camoDef(withCamo.camo as Parameters<typeof camoDef>[0]);
        const swatch = find(rowEl, 'op-profile__swatch');
        expect(swatch.style['background']).toBe(camo.swatch);
        expect(swatch.title).toBe(`${camo.name} camo`);
        expect(find(rowEl, 'op-profile__row-reward').children[2]?.textContent).toBe(camo.name);
        const without = CHALLENGES.find((c) => c.camo === undefined && c.category === withCamo.category);
        if (without !== undefined) {
            const plain = findAll(body(r), 'op-profile__row').find((el) => find(el, 'op-profile__row-name').textContent === without.name);
            expect(plain === undefined ? 1 : plain.querySelectorAll('op-profile__swatch').length).toBe(0);
        }
    });
});

describe('APPEARANCE', () => {
    it('is a labelled listbox of every skin', () => {
        const r = rig();
        r.panel.open('appearance');
        const grid = find(body(r), 'op-profile__skins');
        expect(grid.getAttribute('role')).toBe('listbox');
        expect(grid.getAttribute('aria-label')).toBe('Skins');
        expect(grid.children).toHaveLength(BOT_CHARACTER_IDS.length);
        expect(grid.children.map((t) => t.getAttribute('role'))).toEqual(
            BOT_CHARACTER_IDS.map(() => 'option'),
        );
    });

    it('names each skin and shows its thumbnail, undraggable', () => {
        const r = rig();
        r.panel.open('appearance');
        const tiles = findAll(body(r), 'op-profile__skin');
        expect(tiles.map((t) => t.children[1]?.textContent)).toEqual(
            BOT_CHARACTER_IDS.map((id) => characterDefinition(id).name),
        );
        expect(tiles.every((t) => t.children[0]?.draggable === false)).toBe(true);
    });

    it('marks the chosen one and no other', () => {
        const r = rig();
        r.panel.open('appearance');
        const at = BOT_CHARACTER_IDS.indexOf(r.profile.skinId);
        expect(findAll(body(r), 'op-profile__skin').map((t) => t.classList.contains('is-on'))).toEqual(
            BOT_CHARACTER_IDS.map((_id, i) => i === at),
        );
        expect(findAll(body(r), 'op-profile__skin')[at]?.getAttribute('aria-selected')).toBe('true');
    });

    it('picks a skin into the profile, tells the host and repaints the mark', () => {
        const r = rig();
        r.panel.open('appearance');
        const at = BOT_CHARACTER_IDS.indexOf(r.profile.skinId);
        const other = at === 0 ? 1 : 0;
        fire(findAll(body(r), 'op-profile__skin')[other] as FakeElement, 'click');
        expect(r.profile.skinId).toBe(BOT_CHARACTER_IDS[other]);
        expect(r.changes).toEqual([1]);
        expect(findAll(body(r), 'op-profile__skin')[other]?.classList.contains('is-on')).toBe(true);
        expect(findAll(body(r), 'op-profile__skin')[at]?.classList.contains('is-on')).toBe(false);
    });

    it('carries the new skin onto the overview’s portrait', () => {
        const r = rig();
        r.panel.open('appearance');
        const at = BOT_CHARACTER_IDS.indexOf(r.profile.skinId);
        const other = at === 0 ? 1 : 0;
        fire(findAll(body(r), 'op-profile__skin')[other] as FakeElement, 'click');
        r.panel.open('overview');
        const id = BOT_CHARACTER_IDS[other];
        if (id === undefined) throw new Error('no second skin');
        expect(find(body(r), 'op-profile__portrait-img').src).toBe(characterDefinition(id).thumbUrl);
    });
});
