/**
 * What is in the player's hands, and what it looks like.
 *
 * ## Why it is its own object
 *
 * Six different meshes can be in front of this camera — a weapon per inventory slot, a third
 * for whatever a killstreak lends you, the knife, a grenade per equipment id, and the riot
 * shield — and each of them has its own rule about when it is built, when it is rebuilt and
 * when it is on screen. None of those rules is about the match: they are about files arriving
 * late, about a slot that does not exist until a streak is spent, and about which single thing
 * the hands are doing this frame. That is one job, and before C24b it was spread across ten
 * methods of the composition root, forty lines of its constructor, ninety of its render pass
 * and a third of its teardown.
 *
 * ## The two rules the meshes here actually follow
 *
 * **Built up front, upgraded in place.** `models` is one mesh per inventory slot, both built at
 * construction and toggled by visibility, because building on demand would put a geometry merge
 * and a GPU upload on the frame the player presses the swap key — the one frame that must not
 * stutter. A slot whose file has not arrived starts on the primitives and swaps to the file
 * when it lands, without the weapon object, its ammunition or its state being touched.
 *
 * **Everything else is answered by looking.** Each late promise re-checks the slot rather than
 * trusting a flag kept in step with it: the match may have ended, the slot may hold a different
 * weapon by now, or a rebuild may already have happened. There is no state here that can get
 * stuck, which is the same discipline `syncChopperBody` follows in the simulation.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import type { MovementConfig } from '../shared/player/MovementConfig';
import type { AttachmentId } from '../shared/weapons/Attachments';
import type { ViewmodelConfig } from '../shared/weapons/ViewmodelConfig';
import { PISTOL_DEFAULT, type WeaponDef } from '../shared/weapons/WeaponDefs';
import type { CamoId } from '../shared/meta/Camos';
import type { ResolvedLoadout } from '../shared/meta/Loadouts';
import type { Fx } from './engine/Fx';
import type { FlameFx } from './engine/FlameFx';
import type { ViewmodelLayer } from './player/Viewmodel';
import { SCOPE_VIEWMODEL_HIDDEN } from './ui/HudTactical';
import { buildGrenadeModel, type GrenadeModel } from './weapons/GrenadeMesh';
import { buildKnifeModel, type KnifeModel } from './weapons/KnifeMesh';
import { buildShieldModel, type ShieldModel } from './weapons/ShieldMesh';
import { SHIELD_ASSET_ID } from './weapons/WeaponAssetCatalog';
import type { WeaponAssetService } from './weapons/WeaponAssetService';
import { buildWeaponModel, type WeaponModel } from './weapons/WeaponMesh';
import { ViewmodelAnim, makeViewmodelDrive, type ViewmodelDrive } from './weapons/ViewmodelAnim';
import type { Match } from './ClientMatch';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface MatchArsenalDeps {
  /** The match these hands belong to. Read only at tick and frame time, never at construction. */
  readonly match: Match;
  readonly viewmodel: ViewmodelLayer;
  /** `Game`'s long-lived weapon templates, or null where a match has no use for a file. */
  readonly weaponAssets: WeaponAssetService | null;
  readonly anisotropy: number;
  readonly viewmodelConfig: ViewmodelConfig;
  readonly movementConfig: MovementConfig;
  /** The muzzle follows the visible weapon; both of these are told where it is. */
  readonly fx: Fx;
  readonly flame: FlameFx;
  /** The class this match was built with: the two camos and the two attachment lists. */
  readonly loadout: ResolvedLoadout;
  readonly primary: WeaponDef;
  readonly secondary: WeaponDef;
}

/** What `replaceSlotMesh` answers: whether the old mesh was on screen, or null for no such slot. */
export type SlotWasVisible = boolean | null;
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * The inventory slot a carried killstreak borrows, as the viewmodel array indexes it.
 *
 * The same 2 `Inventory.STREAK_SLOT` uses, and spelled again here rather than imported because
 * what it means on this side is *"the third mesh"*: `models` is indexed by slot and this class
 * is the only thing that builds and disposes that one. If the two ever disagree the symptom is
 * immediate and local — a slot with no mesh draws the weapon that was there before it.
 */
