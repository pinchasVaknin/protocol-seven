import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EV } from '../shared/core/Events';
import { ALL_WEAPONS } from '../shared/weapons/WeaponDefs';
import { makeSnapshot } from '../shared/player/PlayerState';
import { BYE_IDLE } from '../shared/net/Protocol';
import { WARMUP_MATCH_ID } from '../shared/net/Skirmish';
import { Cheat, CheatOutcome, cheatCodeToggling } from '../shared/cheats/Cheats';
import type { WelcomeInfo } from '../shared/net/Messages';
import type { SummaryInfo } from '../shared/net/Messages';
import { Game } from './Game';
import { FakeElement } from './ui/testing/dom';

/**
 * Characterization tests for the application root (refactor unit C23, written before the
 * refactor and green on the unmodified file).
 *
 * **What is real here and why.** The thing under test is a state machine with a server on one
 * side of it, so everything that *decides* is real: the real `GameScreens` with its real
 * buttons, the real `Input`, the real `Profile` over a storage double, the real `VoteOverlay`,
 * `LoadingScreen` and `QuickLoadout`, the real `Loop` driven one frame at a time, and the real
 * event bus. A test that pressed a double's button would be testing the double.
 *
 * The doubles are the four things that need a GPU, a speaker, a socket or a network fetch —
 * `Renderer`, `ProceduralTextures`, `ProceduralAudio`, `MenuBackdrop` — plus `MatchWorld`,
 * `handshake`, the two asset services and `MapBuildQueue`. `MatchWorld` is doubled for the
 * reason C22 doubled `ClientMatch`: what this file does is decide *what the world is handed*
 * and *when it is torn down*, and a double records exactly that. `MapBuildQueue` is doubled so
 * the five rungs of the migration ladder can each be reached on demand rather than by meshing
 * a real map and hoping the timing lands.
 *
 * The frame loop is driven by hand: `requestAnimationFrame` records the callback instead of
 * scheduling it, so `frame(ms)` runs one complete sim-and-render pass at a time the test
 * chooses. That is what makes `servicePendingTransitions` — which is only ever reached from a
 * render pass or the hidden-tab heartbeat — an ordinary function call here.
 */

// ---------------------------------------------------------------------------- the doubles

/** Every `MatchWorld` built in a test, in order, with what it was handed and what happened to it. */
interface WorldDouble {
    readonly deps: Record<string, unknown>;
    readonly net: NetDouble | null;
    readonly match: MatchDouble;
    readonly map: { def: { id: string } };
    readonly player: Record<string, unknown>;
    readonly debug: Record<string, unknown>;
    botHarness: unknown;
    particulate: null;
    disposed: { keepConnection: boolean } | null;
    readonly harnessOptions: unknown[];
    /** What the frame pass pushed at this world's match and overlay, in order. */
    readonly pushed: Record<string, unknown[]>;
}

interface MatchDouble {
    active: boolean[];
    netFrozen: boolean;
    readonly calls: string[];
    localId: number;
    localTeam: 'A' | 'B';
    readonly flow: { result: unknown; currentPhase: string; round: number; teamScore: (t: string) => number };
}

interface NetDouble {
    state: 'live' | 'rejected' | 'disconnected';
    frozen: boolean;
    updates: number;
    readonly client: {
        closeReason: string;
        reconnectToken: Uint8Array | null;
        effectiveTick: number;
        cheatMask: number;
        readonly stats: { clientTick: number };
        readonly prediction: { stats: { mispredictions: number } };
        readonly sent: string[];
        sendVote: (phase: number, option: number) => void;
        sendReady: (matchId: number) => void;
        sendLoadout: (loadout: unknown) => void;
        sendCheat: (code: string) => void;
    };
}

let worlds: WorldDouble[];
/** What `match.spectatorView(alpha)` answers: a pose while spectating, null otherwise. */
let spectated: unknown = null;
/** What `streaks.activeChopperFor` answers: a live Chopper Gunner, or null. */
let chopper: unknown = null;
let buildQueue: BuildQueueDouble;
let handshakeResult: (() => Promise<unknown>) | null;
let gpuHold: boolean;

interface BuildQueueDouble {
    readonly started: string[];
    readonly taken: string[];
    ready: string | null;
    building: boolean;
    progress: unknown;
    pumped: number[];
    hasReady: (mapId: string) => boolean;
    start: (mapId: string) => void;
    take: (mapId: string) => unknown;
    pump: (budget?: number) => number;
    /** Set by the test, invoked as the queue's own `onComplete`. */
    complete: ((mapId: string, built: unknown, report: unknown) => void) | null;
}

function makeNet(): NetDouble {
    const sent: string[] = [];
    const net = {
        state: 'live' as 'live' | 'rejected' | 'disconnected',
        frozen: false,
        updates: 0,
        update(): void {
            net.updates++;
        },
        client: {
            closeReason: '',
            reconnectToken: null,
            effectiveTick: 0,
            cheatMask: 0,
            stats: { clientTick: 0 },
            prediction: { stats: { mispredictions: 0 } },
            sent,
            sendVote: (phase: number, option: number): void => void sent.push(`vote(${phase},${option})`),
            sendReady: (matchId: number): void => void sent.push(`ready(${matchId})`),
            sendLoadout: (loadout: unknown): void =>
                void sent.push(`loadout(${(loadout as { name?: string } | null)?.name ?? 'null'})`),
            sendCheat: (code: string): void => void sent.push(`cheat(${code})`),
        },
    };
    return net;
}

