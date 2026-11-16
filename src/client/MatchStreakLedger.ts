/**
 * Whose killstreaks these are, and everything that follows from the answer.
 *
 * ## Why it is its own object
 *
 * A solo client owns its streaks and a networked one is told about them, and before C24a that
 * fact was spelled out **nine times** in five different places inside `ClientMatch`:
 * `this.isNetworked ? this.replicatedStreaks.X : this.streaks.X`, once for the balance, once
 * for the price, once for the lockout, once for affordability, once for what is next, twice
 * for a carried weapon, once for a sentry's dismantle ring and once for the minimap's sweep.
 * Each of those is a chance to get the branch the wrong way round, and the failure when one is
 * missed is not a crash — it is a HUD that offers a streak the server will refuse, or a key
 * that charges a price the screen never showed.
 *
 * There is one copy of it now, here, and the rest of the match asks a question rather than
 * choosing a source. Nothing above this object learns which kind of match it is in, which is
 * S3's *"a networked event and a local one must be indistinguishable to the client"* applied
 * to the one subsystem that could not keep it.
 *
 * ## What is deliberately not here
 *
 * The UAV **contacts** are not merged. The two sources iterate differently — the server's list
 * is already this team's whole truth, and the local one is a fixed ring with holes in it — so
 * folding them together would be merging code that only looks alike (R4.3). `MatchSurfaces`
 * keeps those two loops, each under its own name.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { LocalIdentity } from '../shared/combat/LocalIdentity';
import type { StreakView } from '../shared/net/Skirmish';
import { STREAK_DEFS, type StreakDef, type StreakId } from '../shared/streaks/StreakDefs';
import type { StreakSystem } from '../shared/streaks/StreakSystem';
import type { WeaponDef } from '../shared/weapons/WeaponDefs';
import { ReplicatedStreaks } from './streaks/ReplicatedStreaks';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface MatchStreakLedgerDeps {
  /** The local system. Constructed in both runtimes; simulated only in a solo match. */
  readonly streaks: StreakSystem;
  /** Which entity this client is, read at the point of use — the seat can arrive late. */
  readonly identity: LocalIdentity;
  /** True when a server owns activation. See `MatchDeps.networked`. */
  readonly networked: boolean;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** No sentry of this player's is in reach. The ring is hidden rather than drawn at zero. */
export const NO_SENTRY_IN_REACH = -1;

/** A sentry's replicated `fraction` is a byte; the ring wants 0..1. */
const FRACTION_FULL = 255;
//#endregion

// ================================== CLASS MatchStreakLedger =================================== \\
//#region Class MatchStreakLedger
export class MatchStreakLedger {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /**
   * The player's three equipped streaks **in key order**, nulls kept (M11 Gate B playtest).
   *
   * The keys want position to be the whole meaning, because key 3 is slot 0 and key 5 is slot 2
   * whatever is or is not in between. Packing the two together is what made key 5 dead for a
   * player carrying one streak.
   */
  streakSlots: readonly (StreakId | null)[] = [null, null, null];

  /**
   * The same three with the empty slots dropped, because `StreakSystem` wants a set to decide
   * what this player may earn rather than a layout.
   */
  equippedStreakIds: readonly StreakId[] = [];

  /**
   * The server's streak state (M11 Gate B, §8.22).
   *
   * Populated only in a networked match, where `deps.streaks` is constructed but never
   * simulated. See `ReplicatedStreaks` for why the client does not simply fold its own
   * replicated kill events into its own counter.
   */
  private readonly replicated = new ReplicatedStreaks();

