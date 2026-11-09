import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireWeapon, type WeaponDef } from '../../shared/weapons/WeaponDefs';
import { LoadoutStats } from './LoadoutStats';

/**
 * Characterization tests for the stat read-out (refactor unit C16, written before the refactor).
 *
 * The component computes nothing — it is handed two `WeaponDef`s and prints fields off them —
 * so what is worth pinning is the *formatting*: which rows exist in which order, how many
 * digits each carries, which ones are scaled before printing, and the one judgement the panel
 * makes, which is whether a row moved and whether the move helps.
 *
 * The two defs are real ones out of the registry, deep-copied and edited, so a row that reads
 * `d.spread.hipStand` is exercised against the shape the gameplay hands it rather than a
 * literal that happens to have the right keys.
 */

// ---------------------------------------------------------------------------- the DOM double

class FakeElement {
    readonly tokens = new Set<string>();
    readonly children: FakeElement[] = [];
    textContent = '';
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
        toggle: (token: string, on?: boolean): void => {
            const want = on ?? !this.tokens.has(token);
            if (want) this.tokens.add(token);
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
}

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

/** A real weapon, copied deeply enough that a nested edit cannot reach the registry's own. */
function weapon(id = 'ar_carbine'): WeaponDef {
    const def = requireWeapon(id);
    return {
        ...def,
        damage: { ...def.damage },
        damageFalloff: { ...def.damageFalloff },
        spread: { ...def.spread },
        recoil: { ...def.recoil },
    };
}

interface Rig {
    readonly stats: LoadoutStats;
    readonly root: FakeElement;
}

function rig(): Rig {
    const stats = new LoadoutStats();
    return { stats, root: stats.element as unknown as FakeElement };
}

function body(root: FakeElement): FakeElement {
    const found = root.children[2];
    if (found === undefined) throw new Error('the panel has no body');
    return found;
}

/** The stat rows, without the footer the loop appends after them. */
function rows(root: FakeElement): readonly FakeElement[] {
    return body(root).children.slice(0, -1);
}

function footer(root: FakeElement): FakeElement {
    const kids = body(root).children;
    const found = kids[kids.length - 1];
    if (found === undefined) throw new Error('the panel has no footer');
    return found;
}

/** One row by its label, read back as the pieces the panel drew for it. */
function row(root: FakeElement, label: string) {
    const found = rows(root).find((el) => el.children[0]?.textContent === label);
    if (found === undefined) throw new Error(`no row labelled ${label}`);
    const value = found.children[1];
    if (value === undefined) throw new Error(`row ${label} has no value`);
    return {
        el: found,
        changed: found.classList.contains('is-changed'),
        /** The plain read-out, for an unchanged row. */
        text: value.textContent,
        parts: value.children.map((p) => ({ cls: p.className, text: p.textContent })),
    };
}

const LABELS = [
    'Damage near',
    'Damage far',
    'Headshot',
    'Falloff start',
    'Falloff end',
    'Rate of fire',
    'Magazine',
    'Reserve',
    'Reload',
    'Reload empty',
    'ADS time',
    'Sprint to fire',
    'Swap in',
    'Move speed',
    'Hip spread',
    'Moving spread',
    'Aimed spread',
    'Recoil vertical',
    'Recoil lateral',
    'Penetration',
    'Pellets',
];

// ---------------------------------------------------------------------------- the tests

describe('the panel it builds', () => {
    it('is a lo-stats box of a title, a subtitle and a body', () => {
        const { root } = rig();
        expect(root.className).toBe('lo-stats');
        expect(root.children.map((c) => c.className)).toEqual(['lo-stats__title', 'op-label', 'lo-stats__body']);
    });

    it('is empty until it is shown', () => {
        const { root } = rig();
        expect(body(root).children).toEqual([]);
    });

    it('titles itself with the resolved weapon rather than the base', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.name = 'MK18 · FITTED';
        stats.show(base, resolved, 'OPTIC');
        expect(root.children[0]?.textContent).toBe('MK18 · FITTED');
        expect(root.children[1]?.textContent).toBe('OPTIC');
    });

    it('draws one row per stat, in the table’s order, plus the footer', () => {
        const { stats, root } = rig();
        stats.show(weapon(), weapon(), 'BASE WEAPON');
        expect(rows(root)).toHaveLength(LABELS.length);
        expect(rows(root).map((r) => r.children[0]?.textContent)).toEqual(LABELS);
        expect(body(root).children).toHaveLength(LABELS.length + 1);
    });

    it('replaces the rows on a second show rather than appending to them', () => {
        const { stats, root } = rig();
        stats.show(weapon(), weapon(), 'BASE WEAPON');
        stats.show(weapon(), weapon(), 'BASE WEAPON');
        expect(body(root).children).toHaveLength(LABELS.length + 1);
    });

    it('labels and values carry their own classes', () => {
        const { stats, root } = rig();
        stats.show(weapon(), weapon(), 'BASE WEAPON');
        const first = rows(root)[0];
        expect(first?.className).toBe('lo-stat');
        expect(first?.children[0]?.className).toBe('lo-stat__label');
        expect(first?.children[1]?.className).toBe('lo-stat__value op-num');
    });
});

