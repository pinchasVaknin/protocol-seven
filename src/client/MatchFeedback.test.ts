import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGameBus, EV, type GameBus } from '../shared/core/Events';
import { flamethrowerWeapon, minigunWeapon } from '../shared/streaks/StreakWeapons';
import { MIX } from './engine/AudioMix';
import { MatchFeedback, type BodyPose } from './MatchFeedback';
import { viewport } from './ui/Viewport';

/**
 * Characterization tests for the shot-presentation layer (refactor unit C21, written before
 * the refactor).
 *
 * ## Why this file is worth more than its line count
 *
 * Every handler here asks *"was that me?"*, and the file's own header records what happened
 * when they all asked it wrongly (M10): the events arrived, the subscriptions fired, and each
 * handler returned one line in. No hitmarker, no damage numbers, no hurt vignette, no hit
 * chevron, no camera shake, no own-weapon mix, no death hand-off — and **none of it failed
 * loudly**. There was no test that would have caught it, and there is one now: every
 * subscription below is exercised from both sides of that question.
 *
 * ## It needs no DOM and no renderer
 *
 * The one thing that reaches the document is the window size, and `viewport` has a public
 * setter. Everything else is a dependency, so the whole surface is a bus, a camera and a
 * recorder; nothing here is doubled that the product does not already treat as replaceable.
 */

// ---------------------------------------------------------------------------- the rig

/** Every call the feedback layer made, in order, as `name(args)`. */
type Calls = string[];

interface Rig {
    readonly feedback: MatchFeedback;
    readonly bus: GameBus;
    readonly camera: THREE.PerspectiveCamera;
    readonly calls: Calls;
    /** Bodies this client knows about, by entity id. */
    readonly bodies: Map<number, BodyPose>;
    readonly killed: number[];
    /** What `hud.damageNumbersEnabled` answers. */
    numbersOn: boolean;
    /** What `input.takeFirePress()` answers. */
    firePress: number;
}

/**
 * The two streak weapons, built once so they are catalogued.
 *
 * `anyWeaponDef` answers from `WEAPON_DEFS` *or* the registry the streak factories fill, and
 * the factory is the one place a streak weapon is built. Calling them here is what the match
 * does when a streak is used -- without it the ids below are genuinely unknown.
 */
const FLAMETHROWER = flamethrowerWeapon().id;
const MINIGUN = minigunWeapon().id;

/** The local player is entity 7 throughout: never 0, which is the whole point of M10. */
const LOCAL = 7;
/** A body this client has been told about. */
const OTHER = 9;
/** An entity this client has heard of but has no body for — a shooter not yet in a snapshot. */
const UNSEEN = 11;

function round(v: unknown): unknown {
    return typeof v === 'number' ? Number(v.toFixed(4)) : v;
}

function recorder(calls: Calls, name: string): Record<string, unknown> {
    return new Proxy(
        {},
        {
            get:
                (_t, key) =>
                (...args: unknown[]): undefined => {
                    calls.push(`${name}.${String(key)}(${args.map((a) => String(round(a))).join(', ')})`);
                    return undefined;
                },
        },
    ) as Record<string, unknown>;
}

