import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerScore, ScoreSystem } from '../../shared/combat/ScoreSystem';
import type { ColumnDef } from '../../shared/modes/GameMode';
import type { ViewerContext } from '../../shared/ui/TeamColour';
import { Scoreboard } from './Scoreboard';

/**
 * Characterization tests for the Tab board (refactor unit C15, written before the refactor).
 *
 * The same DOM double the C14 HUD tests use. The score rows are literals and the `ScoreSystem`
 * is a stand-in holding them, because `Scoreboard` reads exactly one thing off it — `rows` —
 * and building a real one would pull a bus and a damage ledger into a test about a grid.
 * `compareRows`, the sort it uses, is the real one.
 */

// ---------------------------------------------------------------------------- the DOM double

class FakeElement {
  readonly tokens = new Set<string>();
  /** Unset properties read back as `''`, which is what a real `CSSStyleDeclaration` does. */
  readonly style: Record<string, string> & { setProperty: (k: string, v: string) => void };
  readonly properties = new Map<string, string>();
  readonly children: FakeElement[] = [];
  textContent = '';
  hidden = false;
  parent: FakeElement | null = null;

  constructor(readonly tag: string) {
    this.style = {
      opacity: '',
      transform: '',
      gridTemplateColumns: '',
      setProperty: (k: string, v: string) => void this.properties.set(k, v),
    } as unknown as Record<string, string> & { setProperty: (k: string, v: string) => void };
  }

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
    // A real `appendChild` on a node that already has a parent *moves* it, which is how the
    // board reorders its blocks and how FFA puts both sets of rows under one body.
    child.remove();
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

const SEAT_A: ViewerContext = { team: 'A', freeForAll: false };
const SEAT_B: ViewerContext = { team: 'B', freeForAll: false };
const FFA: ViewerContext = { team: 'A', freeForAll: true };

const COLUMNS: ColumnDef[] = [
  { key: 'kills', label: 'K', width: 4, align: 'right', value: (r) => String(r.kills) },
  { key: 'deaths', label: 'D', width: 4, align: 'right', value: (r) => String(r.deaths) },
  { key: 'score', label: 'SCORE', width: 6, align: 'right', value: (r) => String(r.score) },
];

function score(over: Partial<PlayerScore> = {}): PlayerScore {
  return {
    entityId: 1,
    displayName: 'OPERATOR',
    team: 'A',
    isLocal: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    headshots: 0,
    captures: 0,
    defends: 0,
    plants: 0,
    defuses: 0,
    tags: 0,
    ...over,
  };
}

/** `Scoreboard` reads one member off the score system, so that is all this stands in for. */
function system(rows: PlayerScore[]): ScoreSystem {
  return { rows } as unknown as ScoreSystem;
}

interface Rig {
  readonly board: Scoreboard;
  readonly root: FakeElement;
  readonly title: FakeElement;
  readonly grid: FakeElement;
}

function rig(viewer: ViewerContext = SEAT_A, rowsPerTeam = 3, columns: ColumnDef[] | null = COLUMNS): Rig {
  const board = new Scoreboard(rowsPerTeam);
  board.setViewer(viewer);
  if (columns !== null) board.setColumns(columns, 'TEAM DEATHMATCH', 'FOUNDRY');
  const root = board.element as unknown as FakeElement;
  return { board, root, title: root.children[0] as FakeElement, grid: root.children[1] as FakeElement };
}

/** The block of the given side, found by its position under the grid. */
function blockAt(r: Rig, index: number): FakeElement {
  const block = r.grid.children[index];
  if (block === undefined) throw new Error(`no block at ${index}`);
  return block;
}

function bodyRows(block: FakeElement): FakeElement[] {
  return (block.children[1] as FakeElement).children;
}

function readRow(row: FakeElement) {
  return {
    hidden: row.hidden,
    name: row.children[0]?.textContent ?? '',
    cells: row.children.slice(1).map((c) => c.textContent),
    local: row.classList.contains('sb__row--local'),
  };
}

// ---------------------------------------------------------------------------- the tree

describe('the tree it builds', () => {
  it('is a title over a grid of two team blocks', () => {
    const r = rig();
    expect(r.root.className).toBe('sb');
    expect(r.title.className).toBe('sb__title op-label');
    expect(r.grid.className).toBe('sb__grid');
    expect(r.grid.children).toHaveLength(2);
    expect(r.grid.children.every((b) => b.tokens.has('sb__team'))).toBe(true);
  });

  it('gives each block a head and a body of preallocated hidden rows', () => {
    const r = rig(SEAT_A, 4);
    const block = blockAt(r, 0);
    expect(block.children[0]?.className).toBe('sb__head');
    expect(block.children[1]?.className).toBe('sb__body');
    const rows = bodyRows(block);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.hidden)).toBe(true);
    expect(rows[0]?.children[0]?.className).toBe('sb__name');
  });

