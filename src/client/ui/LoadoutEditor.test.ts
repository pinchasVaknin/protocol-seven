import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { camoDef, CAMO_IDS } from '../../shared/meta/Camos';
import { fieldUpgradeDef, FIELD_UPGRADE_IDS } from '../../shared/meta/FieldUpgrades';
import type { LoadoutSlot } from '../../shared/meta/Loadouts';
import { defaultSettings } from '../../shared/meta/SaveData';
import { attachmentsForWeapon } from '../../shared/meta/Unlocks';
import { perkDef, perksOfTier } from '../../shared/perks/PerkDefs';
import { STREAK_DEFS } from '../../shared/streaks/StreakDefs';
import { attachmentDef } from '../../shared/weapons/Attachments';
import { ALL_WEAPONS, requireWeapon } from '../../shared/weapons/WeaponDefs';
import { ALL_EQUIPMENT, equipmentDef } from '../../shared/equipment/EquipmentDefs';
import { CharacterAssetService } from '../characters/CharacterAssetService';
import { BOT_CHARACTER_IDS, characterDefinition } from '../characters/CharacterCatalog';
import { Profile } from '../meta/Profile';
import { LoadoutEditor } from './LoadoutEditor';
import { FakeElement } from './testing/dom';

/**
 * Characterization tests for Create-a-Class (refactor unit C16, written before the refactor).
 *
 * ## What is a double here and what is not
 *
 * The document is a double and the GPU is absent; everything else is the product's own. A real
 * `Profile` over a map-backed `localStorage`, the real `UnlockState` behind it, the real weapon,
 * attachment, camo, perk, streak and field-upgrade registries, the real `CharacterStage`,
 * `WeaponPreview`, `PlayerCard`, `ProfilePanel` and `LoadoutStats`, and the real
 * `CharacterAssetService` over a repository whose promise never settles — which is the editor's
 * normal first second, the operator not having arrived yet.
 *
 * The two stages build their `WebGLRenderer` on their first `tick` rather than in their
 * constructor, which is the whole reason this screen is constructible in node. `tick` while
 * visible is therefore the one thing here that stays **browser-verified**; everything below is
 * pinned.
 *
 * ## The timers
 *
 * `window.setTimeout` is a list. The editor's hover hold is a 50 ms debounce and `Profile`'s
 * save is debounced too, so a test that wants either has to run the queue itself — which is
 * also the only way to tell a cancelled debounce from a slow one.
 */

// ---------------------------------------------------------------------------- the DOM double

interface FakeEvent {
    key?: string;
    clientX?: number;
    clientY?: number;
    preventDefault: () => void;
    stopPropagation: () => void;
}

/**
 * The element class is shared: `testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 140 lines of it. This file keeps its own environment: the shared
 * `installFakeDom` installs globals this suite has never run with, and handing a suite a
 * `window` on the way past is how a green suite starts meaning something else.
 *
 * Two things are its own and `EditorElement` below keeps both -- see that class. Its own
 * `setAttribute` did not reflect `class` and the shared one does; its `toDataURL` spelled the
 * tag into the data URL where the shared one ends in `x`, and the one assertion on it checks the
 * `data:image/png;base64,` prefix, which both satisfy.
 */


/** Fire one listener type on an element, with the event shape the handlers actually read. */
function fire(el: FakeElement, type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined, ...over };
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
}

// ---------------------------------------------------------------------------- the environment

let storage: Map<string, string>;
let timers: Array<(() => void) | null>;

function installEnvironment(): void {
    storage = new Map();
    timers = [];
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
        createElement: (tag: string) => new EditorElement(tag),
        createElementNS: (_ns: string, tag: string) => new EditorElement(tag),
        activeElement: null,
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        innerWidth: 1920,
        innerHeight: 1080,
        devicePixelRatio: 1,
        setTimeout: (fn: () => void): number => {
            timers.push(fn);
            return timers.length;
        },
        clearTimeout: (id: number): void => {
            if (typeof id === 'number' && id >= 1 && id <= timers.length) timers[id - 1] = null;
        },
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
    };
}

/** Run every timer that has not been cancelled. The hover hold and the save both live here. */
function runTimers(): void {
    for (let i = 0; i < timers.length; i++) {
        const fn = timers[i];
        timers[i] = null;
        if (fn !== null && fn !== undefined) fn();
    }
}

/** How many timers are still waiting to fire. A cancelled debounce leaves none. */
function pendingTimers(): number {
    return timers.filter((t) => t !== null && t !== undefined).length;
}

beforeEach(() => {
    installEnvironment();
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)['document'];
    delete (globalThis as Record<string, unknown>)['HTMLElement'];
    delete (globalThis as Record<string, unknown>)['localStorage'];
    delete (globalThis as Record<string, unknown>)['window'];
});

/**
 * The two answers this suite's own double gave that the shared class does not.
 *
 * **An unmeasured box reads zero**, not 200x40. The tooltip placement this suite exercises
 * writes `rect`, `offsetWidth` and `offsetHeight` on the elements it cares about and leaves
 * every other element unmeasured, so a non-zero default is a layout the screen never saw. The
 * suite happens to stay green either way, which is exactly why this is kept rather than
 * dropped: a green suite is not a measurement.
 *
 * **`focus()` moves `document.activeElement`.** The shared one counts the call and nothing
 * else, deliberately — a focus that silently rewrites a global is a reach a double shared by
 * thirty files should not have. This screen's own double did it, so it does it here.
 */
class EditorElement extends FakeElement {
    override rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    override offsetWidth = 0;
    override offsetHeight = 0;

    override focus(): void {
        super.focus();
        (globalThis as Record<string, unknown>)['document'] = {
            ...((globalThis as Record<string, unknown>)['document'] as object),
            activeElement: this,
        };
    }
}

// ---------------------------------------------------------------------------- the rig

const FALLBACK = defaultSettings('TDM', 'mp_foundry', 90);

interface Rig {
    readonly editor: LoadoutEditor;
    readonly profile: Profile;
    readonly host: FakeElement;
    readonly layer: FakeElement;
    readonly exits: number[];
    readonly names: string[];
    readonly anisotropy: () => number;
}

function rig(): Rig {
    const host = new FakeElement('div');
    const profile = new Profile({ fallbackSettings: FALLBACK });
    const exits: number[] = [];
    const names: string[] = [];
    const characterAssets = new CharacterAssetService({
        preload: () => new Promise(() => undefined),
        dispose: () => undefined,
    });
    const editor = new LoadoutEditor({
        host: host as unknown as HTMLElement,
        profile,
        onSaveAndExit: () => exits.push(1),
        anisotropy: () => 1,
        characterAssets,
        weaponAssets: null,
        serverConfigured: () => true,
        onDisplayName: (name) => names.push(name),
    });
    const layer = host.children[0];
    if (layer === undefined) throw new Error('the editor mounted nothing');
    return { editor, profile, host, layer, exits, names, anisotropy: () => 1 };
}

/** The class the editor opened on, which is the profile's equipped one. */
function equippedSlot(r: Rig): LoadoutSlot {
    const found = r.profile.loadouts[r.profile.equippedIndex];
    if (found === undefined) throw new Error('the profile holds no equipped class');
    return found;
}

/** The first of the five, for a test that plants something in it before showing the screen. */
function firstSlot(r: Rig): LoadoutSlot {
    const found = r.profile.loadouts[0];
    if (found === undefined) throw new Error('the profile holds no classes');
    return found;
}

/** The class as a string of every token: `className` for elements, the attribute for SVGs. */
function classOf(el: FakeElement): string {
    return el.className !== '' ? el.className : (el.getAttribute('class') ?? '');
}

function has(el: FakeElement, token: string): boolean {
    return classOf(el).split(' ').includes(token);
}

function walk(root: FakeElement, visit: (el: FakeElement) => void): void {
    visit(root);
    for (const child of root.children) walk(child, visit);
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    const out: FakeElement[] = [];
    walk(root, (el) => {
        if (has(el, token)) out.push(el);
    });
    return out;
}

function find(root: FakeElement, token: string): FakeElement {
    const found = findAll(root, token)[0];
    if (found === undefined) throw new Error(`no element carrying .${token}`);
    return found;
}

/** The frame: the 1920x1080 box everything but the chrome is painted into. */
function frame(r: Rig): FakeElement {
    return find(r.layer, 'op-frame');
}

function categoryBars(r: Rig): FakeElement[] {
    return findAll(frame(r), 'lo-bar--cat');
}

function categoryBar(r: Rig, box: string): FakeElement {
    const found = categoryBars(r).find((el) => el.dataset['box'] === box);
    if (found === undefined) throw new Error(`no category bar for ${box}`);
    return found;
}

/** A category bar read back: the icon's key, and the chips with their ranks and tips. */
function readCategory(bar: FakeElement) {
    const icon = bar.children[0];
    const value = bar.children[1]?.children[1];
    if (icon === undefined || value === undefined) throw new Error('a category bar is missing its parts');
    return {
        label: bar.children[1]?.children[0]?.textContent ?? '',
        iconKey: icon.dataset['key'] ?? '',
        glyph: classOf(icon.children[0] ?? new FakeElement('none')),
        chipKey: value.dataset['key'] ?? '',
        chips: value.children.map((c) => ({ text: c.textContent, cls: c.className, tabIndex: c.tabIndex, el: c })),
    };
}

function optionBars(r: Rig): FakeElement[] {
    return findAll(frame(r), 'lo-bar--opt');
}

/** An option bar read back as everything its refresher can have written on it. */
function readOption(el: FakeElement) {
    const text = el.children[1];
    const state = el.children[2];
    if (text === undefined || state === undefined) throw new Error('an option bar is missing its parts');
    return {
        name: text.children[0]?.textContent ?? '',
        blurb: text.children[1]?.textContent ?? '',
        on: el.classList.contains('is-on'),
        locked: el.classList.contains('is-locked'),
        disabled: el.disabled,
        hidden: el.hidden,
        need: state.children[1]?.textContent ?? '',
        lockShown: state.children[0]?.style['display'] !== 'none',
        camo: el.classList.contains('lo-bar--camo'),
        picture: el.style['--lo-picture'] ?? '',
        el,
    };
}

