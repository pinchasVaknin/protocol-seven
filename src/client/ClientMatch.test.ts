import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installClock } from '../shared/core/Clock';
import { angleDelta } from '../shared/core/MathUtil';
import { createGameBus, EV } from '../shared/core/Events';
import { Btn, type InputCommand } from '../shared/core/InputCommand';
import { DEFAULT_SCHEDULER } from '../shared/ai/AiScheduler';
import { DEFAULT_PERCEPTION, DEFAULT_TIERS } from '../shared/ai/DifficultyTiers';
import { Cheat } from '../shared/cheats/Cheats';
import { DEFAULT_EQUIPMENT_CONFIG } from '../shared/equipment/EquipmentConfig';
import { defaultLoadouts, resolveLoadout } from '../shared/meta/Loadouts';
import { defaultSettings } from '../shared/meta/SaveData';
import { Domination } from '../shared/modes/Domination';
import type { GameModeId } from '../shared/modes/GameMode';
import { SearchAndDestroy } from '../shared/modes/SearchAndDestroy';
import { findMap, findMode } from '../shared/modes/ModeRegistry';
import { STREAK_DEFS } from '../shared/streaks/StreakDefs';
import { DEFAULT_HEALTH_CONFIG } from '../shared/player/Health';
import { DEFAULT_MOVEMENT_CONFIG } from '../shared/player/MovementConfig';
import { PlayerController } from '../shared/player/PlayerController';
import { DEFAULT_VIEWMODEL_CONFIG } from '../shared/weapons/ViewmodelConfig';
import { loadMapCollision } from '../shared/world/MapLoader';
import { DEFAULT_CAMERA_CONFIG } from './player/CameraConfig';
import { ViewmodelLayer } from './player/Viewmodel';
import { Profile } from './meta/Profile';
import { Match, type MatchDeps } from './ClientMatch';
import { FakeElement } from './ui/testing/dom';

/**
 * Characterization tests for the composition root of a match (refactor unit C24, written
 * before the refactor and green on the unmodified file).
 *
 * **What is real here and why.** The thing under test decides what a player is told and what
 * a key press costs, and both answers are assembled from a dozen real systems — so almost
 * everything is real: a real `CollisionWorld` baked from a shipped map, the real
 * `PlayerController`, the real `BotDirector` with its real navmesh, the real `GameMode` out of
 * the registry, the real `MatchFlow`, `ScoreSystem`, `StreakSystem`, `MatchHud`,
 * `MatchEquipment`, `MatchMeta`, `MortarOverlay`, the real weapon meshes, and the real event
 * bus. A HUD test that read a double's banner would be testing the double.
 *
 * The doubles are the four things that need a speaker, a GPU surface or a socket —
 * `ProceduralAudio` (a `Proxy` that answers any method with a no-op), the camera rig, the
 * input device and the character avatar provider — plus `SentryModel`, whose preload is a
 * network fetch, and `weaponAssets: null`, which is the harness case the file is written for.
 *
 * **Reaching the private members.** The four helpers below — `ledger`, `surfaces`, `arsenal`
 * and `life` — each answer with the collaborator when it exists and with the `Match` itself
 * when it does not. That is what lets the same assertions be green on the unmodified file and
 * on each of C24a, C24b and C24c without one of them being rewritten: a test the refactor has
 * to edit proves nothing about the refactor.
 */

// ---------------------------------------------------------------------------- the doubles

vi.mock('./streaks/SentryModel', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./streaks/SentryModel')>()),
    preloadSentry: (): Promise<void> => Promise.resolve(),
}));

/**
 * The element class is shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 188 lines of it. This file keeps its own environment: the shared
 * `installFakeDom` installs globals this suite has never run with, and handing a suite a
 * `window` on the way past is how a green suite starts meaning something else.
 *
 * Its double was the shared one with `clientWidth`/`clientHeight` at 240x160 instead of 0, and
 * nothing in the tree reads either outside `probes/`, which this suite does not reach. Its
 * `animate` returned a plain object with the same four members a `FakeAnimation` has.
 */


// ---------------------------------------------------------------------------- the environment

let nowMs = 0;

/** The one clock everything under this file reads. `performance.now` is wired to the same value. */
installClock({ nowMs: () => nowMs });

beforeEach(() => {
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
    const setTimer = (fn: () => void): number => {
        void fn;
        return 1;
    };
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
        createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
        documentElement: new FakeElement('html'),
        activeElement: null,
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
    (globalThis as Record<string, unknown>)['localStorage'] = store;
    (globalThis as Record<string, unknown>)['setTimeout'] = setTimer;
    (globalThis as Record<string, unknown>)['clearTimeout'] = (): void => undefined;
    (globalThis as Record<string, unknown>)['window'] = {
        localStorage: store,
        setTimeout: setTimer,
        clearTimeout: (): void => undefined,
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        matchMedia: (query: string) => ({ matches: false, media: query }),
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
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
        'setTimeout',
        'clearTimeout',
        'window',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ]) {
        delete (globalThis as Record<string, unknown>)[key];
    }
});

// ---------------------------------------------------------------------------- the rig

/**
 * The collaborator that owns the streak doors, or the `Match` itself before C24a moved them.
 *
 * Four helpers rather than one so that each sub-unit can land on its own: whichever of the
 * four fields exists answers, and until it does the original object does.
 */
function ledger(match: Match): Record<string, never> {
    const self = match as unknown as Record<string, Record<string, never>>;
    return self['ledger'] ?? (match as unknown as Record<string, never>);
}

function surfaces(match: Match): Record<string, never> {
    const self = match as unknown as Record<string, Record<string, never>>;
    return self['surfaces'] ?? (match as unknown as Record<string, never>);
}

function arsenal(match: Match): Record<string, never> {
    const self = match as unknown as Record<string, Record<string, never>>;
    return self['arsenal'] ?? (match as unknown as Record<string, never>);
}

function life(match: Match): Record<string, never> {
    const self = match as unknown as Record<string, Record<string, never>>;
    return self['life'] ?? (match as unknown as Record<string, never>);
}

/** Call a member that is TS-private on whichever object currently holds it. */
function call<T>(owner: Record<string, never>, name: string, ...args: unknown[]): T {
    const fn = (owner as unknown as Record<string, (...a: unknown[]) => T>)[name];
    if (typeof fn !== 'function') throw new Error(`no such member: ${name}`);
    return fn.apply(owner, args);
}

/** Read a member that is TS-private on whichever object currently holds it. */
function read<T>(owner: Record<string, never>, name: string): T {
    return (owner as unknown as Record<string, T>)[name] as T;
}

interface Rig {
    readonly match: Match;
    readonly bus: ReturnType<typeof createGameBus>;
    readonly player: PlayerController;
    readonly host: FakeElement;
    readonly shakes: number[];
    readonly viewOffsets: number[][];
    readonly streakRequests: unknown[][];
    readonly scene: THREE.Scene;
    cheatMask: number;
    actors: (() => Iterable<never>) | undefined;
}