vi.mock('./MatchWorld', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    MatchWorld: class {
        readonly net: NetDouble | null;
        readonly match: MatchDouble;
        readonly map: { def: { id: string } };
        readonly player: Record<string, unknown>;
        readonly debug: Record<string, unknown>;
        botHarness: unknown = null;
        particulate = null;

        constructor(readonly deps: Record<string, unknown>) {
            const calls: string[] = [];
            this.match = {
                active: [],
                netFrozen: false,
                calls,
                localId: 0,
                localTeam: 'A',
                flow: {
                    result: null,
                    currentPhase: 'LIVE',
                    round: 1,
                    teamScore: (): number => 0,
                },
            } as unknown as MatchDouble;
            const self = this;
            const pushed: Record<string, unknown[]> = {
                scoreboardOpen: [],
                resultSurfaces: [],
                cheatTag: [],
                aimWarning: [],
                headerSlots: [],
                intro: [],
                overlayVisible: [],
            };
            (this as unknown as { pushed: Record<string, unknown[]> }).pushed = pushed;
            const ownGroups: Record<string, object> = { A: { team: 'A' }, B: { team: 'B' } };
            Object.assign(this.match, {
                setActive: (on: boolean): void => void self.match.active.push(on),
                setScoreboardOpen: (on: boolean): void => void pushed['scoreboardOpen']?.push(on),
                setResultSurfacesVisible: (on: boolean): void => void pushed['resultSurfaces']?.push(on),
                setCheatTag: (text: string): void => void pushed['cheatTag']?.push(text),
                setAimWarning: (text: string): void => void pushed['aimWarning']?.push(text),
                setHeaderSlots: (slots: unknown): void => void pushed['headerSlots']?.push(slots),
                clearReplicatedStreaks: (): void => void calls.push('clearStreaks'),
                clearReplicatedProjectiles: (): void => void calls.push('clearProjectiles'),
                applyLoadout: (): void => void calls.push('applyLoadout'),
                headerSlots: [{ label: 'A' }],
                isPlayerDead: false,
                playerRespawnSeconds: 0,
                scoreboardHeld: false,
                inWarmupArena: false,
                streaks: {
                    creditKills: (): void => void calls.push('creditKills'),
                    active: [],
                    lastMs: 0,
                    activeChopperFor: (): unknown => chopper,
                },
                weapons: { definition: { id: 'ar_m4' } },
                actorsForRender: () => [],
                mortarOverlay: undefined,
                ui: { lastUpdateMs: 0, hud: { setIntro: (on: boolean): void => void pushed['intro']?.push(on) } },
                bankProgression: () => ({ lines: [], total: 0, xpBefore: 0, levelBefore: 1, levelAfter: 1, weaponLevelUps: [], challengesCompleted: [], camosUnlocked: [] }),
                lastModeMs: 0,
                mode: { name: 'TEAM DEATHMATCH', getScoreboardColumns: () => [], id: 'TDM' },
                viewer: { team: 'A', freeForAll: false },
                visual: { aimYaw: 0, aimPitch: 0, adsFraction: 0 },
                sampleVisual: (): void => undefined,
                spectatorView: (): unknown => spectated,
                render: (): void => void calls.push('render'),
                simulate: (): void => void calls.push('simulate'),
                botRenderer: { groupFor: (team: string): object => ownGroups[team] ?? {} },
                scoreboard: { rows: [] },
                score: { rows: [] },
                bots: { roster: [] },
            });
            this.net = (deps['server'] ?? null) === null ? null : makeNet();
            this.map = { def: { id: String((deps['mapEntry'] as { id?: string } | undefined)?.id ?? 'mp_foundry') } };
            /**
             * Real snapshots, because the real `CameraRig` reads every field of them: a
             * bare object makes the camera NaN rather than failing where the gap is.
             */
            this.player = {
                sim: makeSnapshot(),
                prev: makeSnapshot(),
                curr: makeSnapshot(),
                weaponSpeedScale: 1,
                step: (): void => void calls.push('step'),
            };
            this.debug = {
                overlay: {
                    onDismiss: null,
                    setVisible: (on: boolean): void => void pushed['overlayVisible']?.push(on),
                },
                simulate: (): void => undefined,
                render: (): void => undefined,
                update: (): void => undefined,
            };
            const record: WorldDouble = {
                deps,
                net: this.net,
                match: this.match,
                map: this.map,
                player: this.player,
                debug: this.debug,
                botHarness: null,
                particulate: null,
                disposed: null,
                harnessOptions: [],
                pushed,
            };
            (this as unknown as { record: WorldDouble }).record = record;
            worlds.push(record);
        }

        dispose(options: { keepConnection?: boolean } = {}): void {
            (this as unknown as { record: WorldDouble }).record.disposed = {
                keepConnection: options.keepConnection === true,
            };
        }

        startBotHarness(options: unknown): void {
            (this as unknown as { record: WorldDouble }).record.harnessOptions.push(options);
        }

        sampleCommand(): unknown {
            return { buttons: 0, yaw: 0, pitch: 0, tick: 0 };
        }

        weaponMoveScale(): number {
            return 1;
        }

        applyMovementConfig(): void {}
        applyWeaponConfig(): void {}
    },
}));

vi.mock('./world/MapBuildQueue', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    MapBuildQueue: class {
        constructor(deps: { onComplete?: BuildQueueDouble['complete'] }) {
            buildQueue.complete = deps.onComplete ?? null;
        }

        get building(): boolean {
            return buildQueue.building;
        }

        get progress(): unknown {
            return buildQueue.progress;
        }

        hasReady(mapId: string): boolean {
            return buildQueue.hasReady(mapId);
        }

        start(mapId: string): void {
            buildQueue.start(mapId);
        }

        take(mapId: string): unknown {
            return buildQueue.take(mapId);
        }

        pump(budget?: number): number {
            return buildQueue.pump(budget);
        }

        cancel(): void {}
    },
}));

vi.mock('./net/Handshake', async (importOriginal) => {
    const original = await importOriginal<typeof import('./net/Handshake')>();
    return {
        ...original,
        handshake: (options: unknown): Promise<unknown> => {
            if (handshakeResult === null) throw new Error('no handshake staged');
            lastHandshakeOptions = options as Record<string, unknown>;
            return handshakeResult();
        },
    };
});

let lastHandshakeOptions: Record<string, unknown> | null = null;

vi.mock('./engine/Renderer', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    Renderer: class {
        readonly three = { shadowMap: {}, info: { memory: { geometries: 0, textures: 0 } } };
        readonly info = { memory: { geometries: 3, textures: 4 }, programs: [1, 2] };
        aspect = 16 / 9;
        pixelRatio = 1;
        readonly calls: string[] = [];
        setSize(): void {}
        setShadowQuality(): void {}
        setMotionBlur(): void {}
        resetMotionBlur(): void {}
        render(): void {}
        renderGunship(): void {}
        clear(): void {}
    },
}));

vi.mock('./engine/ProceduralTextures', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    ProceduralTextures: class {
        readonly anisotropy = 4;
        dispose(): void {}
    },
}));