  it('writes the mode and the map into the title', () => {
    const r = rig();
    expect(r.title.textContent).toBe('TEAM DEATHMATCH · FOUNDRY');
  });
});

// ---------------------------------------------------------------------------- the viewer

describe('setViewer', () => {
  it('puts the viewer own side first and paints it friendly', () => {
    const a = rig(SEAT_A);
    expect(blockAt(a, 0).className).toBe('sb__team sb__team--friendly');
    expect(blockAt(a, 1).className).toBe('sb__team sb__team--hostile');

    // From the other seat the same two blocks swap places, which is half of B12.
    const b = rig(SEAT_B);
    expect(blockAt(b, 0).className).toBe('sb__team sb__team--friendly');
    expect(blockAt(b, 1).className).toBe('sb__team sb__team--hostile');
    // And the one that moved is team A's: its rows are the ones B's seat reads second.
    b.board.refresh(system([score({ entityId: 1, team: 'A', displayName: 'ALPHA' }), score({ entityId: 2, team: 'B', displayName: 'BRAVO' })]));
    expect(readRow(bodyRows(blockAt(b, 0))[0] as FakeElement).name).toBe('BRAVO');
    expect(readRow(bodyRows(blockAt(b, 1))[0] as FakeElement).name).toBe('ALPHA');
  });

  it('heads the name column with what the side is to the viewer', () => {
    const a = rig(SEAT_A);
    expect(blockAt(a, 0).children[0]?.children[0]?.textContent).toBe('ALLIES');
    expect(blockAt(a, 1).children[0]?.children[0]?.textContent).toBe('AXIS');

    const b = rig(SEAT_B);
    expect(blockAt(b, 0).children[0]?.children[0]?.textContent).toBe('ALLIES');
    expect(blockAt(b, 1).children[0]?.children[0]?.textContent).toBe('AXIS');
  });

  it('collapses to one uncoloured ladder in Free-for-All', () => {
    const r = rig(FFA, 3);
    const first = blockAt(r, 0);
    const second = blockAt(r, 1);
    expect(first.className).toBe('sb__team');
    expect(second.hidden).toBe(true);
    // Both sets of row slots live under the first body, and nothing was rebuilt.
    expect(bodyRows(first)).toHaveLength(6);
    expect(bodyRows(second)).toHaveLength(0);
    expect(first.children[0]?.children[0]?.textContent).toBe('OPERATORS');
  });

  it('puts the second block back for the next team match', () => {
    const r = rig(FFA, 3);
    r.board.setViewer(SEAT_A);
    expect(blockAt(r, 1).hidden).toBe(false);
    expect(bodyRows(blockAt(r, 0))).toHaveLength(3);
    expect(bodyRows(blockAt(r, 1))).toHaveLength(3);
  });

  it('is idempotent', () => {
    const r = rig(SEAT_A);
    const before = r.grid.children.map((b) => b.className);
    r.board.setViewer(SEAT_A);
    expect(r.grid.children.map((b) => b.className)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------- the columns

describe('setColumns', () => {
  it('writes one track for the name and one per column, in ch', () => {
    const r = rig();
    const head = blockAt(r, 0).children[0] as FakeElement;
    expect(head.style.gridTemplateColumns).toBe('minmax(0, 1fr) 4ch 4ch 6ch');
    // The name column has no floor — playtest round 5, B3.
    expect((head.style.gridTemplateColumns ?? '').startsWith('minmax(0, 1fr)')).toBe(true);
  });

  it('hands the body the same template through a custom property', () => {
    const r = rig();
    const body = blockAt(r, 0).children[1] as FakeElement;
    expect(body.properties.get('--sb-cols')).toBe('minmax(0, 1fr) 4ch 4ch 6ch');
  });

  it('heads each column with its label and alignment', () => {
    const r = rig();
    const head = blockAt(r, 0).children[0] as FakeElement;
    expect(head.children.map((c) => c.textContent)).toEqual(['ALLIES', 'K', 'D', 'SCORE']);
    expect(head.children.slice(1).map((c) => c.className)).toEqual([
      'sb__col sb__col--right',
      'sb__col sb__col--right',
      'sb__col sb__col--right',
    ]);
  });

  it('gives every row one cell per column, after the name', () => {
    const r = rig();
    const row = bodyRows(blockAt(r, 0))[0] as FakeElement;
    expect(row.children).toHaveLength(4);
    expect(row.style.gridTemplateColumns).toBe('minmax(0, 1fr) 4ch 4ch 6ch');
    expect(row.children.slice(1).map((c) => c.className)).toEqual([
      'sb__cell sb__cell--right op-num',
      'sb__cell sb__cell--right op-num',
      'sb__cell sb__cell--right op-num',
    ]);
  });

  it('rebuilds the cells when a second mode binds different columns', () => {
    const r = rig();
    r.board.setColumns(
      [{ key: 'tags', label: 'TAGS', width: 5, align: 'left', value: (s) => String(s.tags) }],
      'KILL CONFIRMED',
      'DEPOT',
    );
    const row = bodyRows(blockAt(r, 0))[0] as FakeElement;
    expect(row.children).toHaveLength(2);
    expect(r.title.textContent).toBe('KILL CONFIRMED · DEPOT');
    expect((blockAt(r, 0).children[0] as FakeElement).style.gridTemplateColumns).toBe('minmax(0, 1fr) 5ch');
  });
});

// ---------------------------------------------------------------------------- open and close

describe('setOpen and update', () => {
  it('marks the board and fills it immediately, because it is asked for when it matters', () => {
    const r = rig();
    r.board.setOpen(true, system([score({ displayName: 'ALPHA', kills: 3 })]));
    expect(r.root.tokens.has('sb--on')).toBe(true);
    expect(r.board.isOpen).toBe(true);
    expect(readRow(bodyRows(blockAt(r, 0))[0] as FakeElement).name).toBe('ALPHA');
  });

  it('does nothing twice', () => {
    const r = rig();
    const sys = system([score({ displayName: 'ALPHA' })]);
    r.board.setOpen(true, sys);
    const row = bodyRows(blockAt(r, 0))[0] as FakeElement;
    row.children[0]!.textContent = 'TOUCHED';
    r.board.setOpen(true, sys);
    expect(row.children[0]?.textContent).toBe('TOUCHED');
  });

  it('refuses to refresh while closed, however much time passes', () => {
    const r = rig();
    const sys = system([score({ displayName: 'ALPHA' })]);
    r.board.update(10, sys);
    expect(readRow(bodyRows(blockAt(r, 0))[0] as FakeElement).hidden).toBe(true);
  });

  it('refreshes at six hertz while open and not between', () => {
    const r = rig();
    const rows = [score({ displayName: 'ALPHA' })];
    const sys = system(rows);
    r.board.setOpen(true, sys);
    const nameEl = (bodyRows(blockAt(r, 0))[0] as FakeElement).children[0] as FakeElement;

    rows[0] = score({ displayName: 'BRAVO' });
    r.board.update(0.1, system(rows));
    expect(nameEl.textContent).toBe('ALPHA');
    r.board.update(0.1, system(rows));
    expect(nameEl.textContent).toBe('BRAVO');
  });

  it('closes without clearing, so the rows are still bound when it comes back', () => {
    const r = rig();
    const sys = system([score({ displayName: 'ALPHA' })]);
    r.board.setOpen(true, sys);
    r.board.setOpen(false, sys);
    expect(r.root.tokens.has('sb--on')).toBe(false);
    expect(r.board.isOpen).toBe(false);
    expect(readRow(bodyRows(blockAt(r, 0))[0] as FakeElement).name).toBe('ALPHA');
  });
});

// ---------------------------------------------------------------------------- refresh

describe('refresh', () => {
  it('sorts each side by score, then kills, then fewest deaths', () => {
    const r = rig(SEAT_A, 3);
    r.board.refresh(
      system([
        score({ entityId: 1, team: 'A', displayName: 'LOW', score: 100 }),
        score({ entityId: 2, team: 'A', displayName: 'HIGH', score: 900 }),
        score({ entityId: 3, team: 'A', displayName: 'MID', score: 500 }),
      ]),
    );
    expect(bodyRows(blockAt(r, 0)).map((row) => readRow(row).name)).toEqual(['HIGH', 'MID', 'LOW']);
  });

  it('keeps each side on its own block', () => {
    const r = rig(SEAT_A, 2);
    r.board.refresh(
      system([
        score({ entityId: 1, team: 'A', displayName: 'ALPHA' }),
        score({ entityId: 2, team: 'B', displayName: 'BRAVO' }),
      ]),
    );
    expect(readRow(bodyRows(blockAt(r, 0))[0] as FakeElement).name).toBe('ALPHA');
    expect(readRow(bodyRows(blockAt(r, 1))[0] as FakeElement).name).toBe('BRAVO');
  });

  it('hides the slots past the data and shows them again when it grows', () => {
    const r = rig(SEAT_A, 3);
    r.board.refresh(system([score({ team: 'A', displayName: 'ALPHA' })]));
    const rows = bodyRows(blockAt(r, 0));
    expect(rows.map((row) => row.hidden)).toEqual([false, true, true]);
    r.board.refresh(
      system([
        score({ entityId: 1, team: 'A', displayName: 'ALPHA' }),
        score({ entityId: 2, team: 'A', displayName: 'BRAVO' }),
      ]),
    );
    expect(rows.map((row) => row.hidden)).toEqual([false, false, true]);
  });

  it('writes the mode columns through each column value function', () => {
    const r = rig();
    r.board.refresh(system([score({ team: 'A', displayName: 'ALPHA', kills: 7, deaths: 2, score: 900 })]));
    expect(readRow(bodyRows(blockAt(r, 0))[0] as FakeElement).cells).toEqual(['7', '2', '900']);
  });

  it('marks the local row', () => {
    const r = rig();
    r.board.refresh(
      system([
        score({ entityId: 1, team: 'A', displayName: 'ALPHA', score: 10, isLocal: false }),
        score({ entityId: 2, team: 'A', displayName: 'YOU', score: 20, isLocal: true }),
      ]),
    );
    const rows = bodyRows(blockAt(r, 0));
    expect(readRow(rows[0] as FakeElement).local).toBe(true);
    expect(readRow(rows[1] as FakeElement).local).toBe(false);
  });

  it('writes a name and a cell only when it changed', () => {
    const r = rig();
    const row = score({ team: 'A', displayName: 'ALPHA', kills: 1 });
    r.board.refresh(system([row]));
    const el = bodyRows(blockAt(r, 0))[0] as FakeElement;
    el.children[0]!.textContent = 'TOUCHED';
    el.children[1]!.textContent = 'TOUCHED';
    r.board.refresh(system([row]));
    expect(el.children[0]?.textContent).toBe('TOUCHED');
    expect(el.children[1]?.textContent).toBe('TOUCHED');
    row.kills = 2;
    r.board.refresh(system([row]));
    expect(el.children[1]?.textContent).toBe('2');
  });

  it('puts the whole roster on one ladder in Free-for-All, best first', () => {
    const r = rig(FFA, 3);
    r.board.refresh(
      system([
        score({ entityId: 1, team: 'A', displayName: 'ALPHA', score: 100 }),
        score({ entityId: 2, team: 'B', displayName: 'BRAVO', score: 900 }),
        score({ entityId: 3, team: 'A', displayName: 'CHARLIE', score: 500 }),
      ]),
    );
    const ladder = bodyRows(blockAt(r, 0));
    expect(ladder.slice(0, 3).map((row) => readRow(row).name)).toEqual(['BRAVO', 'CHARLIE', 'ALPHA']);
    expect(ladder.slice(3).every((row) => row.hidden)).toBe(true);
  });

  it('survives a board with no columns bound yet', () => {
    const r = rig(SEAT_A, 2, null);
    r.board.refresh(system([score({ team: 'A', displayName: 'ALPHA' })]));
    expect(readRow(bodyRows(blockAt(r, 0))[0] as FakeElement).name).toBe('ALPHA');
    expect(readRow(bodyRows(blockAt(r, 0))[0] as FakeElement).cells).toEqual([]);
  });
});

// ---------------------------------------------------------------------------- dispose

describe('dispose', () => {
  it('takes the board off whatever is holding it', () => {
    const host = new FakeElement('div');
    const board = new Scoreboard(2);
    host.appendChild(board.element as unknown as FakeElement);
    expect(host.children).toHaveLength(1);
    board.dispose();
    expect(host.children).toHaveLength(0);
  });
});
