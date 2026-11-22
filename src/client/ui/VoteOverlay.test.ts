
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DT } from '../../shared/core/Loop';
import type { VoteInfo } from '../../shared/net/Messages';
import { MAP_BALLOT, MODE_BALLOT, VotePhase } from '../../shared/net/Skirmish';
import { VoteOverlay } from './VoteOverlay';
import { FakeElement, installFakeDom, type FakeDom } from './testing/dom';

/**
 * Characterization tests for the vote overlay (refactor unit C19, written before the
 * refactor).
 *
 * Three things in this file are regressions with a playtest behind them, and each is pinned
 * here by the behaviour rather than by the shape of the code:
 *
 *  - **The row set survives the broadcast.** Rows are built once and updated in place; only
 *    a change of the row *set* rebuilds. Asserted by holding a node across repeated `apply`
 *    calls and checking it is the same object.
 *  - **A notice keeps the surface up.** `ALLOCATING` used to hide the overlay on the very next
 *    4 Hz broadcast, so a message about a failed allocation lived 250 ms.
 *  - **A hidden overlay eats no key.** A client migrated into a live match keeps the last
 *    phase it heard, and 1-5 used to go to an invisible ballot instead of to the class
 *    selector.
 *
 * The ballots, the phases and the tick length are the shared module's own. Only the document
 * is a double; the clock the countdown reads is `deps.currentTick`, which the rig moves.
 */

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 290 lines of hand-grown double. It is the same double -- the file it
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
    readonly overlay: VoteOverlay;
    readonly host: FakeElement;
    readonly root: FakeElement;
    readonly votes: [number, number][];
    readonly opens: number[];
    tick: number;
}

function rig(): Rig {
    const host = new FakeElement('div');
    const votes: [number, number][] = [];
    const opens: number[] = [];
    const state = { tick: 0 };
    const audio = {
        playBallotOpen: (phase: number): void => {
            opens.push(phase);
        },
    };
    const overlay = new VoteOverlay({
        host: host as unknown as HTMLElement,
        onVote: (phase, option) => votes.push([phase, option]),
        currentTick: () => state.tick,
        audio: audio as never,
    });
    return {
        overlay,
        host,
        root: host.children[0]!,
        votes,
        opens,
        get tick(): number {
            return state.tick;
        },
        set tick(value: number) {
            state.tick = value;
        },
    };
}

/** A broadcast. Everything not given is the quiet default. */
function info(over: Partial<VoteInfo> = {}): VoteInfo {
    return {
        phase: VotePhase.MODE_VOTE,
        phaseEndsTick: 600,
        tally: [0, 0, 0, 0, 0],
        selfVote: -1,
        decidedMode: -1,
        decidedMap: -1,
        humans: 1,
        ...over,
    };
}

function find(root: FakeElement, token: string): FakeElement {
    const hit = root.querySelector(`.${token}`);
    if (hit === null) throw new Error(`no .${token}`);
    return hit;
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    return root.querySelectorAll(`.${token}`);
}

function rows(r: Rig): FakeElement[] {
    return findAll(r.root, 'op-vote__option');
}

function names(r: Rig): string[] {
    return findAll(r.root, 'op-vote__option-name').map((n) => n.textContent);
}

function counts(r: Rig): string[] {
    return findAll(r.root, 'op-vote__option-count').map((c) => c.textContent);
}

function widths(r: Rig): string[] {
    return findAll(r.root, 'op-vote__option-fill').map((f) => f.style['width']!);
}

function heading(r: Rig): string {
    return find(r.root, 'op-vote__heading').textContent;
}

function clock(r: Rig): string {
    return find(r.root, 'op-vote__clock').textContent;
}

function banner(r: Rig): FakeElement {
    return find(r.root, 'op-vote__banner');
}

function hint(r: Rig): FakeElement {
    return find(r.root, 'op-vote__hint');
}

/** Run `n` frames of the render loop. */
function frames(r: Rig, n: number): void {
    for (let i = 0; i < n; i++) r.overlay.tick();
}

// ---------------------------------------------------------------------------- the surface

