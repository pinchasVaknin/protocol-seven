import { installClock } from '../shared/core/Clock';
import { EV } from '../shared/core/Events';
import { decodeHeader, readEvents, Ev, type EventSink } from '../shared/net/Messages';
import { MAX_SERVER_FRAME_BYTES } from '../shared/net/Protocol';
import { ByteReader, ByteWriter } from '../shared/net/Wire';
import { MAX_TICK_EVENTS } from './net/EventCollector';
import { ServerMatch } from './Match';
import { nodeClock } from './NodeClock';

/**
 * What a tick's events **say**, printed (BACKLOG #47, 2026-10-19).
 *
 * ## Why a sixth printer
 *
 * The oracle set could not see an event's payload. #44 changed what every missed shot in the
 * game puts on the wire — `FiredEvent.material`, which drives the client's spark colour and
 * impact click — and not one oracle byte moved: the per-tick hashes are simulation state and no
 * simulation state derives from a replicated event; the other printers hold content, scores and
 * progression; and the flow check does decode events, but it holds them against the *cut's
 * rules* — which seat may have which event, in which form — never against a field's value.
 *
 * So a refactor of `EventCollector`, `MessageEvents` or a client event sink could change what a
 * shot, a step or a kill says and pass every gate. This closes that: one seeded match, every
 * event of every tick, decoded off the wire and printed field by field.
 *
 * ## Why it is deterministic
 *
 * It is the same fixed seed the five match printers run, driven through `ServerMatch` with no
 * sockets and no clock in the loop: the bots' decisions come from the seeded `Rng`, positions
 * from the tick-driven simulation, and every number here is read back **through the decoder**,
 * so the wire's own quantisation is part of the record rather than something the reader has to
 * remember. Two runs on one tree print the same bytes; `toFixed` keeps the floats engine-stable,
 * as §5's figures do.
 *
 * Both forms are printed. The shared frame is what a seat that may see everything is sent; the
 * **variants** are what everybody else gets in its place — a suppressed shot as its bare impact
 * (D2) and a kill with the killer's health zeroed (E3) — and those bytes had no gate at all.
 *
 * Exit code is always 0: a printer, not a judge. `diff` is the judge.
 *
 * Usage:
 *   node dist-server/eventRun.js [--ticks 1800]
 */

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** The fixed scenario. The same map, mode and seed the match printers use. */
const MAP_ID = 'mp_foundry';
const MODE_ID = 'TDM';
const BOTS = 10;
const SEED = 99;

/** Ticks recorded. 1,800 at 60 Hz is 30 s — long enough for the bots to find each other. */
const DEFAULT_TICKS = 1800;

const KIND_NAMES: Readonly<Record<number, string>> = {
  [Ev.Footstep]: 'step',
  [Ev.Jump]: 'jump',
  [Ev.Land]: 'land',
  [Ev.Fired]: 'fired',
  [Ev.Impact]: 'impact',
  [Ev.Damage]: 'hit',
  [Ev.Killed]: 'killed',
};
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function n3(v: number): string {
  return v.toFixed(3);
}

/** One decoded event as one line. Every field the kind carries, in a fixed order. */
function sink(out: string[]): EventSink {
  return {
    onFootstep: (e) =>
      out.push(
        `step     id=${e.entityId} at=${n3(e.x)},${n3(e.y)},${n3(e.z)} material=${e.material} ` +
          `heavy=${e.heavy ? 1 : 0} quiet=${e.quiet ? 1 : 0}`,
      ),
    onJump: (e) => out.push(`jump     id=${e.entityId} at=${n3(e.x)},${n3(e.y)},${n3(e.z)} speed=${n3(e.speed)}`),
    onLand: (e) =>
      out.push(
        `land     id=${e.entityId} at=${n3(e.x)},${n3(e.y)},${n3(e.z)} speed=${n3(e.speed)} material=${e.material}`,
      ),
    onFired: (e) =>
      out.push(
        `fired    id=${e.sourceId} weapon=${e.weaponIndex} from=${n3(e.x)},${n3(e.y)},${n3(e.z)} ` +
          `to=${n3(e.endX)},${n3(e.endY)},${n3(e.endZ)} material=${e.material} tracer=${e.tracer ? 1 : 0} ` +
          `pelletsHit=${e.pelletsHit} ping=${e.minimapPing ? 1 : 0}`,
      ),
    onImpact: (e) => out.push(`impact   at=${n3(e.x)},${n3(e.y)},${n3(e.z)} material=${e.material}`),
    onDamage: (e) =>
      out.push(
        `hit      ${e.sourceId}>${e.targetId} amount=${e.amount} zone=${e.zone} lethal=${e.lethal ? 1 : 0} ` +
          `autonomous=${e.autonomous ? 1 : 0} at=${n3(e.x)},${n3(e.y)},${n3(e.z)}`,
      ),
    onKilled: (e) =>
      out.push(
        `killed   ${e.sourceId}>${e.targetId} weapon=${e.weaponIndex} zone=${e.zone} ` +
          `killerHealth=${e.killerHealth}`,
      ),
  };
}

function decodeFrame(frame: Uint8Array, into: string[]): void {
  const r = new ByteReader(frame);
  const head = decodeHeader(r);
  if (head.kind !== 'events') {
    into.push(`!! decoded as ${head.kind}`);
    return;
  }
  readEvents(r, head.count, sink(into));
}

