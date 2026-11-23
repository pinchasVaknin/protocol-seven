import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { killDeath, ScoreSystem, type ScoreTeam } from '../../shared/combat/ScoreSystem';
import { EventBus } from '../../shared/core/EventBus';
import type { MatchResult } from '../../shared/modes/GameMode';
import { personalOutcome } from '../../shared/modes/MatchOutcome';
import { defaultSettings } from '../../shared/meta/SaveData';
import { SKIP_FAST_FORWARD, SKIP_TAPS_TO_LEAVE } from '../../shared/ui/SkipGesture';
import { BOT_CHARACTER_IDS } from '../characters/CharacterCatalog';
import { CharacterAssetService } from '../characters/CharacterAssetService';
import { Profile } from '../meta/Profile';
import { EndOfMatch, reasonLine, type LineupSource, type MatchFacts } from './EndOfMatch';
import { FakeElement } from './testing/dom';

/**
 * Characterization tests for the debrief (refactor unit C18, written before the refactor).
 *
 * ## How the choreography is reachable at all
 *
 * `tick` ends on `if (!this.stageBox.hidden) this.stage.tick(step)`, and `CharacterStage.tick`
 * is the one thing under this unit that builds a `WebGLRenderer`. So the tests open the
 * **SCOREBOARD** tab — one public call — and from there the whole seven-phase timeline runs in
 * node: the classes, the three cues, the medal stagger, the fast-forward and the hand-off to
 * the XP cadence. The podium's own `tick` is the single row left browser-verified.
 *
 * The clock is this file's: `performance.now` is a number the tests advance, which is what
 * makes the scrub — `SpaceSkip` reads that clock — assertable rather than timing-dependent.
 *
 * The score rows, the outcome rules, the podium's ordering and the emblem URLs are all the
 * product's own; only the document is a double.
 */

// ---------------------------------------------------------------------------- the DOM double

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
    key?: string;
    code?: string;
    repeat?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
}

/**
 * The element class is shared: `testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 142 lines of it. This file keeps its own environment: the shared
 * `installFakeDom` installs globals this suite has never run with, and handing a suite a
 * `window` on the way past is how a green suite starts meaning something else.
 *
 * Its own `setAttribute` did not reflect `class`; the shared one does. Its `getContext` took no
 * kind and always answered; the shared one answers `null` for anything but `2d`, and no client
 * code asks for another -- the context itself was byte-identical to the shared one.
 */


function fire(el: FakeElement, type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined, ...over };
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
}

// ---------------------------------------------------------------------------- the environment

let windowListeners: Map<string, Listener[]>;
let nowMs = 0;

function fireWindow(type: string, over: Partial<FakeEvent> = {}): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined, ...over };
    for (const fn of [...(windowListeners.get(type) ?? [])]) fn(event);
}

beforeEach(() => {
    windowListeners = new Map();
    nowMs = 100_000;
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
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        documentElement: new FakeElement('html'),
        activeElement: null,
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        setTimeout: (): number => 1,
        clearTimeout: (): void => undefined,
        addEventListener: (type: string, fn: Listener): void => {
            const held = windowListeners.get(type);
            if (held === undefined) windowListeners.set(type, [fn]);
            else held.push(fn);
        },
        removeEventListener: (type: string, fn: Listener): void => {
            const held = windowListeners.get(type);
            if (held === undefined) return;
            const at = held.indexOf(fn);
            if (at >= 0) held.splice(at, 1);
        },
    };
    (globalThis as Record<string, unknown>)['performance'] = { now: () => nowMs };
    (globalThis as Record<string, unknown>)['requestAnimationFrame'] = (): number => 1;
    (globalThis as Record<string, unknown>)['cancelAnimationFrame'] = (): void => undefined;
});

afterEach(() => {
    for (const key of [
        'document',
        'HTMLElement',
        'localStorage',
        'window',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ]) {
        delete (globalThis as Record<string, unknown>)[key];
    }
});

// ---------------------------------------------------------------------------- the rig

const FALLBACK = defaultSettings('TDM', 'mp_foundry', 90);

const FACTS: MatchFacts = {
    mapName: 'FOUNDRY',
    mapPicture: '/maps/foundry.jpg',
    modeName: 'Team Deathmatch',
    difficulty: 'MIXED',
};

const LINEUP: LineupSource = {
    characterIdFor: (id) => BOT_CHARACTER_IDS[id % BOT_CHARACTER_IDS.length] ?? BOT_CHARACTER_IDS[0]!,
    weaponIdFor: () => 'ar_carbine',
};