function options(r: Rig) {
    return optionBars(r).map(readOption);
}

function optionNamed(r: Rig, name: string) {
    const found = options(r).find((o) => o.name === name);
    if (found === undefined) throw new Error(`no option bar named ${name}`);
    return found;
}

function plates(r: Rig): FakeElement[] {
    return findAll(frame(r), 'lo-plate');
}

function readPlate(plate: FakeElement) {
    const [num, name, tag, equip] = plate.children;
    if (num === undefined || name === undefined || tag === undefined || equip === undefined) {
        throw new Error('a plate is missing its parts');
    }
    return {
        num: num.textContent,
        name: name.value,
        readOnly: name.readOnly,
        tabIndex: name.tabIndex,
        on: plate.classList.contains('is-on'),
        equipped: plate.classList.contains('is-equipped'),
        selected: plate.getAttribute('aria-selected'),
        tagHidden: tag.hidden,
        equipHidden: equip.hidden,
        nameEl: name,
        equipEl: equip,
        el: plate,
    };
}

function tabs(r: Rig): FakeElement[] {
    return findAll(frame(r), 'op-tab');
}

function pager(r: Rig) {
    const el = find(frame(r), 'lo-pager');
    const [prev, count, next] = el.children;
    if (prev === undefined || count === undefined || next === undefined) throw new Error('the pager is missing its parts');
    return { el, prev, next, count: count.textContent, hidden: el.hidden };
}

function statRows(r: Rig): FakeElement[] {
    return findAll(frame(r), 'lo-stat');
}

function statFor(r: Rig, label: string): FakeElement {
    const found = statRows(r).find((el) => el.children[0]?.textContent === label);
    if (found === undefined) throw new Error(`no stat row ${label}`);
    return found;
}

/** The whole arsenal, as the weapon list would order it for a slot. */
function weaponsFor(slot: 'primary' | 'secondary', overkill: boolean): readonly string[] {
    return ALL_WEAPONS.filter((def) => {
        if (slot === 'secondary' && def.slot === 'primary' && !overkill) return false;
        if (slot === 'primary' && def.slot === 'secondary') return false;
        return true;
    }).map((def) => def.name);
}

const UNLOCKED_PRIMARY = 'ar_carbine';

/** A weapon whose unlock level is above one, for the locked half of every list. */
function lockedWeaponId(): string {
    const found = ALL_WEAPONS.find((def) => def.slot === 'primary' && def.unlockLevel > 1);
    if (found === undefined) throw new Error('every weapon is available at level one');
    return found.id;
}

// ---------------------------------------------------------------------------- the screen

