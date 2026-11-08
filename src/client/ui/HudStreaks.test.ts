import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STREAK_COOLDOWN_SECONDS } from '../../shared/streaks/StreakDefs';
import { HudStreaks, makeStreakHudState, type StreakHudState } from './HudStreaks';

/**
 * Characterization tests for the streak strip, the objective banner and the alive strip
 * (refactor unit C14, written before the refactor).
 *
 * Same DOM double as `HudBanner.test.ts` — see the note there. This class takes a host element
 * and appends three separate widgets to it, so the double has to carry parents and `remove`,
 * which is what `dispose` is tested through.
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
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
});

// ---------------------------------------------------------------------------- the rig

interface Slot {
  readonly root: FakeElement;
  readonly cool: FakeElement;
  readonly key: FakeElement;
  readonly name: FakeElement;
  readonly cost: FakeElement;
}

interface Rig {
  readonly streaks: HudStreaks;
  readonly host: FakeElement;
  readonly slots: readonly Slot[];
  readonly progress: FakeElement;
  readonly banner: FakeElement;
  readonly bannerLabel: FakeElement;
  readonly bannerTimer: FakeElement;
  readonly ringWrap: FakeElement;
  readonly ringFill: FakeElement;
  readonly ringLabel: FakeElement;
  readonly alive: FakeElement;
  readonly aliveFriendly: FakeElement;
  readonly aliveEnemy: FakeElement;
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

function rig(): Rig {
  const host = new FakeElement('div');
  const streaks = new HudStreaks(host as unknown as HTMLElement);
  const strip = streaks.element as unknown as FakeElement;
  const banner = streaks.bannerElement as unknown as FakeElement;
  const alive = streaks.aliveElement as unknown as FakeElement;
  const slotRoots = at(strip, 0).children;
  return {
    streaks,
    host,
    slots: slotRoots.map((root) => ({
      root,
      // Appended cool-first, so the fill paints behind the key, the name and the cost.
      cool: at(root, 0),
      key: at(root, 1),
      name: at(root, 2),
      cost: at(root, 3),
    })),
    progress: at(strip, 1),
    banner,
    bannerLabel: at(banner, 0, 0),
    bannerTimer: at(banner, 0, 1),
    ringWrap: at(banner, 1),
    ringFill: at(banner, 1, 0),
    ringLabel: at(banner, 1, 1),
    alive,
    aliveFriendly: at(alive, 0),
    aliveEnemy: at(alive, 2),
  };
}

function state(over: Partial<StreakHudState> = {}): StreakHudState {
  return { ...makeStreakHudState(), ...over };
}

/** One slot record, as `MatchHud` fills them. */
function slot(name: string, key: string, ready: boolean, price: number, lockoutSeconds = 0) {
  return { name, key, ready, price, lockoutSeconds };
}

// ---------------------------------------------------------------------------- the state

describe('makeStreakHudState', () => {
  it('is three empty slots on keys 3, 4 and 5 with nothing to say', () => {
    const fresh = makeStreakHudState();
    expect(fresh.slots.map((s) => s.key)).toEqual(['3', '4', '5']);
    expect(fresh.slots.every((s) => s.name === '' && !s.ready && s.price === 0)).toBe(true);
    expect(fresh.balance).toBe(0);
    expect(fresh.nextName).toBe('');
    expect(fresh.objectiveLabel).toBe('');
  });

  it('omits the objective seconds and the ring with a negative rather than a zero', () => {
    // Zero is a legal value for both — "no time left" and "nothing done yet" — so the sentinel
    // has to be outside the range.
    const fresh = makeStreakHudState();
    expect(fresh.objectiveSeconds).toBe(-1);
    expect(fresh.interactFraction).toBe(-1);
  });

  it('hands out fresh slots every call, not one shared array', () => {
    const first = makeStreakHudState();
    const firstSlot = first.slots[0];
    if (firstSlot !== undefined) firstSlot.name = 'UAV';
    expect(makeStreakHudState().slots[0]?.name).toBe('');
  });
});

// ---------------------------------------------------------------------------- the tree

