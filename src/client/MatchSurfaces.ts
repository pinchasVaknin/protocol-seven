/**
 * Everything the HUD is told, once a frame.
 *
 * ## Why it is its own object
 *
 * `ClientMatch` is the composition root of a match, and the per-frame pass that decides what
 * the player is *shown* had grown into the largest decision in the programme: a banner at a
 * cognitive complexity of 62, a minimap at 42, and a dismantle prompt at 23, all reading a
 * dozen systems that the root happens to hold. None of it simulates anything. It is a pure
 * read of the match into four preallocated records — the ammo and health block, the streak
 * strip, the objective banner and the minimap — and that is one job, so it is one object.
 *
 * ## The mode registry (§4.4)
 *
 * Four `instanceof` checks on concrete mode classes lived in three of those methods, plus one
 * more in the helper that decided what the minimap draws at all. They were really choosing a
 * **presenter**: Search & Destroy gets a bomb timer and an alive count, Domination gets flags,
 * and the other four get nothing. `PRESENTERS` says that once, keyed by `GameModeId` and
 * `satisfies Record<…>` so a seventh mode does not compile until somebody decides what it
 * shows. Each entry casts the mode to its own class on one line, because a table keyed by id
 * cannot narrow a type — the honest cost of this shape rather than something hidden by it.
 *
 * The table is consulted **once per frame**, not per entity per tick, which is what makes it
 * allowed under R7 at all.
 *
 * ## What it never does
 *
 * It writes nothing the simulation reads, allocates nothing per frame beyond the one reach
 * closure the dismantle test already built, and holds no state: every answer is recomputed
 * from the systems that own it, so there is nothing here that can get stuck.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { BotTeam } from '../shared/core/Vocabulary';
import { inputLabel } from '../shared/core/Keybinds';
import type { Keybinds } from '../shared/core/Keybinds';
import { EquipmentSystem } from '../shared/equipment/EquipmentSystem';
import { Domination } from '../shared/modes/Domination';
import type { GameMode, GameModeId } from '../shared/modes/GameMode';
import { SearchAndDestroy } from '../shared/modes/SearchAndDestroy';
import { sentryInDismantleReach } from '../shared/streaks/SentryGun';
import { streakDef, type StreakConfig } from '../shared/streaks/StreakDefs';
import type { ObjectiveKind } from '../shared/world/maps/types';
import { NO_SUPPLY_POINT } from '../shared/world/SupplySystem';
import type { StreakHudState } from './ui/HudStreaks';
import type { Minimap } from './ui/Minimap';
import type { Match } from './ClientMatch';
import { NO_SENTRY_IN_REACH, type MatchStreakLedger } from './MatchStreakLedger';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * What one mode shows on the banner and on the minimap, and what it puts there at all.
 *
 * `objectiveKinds` is empty for a mode with none, which also switches the minimap's objective
 * layer off entirely — a Domination flag on a Team Deathmatch minimap is noise, and an S&D
 * bomb site on a Domination one is worse than noise because it looks like something you can
 * capture.
 */
interface ModePresenter {
  readonly objectiveKinds: readonly ObjectiveKind[];
  /** The headline, the timer and the ring. Called every frame, into an already-cleared record. */
  readonly banner: (self: MatchSurfaces, mode: GameMode, hud: StreakHudState) => void;
  /** The objective layer's per-zone state. Called every frame, after the contacts. */
  readonly minimap: (self: MatchSurfaces, mode: GameMode, map: Minimap) => void;
}

