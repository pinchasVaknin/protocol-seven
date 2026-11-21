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
 * The two cases at the bottom used to pin behaviour that was **wrong** rather than designed,
 * both about the window. BACKLOG #38 fixed both on 2026-11-22 and they now assert the window
 * holding what it admits; each carries the shape it had before it.
 */

/** The ring length `InputBuffer` is built on, which is private to it. 241 ticks is 4.0 s. */
const RING = MAX_TICK_SKEW * 2 + 1;

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
    expect(buffer.accept(command(1, 200 + MAX_TICK_SKEW + 1), 200)).toBe(false);
    expect(buffer.accept(command(2, 200 - MAX_TICK_SKEW - 1), 200)).toBe(false);
    expect(buffer.stats()).toMatchObject({ accepted: 0, outOfWindow: 2 });
  });

  it('accepts the two ticks exactly on the edge of the window', () => {
    const buffer = new InputBuffer();
    expect(buffer.accept(command(1, 200 - MAX_TICK_SKEW), 200)).toBe(true);
    expect(buffer.accept(command(2, 200 + MAX_TICK_SKEW), 200)).toBe(true);
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

  // BACKLOG #38, fixed 2026-11-22. This case was the reverse: it asserted that the command
  // 64 ticks behind was gone, because `[c - 64, c + 64]` is 129 ticks over 128 slots and the
  // two ends shared one. The window is `MAX_TICK_SKEW` either side of a ring exactly that
  // many ticks long now, so the furthest apart two accepted ticks can be is one less than the
  // ring and no two of them can collide.
  it('keeps both ends of the window, which no longer share a slot', () => {
    const buffer = new InputBuffer();
    const behind = 200 - MAX_TICK_SKEW;
    const ahead = 200 + MAX_TICK_SKEW;
    expect(behind % RING).not.toBe(ahead % RING);

    buffer.accept(command(1, behind), 200);
    buffer.accept(command(2, ahead), 200);

    expect(buffer.stats()).toMatchObject({ accepted: 2, outOfWindow: 0 });
    expect(buffer.take(behind).seq).toBe(1);
    expect(buffer.stats().starved).toBe(0);
    expect(buffer.take(ahead).seq).toBe(2);
  });

  // BACKLOG #38's other half, same date. This case asserted the drop: the boundary admitted a
  // skew of 120 and the buffer's own window was 64, so 65 to 120 ticks out passed one check
  // and was counted `outOfWindow` by the next.
  it('keeps every command the validator accepted, out to the skew limit', () => {
    const buffer = new InputBuffer();
    const far = command(1, 200 + MAX_TICK_SKEW);
    expect(validateCommand(far, 200)).toBe(Reject.None);
    expect(buffer.accept(far, 200)).toBe(true);
    expect(buffer.stats().outOfWindow).toBe(0);

    // And one tick further, which the validator rejects too: the two now agree on the edge.
    const past = command(2, 200 + MAX_TICK_SKEW + 1);
    expect(validateCommand(past, 200)).toBe(Reject.TickSkew);
    expect(buffer.accept(past, 200)).toBe(false);
    expect(buffer.stats().outOfWindow).toBe(1);
  });
});
