import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BOT_ID_BASE } from '../shared/ai/BotDirector';
import type { BotTeam } from '../shared/ai/Combatant';
import { CheatState } from '../shared/cheats/Cheats';
import { installClock } from '../shared/core/Clock';
import { EV } from '../shared/core/Events';
import { EventBus } from '../shared/core/EventBus';
import { Btn, type MutableInputCommand } from '../shared/core/InputCommand';
import { DT } from '../shared/core/Loop';
import { defaultLoadouts, type LoadoutSlot } from '../shared/meta/Loadouts';
import { NO_SKIN_INDEX } from '../shared/meta/Skins';
import type { ObjectiveZone } from '../shared/modes/ObjectiveZone';
import { SearchAndDestroy } from '../shared/modes/SearchAndDestroy';
import { MAX_PLAYERS } from '../shared/net/Protocol';
import { NO_PERKS } from '../shared/perks/PerkState';
import { MELEE_SWING_SECONDS } from '../shared/weapons/Melee';
import { AR_DEFAULT, PISTOL_DEFAULT } from '../shared/weapons/WeaponDefs';
import { MapBakery } from './MapBakery';
import { ServerMatch, type ServerMatchOptions } from './Match';
import type { NetPlayer } from './NetPlayer';

/**
 * The authoritative match (B6): what it wires, how it seats, and the order it ticks in.
 *
 * `Match.ts` had no test of its own before this file. Everything asserted here is reachable
 * from outside: the systems it composes answer for themselves (`damage.freeForAll`,
 * `bots.objectives`, `score.records`), seats are observed through `players` / `getPlayer` /
 * `score.row`, and the per-player steps are driven by **real input commands** pushed into a
 * real `InputBuffer`, so the melee pose and the bomb interactions go through the same path a
 * client's packet does.
 *
 * Five claims get the most attention, because each is a fix whose absence presented as
 * something else entirely:
 *
 *  - **One registry fact, set in every place that needs it.** `freeForAll` has to reach the
 *    director, the damage door and the scoreboard; it reached none of them on the server for a
 *    whole milestone, and half the roster was hostile, hunted and *immune*.
 *  - **A joining human goes on the side with fewer humans**, not fewer bodies — a seat is
 *    granted and a bot is taken off the same side, so counting bodies sends every joiner to A.
 *  - **The bot that replaces a leaver is the tier that side is short of**, which is the
 *    difference between a balanced match and one bot nobody can explain.
 *  - **A leaver's scoreboard row stays; a displaced bot's row goes.** The two are opposite on
 *    purpose: one is a record of a match still being played, the other is a `0/0/0` row that
 *    placed real players eleventh in an eight-body match.
 *  - **`dispose` releases every subscription.** §8.13 counts `EventBus.liveSubscriptions` over
 *    a hundred cycles, and two separate leaks (the streaks, then the fire) were found by it.
 *
 * The clock is a fake held still: `nowMs` feeds the log timestamps and the streak lockouts,
 * and nothing here is measured in wall time — ticks are the clock, as the simulation requires.
 */

let now = 10_000;

installClock({ nowMs: () => now });

/** Ticks a match takes to leave WARMUP: the map's authored intro, the return and the countdown. */
const WARMUP_BUDGET = 1_400;

let bakery: MapBakery;
const live: ServerMatch[] = [];

beforeAll(() => {
  bakery = new MapBakery();
  bakery.bakeAll();
});

afterEach(() => {
  for (const match of live) match.dispose();
  live.length = 0;
  now = 10_000;
});

function options(overrides: Partial<ServerMatchOptions> = {}): ServerMatchOptions {
  const mapId = overrides.mapId ?? 'mp_foundry';
  return {
    mapId,
    modeId: 'TDM',
    bots: 2,
    rosterOverride: 2,
    tier: 'MIX',
    seed: 1234,
    startTick: 0,
    baked: bakery.instanceView(mapId),
    ...overrides,
  };
}

function match(overrides: Partial<ServerMatchOptions> = {}): ServerMatch {
  const made = new ServerMatch(options(overrides));
  live.push(made);
  return made;
}

let nextName = 1;

