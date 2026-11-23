/**
 * Catches a live body the simulation has left standing on the ground in the `AIRBORNE` stance.
 *
 * ## What this is for
 *
 * BACKLOG #87: bodies intermittently drawn in the jumping pose — knees up toward the belly —
 * while they stand or walk normally. A client-side hunt measured four layers clean and then
 * caught the real thing on the deployed server with `?airpose`, which reported this, from a
 * body the client was drawing faithfully:
 *
 * ```
 * entity 104 · alive: true · y: 0 · planarSpeed: 0
 * stance: AIRBORNE · frozen: false · extrapolated: false
 * ```
 *
 * Not frozen and not extrapolated means snapshots were arriving: **the stance on the wire was
 * wrong**, and the client was right to draw what it was told. So the defect is here, in the
 * authority, and the client cannot see enough to say why.
 *
 * ## Why it is not gated behind a flag
 *
 * It is a defect detector, not a trace. A healthy server never prints a line, and the cost of
 * the check is one comparison per bot per tick — ten bots at 60 Hz is six hundred boolean tests
 * a second, which is nothing next to the tick that produced them. Gating it would mean the one
 * thing standing between us and this bug is somebody remembering to set an environment variable
 * on the deploy where it happens.
 *
 * ## What is deliberately not reported
 *
 * **A dead body.** `Bot.advance` returns early for a bot that is not alive, so its controller
 * never runs and `sim.stance` stays exactly as it was at the moment of death — a bot killed
 * mid-jump replicates `AIRBORNE` for its whole death. That is a real oddity and it is on record
 * in #87, but it is also harmless: the client draws a dead body with a death clip and never
 * reads the stance. Reporting it would bury the live case in noise, and the live case is the bug.
 *
 * **A body that is not grounded.** `AIRBORNE` while off the ground is the stance doing its job.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { Bot } from '../../shared/ai/Bot';
import { metric } from '../log';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Consecutive ticks of grounded-and-`AIRBORNE` before a body is called stuck.
 *
 * The clear runs after the collision pass in the same tick (`updatePostMoveStance`), so a
 * correctly behaving body is never grounded and `AIRBORNE` on two ticks in a row — measured over
 * 6,023 jumps and 6,006 landings, where every landing cleared it within the tick. 60 is a whole
 * second at the 60 Hz sim rate: far past any honest transient, and still prompt enough to name
 * the tick the body got stuck on.
 */
const STUCK_TICKS = 60;

/** How many ticks each entity has been grounded and `AIRBORNE`, by entity id. */
const held = new Map<number, number>();

/** Entities already reported for the episode they are in, so one episode prints one line. */
const reported = new Set<number>();
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Look over the roster once, after the tick that moved it.
 *
 * Called from `MatchInstance.step` with the bots it has just stepped, so everything read here is
 * this tick's authoritative state rather than a snapshot of it.
 */
export function watchStuckStance(bots: readonly Bot[], tick: number): void {
  for (const bot of bots) {
    const sim = bot.controller.sim;
    const stuck = bot.participating && sim.grounded && sim.stance === 'AIRBORNE';
    if (!stuck) {
      held.delete(bot.entityId);
      reported.delete(bot.entityId);
      continue;
    }
    const ticks = (held.get(bot.entityId) ?? 0) + 1;
    held.set(bot.entityId, ticks);
    if (ticks < STUCK_TICKS || reported.has(bot.entityId)) continue;
    reported.add(bot.entityId);
    report(bot, sim, ticks, tick);
  }
}

/** Forget every episode. For a test, and for a match that has just been torn down. */
export function resetStuckStanceWatch(): void {
  held.clear();
  reported.clear();
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * One line, with the fields that can name a cause.
 *
 * Every one of these is a candidate: `mantleActive` would mean `step` is early-returning before
 * the stance clear is reached, a non-zero `mantleCooldown` points at a vault that has just
 * finished, `slideActive` at the one branch that takes the ground edge for itself, and `vy`
 * with `landImpact` at a landing that did not register. `tick` is the match tick, so the line
 * can be lined up against everything else the instance logged.
 */
function report(bot: Bot, sim: Bot['controller']['sim'], ticks: number, tick: number): void {
  metric('stance', 'stuck-airborne', {
    entityId: bot.entityId,
    ticks,
    tick,
    y: +sim.y.toFixed(3),
    vy: +sim.vy.toFixed(3),
    grounded: sim.grounded,
    stance: sim.stance,
    slideActive: sim.slideActive,
    mantleActive: sim.mantleActive,
    mantleCooldown: +sim.mantleCooldown.toFixed(3),
    coyote: +sim.coyote.toFixed(3),
    jumpBuffer: +sim.jumpBuffer.toFixed(3),
    landImpact: +sim.landImpact.toFixed(3),
    justLanded: sim.justLanded,
    capsuleHeight: +sim.capsuleHeight.toFixed(3),
  });
}
//#endregion
