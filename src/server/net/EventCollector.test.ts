import { describe, expect, it } from 'vitest';
import { createGameBus, EV, type GameBus } from '../../shared/core/Events';
import { decodeHeader, readEvents, Ev, type FiredEvent } from '../../shared/net/Messages';
import { MAX_SERVER_FRAME_BYTES } from '../../shared/net/Protocol';
import { ByteReader, ByteWriter } from '../../shared/net/Wire';
import { EventCollector, MAX_TICK_EVENTS } from './EventCollector';

/**
 * A suppressed shot is silent online (protocol v27, 2026-10-04).
 *
 * The answer has to come from the shooter's **resolved** weapon, which only the server holds:
 * `WeaponSystem` puts it on `weapon.fired`, and this is the step that carries it onto the wire.
 */
function firedOnTheWire(minimapPing: boolean): FiredEvent {
  const bus = createGameBus();
  const collector = new EventCollector();
  collector.subscribe(bus);
  collector.begin();
  bus.emit(EV.WeaponFired, {
    weaponId: 'ar_carbine',
    sourceId: 5,
    x: 0,
    y: 1.6,
    z: 0,
    dx: 0,
    dy: 0,
    dz: 1,
    endX: 0,
    endY: 1.6,
    endZ: 20,
    distance: 20,
    shotIndex: 0,
    spreadDeg: 0,
    tracer: true,
    hitTarget: false,
    ammoInMag: 29,
    pellets: 1,
    pelletsHit: 0,
    minimapPing,
  });
  const frame = collector.finish();
  if (frame === null) throw new Error('nothing collected');
  const r = new ByteReader(frame);
  const head = decodeHeader(r);
  if (head.kind !== 'events') throw new Error(`decoded as ${head.kind}`);
  let seen: FiredEvent | null = null;
  readEvents(r, head.count, {
    onFired: (e) => {
      seen = { ...e };
    },
  });
  if (seen === null) throw new Error('no fired event');
  return seen;
}

describe('EventCollector, the fired event', () => {
  it('carries a suppressed shot as silent and an open one as a ping', () => {
    expect(firedOnTheWire(false).minimapPing).toBe(false);
    expect(firedOnTheWire(true).minimapPing).toBe(true);
  });
});

/**
 * The record a tick leaves, and the frame each seat is cut from it (B2b).
 *
 * The class had one test for 238 lines. What it does is two things at once — encode the tick's
 * events once, and *record* each one (its kind, the body it is about, where, whether an enemy may
 * hear it, and which bytes it occupies) — because `SeatEvents` decides per seat from the record
 * and `frameFor` then copies byte ranges out. So these pin the record, the two variant forms, and
 * what `frameFor` does with each of the three `keep` values.
 */

function tickOf(fill: (bus: GameBus) => void, silent: ((id: number) => boolean) | null = null): EventCollector {
  const bus = createGameBus();
  const events = new EventCollector();
  events.silentFootsteps = silent;
  events.subscribe(bus);
  events.begin();
  fill(bus);
  events.finish();
  return events;
}

function step(bus: GameBus, entityId: number, x: number, z: number, quiet = false): void {
  bus.emit(EV.PlayerFootstep, { entityId, x, y: 0, z, speed: 5, heavy: false, quiet, material: 3 });
}

function shot(bus: GameBus, sourceId: number, minimapPing: boolean, endZ = 20): void {
  bus.emit(EV.WeaponFired, {
    weaponId: 'ar_carbine',
    sourceId,
    x: 1,
    y: 1.6,
    z: 2,
    dx: 0,
    dy: 0,
    dz: 1,
    endX: 1,
    endY: 1.6,
    endZ,
    distance: 20,
    shotIndex: 0,
    spreadDeg: 0,
    tracer: true,
    hitTarget: false,
    ammoInMag: 29,
    pellets: 1,
    pelletsHit: 0,
    minimapPing,
  });
}

function hurt(bus: GameBus, sourceId: number, targetId: number): void {
  bus.emit(EV.DamageDealt, {
    sourceId,
    targetId,
    weaponId: 'ar_carbine',
    zone: 'torso',
    amount: 20,
    x: 7,
    y: 1,
    z: 8,
    distance: 20,
    falloffLoss: 0,
    penetrationLoss: 0,
    lethal: false,
    autonomous: false,
  });
}

/** Every event of a frame, as `kind:subject` labels — the shape the cut's own tests use. */
function decode(frame: Uint8Array | null): string[] {
  if (frame === null) return [];
  const r = new ByteReader(frame);
  const head = decodeHeader(r);
  if (head.kind !== 'events') throw new Error(`decoded as ${head.kind}`);
  const out: string[] = [];
  readEvents(r, head.count, {
    onFootstep: (e) => out.push(`step:${e.entityId}:${e.material}${e.quiet ? ':quiet' : ''}`),
    onJump: (e) => out.push(`jump:${e.entityId}:${Math.round(e.speed)}`),
    onLand: (e) => out.push(`land:${e.entityId}:${e.material}`),
    onFired: (e) => out.push(`fired:${e.sourceId}:${e.minimapPing ? 'ping' : 'quiet'}:${e.material}`),
    onImpact: (e) => out.push(`impact:${Math.round(e.z)}:${e.material}`),
    onDamage: (e) => out.push(`hit:${e.sourceId}>${e.targetId}`),
    onKilled: (e) => out.push(`killed:${e.targetId}<${e.sourceId}:${e.killerHealth}`),
  });
  return out;
}

