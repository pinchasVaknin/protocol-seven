/**
 * Every HUD surface `Game` owns, decided once per frame from one place — and the two stores
 * those decisions read.
 *
 * This is the invariant playtest round 4 asked for, and the three reports it answers were
 * all the same defect in different costumes: a surface whose visibility was written from
 * **two** places (the debug overlay, where the × wrote one copy and the pause bookkeeping
 * the other), or from a place that **stops running** at the moment the answer had to change
 * (the scoreboard, written from the sim tick, which does not tick while paused).
 *
 * The rules themselves are pure functions in `shared/ui/HudSurfaces.ts`, which is what makes
 * them measurable: `HeadlessClient` builds no `ClientMatch` and has no DOM, so a claim about
 * a panel is a browser claim — but the rule behind it is an ordinary function the harness can
 * run over a real connection across death, respawn, round end and migration. Same reasoning,
 * and the same shape, as `pickSpectatorTarget`.
 *
 * Driven from state every frame rather than opened and closed by events, for the reason
 * `syncChopperBody` gives about the chopper: each window can end four ways — the countdown
 * expires, the player respawns, the match ends, the world is torn down — and a latch would
 * have to be cleared correctly on all of them. Asked every frame, there is nothing to get
 * stuck, and a panel stuck on screen is one eating the digit keys for the rest of the match.
 *
 * ## Why the cheat door is in this file (C23b)
 *
 * Because `requestCheat` is the writer of the two stores this object reads: `debugRequest`,
 * whose four writers the file above insists on counting, and `offlineCheats`, which is what
 * `cheatMask` answers with when there is no server. Splitting the door from the stores would
 * have put a cycle between two collaborators — the door asks whether the overlay is visible,
 * and the surface state asks for the mask and the caption — and left a store whose only
 * writer lives elsewhere, which is the shape round four was fixing.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { nowMs } from '../shared/core/Clock';
import type { GameStateId } from '../shared/core/GameStates';
import type { HeaderSlot } from '../shared/modes/GameMode';
import {
  aimWarningText,
  cheatTag,
  debugOverlayVisible,
  debugUnlocked,
  quickLoadoutWindow,
  resultSurfacesVisible,
  scoreboardOpen,
  type DebugOverlayRequest,
  type HudSurfaceState,
} from '../shared/ui/HudSurfaces';
import {
  CHEAT_NOTICE_SECONDS,
  CHEAT_SIMULATION,
  CheatOutcome,
  cheatCodeToggling,
  cheatOutcomeText,
  instantCheatLabel,
  isSurfaceCheat,
  isUnlockCheat,
  parseCheatCode,
  toggleCheat,
  type CheatCode,
} from '../shared/cheats/Cheats';
import { grantEverything } from '../shared/meta/Unlocks';
import { logger } from '../shared/core/Log';
import type { Input } from './input/Input';
import type { Profile } from './meta/Profile';
import type { GameScreens } from './GameScreens';
import type { QuickLoadout } from './ui/QuickLoadout';
import type { MatchWorld } from './MatchWorld';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** What this object needs from the application root. */
export interface GameSurfacesDeps {
  readonly screens: GameScreens;
  readonly profile: Profile;
  readonly input: Input;
  readonly quickLoadout: QuickLoadout;
  /** The live world, or null outside a match. */
  readonly world: () => MatchWorld | null;
  readonly currentState: () => GameStateId;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const netLog = logger('join');

/** F8. Shared rather than a fresh literal per frame; nothing mutates it. */
const EMPTY_HEADER: readonly HeaderSlot[] = [];
//#endregion

// ===================================== CLASS GameSurfaces ===================================== \\
//#region Class GameSurfaces
export class GameSurfaces {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /**
   * The player's standing request for the debug overlay (playtest round 4, B1).
   *
   * **The only copy of "is the overlay wanted" there is.** It replaces
   * `overlayWasOpenBeforePause`, which was a second copy of `DebugOverlay.visible` that the ×
   * did not write — so the pause bookkeeping restored an intent the player had cancelled and
   * the panel came back on the way into the game. It lives here rather than on the overlay
   * because it has to outlive the surface: the overlay belongs to the world and a rotation
   * throws the world away.
   *
   * Written from exactly four inputs — the pause menu's button, the overlay's ×, Escape, and
   * the demotion on resume — and read by `update`, which is the one caller of
   * `setVisible`. See `shared/ui/HudSurfaces.ts`.
   */
  private debugRequest: DebugOverlayRequest = 'none';