describe('the screen it builds', () => {
    it('mounts one hidden layer on the host and paints nothing into it', () => {
        const { host, layer } = rig();
        expect(host.children).toHaveLength(1);
        expect(layer.className).toBe('op-screen lo');
        expect(layer.hidden).toBe(true);
        expect(findAll(layer, 'lo-bar--cat')).toEqual([]);
    });

    it('unhides and paints the whole screen on show', () => {
        const r = rig();
        r.editor.show();
        expect(r.layer.hidden).toBe(false);
        expect(categoryBars(r)).toHaveLength(6);
    });

    it('puts the chrome on the viewport and the rest in the frame', () => {
        const r = rig();
        r.editor.show();
        const viewport = find(r.layer, 'op-viewport');
        expect(viewport.children.map((c) => c.className.split(' ')[0])).toEqual([
            'op-head',
            'op-frame',
            'op-foot',
            'op-profile',
        ]);
    });

    it('lays the frame out as the strip, the stage, the list column, the action row and the tooltip', () => {
        const r = rig();
        r.editor.show();
        expect(frame(r).children.map((c) => c.className.split(' ')[0])).toEqual([
            'lo-strip',
            'lo-stage',
            'lo-right',
            'op-actionbar',
            'lo-tip',
        ]);
    });

    it('titles itself CREATE A CLASS with the five-class subtitle', () => {
        const r = rig();
        r.editor.show();
        const head = find(r.layer, 'op-head');
        const text = findAll(head, 'op-head__title')
            .concat(findAll(head, 'op-head__sub'))
            .map((el) => el.textContent);
        expect(text).toContain('CREATE A CLASS');
        expect(text).toContain('CUSTOMISE YOUR LOADOUT');
    });

    it('starts closed: the categories shown, the head, the options and the band hidden', () => {
        const r = rig();
        r.editor.show();
        expect(find(frame(r), 'lo-cats').hidden).toBe(false);
        expect(find(frame(r), 'lo-list-head').hidden).toBe(true);
        expect(find(frame(r), 'lo-opts').hidden).toBe(true);
        expect(find(frame(r), 'lo-band').hidden).toBe(true);
        expect(find(frame(r), 'lo-tip').hidden).toBe(true);
    });

    it('opens on the equipped class rather than on the first one', () => {
        const r = rig();
        r.profile.equipLoadout(3);
        r.editor.show();
        expect(plates(r).map((p) => readPlate(p).on)).toEqual([false, false, false, true, false]);
    });

    it('repaints in place only while it is on screen', () => {
        const r = rig();
        r.editor.repaint();
        expect(categoryBars(r)).toEqual([]);
        r.editor.show();
        r.editor.repaint();
        expect(categoryBars(r)).toHaveLength(6);
    });

    it('hides the screen and the tooltip on hide', () => {
        const r = rig();
        r.editor.show();
        r.editor.hide();
        expect(r.layer.hidden).toBe(true);
        expect(find(frame(r), 'lo-tip').hidden).toBe(true);
    });

    it('takes the layer off the host when disposed of', () => {
        const r = rig();
        r.editor.show();
        r.editor.dispose();
        expect(r.host.children).toEqual([]);
    });

    it('passes Escape to the profile panel and nowhere else', () => {
        const r = rig();
        r.editor.show();
        expect(r.editor.handleEscape()).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the six bars

describe('the six category bars', () => {
    it('are the six categories in the brief’s order, each with its chevron', () => {
        const r = rig();
        r.editor.show();
        expect(categoryBars(r).map((b) => b.dataset['box'])).toEqual([
            'primary',
            'secondary',
            'equipment',
            'perks',
            'streaks',
            'field',
        ]);
        expect(categoryBars(r).map((b) => readCategory(b).label)).toEqual([
            'Primary',
            'Secondary',
            'Equipment',
            'Perks',
            'Killstreaks',
            'Field upgrade',
        ]);
        expect(categoryBars(r).every((b) => b.children[2]?.textContent === '›')).toBe(true);
    });

    it('key the two weapon icons on the weapon and the other four on the category', () => {
        const r = rig();
        r.editor.show();
        const slot = equippedSlot(r);
        expect(readCategory(categoryBar(r, 'primary')).iconKey).toBe(slot?.primary.weaponId);
        expect(readCategory(categoryBar(r, 'secondary')).iconKey).toBe(slot?.secondary.weaponId);
        expect(readCategory(categoryBar(r, 'perks')).iconKey).toBe('perks');
        expect(readCategory(categoryBar(r, 'field')).iconKey).toBe('field');
    });

    it('draw a silhouette for a weapon box and a glyph for the rest', () => {
        const r = rig();
        r.editor.show();
        expect(readCategory(categoryBar(r, 'primary')).glyph).toBe('lo-bar__silhouette');
        expect(readCategory(categoryBar(r, 'streaks')).glyph).toBe('lo-bar__glyph');
    });

    it('show a weapon as a lead chip and its finish and attachments as details', () => {
        const r = rig();
        r.editor.show();
        const slot = equippedSlot(r);
        const def = requireWeapon(slot.primary.weaponId);
        const chips = readCategory(categoryBar(r, 'primary')).chips;
        expect(chips[0]?.text).toBe(def.name);
        expect(chips[0]?.cls).toBe('lo-chip lo-chip--lead lo-metal');
        expect(chips[1]?.text).toBe('FACTORY FINISH');
        expect(chips[1]?.cls).toBe('lo-chip');
    });

    it('show the fitted attachments as further details, in the order they are held', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const slot = firstSlot(r);
        const def = requireWeapon(slot.primary.weaponId);
        const fits = attachmentsForWeapon(def);
        for (const id of fits) r.profile.unlockAttachment(def.id, id);
        r.profile.editLoadout(0, (s) => {
            s.primary.attachments = [...fits.slice(0, 2)];
        });
        r.profile.equipLoadout(0);
        r.editor.show();
        const chips = readCategory(categoryBar(r, 'primary')).chips;
        expect(chips.slice(2).map((c) => c.text)).toEqual(fits.slice(0, 2).map((id) => attachmentDef(id).name));
        expect(chips.slice(2).every((c) => c.cls === 'lo-chip')).toBe(true);
    });

    it('name the finish once one is fitted', () => {
        const r = rig();
        const slot = firstSlot(r);
        const weaponId = slot.primary.weaponId;
        const camo = CAMO_IDS[0];
        if (camo === undefined) throw new Error('no camos');
        r.profile.grantCamo(weaponId, camo);
        r.profile.editLoadout(0, (s) => {
            s.primary.camo = camo;
        });
        r.profile.equipLoadout(0);
        r.editor.show();
        expect(readCategory(categoryBar(r, 'primary')).chips[1]?.text).toBe(camoDef(camo).name);
    });

    it('show the two grenades as peers', () => {
        const r = rig();
        r.editor.show();
        const slot = equippedSlot(r);
        const chips = readCategory(categoryBar(r, 'equipment')).chips;
        expect(chips.map((c) => c.text)).toEqual([
            equipmentDef(slot.lethal).name,
            equipmentDef(slot.tactical).name,
        ]);
        expect(chips.every((c) => c.cls === 'lo-chip lo-chip--peer lo-metal')).toBe(true);
    });

    it('show three perk chips, an em dash for an empty tier', () => {
        const r = rig();
        r.profile.editLoadout(0, (s) => {
            s.perks = [null, null, null];
        });
        r.profile.equipLoadout(0);
        r.editor.show();
        const chips = readCategory(categoryBar(r, 'perks')).chips;
        expect(chips).toHaveLength(3);
        expect(chips.map((c) => c.text)).toEqual(['—', '—', '—']);
        expect(chips.every((c) => c.cls === 'lo-chip lo-chip--peer lo-metal lo-chip--empty')).toBe(true);
    });

    it('show three killstreak chips, an em dash for an empty key', () => {
        const r = rig();
        r.profile.editLoadout(0, (s) => {
            s.streaks = [null, null, null];
        });
        r.profile.equipLoadout(0);
        r.editor.show();
        const chips = readCategory(categoryBar(r, 'streaks')).chips;
        expect(chips).toHaveLength(3);
        expect(chips.map((c) => c.text)).toEqual(['—', '—', '—']);
    });

    it('show the field upgrade as a lead', () => {
        const r = rig();
        r.editor.show();
        const slot = equippedSlot(r);
        const chips = readCategory(categoryBar(r, 'field')).chips;
        expect(chips).toHaveLength(1);
        expect(chips[0]?.text).toBe(fieldUpgradeDef(slot.fieldUpgrade).name);
        expect(chips[0]?.cls).toBe('lo-chip lo-chip--lead lo-metal');
    });

    it('give every chip the keyboard, so a tooltip is reachable without a pointer', () => {
        const r = rig();
        r.editor.show();
        expect(categoryBars(r).every((b) => readCategory(b).chips.every((c) => c.tabIndex === 0))).toBe(true);
    });

    it('key the chips on their joined text, and leave the elements alone while the key holds', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        const was = readCategory(categoryBar(r, 'perks'));
        const chip = was.chips[0]?.el;
        if (chip === undefined) throw new Error('no perk chip');
        expect(was.chipKey).toBe(was.chips.map((c) => c.text).join('\u001f'));
        // An edit in another category refreshes every bar; the perk chips keep their key, so the
        // tooltip open on one of them survives it.
        r.editor.openBox('field', 0);
        const last = FIELD_UPGRADE_IDS[FIELD_UPGRADE_IDS.length - 1];
        if (last === undefined) throw new Error('no field upgrades');
        fire(optionNamed(r, fieldUpgradeDef(last).name).el, 'click');
        expect(readCategory(categoryBar(r, 'perks')).chips[0]?.el).toBe(chip);
    });

    it('rebuild a box’s chips once its own key moved', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        const chip = readCategory(categoryBar(r, 'field')).chips[0]?.el;
        if (chip === undefined) throw new Error('no field chip');
        r.editor.openBox('field', 0);
        const last = FIELD_UPGRADE_IDS[FIELD_UPGRADE_IDS.length - 1];
        if (last === undefined) throw new Error('no field upgrades');
        fire(optionNamed(r, fieldUpgradeDef(last).name).el, 'click');
        const after = readCategory(categoryBar(r, 'field'));
        expect(after.chips[0]?.el).not.toBe(chip);
        expect(after.chips[0]?.text).toBe(fieldUpgradeDef(last).name);
    });

    it('separate the chip key with a unit separator, so two splits cannot collide', () => {
        const r = rig();
        r.editor.show();
        const equipment = readCategory(categoryBar(r, 'equipment'));
        // The separator is the one character a chip's text can never hold, which is what keeps
        // ['AB','C'] and ['A','BC'] two different keys.
        expect(equipment.chipKey).toBe(equipment.chips.map((c) => c.text).join('\u001f'));
        expect(equipment.chipKey).toContain('\u001f');
        expect(equipment.chips.every((c) => !c.text.includes('\u001f'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the strip

describe('the class strip', () => {
    it('is a tablist of five numbered plates', () => {
        const r = rig();
        r.editor.show();
        const strip = find(frame(r), 'lo-strip');
        expect(strip.getAttribute('role')).toBe('tablist');
        expect(strip.getAttribute('aria-label')).toBe('Classes');
        expect(plates(r)).toHaveLength(5);
        expect(plates(r).map((p) => readPlate(p).num)).toEqual(['1', '2', '3', '4', '5']);
        expect(plates(r).every((p) => p.getAttribute('role') === 'tab')).toBe(true);
    });

    it('names each plate from the profile and labels the field for a reader', () => {
        const r = rig();
        r.editor.show();
        expect(plates(r).map((p) => readPlate(p).name)).toEqual(r.profile.loadouts.map((s) => s.name));
        expect(plates(r).map((p) => p.children[1]?.getAttribute('aria-label'))).toEqual([
            'Class 1 name',
            'Class 2 name',
            'Class 3 name',
            'Class 4 name',
            'Class 5 name',
        ]);
    });

    it('makes the name a 16-character field with no spellcheck and no autocomplete', () => {
        const r = rig();
        r.editor.show();
        const name = plates(r)[0]?.children[1];
        expect(name?.type).toBe('text');
        expect(name?.maxLength).toBe(16);
        expect(name?.spellcheck).toBe(false);
        expect(name?.autocomplete).toBe('off');
    });

    it('leaves only the open plate’s name writable and in the tab order', () => {
        const r = rig();
        r.editor.show();
        expect(plates(r).map((p) => readPlate(p).readOnly)).toEqual([false, true, true, true, true]);
        expect(plates(r).map((p) => readPlate(p).tabIndex)).toEqual([0, -1, -1, -1, -1]);
    });

    it('marks the open plate and tells a reader which tab is selected', () => {
        const r = rig();
        r.editor.show();
        expect(plates(r).map((p) => readPlate(p).selected)).toEqual(['true', 'false', 'false', 'false', 'false']);
    });

    it('carries EQUIPPED on the equipped plate and nowhere else', () => {
        const r = rig();
        r.profile.equipLoadout(2);
        r.editor.show();
        expect(plates(r).map((p) => readPlate(p).tagHidden)).toEqual([true, true, false, true, true]);
    });

    it('offers EQUIP on the open plate only while it is not the equipped one', () => {
        const r = rig();
        r.editor.show();
        expect(plates(r).map((p) => readPlate(p).equipHidden)).toEqual([true, true, true, true, true]);
        fire(plates(r)[1] as FakeElement, 'click');
        expect(plates(r).map((p) => readPlate(p).equipHidden)).toEqual([true, false, true, true, true]);
    });

    it('equips the open class from its own plate', () => {
        const r = rig();
        r.editor.show();
        fire(plates(r)[3] as FakeElement, 'click');
        fire(readPlate(plates(r)[3] as FakeElement).equipEl, 'click');
        expect(r.profile.equippedIndex).toBe(3);
        expect(plates(r).map((p) => readPlate(p).tagHidden)).toEqual([true, true, true, false, true]);
    });

    it('selects a class on click and on Enter or Space, and not on another key', () => {
        const r = rig();
        r.editor.show();
        fire(plates(r)[1] as FakeElement, 'keydown', { key: 'Enter' });
        expect(readPlate(plates(r)[1] as FakeElement).on).toBe(true);
        fire(plates(r)[2] as FakeElement, 'keydown', { key: ' ' });
        expect(readPlate(plates(r)[2] as FakeElement).on).toBe(true);
        fire(plates(r)[3] as FakeElement, 'keydown', { key: 'a' });
        expect(readPlate(plates(r)[3] as FakeElement).on).toBe(false);
    });

    it('closes an open category when the class changes', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        expect(find(frame(r), 'lo-opts').hidden).toBe(false);
        fire(plates(r)[1] as FakeElement, 'click');
        expect(find(frame(r), 'lo-opts').hidden).toBe(true);
        expect(find(frame(r), 'lo-cats').hidden).toBe(false);
        expect(optionBars(r)).toEqual([]);
    });

    it('does nothing when the open class is clicked again', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        fire(plates(r)[0] as FakeElement, 'click');
        expect(find(frame(r), 'lo-opts').hidden).toBe(false);
    });

    it('renames the class on change, trimmed, uppercased and capped at sixteen', () => {
        const r = rig();
        r.editor.show();
        const name = readPlate(plates(r)[0] as FakeElement).nameEl;
        name.value = '  recon overwatch  ';
        fire(name, 'change');
        expect(r.profile.loadouts[0]?.name).toBe('RECON OVERWATCH');
    });

    it('trims on both sides of the cap, so a long name cannot end in a space', () => {
        const r = rig();
        r.editor.show();
        const name = readPlate(plates(r)[0] as FakeElement).nameEl;
        name.value = '  recon overwatch team  ';
        fire(name, 'change');
        // The slice falls between two words; the second trim takes the space the cap left
        // behind (#73, fixed 2026-11-17 — this assertion read 'RECON OVERWATCH ' before).
        expect(r.profile.loadouts[0]?.name).toBe('RECON OVERWATCH');
    });

    it('refuses a name that is empty once trimmed', () => {
        const r = rig();
        r.editor.show();
        const was = r.profile.loadouts[0]?.name;
        const name = readPlate(plates(r)[0] as FakeElement).nameEl;
        name.value = '   ';
        fire(name, 'change');
        expect(r.profile.loadouts[0]?.name).toBe(was);
    });

    it('writes the name back onto the field from the profile', () => {
        const r = rig();
        r.editor.show();
        const name = readPlate(plates(r)[1] as FakeElement).nameEl;
        name.value = 'SCRATCH';
        fire(plates(r)[2] as FakeElement, 'click');
        expect(name.value).toBe(r.profile.loadouts[1]?.name);
    });
});

// ---------------------------------------------------------------------------- opening a list

describe('opening a category', () => {
    it('replaces the categories with the options and shows the head', () => {
        const r = rig();
        r.editor.show();
        fire(categoryBar(r, 'perks'), 'click');
        expect(find(frame(r), 'lo-cats').hidden).toBe(true);
        expect(find(frame(r), 'lo-opts').hidden).toBe(false);
        expect(find(frame(r), 'lo-list-head').hidden).toBe(false);
        expect(optionBars(r).length).toBeGreaterThan(0);
    });

    it('heads the list with the category, its tabs and a pager', () => {
        const r = rig();
        r.editor.show();
        fire(categoryBar(r, 'primary'), 'click');
        const head = find(frame(r), 'lo-list-head');
        expect(head.children.map((c) => c.className.split(' ')[0])).toEqual([
            'lo-list-head__label',
            'op-tabs',
            'lo-pager',
        ]);
        expect(head.children[0]?.textContent).toBe('Primary');
    });

    it('offers the tabs the brief asks for, the opened one marked', () => {
        const r = rig();
        r.editor.show();
        fire(categoryBar(r, 'primary'), 'click');
        expect(tabs(r).map((t) => t.textContent)).toEqual(['WEAPON', 'ATTACHMENTS', 'SKIN']);
        expect(tabs(r).map((t) => t.classList.contains('op-tab--on'))).toEqual([true, false, false]);
        fire(categoryBar(r, 'equipment'), 'click');
        expect(tabs(r).map((t) => t.textContent)).toEqual(['LETHAL', 'TACTICAL']);
        fire(categoryBar(r, 'perks'), 'click');
        expect(tabs(r).map((t) => t.textContent)).toEqual(['PERK 1', 'PERK 2', 'PERK 3']);
        fire(categoryBar(r, 'streaks'), 'click');
        expect(tabs(r).map((t) => t.textContent)).toEqual(['KEY 3', 'KEY 4', 'KEY 5']);
        fire(categoryBar(r, 'field'), 'click');
        expect(tabs(r).map((t) => t.textContent)).toEqual(['FIELD UPGRADE']);
    });

    it('switches tabs from the row, marking the new one', () => {
        const r = rig();
        r.editor.show();
        fire(categoryBar(r, 'primary'), 'click');
        fire(tabs(r)[1] as FakeElement, 'click');
        expect(tabs(r).map((t) => t.classList.contains('op-tab--on'))).toEqual([false, true, false]);
    });

    it('shows the band for the three weapon tabs and hides it for everything else', () => {
        const r = rig();
        r.editor.show();
        for (const tab of [0, 1, 2]) {
            r.editor.openBox('primary', tab);
            expect(find(frame(r), 'lo-band').hidden).toBe(false);
        }
        for (const box of ['equipment', 'perks', 'streaks', 'field'] as const) {
            r.editor.openBox(box, 0);
            expect(find(frame(r), 'lo-band').hidden).toBe(true);
        }
    });

    it('opens a box by kind and tab for the layout probe', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('streaks', 2);
        expect(find(frame(r), 'lo-list-head').children[0]?.textContent).toBe('Killstreaks');
        expect(tabs(r).map((t) => t.classList.contains('op-tab--on'))).toEqual([false, false, true]);
    });

    it('ignores a box kind it does not have', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('nonesuch' as 'primary', 0);
        expect(find(frame(r), 'lo-opts').hidden).toBe(true);
    });

    it('falls back to the first tab when the index is past the end', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 9);
        expect(tabs(r).map((t) => t.classList.contains('op-tab--on'))).toEqual([false, false, false]);
        expect(options(r).map((o) => o.name)).toEqual(weaponsFor('primary', false));
    });

    it('closes the list and clears its options on save', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('perks', 0);
        const save = findAll(frame(r), 'lo-row__actions')[0]?.children[1];
        if (save === undefined) throw new Error('no SAVE');
        fire(save, 'click');
        expect(find(frame(r), 'lo-cats').hidden).toBe(false);
        expect(optionBars(r)).toEqual([]);
    });

    it('keeps the list’s refreshers out of the static set', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('field', 0);
        const opened = optionBars(r).length;
        expect(opened).toBeGreaterThan(0);
        r.editor.openBox('perks', 0);
        // Opening a second category truncates the first one's closures before appending its own,
        // so the options on screen are the new list's alone.
        expect(options(r).map((o) => o.name)).toContain('NONE');
        expect(optionBars(r).length).not.toBe(0);
    });
});

