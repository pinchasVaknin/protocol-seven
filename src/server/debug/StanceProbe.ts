/**
 * Catches a live body the simulation has left in the `AIRBORNE` stance for far too long.
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
 * Nothing else. **Grounded is reported, not required** — see below.
 *
 * ## The filter this started with was wrong, and that is the finding
 *
 * The first version only reported a bot that was `grounded && AIRBORNE`, on the reasoning that
 * `AIRBORNE` off the ground is the stance doing its job. Deployed, it stayed **completely
 * silent** while the client's `?airpose` caught five bodies at once (100, 101, 104, 106, 108),
 * every one of them `stance: AIRBORNE` with `rawAirborne` and `airborne` both true, held past
 * 1,200 ms — and several of them moving at **4.1 to 4.8 m/s**, which is walking pace.
 *
 * The silence is the evidence. If the server had those bodies grounded, the line would have
 * printed. It did not, so on the server `grounded` is **false** for a body that is visibly
 * walking along the ground: they are not bodies with a stale stance, they are bodies the
 * simulation genuinely believes are in the air, indefinitely, sliding along under air control.
 *
 * So the condition is now duration alone, and `grounded`, `y`, `yStart`, `fell` and `vy` are
 * reported rather than assumed. That triple answers the next question without another round
 * trip: a real fall has `vy` strongly negative and `fell` growing, while a body stranded in the
 * air has both at about zero and `y` standing still.
 *
 * Twice now a filter built on what seemed obvious has hidden the thing it was written to find —
 * the client watch made the same mistake with `planarSpeed`. Measure the thing; filter later.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { Bot } from '../../shared/ai/Bot';
import { metric } from '../log';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Consecutive ticks in the `AIRBORNE` stance before a body is called stuck.
 *
 * A jump measured in a live match holds the air pose for at most 567 ms, and the landing clears
 * the stance in the same tick it happens — over 6,023 jumps and 6,006 landings, every one of
 * them. 60 ticks is a whole second at the 60 Hz sim rate: past any honest jump, and short enough
 * that a genuine long fall is still told apart by `fell` and `vy` rather than by the threshold.
 */
const STUCK_TICKS = 60;

/** How long each entity has been `AIRBORNE`, and the height it was at when it started. */
const held = new Map<number, { ticks: number; yStart: number }>();

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
    if (!bot.participating || sim.stance !== 'AIRBORNE') {
      held.delete(bot.entityId);
      reported.delete(bot.entityId);
      continue;
    }
    const episode = held.get(bot.entityId) ?? { ticks: 0, yStart: sim.y };
    episode.ticks++;
    held.set(bot.entityId, episode);
    if (episode.ticks < STUCK_TICKS || reported.has(bot.entityId)) continue;
    reported.add(bot.entityId);
    report(bot, sim, episode, tick);
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
function report(
  bot: Bot,
  sim: Bot['controller']['sim'],
  episode: { ticks: number; yStart: number },
  tick: number,
): void {
  metric('stance', 'stuck-airborne', {
    entityId: bot.entityId,
    ticks: episode.ticks,
    tick,
    // The three that separate a real fall from a body stranded in the air: a fall has `vy`
    // strongly negative and `fell` growing; a stranded body has both at about zero.
    y: +sim.y.toFixed(3),
    yStart: +episode.yStart.toFixed(3),
    fell: +(episode.yStart - sim.y).toFixed(3),
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