  /**
   * The entitlements this process has granted itself **while offline** (round 4, F14).
   *
   * Only ever read when there is no server, where this process is the authority and the QA
   * spectator has worked exactly this way since M8. Renamed from `localCheats` when the debug
   * bit was deleted: with that gone there is nothing client-authored left in the mask, so this
   * holds simulation bits and nothing else, and the name may as well say when it applies.
   *
   * Cleared by `Game.teardownWorld`, which is the offline mirror of `MatchInstance.unseat` —
   * the entitlement belongs to the world it was granted in, offline exactly as on a server.
   */
  private offlineCheats = 0;

  /**
   * The instant cheat this client is currently announcing, and when the announcement ends.
   *
   * A **deadline** rather than a countdown, which is B4's lesson taken at its word: a duration is
   * only true at the instant it was created, and one integrated per frame goes on counting
   * through a pause, a rotation and a migration. `nowMs` against a deadline cannot.
   *
   * `pendingInstant` is the client half of one request/reply exchange — the code that was sent,
   * held until the server answers, because the answer carries an outcome and not a label. It is
   * not a second copy of anything: nothing else knows what was typed, the next send replaces it,
   * and a reply that never arrives leaves a field nothing reads. Both are cleared on migration,
   * beside the streak and ballot discards.
   */
  private pendingInstant: CheatCode | null = null;
  private instantCheatLabelText = '';
  private instantCheatUntilMs = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(private readonly deps: GameSurfacesDeps) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * This client's entitlements, from the one authority that owns them (round 4, F14).
   *
   * Connected, it is the server's replicated answer and whatever this process may have granted
   * itself offline is ignored — which is also what makes cheating offline and then joining a
   * server clean up after itself. Offline, there is no server to ask and this process is the
   * authority.
   *
   * It was a merge of two halves until the debug bit was deleted. With every bit in the table
   * now server-authored there is one authority and one expression, which is the simplification
   * that removing a redundant fact buys.
   */
  get cheatMask(): number {
    const net = this.deps.world()?.net?.client;
    return (net === undefined ? this.offlineCheats : net.cheatMask) & CHEAT_SIMULATION;
  }

  /** Push this frame's answer at every surface. One evaluation, from one record. */
  update(): void {
    const state = this.state();
    this.updateQuickLoadout(state);

    const match = this.deps.world()?.match;
    if (match !== undefined) this.pushMatchSurfaces(match, state);

    const overlay = this.deps.world()?.debug.overlay;
    if (overlay !== undefined) overlay.setVisible(debugOverlayVisible(state));

    this.deps.screens.pauseMenu.setDebugAvailable(debugUnlocked(state));
  }

  /**
   * This frame's answer to everything `shared/ui/HudSurfaces.ts` asks about.
   *
   * Rebuilt per frame rather than kept as a field, because every value in it is already owned
   * somewhere else and a retained copy would be exactly the second writer this removed.
   */
  state(): HudSurfaceState {
    const match = this.deps.world()?.match;
    return {
      screen: this.deps.currentState(),
      hasWorld: match !== undefined,
      playerDead: match?.isPlayerDead ?? false,
      respawnSeconds: match?.playerRespawnSeconds ?? 0,
      phase: match?.flow.currentPhase ?? 'WARMUP',
      round: match?.flow.round ?? 1,
      scoreboardHeld: match?.scoreboardHeld ?? false,
      debugRequest: this.debugRequest,
      cheatMask: this.cheatMask,
      instantCheatLabel: this.instantCheatCaption,
      // A fact about the world, not about this frame: `MatchWorld` asks `isArenaInstance` once,
      // when the world is built, and a migration rebuilds the world.
      inWarmupArena: match?.inWarmupArena ?? false,
      // B8. Off `Input`, which `Game` owns rather than the world — so unlike every field
      // above, these three do not go `undefined` between a teardown and the next build, and the
      // banner is describing the same pointer across a rotation that it was before it.
      wantsPointerLock: this.deps.input.pointerLockArmed,
      pointerLocked: this.deps.input.isLocked,
      lockRefused: this.deps.input.pointerLockRefused,
    };
  }

