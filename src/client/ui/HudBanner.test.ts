import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ViewerContext } from '../../shared/ui/TeamColour';
import { HudBanner, formatClock, makeBannerState, type BannerState } from './HudBanner';

/**
 * Characterization tests for the score banner (refactor unit C14, written before the refactor).
 *
 * The banner is a DOM writer, so almost nothing here is reachable through a pure function — but
 * `vitest.config.ts` says a dozen test files in this project install a global `document`, and
 * `Input.test.ts` and `ProceduralTextures.test.ts` are two of them. So that is what this does:
 * a double for the five DOM operations this file actually performs, and then every write is a
 * fact a test can hold.
 *
 * The double keeps `className` and `classList` over **one** token set, because the real DOM does
 * — writing `className` after a `toggle` drops the toggled class, and a double with two
 * independent stores would hide that if the refactor ever reordered the two.
 */

// ---------------------------------------------------------------------------- the DOM double

class FakeElement {
  readonly tokens = new Set<string>();
  /** Unset properties read back as `''`, which is what a real `CSSStyleDeclaration` does. */
  readonly style: Record<string, string> = { opacity: '', transform: '', visibility: '' };
  readonly children: FakeElement[] = [];
  textContent = '';
  hidden = false;
  parent: FakeElement | null = null;

  constructor(readonly tag: string) {}

  get className(): string {
    return [...this.tokens].join(' ');
  }

  set className(value: string) {
    this.tokens.clear();
    for (const token of value.split(' ')) if (token !== '') this.tokens.add(token);
  }

  readonly classList = {
    toggle: (token: string, on?: boolean): void => {
      const want = on ?? !this.tokens.has(token);
      if (want) this.tokens.add(token);
      else this.tokens.delete(token);
    },
    add: (token: string): void => void this.tokens.add(token),
    remove: (token: string): void => void this.tokens.delete(token),
    contains: (token: string): boolean => this.tokens.has(token),
  };

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeElement(tag),
  };
  // The five `x instanceof HTMLElement` guards in the HUD are a real branch: without this they
  // throw rather than return false, which would pin nothing.
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
});

// ---------------------------------------------------------------------------- the rig

const SEAT_A: ViewerContext = { team: 'A', freeForAll: false };
const SEAT_B: ViewerContext = { team: 'B', freeForAll: false };
const FFA_SEAT: ViewerContext = { team: 'A', freeForAll: true };

interface Rig {
  readonly banner: HudBanner;
  /** The two team slots and the centre, in the order the banner appends them. */
  readonly slotLeft: FakeElement;
  readonly centre: FakeElement;
  readonly slotRight: FakeElement;
  readonly labelA: FakeElement;
  readonly scoreA: FakeElement;
  readonly barA: FakeElement;
  readonly labelB: FakeElement;
  readonly scoreB: FakeElement;
  readonly barB: FakeElement;
  readonly clock: FakeElement;
  readonly rounds: FakeElement;
  readonly phase: FakeElement;
  readonly caption: FakeElement;
  readonly brief: FakeElement;
}

function at(el: FakeElement, ...path: number[]): FakeElement {
  let node = el;
  for (const index of path) {
    const next = node.children[index];
    if (next === undefined) throw new Error(`no child ${index} of ${node.className}`);
    node = next;
  }
  return node;
}

function rig(viewer: ViewerContext = SEAT_A): Rig {
  const banner = new HudBanner();
  banner.setViewer(viewer);
  const root = banner.element as unknown as FakeElement;
  const phase = banner.phaseElement as unknown as FakeElement;
  return {
    banner,
    slotLeft: at(root, 0),
    centre: at(root, 1),
    slotRight: at(root, 2),
    labelA: at(root, 0, 0),
    scoreA: at(root, 0, 1),
    barA: at(root, 0, 2, 0),
    labelB: at(root, 2, 0),
    scoreB: at(root, 2, 1),
    barB: at(root, 2, 2, 0),
    clock: at(root, 1, 0),
    rounds: at(root, 1, 1),
    phase,
    caption: at(phase, 0),
    brief: at(phase, 1),
  };
}