export interface MatchSurfacesDeps {
  /** The match these surfaces describe. Read only, and only through its public surface. */
  readonly match: Match;
  readonly ledger: MatchStreakLedger;
  /** The live binding table, so a prompt names the key the player will actually press. */
  readonly keybinds: Keybinds;
  /** Already resolved against the default, because the reach test is asked every frame. */
  readonly streakConfig: StreakConfig;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * A mode with nothing of its own to say: Team Deathmatch, Free-for-All, Kill Confirmed and the
 * range.
 *
 * A constant above the class rather than a helper below it, because `PRESENTERS` is a static
 * field and its initialiser runs when the class is *defined* — a `const` further down the file
 * is still in its temporal dead zone at that moment (C21 found this the hard way).
 */
const NO_MODE_PRESENTATION: ModePresenter = {
  objectiveKinds: [],
  banner: (): void => undefined,
  minimap: (): void => undefined,
};
//#endregion

// ==================================== CLASS MatchSurfaces ===================================== \\
//#region Class MatchSurfaces
export class MatchSurfaces {
  // ========================================== STATIC ========================================== \\
  //#region Static
  /**
   * Which presenter each mode gets. Exhaustive by construction.
   *
   * Inside the class body because the entries reach the instance's own private fills — a table
   * at module scope could not, and making those fills public to feed it would be the tail
   * wagging the dog (R2).
   */
  private static readonly PRESENTERS = {
    TDM: NO_MODE_PRESENTATION,
    FFA: NO_MODE_PRESENTATION,
    KC: NO_MODE_PRESENTATION,
    RANGE: NO_MODE_PRESENTATION,
    DOM: {
      objectiveKinds: ['flag'],
      banner: (self: MatchSurfaces, mode: GameMode, hud: StreakHudState): void =>
        self.fillFlagBanner(mode as Domination, hud),
      minimap: (self: MatchSurfaces, mode: GameMode, map: Minimap): void =>
        self.fillFlagStates(mode as Domination, map),
    },
    SND: {
      objectiveKinds: ['bombsite'],
      banner: (self: MatchSurfaces, mode: GameMode, hud: StreakHudState): void =>
        self.fillBombBanner(mode as SearchAndDestroy, hud),
      minimap: (): void => undefined,
    },
  } satisfies Record<GameModeId, ModePresenter>;