/** The timeline, as the source states it. */
const DOCK_AT = 4.2;
const DOCKED_AT = 4.8;
const PODIUM_AT = 4.9;
const PLATES_AT = 7.0;
const MEDAL_STAGGER = 0.16;
const STATS_AT = 7.6;
const REST_AT = 8.2;
const ARM_AT = 1.0;

interface Rig {
    readonly summary: EndOfMatch;
    readonly profile: Profile;
    readonly host: FakeElement;
    readonly layer: FakeElement;
    readonly cues: string[];
    readonly continues: number[];
    readonly exits: number[];
    readonly xpStarts: number[];
}

function rig(): Rig {
    const host = new FakeElement('div');
    const profile = new Profile({ fallbackSettings: FALLBACK });
    const cues: string[] = [];
    const continues: number[] = [];
    const exits: number[] = [];
    const xpStarts: number[] = [];
    const characterAssets = new CharacterAssetService({
        preload: () => new Promise(() => undefined),
        dispose: () => undefined,
    });
    const summary = new EndOfMatch({
        rowsPerTeam: 8,
        onContinue: () => continues.push(1),
        onExit: () => exits.push(1),
        characterAssets,
        weaponAssets: null,
        anisotropy: () => 1,
        profile,
        audio: {
            playDebriefHit: (kind) => cues.push(`hit:${kind}`),
            playDebriefSweep: () => cues.push('sweep'),
            playDebriefMedal: (rank) => cues.push(`medal:${rank}`),
        },
    });
    summary.onXp = () => xpStarts.push(1);
    host.appendChild(summary.element as unknown as FakeElement);
    return { summary, profile, host, layer: host.children[0] as FakeElement, cues, continues, exits, xpStarts };
}

function boardOf(perTeam: number): ScoreSystem {
    const score = new ScoreSystem(new EventBus());
    let id = 1;
    for (const team of ['A', 'B'] as readonly ScoreTeam[]) {
        for (let i = 0; i < perTeam; i++) {
            const row = score.register(id, `${team === 'A' ? 'ALLY' : 'HOSTILE'}-${String(id).padStart(3, '0')}`, team);
            if (row !== undefined) {
                row.isLocal = id === 1;
                row.kills = 12 + i;
                row.deaths = 9 + i;
                row.assists = i;
                row.score = 1200 + i * 137;
                row.bestStreak = 4 + i;
                row.shotsFired = 240 + i * 7;
                row.shotsHit = 96 + i * 3;
            }
            id++;
        }
    }
    return score;
}

const WIN: MatchResult = { kind: 'match', winner: 'A', reason: 'Score limit', scoreA: 75, scoreB: 40, roundsA: 0, roundsB: 0 };
const LOSS: MatchResult = { kind: 'match', winner: 'B', reason: 'Score limit', scoreA: 40, scoreB: 75, roundsA: 0, roundsB: 0 };
const DRAW: MatchResult = { kind: 'match', winner: 'DRAW', reason: 'Time — draw', scoreA: 50, scoreB: 50, roundsA: 0, roundsB: 0 };

function show(r: Rig, result: MatchResult = WIN, perTeam = 4, localTeam: ScoreTeam = 'A'): ScoreSystem {
    const score = boardOf(perTeam);
    r.summary.setViewer({ team: localTeam, freeForAll: false });
    r.summary.show(result, localTeam, 1, score, LINEUP, FACTS);
    return score;
}

/** Drive the timeline with the board tab up, which is what keeps the stage out of it. */
function run(r: Rig, seconds: number, dt = 0.016): void {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
        nowMs += dt * 1000;
        r.summary.tick(dt);
    }
}

function find(root: FakeElement, token: string): FakeElement {
    const found = root.querySelectorAll(token)[0];
    if (found === undefined) throw new Error(`no element carrying .${token}`);
    return found;
}

function findAll(root: FakeElement, token: string): FakeElement[] {
    return root.querySelectorAll(token);
}

function frameOf(r: Rig): FakeElement {
    return find(r.layer, 'op-frame');
}

function phases(r: Rig): string[] {
    return [...frameOf(r).tokens].filter((t) => t.startsWith('dbf--'));
}

// ---------------------------------------------------------------------------- the screen

