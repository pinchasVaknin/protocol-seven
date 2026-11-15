import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameBus, EV } from '../shared/core/Events';
import { hashModeState, makeModeStateScratch, modeStateFacts } from '../shared/debug/ModeStateHash';
import { Btn, type InputCommand } from '../shared/core/InputCommand';
import { installLogSink, type LogLevel } from '../shared/core/Log';
import { findMap, findMode } from '../shared/modes/ModeRegistry';
import { KillConfirmed } from '../shared/modes/KillConfirmed';
import { SearchAndDestroy } from '../shared/modes/SearchAndDestroy';
import { Tdm } from '../shared/modes/Tdm';
import { DEFAULT_MOVEMENT_CONFIG } from '../shared/player/MovementConfig';
import { PlayerController } from '../shared/player/PlayerController';
import { STREAK_DEFS } from '../shared/streaks/StreakDefs';
import { AR_DEFAULT, heldMoveScale, PISTOL_DEFAULT } from '../shared/weapons/WeaponDefs';
import { VotePhase, WARMUP_MATCH_ID } from '../shared/net/Skirmish';
import type { ObjectiveState } from '../shared/net/Skirmish';
import type { WelcomeInfo } from '../shared/net/Messages';
import type { ProceduralTextures } from './engine/ProceduralTextures';
import type { LoadedMap } from './world/MapRender';
import { Particulate } from './world/Particulate';
import { MatchWorld, type MatchWorldDeps, type NetworkedMatchOptions } from './MatchWorld';

/**
  * Characterization tests for the per-match world (refactor unit C22, written before the
  * refactor and green on the unmodified file).
  *
  * **What is real here and why.** The thing under test is a constructor: its whole job is to
  * build five collaborators in one order, hang nine replication channels off the session and
  * take all of it apart again in the exact mirror. So the three collaborators whose *identity*
  * the assertions are about — the map, the player and the scene — are real: a real `THREE.Scene`,
  * the real `loadMap` (which `MapRender.test.ts` already proves builds every shipped map in node
  * off a two-method texture stub), the real `PlayerController`, the real `Particulate`, the real
  * `DivergenceChecker` and the real event bus.
  *
  * `ClientMatch`, `DebugSuite`, `BotHarness` and `NetSession` are doubles. Each of them needs a
  * renderer, an audio graph or a socket, and none of them is what this file does: what this file
  * does is *decide what they are handed* and *when*. A double records that, which is the property
  * under test, and a real one would only move the test into the browser — where the unit's own
  * BROWSER check already drives the whole thing against a live dedicated server.
  *
  * `PropModels` is doubled for one reason only: the station model is a network fetch.
  */

// ---------------------------------------------------------------------------- the doubles

interface Recorded {
    readonly what: string;
    readonly args: readonly unknown[];
}

interface MatchDouble {
    readonly deps: Record<string, unknown>;
    mode: unknown;
    range: { dummies: { health: { setConfig: (cfg: unknown) => void }; markLabelDirty: () => void }[] } | null;
    isPlayerDead: boolean;
    inputSuppressed: boolean;
    targeting: boolean;
    readonly flow: Record<string, unknown>;
    readonly score: Record<string, unknown>;
    readonly weapons: Record<string, unknown>;
    readonly playerHealth: Record<string, unknown>;
    readonly bots: Record<string, unknown>;
}

interface SessionDouble {
    readonly deps: Record<string, unknown>;
    lastVote: { phase: number } | null;
    onMatchState: ((state: unknown) => void) | null;
    onLocalState: ((health: number, alive: boolean, serial: number) => void) | null;
    onObjectives: ((states: readonly ObjectiveState[]) => void) | null;
    onTags: ((tags: readonly unknown[]) => void) | null;
    onBomb: ((info: unknown) => void) | null;
    onStreaks: ((view: unknown) => void) | null;
    onProjectiles: ((projectiles: unknown, smoke: unknown) => void) | null;
    onAuthoritativeState: ((header: unknown) => void) | null;
    onStateHash: ((tick: number, hash: number, sections: readonly number[]) => void) | null;
    onScoreboard: ((rows: readonly unknown[]) => void) | null;
}

interface HarnessDouble {
    readonly options: unknown;
    readonly match: unknown;
}

const reg = vi.hoisted(() => ({
    calls: [] as Recorded[],
    matches: [] as MatchDouble[],
    sessions: [] as SessionDouble[],
    debugs: [] as { deps: Record<string, unknown> }[],
    harnesses: [] as HarnessDouble[],
    props: [] as { stationWanted: boolean }[],
    reset(): void {
        this.calls.length = 0;
        this.matches.length = 0;
        this.sessions.length = 0;
        this.debugs.length = 0;
        this.harnesses.length = 0;
        this.props.length = 0;
    },
    note(what: string, ...args: unknown[]): void {
        this.calls.push({ what, args });
    },
    what(): string[] {
        return this.calls.map((c) => c.what);
    },
}));

