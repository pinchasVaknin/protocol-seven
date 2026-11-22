import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODE_ID, findMode, MODES } from '../shared/modes/ModeRegistry';
import { defaultSettings } from '../shared/meta/SaveData';
import { cloneWeaponDef, WEAPON_DEFS } from '../shared/weapons/WeaponDefs';
import { Profile } from './meta/Profile';
import { applyEquippedLoadout, asModeId, type LoadoutTargets } from './GameLoadout';
import { installFakeDom, type FakeDom } from './ui/testing/dom';

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 342 lines of hand-grown double. It is the same double -- the file it
 * moved to was written from this one -- so nothing this suite sees has changed.
 */

let env: FakeDom;

beforeEach(() => {
    env = installFakeDom();
});

afterEach(() => {
    env.restore();
});

// ---------------------------------------------------------------------------- the rig

function profile(): Profile {
    return new Profile({ fallbackSettings: defaultSettings('TDM', 'mp_foundry', 90) });
}

function targets(): LoadoutTargets {
    return {
        primary: cloneWeaponDef(WEAPON_DEFS['ar_carbine']!),
        secondary: cloneWeaponDef(WEAPON_DEFS['pistol_talon']!),
        playerBase: cloneWeaponDef(WEAPON_DEFS['ar_carbine']!),
    };
}

// ---------------------------------------------------------------------------- the mode id

describe('asModeId', () => {
    it('takes every mode the registry knows', () => {
        for (const mode of MODES) expect(asModeId(mode.id)).toBe(mode.id);
    });

    /** A stored mode id that no longer exists falls back rather than throwing. */
    it('falls back to the default for an id that no longer exists', () => {
        expect(asModeId('OBJECTIVE_RUSH')).toBe(DEFAULT_MODE_ID);
        expect(asModeId('')).toBe(DEFAULT_MODE_ID);
    });

    it('is case-sensitive, because the ids are', () => {
        expect(asModeId('dom')).toBe(DEFAULT_MODE_ID);
    });
});

// ---------------------------------------------------------------------------- the copy

describe('applying the equipped class', () => {
    it('hands back the resolved loadout the match will be given', () => {
        const t = targets();
        const loadout = applyEquippedLoadout(profile(), 'TDM', t);
        expect(loadout.primary.id).toBe(t.primary.id);
        expect(loadout.secondary.id).toBe(t.secondary.id);
    });

    /**
     * The same object, not an equal one: two resolves of the same slot are equal, and "equal"
     * and "the same" are different claims.
     */
    it('keeps the three destination objects, rather than replacing them', () => {
        const t = targets();
        const before = [t.primary, t.secondary, t.playerBase];
        applyEquippedLoadout(profile(), 'TDM', t);
        expect([t.primary, t.secondary, t.playerBase]).toEqual(before);
    });

    it('writes the equipped class into them', () => {
        const p = profile();
        const t = targets();
        const loadout = applyEquippedLoadout(p, 'TDM', t);
        expect(t.primary.id).toBe(loadout.primary.id);
        expect(t.primary.damage).toEqual(loadout.primary.damage);
        expect(t.playerBase.id).toBe(loadout.primaryBase.id);
    });

    /** Writing to a live weapon must never reach back into the registry. */
    it('shares no nested record with the loadout it came from', () => {
        const t = targets();
        const loadout = applyEquippedLoadout(profile(), 'TDM', t);
        expect(t.primary.damage).not.toBe(loadout.primary.damage);
        expect(t.primary.spread).not.toBe(loadout.primary.spread);
        expect(t.primary.recoil).not.toBe(loadout.primary.recoil);
        expect(t.primary.attachmentSlots).not.toBe(loadout.primary.attachmentSlots);
    });

    it('shares nothing with the registry either', () => {
        const t = targets();
        applyEquippedLoadout(profile(), 'TDM', t);
        const registry = WEAPON_DEFS[t.primary.id]!;
        expect(t.primary).not.toBe(registry);
        expect(t.primary.damage).not.toBe(registry.damage);
        const was = registry.damage.near;
        t.primary.damage.near = was + 999;
        expect(registry.damage.near).toBe(was);
    });

    /** A scope is optional, so it is deleted rather than left over from the last class. */
    it('clears a scope the new class does not have', () => {
        const t = targets();
        t.primary.scope = { magnification: 4, glint: false } as never;
        applyEquippedLoadout(profile(), 'TDM', t);
        const hasScope = WEAPON_DEFS[t.primary.id]!.scope !== undefined;
        expect(t.primary.scope === undefined).toBe(!hasScope);
    });

    /** `unrestricted` is the mode's: the range lets a class carry what a match would not. */
    it('asks the mode whether the class is unrestricted', () => {
        const p = profile();
        for (const mode of MODES) {
            const t = targets();
            const loadout = applyEquippedLoadout(p, mode.id, t);
            expect(loadout.primary.id).toBe(p.resolveEquipped(findMode(mode.id).unrestricted).primary.id);
        }
    });

    it('can be applied twice onto the same objects', () => {
        const p = profile();
        const t = targets();
        applyEquippedLoadout(p, 'TDM', t);
        const first = t.primary;
        applyEquippedLoadout(p, 'DOM', t);
        expect(t.primary).toBe(first);
    });
});