// ---------------------------------------------------------------------------- the lists

describe('the weapon list', () => {
    it('offers every primary for the primary slot and no sidearm', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        expect(options(r).map((o) => o.name)).toEqual(weaponsFor('primary', false));
    });

    it('offers only sidearms for the secondary slot until Overkill is on', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('secondary', 0);
        expect(options(r).map((o) => o.name)).toEqual(weaponsFor('secondary', false));
    });

    it('lets the primaries into the secondary slot once Overkill is on', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.profile.editLoadout(0, (s) => {
            s.perks = ['overkill', null, null];
        });
        r.profile.equipLoadout(0);
        r.editor.show();
        r.editor.openBox('secondary', 0);
        expect(options(r).map((o) => o.name)).toEqual(weaponsFor('secondary', true));
    });

    it('marks the equipped weapon and says EQUIPPED on it', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const equipped = requireWeapon(r.profile.loadouts[r.profile.equippedIndex]?.primary.weaponId ?? '');
        const bar = optionNamed(r, equipped.name);
        expect(bar.on).toBe(true);
        expect(bar.need).toBe('EQUIPPED');
        expect(bar.locked).toBe(false);
    });

    it('prints the weapon’s own progress as its blurb', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const def = requireWeapon(UNLOCKED_PRIMARY);
        expect(optionNamed(r, def.name).blurb).toBe(`${def.class} · LV 1 · 0 kills · 0 hs · no shots`);
    });

    it('prints the kills, the headshots, the accuracy and the longest shot once there are any', () => {
        const r = rig();
        const stats = r.profile.weapon(UNLOCKED_PRIMARY);
        stats.kills = 12;
        stats.headshots = 3;
        stats.shotsFired = 100;
        stats.shotsHit = 41;
        stats.longestShot = 63.4;
        stats.timeUsed = 125;
        r.editor.show();
        r.editor.openBox('primary', 0);
        const def = requireWeapon(UNLOCKED_PRIMARY);
        expect(optionNamed(r, def.name).blurb).toBe(
            `${def.class} · LV 1 · 12 kills · 3 hs · 41% acc · longest 63 m · 2m used`,
        );
    });

    it('locks a weapon above the account level and prints where the player is', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const def = requireWeapon(lockedWeaponId());
        const bar = optionNamed(r, def.name);
        expect(bar.locked).toBe(true);
        expect(bar.disabled).toBe(true);
        expect(bar.lockShown).toBe(true);
        expect(bar.need).toBe(`LEVEL 1 / ${def.unlockLevel}`);
    });

    it('hides the padlock on an unlocked bar', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        expect(optionNamed(r, requireWeapon(UNLOCKED_PRIMARY).name).lockShown).toBe(false);
    });

    it('equips an unlocked weapon on click and drops the attachments with it', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const first = ALL_WEAPONS.find((d) => d.slot === 'primary' && d.id !== UNLOCKED_PRIMARY);
        if (first === undefined) throw new Error('one primary only');
        for (const id of attachmentsForWeapon(requireWeapon(UNLOCKED_PRIMARY))) {
            r.profile.unlockAttachment(UNLOCKED_PRIMARY, id);
        }
        r.profile.editLoadout(0, (s) => {
            s.primary.weaponId = UNLOCKED_PRIMARY;
            s.primary.attachments = [...attachmentsForWeapon(requireWeapon(UNLOCKED_PRIMARY)).slice(0, 1)];
        });
        r.profile.equipLoadout(0);
        r.editor.show();
        r.editor.openBox('primary', 0);
        fire(optionNamed(r, first.name).el, 'click');
        expect(r.profile.loadouts[0]?.primary.weaponId).toBe(first.id);
        expect(r.profile.loadouts[0]?.primary.attachments).toEqual([]);
    });

    it('does nothing when a locked bar is clicked', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const was = r.profile.loadouts[0]?.primary.weaponId;
        fire(optionNamed(r, requireWeapon(lockedWeaponId()).name).el, 'click');
        expect(r.profile.loadouts[0]?.primary.weaponId).toBe(was);
    });

    it('moves EQUIPPED to the bar that was picked', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const target = ALL_WEAPONS.find((d) => d.slot === 'primary' && d.name !== optionNamed(r, options(r)[0]?.name ?? '').name);
        const pick = ALL_WEAPONS.filter((d) => d.slot === 'primary')[2];
        if (pick === undefined || target === undefined) throw new Error('not enough primaries');
        fire(optionNamed(r, pick.name).el, 'click');
        expect(optionNamed(r, pick.name).need).toBe('EQUIPPED');
        expect(options(r).filter((o) => o.need === 'EQUIPPED')).toHaveLength(1);
    });
});

describe('the attachments list', () => {
    it('offers every attachment the weapon fits', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 1);
        const def = requireWeapon(r.profile.loadouts[r.profile.equippedIndex]?.primary.weaponId ?? '');
        expect(options(r).map((o) => o.name)).toEqual(attachmentsForWeapon(def).map((id) => attachmentDef(id).name));
    });

    it('prints the benefit and the cost of each one', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 1);
        const def = requireWeapon(r.profile.loadouts[r.profile.equippedIndex]?.primary.weaponId ?? '');
        const first = attachmentsForWeapon(def)[0];
        if (first === undefined) throw new Error('the starting weapon fits nothing');
        const a = attachmentDef(first);
        expect(optionNamed(r, a.name).blurb).toBe(`${a.benefit} — ${a.cost}`);
    });

    it('locks one that is still kill-gated and counts the kills towards it', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 1);
        const locked = options(r).filter((o) => o.locked);
        expect(locked.length).toBeGreaterThan(0);
        expect(locked.every((o) => /^\d+ \/ \d+ KILLS$/.test(o.need))).toBe(true);
    });

    it('fits and removes an attachment on successive clicks', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const weaponId = r.profile.loadouts[0]?.primary.weaponId ?? '';
        const fits = attachmentsForWeapon(requireWeapon(weaponId));
        const first = fits[0];
        if (first === undefined) throw new Error('the starting weapon fits nothing');
        r.profile.unlockAttachment(weaponId, first);
        r.editor.show();
        r.editor.openBox('primary', 1);
        const bar = optionNamed(r, attachmentDef(first).name).el;
        fire(bar, 'click');
        expect(r.profile.loadouts[0]?.primary.attachments).toEqual([first]);
        fire(bar, 'click');
        expect(r.profile.loadouts[0]?.primary.attachments).toEqual([]);
    });

    it('says so when the weapon takes none', () => {
        const r = rig();
        const bare = ALL_WEAPONS.find((d) => attachmentsForWeapon(d).length === 0);
        if (bare === undefined) {
            // Every weapon fits something: the note is unreachable from the product's registry,
            // which is worth stating rather than skipping.
            expect(ALL_WEAPONS.every((d) => attachmentsForWeapon(d).length > 0)).toBe(true);
            return;
        }
        r.profile.maxAccountLevel();
        r.profile.editLoadout(0, (s) => {
            s[bare.slot === 'secondary' ? 'secondary' : 'primary'].weaponId = bare.id;
        });
        r.profile.equipLoadout(0);
        r.editor.show();
        r.editor.openBox(bare.slot === 'secondary' ? 'secondary' : 'primary', 1);
        expect(find(frame(r), 'lo-empty').textContent).toBe('This weapon takes no attachments');
        expect(optionBars(r)).toEqual([]);
    });

    it('reads the attachments of the slot the tab belongs to', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('secondary', 1);
        const def = requireWeapon(r.profile.loadouts[r.profile.equippedIndex]?.secondary.weaponId ?? '');
        expect(options(r).map((o) => o.name)).toEqual(attachmentsForWeapon(def).map((id) => attachmentDef(id).name));
    });
});