vi.mock('./ClientMatch', () => {
    class Match {
        readonly deps: Record<string, unknown>;
        mode: unknown = { objectiveZones: [], dogTags: null, bombInfo: null };
        range: unknown = null;
        isPlayerDead = false;
        inputSuppressed = false;
        targeting = false;
        readonly flow = {
            applyReplicated: (state: unknown): void => reg.note('flow.applyReplicated', state),
            setKillfeedDirectory: (dir: unknown): void => reg.note('flow.setKillfeedDirectory', dir),
            teamScore: (): number => 0,
            round: 1,
            currentPhase: 'LIVE',
        };
        readonly score = {
            applyReplicated: (rows: unknown): void => reg.note('score.applyReplicated', rows),
        };
        readonly weapons = {
            definition: null as unknown,
            setDefinition: (def: unknown): void => reg.note('weapons.setDefinition', def),
        };
        readonly playerHealth = {
            setConfig: (cfg: unknown): void => reg.note('playerHealth.setConfig', cfg),
        };
        readonly bots = {
            applyHealthConfig: (cfg: unknown): void => reg.note('bots.applyHealthConfig', cfg),
        };

        constructor(deps: Record<string, unknown>) {
            this.deps = deps;
            reg.note('new Match');
            reg.matches.push(this as unknown as MatchDouble);
        }

        applyReplicatedSelf(health: number, alive: boolean, serial: number): void {
            reg.note('match.applyReplicatedSelf', health, alive, serial);
        }

        applyReplicatedStreaks(view: unknown): void {
            reg.note('match.applyReplicatedStreaks', view);
        }

        applyReplicatedProjectiles(projectiles: unknown, smoke: unknown): void {
            reg.note('match.applyReplicatedProjectiles', projectiles, smoke);
        }

        simulate(cmd: unknown): void {
            reg.note('match.simulate', cmd);
        }

        dispose(): void {
            reg.note('match.dispose');
        }
    }
    return { Match };
});

vi.mock('./net/NetSession', () => {
    class NetSession {
        readonly deps: Record<string, unknown>;
        lastVote: { phase: number } | null = null;
        onMatchState: unknown = null;
        onLocalState: unknown = null;
        onObjectives: unknown = null;
        onTags: unknown = null;
        onBomb: unknown = null;
        onStreaks: unknown = null;
        onProjectiles: unknown = null;
        onAuthoritativeState: unknown = null;
        onStateHash: unknown = null;
        onScoreboard: unknown = null;
        readonly client = {
            sendStreak: (kind: number, x: number, z: number): void => reg.note('client.sendStreak', kind, x, z),
        };

        constructor(deps: Record<string, unknown>) {
            this.deps = deps;
            reg.note('new NetSession');
            reg.sessions.push(this as unknown as SessionDouble);
        }

        get welcome(): unknown {
            return this.deps['welcome'];
        }

        start(): void {
            reg.note('net.start');
        }

        detach(): void {
            reg.note('net.detach');
        }

        disconnect(reason: string): void {
            reg.note('net.disconnect', reason);
        }

        renderables(): Iterable<unknown> {
            return [];
        }

        roundBlockers(): readonly unknown[] {
            return [];
        }

        directory(): unknown {
            return 'the-directory';
        }
    }
    return { NetSession };
});

vi.mock('./debug/DebugSuite', () => {
    class DebugSuite {
        constructor(readonly deps: Record<string, unknown>) {
            reg.note('new DebugSuite');
            reg.debugs.push(this as { deps: Record<string, unknown> });
        }

        dispose(): void {
            reg.note('debug.dispose');
        }
    }
    return { DebugSuite };
});

vi.mock('./debug/BotHarness', () => {
    class BotHarness {
        constructor(
            readonly options: unknown,
            readonly match: unknown,
            readonly loop: unknown,
            readonly stats: unknown,
        ) {
            reg.note('new BotHarness');
            reg.harnesses.push(this as HarnessDouble);
        }

        start(): void {
            reg.note('harness.start');
        }

        stop(): void {
            reg.note('harness.stop');
        }
    }
    return { BotHarness };
});

vi.mock('./world/PropModels', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./world/PropModels')>();
    class PropModels {
        constructor() {
            reg.props.push({ stationWanted: false });
        }

        preloadStation(): Promise<void> {
            reg.note('props.preloadStation');
            const mine = reg.props[reg.props.length - 1];
            if (mine !== undefined) mine.stationWanted = true;
            return Promise.resolve();
        }

        addStations(root: unknown, def: unknown): number {
            reg.note('props.addStations', root, def);
            return 2;
        }

        dispose(): void {
            reg.note('props.dispose');
        }
    }
    return { ...actual, PropModels };
});

// ---------------------------------------------------------------------------- the rig

/** The two things `loadMap` reads off the texture factory. Taken from `MapRender.test.ts`. */
const textures = {
    get: (): { worldScale: number; texture: null } => ({ worldScale: 2, texture: null }),
    anisotropy: 4,
} as unknown as ProceduralTextures;

const logLines: string[] = [];

interface Sampled {
    readonly kind: 'neutral' | 'spectating' | 'live';
    readonly tick: number;
    readonly buttons: number;
}

const sampled: Sampled[] = [];
const viewSet: number[][] = [];