describe('the surface it builds', () => {
    it('mounts one hidden overlay on the host', () => {
        const r = rig();
        expect(r.host.children).toHaveLength(1);
        expect(r.root.className).toBe('op-vote');
        expect(r.root.hidden).toBe(true);
    });

    it('is a banner, a head, the options and the hint', () => {
        const r = rig();
        expect(r.root.children.map((c) => c.className)).toEqual([
            'op-vote__banner',
            'op-vote__head',
            'op-vote__options',
            'op-vote__hint',
        ]);
    });

    it('puts the heading and the clock in the head', () => {
        const r = rig();
        expect(r.root.children[1]!.children.map((c) => c.className)).toEqual([
            'op-vote__heading',
            'op-vote__clock',
        ]);
    });

    it('starts with the banner hidden and nothing to vote on', () => {
        const r = rig();
        expect(banner(r).hidden).toBe(true);
        expect(rows(r)).toHaveLength(0);
    });

    it('says how to vote, and that there is no need to stop', () => {
        const r = rig();
        expect(hint(r).textContent).toBe('PRESS 1-5 TO VOTE \u2014 KEEP PLAYING');
    });
});

// ---------------------------------------------------------------------------- the mode ballot

describe('the mode ballot', () => {
    it('shows itself with a row per mode on the ballot', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(r.root.hidden).toBe(false);
        expect(heading(r)).toBe('VOTE \u2014 MODE');
        expect(rows(r)).toHaveLength(MODE_BALLOT.length);
    });

    it('numbers each option from one and names it', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(names(r)).toEqual([
            '1  TEAM DEATHMATCH',
            '2  DOMINATION',
            '3  KILL CONFIRMED',
            '4  FREE-FOR-ALL',
            '5  SEARCH & DESTROY',
        ]);
    });

    it('shows the server\'s tally and nothing of its own', () => {
        const r = rig();
        r.overlay.apply(info({ tally: [3, 1, 0, 0, 0] }));
        expect(counts(r)).toEqual(['3', '1', '0', '0', '0']);
    });

    it('fills each bar by its share of the votes cast', () => {
        const r = rig();
        r.overlay.apply(info({ tally: [3, 1, 0, 0, 0] }));
        expect(widths(r)).toEqual(['75%', '25%', '0%', '0%', '0%']);
    });

    it('fills nothing when nobody has voted', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(widths(r)).toEqual(['0%', '0%', '0%', '0%', '0%']);
    });

    it('rounds the share rather than truncating it', () => {
        const r = rig();
        r.overlay.apply(info({ tally: [1, 1, 1, 0, 0] }));
        expect(widths(r)).toEqual(['33%', '33%', '33%', '0%', '0%']);
    });

    it('marks the option this player chose', () => {
        const r = rig();
        r.overlay.apply(info({ selfVote: 2 }));
        const on = rows(r).map((b) => b.classList.contains('op-vote__option--on'));
        expect(on).toEqual([false, false, true, false, false]);
        expect(rows(r).map((b) => b.getAttribute('aria-pressed'))).toEqual([
            'false',
            'false',
            'true',
            'false',
            'false',
        ]);
    });

    it('shows the hint while a ballot is open', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(hint(r).hidden).toBe(false);
    });

    it('hides the banner: there is no mode to announce yet', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(banner(r).hidden).toBe(true);
    });

    it('renders every option as a disabled button, because a click is a shot', () => {
        const r = rig();
        r.overlay.apply(info());
        for (const button of rows(r)) {
            expect(button.tag).toBe('button');
            expect(button.type).toBe('button');
            expect(button.disabled).toBe(true);
            expect(button.getAttribute('aria-disabled')).toBe('true');
            expect(button.listeners.get('click')).toBeUndefined();
        }
    });
});

// ---------------------------------------------------------------------------- the map ballot

