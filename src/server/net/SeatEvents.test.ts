import { describe, expect, it } from 'vitest';
import { createGameBus, EV, type GameBus } from '../../shared/core/Events';
import { decodeHeader, Ev, readEvents } from '../../shared/net/Messages';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import { ByteReader } from '../../shared/net/Wire';
import { EventCollector } from './EventCollector';
import { HEARING_RADIUS_M, SeatEvents } from './SeatEvents';
import { emptyAuditStats, SeatAudit } from './VisibilityAudit';

/**
 * Which sounds each seat is sent (anti-wallhack phase 2, part 2). The viewer, entity 1 on team A,
 * stands at the origin; positions are on the ground plane, where hearing is measured.
 */

function body(entityId: number, x: number, z: number, team: 'A' | 'B', alive = true): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.x = x;
  e.z = z;
  e.flags = (alive ? EFlag.Alive : 0) | (team === 'B' ? EFlag.TeamB : 0);
  return e;
}

function step(bus: GameBus, entityId: number, x: number, z: number, quiet = false): void {
  bus.emit(EV.PlayerFootstep, { entityId, x, y: 0, z, speed: 5, heavy: false, quiet, material: 0 });
}

function tick(fill: (bus: GameBus) => void, silent: (id: number) => boolean = () => false): EventCollector {
  const bus = createGameBus();
  const events = new EventCollector();
  events.silentFootsteps = silent;
  events.subscribe(bus);
  events.begin();
  fill(bus);
  events.finish();
  return events;
}

const NOBODY = (): boolean => false;
const ROSTER = [body(1, 0, 0, 'A'), body(2, 3, 0, 'A'), body(3, 5, 0, 'B'), body(4, 30, 0, 'B')];

/** Which of the tick's events seat 1 is sent, as `kind:entity` strings, decoded off its frame. */
function sentTo(
  events: EventCollector,
  opts: { roster?: EntitySnapshot[]; freeForAll?: boolean; hearsAll?: boolean; spectating?: boolean; hidden?: (id: number) => boolean } = {},
): string[] {
  const roster = opts.roster ?? ROSTER;
  const cut = new SeatEvents();
  const kept = cut.select(events, 1, roster, roster.length, opts.freeForAll ?? false, opts.hearsAll ?? false, opts.spectating ?? false, opts.hidden ?? NOBODY);
  if (kept === 0) return [];
  const r = new ByteReader(events.frameFor(cut.keep, cut.writer));
  const head = decodeHeader(r);
  if (head.kind !== 'events') throw new Error(`decoded as ${head.kind}`);
  const out: string[] = [];
  readEvents(r, head.count, {
    onFootstep: (e) => out.push(`step:${e.entityId}`),
    onJump: (e) => out.push(`jump:${e.entityId}`),
    onLand: (e) => out.push(`land:${e.entityId}`),
    onKilled: (e) => out.push(`killed:${e.targetId}`),
  });
  expect(out.length).toBe(kept);
  return out;
}

