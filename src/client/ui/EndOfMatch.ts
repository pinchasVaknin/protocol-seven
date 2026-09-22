import { accuracy, compareRows, killDeath, type PlayerScore, type ScoreSystem, type ScoreTeam } from '../../shared/combat/ScoreSystem';
import type { ColumnDef, MatchResult } from '../../shared/modes/GameMode';
import { personalOutcome, type PersonalOutcome } from '../../shared/modes/MatchOutcome';
import { relationClass, relationTo, teamLabel, teamsInViewOrder, type ViewerContext } from '../../shared/ui/TeamColour';
import type { CharacterAssetService } from '../characters/CharacterAssetService';
import type { WeaponAssetService } from '../weapons/WeaponAssetService';
import type { CharacterId } from '../characters/CharacterCatalog';
import type { ProceduralAudio } from '../engine/ProceduralAudio';
import type { Profile } from '../meta/Profile';
import { CharacterStage, PODIUM_STAGE, type StageFigure } from './CharacterStage';
import { teamEmblemUrl } from './Emblem';
import { createScreen } from './Frame';
import { podiumOf, podiumSlots } from './Lineup';
import { PlayerCard } from './PlayerCard';
import { Scoreboard } from './Scoreboard';
import { makeScreenFooter, makeScreenHeader, type ScreenPlace } from './ScreenChrome';
import { makeIconSvg } from './WeaponIcons';

/**
 * The debrief (brief S6.5; on the frame, M15 D; rebuilt as the human's two-screen
 * choreography, M18): the result, then the podium, then the XP — and the board on a tab.
 *
 * ## The shape
 *
 * The shared chrome (`ScreenChrome.ts`): the header names the place — AFTER ACTION REPORT
 * over the mode and the map — and carries the player card, whose level flips with the XP
 * bar rather than before it; the footer is the line and the stamp. Between them, three
 * bands: the **head** (the result, small, with the score and the reason beside it, and the
 * PODIUM / SCOREBOARD tabs), the **body** (the result card, then the podium, or the board),
 * and the **band** (the XP strip and the two ways out: PLAY AGAIN and MAIN MENU).
 *
 * ## The choreography, on the render clock
 *
 * `tick` runs a timeline in seconds since `show`, and each phase is a class on the frame
 * that the stylesheet transitions into; the staggers inside a phase are `transition-delay`s
 * there, so the timing is in one place per phase rather than a timer per element:
 *
 *  - **The card** (`dbf--card`, 0 s): VICTORY lands with a hit, the reason under it, the two
 *    team plates in from the sides with VS between, the mission card up from below — the
 *    map's picture, the mode and the difficulty, the player's own six figures — and the
 *    band with the XP strip at its foot.
 *  - **The dock** (`dbf--dock`, 4.2 s): the plates lift and fade, the mission card drops,
 *    and the word shrinks onto its place in the head — a FLIP: the big word is transformed
 *    onto the small one's box, measured at that moment, so it arrives exactly where the
 *    small one stands and the small one takes over (`dbf--docked`). The score comes with it
 *    (the human: the numbers must not leave with the plates), and a sweep is heard.
 *  - **The podium** (`dbf--podium`, 4.9 s): the stage fades in and the three best of the
 *    match walk onto their blocks — bronze, silver, gold — the walk the bodies' own
 *    (`CharacterStage.walkIn`). Then the plates under their feet (`dbf--plates`): the
 *    medal, MVP on the first, the name in the team's colour, a note each as they land. Then
 *    the stat cards (`dbf--stats`): score, kills, deaths, K/D.
 *  - **Rest** (`dbf--rest`, 8.1 s): the XP cadence starts (`onXp`, set by `GameScreens`),
 *    and the screen is done moving.
 *
 * Ten seconds was the human's budget for this, against a summary hold the server now keeps
 * for thirty; the rest lands at eight, and the cadence plays into the twenty that remain.
 *
 * ## Skipping, and the keys
 *
 * A second after the screen is up the keys arm: **Space** is PLAY AGAIN, **Escape** is MAIN
 * MENU, **Tab** turns the board over, and any other key or a click on nothing settles the
 * choreography to its rest at once (`settle`) — a player who has seen it fifty times has a
 * way past it. The second of grace is for the hand that was still holding jump when the
 * match ended, and for the Escape that was aimed at the pause menu.
 *
 * ## Two buttons that mean two things
 *
 * PLAY AGAIN in single-player starts the same match again — map, mode, difficulty as they
 * stand. Connected, it is NEXT MATCH with the server's countdown, because the server runs
 * the ballot and the rotation and there is no "again" to give: the seat, the socket and the
 * world survive it. MAIN MENU is the same in both — the menu, the world dropped, the socket
 * closed — and is offered in both, which it was not while the primary also went there.
 *
 * ## The XP insertion point
 *
 * `xpSlot` is the band's left cell; `GameScreens` appends the `XpSummary` to it and hides it
 * for a mode that banks nothing. The row list grows *up* out of the strip, over the stage,
 * and does not open on its own here — the strip names how many unlocks it holds and a click
 * opens it — because it would open over the podium's stat cards otherwise.
 */

