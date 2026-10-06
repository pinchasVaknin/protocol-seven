import { describe, expect, it } from 'vitest';
import { createGameBus, EV } from '../core/Events';
import { DT } from '../core/Loop';
import { AR_DEFAULT } from './WeaponDefs';
import { makeWeaponInput, Weapon, type WeaponInput } from './WeaponBase';

/**
 * The magazine change needs both hands (2026-09-25, the human): no reload may start, and one in
 * progress is dropped, while the body is sprinting, sliding or vaulting.
 *
 * Three separate paths reach `beginReload` and the rule has to hold on all of them, which is
 * what these tests are for — blocking the key alone left two doors open. `WeaponSystem` decides
 * *when* `reloadBlocked` is true from the stance machine; this file is about what the weapon does
 * once it is.
 */

function armed(): Weapon {
  const weapon = new Weapon(AR_DEFAULT, createGameBus());
  weapon.mag = 1; // one short of a magazine, so a reload has something to do
  return weapon;
}

/** Run `input` for `seconds` of simulation ticks. */
function run(weapon: Weapon, input: WeaponInput, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) weapon.step(input);
}

describe('a reload that the body has no hands for', () => {
  it('does not start when the key is pressed', () => {
    const weapon = armed();
    const input = makeWeaponInput();
    input.reloadPressed = true;
    input.reloadBlocked = true;
    weapon.step(input);
    expect(weapon.reloading).toBe(false);
  });

  it('emits nothing when it is refused', () => {
    // The one-tick reload this replaced was long enough to fire the event, which is a click of
    // audio, a viewmodel twitch and one snapshot telling everybody else the body was reloading.
    const bus = createGameBus();
    const weapon = new Weapon(AR_DEFAULT, bus);
    weapon.mag = 1;
    let started = 0;
    bus.on(EV.WeaponReloadStarted, () => started++);
    const input = makeWeaponInput();
    input.reloadPressed = true;
    input.reloadBlocked = true;
    weapon.step(input);
    expect(started).toBe(0);

    input.reloadBlocked = false;
    weapon.step(input);
    expect(started).toBe(1);
  });

  it('does not start from a dry trigger either', () => {
    // Firing is legal mid-slide by an M4 decision, so an empty weapon fired while sliding used
    // to reload itself through the automatic path — the door blocking the key left open.
    //
    // Asserted on the event, not on `reloading`: `stepReload` cancels on the following tick, so
    // the flag reads false a tick later whether or not the reload was ever allowed to begin, and
    // an earlier version of this test passed against the unguarded code for exactly that reason.
    const bus = createGameBus();
    const weapon = new Weapon(AR_DEFAULT, bus);
    weapon.mag = 0;
    let dry = 0;
    let started = 0;
    bus.on(EV.WeaponDryFired, () => dry++);
    bus.on(EV.WeaponReloadStarted, () => started++);

    const input = makeWeaponInput();
    input.fireHeld = true;
    input.reloadBlocked = true;
    run(weapon, input, 0.5);
    // The control: the trigger really was pulled on an empty magazine, so the path was reached.
    expect(dry).toBe(1);
    expect(started).toBe(0);
    expect(weapon.mag).toBe(0);
  });

  it('drops one already running', () => {
    const weapon = armed();
    const input = makeWeaponInput();
    input.reloadPressed = true;
    weapon.step(input);
    expect(weapon.reloading).toBe(true);

    input.reloadPressed = false;
    input.reloadBlocked = true;
    weapon.step(input);
    expect(weapon.reloading).toBe(false);
    expect(weapon.reloadFraction).toBe(0);
  });

  it('costs the magazine rather than banking half of it', () => {
    // The ammo only lands on completion, so there is no half-reload state to reason about.
    const weapon = armed();
    const before = weapon.mag;
    const reserveBefore = weapon.reserve;
    const input = makeWeaponInput();
    input.reloadPressed = true;
    weapon.step(input);
    input.reloadPressed = false;
    run(weapon, input, AR_DEFAULT.reloadTime * 0.6);
    input.reloadBlocked = true;
    weapon.step(input);
    expect(weapon.mag).toBe(before);
    expect(weapon.reserve).toBe(reserveBefore);
  });
});