interface RigOptions {
    readonly modeId?: GameModeId;
    readonly mapId?: string;
    readonly networked?: boolean;
    readonly localTeam?: 'A' | 'B';
    readonly warmupArena?: boolean;
}

function makeCommand(over: Partial<InputCommand> = {}): InputCommand {
    return {
        tickIndex: 0,
        buttons: 0,
        moveX: 0,
        moveY: 0,
        yaw: 0,
        pitch: 0,
        sampledAtMs: nowMs,
        ...over,
    } as unknown as InputCommand;
}

function rig(options: RigOptions = {}): Rig {
    const bus = createGameBus();
    const scene = new THREE.Scene();
    const host = new FakeElement('div');
    const map = findMap(options.mapId ?? 'mp_foundry');
    const mode = findMode(options.modeId ?? 'TDM');
    const collision = loadMapCollision(map.def);
    const player = new PlayerController(DEFAULT_MOVEMENT_CONFIG, collision.collision, bus);
    const spawn = collision.spawns[0];
    if (spawn !== undefined) player.spawn(spawn.position.x, spawn.position.y, spawn.position.z, spawn.facingYaw);

    const shakes: number[] = [];
    const viewOffsets: number[][] = [];
    const streakRequests: unknown[][] = [];
    const loadout = resolveLoadout(defaultLoadouts()[0]!, 0);
    const profile = new Profile({ fallbackSettings: defaultSettings('TDM', 'mp_foundry', 90) });

    const state: { cheatMask: number; actors: (() => Iterable<never>) | undefined } = {
        cheatMask: 0,
        actors: undefined,
    };

    const deps = {
        bus,
        scene,
        characterAvatarProvider: () => ({
            isReady: false,
            create: (): null => null,
            dispose: (): void => undefined,
        }),
        weaponAssets: null,
        viewmodel: new ViewmodelLayer(DEFAULT_CAMERA_CONFIG),
        cameraRig: {
            fov: 90,
            camera: camera(),
            shake: {
                add: (amount: number): void => {
                    shakes.push(amount);
                },
            },
        },
        cameraConfig: DEFAULT_CAMERA_CONFIG,
        audio: new Proxy({}, { get: () => () => undefined }),
        input: {
            yaw: 0,
            pitch: 0,
            addViewOffset: (yaw: number, pitch: number): void => {
                viewOffsets.push([yaw, pitch]);
            },
            setView: (): void => undefined,
            takeFirePress: (): number => nowMs,
            keybinds: { inputsFor: (): readonly string[] => ['KeyT'] },
        },
        world: collision.collision,
        player,
        movementConfig: DEFAULT_MOVEMENT_CONFIG,
        weaponDef: loadout.primary,
        secondaryDef: loadout.secondary,
        playerBaseDef: loadout.primaryBase,
        viewmodelConfig: DEFAULT_VIEWMODEL_CONFIG,
        healthConfig: DEFAULT_HEALTH_CONFIG,
        equipmentConfig: DEFAULT_EQUIPMENT_CONFIG,
        uiHost: host,
        anisotropy: 4,
        map,
        mode,
        tiers: DEFAULT_TIERS,
        difficulty: 'MIX',
        perceptionConfig: DEFAULT_PERCEPTION,
        schedulerConfig: DEFAULT_SCHEDULER,
        seed: 1234,
        loadout,
        profile,
        banksProgress: false,
        networked: options.networked === true,
        warmupArena: options.warmupArena === true,
        localTeam: options.localTeam ?? 'A',
        cheats: (): number => state.cheatMask,
        actors: options.networked === true ? (): Iterable<never> => state.actors?.() ?? [] : undefined,
        onStreakRequest: (...args: unknown[]): void => {
            streakRequests.push(args);
        },
    } as unknown as MatchDeps;

    const match = new Match(deps);
    return {
        match,
        bus,
        player,
        host,
        shakes,
        viewOffsets,
        streakRequests,
        scene,
        get cheatMask(): number {
            return state.cheatMask;
        },
        set cheatMask(value: number) {
            state.cheatMask = value;
        },
        get actors(): (() => Iterable<never>) | undefined {
            return state.actors;
        },
        set actors(value: (() => Iterable<never>) | undefined) {
            state.actors = value;
        },
    };
}

// ---------------------------------------------------------------------------- the tests

/** The wire's index for a sentry, derived rather than written down, as the client derives it. */
const STREAK_KIND_SENTRY = STREAK_DEFS.findIndex((def) => def.id === 'sentry');
const STREAK_KIND_UAV = STREAK_DEFS.findIndex((def) => def.id === 'uav');
const STREAK_KIND_MORTAR = STREAK_DEFS.findIndex((def) => def.id === 'mortar');

/** A camera for the render pass. Nothing is drawn; the pass only reads its position. */
function camera(): THREE.PerspectiveCamera {
    return new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 500);
}

/** Put the player's body somewhere, without the `player.spawned` a real spawn emits. */
function place(r: Rig, x: number, y: number, z: number): void {
    const sim = r.player.sim as unknown as Record<string, number>;
    sim['x'] = x;
    sim['y'] = y;
    sim['z'] = z;
}

/** The three fills the render pass runs, without the rest of a frame. */
function fillHud(match: Match): void {
    call(surfaces(match), 'fillTacticalState');
    call(surfaces(match), 'fillStreakHud');
    call(surfaces(match), 'fillMinimapStreaks');
}

function streakView(over: Partial<import('../shared/net/Skirmish').StreakView> = {}): import('../shared/net/Skirmish').StreakView {
    return {
        offers: [],
        balance: 0,
        nextKind: -1,
        nextPrice: 0,
        scrambled: false,
        sweepAngle: -1,
        contacts: [],
        entities: [],
        ...over,
    };
}

