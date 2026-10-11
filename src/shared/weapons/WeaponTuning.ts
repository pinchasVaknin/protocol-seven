/**
 * The live tuning surface for a `WeaponDef` (brief S7).
 *
 * Split out of `WeaponDefs.ts` so the schema and the AR's data stay readable: the accessor
 * table below is most of this file, and it is machinery, not content.
 *
 * The point of the derivation is that it is checked in both directions. `WeaponNumberKey`
 * is computed *from* the schema, so a numeric field added to `WeaponDef` with no slider
 * metadata is a type error at `WEAPON_TUNABLES`, and a key that no accessor handles is a
 * type error at `WEAPON_NUMBERS`. The panel cannot drift out of date with the weapon.
 *
 * **One table rather than two switches.** This was a pair of 63-case `switch` statements, one
 * reading and one writing: 320 lines of machinery whose only real property was that the two
 * agreed. They agreed by inspection, and only halfway — `readWeaponNumber` returns a `number`,
 * so `noImplicitReturns` caught a missing case, but `writeWeaponNumber` returns `void`, and a
 * key it did not handle fell through in silence while the slider did nothing.
 * `satisfies Record<WeaponNumberKey, WeaponNumberAccessor>` refuses a missing key *and* an
 * extra one, for the read and the write at once, which is the guarantee the paragraph above
 * claims. It is also where the six repetitions of the scope's absent-weapon rule went.
 *
 * Nothing here is on a hot path: the callers are the F1 panel's sliders and the COPY CONFIG
 * button, which run at the speed of a human hand.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { TunableMeta } from '../player/MovementConfig';
import type { RecoilPattern, ScopeProfile, SpreadProfile, WeaponDef, WeaponVoice } from './WeaponDefs';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * Keys of `T` whose value is a number.
 *
 * This is what makes the tuning panel compile-checked the same way M1's is: the key
 * union below is *derived* from the schema, so adding a numeric field to `WeaponDef`
 * without giving it slider metadata is a type error at `WEAPON_TUNABLES`, and failing
 * to wire it into the accessors is a type error at the exhaustive switches.
 */
type NumberKeysOf<T> = { [K in keyof T]-?: number extends T[K] ? K : never }[keyof T] & string;

/**
 * Optional numbers are out: a slider has to show *something* on every weapon, and
 * `moveSpeedMultFiring` exists on one killstreak that the panel never holds.
 */
type TopKey = Exclude<NumberKeysOf<WeaponDef>, 'projectileSpeed' | 'moveSpeedMultFiring'>;
type DamageKey = `damage.${NumberKeysOf<WeaponDef['damage']>}`;
type FalloffKey = `falloff.${NumberKeysOf<WeaponDef['damageFalloff']>}`;
type SpreadKey = `spread.${NumberKeysOf<SpreadProfile>}`;
type RecoilKey = `recoil.${NumberKeysOf<RecoilPattern>}`;
type VoiceKey = `voice.${NumberKeysOf<WeaponVoice>}`;
/**
 * The scope's numbers are derived the same way, but from `ScopeProfile` directly rather
 * than through `WeaponDef` — `scope` is optional, so `NumberKeysOf<WeaponDef>` cannot see
 * inside it. Reading a scope key off an unscoped weapon returns 0 and writing one is a
 * no-op; `WeaponDebug` hides the whole group when `def.scope` is undefined rather than
 * showing sliders that do nothing.
 */
type ScopeKey = `scope.${NumberKeysOf<ScopeProfile>}`;

export type WeaponNumberKey =
  | TopKey
  | DamageKey
  | FalloffKey
  | SpreadKey
  | RecoilKey
  | VoiceKey
  | ScopeKey;

/**
 * A number on a `WeaponDef`, as the pair of operations a slider needs.
 *
 * Both are closures built once at module load, one pair per key. What matters about the pair
 * is that it cannot disagree with itself about which field it names.
 */