function command(kind: Sampled['kind'], tick: number, buttons: number): InputCommand {
    sampled.push({ kind, tick, buttons });
    return { tickIndex: tick, buttons } as unknown as InputCommand;
}

/**
  * `CollisionWorld.skin` is TS-private and is what `configure` writes, so the only way to see
  * that the config reached the world is to read it the way the console does.
  */
function collisionSkinOf(world: unknown): number {
    return (world as { skin: number }).skin;
}

const input = {
    setView: (yaw: number, pitch: number): void => {
        viewSet.push([yaw, pitch]);
    },
    sampleNeutral: (tick: number): InputCommand => command('neutral', tick, 0),
    sampleSpectating: (tick: number): InputCommand => command('spectating', tick, 0),
    sample: (tick: number, _nowMs: number, buttons: number): InputCommand => command('live', tick, buttons),
};

function welcomeFor(matchId: number, mapId = 'mp_foundry'): WelcomeInfo {
    return {
        entityId: 7,
        team: 'B',
        mapId,
        modeId: 'TDM',
        serverTick: 120,
        serverMs: 2_000,
        snapshotHz: 20,
        matchId,
        effectiveTick: 121,
        migrated: false,
    };
}

interface Rig {
    readonly deps: MatchWorldDeps;
    readonly scene: THREE.Scene;
    readonly ended: number[];
}

function makeDeps(
    options: {
        mapId?: string;
        server?: NetworkedMatchOptions | null;
        inMatch?: () => boolean;
        callsign?: string;
    } = {},
): Rig {
    const scene = new THREE.Scene();
    const ended: number[] = [];
    const deps = {
        bus: createGameBus(),
        scene,
        renderer: {} as unknown,
        textures,
        characterAvatarProvider: {} as unknown,
        weaponAssets: null,
        viewmodel: {} as unknown,
        cameraRig: {} as unknown,
        audio: {} as unknown,
        input: input as unknown,
        loop: { id: 'loop' } as unknown,
        uiHost: { id: 'uiHost' } as unknown,
        debugHost: { id: 'debugHost' } as unknown,
        stats: { id: 'stats' } as unknown,
        speedo: {} as unknown,
        matchHarness: {} as unknown,
        profile: {
            settings: { shadowQuality: 'medium', callsign: options.callsign ?? 'TESTER' },
        } as unknown,

        movementConfig: { ...DEFAULT_MOVEMENT_CONFIG },
        cameraConfig: {} as unknown,
        viewmodelConfig: {} as unknown,
        healthConfig: { max: 200, regenDelay: 5, regenRate: 40 },
        equipmentConfig: {} as unknown,
        weaponDef: AR_DEFAULT,
        secondaryDef: PISTOL_DEFAULT,
        playerBaseDef: AR_DEFAULT,
        tiers: {} as unknown,
        perceptionConfig: {} as unknown,
        schedulerConfig: {} as unknown,

        mapEntry: findMap(options.mapId ?? 'mp_foundry'),
        transport: {} as unknown,
        modeEntry: findMode('TDM'),
        difficulty: 'MIX',
        loadout: { id: 'loadout' } as unknown,

        onMatchEnded: (): void => {
            ended.push(1);
        },
        onConfigChanged: (): void => reg.note('onConfigChanged'),
        onWeaponConfigChanged: (): void => reg.note('onWeaponConfigChanged'),
        inMatch: options.inMatch ?? ((): boolean => true),
        cheats: (): number => 0b1010,
        requestCheat: (bits: number): void => reg.note('requestCheat', bits),
        lastBuild: (): null => null,
        buildProgress: (): null => null,
        migrationWindows: (): readonly never[] => [],
        server: options.server ?? null,
    } as unknown as MatchWorldDeps;
    return { deps, scene, ended };
}

function serverOptions(over: Partial<NetworkedMatchOptions> = {}): NetworkedMatchOptions {
    return {
        link: { id: 'link' } as unknown,
        welcome: welcomeFor(4),
        receivedAtMs: 1_234,
        displayName: 'SERVER-NAME',
        wantRewindDebug: true,
        onNewMatch: (): void => reg.note('onNewMatch'),
        ...over,
    } as unknown as NetworkedMatchOptions;
}

/** A `LoadedMap` that was never built, for the adoption path and the empty-spawn case. */
function fakeMap(mapId: string, spawns: readonly unknown[] | null = null): LoadedMap {
    const def = findMap(mapId).def;
    const root = new THREE.Group();
    root.name = 'adopted-root';
    return {
        def,
        root,
        collision: {
            configure: (slope: number, skin: number): void => reg.note('collision.configure', slope, skin),
        } as unknown,
        spawns: spawns ?? [{ position: { x: 1, y: 2, z: 3 }, facingYaw: 0.5 }],
        navBounds: {} as unknown,
        stats: {} as unknown,
        dispose: (): void => reg.note('map.dispose'),
    } as unknown as LoadedMap;
}

function worldWith(rig: Rig): MatchWorld {
    return new MatchWorld(rig.deps);
}