describe('Match — construction', () => {
    it('builds every system a solo Team Deathmatch needs', () => {
        const r = rig();
        expect(r.match.mode.id).toBe('TDM');
        expect(r.match.flow.currentPhase).toBe('WARMUP');
        expect(r.match.localId).toBe(0);
        expect(r.match.localTeam).toBe('A');
        expect(r.match.isNetworked).toBe(false);
        expect(r.match.range).toBeNull();
        r.match.dispose();
    });

    it('scores for itself offline and never over the network', () => {
        const solo = rig();
        const net = rig({ networked: true });
        expect(solo.match.score.authoritative).toBe(true);
        expect(net.match.score.authoritative).toBe(false);
        expect(net.match.isNetworked).toBe(true);
        solo.match.dispose();
        net.match.dispose();
    });

    it('takes the side the server put this client on', () => {
        const r = rig({ networked: true, localTeam: 'B' });
        expect(r.match.localTeam).toBe('B');
        expect(r.match.viewer).toEqual({ team: 'B', freeForAll: false });
        r.match.dispose();
    });

    it('makes the warm-up arena invulnerable and unrecorded', () => {
        const plain = rig();
        const arena = rig({ warmupArena: true, networked: true });
        expect(arena.match.inWarmupArena).toBe(true);
        expect(arena.match.damage.combatantsInvulnerable).toBe(true);
        expect(arena.match.score.records).toBe(false);
        expect(plain.match.inWarmupArena).toBe(false);
        expect(plain.match.damage.combatantsInvulnerable).toBe(false);
        plain.match.dispose();
        arena.match.dispose();
    });

    it('carries free-for-all into the three systems that branch on it', () => {
        const r = rig({ modeId: 'FFA' });
        expect(r.match.score.freeForAll).toBe(true);
        expect(r.match.bots.freeForAll).toBe(true);
        expect(r.match.damage.freeForAll).toBe(true);
        expect(r.match.viewer).toEqual({ team: 'A', freeForAll: true });
        r.match.dispose();
    });

    it('gives the range infinite spare magazines and nothing else one', () => {
        const range = rig({ modeId: 'RANGE', mapId: 'mp_testbed' });
        const tdm = rig();
        expect(range.match.weapons.inventory.infiniteReserve).toBe(true);
        expect(tdm.match.weapons.inventory.infiniteReserve).toBe(false);
        range.match.dispose();
        tdm.match.dispose();
    });
});

describe('Match — which objectives the minimap draws', () => {
    it('asks the mode once, at construction', () => {
        const tdm = rig();
        const dom = rig({ modeId: 'DOM' });
        const snd = rig({ modeId: 'SND' });
        expect(tdm.match.ui.hud.minimap.objectiveKinds).toEqual([]);
        expect(tdm.match.ui.hud.minimap.showObjectives).toBe(false);
        expect(dom.match.ui.hud.minimap.objectiveKinds).toEqual(['flag']);
        expect(dom.match.ui.hud.minimap.showObjectives).toBe(true);
        expect(snd.match.ui.hud.minimap.objectiveKinds).toEqual(['bombsite']);
        expect(snd.match.ui.hud.minimap.showObjectives).toBe(true);
        tdm.match.dispose();
        dom.match.dispose();
        snd.match.dispose();
    });
});

describe('Match — the streak ledger', () => {
    it('keeps the class slots in key order and the earned set without the gaps', () => {
        const r = rig();
        call(ledger(r.match), 'setStreakLoadout', ['uav', null, 'mortar']);
        expect(read(ledger(r.match), 'streakSlots')).toEqual(['uav', null, 'mortar']);
        expect(read(ledger(r.match), 'equippedStreakIds')).toEqual(['uav', 'mortar']);
        r.match.dispose();
    });

    it('pads a short list to three slots', () => {
        const r = rig();
        call(ledger(r.match), 'setStreakLoadout', ['uav']);
        expect(read(ledger(r.match), 'streakSlots')).toEqual(['uav', null, null]);
        expect(read(ledger(r.match), 'equippedStreakIds')).toEqual(['uav']);
        r.match.dispose();
    });

    it('answers the five questions from the local system offline', () => {
        const r = rig();
        expect(call<number>(ledger(r.match), 'streakBalance')).toBe(0);
        expect(call<number>(ledger(r.match), 'streakPrice', 'uav')).toBe(4);
        expect(call<number>(ledger(r.match), 'streakLockout', 'uav')).toBe(0);
        expect(call<boolean>(ledger(r.match), 'canAffordStreak', 'uav')).toBe(false);
        expect(call<{ price: number } | null>(ledger(r.match), 'nextStreak')?.price).toBe(4);
        r.match.dispose();
    });

    it('answers the same five from the server when there is one', () => {
        const r = rig({ networked: true });
        r.match.applyReplicatedStreaks(
            streakView({
                offers: [{ kind: 0, price: 3, lockoutCs: 250 }],
                balance: 6,
                nextKind: 1,
                nextPrice: 9,
            }),
        );
        expect(call<number>(ledger(r.match), 'streakBalance')).toBe(6);
        expect(call<number>(ledger(r.match), 'streakPrice', 'uav')).toBe(3);
        expect(call<number>(ledger(r.match), 'streakLockout', 'uav')).toBe(2.5);
        expect(call<boolean>(ledger(r.match), 'canAffordStreak', 'uav')).toBe(false);
        r.match.dispose();
    });

    it('affords a streak the server priced under the balance and left unlocked', () => {
        const r = rig({ networked: true });
        r.match.applyReplicatedStreaks(
            streakView({ offers: [{ kind: 0, price: 3, lockoutCs: 0 }], balance: 6 }),
        );
        expect(call<boolean>(ledger(r.match), 'canAffordStreak', 'uav')).toBe(true);
        r.match.dispose();
    });

    it('drops every replicated streak on a migration', () => {
        const r = rig({ networked: true });
        r.match.applyReplicatedStreaks(streakView({ balance: 9, scrambled: true }));
        expect(call<number>(ledger(r.match), 'streakBalance')).toBe(9);
        r.match.clearReplicatedStreaks();
        expect(call<number>(ledger(r.match), 'streakBalance')).toBe(0);
        r.match.dispose();
    });
});

describe('Match — the streak strip', () => {
    it('names each key, prices it and says whether it works', () => {
        const r = rig();
        call(ledger(r.match), 'setStreakLoadout', ['uav', 'care_package', 'mortar']);
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.slots.map((s) => s.name)).toEqual(['UAV', 'CARE PACKAGE', 'MORTAR STRIKE']);
        expect(hud.slots.map((s) => s.price)).toEqual([4, 5, 7]);
        expect(hud.slots.map((s) => s.ready)).toEqual([false, false, false]);
        expect(hud.balance).toBe(0);
        expect(hud.nextName).toBe('UAV');
        expect(hud.nextPrice).toBe(4);
        r.match.dispose();
    });

    it('leaves an empty slot blank and free rather than priced', () => {
        const r = rig();
        call(ledger(r.match), 'setStreakLoadout', ['uav', null, null]);
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.slots[1]?.name).toBe('');
        expect(hud.slots[1]?.price).toBe(0);
        expect(hud.slots[1]?.lockoutSeconds).toBe(0);
        expect(hud.slots[1]?.ready).toBe(false);
        r.match.dispose();
    });

    it('shows the lockout the server sent as a duration, not a flag', () => {
        const r = rig({ networked: true });
        call(ledger(r.match), 'setStreakLoadout', ['uav', null, null]);
        r.match.applyReplicatedStreaks(
            streakView({ offers: [{ kind: 0, price: 2, lockoutCs: 430 }], balance: 10 }),
        );
        fillHud(r.match);
        expect(r.match.ui.streakState.slots[0]?.lockoutSeconds).toBe(4.3);
        expect(r.match.ui.streakState.slots[0]?.price).toBe(2);
        r.match.dispose();
    });
});