describe('the screen it builds', () => {
    it('mounts one hidden layer on the host', () => {
        const { host, layer, summary } = rig();
        expect(host.children).toHaveLength(1);
        expect(layer.className).toBe('op-screen dbf');
        expect(layer.hidden).toBe(true);
        expect(summary.xpSlot.hidden).toBe(true);
    });

    it('lays the frame out as the head, the body and the band', () => {
        const r = rig();
        expect(frameOf(r).children.map((c) => c.className)).toEqual(['dbf-head', 'dbf-body', 'dbf-band']);
    });

    it('holds the result card, the stage and the board in the body', () => {
        const r = rig();
        expect(find(r.layer, 'dbf-body').children.map((c) => c.className)).toEqual([
            'dbf-card',
            'dbf-stage',
            'dbf-board',
        ]);
        expect(find(r.layer, 'dbf-board').hidden).toBe(true);
    });

    it('offers the two tabs with the keyboard hint', () => {
        const r = rig();
        const tabs = find(r.layer, 'dbf-tabs');
        expect(tabs.getAttribute('role')).toBe('tablist');
        expect(tabs.children.map((c) => c.textContent)).toEqual(['PODIUM', 'SCOREBOARD', 'TAB']);
        expect(tabs.children[0]?.getAttribute('role')).toBe('tab');
    });

    it('offers the two ways out, the primary naming the gesture', () => {
        const r = rig();
        const actions = find(r.layer, 'dbf-band__actions');
        expect(actions.children[0]?.className).toBe('op-cta op-cta--quiet dbf-exit');
        expect(actions.children[0]?.children[1]?.textContent).toBe('MAIN MENU');
        expect(actions.children[1]?.className).toBe('op-cta op-cta--primary dbf-continue');
        expect(find(r.layer, 'dbf-continue__key').textContent).toBe(`SPACE ×${SKIP_TAPS_TO_LEAVE}`);
    });

    it('leaves the player card static, with nothing to open', () => {
        const r = rig();
        show(r);
        expect(find(r.layer, 'op-card').classList.contains('op-card--static')).toBe(true);
    });
});

describe('the continue button', () => {
    it('says PLAY AGAIN with no server', () => {
        const r = rig();
        expect(find(r.layer, 'dbf-continue').children[1]?.textContent).toBe('PLAY AGAIN');
    });

    it('says NEXT MATCH connected, and counts the server’s hold down', () => {
        const r = rig();
        r.summary.setNetworked(true);
        expect(find(r.layer, 'dbf-continue').children[1]?.textContent).toBe('NEXT MATCH');
        r.summary.setRemainingSeconds(12);
        expect(find(r.layer, 'dbf-continue').children[1]?.textContent).toBe('NEXT MATCH · 12s');
        r.summary.setRemainingSeconds(0);
        expect(find(r.layer, 'dbf-continue').children[1]?.textContent).toBe('NEXT MATCH');
    });

    it('rounds a part second up, and ignores a hold nobody is keeping', () => {
        const r = rig();
        r.summary.setNetworked(true);
        r.summary.setRemainingSeconds(3.2);
        expect(find(r.layer, 'dbf-continue').children[1]?.textContent).toBe('NEXT MATCH · 4s');
        r.summary.setRemainingSeconds(null);
        expect(find(r.layer, 'dbf-continue').children[1]?.textContent).toBe('NEXT MATCH');
    });

    it('keeps saying PLAY AGAIN with a hold but no connection', () => {
        const r = rig();
        r.summary.setRemainingSeconds(9);
        expect(find(r.layer, 'dbf-continue').children[1]?.textContent).toBe('PLAY AGAIN');
    });

    it('calls the two handlers', () => {
        const r = rig();
        fire(find(r.layer, 'dbf-continue'), 'click');
        fire(find(r.layer, 'dbf-exit'), 'click');
        expect(r.continues).toEqual([1]);
        expect(r.exits).toEqual([1]);
    });
});

// ---------------------------------------------------------------------------- showing

