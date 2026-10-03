import { bombStateCode, phaseIndex } from '../net/Messages';
import { MAX_TAGS, OBJ_TEAM_A, OBJ_TEAM_B, ownerCode } from '../net/Skirmish';
import type { GameMode } from '../modes/GameMode';
import type { MatchFlow } from '../modes/MatchFlow';

/**
 * A hash of everything the server says about mode state, computed identically on both sides
 * (M11 Gate B, §7, §8.21).
 *
 * §7: *"State-divergence checker: hash authoritative mode state on the instance and on each
 * client, logging any mismatch with the tick it appeared on."*
 *
 * ## What this catches, and what it does not
 *
 * It compares the server's own view of its mode state against what a client **ended up holding**
 * after decoding every channel that describes it. So it catches the whole class of faults that
 * live between those two points and are otherwise silent:
 *
 * - a channel that stopped being sent, or was skipped by an empty-list optimisation
 * - a field truncated or mis-quantised by an encoder change on one side only
 * - a list capped at a different length than the reader expects
 * - a frame applied to the wrong mode after a migration
 * - two channels describing different ticks
 *
 * It does **not** catch the server being wrong about its own game. If `Domination.onTick` counts
 * a zone incorrectly, both sides agree on the incorrect number and this stays silent — that is
 * what the score-versus-events comparison in `DivergenceChecker` is for, and the two are
 * complementary rather than alternatives. Saying so plainly matters: a checker whose limits are
 * not written down gets read as proving more than it does.
 *
 * ## Why it is a hash rather than a field-by-field compare
 *
 * A field-by-field message would be most of the mode state sent twice. The hash is four bytes,
 * and the moment it disagrees the *existing* channels are all still on the wire to diagnose it
 * with — the hash says **when**, and the panels say **what**.
 *
 * ## Ordering is the whole correctness argument
 *
 * The tick is carried with it and the message is sent **last** in the instance's send order,
 * after the snapshot, the objectives, the tags, the bomb and the streaks. A client therefore has
 * applied every channel describing tick N before it is asked what it thinks tick N looked like.
 * Sent any earlier, this would compare tick N against a client holding tick N-1 and report a
 * mismatch on every sample — the flaky probe that teaches its reader to ignore it.
 */

/**
 * The mode state, flattened to the numbers both sides can agree on.
 *
 * Deliberately **quantised to the wire's precision** before hashing. The server holds a
 * progress of 0.4372 and the client holds 111/255; hashing the raw values would report a
 * divergence on every objective in the game, which is a units bug rather than a finding.
 */
export interface ModeStateFacts {
  readonly scoreA: number;
  readonly scoreB: number;
  readonly round: number;
  readonly phase: number;
  /** Per zone: owner, capturing, progress as a byte, and the two body counts. */
  readonly zones: readonly {
    readonly owner: number;
    readonly capturing: number;
    readonly progress: number;
    readonly countA: number;
    readonly countB: number;
  }[];
  /** Dog tag ids, in the order they are sent. */
  readonly tagIds: readonly number[];
  /** Bomb state, or null for the four modes without one. */
  readonly bomb: {
    readonly state: number;
    readonly carrierId: number;
    readonly attackers: number;
    readonly plantedSite: number;
    /** Fuse in hundredths, as sent. */
    readonly timerCs: number;
    readonly interactProgress: number;
    readonly interactEntity: number;
  } | null;
}