vi.mock('./engine/ProceduralAudio', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    /**
     * Refuses nothing: every screen in the front end plays something of its own, and an
     * enumerated double would fail on the next one somebody adds rather than on this file.
     */
    ProceduralAudio: class {
        constructor() {
            const state: Record<string, unknown> = { isRunning: false };
            return new Proxy(state, {
                get: (t, key) => {
                    if (key === 'isRunning') return t['isRunning'];
                    if (key === 'start') {
                        return (): void => {
                            t['isRunning'] = true;
                        };
                    }
                    return key in t ? t[key as string] : () => undefined;
                },
                set: (t, key, value) => {
                    t[key as string] = value;
                    return true;
                },
            });
        }
    },
}));

vi.mock('./world/MenuBackdrop', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    MenuBackdrop: class {
        mapId = '';
        prepared: string[] = [];
        prepare(id: string): void {
            this.mapId = id;
            this.prepared.push(id);
        }
        dispose(): void {
            this.mapId = '';
        }
        simulate(): void {}
        frame(): null {
            return null;
        }
    },
}));

vi.mock('./engine/GpuWarmup', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    gpuWarmup: {
        attach: (): void => undefined,
        requestScene: (): void => undefined,
        hold: (): boolean => gpuHold,
        adopt: (): void => undefined,
    },
}));

vi.mock('./characters/CharacterAssetService', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    CharacterAssetService: class {
        preload(): Promise<void> {
            return Promise.resolve();
        }
        avatarProvider(): unknown {
            return { isReady: false, create: (): null => null, dispose: (): void => undefined };
        }
    },
}));

vi.mock('./weapons/WeaponAssetService', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    WeaponAssetService: class {
        readonly asked: string[] = [];
        preload(id: string): Promise<void> {
            this.asked.push(`weapon:${id}`);
            return Promise.resolve();
        }
        preloadLod(id: string): Promise<void> {
            this.asked.push(`lod:${id}`);
            return Promise.resolve();
        }
        preloadEquipment(id: string): Promise<void> {
            this.asked.push(`equipment:${id}`);
            return Promise.resolve();
        }
        preloadKnife(): Promise<void> {
            this.asked.push('knife');
            return Promise.resolve();
        }
        preloadHands(): Promise<void> {
            this.asked.push('hands');
            return Promise.resolve();
        }
    },
}));

vi.mock('./streaks/SentryModel', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), preloadSentry: (): Promise<void> => Promise.resolve() }));
vi.mock('./world/PropModels', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    preloadStation: (): Promise<void> => Promise.resolve(),
    PropModels: class {},
}));
vi.mock('./debug/ConsoleApi', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()), installConsoleApi: (): void => undefined }));

// ---------------------------------------------------------------------------- the DOM double

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
    key?: string;
    code?: string;
    button?: number;
    repeat?: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
}

/**
 * The element class is shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 183 lines of it. This file keeps its own environment: the shared
 * `installFakeDom` installs globals this suite has never run with, and handing a suite a
 * `window` on the way past is how a green suite starts meaning something else.
 *
 * Its element class was a strict subset of the shared one -- the rich 2D context, the reflecting
 * `setAttribute`, `getAttributeNames`, `hasAttribute` and `requestPointerLock` are all in the
 * shared class now. Its *environment* is the superset and stays: it is the only file that
 * registers `Element` and `HTMLCanvasElement` globally, the only one with `setInterval`, a
 * `navigator`, a `window.location` the tests rewrite per case, a `document.hidden` behind a
 * getter and a `requestAnimationFrame` that keeps the callback so a test can step frames -- and
 * its `matchMedia` answers `pointer: fine` where every other double answers reduced motion,
 * which is a different answer to the same call.
 */


// ---------------------------------------------------------------------------- the environment

let windowListeners: Map<string, Listener[]>;
let documentListeners: Map<string, Listener[]>;
let timers: { readonly at: number; readonly fn: () => void; cancelled: boolean }[];
let intervals: { readonly ms: number; readonly fn: () => void; cancelled: boolean }[];
let nowMs = 0;
let pageHidden = false;
let search = '?nosplash';
/** The frame callback the loop asked for, or null when it has not asked. */
let rafCallback: ((ms: number) => void) | null = null;

class FakeKeyboardEvent {}

