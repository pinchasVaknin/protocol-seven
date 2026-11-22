import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultLoadouts, type LoadoutSlot } from '../../shared/meta/Loadouts';
import { QuickLoadout } from './QuickLoadout';
import { FakeElement } from './testing/dom';

/**
 * Characterization tests for the quick class selector (refactor unit C16, written before the
 * refactor).
 *
 * Three things are worth pinning here and the rest follows from them: the `handleDigit`
 * contract, which is what keeps 1 and 2 swapping weapons and 3-5 spending killstreaks at every
 * moment this panel is closed; the five rows being built once and only relabelled; and the
 * early-out in `paint`, which is the reason a panel up for ten seconds is not ten seconds of
 * DOM writes. The early-out is observed the only way it can be — by writing into a row behind
 * the component's back and watching an unchanged frame leave it there.
 *
 * The classes are real `LoadoutSlot`s out of `defaultLoadouts`, renamed, because `slots()` is
 * the profile's own array in the product.
 */

// ---------------------------------------------------------------------------- the DOM double

/**

 * The element class is shared: `testing/dom.ts` (BACKLOG #79).

 *

 * What stood here was 44 lines of it. This file keeps its own environment: the shared

 * `installFakeDom` installs globals this suite has never run with, and handing a suite a

 * `window` on the way past is how a green suite starts meaning something else.

 */


beforeEach(() => {
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)['document'];
    delete (globalThis as Record<string, unknown>)['HTMLElement'];
});

// ---------------------------------------------------------------------------- the rig

function slots(...names: string[]): LoadoutSlot[] {
    return defaultLoadouts()
        .slice(0, names.length)
        .map((slot, index) => ({ ...slot, name: names[index] ?? slot.name }));
}

interface Rig {
    readonly quick: QuickLoadout;
    readonly host: FakeElement;
    readonly root: FakeElement;
    readonly rows: readonly FakeElement[];
    readonly picks: number[];
    /** How many times the component asked for the classes and for the equipped index. */
    readonly reads: { slots: number; equipped: number };
    equipped: number;
    classes: readonly LoadoutSlot[];
}

function rig(classes: readonly LoadoutSlot[] = slots('ASSAULT', 'SCOUT', 'SUPPORT', 'RECON', 'BREACH')): Rig {
    const host = new FakeElement('div');
    const picks: number[] = [];
    const reads = { slots: 0, equipped: 0 };
    const state = { equipped: 0, classes };
    const quick = new QuickLoadout({
        host: host as unknown as HTMLElement,
        slots: () => {
            reads.slots++;
            return state.classes;
        },
        equipped: () => {
            reads.equipped++;
            return state.equipped;
        },
        onPick: (index) => picks.push(index),
    });
    const root = quick.element as unknown as FakeElement;
    const list = root.children[1];
    if (list === undefined) throw new Error('the panel has no row list');
    return {
        quick,
        host,
        root,
        rows: list.children,
        picks,
        reads,
        get equipped() {
            return state.equipped;
        },
        set equipped(value: number) {
            state.equipped = value;
        },
        get classes() {
            return state.classes;
        },
        set classes(value: readonly LoadoutSlot[]) {
            state.classes = value;
        },
    };
}

function name(row: FakeElement): FakeElement {
    const found = row.children[1];
    if (found === undefined) throw new Error('the row has no name');
    return found;
}

// ---------------------------------------------------------------------------- the tests

describe('the panel it builds', () => {
    it('mounts itself on the host, hidden', () => {
        const { host, root } = rig();
        expect(host.children).toEqual([root]);
        expect(root.className).toBe('ql');
        expect(root.hidden).toBe(true);
    });

    it('is a caption over a list of rows', () => {
        const { root } = rig();
        expect(root.children.map((c) => c.className)).toEqual(['ql__title op-label', 'ql__rows']);
    });

    it('builds five rows whatever the profile holds', () => {
        expect(rig(slots('ONE')).rows).toHaveLength(5);
        expect(rig(slots('A', 'B', 'C', 'D', 'E')).rows).toHaveLength(5);
    });

    it('numbers the rows 1 to 5, each number beside an empty name', () => {
        const { rows } = rig();
        expect(rows.map((r) => r.children[0]?.textContent)).toEqual(['1', '2', '3', '4', '5']);
        expect(rows.map((r) => r.children[0]?.className)).toEqual(Array(5).fill('ql__key op-num'));
        expect(rows.map((r) => name(r).className)).toEqual(Array(5).fill('ql__name'));
        expect(rows.map((r) => name(r).textContent)).toEqual(['', '', '', '', '']);
    });

    it('reports itself closed before it is shown', () => {
        expect(rig().quick.isOpen).toBe(false);
    });

    it('asks for nothing until it is shown', () => {
        const { reads } = rig();
        expect(reads).toEqual({ slots: 0, equipped: 0 });
    });
});

