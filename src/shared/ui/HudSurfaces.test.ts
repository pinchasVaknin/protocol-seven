import { describe, expect, it } from 'vitest';
import { DT } from '../core/Loop';
import { Cheat } from '../cheats/Cheats';
import type { GameStateId } from '../core/GameStates';
import type { MatchPhase } from '../modes/MatchFlow';
import {
  aimWarningText,
  briefVisible,
  captionHasCountdown,
  cheatTag,
  debugOverlayVisible,
  debugUnlocked,
  type HudSurfaceState,
  matchCaption,
  quickLoadoutWindow,
  resultSurfacesVisible,
  scoreboardOpen,
  stepRespawnDisplay,
} from './HudSurfaces';

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

/**
 * The rest of the surface rules, pinned before two repeated conditions were given names
 * (refactor A2).
 *
 * The invariant the file states is that a surface is a pure function of state that outlives it,
 * and the two things these tests exist to protect are the two the file repeats rather than
 * shares: the *in a live match at all* precondition, which four rules spell out, and the
 * *pre-match window*, which `briefVisible` and `quickLoadoutWindow` spell out separately while
 * `briefVisible` documents them as one expression. So both are asserted here from the outside,
 * on every screen and every phase, and the boundary cases are the ones that would survive a
 * careless merge: `debugOverlayVisible` is deliberately **not** governed by the live-match
 * precondition, because the pause screen is a legal screen for it.
 */

const PHASES: readonly MatchPhase[] = ['WARMUP', 'LIVE', 'ROUND_END', 'MATCH_END'];
const SCREENS: readonly GameStateId[] = [
  'BOOT',
  'MENU',
  'LOADOUT',
  'SETTINGS',
  'MATCH',
  'PAUSED',
  'SUMMARY',
];

function state(over: Partial<HudSurfaceState> = {}): HudSurfaceState {
  return {
    screen: 'MATCH',
    hasWorld: true,
    playerDead: false,
    respawnSeconds: 0,
    phase: 'LIVE',
    round: 1,
    scoreboardHeld: false,
    debugRequest: 'none',
    cheatMask: 0,
    instantCheatLabel: '',
    inWarmupArena: false,
    wantsPointerLock: false,
    pointerLocked: true,
    lockRefused: false,
    ...over,
  };
}

/** The four rules the live-match precondition governs, and what each says when it is down. */
const LIVE_MATCH_RULES: ReadonlyArray<readonly [string, (s: HudSurfaceState) => unknown, unknown]> = [
  ['aimWarningText', aimWarningText, ''],
  ['resultSurfacesVisible', resultSurfacesVisible, false],
  ['quickLoadoutWindow', quickLoadoutWindow, 'none'],
  ['cheatTag', cheatTag, ''],
];

describe('the live-match precondition', () => {
  /** Every surface asking to be up: held key, a cheat on, and a refused lock. */
  function wantingEverything(over: Partial<HudSurfaceState>): HudSurfaceState {
    return state({
      scoreboardHeld: true,
      cheatMask: Cheat.God,
      wantsPointerLock: true,
      pointerLocked: false,
      lockRefused: true,
      phase: 'WARMUP',
      round: 1,
      ...over,
    });
  }

  it('takes all four rules down on every screen but MATCH, however loudly they are asked', () => {
    for (const [, rule, down] of LIVE_MATCH_RULES) {
      for (const screen of SCREENS) {
        if (screen === 'MATCH') continue;
        expect(rule(wantingEverything({ screen }))).toBe(down);
      }
    }
  });

  it('takes all four down with no world, even on the match screen', () => {
    for (const [, rule, down] of LIVE_MATCH_RULES) {
      expect(rule(wantingEverything({ hasWorld: false }))).toBe(down);
    }
  });

  it('lets all four up on the match screen with a world, so the rule is not simply off', () => {
    const live = wantingEverything({});

    expect(aimWarningText(live)).not.toBe('');
    expect(resultSurfacesVisible(live)).toBe(true);
    expect(quickLoadoutWindow(live)).not.toBe('none');
    expect(cheatTag(live)).not.toBe('');
  });

  it('does not govern the debug overlay, which is legal on the pause screen', () => {
    expect(debugOverlayVisible(state({ screen: 'PAUSED', debugRequest: 'onPause' }))).toBe(true);
  });
});

