import { compareRows, type Rankable, type ScoreTeam } from '../../shared/combat/ScoreSystem';
import type { WinnerFacts } from '../../shared/modes/MatchOutcome';

/**
 * Who stands on the podium after a match, and where (M15, D1; the podium, M18).
 *
 * Pure: a result and a board in, a ranked list out — so the rule that decides who is on the
 * stage is a function with a test rather than a branch inside a screen. The screen turns each
 * entry into a body; this decides the entries.
 *
 * **The three best of the whole match, the MVP first.** M18's decision (the human's, Q1):
 * the podium is a ranking of individuals, so it is taken from the whole ladder rather than
 * from the winning side — a hostile MVP on a DEFEAT screen says what happened, and the plate
 * under them is in the enemy's colour. The ladder is the board's own order (`compareRows`),
 * and where the mode crowned one individual — Free-for-All decides on kills where the ladder
 * ranks on score — the crowned winner is pinned to first, for the reason `personalOutcome`
 * pins them: a podium whose centre is not the winner disagrees with the headline over it. It
 * replaced the lineup of the winning side's five: gold, silver and bronze are a set of
 * three, and a fourth and a fifth had nothing to stand under.
 *
 * **Where each stands** is `podiumSlots`: gold centre on the tallest block, silver on the
 * viewer's left, bronze on the right, each flank turned a little toward the centre — the
 * blocks are `CharacterStage`'s podium, built from the same `PODIUM_X` and `PODIUM_STEPS`,
 * so the feet land on the blocks by construction.
 */

export interface LineupRow extends Rankable {
  readonly entityId: number;
  readonly displayName: string;
  readonly team: ScoreTeam;
  readonly isLocal: boolean;
}

/** Gold, silver, bronze. */
export const PODIUM_SIZE = 3;
/** Where the three stand, metres across: gold centre, silver on the viewer's left, bronze right. `CharacterStage` builds the blocks here. */
export const PODIUM_X: readonly number[] = [0, -1.9, 1.9];
/** The blocks' heights, metres, in the same order. */
export const PODIUM_STEPS: readonly number[] = [0.34, 0.2, 0.1];

/** The rows to stand on the podium, best first. Empty for an empty board; fewer than three for a board of fewer. */
export function podiumOf<T extends LineupRow>(result: WinnerFacts, rows: readonly T[]): T[] {
  const ladder = [...rows].sort(compareRows);
  const crowned = result.winnerEntityId;
  if (crowned !== undefined) {
    const at = ladder.findIndex((row) => row.entityId === crowned);
    if (at > 0) {
      const [winner] = ladder.splice(at, 1);
      if (winner !== undefined) ladder.unshift(winner);
    }
  }
  return ladder.slice(0, PODIUM_SIZE);
}

export interface SlotPosition {
  /** Metres from the platform's centre, across. */
  readonly x: number;
  /** Metres above the platform: the block's top. */
  readonly y: number;
  /** Metres toward the camera. */
  readonly z: number;
  /** Radians. π faces the camera; the flanks turn a little toward the centre. */
  readonly yaw: number;
}

/** How far the flanks turn in, per metre off the centre line. */
const FLANK_TURN = 0.11;

/** Where `count` bodies stand, by rank: index 0 is gold, on the centre block. */
export function podiumSlots(count: number): SlotPosition[] {
  const n = Math.max(0, Math.min(PODIUM_SIZE, Math.round(count)));
  const slots: SlotPosition[] = [];
  for (let rank = 0; rank < n; rank++) {
    const x = PODIUM_X[rank] ?? 0;
    // Yaw π + δ faces +X, so a body on +X turns toward the centre by *subtracting* its offset.
    slots.push({ x, y: PODIUM_STEPS[rank] ?? 0, z: 0, yaw: Math.PI - x * FLANK_TURN });
  }
  return slots;
}