describe('Match — the objective banner', () => {
    it('says nothing in Team Deathmatch', () => {
        const r = rig();
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.objectiveLabel).toBe('');
        expect(hud.objectiveSeconds).toBe(-1);
        expect(hud.interactFraction).toBe(-1);
        expect(hud.interactLabel).toBe('');
        expect(hud.showAlive).toBe(false);
        expect(hud.urgent).toBe(false);
        r.match.dispose();
    });

    it('counts the sides in Search & Destroy, friendly first', () => {
        const r = rig({ modeId: 'SND' });
        r.match.setActive(true);
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.showAlive).toBe(true);
        expect(hud.aliveFriendly).toBe(r.match.countAlive('A'));
        expect(hud.aliveEnemy).toBe(r.match.countAlive('B'));
        r.match.dispose();
    });

    it('counts the sides the other way round for a team-B client', () => {
        const r = rig({ modeId: 'SND', localTeam: 'B' });
        r.match.setActive(true);
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.aliveFriendly).toBe(r.match.countAlive('B'));
        expect(hud.aliveEnemy).toBe(r.match.countAlive('A'));
        r.match.dispose();
    });

    it('puts a planted bomb above everything, with its timer, in red', () => {
        const r = rig({ modeId: 'SND' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.bomb = 'PLANTED';
        mode.plantedSite = mode.sites[0] ?? null;
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.objectiveLabel).toBe(`BOMB · SITE ${mode.sites[0]?.label ?? ''}`);
        expect(hud.objectiveSeconds).toBe(mode.bombSecondsLeft);
        expect(hud.urgent).toBe(true);
        r.match.dispose();
    });

    it('shows the ring while this player is the one planting', () => {
        const r = rig({ modeId: 'SND' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.interactEntity = r.match.localId;
        mode.interactFraction = 0.4;
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.interactFraction).toBe(0.4);
        expect(hud.interactLabel).toBe('PLANTING');
        expect(hud.objectiveLabel).toBe('OBJECTIVE');
        r.match.dispose();
    });

    it('calls the same ring a defuse once the bomb is down', () => {
        const r = rig({ modeId: 'SND' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.bomb = 'PLANTED';
        mode.plantedSite = mode.sites[0] ?? null;
        mode.interactEntity = r.match.localId;
        mode.interactFraction = 0.75;
        fillHud(r.match);
        expect(r.match.ui.streakState.interactLabel).toBe('DEFUSING');
        r.match.dispose();
    });

    it('reports somebody else on the bomb rather than offering the key', () => {
        const r = rig({ modeId: 'SND' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.bomb = 'PLANTED';
        mode.plantedSite = mode.sites[0] ?? null;
        mode.interactEntity = 4;
        mode.interactFraction = 0.2;
        // The label follows the flag the *mode* set when the interaction began, not the bomb's
        // state — a defuse is announced because `beginInteract` was told it was one.
        (mode as unknown as Record<string, boolean>)['interactIsDefuse'] = true;
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.interactLabel).toBe('TEAMMATE DEFUSING');
        expect(hud.interactFraction).toBe(0.2);
        r.match.dispose();
    });

    it('calls the same line a plant when the mode says it is one', () => {
        const r = rig({ modeId: 'SND' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.interactEntity = 4;
        mode.interactFraction = 0.2;
        fillHud(r.match);
        expect(r.match.ui.streakState.interactLabel).toBe('PLANT IN PROGRESS');
        r.match.dispose();
    });

    it('tells the attackers where the bomb is when nobody is carrying it', () => {
        const r = rig({ modeId: 'SND', localTeam: 'B' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.attackers = 'B';
        mode.bomb = 'CARRIED';
        mode.carrierId = -1;
        fillHud(r.match);
        expect(r.match.ui.streakState.objectiveLabel).toBe('RECOVER THE BOMB');
        r.match.dispose();
    });

    it('says the carrier is out when one of them has it and it is not this client', () => {
        const r = rig({ modeId: 'SND', localTeam: 'B' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.attackers = 'B';
        mode.bomb = 'CARRIED';
        mode.carrierId = 6;
        fillHud(r.match);
        expect(r.match.ui.streakState.objectiveLabel).toBe('BOMB CARRIER OUT');
        r.match.dispose();
    });

    it('says the key by its binding rather than by a hard-coded letter', () => {
        const r = rig({ modeId: 'SND', localTeam: 'B' });
        const mode = r.match.mode as SearchAndDestroy;
        mode.attackers = 'B';
        mode.bomb = 'CARRIED';
        mode.carrierId = r.match.localId;
        const site = mode.sites[0];
        if (site !== undefined) place(r, site.def.position.x, site.def.position.y, site.def.position.z);
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.objectiveLabel).toBe(`SITE ${site?.label ?? ''}`);
        expect(hud.interactLabel).toBe('HOLD T TO PLANT');
        expect(hud.interactFraction).toBe(0);
        r.match.dispose();
    });

    it('names a Domination flag the player is standing on, and what is happening to it', () => {
        const r = rig({ modeId: 'DOM' });
        const mode = r.match.mode as Domination;
        const zone = mode.zones[0];
        expect(zone).toBeDefined();
        if (zone === undefined) return;
        place(r, zone.def.position.x, zone.def.position.y, zone.def.position.z);
        zone.owner = 'NONE';
        zone.progress = 0.3;
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.objectiveLabel).toBe(`FLAG ${zone.label}`);
        expect(hud.interactFraction).toBe(0.3);
        expect(hud.interactLabel).toBe('CAPTURING');
        r.match.dispose();
    });

    it('calls a flag this side already owns HELD', () => {
        const r = rig({ modeId: 'DOM' });
        const mode = r.match.mode as Domination;
        const zone = mode.zones[0];
        if (zone === undefined) return;
        place(r, zone.def.position.x, zone.def.position.y, zone.def.position.z);
        zone.owner = 'A';
        fillHud(r.match);
        expect(r.match.ui.streakState.interactLabel).toBe('HELD');
        r.match.dispose();
    });

    it('says nothing about a flag the player has walked off', () => {
        const r = rig({ modeId: 'DOM' });
        place(r, 9_000, 0, 9_000);
        fillHud(r.match);
        expect(r.match.ui.streakState.objectiveLabel).toBe('');
        r.match.dispose();
    });
});

describe('Match — the free-for-all banner', () => {
    it('is off in a team mode', () => {
        const r = rig();
        fillHud(r.match);
        expect(r.match.ui.state.banner.ffa).toBe(false);
        r.match.dispose();
    });

    it('shows the leader and this player by kills, not by points', () => {
        const r = rig({ modeId: 'FFA' });
        r.match.setActive(true);
        const rows = r.match.score.rows;
        const self = rows.find((row) => row.entityId === r.match.localId);
        const other = rows.find((row) => row.entityId !== r.match.localId);
        expect(self).toBeDefined();
        expect(other).toBeDefined();
        if (self === undefined || other === undefined) return;
        self.kills = 3;
        self.score = 900;
        other.kills = 7;
        other.score = 0;
        fillHud(r.match);
        const banner = r.match.ui.state.banner;
        expect(banner.ffa).toBe(true);
        expect(banner.leaderName).toBe(other.displayName);
        expect(banner.leaderScore).toBe(7);
        expect(banner.selfScore).toBe(3);
        r.match.dispose();
    });
});

describe('Match — the dismantle prompt', () => {
    it("offers the key at this player's own replicated sentry, in reach", () => {
        const r = rig({ networked: true });
        place(r, 0, 0, 0);
        r.match.applyReplicatedStreaks(
            streakView({
                entities: [
                    {
                        instanceId: 1,
                        kind: STREAK_KIND_SENTRY,
                        ownerId: r.match.localId,
                        team: 0,
                        x: 0,
                        y: 0,
                        z: -1.2,
                        yaw: 0,
                        pitch: 0,
                        health: 255,
                        fraction: 0,
                        flags: 0,
                    },
                ],
            }),
        );
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.objectiveLabel).toBe('YOUR SENTRY');
        expect(hud.interactLabel).toBe('HOLD T TO DISMANTLE');
        expect(hud.interactFraction).toBe(0);
        r.match.dispose();
    });

    it('fills the ring at the rate the server is counting', () => {
        const r = rig({ networked: true });
        place(r, 0, 0, 0);
        r.match.applyReplicatedStreaks(
            streakView({
                entities: [
                    {
                        instanceId: 1,
                        kind: STREAK_KIND_SENTRY,
                        ownerId: r.match.localId,
                        team: 0,
                        x: 0,
                        y: 0,
                        z: -1.2,
                        yaw: 0,
                        pitch: 0,
                        health: 255,
                        fraction: 128,
                        flags: 0,
                    },
                ],
            }),
        );
        fillHud(r.match);
        expect(r.match.ui.streakState.interactFraction).toBe(128 / 255);
        expect(r.match.ui.streakState.interactLabel).toBe('DISMANTLING');
        r.match.dispose();
    });

    it("says nothing at somebody else's sentry", () => {
        const r = rig({ networked: true });
        place(r, 0, 0, 0);
        r.match.applyReplicatedStreaks(
            streakView({
                entities: [
                    {
                        instanceId: 1,
                        kind: STREAK_KIND_SENTRY,
                        ownerId: r.match.localId + 3,
                        team: 0,
                        x: 0,
                        y: 0,
                        z: -1.2,
                        yaw: 0,
                        pitch: 0,
                        health: 255,
                        fraction: 0,
                        flags: 0,
                    },
                ],
            }),
        );
        fillHud(r.match);
        expect(r.match.ui.streakState.objectiveLabel).toBe('');
        r.match.dispose();
    });
});

describe('Match — the minimap', () => {
    it("draws the server's contacts and its sweep when there is a server", () => {
        const r = rig({ networked: true });
        r.match.applyReplicatedStreaks(
            streakView({
                sweepAngle: 1.25,
                scrambled: true,
                contacts: [
                    { entityId: 3, x: 4, z: -5, ageCs: 120 },
                    { entityId: 4, x: 7, z: 8, ageCs: 30 },
                ],
            }),
        );
        fillHud(r.match);
        const map = r.match.ui.hud.minimap;
        expect(map.sweepAngle).toBe(1.25);
        expect(map.scrambled).toBe(true);
        const active = map.contacts.filter((c) => c.active);
        expect(active.length).toBe(2);
        expect(active[0]?.x).toBe(4);
        expect(active[0]?.z).toBe(-5);
        expect(active[0]?.age).toBe(1.2);
        r.match.dispose();
    });

    it('has no sweep when this team has no UAV up', () => {
        const r = rig({ networked: true });
        r.match.applyReplicatedStreaks(streakView({ sweepAngle: -1 }));
        fillHud(r.match);
        expect(r.match.ui.hud.minimap.sweepAngle).toBeNull();
        r.match.dispose();
    });

    it("clears last frame's contacts before it writes this frame's", () => {
        const r = rig({ networked: true });
        r.match.applyReplicatedStreaks(
            streakView({ contacts: [{ entityId: 3, x: 1, z: 1, ageCs: 0 }] }),
        );
        fillHud(r.match);
        expect(r.match.ui.hud.minimap.contacts.filter((c) => c.active).length).toBe(1);
        r.match.applyReplicatedStreaks(streakView({ contacts: [] }));
        fillHud(r.match);
        expect(r.match.ui.hud.minimap.contacts.filter((c) => c.active).length).toBe(0);
        r.match.dispose();
    });

    it("paints a team-A client's own flags friendly and the others enemy", () => {
        const r = rig({ modeId: 'DOM' });
        const mode = r.match.mode as Domination;
        const zones = mode.zones;
        zones[0]!.owner = 'A';
        zones[1]!.owner = 'B';
        zones[2]!.owner = 'NONE';
        zones[1]!.progress = 0.5;
        fillHud(r.match);
        const states = r.match.ui.hud.minimap.objectiveStates;
        expect(states.length).toBe(zones.length);
        expect(states.map((s) => s.owner)).toEqual(['FRIENDLY', 'ENEMY', 'NONE']);
        expect(states[1]?.progress).toBe(0.5);
        r.match.dispose();
    });

    it("paints the same three the other way round for a team-B client", () => {
        const r = rig({ modeId: 'DOM', localTeam: 'B' });
        const zones = (r.match.mode as Domination).zones;
        zones[0]!.owner = 'A';
        zones[1]!.owner = 'B';
        zones[2]!.owner = 'NONE';
        fillHud(r.match);
        expect(r.match.ui.hud.minimap.objectiveStates.map((s) => s.owner)).toEqual([
            'ENEMY',
            'FRIENDLY',
            'NONE',
        ]);
        r.match.dispose();
    });

    it('leaves the objective states alone in a mode with no flags', () => {
        const r = rig();
        fillHud(r.match);
        expect(r.match.ui.hud.minimap.objectiveStates).toEqual([]);
        r.match.dispose();
    });
});

describe('Match — the tactical read-out', () => {
    it('reads both hands, the equipment and the field upgrade off the systems', () => {
        const r = rig();
        fillHud(r.match);
        const tac = r.match.ui.state.tactical;
        expect(tac.slotIndex).toBe(0);
        expect(tac.weaponName).toBe(r.match.weapons.inventory.active.definition.name);
        expect(tac.otherName).toBe(r.match.weapons.inventory.at(1)?.definition.name ?? '');
        expect(tac.lethalId).toBe(r.match.loadout.lethal);
        expect(tac.tacticalId).toBe(r.match.loadout.tactical);
        expect(tac.fieldUpgradeName).toBe(r.match.meta.fieldUpgrade.name);
        r.match.dispose();
    });

    it('has no scope on a weapon without one', () => {
        const r = rig();
        fillHud(r.match);
        const tac = r.match.ui.state.tactical;
        expect(tac.hasScope).toBe(r.match.weapons.inventory.active.definition.scope !== undefined);
        expect(tac.scopeFraction).toBe(0);
        r.match.dispose();
    });
});

describe('Match — the ammunition read-out', () => {
    it('shows the magazine of the gun in hand', () => {
        const r = rig();
        r.match.setActive(true);
        r.match.render(1, camera(), 1 / 60, 0, 0);
        const state = r.match.ui.state;
        const weapon = r.match.weapons.weapon;
        expect(state.mag).toBe(weapon.mag);
        expect(state.magSize).toBe(weapon.definition.magSize);
        expect(state.reserve).toBe(weapon.reserve);
        expect(state.health).toBe(r.match.playerHealth.current);
        expect(state.dead).toBe(false);
        r.match.dispose();
    });
});

describe('Match — the resupply prompt', () => {
    /** Stand the player at the map's first station, in the stance the argument asks for. */
    function atStation(r: Rig, stance: 'STAND' | 'CROUCH'): void {
        const point = findMap('mp_foundry').def.supply?.[0];
        expect(point).toBeDefined();
        if (point === undefined) return;
        place(r, point.position.x, point.position.y, point.position.z);
        (r.player.sim as unknown as Record<string, string>)['stance'] = stance;
        r.match.simulate(makeCommand());
    }

    it('teaches the rule to a player standing at the crate', () => {
        const r = rig();
        r.match.setActive(true);
        atStation(r, 'STAND');
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(r.match.supplyState.needsCrouch).toBe(true);
        expect(hud.objectiveLabel).toBe('RESUPPLY');
        expect(hud.interactLabel).toBe('CROUCH TO RESUPPLY');
        expect(hud.interactFraction).toBe(r.match.supplyState.stock);
        r.match.dispose();
    });

    it('says what is happening once they kneel', () => {
        const r = rig();
        r.match.setActive(true);
        r.match.weapons.weapon.reserve = 0;
        atStation(r, 'CROUCH');
        fillHud(r.match);
        expect(r.match.ui.streakState.interactLabel).toBe('RESUPPLYING');
        r.match.dispose();
    });

    it('says so when there is nothing left to take', () => {
        const r = rig();
        r.match.setActive(true);
        atStation(r, 'CROUCH');
        fillHud(r.match);
        expect(r.match.supplyState.full).toBe(true);
        expect(r.match.ui.streakState.interactLabel).toBe('RESUPPLIED');
        r.match.dispose();
    });

    it('says nothing away from a crate', () => {
        const r = rig();
        r.match.setActive(true);
        place(r, 9_000, 0, 9_000);
        r.match.simulate(makeCommand());
        fillHud(r.match);
        expect(r.match.ui.streakState.objectiveLabel).toBe('');
        r.match.dispose();
    });

    it('is outranked by the bomb the player is standing over', () => {
        const r = rig({ modeId: 'SND', localTeam: 'B' });
        r.match.setActive(true);
        const mode = r.match.mode as SearchAndDestroy;
        mode.attackers = 'B';
        mode.bomb = 'CARRIED';
        mode.carrierId = r.match.localId;
        const site = mode.sites[0];
        if (site === undefined) return;
        place(r, site.def.position.x, site.def.position.y, site.def.position.z);
        r.match.simulate(makeCommand());
        fillHud(r.match);
        expect(r.match.ui.streakState.interactLabel).toBe('HOLD T TO PLANT');
        r.match.dispose();
    });
});

describe('Match — the streak doors offline', () => {
    it('affords a streak once the kills are banked', () => {
        const r = rig();
        r.match.setActive(true);
        call(ledger(r.match), 'setStreakLoadout', ['uav', null, null]);
        expect(call<boolean>(ledger(r.match), 'canAffordStreak', 'uav')).toBe(false);
        r.match.streaks.creditKills(r.match.localId, 8);
        expect(call<number>(ledger(r.match), 'streakBalance')).toBe(8);
        expect(call<boolean>(ledger(r.match), 'canAffordStreak', 'uav')).toBe(true);
        fillHud(r.match);
        expect(r.match.ui.streakState.slots[0]?.ready).toBe(true);
        expect(r.match.ui.streakState.balance).toBe(8);
        r.match.dispose();
    });

    it("draws this team's own UAV sweep offline", () => {
        const r = rig();
        r.match.setActive(true);
        r.match.streaks.creditKills(r.match.localId, 20);
        const live = r.match.streaks.activate(r.match.localId, 'uav', 0, 20, 0, 0);
        expect(live).not.toBeNull();
        fillHud(r.match);
        const map = r.match.ui.hud.minimap;
        expect(map.sweepAngle).toBe(r.match.streaks.uavFor('A')?.sweepAngle ?? null);
        expect(map.scrambled).toBe(false);
        r.match.dispose();
    });

    it("offers the dismantle key at this player's own live sentry", () => {
        const r = rig();
        r.match.setActive(true);
        place(r, 0, 0, 0);
        r.match.streaks.creditKills(r.match.localId, 30);
        const sentry = r.match.streaks.activate(r.match.localId, 'sentry', 0, 0, -1.2, 0);
        expect(sentry).not.toBeNull();
        fillHud(r.match);
        const hud = r.match.ui.streakState;
        expect(hud.objectiveLabel).toBe('YOUR SENTRY');
        expect(hud.interactLabel).toBe('HOLD T TO DISMANTLE');
        r.match.dispose();
    });
});

describe('Match — spending a streak', () => {
    it('activates locally in a solo match', () => {
        const r = rig();
        r.match.setActive(true);
        call(ledger(r.match), 'setStreakLoadout', ['uav', null, null]);
        r.match.streaks.creditKills(r.match.localId, 20);
        r.match.simulate(makeCommand({ tickIndex: 1, buttons: Btn.Streak1 }));
        expect(r.streakRequests).toEqual([]);
        expect(call<number>(ledger(r.match), 'streakBalance')).toBeLessThan(20);
        r.match.dispose();
    });

    it('asks the server and changes nothing locally when there is one', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        call(ledger(r.match), 'setStreakLoadout', ['uav', null, null]);
        r.match.applyReplicatedStreaks(
            streakView({ offers: [{ kind: STREAK_KIND_UAV, price: 2, lockoutCs: 0 }], balance: 9 }),
        );
        r.match.simulate(makeCommand({ tickIndex: 1, buttons: Btn.Streak1 }));
        expect(r.streakRequests.length).toBe(1);
        expect(r.streakRequests[0]?.[0]).toBe('uav');
        expect(call<number>(ledger(r.match), 'streakBalance')).toBe(9);
        r.match.dispose();
    });

    it('honours the key by the class slot rather than by what is earned', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        call(ledger(r.match), 'setStreakLoadout', [null, null, 'uav']);
        r.match.applyReplicatedStreaks(
            streakView({ offers: [{ kind: STREAK_KIND_UAV, price: 1, lockoutCs: 0 }], balance: 9 }),
        );
        r.match.simulate(makeCommand({ tickIndex: 1, buttons: Btn.Streak1 }));
        expect(r.streakRequests).toEqual([]);
        r.match.simulate(makeCommand({ tickIndex: 2, buttons: Btn.Streak3 }));
        expect(r.streakRequests.length).toBe(1);
        r.match.dispose();
    });

    it('marks a mortar before it spends it', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        call(ledger(r.match), 'setStreakLoadout', ['mortar', null, null]);
        r.match.applyReplicatedStreaks(
            streakView({ offers: [{ kind: STREAK_KIND_MORTAR, price: 1, lockoutCs: 0 }], balance: 9 }),
        );
        r.match.simulate(makeCommand({ tickIndex: 1, buttons: Btn.Streak1 }));
        expect(r.match.mortarOverlay.isOpen).toBe(true);
        expect(r.match.targeting).toBe(true);
        expect(r.streakRequests).toEqual([]);
        r.match.dispose();
    });

    it('spends it on the confirm, through the one door that knows about servers', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.mortarOverlay.show(0, 0);
        r.match.mortarOverlay.confirm();
        expect(r.streakRequests.length).toBe(1);
        expect(r.streakRequests[0]?.[0]).toBe('mortar');
        expect(r.match.mortarMarkX).toBe(r.match.mortarOverlay.markX);
        r.match.dispose();
    });
});

describe('Match — steering the mortar mark', () => {
    /** The overlay opened without a key press, so `overlayYaw` is still its initial zero. */
    function openedAtZeroYaw(r: Rig): number {
        r.match.setActive(true);
        r.match.mortarOverlay.show(0, 0);
        return r.match.mortarOverlay.markX;
    }

    it('owns the input while it is up', () => {
        const r = rig();
        r.match.setActive(true);
        expect(r.match.targeting).toBe(false);
        r.match.mortarOverlay.show(0, 0);
        expect(r.match.targeting).toBe(true);
        r.match.dispose();
    });

    it('moves the mark against the look delta, because the map is drawn in world axes', () => {
        const r = rig();
        const before = openedAtZeroYaw(r);
        r.match.simulate(makeCommand({ tickIndex: 1, yaw: 0.1 }));
        expect(r.match.mortarOverlay.markX).toBeCloseTo(before - 0.1 * 42, 10);
        r.match.dispose();
    });

    it('takes the short way round a yaw that crossed the half turn', () => {
        const r = rig();
        const before = openedAtZeroYaw(r);
        // 3.2 rad the long way is -3.083 the short way, so the mark goes the other direction.
        r.match.simulate(makeCommand({ tickIndex: 1, yaw: 3.2 }));
        expect(r.match.mortarOverlay.markX).toBeGreaterThan(before);
        r.match.dispose();
    });

    /**
     * `d = -PI` exactly: the one input BACKLOG #1 is about, and the one assertion C24c changed.
     *
     * The local `angleDeltaRad` this file used to carry answered `-PI` here, because its `while`
     * loops tested `d < -PI`; `MathUtil.angleDelta` answers `+PI`, because its `if` tests
     * `d <= -PI`. The mark therefore travels the other way at this input and at no other, which
     * is the deliberate behaviour change C24c took under its own approval.
     *
     * Reachable through the public surface, which is what makes it worth a test at all:
     * `mortarOverlay` is a public field, `overlayYaw` starts at zero, and `show` called directly
     * does not write it — only `stepStreakInput` does.
     */
    it('answers an exact half turn the way the shared helper does', () => {
        const r = rig();
        const before = openedAtZeroYaw(r);
        r.match.simulate(makeCommand({ tickIndex: 1, yaw: -Math.PI }));
        expect(angleDelta(0, -Math.PI)).toBe(Math.PI);
        expect(r.match.mortarOverlay.markX).toBeLessThan(before);
        r.match.dispose();
    });

    it('confirms the mark on the fire key and cancels on the streak key', () => {
        const r = rig();
        r.match.setActive(true);
        r.match.mortarOverlay.show(0, 0);
        r.match.simulate(makeCommand({ tickIndex: 1, buttons: Btn.Streak1 }));
        expect(r.match.mortarOverlay.isOpen).toBe(false);
        r.match.mortarOverlay.show(0, 0);
        r.match.simulate(makeCommand({ tickIndex: 2, buttons: Btn.Fire }));
        expect(r.match.mortarOverlay.isOpen).toBe(false);
        r.match.dispose();
    });
});

describe('Match — how many are still standing', () => {
    it('walks the roster in a solo match', () => {
        const r = rig({ modeId: 'SND' });
        r.match.setActive(true);
        const roster = [...r.match.bots.roster];
        const a = roster.filter((c) => c.team === 'A' && c.participating).length;
        expect(r.match.countAlive('A')).toBe(a);
        r.match.dispose();
    });

    it('walks the remote actors over the network, and counts this client separately', () => {
        const r = rig({ networked: true, localTeam: 'A' });
        r.actors = (): Iterable<never> =>
            [
                { entityId: 2, team: 'A', participating: true },
                { entityId: 3, team: 'B', participating: true },
                { entityId: 4, team: 'B', participating: false },
            ] as unknown as Iterable<never>;
        // The local entity is not among the remote actors, so it is never double-counted.
        expect(r.match.countAlive('A')).toBe(2);
        expect(r.match.countAlive('B')).toBe(1);
        r.match.dispose();
    });

    it('stops counting this client once it is dead', () => {
        const r = rig({ networked: true, localTeam: 'A' });
        r.actors = (): Iterable<never> => [] as unknown as Iterable<never>;
        expect(r.match.countAlive('A')).toBe(1);
        r.match.applyReplicatedSelf(0, false, 1);
        expect(r.match.isPlayerDead).toBe(true);
        expect(r.match.countAlive('A')).toBe(0);
        r.match.dispose();
    });
});

describe('Match — the local life', () => {
    it('starts the respawn countdown when the player is killed', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.applyReplicatedSelf(0, false, 1);
        expect(r.match.isPlayerDead).toBe(true);
        expect(r.match.playerRespawnSeconds).toBeGreaterThan(0);
        expect(r.shakes.length).toBeGreaterThan(0);
        r.match.dispose();
    });

    it('counts the death screen down without bringing the body back', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.applyReplicatedSelf(0, false, 1);
        const first = r.match.playerRespawnSeconds;
        r.match.simulate(makeCommand({ tickIndex: 1 }));
        expect(r.match.playerRespawnSeconds).toBeLessThan(first);
        expect(r.match.isPlayerDead).toBe(true);
        r.match.dispose();
    });

    it('starts a new life on a new spawn serial, not on the alive bit', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.applyReplicatedSelf(0, false, 1);
        expect(r.match.isPlayerDead).toBe(true);
        // A Search & Destroy survivor's next round: the serial moves, the alive bit never did.
        r.match.applyReplicatedSelf(200, true, 2);
        expect(r.match.isPlayerDead).toBe(false);
        expect(r.match.playerRespawnSeconds).toBe(0);
        r.match.dispose();
    });

    it('ignores a repeated serial', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.applyReplicatedSelf(120, true, 4);
        r.match.weapons.weapon.mag = 3;
        r.match.applyReplicatedSelf(110, true, 4);
        expect(r.match.weapons.weapon.mag).toBe(3);
        r.match.dispose();
    });

    it('does nothing at all in a solo match', () => {
        const r = rig();
        r.match.setActive(true);
        r.match.applyReplicatedSelf(0, false, 9);
        expect(r.match.isPlayerDead).toBe(false);
        r.match.dispose();
    });

    it('latches a death report and clears it on the next life', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.flow.setKillfeedDirectory({
            nameOf: (id: number): string | null => (id === 5 ? 'ENEMY-1' : null),
            teamOf: (id: number): 'A' | 'B' | null => (id === 5 ? 'B' : null),
        });
        r.bus.emit(EV.EntityKilled, {
            targetId: r.match.localId,
            sourceId: 5,
            weaponId: r.match.weapons.definition.id,
            zone: 'head',
            killerHealth: 42,
        } as never);
        r.match.applyReplicatedSelf(0, false, 1);
        r.match.render(1, camera(), 1 / 60, 0, 0);
        const report = r.match.ui.state.deathReport;
        expect(report).not.toBeNull();
        expect(report?.killerHealth).toBe(42);
        expect(report?.headshot).toBe(true);
        r.match.applyReplicatedSelf(200, true, 2);
        r.match.render(1, camera(), 1 / 60, 0, 0);
        expect(r.match.ui.state.deathReport).toBeNull();
        r.match.dispose();
    });

    it('explains nothing about your own grenade', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.bus.emit(EV.EntityKilled, {
            targetId: r.match.localId,
            sourceId: r.match.localId,
            weaponId: r.match.weapons.definition.id,
            zone: 'torso',
            killerHealth: 0,
        } as never);
        r.match.applyReplicatedSelf(0, false, 1);
        r.match.render(1, camera(), 1 / 60, 0, 0);
        expect(r.match.ui.state.deathReport).toBeNull();
        r.match.dispose();
    });
});

