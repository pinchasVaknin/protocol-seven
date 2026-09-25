import { cosmeticVariantFor } from '../../shared/ai/BotVisualState';
import type { CharacterAnimationId } from './CharacterCatalog';

/**
 * Which variant of a slot a body wears (M13 Phase D).
 *
 * A slot with two idles or two sprints must not be drawn at random: two clients watching the
 * same body would see two different bodies, and a reconnect would change the one you were
 * looking at. So a variant is a pure function of facts every client already shares —
 *
 * - **locomotion** — `(entityId, spawnSerial)`: fixed for a life, re-dealt at the respawn;
 * - **flinches** — `(entityId, flinchSerial)`, had there been a flinch clip. There is not, and
 *   there is not going to be: the human's call (2026-09-25) is that the procedural lean in
 *   `CharacterAvatar.flinch` is the hit reaction. The pair is named here because the seed rule is
 *   the general one, not because a slot is waiting;
 * - **deaths** — the simulation's own `deathVariant`, already `(entityId, deathSerial)`
 *   through the same hash, indexed modulo the slot's count so the server and the procedural
 *   body agree with the skinned one.
 *
 * The slot id is folded into the seed so an actor's idle and its walk are dealt
 * independently rather than both landing on "the second one".
 */
export function variantFor(slot: CharacterAnimationId, entityId: number, serial: number, count: number): number {
  if (count <= 1) return 0;
  return cosmeticVariantFor(entityId ^ slotSalt(slot), serial, count);
}

/** FNV-1a over the slot id: a stable 32-bit salt per slot, computed once per call site. */
function slotSalt(slot: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < slot.length; i++) {
    hash ^= slot.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
