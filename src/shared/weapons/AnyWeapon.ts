import { WEAPON_DEFS, type WeaponDef } from './WeaponDefs';

/**
 * Any weapon a *fired shot* can name: the loadout catalogue, plus whatever registered itself.
 *
 * There are two catalogues on purpose. `WEAPON_DEFS` is what a player can equip — it carries
 * unlocks and attachment slots, three audits walk it expecting exactly the shipped twelve, and
 * the pickers are built from it. A sentry's burst, a minigun's belt and a burn are weapons in
 * every sense the damage path cares about and in none of the senses that table exists for.
 *
 * The seam between them was invisible until a killstreak weapon reached a *player's*
 * `WeaponSystem` (2026-09-26). `MatchFeedback` resolves the id on every `WeaponFired` to get a
 * muzzle flash and a gunshot, and it **throws** on a miss, deliberately: the id is taken from a
 * def by every emitter, so an unknown one is a programming error rather than a case to fall
 * back from. That reasoning was right and its lookup was half the catalogue — the first minigun
 * shot threw inside `EventBus.emit`, which aborted the rest of that simulation tick, every tick
 * a round left the barrel.
 *
 * **Registered rather than imported**, so this module stays below the ones that build the other
 * defs: `streaks/` depends on `weapons/` and not the other way about, which is the same rule
 * that keeps `combat/` from reaching up into `ai/`. `StreakWeapons.synthetic` is the one place a
 * streak weapon is built, so registering there is what makes this complete rather than merely
 * populated — an id can only reach an event by way of a def, and that def came through here.
 *
 * Code that means the *loadout* — a picker, an unlock, a camo — should keep reading
 * `WEAPON_DEFS` and keep being unable to see any of this.
 */
const REGISTERED = new Map<string, WeaponDef>();

/** Add a def that is not in the loadout table. Called by whatever builds one. */
export function registerWeaponDef(def: WeaponDef): void {
  REGISTERED.set(def.id, def);
}

export function anyWeaponDef(id: string): WeaponDef | undefined {
  return WEAPON_DEFS[id] ?? REGISTERED.get(id);
}