describe('the skin list', () => {
    it('leads with NONE and then every camo', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 2);
        expect(options(r).map((o) => o.name)).toEqual(['NONE', ...CAMO_IDS.map((id) => camoDef(id).name)]);
    });

    it('marks NONE while no finish is fitted, and never locks it', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 2);
        const none = optionNamed(r, 'NONE');
        expect(none.on).toBe(true);
        expect(none.locked).toBe(false);
        expect(none.need).toBe('EQUIPPED');
        expect(none.blurb).toBe('Factory finish');
    });

    it('prints the camo’s authored requirement as its blurb and the challenge as its lock', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 2);
        const id = CAMO_IDS[0];
        if (id === undefined) throw new Error('no camos');
        const bar = optionNamed(r, camoDef(id).name);
        expect(bar.blurb).toBe(camoDef(id).requirement);
        expect(bar.locked).toBe(true);
        expect(bar.need).not.toBe('');
    });

    it('gives every camo bar its own picture', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 2);
        const camos = options(r).filter((o) => o.name !== 'NONE');
        expect(camos.every((o) => o.camo)).toBe(true);
        expect(camos.every((o) => o.picture.startsWith('url("data:image/png;base64,'))).toBe(true);
        expect(optionNamed(r, 'NONE').camo).toBe(false);
    });

    it('fits an owned camo and goes back to the factory finish', () => {
        const r = rig();
        const weaponId = r.profile.loadouts[0]?.primary.weaponId ?? '';
        const id = CAMO_IDS[0];
        if (id === undefined) throw new Error('no camos');
        r.profile.grantCamo(weaponId, id);
        r.editor.show();
        r.editor.openBox('primary', 2);
        fire(optionNamed(r, camoDef(id).name).el, 'click');
        expect(r.profile.loadouts[0]?.primary.camo).toBe(id);
        fire(optionNamed(r, 'NONE').el, 'click');
        expect(r.profile.loadouts[0]?.primary.camo).toBe(null);
    });

    it('opens every finish on the range, the challenge chip gone', () => {
        const r = rig();
        r.editor.show(true);
        r.editor.openBox('primary', 2);
        expect(options(r).every((o) => !o.locked)).toBe(true);
        expect(options(r).every((o) => !o.lockShown)).toBe(true);
    });
});

describe('the two equipment lists', () => {
    it('offers the lethals under LETHAL and the tacticals under TACTICAL', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('equipment', 0);
        expect(options(r).map((o) => o.name)).toEqual(
            ALL_EQUIPMENT.filter((e) => e.slot === 'lethal').map((e) => e.name),
        );
        r.editor.openBox('equipment', 1);
        expect(options(r).map((o) => o.name)).toEqual(
            ALL_EQUIPMENT.filter((e) => e.slot === 'tactical').map((e) => e.name),
        );
    });

    it('prints the count, the damage, the radius and the fuse as the blurb', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('equipment', 0);
        const frag = ALL_EQUIPMENT.find((e) => e.slot === 'lethal' && e.cookable);
        if (frag === undefined) throw new Error('no cookable lethal');
        const parts = [`x${frag.count} per life`];
        if (frag.damageProfile !== null) parts.push(`${frag.damageProfile.damage.near} dmg · ${frag.effectRadius} m`);
        if (frag.flashSeconds > 0) parts.push(`${frag.flashSeconds}s blind`);
        if (frag.smokeSeconds > 0) parts.push(`${frag.smokeSeconds}s cover`);
        parts.push('cookable');
        expect(optionNamed(r, frag.name).blurb).toBe(parts.join(' · '));
    });

    it('marks the equipped grenade in each slot', () => {
        const r = rig();
        r.editor.show();
        const slot = equippedSlot(r);
        r.editor.openBox('equipment', 0);
        expect(optionNamed(r, equipmentDef(slot.lethal).name).on).toBe(true);
        r.editor.openBox('equipment', 1);
        expect(optionNamed(r, equipmentDef(slot.tactical).name).on).toBe(true);
    });

    it('locks a level-gated grenade and prints the level the gate is enforcing', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('equipment', 1);
        const locked = options(r).filter((o) => o.locked);
        expect(locked.length).toBeGreaterThan(0);
        expect(locked.every((o) => /^LEVEL 1 \/ \d+$/.test(o.need))).toBe(true);
    });

    it('equips an unlocked grenade on click', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        r.editor.openBox('equipment', 0);
        const lethals = ALL_EQUIPMENT.filter((e) => e.slot === 'lethal');
        const pick = lethals[lethals.length - 1];
        if (pick === undefined) throw new Error('no lethals');
        fire(optionNamed(r, pick.name).el, 'click');
        expect(r.profile.loadouts[0]?.lethal).toBe(pick.id);
    });
});

describe('the three perk lists', () => {
    it('leads each tier with NONE and then that tier’s perks', () => {
        const r = rig();
        r.editor.show();
        for (const tier of [1, 2, 3] as const) {
            r.editor.openBox('perks', tier - 1);
            expect(options(r).map((o) => o.name)).toEqual(['NONE', ...perksOfTier(tier).map((p) => p.name)]);
        }
    });

    it('says what NONE means for a tier', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('perks', 0);
        expect(optionNamed(r, 'NONE').blurb).toBe('Leave this tier empty');
    });

    it('marks NONE while the tier is empty and the perk once one is picked', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.profile.editLoadout(0, (s) => {
            s.perks = [null, null, null];
        });
        r.editor.show();
        r.editor.openBox('perks', 0);
        expect(optionNamed(r, 'NONE').on).toBe(true);
        const perk = perksOfTier(1)[0];
        if (perk === undefined) throw new Error('tier one is empty');
        fire(optionNamed(r, perk.name).el, 'click');
        expect(r.profile.loadouts[0]?.perks[0]).toBe(perk.id);
        expect(optionNamed(r, 'NONE').on).toBe(false);
        fire(optionNamed(r, 'NONE').el, 'click');
        expect(r.profile.loadouts[0]?.perks[0]).toBe(null);
    });

    it('marks an inert perk’s blurb as having no consumer', () => {
        const r = rig();
        r.editor.show();
        const inert = [1, 2, 3].flatMap((t) => perksOfTier(t as 1 | 2 | 3)).find((p) => p.inert === true);
        if (inert === undefined) {
            expect([1, 2, 3].flatMap((t) => perksOfTier(t as 1 | 2 | 3)).every((p) => p.inert !== true)).toBe(true);
            return;
        }
        r.editor.openBox('perks', inert.tier - 1);
        expect(optionNamed(r, inert.name).blurb).toBe(`${perkDef(inert.id).blurb} (no consumer until M7)`);
    });

    it('locks a level-gated perk with its level', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('perks', 1);
        const locked = options(r).filter((o) => o.locked);
        expect(locked.length).toBeGreaterThan(0);
        expect(locked.every((o) => /^LEVEL 1 \/ \d+$/.test(o.need))).toBe(true);
    });
});

describe('the three killstreak lists', () => {
    it('leads each key with NONE and then every streak, in the table’s order', () => {
        const r = rig();
        r.editor.show();
        for (const tab of [0, 1, 2]) {
            r.editor.openBox('streaks', tab);
            expect(options(r).map((o) => o.name)).toEqual(['NONE', ...STREAK_DEFS.map((d) => d.name)]);
        }
    });

    it('says what NONE means for a key', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('streaks', 0);
        expect(optionNamed(r, 'NONE').blurb).toBe('Leave this key empty');
    });

    it('prints a streak’s price as a cost rather than as a threshold', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('streaks', 0);
        const def = STREAK_DEFS[0];
        if (def === undefined) throw new Error('no streaks');
        expect(optionNamed(r, def.name).blurb).toBe(`Costs ${def.requirement} kills · ${def.blurb}`);
    });

    it('never locks a streak behind a level, whatever the account is', () => {
        const r = rig();
        r.profile.editLoadout(0, (s) => {
            s.streaks = [null, null, null];
        });
        r.editor.show();
        r.editor.openBox('streaks', 0);
        expect(options(r).every((o) => !o.locked)).toBe(true);
    });

    it('locks a streak that is on another key and says so', () => {
        const r = rig();
        const def = STREAK_DEFS[0];
        if (def === undefined) throw new Error('no streaks');
        r.profile.editLoadout(0, (s) => {
            s.streaks = [def.id, null, null];
        });
        r.editor.show();
        r.editor.openBox('streaks', 1);
        const bar = optionNamed(r, def.name);
        expect(bar.locked).toBe(true);
        expect(bar.need).toBe('ON ANOTHER KEY');
        expect(bar.lockShown).toBe(true);
    });

    it('does not lock a streak against the key it is already on', () => {
        const r = rig();
        const def = STREAK_DEFS[0];
        if (def === undefined) throw new Error('no streaks');
        r.profile.editLoadout(0, (s) => {
            s.streaks = [def.id, null, null];
        });
        r.editor.show();
        r.editor.openBox('streaks', 0);
        const bar = optionNamed(r, def.name);
        expect(bar.locked).toBe(false);
        expect(bar.on).toBe(true);
        expect(bar.need).toBe('EQUIPPED');
    });

    it('spends a key on a streak and clears it again', () => {
        const r = rig();
        const def = STREAK_DEFS[1];
        if (def === undefined) throw new Error('not enough streaks');
        r.editor.show();
        r.editor.openBox('streaks', 2);
        fire(optionNamed(r, def.name).el, 'click');
        expect(r.profile.loadouts[0]?.streaks[2]).toBe(def.id);
        fire(optionNamed(r, 'NONE').el, 'click');
        expect(r.profile.loadouts[0]?.streaks[2]).toBe(null);
    });
});

