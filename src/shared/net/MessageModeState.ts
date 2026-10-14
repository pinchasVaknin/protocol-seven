/**
 * What a mode replicates every tick it is running: zones, dog tags, the bomb, killstreaks,
 * grenades in flight, the cheat answer and the §7 hash.
 *
 * The cadence here is the snapshot's, not the match's, and every list in it is capped: a count
 * past its cap is a malformed frame and is refused before anything is allocated against it
 * (S4.16). The caps themselves live in `Skirmish.ts`, with the states they bound.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { CHEAT_CODE_MAX } from '../cheats/Cheats';
import type { BombInfo, TagInfo } from '../modes/GameMode';
import { BAD, head, type BadFrame } from './MessageFrame';
import {
  dequantAngle,
  dequantPitch,
  dequantPos,
  MsgC,
  MsgS,
  quantAngle,
  quantPitch,
  quantPos,
} from './Protocol';
import {
  BOMB_CARRIED,
  BOMB_DEFUSED,
  BOMB_EXPLODED,
  BOMB_PLANTED,
  MAX_OBJECTIVES,
  MAX_PROJECTILES,
  MAX_SMOKE,
  MAX_STREAK_ENTITIES,
  MAX_STREAK_OFFERS,
  MAX_TAGS,
  MAX_UAV_CONTACTS,
  OBJ_TEAM_A,
  OBJ_TEAM_B,
  type ObjectiveState,
  type ProjectileState,
  type SmokeState,
  type StreakEntityState,
  type StreakOfferState,
  type StreakView,
  type UavContactState,
} from './Skirmish';
import type { ByteReader, ByteWriter } from './Wire';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** What a running mode replicates. */
export type DecodedModeState =
  | { kind: 'objectives'; states: readonly ObjectiveState[] }
  | { kind: 'tags'; tags: readonly TagInfo[] }
  | { kind: 'bomb'; bomb: BombInfo }
  | { kind: 'streaks'; view: StreakView }
  | {
      kind: 'projectiles';
      projectiles: readonly ProjectileState[];
      smoke: readonly SmokeState[];
    }
  | { kind: 'streakRequest'; streakKind: number; x: number; z: number }
  | { kind: 'cheatRequest'; code: string }
  | { kind: 'cheats'; outcome: number; mask: number }
  | { kind: 'stateHash'; tick: number; hash: number; sections: number[] };
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Objective state, one record per zone in the mode's own order (M11 Gate B, §6.8).
 *
 * Four bytes a zone: owner and capturing team packed into one, progress as a byte, and the two
 * body counts. The counts are what the HUD's contested indicator reads, and §6.8 requires
 * contested state not to flicker under jitter — sending the counts rather than a derived
 * boolean means the client renders exactly what the server counted rather than re-deriving it
 * from a position list that is 100 ms in the past.
 */
export function writeObjectives(w: ByteWriter, states: readonly ObjectiveState[]): Uint8Array {
  head(w, MsgS.Objectives);
  const n = Math.min(states.length, MAX_OBJECTIVES);
  w.u8v(n);
  for (let i = 0; i < n; i++) {
    const o = states[i];
    if (o === undefined) continue;
    // Owner in the low two bits, capturing team in the next two. Both are 0-2.
    w.u8v((o.owner & 0x03) | ((o.capturing & 0x03) << 2));
    w.u8v(o.progress);
    w.u8v(Math.min(255, o.countA));
    w.u8v(Math.min(255, o.countB));
  }
  return w.bytes();
}

/** Every zone's owner, progress and body counts. */
export function decodeObjectives(r: ByteReader): DecodedModeState | BadFrame {
  const n = r.u8v();
  if (r.overran || n > MAX_OBJECTIVES) return BAD;
  const states: ObjectiveState[] = [];
  for (let i = 0; i < n; i++) {
    const packed = r.u8v();
    const progress = r.u8v();
    const countA = r.u8v();
    const countB = r.u8v();
    states.push({ owner: packed & 0x03, capturing: (packed >> 2) & 0x03, progress, countA, countB });
  }
  return r.overran ? BAD : { kind: 'objectives', states };
}

