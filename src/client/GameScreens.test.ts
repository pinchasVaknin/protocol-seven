import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../shared/meta/SaveData';
import { Profile } from './meta/Profile';
import { GameScreens, type GameScreensDeps } from './GameScreens';
import { FakeElement, installFakeDom, type FakeDom } from './ui/testing/dom';

/**
 * Characterization tests for the front end's composition root (refactor unit C21, written
 * before the refactor).
 *
 * **The screens raise intents, `Game` decides what state to go to.** Nothing here calls
 * `transitionTo` -- every button is a callback the state machine supplies -- which is what
 * keeps the legal-transition table the only description of how the application moves. So the
 * assertions are about which intent each control raises, and about the one piece of logic
 * that stayed: the Continue button acts on the **first** press, because a button labelled
 * "Return to lobby" that does something else is a button that lies.
 */


// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 337 lines of hand-grown double. It is the same double -- the file it
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

interface Rig {
    readonly screens: GameScreens;
    readonly host: FakeElement;
    readonly intents: string[];
}

function rig(over: Partial<GameScreensDeps> = {}): Rig {
    const host = new FakeElement('div');
    const intents: string[] = [];
    const note = (name: string) => (...args: unknown[]): void => {
        intents.push(args.length === 0 ? name : `${name}(${args.join(', ')})`);
    };
    const profile = new Profile({ fallbackSettings: defaultSettings('TDM', 'mp_foundry', 90) });
    const screens = new GameScreens({
        host: host as unknown as HTMLElement,
        profile,
        audio: new Proxy({}, { get: () => () => undefined }) as never,
        selection: { modeId: 'TDM', mapId: 'mp_foundry', difficulty: 'MIX' } as never,
        onLaunch: note('launch'),
        onPlayMultiplayer: note('multiplayer'),
        serverConfigured: () => false,
        onDisplayName: note('displayName'),
        onLoadout: note('loadout'),
        onSettings: note('settings'),
        onLoadoutSaveAndExit: note('saveAndExit'),
        onQuitToMenu: note('quit'),
        onResume: note('resume'),
        onToggleOverlay: note('overlay'),
        onCheatCode: note('cheat'),
        onLeaveSummary: note('leaveSummary'),
        onExitSummary: note('exitSummary'),
        pauseStatusLine: () => 'OFFLINE',
        anisotropy: () => 4,
        characterAssets: {
            avatarProvider: () => ({ isReady: false, create: (): null => null, dispose: (): void => undefined }),
        } as never,
        weaponAssets: null,
        ...over,
    });
    return { screens, host, intents };
}

// ---------------------------------------------------------------------------- the five

