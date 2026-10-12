import { describe, expect, it } from 'vitest';
import { HitboxRig } from '../combat/HitboxRig';
import { ScoreSystem } from '../combat/ScoreSystem';
import { createGameBus } from '../core/Events';
import { DT } from '../core/Loop';
import { Health } from '../player/Health';
import { FOUNDRY_MAP } from '../world/maps/foundry';
import type { Combatant } from '../ai/Combatant';
import { Domination } from './Domination';
import type { KillEvent, ModeDeps } from './GameMode';

/**
 * Domination, pinned — the flags, the scoring tick, and the bot assignment.
 *
 * Three things carry the mode and each is pinned on its own:
 *
 *  - **The opening layout.** Each side starts holding the flag nearest its own spawn and the
 *    middle starts neutral. Anything else makes the opening thirty seconds a race to three
 *    uncontested flags, which is why the zones are sorted by x and the ends handed out.
 *  - **The scoring tick.** One point per flag held, every `tickSeconds` — a team score rather
 *    than a personal one, which is what makes holding two flags worth something even to a
 *    player who never fires.
 *  - **`assign`, which is the `ObjectiveProvider` half.** `BotBrain` asks it four times a second
 *    per bot, and its scoring is the whole of "bots play the objective" on this mode: nearest
 *    first, neutral before enemy-held, everything more urgent while behind, and a cap on how
 *    many bots pile onto one flag. A bot keeps its assignment until the flag actually changes
 *    hands under it, because a bot that re-decides every quarter second never arrives.
 *
 * Foundry rather than the greybox, because Domination needs a map with three authored flags and
 * the greybox has none — a mode is handed its objectives by the map and never places one itself.
 */

const HEALTH = { max: 200, regenDelay: 5, regenRate: 40 };

