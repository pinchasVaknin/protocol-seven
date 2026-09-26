import { DT } from '../core/Loop';
import { registerWeaponDef } from '../weapons/AnyWeapon';
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
  'streak_flamethrower',
  'streak_burn',
];

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
  // The one place a streak weapon is built is the one place it is catalogued. See `anyWeaponDef`.
  registerWeaponDef(def);
  return def;
}

let minigun: WeaponDef | null = null;
let flamethrower: WeaponDef | null = null;
let burn: WeaponDef | null = null;
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
  if (streakId === 'minigun') return minigunWeapon();
  if (streakId === 'flamethrower') return flamethrowerWeapon();
  return null;
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

/**
 * The second carried streak, and the first weapon in the game that is not a ray.
 *
 * ## What the numbers are trying to be
 *
 * A flamethrower is an **area denial** weapon, not a duel weapon, and every figure here is
 * chosen to keep it on that side of the line. Nine metres is short enough that crossing a lane
 * to use it is a decision; the 16-degree half-angle is wide enough to hold a doorway and too
 * narrow to sweep a room from its middle. Falloff runs from five metres to nine, so the tip of
 * the jet is a *threat* and the root of it is lethal — the same shape a shotgun has, expressed
 * through the term `damageAtRange` already applies.
 *
 * Ten fuel a second at 7 damage each is 70 a second in contact, so a body held in the jet for
 * a second and a half is dead. Half a second of contact is 35 and does **not** kill: what
 * follows them out is the burn, three seconds at 8 a second, which is another 24 and still not
 * lethal on its own. That gap is deliberate and is the whole balance of the weapon — brushing
 * the edge of a jet costs a player most of their health and leaves them alive to make a
 * decision about it, and a second in the middle of one does not.
 *
 * No headshot: fire does not care where it lands, and a headshot multiplier on a cone that
 * cannot be aimed at a head would be a coin toss the player has no say in. No penetration, for
 * the reason the cone tests line of sight at all — flame goes around corners in no engine worth
 * shipping, and through none of the walls here.
 *
 * 150 fuel is fifteen seconds of held trigger inside a twenty-five second streak: the same
 * trade the minigun's belt makes, at the other end of the range band.
 */
export function flamethrowerWeapon(): WeaponDef {
  if (flamethrower !== null) return flamethrower;
  const def = synthetic('streak_flamethrower', 'FLAMETHROWER', 7, 1);
  def.damage.near = 7;
  def.damage.far = 3;
  def.damageFalloff.start = 5;
  def.damageFalloff.end = 9;
  def.limbMult = 1;
  def.upperTorsoMult = 1;
  def.rpm = 600;
  def.magSize = 150;
  def.reserveAmmo = 0;
  def.reloadTime = 0;
  def.reloadEmptyTime = 0;
  def.swapInTime = 0.7;
  def.swapOutTime = 0.4;
  def.sprintOutTime = 0.35;
  def.adsFovScale = 1;
  def.adsViewmodelFovScale = 1;
  def.penetration = 0;
  // Nothing about a jet is a bullet: no tracer, no spread cone to widen, and a kick that is
  // pressure rather than recoil.
  def.tracerFraction = 0;
  def.pellets = 1;
  def.recoil.verticalScale = def.recoil.verticalScale * 0.25;
  def.recoil.horizontalScale = def.recoil.horizontalScale * 0.25;
  def.shakePerShot = def.shakePerShot * 0.3;
  def.muzzleFlashScale = def.muzzleFlashScale * 0.8;
  def.flame = {
    rangeM: 9,
    halfAngleDeg: 16,
    burnSeconds: 3,
    burnDps: 8,
  };
  /**
   * The voice, because ten of these leave the barrel every second.
   *
   * A carbine's crack at 10 Hz is a machine gun, and this is a jet: the body of the sound drops
   * to a low roar, the click that makes a rifle sound like a rifle goes to almost nothing, and
   * the tail is long and wet so the ticks run together into one continuous sound rather than
   * arriving as ten separate shots. Synthesis rather than a sample, like every other weapon
   * here — `engine/WeaponAudio` builds all of them from these numbers.
   */
  def.voice.level = def.voice.level * 0.45;
  def.voice.bodyFreq = 150;
  def.voice.bodyQ = 1.1;
  def.voice.bodyDecay = 0.16;
  def.voice.bodyRatio = 0.7;
  def.voice.clickFreq = 900;
  def.voice.clickLevel = def.voice.clickLevel * 0.15;
  def.voice.thumpFreq = 70;
  def.voice.thumpLevel = def.voice.thumpLevel * 0.5;
  def.voice.tailDecay = 0.34;
  def.voice.tailLevel = def.voice.tailLevel * 1.4;
  def.voice.tailFreq = 1100;
  def.voice.wet = Math.min(1, def.voice.wet * 1.6);
  flamethrower = def;
  return flamethrower;
}

/**
 * What the fire itself kills with, after the jet has stopped.
 *
 * A weapon of its own rather than the flamethrower's def with the numbers swapped, and the
 * reason is that these defs are **process-wide singletons**: borrowing one for a tick and
 * putting its damage back is a mutation two systems can race over, and it is the kind that
 * shows up as one wrong number in a killfeed a week later. So the burn gets its own id, its own
 * entry in the wire table, and its own damage — which is a *per-tick* figure, `burnDps * DT`,
 * because `DamageSystem` applies what the def says and the burn is applied every tick.
 *
 * It also reads better: a player killed by a burn sees `[BURNING]` rather than a flamethrower
 * they walked away from two seconds ago.
 *
 * Derived from the flamethrower's own profile so the two cannot drift. A second flame weapon
 * with a different `burnDps` would need a def per figure; there is one, and this is that one.
 */
export function burnWeapon(): WeaponDef {
  if (burn !== null) return burn;
  const profile = flamethrowerWeapon().flame;
  const perTick = (profile?.burnDps ?? 0) * DT;
  const def = synthetic('streak_burn', 'BURNING', perTick, 1);
  def.damage.near = perTick;
  def.damage.far = perTick;
  def.limbMult = 1;
  def.upperTorsoMult = 1;
  burn = def;
  return burn;
}
