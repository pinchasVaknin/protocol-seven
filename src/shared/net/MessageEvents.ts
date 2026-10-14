/**
 * The event channel: what the client is told so it can *present* something (S4.15).
 *
 * The writers, the reader and the records they travel in, together — a wrong bit in an event
 * is as silent as a wrong bit in a snapshot and twice as hard to see, because the symptom is
 * a sound that did not play rather than a number that is wrong.
 *
 * `readEvents` keeps its `switch` rather than taking a decoder table: it runs once per event
 * per frame on the client's receive path, and R7 of the refactor programme keeps dispatch out
 * of that loop. Each case is one line into a named reader instead.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { HitZone } from '../combat/HitboxRig';
import { HIT_ZONES } from '../combat/HitboxRig';
import { BAD, head, type BadFrame } from './MessageFrame';
import { dequantPos, MsgS, quantPos } from './Protocol';
import { ByteReader, ByteWriter } from './Wire';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface FiredEvent {
  sourceId: number;
  weaponIndex: number;
  /** Muzzle, in world space. */
  x: number;
  y: number;
  z: number;
  /**
   * Where the round stopped.
   *
   * One terminus per trigger pull, not per pellet. A shotgun fires up to eight rounds and
   * this is the first one's — which is the one the tracer and the impact belong to, exactly
   * as `WeaponSystem` already decided for the local case. Replicating eight termini to draw
   * eight sparks somebody is not looking at is bandwidth spent on nothing.
   */
  endX: number;
  endY: number;
  endZ: number;
  /** Terminating surface material, for the impact sound and spark colour. */
  material: number;
  tracer: boolean;
  /**
   * How many of this pull's rays found a body (protocol v14, playtest round 5, B5).
   *
   * This was a `hitTarget` bit, and a bit is not a statistic. `ScoreSystem` builds a client's
   * whole scoreboard — accuracy column included — out of replicated events, so a remote
   * shotgunner's eight rays arriving as one connected-or-not flag meant the client counted
   * *pulls* where the server counted *rays*: one figure with two definitions, split by runtime,
   * which is the shape this milestone keeps finding.
   *
   * How many rays the pull sent is **not** here: it is `WEAPON_DEFS[weaponIndex].pellets`, and
   * both sides compile against that table. A derived field on the wire is a second copy of a
   * fact. `hitTarget` is derived from this one the same way, by the one consumer that wants it.
   *
   * Six bits of the byte the tracer flag already occupies, so it costs nothing.
   */
  pelletsHit: number;
  /**
   * Whether this shot shows on the enemy's minimap (protocol v27, 2026-10-04).
   *
   * The **resolved** weapon's answer — a suppressor sets it false — carried by the server, which
   * is the only side that knows what is on the shooter's gun. The client used to read it off
   * `WEAPON_DEFS[weaponIndex]`, the *base* def no attachment has touched, so online every
   * suppressed shot pinged every enemy's minimap and the SUPPRESSOR's whole benefit was gone.
   * Bit 7 of the tracer byte, set when the shot is silent, so a zero means what it always meant.
   */
  minimapPing: boolean;
}

export interface DamageEvent {
  sourceId: number;
  targetId: number;
  amount: number;
  zone: HitZone;
  lethal: boolean;
  /**
   * The shot came from something the source deployed — a sentry (protocol v19, 2026-09-24).
   *
   * A **spare bit of the zone byte** rather than a field of its own: `HIT_ZONES` has four
   * members, so the low six bits are five times the room the zone will ever need, and the
   * alternative — sending the weapon so the client could work it out — is a byte per damage
   * event for a question with one bit of answer in it.
   */
  autonomous: boolean;
  x: number;
  y: number;
  z: number;
}

export interface KilledEvent {
  targetId: number;
  sourceId: number;
  weaponIndex: number;
  zone: HitZone;
  /**
   * The killer's remaining health at the instant of the kill (protocol v15, round 5, F9).
   *
   * Every entity's health is already in the snapshot, so a client *can* answer this without the
   * byte — from a frame up to a tick and an interpolation delay old, which may already include
   * damage the killer took afterwards. The death panel's whole value is "he had 8 health left"
   * versus "he had 100", and the stale version of that sentence describes a different fight.
   *
   * One byte on an event that happens a few times a minute per player, against a number that
   * only the server holds at the moment it is true. 0 means there was no killer to ask.
   */
  killerHealth: number;
}

export interface FootstepEvent {
  entityId: number;
  x: number;
  y: number;
  z: number;
  material: number;
  heavy: boolean;
  quiet: boolean;
}

