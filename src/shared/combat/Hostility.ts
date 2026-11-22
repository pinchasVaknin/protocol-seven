import type { BotTeam } from '../core/Vocabulary';
/**
 * One answer to "is `subject` an enemy of `viewer`" (M13 Phase A).
 *
 * ## The report, and why it was three reports
 *
 * A sentry that would not fire at half the room, a UAV that did not show them, and a Chopper
 * Gunner whose thermal pass drew them near-black — three playtest bugs, one defect. Free-for-All
 * keeps the two-team substrate on purpose (`modes/FreeForAll.ts` says why at length), so half of
 * every FFA lobby shares a `ScoreTeam` with any given player and none of them is a team-mate.
 * The question "is this an enemy" was answered in seven places, and only four of them had been
 * told about the mode: perception, spawn safety, the score and the damage door each carried
 * their own `freeForAll` flag; the streaks compared `team === team` and had never heard of it.
 *
 * ## Why one function rather than one more flag
 *
 * Every site that got it wrong had written the same expression — `other.team === self.team` —
 * and every site that got it right had written the same guard in front of it. A seventh copy
 * of the guard is a seventh place to forget it; a function is the one place. So this is the
 * only hostility test in the tree, `ui/TeamColour.relationTo` is a thin wrapper over it for the
 * surfaces that need three answers rather than two, and `grep -rn "team === " src/shared` is
 * the audit that nothing has grown a private copy.
 *
 * ## What it does not decide
 *
 * Identity. In Free-for-All everybody is hostile, **including the viewer's own substrate side,
 * and therefore the viewer** — the substrate cannot tell the viewer from the opponents that
 * share their side, so it does not try. Every caller already skips the self case by entity id
 * (`other === self`, `killerId === victimId`, `sourceId !== targetId`, and now the sentry's and
 * the UAV's `c.entityId === this.ownerId`), and that is where it belongs: "is this me" is a
 * question about an id and "is this an enemy" is a question about a side. `relationToSelf` in
 * `TeamColour` is the same split on the UI side.
 *
 * Lives in `combat/` rather than `ui/` because `ai/` and `streaks/` are simulation and `combat/`
 * is the layer they already depend on. It took `BotTeam` from `core/Vocabulary` on 2026-11-22
 * (BACKLOG #2): it was written against the literal union, for the reason `Damageable.team` gave
 * — `combat/` sits below `ai/`, where the word used to live — and `BotTeam` was the name
 * that workaround needed. The word is below both layers now, so the alias is gone and the two
 * sides of a firefight are called the same thing everywhere.
 */

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Whether a body on `subjectTeam` is an enemy of a body on `viewerTeam`.
 *
 * With teams, the other side. Without them, everybody — see the header for why that includes
 * the viewer's own side and why the self case is the caller's.
 */
export function isHostile(
  viewerTeam: BotTeam,
  subjectTeam: BotTeam,
  freeForAll: boolean,
): boolean {
  if (freeForAll) return true;
  return subjectTeam !== viewerTeam;
}
//#endregion