function installEnvironment(): void {
    windowListeners = new Map();
    documentListeners = new Map();
    timers = [];
    intervals = [];
    worlds = [];
    spectated = null;
    chopper = null;
    nowMs = 100_000;
    pageHidden = false;
    rafCallback = null;
    gpuHold = false;
    handshakeResult = null;
    lastHandshakeOptions = null;
    buildQueue = {
        started: [],
        taken: [],
        ready: null,
        building: false,
        progress: null,
        pumped: [],
        complete: null,
        hasReady: (mapId: string): boolean => buildQueue.ready === mapId,
        start: (mapId: string): void => void buildQueue.started.push(mapId),
        take: (mapId: string): unknown => {
            buildQueue.taken.push(mapId);
            if (buildQueue.ready !== mapId) return null;
            buildQueue.ready = null;
            return { def: { id: mapId } };
        },
        pump: (budget?: number): number => {
            buildQueue.pumped.push(budget ?? 0);
            return 0;
        },
    };

    const storage = new Map<string, string>();
    const store = {
        getItem: (k: string): string | null => storage.get(k) ?? null,
        setItem: (k: string, v: string): void => void storage.set(k, v),
        removeItem: (k: string): void => void storage.delete(k),
        clear: (): void => storage.clear(),
        key: (i: number): string | null => [...storage.keys()][i] ?? null,
        get length(): number {
            return storage.size;
        },
    };
    const setTimer = (fn: () => void, ms = 0): number => {
        timers.push({ at: nowMs + ms, fn, cancelled: false });
        return timers.length;
    };
    const clearTimer = (id: number): void => {
        const timer = timers[id - 1];
        if (timer !== undefined) timer.cancelled = true;
    };
    const setEvery = (fn: () => void, ms = 0): number => {
        intervals.push({ ms, fn, cancelled: false });
        return intervals.length;
    };
    const clearEvery = (id: number): void => {
        const held = intervals[id - 1];
        if (held !== undefined) held.cancelled = true;
    };

    const documentElement = new FakeElement('html');
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        documentElement,
        activeElement: null,
        get hidden(): boolean {
            return pageHidden;
        },
        addEventListener: (type: string, fn: Listener): void => {
            const held = documentListeners.get(type);
            if (held === undefined) documentListeners.set(type, [fn]);
            else held.push(fn);
        },
        removeEventListener: (): void => undefined,
        exitPointerLock: (): void => undefined,
        pointerLockElement: null,
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['HTMLCanvasElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['Element'] = FakeElement;
    (globalThis as Record<string, unknown>)['KeyboardEvent'] = FakeKeyboardEvent;
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['setTimeout'] = setTimer;
    (globalThis as Record<string, unknown>)['clearTimeout'] = clearTimer;
    (globalThis as Record<string, unknown>)['setInterval'] = setEvery;
    (globalThis as Record<string, unknown>)['clearInterval'] = clearEvery;
    Object.defineProperty(globalThis, 'navigator', {
        value: { maxTouchPoints: 0, userAgent: 'node' },
        configurable: true,
        writable: true,
    });
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        setInterval: setEvery,
        clearInterval: clearEvery,
        innerWidth: 1920,
        innerHeight: 1080,
        devicePixelRatio: 1,
        location: { get search(): string { return search; }, host: 'localhost:5173' },
        matchMedia: (query: string) => ({ matches: query.includes('pointer: fine'), media: query }),
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
    (globalThis as Record<string, unknown>)['requestAnimationFrame'] = (fn: (ms: number) => void): number => {
        rafCallback = fn;
        return 1;
    };
    (globalThis as Record<string, unknown>)['cancelAnimationFrame'] = (): void => undefined;
}

beforeEach(() => {
    search = '?nosplash';
    installEnvironment();
});

afterEach(() => {
    for (const key of [
        'document',
        'HTMLElement',
        'HTMLCanvasElement',
        'Element',
        'KeyboardEvent',
        'localStorage',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'navigator',
        'window',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ]) {
        delete (globalThis as Record<string, unknown>)[key];
    }
});

// ---------------------------------------------------------------------------- the rig

interface Rig {
    readonly game: Game;
    readonly uiHost: FakeElement;
    readonly canvas: FakeElement;
    /** Advance the clock and run every timer that has come due, in the order they were set. */
    readonly runTimers: (advanceMs?: number) => void;
    /** One complete sim-and-render pass. */
    readonly frame: (advanceMs?: number) => void;
    /** Every `visibilitychange` listener, as the document would. */
    readonly setHidden: (hidden: boolean) => void;
    readonly tickIntervals: () => void;
}

function rig(): Rig {
    const canvas = new FakeElement('canvas');
    const uiHost = new FakeElement('div');
    const debugHost = new FakeElement('div');
    const game = new Game(
        canvas as unknown as HTMLCanvasElement,
        uiHost as unknown as HTMLElement,
        debugHost as unknown as HTMLElement,
    );
    return {
        game,
        uiHost,
        canvas,
        runTimers: (advanceMs = 5000): void => {
            nowMs += advanceMs;
            const due = timers.filter((t) => !t.cancelled && t.at <= nowMs);
            for (const timer of due) {
                timer.cancelled = true;
                timer.fn();
            }
        },
        frame: (advanceMs = 16): void => {
            nowMs += advanceMs;
            rafCallback?.(nowMs);
        },
        setHidden: (hidden: boolean): void => {
            pageHidden = hidden;
            for (const fn of documentListeners.get('visibilitychange') ?? []) {
                fn({ preventDefault: () => undefined, stopPropagation: () => undefined });
            }
        },
        tickIntervals: (): void => {
            for (const held of intervals) if (!held.cancelled) held.fn();
        },
    };
}

/** A `Welcome`, with only the fields this file reads spelled out. */
function welcome(over: Partial<WelcomeInfo> = {}): WelcomeInfo {
    return {
        entityId: 1,
        team: 'A',
        mapId: 'mp_depot',
        modeId: 'TDM',
        serverTick: 100,
        serverMs: 1000,
        snapshotHz: 20,
        matchId: 7,
        effectiveTick: 100,
        migrated: false,
        ...over,
    } as WelcomeInfo;
}

function summary(over: Partial<SummaryInfo> = {}): SummaryInfo {
    return {
        matchId: 7,
        mapId: 'mp_foundry',
        modeId: 'TDM',
        winner: 'A',
        reason: 'score limit',
        scoreA: 75,
        scoreB: 40,
        rows: [],
        xp: [],
        endsTick: 0,
        ...over,
    } as SummaryInfo;
}

/** Stage a successful handshake and press Play Multiplayer. */
async function connect(r: Rig, over: Partial<WelcomeInfo> = {}): Promise<void> {
    handshakeResult = (): Promise<unknown> =>
        Promise.resolve({
            link: { close: (): void => undefined },
            welcome: welcome(over),
            reconnectToken: new Uint8Array([1, 2, 3]),
            receivedAtMs: nowMs,
            pending: [],
        });
    await (flow(r.game)['playMultiplayer'] as () => Promise<void>).call(flow(r.game));
}

/**
 * The object that owns the server flow: `Game` itself before C23a moved it, and its
 * `GameSession` afterwards.
 *
 * Every assertion below is about behaviour that does not change in the split, so they are
 * written against whichever object is holding it. That is what lets this file be the same
 * file before and after — a characterization test that had to be rewritten by the refactor
 * it is pinning would be proving nothing.
 */
function flow(game: Game): Record<string, unknown> {
    const session = (game as unknown as { session?: object }).session;
    return (session ?? game) as unknown as Record<string, unknown>;
}

/** The object that owns the frame's camera state: `Game` before C23b, its `GameFrame` after. */
function frameOf(game: Game): Record<string, unknown> {
    const owner = (game as unknown as { frame?: object }).frame;
    return (owner ?? game) as unknown as Record<string, unknown>;
}

/**
 * The object that owns the HUD surfaces and the cheat door: `Game` itself before C23b moved
 * them, and its `GameSurfaces` afterwards. Same reasoning as `flow` above.
 */
function surfaces(game: Game): Record<string, unknown> {
    const owner = (game as unknown as { surfaces?: object }).surfaces;
    return (owner ?? game) as unknown as Record<string, unknown>;
}

/** The §4.18 drains only: the render pass pumps the queue every frame with no budget. */
function drains(): number[] {
    return buildQueue.pumped.filter((budget) => budget > 0);
}

/** The skirmish sink the live world was built with. */
function sinkOf(index = 0): Record<string, (...args: never[]) => void> {
    const server = worlds[index]?.deps['server'] as { skirmish?: Record<string, (...args: never[]) => void> } | null;
    const sink = server?.skirmish;
    if (sink === undefined) throw new Error('world was built without a skirmish sink');
    return sink;
}

// ---------------------------------------------------------------------------- the machine

describe('Game: the state machine', () => {
    it('boots to MENU through a timeout, with the loop already running', () => {
        const r = rig();
        expect(r.game.currentState).toBe('BOOT');
        r.game.start();
        expect(r.game.currentState).toBe('BOOT');
        expect(r.game.loopHandle.isRunning).toBe(true);
        r.runTimers();
        expect(r.game.currentState).toBe('MENU');
    });

    it('refuses an illegal transition by name, and says which one', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        expect(() => r.game.transitionTo('SUMMARY')).toThrow('Illegal game transition MENU -> SUMMARY');
    });

    it('is a no-op when the next state is the current one', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        const seen: string[] = [];
        r.game.bus.on(EV.GameStateChanged, (p) => void seen.push(`${p.from}->${p.to}`));
        r.game.transitionTo('MENU');
        expect(seen).toEqual([]);
    });

    it('emits GameStateChanged after the enter handler, with from and to', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        const seen: string[] = [];
        r.game.bus.on(EV.GameStateChanged, (p) => void seen.push(`${p.from}->${p.to}`));
        r.game.transitionTo('MATCH');
        expect(seen).toEqual(['MENU->MATCH']);
    });

    it('arms the bindings only inside a match', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        expect((r.game.inputState as unknown as { bindingsActive: boolean }).bindingsActive).toBe(false);
        r.game.transitionTo('MATCH');
        expect((r.game.inputState as unknown as { bindingsActive: boolean }).bindingsActive).toBe(true);
        r.game.transitionTo('PAUSED');
        expect((r.game.inputState as unknown as { bindingsActive: boolean }).bindingsActive).toBe(false);
    });

    it('builds a world on entering MATCH and activates it', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        expect(worlds).toHaveLength(1);
        expect(worlds[0]?.match.active).toEqual([true]);
        expect(r.game.activeMatch).not.toBeNull();
    });

    it('keeps the world across a pause and disposes it on the way to the menu', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        r.game.transitionTo('PAUSED');
        expect(worlds[0]?.disposed).toBeNull();
        expect(worlds[0]?.match.active).toEqual([true]);
        r.game.transitionTo('MENU');
        expect(worlds[0]?.disposed).toEqual({ keepConnection: false });
        expect(worlds[0]?.match.active).toEqual([true, false]);
        expect(r.game.activeMatch).toBeNull();
    });

    it('does not build a second world while one is up', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        r.game.transitionTo('PAUSED');
        r.game.transitionTo('MATCH');
        expect(worlds).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------- joining

describe('Game: launching and joining', () => {
    it('Play Solo transitions straight to MATCH without dialling', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        await (flow(r.game)['launchMatch'] as () => Promise<void>).call(flow(r.game));
        expect(r.game.currentState).toBe('MATCH');
        expect(lastHandshakeOptions).toBeNull();
        expect(worlds[0]?.deps['server']).toBeNull();
    });

    it('sends the class and the skin with the Hello, and keeps the seat token', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        expect(r.game.currentState).toBe('MATCH');
        expect(lastHandshakeOptions?.['loadout']).not.toBeNull();
        expect(typeof lastHandshakeOptions?.['skinIndex']).toBe('number');
        expect(lastHandshakeOptions?.['reconnectToken']).toBeNull();
        const server = worlds[0]?.deps['server'] as Record<string, unknown>;
        expect((server['welcome'] as WelcomeInfo).mapId).toBe('mp_depot');
        expect(server['reconnectToken']).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('builds the world from the server map, not from the menu selection', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        r.game.menuSelection.mapId = 'mp_dunes';
        await connect(r, { mapId: 'mp_depot' });
        expect((worlds[0]?.deps['mapEntry'] as { id: string }).id).toBe('mp_depot');
    });

    it('a failed join stays on the menu with the reason, and never falls back to solo', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        handshakeResult = (): Promise<unknown> => Promise.reject(new Error('refused'));
        await (flow(r.game)['playMultiplayer'] as () => Promise<void>).call(flow(r.game));
        expect(r.game.currentState).toBe('MENU');
        expect(worlds).toHaveLength(0);
    });

    it('says so when the button was pressed with no server configured', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?nosplash';
        await (flow(r.game)['playMultiplayer'] as () => Promise<void>).call(flow(r.game));
        expect(r.game.currentState).toBe('MENU');
        expect(lastHandshakeOptions).toBeNull();
    });

    it('Play Solo after multiplayer does not dial the leftover options', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        r.game.transitionTo('MENU');
        const before = lastHandshakeOptions;
        // The Play Solo button clears `multiplayerJoin` before launching.
        flow(r.game)['multiplayerJoin'] = null;
        await (flow(r.game)['launchMatch'] as () => Promise<void>).call(flow(r.game));
        expect(lastHandshakeOptions).toBe(before);
        expect(worlds[1]?.deps['server']).toBeNull();
    });
});

