import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_LEVEL, prestigeLabel } from '../../shared/meta/Levels';
import { defaultSettings } from '../../shared/meta/SaveData';
import { characterDefinition, BOT_CHARACTER_IDS } from '../characters/CharacterCatalog';
import { Profile } from '../meta/Profile';
import { levelLine, PlayerCard } from './PlayerCard';

/**
 * Characterization tests for the player card (refactor unit C18, written before the refactor).
 *
 * Two facts and a dot, which is the whole of R2.1 — so what is worth pinning is that the card
 * reads the profile *afresh* on every `refresh`, that the dot says only what it can know, and
 * that the optional level argument is the debrief's: the card trails the banked level until
 * the XP bar's flourish catches up with it.
 *
 * The document is a double; the `Profile`, the character catalogue and the level table are the
 * product's own.
 */

// ---------------------------------------------------------------------------- the DOM double

class FakeElement {
    readonly tokens = new Set<string>();
    readonly children: FakeElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, (() => void)[]>();
    textContent = '';
    hidden = false;
    type = '';
    title = '';
    src = '';
    alt = '';
    draggable = true;
    parent: FakeElement | null = null;

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

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    addEventListener(type: string, fn: () => void): void {
        const held = this.listeners.get(type);
        if (held === undefined) this.listeners.set(type, [fn]);
        else held.push(fn);
    }
}

function fire(el: FakeElement, type: string): void {
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn();
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
    readonly card: PlayerCard;
    readonly profile: Profile;
    readonly root: FakeElement;
    readonly opens: number[];
    online: boolean;
}

function rig(): Rig {
    const profile = new Profile({ fallbackSettings: FALLBACK });
    const opens: number[] = [];
    const state = { online: true };
    const card = new PlayerCard({
        profile,
        online: () => state.online,
        onOpenProfile: () => opens.push(1),
    });
    return {
        card,
        profile,
        root: card.element as unknown as FakeElement,
        opens,
        get online() {
            return state.online;
        },
        set online(value: boolean) {
            state.online = value;
        },
    };
}

function parts(root: FakeElement) {
    const [portrait, text, rule, gear] = root.children;
    if (portrait === undefined || text === undefined || rule === undefined || gear === undefined) {
        throw new Error('the card is missing a part');
    }
    const [avatar, dot] = portrait.children;
    const [name, level] = text.children;
    if (avatar === undefined || dot === undefined || name === undefined || level === undefined) {
        throw new Error('the card is missing a leaf');
    }
    return { portrait, text, rule, gear, avatar, dot, name, level };
}

// ---------------------------------------------------------------------------- the tests