function body(entityId: number, team: 'A' | 'B', x = 0, z = 0): Combatant {
  const rig = new HitboxRig();
  rig.setTransform(x, 0, z, 0);
  return {
    entityId,
    displayName: 'E' + entityId,
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

interface Rig {
  readonly mode: Domination;
  readonly score: ScoreSystem;
  readonly roster: Combatant[];
}

function rig(over: Partial<ModeDeps> = {}): Rig {
  const bus = createGameBus();
  const score = new ScoreSystem(bus);
  const roster: Combatant[] = [body(0, 'A'), body(100, 'B')];
  for (const c of roster) score.register(c.entityId, c.displayName, c.team);
  const deps: ModeDeps = { bus, score, roster, mapDef: FOUNDRY_MAP, ...over };
  const mode = new Domination(deps);
  mode.onRoundStart(1);
  return { mode, score, roster };
}

/** Put `bot` on the flag at `zoneId` and hold it there until it changes hands. */
function capture(mode: Domination, bot: Combatant, zoneId: string, roster: Combatant[]): void {
  const zone = mode.objectiveZones.find((z) => z.id === zoneId);
  expect(zone).toBeDefined();
  if (zone === undefined) return;
  const stander = body(bot.entityId, bot.team, zone.def.position.x, zone.def.position.z);
  roster.length = 0;
  roster.push(stander);
  for (let tick = 1; tick <= 1000 && zone.owner !== bot.team; tick++) mode.onTick(tick);
}

describe('what Domination declares it is', () => {
  it('is one round to two hundred points over ten minutes', () => {
    const { mode } = rig();
    expect(mode.id).toBe('DOM');
    expect(mode.roundsToWin).toBe(1);
    expect(mode.swapSidesAfterRound).toBe(null);
    expect(mode.livesPerRound).toBe(Infinity);
    expect(mode.scoreLimit).toBe(200);
    expect(mode.roundSeconds).toBe(600);
  });

  it('takes its flags from the map, and only the flags', () => {
    const { mode } = rig();
    const flags = FOUNDRY_MAP.objectives.filter((o) => o.kind === 'flag');
    expect(mode.objectiveZones).toHaveLength(flags.length);
    expect(mode.objectiveZones.length).toBeGreaterThanOrEqual(3);
  });

  it('publishes one header slot per flag, with its letter and its owner', () => {
    const { mode } = rig();
    const slots = mode.headerSlots;
    expect(slots).toHaveLength(mode.objectiveZones.length);
    for (const slot of slots) {
      expect(slot.label.length).toBeGreaterThan(0);
      expect(['A', 'B', 'NONE']).toContain(slot.owner);
    }
  });

  it('crowns a side, not an individual, and carries no tags or bomb', () => {
    const { mode } = rig();
    expect(mode.individualWinner()).toBeUndefined();
    expect(mode.dogTags).toBe(null);
    expect(mode.bombInfo).toBe(null);
  });
});

describe('the opening layout', () => {
  it('gives each side the flag nearest its own end and leaves the middle neutral', () => {
    const { mode } = rig();
    const byX = [...mode.objectiveZones].sort((l, r) => l.def.position.x - r.def.position.x);
    expect(byX[0]?.owner).toBe('A');
    expect(byX[byX.length - 1]?.owner).toBe('B');
    for (let i = 1; i < byX.length - 1; i++) expect(byX[i]?.owner).toBe('NONE');
  });

  it('is laid out again on a second round start', () => {
    const { mode, roster } = rig();
    const byX = [...mode.objectiveZones].sort((l, r) => l.def.position.x - r.def.position.x);
    const middle = byX[1];
    expect(middle).toBeDefined();
    if (middle === undefined) return;
    capture(mode, body(100, 'B'), middle.id, roster);
    expect(middle.owner).toBe('B');

    mode.onRoundStart(2);
    expect(middle.owner).toBe('NONE');
  });
});

describe('scoring', () => {
  it('adds one point per flag held, every scoring tick', () => {
    const { mode, score } = rig();
    // 301 ticks, not 300: five seconds of `+= DT` lands a hair under 5, so the tick that pays
    // is the one after. The same float accumulation decides when a flag changes hands.
    const ticks = Math.round(5 / DT);
    for (let tick = 1; tick <= ticks; tick++) mode.onTick(tick);
    expect(score.team('A').score).toBe(0);
    mode.onTick(ticks + 1);
    // One flag each at the start, so one point each.
    expect(score.team('A').score).toBe(1);
    expect(score.team('B').score).toBe(1);
  });

  it('pays nothing to a side holding no flags', () => {
    const { mode, score, roster } = rig();
    const byX = [...mode.objectiveZones].sort((l, r) => l.def.position.x - r.def.position.x);
    const theirs = byX[byX.length - 1];
    expect(theirs).toBeDefined();
    if (theirs === undefined) return;
    capture(mode, body(0, 'A'), theirs.id, roster);
    expect(theirs.owner).toBe('A');

    const before = score.team('B').score;
    for (let tick = 1; tick <= Math.round(5 / DT); tick++) mode.onTick(tick);
    expect(score.team('B').score).toBe(before);
  });

  it('credits the capture to the bot that took the flag', () => {
    const { mode, score, roster } = rig();
    const byX = [...mode.objectiveZones].sort((l, r) => l.def.position.x - r.def.position.x);
    const middle = byX[1];
    expect(middle).toBeDefined();
    if (middle === undefined) return;
    capture(mode, body(100, 'B'), middle.id, roster);
    expect(middle.owner).toBe('B');
    expect(score.row(100)?.captures).toBe(1);
    expect(score.row(100)?.score).toBeGreaterThanOrEqual(250);
  });

  it('reads a side off the score system', () => {
    const { mode, score } = rig();
    for (let tick = 1; tick <= Math.round(5 / DT); tick++) mode.onTick(tick);
    expect(mode.teamScore('A')).toBe(score.team('A').score);
  });

  it('pays the kill and the headshot bonus', () => {
    const { mode, score } = rig();
    const ev: KillEvent = {
      killerId: 0,
      victimId: 100,
      weaponId: 'ar_carbine',
      zone: 'head',
      killerTeam: 'A',
      victimTeam: 'B',
      headshot: true,
      suicide: false,
      friendly: false,
    };
    mode.onKill(ev);
    expect(score.row(0)?.score).toBe(150);
  });
});

describe('deciding the match', () => {
  it('runs while nobody is at the limit', () => {
    const { mode } = rig();
    expect(mode.checkWinCondition()).toBe(null);
  });

  it('ends on the clock with the leader winning on time', () => {
    const { mode } = rig({ roundSecondsOverride: DT });
    mode.onRoundStart(1);
    mode.onTick(1);
    const result = mode.checkWinCondition();
    expect(result?.kind).toBe('match');
    expect(['A', 'B', 'DRAW']).toContain(result?.winner);
  });
});

describe('what the mode tells a bot to do', () => {
  it('sends a bot at a flag it does not hold', () => {
    const { mode } = rig();
    const bot = body(100, 'B', 0, 0);
    const target = mode.assign(bot);
    expect(target).not.toBe(null);
    expect(target?.action).toBe('capture');
    const zone = mode.objectiveZones.find((z) => z.id === target?.id);
    expect(zone?.owner).not.toBe('B');
  });

  it('aims inside the ring rather than at its edge, so a bot stopping short still counts', () => {
    const { mode } = rig();
    const target = mode.assign(body(100, 'B'));
    const zone = mode.objectiveZones.find((z) => z.id === target?.id);
    expect(zone).toBeDefined();
    if (zone === undefined || target === null) return;
    expect(target.radius).toBeLessThan(zone.def.radius);
    expect(target.radius).toBeGreaterThanOrEqual(1.2);
  });

  it('keeps the assignment until the flag changes hands under the bot', () => {
    const { mode } = rig();
    const bot = body(100, 'B', 0, 0);
    const first = mode.assign(bot)?.id;
    // Asked again from somewhere else entirely, the answer holds: a bot that re-decides every
    // quarter second never arrives anywhere.
    expect(mode.assign(body(100, 'B', 40, 40))?.id).toBe(first);
  });

  it('re-decides once the flag it was sent to becomes its own', () => {
    const { mode, roster } = rig();
    const bot = body(100, 'B', 0, 0);
    const first = mode.assign(bot)?.id;
    expect(first).toBeDefined();
    if (first === undefined) return;
    capture(mode, bot, first, roster);
    const again = mode.assign(bot)?.id;
    expect(again).not.toBe(first);
  });

  it('prefers a neutral flag to one the enemy holds, at the same distance', () => {
    const { mode } = rig();
    const byX = [...mode.objectiveZones].sort((l, r) => l.def.position.x - r.def.position.x);
    const neutral = byX[1];
    const enemyHeld = byX[0];
    expect(neutral?.owner).toBe('NONE');
    expect(enemyHeld?.owner).toBe('A');
    if (neutral === undefined || enemyHeld === undefined) return;

    // Stood exactly between the two, so distance cannot decide it.
    const midX = (neutral.def.position.x + enemyHeld.def.position.x) / 2;
    const midZ = (neutral.def.position.z + enemyHeld.def.position.z) / 2;
    expect(mode.assign(body(100, 'B', midX, midZ))?.id).toBe(neutral.id);
  });

  it('caps how many bots pile onto one flag', () => {
    const { mode } = rig();
    const sent = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const target = mode.assign(body(100 + i, 'B', 0, 0));
      if (target !== null) sent.add(`${target.id}:${i}`);
    }
    // Six bots from one spot cannot all be sent to the same flag.
    const perFlag = new Map<string, number>();
    for (const key of sent) {
      const id = key.split(':')[0] ?? '';
      perFlag.set(id, (perFlag.get(id) ?? 0) + 1);
    }
    for (const n of perFlag.values()) expect(n).toBeLessThanOrEqual(3);
  });

  it('sits on the nearest flag it holds once everything is theirs, at a low priority', () => {
    const { mode } = rig();
    for (const zone of mode.objectiveZones) zone.reset('B');
    const target = mode.assign(body(100, 'B', 0, 0));
    expect(target?.action).toBe('defend');
    // Low enough that the bot still fights what it meets on the way — see
    // `OBJECTIVE_IGNORE_BELOW` in `ai/ObjectiveIntent`.
    expect(target?.priority).toBeLessThan(0.5);
  });

  it('refuses to be built on a map that authored no flags, loudly', () => {
    // A Domination match with no flags is a deathmatch with a misleading HUD, and it would
    // read as a balance problem rather than as missing map data. Better at load.
    const bus = createGameBus();
    const score = new ScoreSystem(bus);
    const bare = { ...FOUNDRY_MAP, objectives: [] };
    expect(() => new Domination({ bus, score, roster: [], mapDef: bare })).toThrow(/flag/i);
  });

  it('hands out one reused target record, which the brain reads immediately', () => {
    const { mode } = rig();
    const first = mode.assign(body(100, 'B'));
    const second = mode.assign(body(101, 'B'));
    expect(first).toBe(second);
  });
});