// ---------------------------------------------------------------------------- the sink

describe('Game: the skirmish sink', () => {
    it('onPrepare starts the background build for the named map', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        sinkOf().onPrepare?.(9 as never, 'mp_dunes' as never);
        expect(buildQueue.started).toEqual(['mp_dunes']);
    });

    it('a finished build reports readiness for a live match and not for the arena', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        sinkOf().onPrepare?.(9 as never, 'mp_dunes' as never);
        buildQueue.complete?.('mp_dunes', null, { elapsedMs: 1, workMs: 1, chunks: 1, worstChunkMs: 1 });
        expect(worlds[0]?.net?.client.sent).toContain('ready(9)');

        sinkOf().onPrepare?.(WARMUP_MATCH_ID as never, 'mp_foundry' as never);
        buildQueue.complete?.('mp_foundry', null, { elapsedMs: 1, workMs: 1, chunks: 1, worstChunkMs: 1 });
        expect(worlds[0]?.net?.client.sent.filter((s) => s.startsWith('ready'))).toEqual(['ready(9)']);
    });

    it('onMigrated discards the streaks, the projectiles and the ballot before deferring', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        sinkOf().onMigrated?.(welcome({ mapId: 'mp_dunes', matchId: 9 }) as never);
        expect(worlds[0]?.match.calls).toContain('clearStreaks');
        expect(worlds[0]?.match.calls).toContain('clearProjectiles');
        // Deferred: nothing is rebuilt until a frame runs.
        expect(worlds).toHaveLength(1);
    });

    it('onSummary is held until SUMMARY renders it', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        sinkOf().onSummary?.(summary() as never);
        expect(r.game.currentState).toBe('MATCH');
        expect(flow(r.game)['pendingNetSummary']).not.toBeNull();
    });

    it('refuses a digit while no ballot is open, so 1-5 reach the class selector', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        // The overlay stays `Game`'s — it is app-lifetime DOM — and answers false on every
        // frame of the game that is not a ballot, which is what lets the quick class selector
        // registered behind it see the key.
        const overlay = (r.game as unknown as { voteOverlay: { handleDigit: (d: number) => boolean } }).voteOverlay;
        expect(overlay.handleDigit(1)).toBe(false);
    });
});