describe('the tree it builds', () => {
  it('appends three widgets to the host: the strip, the banner and the alive line', () => {
    const r = rig();
    expect(r.host.children).toHaveLength(3);
    expect(r.host.children.map((el) => el.className)).toEqual([
      'hud-streaks',
      'hud-objective',
      'hud-alive',
    ]);
  });

  it('is three slots, keyed 3, 4 and 5, with the lockout fill behind each', () => {
    const r = rig();
    expect(r.slots).toHaveLength(3);
    expect(r.slots.map((s) => s.key.textContent)).toEqual(['3', '4', '5']);
    expect(r.slots.map((s) => s.cool.style.transform)).toEqual([
      'scaleY(0)',
      'scaleY(0)',
      'scaleY(0)',
    ]);
    expect(r.slots[0]?.cool.className).toBe('hud-streaks__cool');
    expect(r.slots[0]?.name.className).toBe('hud-streaks__name');
    expect(r.slots[0]?.cost.className).toBe('hud-streaks__cost');
  });

  it('starts the banner and the alive line hidden, and the ring inside the banner too', () => {
    const r = rig();
    expect(r.banner.style.opacity).toBe('0');
    expect(r.ringWrap.style.opacity).toBe('0');
    expect(r.alive.style.opacity).toBe('0');
  });

  it('labels the alive line between the two counts', () => {
    const r = rig();
    expect(at(r.alive, 1).textContent).toBe('ALIVE');
    expect(r.aliveFriendly.className).toBe('hud-alive__count hud-alive__count--friendly');
    expect(r.aliveEnemy.className).toBe('hud-alive__count hud-alive__count--enemy');
  });
});

// ---------------------------------------------------------------------------- the alive strip