function state(over: Partial<BannerState> = {}): BannerState {
  return { ...makeBannerState(), ...over };
}

// ---------------------------------------------------------------------------- formatClock

describe('formatClock', () => {
  it('is M:SS with the seconds zero-padded', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(10)).toBe('0:10');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(125)).toBe('2:05');
    expect(formatClock(600)).toBe('10:00');
  });

  it('floors rather than rounds, so a clock never shows a second it has not reached', () => {
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(60.999)).toBe('1:00');
  });

  it('never goes negative — an overrun reads as 0:00', () => {
    expect(formatClock(-0.1)).toBe('0:00');
    expect(formatClock(-90)).toBe('0:00');
  });

  it('does not wrap at an hour; the minutes just keep counting', () => {
    expect(formatClock(3600)).toBe('60:00');
    expect(formatClock(3661)).toBe('61:01');
  });
});

// ---------------------------------------------------------------------------- makeBannerState

describe('makeBannerState', () => {
  it('starts at round 1 of 1, no scores and no captions', () => {
    expect(makeBannerState()).toEqual({
      scoreA: 0,
      scoreB: 0,
      limit: 0,
      secondsRemaining: 0,
      round: 1,
      roundsToWin: 1,
      phaseSeconds: 0,
      phaseLabel: '',
      phaseBrief: '',
      ffa: false,
      leaderName: '',
      leaderScore: 0,
      selfScore: 0,
    });
  });

  it('hands out a fresh record every call', () => {
    const first = makeBannerState();
    first.scoreA = 9;
    expect(makeBannerState().scoreA).toBe(0);
  });
});

// ---------------------------------------------------------------------------- the tree

