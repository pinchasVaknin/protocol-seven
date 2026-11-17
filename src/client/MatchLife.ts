/**
 * The local player's life: the death, the wait, whose eyes they borrow, and the class waiting
 * for their next body.
 *
 * ## Why it is its own object
 *
 * "Am I alive" was answered by seven fields of the composition root and written by five
 * different paths — a local death, a replicated one, a respawn, a round reset and a deferred
 * class change — and M10 is the milestone where that stopped being one question. The server
 * owns whether this player is alive and where they come back; the client owns the countdown on
 * the screen, the panel that explains the death, and the camera that has to go somewhere in
 * the meantime. Those two halves meet in exactly one place, and this is it.
 *
 * ## The one rule everything here follows
 *
 * **A life begins at a spawn serial, not at an alive bit.** A Search & Destroy survivor's next
 * round is a new life the server spawns without ever having killed them, and so is a class
 * change cashed during the pre-match freeze: in both the server picks a spawn point, refills
 * its own copy of the hand and bumps the serial, while the alive bit never moves. Everything
 * per-life hangs off `beginLife`, and `beginLife` hangs off the serial.
 *
 * ## What is deliberately asked rather than latched
 *
 * Who this player is watching is recomputed every frame rather than latched on death: a target
 * can die, disconnect or be replaced by a bot at any moment, and a latch would have to be
 * invalidated correctly on all three. The death report is the opposite — latched on the kill
 * and cleared on the next life — because it describes a moment that has passed.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { RESPAWN_SECONDS } from '../shared/ai/BotDirector';
import type { BotTeam } from '../shared/ai/Combatant';
import { makeSpawnChoice, type SpawnChoice } from '../shared/ai/SpawnSelector';
import type { HitZone } from '../shared/combat/HitboxRig';
import { EV, type GameBus } from '../shared/core/Events';
import { DT } from '../shared/core/Loop';
import { EquipmentSystem } from '../shared/equipment/EquipmentSystem';
import type { ResolvedLoadout } from '../shared/meta/Loadouts';
import {
  NO_SPECTATOR_TARGET,
  nextSpectatorTarget,
  pickSpectatorTarget,
  type SpectatorCandidate,
} from '../shared/modes/SpectatorTarget';
import type { MovementConfig } from '../shared/player/MovementConfig';
import type { PlayerController } from '../shared/player/PlayerController';
import { eyeHeightFor } from '../shared/player/Stance';
import { anyWeaponDef } from '../shared/weapons/AnyWeapon';
import type { CameraRig } from './engine/CameraRig';
import type { ProceduralAudio } from './engine/ProceduralAudio';
import type { Input } from './input/Input';
import type { RenderableActor } from '../shared/ai/BotVisualState';
import { WAKE_WAIT_MS } from './net/WakeWait';
import type { DeathReport } from './ui/Hud';
import type { BodyPose } from './MatchFeedback';
import type { MatchArsenal } from './MatchArsenal';
import type { MatchStreakLedger } from './MatchStreakLedger';
import type { Match, SpectatorView } from './ClientMatch';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface MatchLifeDeps {
  /** The match this life is being lived in. Read at tick and frame time, never at construction. */
  readonly match: Match;
  /** A new life puts the right weapon back in the hands; that is this collaborator's. */
  readonly arsenal: MatchArsenal;
  /**
   * A class change rewrites the three streak keys, and the ledger is where they live.
   *
   * A supplier rather than the object, because this collaborator is constructed where the death
   * subscription used to be registered — which is *before* the streak system the ledger wraps.
   * Nothing here asks for it until a class is swapped, which is long after both exist.
   */
  readonly ledger: () => MatchStreakLedger;
  readonly bus: GameBus;
  readonly player: PlayerController;
  readonly input: Input;
  readonly audio: ProceduralAudio;
  readonly cameraRig: CameraRig;
  readonly movementConfig: MovementConfig;
  /** Whether this mode puts everybody back at a round boundary. Search & Destroy, in practice. */
  readonly usesRoundReset: boolean;
  /** The remote bodies, over the network only. Absent in single-player, which has a roster. */
  readonly actors: (() => Iterable<RenderableActor>) | undefined;
  /** Where a body is, whichever kind of match this is. Answers with a shared scratch. */
  readonly bodyAt: (entityId: number) => Readonly<BodyPose> | null;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Seconds the player spends dead.
 *
 * **The server's number, not a copy of it** (playtest round 4). It was a local `4.5` beside
 * `BotDirector.RESPAWN_SECONDS`'s `4.5` — the same fact written twice, and the death screen's
 * countdown is what the quick class selector's window is derived from, so the day the two
 * drifted the panel would have closed early or late with nothing to point at. Reading the one
 * the server actually respawns on is also what lets `HeadlessClient` step the same display
 * timer and measure the same window.
 */
