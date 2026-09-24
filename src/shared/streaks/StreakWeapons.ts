import { AR_DEFAULT, cloneWeaponDef, type WeaponDef } from '../weapons/WeaponDefs';

/**
 * Weapons that belong to killstreaks rather than to a player (M7).
 *
 * `DamageSystem.apply` takes a `DamageRequest`, and a request carries a `WeaponDef` because
 * that is where falloff, zone multipliers and the killfeed's weapon name live. A mortar shell
 * and a sentry burst are not weapons anybody carries, but they still have to answer those
 * questions — so they get real defs rather than a special case in the damage path.
 *
 * Built by cloning the carbine and overriding what matters. That is deliberate rather than
 * lazy: it guarantees every field a `WeaponDef` is required to have is present and sane, so
 * adding a field to the schema cannot leave a streak weapon half-initialised.
 *
 * Each is built once for the process. They are read-only in practice — nothing resolves
 * attachments against them — so sharing one object across every sentry on the map is safe.
 */

/**
 * The prefix every streak weapon id carries, and the reason it is a constant.
 *
 * `MatchLedger` already keys the same kind of decision off `'eq_'` — a grenade kill is not a
 * kill with whatever was in your hands — and a sentry burst is the same statement about a
 * different machine. Two readers spelling `'streak_'` themselves is two places for a rename
 * to go half-done, so the prefix lives here, next to the three ids that use it.
 */
export const STREAK_WEAPON_PREFIX = 'streak_';

/** Whether a weapon id belongs to a killstreak rather than to anybody's loadout. */
export function isStreakWeapon(weaponId: string): boolean {
  return weaponId.startsWith(STREAK_WEAPON_PREFIX);
}

/**
 * The short word the killfeed puts beside the killer's name — `SENTRY`, `MORTAR`, `CHOPPER`.
 *
 * Derived from the id rather than from the def, because the defs are built with a damage
 * number the feed has no business asking for, and `sentryWeapon(0)` to read a name would
 * rewrite the shared singleton's damage on the way past.
 */
export function streakWeaponTag(weaponId: string): string {
  if (!isStreakWeapon(weaponId)) return '';
  return weaponId.slice(STREAK_WEAPON_PREFIX.length).toUpperCase();
}

/** Every streak weapon id, in a fixed order. The wire's weapon table appends these. */
export const STREAK_WEAPON_IDS: readonly string[] = ['streak_mortar', 'streak_sentry', 'streak_chopper'];

function synthetic(id: string, name: string, damage: number, headshotMult: number): WeaponDef {
  const def = cloneWeaponDef(AR_DEFAULT);
  def.id = id;
  def.name = name;
  def.damage.near = damage;
  def.damage.far = damage;
  def.headshotMult = headshotMult;
  def.limbMult = 1;
  // No distance term of their own: the mortar applies a radial falloff through
  // `penetrationRetain`, and a sentry's shots are already range-limited by its own arc.
  def.damageFalloff.start = 1000;
  def.damageFalloff.end = 1001;
  return def;
}

let mortar: WeaponDef | null = null;
let sentry: WeaponDef | null = null;
let chopper: WeaponDef | null = null;

/** Flat damage, no falloff. The blast radius is the only distance term. */
export function mortarWeapon(damage: number): WeaponDef {
  if (mortar === null) mortar = synthetic('streak_mortar', 'MORTAR', damage, 1);
  mortar.damage.near = damage;
  mortar.damage.far = damage;
  return mortar;
}

/** A sentry hits a head no harder than a chest: it is a turret, not a marksman. */
export function sentryWeapon(damage: number): WeaponDef {
  if (sentry === null) sentry = synthetic('streak_sentry', 'SENTRY GUN', damage, 1.15);
  sentry.damage.near = damage;
  sentry.damage.far = damage;
  return sentry;
}

export function chopperWeapon(damage: number): WeaponDef {
  if (chopper === null) chopper = synthetic('streak_chopper', 'CHOPPER GUNNER', damage, 1.25);
  chopper.damage.near = damage;
  chopper.damage.far = damage;
  return chopper;
}