  /** Whether the overlay is on screen this instant. The one question its four writers ask. */
  isDebugOverlayVisible(): boolean {
    return debugOverlayVisible(this.state());
  }

  /** The × asked for it to go. One of the four writers; it decides nothing else. */
  dismissDebugOverlay(): void {
    this.debugRequest = 'none';
  }

  /**
   * The pause screen's debug button. Toggles the request; the frame pass does the showing.
   *
   * A request made here is `'onPause'`, which is what buys the overlay the one screen where
   * the cursor is free — the tuning sliders are unusable anywhere else, and that is the whole
   * reason M5 put this button on the pause menu.
   */
  toggleDebugOverlayFromPause(): void {
    this.debugRequest = this.isDebugOverlayVisible() ? 'none' : 'onPause';
  }

  /**
   * On resume an `'onPause'` request demotes to `'inMatch'`, which is how *"once the overlay
   * has been opened on purpose it stays open through the resume"* survives without a second
   * flag remembering it.
   */
  demoteDebugRequestOnResume(): void {
    if (this.debugRequest === 'onPause') this.debugRequest = 'inMatch';
  }

  /**
   * A code was typed on the pause screen (playtest round 4, F14).
   *
   * **The one door**, and it is the same shape as `ClientMatch.spendStreak` for the same reason:
   * what a code means is one question and who is entitled to answer it is another, and the
   * second depends on which kind of match this is. Nothing downstream ever asks whether a code
   * was typed — every effect reads the entitlement.
   *
   * Three routes out, and the ordering is the policy:
   *
   * - **Unrecognised** is answered here, with no round trip. It is a typo, and asking a server
   *   about it would mean a server that has cheats off answering *"cheats are disabled"* about a
   *   string that is not a code — sending somebody to find an operator they do not need.
   * - **A local code** is applied here, because the client is its authority. It also moves
   *   `debugRequest`, and that is not a second writer of one fact: *may they* and *do they want
   *   it* are two facts, and the code is the only input that has an opinion about both.
   * - **Everything else** is a request. Connected, it goes to the server and nothing changes
   *   locally until the answer arrives — §4.16, and the same rule as an unoptimistic streak.
   *   Offline, the shared table is applied against `offlineCheats`, which is this process being
   *   the authority rather than a second copy of the rule.
   */
  requestCheat(code: string): void {
    const entry = parseCheatCode(code);
    if (entry === null) {
      this.setCodeResult(cheatOutcomeText(CheatOutcome.RefusedUnknown));
      return;
    }
    if (isSurfaceCheat(entry)) {
      this.applySurfaceCheat();
      return;
    }
    if (isUnlockCheat(entry)) {
      this.applyUnlockCheat();
      return;
    }
    this.requestSimulationCheat(entry);
  }

  /**
   * Ask for an entitlement by bits, for the surfaces that are not a text field (round 4, F14).
   *
   * The QA spectator panel and `__p7.spectate.*` want *"god mode on"* rather than a string
   * to type, and they must not become a second way to grant one — so the bits are resolved to the
   * code that toggles them and go through the same door a typed code does. A bit combination with
   * no code is not a request anybody can make, which is the point rather than an edge case.
   */
  requestCheatBits(bits: number): void {
    const code = cheatCodeToggling(bits);
    if (code === null) return;
    this.requestCheat(code);
  }

  /**
   * The server answered a cheat code (playtest round 4, F14).
   *
   * Only the sentence arrives: the entitlements are already in `NetClient.cheatMask` —
   * replicated state, applied before this fires — so there is nothing here to write and
   * nothing that could disagree with what the simulation is doing.
   *
   * It goes to a code field's own line rather than through `voteOverlay.notice`, and
   * that is not a preference: the vote overlay lives under `.op-screen`'s backdrop, so a
   * notice raised while the player is looking at the field they typed into would be painted
   * over by the screen it is answering. `setCodeResult` writes both fields, which is the
   * one rule this feature has about captions now — an answer goes where the question could
   * have been asked, not where the code happens to think the player is standing.
   */
  onCheatsAnswered(outcome: number): void {
    this.setCodeResult(cheatOutcomeText(outcome));
    // An instant cheat is announced on the reply and never before it: the payment is the
    // server's, and a caption raised on the send would be claiming one that may be refused.
    const pending = this.pendingInstant;
    this.pendingInstant = null;
    if (outcome === CheatOutcome.InstantApplied && pending !== null) {
      this.raiseInstantCheat(pending);
    }
    netLog.info(`cheat code answered: outcome ${outcome}.`);
  }