const PLAYER_RESPAWN_SECONDS = RESPAWN_SECONDS;

/** Heartbeat rate at the low-health threshold and at zero, beats per minute (S6.4). */
const HEARTBEAT_BPM_CALM = 74;
const HEARTBEAT_BPM_PANIC = 152;
//#endregion

// ====================================== CLASS MatchLife ======================================= \\
//#region Class MatchLife
export class MatchLife {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly spawnChoice: SpawnChoice = makeSpawnChoice();
  private deathSubscription: (() => void) | null = null;
  /** F9's panel content, latched on the local player's death and cleared on their next spawn. */
  private deathReport: DeathReport | null = null;
  /** Who killed the local player, and when — for a distance the kill's own frame could not measure. */
  private deathKillerId = -1;
  private deathAtMs = 0;
  private roundResetSubscription: (() => void) | null = null;

  private playerDead = false;
  /**
   * The last replicated spawn serial this client acted on. `-1` before the first snapshot.
   *
   * The networked half of "a new life started" (playtest round 4, B3). See
   * `applyReplicatedSelf`.
   */
  private lastSpawnSerial = -1;

  /**
   * Who this player is watching while dead (§6.8).
   *
   * Cleared on every round start — the §4.18 discard rule applied to a round boundary. Without
   * it a spectator returns from the round they died in still pointed at a body that has since
   * respawned somewhere else, which reads as the camera being stuck.
   */
  private spectatorTarget = NO_SPECTATOR_TARGET;

  private playerRespawnTimer = 0;
  private heartbeatTimer = 0;

  /** A class change waiting for this player's next body. See `applyLoadout`. */
  private pendingLoadout: ResolvedLoadout | null = null;