describe('update: the alive strip', () => {
  it('stays down in a mode where everybody respawns', () => {
    const r = rig();
    r.streaks.update(state({ showAlive: false, aliveFriendly: 3, aliveEnemy: 2 }));
    expect(r.alive.style.opacity).toBe('0');
    expect(r.aliveFriendly.textContent).toBe('');
  });

  it('comes up with both counts in a one-life mode', () => {
    const r = rig();
    r.streaks.update(state({ showAlive: true, aliveFriendly: 3, aliveEnemy: 1 }));
    expect(r.alive.style.opacity).toBe('1');
    expect(r.aliveFriendly.textContent).toBe('3');
    expect(r.aliveEnemy.textContent).toBe('1');
  });

  it('writes the counts only when the pair changed', () => {
    const r = rig();
    r.streaks.update(state({ showAlive: true, aliveFriendly: 3, aliveEnemy: 1 }));
    r.aliveFriendly.textContent = 'TOUCHED';
    r.streaks.update(state({ showAlive: true, aliveFriendly: 3, aliveEnemy: 1 }));
    expect(r.aliveFriendly.textContent).toBe('TOUCHED');
    r.streaks.update(state({ showAlive: true, aliveFriendly: 2, aliveEnemy: 1 }));
    expect(r.aliveFriendly.textContent).toBe('2');
  });

  it('goes back down when the mode stops using it', () => {
    const r = rig();
    r.streaks.update(state({ showAlive: true, aliveFriendly: 1, aliveEnemy: 1 }));
    r.streaks.update(state({ showAlive: false }));
    expect(r.alive.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------- the slots

describe('update: the three slots', () => {
  it('names a slot and prices it, and marks it owned', () => {
    const r = rig();
    r.streaks.update(state({ slots: [slot('UAV', '3', true, 4), slot('', '4', false, 0), slot('', '5', false, 0)] }));
    const first = r.slots[0];
    expect(first?.name.textContent).toBe('UAV');
    expect(first?.cost.textContent).toBe('4');
    expect(first?.root.tokens.has('is-owned')).toBe(true);
    expect(first?.root.tokens.has('is-ready')).toBe(true);
  });

  it('leaves an empty slot with no price at all rather than a zero', () => {
    const r = rig();
    r.streaks.update(state());
    expect(r.slots[0]?.cost.textContent).toBe('');
    expect(r.slots[0]?.root.tokens.has('is-owned')).toBe(false);
  });

  it('shows the price of a named slot the player cannot afford yet', () => {
    // The useful half of the round-4 pivot: an unaffordable slot says what is missing.
    const r = rig();
    r.streaks.update(state({ slots: [slot('CHOPPER GUNNER', '5', false, 12)] }));
    expect(r.slots[0]?.name.textContent).toBe('CHOPPER GUNNER');
    expect(r.slots[0]?.cost.textContent).toBe('12');
    expect(r.slots[0]?.root.tokens.has('is-owned')).toBe(true);
    expect(r.slots[0]?.root.tokens.has('is-ready')).toBe(false);
  });

  it('repaints a slot that became affordable without changing its name', () => {
    // This is what the stamp is for: three facts, one guard.
    const r = rig();
    r.streaks.update(state({ slots: [slot('UAV', '3', false, 4)] }));
    expect(r.slots[0]?.root.tokens.has('is-ready')).toBe(false);
    r.streaks.update(state({ slots: [slot('UAV', '3', true, 4)] }));
    expect(r.slots[0]?.root.tokens.has('is-ready')).toBe(true);
  });

  it('repaints a slot whose price changed, name and readiness alike', () => {
    const r = rig();
    r.streaks.update(state({ slots: [slot('UAV', '3', true, 4)] }));
    r.streaks.update(state({ slots: [slot('UAV', '3', true, 3)] }));
    expect(r.slots[0]?.cost.textContent).toBe('3');
  });

  it('writes nothing while all three facts are the same', () => {
    const r = rig();
    r.streaks.update(state({ slots: [slot('UAV', '3', true, 4)] }));
    const first = r.slots[0];
    if (first !== undefined) first.name.textContent = 'TOUCHED';
    r.streaks.update(state({ slots: [slot('UAV', '3', true, 4)] }));
    expect(first?.name.textContent).toBe('TOUCHED');
  });

  it('treats a missing slot record as an empty slot rather than throwing', () => {
    const r = rig();
    r.streaks.update(state({ slots: [] }));
    expect(r.slots.every((s) => s.name.textContent === '' && s.cost.textContent === '')).toBe(true);
  });

  it('drives the three slots independently', () => {
    const r = rig();
    r.streaks.update(state({
      slots: [slot('UAV', '3', true, 4), slot('MORTAR', '4', false, 7), slot('SENTRY', '5', false, 9)],
    }));
    expect(r.slots.map((s) => s.name.textContent)).toEqual(['UAV', 'MORTAR', 'SENTRY']);
    expect(r.slots.map((s) => s.cost.textContent)).toEqual(['4', '7', '9']);
    expect(r.slots.map((s) => s.root.tokens.has('is-ready'))).toEqual([true, false, false]);
  });
});

// ---------------------------------------------------------------------------- the lockout

describe('update: the lockout fill', () => {
  it('needs a name as well as a lockout, so an empty slot never cools', () => {
    const r = rig();
    r.streaks.update(state({ slots: [slot('', '3', false, 0, 20)] }));
    expect(r.slots[0]?.root.tokens.has('is-cooling')).toBe(false);
    expect(r.slots[0]?.cool.style.transform).toBe('scaleY(0.000)');
  });

  it('marks a named slot with time left and drains the fill against the cooldown', () => {
    const r = rig();
    r.streaks.update(state({ slots: [slot('UAV', '3', false, 4, STREAK_COOLDOWN_SECONDS / 2)] }));
    expect(r.slots[0]?.root.tokens.has('is-cooling')).toBe(true);
    expect(r.slots[0]?.cool.style.transform).toBe('scaleY(0.500)');
  });

  it('holds the fill full while a previous instance is still in the world', () => {
    // Clamped at 1 rather than scaled against the whole wait, so a sentry still up and a
    // cooldown that has just started read the same.
    const r = rig();
    r.streaks.update(state({ slots: [slot('SENTRY', '5', false, 9, 120)] }));
    expect(r.slots[0]?.cool.style.transform).toBe('scaleY(1.000)');
  });

  it('empties the fill and the mark when the wait ends', () => {
    const r = rig();
    r.streaks.update(state({ slots: [slot('UAV', '3', false, 4, 10)] }));
    r.streaks.update(state({ slots: [slot('UAV', '3', true, 4, 0)] }));
    expect(r.slots[0]?.root.tokens.has('is-cooling')).toBe(false);
    expect(r.slots[0]?.cool.style.transform).toBe('scaleY(0.000)');
  });

  it('writes the fill every frame, because a transform is not a write worth guarding', () => {
    const r = rig();
    r.streaks.update(state({ slots: [slot('UAV', '3', false, 4, 15)] }));
    const first = r.slots[0];
    if (first !== undefined) first.cool.style.transform = 'TOUCHED';
    r.streaks.update(state({ slots: [slot('UAV', '3', false, 4, 15)] }));
    expect(first?.cool.style.transform).toBe('scaleY(0.500)');
  });
});

// ---------------------------------------------------------------------------- the progress line

describe('update: the progress line', () => {
  it('counts the balance toward the cheapest thing still out of reach', () => {
    const r = rig();
    r.streaks.update(state({ balance: 2, nextPrice: 4, nextName: 'UAV' }));
    expect(r.progress.textContent).toBe('2 / 4 · UAV');
    expect(r.progress.style.opacity).toBe('1');
  });

  it('goes away entirely when there is nothing left to want', () => {
    const r = rig();
    r.streaks.update(state({ balance: 2, nextPrice: 4, nextName: 'UAV' }));
    r.streaks.update(state({ nextName: '' }));
    expect(r.progress.textContent).toBe('');
    expect(r.progress.style.opacity).toBe('0');
  });

  it('writes only when the whole line changed', () => {
    const r = rig();
    r.streaks.update(state({ balance: 2, nextPrice: 4, nextName: 'UAV' }));
    r.progress.textContent = 'TOUCHED';
    r.streaks.update(state({ balance: 2, nextPrice: 4, nextName: 'UAV' }));
    expect(r.progress.textContent).toBe('TOUCHED');
    r.streaks.update(state({ balance: 3, nextPrice: 4, nextName: 'UAV' }));
    expect(r.progress.textContent).toBe('3 / 4 · UAV');
  });
});

// ---------------------------------------------------------------------------- the banner

describe('update: the objective banner', () => {
  it('stays down while there is nothing to say', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: '' }));
    expect(r.banner.style.opacity).toBe('0');
    expect(r.bannerLabel.textContent).toBe('');
  });

  it('comes up with a headline and whole seconds', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'BOMB ARMED', objectiveSeconds: 12.4 }));
    expect(r.banner.style.opacity).toBe('1');
    expect(r.bannerLabel.textContent).toBe('BOMB ARMED');
    expect(r.bannerTimer.textContent).toBe('13');
  });

  it('omits the timer on a negative, which is what "no clock" means here', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'CAPTURE B', objectiveSeconds: -1 }));
    expect(r.bannerTimer.textContent).toBe('');
  });

  it('goes urgent while the bomb is ticking, and back', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'BOMB ARMED', urgent: true }));
    expect(r.banner.tokens.has('is-urgent')).toBe(true);
    r.streaks.update(state({ objectiveLabel: 'BOMB ARMED', urgent: false }));
    expect(r.banner.tokens.has('is-urgent')).toBe(false);
  });

  it('writes nothing below the headline once the banner is down', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'BOMB ARMED', objectiveSeconds: 10, urgent: true }));
    r.bannerTimer.textContent = 'TOUCHED';
    r.streaks.update(state({ objectiveLabel: '', objectiveSeconds: 4, urgent: false }));
    expect(r.banner.style.opacity).toBe('0');
    expect(r.bannerTimer.textContent).toBe('TOUCHED');
    expect(r.banner.tokens.has('is-urgent')).toBe(true);
  });

  it('writes the timer only when the whole second changed', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'BOMB ARMED', objectiveSeconds: 12.9 }));
    expect(r.bannerTimer.textContent).toBe('13');
    r.bannerTimer.textContent = 'TOUCHED';
    r.streaks.update(state({ objectiveLabel: 'BOMB ARMED', objectiveSeconds: 12.1 }));
    expect(r.bannerTimer.textContent).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the ring