/**
 * FNV-1a, 32-bit.
 *
 * Chosen for being trivially identical in two implementations rather than for its distribution:
 * this is a comparator, not a hash table, and the property that matters is that a byte changing
 * anywhere changes the result. Kept in `>>> 0` throughout so the two runtimes cannot disagree
 * about sign — the classic way a "cross-platform" hash stops being one.
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mix(hash: number, value: number): number {
  // Four bytes, low first. `| 0` on the input so a float that should have been quantised
  // upstream fails loudly as a mismatch rather than quietly as a rounding difference.
  let h = hash;
  const v = value | 0;
  for (let i = 0; i < 4; i++) {
    h ^= (v >>> (i * 8)) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

export function hashModeState(f: ModeStateFacts): number {
  let h = FNV_OFFSET >>> 0;
  h = mix(h, f.scoreA);
  h = mix(h, f.scoreB);
  h = mix(h, f.round);
  h = mix(h, f.phase);

  // Length first, so a truncated list cannot hash the same as a shorter one that happens to
  // share a prefix — the exact failure a cap mismatch produces.
  h = mix(h, f.zones.length);
  for (const z of f.zones) {
    h = mix(h, z.owner);
    h = mix(h, z.capturing);
    h = mix(h, z.progress);
    h = mix(h, z.countA);
    h = mix(h, z.countB);
  }

  h = mix(h, f.tagIds.length);
  for (const id of f.tagIds) h = mix(h, id);

  h = mix(h, f.bomb === null ? 0 : 1);
  if (f.bomb !== null) {
    h = mix(h, f.bomb.state);
    h = mix(h, f.bomb.carrierId);
    h = mix(h, f.bomb.attackers);
    h = mix(h, f.bomb.plantedSite);
    h = mix(h, f.bomb.timerCs);
    h = mix(h, f.bomb.interactProgress);
    h = mix(h, f.bomb.interactEntity);
  }
  return h >>> 0;
}

/**
 * The hash in four parts, so a mismatch can say **where** (part 5, the S&D report).
 *
 * The playtest got a confirmed `modeStateHash` divergence at the start of a Search & Destroy round
 * and could not tie it to anything: the hash said *when* and nothing at all about *what*, and the
 * channels it pointed back to are a dozen fields wide. Each part hashes one channel's worth of the
 * facts, in the order `hashModeState` mixes them, and they ride the same message — sixteen bytes —
 * so the client can name the part that disagrees and print its own values for it.
 */
export const MODE_STATE_SECTIONS = ['flow', 'zones', 'tags', 'bomb'] as const;
export type ModeStateSection = (typeof MODE_STATE_SECTIONS)[number];

/** Write the four part hashes of `f` into `out`, in `MODE_STATE_SECTIONS` order. */
export function hashModeStateSections(f: ModeStateFacts, out: number[]): number[] {
  let flow = FNV_OFFSET >>> 0;
  flow = mix(flow, f.scoreA);
  flow = mix(flow, f.scoreB);
  flow = mix(flow, f.round);
  flow = mix(flow, f.phase);

  let zones = mix(FNV_OFFSET >>> 0, f.zones.length);
  for (const z of f.zones) {
    zones = mix(zones, z.owner);
    zones = mix(zones, z.capturing);
    zones = mix(zones, z.progress);
    zones = mix(zones, z.countA);
    zones = mix(zones, z.countB);
  }

  let tags = mix(FNV_OFFSET >>> 0, f.tagIds.length);
  for (const id of f.tagIds) tags = mix(tags, id);

  let bomb = mix(FNV_OFFSET >>> 0, f.bomb === null ? 0 : 1);
  if (f.bomb !== null) {
    bomb = mix(bomb, f.bomb.state);
    bomb = mix(bomb, f.bomb.carrierId);
    bomb = mix(bomb, f.bomb.attackers);
    bomb = mix(bomb, f.bomb.plantedSite);
    bomb = mix(bomb, f.bomb.timerCs);
    bomb = mix(bomb, f.bomb.interactProgress);
    bomb = mix(bomb, f.bomb.interactEntity);
  }

  out.length = 4;
  out[0] = flow >>> 0;
  out[1] = zones >>> 0;
  out[2] = tags >>> 0;
  out[3] = bomb >>> 0;
  return out;
}