beforeEach(() => {
    reg.reset();
    sampled.length = 0;
    viewSet.length = 0;
    logLines.length = 0;
    installLogSink({
        log(level: LogLevel, tag: string, message: string): void {
            logLines.push(`${level} [${tag}] ${message}`);
        },
    });
});

afterEach(() => {
    installLogSink({ log(): void { /* the console sink is not wanted between files */ } });
});

// ---------------------------------------------------------------------------- the tests

describe('MatchWorld, single-player', () => {
    it('builds the map, adds its root to the scene and applies the map ambient', () => {
        const rig = makeDeps();
        const world = worldWith(rig);

        expect(world.map.def.id).toBe('mp_foundry');
        expect(rig.scene.children).toContain(world.map.root);
        expect(rig.scene.fog).not.toBeNull();
        expect(rig.scene.background).not.toBeNull();
    });

    it('configures the collision world from the movement config', () => {
        const rig = makeDeps();
        const world = worldWith(rig);

        expect(collisionSkinOf(world.map.collision)).toBe(DEFAULT_MOVEMENT_CONFIG.collisionSkin);
    });

    it('spawns the player in the first spawn zone and points the view down its yaw', () => {
        const rig = makeDeps();
        const world = worldWith(rig);
        const spawn = world.map.spawns[0];

        expect(world.player).toBeInstanceOf(PlayerController);
        expect(world.player.sim.x).toBe(spawn?.position.x);
        expect(world.player.sim.z).toBe(spawn?.position.z);
        expect(world.player.sim.yaw).toBe(spawn?.facingYaw);
        expect(viewSet).toEqual([[spawn?.facingYaw, 0]]);
    });

    it('throws when the map has no spawn zones', () => {
        const rig = makeDeps({
            server: serverOptions({ prebuiltMap: fakeMap('mp_foundry', []) }),
        });

        expect(() => worldWith(rig)).toThrow('Map has no spawn zones');
    });

    it('hangs no particulate on a map that authors none', () => {
        const world = worldWith(makeDeps({ mapId: 'mp_foundry' }));

        expect(world.map.def.particulate).toBeUndefined();
        expect(world.particulate).toBeNull();
    });

    it('hangs the particulate on the map root, not on the scene, when the map authors one', () => {
        const rig = makeDeps({ mapId: 'mp_depot' });
        const world = worldWith(rig);

        expect(world.particulate).toBeInstanceOf(Particulate);
        expect(world.map.root.children).toContain(world.particulate?.points);
        expect(rig.scene.children).not.toContain(world.particulate?.points);
    });

    it('asks for the station model on a map that places one, and mounts it when it lands', async () => {
        const world = worldWith(makeDeps({ mapId: 'mp_foundry' }));
        expect(world.map.def.props.some((prop) => prop.shape === 'ammoCrate')).toBe(true);
        expect(reg.what()).toContain('props.preloadStation');

        await Promise.resolve();
        await Promise.resolve();
        expect(reg.what()).toContain('props.addStations');
    });

    it('asks for nothing on a map that places no station', () => {
        const world = worldWith(makeDeps({ mapId: 'mp_testbed' }));

        expect(world.map.def.props.some((prop) => prop.shape === 'ammoCrate')).toBe(false);
        expect(reg.what()).not.toContain('props.preloadStation');
    });

    it('leaves the session null and tells the match it is not networked', () => {
        const world = worldWith(makeDeps());
        const match = reg.matches[0];

        expect(world.net).toBeNull();
        expect(reg.sessions).toHaveLength(0);
        expect(match?.deps['networked']).toBe(false);
        expect(match?.deps['actors']).toBeUndefined();
        expect(match?.deps['roundBlockers']).toBeUndefined();
        expect(match?.deps['onStreakRequest']).toBeUndefined();
        expect(match?.deps['localTeam']).toBeUndefined();
        expect(match?.deps['warmupArena']).toBe(false);
    });

    it("names the local player from the profile callsign, through the join's own sanitiser", () => {
        // The sanitiser trims and caps; it does not change case. Pinned as it is.
        worldWith(makeDeps({ callsign: '  rook  ' }));

        expect(reg.matches[0]?.deps['localName']).toBe('rook');
    });

    it('falls back to OPERATOR when the callsign is empty, as the join does', () => {
        worldWith(makeDeps({ callsign: '' }));

        expect(reg.matches[0]?.deps['localName']).toBe('OPERATOR');
    });

    it('hands the match the fixed AI seed, the mode and the map it was built for', () => {
        const rig = makeDeps();
        const world = worldWith(rig);
        const match = reg.matches[0];

        expect(match?.deps['seed']).toBe(0x0fe7_a105);
        expect(match?.deps['map']).toBe(rig.deps.mapEntry);
        expect(match?.deps['mode']).toBe(rig.deps.modeEntry);
        expect(match?.deps['banksProgress']).toBe(rig.deps.modeEntry.banksProgress);
        expect(match?.deps['world']).toBe(world.map.collision);
        expect(match?.deps['player']).toBe(world.player);
        expect(match?.deps['identity']).toBe((world as unknown as Record<string, unknown>)['identity']);
        expect(match?.deps['cheats']).toBe(rig.deps.cheats);
    });

    it('reports a closed ballot with no session', () => {
        worldWith(makeDeps());
        const ballotOpen = reg.matches[0]?.deps['ballotOpen'] as () => boolean;

        expect(ballotOpen()).toBe(false);
    });

    it('builds the debug suite over this world, with the instrumentation Game owns', () => {
        const rig = makeDeps();
        const world = worldWith(rig);
        const debug = reg.debugs[0];

        expect(world.debug).toBe(debug);
        expect(debug?.deps['match']).toBe(world.match);
        expect(debug?.deps['map']).toBe(world.map);
        expect(debug?.deps['player']).toBe(world.player);
        expect(debug?.deps['divergence']).toBe(world.divergence);
        expect(debug?.deps['host']).toBe(rig.deps.debugHost);
        expect(debug?.deps['lastBuild']).toBe(rig.deps.lastBuild);
        expect(debug?.deps['buildProgress']).toBe(rig.deps.buildProgress);
        expect(debug?.deps['migrationWindows']).toBe(rig.deps.migrationWindows);
        expect((debug?.deps['netSession'] as () => unknown)()).toBe(world.net);
    });

    it('builds the five collaborators in one order: map, player, session, match, debug suite', () => {
        worldWith(makeDeps({ server: serverOptions() }));

        expect(reg.what().filter((w) => w.startsWith('new '))).toEqual([
            'new NetSession',
            'new Match',
            'new DebugSuite',
        ]);
    });

    it('tells Game the match ended, once, when the bus says so', () => {
        const rig = makeDeps();
        worldWith(rig);

        rig.deps.bus.emit(EV.MatchEnded, { reason: 'test' } as never);

        expect(rig.ended).toHaveLength(1);
    });
});