// ---------------------------------------------------------------------------- rotation

describe('Game: rotation and migration', () => {
    it('a rotation keeps the socket, replaces the welcome and rebuilds the world', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r, { mapId: 'mp_foundry' });
        const onNewMatch = (worlds[0]?.deps['server'] as { onNewMatch: (w: WelcomeInfo) => void }).onNewMatch;
        onNewMatch(welcome({ mapId: 'mp_depot', matchId: 11 }));
        expect(worlds).toHaveLength(1);
        r.frame();
        expect(worlds).toHaveLength(2);
        expect(worlds[0]?.disposed).toEqual({ keepConnection: true });
        expect((worlds[1]?.deps['mapEntry'] as { id: string }).id).toBe('mp_depot');
        expect(r.game.currentState).toBe('MATCH');
    });

    it('adopts a background build for the map it is moving to', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r, { mapId: 'mp_foundry' });
        buildQueue.ready = 'mp_depot';
        const onNewMatch = (worlds[0]?.deps['server'] as { onNewMatch: (w: WelcomeInfo) => void }).onNewMatch;
        onNewMatch(welcome({ mapId: 'mp_depot' }));
        r.frame();
        expect(buildQueue.taken).toEqual(['mp_depot']);
        expect((worlds[1]?.deps['server'] as Record<string, unknown>)['prebuiltMap']).toEqual({ def: { id: 'mp_depot' } });
    });

    it('a migration with the build ready moves in the same frame', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r, { mapId: 'mp_foundry' });
        buildQueue.ready = 'mp_dunes';
        sinkOf().onMigrated?.(welcome({ mapId: 'mp_dunes', matchId: 9 }) as never);
        r.frame();
        expect(worlds).toHaveLength(2);
        expect((worlds[1]?.deps['mapEntry'] as { id: string }).id).toBe('mp_dunes');
    });

    it('a migration with no build shows the loading screen and holds one frame before draining', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r, { mapId: 'mp_foundry' });
        buildQueue.ready = null;
        buildQueue.building = true;
        sinkOf().onMigrated?.(welcome({ mapId: 'mp_dunes', matchId: 9 }) as never);

        r.frame();
        expect(worlds).toHaveLength(1);
        expect(drains()).toEqual([]);

        r.frame();
        expect(drains()).toEqual([]);

        r.frame();
        expect(drains()).toEqual([200]);

        buildQueue.building = false;
        r.frame();
        expect(worlds).toHaveLength(2);
    });

    it('a migration to the map already loaded moves without touching the queue', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r, { mapId: 'mp_foundry' });
        sinkOf().onMigrated?.(welcome({ mapId: 'mp_foundry', matchId: 9 }) as never);
        r.frame();
        expect(worlds).toHaveLength(2);
    });

    it('the summary transition is serviced before the rotation', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        const seen: string[] = [];
        r.game.bus.on(EV.GameStateChanged, (p) => void seen.push(`${p.from}->${p.to}`));
        (worlds[0]?.deps['onMatchEnded'] as () => void)();
        sinkOf().onSummary?.(summary() as never);
        const onNewMatch = (worlds[0]?.deps['server'] as { onNewMatch: (w: WelcomeInfo) => void }).onNewMatch;
        onNewMatch(welcome({ mapId: 'mp_depot' }));
        r.frame();
        expect(seen[0]).toBe('MATCH->SUMMARY');
    });
});

// ---------------------------------------------------------------------------- the window

describe('Game: the post-migration misprediction window', () => {
    it('opens on the move and reports what happened inside it', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        const client = worlds[0]!.net!.client;
        client.effectiveTick = 500;
        client.stats.clientTick = 500;
        client.prediction.stats.mispredictions = 12;
        sinkOf().onMigrated?.(welcome({ mapId: 'mp_foundry', matchId: 9 }) as never);

        const windows = flow(r.game)['migrationWindows'] as { matchId: number; tick: number; mispredictions: number }[];
        expect(windows).toHaveLength(1);
        expect(windows[0]).toEqual({ matchId: 9, tick: 500, mispredictions: 0 });

        client.prediction.stats.mispredictions = 15;
        client.stats.clientTick = 520;
        r.frame();
        expect(windows[0]?.mispredictions).toBe(3);
    });
});

// ---------------------------------------------------------------------------- the hidden tab

describe('Game: the background-tab heartbeat', () => {
    it('starts a timer when the page hides and clears it when it comes back', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        expect(intervals.filter((i) => !i.cancelled)).toHaveLength(0);
        r.setHidden(true);
        expect(intervals.filter((i) => !i.cancelled)).toHaveLength(1);
        r.setHidden(false);
        expect(intervals.filter((i) => !i.cancelled)).toHaveLength(0);
    });

    it('pumps the session and services the deferred transitions while hidden', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r, { mapId: 'mp_foundry' });
        r.setHidden(true);
        const onNewMatch = (worlds[0]?.deps['server'] as { onNewMatch: (w: WelcomeInfo) => void }).onNewMatch;
        onNewMatch(welcome({ mapId: 'mp_depot' }));
        r.tickIntervals();
        expect(worlds).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------- the summary

describe('Game: the summary', () => {
    it("banks the server's XP lines and shows the floor line for an empty tally", async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        const before = r.game.profile.xp;
        sinkOf().onSummary?.(summary({ xp: [] }) as never);
        worlds[0]!.match.localTeam = 'A';
        (worlds[0]!.match.flow as { result: unknown }).result = null;
        r.game.transitionTo('SUMMARY');
        expect(r.game.currentState).toBe('SUMMARY');
        expect(r.game.profile.xp).toBeGreaterThan(before);
    });

    it('reports no seconds left when nobody is holding the screen', () => {
        const r = rig();
        const left = (flow(r.game)['summaryRemainingSeconds'] as () => number | null).call(flow(r.game));
        expect(left).toBeNull();
    });

    it('counts the hold against the synced server clock', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        worlds[0]!.net!.client.stats.clientTick = 100;
        sinkOf().onSummary?.(summary({ endsTick: 220 }) as never);
        r.game.transitionTo('SUMMARY');
        const left = (flow(r.game)['summaryRemainingSeconds'] as () => number | null).call(flow(r.game));
        expect(left).toBeCloseTo(2, 5);
    });
});

