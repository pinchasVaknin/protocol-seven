import { describe, expect, it } from 'vitest';
import { aimWarning, type DeviceCapabilities, playability } from './Capabilities';

/**
 * Whether this device can play, and whether it can aim right now (playtest round 5, B8 and F1).
 *
 * Pure functions of a record, which is the whole reason they are in `shared/`: the harness
 * builds no DOM, so without this split every answer here would be a browser claim.
 *
 * The case worth protecting is the **touchscreen laptop**. Gating on `maxTouchPoints` would
 * refuse a machine with a perfectly good trackpad, and F1 asks *does this have something to aim
 * with*, not *does this have a finger*.
 */

function caps(over: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    maxTouchPoints: 0,
    finePointer: true,
    coarsePointer: false,
    hasPointerLock: true,
    ...over,
  };
}

describe('playability', () => {
  it('admits an ordinary desktop', () => {
    expect(playability(caps())).toEqual({ id: 'ok', ok: true, headline: '', detail: '' });
  });

  it('admits a touchscreen laptop: touch is not a disqualifier', () => {
    const touchLaptop = caps({ maxTouchPoints: 10, coarsePointer: true, finePointer: true });

    expect(playability(touchLaptop).ok).toBe(true);
    expect(playability(touchLaptop).id).toBe('ok');
  });

  it('refuses a phone, with the two-line wording the playtest asked for', () => {
    const phone = caps({ maxTouchPoints: 5, coarsePointer: true, finePointer: false });

    expect(playability(phone)).toEqual({
      id: 'no-fine-pointer',
      ok: false,
      headline: 'PROTOCOL SEVEN is a desktop shooter',
      detail: 'Open it on a computer.',
    });
  });

  it('refuses a browser with no Pointer Lock', () => {
    const noLock = playability(caps({ hasPointerLock: false }));

    expect(noLock.id).toBe('no-pointer-lock');
    expect(noLock.ok).toBe(false);
    expect(noLock.headline).toBe('This browser cannot capture the mouse');
    expect(noLock.detail).toContain('Pointer Lock');
  });

  it('tests pointer lock first, because it is the harder failure', () => {
    const neither = caps({ hasPointerLock: false, finePointer: false, coarsePointer: true });

    expect(playability(neither).id).toBe('no-pointer-lock');
  });

  it('gives every playable device the same answer, whatever else it reports', () => {
    expect(playability(caps())).toEqual(playability(caps({ maxTouchPoints: 2 })));
  });
});

describe('aimWarning', () => {
  interface LockState {
    wantsPointerLock: boolean;
    pointerLocked: boolean;
    lockRefused: boolean;
  }

  /** The one state that raises the banner, with the field under test overridden. */
  function warn(over: Partial<LockState>): string {
    return aimWarning({ wantsPointerLock: true, pointerLocked: false, lockRefused: true, ...over });
  }

  it('is up only when the match wants the lock, has not got it, and was refused', () => {
    expect(warn({})).toBe('MOUSE NOT CAPTURED — CLICK TO AIM · F11 FOR FULLSCREEN');
  });

  it('is down while nothing is asking, which is what makes it survive a pause', () => {
    expect(warn({ wantsPointerLock: false })).toBe('');
  });

  it('is down once the lock lands', () => {
    expect(warn({ pointerLocked: true })).toBe('');
  });

  it('is down before a refusal arrives, so it cannot flash during the request', () => {
    expect(warn({ lockRefused: false })).toBe('');
  });

  it('is down for every combination that is not that one', () => {
    for (const wantsPointerLock of [true, false]) {
      for (const pointerLocked of [true, false]) {
        for (const lockRefused of [true, false]) {
          const shouldWarn = wantsPointerLock && !pointerLocked && lockRefused;
          const text = aimWarning({ wantsPointerLock, pointerLocked, lockRefused });
          expect(text !== '').toBe(shouldWarn);
        }
      }
    }
  });
});
