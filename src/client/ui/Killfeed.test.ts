import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameEvents } from '../../shared/core/Events';
import type { ViewerContext } from '../../shared/ui/TeamColour';
import { KillfeedView } from './Killfeed';

/**
 * Characterization tests for the killfeed's five rows (refactor unit C15, written before the
 * refactor).
 *
 * The same DOM double the C14 HUD tests use, plus `createElementNS` and `cloneNode`, because a
 * row paints a real weapon icon through `WeaponIcons.makeIconSvg`. The icons themselves are the
 * real ones; only the document is a double.
 */

// ---------------------------------------------------------------------------- the DOM double

class FakeElement {
  readonly tokens = new Set<string>();
  /** Unset properties read back as `''`, which is what a real `CSSStyleDeclaration` does. */
  readonly style: Record<string, string> = { opacity: '', transform: '' };
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
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

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  cloneNode(_deep?: boolean): FakeElement {
    const copy = new FakeElement(this.tag);
    for (const [key, value] of this.attributes) copy.setAttribute(key, value);
    for (const child of this.children) copy.appendChild(child.cloneNode(true));
    return copy;
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
  };
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
});

// ---------------------------------------------------------------------------- the rig

const SEAT_A: ViewerContext = { team: 'A', freeForAll: false };
const SEAT_B: ViewerContext = { team: 'B', freeForAll: false };
const FFA: ViewerContext = { team: 'A', freeForAll: true };

type Entry = GameEvents['killfeed.entry'];

function entry(over: Partial<Entry> = {}): Entry {
  return {
    killerName: 'VULTURE',
    victimName: 'MAGPIE',
    killerTeam: 'A',
    victimTeam: 'B',
    weaponId: 'mk18',
    headshot: false,
    suicide: false,
    involvesLocal: false,
    ...over,
  };
}

interface Rig {
  readonly feed: KillfeedView;
  readonly root: FakeElement;
  readonly rows: readonly FakeElement[];
}

function rig(viewer: ViewerContext = SEAT_A): Rig {
  const feed = new KillfeedView();
  feed.setViewer(viewer);
  const root = feed.element as unknown as FakeElement;
  return { feed, root, rows: root.children };
}

/** One row read back as the five fields it carries. */
function read(row: FakeElement) {
  return {
    killer: row.children[0]?.textContent ?? '',
    killerClass: row.children[0]?.className ?? '',
    tag: row.children[1]?.textContent ?? '',
    tagHidden: row.children[1]?.hidden ?? false,
    icons: row.children[2]?.children.length ?? 0,
    headshots: row.children[3]?.children.length ?? 0,
    victim: row.children[4]?.textContent ?? '',
    victimClass: row.children[4]?.className ?? '',
    local: row.classList.contains('hud-feed__row--local'),
    opacity: row.style.opacity,
  };
}

// ---------------------------------------------------------------------------- the tree

describe('the tree it builds', () => {
  it('is five rows, each five spans, all invisible', () => {
    const r = rig();
    expect(r.root.className).toBe('hud-feed');
    expect(r.rows).toHaveLength(5);
    for (const row of r.rows) {
      expect(row.className).toBe('hud-feed__row');
      expect(row.style.opacity).toBe('0');
      expect(row.children.map((c) => c.className)).toEqual([
        'hud-feed__name',
        'hud-feed__tag',
        'hud-feed__icon',
        'hud-feed__hs',
        'hud-feed__name',
      ]);
    }
  });

  it('builds every row once, so a busy feed allocates no elements', () => {
    const r = rig();
    const before = r.rows.map((row) => row.children[0]);
    for (let i = 0; i < 8; i++) r.feed.push(entry({ killerName: `K${i}` }));
    expect(r.rows.map((row) => row.children[0])).toEqual(before);
  });
});

// ---------------------------------------------------------------------------- push