describe('a reload the body does have hands for', () => {
  it('still completes and still fills the magazine', () => {
    const weapon = armed();
    const input = makeWeaponInput();
    input.reloadPressed = true;
    weapon.step(input);
    input.reloadPressed = false;
    run(weapon, input, AR_DEFAULT.reloadTime + 4 * DT);
    expect(weapon.reloading).toBe(false);
    expect(weapon.mag).toBe(AR_DEFAULT.magSize);
  });

  it('is still cancelled by lowering, which is the older half of the rule', () => {
    const weapon = armed();
    const input = makeWeaponInput();
    input.reloadPressed = true;
    weapon.step(input);
    input.reloadPressed = false;
    input.lowering = true;
    weapon.step(input);
    expect(weapon.reloading).toBe(false);
  });
});

/**
 * A weapon with no sights is never aimed (2026-09-27, the human: "a minigun is fired from the
 * hip; there is no sense in seeing it with sights").
 *
 * `noAds` was added because saying it with `adsFovScale = 1` was not saying it: the view did
 * not change, but `adsFraction` still ran to 1, so the gun swung to the eye, the spread took
 * its ADS value and the recoil took `adsScale`. These hold the flag at the one place the
 * fraction is allowed to move — and the last one holds the *other* weapons to still aiming,
 * because a flag that stopped everything would pass the first three tests too.
 */
describe('a weapon that cannot be aimed', () => {
  const sightless = (): Weapon => new Weapon({ ...AR_DEFAULT, noAds: true }, createGameBus());

  it('stays at the hip however long the button is held', () => {
    const weapon = sightless();
    const input = makeWeaponInput();
    input.adsHeld = true;
    run(weapon, input, 2);
    expect(weapon.adsFraction).toBe(0);
    expect(weapon.aiming).toBe(false);
  });

  it('never emits WeaponAdsChanged', () => {
    const bus = createGameBus();
    const weapon = new Weapon({ ...AR_DEFAULT, noAds: true }, bus);
    let heard = 0;
    bus.on(EV.WeaponAdsChanged, () => (heard += 1));
    const input = makeWeaponInput();
    input.adsHeld = true;
    run(weapon, input, 1);
    input.adsHeld = false;
    run(weapon, input, 1);
    expect(heard).toBe(0);
  });

  it('is the flag and not the weapon: the same def aims without it', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    const input = makeWeaponInput();
    input.adsHeld = true;
    run(weapon, input, 2);
    expect(weapon.adsFraction).toBe(1);
    expect(weapon.aiming).toBe(true);
  });
});

/**
 * The Shooting Range's guns (2026-10-03): the playtest ran the range dry at about 270 rounds, 0/0
 * with no word on screen. The magazine still empties and still reloads; the pool behind it is
 * what goes.
 */
describe('a weapon with an infinite reserve', () => {
  it('reloads a full magazine with nothing in reserve, and takes nothing from it', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    weapon.infiniteReserve = true;
    weapon.mag = 0;
    weapon.reserve = 0;
    const input = makeWeaponInput();
    input.reloadPressed = true;
    weapon.step(input);
    expect(weapon.reloading).toBe(true);
    input.reloadPressed = false;
    run(weapon, input, AR_DEFAULT.reloadEmptyTime + 0.5);
    expect(weapon.mag).toBe(AR_DEFAULT.magSize);
    expect(weapon.reserve).toBe(0);
  });

  it('reloads itself from a dry trigger, as a finite one with rounds left would', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    weapon.infiniteReserve = true;
    weapon.mag = 0;
    weapon.reserve = 0;
    const input = makeWeaponInput();
    input.fireHeld = true;
    input.firePressed = true;
    weapon.step(input);
    expect(weapon.reloading).toBe(true);
  });

  it('is off unless asked for: a finite gun with nothing left does not reload', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    weapon.mag = 0;
    weapon.reserve = 0;
    const input = makeWeaponInput();
    input.reloadPressed = true;
    weapon.step(input);
    expect(weapon.reloading).toBe(false);
  });
});