/**
 * Kill Confirmed's dog tags (M11 Gate B, §6.8).
 *
 * Seven bytes a tag: a `uint16` id and three quantised `int16` positions. The id wraps at 65535
 * and is compared for equality only, never ordered, so a match long enough to drop that many
 * tags reuses an id that has been off the floor for hours.
 *
 * **The newest tags win when the list overflows.** A tag near the end of its 20 s life is the
 * one whose absence a player is least likely to notice, and the one most likely to be gone
 * before the next frame anyway; a tag that landed this tick is on a body somebody is standing
 * over. Truncating the front rather than the back is the difference between a cap that degrades
 * and a cap that hides exactly the tags being fought over.
 */
export function writeTags(w: ByteWriter, tags: readonly TagInfo[]): Uint8Array {
  head(w, MsgS.Tags);
  const skip = Math.max(0, tags.length - MAX_TAGS);
  const n = Math.min(tags.length, MAX_TAGS);
  w.u8v(n);
  for (let i = skip; i < tags.length; i++) {
    const t = tags[i];
    if (t === undefined) continue;
    w.u16(t.id & 0xffff);
    w.u8v(t.team === 'B' ? OBJ_TEAM_B : OBJ_TEAM_A);
    w.i16(quantPos(t.x));
    w.i16(quantPos(t.y));
    w.i16(quantPos(t.z));
  }
  return w.bytes();
}

/** Kill Confirmed's tags on the floor. */
export function decodeTags(r: ByteReader): DecodedModeState | BadFrame {
  const n = r.u8v();
  // A count past the cap is a malformed frame, not a big match. S4.16: drop it, never
  // allocate against a number a client controls.
  if (r.overran || n > MAX_TAGS) return BAD;
  const tags: TagInfo[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.u16();
    const team = r.u8v() === OBJ_TEAM_B ? 'B' : 'A';
    const x = dequantPos(r.i16());
    const y = dequantPos(r.i16());
    const z = dequantPos(r.i16());
    tags.push({ id, team, x, y, z });
  }
  return r.overran ? BAD : { kind: 'tags', tags };
}

/**
 * Search & Destroy's bomb (M11 Gate B, §6.8).
 *
 * The fuse travels as hundredths of a second in a `uint16` — 655 s of range against a 45 s
 * timer, and a hundredth is finer than the one-decimal HUD readout. It is **not** sent as a
 * tick count: the client would have to hold the tick rate and the round's start tick to read
 * it, which is three facts where one will do.
 */
export function writeBomb(w: ByteWriter, info: BombInfo): Uint8Array {
  head(w, MsgS.Bomb);
  w.u8v(bombStateCode(info.state));
  w.i16(info.carrierId);
  w.u8v(info.attackers === 'B' ? OBJ_TEAM_B : OBJ_TEAM_A);
  w.i16(quantPos(info.x));
  w.i16(quantPos(info.y));
  w.i16(quantPos(info.z));
  w.u16(Math.max(0, Math.min(0xffff, Math.round(info.secondsLeft * 100))));
  w.u8v(Math.max(0, Math.min(255, Math.round(info.interactFraction * 255))));
  w.i16(info.interactEntity);
  w.i8(info.plantedSiteIndex);
  return w.bytes();
}

/** Search & Destroy's bomb. */
export function decodeBomb(r: ByteReader): DecodedModeState | BadFrame {
  const state = bombStateFromCode(r.u8v());
  const carrierId = r.i16();
  const attackers = r.u8v() === OBJ_TEAM_B ? 'B' : 'A';
  const x = dequantPos(r.i16());
  const y = dequantPos(r.i16());
  const z = dequantPos(r.i16());
  const secondsLeft = r.u16() / 100;
  const interactFraction = r.u8v() / 255;
  const interactEntity = r.i16();
  const plantedSiteIndex = r.i8();
  return r.overran
    ? BAD
    : {
        kind: 'bomb',
        bomb: {
          state,
          carrierId,
          attackers,
          x,
          y,
          z,
          secondsLeft,
          interactFraction,
          interactEntity,
          plantedSiteIndex,
        },
      };
}

/**
 * Exported so the §7 hash encodes a bomb state the same way the wire does.
 *
 * Two spellings of "PLANTED is 1" is two places to get it wrong, and the resulting mismatch
 * would look like a replication bug rather than a comparator bug.
 */
export function bombStateCode(state: BombInfo['state']): number {
  if (state === 'PLANTED') return BOMB_PLANTED;
  if (state === 'DEFUSED') return BOMB_DEFUSED;
  if (state === 'EXPLODED') return BOMB_EXPLODED;
  return BOMB_CARRIED;
}