describe('showing a match', () => {
    it('unhides the screen and opens on the podium tab', () => {
        const r = rig();
        show(r);
        expect(r.layer.hidden).toBe(false);
        expect(r.summary.boardShowing).toBe(false);
        expect(find(r.layer, 'dbf-stage').hidden).toBe(false);
        expect(find(r.layer, 'dbf-board').hidden).toBe(true);
    });

    it('writes the outcome word twice, big and small, and marks a win', () => {
        const r = rig();
        show(r, WIN);
        const hero = find(r.layer, 'dbf-hero__word');
        const head = find(r.layer, 'dbf-head__word');
        const outcome = personalOutcome(WIN, 'A', 1, boardOf(4).rows);
        expect(hero.textContent).toBe(outcome.label);
        expect(head.textContent).toBe(outcome.label);
        expect(hero.classList.contains('is-win')).toBe(true);
        expect(hero.classList.contains('is-loss')).toBe(false);
    });

    it('marks a loss and neither on a draw', () => {
        const r = rig();
        show(r, LOSS);
        expect(find(r.layer, 'dbf-hero__word').classList.contains('is-loss')).toBe(true);
        show(r, DRAW);
        expect(find(r.layer, 'dbf-hero__word').classList.contains('is-win')).toBe(false);
        expect(find(r.layer, 'dbf-hero__word').classList.contains('is-loss')).toBe(false);
    });

    it('writes the same reason line in both places', () => {
        const r = rig();
        show(r, WIN);
        const reason = reasonLine(personalOutcome(WIN, 'A', 1, boardOf(4).rows), WIN, '');
        expect(find(r.layer, 'dbf-hero__reason').textContent).toBe(reason);
        expect(find(r.layer, 'dbf-head__reason').textContent).toBe(reason);
    });

    it('puts this seat’s score first', () => {
        const r = rig();
        show(r, WIN, 4, 'A');
        expect(find(r.layer, 'dbf-head__score').children.map((c) => c.textContent)).toEqual(['75', '—', '40']);
        show(r, WIN, 4, 'B');
        expect(find(r.layer, 'dbf-head__score').children.map((c) => c.textContent)).toEqual(['40', '—', '75']);
    });

    it('names the place with this match’s mode and map, upper-cased', () => {
        const r = rig();
        show(r);
        const subs = findAll(r.layer, 'op-head__sub').map((e) => e.textContent);
        expect(subs).toContain('TEAM DEATHMATCH · FOUNDRY');
    });

    it('clears every phase class and the FLIP transform from the last match', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, 10);
        expect(phases(r).length).toBeGreaterThan(3);
        show(r);
        expect(phases(r)).toEqual(['dbf--card']);
        expect(find(r.layer, 'dbf-hero__word').style['transform']).toBe('');
    });

    it('hides the screen, and shows it again from the top', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, 10);
        r.summary.hide();
        expect(r.layer.hidden).toBe(true);
        show(r);
        expect(phases(r)).toEqual(['dbf--card']);
    });

    it('takes the layer off the host when disposed of', () => {
        const r = rig();
        show(r);
        r.summary.dispose();
        expect(r.host.children).toEqual([]);
    });
});