describe('update: the interaction ring', () => {
  it('appears at zero progress, because zero is a plant that has just begun', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'PLANTING', interactFraction: 0, interactLabel: 'HOLD F' }));
    expect(r.ringWrap.style.opacity).toBe('1');
    expect(r.ringFill.style.transform).toBe('scaleX(0.000)');
    expect(r.ringLabel.textContent).toBe('HOLD F');
  });

  it('fills as the interaction runs, and clamps at both ends', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'PLANTING', interactFraction: 0.5 }));
    expect(r.ringFill.style.transform).toBe('scaleX(0.500)');
    r.streaks.update(state({ objectiveLabel: 'PLANTING', interactFraction: 4 }));
    expect(r.ringFill.style.transform).toBe('scaleX(1.000)');
  });

  it('hides on a negative fraction and writes no fill at all', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'PLANTING', interactFraction: 0.5 }));
    r.ringFill.style.transform = 'TOUCHED';
    r.streaks.update(state({ objectiveLabel: 'PLANTING', interactFraction: -1 }));
    expect(r.ringWrap.style.opacity).toBe('0');
    expect(r.ringFill.style.transform).toBe('TOUCHED');
  });

  it('writes the ring label only when it changed', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: 'PLANTING', interactFraction: 0.2, interactLabel: 'HOLD F' }));
    r.ringLabel.textContent = 'TOUCHED';
    r.streaks.update(state({ objectiveLabel: 'PLANTING', interactFraction: 0.3, interactLabel: 'HOLD F' }));
    expect(r.ringLabel.textContent).toBe('TOUCHED');
  });

  it('needs the banner up: a ring with no headline is never reached', () => {
    const r = rig();
    r.streaks.update(state({ objectiveLabel: '', interactFraction: 0.5 }));
    expect(r.ringWrap.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------- dispose

describe('dispose', () => {
  it('takes all three widgets off the host', () => {
    const r = rig();
    expect(r.host.children).toHaveLength(3);
    r.streaks.dispose();
    expect(r.host.children).toHaveLength(0);
  });
});
