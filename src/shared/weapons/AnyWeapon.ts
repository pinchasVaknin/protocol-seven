import { streakWeaponDef } from '../streaks/StreakWeapons';
import { WEAPON_DEFS, type WeaponDef } from './WeaponDefs';

/**
 * Any weapon a *fired shot* can name: the loadout catalogue, then the killstreaks'.
 *
 * There are two catalogues on purpose. `WEAPON_DEFS` is what a player can equip — it carries
 * unlocks and attachment slots, three audits walk it expecting exactly the shipped twelve, and
 * the pickers are built from it. A sentry's burst and a minigun's belt are weapons in every
 * sense the damage path cares about and in none of the senses that table exists for.
 *
 * The seam between them was invisible until a killstreak weapon reached a *player's*
 * `WeaponSystem` (2026-09-26). `MatchFeedback` resolves the id on every `WeaponFired` to get a
 * muzzle flash and a gunshot, and it **throws** on a miss, deliberately: the id is taken from a
 * def by every emitter, so an unknown one is a programming error rather than a case to fall
 * back from. That reasoning was right and its lookup was half the catalogue — the first minigun
 * shot threw inside `EventBus.emit`, which aborted the rest of that simulation tick, every tick
 * a round left the barrel. The bots stopped stepping, the weapon fired at a round a second, and
 * none of it looked like a missing table.
 *
 * So this is the lookup for anything that resolves an id **off an event**. Code that means the
 * loadout — a picker, an unlock, a camo — should keep reading `WEAPON_DEFS` and keep being
 * unable to see a streak weapon.
 */
export function anyWeaponDef(id: string): WeaponDef | undefined {
  return WEAPON_DEFS[id] ?? streakWeaponDef(id);
}
