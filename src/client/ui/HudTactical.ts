/**
 * The M5 half of the HUD: equipment, the grenade indicator, the flash white-out, and the
 * scope (brief S6.1, S6.3).
 *
 * A separate class composed by `Hud` for the same reason `HudBanner`, `Killfeed` and
 * `Minimap` are — `Hud.ts` is already at S3's size limit and this is five more independent
 * widgets. Everything here follows the same rule as the rest of the HUD: per-frame writes
 * are `transform` and `opacity` only, and text is written only when the string changed.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { clamp01 } from '../../shared/core/MathUtil';
import { BearingIndicator } from './BearingIndicator';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface TacticalState {
  /** Active weapon name and which slot it came from, for the weapon plate. */
  weaponName: string;
  slotIndex: number;
  /** The other slot's name, dimmed under the active one. */
  otherName: string;

  lethalId: string;
  lethalCount: number;
  tacticalId: string;
  tacticalCount: number;
  /** Seconds of fuse left on a cooked grenade, or 0. */
  cookRemaining: number;
  cookTotal: number;

  /** 0..1 white-out. */
  flash: number;

  /** Live enemy lethal near the player. */
  threatActive: boolean;
  threatX: number;
  threatY: number;
  threatZ: number;
  /**
   * Screen bearing to that grenade, radians, 0 ahead and positive to the right.
   *
   * Computed by `MatchHud` through `shared/ui/ScreenProjection` rather than here (P9 follow-up).
   * The world position stays in this record because the *fact* is where the grenade is; the
   * angle is a view of it, and the view belongs to whoever holds the camera.
   */
  threatBearingRad: number;

  /**
   * Where the loose bomb is, when there is one to go and pick up (round 4, F2).
   *
   * Deliberately only the **loose** bomb. See `MatchObjectives.readBombBearing` for why a
   * carried one must never appear here: it would track a living enemy through walls.
   */
  objectiveActive: boolean;
  objectiveX: number;
  objectiveZ: number;
  /** Screen bearing to the loose bomb, radians. Same source as `threatBearingRad`. */
  objectiveBearingRad: number;

  /** 0 = irons, 1 = fully scoped. Draws the scope overlay. */
  scopeFraction: number;
  /** 0..1 breath remaining, and whether it is being held. */
  breath: number;
  breathHeld: boolean;
  hasScope: boolean;

  // -- M6 --------------------------------------------------------------------
  /** The equipped field upgrade's short name, and 0..1 of its charge. */
  fieldUpgradeName: string;
  fieldUpgradeCharge: number;
}

/** The weapon plate: the active name over the other slot's. */
interface WeaponPlate {
  readonly root: HTMLElement;
  readonly primary: HTMLElement;
  readonly secondary: HTMLElement;
}

/** One equipment slot — a label and a count. The lethal and the tactical are the same thing. */
interface GearSlot {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly count: HTMLElement;
}

/** The field upgrade's slot, whose charge is drawn behind its label rather than beside it. */
interface UpgradeSlot {
  readonly root: HTMLElement;
  readonly fill: HTMLElement;
  readonly label: HTMLElement;
}

/** A bar and the `i` that fills it. The cook timer and the breath meter are the same shape. */
interface BarPair {
  readonly bar: HTMLElement;
  readonly fill: HTMLElement;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * ADS fraction at which the scope tube starts closing in around the picture.
 *
 * The transition is deliberately non-linear: the weapon is visibly up before the vignette
 * arrives, so scoping reads as raising a rifle rather than as a screen effect.
 */
const SCOPE_OVERLAY_START = 0.55;

/**
 * ADS fraction past which the *weapon* stops being drawn (M7).
 *
 * A scoped weapon's tube is a solid cylinder standing exactly on the sight line, 0.17 m from
 * the eye — measured, not assumed. Below this fraction the player is looking *at* a rifle and
 * should see it; above it they are looking *through* an optic, and the honest picture is the
 * one the overlay draws. Without the hand-off the scope's clear centre is filled by the
 * weapon's own objective bell, which is the same defect the M6 playtest reported on the SMG's
 * red dot. Set above `SCOPE_OVERLAY_START` so the tube is already closing before the gun goes.
 */
export const SCOPE_VIEWMODEL_HIDDEN = 0.8;

/** Short labels. The HUD has no room for "FLASHBANG" next to a count. */
const EQUIPMENT_LABELS: Readonly<Record<string, string>> = {
  frag: 'FRAG',
  semtex: 'SEMTEX',
  flashbang: 'FLASH',
  smoke: 'SMOKE',
  claymore: 'CLAY',
};
//#endregion

// ===================================== CLASS HudTactical ====================================== \\
//#region Class HudTactical
export class HudTactical {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly element: HTMLElement;
  readonly flashElement: HTMLElement;
  readonly scopeElement: HTMLElement;
  /**
   * Two arrows, one component (round 4, F2).
   *
   * The grenade warning and the bomb marker are the same widget pointed at different things,
   * and they can be live at once — a grenade lands beside the bomb you are running for — so
   * they are two instances rather than one element with two writers.
   */
  private readonly threatArrow = new BearingIndicator('threat');
  private readonly objectiveArrow = new BearingIndicator('objective');