describe('the card it builds', () => {
    it('is a portrait, two lines of text, a rule and the gear', () => {
        const { root } = rig();
        expect(root.className).toBe('op-card');
        expect(root.children.map((c) => c.className)).toEqual([
            'op-card__portrait',
            'op-card__text',
            'op-card__rule',
            'op-card__gear',
        ]);
    });

    it('puts the presence dot on the avatar', () => {
        const { root } = rig();
        const { avatar, dot } = parts(root);
        expect(avatar.className).toBe('op-card__avatar');
        expect(avatar.alt).toBe('');
        expect(avatar.draggable).toBe(false);
        expect(dot.tag).toBe('i');
    });

    it('labels the gear for a reader and gives it a tooltip', () => {
        const { root } = rig();
        const { gear } = parts(root);
        expect(gear.type).toBe('button');
        expect(gear.title).toBe('Player profile');
        expect(gear.getAttribute('aria-label')).toBe('Player profile');
        expect(gear.children[0]?.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    it('opens the profile from the gear and from nothing else', () => {
        const r = rig();
        const { gear, name, avatar } = parts(r.root);
        fire(name, 'click');
        fire(avatar, 'click');
        expect(r.opens).toEqual([]);
        fire(gear, 'click');
        expect(r.opens).toEqual([1]);
    });

    it('has read the profile once by the time the constructor returns', () => {
        const r = rig();
        const { name, avatar } = parts(r.root);
        expect(name.textContent).toBe(r.profile.settings.callsign);
        expect(avatar.src).toBe(characterDefinition(r.profile.skinId).thumbUrl);
    });
});

describe('what refresh reads', () => {
    it('takes the callsign from the profile every time', () => {
        const r = rig();
        const { name } = parts(r.root);
        r.profile.patchSettings({ callsign: 'VULTURE' });
        r.card.refresh();
        expect(name.textContent).toBe('VULTURE');
        r.profile.patchSettings({ callsign: 'MAGPIE' });
        r.card.refresh();
        expect(name.textContent).toBe('MAGPIE');
    });

    it('follows the skin', () => {
        const r = rig();
        const { avatar } = parts(r.root);
        const other = BOT_CHARACTER_IDS.find((id) => id !== r.profile.skinId);
        if (other === undefined) throw new Error('only one skin');
        r.profile.setSkin(other);
        r.card.refresh();
        expect(avatar.src).toBe(characterDefinition(other).thumbUrl);
    });

    it('writes the avatar only when it is not already the skin’s, which also repairs it', () => {
        const r = rig();
        const { avatar } = parts(r.root);
        const wanted = characterDefinition(r.profile.skinId).thumbUrl;
        // The guard is against the URL the card *wants*, not against "did I write it" — so a
        // refresh over an unchanged src assigns nothing, and over a wrong one puts it back.
        avatar.src = wanted;
        r.card.refresh();
        expect(avatar.src).toBe(wanted);
        avatar.src = 'SOMETHING ELSE';
        r.card.refresh();
        expect(avatar.src).toBe(wanted);
    });

    it('says the level the profile is on', () => {
        const r = rig();
        const { level } = parts(r.root);
        expect(level.textContent).toBe(`LEVEL ${r.profile.progress.level}`);
        r.profile.maxAccountLevel();
        r.card.refresh();
        expect(level.textContent).toBe(`LEVEL ${MAX_LEVEL} (MAX)`);
    });

    it('says the level it was handed instead, which is the debrief’s', () => {
        const r = rig();
        const { level } = parts(r.root);
        r.profile.maxAccountLevel();
        // The bar is still showing 7 while the banked level is the cap.
        r.card.refresh(7);
        expect(level.textContent).toBe('LEVEL 7');
        r.card.refresh();
        expect(level.textContent).toBe(`LEVEL ${MAX_LEVEL} (MAX)`);
    });
});

describe('the dot', () => {
    it('is lit and titled when a server is configured', () => {
        const r = rig();
        const { dot } = parts(r.root);
        expect(dot.classList.contains('is-online')).toBe(true);
        expect(dot.title).toBe('Server configured');
    });

    it('goes out when there is none, and says so', () => {
        const r = rig();
        r.online = false;
        r.card.refresh();
        const { dot } = parts(r.root);
        expect(dot.classList.contains('is-online')).toBe(false);
        expect(dot.title).toBe('No server configured');
    });

    it('is asked afresh on every refresh', () => {
        const r = rig();
        const { dot } = parts(r.root);
        r.online = false;
        r.card.refresh();
        expect(dot.classList.contains('is-online')).toBe(false);
        r.online = true;
        r.card.refresh();
        expect(dot.classList.contains('is-online')).toBe(true);
    });
});

describe('the level line', () => {
    it('is LEVEL N below the cap', () => {
        const r = rig();
        expect(levelLine(r.profile, 1)).toBe('LEVEL 1');
        expect(levelLine(r.profile, 31)).toBe('LEVEL 31');
    });

    it('says MAX at the cap and above it', () => {
        const r = rig();
        expect(levelLine(r.profile, MAX_LEVEL)).toBe(`LEVEL ${MAX_LEVEL} (MAX)`);
        expect(levelLine(r.profile, MAX_LEVEL + 4)).toBe(`LEVEL ${MAX_LEVEL} (MAX)`);
    });

    it('leads with the prestige badge once the cap has been passed', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.profile.doPrestige();
        expect(r.profile.prestige).toBeGreaterThan(0);
        expect(levelLine(r.profile, 3)).toBe(`PRESTIGE ${prestigeLabel(r.profile.prestige)} · LEVEL 3`);
    });

    it('falls back to the profile’s own level when none is given', () => {
        const r = rig();
        expect(levelLine(r.profile)).toBe(`LEVEL ${r.profile.progress.level}`);
    });
});