describe('aimWarningText', () => {
  it('delegates to the capability rule once the match is live', () => {
    const warned = state({ wantsPointerLock: true, pointerLocked: false, lockRefused: true });

    expect(aimWarningText(warned)).toContain('MOUSE NOT CAPTURED');
  });

  it('is empty while the lock is held', () => {
    expect(aimWarningText(state({ wantsPointerLock: true, pointerLocked: true }))).toBe('');
  });
});

describe('scoreboardOpen', () => {
  it('follows the held key, and nothing else', () => {
    expect(scoreboardOpen(state({ scoreboardHeld: true }))).toBe(true);
    expect(scoreboardOpen(state({ scoreboardHeld: false }))).toBe(false);
  });

  it('cannot latch over the pause screen, which is the defect it was extracted for', () => {
    expect(scoreboardOpen(state({ screen: 'PAUSED', scoreboardHeld: true }))).toBe(false);
  });

  it('is down in the arena, because it is a result surface', () => {
    expect(scoreboardOpen(state({ scoreboardHeld: true, inWarmupArena: true }))).toBe(false);
  });
});

describe('resultSurfacesVisible', () => {
  it('is up in a live match and down in the waiting room', () => {
    expect(resultSurfacesVisible(state())).toBe(true);
    expect(resultSurfacesVisible(state({ inWarmupArena: true }))).toBe(false);
  });

  it('does not depend on the phase: an empty board is still a result surface', () => {
    for (const phase of PHASES) {
      expect(resultSurfacesVisible(state({ phase }))).toBe(true);
    }
  });
});

describe('quickLoadoutWindow', () => {
  it('opens on respawn only while a countdown is actually running', () => {
    expect(quickLoadoutWindow(state({ playerDead: true, respawnSeconds: 4 }))).toBe('respawn');
    expect(quickLoadoutWindow(state({ playerDead: true, respawnSeconds: 0 }))).toBe('none');
  });

  it('opens in the pre-match freeze of round one, and only round one', () => {
    expect(quickLoadoutWindow(state({ phase: 'WARMUP', round: 1 }))).toBe('prematch');
    expect(quickLoadoutWindow(state({ phase: 'WARMUP', round: 2 }))).toBe('none');
  });

  it('is shut during the round-end hold, which is also frozen', () => {
    expect(quickLoadoutWindow(state({ phase: 'ROUND_END', round: 1 }))).toBe('none');
  });

  it('prefers the respawn window when a player dies inside the freeze', () => {
    const both = state({ phase: 'WARMUP', round: 1, playerDead: true, respawnSeconds: 3 });

    expect(quickLoadoutWindow(both)).toBe('respawn');
  });

  it('is shut for every other phase at rest', () => {
    for (const phase of PHASES) {
      const expected = phase === 'WARMUP' ? 'prematch' : 'none';
      expect(quickLoadoutWindow(state({ phase, round: 1 }))).toBe(expected);
    }
  });
});

describe('briefVisible', () => {
  it('opens in the same window as the quick selector, round one only', () => {
    expect(briefVisible('WARMUP', 1, false)).toBe(true);
    expect(briefVisible('WARMUP', 2, false)).toBe(false);
    expect(briefVisible('LIVE', 1, false)).toBe(false);
  });

  it('is off in the arena, which has nothing to brief', () => {
    expect(briefVisible('WARMUP', 1, true)).toBe(false);
  });

  it('agrees with quickLoadoutWindow on every phase and round, because it is one window', () => {
    for (const phase of PHASES) {
      for (const round of [0, 1, 2, 3]) {
        const prematch = quickLoadoutWindow(state({ phase, round })) === 'prematch';
        expect(briefVisible(phase, round, false)).toBe(prematch);
      }
    }
  });
});