describe('the map ballot', () => {
    const MAP = { phase: VotePhase.MAP_VOTE, tally: [0, 0, 0] };

    it('shows a row per map on the ballot', () => {
        const r = rig();
        r.overlay.apply(info(MAP));
        expect(heading(r)).toBe('VOTE \u2014 MAP');
        expect(rows(r)).toHaveLength(MAP_BALLOT.length);
        expect(names(r)).toEqual(['1  FOUNDRY', '2  DUNES', '3  DEPOT']);
    });

    it('keeps the decided mode on screen through it', () => {
        const r = rig();
        r.overlay.apply(info({ ...MAP, decidedMode: 1 }));
        expect(banner(r).hidden).toBe(false);
        expect(banner(r).textContent).toBe('DOMINATION \u2014 NOW PICK THE MAP');
    });

    it('announces nothing when the server has decided no mode', () => {
        const r = rig();
        r.overlay.apply(info({ ...MAP, decidedMode: -1 }));
        expect(banner(r).hidden).toBe(true);
    });

    it('announces nothing for a mode index off the end of the ballot', () => {
        const r = rig();
        r.overlay.apply(info({ ...MAP, decidedMode: 99 }));
        expect(banner(r).hidden).toBe(true);
    });

    it('rebuilds the row set when the ballot changes from modes to maps', () => {
        const r = rig();
        r.overlay.apply(info());
        const first = rows(r)[0]!;
        r.overlay.apply(info(MAP));
        expect(rows(r)).toHaveLength(3);
        expect(rows(r)[0]).not.toBe(first);
    });
});

// ---------------------------------------------------------------------------- the discipline

describe('the replaceChildren discipline', () => {
    it('keeps the same nodes across repeated broadcasts', () => {
        const r = rig();
        r.overlay.apply(info());
        const held = [...rows(r)];
        for (let i = 0; i < 20; i++) r.overlay.apply(info({ tally: [i, 0, 0, 0, 0] }));
        expect(rows(r)).toEqual(held);
    });

    it('writes the new numbers into the surviving nodes', () => {
        const r = rig();
        r.overlay.apply(info());
        const held = rows(r)[0]!;
        r.overlay.apply(info({ tally: [4, 0, 0, 0, 0], selfVote: 0 }));
        expect(held.classList.contains('op-vote__option--on')).toBe(true);
        expect(find(held, 'op-vote__option-count').textContent).toBe('4');
    });

    it('does not rebuild when only the tally moves', () => {
        const r = rig();
        r.overlay.apply(info());
        const host = find(r.root, 'op-vote__options');
        const held = host.children[0]!;
        r.overlay.apply(info({ tally: [9, 9, 9, 9, 9] }));
        expect(host.children[0]).toBe(held);
    });
});

// ---------------------------------------------------------------------------- the cue

describe('the ballot-opened cue', () => {
    it('plays once on the edge into the mode vote', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(r.opens).toEqual([VotePhase.MODE_VOTE]);
    });

    it('does not play again on the next forty broadcasts of the same phase', () => {
        const r = rig();
        for (let i = 0; i < 40; i++) r.overlay.apply(info());
        expect(r.opens).toEqual([VotePhase.MODE_VOTE]);
    });

    it('plays again on the edge into the map vote', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.apply(info({ phase: VotePhase.MAP_VOTE, tally: [0, 0, 0] }));
        expect(r.opens).toEqual([VotePhase.MODE_VOTE, VotePhase.MAP_VOTE]);
    });

    it('plays for neither PLAY nor ALLOCATING', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.PLAY }));
        r.overlay.apply(info({ phase: VotePhase.ALLOCATING }));
        expect(r.opens).toEqual([]);
    });

    it('re-arms after a migration, because the ballot is genuinely new again', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.hide();
        r.overlay.apply(info());
        expect(r.opens).toEqual([VotePhase.MODE_VOTE, VotePhase.MODE_VOTE]);
    });
});

// ---------------------------------------------------------------------------- PLAY

describe('during PLAY', () => {
    it('stays up with the countdown and nothing else', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.PLAY }));
        expect(r.root.hidden).toBe(false);
        expect(heading(r)).toBe('NEXT VOTE IN');
        expect(rows(r)).toHaveLength(0);
        expect(hint(r).hidden).toBe(true);
        expect(banner(r).hidden).toBe(true);
    });

    it('clears the rows left over from a ballot', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(rows(r)).toHaveLength(5);
        r.overlay.apply(info({ phase: VotePhase.PLAY }));
        expect(rows(r)).toHaveLength(0);
    });

    it('writes the countdown as soon as the broadcast lands', () => {
        const r = rig();
        r.tick = 300;
        r.overlay.apply(info({ phase: VotePhase.PLAY, phaseEndsTick: 600 }));
        expect(clock(r)).toBe((300 * DT).toFixed(1));
    });
});

// ---------------------------------------------------------------------------- ALLOCATING

