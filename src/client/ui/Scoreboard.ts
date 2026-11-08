/**
 * The scoreboard, on held Tab (brief S6.5).
 *
 * Columns come from `GameMode.getScoreboardColumns()` and nothing here knows what a column
 * means — which is the point: Domination's captures and Kill Confirmed's tags become new
 * columns in those modes rather than new branches in this file.
 *
 * Rows are preallocated to the roster size once, so opening the board mid-firefight does no
 * layout beyond the reflow of showing it. It refreshes at 6 Hz while open and not at all
 * while closed, because a scoreboard that repaints sixty times a second is a scoreboard that
 * costs frames during the one moment the player is standing still and safe.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { compareRows, type PlayerScore, type ScoreSystem, type ScoreTeam } from '../../shared/combat/ScoreSystem';
import type { ColumnDef } from '../../shared/modes/GameMode';
import {
  relationClass,
  relationTo,
  teamLabel,
  teamsInViewOrder,
  type ViewerContext,
} from '../../shared/ui/TeamColour';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
interface Row {
  readonly el: HTMLElement;
  readonly name: HTMLElement;
  readonly cells: HTMLElement[];
  readonly last: string[];
  lastName: string;
  bound: PlayerScore | null;
}

/** One side's block: the coloured container, its heading strip and the body holding its rows. */
interface TeamBlock {
  readonly block: HTMLElement;
  readonly head: HTMLElement;
  readonly body: HTMLElement;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const REFRESH_HZ = 6;
//#endregion

// ====================================== CLASS Scoreboard ====================================== \\
//#region Class Scoreboard
export class Scoreboard {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly element: HTMLElement;