export interface SummaryDeps {
  readonly rowsPerTeam: number;
  /** The primary: the same match again in single-player; the arena, when the server says, connected. */
  readonly onContinue: () => void;
  /** The secondary: the main menu, whatever is connected. */
  readonly onExit: () => void;
  /** The skins, for the podium (D1). The same service the match drew the bodies from. */
  readonly characterAssets: CharacterAssetService;
  /** The weapon files the podium's bodies hold (M19, stage 3). */
  readonly weaponAssets: WeaponAssetService | null;
  readonly anisotropy: () => number;
  /** The player, for the header's card. */
  readonly profile: Profile;
  /** The three cues (M18). `ProceduralAudio` in the client; no-ops on the layout probe. */
  readonly audio: Pick<ProceduralAudio, 'playDebriefHit' | 'playDebriefSweep' | 'playDebriefMedal'>;
}

/**
 * What the podium needs to know about an entity that the board does not carry (D1): which
 * body it wore and what it held. `Game` answers from the world's own character selector and
 * the renderer's actor list; the layout probe answers with a fixture.
 */
export interface LineupSource {
  /** The body the match dealt this entity — or, for the local player, the skin they picked. */
  characterIdFor(entityId: number): CharacterId;
  /** What this entity was last holding, or null for a body the screen never saw armed. */
  weaponIdFor(entityId: number): string | null;
}

/** What the result card names about the match: the mission card's facts. */
export interface MatchFacts {
  readonly mapName: string;
  /** `public/maps/<id>.jpg`, the menu's own picture of the map. */
  readonly mapPicture: string;
  readonly modeName: string;
  /** The bots' tier in single-player; null connected, where the roster has no one tier. */
  readonly difficulty: string | null;
}

/** The timeline, seconds from `show`. */
const DOCK_AT = 4.2;
const DOCKED_AT = 4.8;
const PODIUM_AT = 4.9;
/** Metres behind its block a body starts its walk, and seconds between one body starting and the next. */
const WALK_BACK = 3.2;
const WALK_STAGGER = 0.3;
const PLATES_AT = 7.0;
/** Seconds between one medal landing and the next; bronze first. */
const MEDAL_STAGGER = 0.16;
const STATS_AT = 7.6;
const REST_AT = 8.2;
/** Seconds before the keys mean anything. */
const ARM_AT = 1.0;

/** Just in front of the toes, where the plate hangs. Metres. */
const PLATE_LEAD = 0.55;

const ARROW_LEFT = 'M11 4 l1.6 1.6 -5.3 5.4 H21 v2 H7.3 l5.3 5.4 L11 20 l-8 -8 Z';
const DOUBLE_CHEVRON = 'M4 4 L12 12 L4 20 L2.4 18.4 L8.8 12 L2.4 5.6 Z M12 4 L20 12 L12 20 L10.4 18.4 L16.8 12 L10.4 5.6 Z';

const MEDAL_CLASS = ['gold', 'silver', 'bronze'] as const;

export class EndOfMatch {
  readonly element: HTMLElement;
  /** M6 appends the XP breakdown here. Empty and hidden until it does. */
  readonly xpSlot: HTMLElement;
  /** The XP cadence, started when the choreography rests. `GameScreens` sets it per match. */
  onXp: (() => void) | null = null;

  private readonly deps: SummaryDeps;
  private readonly viewport: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly card: PlayerCard;
  private readonly body: HTMLElement;

  // the head
  private readonly headWord: HTMLElement;
  private readonly headScore: HTMLElement;
  private readonly headReason: HTMLElement;
  private readonly podiumTab: HTMLButtonElement;
  private readonly boardTab: HTMLButtonElement;

  // the result card
  private readonly resultCard: HTMLElement;
  private readonly heroWord: HTMLElement;
  private readonly heroReason: HTMLElement;
  private readonly teams: HTMLElement;
  private readonly mission: HTMLElement;

  // the podium and the board
  private readonly stageBox: HTMLElement;
  private readonly stage: CharacterStage;
  private readonly plates: HTMLElement;
  private readonly board: Scoreboard;
  private readonly boardBox: HTMLElement;
  private readonly awards: HTMLElement;

  // the band
  private readonly continueButton: HTMLButtonElement;
  private readonly continueLabel: HTMLElement;

  private viewer: ViewerContext = { team: 'A', freeForAll: false };
  private place: ScreenPlace = { title: 'AFTER ACTION REPORT', subtitle: '' };

  /** Seconds since `show`; the timeline runs on it. -1 while hidden. */
  private clock = -1;
  private phase = 0;
  private medalsPlayed = 0;
  private podiumCount = 0;
  private xpStarted = false;
  private outcomeKind: PersonalOutcome['kind'] = 'WIN';
  private listening = false;