function rig(): Rig {
    // No DOM: the one window read has a public setter, and a fixed size makes the projected
    // damage-number coordinates exact rather than environmental.
    viewport.set(1920, 1080);
    const calls: Calls = [];
    const bodies = new Map<number, BodyPose>([[OTHER, { x: 10, y: 0, z: 10, eyeHeight: 1.6 }]]);
    const killed: number[] = [];
    const bus = createGameBus();
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld();

    const state = { numbersOn: true, firePress: 0 };
    const hud = new Proxy(
        {},
        {
            get: (_t, key) => {
                if (key === 'damageNumbersEnabled') return state.numbersOn;
                return (...args: unknown[]): undefined => {
                    calls.push(`hud.${String(key)}(${args.map((a) => String(round(a))).join(', ')})`);
                    return undefined;
                };
            },
        },
    );

    const feedback = new MatchFeedback({
        bus,
        cameraRig: {
            camera,
            shake: {
                add: (n: number): void => {
                    calls.push(`shake(${n.toFixed(4)})`);
                },
            },
            applyLanding: (_cfg: unknown, speed: number): void => {
                calls.push(`applyLanding(${speed})`);
            },
        } as never,
        cameraConfig: {} as never,
        audio: recorder(calls, 'audio') as never,
        input: {
            takeFirePress: (): number => state.firePress,
        } as never,
        player: { sim: { x: 1, y: 2, z: 3, eyeHeight: 1.6 } } as never,
        playerHealth: { max: 100 } as never,
        weaponAudio: recorder(calls, 'weaponAudio') as never,
        fx: recorder(calls, 'fx') as never,
        flame: recorder(calls, 'flame') as never,
        hud: hud as never,
        bots: recorder(calls, 'bots') as never,
        latency: recorder(calls, 'latency') as never,
        identity: { is: (id: number): boolean => id === LOCAL } as never,
        bodyAt: (id: number): Readonly<BodyPose> | null => bodies.get(id) ?? null,
        onPlayerKilled: (): void => {
            killed.push(1);
        },
        listener: () => ({ x: 100, y: 200, z: 300 }),
    });

    return {
        feedback,
        bus,
        camera,
        calls,
        bodies,
        killed,
        get numbersOn(): boolean {
            return state.numbersOn;
        },
        set numbersOn(v: boolean) {
            state.numbersOn = v;
        },
        get firePress(): number {
            return state.firePress;
        },
        set firePress(v: number) {
            state.firePress = v;
        },
    };
}

/** Only the calls whose name starts with `prefix`. */
function only(r: Rig, prefix: string): string[] {
    return r.calls.filter((c) => c.startsWith(prefix));
}

function fired(over: Record<string, unknown> = {}): never {
    return {
        weaponId: 'ar_carbine',
        sourceId: LOCAL,
        x: 0,
        y: 1,
        z: 0,
        dx: 0,
        dy: 0,
        dz: 1,
        endX: 0,
        endY: 1,
        endZ: 10,
        distance: 10,
        shotIndex: 0,
        spreadDeg: 0,
        tracer: true,
        hitTarget: false,
        ammoInMag: 29,
        pellets: 1,
        pelletsHit: 0,
        ...over,
    } as never;
}

function damaged(over: Record<string, unknown> = {}): never {
    return {
        sourceId: LOCAL,
        targetId: OTHER,
        weaponId: 'ar_carbine',
        zone: 'torso',
        amount: 30,
        x: 5,
        y: 1,
        z: 5,
        distance: 8,
        falloffLoss: 0,
        penetrationLoss: 0,
        lethal: false,
        autonomous: false,
        ...over,
    } as never;
}

function killedEvent(over: Record<string, unknown> = {}): never {
    return { targetId: OTHER, sourceId: LOCAL, weaponId: 'ar_carbine', zone: 'torso', killerHealth: 80, ...over } as never;
}

function landed(over: Record<string, unknown> = {}): never {
    return { entityId: LOCAL, x: 0, y: 0, z: 0, impactSpeed: 6, stance: 'STAND', material: 2, ...over } as never;
}

function footstep(over: Record<string, unknown> = {}): never {
    return { entityId: LOCAL, x: 0, y: 0, z: 0, speed: 3, heavy: false, quiet: false, material: 2, ...over } as never;
}

// ---------------------------------------------------------------------------- firing