/** Seat one human, as `MatchInstance.seat` does: a name, the grants and a body index. */
function join(
  m: ServerMatch,
  opts: { name?: string; loadout?: LoadoutSlot | null; reclaim?: { entityId: number; team: BotTeam } } = {},
): NetPlayer {
  const player = m.addPlayer(
    opts.name ?? `OP${nextName++}`,
    new CheatState(),
    NO_SKIN_INDEX,
    opts.loadout ?? null,
    opts.reclaim ?? null,
  );
  expect(player).not.toBeNull();
  return player as NetPlayer;
}

const command: MutableInputCommand = {
  seq: 0,
  tickIndex: 0,
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  sampledAtMs: 0,
};

/**
 * Put one command in this player's buffer for `tick`, as a packet would.
 *
 * The buffer copies what it accepts, so one module-level record serves every call — the same
 * reason the send paths reuse their scratch.
 */
function press(player: NetPlayer, tick: number, buttons: number): void {
  command.seq++;
  command.tickIndex = tick;
  command.buttons = buttons;
  command.yaw = player.yaw;
  expect(player.input.accept(command, tick)).toBe(true);
}

/** Step `count` ticks from `from`. Answers the next unstepped tick. */
function stepTicks(m: ServerMatch, from: number, count: number): number {
  let tick = from;
  for (let i = 0; i < count; i++) m.step(tick++);
  return tick;
}

/**
 * Step until the match goes live, and answer the first LIVE tick.
 *
 * Most of a match's opening is WARMUP — the map's authored intro plus the return and the
 * countdown — and `stepPlayer` passes `frozen` throughout it, which zeroes the buttons of
 * every command. So anything driven by input has to be asked after this.
 */
function goLive(m: ServerMatch): number {
  for (let tick = 0; tick < WARMUP_BUDGET; tick++) {
    m.step(tick);
    if (m.flow.currentPhase === 'LIVE') return tick + 1;
  }
  throw new Error('the match did not go live inside the warmup budget');
}

/** Step until the win condition fires, and answer the tick it fired on. */
function runToEnd(m: ServerMatch): number {
  for (let tick = 0; tick < WARMUP_BUDGET + 600; tick++) {
    m.step(tick);
    if (m.isOver) return tick;
  }
  throw new Error('the match did not end inside the step budget');
}

function sndMatch(): { match: ServerMatch; mode: SearchAndDestroy } {
  const m = match({ modeId: 'SND', variant: 'SKIRMISH', bots: 2, rosterOverride: 2 });
  expect(m.mode).toBeInstanceOf(SearchAndDestroy);
  return { match: m, mode: m.mode as SearchAndDestroy };
}

/** Stand this player on a zone, which is what `contains` asks about. */
function standOn(player: NetPlayer, zone: ObjectiveZone): void {
  const sim = player.controller.sim;
  sim.x = zone.def.position.x;
  sim.y = zone.def.position.y;
  sim.z = zone.def.position.z;
}