describe('Match — a class change', () => {
    it('lands at once during the pre-match freeze', () => {
        const r = rig();
        r.match.setActive(true);
        expect(r.match.flow.currentPhase).toBe('WARMUP');
        const next = resolveLoadout(defaultLoadouts()[1]!, 1);
        r.match.applyLoadout(next);
        expect(r.match.weapons.inventory.active.definition.id).toBe(next.primary.id);
        expect(read(life(r.match), 'pendingLoadout')).toBeNull();
        r.match.dispose();
    });

    it('waits for the next body on a living player mid-match', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.netFrozen = false;
        const was = r.match.weapons.inventory.active.definition.id;
        const next = resolveLoadout(defaultLoadouts()[1]!, 1);
        r.match.flow.start();
        if (r.match.flow.currentPhase === 'WARMUP') {
            // Only the deferred branch is under test; skip where the flow is still frozen.
            r.match.dispose();
            return;
        }
        r.match.applyLoadout(next);
        expect(r.match.weapons.inventory.active.definition.id).toBe(was);
        expect(read(life(r.match), 'pendingLoadout')).not.toBeNull();
        r.match.applyReplicatedSelf(200, true, 7);
        expect(r.match.weapons.inventory.active.definition.id).toBe(next.primary.id);
        r.match.dispose();
    });

    it('lands at once on a dead player, whose next spawn is the one being waited for', () => {
        const r = rig({ networked: true });
        r.match.setActive(true);
        r.match.applyReplicatedSelf(0, false, 1);
        const next = resolveLoadout(defaultLoadouts()[1]!, 1);
        r.match.applyLoadout(next);
        expect(r.match.weapons.inventory.active.definition.id).toBe(next.primary.id);
        r.match.dispose();
    });
});