describe('the five screens', () => {
    it('builds all of them at once', () => {
        const r = rig();
        expect(r.screens.menus).toBeDefined();
        expect(r.screens.loadoutEditor).toBeDefined();
        expect(r.screens.xpSummary).toBeDefined();
        expect(r.screens.pauseMenu).toBeDefined();
        expect(r.screens.summary).toBeDefined();
    });

    /** One lifetime: built at boot and kept for the life of the page. */
    it('keeps them: a second read is the same object', () => {
        const r = rig();
        expect(r.screens.menus).toBe(r.screens.menus);
        expect(r.screens.summary).toBe(r.screens.summary);
    });

    it('mounts the summary on the host', () => {
        const r = rig();
        expect(r.host.children.some((c) => c === (r.screens.summary.element as unknown as FakeElement))).toBe(true);
    });

    /** The M4 insertion point, filled (S6.1). */
    it('puts the XP strip inside the summary\u2019s own slot', () => {
        const r = rig();
        const slot = r.screens.summary.xpSlot as unknown as FakeElement;
        const strip = r.screens.xpSummary.element as unknown as FakeElement;
        expect(strip.parent).toBe(slot);
    });

    it('raises no intent merely by being built', () => {
        expect(rig().intents).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- the summary

describe('putting the board up', () => {
    function show(r: Rig, report: unknown): void {
        r.screens.showSummary(
            {
                viewer: 7,
                localTeam: 'A',
                localId: 7,
                score: { teamA: 10, teamB: 5, rows: [] },
                mode: { getScoreboardColumns: () => [], name: 'TEAM DEATHMATCH' },
            } as never,
            { kind: 'match', winner: 'A', reason: 'Score limit', scoreA: 75, scoreB: 40, roundsA: 0, roundsB: 0 } as never,
            { mapName: 'FOUNDRY' } as never,
            report as never,
            0,
            { bodyFor: () => null } as never,
        );
    }

    /**
     * Null for a mode that does not bank progress -- the Shooting Range. The XP slot is hidden
     * rather than played empty, because an animation that counts to zero reads as a bug.
     */
    it('hides the XP slot for a mode that banks nothing', () => {
        const r = rig();
        show(r, null);
        expect((r.screens.summary.xpSlot as unknown as FakeElement).hidden).toBe(true);
    });

    it('shows it for a mode that does', () => {
        const r = rig();
        show(r, { lines: [], total: 500, xpBefore: 0, levelBefore: 1, levelAfter: 1, weaponLevelUps: [], challengesCompleted: [], camosUnlocked: [] });
        expect((r.screens.summary.xpSlot as unknown as FakeElement).hidden).toBe(false);
    });

    it('takes the board down again', () => {
        const r = rig();
        show(r, null);
        r.screens.hideSummary();
        expect((r.screens.summary.element as unknown as FakeElement).hidden).toBe(true);
    });

    it('is safe to hide twice', () => {
        const r = rig();
        r.screens.hideSummary();
        r.screens.hideSummary();
        expect((r.screens.summary.element as unknown as FakeElement).hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the one rule

describe('the Continue button', () => {
    /**
     * Acts on the first press (playtest round 4, B4). It used to swallow the first click to
     * finish the XP animation and leave only on the second -- the reported *"you have to click
     * twice"*. The XP is banked when SUMMARY is entered, so skipping the animation costs
     * nothing but the animation.
     */
    it('leaves on the first press', () => {
        const r = rig();
        const button = (r.screens.summary.element as unknown as FakeElement).querySelector('.dbf-continue');
        expect(button).not.toBeNull();
        env.fire(button!, 'click');
        expect(r.intents).toEqual(['leaveSummary']);
    });

    it('raises exactly one intent for one press', () => {
        const r = rig();
        const button = (r.screens.summary.element as unknown as FakeElement).querySelector('.dbf-continue');
        env.fire(button!, 'click');
        env.fire(button!, 'click');
        expect(r.intents).toEqual(['leaveSummary', 'leaveSummary']);
    });
});

// ---------------------------------------------------------------------------- the intents

describe('the intents the screens raise', () => {
    it('asks for the loadout editor on the five classes from the menu', () => {
        const r = rig();
        r.screens.menus.show('MAIN');
        const nav = (r.host.querySelectorAll('.op-nav') ?? []) as FakeElement[];
        const button = nav.find((b) => (b.querySelector('.op-nav__label')?.children[0]?.textContent
            ?? b.querySelector('.op-nav__label')?.textContent) === 'CREATE A CLASS');
        env.fire(button!, 'click');
        expect(r.intents).toEqual(['loadout(false)']);
    });

    it('asks for settings from the menu', () => {
        const r = rig();
        r.screens.menus.show('MAIN');
        const nav = (r.host.querySelectorAll('.op-nav') ?? []) as FakeElement[];
        env.fire(nav[3]!, 'click');
        expect(r.intents).toEqual(['settings']);
    });

    it('asks for a match from Play Solo', () => {
        const r = rig();
        r.screens.menus.show('PLAY');
        const launch = r.host.querySelector('.ps-launch');
        env.fire(launch!, 'click');
        expect(r.intents).toEqual(['launch']);
    });
});