describe('the field upgrade list', () => {
    it('offers every upgrade with its charge time', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('field', 0);
        expect(options(r).map((o) => o.name)).toEqual(FIELD_UPGRADE_IDS.map((id) => fieldUpgradeDef(id).name));
        const id = FIELD_UPGRADE_IDS[0];
        if (id === undefined) throw new Error('no field upgrades');
        const def = fieldUpgradeDef(id);
        expect(optionNamed(r, def.name).blurb).toBe(`${def.blurb} · ${def.chargeSeconds}s charge`);
    });

    it('marks the equipped one and swaps on click', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        r.editor.openBox('field', 0);
        const last = FIELD_UPGRADE_IDS[FIELD_UPGRADE_IDS.length - 1];
        if (last === undefined) throw new Error('no field upgrades');
        fire(optionNamed(r, fieldUpgradeDef(last).name).el, 'click');
        expect(r.profile.loadouts[0]?.fieldUpgrade).toBe(last);
        expect(optionNamed(r, fieldUpgradeDef(last).name).on).toBe(true);
    });

    it('locks a level-gated upgrade with its level', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('field', 0);
        const locked = options(r).filter((o) => o.locked);
        expect(locked.length).toBeGreaterThan(0);
        expect(locked.every((o) => /^LEVEL 1 \/ \d+$/.test(o.need))).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the pager

describe('the pager', () => {
    it('pages the weapon list five at a time while the band is up', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const total = options(r).length;
        expect(pager(r).count).toBe(`1 / ${Math.ceil(total / 5)}`);
        expect(options(r).filter((o) => !o.hidden)).toHaveLength(Math.min(5, total));
    });

    it('pages a bandless list seven at a time', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('streaks', 0);
        const total = options(r).length;
        expect(pager(r).count).toBe(`1 / ${Math.ceil(total / 7)}`);
        expect(options(r).filter((o) => !o.hidden)).toHaveLength(Math.min(7, total));
    });

    it('hides itself when everything fits on one page', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('field', 0);
        expect(options(r).length).toBeLessThanOrEqual(7);
        expect(pager(r).hidden).toBe(true);
        expect(options(r).every((o) => !o.hidden)).toBe(true);
    });

    it('disables the arrow at each end', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        expect(pager(r).prev.disabled).toBe(true);
        expect(pager(r).next.disabled).toBe(false);
        fire(pager(r).next, 'click');
        expect(pager(r).prev.disabled).toBe(false);
    });

    it('labels its arrows for a reader', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        expect(pager(r).prev.getAttribute('aria-label')).toBe('Previous page');
        expect(pager(r).next.getAttribute('aria-label')).toBe('Next page');
        expect(pager(r).prev.textContent).toBe('‹');
        expect(pager(r).next.textContent).toBe('›');
    });

    it('moves a page and shows that page’s bars alone', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const all = options(r).map((o) => o.name);
        fire(pager(r).next, 'click');
        expect(pager(r).count).toBe(`2 / ${Math.ceil(all.length / 5)}`);
        expect(options(r).filter((o) => !o.hidden).map((o) => o.name)).toEqual(all.slice(5, 10));
    });

    it('clamps at both ends rather than wrapping', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        fire(pager(r).prev, 'click');
        expect(pager(r).count.startsWith('1 /')).toBe(true);
        for (let i = 0; i < 20; i++) fire(pager(r).next, 'click');
        const count = Math.ceil(options(r).length / 5);
        expect(pager(r).count).toBe(`${count} / ${count}`);
    });

    it('keeps the open page across an edit, which is what B11 was built for', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        r.editor.openBox('primary', 0);
        fire(pager(r).next, 'click');
        const shown = options(r).filter((o) => !o.hidden);
        const pick = shown[0];
        if (pick === undefined) throw new Error('the second page is empty');
        fire(pick.el, 'click');
        expect(pager(r).count.startsWith('2 /')).toBe(true);
        expect(options(r).filter((o) => !o.hidden).map((o) => o.name)).toEqual(shown.map((o) => o.name));
    });

    it('goes back to the first page when a tab changes', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        fire(pager(r).next, 'click');
        fire(tabs(r)[0] as FakeElement, 'click');
        expect(pager(r).count.startsWith('1 /')).toBe(true);
    });
});

// ---------------------------------------------------------------------------- save / cancel

describe('SAVE and CANCEL', () => {
    function actions(r: Rig): { save: FakeElement; cancel: FakeElement; wrap: FakeElement } {
        const wrap = find(frame(r), 'lo-row__actions');
        const [cancel, save] = wrap.children;
        if (cancel === undefined || save === undefined) throw new Error('the action cell is missing its buttons');
        return { save, cancel, wrap };
    }

    it('stand on the action row’s stage cell, hidden until a category is open', () => {
        const r = rig();
        r.editor.show();
        expect(actions(r).wrap.hidden).toBe(true);
        expect(find(frame(r), 'lo-skins__toggle').hidden).toBe(false);
        r.editor.openBox('perks', 0);
        expect(actions(r).wrap.hidden).toBe(false);
        expect(find(frame(r), 'lo-skins__toggle').hidden).toBe(true);
    });

    it('read CANCEL then SAVE, the second one primary', () => {
        const r = rig();
        r.editor.show();
        const { save, cancel } = actions(r);
        expect(cancel.children[0]?.textContent).toBe('CANCEL');
        expect(save.children[0]?.textContent).toBe('SAVE');
        expect(save.classList.contains('op-cta--primary')).toBe(true);
        expect(cancel.classList.contains('op-cta--primary')).toBe(false);
    });

    it('SAVE keeps the picks and returns to the categories', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        r.editor.openBox('field', 0);
        const last = FIELD_UPGRADE_IDS[FIELD_UPGRADE_IDS.length - 1];
        if (last === undefined) throw new Error('no field upgrades');
        fire(optionNamed(r, fieldUpgradeDef(last).name).el, 'click');
        fire(actions(r).save, 'click');
        expect(r.profile.loadouts[0]?.fieldUpgrade).toBe(last);
        expect(find(frame(r), 'lo-cats').hidden).toBe(false);
    });

    it('CANCEL puts the class back the way it was when the category opened', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const was = r.profile.loadouts[0]?.fieldUpgrade;
        r.editor.show();
        r.editor.openBox('field', 0);
        const last = FIELD_UPGRADE_IDS[FIELD_UPGRADE_IDS.length - 1];
        if (last === undefined) throw new Error('no field upgrades');
        fire(optionNamed(r, fieldUpgradeDef(last).name).el, 'click');
        fire(actions(r).cancel, 'click');
        expect(r.profile.loadouts[0]?.fieldUpgrade).toBe(was);
        expect(find(frame(r), 'lo-cats').hidden).toBe(false);
    });

    it('CANCEL restores the attachment array rather than aliasing the snapshot’s', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const weaponId = r.profile.loadouts[0]?.primary.weaponId ?? '';
        const fits = attachmentsForWeapon(requireWeapon(weaponId));
        const first = fits[0];
        if (first === undefined) throw new Error('the starting weapon fits nothing');
        r.profile.unlockAttachment(weaponId, first);
        r.editor.show();
        r.editor.openBox('primary', 1);
        fire(optionNamed(r, attachmentDef(first).name).el, 'click');
        expect(r.profile.loadouts[0]?.primary.attachments).toEqual([first]);
        fire(actions(r).cancel, 'click');
        expect(r.profile.loadouts[0]?.primary.attachments).toEqual([]);
    });

    it('CANCEL restores the name too, the snapshot being the whole class', () => {
        const r = rig();
        r.editor.show();
        const was = r.profile.loadouts[0]?.name ?? '';
        r.editor.openBox('perks', 0);
        const name = readPlate(plates(r)[0] as FakeElement).nameEl;
        name.value = 'SCRATCHED';
        fire(name, 'change');
        expect(r.profile.loadouts[0]?.name).toBe('SCRATCHED');
        fire(actions(r).cancel, 'click');
        expect(r.profile.loadouts[0]?.name).toBe(was);
    });

    it('keeps the snapshot across a tab switch inside the same category', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const weaponId = r.profile.loadouts[0]?.primary.weaponId ?? '';
        r.editor.show();
        r.editor.openBox('primary', 0);
        const pick = ALL_WEAPONS.filter((d) => d.slot === 'primary' && d.id !== weaponId)[0];
        if (pick === undefined) throw new Error('one primary only');
        fire(optionNamed(r, pick.name).el, 'click');
        fire(tabs(r)[1] as FakeElement, 'click');
        fire(actions(r).cancel, 'click');
        expect(r.profile.loadouts[0]?.primary.weaponId).toBe(weaponId);
    });

    it('takes a fresh snapshot when another category is opened', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const weaponId = r.profile.loadouts[0]?.primary.weaponId ?? '';
        const pick = ALL_WEAPONS.filter((d) => d.slot === 'primary' && d.id !== weaponId)[0];
        if (pick === undefined) throw new Error('one primary only');
        fire(optionNamed(r, pick.name).el, 'click');
        r.editor.openBox('field', 0);
        fire(actions(r).cancel, 'click');
        // The weapon was picked before this category opened, so CANCEL here does not undo it.
        expect(r.profile.loadouts[0]?.primary.weaponId).toBe(pick.id);
    });

    it('CANCEL writes the weapon objects and the four arrays in place', () => {
        const r = rig();
        r.editor.show();
        const slot = r.profile.loadouts[0];
        if (slot === undefined) throw new Error('no class');
        const held = { primary: slot.primary, secondary: slot.secondary, perks: slot.perks, streaks: slot.streaks };
        const attachments = slot.primary.attachments;
        const perksBefore = [...slot.perks];
        r.editor.openBox('perks', 0);
        fire(actions(r).cancel, 'click');
        // BACKLOG #72, fixed 2026-11-22. The last three assertions were `not.toBe`: the two
        // weapon objects were written in place and the four arrays inside them were replaced,
        // one level below where `assignSlot`'s own comment says it writes rather than replaces.
        expect(slot.primary).toBe(held.primary);
        expect(slot.secondary).toBe(held.secondary);
        expect(slot.perks).toBe(held.perks);
        expect(slot.streaks).toBe(held.streaks);
        expect(slot.primary.attachments).toBe(attachments);
        // In place, and with the right contents: an array kept and not written is the other bug.
        expect(slot.perks).toEqual(perksBefore);
    });

    it('CANCEL with nothing open does nothing', () => {
        const r = rig();
        r.editor.show();
        const before = r.profile.loadouts[0]?.name;
        fire(actions(r).cancel, 'click');
        expect(r.profile.loadouts[0]?.name).toBe(before);
    });

    it('offers one exit under the list, and it is the caller’s', () => {
        const r = rig();
        r.editor.show();
        const exit = find(frame(r), 'lo-exit');
        expect(exit.children[0]?.textContent).toBe('SAVE AND EXIT');
        expect(exit.classList.contains('op-cta--primary')).toBe(true);
        fire(exit, 'click');
        expect(r.exits).toEqual([1]);
    });
});