const STREAK_VIEWMODEL_SLOT = 2;
//#endregion

// ===================================== CLASS MatchArsenal ===================================== \\
//#region Class MatchArsenal
export class MatchArsenal {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** One per inventory slot; only the active one is visible. */
  readonly models: WeaponModel[];

  /** The visible one. Reassigned on a swap. */
  model: WeaponModel;

  /** The knife viewmodel. Alongside the weapons rather than among them — see the constructor. */
  private knifeModel: KnifeModel;

  /**
   * The riot shield in the left hand (2026-09-27), or null when the player is not holding one.
   *
   * Not in `models`: that array is the inventory indexed by slot, and the shield is not a slot
   * — the slot it comes with holds a *pistol*, which is what the right hand is doing. This is
   * the same reasoning that keeps the knife out of the array, and the shield is built on demand
   * for the same reason the streak slot's own mesh is: a match cannot pre-build a mesh for
   * every streak a class might buy.
   */
  private shieldModel: ShieldModel | null = null;

  /**
   * The grenade in the hand (2026-09-24), one model per equipment id, built the first time
   * that id is thrown and kept for the match.
   *
   * Not an entry in `models` for the same reason the knife is not: that array is the
   * inventory, indexed by slot. A grenade is a thing you throw, and which one is in the hand
   * is the slot the player is cooking rather than the weapon they are carrying — so the
   * lethal and the tactical can both have a model and only one is ever on screen.
   */
  private readonly grenadeModels = new Map<string, GrenadeModel>();
  private grenadeShown: GrenadeModel | null = null;
  /** Equipment ids this match has already asked the service for, so it asks once. */
  private readonly grenadesRequested = new Set<string>();
  /** The camo each slot is wearing, so a rebuild does not lose it. */
  private readonly slotCamos: Array<CamoId | null> = [];
  /** The attachments each slot shows (M19, stage 2), kept for the same reason. */
  private readonly slotAttachments: Array<readonly AttachmentId[]> = [];

