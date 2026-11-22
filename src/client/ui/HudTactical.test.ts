import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HudTactical,
  SCOPE_VIEWMODEL_HIDDEN,
  makeTacticalState,
  type TacticalState,
} from './HudTactical';
import { FakeElement } from './testing/dom';

/**
 * Characterization tests for the tactical half of the HUD (refactor unit C14, written before the
 * refactor).
 *
 * Same double as `HudBanner.test.ts` and for the same reason — see the note there. The two
 * `BearingIndicator`s this class owns are the real ones, so the arrows' writes are pinned here
 * too, through the class that drives them.
 */

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class is shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 66 lines of it. The environment is still this file's own, and still
 * only the two globals this suite needs -- the shared `installFakeDom` would also install a
 * `window`, a `localStorage` and a fake clock, and a suite that runs without them today is not
 * a suite to hand them to on the way past.
 *
 * The style seed is what this file's own double carried, for the reason the constructor gives:
 * an untouched key reads back as `''`, and this suite asserts on that.
 */

const element = (tag: string): FakeElement => new FakeElement(tag, { opacity: '', transform: '', visibility: '' });

beforeEach(() => {
  (globalThis as Record<string, unknown>).document = { createElement: element };
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).HTMLElement;
});

// ---------------------------------------------------------------------------- the rig

interface Rig {
  readonly tac: HudTactical;
  readonly layers: readonly FakeElement[];
  readonly primary: FakeElement;
  readonly secondary: FakeElement;
  readonly lethalLabel: FakeElement;
  readonly lethalCount: FakeElement;
  readonly tacticalLabel: FakeElement;
  readonly tacticalCount: FakeElement;
  readonly upgradeSlot: FakeElement;
  readonly upgradeFill: FakeElement;
  readonly upgradeLabel: FakeElement;
  readonly cookBar: FakeElement;
  readonly cookFill: FakeElement;
  readonly breathBar: FakeElement;
  readonly breathFill: FakeElement;
  readonly threatArrow: FakeElement;
  readonly objectiveArrow: FakeElement;
  readonly flash: FakeElement;
  readonly scope: FakeElement;
}

function at(el: FakeElement, ...path: number[]): FakeElement {
  let node = el;
  for (const index of path) {
    const next = node.children[index];
    if (next === undefined) throw new Error(`no child ${index} of ${node.className}`);
    node = next;
  }
  return node;
}

function rig(): Rig {
  const tac = new HudTactical();
  const layers = tac.layers as unknown as FakeElement[];
  const root = tac.element as unknown as FakeElement;
  const scope = layers[0] as FakeElement;
  const cookBar = layers[2] as FakeElement;
  const breathBar = layers[3] as FakeElement;
  return {
    tac,
    layers,
    primary: at(root, 0, 0),
    secondary: at(root, 0, 1),
    lethalLabel: at(root, 1, 0, 0),
    lethalCount: at(root, 1, 0, 1),
    tacticalLabel: at(root, 1, 1, 0),
    tacticalCount: at(root, 1, 1, 1),
    upgradeSlot: at(root, 1, 2),
    upgradeFill: at(root, 1, 2, 0),
    upgradeLabel: at(root, 1, 2, 1),
    cookBar,
    cookFill: at(cookBar, 0),
    breathBar,
    breathFill: at(breathBar, 0),
    threatArrow: layers[4] as FakeElement,
    objectiveArrow: layers[5] as FakeElement,
    flash: layers[6] as FakeElement,
    scope,
  };
}

function state(over: Partial<TacticalState> = {}): TacticalState {
  return { ...makeTacticalState(), ...over };
}

// ---------------------------------------------------------------------------- the constants

describe('the scope hand-off', () => {
  it('hides the viewmodel at 0.8, above the fraction the tube starts closing at', () => {
    expect(SCOPE_VIEWMODEL_HIDDEN).toBe(0.8);
  });
});

describe('makeTacticalState', () => {
  it('starts on frag and flashbang with a full breath and no scope', () => {
    expect(makeTacticalState()).toEqual({
      weaponName: '',
      slotIndex: 0,
      otherName: '',
      lethalId: 'frag',
      lethalCount: 0,
      tacticalId: 'flashbang',
      tacticalCount: 0,
      cookRemaining: 0,
      cookTotal: 1,
      flash: 0,
      threatActive: false,
      threatX: 0,
      threatY: 0,
      threatZ: 0,
      threatBearingRad: 0,
      objectiveActive: false,
      objectiveX: 0,
      objectiveZ: 0,
      objectiveBearingRad: 0,
      scopeFraction: 0,
      breath: 1,
      breathHeld: false,
      hasScope: false,
      fieldUpgradeName: '',
      fieldUpgradeCharge: 0,
    });
  });

  it('hands out a fresh record every call', () => {
    makeTacticalState().breath = 0;
    expect(makeTacticalState().breath).toBe(1);
  });
});