describe('debugUnlocked', () => {
  it('is derived from the request, because it was never a second fact', () => {
    expect(debugUnlocked(state({ debugRequest: 'none' }))).toBe(false);
    expect(debugUnlocked(state({ debugRequest: 'inMatch' }))).toBe(true);
    expect(debugUnlocked(state({ debugRequest: 'onPause' }))).toBe(true);
  });

  it('reads the request even with no world, since it is about the request', () => {
    expect(debugUnlocked(state({ hasWorld: false, debugRequest: 'inMatch' }))).toBe(true);
  });
});

describe('debugOverlayVisible', () => {
  it('is up in a match for either kind of request', () => {
    expect(debugOverlayVisible(state({ debugRequest: 'inMatch' }))).toBe(true);
    expect(debugOverlayVisible(state({ debugRequest: 'onPause' }))).toBe(true);
  });

  it('is up over the pause screen only for a request made there', () => {
    expect(debugOverlayVisible(state({ screen: 'PAUSED', debugRequest: 'onPause' }))).toBe(true);
    expect(debugOverlayVisible(state({ screen: 'PAUSED', debugRequest: 'inMatch' }))).toBe(false);
  });

  it('is down everywhere else, and down with no request at all', () => {
    expect(debugOverlayVisible(state({ screen: 'MENU', debugRequest: 'onPause' }))).toBe(false);
    expect(debugOverlayVisible(state({ screen: 'SUMMARY', debugRequest: 'inMatch' }))).toBe(false);
    expect(debugOverlayVisible(state({ debugRequest: 'none' }))).toBe(false);
  });

  it('is down with no world, whatever was asked for', () => {
    expect(debugOverlayVisible(state({ hasWorld: false, debugRequest: 'inMatch' }))).toBe(false);
  });
});

describe('cheatTag', () => {
  it('names the toggles that are on', () => {
    expect(cheatTag(state({ cheatMask: Cheat.God }))).toBe('CHEATS · GOD');
  });

  it('composes an instant announcement with the standing toggles', () => {
    const s = state({ cheatMask: Cheat.God, instantCheatLabel: '+30 KILLS' });

    expect(cheatTag(s)).toBe('CHEATS · GOD · +30 KILLS');
  });

  it('is empty with nothing on', () => {
    expect(cheatTag(state())).toBe('');
  });
});

describe('captionHasCountdown', () => {
  it('counts down in a match and never in the waiting room', () => {
    expect(captionHasCountdown(false)).toBe(true);
    expect(captionHasCountdown(true)).toBe(false);
  });
});

describe('stepRespawnDisplay', () => {
  it('counts down by one tick while dead', () => {
    expect(stepRespawnDisplay(5, true)).toBe(5 - DT);
    expect(stepRespawnDisplay(5, true, 0.5)).toBe(4.5);
  });

  it('holds still while alive, so it is never a second opinion about the alive bit', () => {
    expect(stepRespawnDisplay(5, false)).toBe(5);
  });

  it('clamps at zero and waits there for the server', () => {
    expect(stepRespawnDisplay(0.001, true, 1)).toBe(0);
    expect(stepRespawnDisplay(0, true)).toBe(0);
  });

  it('leaves a negative value alone rather than counting it further down', () => {
    expect(stepRespawnDisplay(-1, true)).toBe(-1);
  });

  it('feeds the respawn window: zero closes it', () => {
    const stepped = stepRespawnDisplay(0.001, true, 1);

    expect(quickLoadoutWindow(state({ playerDead: true, respawnSeconds: stepped }))).toBe('none');
  });
});