interface WeaponNumberAccessor {
  readonly read: (def: WeaponDef) => number;
  readonly write: (def: WeaponDef, v: number) => void;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/** Keys that only mean anything on a weapon with a `scope`. */
const SCOPE_KEY_PREFIX = 'scope.';

export const WEAPON_TUNABLES: Readonly<Record<WeaponNumberKey, TunableMeta>> = {
  'damage.near': { label: 'Near', group: 'Damage', min: 5, max: 120, step: 1, unit: '' },
  'damage.far': { label: 'Far', group: 'Damage', min: 5, max: 120, step: 1, unit: '' },
  'falloff.start': { label: 'Falloff start', group: 'Damage', min: 2, max: 80, step: 0.5, unit: 'm' },
  'falloff.end': { label: 'Falloff end', group: 'Damage', min: 4, max: 140, step: 0.5, unit: 'm' },
  headshotMult: { label: 'Headshot', group: 'Damage', min: 1, max: 4, step: 0.05, unit: 'x' },
  limbMult: { label: 'Limb', group: 'Damage', min: 0.4, max: 1.5, step: 0.05, unit: 'x' },
  upperTorsoMult: { label: 'Upper torso', group: 'Damage', min: 0.8, max: 2, step: 0.01, unit: 'x' },
  penetration: { label: 'Penetration', group: 'Damage', min: 0, max: 2, step: 0.01, unit: 'm' },
  pellets: { label: 'Pellets', group: 'Damage', min: 1, max: 16, step: 1, unit: '' },
  pelletSpread: { label: 'Pellet cone', group: 'Damage', min: 0, max: 10, step: 0.05, unit: '°' },

  rpm: { label: 'RPM', group: 'Handling', min: 60, max: 1400, step: 5, unit: '' },
  magSize: { label: 'Mag size', group: 'Handling', min: 1, max: 200, step: 1, unit: '' },
  reserveAmmo: { label: 'Reserve', group: 'Handling', min: 0, max: 600, step: 10, unit: '' },
  reloadTime: { label: 'Reload', group: 'Handling', min: 0.4, max: 6, step: 0.05, unit: 's' },
  reloadEmptyTime: { label: 'Reload empty', group: 'Handling', min: 0.4, max: 8, step: 0.05, unit: 's' },
  adsTime: { label: 'ADS time', group: 'Handling', min: 0.05, max: 1.2, step: 0.01, unit: 's' },
  sprintOutTime: { label: 'Sprint to fire', group: 'Handling', min: 0, max: 1, step: 0.01, unit: 's' },
  moveSpeedMult: { label: 'Move speed', group: 'Handling', min: 0.5, max: 1.3, step: 0.01, unit: 'x' },
  swapInTime: { label: 'Swap in', group: 'Handling', min: 0.1, max: 1.5, step: 0.01, unit: 's' },
  swapOutTime: { label: 'Swap out', group: 'Handling', min: 0.1, max: 1.5, step: 0.01, unit: 's' },

  'spread.hipStand': { label: 'Hip standing', group: 'Spread', min: 0, max: 8, step: 0.05, unit: '°' },
  'spread.hipMove': { label: 'Hip moving', group: 'Spread', min: 0, max: 12, step: 0.05, unit: '°' },
  'spread.ads': { label: 'ADS', group: 'Spread', min: 0, max: 3, step: 0.01, unit: '°' },
  'spread.crouchScale': { label: 'Crouch x', group: 'Spread', min: 0.2, max: 1.2, step: 0.01, unit: 'x' },
  'spread.airScale': { label: 'Airborne x', group: 'Spread', min: 1, max: 5, step: 0.05, unit: 'x' },
  'spread.perShot': { label: 'Bloom / shot', group: 'Spread', min: 0, max: 1, step: 0.005, unit: '°' },
  'spread.perShotMax': { label: 'Bloom cap', group: 'Spread', min: 0, max: 6, step: 0.05, unit: '°' },
  'spread.recover': { label: 'Bloom recover', group: 'Spread', min: 0.1, max: 20, step: 0.1, unit: '°/s' },

  'recoil.verticalScale': { label: 'Vertical x', group: 'Recoil', min: 0, max: 3, step: 0.02, unit: 'x' },
  'recoil.horizontalScale': { label: 'Lateral x', group: 'Recoil', min: 0, max: 3, step: 0.02, unit: 'x' },
  'recoil.firstShotScale': { label: 'First shot x', group: 'Recoil', min: 0.5, max: 3, step: 0.05, unit: 'x' },
  'recoil.recoverFraction': { label: 'Recovered', group: 'Recoil', min: 0, max: 1, step: 0.01, unit: '' },
  'recoil.recoverRate': { label: 'Recover rate', group: 'Recoil', min: 1, max: 30, step: 0.5, unit: '/s' },
  'recoil.recoverDelay': { label: 'Recover delay', group: 'Recoil', min: 0, max: 0.5, step: 0.01, unit: 's' },
  'recoil.adsScale': { label: 'ADS x', group: 'Recoil', min: 0.2, max: 1.5, step: 0.01, unit: 'x' },
  'recoil.visualScale': { label: 'Visual x', group: 'Recoil', min: 0, max: 4, step: 0.05, unit: 'x' },
  'recoil.visualAttack': { label: 'Visual attack', group: 'Recoil', min: 0.005, max: 0.2, step: 0.002, unit: 's' },
  'recoil.visualSettle': { label: 'Visual settle', group: 'Recoil', min: 0.02, max: 0.6, step: 0.005, unit: 's' },

  adsFovScale: { label: 'ADS world FOV', group: 'Optics', min: 0.4, max: 1, step: 0.01, unit: 'x' },
  adsViewmodelFovScale: { label: 'ADS vm FOV', group: 'Optics', min: 0.4, max: 1, step: 0.01, unit: 'x' },
  tracerFraction: { label: 'Tracer rate', group: 'Optics', min: 0, max: 1, step: 0.02, unit: '' },
  shakePerShot: { label: 'Shake / shot', group: 'Optics', min: 0, max: 0.4, step: 0.005, unit: '' },
  muzzleFlashScale: { label: 'Flash size', group: 'Optics', min: 0, max: 3, step: 0.05, unit: 'x' },
  unlockLevel: { label: 'Unlock level', group: 'Optics', min: 1, max: 55, step: 1, unit: '' },

  'voice.level': { label: 'Level', group: 'Voice', min: 0, max: 1.5, step: 0.02, unit: '' },
  'voice.bodyFreq': { label: 'Body freq', group: 'Voice', min: 200, max: 4000, step: 25, unit: 'Hz' },
  'voice.bodyQ': { label: 'Body Q', group: 'Voice', min: 0.2, max: 12, step: 0.05, unit: '' },
  'voice.bodyDecay': { label: 'Body decay', group: 'Voice', min: 0.02, max: 0.4, step: 0.005, unit: 's' },
  'voice.bodyRatio': { label: 'Body sweep', group: 'Voice', min: 0.08, max: 0.9, step: 0.01, unit: 'x' },
  'voice.tailDecay': { label: 'Tail decay', group: 'Voice', min: 0.05, max: 1.2, step: 0.01, unit: 's' },
  'voice.tailLevel': { label: 'Tail level', group: 'Voice', min: 0, max: 1, step: 0.01, unit: '' },
  'voice.tailFreq': { label: 'Tail cutoff', group: 'Voice', min: 600, max: 6000, step: 50, unit: 'Hz' },
  'voice.clickFreq': { label: 'Click freq', group: 'Voice', min: 1000, max: 12000, step: 100, unit: 'Hz' },
  'voice.clickLevel': { label: 'Click level', group: 'Voice', min: 0, max: 1.5, step: 0.02, unit: '' },
  'voice.thumpFreq': { label: 'Thump freq', group: 'Voice', min: 30, max: 300, step: 1, unit: 'Hz' },
  'voice.thumpLevel': { label: 'Thump level', group: 'Voice', min: 0, max: 1.5, step: 0.02, unit: '' },
  'voice.wet': { label: 'Reverb send', group: 'Voice', min: 0, max: 1, step: 0.01, unit: '' },

  'scope.swayDeg': { label: 'Sway', group: 'Scope', min: 0, max: 2, step: 0.01, unit: '°' },
  'scope.swayRate': { label: 'Breath rate', group: 'Scope', min: 0.1, max: 2, step: 0.01, unit: 'Hz' },
  'scope.breathSeconds': { label: 'Hold', group: 'Scope', min: 0.5, max: 8, step: 0.1, unit: 's' },
  'scope.breathRecovery': { label: 'Recover', group: 'Scope', min: 0.5, max: 12, step: 0.1, unit: 's' },
  'scope.breathHoldScale': { label: 'Held sway x', group: 'Scope', min: 0, max: 1, step: 0.01, unit: 'x' },
  'scope.magnification': { label: 'Magnification', group: 'Scope', min: 1, max: 10, step: 0.1, unit: 'x' },
};

export const WEAPON_NUMBER_KEYS = Object.keys(WEAPON_TUNABLES) as WeaponNumberKey[];

/**
 * Every tunable number, as the field it is.
 *
 * `satisfies` rather than a type annotation on purpose: it checks the object against
 * `Record<WeaponNumberKey, WeaponNumberAccessor>` — so a key the schema gained and this table
 * has not is a compile error, and a key here the schema does not have is one too — while
 * leaving the literal's own keys visible, which is what `WEAPON_NUMBER_KEYS` above is read off.
 */
const WEAPON_NUMBERS = {
  'damage.near':            field((d: WeaponDef) => d.damage, 'near'),
  'damage.far':             field((d: WeaponDef) => d.damage, 'far'),
  'falloff.start':          field((d: WeaponDef) => d.damageFalloff, 'start'),
  'falloff.end':            field((d: WeaponDef) => d.damageFalloff, 'end'),
  'headshotMult':           field((d: WeaponDef) => d, 'headshotMult'),
  'limbMult':               field((d: WeaponDef) => d, 'limbMult'),
  'upperTorsoMult':         field((d: WeaponDef) => d, 'upperTorsoMult'),
  'penetration':            field((d: WeaponDef) => d, 'penetration'),
  'pellets':                field((d: WeaponDef) => d, 'pellets'),
  'pelletSpread':           field((d: WeaponDef) => d, 'pelletSpread'),
  'rpm':                    field((d: WeaponDef) => d, 'rpm'),
  'magSize':                field((d: WeaponDef) => d, 'magSize'),
  'reserveAmmo':            field((d: WeaponDef) => d, 'reserveAmmo'),
  'reloadTime':             field((d: WeaponDef) => d, 'reloadTime'),
  'reloadEmptyTime':        field((d: WeaponDef) => d, 'reloadEmptyTime'),
  'adsTime':                field((d: WeaponDef) => d, 'adsTime'),
  'sprintOutTime':          field((d: WeaponDef) => d, 'sprintOutTime'),
  'moveSpeedMult':          field((d: WeaponDef) => d, 'moveSpeedMult'),
  'swapInTime':             field((d: WeaponDef) => d, 'swapInTime'),
  'swapOutTime':            field((d: WeaponDef) => d, 'swapOutTime'),
  'spread.hipStand':        field((d: WeaponDef) => d.spread, 'hipStand'),
  'spread.hipMove':         field((d: WeaponDef) => d.spread, 'hipMove'),
  'spread.ads':             field((d: WeaponDef) => d.spread, 'ads'),
  'spread.crouchScale':     field((d: WeaponDef) => d.spread, 'crouchScale'),
  'spread.airScale':        field((d: WeaponDef) => d.spread, 'airScale'),
  'spread.perShot':         field((d: WeaponDef) => d.spread, 'perShot'),
  'spread.perShotMax':      field((d: WeaponDef) => d.spread, 'perShotMax'),
  'spread.recover':         field((d: WeaponDef) => d.spread, 'recover'),
  'recoil.verticalScale':   field((d: WeaponDef) => d.recoil, 'verticalScale'),
  'recoil.horizontalScale': field((d: WeaponDef) => d.recoil, 'horizontalScale'),
  'recoil.firstShotScale':  field((d: WeaponDef) => d.recoil, 'firstShotScale'),
  'recoil.recoverFraction': field((d: WeaponDef) => d.recoil, 'recoverFraction'),
  'recoil.recoverRate':     field((d: WeaponDef) => d.recoil, 'recoverRate'),
  'recoil.recoverDelay':    field((d: WeaponDef) => d.recoil, 'recoverDelay'),
  'recoil.adsScale':        field((d: WeaponDef) => d.recoil, 'adsScale'),
  'recoil.visualScale':     field((d: WeaponDef) => d.recoil, 'visualScale'),
  'recoil.visualAttack':    field((d: WeaponDef) => d.recoil, 'visualAttack'),
  'recoil.visualSettle':    field((d: WeaponDef) => d.recoil, 'visualSettle'),
  'adsFovScale':            field((d: WeaponDef) => d, 'adsFovScale'),
  'adsViewmodelFovScale':   field((d: WeaponDef) => d, 'adsViewmodelFovScale'),
  'tracerFraction':         field((d: WeaponDef) => d, 'tracerFraction'),
  'shakePerShot':           field((d: WeaponDef) => d, 'shakePerShot'),
  'muzzleFlashScale':       field((d: WeaponDef) => d, 'muzzleFlashScale'),
  'unlockLevel':            field((d: WeaponDef) => d, 'unlockLevel'),
  'voice.level':            field((d: WeaponDef) => d.voice, 'level'),
  'voice.bodyFreq':         field((d: WeaponDef) => d.voice, 'bodyFreq'),
  'voice.bodyQ':            field((d: WeaponDef) => d.voice, 'bodyQ'),
  'voice.bodyDecay':        field((d: WeaponDef) => d.voice, 'bodyDecay'),
  'voice.bodyRatio':        field((d: WeaponDef) => d.voice, 'bodyRatio'),
  'voice.tailDecay':        field((d: WeaponDef) => d.voice, 'tailDecay'),
  'voice.tailLevel':        field((d: WeaponDef) => d.voice, 'tailLevel'),
  'voice.tailFreq':         field((d: WeaponDef) => d.voice, 'tailFreq'),
  'voice.clickFreq':        field((d: WeaponDef) => d.voice, 'clickFreq'),
  'voice.clickLevel':       field((d: WeaponDef) => d.voice, 'clickLevel'),
  'voice.thumpFreq':        field((d: WeaponDef) => d.voice, 'thumpFreq'),
  'voice.thumpLevel':       field((d: WeaponDef) => d.voice, 'thumpLevel'),
  'voice.wet':              field((d: WeaponDef) => d.voice, 'wet'),
  'scope.swayDeg':          scopeField('swayDeg', 0),
  'scope.swayRate':         scopeField('swayRate', 0),
  'scope.breathSeconds':    scopeField('breathSeconds', 0),
  'scope.breathRecovery':   scopeField('breathRecovery', 0),
  'scope.breathHoldScale':  scopeField('breathHoldScale', 0),
  'scope.magnification':    scopeField('magnification', 1),
} satisfies Record<WeaponNumberKey, WeaponNumberAccessor>;
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function readWeaponNumber(def: WeaponDef, key: WeaponNumberKey): number {
  return WEAPON_NUMBERS[key].read(def);
}

export function writeWeaponNumber(def: WeaponDef, key: WeaponNumberKey, v: number): void {
  WEAPON_NUMBERS[key].write(def, v);
}

/** Serialise a tuned weapon back into pasteable TypeScript source. */
export function weaponDefToSource(def: WeaponDef): string {
  const lines: string[] = [`// ${def.name} (${def.id}) — tuned values`, 'const tuned = {'];
  let lastGroup = '';
  for (const key of WEAPON_NUMBER_KEYS) {
    const meta = WEAPON_TUNABLES[key];
    // A pistol has no scope numbers to paste back.
    if (def.scope === undefined && key.startsWith(SCOPE_KEY_PREFIX)) continue;
    if (meta.group !== lastGroup) {
      if (lastGroup !== '') lines.push('');
      lines.push(`  // -- ${meta.group.toLowerCase()} --`);
      lastGroup = meta.group;
    }
    lines.push(`  '${key}': ${Math.round(readWeaponNumber(def, key) * 1e4) / 1e4},`);
  }
  lines.push('};');
  return lines.join('\n');
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * A number that lives on the def itself, or on one of its always-present records.
 *
 * `owner` picks the record out of the def and `key` names the field in it, which is what lets
 * one row describe `def.rpm` and `def.recoil.visualScale` in the same shape. `key` is
 * constrained to the record's *numeric* fields, so naming `recoil.kicks` here does not compile.
 */
function field<T extends object, K extends NumberKeysOf<T> & keyof T>(
  owner: (def: WeaponDef) => T,
  key: K,
): WeaponNumberAccessor {
  return {
    read: (def) => owner(def)[key] as number,
    write: (def, v) => {
      owner(def)[key] = v as T[K];
    },
  };
}

/**
 * A number inside the optional `scope` record.
 *
 * `scope` is absent on ten of the twelve weapons, so reading one of these returns `fallback`
 * and writing one is a no-op rather than inventing a scope. `WeaponDebug` hides the whole
 * group when `def.scope` is undefined rather than showing sliders that do nothing, so the
 * fallback is only ever what is behind a group nobody sees.
 */
function scopeField(
  key: NumberKeysOf<ScopeProfile> & keyof ScopeProfile,
  fallback: number,
): WeaponNumberAccessor {
  return {
    read: (def) => def.scope?.[key] ?? fallback,
    write: (def, v) => {
      if (def.scope !== undefined) def.scope[key] = v;
    },
  };
}
//#endregion