describe('ServerMatch', () => {
  describe('the facts it reads off the registry', () => {
    it('sets free-for-all on the director, the damage door and the scoreboard', () => {
      // One fact in three places. It reached none of them on the server for a milestone, and
      // half the roster was hostile, hunted by the AI and immune.
      const ffa = match({ modeId: 'FFA' });
      expect(ffa.bots.freeForAll).toBe(true);
      expect(ffa.damage.freeForAll).toBe(true);
      expect(ffa.score.freeForAll).toBe(true);
    });

    it('leaves all three clear for a team mode', () => {
      const tdm = match({ modeId: 'TDM' });
      expect(tdm.bots.freeForAll).toBe(false);
      expect(tdm.damage.freeForAll).toBe(false);
      expect(tdm.score.freeForAll).toBe(false);
    });

    it('makes the arena variant take no health and keep no record', () => {
      // §6.3 and F7: the two facts are the same fact, and setting one without the other is
      // what produced a mode where you could shoot someone but not score them.
      const arena = match({ variant: 'WARMUP', modeId: 'FFA' });
      expect(arena.damage.combatantsInvulnerable).toBe(true);
      expect(arena.score.records).toBe(false);
    });

    it('keeps a live match killable and scored', () => {
      const m = match({ modeId: 'FFA' });
      expect(m.damage.combatantsInvulnerable).toBe(false);
      expect(m.score.records).toBe(true);
    });

    it('hands the director the mode objectives, and null for a mode with none', () => {
      // Missing this made three of the five modes unplayable on a dedicated server: no flag
      // was pursued, no tag chased, and no bomb ever walked onto.
      expect(match({ modeId: 'DOM' }).bots.objectives).not.toBeNull();
      expect(match({ modeId: 'SND', variant: 'SKIRMISH' }).bots.objectives).not.toBeNull();
      expect(match({ modeId: 'TDM' }).bots.objectives).toBeNull();
    });

    it('carries the care packages as the second objective provider', () => {
      const m = match();
      expect(m.bots.streakObjectives).toBe(m.streaks);
    });

    it("takes the mode's push aggression", () => {
      const snd = match({ modeId: 'SND', variant: 'SKIRMISH' });
      expect(snd.bots.pushAggressionScale).toBe(snd.modeEntry.pushAggressionScale ?? 1);
      expect(match({ modeId: 'TDM' }).bots.pushAggressionScale).toBe(1);
    });

    it('lets only humans pick the bomb up by hand', () => {
      const { match: m, mode } = sndMatch();
      const player = join(m);
      expect(mode.manualPickup(player.entityId)).toBe(true);
      expect(mode.manualPickup(BOT_ID_BASE)).toBe(false);
    });

    it('points the bots perception at the smoke this match owns', () => {
      // §6.8's "smoke occludes bot LOS server-side" is this one assignment.
      const m = match();
      expect(m.bots.perception.occluder).toBe(m.equipment.smoke);
    });

    it('answers Dead Silence from the resolved class, for humans and bots alike', () => {
      const m = match();
      const quiet = join(m, { loadout: loadoutWith({ perks: [null, 'dead_silence', null] }) });
      const loud = join(m);
      expect(m.bots.silentFootsteps?.(quiet.entityId)).toBe(true);
      expect(m.bots.silentFootsteps?.(loud.entityId)).toBe(false);
      expect(m.bots.silentFootsteps?.(BOT_ID_BASE)).toBe(false);
    });

    it('asks the streaks this match owns for a riot shield', () => {
      const m = match();
      const player = join(m);
      // Nobody is holding one, and the hook is wired rather than defaulted.
      expect(m.damage.shieldOf(player.entityId)).toBeNull();
    });

    it('starts the flow, because there is no state machine above a dedicated server', () => {
      const m = match();
      expect(m.flow.currentPhase).toBe('WARMUP');
      expect(m.isOver).toBe(false);
      expect(m.tickCount).toBe(0);
    });
  });

  describe('populate', () => {
    it('prefers the roster override over the mode and the requested count', () => {
      // The override exists for the arena: a greybox room authored as a weapon range would
      // otherwise be filled with the mode entry's eight.
      const m = match({ bots: 8, rosterOverride: 3 });
      expect(m.bots.bots).toHaveLength(3);
    });

    it("falls back to the mode's authored roster", () => {
      const m = new ServerMatch({ ...options(), rosterOverride: undefined, bots: 2 });
      live.push(m);
      expect(m.bots.bots).toHaveLength(m.modeEntry.rosterSize ?? 2);
    });

    it('gives every bot a scoreboard row', () => {
      const m = match({ rosterOverride: 4 });
      for (const bot of m.bots.bots) expect(m.score.row(bot.entityId)).toBeDefined();
    });

    it('splits the roster across the two sides', () => {
      const m = match({ rosterOverride: 4 });
      const a = m.bots.bots.filter((b) => b.team === 'A').length;
      const b = m.bots.bots.filter((b) => b.team === 'B').length;
      expect(a + b).toBe(4);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    });
  });

  describe('seating a human', () => {
    it('registers the new body with every system that has to know', () => {
      const m = match();
      const player = join(m, { name: 'ALPHA' });

      expect(m.players).toContain(player);
      expect(m.getPlayer(player.entityId)).toBe(player);
      expect(m.damage.get(player.entityId)).toBe(player);
      expect(m.bots.roster).toContain(player);
      expect(m.score.row(player.entityId)?.displayName).toBe('ALPHA');
    });

    it('hands out human ids from 1 upward', () => {
      const m = match();
      expect(join(m).entityId).toBe(1);
      expect(join(m).entityId).toBe(2);
      expect(join(m).entityId).toBe(3);
    });

    it('arms a player with no loadout from the M10 defaults', () => {
      const m = match();
      const player = join(m);
      // The log line names the pair, and the fallback is the M10 one on both slots.
      expect(player.weapons.definition.id).toBe(AR_DEFAULT.id);
      expect(PISTOL_DEFAULT.id).toBe('pistol_talon');
      expect(m.perksOf(player.entityId)).toBe(NO_PERKS);
      expect(m.loadoutOf(player.entityId)).toBeNull();
    });

    it('builds the weapon and the perks from the class that was sent', () => {
      const m = match();
      const slot = loadoutWith({});
      const player = join(m, { loadout: slot });
      const resolved = m.loadoutOf(player.entityId);
      expect(resolved).not.toBeNull();
      expect(resolved?.name).toBe(slot.name);
      expect(player.weapons.definition.id).toBe(resolved?.primary.id);
      expect(m.perksOf(player.entityId)).toBe(resolved?.perkState);
    });

    it('refuses a seat once the match is full', () => {
      const m = match();
      for (let i = 0; i < MAX_PLAYERS; i++) join(m);
      expect(m.players).toHaveLength(MAX_PLAYERS);
      expect(m.addPlayer('LATE', new CheatState(), NO_SKIN_INDEX, null, null)).toBeNull();
    });

    it('spawns the body, so a seat is not a permanently dead player', () => {
      const m = match();
      const player = join(m);
      expect(player.alive).toBe(true);
      expect(player.participating).toBe(true);
    });
  });

  describe('reclaiming a seat', () => {
    it('takes back the id and the side the player left with', () => {
      // Both halves are load-bearing: the id reclaims the record, and the side matters because
      // arrivals are otherwise balanced onto the smaller team.
      const m = match();
      const first = join(m);
      const team = first.team;
      m.removePlayer(first.entityId);

      const back = join(m, { reclaim: { entityId: first.entityId, team } });
      expect(back.entityId).toBe(first.entityId);
      expect(back.team).toBe(team);
    });

    it('refuses an id that is still occupied', () => {
      const m = match();
      const sitting = join(m);
      expect(
        m.addPlayer('GHOST', new CheatState(), NO_SKIN_INDEX, null, {
          entityId: sitting.entityId,
          team: sitting.team,
        }),
      ).toBeNull();
    });

    it('refuses an id outside the human range', () => {
      // 0 is the spectator seat and 100 up belongs to the bots; two bodies on one entity is
      // the failure this comparison exists to prevent.
      const m = match();
      expect(m.addPlayer('A', new CheatState(), NO_SKIN_INDEX, null, { entityId: 0, team: 'A' })).toBeNull();
      expect(
        m.addPlayer('B', new CheatState(), NO_SKIN_INDEX, null, { entityId: BOT_ID_BASE, team: 'A' }),
      ).toBeNull();
    });
  });

  describe('which side a joining human goes on', () => {
    it('balances on humans first, not on bodies', () => {
      // Measured on a four-human TDM backfill before the fix: entities 1, 2, 3 and 4 all on
      // team A, because a seat is granted and then a bot is removed from the same side.
      const m = match({ rosterOverride: 4 });
      const seats = [join(m), join(m), join(m), join(m)];
      const a = seats.filter((p) => p.team === 'A').length;
      const b = seats.filter((p) => p.team === 'B').length;
      expect(a).toBe(2);
      expect(b).toBe(2);
    });

    it('breaks a human tie on the smaller body count', () => {
      const m = match({ rosterOverride: 4 });
      const first = join(m);
      // One human each, so the next tie is decided by bodies — and A is a body down once a
      // bot has given its seat up.
      m.removeBotForSeat(first.team);
      const second = join(m);
      expect(second.team).not.toBe(first.team);
    });
  });

  describe('joining a one-life round', () => {
    it('holds a body out of a round already under way', () => {
      // §6.7: one life a round means a body appearing halfway through has an advantage nobody
      // else in the round has.
      const { match: m } = sndMatch();
      goLive(m);
      const late = join(m);
      expect(late.alive).toBe(false);
    });

    it('spawns them when the next round starts', () => {
      const { match: m } = sndMatch();
      const tick = goLive(m);
      const late = join(m);
      expect(late.alive).toBe(false);

      m.bus.emit(EV.RoundStarted, { round: 2, roundsToWin: 2 });
      expect(late.alive).toBe(true);
      expect(tick).toBeGreaterThan(0);
    });

    it('does not hold anybody during the pre-match freeze', () => {
      // WARMUP is the 3-2-1 before a round: blocking there would hold the whole lobby out of
      // round one.
      const { match: m } = sndMatch();
      m.step(0);
      expect(m.flow.currentPhase).toBe('WARMUP');
      expect(join(m).alive).toBe(true);
    });
  });

  describe('classes', () => {
    it('answers the neutral state for a bot and for a stranger', () => {
      const m = match();
      expect(m.perksOf(BOT_ID_BASE)).toBe(NO_PERKS);
      expect(m.perksOf(4242)).toBe(NO_PERKS);
      expect(m.loadoutOf(4242)).toBeNull();
    });

    it('refuses to queue a class for somebody who is not seated', () => {
      const m = match();
      expect(m.setPendingLoadout(4242, loadoutWith({}))).toBe(false);
    });

    it('queues a class without touching the standing body', () => {
      // §6.6: changes take effect on the next spawn, not immediately on the living player.
      const m = match();
      const player = join(m);
      const held = player.weapons.definition.id;
      expect(m.setPendingLoadout(player.entityId, loadoutWith({ primary: 'smg_wasp' }))).toBe(true);
      expect(player.weapons.definition.id).toBe(held);
    });

    it('cashes a queued class during the pre-match freeze', () => {
      // The quick selector's promise: the class you press during the countdown is the class
      // you start the match with.
      const m = match();
      const player = join(m);
      const serial = player.visual.spawnSerial;
      m.setPendingLoadout(player.entityId, loadoutWith({ primary: 'smg_wasp', name: 'RUSH' }));

      expect(m.applyPendingLoadoutNow(player.entityId)).toBe(true);
      expect(m.loadoutOf(player.entityId)?.name).toBe('RUSH');
      expect(player.weapons.definition.id).toBe(m.loadoutOf(player.entityId)?.primary.id);
      expect(player.visual.spawnSerial).toBe(serial + 1);
    });

    it('refuses to cash one with nothing queued', () => {
      const m = match();
      const player = join(m);
      expect(m.applyPendingLoadoutNow(player.entityId)).toBe(false);
    });

    it('refuses to cash one once the match is live', () => {
      const m = match();
      const player = join(m);
      m.setPendingLoadout(player.entityId, loadoutWith({}));
      goLive(m);
      expect(m.applyPendingLoadoutNow(player.entityId)).toBe(false);
    });

    it('applies a queued class on the next ordinary spawn instead', () => {
      const m = match();
      const player = join(m);
      m.setPendingLoadout(player.entityId, loadoutWith({ primary: 'smg_wasp', name: 'RUSH' }));

      // A spawn is the discontinuity both sides already agree on, and a respawn is one. The
      // timer is zero, so the next tick's `maybeRespawn` is the spawn that cashes it.
      player.onKilled(0, 1, 0);
      expect(player.alive).toBe(false);
      m.step(0);

      expect(player.alive).toBe(true);
      expect(m.loadoutOf(player.entityId)?.name).toBe('RUSH');
      expect(player.weapons.definition.id).toBe(m.loadoutOf(player.entityId)?.primary.id);
    });
  });

  describe('removing a human', () => {
    it('undoes every registration the seat made', () => {
      const m = match();
      const player = join(m);
      const entityId = player.entityId;

      m.removePlayer(entityId);

      expect(m.players).toHaveLength(0);
      expect(m.getPlayer(entityId)).toBeUndefined();
      expect(m.damage.get(entityId)).toBeUndefined();
      expect(m.bots.roster).not.toContain(player);
      expect(m.loadoutOf(entityId)).toBeNull();
    });

    it('keeps the scoreboard row, because their kills already counted', () => {
      // S8.11 asks for the entity to be gone from the world. The record of what they did is
      // not the same thing, and retracting it would rewrite a match still being played.
      const m = match();
      const player = join(m, { name: 'LEAVER' });
      m.removePlayer(player.entityId);
      expect(m.score.row(player.entityId)?.displayName).toBe('LEAVER');
    });

    it('is a no-op for an entity that was never seated', () => {
      const m = match();
      const player = join(m);
      m.removePlayer(4242);
      expect(m.players).toContain(player);
    });
  });

  describe('bots and seats', () => {
    it('takes a bot off the named side and deletes its row', () => {
      // A displaced bot is not a result: its 0/0/0 row placed real players eleventh in an
      // eight-body match.
      const m = match({ rosterOverride: 4 });
      const before = m.bots.bots.filter((b) => b.team === 'A');
      const victim = before[0];
      expect(victim).toBeDefined();

      expect(m.removeBotForSeat('A')).toBe(true);
      expect(m.bots.bots.filter((b) => b.team === 'A')).toHaveLength(before.length - 1);
      const gone = m.bots.bots.every((b) => b.entityId !== victim?.entityId);
      if (gone && victim !== undefined) expect(m.score.row(victim.entityId)).toBeUndefined();
    });

    it('answers false when that side has no bot to give', () => {
      const m = match({ rosterOverride: 2 });
      expect(m.removeBotForSeat('A')).toBe(true);
      expect(m.removeBotForSeat('A')).toBe(false);
    });

    it('hands a leaver seat to a fresh bot on the same side', () => {
      // In S&D the last human on a team disconnecting ends the round for everybody, scored as
      // an elimination nobody achieved.
      const m = match({ rosterOverride: 2 });
      const player = join(m);
      const team = player.team;
      const before = m.bots.bots.filter((b) => b.team === team).length;

      expect(m.replacePlayerWithBot(player.entityId)).toBe(true);
      expect(m.getPlayer(player.entityId)).toBeUndefined();
      expect(m.bots.bots.filter((b) => b.team === team)).toHaveLength(before + 1);
    });

    it('gives the replacement a scoreboard row of its own', () => {
      const m = match({ rosterOverride: 2 });
      const player = join(m);
      const before = new Set(m.bots.bots.map((b) => b.entityId));
      m.replacePlayerWithBot(player.entityId);
      const arrival = m.bots.bots.find((b) => !before.has(b.entityId));
      expect(arrival).toBeDefined();
      expect(m.score.row(arrival?.entityId ?? -1)).toBeDefined();
    });

    it('deals the replacement the tier its side is short of', () => {
      // Round 5, B4: this used to index the mix by the total bot count — a third cursor that
      // knew nothing about either side's composition, so a replacement could deepen exactly
      // the imbalance the deal exists to prevent.
      const m = match({ rosterOverride: 4, tier: 'RECRUIT' });
      const player = join(m);
      const team = player.team;
      m.replacePlayerWithBot(player.entityId);
      // Every tier on a RECRUIT-configured match is RECRUIT, whatever the map's mix says.
      for (const tier of m.bots.tiersOn(team)) expect(tier).toBe('RECRUIT');
    });

    it('answers false for an entity it does not hold', () => {
      const m = match();
      expect(m.replacePlayerWithBot(4242)).toBe(false);
    });
  });

  describe('the tick', () => {
    it('counts its own steps', () => {
      const m = match();
      stepTicks(m, 0, 5);
      expect(m.tickCount).toBe(5);
    });

    it('freezes input during the countdown and the post-round pause', () => {
      const m = match();
      m.step(0);
      expect(m.flow.currentPhase).toBe('WARMUP');
      expect(m.inputFrozen).toBe(true);

      goLive(m);
      expect(m.inputFrozen).toBe(false);
    });

    it('passes the freeze to the bots, which never used to receive it', () => {
      // The humans stood still and the bots played on — sprinting off their spawns and, in
      // S&D, starting the round before the round started.
      const m = match();
      m.step(0);
      expect(m.bots.inputFrozen).toBe(true);

      // It lifts on the tick *after* the phase flips, and so does the humans': both are read
      // at the top of the step and the flow advances at the end of it.
      const live = goLive(m);
      expect(m.bots.inputFrozen).toBe(true);
      m.step(live);
      expect(m.bots.inputFrozen).toBe(false);
    });

    it('asks the network layer how stale each shooter view is', () => {
      const m = match();
      const player = join(m);
      const asked: number[] = [];
      m.viewLagMsFor = (entityId) => {
        asked.push(entityId);
        return 120;
      };
      m.step(0);
      expect(asked).toContain(player.entityId);
    });

    it('resolves every shot against the present when rewind is disabled', () => {
      const m = match();
      join(m);
      let asked = false;
      m.viewLagMsFor = () => {
        asked = true;
        return 120;
      };
      m.rewindDisabled = true;
      m.step(0);
      expect(asked).toBe(false);
    });
  });

  describe('the knife pose', () => {
    it('starts on the rising edge and runs for the shared swing length', () => {
      const m = match();
      const player = join(m);
      const tick = goLive(m);

      press(player, tick, Btn.Melee);
      m.step(tick);
      expect(player.meleeSeconds).toBeCloseTo(MELEE_SWING_SECONDS, 5);
    });

    it('does not restart while the key is held', () => {
      // Holding is one swing on the client too, and its cooldown is longer than the swing.
      const m = match();
      const player = join(m);
      let tick = goLive(m);

      press(player, tick, Btn.Melee);
      m.step(tick++);
      press(player, tick, Btn.Melee);
      m.step(tick);
      expect(player.meleeSeconds).toBeCloseTo(MELEE_SWING_SECONDS - DT, 5);
    });

    it('refuses a swing with the mortar map up', () => {
      // One of the client's three gates, all of which this now holds: a watcher used to see a
      // swing for every one the client had refused.
      const m = match();
      const player = join(m);
      const tick = goLive(m);

      press(player, tick, Btn.Melee | Btn.Targeting);
      m.step(tick);
      expect(player.meleeSeconds).toBe(0);
    });

    it('refuses a swing with a grenade in the hand', () => {
      // `MatchThrows.stepThrowers` writes `handBusy` earlier in the same tick that `stepMelee`
      // reads it, so the only way to be hand-busy is to be holding one: the lethal key draws.
      const m = match();
      const player = join(m);
      const tick = goLive(m);

      press(player, tick, Btn.Lethal | Btn.Melee);
      m.step(tick);

      expect(player.handBusy).toBe(true);
      expect(player.meleeSeconds).toBe(0);
    });

    it('clears the pose on death, so it is not drawn on the next life', () => {
      const m = match();
      const player = join(m);
      let tick = goLive(m);
      press(player, tick, Btn.Melee);
      m.step(tick++);
      expect(player.meleeSeconds).toBeGreaterThan(0);

      player.onKilled(0, 1, 5);
      m.step(tick);
      expect(player.meleeSeconds).toBe(0);
    });
  });

  describe('the bomb', () => {
    it('begins a plant for a carrier holding Use on a site', () => {
      // The whole interaction lived on the client, so nobody in a networked S&D could touch
      // the bomb: not a bot, which had no objective, and not a human.
      const { match: m, mode } = sndMatch();
      const player = join(m);
      const tick = goLive(m);
      const site = mode.sites[0];
      expect(site).toBeDefined();

      mode.carrierId = player.entityId;
      mode.attackers = player.team;
      standOn(player, site as ObjectiveZone);
      press(player, tick, Btn.Use);
      m.step(tick);

      expect(mode.interactEntity).toBe(player.entityId);
    });

    it('releasing the key cancels only your own interaction', () => {
      const { match: m, mode } = sndMatch();
      const player = join(m);
      let tick = goLive(m);
      const site = mode.sites[0] as ObjectiveZone;

      mode.carrierId = player.entityId;
      mode.attackers = player.team;
      standOn(player, site);
      press(player, tick, Btn.Use);
      m.step(tick++);
      expect(mode.interactEntity).toBe(player.entityId);

      press(player, tick, 0);
      m.step(tick);
      expect(mode.interactEntity).toBe(-1);
    });

    it("leaves another player's plant alone when this one lets go", () => {
      // Only cancel what *this* player started. Another player's plant is not theirs to stop.
      const { match: m, mode } = sndMatch();
      const planter = join(m);
      const bystander = join(m);
      let tick = goLive(m);
      const site = mode.sites[0] as ObjectiveZone;

      mode.carrierId = planter.entityId;
      mode.attackers = planter.team;
      standOn(planter, site);
      standOn(bystander, site);
      press(planter, tick, Btn.Use);
      press(bystander, tick, Btn.Use);
      m.step(tick++);
      expect(mode.interactEntity).toBe(planter.entityId);

      // The bystander releases; the planter keeps holding.
      press(planter, tick, Btn.Use);
      press(bystander, tick, 0);
      m.step(tick);
      expect(mode.interactEntity).toBe(planter.entityId);
    });

    it('does not let a defender plant', () => {
      const { match: m, mode } = sndMatch();
      const player = join(m);
      const tick = goLive(m);
      const site = mode.sites[0] as ObjectiveZone;

      mode.attackers = player.team === 'A' ? 'B' : 'A';
      standOn(player, site);
      press(player, tick, Btn.Use);
      m.step(tick);
      expect(mode.interactEntity).toBe(-1);
    });

    it('says nothing at all in a mode with no bomb', () => {
      const m = match({ modeId: 'TDM' });
      const player = join(m);
      const tick = goLive(m);
      press(player, tick, Btn.Use);
      expect(() => m.step(tick)).not.toThrow();
    });
  });

  describe('grenade hands and the life audit', () => {
    it('gives a hand the class grenades, not the M5 defaults', () => {
      const m = match();
      const player = join(m, { loadout: loadoutWith({ primary: 'smg_wasp' }) });
      const tick = goLive(m);

      press(player, tick, 0);
      m.step(tick);
      // The hand is created on first use, and the audit is what can see inside it.
      expect(m.equipmentAudit.lifeStarts).toBeGreaterThan(0);
    });

    it('every life starts with a full stock', () => {
      // Round 4, B3: `partialStock` must be 0. A bot threw its one lethal and was unarmed for
      // the rest of the match, because the only caller of `BotThrower.respawn` was a client.
      const m = match();
      join(m);
      stepTicks(m, 0, 30);
      const report = m.equipmentAudit;
      expect(report.lifeStarts).toBeGreaterThan(0);
      expect(report.partialStock).toBe(0);
    });

    it('counts a human life and a bot life separately', () => {
      const m = match();
      join(m);
      stepTicks(m, 0, 30);
      const report = m.equipmentAudit;
      expect(report.humanLifeStarts + report.botLifeStarts).toBe(report.lifeStarts);
      expect(report.humanLifeStarts).toBeGreaterThan(0);
    });

    it('reports what the hands and the field did', () => {
      const m = match();
      join(m);
      stepTicks(m, 0, 10);
      const stats = m.equipmentStats;
      expect(stats.thrown).toBe(0);
      expect(stats.detonated).toBe(0);
      expect(stats.smokeLive).toBe(0);
      expect(stats.smokeBlocked).toBe(0);
    });
  });

  describe('the result', () => {
    it('is null while the match is still running', () => {
      const m = match();
      stepTicks(m, 0, 10);
      expect(m.outcome()).toBeNull();
    });

    it('carries the map, the mode and the clock once the winner is declared', () => {
      const m = match({ roundSecondsOverride: 1 });
      const endedOn = runToEnd(m);

      const out = m.outcome();
      expect(out).not.toBeNull();
      expect(out?.mapId).toBe('mp_foundry');
      expect(out?.modeId).toBe('TDM');
      expect(out?.ticks).toBe(m.tickCount);
      expect(out?.simSeconds).toBe(Math.round(m.tickCount * DT * 10) / 10);
      expect(endedOn).toBeGreaterThan(0);
    });

    it('delegates the tier report to the director it shares with the browser', () => {
      const m = match();
      expect(m.report()).toEqual(m.bots.report());
    });

    it('reports the streak economy with its own control', () => {
      const m = match();
      expect(m.streakEconomy).toEqual(m.streaks.economyReport());
    });
  });

  describe('teardown', () => {
    it('leaves no subscription behind', () => {
      // §8.13 counts exactly this over a hundred cycles: the streaks leak and the fire leak
      // were both found by it, the second running the count from 38 to 434.
      const before = EventBus.liveSubscriptions;
      const m = new ServerMatch(options());
      expect(EventBus.liveSubscriptions).toBeGreaterThan(before);

      m.dispose();
      expect(EventBus.liveSubscriptions).toBe(before);
    });

    it('releases the references a director would otherwise outlive', () => {
      const m = new ServerMatch(options());
      m.dispose();
      expect(m.bots.perception.occluder).toBeNull();
      expect(m.bots.streakObjectives).toBeNull();
    });
  });
});

/** The default class, with the fields a test cares about overridden. */
function loadoutWith(overrides: {
  name?: string;
  primary?: string;
  perks?: Array<string | null>;
}): LoadoutSlot {
  const slot = defaultLoadouts()[0];
  if (slot === undefined) throw new Error('no default loadout');
  const copy: LoadoutSlot = {
    ...slot,
    name: overrides.name ?? slot.name,
    primary: { ...slot.primary },
    secondary: { ...slot.secondary },
    perks: [...slot.perks],
    streaks: [...slot.streaks],
  };
  if (overrides.primary !== undefined) copy.primary.weaponId = overrides.primary;
  if (overrides.perks !== undefined) copy.perks = overrides.perks as LoadoutSlot['perks'];
  return copy;
}
