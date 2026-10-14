/**
 * The player's class on the wire, as ids and nothing else (Tier 1 #20, rule 1).
 *
 * One body, two messages: `Hello` carries it so the seat is configured inside the handshake,
 * and `Loadout` carries it on its own for a change mid-connection. They share this codec so
 * the two cannot encode a class differently — see `writeLoadoutBody`.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { BAD, head, type BadFrame } from './MessageFrame';
import { MsgC } from './Protocol';
import type { NetLoadout, NetWeaponLoadout } from './Skirmish';
import type { ByteReader, ByteWriter } from './Wire';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/** A class that arrived on its own. Structurally decoded; `sanitiseNetLoadout` judges the ids. */
export type DecodedLoadout = { kind: 'loadout'; loadout: NetLoadout };
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Longest id list any message may carry. Covers five attachments with room to spare. */
const MAX_ID_LIST = 8;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * The player's class, as ids (Tier 1 #20, rule 1).
 *
 * Nothing resolved crosses this wire: no damage number, no recoil value, no speed multiplier.
 * The server looks every id up in the same registry the client did and runs the same
 * `resolveLoadout`, so the two sides cannot disagree about what a class *does* while agreeing
 * about what it contains.
 */
export function writeLoadout(w: ByteWriter, loadout: NetLoadout): Uint8Array {
  head(w, MsgC.Loadout);
  writeLoadoutBody(w, loadout);
  return w.bytes();
}

/** A class changed mid-connection. */
export function decodeLoadout(r: ByteReader): DecodedLoadout | BadFrame {
  const name = r.str();
  const primary = readWeaponLoadout(r);
  const secondary = readWeaponLoadout(r);
  const lethal = r.str();
  const tactical = r.str();
  const fieldUpgrade = r.str();
  const perks = readIdList(r);
  const streaks = readIdList(r);
  if (r.overran) return BAD;
  // Structurally decoded only. `sanitiseNetLoadout` is what decides whether any of these
  // ids are *real*, and it is deliberately a separate step: decoding is about bytes and
  // validation is about meaning, and folding them together is how a decoder ends up
  // throwing on a name it does not recognise (S4.16).
  return {
    kind: 'loadout',
    loadout: { name, primary, secondary, lethal, tactical, fieldUpgrade, perks, streaks },
  };
}

/** The class's body, shared by `Hello` and `Loadout` so the two cannot encode it differently. */
export function writeLoadoutBody(w: ByteWriter, loadout: NetLoadout): void {
  w.str(loadout.name);
  writeWeaponLoadout(w, loadout.primary);
  writeWeaponLoadout(w, loadout.secondary);
  w.str(loadout.lethal);
  w.str(loadout.tactical);
  w.str(loadout.fieldUpgrade);
  writeIdList(w, loadout.perks);
  writeIdList(w, loadout.streaks);
}

export function readLoadoutBody(r: ByteReader): NetLoadout {
  const name = r.str();
  const primary = readWeaponLoadout(r);
  const secondary = readWeaponLoadout(r);
  const lethal = r.str();
  const tactical = r.str();
  const fieldUpgrade = r.str();
  const perks = readIdList(r);
  const streaks = readIdList(r);
  return { name, primary, secondary, lethal, tactical, fieldUpgrade, perks, streaks };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function writeWeaponLoadout(w: ByteWriter, weapon: NetWeaponLoadout): void {
  w.str(weapon.weaponId);
  w.str(weapon.camo ?? '');
  writeIdList(w, weapon.attachments);
}

function readWeaponLoadout(r: ByteReader): NetWeaponLoadout {
  const weaponId = r.str();
  const camo = r.str();
  const attachments = readIdList(r).filter((a): a is string => a !== null);
  return { weaponId, camo: camo === '' ? null : camo, attachments };
}

function writeIdList(w: ByteWriter, ids: readonly (string | null)[]): void {
  const capped = Math.min(ids.length, MAX_ID_LIST);
  w.u8v(capped);
  for (let i = 0; i < capped; i++) w.str(ids[i] ?? '');
}

function readIdList(r: ByteReader): Array<string | null> {
  const count = r.u8v();
  const out: Array<string | null> = [];
  // Capped before the loop, so a claimed length of 200 cannot make the server allocate 200
  // strings before the reader notices it has run out of bytes (S4.16).
  if (count > MAX_ID_LIST) return out;
  for (let i = 0; i < count; i++) {
    const id = r.str();
    out.push(id === '' ? null : id);
  }
  return out;
}
//#endregion