  constructor(deps: SummaryDeps) {
    this.deps = deps;
    const { layer, viewport, frame } = createScreen('op-screen dbf');
    this.element = layer;
    this.viewport = viewport;
    this.frame = frame;
    this.element.hidden = true;

    this.card = new PlayerCard({
      profile: deps.profile,
      online: () => this.networked,
      // Nothing to open here: the profile is the menu's.
      onOpenProfile: () => undefined,
    });
    this.card.element.classList.add('op-card--static');

    // ---- the head: the result small, the score, the reason; the tabs ----
    const head = document.createElement('div');
    head.className = 'dbf-head';
    const result = document.createElement('div');
    result.className = 'dbf-head__result';
    this.headWord = document.createElement('span');
    this.headWord.className = 'dbf-head__word';
    this.headScore = document.createElement('span');
    this.headScore.className = 'dbf-head__score op-num';
    this.headReason = document.createElement('span');
    this.headReason.className = 'dbf-head__reason op-label';
    result.append(this.headWord, this.headScore, this.headReason);

    const tabs = document.createElement('div');
    tabs.className = 'dbf-tabs';
    tabs.setAttribute('role', 'tablist');
    this.podiumTab = makeTab('PODIUM');
    this.boardTab = makeTab('SCOREBOARD');
    this.podiumTab.addEventListener('click', () => this.showBoard(false));
    this.boardTab.addEventListener('click', () => this.showBoard(true));
    const hint = document.createElement('span');
    hint.className = 'dbf-tabs__hint op-label';
    hint.textContent = 'TAB';
    tabs.append(this.podiumTab, this.boardTab, hint);
    head.append(result, tabs);

    // ---- the body: the card, the podium, the board ----
    this.body = document.createElement('div');
    this.body.className = 'dbf-body';

    this.resultCard = document.createElement('div');
    this.resultCard.className = 'dbf-card';
    const hero = document.createElement('div');
    hero.className = 'dbf-hero';
    this.heroWord = document.createElement('h1');
    this.heroWord.className = 'dbf-hero__word';
    this.heroReason = document.createElement('p');
    this.heroReason.className = 'dbf-hero__reason op-label';
    hero.append(this.heroWord, this.heroReason);
    this.teams = document.createElement('div');
    this.teams.className = 'dbf-teams';
    this.mission = document.createElement('div');
    this.mission.className = 'dbf-mission';
    this.resultCard.append(hero, this.teams, this.mission);

    this.stageBox = document.createElement('div');
    this.stageBox.className = 'dbf-stage';
    this.stage = new CharacterStage({ characterAssets: deps.characterAssets, anisotropy: deps.anisotropy, weaponAssets: deps.weaponAssets }, PODIUM_STAGE);
    this.plates = document.createElement('div');
    this.plates.className = 'dbf-stage__plates';
    this.stageBox.append(this.stage.canvas, this.plates);

    this.board = new Scoreboard(deps.rowsPerTeam);
    // The same component, shown flat rather than as a hold-to-view overlay, in a box of its
    // own with the awards strip under it (the reference's second screen).
    this.board.element.classList.add('sb--embedded', 'sb--on');
    this.boardBox = document.createElement('div');
    this.boardBox.className = 'dbf-board';
    this.awards = document.createElement('div');
    this.awards.className = 'dbf-awards';
    this.boardBox.append(this.board.element, this.awards);
    this.boardBox.hidden = true;

    this.body.append(this.resultCard, this.stageBox, this.boardBox);

    // ---- the band: the XP strip, and the two ways out ----
    const band = document.createElement('div');
    band.className = 'dbf-band';
    this.xpSlot = document.createElement('div');
    this.xpSlot.className = 'dbf-band__xp';
    this.xpSlot.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'dbf-band__actions';
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'op-cta op-cta--quiet dbf-exit';
    exit.appendChild(makeIconSvg(ARROW_LEFT, '0 0 24 24', 'op-cta__lead'));
    const et = document.createElement('span');
    et.textContent = 'MAIN MENU';
    exit.appendChild(et);
    exit.addEventListener('click', () => deps.onExit());

    this.continueButton = document.createElement('button');
    this.continueButton.type = 'button';
    this.continueButton.className = 'op-cta op-cta--primary dbf-continue';
    this.continueButton.appendChild(makeIconSvg(DOUBLE_CHEVRON, '0 0 24 24', 'op-cta__lead'));
    this.continueLabel = document.createElement('span');
    this.continueButton.appendChild(this.continueLabel);
    const key = document.createElement('span');
    key.className = 'dbf-continue__key op-label';
    key.textContent = 'SPACE';
    this.continueButton.appendChild(key);
    this.continueButton.addEventListener('click', () => deps.onContinue());
    actions.append(exit, this.continueButton);
    band.append(this.xpSlot, actions);

    frame.append(head, this.body, band);
    this.element.addEventListener('pointerdown', this.onPointer);
    this.paintButton();
  }

  // -- facts the screen is told --------------------------------------------------