describe('MatchWorld, the background build (M11 §6.5)', () => {
    it('adopts a prebuilt map that is the map this world needs', () => {
        const prebuilt = fakeMap('mp_foundry');
        const world = worldWith(makeDeps({ server: serverOptions({ prebuiltMap: prebuilt }) }));

        expect(world.map).toBe(prebuilt);
        expect(world.map.root.name).toBe('adopted-root');
    });

    it('builds its own map when the prebuilt one is for another map', () => {
        const prebuilt = fakeMap('mp_depot');
        const rig = makeDeps({ mapId: 'mp_foundry', server: serverOptions({ prebuiltMap: prebuilt }) });
        const world = worldWith(rig);

        expect(world.map).not.toBe(prebuilt);
        expect(world.map.def.id).toBe('mp_foundry');
        expect(rig.scene.children).toContain(world.map.root);
    });

    it('builds its own map when the server handed none', () => {
        const world = worldWith(makeDeps({ server: serverOptions({ prebuiltMap: null }) }));

        expect(world.map.root.name).not.toBe('adopted-root');
    });
});

describe('MatchWorld, networked', () => {
    function networked(over: Partial<NetworkedMatchOptions> = {}): {
        world: MatchWorld;
        rig: Rig;
        net: SessionDouble;
        match: MatchDouble;
    } {
        const rig = makeDeps({ server: serverOptions(over) });
        const world = worldWith(rig);
        return {
            world,
            rig,
            net: reg.sessions[0] as SessionDouble,
            match: reg.matches[0] as MatchDouble,
        };
    }

    it('builds the session from the handshake, before the match', () => {
        const token = new Uint8Array([9, 9]);
        const { net } = networked({ reconnectToken: token, skinIndex: 3, pending: [new Uint8Array([1])] });

        expect(net.deps['link']).toEqual({ id: 'link' });
        expect(net.deps['receivedAtMs']).toBe(1_234);
        expect(net.deps['displayName']).toBe('SERVER-NAME');
        expect(net.deps['wantRewindDebug']).toBe(true);
        expect(net.deps['reconnectToken']).toBe(token);
        expect(net.deps['skinIndex']).toBe(3);
        expect((net.deps['pending'] as readonly Uint8Array[])[0]).toEqual(new Uint8Array([1]));
        expect((net.deps['healthMax'] as () => number)()).toBe(200);
    });

    it("points the session's three per-tick callbacks back at this world", () => {
        const { world, net, match } = networked();
        match.isPlayerDead = false;
        match.inputSuppressed = false;
        match.targeting = false;
        match.weapons['definition'] = AR_DEFAULT;

        const sample = net.deps['sample'] as (tick: number) => InputCommand;
        const applyWeapon = net.deps['applyWeapon'] as (cmd: InputCommand) => void;
        const moveScale = net.deps['moveScale'] as (cmd: InputCommand) => number;
        const cmd = { tick: 5, buttons: 0 } as unknown as InputCommand;

        expect(sample(11).tickIndex).toBe(11);
        applyWeapon(cmd);
        expect(reg.what()).toContain('match.simulate');
        expect(moveScale(cmd)).toBe(heldMoveScale(AR_DEFAULT, 0));
        expect(world.net).toBe(net as unknown as MatchWorld['net']);
    });

    it('hangs all ten replication channels, sets the killfeed directory and starts the socket', () => {
        const { net } = networked();

        for (const channel of [
            'onMatchState',
            'onLocalState',
            'onObjectives',
            'onTags',
            'onBomb',
            'onStreaks',
            'onProjectiles',
            'onAuthoritativeState',
            'onStateHash',
            'onScoreboard',
        ] as const) {
            expect(typeof net[channel]).toBe('function');
        }
        expect(reg.calls.find((c) => c.what === 'flow.setKillfeedDirectory')?.args[0]).toBe('the-directory');
        expect(reg.what()).toContain('net.start');
        expect(logLines.some((l) => l.startsWith('info [world] world built for TDM on mp_foundry'))).toBe(true);
    });

    it('takes the local name and team from the seat the server gave, not from the profile', () => {
        const { match } = networked();

        expect(match.deps['localName']).toBe('SERVER-NAME');
        expect(match.deps['localTeam']).toBe('B');
        expect(match.deps['networked']).toBe(true);
        expect(typeof match.deps['actors']).toBe('function');
        expect(typeof match.deps['roundBlockers']).toBe('function');
        expect(typeof match.deps['onStreakRequest']).toBe('function');
    });

    it('is the warmup arena only for the arena instance id', () => {
        const arena = networked({ welcome: welcomeFor(WARMUP_MATCH_ID) });
        expect(arena.match.deps['warmupArena']).toBe(true);

        reg.reset();
        const live = networked({ welcome: welcomeFor(WARMUP_MATCH_ID + 1) });
        expect(live.match.deps['warmupArena']).toBe(false);
    });

    it('calls the ballot open during the two vote phases and closed otherwise', () => {
        const { net, match } = networked();
        const ballotOpen = match.deps['ballotOpen'] as () => boolean;

        expect(ballotOpen()).toBe(false);
        net.lastVote = { phase: VotePhase.MODE_VOTE };
        expect(ballotOpen()).toBe(true);
        net.lastVote = { phase: VotePhase.MAP_VOTE };
        expect(ballotOpen()).toBe(true);
        net.lastVote = { phase: VotePhase.IDLE };
        expect(ballotOpen()).toBe(false);
    });

    it('spends a streak by sending its index in the shared table', () => {
        const { match } = networked();
        const request = match.deps['onStreakRequest'] as (id: string, x: number, z: number) => void;

        for (const [index, def] of STREAK_DEFS.entries()) {
            request(def.id, index, -index);
            expect(reg.calls.filter((c) => c.what === 'client.sendStreak').pop()?.args).toEqual([
                index,
                index,
                -index,
            ]);
        }
    });

    it('sends index 0 for a streak id the table does not know', () => {
        const { match } = networked();
        const request = match.deps['onStreakRequest'] as (id: string, x: number, z: number) => void;

        request('not_a_streak', 1, 2);

        expect(reg.calls.filter((c) => c.what === 'client.sendStreak').pop()?.args).toEqual([0, 1, 2]);
    });

    it('feeds the match state and this seat state straight through', () => {
        const { net } = networked();

        net.onMatchState?.({ phase: 2 });
        net.onLocalState?.(55, false, 9);

        expect(reg.calls.find((c) => c.what === 'flow.applyReplicated')?.args[0]).toEqual({ phase: 2 });
        expect(reg.calls.find((c) => c.what === 'match.applyReplicatedSelf')?.args).toEqual([55, false, 9]);
    });

    it('writes the replicated objective state into the zones the renderer walks', () => {
        const { net, match } = networked();
        const zones = [
            { owner: 'NONE', capturingTeam: 'NONE', progress: 0, countA: 0, countB: 0 },
            { owner: 'NONE', capturingTeam: 'NONE', progress: 0, countA: 0, countB: 0 },
        ];
        match.mode = { objectiveZones: zones };

        net.onObjectives?.([
            { owner: 1, capturing: 2, progress: 51, countA: 3, countB: 4 },
            { owner: 2, capturing: 0, progress: 255, countA: 0, countB: 1 },
        ]);

        expect(zones[0]).toEqual({ owner: 'A', capturingTeam: 'B', progress: 51 / 255, countA: 3, countB: 4 });
        expect(zones[1]).toEqual({ owner: 'B', capturingTeam: 'NONE', progress: 1, countA: 0, countB: 1 });
    });

    it('writes nothing and warns when the server and the map disagree about the zone count', () => {
        const { net, match } = networked();
        const zones = [{ owner: 'NONE', capturingTeam: 'NONE', progress: 0, countA: 0, countB: 0 }];
        match.mode = { objectiveZones: zones };

        net.onObjectives?.([
            { owner: 1, capturing: 0, progress: 10, countA: 1, countB: 0 },
            { owner: 1, capturing: 0, progress: 10, countA: 1, countB: 0 },
        ]);

        expect(zones[0]?.owner).toBe('NONE');
        expect(
            logLines.some(
                (l) =>
                    l.startsWith('warn [world] objective count mismatch: server sent 2, this map has 1.') &&
                    l.includes('Client and server disagree about the map.'),
            ),
        ).toBe(true);
    });

    it('gives the dog tags to Kill Confirmed and to nothing else', () => {
        const { net, match } = networked();
        const kc = Object.create(KillConfirmed.prototype) as KillConfirmed & {
            applyReplicatedTags: (tags: unknown) => void;
        };
        kc.applyReplicatedTags = (tags: unknown): void => reg.note('kc.applyReplicatedTags', tags);
        match.mode = kc;
        net.onTags?.([{ id: 1 }]);
        expect(reg.what()).toContain('kc.applyReplicatedTags');

        match.mode = Object.create(Tdm.prototype) as Tdm;
        expect(() => net.onTags?.([{ id: 2 }])).not.toThrow();
        expect(reg.calls.filter((c) => c.what === 'kc.applyReplicatedTags')).toHaveLength(1);
    });

    it('gives the bomb to Search & Destroy and to nothing else', () => {
        const { net, match } = networked();
        const snd = Object.create(SearchAndDestroy.prototype) as SearchAndDestroy & {
            applyReplicatedBomb: (info: unknown) => void;
        };
        snd.applyReplicatedBomb = (info: unknown): void => reg.note('snd.applyReplicatedBomb', info);
        match.mode = snd;
        net.onBomb?.({ state: 'CARRIED' });
        expect(reg.what()).toContain('snd.applyReplicatedBomb');

        match.mode = Object.create(Tdm.prototype) as Tdm;
        expect(() => net.onBomb?.({ state: 'PLANTED' })).not.toThrow();
        expect(reg.calls.filter((c) => c.what === 'snd.applyReplicatedBomb')).toHaveLength(1);
    });

    it('passes the streaks, the projectiles and the scoreboard through unfiltered', () => {
        const { net } = networked();

        net.onStreaks?.({ active: 1 });
        net.onProjectiles?.([{ id: 1 }], [{ id: 2 }]);
        net.onScoreboard?.([{ entityId: 3 }]);

        expect(reg.calls.find((c) => c.what === 'match.applyReplicatedStreaks')?.args[0]).toEqual({ active: 1 });
        expect(reg.calls.find((c) => c.what === 'match.applyReplicatedProjectiles')?.args).toEqual([
            [{ id: 1 }],
            [{ id: 2 }],
        ]);
        expect(reg.calls.find((c) => c.what === 'score.applyReplicated')?.args[0]).toEqual([{ entityId: 3 }]);
    });

    it('samples the authoritative header into the divergence checker', () => {
        const { world, net } = networked();

        net.onAuthoritativeState?.({ tick: 10, scoreA: 0, scoreB: 0, round: 1, phase: 0 });

        expect(world.divergence.samples).toBe(1);
    });

    it("answers the state hash with the client's own, through the shared facts function", () => {
        const { world, net, match } = networked();
        const mode = { objectiveZones: [], dogTags: null, bombInfo: null };
        match.mode = mode;
        const flow = match.flow as unknown as Parameters<typeof modeStateFacts>[1];
        const mine = hashModeState(modeStateFacts(mode as never, flow, makeModeStateScratch()));

        // The server agreeing: samples climb, nothing is recorded.
        for (let i = 0; i < 5; i++) net.onStateHash?.(30 + i, mine, [0, 0, 0, 0]);
        expect(world.divergence.hashSamples).toBe(5);
        expect(world.divergence.records).toHaveLength(0);

        // A hash this client cannot have produced, four snapshots running: one confirmed record.
        for (let i = 0; i < 4; i++) net.onStateHash?.(40 + i, mine ^ 0x5555, [1, 2, 3, 4]);
        expect(world.divergence.hashSamples).toBe(9);
        expect(world.divergence.records).toHaveLength(1);
        expect(world.divergence.records[0]?.field).toBe('modeStateHash');
        expect(world.divergence.records[0]?.client).toBe(mine);
    });
});