describe('the two tabs', () => {
    it('turns the board over and back', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        expect(r.summary.boardShowing).toBe(true);
        expect(find(r.layer, 'dbf-board').hidden).toBe(false);
        expect(find(r.layer, 'dbf-stage').hidden).toBe(true);
        expect(find(r.layer, 'dbf-card').hidden).toBe(true);
        r.summary.showBoard(false);
        expect(r.summary.boardShowing).toBe(false);
    });

    it('marks the open tab for a reader', () => {
        const r = rig();
        show(r);
        const tabs = find(r.layer, 'dbf-tabs').children;
        expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
        expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
        r.summary.showBoard(true);
        expect(tabs[0]?.classList.contains('op-tab--on')).toBe(false);
        expect(tabs[1]?.classList.contains('op-tab--on')).toBe(true);
    });

    it('is switched by the tabs themselves', () => {
        const r = rig();
        show(r);
        fire(find(r.layer, 'dbf-tabs').children[1] as FakeElement, 'click');
        expect(r.summary.boardShowing).toBe(true);
        fire(find(r.layer, 'dbf-tabs').children[0] as FakeElement, 'click');
        expect(r.summary.boardShowing).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the timeline

describe('the choreography', () => {
    it('lands the card at once, with the hit its outcome asks for', () => {
        const r = rig();
        show(r, WIN);
        expect(phases(r)).toEqual(['dbf--card']);
        expect(r.cues).toEqual(['hit:WIN']);
    });

    it('plays the loss hit for a loss', () => {
        const r = rig();
        show(r, LOSS);
        expect(r.cues).toEqual(['hit:LOSS']);
    });

    it('docks at its second, with the sweep', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, DOCK_AT - 0.1);
        expect(phases(r)).not.toContain('dbf--dock');
        run(r, 0.2);
        expect(phases(r)).toContain('dbf--dock');
        expect(r.cues).toContain('sweep');
    });

    it('runs the seven phases in order, and no phase twice', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        // The classes accumulate, so the set at the end is the order they were added in.
        const at: Record<string, number> = {};
        for (const [name, when] of [
            ['dbf--dock', DOCK_AT],
            ['dbf--docked', DOCKED_AT],
            ['dbf--podium', PODIUM_AT],
            ['dbf--plates', PLATES_AT],
            ['dbf--stats', STATS_AT],
            ['dbf--rest', REST_AT],
        ] as const) {
            run(r, Math.max(0, when + 0.05 - (at['t'] ?? 0)));
            at['t'] = when + 0.05;
            expect(phases(r)).toContain(name);
        }
        expect(phases(r)).toEqual([
            'dbf--card',
            'dbf--dock',
            'dbf--docked',
            'dbf--podium',
            'dbf--plates',
            'dbf--stats',
            'dbf--rest',
        ]);
    });

    it('plays one medal per body, bronze first', () => {
        const r = rig();
        show(r, WIN, 4);
        r.summary.showBoard(true);
        run(r, PLATES_AT + MEDAL_STAGGER * 4 + 0.2);
        const medals = r.cues.filter((c) => c.startsWith('medal:'));
        expect(medals).toEqual(['medal:2', 'medal:1', 'medal:0']);
    });

    it('starts the XP cadence at the rest, and only once', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, REST_AT - 0.1);
        expect(r.xpStarts).toEqual([]);
        run(r, 0.3);
        expect(r.xpStarts).toEqual([1]);
        run(r, 5);
        expect(r.xpStarts).toEqual([1]);
    });

    it('does nothing at all while hidden', () => {
        const r = rig();
        r.summary.tick(1);
        expect(phases(r)).toEqual([]);
        show(r);
        r.summary.hide();
        const before = phases(r).length;
        r.summary.tick(5);
        expect(phases(r)).toHaveLength(before);
    });

    it('measures the FLIP onto the head’s box when it docks', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        find(r.layer, 'dbf-hero__word').rect = { left: 100, top: 300, right: 500, bottom: 380, width: 400, height: 80 };
        find(r.layer, 'dbf-head__word').rect = { left: 40, top: 20, right: 140, bottom: 40, width: 100, height: 20 };
        find(r.layer, 'dbf-hero__word').offsetWidth = 400;
        run(r, DOCK_AT + 0.1);
        expect(find(r.layer, 'dbf-hero__word').style['transform']).toBe('translate(-60.0px, -280.0px) scale(0.2500)');
    });

    it('does not move the word when it cannot be measured', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        find(r.layer, 'dbf-hero__word').rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        run(r, DOCK_AT + 0.1);
        expect(find(r.layer, 'dbf-hero__word').style['transform']).toBe('');
    });
});

describe('settling', () => {
    it('puts every phase on at once', () => {
        const r = rig();
        show(r);
        r.summary.settle();
        expect(phases(r)).toEqual([
            'dbf--card',
            'dbf--dock',
            'dbf--docked',
            'dbf--podium',
            'dbf--plates',
            'dbf--stats',
            'dbf--rest',
        ]);
    });

    it('plays no cue but the card’s, which `show` had already played', () => {
        const r = rig();
        show(r);
        r.summary.settle();
        expect(r.cues).toEqual(['hit:WIN']);
    });

    it('starts the XP cadence, because that is the rest', () => {
        const r = rig();
        show(r);
        r.summary.settle();
        expect(r.xpStarts).toEqual([1]);
    });

    it('takes the instant marker off again', () => {
        const r = rig();
        show(r);
        r.summary.settle();
        expect(frameOf(r).classList.contains('dbf--instant')).toBe(false);
    });

    it('settles the card alone for the probe’s first surface', () => {
        const r = rig();
        show(r);
        r.summary.settleCard();
        expect(phases(r)).toEqual(['dbf--card']);
    });

    it('does nothing before the screen was ever shown', () => {
        const r = rig();
        r.summary.settle();
        r.summary.settleCard();
        expect(phases(r)).toEqual([]);
    });

    it('leaves the timeline past the rest, so a later tick enters nothing', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        r.summary.settle();
        const before = r.cues.length;
        run(r, 5);
        expect(r.cues).toHaveLength(before);
    });
});

// ---------------------------------------------------------------------------- the keys