  /**
   * How long the **server** is still holding this screen, seconds. `null` when nobody is.
   *
   * Written once per frame by `Game.draw`, from `(endsTick - currentTick) * DT` against the
   * synced server clock — the same derivation the vote overlay's clock has always used. It is
   * not integrated here and there is no local `dt` any more, which is the round-4 fix for B4's
   * timer: a client counting for itself is a second clock for a fact the server owns, and it
   * kept counting through a connection that had gone away.
   *
   * Display only. Reaching zero changes the label and nothing else: the arena arrives when the
   * server migrates everybody, and a client that decided for itself would leave early and stand
   * in a world that has been torn down.
   */
  setRemainingSeconds(seconds: number | null): void {
    const next = seconds === null ? -1 : Math.max(0, Math.ceil(seconds));
    if (next === this.remainingSeconds) return;
    this.remainingSeconds = next;
    this.paintButton();
  }

  private paintButton(): void {
    const left = this.remainingSeconds;
    if (!this.networked) {
      this.continueLabel.textContent = 'PLAY AGAIN';
      return;
    }
    this.continueLabel.textContent = left > 0 ? `NEXT MATCH · ${left}s` : 'NEXT MATCH';
  }

  /**
   * Whether a server is holding this screen.
   *
   * Derived from the connection rather than from the hold it happened to send. They are
   * different facts, and taking `holdSeconds > 0` for the second meant this screen described
   * itself as single-player whenever that number was missing — which now decides a label as
   * well as a countdown.
   */
  private networked = false;
  /** Whole seconds left on the server's hold, or -1 for "nobody is holding this". */
  private remainingSeconds = -1;

  setNetworked(on: boolean): void {
    this.networked = on;
    this.paintButton();
  }

  /** Bind the mode's scoreboard columns. Same call the in-match board gets. */
  setColumns(columns: ColumnDef[], modeName: string, mapName: string): void {
    this.board.setColumns(columns, modeName, mapName);
  }

  /**
   * Which seat is reading the board (playtest round 4, B12).
   *
   * This screen is built once at boot and shows every match after it, so unlike `MatchHud`'s
   * board it cannot take the viewer at construction — there is no seat yet. `GameScreens
   * .showSummary` sets it from `match.localTeam`, beside the winner it already passes for
   * exactly the same reason: it is the one place that knows which side this client was on.
   * The plates on the podium read it too: a colour is a relation to the viewer.
   */
  setViewer(viewer: ViewerContext): void {
    this.viewer = viewer;
    this.board.setViewer(viewer);
  }

  /**
   * The level the XP bar is showing, for the header's card: it flips with the flourish.
   * Kept, because `show` repaints the card and must not put the banked level back on it —
   * the strip is primed before the screen is shown, and the card follows the strip.
   */
  setShownLevel(level: number): void {
    this.shownLevel = level;
    this.card.refresh(level);
  }

  private shownLevel: number | undefined = undefined;

  // -- showing ---------------------------------------------------------------------

  /**
   * The headline and the reason line, per recipient (M13 Phase A, bug 4.4).
   *
   * `personalOutcome` decides what this seat reads — VICTORY, DEFEAT, DRAW, or in a mode that
   * crowned one individual, that individual's VICTORY and everybody else's place. The seat is
   * a side *and* an entity, because in Free-for-All the side is substrate and three of every
   * four players on the winner's side did not win.
   *
   * Then the podium (D1, M18): `podiumOf` decides who stands on it and `podiumSlots` where;
   * `lineup` says what body and what weapon each of them gets. The board is refreshed behind
   * the PODIUM tab, which is the one the screen opens on. The choreography starts at zero.
   */
  show(
    result: MatchResult,
    localTeam: ScoreTeam,
    localId: number,
    score: ScoreSystem,
    lineup: LineupSource,
    facts: MatchFacts,
  ): void {
    const outcome = personalOutcome(result, localTeam, localId, score.rows);
    this.outcomeKind = outcome.kind;
    const winnerName = result.winnerEntityId === undefined ? '' : nameOf(score.rows, result.winnerEntityId);
    const reason = reasonLine(outcome, result, winnerName);
    for (const word of [this.heroWord, this.headWord]) {
      word.textContent = outcome.label;
      word.classList.toggle('is-win', outcome.kind === 'WIN');
      word.classList.toggle('is-loss', outcome.kind === 'LOSS');
    }
    this.heroReason.textContent = reason;
    this.headReason.textContent = reason;

    // The score in view order: this seat's side first (B12), the leader's first in Free-for-All.
    const [near, far] = this.viewer.freeForAll ? [result.scoreA, result.scoreB] : this.scoresInViewOrder(result);
    this.headScore.replaceChildren();
    const a = document.createElement('b');
    a.textContent = String(near);
    const dash = document.createElement('i');
    dash.textContent = '—';
    const b = document.createElement('b');
    b.textContent = String(far);
    this.headScore.append(a, dash, b);

    this.paintTeams(result, score);
    this.paintMission(score, facts);
    this.board.refresh(score);
    this.paintAwards(score);

    // The podium: bodies on their blocks, plates under their feet, out of sight until their phase.
    const rows = podiumOf(result, score.rows);
    const slots = podiumSlots(rows.length);
    const figures: StageFigure[] = [];
    this.plates.replaceChildren();
    rows.forEach((row, index) => {
      const slot = slots[index];
      if (slot === undefined) return;
      figures.push({
        characterId: lineup.characterIdFor(row.entityId),
        weaponId: lineup.weaponIdFor(row.entityId),
        x: slot.x,
        y: slot.y,
        z: slot.z,
        yaw: slot.yaw,
      });
      this.plates.appendChild(this.plateFor(row, index, this.stage.projectToCanvas(slot.x, slot.y, slot.z + PLATE_LEAD)));
    });
    this.stage.showLineup(figures);
    this.podiumCount = figures.length;

    // The chrome, with this match's mode and map under the place's name.
    this.place = { title: 'AFTER ACTION REPORT', subtitle: `${facts.modeName} · ${facts.mapName}`.toUpperCase() };
    this.card.refresh(this.shownLevel);
    this.viewport.replaceChildren(
      makeScreenHeader('op-head--frame', this.place, this.card.element),
      this.frame,
      makeScreenFooter('op-foot--frame', this.place),
    );

    // From the top: no phase, no transform left over from the last dock, the timeline at zero.
    this.frame.classList.remove('dbf--card', 'dbf--dock', 'dbf--docked', 'dbf--podium', 'dbf--plates', 'dbf--stats', 'dbf--rest', 'dbf--instant');
    this.heroWord.style.transform = '';
    this.phase = 0;
    this.medalsPlayed = 0;
    this.xpStarted = false;
    this.clock = 0;
    this.showBoard(false);
    this.element.hidden = false;
    this.listen();
    // The first phase on the frame after the screen is laid out, so the card's entrance is a transition.
    void this.frame.offsetWidth;
    this.enter(1);
  }