  private readonly deps: MatchLifeDeps;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: MatchLifeDeps) {
    this.deps = deps;

    /**
     * The death report (playtest round 5, F9).
     *
     * Built here rather than in the HUD because this is the only object that holds all four
     * facts at once: the killfeed's directory for the name, `bodyAt` for the killer's position,
     * the weapon table for the label, and the event itself for the health the server stamped.
     * Latched on the kill and cleared on the next spawn — the same lifetime as being dead, which
     * is exactly how long the panel is up.
     *
     * `EV.EntityKilled` and not `EV.KillfeedEntry`: the feed line is written for a different
     * purpose and carries no health, and correlating two events that happen to arrive on one
     * tick is the kind of coupling that survives until the day something reorders them.
     */
    this.deathSubscription = deps.bus.on(EV.EntityKilled, (p) => {
      if (p.targetId !== this.localId) return;
      this.deathReport = this.buildDeathReport(p.sourceId, p.weaponId, p.zone, p.killerHealth);
      this.deathKillerId = p.sourceId;
      this.deathAtMs = performance.now();
    });

    /**
     * A new round puts everybody back where they started (post-M8 playtest).
     *
     * Only for modes that actually have rounds, which in practice is Search & Destroy: a
     * single-round mode fires this once, at the start, where it is a no-op against a world
     * that has just spawned everyone anyway.
     *
     * Subscribed rather than called from `MatchFlow`, because respawning is not the flow's
     * job — it owns *whether* somebody may come back and this owns *putting them there*, and
     * merging the two would put the roster and the spawn selector inside the round machine.
     */
    this.roundResetSubscription = deps.bus.on(EV.RoundStarted, () => {
      if (!this.deps.usesRoundReset) return;
      // No state leaks across a round boundary, the camera's included. True in both runtimes:
      // where the player is put is the server's business, where the camera looks is not.
      this.spectatorTarget = NO_SPECTATOR_TARGET;
      /**
       * The **server** puts everybody back in a networked match (playtest round 4, B3).
       *
       * This ran in both runtimes, and over the network it was a second writer against the one
       * fact a client may not decide: `hardResetRound` calls `respawnPlayer`, which runs
       * `selectSpawn` and teleports the local controller to a point the client chose while the
       * server was putting the body somewhere else — a guaranteed misprediction of up to the
       * width of the map, every round, corrected a snapshot later by a camera lurch.
       *
       * It also concealed B3 by accident: the local `player.spawn` emits `player.spawned`, so
       * the grenades did come back, as a side effect of the teleport rather than because
       * anything had decided a life had started. Removing the teleport without the serial above
       * would have turned an intermittent bug into a certain one.
       */
      if (this.deps.match.isNetworked) return;
      this.hardResetRound();
    });
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get isDead(): boolean {
    return this.playerDead;
  }

  get respawnSeconds(): number {
    return this.playerRespawnTimer;
  }

  /**
   * The local player died. Owned here rather than in `MatchFeedback` because what follows is
   * gameplay: the respawn timer, and the respawn gate the mode controls.
   */
  onPlayerKilled(): void {
    if (this.playerDead) return;
    this.playerDead = true;
    this.playerRespawnTimer = PLAYER_RESPAWN_SECONDS;
    /**
     * Out of the sights, on the tick of death (post-M8 playtest).
     *
     * A dead player's weapon is not stepped — `simulate` skips it — so `adsFraction` freezes
     * at whatever it held when the round landed, and `Game` keeps feeding that to the camera
     * as an FOV scale. With a sniper that is a scoped picture the player is stuck inside for
     * the whole death screen. Forcing it down here is the only place that works, because
     * every other candidate is code that has just stopped running.
     */
    this.deps.match.weapons.clearAim();
    this.deps.match.melee.reset();
    const sim = this.deps.player.sim;
    this.deps.match.weaponAudio.playDeath(sim.x, sim.y + 0.4, sim.z);
    this.deps.cameraRig.shake.add(0.45);
    // Dying clears the low-health state: the muffle belongs to being nearly dead, not to being
    // dead, and holding it through a respawn is state leaking across a life.
    this.deps.audio.setMuffle(0);
  }

  /**
   * Adopt the local player's replicated health and liveness (M10 playtest fix).
   *
   * The server owns whether this player is alive; before this the client decided for itself
   * and got it wrong in the only way that matters. `onPlayerKilled` keys on
   * `PLAYER_ENTITY_ID`, which is entity **0** — the server's empty spectator seat — while a
   * connected human is entity 1 or above. So the death path never fired, the death screen
   * never appeared, and `stepPlayerRespawn` (the only thing that clears `playerDead`) is
   * skipped in networked matches anyway. Three separate notions of "am I dead", one of them
   * authoritative and none of them talking to each other.
   *
   * Now there is one: this. Called on every change to the replicated health or alive bit.
   */
  applyReplicatedSelf(health: number, alive: boolean, spawnSerial: number): void {
    /**
     * The life boundary is the **spawn serial**, and it is not the alive bit (round 4, B3).
     *
     * This used to read `alive && this.playerDead` — a life starts when a dead player stops
     * being dead — and that is true of a respawn and of nothing else. A Search & Destroy
     * survivor's next round is a new life the server spawns without ever having killed them,
     * and so is a class change cashed during the pre-match freeze (`applyPendingLoadoutNow`):
     * in both the server picks a spawn point, refills its own copy of the hand and bumps the
     * serial, while the client's alive bit never moves and its own per-life reset never runs.
     * The report's *"in certain modes"* is exactly that set — the modes where a life can begin
     * without a death.
     *
     * The serial covers both, because it is what `PlayerController.spawn` moves and every new
     * life on the server goes through that one door. It is also strictly stronger than what it
     * replaces: a respawn bumps it too, so the ordinary case is the same event seen through a
     * signal that does not have a hole in it.
     *
     * Derived by comparison rather than by a flag on the wire: the serial is state, it stays
     * true after the snapshot that carried it, and comparing it with the last one acted on
     * cannot miss an edge by arriving late.
     */
    if (spawnSerial !== this.lastSpawnSerial) {
      this.lastSpawnSerial = spawnSerial;
      this.beginLife();
    }

    // After the reset, deliberately: `beginLife` puts the local `Health` back to full, and the
    // server's answer has to be the last word on this even in the frame a life starts.
    this.deps.match.playerHealth.setReplicated(health, alive);

    if (!alive && !this.playerDead) this.onPlayerKilled();
  }

  /**
   * Swap the whole class over on a live match (M6).
   *
   * Called when the player edits their loadout from the pause screen, which is S6.3's
   * "reachable… between spawns". Both weapons are rebuilt (a class change is a different
   * silhouette as much as different numbers), the grenades are replaced and refilled, and
   * the perks are re-derived. Ammunition resets with the weapons, which is the honest
   * behaviour: you did not keep the magazine, you picked up a different gun.
   */
  applyLoadout(loadout: ResolvedLoadout): void {
    /**
     * **On the next spawn, unless there is not going to be one to wait for** (M11 Gate B).
     *
     * This used to apply unconditionally, which is Tier 1 #20 arriving from the client's side:
     * `meta.setLoadout` re-runs the perk hooks and one of them writes `PlayerController
     * .speedScale`, so a class swapped on a *standing* body changed how fast this client
     * predicted itself moving while the server — which defers to the next spawn by rule
     * (`ServerMatch.setPendingLoadout`) — kept simulating the old figure. A constant per-tick
     * disagreement about speed, which is what rubberbanding is.
     *
     * It mattered little when the editor was a screen you had to pause to reach. The quick
     * selector puts it one keypress away, so the two sides now follow the same rule: deferred
     * for a living player mid-match, immediate when the player is dead (their next spawn is the
     * one being waited for) or during the pre-match freeze (where the server applies it at once
     * too — see `ServerMatch.applyPendingLoadoutNow` — and nobody can move regardless).
     */
    if (this.canApplyLoadoutNow()) {
      this.pendingLoadout = null;
      this.applyLoadoutNow(loadout);
      return;
    }
    this.pendingLoadout = loadout;
  }

  /**
   * The player's side of S6.9. Same timer and the same spawn selector the bots use, and the
   * same respawn gate — so "nobody comes back once the match is over" is one rule with one
   * implementation rather than one for them and a different one for you.
   */
  stepPlayerRespawn(): void {
    if (!this.playerDead) return;
    this.playerRespawnTimer = Math.max(0, this.playerRespawnTimer - DT);
    if (this.playerRespawnTimer > 0) return;
    if (!this.deps.match.flow.respawnAllowed(this.localId)) return;
    this.respawnPlayer();
  }

  /**
   * Count the death-screen timer down, and **only** that.
   *
   * `stepPlayerRespawn` does two things — it decrements the timer *and* it brings the body back
   * — and over the network the second belongs to the server, so the whole method was skipped.
   * The timer was therefore set once by `onPlayerKilled` and never moved: the death screen
   * showed a frozen 4.5 for the entire wait and then the player simply reappeared. The wait was
   * always correct; the only thing broken was the number describing it.
   *
   * Purely presentational, and clamped at zero rather than allowed to run negative: the
   * authoritative "you are alive again" is the replicated `EFlag.Alive` arriving through
   * `applyReplicatedSelf`, and this must never be mistaken for a second opinion about it. If the
   * server is slower than the local estimate the display sits at zero and waits, which reads as
   * "any moment now" — the honest thing for a client that does not decide.
   */
  stepRespawnDisplay(): void {
    if (!this.playerDead || this.playerRespawnTimer <= 0) return;
    this.playerRespawnTimer = Math.max(0, this.playerRespawnTimer - DT);
  }

  /**
   * The audible half of the low-health state (brief S6.4).
   *
   * Driven from the same intensity the vignette uses, so what you see and what you hear
   * cannot disagree. The muffle is a state and is set every tick; the heartbeat is an event
   * and is scheduled on a tick timer that speeds up as health falls — 74 BPM at the
   * threshold, 152 at nothing left.
   */
  stepLowHealthAudio(): void {
    const intensity = this.playerDead ? 0 : this.deps.match.ui.lowHealthIntensity;
    this.deps.audio.setMuffle(intensity);

    if (intensity <= 0) {
      this.heartbeatTimer = 0;
      return;
    }
    const bpm = HEARTBEAT_BPM_CALM + (HEARTBEAT_BPM_PANIC - HEARTBEAT_BPM_CALM) * intensity;
    this.heartbeatTimer -= DT;
    if (this.heartbeatTimer > 0) return;
    this.heartbeatTimer = 60 / bpm;
    this.deps.audio.playHeartbeat(intensity);
  }

  /**
   * What the death screen should show, or null.
   *
   * The settle runs only while dead, for the same reason the panel is withheld when alive: a
   * report that outlived the body it describes would be a panel telling a living player how
   * they died a minute ago (round 5, F9).
   */
  reportForHud(): DeathReport | null {
    if (!this.playerDead) return null;
    this.settleDeathDistance();
    return this.deathReport;
  }

  /**
   * The body this dead player is watching, or null (M11 Gate B, §6.8).
   *
   * Only in a **one-life** mode, which is what makes this a spectator rather than a death cam:
   * in Team Deathmatch a corpse is looking at the floor for four seconds and then playing again,
   * and taking the camera somewhere else would be a worse experience than the wait. In Search &
   * Destroy the wait is the rest of the round.
   *
   * Recomputed every frame rather than latched on death. A target can die, disconnect or be
   * replaced by a bot at any moment, and a latch would have to be invalidated correctly on all
   * three — asked every frame, there is nothing to get stuck.
   */
  get spectatorTargetId(): number {
    if (!this.playerDead) return NO_SPECTATOR_TARGET;
    if (!this.deps.usesRoundReset) return NO_SPECTATOR_TARGET;
    const chosen = pickSpectatorTarget(
      this.localId,
      this.deps.match.localTeam,
      this.spectatorCandidates(),
      this.spectatorTarget,
    );
    this.spectatorTarget = chosen;
    return chosen;
  }

  /**
   * Where the spectator camera should sit, or null to leave it on the local body.
   *
   * The followed body's **feet**, its facing, and the eye height the stance it is drawn in
   * actually has. A first-person framing rather than a chase camera, deliberately: a
   * third-person spectator needs collision of its own, and one that clips through a wall while
   * the player is already waiting out a round is a worse answer than looking through a
   * teammate's eyes.
   *
   * Two things were wrong with the first version and both arrived as one report — *"the head of
   * the body you are watching cuts into the camera"*.
   *
   * **The roster it looked in.** `deps.actors` is the *networked* supplier and is undefined in
   * single-player, so every solo Search & Destroy death landed on `?? []` and returned null: the
   * camera stayed at the eye the dead player left behind, while `BotRenderer` — told through
   * `setEyesOf` that the camera was inside a teammate — dutifully hid that teammate. A frozen
   * view of the room you died in with one of your own side invisible in it, and every other body
   * in the match free to walk through the camera. `actorsForRender` is the supplier that answers
   * both kinds of match, and it is the one the renderer itself draws from, which is what makes
   * the body that is hidden and the body the camera is inside provably the same body.
   *
   * **The eye it used.** `PlayerSnapshot`'s own default is a standing 1.65 m and a spectated body
   * is not always standing: a teammate who crouches drops their eyes to 0.95 m and a sliding one
   * to 0.55 m, and the camera stayed a metre above their head with the body hidden under it.
   * `eyeHeightFor` is the rule the living player's own camera is composed with, applied here to
   * the stance the body is *drawn* in, so the spectator's eye is where that body's eyes are.
   */
  spectatorView(alpha: number): SpectatorView | null {
    const id = this.spectatorTargetId;
    if (id === NO_SPECTATOR_TARGET) return null;
    for (const actor of this.deps.match.actorsForRender()) {
      if (actor.entityId !== id) continue;
      return {
        x: actor.renderX(alpha),
        y: actor.renderY(alpha),
        z: actor.renderZ(alpha),
        yaw: actor.renderYaw(alpha),
        eyeHeight: eyeHeightFor(this.deps.movementConfig, actor.animation.stance),
      };
    }
    return null;
  }

  /** Cycle to the next living teammate. Bound to the fire key while dead (M7's verb). */
  cycleSpectatorTarget(): void {
    if (!this.playerDead) return;
    this.spectatorTarget = nextSpectatorTarget(
      this.localId,
      this.deps.match.localTeam,
      this.spectatorCandidates(),
      this.spectatorTarget,
    );
  }

  /** Both subscriptions dropped. Called from the match's own teardown, in its original order. */
  dispose(): void {
    this.deathSubscription?.();
    this.roundResetSubscription?.();
    this.roundResetSubscription = null;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** The entity id this client's own player occupies. Read at the point of use, never copied. */
  private get localId(): number {
    return this.deps.match.localId;
  }

  /**
   * Everything the death screen says, assembled at the moment of death (round 5, F9).
   *
   * Each field degrades on its own rather than the whole report being withheld: a killstreak has
   * a name and no health, a fall has neither, and a killer who has already been removed from the
   * roster has a health the server stamped and no body to measure to. `describeDeath` drops
   * whatever is missing, so a partial report is a shorter sentence rather than a wrong one.
   */
  private buildDeathReport(
    killerId: number,
    weaponId: string,
    zone: HitZone,
    killerHealth: number,
  ): DeathReport | null {
    if (killerId === this.localId) return null; // your own grenade needs no explaining
    const killerName = this.deps.match.flow.killfeed.nameOf(killerId);
    if (killerName === null) return null;

    /*
     * Distance between the two bodies, measured now.
     *
     * `bodyAt` returns a shared scratch, so the numbers are read out before anything else can
     * ask — which is the contract that comment states and the reason this does not hold the
     * pose. The player's own position comes off the sim rather than the same scratch for the
     * same reason.
     */
    const sim = this.deps.player.sim;
    const body = this.deps.bodyAt(killerId);
    const distanceM = body === null ? -1 : Math.hypot(body.x - sim.x, body.y - sim.y, body.z - sim.z);

    return {
      killerName,
      weaponName: anyWeaponDef(weaponId)?.name ?? '',
      distanceM,
      killerHealth,
      headshot: zone === 'head',
    };
  }

  /**
   * The killer's distance, once there is a body to measure to (anti-wallhack phase 2, part 1).
   *
   * A killer this client was not told about is dormant when the kill arrives, and wakes in the
   * next snapshot (R9) — so a report built on the kill's own frame said nothing about distance.
   * Measured again each frame for `WAKE_WAIT_MS`, then left as it is.
   */
  private settleDeathDistance(): void {
    const report = this.deathReport;
    if (report === null || report.distanceM >= 0) return;
    if (performance.now() - this.deathAtMs > WAKE_WAIT_MS) return;
    const body = this.deps.bodyAt(this.deathKillerId);
    if (body === null) return;
    const sim = this.deps.player.sim;
    this.deathReport = { ...report, distanceM: Math.hypot(body.x - sim.x, body.y - sim.y, body.z - sim.z) };
  }

  /**
   * A new life, where the server already put us. The networked per-life reset, entire.
   *
   * Everything `respawnPlayer` does **except choose a position**: no `selectSpawn`, no
   * `player.spawn`, no `setView`. The server picked the spawn point, the snapshot carried it,
   * and prediction has already adopted it — re-spawning locally would fight the authoritative
   * position and yank the camera somewhere the server disagrees with.
   *
   * What it does do is the per-life reset the rest of the client depends on: full health, a
   * reloaded weapon on the right slot, the sights down, the knife put away, grenades back.
   *
   * Called from one place, off one signal — see `applyReplicatedSelf`. It was named
   * `respawnNetworked` while a respawn was the only way it could be reached; a round start is
   * the other way, and naming it after the death it no longer needs is what let the round start
   * be forgotten.
   */
  private beginLife(): void {
    const match = this.deps.match;
    // Before the weapon reset, so the reset puts the *new* class's primary in hand rather than
    // the old one's and then having it swapped out from under the animation.
    this.applyPendingLoadout();
    match.playerHealth.reset();
    match.weapons.reset();
    /**
     * The grenades, explicitly (M11 Gate B playtest, and round 4's B3).
     *
     * `MatchEquipment` refills on `player.spawned`, and this path deliberately never emits one
     * — the server chose the position, so `PlayerController.spawn` is not called. So the one
     * event the refill hangs off does not exist over the network, and a networked player came
     * back with whatever the previous life had left. The server refilled its own copy on the
     * same spawn all along, which is why nothing desynced and nothing logged — only the HUD and
     * the local hand were wrong.
     *
     * Round two's fix was this call; round four's is *what reaches it*. The call was right and
     * the trigger was half a signal.
     */
    match.equipment.refillForLife();
    // A reset is not a swap and emits no `weapon.swapped`, so the visible model has to be
    // told separately or it keeps whatever was in frame when the player died.
    this.deps.arsenal.showSlot(match.weapons.inventory.activeSlotIndex);
    match.melee.reset();
    match.playerCombatant.syncRig();
    this.playerDead = false;
    this.playerRespawnTimer = 0;
  }

  /** Whether a class change lands immediately rather than waiting for a body. */
  private canApplyLoadoutNow(): boolean {
    if (this.playerDead) return true;
    const flow = this.deps.match.flow;
    return flow.currentPhase === 'WARMUP' && flow.round <= 1;
  }

  /** The actual swap. Both weapons rebuilt, grenades replaced and refilled, perks re-derived. */
  private applyLoadoutNow(loadout: ResolvedLoadout): void {
    const match = this.deps.match;
    this.deps.ledger().setStreakLoadout(loadout.streaks);
    match.equip(0, loadout.primary, loadout.primaryCamo, loadout.primaryAttachments);
    match.equip(1, loadout.secondary, loadout.secondaryCamo, loadout.secondaryAttachments);
    match.equipment.inventory.lethal = loadout.lethal;
    match.equipment.inventory.tactical = loadout.tactical;
    EquipmentSystem.refill(match.equipment.inventory);
    match.meta.setLoadout(loadout);
  }

  /**
   * Cash a deferred class change, on the spawn it was waiting for.
   *
   * Called from both respawn paths, so the local and networked halves cannot develop different
   * ideas about when a class takes effect.
   */
  private applyPendingLoadout(): void {
    const pending = this.pendingLoadout;
    if (pending === null) return;
    this.pendingLoadout = null;
    this.applyLoadoutNow(pending);
  }

  /**
   * Everybody back to a spawn, the bomb back at the attackers' base (post-M8 playtest).
   *
   * The bomb half is already done by the time this runs — `SearchAndDestroy.onRoundStart`
   * calls `resetBomb`, and the flow emits `round.started` after it — so this is the *people*
   * half, which nothing owned. Rounds two and three previously began with whoever survived
   * round one standing wherever they had finished it, which on a bomb site is a free plant.
   *
   * The player is reset through the same `respawnPlayer` a death uses, so a round start and a
   * respawn cannot disagree about what a fresh life is: full health, full magazines, primary
   * in hand, sights down, equipment refilled.
   *
   * **Single-player only** since round 4. Over the network the server owns the round reset and
   * announces it by bumping the spawn serial; see the subscription that calls this.
   */
  private hardResetRound(): void {
    this.deps.match.bots.respawnAll();
    this.playerDead = false;
    this.playerRespawnTimer = 0;
    this.respawnPlayer();
  }

  private respawnPlayer(): void {
    const match = this.deps.match;
    const choice = this.spawnChoice;
    // This path is single-player only — a networked respawn is `beginLife`, where the
    // server chose the point — but the side and the id are read from the match rather than
    // from the two constants, so the local-only claim is not also a hidden assumption.
    if (match.bots.selectSpawn(match.localTeam, this.localId, choice)) {
      this.deps.player.spawn(choice.x, choice.y + 0.05, choice.z, choice.yaw);
      this.deps.input.setView(choice.yaw, 0);
    }
    this.applyPendingLoadout();
    match.playerHealth.reset();
    match.weapons.reset();
    /**
     * The mesh follows the reset, explicitly (post-M8 playtest).
     *
     * `weapons.reset()` puts the *logic* back on slot 0, and the visible model normally
     * follows the inventory through the `weapon.swapped` subscription in the constructor —
     * but a reset is not a swap and emits no such event. So a player who died holding the
     * pistol came back holding a pistol that fired the rifle's ballistics and reported the
     * rifle's ammo: the two halves of "which weapon am I holding" had drifted apart.
     *
     * Asking the inventory which slot is live rather than hard-coding 0 keeps the two facts
     * in the same place — if `Inventory.reset` ever comes back on a different slot, the
     * viewmodel comes back with it.
     */
    this.deps.arsenal.showSlot(match.weapons.inventory.activeSlotIndex);
    match.melee.reset();
    // Equipment is per life (S6.3). `MatchEquipment` refills on `player.spawned`, which
    // `PlayerController.spawn` above has already emitted.
    match.playerCombatant.syncRig();
    this.playerDead = false;
    this.playerRespawnTimer = 0;
    match.flow.noteRespawn(this.localId);
  }

  /**
   * Everything this client could watch.
   *
   * The **remote actors** in a networked match and the bot roster in single-player — the same
   * split `actors` makes for rendering, and for the same reason: a networked client has no
   * roster, only bodies rebuilt from snapshots.
   */
  private *spectatorCandidates(): Generator<SpectatorCandidate> {
    if (this.deps.match.isNetworked) {
      for (const actor of this.deps.actors?.() ?? []) {
        const remote = actor as { entityId?: number; team?: BotTeam; participating?: boolean };
        if (typeof remote.entityId !== 'number' || remote.team === undefined) continue;
        yield { entityId: remote.entityId, team: remote.team, alive: remote.participating === true };
      }
      return;
    }
    for (const bot of this.deps.match.bots.bots) {
      yield { entityId: bot.entityId, team: bot.team, alive: bot.participating };
    }
  }
  //#endregion
}
//#endregion
