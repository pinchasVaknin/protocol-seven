/**
 * The six words the whole simulation is written in, at the bottom of it.
 *
 * `core/Events.ts` used to import all six **upward** — `BotTeam` from `ai/Combatant`, `BotTier`
 * from `ai/DifficultyTiers`, `BotState` from `ai/BotStates`, `HitZone` from `combat/HitboxRig`,
 * `StanceId` from `player/Stance` and `WeaponSlot` from `weapons/WeaponDefs` — so the foundation
 * every other partition sits on could not be loaded or reasoned about without `ai`, `combat`,
 * `player` and `weapons` above it (BACKLOG #2, which absorbed #19; closed 2026-11-22).
 *
 * #19 was the same defect from the other end: the vocabulary those types belong to lived in a
 * leaf. Both halves are one move, and this is it.
 *
 * ## What is here and what is deliberately not
 *
 * **Only the words.** A string-literal union naming the legal values of something, nothing that
 * does anything with them. The lists, the transition tables and the per-value data stay where
 * the behaviour is: `BOT_STATES` and its legal-edge table in `ai/BotStates`, `BOT_TIERS` and its
 * `TierTable` in `ai/DifficultyTiers`, `STANCES` and its edges in `player/Stance`, the rig in
 * `combat/HitboxRig`. Each of those is `satisfies` the union here or keyed by a
 * `Record<union, …>`, so the list and the word cannot drift apart in either direction without a
 * compile error.
 *
 * **`Combatant` is not here.** The entry called its address wrong and it is staying in
 * `shared/ai/Combatant.ts` on purpose: it extends `Damageable`, which lives in
 * `combat/DamageSystem`, so bringing it down would bring that with it — a much larger move with
 * no bearing on the defect above. Its own file comment explains why it is the right
 * abstraction; only `BotTeam` had the wrong address, and `BotTeam` is here.
 *
 * ## What this file makes legal
 *
 * Two deliberate workarounds the project had already paid for, both now gone:
 * `DamageSystem.Damageable.team` and `combat/Hostility` were written against the literal union
 * `'A' | 'B'` rather than `BotTeam`, each with a comment saying `combat/` sits below `ai/` and
 * must not depend upward on it. They read `BotTeam` from here now, because here is below both.
 *
 * `check-boundaries.mjs` enforces the layering inside `shared/` as of the same change, so the
 * next upward import fails the gate rather than going in unnoticed. That rule is most of this
 * entry's value: the six imports above were each individually reasonable when they were written.
 */

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * Which side a body is on.
 *
 * Two letters and no more: every mode in the game is either two teams or a free-for-all keyed on
 * entity id, and a third team would be a mode, not a value.
 */
export type BotTeam = 'A' | 'B';

/**
 * A bot's difficulty tier (brief S6.7).
 *
 * The per-tier numbers — reaction, accuracy cone, convergence, push aggression, peek frequency —
 * are `ai/DifficultyTiers`' `TierTable`, and health is deliberately not among them.
 */
export type BotTier = 'RECRUIT' | 'REGULAR' | 'HARDENED' | 'VETERAN';

/**
 * A bot's state (brief S6.2). The legal edges between them are `ai/BotStates`' own table.
 *
 * Every state can die, and only DEAD leads back to IDLE, which is what makes a respawn the
 * single door back into the machine.
 */
export type BotState =
  | 'IDLE'
  | 'PATROL'
  | 'INVESTIGATE'
  | 'ENGAGE'
  | 'SUPPRESS'
  | 'RELOAD'
  | 'SEEK_COVER'
  | 'FLANK'
  | 'PUSH'
  | 'OBJECTIVE'
  | 'DEAD';

/** Which part of a body a shot landed in. The boxes themselves are `combat/HitboxRig`'s rig. */
export type HitZone = 'head' | 'torso' | 'arm' | 'leg';

/**
 * How a body is standing. The legal edges between stances are `player/Stance`'s own table.
 *
 * `MANTLE` and `SLIDE` are stances rather than flags for the reason that file gives: a state a
 * body can be in belongs in the one place that says which states it can reach.
 */
export type StanceId = 'STAND' | 'CROUCH' | 'SLIDE' | 'AIRBORNE' | 'MANTLE';

/** Which inventory slot a weapon occupies (S6.4). */
export type WeaponSlot = 'primary' | 'secondary';
//#endregion
