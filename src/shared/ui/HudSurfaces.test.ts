import { describe, expect, it } from 'vitest';
import { matchCaption } from './HudSurfaces';

/**
 * The caption over the crosshair (round 4, F12; 2026-10-03).
 *
 * The arena reads WAITING — except while its ballot is open, which says what the room is waiting
 * for in its own words. In a narrow window the caption sat under the ballot's list (playtest,
 * 596×696).
 */
describe('matchCaption', () => {
  it('reads WAITING in the arena between ballots', () => {
    expect(matchCaption('LIVE', true)).toBe('WAITING');
    expect(matchCaption('LIVE', true, false)).toBe('WAITING');
  });

  it('gives way to an open ballot', () => {
    expect(matchCaption('LIVE', true, true)).toBe('');
  });

  it('is the phase in a match, ballot or not', () => {
    expect(matchCaption('WARMUP', false)).toBe('GET READY');
    expect(matchCaption('WARMUP', false, true)).toBe('GET READY');
    expect(matchCaption('LIVE', false)).toBe('');
  });
});
