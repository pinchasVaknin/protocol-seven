import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HitboxRig } from '../shared/combat/HitboxRig';
import { ScoreSystem } from '../shared/combat/ScoreSystem';
import { createGameBus } from '../shared/core/Events';
import { Health } from '../shared/player/Health';
import { FOUNDRY_MAP } from '../shared/world/maps/foundry';
import type { Combatant } from '../shared/ai/Combatant';
import type { GameMode, ModeDeps } from '../shared/modes/GameMode';
import { Domination } from '../shared/modes/Domination';
import { KillConfirmed } from '../shared/modes/KillConfirmed';
import { SearchAndDestroy } from '../shared/modes/SearchAndDestroy';
import { Tdm } from '../shared/modes/Tdm';
import { MatchObjectives } from './MatchObjectives';

/**
 * Characterization tests for the objective furniture (refactor unit C21, written before the
 * refactor).
 *
 * This is the file §4.4 of the prompt names: five `instanceof` checks on concrete `GameMode`
 * subclasses, in two methods. So the modes here are **real instances** rather than registry
 * rows -- a `ModeEntry` is not a `GameMode`, and a test that passed one would take the empty
 * path for every mode and prove nothing about the three that have objectives.
 *
 * Nothing here needs a renderer. The scene is a real `THREE.Scene`, the meshes are real
 * meshes, and what is asserted is the graph they make and the numbers written into it:
 * `MatchObjectives` draws nothing itself, it arranges things for `Renderer` to draw.
 */

// ---------------------------------------------------------------------------- the rig

/**
 * The one piece of document this file needs.
 *
 * `palette.set` writes the gameplay colours onto `:root` so a stylesheet can say
 * `var(--c-hostile)`, and that is the only DOM anything in this unit touches. A setter that
 * records is enough; nothing here reads the variables back.
 */
beforeEach(() => {
    (globalThis as Record<string, unknown>)['document'] = {
        documentElement: { style: { setProperty: (): void => undefined } },
    };
});

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function body(entityId: number, team: 'A' | 'B', x = 0, z = 0): Combatant {
    const rig = new HitboxRig();
    rig.setTransform(x, 0, z, 0);
    return {
        entityId,
        displayName: 'E' + String(entityId),
        health: new Health(HEALTH),
        rig,
        team,
        px: x,
        py: 0,
        pz: z,
        yaw: 0,
        vx: 0,
        vz: 0,
        eyeHeight: 1.6,
        aimHeight: 1.26,
        quiet: false,
        participating: true,
        glinting: false,
    };
}

function modeDeps(): ModeDeps {
    const bus = createGameBus();
    const score = new ScoreSystem(bus);
    const roster: Combatant[] = [body(0, 'A'), body(100, 'B')];
    for (const c of roster) score.register(c.entityId, c.displayName, c.team);
    return { bus, score, roster, mapDef: FOUNDRY_MAP };
}

interface Rig {
    readonly objectives: MatchObjectives;
    readonly scene: THREE.Scene;
    readonly group: THREE.Group;
    /** Entities this client is not told the position of. */
    readonly dormant: Set<number>;
}

function rig(mode: GameMode, localTeam: 'A' | 'B' = 'A'): Rig {
    const scene = new THREE.Scene();
    const dormant = new Set<number>();
    const objectives = new MatchObjectives({
        bus: createGameBus(),
        scene,
        mode,
        localTeam,
        dormant: (id: number) => dormant.has(id),
    });
    return { objectives, scene, group: objectives.group, dormant };
}

function dom(): Domination {
    const mode = new Domination(modeDeps());
    mode.onRoundStart(1);
    return mode;
}

function snd(): SearchAndDestroy {
    const mode = new SearchAndDestroy(modeDeps());
    mode.onRoundStart(1);
    return mode;
}

function kc(): KillConfirmed {
    const mode = new KillConfirmed(modeDeps());
    mode.onRoundStart(1);
    return mode;
}

function tdm(): Tdm {
    const mode = new Tdm(modeDeps());
    mode.onRoundStart(1);
    return mode;
}

/** Every mesh under `root`, by the name of the group it hangs in. */
function meshesIn(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh === true) out.push(o as THREE.Mesh);
    });
    return out;
}

/**
 * Meshes that would actually be drawn: `traverse` visits a hidden group's children too, and
 * each of those children carries `visible === true` of its own.
 */