  private readonly deps: MatchStreakLedgerDeps;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: MatchStreakLedgerDeps) {
    this.deps = deps;
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** Record the class's streaks, in both the shapes the rest of the match asks for. */
  setStreakLoadout(streaks: ReadonlyArray<StreakId | null>): void {
    this.streakSlots = [streaks[0] ?? null, streaks[1] ?? null, streaks[2] ?? null];
    this.equippedStreakIds = this.streakSlots.filter((id): id is StreakId => id !== null);
  }

  /**
   * The three questions the streak strip and the keys ask, each behind one accessor.
   *
   * The server's answer in a networked match and the local system's otherwise. Routed through
   * these rather than branched at each call site, because the failure when one of them is
   * missed is a HUD that offers a streak the server will refuse, or a key that charges a price
   * the screen never showed. There were two of these before round 4; the balance model added
   * price and availability, and the pivot turned availability from a bit into a duration.
   */
  streakBalance(): number {
    return this.deps.networked ? this.replicated.balance : this.deps.streaks.balanceOf(this.localId);
  }

  streakPrice(id: StreakId): number {
    return this.deps.networked
      ? this.replicated.priceOf(id)
      : this.deps.streaks.priceOf(id, this.localId);
  }

  /**
   * Seconds until this key works again, or 0 (round 4, the pivot).
   *
   * One number for the cooldown and for a previous instance still being in the world, because
   * the strip draws them the same way and the player experiences them as the same thing: the
   * key does nothing, and the slot says how long for without saying it in words.
   */
  streakLockout(id: StreakId): number {
    return this.deps.networked
      ? this.replicated.lockoutSeconds(id)
      : this.deps.streaks.lockoutSecondsFor(this.localId, id);
  }

  canAffordStreak(id: StreakId): boolean {
    return this.deps.networked
      ? this.replicated.canAfford(id)
      : this.deps.streaks.canAfford(this.localId, id);
  }

  nextStreak(): { def: StreakDef; price: number } | null {
    return this.deps.networked ? this.replicated.next : this.deps.streaks.nextFor(this.localId);
  }

  /**
   * The killstreak weapon in an entity's hands, from whichever list is authoritative here.
   *
   * Asked by the damage door for a shield and by the viewmodel for a minigun, and neither of
   * them learns that two kinds of match exist.
   */
  carriedWeaponFor(entityId: number): WeaponDef | null {
    return this.deps.networked
      ? this.replicated.carriedWeaponFor(entityId)
      : this.deps.streaks.carriedWeaponFor(entityId);
  }

  /**
   * How far through a dismantle this player's own sentry is, or `NO_SENTRY_IN_REACH`.
   *
   * The reach test is the caller's, because it is a fact about where the *player* is standing;
   * what this owns is which list the sentries are in and whose they are. The ring is the
   * simulation's own progress: the local sentry's in a solo match, the replicated `fraction`
   * over the network, so it fills at the rate the server is actually counting.
   */
  ownSentryDismantleFraction(inReach: (x: number, y: number, z: number) => boolean): number {
    if (this.deps.networked) {
      for (const e of this.replicated.entities) {
        if (STREAK_DEFS[e.kind]?.id !== 'sentry' || !this.deps.identity.is(e.ownerId)) continue;
        if (!inReach(e.x, e.y, e.z)) continue;
        return e.fraction / FRACTION_FULL;
      }
      return NO_SENTRY_IN_REACH;
    }
    for (const sentry of this.deps.streaks.sentries()) {
      if (!this.deps.identity.is(sentry.ownerId) || !inReach(sentry.x, sentry.y, sentry.z)) continue;
      return sentry.dismantleFraction;
    }
    return NO_SENTRY_IN_REACH;
  }

  /** The bearing of the server's UAV beam, or null when this team has none up: -1 on the wire. */
  get replicatedSweepAngle(): number | null {
    return this.replicated.sweepAngle < 0 ? null : this.replicated.sweepAngle;
  }

  /** Whether the server says an enemy Counter-UAV is scrambling this seat's map. */
  get replicatedScrambled(): boolean {
    return this.replicated.scrambled;
  }

  /** The server's contacts for this seat: already filtered, already the whole truth. */
  get replicatedContacts(): StreakView['contacts'] {
    return this.replicated.contacts;
  }

  /** Every replicated streak body in the world, for the renderer's mesh pool. */
  get replicatedEntities(): StreakView['entities'] {
    return this.replicated.entities;
  }

  /** Adopt one `Streaks` frame (§8.22). Called by `MatchWorld` from the net session. */
  applyReplicated(view: StreakView): void {
    this.replicated.apply(view);
  }

  /** Drop every replicated streak. Called on migration, per §4.18's obligation list. */
  clearReplicated(): void {
    this.replicated.clear();
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /**
   * The entity id this client's own player occupies.
   *
   * Read through the identity at the point of use rather than copied into a field, because the
   * assignment arrives over a socket and may land after this object was constructed.
   */
  private get localId(): number {
    return this.deps.identity.entityId;
  }
  //#endregion
}
//#endregion