/** The facts of one part, as a short line for a divergence log. */
export function describeModeStateSection(f: ModeStateFacts, section: ModeStateSection): string {
  switch (section) {
    case 'flow':
      return `score ${f.scoreA}-${f.scoreB}, round ${f.round}, phase ${f.phase}`;
    case 'zones':
      return f.zones.map((z) => `[${z.owner}/${z.capturing} ${z.progress} ${z.countA}:${z.countB}]`).join(' ') || 'none';
    case 'tags':
      return `${f.tagIds.length}: ${f.tagIds.join(',')}`;
    case 'bomb':
      return f.bomb === null
        ? 'none'
        : `state ${f.bomb.state}, carrier ${f.bomb.carrierId}, attackers ${f.bomb.attackers}, site ${f.bomb.plantedSite}, ` +
            `timer ${f.bomb.timerCs}cs, interact ${f.bomb.interactProgress} by ${f.bomb.interactEntity}`;
  }
}

// -- building the facts, once, for both runtimes ------------------------------

/**
 * Reused buffers, so an instance hashing sixty times a second allocates nothing.
 *
 * Per caller rather than module-level: the browser and the server both build facts, and a
 * shared buffer between two callers on one process — which the harness is — would have them
 * overwriting each other's zone list mid-hash.
 */
export interface ModeStateScratch {
  zones: {
    owner: number;
    capturing: number;
    progress: number;
    countA: number;
    countB: number;
  }[];
  tagIds: number[];
}

export function makeModeStateScratch(): ModeStateScratch {
  return { zones: [], tagIds: [] };
}

/**
 * The mode state, flattened exactly as the channels send it (playtest round 5, B7).
 *
 * **One builder, both runtimes**, which is the same argument `DivergenceChecker` makes about
 * itself: the server's copy of this and the client's copy of it must agree about what "the
 * state" is, and two hand-kept transcriptions of a quantisation rule are two rules that drift.
 * The instance used to own this privately and the browser had no copy at all, which is why the
 * browser ran no hash check for a whole milestone.
 *
 * The score comes off `MatchFlow.teamScore`, and that is what makes one builder possible:
 * it returns the mode's own number where the mode is running and the replicated one where it
 * is not, so the identical call is correct on an authoritative instance and on a client that
 * scores nothing. Reading `mode.teamScore` here — which is what the instance used to do — would
 * hash a structural zero on every client and report a divergence on every sample.
 *
 * Everything is quantised to the wire's precision before it is hashed. The server holds a
 * capture progress of 0.4372 and the client holds 111/255; hashing the raw values would report
 * a divergence on every objective in the game, which is a units bug dressed as a finding.
 */
export function modeStateFacts(
  mode: GameMode,
  flow: MatchFlow,
  scratch: ModeStateScratch,
): ModeStateFacts {
  scratch.zones.length = 0;
  for (const zone of mode.objectiveZones) {
    scratch.zones.push({
      owner: ownerCode(zone.owner),
      capturing: ownerCode(zone.capturingTeam),
      progress: Math.max(0, Math.min(255, Math.round(zone.progress * 255))),
      countA: Math.min(255, zone.countA),
      countB: Math.min(255, zone.countB),
    });
  }

  scratch.tagIds.length = 0;
  const tags = mode.dogTags;
  if (tags !== null) {
    // The same truncation `writeTags` applies — the newest win — so a match with more than the
    // cap on the floor hashes what was actually sent rather than what was held.
    const skip = Math.max(0, tags.length - MAX_TAGS);
    for (let i = skip; i < tags.length; i++) {
      const t = tags[i];
      if (t !== undefined) scratch.tagIds.push(t.id & 0xffff);
    }
  }

  const info = mode.bombInfo;
  return {
    scoreA: flow.teamScore('A'),
    scoreB: flow.teamScore('B'),
    round: flow.round,
    phase: phaseIndex(flow.currentPhase),
    zones: scratch.zones,
    tagIds: scratch.tagIds,
    bomb:
      info === null
        ? null
        : {
            state: bombStateCode(info.state),
            carrierId: info.carrierId,
            attackers: info.attackers === 'B' ? OBJ_TEAM_B : OBJ_TEAM_A,
            plantedSite: info.plantedSiteIndex,
            timerCs: Math.max(0, Math.min(0xffff, Math.round(info.secondsLeft * 100))),
            interactProgress: Math.max(0, Math.min(255, Math.round(info.interactFraction * 255))),
            interactEntity: info.interactEntity,
          },
  };
}
