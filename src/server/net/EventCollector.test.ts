import { describe, expect, it } from 'vitest';
import { createGameBus, EV } from '../../shared/core/Events';
import { decodeHeader, readEvents, type FiredEvent } from '../../shared/net/Messages';
import { ByteReader } from '../../shared/net/Wire';
import { EventCollector } from './EventCollector';

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