  private readonly weaponPrimary: HTMLElement;
  private readonly weaponSecondary: HTMLElement;
  private readonly lethalLabel: HTMLElement;
  private readonly lethalCount: HTMLElement;
  private readonly tacticalLabel: HTMLElement;
  private readonly tacticalCount: HTMLElement;
  private readonly cookBar: HTMLElement;
  private readonly cookFill: HTMLElement;
  private readonly breathBar: HTMLElement;
  private readonly breathFill: HTMLElement;
  private readonly upgradeSlot: HTMLElement;
  private readonly upgradeLabel: HTMLElement;
  private readonly upgradeFill: HTMLElement;

  private lastUpgrade = '';
  private lastCharge = -1;
  private lastWeapon = '';
  private lastOther = '';
  private lastLethal = '';
  private lastTactical = '';
  private lastFlash = -1;
  private lastScope = -1;
  private cookShown = false;
  private breathShown = false;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'hud-tac';

    const weapons = this.createWeaponPlate();
    this.weaponPrimary = weapons.primary;
    this.weaponSecondary = weapons.secondary;

    const gear = document.createElement('div');
    gear.className = 'hud-tac__gear';
    const lethal = this.createGearSlot();
    this.lethalLabel = lethal.label;
    this.lethalCount = lethal.count;
    const tactical = this.createGearSlot();
    this.tacticalLabel = tactical.label;
    this.tacticalCount = tactical.count;
    const upgrade = this.createUpgradeSlot();
    this.upgradeSlot = upgrade.root;
    this.upgradeFill = upgrade.fill;
    this.upgradeLabel = upgrade.label;
    gear.append(lethal.root, tactical.root, this.upgradeSlot);

    this.element.append(weapons.root, gear);

    // The cook bar sits under the crosshair rather than with the gear: it is a timer you
    // are watching while aiming, and a player looking at the corner of the screen with a
    // live grenade in their hand has already lost.
    const cook = this.createBar('hud-cook');
    this.cookBar = cook.bar;
    this.cookFill = cook.fill;

    const breath = this.createBar('hud-breath');
    this.breathBar = breath.bar;
    this.breathFill = breath.fill;

    this.flashElement = this.createFlashLayer();
    this.scopeElement = this.createScopeLayer();
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** Every element this owns, in the order `Hud` should append them. */
  get layers(): readonly HTMLElement[] {
    return [
      this.scopeElement,
      this.element,
      this.cookBar,
      this.breathBar,
      this.threatArrow.element,
      this.objectiveArrow.element,
      this.flashElement,
    ];
  }

  /**
   * One frame. `playerYaw` turns the threat's world position into a screen-relative
   * bearing, which is the same maths the directional hit indicator uses.
   */
  update(state: TacticalState): void {
    if (state.weaponName !== this.lastWeapon) {
      this.lastWeapon = state.weaponName;
      this.weaponPrimary.textContent = state.weaponName;
    }
    if (state.otherName !== this.lastOther) {
      this.lastOther = state.otherName;
      this.weaponSecondary.textContent = state.otherName;
    }

    const lethalText = `${equipmentLabel(state.lethalId)} ${state.lethalCount}`;
    if (lethalText !== this.lastLethal) {
      this.lastLethal = lethalText;
      this.writeGearSlot(this.lethalLabel, this.lethalCount, state.lethalId, state.lethalCount);
    }
    const tacticalText = `${equipmentLabel(state.tacticalId)} ${state.tacticalCount}`;
    if (tacticalText !== this.lastTactical) {
      this.lastTactical = tacticalText;
      this.writeGearSlot(this.tacticalLabel, this.tacticalCount, state.tacticalId, state.tacticalCount);
    }

    if (state.fieldUpgradeName !== this.lastUpgrade) {
      this.lastUpgrade = state.fieldUpgradeName;
      this.upgradeLabel.textContent = state.fieldUpgradeName;
    }
    // Quantised to a hundredth: the charge changes every tick and a `style` write per
    // frame for a bar that moves 1% a second is a DOM write nobody can see.
    const charge = Math.round(clamp01(state.fieldUpgradeCharge) * 100) / 100;
    if (charge !== this.lastCharge) {
      this.lastCharge = charge;
      this.upgradeFill.style.transform = `scaleX(${charge.toFixed(2)})`;
      this.upgradeSlot.classList.toggle('is-ready', charge >= 1);
    }

    this.updateCook(state);
    this.updateBreath(state);
    this.threatArrow.update(state.threatActive, state.threatBearingRad);
    this.objectiveArrow.update(state.objectiveActive, state.objectiveBearingRad);
    this.updateFlash(state.flash);
    this.updateScope(state.scopeFraction);
  }