describe('MatchWorld, the command this client sends', () => {
    it('sends nothing but a neutral command while a front-end screen owns the page', () => {
        const world = worldWith(makeDeps({ inMatch: () => false }));

        world.sampleCommand(3);

        expect(sampled).toEqual([{ kind: 'neutral', tick: 3, buttons: 0 }]);
    });

    it('sends view angles only when the player is dead', () => {
        const world = worldWith(makeDeps());
        (reg.matches[0] as MatchDouble).isPlayerDead = true;

        world.sampleCommand(4);

        expect(sampled).toEqual([{ kind: 'spectating', tick: 4, buttons: 0 }]);
    });

    it('sends view angles only while input is suppressed', () => {
        const world = worldWith(makeDeps());
        (reg.matches[0] as MatchDouble).inputSuppressed = true;

        world.sampleCommand(5);

        expect(sampled).toEqual([{ kind: 'spectating', tick: 5, buttons: 0 }]);
    });

    it('sends the real command otherwise, and tells the server when the mortar map is up', () => {
        const world = worldWith(makeDeps());
        const match = reg.matches[0] as MatchDouble;

        world.sampleCommand(6);
        match.targeting = true;
        world.sampleCommand(7);

        expect(sampled).toEqual([
            { kind: 'live', tick: 6, buttons: 0 },
            { kind: 'live', tick: 7, buttons: Btn.Targeting },
        ]);
    });

    it('asks the weapon in the hands how fast the body may move', () => {
        const world = worldWith(makeDeps());
        const match = reg.matches[0] as MatchDouble;
        match.weapons['definition'] = AR_DEFAULT;

        const firing = { tick: 1, buttons: Btn.Fire } as unknown as InputCommand;
        const idle = { tick: 1, buttons: 0 } as unknown as InputCommand;

        expect(world.weaponMoveScale(idle)).toBe(heldMoveScale(AR_DEFAULT, 0));
        expect(world.weaponMoveScale(firing)).toBe(heldMoveScale(AR_DEFAULT, Btn.Fire));
    });
});