// ---------------------------------------------------------------------------- the layers

describe('layers', () => {
  it('is the seven elements in the order the HUD must stack them', () => {
    const r = rig();
    expect(r.layers).toHaveLength(7);
    expect(r.layers.map((el) => el.className)).toEqual([
      'hud-scope',
      'hud-tac',
      'hud-cook',
      'hud-breath',
      'hud-bearing hud-bearing--threat',
      'hud-bearing hud-bearing--objective',
      'hud-flash',
    ]);
  });

  it('starts the scope tube and the white-out invisible', () => {
    const r = rig();
    expect(r.scope.style.opacity).toBe('0');
    expect(r.flash.style.opacity).toBe('0');
    expect(r.threatArrow.style.opacity).toBe('0');
    expect(r.objectiveArrow.style.opacity).toBe('0');
  });

  it('builds the weapon plate and the three gear slots', () => {
    const r = rig();
    const root = r.tac.element as unknown as FakeElement;
    expect(at(root, 0).className).toBe('hud-tac__weapons');
    expect(at(root, 1).className).toBe('hud-tac__gear');
    expect(at(root, 1).children).toHaveLength(3);
    expect(r.primary.className).toBe('hud-tac__weapon op-label');
    expect(r.secondary.className).toBe('hud-tac__weapon hud-tac__weapon--alt op-label');
    expect(r.upgradeSlot.className).toBe('hud-tac__slot hud-tac__slot--upgrade');
    expect(r.upgradeFill.className).toBe('hud-tac__charge');
  });
});

// ---------------------------------------------------------------------------- the weapon plate

