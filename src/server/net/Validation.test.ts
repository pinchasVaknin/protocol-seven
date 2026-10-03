import { describe, expect, it } from 'vitest';
import { Btn, LIVE_BUTTONS, type MutableInputCommand } from '../../shared/core/InputCommand';
import { Reject, validateCommand } from './Validation';

/**
 * The buttons mask at the server's door (2026-09-28).
 *
 * It was a literal, eighteen bits wide because `Btn.Melee` was the highest bit — so the first bit
 * added after it, `Btn.Targeting`, would have been dropped on arrival and the server would have gone
 * on firing the click that confirms a mortar mark, with nothing anywhere to say why. The mask is
 * `Btn`'s own union now; these hold it there.
 */

function command(buttons: number): MutableInputCommand {
  return { seq: 1, tickIndex: 100, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons, sampledAtMs: 0 };
}

describe('validateCommand, the buttons', () => {
  it('keeps every bit Btn names, the newest included', () => {
    for (const bit of Object.values(Btn)) {
      const cmd = command(bit);
      expect(validateCommand(cmd, 100)).toBe(Reject.None);
      expect(cmd.buttons).toBe(bit);
    }
    const all = command(LIVE_BUTTONS);
    validateCommand(all, 100);
    expect(all.buttons & Btn.Targeting).toBe(Btn.Targeting);
  });

  it('drops the bits nothing names', () => {
    const cmd = command(Btn.Fire | (1 << 30));
    validateCommand(cmd, 100);
    expect(cmd.buttons).toBe(Btn.Fire);
  });
});