describe('MatchWorld, the live retune and the AFK harness', () => {
    it('pushes the movement config into the player and the collision world', () => {
        const rig = makeDeps();
        const world = worldWith(rig);
        rig.deps.movementConfig.collisionSkin = 0.02;
        rig.deps.movementConfig.maxSlopeDeg = 55;

        world.applyMovementConfig();

        expect(collisionSkinOf(world.map.collision)).toBe(0.02);
        expect((world.player as unknown as Record<string, unknown>)['cfg']).toBe(rig.deps.movementConfig);
    });

    it('pushes the weapon and health numbers at the player, the dummies and the bots', () => {
        const rig = makeDeps();
        const world = worldWith(rig);
        const match = reg.matches[0] as MatchDouble;
        const dummy = {
            health: { setConfig: (cfg: unknown): void => reg.note('dummy.health.setConfig', cfg) },
            markLabelDirty: (): void => reg.note('dummy.markLabelDirty'),
        };
        match.range = { dummies: [dummy] };

        world.applyWeaponConfig();

        expect(reg.what()).toEqual(
            expect.arrayContaining([
                'weapons.setDefinition',
                'playerHealth.setConfig',
                'dummy.health.setConfig',
                'dummy.markLabelDirty',
                'bots.applyHealthConfig',
            ]),
        );
        expect(reg.calls.find((c) => c.what === 'weapons.setDefinition')?.args[0]).toBe(rig.deps.weaponDef);
    });

    it('retunes with no shooting range on the map', () => {
        const world = worldWith(makeDeps());

        expect(() => world.applyWeaponConfig()).not.toThrow();
        expect(reg.what()).toContain('bots.applyHealthConfig');
    });

    it('attaches and starts the AFK bot-match driver, and hands it back', () => {
        const world = worldWith(makeDeps());

        expect(world.botHarness).toBeNull();
        const harness = world.startBotHarness({ kills: 3 } as never);

        expect(world.botHarness).toBe(harness);
        expect(reg.harnesses[0]?.match).toBe(world.match);
        expect(reg.what()).toContain('harness.start');
    });
});

