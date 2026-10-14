/**
 * The frame every message is wrapped in, and the one answer a bad frame ever gets.
 *
 * ```
 *   u32 MAGIC | u8 msgId | payload...
 * ```
 *
 * The magic costs four bytes per frame and buys a cheap, total rejection of anything that is
 * not this protocol — a stray HTTP request, a port scanner, an old client build. S4.16 wants
 * garbage to drop the connection rather than the process, and the earlier garbage is
 * recognised the less of it reaches a decoder.
 *
 * These two live on their own because they are the only things every message family shares:
 * each family writes its head through `head`, and each refuses a body it cannot read with
 * `BAD`. Nothing here knows about any individual message.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { MAGIC } from './Protocol';
import type { ByteWriter } from './Wire';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * A frame that is not ours, not whole, or not allowed.
 *
 * Its own type rather than a member of `Decoded`, so a family's decoder can declare that it
 * returns *its* messages or a refusal without naming every other family's.
 */
export type BadFrame = { kind: 'bad' };
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
export const BAD: BadFrame = { kind: 'bad' };
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function head(w: ByteWriter, id: number): void {
  w.reset();
  w.u32(MAGIC);
  w.u8v(id);
}
//#endregion