  /** The SCOREBOARD tab, or the PODIUM tab. The probe measures both. */
  showBoard(on: boolean): void {
    this.stageBox.hidden = on;
    this.resultCard.hidden = on;
    this.boardBox.hidden = !on;
    this.podiumTab.setAttribute('aria-selected', on ? 'false' : 'true');
    this.boardTab.setAttribute('aria-selected', on ? 'true' : 'false');
    this.podiumTab.classList.toggle('op-tab--on', !on);
    this.boardTab.classList.toggle('op-tab--on', on);
  }

  /** Whether the board is the tab showing. */
  get boardShowing(): boolean {
    return !this.boardBox.hidden;
  }

  /**
   * One frame of the choreography and of the podium. Driven from `Game.draw`, so it stops
   * with the frame loop; a screen the probe shows and never ticks stays where `show` or
   * `settle` put it.
   */
  tick(dt: number): void {
    if (this.element.hidden || this.clock < 0) return;
    this.clock += dt;
    const t = this.clock;
    if (this.phase < 2 && t >= DOCK_AT) this.enter(2);
    if (this.phase < 3 && t >= DOCKED_AT) this.enter(3);
    if (this.phase < 4 && t >= PODIUM_AT) this.enter(4);
    if (this.phase < 5 && t >= PLATES_AT) this.enter(5);
    if (this.phase === 5) {
      // The medals, one at a time from bronze, each with its note.
      while (this.medalsPlayed < this.podiumCount && t >= PLATES_AT + this.medalsPlayed * MEDAL_STAGGER) {
        const rank = this.podiumCount - 1 - this.medalsPlayed;
        this.deps.audio.playDebriefMedal(rank);
        this.medalsPlayed++;
      }
    }
    if (this.phase < 6 && t >= STATS_AT) this.enter(6);
    if (this.phase < 7 && t >= REST_AT) this.enter(7);
    if (!this.stageBox.hidden) this.stage.tick(dt);
  }

  /**
   * The rest state, now: every phase on, the transitions off for the frame it takes, the
   * bodies on their marks, the cadence started. The skip's, and the layout probe's — which
   * measures in the task it shows in and wants where the screen ends up.
   */
  settle(): void {
    if (this.clock < 0) return;
    this.frame.classList.add('dbf--instant');
    for (let phase = this.phase + 1; phase <= 7; phase++) this.enter(phase, true);
    this.stage.settle();
    this.clock = Math.max(this.clock, REST_AT);
    void this.frame.offsetWidth;
    this.frame.classList.remove('dbf--instant');
  }

  /** The result card alone, at rest: the layout probe's first surface. */
  settleCard(): void {
    if (this.clock < 0) return;
    this.frame.classList.add('dbf--instant');
    this.enter(1, true);
    void this.frame.offsetWidth;
    this.frame.classList.remove('dbf--instant');
  }

  hide(): void {
    this.element.hidden = true;
    this.clock = -1;
    this.shownLevel = undefined;
    this.unlisten();
    // The bodies go with the screen: a podium nobody is looking at is three skins held for nothing.
    this.stage.release();
  }