  private readonly anim: ViewmodelAnim;
  private readonly drive: ViewmodelDrive = makeViewmodelDrive();
  private readonly deps: MatchArsenalDeps;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: MatchArsenalDeps) {
    this.deps = deps;
    // One mesh per inventory slot, both built up front and toggled by visibility. Building
    // on demand would put a geometry merge and a GPU upload on the frame the player presses
    // the swap key, which is the one frame that must not stutter.
    this.slotCamos[0] = deps.loadout.primaryCamo;
    this.slotCamos[1] = deps.loadout.secondaryCamo;
    this.slotAttachments[0] = deps.loadout.primaryAttachments;
    this.slotAttachments[1] = deps.loadout.secondaryAttachments;
    this.models = [
      buildWeaponModel(deps.primary.id, deps.anisotropy, deps.loadout.primaryCamo, this.modelOptions(0, deps.primary.id)),
      buildWeaponModel(deps.secondary.id, deps.anisotropy, deps.loadout.secondaryCamo, this.modelOptions(1, deps.secondary.id)),
    ];
    for (const model of this.models) {
      deps.viewmodel.add(model.root);
      model.root.visible = false;
    }
    this.model = this.requireModel(0);
    this.model.root.visible = true;
    deps.fx.attachMuzzle(this.model.muzzle);
    deps.flame.setLocalMuzzle(this.model.muzzle, deps.viewmodel.camera);
    this.anim = new ViewmodelAnim(this.model);
    // A slot whose file has not arrived starts on the primitives and upgrades in place when it
    // does (M19). `Game` warms the equipped class while the menu is up, so this is usually a
    // no-op; when it is not, the match starts rather than waiting on a download.
    this.models.forEach((_, slot) => this.upgradeWhenLoaded(slot));

    /**
     * The knife (round 2). One static model, built with the weapons and hidden until it swings.
     *
     * Not an entry in `models`: that array is the inventory, indexed by slot, and everything
     * that walks it — `equip`, `showSlot`, the camo bookkeeping — would have to special-case a
     * third element that is not a weapon. A knife is a thing you *do*, which is the same reason
     * `Melee` is not a `Weapon`; see the header of `weapons/Melee.ts`.
     */
    // The arms' rig goes in with the blade (stage 5): with it the knife is held by the same
    // gloved hand every weapon is, and the box fist and its cylinder arm are not built.
    this.knifeModel = buildKnifeModel(
      deps.anisotropy,
      deps.weaponAssets?.knife() ?? null,
      deps.weaponAssets?.hands() ?? null,
    );
    this.knifeModel.root.visible = false;
    deps.viewmodel.add(this.knifeModel.root);
    if (this.knifeModel.arm !== null) {
      this.knifeModel.arm.visible = false;
      deps.viewmodel.add(this.knifeModel.arm);
    }
    this.anim.setKnife(this.knifeModel.root, this.knifeModel.arm, this.knifeModel.hands);
    this.upgradeKnifeWhenLoaded();
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** Put the hands back where a fresh match starts them. Called when the match goes live. */
  reset(yaw: number, pitch: number): void {
    this.anim.reset(yaw, pitch);
  }

  /**
   * Rebuild one slot's mesh for a different weapon, keeping what the caller did not supply.
   *
   * Answers whether the old mesh was on screen, so the caller can put the new one back there
   * *after* the inventory has changed hands — or null when the slot does not exist, which is
   * the one case where nothing else should happen either.
   */
  replaceSlotMesh(
    slotIndex: number,
    def: WeaponDef,
    camo?: CamoId | null,
    attachments?: readonly AttachmentId[],
  ): SlotWasVisible {
    const old = this.models[slotIndex];
    if (old === undefined) return null;
    const wasVisible = old.root.visible;
    this.deps.viewmodel.remove(old.root);
    old.dispose();

    // `undefined` keeps whatever finish the slot already had; `null` strips it. The
    // distinction matters because M5's debug weapon picker calls this with two arguments
    // and has no idea camos exist — without it, opening the arsenal panel would silently
    // return a gold rifle to grey. The attachments follow the same rule (stage 2).
    const nextCamo = camo === undefined ? (this.slotCamos[slotIndex] ?? null) : camo;
    this.slotCamos[slotIndex] = nextCamo;
    if (attachments !== undefined) this.slotAttachments[slotIndex] = attachments;
    const model = buildWeaponModel(def.id, this.deps.anisotropy, nextCamo, this.modelOptions(slotIndex, def.id));
    this.models[slotIndex] = model;
    this.deps.viewmodel.add(model.root);
    model.root.visible = wasVisible;
    return wasVisible;
  }

  /** Show one slot's mesh and hide the rest. The shield rides the slot it came with. */
  showSlot(slotIndex: number): void {
    const model = this.models[slotIndex];
    if (model === undefined) return;
    for (const m of this.models) m.root.visible = m === model;
    // The shield rides the streak slot: it is the other half of what that slot holds, so it is
    // on screen exactly when the pistol it comes with is, and never on its own.
    if (this.shieldModel !== null) this.shieldModel.root.visible = slotIndex === STREAK_VIEWMODEL_SLOT;
    this.model = model;
    this.anim.setModel(model);
    this.deps.fx.attachMuzzle(model.muzzle);
    this.deps.flame.setLocalMuzzle(model.muzzle, this.deps.viewmodel.camera);
  }

  /**
   * Swap a slot's primitives for its file once the file lands (M19, stage 1).
   *
   * Only the mesh changes: the weapon object, its ammunition and its state are untouched,
   * which is what separates this from a re-equip. The checks before the rebuild are the ones a
   * late promise needs — the match may have ended, the slot may hold a different weapon by
   * now, or a rebuild may already have happened — and each is answered by looking at the slot
   * rather than by a flag kept in step with it.
   */
  upgradeWhenLoaded(slotIndex: number): void {
    const assets = this.deps.weaponAssets;
    const model = this.models[slotIndex];
    if (assets === null || model === undefined) return;
    const weaponId = model.weaponId;
    // The file to fetch is the *mesh's*, which is the weapon's own for all but the shield's
    // sidearm — asking for `streak_shield` here would fetch a plate for a slot drawing a pistol.
    const assetId = assetIdFor(weaponId);
    // Two files can upgrade a slot: the weapon's own, and the arms' (stage 4), which every
    // slot wears — the two LMGs, built from primitives, included.
    const wantsFile = model.source !== 'glb' && assets.statusFor(assetId) !== 'none';
    const wantsHands = model.hands === null;
    if (!wantsFile && !wantsHands) return;
    const waits: Promise<void>[] = [];
    if (wantsFile) waits.push(assets.preload(assetId));
    if (wantsHands) waits.push(assets.preloadHands());
    void Promise.allSettled(waits).then(() => this.adoptSlotFile(slotIndex, model, wantsFile, wantsHands));
  }

  /**
   * The viewmodel for the slot a killstreak borrows (2026-09-27).
   *
   * `models` is built up front, one mesh per inventory slot, *"because building on demand would
   * put a geometry merge and a GPU upload on the frame the player presses the swap key"*. A
   * carried streak is the one weapon that cannot work that way: the slot does not exist until a
   * streak is spent and stops existing when it ends, and a match cannot pre-build a mesh for
   * every streak weapon a class might buy.
   *
   * So this slot alone is built on arrival — and the cost lands in the right place, because the
   * hands are already a second into a swap-in the streak's own `swapInTime` is holding open. The
   * minigun's 1.1 s spin-up and the shield's 1.2 s raise are not decoration here.
   *
   * Before this, `models[2]` was simply absent: `showSlot` looked the slot up, found nothing and
   * returned, and the mesh left on screen was whatever the player had been holding — a minigun
   * that looked like a carbine and a riot shield that looked like a rifle. The slab and the
   * sidearm are the same placeholders the bodies wear; what changes is that the hands now hold
   * the thing the game thinks they are holding.
   *
   * Driven from the **inventory** rather than from the streak, deliberately: the slot outlives
   * the streak by the length of a put-away, and disposing the mesh on the tick the clock ran out
   * would take it out of hands that are still lowering it.
   */
  syncStreakModel(): void {
    const inventory = this.deps.match.weapons.inventory;
    const held = inventory.at(STREAK_VIEWMODEL_SLOT)?.definition ?? null;
    const wantId = held?.id ?? null;
    const current = this.models[STREAK_VIEWMODEL_SLOT];
    if ((current?.weaponId ?? null) === wantId) return;

    if (current !== undefined) {
      const wasVisible = current.root.visible;
      this.deps.viewmodel.remove(current.root);
      current.dispose();
      this.models.length = STREAK_VIEWMODEL_SLOT;
      // The hands are empty for one frame otherwise: the streak's mesh is gone and the slot the
      // inventory has already gone back to was last drawn before it was taken away.
      if (wasVisible) this.showSlot(inventory.activeSlotIndex);
    }
    if (held === null) return;

    const model = buildWeaponModel(
      held.id,
      this.deps.anisotropy,
      // No camo on a streak weapon: it is not in anybody's loadout and no challenge counts it.
      null,
      this.modelOptions(STREAK_VIEWMODEL_SLOT, held.id),
    );
    this.models[STREAK_VIEWMODEL_SLOT] = model;
    this.deps.viewmodel.add(model.root);
    model.root.visible = false;
    this.upgradeWhenLoaded(STREAK_VIEWMODEL_SLOT);
    this.syncShield(wantId);
  }

  /**
   * Assemble the pose the animator is driven by, once a frame.
   *
   * Nothing is derived here that `ViewmodelAnim` could derive for itself: every field is a fact
   * read off the system that owns it, written into one object that already exists (R7).
   */
  updateDrive(dt: number, yaw: number, pitch: number): void {
    const match = this.deps.match;
    const sim = match.playerSim;
    const weapon = match.weapons.weapon;
    const drive = this.drive;
    drive.raise = match.visual.raise;
    drive.adsFraction = match.visual.adsFraction;
    drive.reloading = weapon.reloading;
    drive.reloadFraction = match.visual.reloadFraction;
    drive.reloadEmpty = weapon.reloadEmpty;
    drive.visualPunch = match.visual.visualPunch;
    drive.visualLateral = match.visual.visualLateral;
    drive.tacSprint = sim.tacSprintActive;
    drive.slide = sim.slideActive;
    drive.throwing = match.equipment.thrower.busy;
    /**
     * The throw, as the animation reads it (2026-09-24).
     *
     * Two numbers straight off `ThrowController`, and nothing derived here: the cook the fuse
     * is burning, and how far the release's follow-through has run. `ViewmodelAnim` turns them
     * into a pose; it never turns a pose into a timing.
     */
    const thrower = match.equipment.thrower;
    // READY is the grenade up in the hand with the pin still in, which is the throw at zero.
    drive.throwCook = thrower.phase === 'IDLE' ? -1 : thrower.phase === 'READY' ? 0 : thrower.cook;
    drive.throwRelease = thrower.releaseFraction;
    this.showGrenade(
      !match.isPlayerDead && thrower.busy
        ? thrower.slot === 'lethal'
          ? match.equipment.inventory.lethal
          : match.equipment.inventory.tactical
        : null,
    );
    drive.swapping = match.weapons.inventory.swapping;
    drive.melee = match.melee.fraction;
    drive.bobPhase = sim.bobPhase;
    drive.speed = sim.speed;
    drive.speedRef = this.deps.movementConfig.sprintSpeed;
    drive.grounded = sim.grounded;
    drive.yaw = yaw;
    drive.pitch = pitch;
    this.anim.update(drive, this.deps.viewmodelConfig, dt);
  }

  /** Which single thing the hands are showing this frame: the weapon, the knife, or nothing. */
  updateVisibility(): void {
    const match = this.deps.match;
    const dead = match.isPlayerDead;
    // A dead player is not holding a rifle — and a scoped one is looking through an optic
    // rather than at a weapon, so the viewmodel hands off to the scope overlay (M7). See
    // `SCOPE_VIEWMODEL_HIDDEN`: the tube is a solid cylinder on the sight line and would
    // otherwise fill the middle of the scope picture.
    const def = match.weapons.weapon.definition;
    const scoped = def.scope !== undefined && match.visual.adsFraction >= SCOPE_VIEWMODEL_HIDDEN;
    /**
     * A knife swing takes the rifle off screen entirely (round 2).
     *
     * `melee.busy` is the same flag that sets `weapons.fireBlocked` in `simulate`, so what is
     * in frame and what the player can do are one fact read twice — the contract the throw
     * animation already follows. It is deliberately `busy` and not `fraction > 0`: the
     * fraction is zero on the first tick of a wind-up, and swapping the meshes a tick late
     * would show the rifle for one frame after the blade should have replaced it.
     */
    const knifing = !dead && match.melee.busy;
    /**
     * A grenade in the hand takes the weapon off screen, the way a knife swing does.
     *
     * Before the grenade had a model this was `drive.throwing` lowering the rifle out of frame
     * over a fifth of a second, which was enough when a throw lasted as long as a button press.
     * It is not enough now: a drawn grenade stays in the hand for as long as the player likes,
     * and the rifle would still be there beside it — along with the second pair of gloves that
     * hangs off it, since `ViewmodelHands` lives under the weapon's own root.
     *
     * The test is the grenade *model*, not `thrower.busy`: with no file for this equipment
     * there is nothing to put in the hand, and hiding the rifle would leave an empty screen.
     * That is the same fallback the throw had before any of this existed.
     */
    const grenadeInHand = this.grenadeShown !== null;
    this.model.root.visible = !dead && !scoped && !knifing && !grenadeInHand;
    this.knifeModel.root.visible = knifing;
    if (this.knifeModel.arm !== null) this.knifeModel.arm.visible = knifing;
  }

  /** Every mesh this object put in the viewmodel, taken out again and released. */
  dispose(): void {
    for (const model of this.models) {
      this.deps.viewmodel.remove(model.root);
      model.dispose();
    }
    this.models.length = 0;
    this.anim.setKnife(null, null, null);
    this.deps.viewmodel.remove(this.knifeModel.root);
    if (this.knifeModel.arm !== null) this.deps.viewmodel.remove(this.knifeModel.arm);
    this.knifeModel.dispose();
    if (this.shieldModel !== null) {
      this.anim.setShield(null);
      this.deps.viewmodel.remove(this.shieldModel.root);
      this.shieldModel.dispose();
      this.shieldModel = null;
    }
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private requireModel(index: number): WeaponModel {
    const model = this.models[index];
    if (model === undefined) throw new Error(`Match has no viewmodel for slot ${index}`);
    return model;
  }

  private modelOptions(
    slotIndex: number,
    weaponId: string,
  ): { hands: true; assets: WeaponAssetService | null; attachments: readonly AttachmentId[]; assetId: string } {
    return {
      hands: true,
      assets: this.deps.weaponAssets,
      attachments: this.slotAttachments[slotIndex] ?? [],
      assetId: assetIdFor(weaponId),
    };
  }

  /** The late half of `upgradeWhenLoaded`: what to do once the files have settled, or not. */
  private adoptSlotFile(
    slotIndex: number,
    model: WeaponModel,
    wantsFile: boolean,
    wantsHands: boolean,
  ): void {
    const assets = this.deps.weaponAssets;
    if (assets === null) return;
    const weaponId = model.weaponId;
    const assetId = assetIdFor(weaponId);
    const current = this.models[slotIndex];
    if (current === undefined || current !== model || current.weaponId !== weaponId) return;
    const fileArrived = wantsFile && assets.template(assetId) !== null;
    const handsArrived = wantsHands && assets.hands() !== null;
    if (!fileArrived && !handsArrived) return;
    const wasVisible = current.root.visible;
    this.deps.viewmodel.remove(current.root);
    current.dispose();
    const next = buildWeaponModel(weaponId, this.deps.anisotropy, this.slotCamos[slotIndex] ?? null, this.modelOptions(slotIndex, weaponId));
    this.models[slotIndex] = next;
    this.deps.viewmodel.add(next.root);
    next.root.visible = wasVisible;
    if (wasVisible) this.showSlot(slotIndex);
  }

  /**
   * The same in-place upgrade the weapons get, for the knife (stage 5).
   *
   * Two files can change what a knife looks like: its own blade and the arms' rig that holds
   * it. Both are warmed on the menu, so this is the case where a match started before they
   * landed — and a whole match swinging a box fist because a promise was 200 ms late is the
   * thing stage 1 built this shape to avoid. The rebuild is unconditional about visibility:
   * the knife is hidden except mid-swing, and `frame` puts the right one on screen next tick.
   */
  private upgradeKnifeWhenLoaded(): void {
    const assets = this.deps.weaponAssets;
    if (assets === null) return;
    const current = this.knifeModel;
    const wantsBlade = assets.knife() === null;
    const wantsHands = current.hands === null;
    if (!wantsBlade && !wantsHands) return;
    const waits: Promise<void>[] = [];
    if (wantsBlade) waits.push(assets.preloadKnife());
    if (wantsHands) waits.push(assets.preloadHands());
    void Promise.allSettled(waits).then(() => this.adoptKnifeFile(current));
  }

  /** The late half of `upgradeKnifeWhenLoaded`. The grenades go with it: they wear the same rig. */
  private adoptKnifeFile(current: KnifeModel): void {
    const assets = this.deps.weaponAssets;
    if (assets === null) return;
    // The two ways a late promise can arrive into a world that has moved on: the match is
    // over (`dispose` took the knife out of the viewmodel, so it has no parent) or another
    // upgrade got there first. Both are answered by looking, not by a flag.
    if (this.knifeModel !== current || current.root.parent === null) return;
    if (assets.knife() === null && assets.hands() === null) return;
    const wasVisible = this.knifeModel.root.visible;
    this.deps.viewmodel.remove(this.knifeModel.root);
    if (this.knifeModel.arm !== null) this.deps.viewmodel.remove(this.knifeModel.arm);
    this.knifeModel.dispose();
    for (const grenade of this.grenadeModels.values()) {
      this.deps.viewmodel.remove(grenade.root);
      grenade.dispose();
    }
    this.grenadeModels.clear();
    this.grenadeShown = null;
    this.knifeModel = buildKnifeModel(this.deps.anisotropy, assets.knife(), assets.hands());
    this.knifeModel.root.visible = wasVisible;
    this.deps.viewmodel.add(this.knifeModel.root);
    if (this.knifeModel.arm !== null) {
      this.knifeModel.arm.visible = wasVisible;
      this.deps.viewmodel.add(this.knifeModel.arm);
    }
    this.anim.setKnife(this.knifeModel.root, this.knifeModel.arm, this.knifeModel.hands);
  }

  /**
   * Put one equipment id in the hand, or nothing.
   *
   * Called every frame before the animator runs, because which grenade is being thrown is a
   * per-throw fact. A file that has not arrived means no grenade in the hand for this throw
   * and the weapon simply lowers, which is exactly what a throw looked like before this
   * existed — the fallback is the old behaviour rather than a box.
   */
  private showGrenade(equipmentId: string | null): void {
    const next = equipmentId === null ? null : this.grenadeFor(equipmentId);
    if (next !== this.grenadeShown) {
      if (this.grenadeShown !== null) this.grenadeShown.root.visible = false;
      this.grenadeShown = next;
      this.anim.setGrenade(next);
    }
    if (next !== null) next.root.visible = true;
  }

  private grenadeFor(equipmentId: string): GrenadeModel | null {
    const assets = this.deps.weaponAssets;
    const existing = this.grenadeModels.get(equipmentId);
    /**
     * Built already, and built with everything it needed.
     *
     * The second half of that test is the in-place upgrade the weapons have: a grenade built
     * in the window before the arms' file landed has no gloves, and without this it would keep
     * holding itself in mid-air for the rest of the match. Once the rig is there the model is
     * thrown away and built again, once.
     */
    if (existing !== undefined && (existing.hands !== null || (assets?.hands() ?? null) === null)) return existing;
    const template = assets?.equipment(equipmentId) ?? null;
    if (template === null) {
      /**
       * Ask for it, once, the way `EquipmentFx` asks for a body it has not seen.
       *
       * The menu warms the equipped class's two and that is what makes a match start ready
       * (`Game.warmWeaponAssets`). This is the other half: a class swapped between spawns
       * changes which two a match needs, and without a request here that grenade would never
       * arrive in the hand however many times it was drawn — `equipment()` only ever answers
       * with what somebody has already fetched.
       */
      if (assets !== null && !this.grenadesRequested.has(equipmentId)) {
        this.grenadesRequested.add(equipmentId);
        void assets.preloadEquipment(equipmentId).catch(() => undefined);
      }
      return existing ?? null;
    }
    if (existing !== undefined) {
      this.deps.viewmodel.remove(existing.root);
      existing.dispose();
    }
    const model = buildGrenadeModel(template, assets?.hands() ?? null);
    model.root.visible = false;
    this.deps.viewmodel.add(model.root);
    this.grenadeModels.set(equipmentId, model);
    return model;
  }

  /**
   * The shield in the other hand (2026-09-27).
   *
   * The streak that gives you a shield gives you a **pistol** with it, and the pistol is what
   * the slot above builds: `WeaponModelSpecs.streak_shield` has always described the sidearm,
   * "the half of it a first-person camera can see". The plate was the other half, and until now
   * the player could not see it — only the bodies around them could.
   *
   * So the shield is a second model hung beside that pistol, not instead of it, and the two
   * hands are split between them: the pistol keeps the right, and its **left arm is collapsed**
   * so the shield's own rig can hold the plate. Two rigs are on screen and each draws one arm;
   * without the collapse the left arm is drawn twice, once on the grip and once on the cuff.
   *
   * Where it sits on screen is `VIEWMODEL_OFFSETS.streak_shield` and nothing else — a plate has
   * no sight to land and no hip pose of its own. The hand tuner writes that row.
   */
  private syncShield(wantId: string | null): void {
    const want = wantId === SHIELD_ASSET_ID;
    if (!want) {
      if (this.shieldModel === null) return;
      this.anim.setShield(null);
      this.deps.viewmodel.remove(this.shieldModel.root);
      this.shieldModel.dispose();
      this.shieldModel = null;
      return;
    }
    if (this.shieldModel !== null) return;
    const assets = this.deps.weaponAssets;
    this.shieldModel = buildShieldModel(assets?.shield() ?? null, assets?.hands() ?? null);
    this.shieldModel.root.visible = false;
    this.deps.viewmodel.add(this.shieldModel.root);
    this.anim.setShield(this.shieldModel);
    // The pistol's left arm belongs to the plate now.
    this.models[STREAK_VIEWMODEL_SLOT]?.hands?.showArm('L', false);
    this.upgradeShieldWhenLoaded();
  }

  /**
   * Rebuild the shield once its file lands, the way the knife's upgrade does.
   *
   * The plate is built from whatever `WeaponAssetService` has when the streak is first picked
   * up, which on the first shield of a match is nothing: `preloadShield` is started here rather
   * than at match start because most matches never see one, and 0.4 MB fetched for every player
   * who never calls the streak is 0.4 MB the loadout's weapons wanted.
   *
   * Until it arrives the root is empty — no box stands in, because the *world* shield the body
   * wears is already drawn and a second slab in the viewmodel would be the same object twice.
   */
  private upgradeShieldWhenLoaded(): void {
    const assets = this.deps.weaponAssets;
    if (assets === null || assets === undefined) return;
    if (assets.shield() !== null && assets.hands() !== null) return;
    const current = this.shieldModel;
    void Promise.all([assets.preloadShield().catch(() => undefined), assets.preloadHands().catch(() => undefined)]).then(() => {
      // Answered by looking rather than by a flag: the streak may have ended, or the match.
      if (this.shieldModel !== current || current === null || current.root.parent === null) return;
      const wasVisible = current.root.visible;
      this.deps.viewmodel.remove(current.root);
      current.dispose();
      this.shieldModel = buildShieldModel(assets.shield(), assets.hands());
      this.shieldModel.root.visible = wasVisible;
      this.deps.viewmodel.add(this.shieldModel.root);
      this.anim.setShield(this.shieldModel);
      this.models[STREAK_VIEWMODEL_SLOT]?.hands?.showArm('L', false);
    });
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * Whose **mesh** a weapon draws, which is itself for all but one (2026-09-27).
 *
 * The riot shield streak hands you a pistol, and the human asked for the pistol the game
 * already has rather than the slab `WeaponModelSpecs.streak_shield` describes. It is still not
 * *that* pistol though — it is held in one hand beside a plate — so only the geometry is
 * borrowed and every tuned number (`HAND_POSES`, `VIEWMODEL_OFFSETS`) stays keyed to
 * `streak_shield`, which is what `WeaponModelOptions.assetId` is for.
 */
function assetIdFor(weaponId: string): string {
  return weaponId === SHIELD_ASSET_ID ? PISTOL_DEFAULT.id : weaponId;
}
//#endregion