/**
 * Everything one recipient is told about streaks (M11 Gate B, §6.8, §8.22).
 *
 * Encoded per seat, which is what makes the two private sections private — see `MsgS.Streaks`
 * and `StreakView`. The entity list is the same for everybody and simply rides along.
 */
export function writeStreaks(w: ByteWriter, view: StreakView): Uint8Array {
  head(w, MsgS.Streaks);

  // Four bytes per offer rather than one per held streak (round 4, B9 and the pivot). A price
  // list is bigger than an inventory and has to be: a client cannot decide what a key does, or
  // say why it did nothing, from a list of what it is allowed to press.
  const offers = Math.min(view.offers.length, MAX_STREAK_OFFERS);
  w.u8v(offers);
  for (let i = 0; i < offers; i++) {
    const o = view.offers[i];
    if (o === undefined) continue;
    w.u8v(o.kind & 0xff);
    w.u8v(Math.max(0, Math.min(255, o.price)));
    // Centiseconds in sixteen bits: the longest lockout in the table is a sentry's ninety
    // seconds plus the cooldown, which is 12000 and well inside it. Hundredths rather than
    // tenths because the fill is drawn every frame and a tenth of a second is a visible step.
    w.u16(Math.max(0, Math.min(0xffff, Math.round(o.lockoutCs))));
  }

  w.u8v(Math.max(0, Math.min(255, view.balance)));
  w.i8(view.nextKind);
  w.u8v(Math.max(0, Math.min(255, view.nextPrice)));
  // Sweep as a quantised angle with a sentinel: -1 means "your team has no UAV up", which is a
  // different statement from "the beam is at zero" and the minimap draws them differently.
  w.u8v(view.scrambled ? 1 : 0);
  w.u8v(view.sweepAngle < 0 ? 0 : 1);
  w.u16(view.sweepAngle < 0 ? 0 : quantAngle(view.sweepAngle));

  const contacts = Math.min(view.contacts.length, MAX_UAV_CONTACTS);
  w.u8v(contacts);
  for (let i = 0; i < contacts; i++) {
    const c = view.contacts[i];
    if (c === undefined) continue;
    w.i16(c.entityId);
    w.i16(quantPos(c.x));
    w.i16(quantPos(c.z));
    w.u16(Math.max(0, Math.min(0xffff, c.ageCs)));
  }

  const entities = Math.min(view.entities.length, MAX_STREAK_ENTITIES);
  w.u8v(entities);
  for (let i = 0; i < entities; i++) {
    const e = view.entities[i];
    if (e === undefined) continue;
    w.u16(e.instanceId & 0xffff);
    w.u8v(e.kind & 0xff);
    w.i16(e.ownerId);
    w.u8v(e.team & 0x03);
    w.i16(quantPos(e.x));
    w.i16(quantPos(e.y));
    w.i16(quantPos(e.z));
    w.u16(quantAngle(e.yaw));
    w.i16(quantPitch(e.pitch));
    w.u8v(Math.max(0, Math.min(255, e.health)));
    w.u8v(Math.max(0, Math.min(255, e.fraction)));
    w.u8v(e.flags & 0xff);
  }
  return w.bytes();
}

export function decodeStreaks(r: ByteReader): DecodedModeState | BadFrame {
  const offers = readStreakOffers(r);
  if (offers === null) return BAD;

  const balance = r.u8v();
  const nextKind = r.i8();
  const nextPrice = r.u8v();
  const scrambled = r.u8v() === 1;
  const hasSweep = r.u8v() === 1;
  const sweepRaw = r.u16();
  const sweepAngle = hasSweep ? dequantAngle(sweepRaw) : -1;

  const contacts = readUavContacts(r);
  if (contacts === null) return BAD;

  const entities = readStreakEntities(r);
  if (entities === null) return BAD;

  return r.overran
    ? BAD
    : {
        kind: 'streaks',
        view: {
          offers,
          balance,
          nextKind,
          nextPrice,
          scrambled,
          sweepAngle,
          contacts,
          entities,
        },
      };
}

/**
 * Grenades in flight and smoke on the ground (M11 Gate B, §6.8, §8.24).
 *
 * Positions to the centimetre like everything else in this file. A grenade is small and fast,
 * and 1 cm is well inside the radius of the mesh drawn at it — the visible error in a replicated
 * arc comes from the snapshot rate, not from the quantisation, and interpolating between two
 * 1 cm samples is exactly as smooth as interpolating between two exact ones.
 */