describe('the keys', () => {
    it('ignores everything for the first second', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        fireWindow('keydown', { code: 'Escape', key: 'Escape' });
        fireWindow('keydown', { code: 'Tab', key: 'Tab' });
        expect(r.exits).toEqual([]);
        expect(r.summary.boardShowing).toBe(true);
    });

    it('leaves on Escape once the keys are armed', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        fireWindow('keydown', { code: 'Escape', key: 'Escape' });
        expect(r.exits).toEqual([1]);
    });

    it('turns the board over on Tab', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        fireWindow('keydown', { code: 'Tab', key: 'Tab' });
        expect(r.summary.boardShowing).toBe(false);
        fireWindow('keydown', { code: 'Tab', key: 'Tab' });
        expect(r.summary.boardShowing).toBe(true);
    });

    it('answers a synthetic press that carries only `key`', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        fireWindow('keydown', { key: 'Tab' });
        expect(r.summary.boardShowing).toBe(false);
    });

    it('does nothing for every other key', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        for (const key of ['Enter', 'a', 'ArrowLeft', 'F5']) fireWindow('keydown', { code: key, key });
        expect(r.exits).toEqual([]);
        expect(r.continues).toEqual([]);
        expect(r.summary.boardShowing).toBe(true);
    });

    it('ignores a key that is repeating', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        fireWindow('keydown', { code: 'Escape', key: 'Escape', repeat: true });
        expect(r.exits).toEqual([]);
    });

    it('stops listening once the screen is hidden', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        r.summary.hide();
        fireWindow('keydown', { code: 'Escape', key: 'Escape' });
        expect(r.exits).toEqual([]);
    });
});