describe('a shot being fired', () => {
    it('flashes, traces and bangs wherever it came from', () => {
        const r = rig();
        r.bus.emit(EV.WeaponFired, fired({ sourceId: OTHER }));
        expect(only(r, 'fx.fireMuzzleFlash')).toHaveLength(1);
        expect(only(r, 'fx.spawnTracer')).toEqual(['fx.spawnTracer(0, 1, 0, 0, 1, 10)']);
        expect(only(r, 'weaponAudio.playGunshot')).toHaveLength(1);
    });

    /** The flash *mesh* hangs off the local player's own viewmodel; the light belongs to anyone. */
    it('tells the flash whether it is the local player\u2019s own', () => {
        const own = rig();
        own.bus.emit(EV.WeaponFired, fired({ sourceId: LOCAL }));
        expect(only(own, 'fx.fireMuzzleFlash')[0]!.endsWith('true)')).toBe(true);
        const other = rig();
        other.bus.emit(EV.WeaponFired, fired({ sourceId: OTHER }));
        expect(only(other, 'fx.fireMuzzleFlash')[0]!.endsWith('false)')).toBe(true);
    });

    /** M8's mix: your own rifle sits below everyone else's so an enemy at thirty metres is heard. */
    it('mixes the player\u2019s own rifle below everyone else\u2019s', () => {
        const own = rig();
        own.bus.emit(EV.WeaponFired, fired({ sourceId: LOCAL }));
        const other = rig();
        other.bus.emit(EV.WeaponFired, fired({ sourceId: OTHER }));
        expect(only(own, 'weaponAudio.playGunshot')[0]!.endsWith(`${MIX.ownWeapon})`)).toBe(true);
        expect(only(other, 'weaponAudio.playGunshot')[0]!.endsWith(`${MIX.otherWeapon})`)).toBe(true);
        expect(MIX.ownWeapon).toBeLessThan(MIX.otherWeapon);
    });

    it('draws no tracer for a shot that has none', () => {
        const r = rig();
        r.bus.emit(EV.WeaponFired, fired({ tracer: false }));
        expect(only(r, 'fx.spawnTracer')).toEqual([]);
    });

    /** A bot shooting across the room shaking your camera is the classic tell. */
    it('shakes the camera only for the local player, and by the weapon\u2019s own number', () => {
        const own = rig();
        own.bus.emit(EV.WeaponFired, fired({ sourceId: LOCAL }));
        expect(only(own, 'shake')).toHaveLength(1);
        const other = rig();
        other.bus.emit(EV.WeaponFired, fired({ sourceId: OTHER }));
        expect(only(other, 'shake')).toEqual([]);
    });

    it('arms the latency probe from the press, only for the local player', () => {
        const own = rig();
        own.firePress = 1234;
        own.bus.emit(EV.WeaponFired, fired({ sourceId: LOCAL }));
        expect(only(own, 'latency.armFromPress')).toEqual(['latency.armFromPress(1234)']);
        const other = rig();
        other.bus.emit(EV.WeaponFired, fired({ sourceId: OTHER }));
        expect(only(other, 'latency.armFromPress')).toEqual([]);
    });

    /**
     * The weapon is the **shooter's**, off the event. Reading the viewer's inventory instead
     * made every shot in the match sound like whatever the viewer happened to be holding.
     */
    it('throws for a weapon id nothing catalogues, rather than falling back to the viewer\u2019s', () => {
        const r = rig();
        expect(() => r.bus.emit(EV.WeaponFired, fired({ weaponId: 'not_a_weapon' }))).toThrow(/unknown weapon/);
    });

    /**
     * A minigun's shots are emitted by the same `WeaponSystem` and its def is not in the
     * loadout table, so a lookup against `WEAPON_DEFS` alone threw on every round -- inside
     * `EventBus.emit`, which took the rest of the tick with it.
     */
    it('takes a killstreak weapon, which is not in the loadout table', () => {
        const r = rig();
        expect(() => r.bus.emit(EV.WeaponFired, fired({ weaponId: MINIGUN }))).not.toThrow();
        expect(only(r, 'weaponAudio.playGunshot')).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------- the flamethrower

describe('a weapon with a jet instead of a shot', () => {
    /** The star-shaped flash ten times a second is what made the flamethrower read as a machine gun. */
    it('emits fire and never a muzzle flash mesh', () => {
        const r = rig();
        r.bus.emit(EV.WeaponFired, fired({ weaponId: FLAMETHROWER, sourceId: LOCAL }));
        expect(only(r, 'flame.emit')).toHaveLength(1);
        expect(only(r, 'fx.spawnTracer')).toEqual([]);
        // The world light still goes out, thrown down the jet; `false` is "not the viewmodel's".
        const flash = only(r, 'fx.fireMuzzleFlash');
        expect(flash).toHaveLength(1);
        expect(flash[0]!.endsWith('false)')).toBe(true);
    });

    /** Thrown a metre and a half down the jet, where the fire that would light a wall is. */
    it('throws the light down the jet, capped at a metre and a half', () => {
        const near = rig();
        near.bus.emit(EV.WeaponFired, fired({ weaponId: FLAMETHROWER, distance: 1, dx: 1, dy: 0, dz: 0, x: 0, y: 1, z: 0 }));
        expect(only(near, 'fx.fireMuzzleFlash')[0]).toContain('(0.5, 1, 0');
        const far = rig();
        far.bus.emit(EV.WeaponFired, fired({ weaponId: FLAMETHROWER, distance: 50, dx: 1, dy: 0, dz: 0, x: 0, y: 1, z: 0 }));
        expect(only(far, 'fx.fireMuzzleFlash')[0]).toContain('(1.5, 1, 0');
    });

    it('tells the jet whether it is the local player\u2019s', () => {
        const own = rig();
        own.bus.emit(EV.WeaponFired, fired({ weaponId: FLAMETHROWER, sourceId: LOCAL }));
        expect(only(own, 'flame.emit')[0]!.endsWith('true)')).toBe(true);
        const other = rig();
        other.bus.emit(EV.WeaponFired, fired({ weaponId: FLAMETHROWER, sourceId: OTHER }));
        expect(only(other, 'flame.emit')[0]!.endsWith('false)')).toBe(true);
    });
});

// ---------------------------------------------------------------------------- impacts

describe('a round landing on the world', () => {
    it('spawns debris and plays the impact, whoever fired it', () => {
        const r = rig();
        r.bus.emit(EV.BulletImpact, { x: 1, y: 2, z: 3, nx: 0, ny: 1, nz: 0, material: 4, penetrated: false });
        expect(r.calls).toEqual([
            'fx.spawnImpact(1, 2, 3, 0, 1, 0, 4, false)',
            'weaponAudio.playImpact(1, 2, 3, 4, false)',
        ]);
    });

    it('carries the penetration flag to both', () => {
        const r = rig();
        r.bus.emit(EV.BulletImpact, { x: 0, y: 0, z: 0, nx: 1, ny: 0, nz: 0, material: 1, penetrated: true });
        expect(r.calls.every((c) => c.endsWith('true)'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------- the knife

describe('a melee swing', () => {
    /** A connecting knife goes through DamageSystem like anything else; only the swing is here. */
    it('plays the swing wherever it came from', () => {
        const r = rig();
        r.bus.emit(EV.MeleeSwing, { sourceId: OTHER, x: 1, y: 2, z: 3, hit: false, lethal: false });
        expect(only(r, 'weaponAudio.playMeleeSwing')).toEqual(['weaponAudio.playMeleeSwing(1, 2, 3, false)']);
        expect(only(r, 'shake')).toEqual([]);
    });

    it('shakes harder for a swing that connects, and only for the local player', () => {
        const hit = rig();
        hit.bus.emit(EV.MeleeSwing, { sourceId: LOCAL, x: 0, y: 0, z: 0, hit: true, lethal: false });
        expect(only(hit, 'shake')).toEqual(['shake(0.1600)']);
        const miss = rig();
        miss.bus.emit(EV.MeleeSwing, { sourceId: LOCAL, x: 0, y: 0, z: 0, hit: false, lethal: false });
        expect(only(miss, 'shake')).toEqual(['shake(0.0600)']);
    });
});

// ---------------------------------------------------------------------------- damage dealt

describe('damage the local player dealt', () => {
    it('marks it, sounds it, puffs it and queues a number', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged());
        expect(only(r, 'hud.showHitmarker')).toHaveLength(1);
        expect(only(r, 'weaponAudio.playHitmarker')).toEqual(['weaponAudio.playHitmarker(false)']);
        expect(only(r, 'fx.spawnHitPuff')).toHaveLength(1);
        expect(only(r, 'weaponAudio.playFleshImpact')).toEqual(['weaponAudio.playFleshImpact(5, 1, 5, false)']);
    });

    it('tells the flesh impact when it was a head', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ zone: 'head' }));
        expect(only(r, 'weaponAudio.playFleshImpact')).toEqual(['weaponAudio.playFleshImpact(5, 1, 5, true)']);
    });

    it('marks a lethal hit differently', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ lethal: true }));
        expect(only(r, 'hud.showHitmarker')[0]!.startsWith('hud.showHitmarker(true')).toBe(true);
        expect(only(r, 'weaponAudio.playHitmarker')).toEqual(['weaponAudio.playHitmarker(true)']);
    });

    /** A different colour, so nobody reads a turret's work as their own aim. */
    it('marks a sentry\u2019s hit as the sentry\u2019s', () => {
        const own = rig();
        own.bus.emit(EV.DamageDealt, damaged({ autonomous: false }));
        expect(only(own, 'hud.showHitmarker')[0]!.endsWith('false)')).toBe(true);
        const turret = rig();
        turret.bus.emit(EV.DamageDealt, damaged({ autonomous: true }));
        expect(only(turret, 'hud.showHitmarker')[0]!.endsWith('true)')).toBe(true);
    });

    /** Debris comes back along the shot, so the puff faces the shooter. */
    it('points the puff back at the player, normalised', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ x: 5, y: 1, z: 5 }));
        const puff = only(r, 'fx.spawnHitPuff')[0]!;
        const parts = puff.slice(puff.indexOf('(') + 1, -1).split(', ').map(Number);
        const [, , , dx, dy, dz] = parts;
        expect(Math.hypot(dx!, dy!, dz!)).toBeCloseTo(1, 3);
        // The player's sim is (1, 2, 3) with a 1.6 m eye, so the direction is up and back.
        expect(dx).toBeLessThan(0);
        expect(dy).toBeGreaterThan(0);
        expect(dz).toBeLessThan(0);
    });

    /** A round landing on a body is a sound in the room no matter who fired it (S6.8). */
    it('sounds the flesh impact for a shot between two other entities', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: OTHER, targetId: UNSEEN }));
        expect(only(r, 'weaponAudio.playFleshImpact')).toHaveLength(1);
        expect(only(r, 'hud.showHitmarker')).toEqual([]);
        expect(only(r, 'fx.spawnHitPuff')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- being hit

describe('damage the local player took', () => {
    it('shows the vignette against the health it has', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: OTHER, targetId: LOCAL, amount: 25 }));
        expect(only(r, 'hud.showHurt')).toEqual(['hud.showHurt(25, 100)']);
    });

    it('does not mark it, sound it or puff it: that is the shooter\u2019s feedback', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: OTHER, targetId: LOCAL }));
        expect(only(r, 'hud.showHitmarker')).toEqual([]);
        expect(only(r, 'fx.spawnHitPuff')).toEqual([]);
        expect(only(r, 'weaponAudio.playFleshImpact')).toEqual([]);
    });

    /** A jolt proportional to the round, capped well below the landing shake. */
    it('jolts the camera in proportion to the round', () => {
        const light = rig();
        light.bus.emit(EV.DamageDealt, damaged({ sourceId: OTHER, targetId: LOCAL, amount: 3 }));
        const heavy = rig();
        heavy.bus.emit(EV.DamageDealt, damaged({ sourceId: OTHER, targetId: LOCAL, amount: 90 }));
        expect(only(light, 'shake')).toEqual(['shake(0.0960)']);
        expect(only(heavy, 'shake')).toEqual(['shake(0.2400)']);
    });

    it('caps the jolt however large the round', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: OTHER, targetId: LOCAL, amount: 10000 }));
        expect(only(r, 'shake')).toEqual(['shake(0.2400)']);
    });

    /**
     * Being shot from off-screen with no indication of the direction is the single most
     * frustrating way to die, which is why the chevron is the important half.
     */
    it('points a chevron at the shooter', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: OTHER, targetId: LOCAL }));
        expect(only(r, 'hud.showHitDirection')).toHaveLength(1);
    });

    /**
     * The rig is given a body for the local player first, so this measures the guard rather
     * than the absence of a body: without one, `pointChevron` would answer false anyway and
     * the test would pass with the guard taken out.
     */
    it('points no chevron at itself, even knowing where it is', () => {
        const r = rig();
        r.bodies.set(LOCAL, { x: 2, y: 0, z: 2, eyeHeight: 1.6 });
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: LOCAL, targetId: LOCAL }));
        expect(only(r, 'hud.showHitDirection')).toEqual([]);
        expect(only(r, 'hud.showHurt')).toHaveLength(1);
    });

    it('waits for nobody when it shot itself', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: LOCAL, targetId: LOCAL }));
        r.bodies.set(LOCAL, { x: 2, y: 0, z: 2, eyeHeight: 1.6 });
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showHitDirection')).toEqual([]);
    });

    /**
     * A shooter this client was not told about wakes in the next snapshot (R9); until it does
     * there is nothing to point at, so the chevron waits rather than not appearing.
     */
    it('waits for a shooter it has no body for, and points once it arrives', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: UNSEEN, targetId: LOCAL }));
        expect(only(r, 'hud.showHitDirection')).toEqual([]);
        r.bodies.set(UNSEEN, { x: -5, y: 0, z: -5, eyeHeight: 1.6 });
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showHitDirection')).toHaveLength(1);
    });

    it('does not point twice for one wait', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ sourceId: UNSEEN, targetId: LOCAL }));
        r.bodies.set(UNSEEN, { x: -5, y: 0, z: -5, eyeHeight: 1.6 });
        r.feedback.render(r.camera);
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showHitDirection')).toHaveLength(1);
    });

    it('turns the bearing with the shooter, not with the shooter\u2019s height', () => {
        const left = rig();
        left.bodies.set(UNSEEN, { x: -10, y: 0, z: 0, eyeHeight: 1.6 });
        left.bus.emit(EV.DamageDealt, damaged({ sourceId: UNSEEN, targetId: LOCAL }));
        const right = rig();
        right.bodies.set(UNSEEN, { x: 10, y: 0, z: 0, eyeHeight: 1.6 });
        right.bus.emit(EV.DamageDealt, damaged({ sourceId: UNSEEN, targetId: LOCAL }));
        expect(only(left, 'hud.showHitDirection')[0]).not.toBe(only(right, 'hud.showHitDirection')[0]);
    });
});