describe('push', () => {
  it('writes the newest line into the top row', () => {
    const r = rig();
    r.feed.push(entry({ killerName: 'VULTURE', victimName: 'MAGPIE' }));
    const row = read(r.rows[0] as FakeElement);
    expect(row.killer).toBe('VULTURE');
    expect(row.victim).toBe('MAGPIE');
  });

  it('shifts the older lines down by one', () => {
    const r = rig();
    r.feed.push(entry({ killerName: 'FIRST' }));
    r.feed.push(entry({ killerName: 'SECOND' }));
    r.feed.push(entry({ killerName: 'THIRD' }));
    expect(r.rows.slice(0, 3).map((row) => read(row).killer)).toEqual(['THIRD', 'SECOND', 'FIRST']);
  });

  it('drops the sixth line off the bottom', () => {
    const r = rig();
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) r.feed.push(entry({ killerName: name }));
    expect(r.rows.map((row) => read(row).killer)).toEqual(['F', 'E', 'D', 'C', 'B']);
  });

  it('leaves a suicide with no killer at all', () => {
    const r = rig();
    r.feed.push(entry({ suicide: true, killerName: 'MAGPIE', victimName: 'MAGPIE' }));
    const row = read(r.rows[0] as FakeElement);
    expect(row.killer).toBe('');
    expect(row.victim).toBe('MAGPIE');
  });

  it('paints both names by what their team is to this viewer', () => {
    const a = rig(SEAT_A);
    a.feed.push(entry({ killerTeam: 'A', victimTeam: 'B' }));
    expect(read(a.rows[0] as FakeElement).killerClass).toBe('hud-feed__name hud-feed__name--friendly');
    expect(read(a.rows[0] as FakeElement).victimClass).toBe('hud-feed__name hud-feed__name--hostile');

    // The same kill from the other seat reads the other way round — B12's whole point.
    const b = rig(SEAT_B);
    b.feed.push(entry({ killerTeam: 'A', victimTeam: 'B' }));
    expect(read(b.rows[0] as FakeElement).killerClass).toBe('hud-feed__name hud-feed__name--hostile');
    expect(read(b.rows[0] as FakeElement).victimClass).toBe('hud-feed__name hud-feed__name--friendly');
  });

  it('paints everybody hostile in Free-for-All', () => {
    const r = rig(FFA);
    r.feed.push(entry({ killerTeam: 'A', victimTeam: 'A' }));
    expect(read(r.rows[0] as FakeElement).killerClass).toBe('hud-feed__name hud-feed__name--hostile');
  });

  it('paints a team of NONE neutral', () => {
    const r = rig();
    r.feed.push(entry({ killerTeam: 'NONE', victimTeam: 'NONE' }));
    expect(read(r.rows[0] as FakeElement).killerClass).toBe('hud-feed__name hud-feed__name--neutral');
  });

  it('brightens both names and the row when the local player is in the line', () => {
    const r = rig();
    r.feed.push(entry({ involvesLocal: true }));
    const row = read(r.rows[0] as FakeElement);
    expect(row.killerClass).toBe('hud-feed__name hud-feed__name--friendly hud-feed__name--bright');
    expect(row.victimClass).toBe('hud-feed__name hud-feed__name--hostile hud-feed__name--bright');
    expect(row.local).toBe(true);
  });

  it('tags the machine beside the person for a killstreak weapon', () => {
    const r = rig();
    r.feed.push(entry({ weaponId: 'streak_sentry' }));
    const row = read(r.rows[0] as FakeElement);
    expect(row.tag).toBe('[SENTRY]');
    expect(row.tagHidden).toBe(false);
  });

  it('hides the tag for an ordinary weapon', () => {
    const r = rig();
    r.feed.push(entry({ weaponId: 'mk18' }));
    const row = read(r.rows[0] as FakeElement);
    expect(row.tag).toBe('');
    expect(row.tagHidden).toBe(true);
  });

  it('draws one weapon icon per line, and the headshot mark only on a headshot', () => {
    const r = rig();
    r.feed.push(entry({ headshot: false }));
    expect(read(r.rows[0] as FakeElement).icons).toBe(1);
    expect(read(r.rows[0] as FakeElement).headshots).toBe(0);
    r.feed.push(entry({ headshot: true, weaponId: 'm9' }));
    expect(read(r.rows[0] as FakeElement).icons).toBe(1);
    expect(read(r.rows[0] as FakeElement).headshots).toBe(1);
  });

  it('carries the icon and the headshot mark down with the line that owns them', () => {
    const r = rig();
    r.feed.push(entry({ killerName: 'FIRST', headshot: true, weaponId: 'streak_sentry' }));
    r.feed.push(entry({ killerName: 'SECOND', headshot: false, weaponId: 'mk18' }));
    const second = read(r.rows[1] as FakeElement);
    expect(second.killer).toBe('FIRST');
    expect(second.headshots).toBe(1);
    expect(second.tag).toBe('[SENTRY]');
    expect(read(r.rows[0] as FakeElement).headshots).toBe(0);
    expect(read(r.rows[0] as FakeElement).tag).toBe('');
  });

  it('restarts the fade for the new top line', () => {
    const r = rig();
    r.feed.push(entry());
    r.feed.update(5.3);
    expect(read(r.rows[0] as FakeElement).opacity).not.toBe('0');
    r.feed.push(entry({ killerName: 'NEW' }));
    r.feed.update(0);
    expect(read(r.rows[0] as FakeElement).opacity).toBe('1.00');
  });
});