  /** Drop it. Called on migration, beside the streak and ballot discards. */
  clearInstantCheat(): void {
    this.pendingInstant = null;
    this.instantCheatLabelText = '';
    this.instantCheatUntilMs = 0;
  }

  /**
   * The offline authority's own seat boundary (round 4, F14).
   *
   * `MatchInstance.unseat` is where a *server* ends a seat's entitlements. Offline there is no
   * seat and no server, and this is the same boundary: the world the cheat was granted in is
   * going away. Without it a single-player god mode would follow the player through the menu
   * into their next match, which is the same defect the networked half was fixed for.
   *
   * Networked, this field is not read at all — see `cheatMask` — so clearing it costs nothing
   * and is not a second writer of the replicated answer.
   */
  clearOfflineEntitlements(): void {
    this.offlineCheats = 0;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * The quick class selector's window, and the promise its caption makes.
   *
   * The caption is not decoration: "SELECT CLASS" during the pre-match freeze and "SELECT
   * NEXT CLASS" while dead are different promises about when the rifle arrives.
   */
  private updateQuickLoadout(state: HudSurfaceState): void {
    // `classWindow`, not `window`: this file legitimately names the browser global elsewhere,
    // and shadowing it here would be a trap for the next person to add a line.
    const classWindow = quickLoadoutWindow(state);
    if (classWindow === 'none') {
      this.deps.quickLoadout.hide();
      return;
    }
    this.deps.quickLoadout.show(classWindow === 'respawn' ? 'Select next class' : 'Select class');
    this.deps.quickLoadout.update();
  }

  /**
   * The five surfaces the match itself draws, from the predicates that decide them.
   *
   * **The score banner, the streak strip and the board read the same predicate** (F7). Pushed
   * from here rather than decided inside the HUD, for the reason the whole class exists: one
   * place evaluates the rules, once a frame, from one record. The alternative — each surface
   * asking whether it is in the arena — is three copies of a comparison and a fourth surface
   * that forgets to make it.
   *
   * F14's tag and B8's aim warning are surfaces in the same sense — derived once per frame,
   * from state that outlives them — and both are idempotent, which is what lets the pause
   * screen's button appear on the frame the code is typed without anybody refreshing it.
   *
   * F8's mode header rides `resultSurfacesVisible` too: the waiting room has no objectives
   * worth a strip, and a header showing three neutral flags in a room with no flags would be
   * the fourth surface that forgot to ask. The slots themselves come from the mode and are
   * drawn without interpretation — this is the whole of the HUD's knowledge of what
   * Domination is.
   */
  private pushMatchSurfaces(match: NonNullable<ReturnType<GameSurfacesDeps['world']>>['match'], state: HudSurfaceState): void {
    const showsResults = resultSurfacesVisible(state);
    match.setScoreboardOpen(scoreboardOpen(state));
    match.setResultSurfacesVisible(showsResults);
    match.setCheatTag(cheatTag(state));
    match.setAimWarning(aimWarningText(state));
    match.setHeaderSlots(showsResults ? match.headerSlots : EMPTY_HEADER);
  }

  /** The caption for whichever screen the code was typed on: the pause menu, or the menu. */
  private setCodeResult(text: string): void {
    this.deps.screens.pauseMenu.setCodeResult(text);
    this.deps.screens.menus.setCodeResult(text);
  }

  /**
   * `DEBUG666` writes `debugRequest` and nothing else, and that is the fix.
   *
   * F14 wrote an entitlement bit *and* the request, which made two copies of one fact — and
   * the × writes only the request, so closing the panel left the bit saying "unlocked" and
   * the code's next press read as "off". One store, four writers (the ×, Escape, the pause
   * button and this), exactly as P1 built it for B1.
   *
   * Toggled against the **visible** state rather than against a flag of its own: if the
   * overlay is up the code takes it down, and if it is not the code puts it up. `'onPause'`
   * because this is where it was typed and the tuning sliders need a cursor — which is what
   * that member of the tri-state means.
   */
  private applySurfaceCheat(): void {
    const wasVisible = this.isDebugOverlayVisible();
    this.debugRequest = wasVisible ? 'none' : 'onPause';
    this.setCodeResult(cheatOutcomeText(wasVisible ? CheatOutcome.Revoked : CheatOutcome.Granted));
  }

  /**
   * A grant against this client's own save, which is the one store it is the authority for.
   *
   * *What* everything means is `grantEverything`, in `shared/meta/Unlocks.ts` beside the
   * gates it defeats — this handler's business is that the grant goes through `Profile`,
   * the same writers progression itself uses, so the unlock state, the editor's chips and
   * the loadout sanitiser see the result as earned rather than as a second rule about
   * what is available. The list lived here once, and shipped twice missing a category.
   *
   * The per-weapon counters are deliberately left alone. Kills and headshots are what the
   * camo *challenges* read, and inventing them would pay out the account's XP awards for
   * work nobody did — the finish is the reward asked for, not the career that earned it.
   */
  private applyUnlockCheat(): void {
    grantEverything(this.deps.profile);
    this.setCodeResult(cheatOutcomeText(CheatOutcome.UnlockApplied));
    this.deps.screens.loadoutEditor.repaint();
    // The level is on the header's card, and this is the one grant that moves it while the
    // player is looking at that header.
    this.deps.screens.menus.refreshCard();
  }

  /** Everything with a simulation bit or a payment behind it: the server's, or this process's. */
  private requestSimulationCheat(entry: CheatCode): void {
    const client = this.deps.world()?.net?.client;
    if (client !== undefined) {
      // Held so the reply can be captioned. The server answers with an outcome rather than a
      // label, deliberately — a label on the wire would be the server deciding how a client
      // words its own HUD — and this is the only thing that knows which code produced it.
      this.pendingInstant = entry.effect.kind === 'instant' ? entry : null;
      client.sendCheat(entry.code);
      // No optimism, and no "asking..." either: the reply is one frame away at any playable
      // ping, and a line that had to be corrected would be worse than a line that waits.
      return;
    }

    const match = this.deps.world()?.match;
    if (match === undefined) {
      /**
       * Typed on the main menu, where there is no match to apply it to (the human,
       * 2026-09-24).
       *
       * Two things had to be true and only one of them was. Nothing *is* granted here —
       * this returns before every writer, so a god mode typed at the menu was never going
       * to follow anybody into a match — but the answer went to the pause screen's caption
       * line, which is not the screen the player is looking at, so the field simply ate the
       * code and said nothing. Both screens now, and `RefusedNoSeat`'s wording says which
       * screen the code belongs on rather than merely that this is not it.
       */
      this.setCodeResult(cheatOutcomeText(CheatOutcome.RefusedNoSeat));
      return;
    }
    if (entry.effect.kind === 'instant') {
      // The same door the server uses, and the reason it is a door at all: P4's balance is
      // credited from the score rather than read out of it, so unearned kills buy streaks
      // without ever appearing in the match results.
      match.streaks.creditKills(match.localId, entry.effect.kills);
      this.raiseInstantCheat(entry);
      this.setCodeResult(cheatOutcomeText(CheatOutcome.InstantApplied));
      return;
    }
    if (entry.effect.kind !== 'toggle') return;
    const after = toggleCheat(this.offlineCheats, entry.effect.bits);
    this.offlineCheats = after;
    const granted = (after & entry.effect.bits) !== 0;
    this.setCodeResult(cheatOutcomeText(granted ? CheatOutcome.Granted : CheatOutcome.Revoked));
  }

  /**
   * Start announcing an instant cheat (F14's fix).
   *
   * One writer of both fields, and it is idempotent in the way that matters: typing the code
   * again while the caption is up restarts the four seconds rather than stacking anything.
   */
  private raiseInstantCheat(entry: CheatCode): void {
    this.instantCheatLabelText = instantCheatLabel(entry);
    this.instantCheatUntilMs = nowMs() + CHEAT_NOTICE_SECONDS * 1000;
  }

  /**
   * The caption, or `''` once the deadline has passed.
   *
   * Derived rather than cleared by a callback, so there is no expiry to get stuck: the answer is
   * right on the frame the deadline passes whether or not anything happened on it. That is the
   * same reasoning `update` gives about every other surface, applied to a value with
   * a clock in it.
   */
  private get instantCheatCaption(): string {
    if (this.instantCheatLabelText === '') return '';
    return nowMs() < this.instantCheatUntilMs ? this.instantCheatLabelText : '';
  }
  //#endregion
}
//#endregion