describe('a row that did not move', () => {
    it('prints the resolved value plainly, with no from/arrow/to', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, weapon(), 'BASE WEAPON');
        const r = row(root, 'Damage near');
        expect(r.changed).toBe(false);
        expect(r.parts).toEqual([]);
        expect(r.text).toBe(`${def.damage.near.toFixed(0)}`);
    });

    it('counts as unmoved when the two differ by less than the epsilon', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.damage.near = base.damage.near + 1e-7;
        stats.show(base, resolved, 'BASE WEAPON');
        expect(row(root, 'Damage near').changed).toBe(false);
    });

    it('counts as moved when the two differ by more than the epsilon, however small the print', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.damage.near = base.damage.near + 1e-5;
        stats.show(base, resolved, 'BASE WEAPON');
        const r = row(root, 'Damage near');
        expect(r.changed).toBe(true);
        // Both ends round to the same printed number: the row is marked changed and reads twice
        // the same value, which is the epsilon being a float guard rather than a display rule.
        expect(r.parts[0]?.text).toBe(r.parts[2]?.text);
    });
});

describe('a row that moved', () => {
    it('prints base, an arrow and resolved, each in its own span', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.damage.near = base.damage.near + 7;
        stats.show(base, resolved, 'OPTIC');
        const r = row(root, 'Damage near');
        expect(r.changed).toBe(true);
        expect(r.parts.map((p) => p.cls)).toEqual(['lo-stat__from', 'lo-stat__arrow', 'lo-stat__to is-better']);
        expect(r.parts[0]?.text).toBe(base.damage.near.toFixed(0));
        expect(r.parts[1]?.text).toBe('→');
        expect(r.parts[2]?.text).toBe((base.damage.near + 7).toFixed(0));
    });

    it('is better when a higher-is-better number rises', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.magSize = base.magSize + 10;
        stats.show(base, resolved, 'MAG');
        expect(row(root, 'Magazine').parts[2]?.cls).toBe('lo-stat__to is-better');
    });

    it('is worse when a higher-is-better number falls', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.magSize = base.magSize - 10;
        stats.show(base, resolved, 'MAG');
        expect(row(root, 'Magazine').parts[2]?.cls).toBe('lo-stat__to is-worse');
    });

    it('is worse when a lower-is-better number rises', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.adsTime = base.adsTime + 0.05;
        stats.show(base, resolved, 'OPTIC');
        expect(row(root, 'ADS time').parts[2]?.cls).toBe('lo-stat__to is-worse');
    });

    it('is better when a lower-is-better number falls', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.adsTime = base.adsTime - 0.05;
        stats.show(base, resolved, 'OPTIC');
        expect(row(root, 'ADS time').parts[2]?.cls).toBe('lo-stat__to is-better');
    });

    it('colours a fallen recoil as better and a risen one as worse', () => {
        const { stats, root } = rig();
        const base = weapon();
        const down = weapon();
        down.recoil.verticalScale = base.recoil.verticalScale - 0.2;
        stats.show(base, down, 'GRIP');
        expect(row(root, 'Recoil vertical').parts[2]?.cls).toBe('lo-stat__to is-better');
        const up = weapon();
        up.recoil.horizontalScale = base.recoil.horizontalScale + 0.2;
        stats.show(base, up, 'BARREL');
        expect(row(root, 'Recoil lateral').parts[2]?.cls).toBe('lo-stat__to is-worse');
    });
});