describe('a seat\'s sounds', () => {
  it(`sends an enemy's step within ${HEARING_RADIUS_M} m and not beyond, a teammate's always, its own never`, () => {
    const events = tick((bus) => {
      step(bus, 1, 0, 0);
      step(bus, 2, 3, 0);
      step(bus, 3, 5, 0);
      step(bus, 4, 30, 0);
    });
    expect(sentTo(events)).toEqual(['step:2', 'step:3']);
  });

  it('measures on the ground plane, as the bots do: a step on the floor above is still in range', () => {
    const events = tick((bus) => bus.emit(EV.PlayerFootstep, { entityId: 3, x: 5, y: 9, z: 0, speed: 5, heavy: false, quiet: false, material: 0 }));
    expect(sentTo(events)).toEqual(['step:3']);
  });

  it('never sends an enemy a crouched step or a Dead Silence one (D4), but a teammate still hears them', () => {
    const events = tick(
      (bus) => {
        step(bus, 3, 5, 0, true);
        step(bus, 3, 5, 1);
        step(bus, 2, 3, 0, true);
      },
      (id) => id === 3,
    );
    expect(sentTo(events)).toEqual(['step:2']);
  });

  it('sends jumps and landings by the same radius', () => {
    const events = tick((bus) => {
      bus.emit(EV.PlayerJumped, { entityId: 3, x: 5, y: 0, z: 0, horizontalSpeed: 6 });
      bus.emit(EV.PlayerLanded, { entityId: 4, x: 30, y: 0, z: 0, impactSpeed: 6, stance: 'STAND', material: 0 });
    });
    expect(sentTo(events)).toEqual(['jump:3']);
  });

  it('lets everything else through — the kill feed is public', () => {
    const events = tick((bus) => {
      step(bus, 4, 30, 0);
      bus.emit(EV.EntityKilled, { targetId: 4, sourceId: 3, weaponId: 'ar_carbine', zone: 'torso', killerHealth: 50 });
    });
    expect(sentTo(events)).toEqual(['killed:4']);
  });

  it('hears nothing of an Unseen body, and everything on a free cam', () => {
    const events = tick((bus) => {
      step(bus, 3, 5, 0);
      step(bus, 4, 30, 0);
    });
    expect(sentTo(events, { hidden: (id) => id === 3 })).toEqual([]);
    expect(sentTo(events, { hearsAll: true })).toEqual(['step:3', 'step:4']);
  });

  it('in free-for-all there are no teammates', () => {
    const events = tick((bus) => step(bus, 2, 20, 0));
    const roster = [body(1, 0, 0, 'A'), body(2, 20, 0, 'A')];
    expect(sentTo(events, { roster })).toEqual(['step:2']);
    expect(sentTo(events, { roster, freeForAll: true })).toEqual([]);
  });

  it('lets a dead spectator hear what any living teammate hears, not what its corpse does (R7)', () => {
    // The corpse is at the origin; the living teammate is 25 m away, next to enemy 4.
    const roster = [body(1, 0, 0, 'A', false), body(2, 25, 0, 'A'), body(3, 5, 0, 'B'), body(4, 30, 0, 'B')];
    const events = tick((bus) => {
      step(bus, 3, 5, 0);
      step(bus, 4, 30, 0);
    });
    expect(sentTo(events, { roster, spectating: true })).toEqual(['step:4']);
    expect(sentTo(events, { roster })).toEqual(['step:3']);
  });

  it('fails open for a seat whose body is not in the roster yet', () => {
    const events = tick((bus) => step(bus, 4, 30, 0));
    expect(sentTo(events, { roster: [body(4, 30, 0, 'B')] })).toEqual(['step:4']);
  });
});

describe('the sound audit', () => {
  const run = (frame: (events: EventCollector, cut: SeatEvents) => Uint8Array | null): ReturnType<typeof emptyAuditStats> => {
    const events = tick((bus) => {
      step(bus, 3, 5, 0);
      step(bus, 3, 5, 1, true);
      step(bus, 4, 30, 0);
    });
    const cut = new SeatEvents();
    cut.select(events, 1, ROSTER, ROSTER.length, false, false, false, NOBODY);
    const stats = emptyAuditStats();
    new SeatAudit().observeEvents(frame(events, cut), events, 1, ROSTER, ROSTER.length, false, false, false, NOBODY, stats);
    return stats;
  };

  it('passes the cut', () => {
    const stats = run((events, cut) => events.frameFor(cut.keep, cut.writer));
    expect(stats).toMatchObject({ enemySounds: 3, enemySoundsSent: 1, soundsMissing: 0, soundLeaks: 0 });
  });

  it('catches the old stream — everything to everybody — as two leaks', () => {
    const shared = tick((bus) => {
      step(bus, 3, 5, 0);
      step(bus, 3, 5, 1, true);
      step(bus, 4, 30, 0);
    });
    const all = new Uint8Array(255).fill(1);
    const stats = run(() => shared.frameFor(all, new SeatEvents().writer));
    expect(stats).toMatchObject({ enemySoundsSent: 3, soundLeaks: 2, soundsMissing: 0 });
  });

  it('catches a cut that dropped what should have been heard', () => {
    expect(run(() => null)).toMatchObject({ enemySoundsSent: 0, soundsMissing: 1 });
  });
});

describe('frameFor', () => {
  it('keeps the events it is told to, whole and in order', () => {
    const events = tick((bus) => {
      step(bus, 3, 5, 0);
      bus.emit(EV.PlayerJumped, { entityId: 4, x: 30, y: 0, z: 0, horizontalSpeed: 6 });
      step(bus, 2, 3, 0);
    });
    const keep = new Uint8Array(255);
    keep[0] = 1;
    keep[2] = 1;
    const r = new ByteReader(events.frameFor(keep, new SeatEvents().writer));
    const head = decodeHeader(r);
    expect(head).toEqual({ kind: 'events', count: 2 });
    const kinds: number[] = [];
    readEvents(r, 2, { onFootstep: (e) => kinds.push(Ev.Footstep * 100 + e.entityId) });
    expect(kinds).toEqual([Ev.Footstep * 100 + 3, Ev.Footstep * 100 + 2]);
    expect(r.remaining).toBe(0);
  });
});
