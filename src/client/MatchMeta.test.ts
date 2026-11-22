import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ScoreSystem } from '../shared/combat/ScoreSystem';
import { createGameBus } from '../shared/core/Events';
import { defaultSettings } from '../shared/meta/SaveData';
import { Profile } from './meta/Profile';
import { MatchMeta } from './MatchMeta';
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

function spy(): Record<string, unknown> {
    return new Proxy({}, { get: () => () => undefined }) as Record<string, unknown>;
}

interface Rig {
    readonly meta: MatchMeta;
    readonly profile: Profile;
    readonly player: { speedScale: number; sim: Record<string, number> };
    readonly bots: { silentFootsteps: boolean };
    readonly scene: THREE.Scene;
}

function rig(banksProgress = true): Rig {
    const bus = createGameBus();
    const profile = new Profile({ fallbackSettings: defaultSettings('TDM', 'mp_foundry', 90) });
    const scene = new THREE.Scene();
    const player = { speedScale: 1, sim: { x: 0, y: 0, z: 0, eyeHeight: 1.6 } };
    const bots = { silentFootsteps: false };
    const meta = new MatchMeta({
        bus,
        scene,
        profile,
        loadout: profile.resolveEquipped(false),
        score: new ScoreSystem(bus),
        player: player as never,
        playerHealth: { max: 100 } as never,
        weapons: spy() as never,
        bots: bots as never,
        equipment: spy() as never,
        equipmentInventory: {} as never,
        localTeam: 'A' as never,
        localId: 7,
        banksProgress,
    });
    return { meta, profile, player, bots, scene };
}

// ---------------------------------------------------------------------------- what it composes

describe('what it composes', () => {
    it('owns a tracker, a progression, the perks and the field upgrade', () => {
        const r = rig();
        expect(r.meta.tracker).toBeDefined();
        expect(r.meta.progression).toBeDefined();
        expect(r.meta.perks).toBeDefined();
        expect(r.meta.perksRenderer).toBeDefined();
        expect(r.meta.fieldUpgrade).toBeDefined();
    });

    it('puts the perks\u2019 own group in the scene', () => {
        const r = rig();
        expect(r.scene.children.length).toBeGreaterThan(0);
    });

    it('reports a perk state from the first frame', () => {
        expect(rig().meta.state).toBeDefined();
    });
});

// ---------------------------------------------------------------------------- the hooks

describe('the four hooks', () => {
    /**
     * A perk sets one number on the system that already owns the behaviour -- and the default
     * class already carries one, so the number is 1.07 rather than 1. That is the hook
     * working, not a perk-free baseline.
     */
    it('writes the class\u2019s own move speed onto the player', () => {
        const r = rig();
        expect(r.player.speedScale).toBe(r.meta.state.moveSpeedMult);
        expect(r.player.speedScale).toBeCloseTo(1.07, 10);
    });

    /** Null is the hook's "nobody is quiet": a predicate only exists when a perk asks for one. */
    it('hands the bots no footstep predicate without Dead Silence', () => {
        const r = rig();
        expect(r.meta.state.audibleFootsteps).toBe(true);
        expect(r.bots.silentFootsteps).toBeNull();
    });

    it('re-applies them when the class changes', () => {
        const r = rig();
        r.player.speedScale = 99;
        r.meta.setLoadout(r.profile.resolveEquipped(false));
        expect(r.player.speedScale).toBe(r.meta.state.moveSpeedMult);
    });
});

// ---------------------------------------------------------------------------- the frame

describe('per frame', () => {
    it('simulates without a complaint', () => {
        const r = rig();
        expect(() => r.meta.simulate({} as never, { x: 0, y: 0, z: 0 } as never, true)).not.toThrow();
    });

    it('simulates for a dead player too', () => {
        const r = rig();
        expect(() => r.meta.simulate({} as never, { x: 0, y: 0, z: 0 } as never, false)).not.toThrow();
    });

    it('renders without a renderer', () => {
        const r = rig();
        expect(() => r.meta.render(1 / 60)).not.toThrow();
    });

    it('takes a hundred frames', () => {
        const r = rig();
        for (let i = 0; i < 100; i++) {
            r.meta.simulate({} as never, { x: 0, y: 0, z: 0 } as never, true);
            r.meta.render(1 / 60);
        }
        expect(r.meta.state).toBeDefined();
    });
});

// ---------------------------------------------------------------------------- the report

describe('the XP report', () => {
    it('reports the shape the summary screen reads', () => {
        const report = rig().meta.finish(true);
        expect(Object.keys(report).sort()).toEqual([
            'camosUnlocked',
            'challengesCompleted',
            'levelAfter',
            'levelBefore',
            'lines',
            'total',
            'weaponLevelUps',
            'xpBefore',
        ]);
    });

    it('reports a different total for a win and a loss', () => {
        expect(rig().meta.finish(true).total).not.toBe(rig().meta.finish(false).total);
    });

    /**
     * A testbed must not move the account, and that is now what happens rather than what the
     * comment said (BACKLOG #83, fixed 2026-11-22). This case asserted the opposite of the one
     * below it: that a range reported a *loss*, because `finish` forced the won flag down --
     * and then banked the loss, which is what made the forcing look like caution.
     *
     * The report tells the truth about the session now and the account does not move; the
     * summary's XP strip is still hidden for a range, which is correct, because there is no
     * longer any XP to show.
     */
    it('reports a range by what happened in it, and banks none of it', () => {
        const won = rig(true).meta.finish(true);
        const range = rig(false).meta.finish(true);
        expect(range.total).toBe(won.total);
    });

    /**
     * Pins current behaviour; suspected bug: a range match banks XP onto the account.
     *
     * `MatchMeta.finish` says of the range that *"it simply never writes any of it"*, and the
     * path it takes writes all of it: `progression.finish(false, false)` reaches
     * `profile.bankMatch` and `profile.flush()` like any other match, and only the *won* flag
     * is forced down. `Game` then uses `banksProgress` to decide whether to **show** the XP
     * strip -- `banks ? report : null` -- so a Shooting Range session silently moves the
     * account by a loss's worth of XP and the screen says nothing.
     *
     * These are the numbers today. See the backlog entry this opened.
     */
    it('leaves the account where it was for a range, and still reports the total', () => {
        const r = rig(false);
        expect(r.profile.xp).toBe(0);
        const report = r.meta.finish(true);
        expect(report.total).toBeGreaterThan(0);
        expect(r.profile.xp).toBe(0);
    });

    /** Deltas, not totals: two profiles in one test share the save the double gives them. */
    it('banks nothing where a lost match banks its 500', () => {
        const range = rig(false);
        const rangeBefore = range.profile.xp;
        range.meta.finish(true);
        expect(range.profile.xp - rangeBefore).toBe(0);

        // The control, which is what makes the zero above mean something: the same rig that
        // banks does bank, and a loss is what a range used to be paid.
        const lost = rig(true);
        const lostBefore = lost.profile.xp;
        lost.meta.finish(false);
        expect(lost.profile.xp - lostBefore).toBeGreaterThan(0);
    });

    it('starts from the level the profile is on', () => {
        const r = rig();
        const report = r.meta.finish(true);
        expect(report.levelBefore).toBe(r.profile.level);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('disposal', () => {
    it('takes the perks\u2019 group out of the scene', () => {
        const r = rig();
        r.meta.dispose();
        expect(r.scene.children).toHaveLength(0);
    });

    it('is safe twice', () => {
        const r = rig();
        r.meta.dispose();
        r.meta.dispose();
        expect(r.scene.children).toHaveLength(0);
    });
});