/** The frame a seat is sent, given one `keep` value for every event of the tick. */
function cutTo(events: EventCollector, forms: number[]): string[] {
  const keep = new Uint8Array(MAX_TICK_EVENTS);
  forms.forEach((f, i) => {
    keep[i] = f;
  });
  return decode(events.frameFor(keep, new ByteWriter(MAX_SERVER_FRAME_BYTES)));
}

describe('the tick record', () => {
  it('sends nothing at all for a tick in which nothing happened', () => {
    const bus = createGameBus();
    const events = new EventCollector();
    events.subscribe(bus);
    events.begin();

    expect(events.finish()).toBeNull();
    expect(events.pending).toBe(0);
  });

  it('records what each event is about, and where', () => {
    const events = tickOf((bus) => {
      step(bus, 2, 4, 5);
      shot(bus, 3, true);
      hurt(bus, 3, 2);
      bus.emit(EV.EntityKilled, { targetId: 2, sourceId: 3, weaponId: 'ar_carbine', zone: 'head', killerHealth: 40 });
    });

    expect(events.pending).toBe(4);
    expect([...events.kinds.slice(0, 4)]).toEqual([Ev.Footstep, Ev.Fired, Ev.Damage, Ev.Killed]);
    // The subject is whose position the event carries — and a hit is placed on its target.
    expect([...events.subjects.slice(0, 4)]).toEqual([2, 3, 2, 2]);
    expect([...events.objects.slice(0, 4)]).toEqual([-1, -1, 3, 3]);
    expect([...events.xs.slice(0, 4)]).toEqual([4, 1, 7, 0]);
    expect([...events.zs.slice(0, 4)]).toEqual([5, 2, 8, 0]);
  });

  it('carries the material of the impact that landed just before the shot', () => {
    const events = tickOf((bus) => {
      bus.emit(EV.BulletImpact, { x: 1, y: 1, z: 20, nx: 0, ny: 0, nz: -1, material: 7, penetrated: false });
      shot(bus, 3, true);
    });

    // `Ballistics` emits the impact first, so the shot can say what the round stopped in.
    expect(decode(events.frameFor(Uint8Array.from([1]), new ByteWriter(MAX_SERVER_FRAME_BYTES))))
      .toEqual(['fired:3:ping:7']);
  });

  it('marks a step no enemy may hear: crouched or sliding, or Dead Silence', () => {
    const quiet = tickOf((bus) => step(bus, 2, 0, 0, true));
    expect(quiet.muted[0]).toBe(1);

    const deadSilence = tickOf((bus) => step(bus, 2, 0, 0), (id) => id === 2);
    expect(deadSilence.muted[0]).toBe(1);

    const ordinary = tickOf((bus) => step(bus, 2, 0, 0));
    expect(ordinary.muted[0]).toBe(0);
  });

  it('marks the shot the minimap shows anyway as loud, and the suppressed one not', () => {
    const events = tickOf((bus) => {
      shot(bus, 2, true);
      shot(bus, 3, false);
    });

    expect([events.loud[0], events.loud[1]]).toEqual([1, 0]);
  });

  it('gives a suppressed shot and every kill a variant, and an open shot none', () => {
    const events = tickOf((bus) => {
      shot(bus, 2, true);
      shot(bus, 3, false);
      bus.emit(EV.EntityKilled, { targetId: 4, sourceId: 2, weaponId: 'ar_carbine', zone: 'torso', killerHealth: 60 });
    });

    expect([...events.hasVariant.slice(0, 3)]).toEqual([0, 1, 1]);
  });

  it('makes the suppressed shot\'s variant a bare impact where the round landed (D2)', () => {
    const events = tickOf((bus) => {
      bus.emit(EV.BulletImpact, { x: 1, y: 1, z: 30, nx: 0, ny: 0, nz: -1, material: 5, penetrated: false });
      shot(bus, 3, false, 30);
    });

    expect(cutTo(events, [1])).toEqual(['fired:3:quiet:5']);
    // Nothing about where it came from: the spark and the decal, at the terminus.
    expect(cutTo(events, [2])).toEqual(['impact:30:5']);
  });

  it('makes the kill\'s variant the same line with the killer\'s health zeroed (E3)', () => {
    const events = tickOf((bus) =>
      bus.emit(EV.EntityKilled, { targetId: 4, sourceId: 2, weaponId: 'ar_carbine', zone: 'torso', killerHealth: 60 }),
    );

    expect(cutTo(events, [1])).toEqual(['killed:4<2:60']);
    expect(cutTo(events, [2])).toEqual(['killed:4<2:0']);
  });

  it('carries a jump\'s speed and a landing\'s material', () => {
    const events = tickOf((bus) => {
      bus.emit(EV.PlayerJumped, { entityId: 2, x: 0, y: 0, z: 0, horizontalSpeed: 6 });
      bus.emit(EV.PlayerLanded, { entityId: 2, x: 0, y: 0, z: 0, impactSpeed: 9, stance: 'STAND', material: 4 });
    });

    expect(decode(events.frameFor(Uint8Array.from([1, 1]), new ByteWriter(MAX_SERVER_FRAME_BYTES))))
      .toEqual(['jump:2:6', 'land:2:4']);
  });

  it('starts a fresh record on every tick', () => {
    const bus = createGameBus();
    const events = new EventCollector();
    events.subscribe(bus);

    events.begin();
    step(bus, 2, 0, 0);
    events.finish();
    expect(events.pending).toBe(1);

    events.begin();
    expect(events.pending).toBe(0);
    step(bus, 9, 1, 1);
    events.finish();
    expect([events.pending, events.subjects[0]]).toEqual([1, 9]);
  });

  it('drops an event raised after the frame was sealed', () => {
    const bus = createGameBus();
    const events = new EventCollector();
    events.subscribe(bus);
    events.begin();
    step(bus, 2, 0, 0);
    events.finish();

    step(bus, 3, 5, 5);
    expect(events.pending).toBe(1);
  });

  /**
   * The 255 ceiling, and why the overflow branch below it is not tested.
   *
   * An event is 10 bytes for a step and 24 for a shot, so 255 of them is at most about 6 KiB
   * against `MAX_SERVER_FRAME_BYTES` of 8,192: **the count ceiling always bites first**, and
   * `write`'s `writer.overflowed` branch cannot be reached through the bus. Recorded in
   * `BACKLOG.md` rather than pinned with a test that would have to fake a writer.
   */
  it('stops at the event ceiling and keeps the count honest', () => {
    const events = tickOf((bus) => {
      for (let i = 0; i < MAX_TICK_EVENTS + 45; i++) step(bus, 2, i % 20, 0);
    });

    expect(events.pending).toBe(MAX_TICK_EVENTS);
    const forms = new Array<number>(MAX_TICK_EVENTS).fill(1);
    expect(cutTo(events, forms)).toHaveLength(MAX_TICK_EVENTS);
  });
});

