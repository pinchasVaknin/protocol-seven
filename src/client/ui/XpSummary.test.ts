import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { camoDef } from '../../shared/meta/Camos';
import { challengeDef, CHALLENGES } from '../../shared/meta/Challenges';
import { levelProgress, prestigeLabel, xpAtLevelStart } from '../../shared/meta/Levels';
import { requireWeapon } from '../../shared/weapons/WeaponDefs';
import type { XpLine, XpLines, XpReport } from '../../shared/meta/XpRules';
import { XpSummary } from './XpSummary';
import { FakeElement } from './testing/dom';

/**
 * Characterization tests for the XP cadence (refactor unit C18, written before the refactor).
 *
 * **The timing is the design**, which means the timing is the thing to pin — so the clock is
 * this file's. `requestAnimationFrame` is a queue and `performance.now` is a number the tests
 * advance, which makes "the third row lands at 1.02 s" an assertion rather than a wait, and
 * makes the level-up interruption — the moment the whole screen exists for — reachable without
 * a real second passing.
 *
 * The level table, the challenge table and the weapon registry are the product's own, so a
 * report built here pays what the game would pay for it.
 */

// ---------------------------------------------------------------------------- the DOM double

/**

 * The element class is shared: `testing/dom.ts` (BACKLOG #79).

 *

 * What stood here was 81 lines of it. This file keeps its own environment: the shared

 * `installFakeDom` installs globals this suite has never run with, and handing a suite a

 * `window` on the way past is how a green suite starts meaning something else.

 *

 * Its own `setAttribute` did not reflect `class`; the shared one does. The measured box is the

 * one thing it needs its own answer for, so `XpElement` below overrides it and nothing else.

 */


function fire(el: FakeElement, type: string): void {
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn();
}

/**
 * The measured box, which this suite's own double answered differently from every other.
 *
 * `offsetWidth` is read to force the reflow the XP bar's transitions depend on, so the number
 * is part of what the suite asserts rather than a don't-care: the shared default of 200x40 is
 * a different bar. Nothing else here differs.
 */
class XpElement extends FakeElement {
    override offsetWidth = 100;
    override offsetHeight = 20;
}

// ---------------------------------------------------------------------------- the clock

let rafQueue: ((t: number) => void)[] = [];
let nowMs = 0;

/** Advance the clock in whole frames, running whatever the cadence queued for each one. */
function advance(seconds: number, frameMs = 16): void {
    let left = Math.round(seconds * 1000);
    while (left > 0) {
        const take = Math.min(frameMs, left);
        nowMs += take;
        left -= take;
        const queued = rafQueue;
        rafQueue = [];
        for (const fn of queued) fn(nowMs);
        if (queued.length === 0) break;
    }
}

beforeEach(() => {
    rafQueue = [];
    nowMs = 1000;
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new XpElement(tag),
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['requestAnimationFrame'] = (fn: (t: number) => void): number => {
        rafQueue.push(fn);
        return rafQueue.length;
    };
    (globalThis as Record<string, unknown>)['cancelAnimationFrame'] = (): void => {
        rafQueue = [];
    };
    (globalThis as Record<string, unknown>)['performance'] = { now: () => nowMs };
});