  /**
   * Which objective kinds the minimap should draw for this mode (M7).
   *
   * Static because `ClientMatch` asks it once, in its constructor, before any instance of this
   * class could usefully exist.
   */
  static objectiveKindsFor(mode: GameMode): readonly ObjectiveKind[] {
    return MatchSurfaces.PRESENTERS[mode.id].objectiveKinds;
  }
  //#endregion

  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly match: Match;
  private readonly ledger: MatchStreakLedger;
  private readonly keybinds: Keybinds;
  private readonly streakConfig: StreakConfig;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: MatchSurfacesDeps) {
    this.match = deps.match;
    this.ledger = deps.ledger;
    this.keybinds = deps.keybinds;
    this.streakConfig = deps.streakConfig;
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /**
   * The M5 half of the HUD state: which weapons are in hand, what equipment is left, the
   * scope, and the cook timer. Read straight off the systems that own them.
   */
  fillTacticalState(): void {
    const tac = this.match.ui.state.tactical;
    const inventory = this.match.weapons.inventory;
    const def = inventory.active.definition;
    const otherIndex = inventory.activeSlotIndex === 0 ? 1 : 0;

    tac.weaponName = def.name;
    tac.slotIndex = inventory.activeSlotIndex;
    tac.otherName = inventory.at(otherIndex)?.definition.name ?? '';

    const inv = this.match.equipment.inventory;
    tac.lethalId = inv.lethal;
    tac.lethalCount = inv.lethalCount;
    tac.tacticalId = inv.tactical;
    tac.tacticalCount = inv.tacticalCount;

    const thrower = this.match.equipment.thrower;
    tac.cookRemaining = thrower.remainingFuse(inv);
    tac.cookTotal = EquipmentSystem.slotDef(inv, thrower.slot).fuseSeconds;

    tac.hasScope = def.scope !== undefined;
    tac.scopeFraction = tac.hasScope ? this.match.visual.adsFraction : 0;
    tac.breath = this.match.weapons.scope.breath;
    tac.breathHeld = this.match.weapons.scope.holding;

    tac.fieldUpgradeName = this.match.meta.fieldUpgrade.name;
    tac.fieldUpgradeCharge = this.match.meta.fieldUpgrade.charge;
  }

  /**
   * The streak strip and the objective banner (M7).
   *
   * Everything here is read straight off the ledger and the mode. The requirement shown is
   * already Hardline-discounted, so the HUD never learns that a perk exists.
   */
  fillStreakHud(): void {
    const hud = this.match.ui.streakState;
    for (let i = 0; i < hud.slots.length; i++) {
      const slot = hud.slots[i];
      if (slot === undefined) continue;
      const id = this.ledger.streakSlots[i] ?? null;
      slot.name = id === null ? '' : streakDef(id).name;
      // Four states, and the fourth is now a duration rather than a flag (round 4, the pivot).
      // A slot dark because the player cannot afford it shows a price; a slot dark because the
      // key is locked out shows how much of the wait is left, as a fill. The key does nothing in
      // both, and the strip has to say which.
      slot.price = id === null ? 0 : this.ledger.streakPrice(id);
      slot.lockoutSeconds = id === null ? 0 : this.ledger.streakLockout(id);
      slot.ready = id !== null && this.ledger.canAffordStreak(id);
    }
    // The **balance**, and the server's when there is one: it is the number a purchase is
    // charged against, and two opinions about it is two opinions about whether a key works.
    hud.balance = this.ledger.streakBalance();
    const next = this.ledger.nextStreak();
    hud.nextName = next?.def.name ?? '';
    hud.nextPrice = next?.price ?? 0;

    this.fillObjectiveBanner(hud);
    this.fillFreeForAllBanner();
  }

  /**
   * Push UAV contacts, the sweep bearing, the scramble flag and flag ownership at the minimap.
   *
   * Written into preallocated records rather than rebuilt, so a UAV costs no allocation per
   * frame — the minimap sizes both arrays at construction for exactly this.
   */
  fillMinimapStreaks(): void {
    const map = this.match.ui.hud.minimap;
    // Whose UAV this is, and whose minimap is being scrambled, is "which side am I on".
    const friendly = this.match.localTeam;
    for (const slot of map.contacts) slot.active = false;
    map.contactFadeSeconds = this.match.streaks.contactFadeSeconds;

    // The two sources are **not** merged, deliberately. The server's list is already this seat's
    // whole truth, and the local one is a fixed ring with holes in it: two different iterations
    // that only look alike, which R4.3 sends to two named methods rather than to one helper.
    if (this.match.isNetworked) this.fillServerIntel(map);
    else this.fillLocalIntel(map, friendly);

    MatchSurfaces.PRESENTERS[this.match.mode.id].minimap(this, this.match.mode, map);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * The bomb timer, the plant/defuse ring and the capture prompt.
   *
   * Only one thing is ever shown, and the order is by urgency: a ticking bomb outranks an
   * interaction, which outranks standing on a flag. A banner that tried to show all three
   * would show none of them.
   */
  private fillObjectiveBanner(hud: StreakHudState): void {
    hud.showAlive = false;
    hud.objectiveLabel = '';
    hud.objectiveSeconds = -1;
    hud.interactFraction = -1;
    hud.interactLabel = '';
    hud.urgent = false;

    MatchSurfaces.PRESENTERS[this.match.mode.id].banner(this, this.match.mode, hud);
    this.fillDismantleBanner(hud);
    this.fillSupplyBanner(hud);
  }

  /** Search & Destroy: who is left, what the bomb is doing, and what this player may do to it. */
  private fillBombBanner(mode: SearchAndDestroy, hud: StreakHudState): void {
    // Alive counts, top of screen, every round (M7 playtest). Counted here rather than by
    // the mode, and against the side the server actually assigned rather than the constant.
    const friendly = this.match.localTeam;
    hud.aliveFriendly = this.match.countAlive(friendly);
    hud.aliveEnemy = this.match.countAlive(friendly === 'A' ? 'B' : 'A');
    hud.showAlive = true;

    if (mode.bomb === 'PLANTED') {
      hud.objectiveLabel = `BOMB · SITE ${mode.plantedSite?.label ?? ''}`;
      hud.objectiveSeconds = mode.bombSecondsLeft;
      hud.urgent = true;
    }

    if (this.showOwnInteraction(mode, hud)) return;
    if (this.showOtherInteraction(mode, hud)) return;
    // A planted bomb is answered here and nowhere below: the carry branch is about a bomb that
    // is still in somebody's hands.
    if (mode.bomb === 'PLANTED') {
      this.offerDefuse(mode, hud);
      return;
    }
    if (mode.bomb !== 'CARRIED') return;
    this.showBombCarry(mode, hud);
  }

  /** The ring while this player is the one planting or defusing. True when it took the slot. */
  private showOwnInteraction(mode: SearchAndDestroy, hud: StreakHudState): boolean {
    if (mode.interactEntity !== this.match.localId || mode.interactFraction <= 0) return false;
    hud.interactFraction = mode.interactFraction;
    hud.interactLabel = mode.bomb === 'PLANTED' ? 'DEFUSING' : 'PLANTING';
    if (hud.objectiveLabel.length === 0) hud.objectiveLabel = 'OBJECTIVE';
    return true;
  }

  /**
   * Somebody else already has it (post-M8 playtest).
   *
   * Telling a second defender to "hold T to defuse" while a team-mate is three seconds into
   * the defuse is telling them to do something the mode will refuse — `beginInteract` ignores a
   * newcomer while a live actor owns the interaction. The prompt is replaced by what is
   * actually happening, which is the thing worth knowing: somebody is on it, so go and cover
   * them.
   */
  private showOtherInteraction(mode: SearchAndDestroy, hud: StreakHudState): boolean {
    const busyWith = mode.interactingEntity;
    if (busyWith < 0 || busyWith === this.match.localId) return false;
    hud.interactFraction = mode.interactFraction;
    hud.interactLabel = mode.interactIsDefusing ? 'TEAMMATE DEFUSING' : 'PLANT IN PROGRESS';
    if (hud.objectiveLabel.length === 0) hud.objectiveLabel = 'OBJECTIVE';
    return true;
  }

  /** The defuse key, to a defender standing on the site the bomb is on. */
  private offerDefuse(mode: SearchAndDestroy, hud: StreakHudState): void {
    const me = this.match.playerCombatant;
    if (me.team !== mode.defenders) return;
    const site = mode.plantedSite;
    if (site === null || !site.contains(me)) return;
    hud.interactFraction = 0;
    hud.interactLabel = `HOLD ${this.useKeyLabel()} TO DEFUSE`;
  }

  /** What an attacker is told about a bomb nobody has planted yet. */
  private showBombCarry(mode: SearchAndDestroy, hud: StreakHudState): void {
    const me = this.match.playerCombatant;
    if (me.team !== mode.attackers) return;
    if (!mode.isCarrier(this.match.localId)) {
      this.showBombRecovery(mode, hud);
      return;
    }
    const site = mode.siteContaining(me);
    hud.objectiveLabel = site === null ? 'CARRYING THE BOMB' : `SITE ${site.label}`;
    if (site !== null) {
      hud.interactFraction = 0;
      hud.interactLabel = `HOLD ${this.useKeyLabel()} TO PLANT`;
    }
  }

  /** Where the bomb is, to an attacker who is not carrying it. */
  private showBombRecovery(mode: SearchAndDestroy, hud: StreakHudState): void {
    if (mode.carrierId >= 0) {
      hud.objectiveLabel = 'BOMB CARRIER OUT';
      return;
    }
    // Tell them where the bomb is, because without it the round cannot be won.
    hud.objectiveLabel = 'RECOVER THE BOMB';
    // Standing on it: the pick-up is a key press now, so it needs a prompt like any other
    // interaction. Without one, "auto-pickup is off" reads as "the bomb is broken".
    if (!mode.tryPickupPrompt(this.match.playerCombatant)) return;
    hud.interactFraction = 0;
    hud.interactLabel = `HOLD ${this.useKeyLabel()} TO TAKE THE BOMB`;
  }

  /** Domination: the flag under the player's feet, and what is happening to it. */
  private fillFlagBanner(mode: Domination, hud: StreakHudState): void {
    const me = this.match.playerCombatant;
    for (const zone of mode.zones) {
      if (!zone.contains(me)) continue;
      hud.objectiveLabel = `FLAG ${zone.label}`;
      hud.interactFraction = zone.progress;
      hud.interactLabel = zone.contested
        ? 'CONTESTED'
        : zone.owner === this.match.localTeam
          ? 'HELD'
          : 'CAPTURING';
      return;
    }
  }

  /**
   * The prompt at the player's own sentry (2026-09-28): stand at it, face it, hold the use key.
   *
   * Between the mode and the crate in urgency: an objective is the match, and a turret the
   * player chose to go and stand at is a decision they are in the middle of, which a crate
   * beside it is not. The reach test is `sentryInDismantleReach` — the function
   * `SentryGun.stepDismantle` decides with — so the key is never offered where the simulation
   * would refuse it. The ring is the simulation's own progress; see the ledger for which
   * simulation that is.
   */
  private fillDismantleBanner(hud: StreakHudState): void {
    if (hud.interactLabel.length > 0 || this.match.isPlayerDead) return;
    const sim = this.match.playerSim;
    const cfg = this.streakConfig;
    const reach = (x: number, y: number, z: number): boolean =>
      sentryInDismantleReach(x, y, z, sim.x, sim.y, sim.z, sim.yaw, cfg);

    const progress = this.ledger.ownSentryDismantleFraction(reach);
    if (progress === NO_SENTRY_IN_REACH) return;

    if (hud.objectiveLabel.length === 0) hud.objectiveLabel = 'YOUR SENTRY';
    hud.interactFraction = progress;
    hud.interactLabel = progress > 0 ? 'DISMANTLING' : `HOLD ${this.useKeyLabel()} TO DISMANTLE`;
  }

  /**
   * The resupply prompt, which is every mode's and therefore nobody's mode's.
   *
   * Written after the mode and only into a slot the mode left empty. The order is the same
   * urgency rule the banner is built on: a bomb being planted, defused or counting down is the
   * most important thing on the screen, and a crate is the least — and on a map where a station
   * sits inside an objective the player is told about the objective.
   *
   * Three states rather than one, because the rule has to be teachable without a tutorial: near
   * it and standing, kneeling and taking, and kneeling with nothing left to take. There is no
   * key in any of them since 2026-09-28 — the crouch is the instruction. The ring is the held
   * weapon's reserve rather than progress toward the next beat, which would be a quarter-second
   * sawtooth; what the player watches climb is the ammunition counter.
   */
  private fillSupplyBanner(hud: StreakHudState): void {
    if (hud.interactLabel.length > 0) return;
    const state = this.match.supplyState;
    if (state.pointId === NO_SUPPLY_POINT) return;

    /**
     * The banner carries the ring, and `HudStreaks.updateBanner` draws neither without a label:
     * a ring with nothing above it is a progress bar for an unnamed thing, so the surface makes
     * the two one decision. Written only into an empty slot, so a bomb that is counting down
     * keeps the strip and this keeps the ring under it.
     */
    if (hud.objectiveLabel.length === 0) hud.objectiveLabel = 'RESUPPLY';

    if (state.needsCrouch) {
      hud.interactFraction = state.stock;
      hud.interactLabel = 'CROUCH TO RESUPPLY';
      return;
    }
    hud.interactFraction = state.stock;
    // Kneeling and not yet `working` is the one tick before the first beat is counted.
    hud.interactLabel = state.full ? 'RESUPPLIED' : 'RESUPPLYING';
  }

  /**
   * Free-for-All shows the leader and you, not team A and team B.
   *
   * Driven from `ScoreSystem.rows`, which is populated on a networked client the same way the
   * scoreboard is. Recomputed per frame rather than cached on a score event — it is a scan of
   * ten rows on a screen that is already walking them for the scoreboard.
   */
  private fillFreeForAllBanner(): void {
    const banner = this.match.ui.state.banner;
    banner.ffa = this.match.viewer.freeForAll;
    if (!banner.ffa) return;

    /**
     * **Kills, not points** (M11 Gate B playtest).
     *
     * This read `row.score`, and over the network that column is zero for everybody, for ever:
     * `MatchFlow`'s replicated branch records kills with **zero points** on purpose — what a
     * kill is worth is a mode decision and the mode is not running on a client. So the banner
     * showed `0` against a leader of `0` for the whole match, which is the reported "the kill
     * counter isn't working in FFA over the network".
     *
     * Kills are the right number anyway, and not merely the available one: `checkWinCondition`
     * decides Free-for-All on `row.kills` and the bar counts toward `scoreLimit`, which is a
     * kill count. Showing points beside a limit measured in kills was a bar that could not
     * reach its own end.
     */
    let leader: { name: string; score: number } | null = null;
    let self = 0;
    for (const row of this.match.score.rows) {
      if (row.entityId === this.match.localId) self = row.kills;
      if (leader === null || row.kills > leader.score) {
        leader = { name: row.displayName, score: row.kills };
      }
    }
    banner.leaderName = leader?.name ?? '';
    banner.leaderScore = leader?.score ?? 0;
    banner.selfScore = self;
  }

  /**
   * The server's intel, and only ever this team's (M11 Gate B, §8.22).
   *
   * The client is not filtering here — there is nothing to filter. `MatchInstance` sends each
   * seat only the contacts its own team's UAV recorded, and a Ghost player was never recorded
   * in the first place. What arrives is already the whole truth this player is entitled to,
   * which is the point: a client that received both teams' contacts and chose to draw one would
   * be one edited line away from a wallhack.
   */
  private fillServerIntel(map: Minimap): void {
    map.sweepAngle = this.ledger.replicatedSweepAngle;
    map.scrambled = this.ledger.replicatedScrambled;
    let n = 0;
    for (const contact of this.ledger.replicatedContacts) {
      if (n >= map.contacts.length) break;
      const slot = map.contacts[n];
      if (slot === undefined) continue;
      slot.x = contact.x;
      slot.z = contact.z;
      slot.age = contact.ageCs / 100;
      slot.active = true;
      n++;
    }
  }

  /** This client's own UAV offline: a fixed ring with holes in it, so the inactive are skipped. */
  private fillLocalIntel(map: Minimap, friendly: BotTeam): void {
    const uav = this.match.streaks.uavFor(friendly);
    map.sweepAngle = uav === null ? null : uav.sweepAngle;
    map.scrambled = this.match.streaks.minimapScrambledFor(friendly);
    if (uav === null) return;
    let i = 0;
    for (const contact of uav.contacts) {
      if (!contact.active || i >= map.contacts.length) continue;
      const slot = map.contacts[i];
      if (slot === undefined) continue;
      slot.x = contact.x;
      slot.z = contact.z;
      slot.age = contact.age;
      slot.active = true;
      i++;
    }
  }

  /** Domination's flags, coloured by what they are **to this viewer** rather than absolutely. */
  private fillFlagStates(mode: Domination, map: Minimap): void {
    const states = map.objectiveStates;
    if (states.length !== mode.zones.length) {
      states.length = 0;
      for (const zone of mode.zones) {
        states.push({ id: zone.id, owner: 'NONE', progress: 0, contested: false });
      }
    }
    for (let i = 0; i < mode.zones.length; i++) {
      const zone = mode.zones[i];
      const state = states[i];
      if (zone === undefined || state === undefined) continue;
      // The constant is team A, so a networked player the server put on team B had every flag
      // on their minimap coloured backwards: their own held zones read as enemy and the
      // enemy's as theirs.
      const friendly = this.match.localTeam;
      state.owner = zone.owner === 'NONE' ? 'NONE' : zone.owner === friendly ? 'FRIENDLY' : 'ENEMY';
      state.progress = zone.progress;
      state.contested = zone.contested;
    }
  }

  /**
   * What the Use key is actually bound to, for the objective prompts (post-M8).
   *
   * The prompts used to read "HOLD P", hard-coded, which was wrong the moment M8 shipped
   * rebinding and wrong again when the default moved to T. Asked of the live binding table
   * so the HUD says the key the player will actually press, whatever they set it to.
   */
  private useKeyLabel(): string {
    const bound = this.keybinds.inputsFor('use')[0];
    return bound === undefined ? 'USE' : inputLabel(bound).toUpperCase();
  }
  //#endregion
}
//#endregion