describe('the scrub', () => {
    it('runs the timeline faster while Space is held, and dresses the frame for it', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        fireWindow('keydown', { code: 'Space', key: ' ' });
        // Past the gesture's hold threshold, the boost is `SKIP_FAST_FORWARD - 1` extra.
        nowMs += 300;
        r.summary.tick(0.016);
        expect(frameOf(r).classList.contains('dbf--fast')).toBe(true);
        expect(SKIP_FAST_FORWARD).toBeGreaterThan(1);
    });

    it('reaches the rest sooner held than not', () => {
        const held = rig();
        show(held);
        held.summary.showBoard(true);
        run(held, ARM_AT + 0.1);
        fireWindow('keydown', { code: 'Space', key: ' ' });
        nowMs += 300;
        run(held, 2);
        const free = rig();
        show(free);
        free.summary.showBoard(true);
        run(free, ARM_AT + 0.1 + 2);
        expect(phases(held).length).toBeGreaterThan(phases(free).length);
    });

    it('stops at the rest and never overshoots it', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        fireWindow('keydown', { code: 'Space', key: ' ' });
        nowMs += 300;
        run(r, 20);
        expect(phases(r)).toHaveLength(7);
        expect(r.cues.filter((c) => c === 'sweep')).toHaveLength(1);
        expect(r.xpStarts).toEqual([1]);
    });

    it('undresses the frame when the screen stops listening', () => {
        const r = rig();
        show(r);
        r.summary.showBoard(true);
        run(r, ARM_AT + 0.1);
        fireWindow('keydown', { code: 'Space', key: ' ' });
        nowMs += 300;
        r.summary.tick(0.016);
        r.summary.hide();
        expect(frameOf(r).classList.contains('dbf--fast')).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the card

describe('the result card', () => {
    it('plates both sides with VS between, this seat’s first', () => {
        const r = rig();
        show(r, WIN, 3, 'A');
        const teams = find(r.layer, 'dbf-teams');
        expect(teams.children.map((c) => c.className.split(' ')[0])).toEqual(['dbf-team', 'dbf-vs', 'dbf-team']);
        expect(find(teams.children[0] as FakeElement, 'dbf-team__sub').textContent).toBe('3 OPERATORS');
        expect(find(teams.children[0] as FakeElement, 'dbf-team__score').textContent).toBe('75');
        expect(find(teams.children[2] as FakeElement, 'dbf-team__score').textContent).toBe('40');
    });

    it('marks the winning plate', () => {
        const r = rig();
        show(r, WIN, 3, 'A');
        const teams = find(r.layer, 'dbf-teams');
        expect(teams.children[0]?.classList.contains('is-winner')).toBe(true);
        expect(teams.children[2]?.classList.contains('is-winner')).toBe(false);
    });

    it('gives each plate the emblem of its relation to the viewer', () => {
        const r = rig();
        show(r, WIN, 3, 'A');
        const emblems = findAll(find(r.layer, 'dbf-teams'), 'dbf-team__emblem');
        expect(emblems).toHaveLength(2);
        expect(emblems[0]?.src).not.toBe(emblems[1]?.src);
        expect(emblems.every((e) => e.draggable === false)).toBe(true);
    });

    it('plates the top two of the ladder in Free-for-All', () => {
        const r = rig();
        const score = boardOf(3);
        r.summary.setViewer({ team: 'A', freeForAll: true });
        const ffa: MatchResult = { ...WIN, winnerEntityId: 4 };
        r.summary.show(ffa, 'A', 1, score, LINEUP, FACTS);
        const teams = find(r.layer, 'dbf-teams');
        expect(findAll(teams, 'dbf-team__sub').map((e) => e.textContent)).toEqual(['WINNER', 'RUNNER-UP']);
    });

    it('names the map, the mode and the difficulty on the mission card', () => {
        const r = rig();
        show(r);
        expect(find(r.layer, 'dbf-mission__img').src).toBe('/maps/foundry.jpg');
        expect(find(r.layer, 'dbf-mission__map').textContent).toBe('FOUNDRY');
        expect(find(r.layer, 'dbf-mission__mode').textContent).toBe('TEAM DEATHMATCH · MIXED');
    });

    it('drops the difficulty connected, where the roster has no one tier', () => {
        const r = rig();
        const score = boardOf(3);
        r.summary.setViewer({ team: 'A', freeForAll: false });
        r.summary.show(WIN, 'A', 1, score, LINEUP, { ...FACTS, difficulty: null });
        expect(find(r.layer, 'dbf-mission__mode').textContent).toBe('TEAM DEATHMATCH');
    });

    it('shows the player’s own six figures', () => {
        const r = rig();
        const score = show(r, WIN, 3, 'A');
        const mine = score.rows.find((row) => row.isLocal);
        if (mine === undefined) throw new Error('no local row');
        const stats = find(r.layer, 'dbf-mission__stats');
        expect(stats.children.map((c) => c.children[0]?.textContent)).toEqual([
            'SCORE',
            'KILLS',
            'DEATHS',
            'K/D',
            'ACCURACY',
            'STREAK',
        ]);
        expect(stats.children[1]?.children[1]?.textContent).toBe(String(mine.kills));
        expect(stats.children[3]?.children[1]?.textContent).toBe(killDeath(mine).toFixed(2));
    });
});

describe('the awards', () => {
    it('names four, each with a row from the board', () => {
        const r = rig();
        show(r, WIN, 4);
        const awards = find(r.layer, 'dbf-awards');
        expect(awards.children.map((c) => c.children[0]?.textContent)).toEqual([
            'MVP',
            'BEST K/D',
            'MOST ASSISTS',
            'LONGEST STREAK',
        ]);
        expect(awards.children.every((c) => (c.children[1]?.textContent ?? '') !== '')).toBe(true);
    });

    it('gives MVP to the ladder’s first, with their points', () => {
        const r = rig();
        const score = show(r, WIN, 4);
        const top = [...score.rows].sort((a, b) => b.score - a.score)[0];
        if (top === undefined) throw new Error('no rows');
        const mvp = find(r.layer, 'dbf-awards').children[0];
        expect(mvp?.children[1]?.textContent).toBe(top.displayName);
        expect(mvp?.children[2]?.textContent).toBe(`${top.score.toLocaleString()} PTS`);
    });

    it('draws nothing at all for a board with nobody on it', () => {
        const r = rig();
        const empty = new ScoreSystem(new EventBus());
        r.summary.setViewer({ team: 'A', freeForAll: false });
        r.summary.show(WIN, 'A', 1, empty, LINEUP, FACTS);
        expect(find(r.layer, 'dbf-awards').children).toEqual([]);
    });
});

describe('the podium plates', () => {
    it('puts one plate under each body, ranked', () => {
        const r = rig();
        show(r, WIN, 4);
        const plates = findAll(r.layer, 'dbf-plate');
        expect(plates.length).toBeGreaterThan(0);
        expect(plates.length).toBeLessThanOrEqual(3);
        expect(plates.map((p) => find(p, 'dbf-plate__medal').textContent)).toEqual(
            plates.map((_p, i) => String(i + 1)),
        );
    });

    it('gives the first the MVP mark and nobody else', () => {
        const r = rig();
        show(r, WIN, 4);
        const plates = findAll(r.layer, 'dbf-plate');
        expect(findAll(plates[0] as FakeElement, 'dbf-plate__mvp')).toHaveLength(1);
        for (const plate of plates.slice(1)) expect(findAll(plate, 'dbf-plate__mvp')).toHaveLength(0);
    });

    it('medals them gold, silver, bronze and staggers them the other way', () => {
        const r = rig();
        show(r, WIN, 4);
        const plates = findAll(r.layer, 'dbf-plate');
        expect(plates[0]?.classList.contains('dbf-plate--gold')).toBe(true);
        expect(plates[1]?.classList.contains('dbf-plate--silver')).toBe(true);
        expect(plates[2]?.classList.contains('dbf-plate--bronze')).toBe(true);
        expect(plates.map((p) => p.style['--dbf-order'])).toEqual(['2', '1', '0']);
    });

    it('places each plate as a percentage of the canvas', () => {
        const r = rig();
        show(r, WIN, 4);
        for (const plate of findAll(r.layer, 'dbf-plate')) {
            expect(plate.style['left']?.endsWith('%')).toBe(true);
            expect(plate.style['top']?.endsWith('%')).toBe(true);
        }
    });

    it('gives each plate the four stat cards', () => {
        const r = rig();
        show(r, WIN, 4);
        const stats = find(findAll(r.layer, 'dbf-plate')[0] as FakeElement, 'dbf-plate__stats');
        expect(stats.children.map((c) => c.children[0]?.textContent)).toEqual(['SCORE', 'KILLS', 'DEATHS', 'K/D']);
    });

    it('marks the local player’s plate', () => {
        const r = rig();
        show(r, WIN, 4);
        const locals = findAll(r.layer, 'dbf-plate').filter((p) => p.classList.contains('dbf-plate--local'));
        expect(locals.length).toBeLessThanOrEqual(1);
    });

    it('rebuilds the plates from scratch on a second show', () => {
        const r = rig();
        show(r, WIN, 4);
        const first = findAll(r.layer, 'dbf-plate').length;
        show(r, WIN, 4);
        expect(findAll(r.layer, 'dbf-plate')).toHaveLength(first);
    });
});

// ---------------------------------------------------------------------------- the reason

describe('the reason line', () => {
    const win = personalOutcome(WIN, 'A', 1, boardOf(2).rows);
    const loss = personalOutcome(LOSS, 'A', 1, boardOf(2).rows);
    const draw = personalOutcome(DRAW, 'A', 1, boardOf(2).rows);

    it('says who led when the time ran out', () => {
        expect(reasonLine(win, { ...WIN, reason: 'Time limit' }, '')).toBe('YOUR TEAM LED WHEN TIME RAN OUT');
        expect(reasonLine(loss, { ...LOSS, reason: 'Time limit' }, '')).toBe('THE ENEMY LED WHEN TIME RAN OUT');
    });

    it('says who reached a limit, naming it', () => {
        expect(reasonLine(win, { ...WIN, reason: 'Score limit' }, '')).toBe('YOUR TEAM REACHED THE SCORE LIMIT');
        expect(reasonLine(win, { ...WIN, reason: 'Tag limit' }, '')).toBe('YOUR TEAM REACHED THE TAG LIMIT');
    });

    it('names the individual where the mode crowned one', () => {
        expect(reasonLine(win, { ...WIN, reason: 'Score limit' }, 'vulture')).toBe('VULTURE REACHED THE SCORE LIMIT');
    });

    it('says the series score for a best-of', () => {
        expect(reasonLine(win, { ...WIN, reason: 'Best of 5', roundsA: 3, roundsB: 2 }, '')).toBe(
            'YOUR TEAM TOOK THE SERIES · 3 — 2',
        );
    });

    it('has two lines for a draw and neither names anybody', () => {
        expect(reasonLine(draw, { ...DRAW, reason: 'Time — draw' }, '')).toBe('LEVEL WHEN TIME RAN OUT');
        expect(reasonLine(draw, { ...DRAW, reason: 'Score tied' }, '')).toBe('LEVEL AT THE END');
    });

    it('falls back to the mode’s own words', () => {
        expect(reasonLine(win, { ...WIN, reason: 'Forfeit' }, '')).toBe('YOUR TEAM · FORFEIT');
    });
});
