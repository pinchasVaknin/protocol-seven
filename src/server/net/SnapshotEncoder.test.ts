import { describe, expect, it } from 'vitest';
import { decodeHeader } from '../../shared/net/Messages';
import {
  makeSnapshotHeader,
  readSnapshotHeader,
  readSnapshotOwnerPresent,
} from '../../shared/net/MessageSnapshot';
import { makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import { ByteReader } from '../../shared/net/Wire';
import { BASELINE_HISTORY } from './Session';
import { SnapshotEncoder } from './SnapshotEncoder';

/**
 * The baseline ring: which snapshot an ack can still name, and what happens at the 16-bit wrap.
 *
 * `encode` issues ids 1..0xffff and then starts over, which at 20 Hz is a little under 55
 * minutes of uptime — well inside one server's life. Everything here is about the moment the
 * ids stop ascending, because the eviction rule used to assume they never would.
 *
 * A real client never acks the snapshot just sent: it acks the one that reached it a round trip
 * ago. `ACK_LAG` is that gap, and it is the whole reason the wrap was visible in the first
 * place — with an instant ack the broken ring still worked, because the one slot it had left
 * always held the newest frame.
 */

/** Snapshots between one being sent and that client's ack for it arriving. ~100 ms at 20 Hz. */
const ACK_LAG = 4;

function body(entityId: number): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.displayName = `E${entityId}`;
  return e;
}

/**
 * One client on this encoder, acking `lag` frames behind. Call the result to send `n` more
 * snapshots; it answers with how many of those had to go out in full.
 *
 * The ack history lives in the closure rather than in each call, because the question the wrap
 * test asks is what happens to a client that has been acking all along.
 */
function client(enc: SnapshotEncoder, lag: number): (n: number) => number {
  const header = makeSnapshotHeader();
  const entities = [body(1), body(2)];
  const sent: number[] = [];

  return (n: number): number => {
    const before = enc.stats.fullSnapshots;
    for (let i = 0; i < n; i++) {
      const acked = sent.length > lag ? (sent[sent.length - 1 - lag] ?? 0) : 0;
      enc.encode(header, acked, null, entities, entities.length, 0);
      sent.push(header.snapshotId);
    }
    return enc.stats.fullSnapshots - before;
  };
}

describe('the baseline ring', () => {
  it('sends the opening snapshots in full and deltas after that', () => {
    // Nothing to ack until the first one has made the round trip, so those are full by
    // definition; everything after is a delta.
    expect(client(new SnapshotEncoder(), ACK_LAG)(64)).toBe(ACK_LAG + 1);
  });

  it('falls back to a full snapshot when the ack is older than the ring', () => {
    expect(client(new SnapshotEncoder(), BASELINE_HISTORY + 1)(64)).toBe(64);
  });

  /**
   * The regression. Before the head replaced the minimum-id scan, the frames either side of the
   * wrap stranded thirty-one of the thirty-two slots: the pre-wrap ids near 65,535 were never
   * the minimum again, so eviction fell on whichever slot held the newest frame and the ring
   * was one deep from then on. An ack four frames old never resolved, and every snapshot after
   * the wrap went out in full — about ten times the bytes, for the rest of the process's life.
   */
  it('still resolves a lagging ack across the 16-bit id wrap', () => {
    const send = client(new SnapshotEncoder(), ACK_LAG);
    // Up to the wrap. Ids run 1..0xffff, so this leaves the ring sitting on the boundary.
    send(0xffff - 8);
    // Through it, and well past: the ring is 32 deep, so by now every pre-wrap id is gone.
    expect(send(256)).toBe(0);
  });
});

/**
 * Removals, the counters, and the one buffer (B2b).
 *
 * The ring had three cases and the rest of the class had none. The removal list is the half of
 * "absent is removed" that the encoder owns: S8.11 tests that a disconnected player leaves no
 * ghost standing on the map, and "the client eventually times it out" is not an answer when the
 * client cannot tell gone from unchanged.
 *
 * Read off the bytes rather than through a decoder, because the symmetric reader lives in the
 * client: after the header and the owner block comes the removal count, then that many ids.
 */
function removalsIn(frame: Uint8Array): number[] {
  const r = new ByteReader(frame);
  const head = decodeHeader(r);
  if (head.kind !== 'snapshot') throw new Error(`decoded as ${head.kind}`);
  readSnapshotHeader(r, makeSnapshotHeader());
  if (readSnapshotOwnerPresent(r)) throw new Error('these frames carry no owner');
  // The cheat mask is written after the owner block, present or not — see `writeSnapshotOwner`.
  r.u8v();
  const count = r.u8v();
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(r.u8v());
  return out;
}

describe('a body that has left', () => {
  it('is named as a removal to a client whose baseline still had it', () => {
    const enc = new SnapshotEncoder();
    const header = makeSnapshotHeader();
    const both = [body(1), body(2)];

    enc.encode(header, 0, null, both, 2, 0);
    const first = header.snapshotId;
    // Entity 2 has gone, and this client's ack still names the frame that had it.
    const frame = enc.encode(header, first, null, both, 1, 0);

    expect(removalsIn(frame)).toEqual([2]);
  });

  it('is named to nobody when the roster did not change', () => {
    const enc = new SnapshotEncoder();
    const header = makeSnapshotHeader();
    const both = [body(1), body(2)];

    enc.encode(header, 0, null, both, 2, 0);
    const first = header.snapshotId;

    expect(removalsIn(enc.encode(header, first, null, both, 2, 0))).toEqual([]);
  });

  it('is not repeated once the client acks a frame that never had it', () => {
    const enc = new SnapshotEncoder();
    const header = makeSnapshotHeader();
    const both = [body(1), body(2)];

    enc.encode(header, 0, null, both, 2, 0);
    const withBoth = header.snapshotId;
    enc.encode(header, withBoth, null, both, 1, 0);
    const withoutIt = header.snapshotId;

    expect(removalsIn(enc.encode(header, withoutIt, null, both, 1, 0))).toEqual([]);
  });

  it('is named on a full snapshot too, where there is no baseline to diff against', () => {
    const enc = new SnapshotEncoder();
    const header = makeSnapshotHeader();
    const both = [body(1), body(2)];

    enc.encode(header, 0, null, both, 2, 0);
    // Ack nothing: a full snapshot, so nothing is known to be missing.
    expect(removalsIn(enc.encode(header, 0, null, both, 1, 0))).toEqual([]);
  });
});

describe('what the encoder reports', () => {
  it('counts the snapshots and the bytes, and averages them', () => {
    const enc = new SnapshotEncoder();
    const header = makeSnapshotHeader();
    const entities = [body(1), body(2)];

    expect(enc.meanBytes).toBe(0);

    const first = enc.encode(header, 0, null, entities, 2, 0).length;
    expect(enc.stats).toMatchObject({ count: 1, lastBytes: first, totalBytes: first });

    const second = enc.encode(header, header.snapshotId, null, entities, 2, 0).length;
    expect(enc.stats).toMatchObject({ count: 2, lastBytes: second, totalBytes: first + second });
    expect(enc.meanBytes).toBeCloseTo((first + second) / 2, 10);
  });

  it('hands back a view over its own buffer, valid only until the next call', () => {
    const enc = new SnapshotEncoder();
    const header = makeSnapshotHeader();
    const entities = [body(1)];

    const first = enc.encode(header, 0, null, entities, 1, 0);
    const second = enc.encode(header, header.snapshotId, null, entities, 1, 0);

    expect(second.buffer).toBe(first.buffer);
  });
});