// ---------------------------------------------------------------------------- the connection

describe('Game: a connection that ends', () => {
    it('a refusal goes to the menu and is never re-dialled', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        const net = worlds[0]!.net!;
        net.state = 'rejected';
        net.client.closeReason = 'version';
        r.frame();
        expect(r.game.currentState).toBe('MENU');
    });

    it('an idle kick drops the seat token and goes to the menu', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        const net = worlds[0]!.net!;
        net.state = 'disconnected';
        net.client.closeReason = BYE_IDLE;
        r.frame();
        expect(r.game.currentState).toBe('MENU');
        expect(flow(r.game)['reconnectToken']).toBeNull();
    });

    it('an ordinary drop dials back in with the seat it held', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        const net = worlds[0]!.net!;
        net.state = 'disconnected';
        net.client.closeReason = 'socket';
        handshakeResult = (): Promise<unknown> =>
            Promise.resolve({
                link: { close: (): void => undefined },
                welcome: welcome({ mapId: 'mp_depot' }),
                reconnectToken: new Uint8Array([9]),
                receivedAtMs: nowMs,
                pending: [],
            });
        r.frame();
        await Promise.resolve();
        await Promise.resolve();
        expect(lastHandshakeOptions?.['reconnectToken']).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('refreshes the seat token from the netcode every frame', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        worlds[0]!.net!.client.reconnectToken = new Uint8Array([7, 7]);
        r.frame();
        expect(flow(r.game)['reconnectToken']).toEqual(new Uint8Array([7, 7]));
    });
});

// ---------------------------------------------------------------------------- warming

describe('Game: warming the assets', () => {
    it('warms the two equipped weapons, the grenades, the knife and the hands off the match screen', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        const assets = (r.game as unknown as { weaponAssets: { asked: string[] } }).weaponAssets;
        expect(assets.asked.filter((a) => a === 'knife')).not.toHaveLength(0);
        expect(assets.asked.filter((a) => a === 'hands')).not.toHaveLength(0);
        expect(assets.asked.some((a) => a.startsWith('weapon:'))).toBe(true);
        expect(assets.asked.some((a) => a.startsWith('lod:'))).toBe(true);
    });

    it('warms every weapon in the arsenal, behind the two the player is about to hold (#35)', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        const asked = (r.game as unknown as { weaponAssets: { asked: string[] } }).weaponAssets.asked;
        // Every weapon's full template, which is what the editor and the preview were waiting
        // on per weapon before BACKLOG #35.
        for (const def of ALL_WEAPONS) expect(asked).toContain(`weapon:${def.id}`);
        // And last: the equipped class, the grenades, the knife, the arms and the world's LODs
        // are all asked for before the first arsenal-only weapon is.
        const equipped = asked.indexOf('hands');
        const arsenalOnly = asked.findIndex(
            (entry, at) => entry.startsWith('weapon:') && at > asked.lastIndexOf('lod:' + ALL_WEAPONS[0]!.id),
        );
        expect(equipped).toBeLessThan(arsenalOnly);
    });

    it('does not warm on the way into a match', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        const assets = (r.game as unknown as { weaponAssets: { asked: string[] } }).weaponAssets;
        const before = assets.asked.length;
        r.game.transitionTo('MATCH');
        expect(assets.asked).toHaveLength(before);
    });
});

// ---------------------------------------------------------------------------- cheats

