import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { GREYBOX_MAP } from '../world/maps/greybox';
import type { Combatant } from '../ai/Combatant';
import type { KillEvent, ModeDeps } from './GameMode';
import { KillConfirmed } from './KillConfirmed';

/**
 * Kill Confirmed, pinned.
 *
 * The mode is one rule with a twist: a kill drops a tag, and the kill only counts for the team
 * once somebody picks the tag up. The twist is that *your own* team's tags can be taken too —
 * a **deny** — which pays the taker but moves no team total. Paying a deny into the team score
 * as well would make denying strictly better than confirming, and the mode would collapse into
 * everybody hovering over their own corpses.
 *
 * `onTick` is where it all happens and it is on the `check:decorators` hot-path list: it ages
 * every tag, expires the dead ones, and tests every combatant against every tag. The scan order
 * is observable — the tag list is walked backwards so a splice is safe, and the roster forwards
 * so the first body in it wins a contested tag — and both are pinned here, because a reordering
 * that looks harmless would change who gets the point.
 */

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function body(entityId: number, team: 'A' | 'B', x = 0, y = 0, z = 0): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(x, y, z, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
    health: new Health(HEALTH),
    rig,
    team,
    px: x,
    py: y,
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

/**
 * A body that has just died: still on the roster, no longer participating.
 *
 * It matters that this is not a living body. A corpse standing on its own tag would collect it,
 * because `onTick` tests every *participating* combatant against every tag — so a rig that
 * leaves the victim alive has the victim denying its own tag before anybody else can reach it.
 */
function fallen(entityId: number, team: 'A' | 'B', x = 0, y = 0, z = 0): Combatant {
  return { ...body(entityId, team, x, y, z), participating: false };
}

interface Rig {
  readonly mode: KillConfirmed;
  readonly score: ScoreSystem;
  readonly bus: GameBus;
  readonly roster: Combatant[];
}

function rig(roster: Combatant[] = [body(0, 'A', 0, 0, 0), fallen(100, 'B', 50, 0, 50)]): Rig {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  for (const c of roster) score.register(c.entityId, c.displayName, c.team);
  const deps: ModeDeps = { bus, score, roster, mapDef: GREYBOX_MAP };
  const mode = new KillConfirmed(deps);
  mode.onRoundStart(1);
  return { mode, score, bus, roster };
}

/** A kill of `victimId` by `killerId`, which is what drops a tag. */
function kill(mode: KillConfirmed, killerId: number, victimId: number, victimTeam: 'A' | 'B' | null): void {
  const ev: KillEvent = {
    killerId,
    victimId,
    weaponId: 'ar_carbine',
    zone: 'torso',
    killerTeam: victimTeam === 'A' ? 'B' : 'A',
    victimTeam,
    headshot: false,
    suicide: false,
    friendly: false,
  };
  mode.onKill(ev);
}

describe('what Kill Confirmed declares it is', () => {
  it('is one round to sixty-five tags over ten minutes', () => {
    const { mode } = rig();
    expect(mode.id).toBe('KC');
    expect(mode.name).toBe('KILL CONFIRMED');
    expect(mode.roundsToWin).toBe(1);
    expect(mode.swapSidesAfterRound).toBe(null);
    expect(mode.livesPerRound).toBe(Infinity);
    expect(mode.scoreLimit).toBe(65);
    expect(mode.roundSeconds).toBe(600);
  });

  it('tells the player both halves of the rule', () => {
    const { mode } = rig();
    expect(mode.brief).toContain('ENEMY TAGS');
    expect(mode.brief).toContain('DENY');
  });

  it('starts with no tags on the floor, and publishes the list rather than null', () => {
    const { mode } = rig();
    expect(mode.dogTags).toEqual([]);
    expect(mode.objectiveZones).toEqual([]);
    expect(mode.bombInfo).toBe(null);
    expect(mode.individualWinner()).toBeUndefined();
  });
});

describe('a kill dropping a tag', () => {
  it('drops one where the victim fell, owned by the side that died', () => {
    const { mode, bus } = rig();
    const seen: Array<{ team: string; victimId: number }> = [];
    bus.on(EV.TagDropped, (p) => seen.push({ team: p.team, victimId: p.victimId }));
    kill(mode, 0, 100, 'B');

    expect(mode.dogTags).toHaveLength(1);
    expect(mode.dogTags?.[0]?.team).toBe('B');
    expect(mode.dogTags?.[0]?.x).toBe(50);
    expect(mode.dogTags?.[0]?.z).toBe(50);
    // Half a metre off the floor: chest height on the body, where the marker is drawn.
    expect(mode.dogTags?.[0]?.y).toBe(0.5);
    expect(seen).toEqual([{ team: 'B', victimId: 100 }]);
  });

  it('drops nothing for a body that is on no side', () => {
    // A range dummy is damageable and belongs to nobody, so there is no tag to take.
    const { mode } = rig();
    kill(mode, 0, 9, null);
    expect(mode.dogTags).toEqual([]);
  });

  it('drops nothing for a victim who is not on the roster', () => {
    const { mode } = rig();
    kill(mode, 0, 999, 'B');
    expect(mode.dogTags).toEqual([]);
  });

  it('pays the kill itself straight away, before anybody confirms it', () => {
    const { mode, score } = rig();
    kill(mode, 0, 100, 'B');
    expect(score.row(0)?.score).toBe(100);
    // But the team total waits for the tag.
    expect(score.team('A').score).toBe(0);
  });
});

describe('picking a tag up', () => {
  it('confirms an enemy tag: the taker is paid and the team scores', () => {
    const taker = body(0, 'A', 50, 0, 50);
    const { mode, score, bus } = rig([taker, fallen(100, 'B', 50, 0, 50)]);
    const seen: Array<{ denied: boolean; entityId: number }> = [];
    bus.on(EV.TagCollected, (p) => seen.push({ denied: p.denied, entityId: p.entityId }));

    kill(mode, 0, 100, 'B');
    mode.onTick(1);

    expect(mode.dogTags).toEqual([]);
    expect(score.row(0)?.tags).toBe(1);
    expect(score.team('A').score).toBe(1);
    expect(seen).toEqual([{ denied: false, entityId: 0 }]);
  });

  it('denies your own tag: the taker is paid and no team total moves', () => {
    // Worth doing because it stops the enemy scoring; paying for it twice would make denying
    // better than confirming.
    const mate = body(101, 'B', 50, 0, 50);
    const { mode, score, bus } = rig([body(0, 'A', 0, 0, 0), fallen(100, 'B', 50, 0, 50), mate]);
    const seen: boolean[] = [];
    bus.on(EV.TagCollected, (p) => seen.push(p.denied));

    kill(mode, 0, 100, 'B');
    mode.onTick(1);

    expect(score.row(101)?.tags).toBe(1);
    expect(score.team('B').score).toBe(0);
    expect(score.team('A').score).toBe(0);
    expect(seen).toEqual([true]);
  });

  it('needs the taker inside the pickup radius', () => {
    const near = body(0, 'A', 51.8, 0, 50);
    const { mode, score } = rig([near, fallen(100, 'B', 50, 0, 50)]);
    kill(mode, 0, 100, 'B');
    mode.onTick(1);
    expect(score.team('A').score).toBe(1);

    const far = body(0, 'A', 52, 0, 50);
    const second = rig([far, fallen(100, 'B', 50, 0, 50)]);
    kill(second.mode, 0, 100, 'B');
    second.mode.onTick(1);
    expect(second.score.team('A').score).toBe(0);
    expect(second.mode.dogTags).toHaveLength(1);
  });

  it('needs the taker on roughly the same floor', () => {
    // The tag sits half a metre above the body — chest height, where the marker and the mesh
    // are drawn — so the 2.2 m tolerance is measured from 0.5, not from the floor.
    const reach = body(0, 'A', 50, 2.7, 50);
    const { mode, score } = rig([reach, fallen(100, 'B', 50, 0, 50)]);
    kill(mode, 0, 100, 'B');
    mode.onTick(1);
    expect(score.team('A').score).toBe(1);

    const above = body(0, 'A', 50, 2.75, 50);
    const higher = rig([above, fallen(100, 'B', 50, 0, 50)]);
    kill(higher.mode, 0, 100, 'B');
    higher.mode.onTick(1);
    // A tag under a catwalk is not collected from the catwalk.
    expect(higher.score.team('A').score).toBe(0);
    expect(higher.mode.dogTags).toHaveLength(1);
  });

  it('ignores a body that is not participating', () => {
    const down = { ...body(0, 'A', 50, 0, 50), participating: false };
    const { mode, score } = rig([down, fallen(100, 'B', 50, 0, 50)]);
    kill(mode, 0, 100, 'B');
    mode.onTick(1);
    expect(score.team('A').score).toBe(0);
  });

  it('gives a contested tag to the first body in the roster', () => {
    // The roster order is the tie-break, and it is walked forwards.
    const first = body(0, 'A', 50, 0, 50);
    const second = body(1, 'A', 50, 0, 50);
    const { mode, score } = rig([first, second, fallen(100, 'B', 50, 0, 50)]);
    kill(mode, 0, 100, 'B');
    mode.onTick(1);
    expect(score.row(0)?.tags).toBe(1);
    expect(score.row(1)?.tags).toBeFalsy();
  });

  it('collects every tag a body is standing on, in one tick', () => {
    const taker = body(0, 'A', 50, 0, 50);
    const { mode, score } = rig([taker, fallen(100, 'B', 50, 0, 50), fallen(101, 'B', 50, 0, 50)]);
    kill(mode, 0, 100, 'B');
    kill(mode, 0, 101, 'B');
    expect(mode.dogTags).toHaveLength(2);
    mode.onTick(1);
    expect(mode.dogTags).toEqual([]);
    expect(score.team('A').score).toBe(2);
  });
});

describe('a tag nobody takes', () => {
  it('survives its authored lifetime and then evaporates', () => {
    // The remaining life is not on the published view — `TagInfo` is what a client needs to
    // draw a marker, and a countdown is not part of it — so the lifetime is observed where a
    // client would observe it: the tag is listed, and then it is not.
    const { mode } = rig();
    kill(mode, 0, 100, 'B');

    const ticks = Math.round(20 / DT);
    for (let tick = 1; tick < ticks; tick++) mode.onTick(tick);
    expect(mode.dogTags).toHaveLength(1);

    mode.onTick(ticks);
    expect(mode.dogTags).toEqual([]);
  });

  it('scores nobody when it evaporates', () => {
    const { mode, score } = rig();
    kill(mode, 0, 100, 'B');
    for (let tick = 1; tick <= Math.ceil(20 / DT); tick++) mode.onTick(tick);
    expect(score.team('A').score).toBe(0);
    expect(score.row(0)?.tags).toBeFalsy();
  });
});

describe('deciding the match', () => {
  it('runs while nobody is at the tag limit', () => {
    const { mode } = rig();
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('ends on the tag that reaches the limit', () => {
    const taker = body(0, 'A', 50, 0, 50);
    const { mode, score } = rig([taker, fallen(100, 'B', 50, 0, 50)]);
    for (let i = 0; i < 65; i++) {
      kill(mode, 0, 100, 'B');
      mode.onTick(i + 1);
    }
    expect(score.team('A').score).toBe(65);
    const result = mode.checkWinCondition();
    expect(result?.kind).toBe('match');
    expect(result?.winner).toBe('A');
    expect(result?.reason).toBe('Tag limit');
  });

  it('reads a side straight off the score system', () => {
    const taker = body(0, 'A', 50, 0, 50);
    const { mode, score } = rig([taker, fallen(100, 'B', 50, 0, 50)]);
    kill(mode, 0, 100, 'B');
    mode.onTick(1);
    expect(mode.teamScore('A')).toBe(score.team('A').score);
  });
});

describe('what the mode tells a bot to do', () => {
  it('sends a bot at the nearest tag worth taking', () => {
    const { mode } = rig();
    kill(mode, 0, 100, 'B');
    const target = mode.assign(body(101, 'B', 50, 0, 52));
    expect(target).not.toBe(null);
    expect(target?.label).toBe('DENY');
  });

  it('labels an enemy tag a confirm', () => {
    const { mode } = rig();
    kill(mode, 0, 100, 'B');
    expect(mode.assign(body(1, 'A', 50, 0, 52))?.label).toBe('CONFIRM');
  });

  it('has nothing to say with no tags on the floor', () => {
    const { mode } = rig();
    expect(mode.assign(body(1, 'A'))).toBe(null);
  });

  it('ignores a tag too far away to be worth the walk', () => {
    const { mode } = rig();
    kill(mode, 0, 100, 'B');
    expect(mode.assign(body(1, 'A', 200, 0, 200))).toBe(null);
  });

  it('does nothing on arrival, because the tick already collected it', () => {
    const { mode } = rig();
    kill(mode, 0, 100, 'B');
    const bot = body(1, 'A', 50, 0, 50);
    const target = mode.assign(bot);
    expect(target).not.toBe(null);
    if (target === null) return;
    // Collecting here as well would take the tag twice.
    expect(() => mode.onArrived(bot, target)).not.toThrow();
    expect(mode.dogTags).toHaveLength(1);
  });
});