export function writeProjectiles(
  w: ByteWriter,
  projectiles: readonly ProjectileState[],
  smoke: readonly SmokeState[],
): Uint8Array {
  head(w, MsgS.Projectiles);
  const n = Math.min(projectiles.length, MAX_PROJECTILES);
  w.u8v(n);
  for (let i = 0; i < n; i++) {
    const p = projectiles[i];
    if (p === undefined) continue;
    w.u16(p.serial & 0xffff);
    w.u8v(p.kind & 0xff);
    w.i16(p.ownerId);
    w.i16(quantPos(p.x));
    w.i16(quantPos(p.y));
    w.i16(quantPos(p.z));
    w.u16(quantAngle(p.yaw));
    w.u8v(p.flags & 0xff);
  }

  const m = Math.min(smoke.length, MAX_SMOKE);
  w.u8v(m);
  for (let i = 0; i < m; i++) {
    const s = smoke[i];
    if (s === undefined) continue;
    w.i16(quantPos(s.x));
    w.i16(quantPos(s.y));
    w.i16(quantPos(s.z));
    // Radius in decimetres: a cloud is metres across and a centimetre of radius is not a thing
    // anybody can see, where a byte per cloud is a thing the bandwidth budget can.
    w.u8v(Math.max(0, Math.min(255, Math.round(s.radius * 10))));
    w.u16(Math.max(0, Math.min(0xffff, s.remainingDs)));
  }
  return w.bytes();
}

/** Grenades in flight and smoke on the ground. */
export function decodeProjectiles(r: ByteReader): DecodedModeState | BadFrame {
  const n = r.u8v();
  if (r.overran || n > MAX_PROJECTILES) return BAD;
  const projectiles: ProjectileState[] = [];
  for (let i = 0; i < n; i++) {
    const serial = r.u16();
    const kind = r.u8v();
    const ownerId = r.i16();
    const x = dequantPos(r.i16());
    const y = dequantPos(r.i16());
    const z = dequantPos(r.i16());
    const yaw = dequantAngle(r.u16());
    const flags = r.u8v();
    projectiles.push({ serial, kind, ownerId, x, y, z, yaw, flags });
  }

  const m = r.u8v();
  if (r.overran || m > MAX_SMOKE) return BAD;
  const smoke: SmokeState[] = [];
  for (let i = 0; i < m; i++) {
    const x = dequantPos(r.i16());
    const y = dequantPos(r.i16());
    const z = dequantPos(r.i16());
    const radius = r.u8v() / 10;
    const remainingDs = r.u16();
    smoke.push({ x, y, z, radius, remainingDs });
  }
  return r.overran ? BAD : { kind: 'projectiles', projectiles, smoke };
}

/**
 * "Spend this streak" (M11 Gate B, §8.22).
 *
 * The coordinates are the mortar's marked point and are meaningless for the other five, which
 * are placed at the player's own body. Sent anyway rather than conditionally, because five bytes
 * saved on a message a player sends at most three times a match is not worth a variable layout.
 */
export function writeStreakRequest(w: ByteWriter, kind: number, x: number, z: number): Uint8Array {
  head(w, MsgC.Streak);
  w.u8v(kind & 0xff);
  w.i16(quantPos(x));
  w.i16(quantPos(z));
  return w.bytes();
}

/** "Spend this streak", with the marked point. */
export function decodeStreakRequest(r: ByteReader): DecodedModeState | BadFrame {
  const streakKind = r.u8v();
  const x = dequantPos(r.i16());
  const z = dequantPos(r.i16());
  return r.overran ? BAD : { kind: 'streakRequest', streakKind, x, z };
}

/**
 * "I typed this cheat code" (playtest round 4, F14).
 *
 * The text, not a parsed id — see `MsgC.Cheat` for why the decision stays the server's. Refused
 * as malformed above `CHEAT_CODE_MAX` rather than truncated and compared: a code that arrives
 * cut short would be answered *"unknown code"*, which is a lie about a frame that was too long
 * rather than about a code that does not exist.
 */
export function writeCheatRequest(w: ByteWriter, code: string): Uint8Array {
  head(w, MsgC.Cheat);
  w.str(code.slice(0, CHEAT_CODE_MAX));
  return w.bytes();
}