export interface PoseEvent {
  entityId: number;
  x: number;
  y: number;
  z: number;
  /** Landing impact speed; zero for a jump. */
  speed: number;
  material: number;
}

/**
 * A round's terminus, alone (protocol v29). No shooter and no direction: the line from an impact
 * back along its travel is the line to the muzzle.
 */
export interface ImpactEvent {
  x: number;
  y: number;
  z: number;
  /** Terminating surface material, as on `FiredEvent`. */
  material: number;
}

export interface EventSink {
  onFired?(e: FiredEvent): void;
  onImpact?(e: ImpactEvent): void;
  onDamage?(e: DamageEvent): void;
  onKilled?(e: KilledEvent): void;
  onFootstep?(e: FootstepEvent): void;
  onJump?(e: PoseEvent): void;
  onLand?(e: PoseEvent): void;
}

/** The event frame's own header: how many events follow. The bodies stream out of the reader. */
export type DecodedEvents = { kind: 'events'; count: number };
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Gameplay events the client needs to *present* something for (S4.15).
 *
 * The table in S4.15 is explicit that cosmetics are **driven by replicated events, not
 * replicated state**: the server says `damage.dealt` and the client decides what that looks
 * and sounds like.
 *
 * ## One judgement call, named rather than glossed (M11 Gate B, S8.25)
 *
 * This comment used to claim there was *"deliberately no tracer, decal or particle anywhere in
 * it"*, and `FiredEvent.tracer` is a few lines below — the comment was simply wrong, and a
 * comment that lies about the audit it describes is worse than no comment. The audit is now
 * `scripts/check-cosmetics.mjs`, which is a check that fails rather than a sentence that
 * asserts.
 *
 * The tracer bit stays, and here is the actual argument for it. S8.25's requirement is that no
 * cosmetic state appears in a **snapshot**, and it does not: the entity snapshot is nineteen
 * fields of position, velocity, stance, health, weapon and event counters, pinned by that check.
 * `tracer` rides an *event*, which is the channel S4.15 says cosmetics are supposed to be driven
 * by. It is one bit meaning "this shot was a tracer round" — a fact about which round in the
 * magazine this was, which the firing side knows and a receiving client cannot recover across
 * packet loss without counting shots it may not have seen. The client still owns what a tracer
 * looks like, how long it lives and whether to draw one at all.
 *
 * What would be a violation, and is not present: a position for the tracer, a particle count, a
 * decal id, a muzzle-flash intensity, a viewmodel pose, a camera-shake magnitude.
 */
export const Ev = {
  /** Somebody fired. Carries the terminus, so the client can draw the whole shot. */
  Fired: 1,
  Damage: 2,
  Killed: 3,
  Footstep: 4,
  Jump: 5,
  Land: 6,
  /**
   * A round landed here (protocol v29). What a client is sent instead of `Fired` for a suppressed
   * shot from a body it is not told about (D2): the spark, the decal and the click of the round
   * arriving, and nothing about where it came from.
   */
  Impact: 7,
} as const;

// Decode scratch. Handed to the sink for the duration of the call and never retained —
// the same "payloads are transient" contract the EventBus has used since M1.
const firedScratch: FiredEvent = {
  sourceId: 0,
  weaponIndex: 0,
  x: 0,
  y: 0,
  z: 0,
  endX: 0,
  endY: 0,
  endZ: 0,
  material: 0,
  tracer: false,
  pelletsHit: 0,
  minimapPing: true,
};

const damageScratch: DamageEvent = {
  sourceId: 0,
  targetId: 0,
  amount: 0,
  zone: 'torso',
  lethal: false,
  autonomous: false,
  x: 0,
  y: 0,
  z: 0,
};

const killedScratch: KilledEvent = { targetId: 0, sourceId: 0, weaponIndex: 0, zone: 'torso', killerHealth: 0 };

const footstepScratch: FootstepEvent = {
  entityId: 0,
  x: 0,
  y: 0,
  z: 0,
  material: 0,
  heavy: false,
  quiet: false,
};

const poseScratch: PoseEvent = { entityId: 0, x: 0, y: 0, z: 0, speed: 0, material: 0 };

const impactScratch: ImpactEvent = { x: 0, y: 0, z: 0, material: 0 };
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function beginEvents(w: ByteWriter): void {
  head(w, MsgS.Events);
  w.u8v(0); // count, patched by `finishEvents`
}