describe('MatchWorld.dispose', () => {
    it('is the mirror of the constructor: scene cleared, everything disposed', () => {
        const rig = makeDeps({ mapId: 'mp_depot' });
        const world = worldWith(rig);
        const particulate = world.particulate;

        world.dispose();

        expect(rig.scene.children).not.toContain(world.map.root);
        expect(rig.scene.fog).toBeNull();
        expect(rig.scene.background).toBeNull();
        expect(reg.what()).toEqual(
            expect.arrayContaining(['debug.dispose', 'match.dispose', 'props.dispose']),
        );
        expect(particulate).not.toBeNull();
    });

    it('disposes the debug tooling before the match it holds a reference to', () => {
        const world = worldWith(makeDeps());
        world.dispose();

        const order = reg.what();
        expect(order.indexOf('debug.dispose')).toBeLessThan(order.indexOf('match.dispose'));
    });

    it('stops the match-ended subscription', () => {
        const rig = makeDeps();
        const world = worldWith(rig);

        world.dispose();
        rig.deps.bus.emit(EV.MatchEnded, { reason: 'after teardown' } as never);

        expect(rig.ended).toHaveLength(0);
    });

    it('stops and forgets the bot harness', () => {
        const world = worldWith(makeDeps());
        world.startBotHarness({ kills: 1 } as never);

        world.dispose();

        expect(reg.what()).toContain('harness.stop');
        expect(world.botHarness).toBeNull();
    });

    it('closes the socket when the player left the match', () => {
        const rig = makeDeps({ server: serverOptions() });
        worldWith(rig).dispose();

        expect(reg.calls.find((c) => c.what === 'net.disconnect')?.args).toEqual(['left the match']);
        expect(reg.what()).not.toContain('net.detach');
    });

    it('keeps the socket for a map rotation', () => {
        const rig = makeDeps({ server: serverOptions() });
        worldWith(rig).dispose({ keepConnection: true });

        expect(reg.what()).toContain('net.detach');
        expect(reg.what()).not.toContain('net.disconnect');
    });

    it('takes a single-player world apart with no session at all', () => {
        const world = worldWith(makeDeps());

        expect(() => world.dispose()).not.toThrow();
        expect(reg.what()).not.toContain('net.disconnect');
    });
});