describe('update: the weapon plate', () => {
  it('writes the active name and the other slot under it', () => {
    const r = rig();
    r.tac.update(state({ weaponName: 'MK18', otherName: 'M9' }));
    expect(r.primary.textContent).toBe('MK18');
    expect(r.secondary.textContent).toBe('M9');
  });

  it('writes neither while the names are the same', () => {
    const r = rig();
    r.tac.update(state({ weaponName: 'MK18' }));
    r.primary.textContent = 'TOUCHED';
    r.tac.update(state({ weaponName: 'MK18' }));
    expect(r.primary.textContent).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the gear

describe('update: the equipment slots', () => {
  it('shortens the known ids and uppercases anything else', () => {
    const r = rig();
    r.tac.update(state({ lethalId: 'frag', lethalCount: 2, tacticalId: 'flashbang', tacticalCount: 1 }));
    expect(r.lethalLabel.textContent).toBe('FRAG');
    expect(r.tacticalLabel.textContent).toBe('FLASH');

    r.tac.update(state({ lethalId: 'semtex', tacticalId: 'smoke' }));
    expect(r.lethalLabel.textContent).toBe('SEMTEX');
    expect(r.tacticalLabel.textContent).toBe('SMOKE');

    r.tac.update(state({ lethalId: 'claymore' }));
    expect(r.lethalLabel.textContent).toBe('CLAY');

    // Nothing in the table: the id itself, uppercased, rather than an empty slot.
    r.tac.update(state({ lethalId: 'thermite' }));
    expect(r.lethalLabel.textContent).toBe('THERMITE');
  });

  it('writes the count and marks an empty slot', () => {
    const r = rig();
    r.tac.update(state({ lethalCount: 2, tacticalCount: 0 }));
    expect(r.lethalCount.textContent).toBe('2');
    expect(r.lethalCount.tokens.has('is-empty')).toBe(false);
    expect(r.tacticalCount.textContent).toBe('0');
    expect(r.tacticalCount.tokens.has('is-empty')).toBe(true);
  });

  it('comes off the empty mark when the count comes back', () => {
    const r = rig();
    r.tac.update(state({ lethalCount: 0 }));
    expect(r.lethalCount.tokens.has('is-empty')).toBe(true);
    r.tac.update(state({ lethalCount: 1 }));
    expect(r.lethalCount.tokens.has('is-empty')).toBe(false);
  });

  it('guards on the label and the count together, so either one repaints the slot', () => {
    const r = rig();
    r.tac.update(state({ lethalId: 'frag', lethalCount: 2 }));
    r.lethalLabel.textContent = 'TOUCHED';
    r.tac.update(state({ lethalId: 'frag', lethalCount: 2 }));
    expect(r.lethalLabel.textContent).toBe('TOUCHED');
    r.tac.update(state({ lethalId: 'frag', lethalCount: 1 }));
    expect(r.lethalLabel.textContent).toBe('FRAG');
  });

  it('keeps the two slots independent', () => {
    const r = rig();
    r.tac.update(state({ lethalId: 'semtex', lethalCount: 3, tacticalId: 'smoke', tacticalCount: 1 }));
    expect(r.lethalCount.textContent).toBe('3');
    expect(r.tacticalCount.textContent).toBe('1');
  });
});

// ---------------------------------------------------------------------------- the field upgrade

describe('update: the field upgrade', () => {
  it('writes the name and draws the charge as a fill', () => {
    const r = rig();
    r.tac.update(state({ fieldUpgradeName: 'TROPHY', fieldUpgradeCharge: 0.5 }));
    expect(r.upgradeLabel.textContent).toBe('TROPHY');
    expect(r.upgradeFill.style.transform).toBe('scaleX(0.50)');
  });

  it('marks the slot ready only at a full charge', () => {
    const r = rig();
    r.tac.update(state({ fieldUpgradeCharge: 0.99 }));
    expect(r.upgradeSlot.tokens.has('is-ready')).toBe(false);
    r.tac.update(state({ fieldUpgradeCharge: 1 }));
    expect(r.upgradeSlot.tokens.has('is-ready')).toBe(true);
  });

  it('clamps a charge outside 0..1', () => {
    const r = rig();
    r.tac.update(state({ fieldUpgradeCharge: 4 }));
    expect(r.upgradeFill.style.transform).toBe('scaleX(1.00)');
    r.tac.update(state({ fieldUpgradeCharge: -1 }));
    expect(r.upgradeFill.style.transform).toBe('scaleX(0.00)');
  });

  it('quantises to a hundredth, so a bar moving a percent a second writes once', () => {
    const r = rig();
    r.tac.update(state({ fieldUpgradeCharge: 0.5 }));
    r.upgradeFill.style.transform = 'TOUCHED';
    r.tac.update(state({ fieldUpgradeCharge: 0.502 }));
    expect(r.upgradeFill.style.transform).toBe('TOUCHED');
    r.tac.update(state({ fieldUpgradeCharge: 0.51 }));
    expect(r.upgradeFill.style.transform).toBe('scaleX(0.51)');
  });
});

// ---------------------------------------------------------------------------- the cook bar

describe('update: the cook bar', () => {
  it('writes no opacity at all on a quiet first frame — the stylesheet holds it down', () => {
    // `.hud-cook { opacity: 0 }` in hud.css, and `cookShown` starts false, so a frame with
    // nothing cooking is a frame with no write. The bar is never visible unguarded.
    const r = rig();
    r.tac.update(state({ cookRemaining: 0 }));
    expect(r.cookBar.style.opacity).toBe('');
  });

  it('comes up and drains over the fuse', () => {
    const r = rig();
    r.tac.update(state({ cookRemaining: 1.5, cookTotal: 3 }));
    expect(r.cookBar.style.opacity).toBe('1');
    expect(r.cookFill.style.transform).toBe('scaleX(0.500)');
  });

  it('goes critical under one second left', () => {
    const r = rig();
    r.tac.update(state({ cookRemaining: 1.2, cookTotal: 3 }));
    expect(r.cookFill.tokens.has('is-critical')).toBe(false);
    r.tac.update(state({ cookRemaining: 0.9, cookTotal: 3 }));
    expect(r.cookFill.tokens.has('is-critical')).toBe(true);
  });

  it('survives a fuse of zero rather than dividing by it', () => {
    const r = rig();
    r.tac.update(state({ cookRemaining: 0.5, cookTotal: 0 }));
    expect(r.cookFill.style.transform).toBe('scaleX(1.000)');
  });

  it('goes back down when the grenade leaves the hand', () => {
    const r = rig();
    r.tac.update(state({ cookRemaining: 1, cookTotal: 3 }));
    r.tac.update(state({ cookRemaining: 0 }));
    expect(r.cookBar.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------- the breath bar

describe('update: the breath bar', () => {
  it('needs a scope and a fraction past 0.4', () => {
    const r = rig();
    // Same as the cook bar: `.hud-breath { opacity: 0 }` is the resting state, so neither of
    // the two refusals below writes anything.
    r.tac.update(state({ hasScope: false, scopeFraction: 1 }));
    expect(r.breathBar.style.opacity).toBe('');
    r.tac.update(state({ hasScope: true, scopeFraction: 0.4 }));
    expect(r.breathBar.style.opacity).toBe('');
    r.tac.update(state({ hasScope: true, scopeFraction: 0.41 }));
    expect(r.breathBar.style.opacity).toBe('1');
  });

  it('draws what is left of the breath, and marks it while it is held', () => {
    const r = rig();
    r.tac.update(state({ hasScope: true, scopeFraction: 1, breath: 0.25, breathHeld: true }));
    expect(r.breathFill.style.transform).toBe('scaleX(0.250)');
    expect(r.breathFill.tokens.has('is-held')).toBe(true);
    r.tac.update(state({ hasScope: true, scopeFraction: 1, breath: 0.25, breathHeld: false }));
    expect(r.breathFill.tokens.has('is-held')).toBe(false);
  });

  it('clamps a breath outside 0..1', () => {
    const r = rig();
    r.tac.update(state({ hasScope: true, scopeFraction: 1, breath: 9 }));
    expect(r.breathFill.style.transform).toBe('scaleX(1.000)');
  });
});

// ---------------------------------------------------------------------------- flash and scope

describe('update: the flash white-out', () => {
  it('writes the clamped value', () => {
    const r = rig();
    r.tac.update(state({ flash: 0.5 }));
    expect(r.flash.style.opacity).toBe('0.500');
    r.tac.update(state({ flash: 3 }));
    expect(r.flash.style.opacity).toBe('1.000');
  });

  it('ignores a move of under a hundredth', () => {
    const r = rig();
    r.tac.update(state({ flash: 0.5 }));
    r.flash.style.opacity = 'TOUCHED';
    r.tac.update(state({ flash: 0.505 }));
    expect(r.flash.style.opacity).toBe('TOUCHED');
    r.tac.update(state({ flash: 0.52 }));
    expect(r.flash.style.opacity).toBe('0.520');
  });
});

describe('update: the scope tube', () => {
  it('stays clear until the ADS fraction reaches 0.55', () => {
    const r = rig();
    r.tac.update(state({ scopeFraction: 0.5 }));
    expect(r.scope.style.opacity).toBe('0.000');
  });

  it('ramps from there to full, which is the non-linear hand-off', () => {
    const r = rig();
    r.tac.update(state({ scopeFraction: 0.775 }));
    expect(r.scope.style.opacity).toBe('0.500');
    r.tac.update(state({ scopeFraction: 1 }));
    expect(r.scope.style.opacity).toBe('1.000');
  });

  it('ignores a move of under a hundredth of the ADS fraction', () => {
    const r = rig();
    r.tac.update(state({ scopeFraction: 0.8 }));
    r.scope.style.opacity = 'TOUCHED';
    r.tac.update(state({ scopeFraction: 0.805 }));
    expect(r.scope.style.opacity).toBe('TOUCHED');
  });
});

// ---------------------------------------------------------------------------- the two arrows

describe('update: the bearing arrows', () => {
  it('points the threat arrow at a whole degree and leaves the objective one down', () => {
    const r = rig();
    r.tac.update(state({ threatActive: true, threatBearingRad: Math.PI / 2 }));
    expect(r.threatArrow.style.opacity).toBe('1');
    expect(r.threatArrow.style.transform).toBe('rotate(90deg)');
    expect(r.objectiveArrow.style.opacity).toBe('0');
  });

  it('drives both at once, because a grenade can land beside the bomb', () => {
    const r = rig();
    r.tac.update(state({
      threatActive: true,
      threatBearingRad: -Math.PI,
      objectiveActive: true,
      objectiveBearingRad: Math.PI / 4,
    }));
    expect(r.threatArrow.style.transform).toBe('rotate(-180deg)');
    expect(r.objectiveArrow.style.transform).toBe('rotate(45deg)');
  });

  it('takes an arrow down when its target goes away', () => {
    const r = rig();
    r.tac.update(state({ threatActive: true, threatBearingRad: 0 }));
    r.tac.update(state({ threatActive: false }));
    expect(r.threatArrow.style.opacity).toBe('0');
  });
});

// ---------------------------------------------------------------------------- reset

describe('reset', () => {
  it('puts the overlays and both arrows away and forgets their guards', () => {
    const r = rig();
    r.tac.update(state({
      flash: 0.6,
      scopeFraction: 1,
      cookRemaining: 1,
      cookTotal: 2,
      hasScope: true,
      threatActive: true,
      threatBearingRad: 1,
      objectiveActive: true,
      objectiveBearingRad: 1,
    }));
    r.tac.reset();
    expect(r.flash.style.opacity).toBe('0');
    expect(r.scope.style.opacity).toBe('0');
    expect(r.cookBar.style.opacity).toBe('0');
    expect(r.breathBar.style.opacity).toBe('0');
    expect(r.threatArrow.style.opacity).toBe('0');
    expect(r.objectiveArrow.style.opacity).toBe('0');

    // And the guards are gone, so the same numbers write again next match.
    r.tac.update(state({ flash: 0.6, scopeFraction: 1, cookRemaining: 1, cookTotal: 2, hasScope: true }));
    expect(r.flash.style.opacity).toBe('0.600');
    expect(r.scope.style.opacity).toBe('1.000');
    expect(r.cookBar.style.opacity).toBe('1');
    expect(r.breathBar.style.opacity).toBe('1');
  });
});
