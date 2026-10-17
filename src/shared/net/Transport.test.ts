import { describe, expect, it } from 'vitest';
import type { InputCommand } from '../core/InputCommand';
import { LocalBotTransport } from './Transport';

/**
 * The local command queue, pinned before A23 touched this file (it had no tests).
 *
 * `LocalBotTransport` is the `ICommandQueue` a bot and the solo loop use, and the shape of its
 * contract is what lets the same match code run with a socket under it or nothing at all: a
 * closed queue swallows what it is handed, a full one drops the *oldest* so input stays fresh,
 * and `drain` hands back slots it owns rather than copies.
 */

function cmd(seq: number): InputCommand {
  return {
    seq,
    tickIndex: seq,
    moveX: 0,
    moveZ: 1,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    sampledAtMs: 0,
  };
}

function drained(q: LocalBotTransport, max: number): number[] {
  const out: InputCommand[] = [];
  const n = q.drain(out, max);
  return out.slice(0, n).map((c) => c.seq);
}

describe('LocalBotTransport', () => {
  it('says what it is: local, and with no round trip to report', () => {
    const q = new LocalBotTransport();
    expect(q.kind).toBe('local');
    expect(q.rttMs).toBe(0);
    expect(q.isOpen).toBe(false);
    expect(q.pending).toBe(0);
  });

  it('swallows commands until it is opened', () => {
    const q = new LocalBotTransport();
    q.submit(cmd(1));
    expect(q.pending).toBe(0);
    q.open();
    q.submit(cmd(2));
    expect(q.pending).toBe(1);
    expect(drained(q, 8)).toEqual([2]);
  });

  it('drains in submit order', () => {
    const q = new LocalBotTransport();
    q.open();
    for (let i = 1; i <= 4; i++) q.submit(cmd(i));
    expect(q.pending).toBe(4);
    expect(drained(q, 8)).toEqual([1, 2, 3, 4]);
    expect(q.pending).toBe(0);
  });

  it('hands back no more than asked for, and keeps the rest', () => {
    const q = new LocalBotTransport();
    q.open();
    for (let i = 1; i <= 5; i++) q.submit(cmd(i));
    expect(drained(q, 2)).toEqual([1, 2]);
    expect(q.pending).toBe(3);
    expect(drained(q, 99)).toEqual([3, 4, 5]);
    expect(q.pending).toBe(0);
    expect(drained(q, 4)).toEqual([]);
  });

  it('drops the oldest when nobody is draining, so input stays fresh', () => {
    const q = new LocalBotTransport(4);
    q.open();
    for (let i = 1; i <= 6; i++) q.submit(cmd(i));
    expect(q.pending).toBe(4);
    // The two oldest went, not the two newest: a stale backlog is worse than a gap.
    expect(drained(q, 8)).toEqual([3, 4, 5, 6]);
  });

  it('wraps its ring rather than growing it', () => {
    const q = new LocalBotTransport(3);
    q.open();
    q.submit(cmd(1));
    q.submit(cmd(2));
    expect(drained(q, 1)).toEqual([1]);
    q.submit(cmd(3));
    q.submit(cmd(4));
    expect(q.pending).toBe(3);
    expect(drained(q, 8)).toEqual([2, 3, 4]);
  });

  it('copies the command, so a caller may reuse the one it submitted', () => {
    const q = new LocalBotTransport();
    q.open();
    const reused = { ...cmd(1) };
    q.submit(reused);
    reused.seq = 99;
    reused.moveZ = -1;
    const out: InputCommand[] = [];
    q.drain(out, 1);
    expect(out[0]?.seq).toBe(1);
    expect(out[0]?.moveZ).toBe(1);
  });

  it('closing empties it, and reopening starts clean', () => {
    const q = new LocalBotTransport();
    q.open();
    q.submit(cmd(1));
    q.close();
    expect(q.isOpen).toBe(false);
    expect(q.pending).toBe(0);
    q.open();
    q.submit(cmd(2));
    expect(drained(q, 8)).toEqual([2]);
  });
});