describe('showing it', () => {
    it('unhides the panel and reports itself open', () => {
        const { quick, root } = rig();
        quick.show('SELECT CLASS');
        expect(root.hidden).toBe(false);
        expect(quick.isOpen).toBe(true);
    });

    it('writes the caption it was handed', () => {
        const { quick, root } = rig();
        quick.show('SELECT NEXT CLASS');
        expect(root.children[0]?.textContent).toBe('SELECT NEXT CLASS');
    });

    it('rewrites the caption when the window changes', () => {
        const { quick, root } = rig();
        quick.show('SELECT CLASS');
        quick.show('SELECT NEXT CLASS');
        expect(root.children[0]?.textContent).toBe('SELECT NEXT CLASS');
    });

    it('leaves the caption alone when it is shown again with the same one', () => {
        const { quick, root } = rig();
        quick.show('SELECT CLASS');
        const title = root.children[0];
        if (title === undefined) throw new Error('no caption');
        title.textContent = 'TOUCHED';
        quick.show('SELECT CLASS');
        expect(title.textContent).toBe('TOUCHED');
    });

    it('labels every row with its class', () => {
        const { quick, rows } = rig();
        quick.show('SELECT CLASS');
        expect(rows.map((r) => name(r).textContent)).toEqual(['ASSAULT', 'SCOUT', 'SUPPORT', 'RECON', 'BREACH']);
        expect(rows.every((r) => !r.hidden)).toBe(true);
    });

    it('hides the rows the profile has no class for', () => {
        const { quick, rows } = rig(slots('ASSAULT', 'SCOUT'));
        quick.show('SELECT CLASS');
        expect(rows.map((r) => r.hidden)).toEqual([false, false, true, true, true]);
        expect(rows.map((r) => name(r).textContent)).toEqual(['ASSAULT', 'SCOUT', '', '', '']);
    });

    it('marks the equipped class and no other', () => {
        const r = rig();
        r.equipped = 2;
        r.quick.show('SELECT CLASS');
        expect(r.rows.map((row) => row.classList.contains('is-selected'))).toEqual([false, false, true, false, false]);
    });

    it('marks nothing when nothing is equipped', () => {
        const r = rig();
        r.equipped = -1;
        r.quick.show('SELECT CLASS');
        expect(r.rows.some((row) => row.classList.contains('is-selected'))).toBe(false);
    });
});

describe('hiding it', () => {
    it('hides the panel and reports itself closed', () => {
        const { quick, root } = rig();
        quick.show('SELECT CLASS');
        quick.hide();
        expect(root.hidden).toBe(true);
        expect(quick.isOpen).toBe(false);
    });

    it('does nothing at all when it was already closed', () => {
        const { quick, root } = rig();
        root.hidden = false;
        quick.hide();
        expect(root.hidden).toBe(false);
    });

    it('keeps the labels it had, so reopening does not rebuild them', () => {
        const { quick, rows } = rig();
        quick.show('SELECT CLASS');
        quick.hide();
        expect(name(rows[0] as FakeElement).textContent).toBe('ASSAULT');
    });
});

