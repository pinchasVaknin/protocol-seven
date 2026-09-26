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
export const STREAK_WEAPON_IDS: readonly string[] = [
  'streak_mortar',
  'streak_sentry',
  'streak_chopper',
  'streak_minigun',
];

/**
 * Every streak weapon that has been built, by id — the second half of the catalogue.
 *
 * `WEAPON_DEFS` is the *loadout* table and these are deliberately not in it: they have no
 * unlock, no attachments, no place in a picker, and three audits walk that table expecting
 * exactly the twelve weapons a player can equip. But a `WeaponFired` event names the def that
 * fired it, and `MatchFeedback` resolves that id to get a muzzle flash and a gunshot — so a
 * reader of the event needs a lookup that spans both catalogues, which is `anyWeaponDef`.
 *
 * Filled by `synthetic`, which every streak weapon is built through, and that is what makes it
 * complete rather than merely populated: an id can only reach an event by way of a def, and a
 * def can only exist by way of this function. A streak weapon that has never been built has
 * never fired.
 */
const BY_ID = new Map<string, WeaponDef>();

/** A streak weapon by id, or undefined. See `BY_ID`. */
export function streakWeaponDef(id: string): WeaponDef | undefined {
  return BY_ID.get(id);
}

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
  BY_ID.set(id, def);
  return def;
}

let minigun: WeaponDef | null = null;
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

/**
 * The weapon a streak puts in its owner's hands, or null for every streak that is not carried.
 *
 * **One table, read by both runtimes and by the thing that builds the streak.** The server and a
 * solo client resolve it from their own live `StreakSystem`; a networked client resolves it from
 * the replicated entity list, where all it has is a kind index. Two spellings of "a minigun
 * streak means the minigun" is two rules, and the second one is the one that gets forgotten when
 * a third carried weapon arrives.
 */
export function carriedStreakWeapon(streakId: string): WeaponDef | null {
  return streakId === 'minigun' ? minigunWeapon() : null;
}

/**
 * The first streak weapon a **player holds** rather than one a machine fires for them.
 *
 * Which changes what the numbers have to answer for. A sentry's def is read once per burst by a
 * turret with its own arc and its own aim tier; this one goes through `WeaponSystem` in a human's
 * hands, with their spread, their recoil, their reload — so every field that was left at the
 * carbine's default because nothing consulted it is now a feel decision.
 *
 * **The weight is in the handling, not in a speed penalty.** There is no per-weapon movement
 * multiplier in `WeaponDef` and `controller.speedScale` belongs to the perks, which both
 * runtimes set from `PerkState`; adding a second writer to it is a divergence waiting for a
 * missed tick. What a minigun *can* say through the fields that already exist is that it takes
 * 1.1 s to bring up — the spin, felt as a raise — that it cannot be aimed down (there are no
 * sights on it), that it kicks twice as hard as a rifle and sprays four times as wide, and that
 * it is never reloaded: `reserveAmmo` is zero, so the belt is the whole streak.
 *
 * 200 rounds at 900 rpm is thirteen seconds of held trigger inside a thirty-second streak, which
 * is the trade: the belt runs out before the clock does unless it is fired in bursts.
 */
export function minigunWeapon(): WeaponDef {
  if (minigun !== null) return minigun;
  const def = synthetic('streak_minigun', 'MINIGUN', 34, 1.2);
  def.damage.near = 34;
  def.damage.far = 24;
  def.damageFalloff.start = 22;
  def.damageFalloff.end = 48;
  def.rpm = 900;
  def.magSize = 200;
  // No reload: a belt-fed streak weapon that could be topped up would outlive its own clock.
  def.reserveAmmo = 0;
  def.reloadTime = 0;
  def.reloadEmptyTime = 0;
  // The spin-up, expressed as the thing that already gates firing: a weapon at raise < 1
  // cannot fire, and `swapInTime` is how long it takes to get there.
  def.swapInTime = 1.1;
  def.swapOutTime = 0.5;
  def.sprintOutTime = 0.45;
  // No sights. `adsTime` is left alone so nothing divides by zero; the sights simply do
  // nothing for it, which is what `adsFovScale` at 1 means.
  def.adsFovScale = 1;
  def.adsViewmodelFovScale = 1;
  def.spread.hipStand = def.spread.hipStand * 2.2;
  def.spread.hipMove = def.spread.hipMove * 2.2;
  def.spread.ads = def.spread.hipStand;
  def.spread.perShot = def.spread.perShot * 1.6;
  def.spread.perShotMax = def.spread.perShotMax * 1.8;
  def.recoil.verticalScale = def.recoil.verticalScale * 1.9;
  def.recoil.horizontalScale = def.recoil.horizontalScale * 2.1;
  def.recoil.adsScale = 1;
  def.shakePerShot = def.shakePerShot * 1.6;
  def.muzzleFlashScale = def.muzzleFlashScale * 1.5;
  def.tracerFraction = 0.5;
  def.penetration = def.penetration * 1.4;
  minigun = def;
  return minigun;
}