export function writeFired(w: ByteWriter, e: FiredEvent): void {
  w.u8v(Ev.Fired);
  w.u8v(e.sourceId);
  w.u8v(e.weaponIndex);
  w.i16(quantPos(e.x));
  w.i16(quantPos(e.y));
  w.i16(quantPos(e.z));
  w.i16(quantPos(e.endX));
  w.i16(quantPos(e.endY));
  w.i16(quantPos(e.endZ));
  w.u8v(e.material);
  // Bit 0 is the tracer, bits 1-6 the connected count (`MAX_PELLETS` bounds it at 16), and bit 7
  // set for a shot that does not ping the minimap (v27).
  w.u8v((e.tracer ? 1 : 0) | ((e.pelletsHit & 0x3f) << 1) | (e.minimapPing ? 0 : 0x80));
}

export function writeImpact(w: ByteWriter, e: ImpactEvent): void {
  w.u8v(Ev.Impact);
  w.i16(quantPos(e.x));
  w.i16(quantPos(e.y));
  w.i16(quantPos(e.z));
  w.u8v(e.material);
}

export function writeDamage(w: ByteWriter, e: DamageEvent): void {
  w.u8v(Ev.Damage);
  w.u8v(e.sourceId);
  w.u8v(e.targetId);
  w.u16(Math.round(Math.min(65535, Math.max(0, e.amount * 100))));
  // Bit 7 lethal, bit 6 autonomous, bits 0-5 the zone. See `DamageEvent.autonomous`.
  w.u8v(zoneIndex(e.zone) | (e.lethal ? 0x80 : 0) | (e.autonomous ? 0x40 : 0));
  w.i16(quantPos(e.x));
  w.i16(quantPos(e.y));
  w.i16(quantPos(e.z));
}

export function writeKilled(w: ByteWriter, e: KilledEvent): void {
  w.u8v(Ev.Killed);
  w.u8v(e.targetId);
  w.u8v(e.sourceId);
  w.u8v(e.weaponIndex);
  w.u8v(zoneIndex(e.zone));
  // Health is 0-255 on the wire everywhere else in this protocol; see `EntitySnapshot.health`.
  w.u8v(Math.max(0, Math.min(255, Math.round(e.killerHealth))));
}

export function writeFootstep(w: ByteWriter, e: FootstepEvent): void {
  w.u8v(Ev.Footstep);
  w.u8v(e.entityId);
  w.i16(quantPos(e.x));
  w.i16(quantPos(e.y));
  w.i16(quantPos(e.z));
  w.u8v(e.material);
  w.u8v((e.heavy ? 1 : 0) | (e.quiet ? 2 : 0));
}

export function writePose(w: ByteWriter, kind: number, e: PoseEvent): void {
  w.u8v(kind);
  w.u8v(e.entityId);
  w.i16(quantPos(e.x));
  w.i16(quantPos(e.y));
  w.i16(quantPos(e.z));
  w.u8v(Math.round(Math.min(255, Math.abs(e.speed) * 10)));
  w.u8v(e.material);
}

/**
 * Patch the event count into the byte reserved by `beginEvents`.
 *
 * The count is written last because it is not known first, and reserving a byte is cheaper
 * than buffering the events somewhere to count them. `bytes()` is a live view over the
 * writer's own buffer, so writing through it patches the frame in place.
 */
export function finishEvents(w: ByteWriter, count: number): Uint8Array {
  const frame = w.bytes();
  // u32 magic + u8 msgId = offset 5.
  if (frame.length > 5) frame[5] = Math.min(count, 255);
  return frame;
}


/** How many events follow. */
export function decodeEvents(r: ByteReader): DecodedEvents | BadFrame {
  const count = r.u8v();
  return r.overran ? BAD : { kind: 'events', count };
}

/**
 * Stream the event list into a sink.
 *
 * Unknown event ids abort the rest of the frame rather than trying to skip: without a length
 * prefix per event there is no way to know where the next one starts, and guessing would
 * decode the remaining bytes as garbage. A newer server talking to an older client is a
 * version mismatch, and the handshake has already refused that case — this is the belt to
 * that braces.
 *
 * The `switch` stays a `switch` (R7): this runs once per event per frame on the receive path,
 * and a dispatch table there would trade a jump for an indirect call on every event in the
 * match. Each case is one line into the reader that owns that event's bytes.
 */