/**
 * The trigger, which is the other half of `stepTrigger` and the half the reload rules sit on
 * top of. A fractional fire-rate accumulator, a dry click that fires once per *pull* rather
 * than once per tick, and a safety valve above both.
 */
describe('the trigger', () => {
  it('queues shots on a fractional accumulator, not a whole number of ticks', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    const input = makeWeaponInput();
    input.fireHeld = true;
    // 700 RPM is 5.14 ticks a shot. Rounding that to 5 or 6 would put the real rate at 720
    // or 600, which is a different gun.
    let shots = 0;
    for (let tick = 0; tick < 60; tick++) {
      weapon.step(input);
      while (weapon.consumeShot()) shots++;
    }
    expect(AR_DEFAULT.rpm).toBe(700);
    expect(shots).toBe(12);
  });

  it('offers the first round on the tick the trigger goes down', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    const input = makeWeaponInput();
    input.fireHeld = true;
    input.firePressed = true;
    weapon.step(input);
    expect(weapon.pendingShots).toBe(1);
    expect(weapon.consumeShot()).toBe(true);
    expect(weapon.mag).toBe(AR_DEFAULT.magSize - 1);
    // One owed shot, taken once.
    expect(weapon.consumeShot()).toBe(false);
  });

  it('never queues more than four rounds in a tick, whatever the rate says', () => {
    const silly = { ...AR_DEFAULT, rpm: 60000 };
    const weapon = new Weapon(silly, createGameBus());
    const input = makeWeaponInput();
    input.fireHeld = true;
    weapon.step(input);
    expect(weapon.pendingShots).toBe(4);
  });

  it('queues nothing while the weapon is down or reloading', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    const input = makeWeaponInput();
    input.fireHeld = true;
    input.lowering = true;
    run(weapon, input, 0.5);
    expect(weapon.raise).toBe(0);
    expect(weapon.pendingShots).toBe(0);

    const reloading = armed();
    const ri = makeWeaponInput();
    ri.reloadPressed = true;
    reloading.step(ri);
    expect(reloading.reloading).toBe(true);
    ri.reloadPressed = false;
    ri.fireHeld = true;
    reloading.step(ri);
    expect(reloading.pendingShots).toBe(0);
  });

  it('clicks once per trigger pull on an empty magazine, not once per tick', () => {
    const bus = createGameBus();
    const weapon = new Weapon(AR_DEFAULT, bus);
    weapon.mag = 0;
    weapon.reserve = 0;
    let clicks = 0;
    bus.on(EV.WeaponDryFired, () => clicks++);

    const input = makeWeaponInput();
    input.fireHeld = true;
    run(weapon, input, 0.5);
    expect(clicks).toBe(1);
    expect(weapon.pendingShots).toBe(0);

    // Releasing and pulling again is a second click. Without the per-pull latch, running the
    // magazine dry *while holding* would produce no click at all, because there is no press
    // edge on the tick the last round leaves.
    input.fireHeld = false;
    weapon.step(input);
    input.fireHeld = true;
    weapon.step(input);
    expect(clicks).toBe(2);
  });

  it('reports the dry click on exactly the tick it happened', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    weapon.mag = 0;
    weapon.reserve = 0;
    const input = makeWeaponInput();
    input.fireHeld = true;
    weapon.step(input);
    expect(weapon.dryFiredThisTick).toBe(true);
    weapon.step(input);
    expect(weapon.dryFiredThisTick).toBe(false);
  });

  it('banks no credit in the fire timer while the trigger is up', () => {
    const weapon = new Weapon(AR_DEFAULT, createGameBus());
    const input = makeWeaponInput();
    // A second of waiting must not buy a burst on the tick the trigger goes down.
    run(weapon, input, 1);
    expect(weapon.fireTimer).toBe(0);
    input.fireHeld = true;
    weapon.step(input);
    expect(weapon.pendingShots).toBe(1);
  });
});