// ---------------------------------------------------------------------------- deaths

describe('a death', () => {
    it('hands the local player\u2019s own death to the match and sounds nothing', () => {
        const r = rig();
        r.bus.emit(EV.EntityKilled, killedEvent({ targetId: LOCAL }));
        expect(r.killed).toEqual([1]);
        expect(only(r, 'weaponAudio.playDeath')).toEqual([]);
    });

    /** Slightly off the floor: the sound is the body arriving, not the feet. */
    it('sounds another body arriving, a little above its feet', () => {
        const r = rig();
        r.bus.emit(EV.EntityKilled, killedEvent({ targetId: OTHER }));
        expect(only(r, 'weaponAudio.playDeath')).toEqual(['weaponAudio.playDeath(10, 0.4, 10)']);
        expect(r.killed).toEqual([]);
    });

    it('stays silent for a body this client does not know about', () => {
        const r = rig();
        r.bus.emit(EV.EntityKilled, killedEvent({ targetId: UNSEEN }));
        expect(only(r, 'weaponAudio.playDeath')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- mechanical noises

describe('the mechanical noises', () => {
    /**
     * The player's own sit at their eye; a bot's sit at the bot, which is what makes hearing
     * one reload behind a crate usable information rather than confusing information.
     */
    it('puts the player\u2019s own at their eye', () => {
        const r = rig();
        r.bus.emit(EV.WeaponDryFired, { weaponId: 'ar_carbine', sourceId: LOCAL });
        expect(only(r, 'weaponAudio.playDryFire')).toEqual(['weaponAudio.playDryFire(1, 3.6, 3)']);
    });

    it('puts another body\u2019s at that body\u2019s eye', () => {
        const r = rig();
        r.bus.emit(EV.WeaponDryFired, { weaponId: 'ar_carbine', sourceId: OTHER });
        expect(only(r, 'weaponAudio.playDryFire')).toEqual(['weaponAudio.playDryFire(10, 1.6, 10)']);
    });

    /** A range dummy: put it at the listener so it stays audible rather than panned to the origin. */
    it('puts an unregistered source at the listener', () => {
        const r = rig();
        r.bus.emit(EV.WeaponDryFired, { weaponId: 'ar_carbine', sourceId: UNSEEN });
        expect(only(r, 'weaponAudio.playDryFire')).toEqual(['weaponAudio.playDryFire(100, 200, 300)']);
    });

    it('locates a reload step the same way, and carries the step', () => {
        const r = rig();
        r.bus.emit(EV.WeaponReloadStep, { weaponId: 'ar_carbine', sourceId: OTHER, step: 'magOut' as never });
        expect(only(r, 'weaponAudio.playReloadStep')).toEqual(['weaponAudio.playReloadStep(10, 1.6, 10, magOut)']);
    });

    it('locates the ADS rustle the same way, and carries the direction', () => {
        const r = rig();
        r.bus.emit(EV.WeaponAdsChanged, { weaponId: 'ar_carbine', sourceId: LOCAL, aiming: true });
        expect(only(r, 'weaponAudio.playAdsRustle')).toEqual(['weaponAudio.playAdsRustle(1, 3.6, 3, true)']);
    });
});

// ---------------------------------------------------------------------------- feet

describe('feet', () => {
    /** Both play positionally for everybody — that is how you hear one drop in behind you. */
    it('sounds a landing for anybody', () => {
        const r = rig();
        r.bus.emit(EV.PlayerLanded, landed({ entityId: OTHER }));
        expect(only(r, 'audio.playLanding')).toHaveLength(1);
    });

    /** The camera dip is the one part that is not shared. */
    it('dips the camera only for the local player\u2019s own landing', () => {
        const own = rig();
        own.bus.emit(EV.PlayerLanded, landed({ entityId: LOCAL, impactSpeed: 7 }));
        expect(only(own, 'applyLanding')).toEqual(['applyLanding(7)']);
        const other = rig();
        other.bus.emit(EV.PlayerLanded, landed({ entityId: OTHER }));
        expect(only(other, 'applyLanding')).toEqual([]);
    });

    /** Your own steps carry no information and are the best mask for the one sound you need. */
    it('mixes the player\u2019s own feet below everyone else\u2019s', () => {
        const own = rig();
        own.bus.emit(EV.PlayerFootstep, footstep({ entityId: LOCAL }));
        const other = rig();
        other.bus.emit(EV.PlayerFootstep, footstep({ entityId: OTHER }));
        expect(only(own, 'audio.playFootstep')[0]!.endsWith(`${MIX.ownFootstep})`)).toBe(true);
        expect(only(other, 'audio.playFootstep')[0]!.endsWith(`${MIX.otherFootstep})`)).toBe(true);
        expect(MIX.ownFootstep).toBeLessThan(MIX.otherFootstep);
    });

    it('mixes a landing the same way', () => {
        const own = rig();
        own.bus.emit(EV.PlayerLanded, landed({ entityId: LOCAL }));
        const other = rig();
        other.bus.emit(EV.PlayerLanded, landed({ entityId: OTHER }));
        expect(only(own, 'audio.playLanding')[0]!.endsWith(`${MIX.ownFootstep})`)).toBe(true);
        expect(only(other, 'audio.playLanding')[0]!.endsWith(`${MIX.otherFootstep})`)).toBe(true);
    });

    it('carries the speed, the weight and the material', () => {
        const r = rig();
        r.bus.emit(EV.PlayerFootstep, footstep({ entityId: OTHER, speed: 4.5, heavy: true, material: 9 }));
        expect(only(r, 'audio.playFootstep')[0]).toBe(`audio.playFootstep(0, 0, 0, 4.5, true, 9, ${MIX.otherFootstep})`);
    });
});

// ---------------------------------------------------------------------------- damage numbers

describe('the damage numbers', () => {
    it('shows one per hit on the next render, projected to the screen', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ x: 0, y: 1.6, z: -5 }));
        expect(only(r, 'hud.showDamageNumber')).toEqual([]);
        r.feedback.render(r.camera);
        const shown = only(r, 'hud.showDamageNumber');
        expect(shown).toHaveLength(1);
        // Dead ahead at the eye line: the middle of a 1920x1080 window.
        expect(shown[0]).toBe('hud.showDamageNumber(960, 540, 30, torso)');
    });

    it('carries the zone, so a headshot can be drawn differently', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ zone: 'head', x: 0, y: 1.6, z: -5 }));
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showDamageNumber')[0]!.endsWith('head)')).toBe(true);
    });

    it('shows nothing when the player has turned them off, and still clears the queue', () => {
        const r = rig();
        r.numbersOn = false;
        r.bus.emit(EV.DamageDealt, damaged({ x: 0, y: 1.6, z: -5 }));
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showDamageNumber')).toEqual([]);
        r.numbersOn = true;
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showDamageNumber')).toEqual([]);
    });

    it('drops a number behind the camera rather than drawing it on the wrong side', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ x: 0, y: 1.6, z: 50 }));
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showDamageNumber')).toEqual([]);
    });

    it('clears the queue every render, so a number is shown once', () => {
        const r = rig();
        r.bus.emit(EV.DamageDealt, damaged({ x: 0, y: 1.6, z: -5 }));
        r.feedback.render(r.camera);
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showDamageNumber')).toHaveLength(1);
    });

    /** Eight slots: a damage event must not allocate in the middle of a firefight. */
    it('holds eight at once and drops the ninth', () => {
        const r = rig();
        for (let i = 0; i < 12; i++) r.bus.emit(EV.DamageDealt, damaged({ x: 0, y: 1.6, z: -5, amount: i }));
        r.feedback.render(r.camera);
        const shown = only(r, 'hud.showDamageNumber');
        expect(shown).toHaveLength(8);
        expect(shown[0]!).toContain(', 0, torso)');
        expect(shown[7]!).toContain(', 7, torso)');
    });

    it('takes more after a render has drained it', () => {
        const r = rig();
        for (let i = 0; i < 10; i++) r.bus.emit(EV.DamageDealt, damaged({ x: 0, y: 1.6, z: -5 }));
        r.feedback.render(r.camera);
        r.bus.emit(EV.DamageDealt, damaged({ x: 0, y: 1.6, z: -5 }));
        r.feedback.render(r.camera);
        expect(only(r, 'hud.showDamageNumber')).toHaveLength(9);
    });
});