describe('the tree it builds', () => {
  it('is two team slots around a centre, with the caption on its own layer', () => {
    const r = rig();
    expect((r.banner.element as unknown as FakeElement).tokens.has('hud-banner')).toBe(true);
    expect(r.slotLeft.tokens.has('hud-banner__team')).toBe(true);
    expect(r.slotRight.tokens.has('hud-banner__team')).toBe(true);
    expect(r.centre.className).toBe('hud-banner__centre');
    expect(r.scoreA.className).toBe('hud-banner__score op-num');
    expect(r.clock.className).toBe('hud-banner__clock op-num');
    expect(r.rounds.className).toBe('hud-banner__rounds op-label');
    expect(r.phase.className).toBe('hud-phase');
    expect(r.brief.className).toBe('hud-phase__brief');
  });

  it('keeps the caption out of the banner, because the HUD mounts it over the crosshair', () => {
    const r = rig();
    expect(r.phase.parent).toBeNull();
    expect((r.banner.element as unknown as FakeElement).children).toHaveLength(3);
  });

  it('hides both FFA captions and the brief until something asks for them', () => {
    const r = rig();
    expect(r.labelA.hidden).toBe(true);
    expect(r.labelB.hidden).toBe(true);
    expect(r.brief.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------- the viewer

describe('setViewer', () => {
  it('paints the left slot friendly and the right hostile in a team mode, in either seat', () => {
    for (const seat of [SEAT_A, SEAT_B]) {
      const r = rig(seat);
      expect(r.slotLeft.className).toBe('hud-banner__team hud-banner__team--friendly');
      expect(r.slotRight.className).toBe('hud-banner__team hud-banner__team--hostile');
    }
  });

  it('puts the leader on the left and you on the right in FFA, and only you are friendly', () => {
    const r = rig(FFA_SEAT);
    expect(r.slotLeft.className).toBe('hud-banner__team hud-banner__team--hostile');
    expect(r.slotRight.className).toBe('hud-banner__team hud-banner__team--friendly');
  });

  it('forgets the score guards, because the scores swap sides with the seat', () => {
    const r = rig(SEAT_A);
    r.banner.update(state({ scoreA: 7, scoreB: 3 }));
    expect(r.scoreA.textContent).toBe('7');
    r.banner.setViewer(SEAT_B);
    r.banner.update(state({ scoreA: 7, scoreB: 3 }));
    expect(r.scoreA.textContent).toBe('3');
    expect(r.scoreB.textContent).toBe('7');
  });
});

// ---------------------------------------------------------------------------- scores

describe('update: the scores', () => {
  it('reads the viewer own side on the left, whichever team that is', () => {
    const a = rig(SEAT_A);
    a.banner.update(state({ scoreA: 12, scoreB: 5 }));
    expect(a.scoreA.textContent).toBe('12');
    expect(a.scoreB.textContent).toBe('5');

    const b = rig(SEAT_B);
    b.banner.update(state({ scoreA: 12, scoreB: 5 }));
    expect(b.scoreA.textContent).toBe('5');
    expect(b.scoreB.textContent).toBe('12');
  });

  it('draws the leader and the local score in FFA, not the two team totals', () => {
    const r = rig(FFA_SEAT);
    r.banner.update(state({ ffa: true, scoreA: 40, scoreB: 40, leaderScore: 17, selfScore: 4 }));
    expect(r.scoreA.textContent).toBe('17');
    expect(r.scoreB.textContent).toBe('4');
  });

  it('writes a score only when the number changed', () => {
    const r = rig();
    r.banner.update(state({ scoreA: 3 }));
    r.scoreA.textContent = 'TOUCHED';
    r.banner.update(state({ scoreA: 3 }));
    expect(r.scoreA.textContent).toBe('TOUCHED');
    r.banner.update(state({ scoreA: 4 }));
    expect(r.scoreA.textContent).toBe('4');
  });
});

// ---------------------------------------------------------------------------- FFA captions

describe('update: the FFA captions', () => {
  it('names the leader on the left and YOU on the right', () => {
    const r = rig(FFA_SEAT);
    r.banner.update(state({ ffa: true, leaderName: 'VULTURE' }));
    expect(r.labelA.textContent).toBe('VULTURE');
    expect(r.labelA.hidden).toBe(false);
    expect(r.labelB.textContent).toBe('YOU');
    expect(r.labelB.hidden).toBe(false);
  });

  it('falls back to LEADER before anybody has a name', () => {
    const r = rig(FFA_SEAT);
    r.banner.update(state({ ffa: true, leaderName: '' }));
    expect(r.labelA.textContent).toBe('LEADER');
    expect(r.labelA.hidden).toBe(false);
  });

  it('empties and hides both captions in a team mode', () => {
    const r = rig(FFA_SEAT);
    r.banner.update(state({ ffa: true, leaderName: 'VULTURE' }));
    r.banner.update(state({ ffa: false }));
    expect(r.labelA.textContent).toBe('');
    expect(r.labelA.hidden).toBe(true);
    expect(r.labelB.textContent).toBe('');
    expect(r.labelB.hidden).toBe(true);
  });

  it('marks the banner itself, so the stylesheet can lay FFA out differently', () => {
    const r = rig(FFA_SEAT);
    const root = r.banner.element as unknown as FakeElement;
    expect(root.tokens.has('hud-banner--ffa')).toBe(false);
    r.banner.update(state({ ffa: true }));
    expect(root.tokens.has('hud-banner--ffa')).toBe(true);
    r.banner.update(state({ ffa: false }));
    expect(root.tokens.has('hud-banner--ffa')).toBe(false);
  });

  it('writes the captions only when the leader label changed', () => {
    const r = rig(FFA_SEAT);
    r.banner.update(state({ ffa: true, leaderName: 'VULTURE' }));
    r.labelB.textContent = 'TOUCHED';
    r.banner.update(state({ ffa: true, leaderName: 'VULTURE', selfScore: 9 }));
    expect(r.labelB.textContent).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the bars

describe('update: the progress bars', () => {
  it('scales each bar by its score over the limit, quantised to a hundredth', () => {
    const r = rig();
    r.banner.update(state({ scoreA: 25, scoreB: 10, limit: 75 }));
    expect(r.barA.style.transform).toBe('scaleX(0.33)');
    expect(r.barB.style.transform).toBe('scaleX(0.13)');
  });

  it('treats a limit of zero as one, so a mode with no limit does not divide by it', () => {
    const r = rig();
    r.banner.update(state({ scoreA: 0, scoreB: 0, limit: 0 }));
    expect(r.barA.style.transform).toBe('scaleX(0.00)');
    r.banner.update(state({ scoreA: 1, scoreB: 0, limit: 0 }));
    expect(r.barA.style.transform).toBe('scaleX(1.00)');
  });

  it('caps a bar at full when the score is over the limit', () => {
    const r = rig();
    r.banner.update(state({ scoreA: 90, limit: 75 }));
    expect(r.barA.style.transform).toBe('scaleX(1.00)');
  });

  it('writes a bar only when the quantised fill changed', () => {
    const r = rig();
    r.banner.update(state({ scoreA: 10, limit: 1000 }));
    expect(r.barA.style.transform).toBe('scaleX(0.01)');
    r.barA.style.transform = 'TOUCHED';
    // 10/1000 and 11/1000 are both 0.01 after quantisation.
    r.banner.update(state({ scoreA: 11, limit: 1000 }));
    expect(r.barA.style.transform).toBe('TOUCHED');
    r.banner.update(state({ scoreA: 20, limit: 1000 }));
    expect(r.barA.style.transform).toBe('scaleX(0.02)');
  });
});

// ---------------------------------------------------------------------------- the clock

describe('update: the clock', () => {
  it('writes the formatted clock', () => {
    const r = rig();
    r.banner.update(state({ secondsRemaining: 125 }));
    expect(r.clock.textContent).toBe('2:05');
  });

  it('goes urgent at thirty seconds and not at thirty-one', () => {
    const r = rig();
    r.banner.update(state({ secondsRemaining: 31 }));
    expect(r.clock.tokens.has('hud-banner__clock--urgent')).toBe(false);
    r.banner.update(state({ secondsRemaining: 30 }));
    expect(r.clock.tokens.has('hud-banner__clock--urgent')).toBe(true);
  });

  it('comes back off the urgent colour when the clock is reset upward', () => {
    const r = rig();
    r.banner.update(state({ secondsRemaining: 12 }));
    expect(r.clock.tokens.has('hud-banner__clock--urgent')).toBe(true);
    r.banner.update(state({ secondsRemaining: 300 }));
    expect(r.clock.tokens.has('hud-banner__clock--urgent')).toBe(false);
  });

  it('writes nothing while the formatted string is the same, which is most frames', () => {
    const r = rig();
    r.banner.update(state({ secondsRemaining: 125.9 }));
    r.clock.textContent = 'TOUCHED';
    r.banner.update(state({ secondsRemaining: 125.1 }));
    expect(r.clock.textContent).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the rounds line

describe('update: the rounds line', () => {
  it('is empty in a mode that plays one round, so TDM carries no ROUND 1 OF 1', () => {
    const r = rig();
    r.banner.update(state({ round: 1, roundsToWin: 1 }));
    expect(r.rounds.textContent).toBe('');
  });

  it('names the round once the mode plays more than one', () => {
    const r = rig();
    r.banner.update(state({ round: 3, roundsToWin: 4 }));
    expect(r.rounds.textContent).toBe('ROUND 3');
  });
});

// ---------------------------------------------------------------------------- the caption

describe('update: the phase caption', () => {
  it('stays down while there is no label', () => {
    const r = rig();
    r.banner.update(state({ phaseLabel: '' }));
    expect(r.phase.tokens.has('hud-phase--on')).toBe(false);
    expect(r.caption.textContent).toBe('');
  });

  it('comes up with the label, and appends whole seconds while a countdown is running', () => {
    const r = rig();
    r.banner.update(state({ phaseLabel: 'WARMUP', phaseSeconds: 4.2 }));
    expect(r.phase.tokens.has('hud-phase--on')).toBe(true);
    expect(r.caption.textContent).toBe('WARMUP · 5');
  });

  it('drops the number once the countdown is spent', () => {
    const r = rig();
    r.banner.update(state({ phaseLabel: 'ROUND OVER', phaseSeconds: 0 }));
    expect(r.caption.textContent).toBe('ROUND OVER');
  });

  it('updates the brief even while the caption is down, so it cannot flash last match', () => {
    const r = rig();
    r.banner.update(state({ phaseLabel: '', phaseBrief: 'PLANT THE BOMB' }));
    expect(r.phase.tokens.has('hud-phase--on')).toBe(false);
    expect(r.brief.textContent).toBe('PLANT THE BOMB');
    expect(r.brief.hidden).toBe(false);
    r.banner.update(state({ phaseLabel: '', phaseBrief: '' }));
    expect(r.brief.textContent).toBe('');
    expect(r.brief.hidden).toBe(true);
  });

  it('writes the caption only when the whole string changed', () => {
    const r = rig();
    r.banner.update(state({ phaseLabel: 'WARMUP', phaseSeconds: 4.9 }));
    expect(r.caption.textContent).toBe('WARMUP · 5');
    r.caption.textContent = 'TOUCHED';
    r.banner.update(state({ phaseLabel: 'WARMUP', phaseSeconds: 4.1 }));
    expect(r.caption.textContent).toBe('TOUCHED');
    r.banner.update(state({ phaseLabel: 'WARMUP', phaseSeconds: 3.1 }));
    expect(r.caption.textContent).toBe('WARMUP · 4');
  });
});

// ---------------------------------------------------------------------------- reset

describe('reset', () => {
  it('takes the caption down and forgets every guard it owns', () => {
    const r = rig();
    r.banner.update(state({ scoreA: 5, scoreB: 2, limit: 10, secondsRemaining: 90, round: 2, roundsToWin: 3, phaseLabel: 'WARMUP', phaseBrief: 'B' }));
    r.banner.reset();
    expect(r.phase.tokens.has('hud-phase--on')).toBe(false);

    // Every guarded write happens again on the next frame, even with identical state.
    r.scoreA.textContent = 'TOUCHED';
    r.barA.style.transform = 'TOUCHED';
    r.clock.textContent = 'TOUCHED';
    r.rounds.textContent = 'TOUCHED';
    r.brief.textContent = 'TOUCHED';
    r.banner.update(state({ scoreA: 5, scoreB: 2, limit: 10, secondsRemaining: 90, round: 2, roundsToWin: 3, phaseLabel: 'WARMUP', phaseBrief: 'B' }));
    expect(r.scoreA.textContent).toBe('5');
    expect(r.barA.style.transform).toBe('scaleX(0.50)');
    expect(r.clock.textContent).toBe('1:30');
    expect(r.rounds.textContent).toBe('ROUND 2');
    expect(r.brief.textContent).toBe('B');
  });

  it('keeps the FFA guards, which the scores and the clock do not', () => {
    // Pins current behaviour: `lastFfa` and `lastLeadLabel` are not in `reset`. Harmless as
    // written — the captions still hold the strings those guards remember — and a test that
    // says so is what makes it a decision rather than an oversight.
    const r = rig(FFA_SEAT);
    r.banner.update(state({ ffa: true, leaderName: 'VULTURE' }));
    r.banner.reset();
    r.labelA.textContent = 'TOUCHED';
    r.banner.update(state({ ffa: true, leaderName: 'VULTURE' }));
    expect(r.labelA.textContent).toBe('TOUCHED');
  });
});