  dispose(): void {
    this.unlisten();
    this.element.removeEventListener('pointerdown', this.onPointer);
    this.stage.dispose();
    this.board.dispose();
    this.element.remove();
  }

  // -- the phases --------------------------------------------------------------------

  /** Into `phase`, doing what the phase does on the way in. `instant` is the settle's: no sound. */
  private enter(phase: number, instant = false): void {
    if (phase <= this.phase) return;
    this.phase = phase;
    const cls = this.frame.classList;
    switch (phase) {
      case 1:
        cls.add('dbf--card');
        if (!instant) this.deps.audio.playDebriefHit(this.outcomeKind);
        break;
      case 2:
        // The dock: the big word onto the small one's box, measured now, before the class
        // moves anything else. The card's other parts leave on their own transitions.
        if (!instant) this.flipWordToHead();
        cls.add('dbf--dock');
        if (!instant) this.deps.audio.playDebriefSweep();
        break;
      case 3:
        cls.add('dbf--docked');
        break;
      case 4:
        cls.add('dbf--podium');
        if (!instant) this.stage.walkIn(WALK_BACK, WALK_STAGGER);
        break;
      case 5:
        cls.add('dbf--plates');
        if (instant) this.medalsPlayed = this.podiumCount;
        break;
      case 6:
        cls.add('dbf--stats');
        break;
      case 7:
        cls.add('dbf--rest');
        if (!this.xpStarted) {
          this.xpStarted = true;
          this.onXp?.();
        }
        break;
      default:
        break;
    }
  }