// ---------------------------------------------------------------------------- the render pass

describe('the render pass', () => {
    /** Timestamped at the moment the damage was applied, so the figure is hit-to-visual. */
    it('tells the latency probe a frame was presented, once per local shot', () => {
        const r = rig();
        r.bus.emit(EV.WeaponFired, fired({ sourceId: LOCAL }));
        r.feedback.render(r.camera);
        expect(only(r, 'latency.notePresented')).toHaveLength(1);
        r.feedback.render(r.camera);
        expect(only(r, 'latency.notePresented')).toHaveLength(1);
    });

    it('tells it nothing for a shot that was not the local player\u2019s', () => {
        const r = rig();
        r.bus.emit(EV.WeaponFired, fired({ sourceId: OTHER }));
        r.feedback.render(r.camera);
        expect(only(r, 'latency.notePresented')).toEqual([]);
    });

    it('is safe with nothing to do', () => {
        const r = rig();
        r.feedback.render(r.camera);
        expect(r.calls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- teardown

describe('disposal', () => {
    it('stops listening to every event', () => {
        const r = rig();
        r.feedback.dispose();
        r.bus.emit(EV.WeaponFired, fired());
        r.bus.emit(EV.DamageDealt, damaged());
        r.bus.emit(EV.EntityKilled, killedEvent({ targetId: LOCAL }));
        r.bus.emit(EV.PlayerFootstep, footstep());
        expect(r.calls).toEqual([]);
        expect(r.killed).toEqual([]);
    });

    it('is safe twice', () => {
        const r = rig();
        r.feedback.dispose();
        r.feedback.dispose();
        expect(r.calls).toEqual([]);
    });
});