  reset(): void {
    this.lastFlash = -1;
    this.lastScope = -1;
    this.flashElement.style.opacity = '0';
    this.scopeElement.style.opacity = '0';
    this.threatArrow.reset();
    this.objectiveArrow.reset();
    this.cookBar.style.opacity = '0';
    this.breathBar.style.opacity = '0';
    this.cookShown = false;
    this.breathShown = false;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private createWeaponPlate(): WeaponPlate {
    const root = document.createElement('div');
    root.className = 'hud-tac__weapons';
    const primary = document.createElement('span');
    primary.className = 'hud-tac__weapon op-label';
    const secondary = document.createElement('span');
    secondary.className = 'hud-tac__weapon hud-tac__weapon--alt op-label';
    root.append(primary, secondary);
    return { root, primary, secondary };
  }

  private createGearSlot(): GearSlot {
    const root = document.createElement('div');
    root.className = 'hud-tac__slot';
    const label = document.createElement('span');
    label.className = 'hud-tac__slot-label op-label';
    const count = document.createElement('span');
    count.className = 'hud-tac__slot-count op-num';
    root.append(label, count);
    return { root, label, count };
  }

  /**
   * The field upgrade is a slot like the other two, with its charge drawn as a fill
   * behind the label rather than as a separate bar — it is the same kind of thing as a
   * grenade count and belongs in the same row (M6, S6.3).
   */
  private createUpgradeSlot(): UpgradeSlot {
    const root = document.createElement('div');
    root.className = 'hud-tac__slot hud-tac__slot--upgrade';
    const fill = document.createElement('i');
    fill.className = 'hud-tac__charge';
    const label = document.createElement('span');
    label.className = 'hud-tac__slot-label op-label';
    root.append(fill, label);
    return { root, fill, label };
  }

  private createBar(className: string): BarPair {
    const bar = document.createElement('div');
    bar.className = className;
    const fill = document.createElement('i');
    bar.appendChild(fill);
    return { bar, fill };
  }

  private createFlashLayer(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hud-flash';
    el.style.opacity = '0';
    return el;
  }

  private createScopeLayer(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'hud-scope';
    el.style.opacity = '0';
    const reticle = document.createElement('i');
    reticle.className = 'hud-scope__reticle';
    el.appendChild(reticle);
    return el;
  }

  /** The three writes a slot makes. Both slots make them; only the guard above differs. */
  private writeGearSlot(label: HTMLElement, count: HTMLElement, id: string, amount: number): void {
    label.textContent = equipmentLabel(id);
    count.textContent = amount.toString();
    count.classList.toggle('is-empty', amount <= 0);
  }

  private updateCook(state: TacticalState): void {
    const cooking = state.cookRemaining > 0;
    if (cooking !== this.cookShown) {
      this.cookShown = cooking;
      this.cookBar.style.opacity = cooking ? '1' : '0';
    }
    if (!cooking) return;
    const fraction = clamp01(state.cookRemaining / Math.max(state.cookTotal, 1e-3));
    this.cookFill.style.transform = `scaleX(${fraction.toFixed(3)})`;
    // Red once there is less than a second left, which is the only warning there is.
    this.cookFill.classList.toggle('is-critical', state.cookRemaining < 1);
  }

  private updateBreath(state: TacticalState): void {
    const show = state.hasScope && state.scopeFraction > 0.4;
    if (show !== this.breathShown) {
      this.breathShown = show;
      this.breathBar.style.opacity = show ? '1' : '0';
    }
    if (!show) return;
    this.breathFill.style.transform = `scaleX(${clamp01(state.breath).toFixed(3)})`;
    this.breathFill.classList.toggle('is-held', state.breathHeld);
  }

  private updateFlash(flash: number): void {
    const value = clamp01(flash);
    if (Math.abs(value - this.lastFlash) < 0.01) return;
    this.lastFlash = value;
    this.flashElement.style.opacity = value.toFixed(3);
  }

  private updateScope(fraction: number): void {
    const value = clamp01(fraction);
    if (Math.abs(value - this.lastScope) < 0.01) return;
    this.lastScope = value;
    // Deliberately non-linear: the tube arrives late in the transition so the weapon is
    // visibly coming up before the picture closes in around it.
    const opacity = value < SCOPE_OVERLAY_START ? 0 : (value - SCOPE_OVERLAY_START) / (1 - SCOPE_OVERLAY_START);
    this.scopeElement.style.opacity = opacity.toFixed(3);
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
export function makeTacticalState(): TacticalState {
  return {
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
  };
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
function equipmentLabel(id: string): string {
  return EQUIPMENT_LABELS[id] ?? id.toUpperCase();
}
//#endregion