function visibleMeshes(root: THREE.Object3D): number {
    let n = 0;
    root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh !== true) return;
        for (let p: THREE.Object3D | null = o; p !== null && p !== root.parent; p = p.parent) {
            if (!p.visible) return;
        }
        n++;
    });
    return n;
}

/**
 * The one mesh every mode carries whatever it is.
 *
 * `bombLight` falls back to a hidden 1 cm sphere when there is no bomb to take a light from,
 * and `buildFallbackLight` adds it to the group unconditionally. So a Team Deathmatch match
 * holds one invisible sphere and one `MeshBasicMaterial` it will never use -- which is
 * harmless, and is pinned here so that it is a decision rather than a surprise.
 */
const FALLBACK_LIGHT_MESHES = 1;

// ---------------------------------------------------------------------------- the group

describe('the group it puts in the scene', () => {
    it('adds one named group and nothing else', () => {
        const r = rig(tdm());
        expect(r.scene.children).toHaveLength(1);
        expect(r.scene.children[0]).toBe(r.group);
        expect(r.group.name).toBe('objectives');
    });

    it('takes it out again on disposal', () => {
        const r = rig(dom());
        r.objectives.dispose();
        expect(r.scene.children).toHaveLength(0);
        expect(r.group.children).toHaveLength(0);
    });

    it('is safe to dispose twice', () => {
        const r = rig(dom());
        r.objectives.dispose();
        r.objectives.dispose();
        expect(r.scene.children).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------- what each mode builds

describe('what each mode puts on the map', () => {
    /** A mode with no objectives gets an empty group: the furniture is the mode's, not the map's. */
    it('builds nothing for Team Deathmatch but the fallback light, hidden', () => {
        const r = rig(tdm());
        expect(meshesIn(r.group)).toHaveLength(FALLBACK_LIGHT_MESHES);
        expect(visibleMeshes(r.group)).toBe(0);
    });

    it('builds the same one for Free-for-All', () => {
        const r = rig(tdm());
        expect(visibleMeshes(r.group)).toBe(0);
    });

    it('builds one flag per authored zone for Domination', () => {
        const mode = dom();
        const r = rig(mode);
        expect(mode.zones.length).toBeGreaterThan(0);
        // A pole, a banner and two rings each.
        expect(meshesIn(r.group).length).toBe(mode.zones.length * 4 + FALLBACK_LIGHT_MESHES);
    });

    it('stands each flag where the map authored it', () => {
        const mode = dom();
        const r = rig(mode);
        const flags = r.group.children.filter((c) => c.type === 'Group');
        const xs = flags.map((c) => Number(c.position.x.toFixed(3))).sort((a, b) => a - b);
        const authored = mode.zones.map((z) => Number(z.def.position.x.toFixed(3))).sort((a, b) => a - b);
        expect(xs).toEqual(authored);
    });

    it('builds a site per bomb site and a bomb for Search & Destroy', () => {
        const mode = snd();
        const r = rig(mode);
        expect(mode.sites.length).toBeGreaterThan(0);
        // Sites have no pole, so three meshes each, plus the bomb's own.
        expect(meshesIn(r.group).length).toBeGreaterThan(mode.sites.length * 3);
        // The bomb is in the group and hidden until the mode says otherwise.
        expect(visibleMeshes(r.group)).toBeGreaterThan(0);
    });

    it('builds a pool of dog tags for Kill Confirmed, all hidden to begin with', () => {
        const r = rig(kc());
        expect(meshesIn(r.group).length).toBeGreaterThan(0);
        expect(visibleMeshes(r.group)).toBe(0);
    });

    it('builds twenty-four tags, enough for a busy Kill Confirmed', () => {
        const r = rig(kc());
        expect(r.group.children.filter((c) => c.type === 'Group')).toHaveLength(24);
    });
});

// ---------------------------------------------------------------------------- the flags

describe('a Domination flag', () => {
    function flagRig(localTeam: 'A' | 'B' = 'A'): { readonly mode: Domination; readonly r: Rig } {
        const mode = dom();
        return { mode, r: rig(mode, localTeam) };
    }

    /** The first flag's banner is the one standard material under the first group. */
    function firstFlag(r: Rig): THREE.Object3D {
        return r.group.children.find((c) => c.type === 'Group')!;
    }

    /**
     * The banner, not the pole.
     *
     * Both are `MeshStandardMaterial` and the pole is added first, so taking the first match
     * reads a colour that never changes -- which is a quiet way for six assertions to agree
     * with each other and with nothing.
     */
    function bannerOf(r: Rig): THREE.Mesh {
        const standard = meshesIn(firstFlag(r)).filter(
            (x) => (x.material as THREE.Material).type === 'MeshStandardMaterial',
        );
        return standard[standard.length - 1]!;
    }

    function bannerColour(r: Rig): number {
        return (bannerOf(r).material as THREE.MeshStandardMaterial).color.getHex();
    }

    /** What you see is what the occupancy test uses: the ring is exactly `zone.def.radius`. */
    it('draws the capture ring at exactly the radius the rule uses', () => {
        const { mode, r } = flagRig();
        const first = r.group.children[0]!;
        const ring = meshesIn(first).find((m) => m.name === '' && (m.geometry as THREE.RingGeometry).type === 'RingGeometry');
        expect(ring).toBeDefined();
        const params = (ring!.geometry as THREE.RingGeometry).parameters;
        expect(params.outerRadius).toBeCloseTo(mode.zones[0]!.def.radius, 6);
    });

    it('paints a neutral flag, a friendly flag and an enemy flag three different colours', () => {
        const { mode, r } = flagRig('A');
        const banner = (): number => {
            r.objectives.update(1 / 60);
            return bannerColour(r);
        };
        mode.zones[0]!.owner = 'NONE';
        const neutral = banner();
        mode.zones[0]!.owner = 'A';
        const friendly = banner();
        mode.zones[0]!.owner = 'B';
        const enemy = banner();
        expect(new Set([neutral, friendly, enemy]).size).toBe(3);
    });

    /** Relative to the viewer: the same flag is friendly to one side and hostile to the other. */
    it('paints the same owner differently for the two sides', () => {
        const fromA = flagRig('A');
        const fromB = flagRig('B');
        for (const { mode, r } of [fromA, fromB]) {
            mode.zones[0]!.owner = 'A';
            r.objectives.update(1 / 60);
        }
        expect(bannerColour(fromA.r)).not.toBe(bannerColour(fromB.r));
    });

    it('hides the progress ring until somebody is taking the flag', () => {
        const { mode, r } = flagRig();
        mode.zones[0]!.progress = 0;
        mode.zones[0]!.capturingTeam = 'NONE';
        r.objectives.update(1 / 60);
        const rings = meshesIn(firstFlag(r)).filter(
            (m) => (m.material as THREE.Material).type === 'MeshBasicMaterial',
        );
        expect(rings.some((m) => !m.visible)).toBe(true);
    });

    /** Grown by scale rather than rebuilt: a new RingGeometry a frame would allocate and upload. */
    it('grows the progress ring by scale, from a fifth to full', () => {
        const { mode, r } = flagRig();
        const scaleAt = (progress: number): number => {
            mode.zones[0]!.progress = progress;
            mode.zones[0]!.capturingTeam = 'A';
            mode.zones[0]!.countA = 1;
            r.objectives.update(1 / 60);
            const grown = meshesIn(firstFlag(r)).filter((m) => m.visible && m.scale.x !== 1);
            return grown[0]?.scale.x ?? 1;
        };
        expect(scaleAt(0.01)).toBeCloseTo(0.208, 3);
        expect(scaleAt(0.5)).toBeCloseTo(0.6, 6);
        expect(scaleAt(1)).toBeCloseTo(1, 6);
    });

    /**
     * The disc reports rather than decorates: a second attacker speeds the beat by 60%, so
     * a player across the map can tell "somebody is on B" from "three of them are on B".
     */
    it('beats faster the more attackers are on it', () => {
        const { mode, r } = flagRig();
        const peaks = (attackers: number): number => {
            mode.zones[0]!.progress = 0.5;
            mode.zones[0]!.capturingTeam = 'A';
            mode.zones[0]!.countA = attackers;
            const out: number[] = [];
            // `spin` advances at 0.9 rad a second, so a beat needs seconds rather than frames.
            for (let i = 0; i < 600; i++) {
                r.objectives.update(1 / 60);
                const ring = meshesIn(firstFlag(r)).find((m) => m.visible && m.scale.x !== 1);
                out.push((ring!.material as THREE.MeshBasicMaterial).opacity);
            }
            let n = 0;
            for (let i = 1; i < out.length - 1; i++) {
                if (out[i]! > out[i - 1]! && out[i]! >= out[i + 1]!) n++;
            }
            return n;
        };
        const one = peaks(1);
        const three = peaks(3);
        expect(one).toBeGreaterThan(0);
        expect(three).toBeGreaterThan(one);
    });

    it('keeps the fill inside the band it was given', () => {
        const { mode, r } = flagRig();
        mode.zones[0]!.progress = 0.5;
        mode.zones[0]!.capturingTeam = 'A';
        mode.zones[0]!.countA = 2;
        for (let i = 0; i < 60; i++) {
            r.objectives.update(1 / 60);
            const ring = meshesIn(firstFlag(r)).find((m) => m.visible && m.scale.x !== 1);
            const o = (ring!.material as THREE.MeshBasicMaterial).opacity;
            expect(o).toBeGreaterThanOrEqual(0.28 - 1e-9);
            expect(o).toBeLessThanOrEqual(0.6 + 1e-9);
        }
    });

    /** A held flag flies its banner; a neutral one droops. */
    it('droops a neutral banner and flies a held one', () => {
        const { mode, r } = flagRig();
        const banner = (): THREE.Mesh => bannerOf(r);
        mode.zones[0]!.owner = 'NONE';
        for (let i = 0; i < 120; i++) r.objectives.update(1 / 60);
        expect(banner().rotation.z).toBeCloseTo(-0.5, 2);
        mode.zones[0]!.owner = 'A';
        for (let i = 0; i < 120; i++) r.objectives.update(1 / 60);
        expect(banner().rotation.z).toBeCloseTo(0, 2);
    });
});

// ---------------------------------------------------------------------------- the dog tags

describe('the Kill Confirmed tags', () => {
    it('shows one tag per dropped tag and hides the rest', () => {
        const mode = kc();
        const r = rig(mode);
        mode.tags.push({ id: 1, team: 'B', x: 1, y: 0, z: 2, life: 10, claimed: false });
        mode.tags.push({ id: 2, team: 'A', x: 3, y: 0, z: 4, life: 10, claimed: false });
        r.objectives.update(1 / 60);
        const shown = r.group.children.filter((c) => c.visible);
        expect(shown).toHaveLength(2);
    });

    it('puts each tag where the mode says, a little off the floor', () => {
        const mode = kc();
        const r = rig(mode);
        mode.tags.push({ id: 1, team: 'B', x: 5, y: 0, z: -7, life: 10, claimed: false });
        r.objectives.update(1 / 60);
        const tag = r.group.children.find((c) => c.visible)!;
        expect(tag.position.x).toBeCloseTo(5, 6);
        expect(tag.position.z).toBeCloseTo(-7, 6);
        expect(tag.position.y).toBeGreaterThan(0);
    });

    /** Friendly tags deny, enemy tags score — so they must be told apart instantly. */
    it('paints an enemy tag and a friendly tag differently', () => {
        const mode = kc();
        const r = rig(mode, 'A');
        mode.tags.push({ id: 1, team: 'A', x: 0, y: 0, z: 0, life: 10, claimed: false });
        mode.tags.push({ id: 2, team: 'B', x: 2, y: 0, z: 0, life: 10, claimed: false });
        r.objectives.update(1 / 60);
        const shown = r.group.children.filter((c) => c.visible);
        const edge = (g: THREE.Object3D): number => {
            const m = meshesIn(g).find((x) => (x.material as THREE.Material).type === 'MeshBasicMaterial');
            return (m!.material as THREE.MeshBasicMaterial).color.getHex();
        };
        expect(edge(shown[0]!)).not.toBe(edge(shown[1]!));
    });

    it('keeps one visual per tag id across frames', () => {
        const mode = kc();
        const r = rig(mode);
        mode.tags.push({ id: 42, team: 'B', x: 0, y: 0, z: 0, life: 10, claimed: false });
        r.objectives.update(1 / 60);
        const first = r.group.children.find((c) => c.visible);
        for (let i = 0; i < 10; i++) r.objectives.update(1 / 60);
        expect(r.group.children.find((c) => c.visible)).toBe(first);
    });

    it('hides a tag again once the mode drops it', () => {
        const mode = kc();
        const r = rig(mode);
        mode.tags.push({ id: 1, team: 'B', x: 0, y: 0, z: 0, life: 10, claimed: false });
        r.objectives.update(1 / 60);
        expect(r.group.children.filter((c) => c.visible)).toHaveLength(1);
        mode.tags.length = 0;
        r.objectives.update(1 / 60);
        expect(r.group.children.filter((c) => c.visible)).toHaveLength(0);
    });

    /** The last three seconds blink, which is the only warning it is about to evaporate. */
    it('blinks a tag in its last three seconds', () => {
        const mode = kc();
        const r = rig(mode);
        mode.tags.push({ id: 1, team: 'B', x: 0, y: 0, z: 0, life: 2, claimed: false });
        const seen = new Set<boolean>();
        for (let i = 0; i < 80; i++) {
            r.objectives.update(1 / 60);
            seen.add(r.group.children.some((c) => c.visible));
        }
        expect(seen).toEqual(new Set([true, false]));
    });

    it('does not blink a tag with time left on it', () => {
        const mode = kc();
        const r = rig(mode);
        mode.tags.push({ id: 1, team: 'B', x: 0, y: 0, z: 0, life: 30, claimed: false });
        for (let i = 0; i < 80; i++) {
            r.objectives.update(1 / 60);
            expect(r.group.children.some((c) => c.visible)).toBe(true);
        }
    });

    /** A tag lying flat on a grey floor is invisible, and the whole mode is built on noticing them. */
    it('bobs and turns, so a tag on a grey floor is not invisible', () => {
        const mode = kc();
        const r = rig(mode);
        mode.tags.push({ id: 1, team: 'B', x: 0, y: 0, z: 0, life: 30, claimed: false });
        const ys: number[] = [];
        const yaws: number[] = [];
        for (let i = 0; i < 30; i++) {
            r.objectives.update(1 / 60);
            const tag = r.group.children.find((c) => c.visible)!;
            ys.push(tag.position.y);
            yaws.push(tag.rotation.y);
        }
        expect(new Set(ys).size).toBeGreaterThan(10);
        expect(yaws[29]).toBeGreaterThan(yaws[0]!);
    });
});

// ---------------------------------------------------------------------------- the bomb

describe('the Search & Destroy bomb', () => {
    /**
     * It used to be hidden the moment anybody picked it up, and nothing drew those hands, so
     * the objective ceased to exist for as long as it was held — reported as *"there is no
     * physical bomb entity to plant on the map"*.
     */
    it('is visible while it is being carried', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'CARRIED';
        mode.carrierId = 5;
        mode.bombX = 3;
        mode.bombY = 0;
        mode.bombZ = 4;
        r.objectives.update(1 / 60);
        const bomb = r.group.children.find((c) => c.visible && c.position.x === 3);
        expect(bomb).toBeDefined();
    });

    /** Hip height on a standing body: carried rather than dropped. */
    it('rides at hip height on a carrier and on the floor when loose', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'CARRIED';
        mode.bombX = 0;
        mode.bombY = 0;
        mode.bombZ = 0;
        mode.carrierId = 5;
        r.objectives.update(1 / 60);
        const carried = r.group.children.find((c) => c.visible && c.position.x === 0 && c.position.y > 0.5);
        expect(carried).toBeDefined();
        mode.carrierId = -1;
        r.objectives.update(1 / 60);
        expect(carried!.position.y).toBeCloseTo(0, 6);
    });

    /** Anti-wallhack: the body is not drawn where the server froze it, so neither is what it carries. */
    it('is not drawn on a carrier this client is not told about', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'CARRIED';
        mode.carrierId = 5;
        mode.bombX = 8;
        r.objectives.update(1 / 60);
        expect(r.group.children.some((c) => c.visible && c.position.x === 8)).toBe(true);
        r.dormant.add(5);
        r.objectives.update(1 / 60);
        expect(r.group.children.some((c) => c.visible && c.position.x === 8)).toBe(false);
    });

    it('turns on the floor and holds steady in a carrier\u2019s hands', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'CARRIED';
        mode.bombX = 0;
        mode.bombZ = 0;
        const spinOver = (carrier: number): number => {
            mode.carrierId = carrier;
            const first = (): THREE.Object3D => r.group.children.find((c) => c.visible && c.position.x === 0)!;
            r.objectives.update(1 / 60);
            const a = first().rotation.y;
            for (let i = 0; i < 20; i++) r.objectives.update(1 / 60);
            return Math.abs(first().rotation.y - a);
        };
        const loose = spinOver(-1);
        const held = spinOver(5);
        expect(held).toBeGreaterThan(loose);
    });

    it('stands on the planted site once it is planted', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'PLANTED';
        mode.plantedSite = mode.sites[0]!;
        r.objectives.update(1 / 60);
        const at = mode.sites[0]!.def.position;
        const bomb = r.group.children.find((c) => c.visible && Math.abs(c.position.x - at.x) < 1e-6);
        expect(bomb).toBeDefined();
        expect(bomb!.rotation.y).toBe(0);
    });
});