afterEach(() => {
    for (const key of ['document', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance']) {
        delete (globalThis as Record<string, unknown>)[key];
    }
});

// ---------------------------------------------------------------------------- the rig

const ROW_INTERVAL = 0.34;
const LEVELUP_HOLD = 0.85;
const TAIL_DELAY = 0.4;

interface Rig {
    readonly xp: XpSummary;
    readonly root: FakeElement;
    readonly ticks: number[];
    readonly levelUps: number[];
    readonly levels: number[];
}

function rig(autoOpen?: boolean): Rig {
    const ticks: number[] = [];
    const levelUps: number[] = [];
    const levels: number[] = [];
    const xp = new XpSummary({
        audio: {
            playXpTick: (i) => ticks.push(i),
            playLevelUp: () => levelUps.push(1),
        },
        onLevel: (l) => levels.push(l),
        ...(autoOpen === undefined ? {} : { autoOpen }),
    });
    return { xp, root: xp.element as unknown as FakeElement, ticks, levelUps, levels };
}

function line(id: string, label: string, xp: number, count = 1, kind: 'each' | 'flat' = 'flat'): XpLine {
    return { id: id as XpLine['id'], label, count, xp, kind };
}

/** A report that pays `total` and does not cross a level boundary. */
function flatReport(total = 300, lines = 3): XpReport {
    const each = Math.floor(total / lines);
    const built: XpLine[] = [];
    for (let i = 0; i < lines; i++) built.push(line('kill', `LINE ${i + 1}`, i === lines - 1 ? total - each * (lines - 1) : each));
    const head = built[0];
    if (head === undefined) throw new Error('no lines');
    return {
        lines: [head, ...built.slice(1)] as unknown as XpLines,
        total,
        xpBefore: xpAtLevelStart(5),
        levelBefore: 5,
        levelAfter: 5,
        weaponLevelUps: [],
        challengesCompleted: [],
        camosUnlocked: [],
    };
}

/** A report whose total carries the bar over exactly one level boundary. */
function levellingReport(): XpReport {
    const before = xpAtLevelStart(5);
    const span = levelProgress(before).span;
    const total = span + 10;
    return {
        ...flatReport(total, 2),
        xpBefore: before,
        levelBefore: 5,
        levelAfter: 6,
    };
}

function strip(r: Rig): FakeElement {
    const found = r.root.children[1];
    if (found === undefined) throw new Error('no strip');
    return found;
}

function listEl(r: Rig): FakeElement {
    const found = r.root.children[0];
    if (found === undefined) throw new Error('no list');
    return found;
}

function rowsEl(r: Rig): FakeElement {
    const found = listEl(r).children[0];
    if (found === undefined) throw new Error('no rows');
    return found;
}

function tailEl(r: Rig): FakeElement {
    const found = listEl(r).children[1];
    if (found === undefined) throw new Error('no tail');
    return found;
}

function flourish(r: Rig): FakeElement {
    const found = r.root.children[2];
    if (found === undefined) throw new Error('no flourish');
    return found;
}

function levelText(r: Rig): string {
    return strip(r).children[0]?.children[1]?.textContent ?? '';
}

function barFill(r: Rig): FakeElement {
    const found = strip(r).children[1]?.children[0]?.children[0];
    if (found === undefined) throw new Error('no bar fill');
    return found;
}

function barLabel(r: Rig): string {
    return strip(r).children[1]?.children[1]?.textContent ?? '';
}

function totalText(r: Rig): string {
    return strip(r).children[3]?.textContent ?? '';
}

function unlocksText(r: Rig): { text: string; hidden: boolean } {
    const el = strip(r).children[2];
    if (el === undefined) throw new Error('no unlock count');
    return { text: el.textContent, hidden: el.hidden };
}

// ---------------------------------------------------------------------------- the tests

describe('the panel it builds', () => {
    it('is the list over the strip, with the flourish last', () => {
        const r = rig();
        expect(r.root.className).toBe('xp');
        expect(r.root.children.map((c) => c.className)).toEqual(['xp__list', 'xp__strip', 'xp__flourish']);
    });

    it('folds the list and hides the flourish until something happens', () => {
        const r = rig();
        expect(listEl(r).hidden).toBe(true);
        expect(flourish(r).hidden).toBe(true);
        expect(r.xp.isOpen).toBe(false);
        expect(r.xp.isPlaying).toBe(false);
    });

    it('makes the whole strip the accordion’s handle', () => {
        const r = rig();
        expect(strip(r).tag).toBe('button');
        expect(strip(r).type).toBe('button');
        expect(strip(r).getAttribute('aria-expanded')).toBe('false');
    });

    it('lays the strip out as the level, the bar, the unlock count, the total and a chevron', () => {
        const r = rig();
        expect(strip(r).children.map((c) => c.className)).toEqual([
            'xp__level-block',
            'xp__bar-block',
            'xp__unlocks op-label',
            'xp__total op-num',
            'xp__chevron',
        ]);
        expect(strip(r).children[4]?.getAttribute('aria-hidden')).toBe('true');
    });
});

describe('the accordion', () => {
    it('opens and folds, saying which it is', () => {
        const r = rig();
        r.xp.open();
        expect(r.xp.isOpen).toBe(true);
        expect(listEl(r).hidden).toBe(false);
        expect(strip(r).getAttribute('aria-expanded')).toBe('true');
        expect(r.root.classList.contains('xp--open')).toBe(true);
        r.xp.close();
        expect(r.xp.isOpen).toBe(false);
        expect(strip(r).getAttribute('aria-expanded')).toBe('false');
        expect(r.root.classList.contains('xp--open')).toBe(false);
    });

    it('keeps the list in the document until its transition has run', () => {
        const r = rig();
        r.xp.open();
        r.xp.close();
        // Still there: a `hidden` applied at once would cut the fold rather than play it.
        expect(listEl(r).hidden).toBe(false);
        for (const fn of [...(listEl(r).listeners.get('transitionend') ?? [])]) {
            (fn as unknown as (e: { target: FakeElement }) => void)({ target: listEl(r) });
        }
        expect(listEl(r).hidden).toBe(true);
    });

    it('ignores a transition that belonged to something else', () => {
        const r = rig();
        r.xp.open();
        r.xp.close();
        const other = new FakeElement('div');
        for (const fn of [...(listEl(r).listeners.get('transitionend') ?? [])]) {
            (fn as unknown as (e: { target: FakeElement }) => void)({ target: other });
        }
        expect(listEl(r).hidden).toBe(false);
    });

    it('does nothing on a second open or a second close', () => {
        const r = rig();
        r.xp.open();
        r.xp.open();
        expect(r.xp.isOpen).toBe(true);
        r.xp.close();
        r.xp.close();
        expect(r.xp.isOpen).toBe(false);
    });

    it('toggles, and the strip is what toggles it', () => {
        const r = rig();
        fire(strip(r), 'click');
        expect(r.xp.isOpen).toBe(true);
        fire(strip(r), 'click');
        expect(r.xp.isOpen).toBe(false);
    });

    it('skips the transition when asked, and takes the marker off again', () => {
        const r = rig();
        r.xp.open(true);
        expect(r.root.classList.contains('xp--instant')).toBe(false);
        expect(r.root.classList.contains('xp--open')).toBe(true);
    });
});

describe('priming the strip', () => {
    it('shows the level and the bar the match found, and no XP yet', () => {
        const r = rig();
        const report = flatReport();
        r.xp.prime(report);
        expect(levelText(r)).toBe('5');
        expect(totalText(r)).toBe('+0 XP');
        const progress = levelProgress(report.xpBefore);
        expect(barFill(r).style['transform']).toBe(`scaleX(${progress.fraction.toFixed(4)})`);
        expect(barLabel(r)).toBe(
            `${Math.floor(progress.into).toLocaleString()} / ${progress.span.toLocaleString()} XP`,
        );
    });

    it('starts nothing', () => {
        const r = rig();
        r.xp.prime(flatReport());
        expect(r.xp.isPlaying).toBe(false);
        advance(5);
        expect(rowsEl(r).children).toEqual([]);
    });

    it('folds the list and empties the rows, every time', () => {
        const r = rig();
        r.xp.play(flatReport());
        advance(10);
        expect(rowsEl(r).children.length).toBeGreaterThan(0);
        r.xp.prime(flatReport());
        expect(rowsEl(r).children).toEqual([]);
        expect(tailEl(r).children).toEqual([]);
        expect(r.xp.isOpen).toBe(false);
        expect(listEl(r).hidden).toBe(true);
    });

    it('reports the level it primed to', () => {
        const r = rig();
        r.xp.prime(flatReport());
        expect(r.levels).toEqual([5]);
    });

    it('leads with the prestige badge once there is one', () => {
        const r = rig();
        r.xp.prestige = 2;
        r.xp.prime(flatReport());
        expect(levelText(r)).toBe(`${prestigeLabel(2)} · 5`);
    });

    it('says MAX LEVEL on the bar at the cap', () => {
        const r = rig();
        r.xp.prime({ ...flatReport(), xpBefore: 10_000_000, levelBefore: 55, levelAfter: 55 });
        expect(barLabel(r)).toBe('MAX LEVEL — PRESTIGE AVAILABLE');
        expect(barFill(r).style['transform']).toBe('scaleX(1.0000)');
    });
});

describe('the cadence', () => {
    it('lands one row per interval, in order, each with its own tick', () => {
        const r = rig();
        r.xp.play(flatReport(300, 3));
        expect(rowsEl(r).children).toHaveLength(0);
        advance(ROW_INTERVAL);
        expect(rowsEl(r).children).toHaveLength(1);
        advance(ROW_INTERVAL);
        expect(rowsEl(r).children).toHaveLength(2);
        advance(ROW_INTERVAL);
        expect(rowsEl(r).children).toHaveLength(3);
        expect(r.ticks).toEqual([0, 1, 2]);
    });

    it('writes each row as a label, a count and its XP', () => {
        const r = rig();
        const report: XpReport = {
            ...flatReport(),
            lines: [line('kill', 'KILLS', 300, 3, 'each'), line('win', 'VICTORY', 200)] as unknown as XpLines,
            total: 500,
        };
        r.xp.play(report);
        advance(ROW_INTERVAL * 2);
        const [first, second] = rowsEl(r).children;
        expect(first?.children.map((c) => c.textContent)).toEqual(['KILLS', 'x3', '+300']);
        expect(second?.children.map((c) => c.textContent)).toEqual(['VICTORY', '', '+200']);
        expect(first?.classList.contains('is-in')).toBe(true);
    });

    it('leaves the count blank for a single of an each-kind line', () => {
        const r = rig();
        r.xp.play({ ...flatReport(), lines: [line('kill', 'KILL', 100, 1, 'each')] as unknown as XpLines, total: 100 });
        advance(ROW_INTERVAL);
        expect(rowsEl(r).children[0]?.children[1]?.textContent).toBe('');
    });

    it('fills the bar behind the rows and ends on the total', () => {
        const r = rig();
        const report = flatReport(300, 2);
        r.xp.play(report);
        advance(30);
        expect(totalText(r)).toBe('+300 XP');
        const after = levelProgress(report.xpBefore + report.total);
        expect(barFill(r).style['transform']).toBe(`scaleX(${after.fraction.toFixed(4)})`);
    });

    it('reaches DONE and stops asking for frames', () => {
        const r = rig();
        r.xp.play(flatReport());
        expect(r.xp.isPlaying).toBe(true);
        advance(30);
        expect(r.xp.isPlaying).toBe(false);
        const queued = rafQueue.length;
        advance(5);
        expect(rafQueue.length).toBeLessThanOrEqual(queued);
    });

    it('opens the list on its own when the cadence ends', () => {
        const r = rig();
        r.xp.play(flatReport());
        advance(30);
        expect(r.xp.isOpen).toBe(true);
    });

    it('waits the tail delay before painting the tail', () => {
        const r = rig();
        const report: XpReport = { ...flatReport(120, 1), weaponLevelUps: ['ar_carbine'] };
        r.xp.play(report);
        // Through the one row and the bar, but not through the tail's delay.
        advance(ROW_INTERVAL + 0.05);
        expect(tailEl(r).children).toHaveLength(0);
        advance(5 + TAIL_DELAY);
        expect(tailEl(r).children).toHaveLength(1);
    });

    it('abandons a run when it is played again', () => {
        const r = rig();
        r.xp.play(flatReport(300, 6));
        advance(ROW_INTERVAL * 2);
        expect(rowsEl(r).children).toHaveLength(2);
        r.xp.play(flatReport(300, 3));
        expect(rowsEl(r).children).toHaveLength(0);
        advance(30);
        expect(rowsEl(r).children).toHaveLength(3);
    });

    it('stops where it is when told to', () => {
        const r = rig();
        r.xp.play(flatReport(300, 6));
        advance(ROW_INTERVAL * 2);
        r.xp.stop();
        const landed = rowsEl(r).children.length;
        advance(10);
        expect(rowsEl(r).children).toHaveLength(landed);
    });
});

describe('the level-up', () => {
    it('interrupts the bar, flips the level and plays its sting', () => {
        const r = rig();
        r.xp.play(levellingReport());
        advance(30);
        expect(r.levelUps).toHaveLength(1);
        expect(r.levels[r.levels.length - 1]).toBe(6);
        expect(levelText(r)).toBe('6');
    });

    it('shows the flourish with the level it reached', () => {
        const r = rig();
        r.xp.play(levellingReport());
        // Far enough in that the bar has crossed, not so far that the hold is over.
        advance(ROW_INTERVAL * 2 + 1.2, 8);
        expect(flourish(r).hidden).toBe(false);
        expect(flourish(r).children[0]?.textContent).toBe('LEVEL 6');
        expect(flourish(r).classList.contains('is-on')).toBe(true);
    });

    it('holds for its own time and then resumes the bar', () => {
        const r = rig();
        r.xp.play(levellingReport());
        advance(ROW_INTERVAL * 2 + 1.2, 8);
        const held = flourish(r).classList.contains('is-on');
        expect(held).toBe(true);
        advance(LEVELUP_HOLD + 0.1, 8);
        expect(flourish(r).classList.contains('is-on')).toBe(false);
        advance(10);
        expect(r.xp.isPlaying).toBe(false);
    });

    it('does not fire at all for a report that stays inside one level', () => {
        const r = rig();
        r.xp.play(flatReport(60, 2));
        advance(30);
        expect(r.levelUps).toEqual([]);
        expect(flourish(r).hidden).toBe(true);
    });
});

describe('finishing early', () => {
    it('lands every row at once, with no audio', () => {
        const r = rig();
        r.xp.play(flatReport(300, 5));
        advance(ROW_INTERVAL);
        const ticked = r.ticks.length;
        r.xp.finish();
        expect(rowsEl(r).children).toHaveLength(5);
        expect(r.ticks).toHaveLength(ticked);
    });

    it('writes the total, the level and the bar the report ends on', () => {
        const r = rig();
        const report = levellingReport();
        r.xp.play(report);
        r.xp.finish();
        expect(totalText(r)).toBe(`+${report.total.toLocaleString()} XP`);
        expect(levelText(r)).toBe('6');
        const after = levelProgress(report.xpBefore + report.total);
        expect(barFill(r).style['transform']).toBe(`scaleX(${after.fraction.toFixed(4)})`);
    });

    it('paints the tail and stops', () => {
        const r = rig();
        r.xp.play({ ...flatReport(), weaponLevelUps: ['ar_carbine'] });
        r.xp.finish();
        expect(tailEl(r).children).toHaveLength(1);
        expect(r.xp.isPlaying).toBe(false);
    });

    it('does nothing at all before a report has been handed over', () => {
        const r = rig();
        expect(() => r.xp.finish()).not.toThrow();
        expect(rowsEl(r).children).toEqual([]);
    });
});

describe('the tail', () => {
    it('names a completed challenge, a camo on its weapon and a weapon that levelled', () => {
        const r = rig();
        const challenge = CHALLENGES[0];
        if (challenge === undefined) throw new Error('no challenges');
        r.xp.play({
            ...flatReport(),
            challengesCompleted: [challenge.id],
            camosUnlocked: [{ weaponId: 'ar_carbine', camo: 'digital' }],
            weaponLevelUps: ['smg_wasp'],
        });
        r.xp.finish();
        const tags = tailEl(r).children.map((t) => t.children.map((c) => c.textContent));
        expect(tags).toEqual([
            ['CHALLENGE', `${challengeDef(challenge.id)?.name} — ${challengeDef(challenge.id)?.description}`],
            ['CAMO', `${camoDef('digital').name} — ${requireWeapon('ar_carbine').name}`],
            ['WEAPON', `${requireWeapon('smg_wasp').name} levelled up`],
        ]);
    });

    it('drops a camo whose id is not one, and a challenge that is not in the table', () => {
        const r = rig();
        r.xp.play({
            ...flatReport(),
            challengesCompleted: ['nonesuch'],
            camosUnlocked: [{ weaponId: 'ar_carbine', camo: 'nonesuch' as 'digital' }],
        });
        r.xp.finish();
        expect(tailEl(r).children).toEqual([]);
    });

    it('names a camo without its weapon when the weapon is unknown', () => {
        const r = rig();
        r.xp.play({ ...flatReport(), camosUnlocked: [{ weaponId: 'nonesuch', camo: 'gold' }] });
        r.xp.finish();
        expect(tailEl(r).children[0]?.children[1]?.textContent).toBe(camoDef('gold').name);
    });

    it('marks itself in only when it has something in it', () => {
        const r = rig();
        r.xp.play(flatReport());
        r.xp.finish();
        expect(tailEl(r).classList.contains('is-in')).toBe(false);
        const r2 = rig();
        r2.xp.play({ ...flatReport(), weaponLevelUps: ['ar_carbine'] });
        r2.xp.finish();
        expect(tailEl(r2).classList.contains('is-in')).toBe(true);
    });
});

describe('the debrief’s folded ending', () => {
    it('does not open the list, and says how many unlocks it holds', () => {
        const r = rig(false);
        r.xp.play({ ...flatReport(), weaponLevelUps: ['ar_carbine', 'smg_wasp'] });
        advance(30);
        expect(r.xp.isOpen).toBe(false);
        expect(unlocksText(r)).toEqual({ text: '2 UNLOCKS', hidden: false });
    });

    it('counts one in the singular', () => {
        const r = rig(false);
        r.xp.play({ ...flatReport(), weaponLevelUps: ['ar_carbine'] });
        advance(30);
        expect(unlocksText(r)).toEqual({ text: '1 UNLOCK', hidden: false });
    });

    it('says nothing when the tail is empty', () => {
        const r = rig(false);
        r.xp.play(flatReport());
        advance(30);
        expect(unlocksText(r).hidden).toBe(true);
    });

    it('says it on an early finish too', () => {
        const r = rig(false);
        r.xp.play({ ...flatReport(), weaponLevelUps: ['ar_carbine'] });
        r.xp.finish();
        expect(unlocksText(r)).toEqual({ text: '1 UNLOCK', hidden: false });
    });

    it('takes the count away again once the list is opened', () => {
        const r = rig(false);
        r.xp.play({ ...flatReport(), weaponLevelUps: ['ar_carbine'] });
        advance(30);
        r.xp.open();
        expect(unlocksText(r).hidden).toBe(true);
    });
});