describe('the units and the digits', () => {
    it('prints the four damage and count rows as whole numbers with no unit', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Damage near').text).toBe(def.damage.near.toFixed(0));
        expect(row(root, 'Damage far').text).toBe(def.damage.far.toFixed(0));
        expect(row(root, 'Magazine').text).toBe(def.magSize.toFixed(0));
        expect(row(root, 'Reserve').text).toBe(def.reserveAmmo.toFixed(0));
        expect(row(root, 'Pellets').text).toBe(def.pellets.toFixed(0));
    });

    it('prints the headshot and the two recoils as two-digit multipliers', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Headshot').text).toBe(`${def.headshotMult.toFixed(2)}x`);
        expect(row(root, 'Recoil vertical').text).toBe(`${def.recoil.verticalScale.toFixed(2)}x`);
        expect(row(root, 'Recoil lateral').text).toBe(`${def.recoil.horizontalScale.toFixed(2)}x`);
    });

    it('prints the two falloff distances to one metre decimal', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Falloff start').text).toBe(`${def.damageFalloff.start.toFixed(1)} m`);
        expect(row(root, 'Falloff end').text).toBe(`${def.damageFalloff.end.toFixed(1)} m`);
    });

    it('prints penetration to two metre decimals', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Penetration').text).toBe(`${def.penetration.toFixed(2)} m`);
    });

    it('prints the rate of fire in rpm', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Rate of fire').text).toBe(`${def.rpm.toFixed(0)} rpm`);
    });

    it('scales the five time rows from seconds to whole milliseconds', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Reload').text).toBe(`${(def.reloadTime * 1000).toFixed(0)} ms`);
        expect(row(root, 'Reload empty').text).toBe(`${(def.reloadEmptyTime * 1000).toFixed(0)} ms`);
        expect(row(root, 'ADS time').text).toBe(`${(def.adsTime * 1000).toFixed(0)} ms`);
        expect(row(root, 'Sprint to fire').text).toBe(`${(def.sprintOutTime * 1000).toFixed(0)} ms`);
        expect(row(root, 'Swap in').text).toBe(`${(def.swapInTime * 1000).toFixed(0)} ms`);
    });

    it('scales move speed to a whole percentage', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Move speed').text).toBe(`${(def.moveSpeedMult * 100).toFixed(0)}%`);
    });

    it('prints the three spreads to three degree decimals', () => {
        const { stats, root } = rig();
        const def = weapon();
        stats.show(def, def, 'BASE WEAPON');
        expect(row(root, 'Hip spread').text).toBe(`${def.spread.hipStand.toFixed(3)}°`);
        expect(row(root, 'Moving spread').text).toBe(`${def.spread.hipMove.toFixed(3)}°`);
        expect(row(root, 'Aimed spread').text).toBe(`${def.spread.ads.toFixed(3)}°`);
    });

    it('compares a scaled row after the scale, so a millisecond move is seen', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        // 2e-6 s is above the epsilon only once multiplied by a thousand; 2e-10 s never is.
        resolved.adsTime = base.adsTime + 2e-6;
        stats.show(base, resolved, 'OPTIC');
        expect(row(root, 'ADS time').changed).toBe(true);
        const quiet = weapon();
        quiet.adsTime = base.adsTime + 2e-10;
        stats.show(base, quiet, 'OPTIC');
        expect(row(root, 'ADS time').changed).toBe(false);
    });
});

describe('the footer', () => {
    it('says nothing is fitted when no row moved', () => {
        const { stats, root } = rig();
        stats.show(weapon(), weapon(), 'BASE WEAPON');
        expect(footer(root).textContent).toBe('No modifiers fitted — these are the base values');
        expect(footer(root).className).toBe('lo-stats__footer op-label');
    });

    it('counts one moved row in the singular', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.magSize = base.magSize + 10;
        stats.show(base, resolved, 'MAG');
        expect(footer(root).textContent).toBe('1 value changed by attachments and perks');
    });

    it('counts several moved rows in the plural', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.magSize = base.magSize + 10;
        resolved.adsTime = base.adsTime + 0.05;
        resolved.spread.ads = base.spread.ads + 0.5;
        stats.show(base, resolved, 'OPTIC · MAG');
        expect(footer(root).textContent).toBe('3 values changed by attachments and perks');
    });

    it('counts a row that moved below the printed precision', () => {
        const { stats, root } = rig();
        const base = weapon();
        const resolved = weapon();
        resolved.damage.near = base.damage.near + 1e-5;
        stats.show(base, resolved, 'OPTIC');
        expect(footer(root).textContent).toBe('1 value changed by attachments and perks');
    });

    it('is the last child of the body, after every row', () => {
        const { stats, root } = rig();
        stats.show(weapon(), weapon(), 'BASE WEAPON');
        const kids = body(root).children;
        expect(kids[kids.length - 1]?.className).toContain('lo-stats__footer');
        expect(kids.filter((k) => k.className === 'lo-stat')).toHaveLength(LABELS.length);
    });
});

describe('a different weapon in each hand', () => {
    it('reads both defs rather than resolving anything itself', () => {
        const { stats, root } = rig();
        const base = weapon('ar_carbine');
        const resolved = weapon('smg_wasp');
        stats.show(base, resolved, 'A DIFFERENT GUN');
        const r = row(root, 'Rate of fire');
        expect(r.changed).toBe(base.rpm !== resolved.rpm);
        if (r.changed) {
            expect(r.parts[0]?.text).toBe(`${base.rpm.toFixed(0)} rpm`);
            expect(r.parts[2]?.text).toBe(`${resolved.rpm.toFixed(0)} rpm`);
        }
    });

    it('marks every row unchanged when the same def is handed in twice', () => {
        const { stats, root } = rig();
        const def = weapon('ar_vulcan');
        stats.show(def, def, 'BASE WEAPON');
        expect(rows(root).every((r) => !r.classList.contains('is-changed'))).toBe(true);
    });
});