// ---------------------------------------------------------------------------- the band

describe('the stat band', () => {
    it('resolves the open class on every refresh, naming the base weapon when nothing is fitted', () => {
        const r = rig();
        r.profile.editLoadout(0, (s) => {
            s.primary.attachments = [];
            s.perks = [null, null, null];
        });
        r.editor.show();
        r.editor.openBox('primary', 0);
        const band = find(frame(r), 'lo-band');
        const def = requireWeapon(r.profile.loadouts[0]?.primary.weaponId ?? '');
        expect(find(band, 'lo-stats__title').textContent).toBe(def.name);
        expect(find(band, 'op-label').textContent).toBe('BASE WEAPON');
    });

    it('names the default class’s own two perks, the class not being bare', () => {
        const r = rig();
        r.editor.show();
        const slot = r.profile.loadouts[0];
        const fitted = [
            ...(slot?.primary.attachments ?? []).map((id) => attachmentDef(id).name),
            ...[0, 1, 2]
                .map((i) => slot?.perks[i])
                .filter((id): id is NonNullable<typeof id> => id !== null && id !== undefined)
                .map((id) => perkDef(id).name),
        ];
        expect(find(find(frame(r), 'lo-band'), 'op-label').textContent).toBe(fitted.join(' · '));
    });

    it('names the attachments and the perks that are moving the numbers', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const weaponId = r.profile.loadouts[0]?.primary.weaponId ?? '';
        const first = attachmentsForWeapon(requireWeapon(weaponId))[0];
        const perk = perksOfTier(1)[0];
        if (first === undefined || perk === undefined) throw new Error('nothing to fit');
        r.profile.unlockAttachment(weaponId, first);
        r.profile.editLoadout(0, (s) => {
            s.primary.attachments = [first];
            s.perks = [perk.id, null, null];
        });
        r.editor.show();
        expect(find(find(frame(r), 'lo-band'), 'op-label').textContent).toBe(
            `${attachmentDef(first).name} · ${perk.name}`,
        );
    });

    it('prints the twenty-one rows the panel holds', () => {
        const r = rig();
        r.editor.show();
        expect(statRows(r)).toHaveLength(21);
        expect(statFor(r, 'Damage near').children[1]?.textContent).toBe(
            requireWeapon(r.profile.loadouts[0]?.primary.weaponId ?? '').damage.near.toFixed(0),
        );
    });

    it('moves a row once an attachment changes it', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const weaponId = r.profile.loadouts[0]?.primary.weaponId ?? '';
        const fits = attachmentsForWeapon(requireWeapon(weaponId));
        for (const id of fits) r.profile.unlockAttachment(weaponId, id);
        r.profile.editLoadout(0, (s) => {
            s.primary.attachments = [...fits];
        });
        r.editor.show();
        expect(statRows(r).some((row) => row.classList.contains('is-changed'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------- stage / hover

describe('the stage and what stands on it', () => {
    function preview(r: Rig): FakeElement {
        return find(frame(r), 'lo-preview--stage');
    }

    it('keeps the operator and hides the preview while the list shows the categories', () => {
        const r = rig();
        r.editor.show();
        expect(preview(r).hidden).toBe(true);
        expect(find(frame(r), 'lo-stage__status').hidden).toBe(false);
    });

    it('puts the weapon on the stage for the three weapon tabs and nothing else', () => {
        const r = rig();
        r.editor.show();
        for (const tab of [0, 1, 2]) {
            r.editor.openBox('primary', tab);
            expect(preview(r).hidden).toBe(false);
            expect(find(frame(r), 'lo-stage__status').hidden).toBe(true);
        }
        r.editor.openBox('perks', 0);
        expect(preview(r).hidden).toBe(true);
        expect(find(frame(r), 'lo-stage__status').hidden).toBe(false);
    });

    it('captions the preview with the weapon it is showing', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('secondary', 0);
        const def = requireWeapon(r.profile.loadouts[0]?.secondary.weaponId ?? '');
        expect(find(preview(r), 'lo-preview__name').textContent).toBe(def.name);
    });

    it('holds the hovered weapon after the debounce, not before it', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const def = requireWeapon(lockedWeaponId());
        const bar = optionNamed(r, def.name).el;
        const was = find(preview(r), 'lo-preview__name').textContent;
        fire(bar, 'pointerenter');
        expect(find(preview(r), 'lo-preview__name').textContent).toBe(was);
        runTimers();
        expect(find(preview(r), 'lo-preview__name').textContent).toBe(def.name);
    });

    it('drops the hovered weapon again on the way out', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const def = requireWeapon(lockedWeaponId());
        const bar = optionNamed(r, def.name).el;
        const equipped = requireWeapon(r.profile.loadouts[0]?.primary.weaponId ?? '');
        fire(bar, 'pointerenter');
        runTimers();
        fire(bar, 'pointerleave');
        runTimers();
        expect(find(preview(r), 'lo-preview__name').textContent).toBe(equipped.name);
    });

    it('takes the keyboard’s focus as a hover and a blur as a leave', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const def = requireWeapon(lockedWeaponId());
        const bar = optionNamed(r, def.name).el;
        fire(bar, 'focus');
        runTimers();
        expect(find(preview(r), 'lo-preview__name').textContent).toBe(def.name);
        fire(bar, 'blur');
        runTimers();
        expect(find(preview(r), 'lo-preview__name').textContent).not.toBe(def.name);
    });

    it('cancels the pending hold when a second bar is entered first', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const shown = options(r).filter((o) => !o.hidden);
        const a = shown[1];
        const b = shown[2];
        if (a === undefined || b === undefined) throw new Error('not enough bars on the page');
        // Measured as a delta: the profile's own debounced save shares this queue.
        const base = pendingTimers();
        fire(a.el, 'pointerenter');
        fire(b.el, 'pointerenter');
        expect(pendingTimers()).toBe(base + 1);
        runTimers();
        expect(find(preview(r), 'lo-preview__name').textContent).toBe(b.name);
    });

    it('cancels a pending hold when the list closes', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const shown = options(r).filter((o) => !o.hidden);
        const a = shown[1];
        if (a === undefined) throw new Error('not enough bars');
        const base = pendingTimers();
        fire(a.el, 'pointerenter');
        expect(pendingTimers()).toBe(base + 1);
        r.editor.openBox('perks', 0);
        expect(pendingTimers()).toBe(base);
    });

    it('cancels a pending hold when the screen is hidden', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        const shown = options(r).filter((o) => !o.hidden);
        const a = shown[1];
        if (a === undefined) throw new Error('not enough bars');
        const base = pendingTimers();
        fire(a.el, 'pointerenter');
        r.editor.hide();
        expect(pendingTimers()).toBe(base);
    });

    it('hides the skin toggle while a weapon stands on the stage', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        expect(find(frame(r), 'lo-skins__toggle').hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the skin strip

describe('the skin strip', () => {
    it('is a listbox of every bot skin, closed to begin with', () => {
        const r = rig();
        r.editor.show();
        const strip = find(frame(r), 'lo-skins__strip');
        expect(strip.getAttribute('role')).toBe('listbox');
        expect(strip.getAttribute('aria-label')).toBe('Skins');
        expect(strip.hidden).toBe(true);
        expect(findAll(frame(r), 'lo-skin')).toHaveLength(BOT_CHARACTER_IDS.length);
    });

    it('names each skin and shows its pre-rendered thumbnail, undraggable', () => {
        const r = rig();
        r.editor.show();
        const tiles = findAll(frame(r), 'lo-skin');
        expect(tiles.map((t) => t.children[1]?.textContent)).toEqual(
            BOT_CHARACTER_IDS.map((id) => characterDefinition(id).name),
        );
        expect(tiles.map((t) => t.children[0]?.src)).toEqual(BOT_CHARACTER_IDS.map((id) => characterDefinition(id).thumbUrl));
        expect(tiles.every((t) => t.children[0]?.draggable === false)).toBe(true);
        expect(tiles.every((t) => t.children[0]?.alt === '')).toBe(true);
    });

    it('opens and closes on the toggle, which says which it is', () => {
        const r = rig();
        r.editor.show();
        const toggle = find(frame(r), 'lo-skins__toggle');
        const strip = find(frame(r), 'lo-skins__strip');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fire(toggle, 'click');
        expect(strip.hidden).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.classList.contains('is-open')).toBe(true);
        expect(find(frame(r), 'lo-skins').classList.contains('is-open')).toBe(true);
        fire(toggle, 'click');
        expect(strip.hidden).toBe(true);
    });

    it('reads CHANGE A SKIN with a figure and a chevron', () => {
        const r = rig();
        r.editor.show();
        const toggle = find(frame(r), 'lo-skins__toggle');
        expect(toggle.children.map((c) => classOf(c))).toEqual([
            'op-cta__lead',
            '',
            'op-cta__chevron lo-skins__chevron',
        ]);
        expect(toggle.children[1]?.textContent).toBe('CHANGE A SKIN');
    });

    it('opens the strip for the layout probe without touching the toggle', () => {
        const r = rig();
        r.editor.show();
        r.editor.openSkins();
        expect(find(frame(r), 'lo-skins__strip').hidden).toBe(false);
    });

    it('marks the profile’s skin and writes a new one through', () => {
        const r = rig();
        r.editor.show();
        const tiles = findAll(frame(r), 'lo-skin');
        const marked = tiles.findIndex((t) => t.classList.contains('is-on'));
        expect(BOT_CHARACTER_IDS[marked]).toBe(r.profile.skinId);
        const other = tiles.findIndex((_t, i) => i !== marked);
        fire(tiles[other] as FakeElement, 'click');
        expect(r.profile.skinId).toBe(BOT_CHARACTER_IDS[other]);
        expect(tiles[other]?.classList.contains('is-on')).toBe(true);
        expect(tiles[other]?.getAttribute('aria-selected')).toBe('true');
        expect(tiles[marked]?.classList.contains('is-on')).toBe(false);
    });

    it('closes the strip on a fresh show', () => {
        const r = rig();
        r.editor.show();
        r.editor.openSkins();
        r.editor.show();
        expect(find(frame(r), 'lo-skins__strip').hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the tooltip

describe('the tooltip', () => {
    function tip(r: Rig): FakeElement {
        return find(frame(r), 'lo-tip');
    }

    function layOut(r: Rig, anchorTop: number, anchorBottom: number): void {
        const f = frame(r);
        f.rect = { left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080 };
        tip(r).offsetWidth = 200;
        tip(r).offsetHeight = 60;
        for (const chip of findAll(f, 'lo-chip')) {
            chip.rect = { left: 100, top: anchorTop, right: 300, bottom: anchorBottom, width: 200, height: 40 };
        }
    }

    it('shows a chip’s explanation on hover and hides it again', () => {
        const r = rig();
        r.editor.show();
        layOut(r, 100, 140);
        const chip = find(frame(r), 'lo-chip');
        fire(chip, 'pointerenter');
        expect(tip(r).hidden).toBe(false);
        expect(tip(r).textContent).not.toBe('');
        fire(chip, 'pointerleave');
        expect(tip(r).hidden).toBe(true);
    });

    it('answers the keyboard as well as the pointer', () => {
        const r = rig();
        r.editor.show();
        layOut(r, 100, 140);
        const chip = find(frame(r), 'lo-chip');
        fire(chip, 'focus');
        expect(tip(r).hidden).toBe(false);
        fire(chip, 'blur');
        expect(tip(r).hidden).toBe(true);
    });

    it('carries the weapon’s own blurb on the primary bar’s lead chip', () => {
        const r = rig();
        r.editor.show();
        layOut(r, 100, 140);
        const chip = readCategory(categoryBar(r, 'primary')).chips[0]?.el;
        if (chip === undefined) throw new Error('no lead chip');
        fire(chip, 'pointerenter');
        const def = requireWeapon(r.profile.loadouts[0]?.primary.weaponId ?? '');
        expect(tip(r).textContent).toBe(`${def.class} · LV 1 · 0 kills · 0 hs · no shots`);
    });

    it('explains an empty perk tier and an empty killstreak key by name', () => {
        const r = rig();
        r.profile.editLoadout(0, (s) => {
            s.perks = [null, null, null];
            s.streaks = [null, null, null];
        });
        r.editor.show();
        layOut(r, 100, 140);
        const perkChip = readCategory(categoryBar(r, 'perks')).chips[1]?.el;
        const streakChip = readCategory(categoryBar(r, 'streaks')).chips[2]?.el;
        if (perkChip === undefined || streakChip === undefined) throw new Error('no empty chips');
        fire(perkChip, 'pointerenter');
        expect(tip(r).textContent).toBe('Perk 2: empty');
        fire(streakChip, 'pointerenter');
        expect(tip(r).textContent).toBe('Key 5: empty');
    });

    it('stands under the chip, in frame pixels', () => {
        const r = rig();
        r.editor.show();
        layOut(r, 100, 140);
        fire(find(frame(r), 'lo-chip'), 'pointerenter');
        expect(tip(r).style['left']).toBe('100px');
        expect(tip(r).style['top']).toBe('148px');
        expect(tip(r).classList.contains('is-above')).toBe(false);
    });

    it('flips above the chip when below would leave the frame', () => {
        const r = rig();
        r.editor.show();
        layOut(r, 1000, 1040);
        fire(find(frame(r), 'lo-chip'), 'pointerenter');
        expect(tip(r).classList.contains('is-above')).toBe(true);
        expect(tip(r).style['top']).toBe('932px');
    });

    it('pulls itself back inside the frame’s right margin', () => {
        const r = rig();
        r.editor.show();
        layOut(r, 100, 140);
        for (const chip of findAll(frame(r), 'lo-chip')) {
            chip.rect = { left: 1850, top: 100, right: 1900, bottom: 140, width: 50, height: 40 };
        }
        fire(find(frame(r), 'lo-chip'), 'pointerenter');
        expect(tip(r).style['left']).toBe('1704px');
    });

    it('divides by the frame’s scale, so a zoomed frame still places it', () => {
        const r = rig();
        r.editor.show();
        const f = frame(r);
        f.rect = { left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 };
        tip(r).offsetWidth = 100;
        tip(r).offsetHeight = 30;
        for (const chip of findAll(f, 'lo-chip')) {
            chip.rect = { left: 50, top: 50, right: 150, bottom: 70, width: 100, height: 20 };
        }
        fire(find(f, 'lo-chip'), 'pointerenter');
        // Half scale: a chip whose foot is 70 window pixels down is 140 frame pixels down.
        expect(tip(r).style['left']).toBe('100px');
        expect(tip(r).style['top']).toBe('148px');
    });
});

// ---------------------------------------------------------------------------- the range door

describe('the range door', () => {
    it('says in the subtitle that nothing is gated and nothing is banked', () => {
        const r = rig();
        r.editor.show(true);
        const head = find(r.layer, 'op-head');
        expect(findAll(head, 'op-head__sub').map((el) => el.textContent)).toContain(
            'SHOOTING RANGE — ALL CONTENT UNLOCKED, NO PROGRESS BANKED',
        );
    });

    it('opens every weapon, perk, grenade and upgrade', () => {
        const r = rig();
        r.editor.show(true);
        for (const box of ['primary', 'equipment', 'perks', 'field'] as const) {
            r.editor.openBox(box, 0);
            expect(options(r).every((o) => !o.locked)).toBe(true);
        }
    });

    it('edits the range’s own class and leaves the five alone', () => {
        const r = rig();
        const wasFive = r.profile.loadouts.map((s) => s.fieldUpgrade);
        r.editor.show(true);
        r.editor.openBox('field', 0);
        const last = FIELD_UPGRADE_IDS[FIELD_UPGRADE_IDS.length - 1];
        if (last === undefined) throw new Error('no field upgrades');
        fire(optionNamed(r, fieldUpgradeDef(last).name).el, 'click');
        expect(r.profile.rangeLoadout().fieldUpgrade).toBe(last);
        expect(r.profile.loadouts.map((s) => s.fieldUpgrade)).toEqual(wasFive);
    });

    it('draws the range’s class in the band rather than the equipped one', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        const pick = ALL_WEAPONS.filter((d) => d.slot === 'primary')[1];
        if (pick === undefined) throw new Error('one primary only');
        r.profile.rangeLoadout().primary.weaponId = pick.id;
        r.editor.show(true);
        expect(find(find(frame(r), 'lo-band'), 'lo-stats__title').textContent).toBe(pick.name);
    });

    it('still paints the five plates, so the strip is the same shape either way', () => {
        const r = rig();
        r.editor.show(true);
        expect(plates(r)).toHaveLength(5);
    });

    it('goes back to the five classes on an ordinary show', () => {
        const r = rig();
        r.editor.show(true);
        r.editor.show();
        const head = find(r.layer, 'op-head');
        expect(findAll(head, 'op-head__sub').map((el) => el.textContent)).toContain('CUSTOMISE YOUR LOADOUT');
    });
});

// ---------------------------------------------------------------------------- tick and hide

describe('the frame it is driven by', () => {
    it('does nothing at all while the screen is hidden', () => {
        const r = rig();
        // Nothing is painted before the first `show`, so a tick that reached the stage would
        // throw rather than merely waste a frame.
        expect(() => r.editor.tick(0.016)).not.toThrow();
        expect(findAll(r.layer, 'lo-stage__status')).toEqual([]);
    });

    it('leaves the status line saying the operator is loading until one arrives', () => {
        const r = rig();
        r.editor.show();
        expect(find(frame(r), 'lo-stage__status').textContent).toBe('LOADING OPERATOR…');
    });

    it('survives a hide before it was ever shown', () => {
        const r = rig();
        expect(() => r.editor.hide()).not.toThrow();
        expect(r.layer.hidden).toBe(true);
    });

    it('can be shown again after a hide, from the categories', () => {
        const r = rig();
        r.editor.show();
        r.editor.openBox('primary', 0);
        r.editor.hide();
        r.editor.show();
        expect(find(frame(r), 'lo-cats').hidden).toBe(false);
        expect(optionBars(r)).toEqual([]);
    });

    it('persists what the player did, once the debounced save runs', () => {
        const r = rig();
        r.profile.maxAccountLevel();
        r.editor.show();
        r.editor.openBox('field', 0);
        const last = FIELD_UPGRADE_IDS[FIELD_UPGRADE_IDS.length - 1];
        if (last === undefined) throw new Error('no field upgrades');
        fire(optionNamed(r, fieldUpgradeDef(last).name).el, 'click');
        runTimers();
        expect([...storage.values()].join('')).toContain(last);
    });
});
