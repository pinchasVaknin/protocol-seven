import { describe, expect, it } from 'vitest';
import { NO_SKIN_INDEX } from '../meta/Skins';
import { decodeHeader, writeHello } from './Messages';
import { PROTOCOL_VERSION } from './Protocol';
import { copyEntitySnapshot, makeEntitySnapshot, readEntity, writeEntity, type EntitySnapshot } from './Snapshot';
import { ByteReader, ByteWriter } from './Wire';

/**
 * The body on the wire (M16, B6): a full write carries `characterIndex`, a delta carries it
 * only when it moved, 255 survives the round trip as "declared none", and the `Hello` carries
 * the same byte after the name. Written against the codec rather than the server, so the
 * shape is pinned where it is defined.
 */

function roundTrip(e: EntitySnapshot, base: EntitySnapshot | null, into: EntitySnapshot): number {
  const w = new ByteWriter(256);
  writeEntity(w, e, base);
  expect(w.overflowed).toBe(false);
  const bytes = w.bytes();
  readEntity(new ByteReader(bytes), into);
  return bytes.length;
}

function standing(entityId: number): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.displayName = 'OPERATOR-011';
  e.x = 3.25;
  e.z = -1.5;
  e.yaw = 0.5;
  return e;
}

describe('EntitySnapshot.characterIndex', () => {
  it('defaults to "declared none" and is copied with the rest', () => {
    expect(makeEntitySnapshot().characterIndex).toBe(NO_SKIN_INDEX);
    const a = standing(1);
    a.characterIndex = 4;
    const b = makeEntitySnapshot();
    copyEntitySnapshot(a, b);
    expect(b.characterIndex).toBe(4);
  });

  it('rides every full write, at 255 as well as at an index', () => {
    for (const index of [0, 6, NO_SKIN_INDEX]) {
      const e = standing(1);
      e.characterIndex = index;
      // A zeroed baseline: the reader must be told, not left to its default.
      const out = makeEntitySnapshot();
      out.characterIndex = 99;
      roundTrip(e, null, out);
      expect(out.characterIndex).toBe(index);
    }
  });

  it('costs nothing on a delta that did not move it, and one byte when it did', () => {
    const base = standing(1);
    base.characterIndex = 2;
    const same = standing(1);
    same.characterIndex = 2;
    const out = makeEntitySnapshot();
    copyEntitySnapshot(base, out);
    const quiet = roundTrip(same, base, out);
    // The id and an empty mask: nothing changed, so nothing is sent.
    expect(quiet).toBe(3);
    expect(out.characterIndex).toBe(2);

    const moved = standing(1);
    moved.characterIndex = 5;
    const changed = roundTrip(moved, base, out);
    expect(changed).toBe(4);
    expect(out.characterIndex).toBe(5);
  });
});

describe('Hello', () => {
  it('carries the skin byte after the name, with no presence byte', () => {
    for (const index of [0, 3, NO_SKIN_INDEX]) {
      const bytes = writeHello(new ByteWriter(256), 'OPERATOR-011', index, null, null);
      const msg = decodeHeader(new ByteReader(bytes));
      expect(msg.kind).toBe('hello');
      if (msg.kind !== 'hello') return;
      expect(msg.version).toBe(PROTOCOL_VERSION);
      expect(msg.name).toBe('OPERATOR-011');
      expect(msg.skinIndex).toBe(index);
      expect(msg.loadout).toBeNull();
      expect(msg.reconnectToken).toBeNull();
    }
  });

  it('is one byte longer than a v17 frame would be, and only that', () => {
    const w = new ByteWriter(256);
    writeHello(w, 'A', 0, null, null);
    // magic u32 + id u8 + version u16 + name (len + 1) + skin u8 + two presence bytes.
    expect(w.bytes().length).toBe(4 + 1 + 2 + 2 + 1 + 1 + 1);
  });
});
