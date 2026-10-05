import { describe, expect, it } from 'vitest';
import {
  Btn,
  CommandRing,
  copyCommand,
  type InputCommand,
  isDown,
  justPressed,
  justReleased,
  LIVE_BUTTONS,
  type MutableInputCommand,
  NULL_COMMAND,
} from './InputCommand';

/**
 * Characterization of the input seam (S4.2).
 *
 * The bit values are pinned as literals because M10 sends this bitfield over the wire: a bit
 * that moved would make a client and a server disagree about which key was held, and the
 * symptom would look like input lag rather than a renumbering. `LIVE_BUTTONS` is pinned both as
 * the literal mask and as the OR of `Btn`, so a bit added later without widening the mask fails
 * the first assertion while the second still passes — which is exactly the failure the
 * `Object.values` form was introduced to prevent.
 */

function command(fields: Partial<MutableInputCommand> = {}): InputCommand {
  return {
    seq: 7,
    tickIndex: 400,
    moveX: 0.5,
    moveZ: -0.5,
    yaw: 1.25,
    pitch: -0.25,
    buttons: Btn.Fire | Btn.Sprint,
    sampledAtMs: 1234.5,
    ...fields,
  };
}

describe('Btn', () => {
  it('pins every bit position, because the wire carries these', () => {
    expect(Btn.Jump).toBe(1 << 0);
    expect(Btn.Crouch).toBe(1 << 1);
    expect(Btn.Sprint).toBe(1 << 2);
    expect(Btn.Ads).toBe(1 << 3);
    expect(Btn.Fire).toBe(1 << 4);
    expect(Btn.Reload).toBe(1 << 5);
    expect(Btn.Scoreboard).toBe(1 << 6);
    expect(Btn.SwapWeapon).toBe(1 << 7);
    expect(Btn.Lethal).toBe(1 << 8);
    expect(Btn.Tactical).toBe(1 << 9);
    expect(Btn.Slot1).toBe(1 << 10);
    expect(Btn.Slot2).toBe(1 << 11);
    expect(Btn.FieldUpgrade).toBe(1 << 12);
    expect(Btn.Streak1).toBe(1 << 13);
    expect(Btn.Streak2).toBe(1 << 14);
    expect(Btn.Streak3).toBe(1 << 15);
    expect(Btn.Use).toBe(1 << 16);
    expect(Btn.Melee).toBe(1 << 17);
    expect(Btn.Targeting).toBe(1 << 18);
  });

  it('has nineteen distinct bits and no duplicates', () => {
    const bits = Object.values(Btn);

    expect(bits).toHaveLength(19);
    expect(new Set(bits).size).toBe(19);
  });
});

describe('LIVE_BUTTONS', () => {
  it('is the mask of bits 0 to 18', () => {
    expect(LIVE_BUTTONS).toBe(0x0007ffff);
    expect(LIVE_BUTTONS).toBe(524287);
  });

  it('is the union of Btn, so the mask cannot fall behind a new bit', () => {
    expect(LIVE_BUTTONS).toBe(Object.values(Btn).reduce((mask, bit) => mask | bit, 0));
  });

  it('admits every bit Btn declares', () => {
    for (const bit of Object.values(Btn)) {
      expect(LIVE_BUTTONS & bit).toBe(bit);
    }
  });
});

describe('isDown', () => {
  it('is true only for a bit present in the word', () => {
    const held = Btn.Fire | Btn.Sprint;

    expect(isDown(held, Btn.Fire)).toBe(true);
    expect(isDown(held, Btn.Sprint)).toBe(true);
    expect(isDown(held, Btn.Jump)).toBe(false);
    expect(isDown(0, Btn.Fire)).toBe(false);
  });
});

describe('justPressed', () => {
  it('is the rising edge and nothing else', () => {
    expect(justPressed(Btn.Jump, 0, Btn.Jump)).toBe(true);
    expect(justPressed(Btn.Jump, Btn.Jump, Btn.Jump)).toBe(false);
    expect(justPressed(0, Btn.Jump, Btn.Jump)).toBe(false);
    expect(justPressed(0, 0, Btn.Jump)).toBe(false);
  });

  it('ignores the other bits in the word', () => {
    expect(justPressed(Btn.Jump | Btn.Fire, Btn.Fire, Btn.Jump)).toBe(true);
    expect(justPressed(Btn.Jump | Btn.Fire, Btn.Jump, Btn.Jump)).toBe(false);
  });
});

describe('justReleased', () => {
  it('is the falling edge and nothing else', () => {
    expect(justReleased(0, Btn.Lethal, Btn.Lethal)).toBe(true);
    expect(justReleased(Btn.Lethal, Btn.Lethal, Btn.Lethal)).toBe(false);
    expect(justReleased(Btn.Lethal, 0, Btn.Lethal)).toBe(false);
    expect(justReleased(0, 0, Btn.Lethal)).toBe(false);
  });
});

describe('copyCommand', () => {
  it('copies all eight fields into the destination', () => {
    const src = command();
    const dst: MutableInputCommand = {
      seq: 0,
      tickIndex: 0,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: 0,
    };

    copyCommand(src, dst);

    expect(dst).toEqual({
      seq: 7,
      tickIndex: 400,
      moveX: 0.5,
      moveZ: -0.5,
      yaw: 1.25,
      pitch: -0.25,
      buttons: Btn.Fire | Btn.Sprint,
      sampledAtMs: 1234.5,
    });
  });

  it('writes into the destination rather than replacing it', () => {
    const dst: MutableInputCommand = {
      seq: 0,
      tickIndex: 0,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: 0,
    };
    const before = dst;

    copyCommand(command({ seq: 1 }), dst);

    expect(dst).toBe(before);
    expect(dst.seq).toBe(1);
  });
});

describe('CommandRing', () => {
  it('refuses a capacity below two', () => {
    expect(() => new CommandRing(1)).toThrow('CommandRing capacity must be >= 2');
    expect(() => new CommandRing(0)).toThrow('CommandRing capacity must be >= 2');
    expect(() => new CommandRing(-1)).toThrow('CommandRing capacity must be >= 2');
  });

  it('exposes its capacity', () => {
    expect(new CommandRing(8).capacity).toBe(8);
  });

  it('hands out a fresh zeroed slot', () => {
    const ring = new CommandRing(2);

    expect(ring.next()).toEqual({
      seq: 0,
      tickIndex: 0,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: 0,
    });
  });

  it('hands out distinct slots until it wraps, then reuses them in order', () => {
    const ring = new CommandRing(3);

    const a = ring.next();
    const b = ring.next();
    const c = ring.next();

    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);

    expect(ring.next()).toBe(a);
    expect(ring.next()).toBe(b);
    expect(ring.next()).toBe(c);
  });

  it('a reused slot still carries what the previous owner wrote: callers overwrite, not clear', () => {
    const ring = new CommandRing(2);

    const first = ring.next();
    first.seq = 42;
    ring.next();

    expect(ring.next()).toBe(first);
    expect(first.seq).toBe(42);
  });
});

describe('NULL_COMMAND', () => {
  it('is the zero command with negative sequence and tick', () => {
    expect(NULL_COMMAND).toEqual({
      seq: -1,
      tickIndex: -1,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: 0,
    });
  });

  it('is frozen, so the sim cannot be handed a mutated one', () => {
    expect(Object.isFrozen(NULL_COMMAND)).toBe(true);
  });

  it('holds no button down', () => {
    for (const bit of Object.values(Btn)) {
      expect(isDown(NULL_COMMAND.buttons, bit)).toBe(false);
    }
  });
});