function parseTicks(argv: readonly string[]): number {
  const at = argv.indexOf('--ticks');
  if (at < 0) return DEFAULT_TICKS;
  const value = Number.parseInt(argv[at + 1] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TICKS;
}
//#endregion

// =================================== MODULE INITIALISATION ==================================== \\
//#region Module Initialisation
installClock(nodeClock);

const ticks = parseTicks(process.argv.slice(2));
const match = new ServerMatch({ mapId: MAP_ID, modeId: MODE_ID, bots: BOTS, tier: 'REGULAR', seed: SEED });

const lines: string[] = [];
lines.push(`# events of ${MODE_ID} on ${MAP_ID}, ${BOTS} bots at REGULAR, seed ${SEED}, ${ticks} ticks`);
lines.push('# every event of every tick, decoded off the frame. BACKLOG #47.');

const whole = new ByteWriter(MAX_SERVER_FRAME_BYTES);
const variantsOf = new ByteWriter(MAX_SERVER_FRAME_BYTES);
const allWhole = new Uint8Array(MAX_TICK_EVENTS).fill(1);
const allVariant = new Uint8Array(MAX_TICK_EVENTS).fill(2);
const totals = new Map<string, number>();
let ticksWithEvents = 0;
let variantCount = 0;
let mutedCount = 0;
let loudCount = 0;

for (let tick = 0; tick < ticks; tick++) {
  match.step(tick);
  const events = match.outgoing;
  const pending = events.pending;
  const frame = events.finish();
  if (frame === null || pending === 0) continue;
  ticksWithEvents++;

  // The record the cut reads, beside the payload the client reads: a drift in either shows here.
  const flags: string[] = [];
  for (let i = 0; i < pending; i++) {
    const name = KIND_NAMES[events.kinds[i] ?? 0] ?? String(events.kinds[i]);
    totals.set(name, (totals.get(name) ?? 0) + 1);
    if (events.muted[i] === 1) mutedCount++;
    if (events.loud[i] === 1) loudCount++;
    if (events.hasVariant[i] === 1) variantCount++;
    flags.push(
      `${i}:${name} subject=${events.subjects[i]} object=${events.objects[i]} ` +
        `at=${n3(events.xs[i] ?? 0)},${n3(events.zs[i] ?? 0)} muted=${events.muted[i]} ` +
        `loud=${events.loud[i]} variant=${events.hasVariant[i]}`,
    );
  }

  lines.push(`tick ${tick}  ${pending} event(s)`);
  for (const f of flags) lines.push(`  record  ${f}`);
  const decoded: string[] = [];
  decodeFrame(events.frameFor(allWhole, whole), decoded);
  for (const d of decoded) lines.push(`  ${d}`);
  const asVariants: string[] = [];
  decodeFrame(events.frameFor(allVariant, variantsOf), asVariants);
  for (const d of asVariants) lines.push(`  variant ${d}`);
}

/**
 * The three forms a bot match never produces, raised on the match's own bus.
 *
 * A bot carries a plain weapon, and suppression is an **attachment** effect
 * (`Attachments.ts`: `minimapPing: false`), so no shot in the run above is suppressed and the
 * bare-impact variant D2 exists for — the one that says where a round landed and nothing about
 * where it came from — never gets encoded. Bots do not crouch-walk much either, so `muted` stays
 * zero. Rather than ship this printer with those two paths unread, they are emitted directly:
 * same bus, same encoder, same decoder, after the last step so nothing downstream can be
 * perturbed by them.
 */
match.outgoing.begin();
match.bus.emit(EV.BulletImpact, { x: 4, y: 1.2, z: -9, nx: 0, ny: 0, nz: 1, material: 4, penetrated: false });
match.bus.emit(EV.WeaponFired, {
  weaponId: 'ar_carbine',
  sourceId: 101,
  x: 1,
  y: 1.6,
  z: 2,
  dx: 0,
  dy: 0,
  dz: 1,
  endX: 4,
  endY: 1.2,
  endZ: -9,
  distance: 11,
  shotIndex: 0,
  spreadDeg: 0,
  tracer: false,
  hitTarget: false,
  ammoInMag: 20,
  pellets: 1,
  pelletsHit: 0,
  minimapPing: false,
});
match.bus.emit(EV.PlayerFootstep, { entityId: 102, x: -3, y: 0, z: 5, speed: 2, heavy: false, quiet: true, material: 2 });
{
  const events = match.outgoing;
  const pending = events.pending;
  events.finish();
  lines.push('');
  lines.push(`synthetic ${pending} event(s): a suppressed shot, its impact, and a crouched step`);
  for (let i = 0; i < pending; i++) {
    const name = KIND_NAMES[events.kinds[i] ?? 0] ?? String(events.kinds[i]);
    lines.push(
      `  record  ${i}:${name} subject=${events.subjects[i]} object=${events.objects[i]} ` +
        `at=${n3(events.xs[i] ?? 0)},${n3(events.zs[i] ?? 0)} muted=${events.muted[i]} ` +
        `loud=${events.loud[i]} variant=${events.hasVariant[i]}`,
    );
  }
  const decoded: string[] = [];
  decodeFrame(events.frameFor(allWhole, whole), decoded);
  for (const d of decoded) lines.push(`  ${d}`);
  const asVariants: string[] = [];
  decodeFrame(events.frameFor(allVariant, variantsOf), asVariants);
  for (const d of asVariants) lines.push(`  variant ${d}`);
}

lines.push('');
lines.push(`ticks with events: ${ticksWithEvents} of ${ticks}`);
for (const name of [...totals.keys()].sort()) lines.push(`${name}: ${totals.get(name)}`);
lines.push(`variants recorded: ${variantCount}`);
lines.push(`muted: ${mutedCount}`);
lines.push(`loud: ${loudCount}`);

match.dispose();
process.stdout.write(`${lines.join('\n')}\n`);
//#endregion