export function readEvents(r: ByteReader, count: number, sink: EventSink): boolean {
  for (let i = 0; i < count; i++) {
    const kind = r.u8v();
    if (r.overran) return false;
    let ok: boolean;
    switch (kind) {
      case Ev.Fired:
        ok = readFiredEvent(r, sink);
        break;
      case Ev.Impact:
        ok = readImpactEvent(r, sink);
        break;
      case Ev.Damage:
        ok = readDamageEvent(r, sink);
        break;
      case Ev.Killed:
        ok = readKilledEvent(r, sink);
        break;
      case Ev.Footstep:
        ok = readFootstepEvent(r, sink);
        break;
      case Ev.Jump:
        ok = readPoseEvent(r, sink, true);
        break;
      case Ev.Land:
        ok = readPoseEvent(r, sink, false);
        break;
      default:
        return false;
    }
    if (!ok) return false;
  }
  return true;
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function zoneIndex(zone: HitZone): number {
  const at = HIT_ZONES.indexOf(zone);
  return at < 0 ? 1 : at;
}

function zoneAt(index: number): HitZone {
  return HIT_ZONES[index] ?? 'torso';
}


/** `Fired`: the muzzle, the terminus, and the byte that carries the tracer, the pellet count and the minimap ping. */
function readFiredEvent(r: ByteReader, sink: EventSink): boolean {
  const e = firedScratch;
  e.sourceId = r.u8v();
  e.weaponIndex = r.u8v();
  e.x = dequantPos(r.i16());
  e.y = dequantPos(r.i16());
  e.z = dequantPos(r.i16());
  e.endX = dequantPos(r.i16());
  e.endY = dequantPos(r.i16());
  e.endZ = dequantPos(r.i16());
  e.material = r.u8v();
  const bits = r.u8v();
  e.tracer = (bits & 1) !== 0;
  e.pelletsHit = (bits >>> 1) & 0x3f;
  e.minimapPing = (bits & 0x80) === 0;
  if (r.overran) return false;
  sink.onFired?.(e);
  return true;
}

/** `Impact`: a round's terminus alone, which is all a client is told about a shot from a body it cannot see (v29). */
function readImpactEvent(r: ByteReader, sink: EventSink): boolean {
  const e = impactScratch;
  e.x = dequantPos(r.i16());
  e.y = dequantPos(r.i16());
  e.z = dequantPos(r.i16());
  e.material = r.u8v();
  if (r.overran) return false;
  sink.onImpact?.(e);
  return true;
}

/** `Damage`: the hit, with the zone, the lethal bit and the autonomous bit sharing one byte. */
function readDamageEvent(r: ByteReader, sink: EventSink): boolean {
  const e = damageScratch;
  e.sourceId = r.u8v();
  e.targetId = r.u8v();
  e.amount = r.u16() / 100;
  const z = r.u8v();
  e.zone = zoneAt(z & 0x3f);
  e.lethal = (z & 0x80) !== 0;
  e.autonomous = (z & 0x40) !== 0;
  e.x = dequantPos(r.i16());
  e.y = dequantPos(r.i16());
  e.z = dequantPos(r.i16());
  if (r.overran) return false;
  sink.onDamage?.(e);
  return true;
}

/** `Killed`: who killed whom with what, and the killer's remaining health (v15). */
function readKilledEvent(r: ByteReader, sink: EventSink): boolean {
  const e = killedScratch;
  e.targetId = r.u8v();
  e.sourceId = r.u8v();
  e.weaponIndex = r.u8v();
  e.zone = zoneAt(r.u8v());
  e.killerHealth = r.u8v();
  if (r.overran) return false;
  sink.onKilled?.(e);
  return true;
}

/** `Footstep`: where, on what, and how loudly. */
function readFootstepEvent(r: ByteReader, sink: EventSink): boolean {
  const e = footstepScratch;
  e.entityId = r.u8v();
  e.x = dequantPos(r.i16());
  e.y = dequantPos(r.i16());
  e.z = dequantPos(r.i16());
  e.material = r.u8v();
  const bits = r.u8v();
  e.heavy = (bits & 1) !== 0;
  e.quiet = (bits & 2) !== 0;
  if (r.overran) return false;
  sink.onFootstep?.(e);
  return true;
}

/** `Jump` and `Land`: the same record, told apart by the id that preceded it. */
function readPoseEvent(r: ByteReader, sink: EventSink, isJump: boolean): boolean {
  const e = poseScratch;
  e.entityId = r.u8v();
  e.x = dequantPos(r.i16());
  e.y = dequantPos(r.i16());
  e.z = dequantPos(r.i16());
  e.speed = r.u8v() / 10;
  e.material = r.u8v();
  if (r.overran) return false;
  if (isJump) sink.onJump?.(e);
  else sink.onLand?.(e);
  return true;
}
//#endregion
