import { DT } from '../core/Loop';
import { registerWeaponDef } from '../weapons/AnyWeapon';
import { AR_DEFAULT, PISTOL_DEFAULT, cloneWeaponDef, type WeaponDef } from '../weapons/WeaponDefs';

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
  'streak_shield',
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
let shieldPistol: WeaponDef | null = null;
let mortar: WeaponDef | null = null;
let sentry: WeaponDef | null = null;
let chopper: WeaponDef | null = null;

/** Flat damage, no falloff. The blast radius is the only distance term. */
export function mortarWeapon(damage: number): WeaponDef {
  if (mortar === null) {
    mortar = synthetic('streak_mortar', 'MORTAR', damage, 1);
    // A shell is a pressure wave, and the riot shield halves it rather than refusing it — the
    // same statement `blast()` makes about a frag. See `WeaponDef.explosive`.
    mortar.explosive = true;
  }
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
  if (streakId === 'shield') return shieldPistolWeapon();
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
 * **The weight is in the feet as well as the handling now** (2026-09-28). This used to say there
 * was no per-weapon movement multiplier to put it in; `WeaponDef.moveSpeedMult` is that field, and
 * the sprint list asked for the minigun to be heavy to carry and heavier to fire. Carried, 0.80 —
 * a walk of 3.7 m/s against the carbine's 4.6, and the slowest thing anybody holds by a clear
 * margin. Firing, 0.40: 1.84 m/s, under a crouch's 2.8, which is *almost stationary* without
 * being planted — a gunner can still step out of a grenade. The trigger decides it rather than the
 * barrel's state, so the replay of a prediction arrives at the same speed (see `heldMoveScale`).
 *
 * The rest is still the handling: 1.1 s to bring up — the spin, felt as a raise — no sights, a
 * kick twice a rifle's, and never a reload: `reserveAmmo` is zero, so the belt is the whole streak.
 *
 * **Harder and tighter** (2026-09-28): the report was a weak spray, and it was two numbers. Against
 * the 200 every body has (`DEFAULT_HEALTH_CONFIG`), 34 near was six to the body and 24 far was
 * nine, through a cone 2.2 times the carbine's, so past a few metres most of the belt went past.
 * Now 40 near and 30 far — five to the body up close, 0.27 s at 900 rpm against 0.33, and seven at
 * range — through a cone 1.6 times the carbine's, so the rounds that make those numbers land.
 * Still hip only, still the bloom and the kick: it is a lethal suppression weapon that has to be
 * walked onto a target. (The first version of this note counted hits against 100 HP; the pool
 * has been 200 since 2026-09-23, and every figure here is against that.)
 *
 * 200 rounds at 900 rpm is thirteen seconds of held trigger inside a thirty-second streak, which
 * is the trade: the belt runs out before the clock does unless it is fired in bursts.
 */
export function minigunWeapon(): WeaponDef {
  if (minigun !== null) return minigun;
  const def = synthetic('streak_minigun', 'MINIGUN', 40, 1.2);
  def.damage.near = 40;
  def.damage.far = 30;
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
  def.moveSpeedMult = 0.8;
  def.moveSpeedMultFiring = 0.4;
  /**
   * No sights, and now no aiming either (2026-09-27).
   *
   * The FOV scales at 1 made aiming *look* like nothing, but `adsFraction` still ran to 1 on
   * the button: the gun swung to the eye, the spread took its ADS value and the recoil took
   * `adsScale`. A minigun is fired from the hip because there is nowhere on it to put an eye.
   * `noAds` stops it at the one place `adsFraction` moves. `adsTime` is left alone so nothing
   * divides by zero.
   */
  def.noAds = true;
  def.adsFovScale = 1;
  def.adsViewmodelFovScale = 1;
  def.spread.hipStand = def.spread.hipStand * 1.6;
  def.spread.hipMove = def.spread.hipMove * 1.6;
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
 * **Buffed 2026-09-28**, because at 7 a tick it lost the close fights it exists to win: against
 * the 200 every body has, 70 a second in contact and the burn's 8 alongside took about 2.6 s to
 * kill. Ten fuel a second at **11** is 110 a second, the burn it lights ticks alongside at **10**,
 * and a body held in the root of the jet is dead in about 1.7 s. Half a second of contact is far
 * from lethal, and that gap is kept on purpose — it is the whole balance of the weapon: five ticks
 * is 55, the burn while it lasts another 5, and the three seconds that follow them out another 30.
 * Ninety of two hundred. Brushing the edge of a jet costs a player close to half their health and
 * leaves them alive to make a decision about it; staying in the middle of one does not. (The first
 * version of this note counted against 100 HP; every figure here is against the real 200.)
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
  const def = synthetic('streak_flamethrower', 'FLAMETHROWER', 11, 1);
  def.damage.near = 11;
  def.damage.far = 5;
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
  // A tank on the back: a step behind a rifle, and no slower firing — a jet held on a doorway
  // is the job, and a gunner who could not walk it onto the door would not be doing it.
  def.moveSpeedMult = 0.95;
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
    burnDps: 10,
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

/**
 * The third carried streak, and the first one whose point is not what it fires.
 *
 * ## What five kills buys
 *
 * A **wall the width of a body**, held in front of it, for twenty seconds — and a sidearm in
 * the other hand, because a shield with nothing beside it is a player who has bought the right
 * to walk somewhere and do nothing when they arrive. The pistol is the loadout's own sidearm
 * with its magazine halved and its reserve kept.
 *
 * ## The magazine is the cost; the reserve is not (2026-09-27, the human)
 *
 * It shipped belt-fed — six rounds and nothing behind them — by the rule the minigun states:
 * *the streak is the ammunition*. That rule is right for a belt and wrong for this, and the
 * difference is what each weapon's clock is measuring. A minigun's two hundred rounds **are**
 * its thirty seconds; firing them is spending the streak. The shield's twenty seconds are
 * measuring *cover*, and a player who emptied six rounds four seconds in spent the other
 * sixteen behind a wall with a dead gun — which is not a trade, it is the streak ending early
 * for a reason nobody bought it for.
 *
 * So the six stays and sixty go behind it. **Six is the price and it is paid often**: a full
 * magazine is nine-tenths of a second of trigger and the reload that follows is the sidearm's
 * own, unshortened, which means a shield-carrier in a firefight is reloading roughly every
 * three seconds and is doing it one-handed behind a plate. That is the friction the number is
 * for. Sixty is simply enough that the friction never becomes an ending: held down without
 * pause the weapon cannot get through more than about forty rounds before the clock does.
 *
 * A crate or MUNITIONS can now top the reserve up, which it could not before and which changes
 * nothing: the reserve already outlasts the streak, so there is nothing for a resupply to
 * extend. The minigun's belt is still zero, and for the reason that has not changed.
 *
 * ## Why it is the cheapest of the three and still the shortest
 *
 * The minigun and the flamethrower are bought to *take* a position; this is bought to **cross**
 * one. Frontal cover is worth most in the ten seconds it takes to get through a doorway
 * somebody is watching, and worth almost nothing standing still — so twenty seconds is not a
 * weaker version of the minigun's thirty, it is the length of the thing it is for. Five kills
 * is the price of an escort, and the arc is what makes it fair: everything the shield refuses,
 * it refuses only from the front, and a body that turns to shoot somebody has turned its back
 * on everybody else.
 *
 * ## The numbers, and what they are answering
 *
 * A 60-degree half-angle is a 120-degree wall. Narrower and a strafing duel slips round it
 * frame by frame in a way no player can read; wider and it stops being a facing decision at
 * all. Explosives keep half, which is the rule that makes a shield-carrier killable by the
 * people who can see them coming — the grenade does not have to get past the shield, it only
 * has to land.
 *
 * `swapInTime` is long on purpose: raising a shield is not drawing a pistol, and the second and
 * a bit it costs is the window in which buying it is still a decision with a downside.
 */
export function shieldPistolWeapon(): WeaponDef {
  if (shieldPistol !== null) return shieldPistol;
  const def = cloneWeaponDef(PISTOL_DEFAULT);
  def.id = 'streak_shield';
  def.name = 'RIOT SHIELD';
  // Half a magazine, and ten of them behind it. See the note above: the six is the friction,
  // the sixty is what keeps the friction from ending the streak. The reload times are the
  // sidearm's, left exactly as they came — a one-handed reload every three seconds is the cost
  // this weapon is supposed to charge, and shortening it would refund it.
  def.magSize = 6;
  def.reserveAmmo = 60;
  // One hand on a shield is not two hands on a pistol: it is slower up, it cannot be aimed
  // down at all, and it wanders more than the sidearm it came from.
  def.swapInTime = 1.2;
  def.swapOutTime = 0.5;
  def.sprintOutTime = 0.3;
  // The plate is the weight, not the pistol: an LMG's feet, where the sidearm it came from has an
  // SMG's. MW3 put its riot shield at the LMG's 0.8 of an SMG; this is 0.86 of one.
  def.moveSpeedMult = 0.9;
  /**
   * **No aiming** (2026-09-27, the human). "It cannot be aimed down properly" was the comment
   * this replaced, and `adsFovScale = 1` was how it was said — which said nothing: the view did
   * not change, but `adsFraction` still ran to 1, so the pistol still travelled to the eye.
   *
   * The reason is the other hand. Aiming a sidearm is a two-handed act, and this one's left
   * arm is through a shield's cuff — there is no hand to bring it up with, and lining the
   * sights up behind a plate is not a thing you can do anyway.
   */
  def.noAds = true;
  def.adsFovScale = 1;
  def.adsViewmodelFovScale = 1;
  def.spread.hipStand = def.spread.hipStand * 1.4;
  def.spread.hipMove = def.spread.hipMove * 1.4;
  def.spread.ads = def.spread.hipStand;
  def.recoil.adsScale = 1;
  def.shield = { halfAngleDeg: 60, blastRetain: 0.5 };
  // The one place a streak weapon is built is the one place it is catalogued. `synthetic`
  // does this for the defs it makes; this one is cloned from the sidearm instead, so it says
  // so itself. See `anyWeaponDef`.
  registerWeaponDef(def);
  shieldPistol = def;
  return shieldPistol;
}