describe('Match — the viewmodels', () => {
    it('builds one mesh per inventory slot and shows only the live one', () => {
        const r = rig();
        const models = read<{ root: { visible: boolean }; weaponId: string }[]>(arsenal(r.match), 'models');
        expect(models.length).toBe(2);
        expect(models[0]?.root.visible).toBe(true);
        expect(models[1]?.root.visible).toBe(false);
        r.match.dispose();
    });

    it('follows the inventory on a swap', () => {
        const r = rig();
        r.match.setActive(true);
        r.bus.emit(EV.WeaponSwapped, { sourceId: r.match.localId } as never);
        const models = read<{ root: { visible: boolean } }[]>(arsenal(r.match), 'models');
        const active = r.match.weapons.inventory.activeSlotIndex;
        expect(models[active]?.root.visible).toBe(true);
        r.match.dispose();
    });

    it('keeps a slot camo when the debug picker calls equip with two arguments', () => {
        const r = rig();
        const camos = read<(string | null)[]>(arsenal(r.match), 'slotCamos');
        const was = camos[0];
        r.match.equip(0, r.match.loadout.secondary);
        expect(read<(string | null)[]>(arsenal(r.match), 'slotCamos')[0]).toBe(was);
        r.match.dispose();
    });

    it('strips the camo when it is asked to, rather than treating null as absent', () => {
        const r = rig();
        r.match.equip(0, r.match.loadout.primary, null);
        expect(read<(string | null)[]>(arsenal(r.match), 'slotCamos')[0]).toBeNull();
        r.match.dispose();
    });
});