describe('the digit contract', () => {
    it('eats nothing while closed', () => {
        const { quick, picks } = rig();
        expect(quick.handleDigit(1)).toBe(false);
        expect(picks).toEqual([]);
    });

    it('eats a digit that names a class and reports the zero-based index', () => {
        const { quick, picks } = rig();
        quick.show('SELECT CLASS');
        expect(quick.handleDigit(1)).toBe(true);
        expect(quick.handleDigit(5)).toBe(true);
        expect(picks).toEqual([0, 4]);
    });

    it('refuses zero and anything past the five keys', () => {
        const { quick, picks } = rig();
        quick.show('SELECT CLASS');
        expect(quick.handleDigit(0)).toBe(false);
        expect(quick.handleDigit(6)).toBe(false);
        expect(quick.handleDigit(-1)).toBe(false);
        expect(picks).toEqual([]);
    });

    it('refuses a digit past the classes the profile actually holds', () => {
        const { quick, picks } = rig(slots('ASSAULT', 'SCOUT'));
        quick.show('SELECT CLASS');
        expect(quick.handleDigit(3)).toBe(false);
        expect(quick.handleDigit(2)).toBe(true);
        expect(picks).toEqual([1]);
    });

    it('refuses every digit when the profile holds no class at all', () => {
        const { quick } = rig([]);
        quick.show('SELECT CLASS');
        expect([1, 2, 3, 4, 5].map((d) => quick.handleDigit(d))).toEqual([false, false, false, false, false]);
    });

    it('repaints after a pick, so the mark follows the key', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        r.equipped = 3;
        expect(r.quick.handleDigit(4)).toBe(true);
        expect(r.rows.map((row) => row.classList.contains('is-selected'))).toEqual([false, false, false, true, false]);
    });

    it('does not repaint after a digit it refused', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        const first = name(r.rows[0] as FakeElement);
        first.textContent = 'TOUCHED';
        r.equipped = 1;
        expect(r.quick.handleDigit(9)).toBe(false);
        expect(first.textContent).toBe('TOUCHED');
    });
});

describe('the per-frame update', () => {
    it('does nothing while closed', () => {
        const { quick, reads } = rig();
        quick.update();
        expect(reads).toEqual({ slots: 0, equipped: 0 });
    });

    it('leaves the rows alone on a frame where nothing it draws changed', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        const first = name(r.rows[0] as FakeElement);
        first.textContent = 'TOUCHED';
        r.quick.update();
        expect(first.textContent).toBe('TOUCHED');
    });

    it('still asks the profile its two questions on an unchanged frame', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        const before = { ...r.reads };
        r.quick.update();
        expect(r.reads.slots).toBe(before.slots + 1);
        expect(r.reads.equipped).toBe(before.equipped + 1);
    });

    it('repaints when the equipped class changed', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        r.equipped = 1;
        r.quick.update();
        expect(r.rows.map((row) => row.classList.contains('is-selected'))).toEqual([false, true, false, false, false]);
    });

    it('repaints when a class was renamed', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        r.classes = slots('OVERWATCH', 'SCOUT', 'SUPPORT', 'RECON', 'BREACH');
        r.quick.update();
        expect(name(r.rows[0] as FakeElement).textContent).toBe('OVERWATCH');
    });

    it('repaints when a class went away, hiding its row', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        r.classes = slots('ASSAULT', 'SCOUT');
        r.quick.update();
        expect(r.rows.map((row) => row.hidden)).toEqual([false, false, true, true, true]);
    });

    it('repaints when a class arrived, showing its row', () => {
        const r = rig(slots('ASSAULT'));
        r.quick.show('SELECT CLASS');
        r.classes = slots('ASSAULT', 'SCOUT');
        r.quick.update();
        expect(r.rows.map((row) => row.hidden)).toEqual([false, false, true, true, true]);
        expect(name(r.rows[1] as FakeElement).textContent).toBe('SCOUT');
    });

    it('does not notice a rename that leaves the five names identical', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        const first = name(r.rows[0] as FakeElement);
        first.textContent = 'TOUCHED';
        // A different array of the same five names: the stamp is the names, not the identity.
        r.classes = slots('ASSAULT', 'SCOUT', 'SUPPORT', 'RECON', 'BREACH');
        r.quick.update();
        expect(first.textContent).toBe('TOUCHED');
    });

    it('sees a swap of two names, because the stamp is ordered', () => {
        const r = rig();
        r.quick.show('SELECT CLASS');
        r.classes = slots('SCOUT', 'ASSAULT', 'SUPPORT', 'RECON', 'BREACH');
        r.quick.update();
        expect(r.rows.map((row) => name(row).textContent)).toEqual(['SCOUT', 'ASSAULT', 'SUPPORT', 'RECON', 'BREACH']);
    });
});

describe('disposing of it', () => {
    it('takes the panel off the host', () => {
        const { quick, host } = rig();
        quick.dispose();
        expect(host.children).toEqual([]);
    });
});