describe('during ALLOCATING', () => {
    it('hides the whole surface when there is nothing to say', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.ALLOCATING }));
        expect(r.root.hidden).toBe(true);
    });

    it('still names the phase and clears the clock and the options', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.apply(info({ phase: VotePhase.ALLOCATING }));
        expect(heading(r)).toBe('STARTING THE MATCH');
        expect(clock(r)).toBe('');
        expect(rows(r)).toHaveLength(0);
        expect(hint(r).hidden).toBe(true);
    });

    it('keeps the surface up for a notice, and keeps it up over many broadcasts', () => {
        const r = rig();
        r.overlay.notice('COULD NOT ALLOCATE A MATCH', 8);
        for (let i = 0; i < 40; i++) r.overlay.apply(info({ phase: VotePhase.ALLOCATING }));
        expect(r.root.hidden).toBe(false);
        expect(banner(r).hidden).toBe(false);
        expect(banner(r).textContent).toBe('COULD NOT ALLOCATE A MATCH');
    });

    it('hides itself again once the notice has run out', () => {
        const r = rig();
        r.overlay.notice('GONE IN A SECOND', 1);
        r.overlay.apply(info({ phase: VotePhase.ALLOCATING }));
        frames(r, 59);
        expect(r.root.hidden).toBe(false);
        frames(r, 1);
        expect(r.root.hidden).toBe(true);
        expect(banner(r).hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the notice

describe('a notice from the server', () => {
    it('shows the text and brings the surface up', () => {
        const r = rig();
        r.overlay.notice('THE ARENA WAS REBUILT');
        expect(r.root.hidden).toBe(false);
        expect(banner(r).hidden).toBe(false);
        expect(banner(r).textContent).toBe('THE ARENA WAS REBUILT');
    });

    it('lasts eight seconds by default, counted in frames', () => {
        const r = rig();
        r.overlay.notice('EIGHT');
        frames(r, 479);
        expect(banner(r).hidden).toBe(false);
        frames(r, 1);
        expect(banner(r).hidden).toBe(true);
    });

    it('outranks the mode announcement for as long as it is up', () => {
        const r = rig();
        r.overlay.notice('LOUDER', 1);
        r.overlay.apply(info({ phase: VotePhase.MAP_VOTE, tally: [0, 0, 0], decidedMode: 0 }));
        expect(banner(r).textContent).toBe('LOUDER');
        frames(r, 60);
        r.overlay.apply(info({ phase: VotePhase.MAP_VOTE, tally: [0, 0, 0], decidedMode: 0 }));
        expect(banner(r).textContent).toBe('TEAM DEATHMATCH \u2014 NOW PICK THE MAP');
    });

    it('leaves a ballot standing when it expires', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.notice('BRIEF', 1);
        frames(r, 60);
        expect(r.root.hidden).toBe(false);
    });

    it('leaves PLAY standing when it expires', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.PLAY }));
        r.overlay.notice('BRIEF', 1);
        frames(r, 60);
        expect(r.root.hidden).toBe(false);
    });

    it('counts down only while there is something to count', () => {
        const r = rig();
        r.overlay.notice('ONE', 1);
        frames(r, 200);
        expect(banner(r).hidden).toBe(true);
        r.overlay.notice('TWO', 1);
        expect(banner(r).textContent).toBe('TWO');
        frames(r, 59);
        expect(banner(r).hidden).toBe(false);
    });

    it('is dropped by hide', () => {
        const r = rig();
        r.overlay.notice('GONE');
        r.overlay.hide();
        expect(r.root.hidden).toBe(true);
        expect(banner(r).hidden).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the countdown

describe('the countdown', () => {
    it('is the server\'s own clock, to a tenth of a second', () => {
        const r = rig();
        r.overlay.apply(info({ phaseEndsTick: 600 }));
        r.tick = 240;
        r.overlay.tick();
        expect(clock(r)).toBe((360 * DT).toFixed(1));
    });

    it('never reads below zero', () => {
        const r = rig();
        r.overlay.apply(info({ phaseEndsTick: 600 }));
        r.tick = 900;
        r.overlay.tick();
        expect(clock(r)).toBe('0.0');
    });

    it('is not written while the surface is down', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.ALLOCATING }));
        const before = clock(r);
        r.tick = 100;
        r.overlay.tick();
        expect(clock(r)).toBe(before);
    });

    it('is not written after a migration', () => {
        const r = rig();
        r.overlay.apply(info({ phaseEndsTick: 600 }));
        r.overlay.hide();
        r.tick = 300;
        r.overlay.tick();
        expect(clock(r)).toBe((600 * DT).toFixed(1));
    });

    it('touches nothing else, however many frames run', () => {
        const r = rig();
        r.overlay.apply(info({ tally: [2, 0, 0, 0, 0] }));
        const held = [...rows(r)];
        frames(r, 300);
        expect(rows(r)).toEqual(held);
        expect(counts(r)).toEqual(['2', '0', '0', '0', '0']);
    });
});

