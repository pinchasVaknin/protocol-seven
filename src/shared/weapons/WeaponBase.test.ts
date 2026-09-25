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