  private readonly teamHeads: Record<ScoreTeam, HTMLElement>;
  private readonly bodies: Record<ScoreTeam, HTMLElement>;
  private readonly rows: Record<ScoreTeam, Row[]> = { A: [], B: [] };
  /**
   * Every row slot on the board, in one list, for the Free-for-All ladder (M13 Phase A).
   *
   * FFA has no sides to split by, and a board that split its eight operators into two columns
   * of four under ALLIES and AXIS was telling the player their team was winning a mode with
   * no teams. So in FFA the second block is hidden, its row elements are moved under the
   * first, and this list — A's rows then B's, the same order the DOM ends up in — is filled
   * from one sort of the whole roster. The slots are the same preallocated elements; nothing
   * is built or destroyed on a mode change.
   */
  private readonly ladder: Row[] = [];
  private readonly title: HTMLElement;
  /** The two team blocks and the grid holding them, so `setViewer` can reorder and recolour. */
  private readonly grid: HTMLElement;
  private readonly blocks: Record<ScoreTeam, HTMLElement>;
  /** The name-column heading per side. Its text is `ALLIES`/`AXIS` and therefore relative. */
  private readonly teamLabels: Partial<Record<ScoreTeam, HTMLElement>> = {};
  private viewer: ViewerContext = { team: 'A', freeForAll: false };
  private columns: ColumnDef[] = [];
  private open = false;
  private accumulator = 0;
  /** Reused sort buffer, so opening the board allocates nothing. */
  private readonly sortBuffer: PlayerScore[] = [];
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(rowsPerTeam: number) {
    this.element = document.createElement('div');
    this.element.className = 'sb';

    this.title = document.createElement('div');
    this.title.className = 'sb__title op-label';
    this.element.appendChild(this.title);

    const grid = document.createElement('div');
    grid.className = 'sb__grid';
    this.element.appendChild(grid);

    const a = this.createTeamBlock('A', rowsPerTeam);
    grid.appendChild(a.block);
    const b = this.createTeamBlock('B', rowsPerTeam);
    grid.appendChild(b.block);

    this.teamHeads = { A: a.head, B: b.head };
    this.bodies = { A: a.body, B: b.body };
    this.grid = grid;
    this.blocks = { A: a.block, B: b.block };
    this.ladder.push(...this.rows.A, ...this.rows.B);
    this.applyViewer();
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * Which seat is reading this board (playtest round 4, B12).
   *
   * Mutable rather than a constructor argument because the two boards have different
   * lifetimes: `MatchHud`'s is built per match and could have taken it once, but the summary's
   * is built at boot by `GameScreens` and outlives every match it shows. One of the two would
   * have had to set it late, and a field that is sometimes set at construction and sometimes
   * afterwards is the shape that ends up unset.
   *
   * Idempotent, so calling it every time a match starts costs a class write and nothing else.
   */
  setViewer(viewer: ViewerContext): void {
    this.viewer = viewer;
    this.applyViewer();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Bind the mode's columns. Called once per match, because the columns are a property of
   * the mode and the mode does not change mid-match.
   */
  setColumns(columns: ColumnDef[], modeName: string, mapName: string): void {
    this.columns = columns;
    this.title.textContent = `${modeName} · ${mapName}`;

    /**
     * The name column has no floor, and that is playtest round 5's B3 (the last of it).
     *
     * It was `minmax(96px, 1fr)`. A `1fr` track already takes every pixel the fixed columns
     * do not want, so on any board with room to spare the 96px minimum is not what decides
     * the name column's width — the free space is. The only case it ever applied to was the
     * case with **no** free space, where all it could do was push the row wider than the box
     * holding it: a 375px window has 328px for a board whose fixed columns and gaps already
     * want 272, and the floor turned the 56px that were left into a 96px overflow.
     *
     * So it only ever fired where it did harm. `.sb__name` has carried
     * `overflow: hidden; text-overflow: ellipsis` since M4 for exactly this: a callsign that
     * does not fit is a callsign that ends in a dot, not a column that leaves the screen.
     *
     * `ch` is resolved against the font on `.sb__head` / `.sb__row`, which `app.css` pins to
     * the cells' own size for that reason — see the comment there.
     */
    const template = `minmax(0, 1fr) ${columns.map((c) => `${c.width}ch`).join(' ')}`;
    for (const team of ['A', 'B'] as const) {
      this.buildHead(team, template, columns);
      this.bodies[team].style.setProperty('--sb-cols', template);
      this.bindRowCells(team, template, columns);
    }
  }

  setOpen(on: boolean, score: ScoreSystem): void {
    if (on === this.open) return;
    this.open = on;
    this.element.classList.toggle('sb--on', on);
    // Refresh immediately on open rather than waiting up to a sixth of a second: the board
    // is asked for at exactly the moment its contents matter.
    if (on) this.refresh(score);
    this.accumulator = 0;
  }

  /** Called once per rendered frame. Does nothing while closed. */
  update(dt: number, score: ScoreSystem): void {
    if (!this.open) return;
    this.accumulator += dt;
    if (this.accumulator < 1 / REFRESH_HZ) return;
    this.accumulator = 0;
    this.refresh(score);
  }

  /** Fill the board once. Also used by the end-of-match summary. */
  refresh(score: ScoreSystem): void {
    if (this.viewer.freeForAll) {
      // One ladder, everybody on it, sorted once.
      this.fill(this.ladder, this.sorted(score, null));
      return;
    }
    for (const team of ['A', 'B'] as const) {
      this.fill(this.rows[team], this.sorted(score, team));
    }
  }

  dispose(): void {
    this.element.remove();
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** One side's block, with its row slots pushed onto that side's list. */
  private createTeamBlock(team: ScoreTeam, rowsPerTeam: number): TeamBlock {
    const block = document.createElement('div');
    // The colour class is written by `setViewer`, which is the single writer of everything
    // on this board that depends on which seat is reading it (round 4, B12).
    block.className = 'sb__team';

    const head = document.createElement('div');
    head.className = 'sb__head';
    block.appendChild(head);

    const body = document.createElement('div');
    body.className = 'sb__body';
    block.appendChild(body);

    for (let i = 0; i < rowsPerTeam; i++) {
      const el = document.createElement('div');
      el.className = 'sb__row';
      el.hidden = true;
      const name = document.createElement('span');
      name.className = 'sb__name';
      el.appendChild(name);
      body.appendChild(el);
      this.rows[team].push({ el, name, cells: [], last: [], lastName: '', bound: null });
    }

    return { block, head, body };
  }

  /**
   * The one writer of everything relative on this board: block colour, block order, heading,
   * and — in Free-for-All — whether there are two blocks at all.
   *
   * Order is DOM order — `appendChild` on an element already in the grid moves it — so the
   * viewer's own side is always the left-hand block. That is half of what B12 reports: a
   * team-B player was reading their score on the right, in red, under a heading that told them
   * they were the Axis.
   *
   * In FFA there is one block, uncoloured, holding every row slot: the second block's rows are
   * moved under the first and the second block is hidden. The move is reversed for the next
   * team match, because the summary's board outlives every match it shows.
   */
  private applyViewer(): void {
    const ffa = this.viewer.freeForAll;
    for (const team of teamsInViewOrder(this.viewer)) {
      const relation = relationTo(this.viewer, team);
      const block = this.blocks[team];
      block.className = ffa ? 'sb__team' : `sb__team sb__team--${relationClass(relation)}`;
      // Re-appending in view order re-sorts the grid without rebuilding either block.
      this.grid.appendChild(block);
      const label = this.teamLabels[team];
      if (label !== undefined) label.textContent = this.labelFor(team);
    }
    // One ladder or two columns: the row elements go where the mode says, the objects stay put.
    const ladderHome = this.bodies.A;
    for (const row of this.rows.B) (ffa ? ladderHome : this.bodies.B).appendChild(row.el);
    this.blocks.B.hidden = ffa;
  }

  /** The name column's heading: relative in a team mode, and not a side at all in FFA. */
  private labelFor(team: ScoreTeam): string {
    return this.viewer.freeForAll ? 'OPERATORS' : teamLabel(relationTo(this.viewer, team));
  }

  /** One side's heading strip: the name column, then one cell per mode column. */
  private buildHead(team: ScoreTeam, template: string, columns: readonly ColumnDef[]): void {
    const head = this.teamHeads[team];
    head.replaceChildren();
    head.style.gridTemplateColumns = template;
    const label = document.createElement('span');
    label.className = 'sb__col sb__col--name';
    label.textContent = this.labelFor(team);
    this.teamLabels[team] = label;
    head.appendChild(label);
    for (const column of columns) {
      const cell = document.createElement('span');
      cell.className = `sb__col sb__col--${column.align}`;
      cell.textContent = column.label;
      head.appendChild(cell);
    }
  }

  /** The same columns on every row slot of a side. The name span is kept; the cells are not. */
  private bindRowCells(team: ScoreTeam, template: string, columns: readonly ColumnDef[]): void {
    for (const row of this.rows[team]) {
      row.el.style.gridTemplateColumns = template;
      row.cells.length = 0;
      row.last.length = 0;
      row.el.replaceChildren(row.name);
      for (const column of columns) {
        const cell = document.createElement('span');
        cell.className = `sb__cell sb__cell--${column.align} op-num`;
        row.el.appendChild(cell);
        row.cells.push(cell);
        row.last.push('');
      }
    }
  }

  /**
   * The rows of one side, or of everybody, in board order.
   *
   * Score, then kills, then fewest deaths — `compareRows`, shared with the summary's place so
   * the two cannot disagree. The buffer is reused, so the caller must be done with it before
   * asking again.
   */
  private sorted(score: ScoreSystem, team: ScoreTeam | null): readonly PlayerScore[] {
    this.sortBuffer.length = 0;
    for (const row of score.rows) {
      if (team === null || row.team === team) this.sortBuffer.push(row);
    }
    this.sortBuffer.sort(compareRows);
    return this.sortBuffer;
  }

  /** Bind sorted data to a run of row slots; slots past the data are hidden. */
  private fill(rows: readonly Row[], sorted: readonly PlayerScore[]): void {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      this.bindRow(row, sorted[i]);
    }
  }

  /** One slot: the player bound to it, or nobody. */
  private bindRow(row: Row, data: PlayerScore | undefined): void {
    if (data === undefined) {
      if (!row.el.hidden) row.el.hidden = true;
      row.bound = null;
      return;
    }
    if (row.el.hidden) row.el.hidden = false;
    if (row.bound !== data) {
      row.bound = data;
      row.el.classList.toggle('sb__row--local', data.isLocal);
    }
    if (data.displayName !== row.lastName) {
      row.lastName = data.displayName;
      row.name.textContent = data.displayName;
    }
    this.fillCells(row, data);
  }

  /** The mode's columns, each written only when its text changed. */
  private fillCells(row: Row, data: PlayerScore): void {
    for (let c = 0; c < this.columns.length; c++) {
      const column = this.columns[c];
      const cell = row.cells[c];
      if (column === undefined || cell === undefined) continue;
      const text = column.value(data);
      if (text === row.last[c]) continue;
      row.last[c] = text;
      cell.textContent = text;
    }
  }
  //#endregion
}
//#endregion