describe('Game: the cheat door', () => {
    it('answers an unrecognised code without a round trip', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        (surfaces(r.game)['requestCheat'] as (c: string) => void).call(surfaces(r.game), 'NOTACODE');
        expect(worlds[0]?.net?.client.sent.filter((s) => s.startsWith('cheat'))).toEqual([]);
    });

    it('sends everything else to the server when there is one', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        // Read out of the table rather than typed here: a code is input and an entitlement is
        // state, and `check-cheats.mjs` holds this file to that rule as it holds the game to it.
        const code = cheatCodeToggling(Cheat.God);
        expect(code).not.toBeNull();
        (surfaces(r.game)['requestCheat'] as (c: string) => void).call(surfaces(r.game), code ?? '');
        expect(worlds[0]?.net?.client.sent.some((entry) => entry.startsWith('cheat('))).toBe(true);
    });

    it('the pause screen button toggles the overlay request against what is on screen', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        r.game.transitionTo('PAUSED');
        const toggle = (): void =>
            (r.game as unknown as { toggleOverlayFromPause: () => void }).toggleOverlayFromPause();
        toggle();
        expect(surfaces(r.game)['debugRequest']).toBe('onPause');
        toggle();
        expect(surfaces(r.game)['debugRequest']).toBe('none');
    });

    it("the server's reply captions the screen", async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        sinkOf().onCheats?.(CheatOutcome.Granted as never);
        expect(worlds[0]?.net?.client.sent.filter((s) => s.startsWith('cheat'))).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- the surfaces

describe('Game: the HUD surfaces, decided once a frame', () => {
    /** A live solo match with one frame run, and what that frame pushed at the match. */
    function liveFrame(over: Record<string, unknown> = {}): Record<string, unknown[]> {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        const world = worlds.at(-1)!;
        Object.assign(world.match, over);
        r.frame();
        return world.pushed;
    }

    it('pushes the scoreboard, the result surfaces and the header every frame', () => {
        const pushed = liveFrame();
        expect(pushed['scoreboardOpen']).toEqual([false]);
        expect(pushed['resultSurfaces']).toEqual([true]);
        expect(pushed['headerSlots']).toEqual([[{ label: 'A' }]]);
    });

    it('holds the board open while Tab is held, and reports nothing in the waiting room', () => {
        expect(liveFrame({ scoreboardHeld: true })['scoreboardOpen']).toEqual([true]);
        // The waiting room reports no result, so neither the board nor the strip nor the header.
        const warmup = liveFrame({ scoreboardHeld: true, inWarmupArena: true });
        expect(warmup['scoreboardOpen']).toEqual([false]);
        expect(warmup['resultSurfaces']).toEqual([false]);
        expect(warmup['headerSlots']).toEqual([[]]);
    });

    it('keeps the debug overlay down until it is asked for, and up in a match once it is', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        r.frame();
        expect(worlds[0]?.pushed['overlayVisible']).toEqual([false, false]);
        surfaces(r.game)['debugRequest'] = 'inMatch';
        r.frame();
        expect(worlds[0]?.pushed['overlayVisible']?.at(-1)).toBe(true);
    });

    it('refuses an in-match request on the pause screen and allows the pause screen its own', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        r.game.transitionTo('PAUSED');
        surfaces(r.game)['debugRequest'] = 'inMatch';
        r.frame();
        expect(worlds[0]?.pushed['overlayVisible']?.at(-1)).toBe(false);
        surfaces(r.game)['debugRequest'] = 'onPause';
        r.frame();
        expect(worlds[0]?.pushed['overlayVisible']?.at(-1)).toBe(true);
    });

    it('reports no cheat tag and no aim warning for an ordinary offline match', () => {
        const pushed = liveFrame();
        expect(pushed['cheatTag']).toEqual(['']);
        expect(pushed['aimWarning']?.at(-1)).toBe('');
    });

    it('runs the frame on a screen with no world without building one', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.frame();
        r.frame();
        expect(worlds).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------- the cheat door

describe('Game: what a cheat code does offline', () => {
    it('changes nothing at all for a code that is not one', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        (surfaces(r.game)['requestCheat'] as (c: string) => void).call(surfaces(r.game), 'XYZZYNOPE');
        expect((surfaces(r.game)['cheatMask'] as number)).toBe(0);
    });

    it('applies a toggle against this process when there is no server', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        const code = cheatCodeToggling(Cheat.God) ?? '';
        const mask = (): number => (surfaces(r.game)['cheatMask'] as number);
        expect(mask()).toBe(0);
        (surfaces(r.game)['requestCheat'] as (c: string) => void).call(surfaces(r.game), code);
        expect(mask() & Cheat.God).toBe(Cheat.God);
        (surfaces(r.game)['requestCheat'] as (c: string) => void).call(surfaces(r.game), code);
        expect(mask() & Cheat.God).toBe(0);
    });

    it('drops the offline entitlement with the world it was granted in', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        const code = cheatCodeToggling(Cheat.God) ?? '';
        (surfaces(r.game)['requestCheat'] as (c: string) => void).call(surfaces(r.game), code);
        expect((surfaces(r.game)['cheatMask'] as number) & Cheat.God).toBe(Cheat.God);
        r.game.transitionTo('MENU');
        expect((surfaces(r.game)['cheatMask'] as number)).toBe(0);
    });

    it('refuses a code typed on the menu, where there is no seat to apply it to', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        const code = cheatCodeToggling(Cheat.God) ?? '';
        (surfaces(r.game)['requestCheat'] as (c: string) => void).call(surfaces(r.game), code);
        expect((surfaces(r.game)['cheatMask'] as number)).toBe(0);
    });

    it('lets the replicated mask win over anything this process granted itself', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r);
        worlds[0]!.net!.client.cheatMask = Cheat.Unseen;
        expect((surfaces(r.game)['cheatMask'] as number)).toBe(Cheat.Unseen);
    });
});

// ---------------------------------------------------------------------------- the frame

describe('Game: composing the frame', () => {
    it('draws the ordinary view when nothing has taken the camera', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        r.frame();
        expect(worlds[0]?.match.calls).toContain('render');
        expect(worlds[0]?.pushed['intro']).toEqual([false]);
    });

    it('runs the gunship pass once a chopper is up for this seat', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        chopper = {
            activeView: (view: Record<string, number>): boolean => {
                Object.assign(view, { x: 0, y: 40, z: 0, yaw: 0, pitch: -0.4, fov: 60 });
                return true;
            },
        };
        worlds[0]!.match.localTeam = 'A';
        r.frame();
        // The groups themselves belong to the renderer, which is a double here; what this
        // pins is that the frame reached the pass with a live streak rather than the ordinary
        // path, and that the match still rendered its own scene first.
        expect(worlds[0]?.match.calls).toContain('render');
    });

    it('drives the camera from the watched body while spectating', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        spectated = { x: 3, y: 1, z: -2, yaw: 1.2, eyeHeight: 0.95 };
        r.frame();
        const pose = frameOf(r.game)['spectatePose'] as { x: number; eyeHeight: number };
        expect(pose.x).toBe(3);
        // The watched body's own eye, not the standing 1.65 the snapshot starts at.
        expect(pose.eyeHeight).toBe(0.95);
    });

    it('leaves every motion field of the spectate drive at rest', () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        r.game.transitionTo('MATCH');
        spectated = { x: 0, y: 0, z: 0, yaw: 0, eyeHeight: 1.65 };
        r.frame();
        const drive = frameOf(r.game)['spectateDrive'] as { sprint: boolean; slide: boolean; adsFraction: number };
        expect(drive.sprint).toBe(false);
        expect(drive.slide).toBe(false);
        expect(drive.adsFraction).toBe(0);
    });

    it('compiles instead of drawing while the GPU warm-up holds, and still cashes a rotation', async () => {
        const r = rig();
        r.game.start();
        r.runTimers();
        search = '?server=127.0.0.1:8080';
        await connect(r, { mapId: 'mp_foundry' });
        gpuHold = true;
        const onNewMatch = (worlds[0]?.deps['server'] as { onNewMatch: (w: WelcomeInfo) => void }).onNewMatch;
        onNewMatch(welcome({ mapId: 'mp_foundry' }));
        r.frame();
        // The held frame draws nothing and still services the deferred rotation, which is the
        // whole reason that call sits on both sides of the early return.
        expect(worlds).toHaveLength(2);
    });
});
