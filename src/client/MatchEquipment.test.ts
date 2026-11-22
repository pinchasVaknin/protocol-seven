import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGameBus } from '../shared/core/Events';
import { PEFlag, type ProjectileState } from '../shared/net/Skirmish';
import { MatchEquipment } from './MatchEquipment';
import { installFakeDom, type FakeDom } from './ui/testing/dom';

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 345 lines of hand-grown double. It is the same double -- the file it
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

const LOCAL = 7;

function spy(): Record<string, unknown> {
    return new Proxy({}, { get: () => () => undefined }) as Record<string, unknown>;
}

interface Rig {
    readonly equipment: MatchEquipment;
    readonly scene: THREE.Scene;
}

function rig(): Rig {
    const scene = new THREE.Scene();
    const equipment = new MatchEquipment({
        bus: createGameBus(),
        scene,
        world: spy() as never,
        damage: spy() as never,
        bots: spy() as never,
        audio: spy() as never,
        cameraRig: { camera: new THREE.PerspectiveCamera(), shake: { add: (): void => undefined } } as never,
        hud: spy() as never,
        cfg: {} as never,
        tiers: {} as never,
        localTeam: 'A' as never,
        localId: LOCAL,
        seed: 1234,
        freeForAll: false,
    });
    return { equipment, scene };
}

function state(over: Partial<ProjectileState> = {}): ProjectileState {
    return { serial: 1, kind: 0, ownerId: 99, x: 1, y: 2, z: 3, yaw: 0.5, flags: 0, ...over };
}

/** Every live replicated grenade in the pool. */
function replicated(r: Rig): { serial: number; tx: number; ty: number; tz: number; yaw: number; resting: boolean; phase: string }[] {
    const pool = (r.equipment.system as unknown as { projectiles: { items: Record<string, unknown>[] } }).projectiles;
    return pool.items
        .filter((p) => p['active'] === true && p['replicated'] === true)
        .map((p) => ({
            serial: p['serial'] as number,
            tx: p['tx'] as number,
            ty: p['ty'] as number,
            tz: p['tz'] as number,
            yaw: p['yaw'] as number,
            resting: p['resting'] as boolean,
            phase: p['phase'] as string,
        }));
}

// ---------------------------------------------------------------------------- the pool

describe('what it builds', () => {
    it('starts with nothing replicated in the pool', () => {
        expect(replicated(rig())).toEqual([]);
    });

    it('puts its own objects in the scene', () => {
        const r = rig();
        expect(r.scene.children.length).toBeGreaterThan(0);
    });

    it('survives a simulate with nothing happening', () => {
        const r = rig();
        expect(() => r.equipment.simulate({} as never, { x: 0, y: 0, z: 0, eyeHeight: 1.6 } as never, true)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------- adoption

describe('adopting the server\u2019s grenades', () => {
    it('takes one it has not seen before', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial)).toEqual([5]);
    });

    /** Predicted, already in this pool and already on screen: the authoritative copy is the double. */
    it('skips the local player\u2019s own', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, ownerId: LOCAL })], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    it('takes several at once, keyed by serial', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 1 }), state({ serial: 2 }), state({ serial: 3 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    });

    it('adopts a serial once, however many snapshots name it', () => {
        const r = rig();
        for (let i = 0; i < 10; i++) r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        expect(replicated(r)).toHaveLength(1);
    });

    it('ignores a kind the equipment table does not have', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, kind: 999 })], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    /**
     * The *target*, not the drawn position: `easeReplicated` closes the gap over the frames
     * until the next snapshot, so a grenade crosses the room rather than stepping across it
     * twenty times a second.
     */
    it('writes the snapshot into the target rather than the drawn position', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, x: 10, y: 11, z: 12 })], [], LOCAL);
        const [p] = replicated(r);
        expect([p!.tx, p!.ty, p!.tz]).toEqual([10, 11, 12]);
    });

    it('follows a grenade as the server moves it', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, x: 0 })], [], LOCAL);
        r.equipment.applyReplicated([state({ serial: 5, x: 9 })], [], LOCAL);
        expect(replicated(r)[0]!.tx).toBe(9);
        expect(replicated(r)).toHaveLength(1);
    });

    it('carries the spin', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, yaw: 1.25 })], [], LOCAL);
        expect(replicated(r)[0]!.yaw).toBe(1.25);
    });
});

// ---------------------------------------------------------------------------- the flags

describe('the flags on the wire', () => {
    it('reads the resting bit', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: 0 })], [], LOCAL);
        expect(replicated(r)[0]!.resting).toBe(false);
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Resting })], [], LOCAL);
        expect(replicated(r)[0]!.resting).toBe(true);
    });

    it('reads the armed bit as the phase', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: 0 })], [], LOCAL);
        expect(replicated(r)[0]!.phase).toBe('LIVE');
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Armed })], [], LOCAL);
        expect(replicated(r)[0]!.phase).toBe('ARMED');
    });

    it('reads both at once', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Resting | PEFlag.Armed })], [], LOCAL);
        expect(replicated(r)[0]).toMatchObject({ resting: true, phase: 'ARMED' });
    });

    it('ignores a bit it does not read', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5, flags: PEFlag.Stuck })], [], LOCAL);
        expect(replicated(r)[0]).toMatchObject({ resting: false, phase: 'LIVE' });
    });
});

// ---------------------------------------------------------------------------- release

describe('letting go of what stopped being sent', () => {
    /** The bang arrives as `EV.EquipmentExploded`; this only has to stop drawing the body. */
    it('releases a grenade the server no longer lists', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        expect(replicated(r)).toHaveLength(1);
        r.equipment.applyReplicated([], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    it('releases only the ones that went', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 1 }), state({ serial: 2 })], [], LOCAL);
        r.equipment.applyReplicated([state({ serial: 2 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial)).toEqual([2]);
    });

    it('releases everything for an empty snapshot', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 1 }), state({ serial: 2 }), state({ serial: 3 })], [], LOCAL);
        r.equipment.applyReplicated([], [], LOCAL);
        expect(replicated(r)).toEqual([]);
    });

    it('can take a serial back after releasing it', () => {
        const r = rig();
        r.equipment.applyReplicated([state({ serial: 5 })], [], LOCAL);
        r.equipment.applyReplicated([], [], LOCAL);
        r.equipment.applyReplicated([state({ serial: 5, x: 50 })], [], LOCAL);
        expect(replicated(r).map((p) => p.serial)).toEqual([5]);
        expect(replicated(r)[0]!.tx).toBe(50);
    });

    it('is safe with nothing to do at all', () => {
        const r = rig();
        expect(() => r.equipment.applyReplicated([], [], LOCAL)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------- teardown

describe('disposal', () => {
    it('takes its objects out of the scene', () => {
        const r = rig();
        r.equipment.dispose();
        expect(r.scene.children).toHaveLength(0);
    });

    it('is safe twice', () => {
        const r = rig();
        r.equipment.dispose();
        r.equipment.dispose();
        expect(r.scene.children).toHaveLength(0);
    });
});