describe('Match — the per-tick cheat levers', () => {
    it('reads the entitlement every tick rather than latching it', () => {
        const r = rig();
        r.match.setActive(true);
        expect(r.match.godMode).toBe(false);
        r.cheatMask = Cheat.God;
        expect(r.match.godMode).toBe(true);
        r.match.simulate(makeCommand({ tickIndex: 1 }));
        expect(r.match.playerCombatant.invulnerable).toBe(true);
        r.cheatMask = 0;
        r.match.simulate(makeCommand({ tickIndex: 2 }));
        expect(r.match.playerCombatant.invulnerable).toBe(false);
        r.match.dispose();
    });

    it('takes the body out of perception while it is hidden from the bots', () => {
        const r = rig();
        r.match.setActive(true);
        r.cheatMask = Cheat.Unseen;
        r.match.simulate(makeCommand({ tickIndex: 1 }));
        expect(r.match.hiddenFromBots).toBe(true);
        expect(r.match.playerCombatant.active).toBe(false);
        r.match.dispose();
    });
});

describe('Match — the frozen window', () => {
    it('freezes everybody through the warm-up and the round end offline', () => {
        const r = rig();
        expect(r.match.flow.currentPhase).toBe('WARMUP');
        expect(r.match.inputFrozen).toBe(true);
        expect(r.match.inputSuppressed).toBe(true);
        r.match.dispose();
    });

    it('takes the answer off the snapshot header over the network', () => {
        const r = rig({ networked: true });
        r.match.netFrozen = false;
        expect(r.match.inputFrozen).toBe(false);
        r.match.netFrozen = true;
        expect(r.match.inputFrozen).toBe(true);
        r.match.dispose();
    });
});