describe('the frame one seat is cut', () => {
  it('keeps nothing for a seat that may have none of it, and still decodes', () => {
    const events = tickOf((bus) => {
      step(bus, 2, 0, 0);
      step(bus, 3, 1, 1);
    });

    expect(cutTo(events, [0, 0])).toEqual([]);
  });

  it('drops an event whose form is its variant when no variant was recorded', () => {
    const events = tickOf((bus) => step(bus, 2, 0, 0));
    // A step has no variant: asking for one sends nothing rather than the whole thing.
    expect(events.hasVariant[0]).toBe(0);
    expect(cutTo(events, [2])).toEqual([]);
  });

  it('drops a form it does not know', () => {
    const events = tickOf((bus) => step(bus, 2, 0, 0));
    expect(cutTo(events, [7])).toEqual([]);
  });

  it('keeps each event in the form that seat may have it', () => {
    const events = tickOf((bus) => {
      step(bus, 2, 0, 0);
      // Its own impact, so the material is this tick's and not whatever the process saw last —
      // see the pin below.
      bus.emit(EV.BulletImpact, { x: 1, y: 1, z: 20, nx: 0, ny: 0, nz: -1, material: 2, penetrated: false });
      shot(bus, 3, false);
      bus.emit(EV.EntityKilled, { targetId: 4, sourceId: 3, weaponId: 'ar_carbine', zone: 'torso', killerHealth: 55 });
    });

    expect(cutTo(events, [0, 2, 2])).toEqual(['impact:20:2', 'killed:4<3:0']);
    expect(cutTo(events, [1, 1, 1])).toEqual(['step:2:3', 'fired:3:quiet:2', 'killed:4<3:55']);
  });

  // Pins current behaviour; suspected bug: `lastImpactMaterial` outlives the tick, the frame and
  // the match (BACKLOG #44).
  it('gives a shot with no impact of its own the last material this process saw', () => {
    // One tick, one impact in concrete (9), and a collector that is then thrown away.
    tickOf((bus) => {
      bus.emit(EV.BulletImpact, { x: 0, y: 0, z: 1, nx: 0, ny: 0, nz: -1, material: 9, penetrated: false });
      shot(bus, 1, true);
    });

    // A different collector, a different bus, a shot that hits nothing: it still reports 9.
    const later = tickOf((bus) => shot(bus, 5, true));
    expect(cutTo(later, [1])).toEqual(['fired:5:ping:9']);
  });
});