// ---------------------------------------------------------------------------- the arrow

describe('the loose-bomb arrow', () => {
    /** Written in the same pass that decides where the mesh goes, so the two cannot disagree. */
    it('is off for a mode with no bomb at all', () => {
        const out = { active: true, x: 1, z: 1 };
        const r = rig(dom());
        r.objectives.update(1 / 60);
        r.objectives.readBombBearing(out);
        expect(out.active).toBe(false);
    });

    it('is off before anything has been updated', () => {
        const out = { active: true, x: 1, z: 1 };
        rig(snd()).objectives.readBombBearing(out);
        expect(out.active).toBe(false);
    });

    it('points at a bomb nobody is carrying', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'CARRIED';
        mode.carrierId = -1;
        mode.bombX = 12;
        mode.bombZ = -3;
        r.objectives.update(1 / 60);
        const out = { active: false, x: 0, z: 0 };
        r.objectives.readBombBearing(out);
        expect(out).toEqual({ active: true, x: 12, z: -3 });
    });

    it('goes out the moment somebody picks it up', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'CARRIED';
        mode.carrierId = -1;
        mode.bombX = 12;
        r.objectives.update(1 / 60);
        mode.carrierId = 5;
        r.objectives.update(1 / 60);
        const out = { active: true, x: 0, z: 0 };
        r.objectives.readBombBearing(out);
        expect(out.active).toBe(false);
    });

    /** Cleared every frame and re-asserted, so a plant takes the arrow down on the same frame. */
    it('goes out the moment it is planted', () => {
        const mode = snd();
        const r = rig(mode);
        mode.bomb = 'CARRIED';
        mode.carrierId = -1;
        r.objectives.update(1 / 60);
        mode.bomb = 'PLANTED';
        mode.plantedSite = mode.sites[0]!;
        r.objectives.update(1 / 60);
        const out = { active: true, x: 0, z: 0 };
        r.objectives.readBombBearing(out);
        expect(out.active).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the palette

describe('the baked-in colours', () => {
    /**
     * Everything else re-reads the palette every frame and follows a change for free. These do
     * not, so a palette change repaints them — the alternative is a dog tag that stays red
     * after the player switched to deuteranopia.
     */
    it('repaints the baked materials when the palette moves', async () => {
        const { palette } = await import('./ui/Palette');
        palette.set('off');
        const r = rig(tdm());
        // The fallback light's material is baked and registered, whatever the mode.
        const mat = meshesIn(r.group)[0]!.material as THREE.MeshBasicMaterial;
        const before = mat.color.getHex();
        expect(before).toBe(palette.current.hostile);
        try {
            palette.set('deuteranopia');
            expect(palette.current.hostile).not.toBe(before);
            expect(mat.color.getHex()).toBe(palette.current.hostile);
        } finally {
            palette.set('off');
        }
        expect(mat.color.getHex()).toBe(before);
    });

    /** Everything else re-reads the palette every frame, so it follows a change for free. */
    it('follows a palette change on the next frame for everything else', async () => {
        const { palette } = await import('./ui/Palette');
        palette.set('off');
        const mode = dom();
        const r = rig(mode, 'A');
        mode.zones[0]!.owner = 'B';
        r.objectives.update(1 / 60);
        const standard = meshesIn(r.group.children.find((c) => c.type === 'Group')!).filter(
            (x) => (x.material as THREE.Material).type === 'MeshStandardMaterial',
        );
        const banner = standard[standard.length - 1]!;
        const before = (banner.material as THREE.MeshStandardMaterial).color.getHex();
        try {
            palette.set('tritanopia');
            r.objectives.update(1 / 60);
            expect((banner.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(before);
        } finally {
            palette.set('off');
        }
    });
});