  /**
   * The word's move: from where the big one stands to where the small one does, as one
   * transform — measured in window pixels and divided by the frame's scale, because the
   * transform is applied in the element's own pixels and the frame is zoomed (`Frame.ts`).
   */
  private flipWordToHead(): void {
    const from = this.heroWord.getBoundingClientRect();
    const to = this.headWord.getBoundingClientRect();
    if (from.width === 0 || to.width === 0) return;
    const scale = from.width / Math.max(1, this.heroWord.offsetWidth);
    const dx = (to.left - from.left) / scale;
    const dy = (to.top - from.top) / scale;
    const shrink = to.height / from.height;
    this.heroWord.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${shrink.toFixed(4)})`;
  }

  // -- the result card -----------------------------------------------------------------

  private scoresInViewOrder(result: MatchResult): readonly [number, number] {
    const [near] = teamsInViewOrder(this.viewer);
    return near === 'A' ? [result.scoreA, result.scoreB] : [result.scoreB, result.scoreA];
  }

  /**
   * The two plates and VS: this seat's side and the other, named as the board names them
   * (ALLIES / AXIS, relative) under their emblems, each with its score and how many stood on
   * it. Free-for-All has no sides: the plates are the two at the top of the ladder — the
   * winner's and the runner-up's — with their kills, which is what `scoreA` and `scoreB` are
   * there, under the emblem of their relation to the viewer.
   */
  private paintTeams(result: MatchResult, score: ScoreSystem): void {
    this.teams.replaceChildren();
    const rows = score.rows;
    if (this.viewer.freeForAll) {
      const ladder = [...rows].sort(compareRows);
      const crowned = result.winnerEntityId;
      const first = ladder.find((r) => r.entityId === crowned) ?? ladder[0];
      const second = ladder.find((r) => r !== first);
      if (first !== undefined) {
        this.teams.appendChild(this.teamPlate(first.displayName, first.kills, 'WINNER', first.isLocal ? 'FRIENDLY' : 'HOSTILE', true));
      }
      this.teams.appendChild(vs());
      if (second !== undefined) {
        this.teams.appendChild(this.teamPlate(second.displayName, second.kills, 'RUNNER-UP', second.isLocal ? 'FRIENDLY' : 'HOSTILE', false));
      }
      return;
    }
    const [near, far] = teamsInViewOrder(this.viewer);
    const count = (team: ScoreTeam): number => rows.filter((r) => r.team === team).length;
    const scoreOf = (team: ScoreTeam): number => (team === 'A' ? result.scoreA : result.scoreB);
    this.teams.append(
      this.teamPlate(teamLabel('FRIENDLY'), scoreOf(near), `${count(near)} OPERATORS`, 'FRIENDLY', result.winner === near),
      vs(),
      this.teamPlate(teamLabel('HOSTILE'), scoreOf(far), `${count(far)} OPERATORS`, 'HOSTILE', result.winner === far),
    );
  }

  private teamPlate(name: string, points: number, sub: string, relation: 'FRIENDLY' | 'HOSTILE', won: boolean): HTMLElement {
    const plate = document.createElement('div');
    plate.className = `dbf-team dbf-team--${relationClass(relation)}`;
    plate.classList.toggle('is-winner', won);
    // The side's emblem over the plate's top edge (decision 7): the wolf for this seat's side, the demon for the other.
    const emblem = document.createElement('img');
    emblem.className = 'dbf-team__emblem';
    emblem.src = teamEmblemUrl(relation);
    emblem.alt = '';
    emblem.draggable = false;
    plate.appendChild(emblem);
    const n = document.createElement('span');
    n.className = 'dbf-team__name';
    n.textContent = name;
    const s = document.createElement('span');
    s.className = 'dbf-team__score op-num';
    s.textContent = points.toLocaleString();
    const u = document.createElement('span');
    u.className = 'dbf-team__sub op-label';
    u.textContent = sub;
    plate.append(n, s, u);
    return plate;
  }

  /** The mission card: the map's picture and name, the mode and the difficulty, the player's own six figures. */
  private paintMission(score: ScoreSystem, facts: MatchFacts): void {
    this.mission.replaceChildren();
    const pic = document.createElement('img');
    pic.className = 'dbf-mission__img';
    pic.src = facts.mapPicture;
    pic.alt = '';
    pic.draggable = false;

    const where = document.createElement('div');
    where.className = 'dbf-mission__where';
    const label = document.createElement('span');
    label.className = 'op-label';
    label.textContent = 'COMBAT MAP';
    const name = document.createElement('span');
    name.className = 'dbf-mission__map';
    name.textContent = facts.mapName;
    const mode = document.createElement('span');
    mode.className = 'dbf-mission__mode';
    mode.textContent = facts.difficulty === null ? facts.modeName.toUpperCase() : `${facts.modeName} · ${facts.difficulty}`.toUpperCase();
    where.append(label, name, mode);

    const stats = document.createElement('div');
    stats.className = 'dbf-mission__stats';
    const mine = findLocal(score.rows);
    if (mine !== undefined) {
      const pct = accuracy(mine);
      const figures: readonly Readonly<[string, string]>[] = [
        ['SCORE', mine.score.toLocaleString()],
        ['KILLS', String(mine.kills)],
        ['DEATHS', String(mine.deaths)],
        ['K/D', killDeath(mine).toFixed(2)],
        ['ACCURACY', pct < 0 ? '—' : `${pct.toFixed(0)}%`],
        ['STREAK', String(mine.bestStreak)],
      ];
      for (const [l, v] of figures) stats.appendChild(stat(l, v));
    }
    this.mission.append(pic, where, stats);
  }

  /**
   * The awards under the board: the MVP (the ladder's first), the best K/D, the most assists
   * and the longest streak, each with the name in the team's colour — the reference's row,
   * from the same rows the board is drawn from. A board with nobody on it has no awards.
   */
  private paintAwards(score: ScoreSystem): void {
    this.awards.replaceChildren();
    const rows = score.rows;
    if (rows.length === 0) return;
    const ladder = [...rows].sort(compareRows);
    const best = (by: (r: PlayerScore) => number): PlayerScore =>
      ladder.reduce((top, r) => (by(r) > by(top) ? r : top), ladder[0]!);
    const kd = best(killDeath);
    const assists = best((r) => r.assists);
    const streak = best((r) => r.bestStreak);
    const entries: readonly Readonly<[string, PlayerScore, string]>[] = [
      ['MVP', ladder[0]!, `${ladder[0]!.score.toLocaleString()} PTS`],
      ['BEST K/D', kd, killDeath(kd).toFixed(2)],
      ['MOST ASSISTS', assists, String(assists.assists)],
      ['LONGEST STREAK', streak, String(streak.bestStreak)],
    ];
    for (const [label, row, value] of entries) {
      const cell = document.createElement('div');
      cell.className = `dbf-award dbf-award--${relationClass(relationTo(this.viewer, row.team))}`;
      const l = document.createElement('span');
      l.className = 'op-label';
      l.textContent = label;
      const n = document.createElement('span');
      n.className = 'dbf-award__name';
      n.textContent = row.displayName;
      const v = document.createElement('span');
      v.className = 'dbf-award__value op-num';
      v.textContent = value;
      cell.append(l, n, v);
      this.awards.appendChild(cell);
    }
  }

  // -- the podium's plates ----------------------------------------------------------------

  /**
   * A plate under a figure's feet: the medal with its rank, MVP on the first, the callsign
   * in the team's colour — a relation to the viewer, as the board's is — and, on its own
   * phase, the stat card: score, kills, deaths, K/D. Positioned as fractions of the canvas
   * from the lens's own projection, so it lands where the body stands at any frame scale;
   * the canvas's CSS box keeps the lens's aspect for exactly this reason.
   */
  private plateFor(row: PlayerScore, rank: number, at: { readonly u: number; readonly v: number }): HTMLElement {
    const plate = document.createElement('div');
    const medal = MEDAL_CLASS[rank] ?? 'bronze';
    plate.className = `dbf-plate dbf-plate--${medal} dbf-plate--${relationClass(relationTo(this.viewer, row.team))}`;
    if (row.isLocal) plate.classList.add('dbf-plate--local');
    plate.style.left = `${(at.u * 100).toFixed(2)}%`;
    plate.style.top = `${(at.v * 100).toFixed(2)}%`;
    // The stagger inside the phase: bronze lands first, gold last, as the medals are played.
    plate.style.setProperty('--dbf-order', String(rankOrder(rank)));

    const badge = document.createElement('span');
    badge.className = 'dbf-plate__medal op-num';
    badge.textContent = String(rank + 1);
    const who = document.createElement('span');
    who.className = 'dbf-plate__who';
    if (rank === 0) {
      const mvp = document.createElement('span');
      mvp.className = 'dbf-plate__mvp op-label';
      mvp.textContent = 'MVP';
      who.appendChild(mvp);
    }
    const name = document.createElement('span');
    name.className = 'dbf-plate__name';
    name.textContent = row.displayName;
    who.appendChild(name);
    const head = document.createElement('div');
    head.className = 'dbf-plate__head';
    head.append(badge, who);

    const stats = document.createElement('div');
    stats.className = 'dbf-plate__stats';
    const figures: readonly Readonly<[string, string]>[] = [
      ['SCORE', row.score.toLocaleString()],
      ['KILLS', String(row.kills)],
      ['DEATHS', String(row.deaths)],
      ['K/D', killDeath(row).toFixed(2)],
    ];
    for (const [l, v] of figures) stats.appendChild(stat(l, v));

    plate.append(head, stats);
    return plate;
  }

  // -- the keys and the click ------------------------------------------------------------------

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('keydown', this.onKey, true);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('keydown', this.onKey, true);
  }

  private get armed(): boolean {
    return this.clock >= ARM_AT;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.element.hidden || e.repeat) return;
    if (!this.armed) return;
    // By `key` as well as `code`: a synthetic press (the browser pane's, a test's) may carry one and not the other.
    const key = e.code === 'Space' || e.key === ' ' ? 'Space' : e.code === 'Tab' || e.key === 'Tab' ? 'Tab' : e.code === 'Escape' || e.key === 'Escape' ? 'Escape' : e.key;
    switch (key) {
      case 'Space':
        e.preventDefault();
        e.stopPropagation();
        this.deps.onContinue();
        return;
      case 'Escape':
        e.stopPropagation();
        this.deps.onExit();
        return;
      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        this.showBoard(!this.boardShowing);
        return;
      case 'Shift':
      case 'Control':
      case 'Alt':
      case 'Meta':
        // A modifier alone is not a key press.
        return;
      default:
        // Any other key: past the choreography.
        this.settle();
    }
  };

  /** A click on nothing in particular settles the choreography; a button or the strip is its own thing. */
  private readonly onPointer = (e: PointerEvent): void => {
    if (!this.armed) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input') !== null) return;
    this.settle();
  };
}

/** Bronze lands first (0), silver second (1), gold last (2): the medal's stagger on a podium of three. */
function rankOrder(rank: number): number {
  return Math.max(0, 2 - rank);
}

function makeTab(label: string): HTMLButtonElement {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'op-tab dbf-tab';
  tab.setAttribute('role', 'tab');
  tab.textContent = label;
  return tab;
}

function vs(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'dbf-vs';
  el.textContent = 'VS';
  return el;
}

function stat(label: string, value: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'dbf-stat';
  const l = document.createElement('span');
  l.className = 'op-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'dbf-stat__value op-num';
  v.textContent = value;
  cell.append(l, v);
  return cell;
}

/**
 * The line under the result, in the reference's voice — *"YOUR TEAM REACHED THE SCORE
 * LIMIT"* — from the mode's own reason string ('Score limit', 'Tag limit', 'Time limit',
 * 'Time — draw', 'Best of 5', ...) and who it is being read by. The score is on the plates
 * and in the head, so the line says *how* rather than *by how much*.
 */
export function reasonLine(outcome: PersonalOutcome, result: MatchResult, winnerName: string): string {
  const reason = result.reason.trim();
  const lower = reason.toLowerCase();
  const who = winnerName !== '' ? winnerName.toUpperCase() : outcome.kind === 'WIN' ? 'YOUR TEAM' : 'THE ENEMY';
  if (outcome.kind === 'DRAW') {
    if (lower.startsWith('time')) return 'LEVEL WHEN TIME RAN OUT';
    return 'LEVEL AT THE END';
  }
  if (lower === 'time limit') return `${who} LED WHEN TIME RAN OUT`;
  if (lower.endsWith('limit')) return `${who} REACHED THE ${reason.toUpperCase()}`;
  if (lower.startsWith('best of')) return `${who} TOOK THE SERIES · ${result.roundsA} — ${result.roundsB}`;
  return `${who} · ${reason.toUpperCase()}`;
}

function findLocal(rows: readonly PlayerScore[]): PlayerScore | undefined {
  for (const row of rows) {
    if (row.isLocal) return row;
  }
  return undefined;
}

/** A row's callsign, or empty for an entity the board has no row for. */
function nameOf(rows: readonly PlayerScore[], entityId: number): string {
  for (const row of rows) {
    if (row.entityId === entityId) return row.displayName;
  }
  return '';
}