// ---------------------------------------------------------------------------- update

describe('update', () => {
  it('holds a line at full for its hold, then fades it', () => {
    const r = rig();
    r.feed.push(entry());
    r.feed.update(0);
    expect(r.rows[0]?.style.opacity).toBe('1.00');
    // 5.4 s is the hold (4.6) plus half the fade (0.8): half way down.
    r.feed.update(5.0);
    expect(r.rows[0]?.style.opacity).toBe('0.50');
  });

  it('quantises the fade to twentieths, so a fading row writes twenty times and not sixty', () => {
    const r = rig();
    r.feed.push(entry());
    r.feed.update(4.8);
    const first = r.rows[0]?.style.opacity;
    if (r.rows[0] !== undefined) r.rows[0].style.opacity = 'TOUCHED';
    r.feed.update(0.01);
    expect(r.rows[0]?.style.opacity).toBe('TOUCHED');
    expect(first).toBe('0.75');
  });

  it('takes the line away when its life runs out, and writes nothing after', () => {
    const r = rig();
    r.feed.push(entry());
    r.feed.update(6);
    expect(r.rows[0]?.style.opacity).toBe('0');
    if (r.rows[0] !== undefined) r.rows[0].style.opacity = 'TOUCHED';
    r.feed.update(1);
    expect(r.rows[0]?.style.opacity).toBe('TOUCHED');
  });

  it('ages every live line independently', () => {
    const r = rig();
    r.feed.push(entry({ killerName: 'OLD' }));
    r.feed.update(4.9);
    r.feed.push(entry({ killerName: 'NEW' }));
    r.feed.update(0.4);
    /*
     * The old line moved to row 1 carrying its remaining life; the new one is still at full.
     *
     * 0.10 rather than the 0.15 the arithmetic reads like: a line starts at
     * `HOLD_SECONDS + FADE_SECONDS`, and 4.6 + 0.8 is 5.3999999999999995, so after 5.3 seconds
     * it has 0.09999999999999964 left and the twentieth it quantises to falls on the low side
     * of the half. Pinned as it is, because it is what the screen does.
     */
    expect(r.rows[0]?.style.opacity).toBe('1.00');
    expect(r.rows[1]?.style.opacity).toBe('0.10');
  });
});

// ---------------------------------------------------------------------------- clear

describe('clear', () => {
  it('empties the feed and lets the next line start clean', () => {
    const r = rig();
    for (const name of ['A', 'B']) r.feed.push(entry({ killerName: name }));
    r.feed.update(0);
    r.feed.clear();
    expect(r.rows.every((row) => row.style.opacity === '0')).toBe(true);
    r.feed.update(1);
    expect(r.rows.every((row) => row.style.opacity === '0')).toBe(true);
  });

  it('leaves the text where it is — the rows are hidden, not rebuilt', () => {
    // Pins current behaviour: `clear` is an opacity and a flag, so last match's names are still
    // in the DOM behind an invisible row. Nothing reads them, and rebuilding five rows to wipe
    // text nobody can see would undo the reason the rows are preallocated.
    const r = rig();
    r.feed.push(entry({ killerName: 'VULTURE' }));
    r.feed.clear();
    expect(read(r.rows[0] as FakeElement).killer).toBe('VULTURE');
  });
});

// ---------------------------------------------------------------------------- setViewer

describe('setViewer', () => {
  it('decides the colours of the lines pushed after it', () => {
    const r = rig(SEAT_A);
    r.feed.setViewer(SEAT_B);
    r.feed.push(entry({ killerTeam: 'A', victimTeam: 'B' }));
    expect(read(r.rows[0] as FakeElement).killerClass).toBe('hud-feed__name hud-feed__name--hostile');
  });

  it('does not repaint the lines already on screen', () => {
    // Pins current behaviour: a seat swap at half-time leaves the lines already in the feed in
    // last half's colours until they fade. They carry their own class down with them.
    const r = rig(SEAT_A);
    r.feed.push(entry({ killerTeam: 'A', victimTeam: 'B' }));
    r.feed.setViewer(SEAT_B);
    expect(read(r.rows[0] as FakeElement).killerClass).toBe('hud-feed__name hud-feed__name--friendly');
  });
});
