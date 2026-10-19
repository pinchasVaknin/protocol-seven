import { describe, expect, it } from 'vitest';
import { NULL_COMMAND, type MutableInputCommand } from '../../shared/core/InputCommand';
import { MAX_TICK_SKEW } from '../../shared/net/Protocol';
import { InputBuffer } from './InputBuffer';
import { Reject, validateCommand } from './Validation';

/**
 * The ring that makes a client's commands continuous (B1).
 *
 * S6.2's promise is the thing under test: commands are applied in *tick* order however they
 * arrive, a gap repeats the last command rather than applying nothing, and a tick always gets
 * exactly one command — because `PlayerController.step` consumes one per tick and a skip would
 * desync this client's tick count from the server's.
 *
 * Two cases at the bottom pin behaviour that is **wrong** rather than behaviour that is
 * designed; both are about the window, and both are in `BACKLOG.md` with the numbers.
 */

/** The ring length `InputBuffer` is built on, which is private to it. 128 ticks is 2.1 s. */
const RING = 128;

function command(seq: number, tickIndex: number, moveZ = 1): MutableInputCommand {
  return { seq, tickIndex, moveX: 0, moveZ, yaw: 0, pitch: 0, buttons: 0, sampledAtMs: 0 };
}

describe('InputBuffer', () => {
  it('hands a tick the command that was sampled for it', () => {
    const buffer = new InputBuffer();
    expect(buffer.accept(command(1, 10), 10)).toBe(true);

    const taken = buffer.take(10);
    expect([taken.seq, taken.tickIndex]).toEqual([1, 10]);
    expect(buffer.stats().accepted).toBe(1);
  });

  it('applies commands in tick order however they arrive', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(2, 12), 10);
    buffer.accept(command(1, 10), 10);

    expect(buffer.take(10).seq).toBe(1);
    expect(buffer.take(12).seq).toBe(2);
  });

  it('refuses the redundant copy of a command it already holds', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(1, 10), 10);

    expect(buffer.accept(command(1, 10), 10)).toBe(false);
    expect(buffer.stats()).toMatchObject({ accepted: 1, duplicate: 1 });
  });

  it('takes a fresh command for a tick it already holds, when the seq differs', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(1, 10, 1), 10);
    expect(buffer.accept(command(2, 10, -1), 10)).toBe(true);

    const taken = buffer.take(10);
    expect([taken.seq, taken.moveZ]).toEqual([2, -1]);
    expect(buffer.stats()).toMatchObject({ accepted: 2, duplicate: 0 });
  });

  it('counts a command outside the window in either direction', () => {
    const buffer = new InputBuffer();
    expect(buffer.accept(command(1, 200 + RING / 2 + 1), 200)).toBe(false);
    expect(buffer.accept(command(2, 200 - RING / 2 - 1), 200)).toBe(false);
    expect(buffer.stats()).toMatchObject({ accepted: 0, outOfWindow: 2 });
  });

  it('accepts the two ticks exactly on the edge of the window', () => {
    const buffer = new InputBuffer();
    expect(buffer.accept(command(1, 200 - RING / 2), 200)).toBe(true);
    expect(buffer.accept(command(2, 200 + RING / 2), 200)).toBe(true);
  });

  it('repeats the last command on a gap, stamped with the tick it is applied on', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(5, 10, 1), 10);
    buffer.take(10);

    const repeat = buffer.take(11);
    expect([repeat.seq, repeat.moveZ]).toEqual([5, 1]);
    // The tick is the one being simulated, not the one the command was sampled for: the
    // tac-sprint double-tap window measures against it.
    expect(repeat.tickIndex).toBe(11);
    expect(buffer.stats()).toMatchObject({ repeated: 1, starved: 0 });
  });

  it('simulates the null command until something has arrived', () => {
    const buffer = new InputBuffer();
    expect(buffer.take(0)).toBe(NULL_COMMAND);
    expect(buffer.take(1)).toBe(NULL_COMMAND);
    expect(buffer.stats()).toMatchObject({ starved: 2, repeated: 0 });
  });

  it('consumes a slot, so the ring cannot serve a stale command when it wraps', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(1, 10), 10);
    buffer.take(10);

    // 128 ticks later the same slot comes round. Nothing has been accepted for it.
    buffer.take(10 + RING);
    expect(buffer.stats().repeated).toBe(1);
  });

  it('acks the highest seq it has ever accepted, not the newest arrival', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(9, 20), 20);
    buffer.accept(command(4, 18), 20);

    expect(buffer.lastSeq).toBe(9);
  });

  it('records the tick the last command was applied on', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(1, 30), 30);
    expect(buffer.lastAppliedTick).toBe(-1);

    buffer.take(30);
    expect(buffer.lastAppliedTick).toBe(30);
    // A repeat is an application too.
    buffer.take(31);
    expect(buffer.lastAppliedTick).toBe(30);
  });

  it('reports starvation as a delta, so a reader at 20 Hz sees every event', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(1, 10), 10);
    buffer.take(10);
    buffer.take(11);
    buffer.take(12);

    expect(buffer.takeStarvation()).toBe(2);
    expect(buffer.takeStarvation()).toBe(0);
  });

  it('caps the starvation signal well below the byte it is sent in', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(1, 0), 0);
    buffer.take(0);
    for (let tick = 1; tick <= 200; tick++) buffer.take(tick);

    expect(buffer.takeStarvation()).toBe(60);
  });

  it('forgets everything on a respawn, the ack included', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(7, 10), 10);
    buffer.take(10);

    buffer.reset();
    expect([buffer.lastSeq, buffer.lastAppliedTick]).toEqual([-1, -1]);
    // The slot is gone and there is no last command to repeat, so the tick starves.
    expect(buffer.take(10)).toBe(NULL_COMMAND);
    expect(buffer.takeStarvation()).toBe(0);
  });

  it('keeps the counters across a reset, because they are the diagnosis', () => {
    const buffer = new InputBuffer();
    buffer.accept(command(1, 10), 10);
    buffer.accept(command(1, 10), 10);
    buffer.reset();

    expect(buffer.stats()).toMatchObject({ accepted: 1, duplicate: 1 });
  });

  // Pins current behaviour; suspected bug: the accept window is one tick wider than the ring,
  // so its two ends share a slot (BACKLOG #38).
  it('loses a command 64 ticks behind when one 64 ticks ahead claims its slot', () => {
    const buffer = new InputBuffer();
    const behind = 200 - RING / 2;
    const ahead = 200 + RING / 2;
    expect(behind % RING).toBe(ahead % RING);

    buffer.accept(command(1, behind), 200);
    buffer.accept(command(2, ahead), 200);

    // Both were accepted; only the later one is still there.
    expect(buffer.stats()).toMatchObject({ accepted: 2, outOfWindow: 0 });
    buffer.take(behind);
    expect(buffer.stats().starved).toBe(1);
    expect(buffer.take(ahead).seq).toBe(2);
  });

  // Pins current behaviour; suspected bug: `MAX_TICK_SKEW` and the ring's half-window disagree,
  // against what this file's own comment claims (BACKLOG #38).
  it('drops a command the validator accepted, because the skew limit is wider than the ring', () => {
    const buffer = new InputBuffer();
    const cmd = command(1, 200 + RING / 2 + 1);
    expect(MAX_TICK_SKEW).toBeGreaterThan(RING / 2);
    expect(validateCommand(cmd, 200)).toBe(Reject.None);

    expect(buffer.accept(cmd, 200)).toBe(false);
    expect(buffer.stats().outOfWindow).toBe(1);
  });
});