// ---------------------------------------------------------------------------- the keys

describe('the number keys', () => {
    it('votes for the option a digit names', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(r.overlay.handleDigit(3)).toBe(true);
        expect(r.votes).toEqual([[VotePhase.MODE_VOTE, 2]]);
    });

    it('takes every digit the ballot has', () => {
        const r = rig();
        r.overlay.apply(info());
        for (let d = 1; d <= MODE_BALLOT.length; d++) expect(r.overlay.handleDigit(d)).toBe(true);
        expect(r.votes.map(([, option]) => option)).toEqual([0, 1, 2, 3, 4]);
    });

    it('refuses a digit past the end of the ballot', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.MAP_VOTE, tally: [0, 0, 0] }));
        expect(r.overlay.handleDigit(3)).toBe(true);
        expect(r.overlay.handleDigit(4)).toBe(false);
        expect(r.votes).toHaveLength(1);
    });

    it('refuses zero and anything below it', () => {
        const r = rig();
        r.overlay.apply(info());
        expect(r.overlay.handleDigit(0)).toBe(false);
        expect(r.overlay.handleDigit(-1)).toBe(false);
        expect(r.votes).toEqual([]);
    });

    it('eats no key before a broadcast has arrived', () => {
        const r = rig();
        expect(r.overlay.handleDigit(1)).toBe(false);
    });

    it('eats no key during PLAY: 1-5 are the class selector then', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.PLAY }));
        expect(r.root.hidden).toBe(false);
        expect(r.overlay.handleDigit(1)).toBe(false);
        expect(r.votes).toEqual([]);
    });

    it('eats no key during ALLOCATING', () => {
        const r = rig();
        r.overlay.apply(info({ phase: VotePhase.ALLOCATING }));
        expect(r.overlay.handleDigit(1)).toBe(false);
    });

    /**
     * The reported *"sometimes I can't switch class"*: a player migrated into a live match
     * carried a live `MAP_VOTE` and keys 1-3 went to a ballot nobody could see.
     */
    it('eats no key while it is hidden, even holding a live ballot', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.notice('UP', 1);
        r.root.hidden = true;
        expect(r.overlay.handleDigit(1)).toBe(false);
        expect(r.votes).toEqual([]);
    });

    it('eats no key after a migration', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.hide();
        expect(r.overlay.handleDigit(1)).toBe(false);
    });

    it('votes in the phase the server last named, not the one before', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.apply(info({ phase: VotePhase.MAP_VOTE, tally: [0, 0, 0] }));
        r.overlay.handleDigit(1);
        expect(r.votes).toEqual([[VotePhase.MAP_VOTE, 0]]);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('hide and dispose', () => {
    it('hide takes the surface down and forgets the ballot', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.hide();
        expect(r.root.hidden).toBe(true);
        expect(r.overlay.handleDigit(1)).toBe(false);
    });

    it('hide leaves the rows in place, because a later broadcast may want them', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.hide();
        expect(rows(r)).toHaveLength(5);
    });

    it('hide is safe before anything has been applied', () => {
        const r = rig();
        r.overlay.hide();
        expect(r.root.hidden).toBe(true);
    });

    it('dispose takes the overlay off the host', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.dispose();
        expect(r.host.children).toHaveLength(0);
    });

    it('dispose drops the rows, so a rebuild cannot write into a detached node', () => {
        const r = rig();
        r.overlay.apply(info());
        r.overlay.dispose();
        r.overlay.apply(info({ tally: [7, 0, 0, 0, 0] }));
        // The key is unchanged, so nothing is rebuilt and the cleared map has no row to write.
        expect(counts(r)).toEqual(['0', '0', '0', '0', '0']);
    });

    it('is safe twice', () => {
        const r = rig();
        r.overlay.dispose();
        r.overlay.dispose();
        expect(r.host.children).toHaveLength(0);
    });
});