/** "I typed this cheat code." */
export function decodeCheatRequest(r: ByteReader): DecodedModeState | BadFrame {
  const code = r.str();
  // Length is meaning, not shape, so it is refused here rather than clamped: an over-long
  // code is a client this server does not recognise, and §4.16 answers that at the boundary.
  if (r.overran || code.length > CHEAT_CODE_MAX) return BAD;
  return { kind: 'cheatRequest', code };
}

/** What the server decided about a code, and this seat's whole mask afterwards (F14). */
export function writeCheats(w: ByteWriter, outcome: number, mask: number): Uint8Array {
  head(w, MsgS.Cheats);
  w.u8v(outcome & 0xff);
  w.u8v(mask & 0xff);
  return w.bytes();
}

/** What the server decided about a code, and this seat’s mask. */
export function decodeCheats(r: ByteReader): DecodedModeState | BadFrame {
  const outcome = r.u8v();
  const mask = r.u8v();
  return r.overran ? BAD : { kind: 'cheats', outcome, mask };
}

/**
 * The §7 mode-state hash, the tick it describes, and its four parts (v26) — see
 * `hashModeStateSections`: the parts are what let a mismatch name the channel it is in.
 */
export function writeStateHash(w: ByteWriter, tick: number, hash: number, sections: readonly number[]): Uint8Array {
  head(w, MsgS.StateHash);
  w.i32(tick);
  w.u32(hash);
  for (let i = 0; i < 4; i++) w.u32(sections[i] ?? 0);
  return w.bytes();
}

/** The §7 mode-state hash and its four sections. */
export function decodeStateHash(r: ByteReader): DecodedModeState | BadFrame {
  const tick = r.i32();
  const hash = r.u32();
  const sections = [r.u32(), r.u32(), r.u32(), r.u32()];
  return r.overran ? BAD : { kind: 'stateHash', tick, hash, sections };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function bombStateFromCode(code: number): BombInfo['state'] {
  if (code === BOMB_PLANTED) return 'PLANTED';
  if (code === BOMB_DEFUSED) return 'DEFUSED';
  if (code === BOMB_EXPLODED) return 'EXPLODED';
  return 'CARRIED';
}

/**
 * The price list, or `null` for a count past the cap.
 *
 * Four bytes per offer rather than one per held streak (round 4, B9 and the pivot) — see
 * `writeStreaks` for why a price list is bigger than an inventory and has to be.
 */
function readStreakOffers(r: ByteReader): StreakOfferState[] | null {
  const offerCount = r.u8v();
  if (r.overran || offerCount > MAX_STREAK_OFFERS) return null;
  const offers: StreakOfferState[] = [];
  for (let i = 0; i < offerCount; i++) {
    const kind = r.u8v();
    const price = r.u8v();
    const lockoutCs = r.u16();
    offers.push({ kind, price, lockoutCs });
  }
  return offers;
}

/**
 * The UAV's contacts, or `null` for a count past the cap.
 *
 * A count past the cap is a malformed frame. S4.16: never allocate against a number the
 * other end controls, even when the other end is meant to be the server.
 */
function readUavContacts(r: ByteReader): UavContactState[] | null {
  const contactCount = r.u8v();
  if (r.overran || contactCount > MAX_UAV_CONTACTS) return null;
  const contacts: UavContactState[] = [];
  for (let i = 0; i < contactCount; i++) {
    const entityId = r.i16();
    const x = dequantPos(r.i16());
    const z = dequantPos(r.i16());
    const ageCs = r.u16();
    contacts.push({ entityId, x, z, ageCs });
  }
  return contacts;
}

/** Every streak body in the world, or `null` for a count past the cap. */
function readStreakEntities(r: ByteReader): StreakEntityState[] | null {
  const entityCount = r.u8v();
  if (r.overran || entityCount > MAX_STREAK_ENTITIES) return null;
  const entities: StreakEntityState[] = [];
  for (let i = 0; i < entityCount; i++) {
    const instanceId = r.u16();
    const kindIndex = r.u8v();
    const ownerId = r.i16();
    const team = r.u8v();
    const x = dequantPos(r.i16());
    const y = dequantPos(r.i16());
    const z = dequantPos(r.i16());
    const yaw = dequantAngle(r.u16());
    const pitch = dequantPitch(r.i16());
    const health = r.u8v();
    const fraction = r.u8v();
    const flags = r.u8v();
    entities.push({
      instanceId,
      kind: kindIndex,
      ownerId,
      team,
      x,
      y,
      z,
      yaw,
      pitch,
      health,
      fraction,
      flags,
    });
  }
  return entities;
}
//#endregion
