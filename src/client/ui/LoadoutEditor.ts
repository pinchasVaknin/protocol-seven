/**
 * Create-a-Class (brief S6.3; rebuilt on the design frame by M15, Phase B): the `LOADOUT`
 * state's screen.
 *
 * ## The shape (round 2, 2026-09-15)
 *
 * The operator on a lit disc on the left — the player's skin, holding the class's primary,
 * turning, the same `ActorAvatar` a match draws (`CharacterStage`) — and on the right **one
 * list**. Closed, the list is the six **category bars**, each showing only what is equipped:
 * PRIMARY, SECONDARY, EQUIPMENT (lethal and tactical), PERKS (three), KILLSTREAKS (three, each
 * with its key), FIELD UPGRADE — with the equipped weapon's silhouette or the category's
 * glyph at twice B2's size. Clicking a bar **replaces the whole list** with that category's
 * options, in the same bar shape, each with its own picture, name, blurb and state; a row of
 * tabs stands over the list where a category holds more than one thing to choose — WEAPON /
 * ATTACHMENTS / SKIN for the two weapons, LETHAL / TACTICAL, PERK 1 / 2 / 3, KEY 3 / 4 / 5 —
 * and a pager beside them, because a list longer than the column is **paged**, never
 * scrolled.
 *
 * ## The header, the strip, the action row (playtest round 3, R3; the row by M17, C5)
 *
 * The header and the footer are the shared chrome (`ScreenChrome.ts`): the mark, CREATE A
 * CLASS, and the player card with its gear and profile panel — exactly the menu's, with the
 * place's name changed, mounted on the viewport so the mark stands at the window's edge
 * (R1.1). The five classes are a **strip** of plates on a second row under the header,
 * spanning the frame: each plate carries its number and its name, so the five are read at
 * once rather than hovered for; the open one takes the accent and its name is the field it
 * is renamed in; the equipped one carries EQUIPPED at its right end, and the open one that is
 * not equipped carries the EQUIP action there instead, so the decision is where it is read
 * and nowhere else. The stage lost its two arrows — a drag is enough, and the drag now
 * carries its fling (`CharacterStage`).
 *
 * The two actions stand on the **action row** across the frame's foot, above the footer, on
 * the same bar Play Solo and Settings end on: it keeps the frame's two columns, so CHANGE A
 * SKIN is centred under the figure (R3.8) and SAVE AND EXIT sits under the list, and the
 * row is where SAVE / CANCEL take the skin toggle's cell while a category is open. The brief
 * (M17) found the two buttons *"thrown into the screen space"* — the toggle floating under
 * the figure, the exit alone at the right — and this is the template it asked for: one row,
 * two cells, one column each.
 *
 * ## Three states, and the stage answers the list
 *
 * A bar is grey-white at rest (a vertical gradient through the letters, which is as metallic
 * as type gets without an image), grows a few percent and whitens under the pointer — the
 * whole bar, picture included, with a gap between bars so the grown one covers nothing — and
 * takes the accent when it is the equipped option or the open category. A press changes its
 * colour and nothing else: a bar that shrinks under the pointer has to know when the pointer
 * left it, and that is a state machine for a button.
 *
 * While a weapon category is open the **weapon stands on the stage** where the operator did —
 * the `WeaponPreview` at stage size, spinning, showing the weapon under the pointer or the
 * equipped one in its finish — and SAVE / CANCEL stand under it: SAVE keeps what was picked
 * and returns to the categories; CANCEL puts the class back the way it was when the category
 * opened. The other categories keep the operator on the stage, there being no grenade or
 * perk to stand there (no assets, M12's first paragraph).
 *
 * ## What each box still means
 *
 * Every edit goes through `Profile.editLoadout`, which sanitises and persists — so the gating
 * this screen draws is a *courtesy*, and the enforcement is `sanitiseLoadout` behind it.
 * Locked content is drawn with its requirement rather than hidden (M5's rule); every
 * requirement comes from `UnlockState` (round 4, B7). `LoadoutStats`, *"the point of the
 * screen"* (M6), is a band under the weapon lists: the same `resolveLoadout` the match makes,
 * on every edit. The SKIN tab (the reference's word for what this project has called camo
 * since M5 — the label changed, `CamoId` did not) shows the finish on the weapon standing on
 * the stage, because a held weapon is one shared material and does not carry a camo.
 *
 * ## Built once, refreshed in place (playtest round 4, B11 — the mechanism, kept)
 *
 * `paint()` runs once per `show()`. Every mutable piece registers a closure in `refreshers`
 * and `refresh()` runs them; opening a category appends its list's closures after
 * `staticRefresherCount` and closing it truncates back. B11 built this so a scrolled list
 * survived an edit; there is no scroll now, and the test is that the open list's *page*
 * survives one. A rebuilt tree would also be a lost tooltip and a jumped list.
 *
 * ## One action, and it saves (playtest round 4, B5)
 *
 * The editor is a leaf off the main menu — `LEGAL_TRANSITIONS` admits `LOADOUT -> MENU` and
 * nothing else — so the one honest action is **Save and exit**, and the flush lives in the
 * state's exit handler where Escape passes through it too.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { ALL_EQUIPMENT, equipmentDef, type EquipmentId } from '../../shared/equipment/EquipmentDefs';
import { camoDef, CAMO_IDS } from '../../shared/meta/Camos';
import { fieldUpgradeDef, FIELD_UPGRADE_IDS } from '../../shared/meta/FieldUpgrades';
import { resolveLoadout, type LoadoutSlot, type WeaponLoadout } from '../../shared/meta/Loadouts';
import { camoPicture } from '../meta/CamoTextures';
import type { Profile } from '../meta/Profile';
import { attachmentsForWeapon, weaponLevelProgress } from '../../shared/meta/Unlocks';
import { STREAK_DEFS, streakDef } from '../../shared/streaks/StreakDefs';
import { perkDef, perksOfTier, PERK_TIERS, type PerkTier } from '../../shared/perks/PerkDefs';
import { attachmentDef, type AttachmentId } from '../../shared/weapons/Attachments';
import { ALL_WEAPONS, requireWeapon, type WeaponDef } from '../../shared/weapons/WeaponDefs';
import type { CharacterAssetService } from '../characters/CharacterAssetService';
import { BOT_CHARACTER_IDS, characterDefinition, type CharacterId } from '../characters/CharacterCatalog';
import { categoryIcon, CATEGORY_VIEWBOX, type CategoryIconId } from './CategoryIcons';
import { CharacterStage } from './CharacterStage';
import { createScreen } from './Frame';
import { LoadoutStats } from './LoadoutStats';
import { PlayerCard } from './PlayerCard';
import { ProfilePanel } from './ProfilePanel';
import { makeScreenFooter, makeScreenHeader, type ScreenPlace } from './ScreenChrome';
import { ICON_VIEWBOX, iconFor, makeIconSvg } from './WeaponIcons';
import { WeaponPreview } from './WeaponPreview';
import type { WeaponAssetService } from '../weapons/WeaponAssetService';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface LoadoutEditorDeps {
    readonly host: HTMLElement;
    readonly profile: Profile;
    /** The one way out. `Game` transitions to MENU; the state's exit handler flushes the save. */
    readonly onSaveAndExit: () => void;
    /** Texture anisotropy for the weapon preview and the held weapon. See `GameScreensDeps.anisotropy`. */
    readonly anisotropy: () => number;
    /** The skins, for the stage. The same service the match draws bodies from. */
    readonly characterAssets: CharacterAssetService;
    /** The weapon templates the preview draws from (M19); null where no file should be fetched. */
    readonly weaponAssets: WeaponAssetService | null;
    /** Whether a server is configured — the card's dot (R2.1). */
    readonly serverConfigured: () => boolean;
    /** The callsign's writer, for the profile panel's field (R2.2). */
    readonly onDisplayName: (name: string) => void;
}

type WeaponSlot = 'primary' | 'secondary';

/** One list of options: what the zone shows under one tab. */
type ListKind =
    | { kind: 'weapon'; slot: WeaponSlot }
    | { kind: 'attachments'; slot: WeaponSlot }
    | { kind: 'camo'; slot: WeaponSlot }
    | { kind: 'lethal' }
    | { kind: 'tactical' }
    | { kind: 'perk'; tier: PerkTier }
    | { kind: 'streak'; index: 0 | 1 | 2 }
    | { kind: 'field' };

type BoxKind = 'primary' | 'secondary' | 'equipment' | 'perks' | 'streaks' | 'field';

interface TabDef {
    readonly label: string;
    readonly list: ListKind;
}

interface BoxDef {
    readonly kind: BoxKind;
    readonly label: string;
    readonly tabs: readonly TabDef[];
}

/**
 * One thing a category bar says about what is equipped, and its rank (playtest round 3,
 * R4.1): a weapon box has one *lead* — the weapon — and its finish and attachments as
 * *details*; the other boxes hold *peers*, two grenades or three streaks that are each the
 * whole answer. The first chip used to be the lead in every box, which drew CARE PACKAGE as
 * an attachment of UAV.
 */
interface Chip {
    readonly text: string;
    readonly tip: string;
    readonly rank: 'lead' | 'peer' | 'detail';
    readonly empty?: boolean;
}

/**
 * One option bar, described whole.
 *
 * Every field past the name is a *predicate* rather than a value, which is the whole of the
 * B11 fix at this level: the element is built once and the closure decides what it says this
 * frame. `apply` is bound once and guarded by the same `isLocked` predicate the bar is drawn
 * from, so a bar that becomes locked stops responding without being rebuilt.
 */
interface Option {
    readonly name: string;
    readonly blurb: () => string;
    readonly isOn: () => boolean;
    readonly isLocked: () => boolean;
    readonly requirement: () => string;
    readonly apply: () => void;
    readonly icon: SVGSVGElement;
    /** A CSS image for a bar that *is* its picture — the camo bars (R4.5). The glyph slot collapses. */
    readonly pictureUrl?: string;
}

/** The pieces of an option bar its refresher writes into. */
interface BarParts {
    readonly el: HTMLButtonElement;
    readonly detail: HTMLElement;
    readonly lock: SVGSVGElement;
    readonly need: HTMLElement;
}

/** The pieces of a class plate its refresher writes into. */
interface PlateParts {
    readonly plate: HTMLElement;
    readonly name: HTMLInputElement;
    readonly tag: HTMLElement;
    readonly equip: HTMLElement;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const BOXES: readonly BoxDef[] = [
    {
        kind: 'primary',
        label: 'Primary',
        tabs: [
            { label: 'WEAPON', list: { kind: 'weapon', slot: 'primary' } },
            { label: 'ATTACHMENTS', list: { kind: 'attachments', slot: 'primary' } },
            { label: 'SKIN', list: { kind: 'camo', slot: 'primary' } },
        ],
    },
    {
        kind: 'secondary',
        label: 'Secondary',
        tabs: [
            { label: 'WEAPON', list: { kind: 'weapon', slot: 'secondary' } },
            { label: 'ATTACHMENTS', list: { kind: 'attachments', slot: 'secondary' } },
            { label: 'SKIN', list: { kind: 'camo', slot: 'secondary' } },
        ],
    },
    {
        kind: 'equipment',
        label: 'Equipment',
        tabs: [
            { label: 'LETHAL', list: { kind: 'lethal' } },
            { label: 'TACTICAL', list: { kind: 'tactical' } },
        ],
    },
    {
        kind: 'perks',
        label: 'Perks',
        tabs: [
            { label: 'PERK 1', list: { kind: 'perk', tier: 1 } },
            { label: 'PERK 2', list: { kind: 'perk', tier: 2 } },
            { label: 'PERK 3', list: { kind: 'perk', tier: 3 } },
        ],
    },
    {
        kind: 'streaks',
        label: 'Killstreaks',
        // Labelled with the key that spends each one (M7 playtest): six shipped streaks against
        // three keys is a collision only the loadout can resolve.
        tabs: [
            { label: 'KEY 3', list: { kind: 'streak', index: 0 } },
            { label: 'KEY 4', list: { kind: 'streak', index: 1 } },
            { label: 'KEY 5', list: { kind: 'streak', index: 2 } },
        ],
    },
    {
        kind: 'field',
        label: 'Field upgrade',
        tabs: [{ label: 'FIELD UPGRADE', list: { kind: 'field' } }],
    },
];

/** Design-frame pixels of the weapon preview on the stage: the stage's width, at the band's aspect. */
const STAGE_PREVIEW_WIDTH = 860;
/** 734 less the row the strip's foot needs: the body's height since the action row (M17, C5). */
const STAGE_PREVIEW_HEIGHT = 480;

/** The action row's glyphs, one path each in a 24-box: a figure, and the chevron the nav uses. */
const SKIN_GLYPH =
    'M12 2 a4 4 0 1 0 0 8 a4 4 0 1 0 0 -8 Z M12 4 a2 2 0 1 1 0 4 a2 2 0 1 1 0 -4 Z ' +
    'M5 22 v-5 a5 5 0 0 1 5 -5 h4 a5 5 0 0 1 5 5 v5 h-2 v-5 a3 3 0 0 0 -3 -3 h-4 a3 3 0 0 0 -3 3 v5 Z';
const CHEVRON_GLYPH = 'M9 4 L17 12 L9 20 L7.4 18.4 L13.8 12 L7.4 5.6 Z';

/**
 * Option bars a page holds: with the stat band under the list, and without (R3.5, decision 11:
 * 80 px bars with 8 px gaps — 8 × 80 + 7 × 8 + 8 = 704 in the 744 the list has without the
 * band, 6 × 80 + 5 × 8 + 8 = 528 in the 592 with one; the CSS comment at `.lo-right` carries
 * the same sum from the other side).
 */
const PAGE_WITH_BAND = 5;
const PAGE_FULL = 7;

/** The glyph a category bar shows when it has no weapon to show. */
const CATEGORY_GLYPH: Readonly<Record<BoxKind, CategoryIconId>> = {
    primary: 'attachment',
    secondary: 'attachment',
    equipment: 'equipment',
    perks: 'perk',
    streaks: 'streak',
    field: 'field',
};

/**
 * How long a pointer has to rest on a weapon bar before the operator picks the weapon up.
 *
 * A pointer crossing a page of bars on its way somewhere else would otherwise put four
 * weapons in the operator's hands in half a second, each one a template fetch.
 */
const HOVER_DEBOUNCE_MS = 50;

/**
 * The separator in a category bar's repaint key.
 *
 * A character no name can hold, so two different partitions of the same letters — a weapon
 * called `AB` with an attachment `C`, and one called `A` with an attachment `BC` — are two
 * different keys and the bar repaints between them.
 */
const CHIP_KEY_SEPARATOR = '\u001f';
//#endregion

// ==================================== CLASS LoadoutEditor ===================================== \\
//#region Class LoadoutEditor
export class LoadoutEditor {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
    private readonly deps: LoadoutEditorDeps;
    private readonly screen: HTMLElement;
    /** The window-sized box the header mounts on (R1.1). `screen` is the layer. */
    private readonly viewport: HTMLElement;
    /** The 1920x1080 box the editor is painted into (M15, A1). */
    private readonly frame: HTMLElement;
    private readonly card: PlayerCard;
    private readonly panel: ProfilePanel;
    private readonly stats = new LoadoutStats();
    private readonly preview: WeaponPreview;
    private readonly stage: CharacterStage;
    private readonly tip: HTMLElement;
    /** The stage's one line of status, written from `tick` because the body arrives between edits. */
    private stageStatus: HTMLElement | null = null;
    /** Whether the skin strip is open over the stage's foot (B5). */
    private skinsOpen = false;

    private slotIndex = 0;
    /** Editing the range's class, where every gate is lifted, rather than one of the five. See `show`. */
    private range = false;
    /**
     * The open category and tab, or null when the list shows the categories. `snapshot` is the
     * class as it was when the category opened, for CANCEL.
     */
    private open: { box: BoxDef; tab: number; snapshot: LoadoutSlot } | null = null;
    private page = 0;
    private pageCount = 1;
    /**
     * Everything on screen whose *value* can change without its *structure* changing. See the
     * class comment; this is B11's mechanism.
     */
    private readonly refreshers: (() => void)[] = [];
    private staticRefresherCount = 0;
    /** The list's three parts: the head (label, tabs, pager), the categories, the options. */
    private listHead: HTMLElement | null = null;
    private cats: HTMLElement | null = null;
    private opts: HTMLElement | null = null;
    /** The stat band under the list, shown for the weapon lists. */
    private band: HTMLElement | null = null;
    /** The stage's parts the weapon preview replaces; the skin toggle on the action row; SAVE / CANCEL beside it. */
    private stageParts: HTMLElement[] = [];
    private stageSkins: HTMLElement | null = null;
    private stageActions: HTMLElement | null = null;
    private readonly boxElements = new Map<BoxKind, HTMLElement>();
    /**
     * Which weapon the stage is holding, when it is not simply the slot's own.
     *
     * Set while the pointer or keyboard focus is on a weapon tile, so the operator holds the
     * weapon under the cursor (round 4, F15). Cleared on the way out.
     */
    private hoveredWeaponId: string | null = null;
    private hoverDebounceTimer: number | null = null;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
    constructor(deps: LoadoutEditorDeps) {
        this.deps = deps;
        this.preview = createStagePreview(deps);
        this.stage = new CharacterStage({ characterAssets: deps.characterAssets, anisotropy: deps.anisotropy, weaponAssets: deps.weaponAssets });
        const { layer, viewport, frame } = createScreen('op-screen lo');
        this.screen = layer;
        this.viewport = viewport;
        this.frame = frame;
        this.screen.hidden = true;
        this.tip = createTip();
        // A skin or a name picked in the panel is on the disc and on the card when it closes.
        this.panel = this.createProfilePanel();
        this.card = this.createPlayerCard();
        deps.host.appendChild(this.screen);
    }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
    /**
     * Repaint in place: what is unlocked has changed under the screen (M19, playtest 4's code).
     * Unlike `show`, the open list, the page and the slot are left where the player had them.
     */
    repaint(): void {
        if (this.screen.hidden) return;
        this.paint();
    }

    /**
     * Open the editor on the five classes, or — `range` — on the Shooting Range's own (2026-10-03).
     *
     * The caller says which, because only the caller knows which door was used. It used to be
     * read off the menu's mode selection, which outlives the page it was made on: a player who had
     * visited the testbed and gone back to the main menu got CREATE A CLASS on the range's hidden
     * slot, edited a class there, pressed PLAY and found the change nowhere (playtest, 2026-09-28).
     * The main menu's door is the five classes, always; the testbed plate's is the range's.
     */
    show(range = false): void {
        this.range = range;
        this.slotIndex = this.deps.profile.equippedIndex;
        this.open = null;
        this.page = 0;
        this.hoveredWeaponId = null;
        this.screen.hidden = false;
        this.skinsOpen = false;
        this.panel.close();
        this.paint();
        this.stage.show(this.deps.profile.skinId);
    }

    hide(): void {
        this.cancelHoverDebounce();
        this.screen.hidden = true;
        this.hideTip();
        this.panel.close();
        this.preview.release();
        this.stage.release();
    }

    /** Escape closes the profile panel if it is open, and is consumed by it; otherwise the screen's one exit is `Game`'s. */
    handleEscape(): boolean {
        return this.panel.handleEscape();
    }

    /**
     * One frame of the stage and the camo preview. Driven from `Game.draw`, not from a timer
     * of its own, so a turning operator nobody is looking at is a GPU nobody asked for.
     */
    tick(dt: number): void {
        if (this.screen.hidden) return;
        if (this.weaponOnStage()) this.preview.tick(dt);
        else this.stage.tick(dt);
        const status = this.stageStatus;
        if (status !== null) {
            const text = this.stage.ready ? '' : 'LOADING OPERATOR…';
            if (status.textContent !== text) status.textContent = text;
        }
    }

    /**
     * Open a box by kind and tab index — for the layout probe, which measures each one, and
     * for nothing else in the product; the boxes are clicked.
     */
    openBox(kind: BoxKind, tab = 0): void {
        const box = BOXES.find((b) => b.kind === kind);
        if (box === undefined) return;
        this.openCategory(box, tab);
        this.refresh();
    }

    /** Open the skin strip — for the layout probe, which measures it. */
    openSkins(): void {
        this.skinsOpen = true;
        this.refresh();
    }

    dispose(): void {
        this.preview.dispose();
        this.stage.dispose();
        this.screen.remove();
    }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
    /**
     * The slot being edited.
     *
     * In an unrestricted mode that is the range's own class rather than one of the five, so a
     * weapon tried on the range cannot follow the player into a match and a match class cannot
     * be trampled by an experiment (M7 playtest).
     */
    private get slot(): LoadoutSlot {
        if (this.range) return this.deps.profile.rangeLoadout();
        const found = this.deps.profile.loadouts[this.slotIndex];
        if (found === undefined) throw new Error(`Loadout slot ${this.slotIndex} does not exist`);
        return found;
    }

    private createProfilePanel(): ProfilePanel {
        return new ProfilePanel({
            profile: this.deps.profile,
            onDisplayName: this.deps.onDisplayName,
            onChange: () => this.card.refresh(),
            onClose: () => {
                this.card.refresh();
                this.stage.show(this.deps.profile.skinId);
                this.refresh();
            },
        });
    }

    private createPlayerCard(): PlayerCard {
        return new PlayerCard({
            profile: this.deps.profile,
            online: this.deps.serverConfigured,
            onOpenProfile: () => this.panel.open(),
        });
    }

    /** Build the screen. Called from `show()` and from nowhere else — see the class comment. */
    private paint(): void {
        this.refreshers.length = 0;
        this.boxElements.clear();
        this.open = null;

        const stage = this.paintStage();
        const right = this.createRightColumn();

        // The chrome on the viewport, the rest in the frame (R1.1); the panel's overlay last.
        this.frame.replaceChildren(this.paintStrip(), stage, right, this.paintActionRow(), this.tip);
        this.viewport.replaceChildren(this.paintHeader(), this.frame, makeScreenFooter('op-foot--frame', this.place()), this.panel.element);
        this.staticRefresherCount = this.refreshers.length;
        this.refresh();
    }

    /** The list column: the head, the list itself, and the stat band under it. */
    private createRightColumn(): HTMLElement {
        const right = document.createElement('div');
        right.className = 'lo-right';

        const head = document.createElement('div');
        head.className = 'lo-list-head';
        head.hidden = true;
        this.listHead = head;

        const list = document.createElement('div');
        list.className = 'lo-list';
        const cats = this.paintCategories();
        const opts = document.createElement('div');
        opts.className = 'lo-opts';
        opts.hidden = true;
        this.cats = cats;
        this.opts = opts;
        list.append(cats, opts);

        const band = document.createElement('div');
        band.className = 'lo-band';
        band.hidden = true;
        band.appendChild(this.stats.element);
        this.band = band;

        right.append(head, list, band);
        return right;
    }

    /** The shared header (`ScreenChrome.ts`): the mark and the wordmark, CREATE A CLASS with its subtitle, the player card. */
    private paintHeader(): HTMLElement {
        this.card.refresh();
        return makeScreenHeader('op-head--frame', this.place(), this.card.element);
    }

    /** What the chrome calls this screen. */
    private place(): ScreenPlace {
        return {
            title: 'CREATE A CLASS',
            subtitle: this.range
                ? 'SHOOTING RANGE — ALL CONTENT UNLOCKED, NO PROGRESS BANKED'
                : 'CUSTOMISE YOUR LOADOUT',
        };
    }

    /**
     * The class strip (R3.3): five plates under the header, one per slot, each with its number
     * and its name.
     *
     * The open plate takes the accent, and its name is the field it is renamed in — the
     * callsign's kind of field, a rule beneath while it is being written; the other four names
     * are labels. The equipped plate carries EQUIPPED at its right end; the open plate that is
     * not equipped carries the EQUIP action there instead. Changing slot closes the open list
     * and refreshes; it does not repaint — the plates, the boxes and the list are the same shape
     * whichever class is selected, only their *values* differ.
     */
    private paintStrip(): HTMLElement {
        const strip = document.createElement('div');
        strip.className = 'lo-strip';
        strip.setAttribute('role', 'tablist');
        strip.setAttribute('aria-label', 'Classes');
        this.deps.profile.loadouts.forEach((_slot, index) => strip.appendChild(this.createPlate(index)));
        return strip;
    }

    /** One plate: its number, the field its class is renamed in, and EQUIPPED or EQUIP. */
    private createPlate(index: number): HTMLElement {
        const plate = document.createElement('div');
        plate.className = 'lo-plate';
        plate.setAttribute('role', 'tab');
        plate.tabIndex = 0;
        this.bindPlateSelect(plate, index);

        const num = document.createElement('span');
        num.className = 'lo-plate__num op-num';
        num.textContent = String(index + 1);
        const name = this.createPlateName(index);
        const tag = document.createElement('span');
        tag.className = 'lo-plate__tag op-label';
        tag.textContent = 'EQUIPPED';
        const equip = this.createPlateEquip(index);
        plate.append(num, name, tag, equip);

        // Looked up rather than captured: `Profile.importSave` and `resetProgress` replace the
        // whole save object, and a closure holding the old slot would keep painting a class that
        // no longer exists.
        const parts: PlateParts = { plate, name, tag, equip };
        this.refreshers.push(() => this.writePlate(index, parts));
        return plate;
    }

    /** Clicking a plate, or pressing Enter or Space on it, selects its class. */
    private bindPlateSelect(plate: HTMLElement, index: number): void {
        const select = (): void => {
            if (index === this.slotIndex) return;
            this.slotIndex = index;
            this.closeList();
            this.refresh();
        };
        plate.addEventListener('click', select);
        plate.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                select();
            }
        });
    }

    private createPlateName(index: number): HTMLInputElement {
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'lo-plate__name';
        name.maxLength = 16;
        name.spellcheck = false;
        name.autocomplete = 'off';
        name.setAttribute('aria-label', `Class ${index + 1} name`);
        name.addEventListener('change', () => {
            const next = name.value.trim().toUpperCase().slice(0, 16);
            if (next.length === 0) return;
            this.edit((slot) => {
                slot.name = next;
            });
        });
        // The editor is a DOM surface over a canvas that owns the keyboard: without this, typing
        // "W" in the name walks nobody, but the shortcut keys 1-5 would change the slot — and
        // Enter or Space in the field must not re-select the plate.
        name.addEventListener('keydown', (e) => e.stopPropagation());
        return name;
    }

    private createPlateEquip(index: number): HTMLButtonElement {
        const equip = document.createElement('button');
        equip.type = 'button';
        equip.className = 'lo-plate__equip';
        equip.textContent = 'EQUIP';
        equip.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deps.profile.equipLoadout(index);
            this.refresh();
        });
        return equip;
    }

    /**
     * A plate's four values, from the profile.
     *
     * The name is never written over what is being typed: the field is its own writer while it
     * holds focus.
     */
    private writePlate(index: number, parts: PlateParts): void {
        const { plate, name, tag, equip } = parts;
        const on = index === this.slotIndex;
        const equipped = index === this.deps.profile.equippedIndex;
        plate.classList.toggle('is-on', on);
        plate.classList.toggle('is-equipped', equipped);
        plate.setAttribute('aria-selected', on ? 'true' : 'false');
        name.readOnly = !on;
        name.tabIndex = on ? 0 : -1;
        tag.hidden = !equipped;
        equip.hidden = equipped || !on;
        if (document.activeElement === name) return;
        const value = this.deps.profile.loadouts[index]?.name ?? '';
        if (name.value !== value) name.value = value;
    }

    /**
     * The action row (M17, C5): the frame's two columns, one cell each.
     *
     * Under the stage, CHANGE A SKIN — or SAVE / CANCEL while a category is open (one or the
     * other, never both; `refreshStage` decides). Under the list, the one exit (playtest round
     * 4, B5), which reads SAVE AND EXIT rather than BACK because that is what it does; there is
     * one destination, so there is one button.
     */
    private paintActionRow(): HTMLElement {
        const row = document.createElement('div');
        row.className = 'op-actionbar lo-row';

        const left = document.createElement('div');
        left.className = 'lo-row__cell lo-row__cell--stage';
        const toggle = this.paintSkinToggle();
        this.stageSkins = toggle;
        // SAVE keeps the picks and returns to the categories; CANCEL restores the snapshot first.
        const actions = document.createElement('div');
        actions.className = 'lo-row__actions';
        actions.hidden = true;
        const cancel = cta('CANCEL', () => this.cancelCategory());
        const save = cta('SAVE', () => this.saveCategory());
        save.classList.add('op-cta--primary');
        actions.append(cancel, save);
        this.stageActions = actions;
        left.append(toggle, actions);

        const right = document.createElement('div');
        right.className = 'lo-row__cell lo-row__cell--list';
        const exit = cta('SAVE AND EXIT', () => this.deps.onSaveAndExit());
        exit.classList.add('op-cta--primary', 'lo-exit');
        right.appendChild(exit);

        row.append(left, right);
        return row;
    }

    /**
     * The operator on the disc. The two arrows that turned it are gone (R3.6): a drag turns it,
     * and the drag carries its fling. The status line stands over the canvas's foot.
     */
    private paintStage(): HTMLElement {
        const wrap = document.createElement('section');
        wrap.className = 'lo-stage';

        const status = document.createElement('span');
        status.className = 'lo-stage__status op-label';
        status.textContent = 'LOADING OPERATOR…';
        this.stageStatus = status;

        const skins = this.paintSkinStrip();
        // The operator's parts, hidden together while a weapon stands in their place. The skin
        // toggle is on the action row (`paintActionRow`), where SAVE / CANCEL take its cell while
        // a category is open; the strip it opens stays here, over the canvas's foot.
        this.stageParts = [this.stage.canvas, status, skins];

        wrap.append(this.stage.canvas, status, this.preview.element, skins);
        return wrap;
    }

    /**
     * CHANGE A SKIN (B5): the toggle on the action row, centred under the figure (R3.8; on the
     * row since M17 C5). The strip it opens is `paintSkinStrip`'s, over the canvas.
     */
    private paintSkinToggle(): HTMLElement {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'op-cta op-cta--quiet lo-skins__toggle';
        toggle.appendChild(makeIconSvg(SKIN_GLYPH, '0 0 24 24', 'op-cta__lead'));
        const label = document.createElement('span');
        label.textContent = 'CHANGE A SKIN';
        toggle.appendChild(label);
        toggle.appendChild(makeIconSvg(CHEVRON_GLYPH, '0 0 24 24', 'op-cta__chevron lo-skins__chevron'));
        toggle.addEventListener('click', () => {
            this.skinsOpen = !this.skinsOpen;
            this.refresh();
        });
        this.refreshers.push(() => {
            toggle.classList.toggle('is-open', this.skinsOpen);
            toggle.setAttribute('aria-expanded', this.skinsOpen ? 'true' : 'false');
        });
        return toggle;
    }

    /**
     * The strip of every skin (B5), opened by the toggle on the action row.
     *
     * The strip lies *over* the canvas rather than under the toggle, so the column's height never
     * changes and the frame never has to. The thumbnails are `scripts/skin-thumbs.mjs`'s renders
     * — seven live stages would be seven contexts and the whole library fetched to open a menu.
     */
    private paintSkinStrip(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'lo-skins';

        const strip = document.createElement('div');
        strip.className = 'lo-skins__strip';
        strip.setAttribute('role', 'listbox');
        strip.setAttribute('aria-label', 'Skins');
        for (const id of BOT_CHARACTER_IDS) strip.appendChild(this.createSkinTile(id));

        this.refreshers.push(() => {
            wrap.classList.toggle('is-open', this.skinsOpen);
            strip.hidden = !this.skinsOpen;
        });

        wrap.appendChild(strip);
        return wrap;
    }

    /**
     * One skin's thumbnail and name.
     *
     * Picking writes the profile (a setting, kept across a progress reset like the callsign) and
     * puts the new body on the disc; other players see it since B6 (M16).
     */
    private createSkinTile(id: CharacterId): HTMLElement {
        const def = characterDefinition(id);
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'lo-skin';
        tile.setAttribute('role', 'option');
        const img = document.createElement('img');
        img.className = 'lo-skin__thumb';
        img.src = def.thumbUrl;
        img.alt = '';
        img.draggable = false;
        const name = document.createElement('span');
        name.className = 'lo-skin__name';
        name.textContent = def.name;
        tile.append(img, name);
        tile.addEventListener('click', () => {
            this.deps.profile.setSkin(id);
            this.stage.show(id);
            this.refresh();
        });
        this.refreshers.push(() => {
            const on = this.deps.profile.skinId === id;
            tile.classList.toggle('is-on', on);
            tile.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        return tile;
    }

    /** The six category bars, each showing only what is equipped. Clicking one opens its list. */
    private paintCategories(): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'lo-cats';
        for (const box of BOXES) {
            const el = this.createCategoryBar(box);
            this.boxElements.set(box.kind, el);
            wrap.appendChild(el);
        }
        return wrap;
    }

    private createCategoryBar(box: BoxDef): HTMLElement {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'lo-bar lo-bar--cat';
        el.dataset['box'] = box.kind;

        const icon = document.createElement('span');
        icon.className = 'lo-bar__icon';
        const text = document.createElement('span');
        text.className = 'lo-bar__text';
        const cat = document.createElement('span');
        cat.className = 'lo-bar__cat op-label';
        cat.textContent = box.label;
        const value = document.createElement('span');
        value.className = 'lo-bar__value';
        text.append(cat, value);
        const chevron = document.createElement('span');
        chevron.className = 'lo-bar__chevron';
        chevron.textContent = '›';
        el.append(icon, text, chevron);

        el.addEventListener('click', () => {
            this.openCategory(box, 0);
            this.refresh();
        });
        this.refreshers.push(() => this.paintBoxValue(box, icon, value));
        return el;
    }

    /**
     * What a box shows: a weapon's silhouette, name and finish; or chips, one per equipped
     * item, each with its explanation on hover (B4).
     */
    private paintBoxValue(box: BoxDef, icon: HTMLElement, value: HTMLElement): void {
        const chips: Chip[] = [];
        const weaponId = this.collectChips(box.kind, chips);
        writeBoxIcon(box.kind, icon, weaponId);
        this.writeBoxChips(value, chips);
    }

    /** The chips a box shows, and the weapon its icon is of where it has one. */
    private collectChips(kind: BoxKind, chips: Chip[]): string | null {
        const slot = this.slot;
        switch (kind) {
            case 'primary':
            case 'secondary':
                return this.collectWeaponChips(slot[kind], chips);
            case 'equipment':
                pushEquipmentChips(slot, chips);
                return null;
            case 'perks':
                pushPerkChips(slot, chips);
                return null;
            case 'streaks':
                pushStreakChips(slot, chips);
                return null;
            case 'field':
                pushFieldChips(slot, chips);
                return null;
        }
    }

    /** The weapon, then its finish and its attachments: one lead and the details under it. */
    private collectWeaponChips(weapon: WeaponLoadout, chips: Chip[]): string {
        const def = requireWeapon(weapon.weaponId);
        chips.push({ text: def.name, tip: this.weaponBlurb(def), rank: 'lead' });
        chips.push({
            text: weapon.camo === null ? 'FACTORY FINISH' : camoDef(weapon.camo).name,
            tip: weapon.camo === null ? 'No camouflage fitted' : camoDef(weapon.camo).requirement,
            rank: 'detail',
        });
        for (const id of weapon.attachments) {
            const a = attachmentDef(id);
            chips.push({ text: a.name, tip: `${a.benefit} — ${a.cost}`, rank: 'detail' });
        }
        return weapon.weaponId;
    }

    /**
     * Chips are rebuilt only when their text changes: a refresh after an unrelated edit
     * leaves them — and a tooltip open on one of them — alone.
     */
    private writeBoxChips(value: HTMLElement, chips: readonly Chip[]): void {
        const key = chips.map((c) => c.text).join(CHIP_KEY_SEPARATOR);
        if (value.dataset['key'] === key) return;
        value.dataset['key'] = key;
        value.replaceChildren(...chips.map((chip) => this.createChip(chip)));
    }

    private createChip(chip: Chip): HTMLElement {
        const span = document.createElement('span');
        span.className = chipClass(chip);
        span.textContent = chip.text;
        span.tabIndex = 0;
        this.attachTip(span, () => chip.tip);
        return span;
    }

    /**
     * Open a category at a tab: the list becomes that category's options, the head its label,
     * tabs and pager, the band its numbers where they apply. Switching tabs within the open
     * category keeps its snapshot; opening another takes a fresh one.
     */
    private openCategory(box: BoxDef, tab: number): void {
        const head = this.listHead;
        const opts = this.opts;
        const cats = this.cats;
        if (head === null || opts === null || cats === null) return;
        const snapshot = this.open?.box === box ? this.open.snapshot : cloneSlot(this.slot);
        this.closeList(false);
        const tabDef = box.tabs[tab] ?? box.tabs[0];
        if (tabDef === undefined) return;

        // The head: the category, its tabs, and the pager at the right end.
        const headParts = this.createListHead(box, tab);
        const withBand = isWeaponList(tabDef.list);
        const pageSize = withBand ? PAGE_WITH_BAND : PAGE_FULL;
        const options = this.optionsFor(tabDef.list);
        opts.replaceChildren(...options);
        this.page = 0;
        this.pageCount = Math.max(1, Math.ceil(options.length / pageSize));
        head.replaceChildren(...headParts, this.paintPager(options, pageSize));

        head.hidden = false;
        cats.hidden = true;
        opts.hidden = false;
        if (this.band !== null) this.band.hidden = !withBand;
        this.open = { box, tab, snapshot };
    }

    /** The head's first two cells: the category's name, and the row of its tabs. */
    private createListHead(box: BoxDef, tab: number): HTMLElement[] {
        const label = document.createElement('span');
        label.className = 'lo-list-head__label op-label';
        label.textContent = box.label;
        const tabs = document.createElement('div');
        tabs.className = 'op-tabs lo-list-head__tabs';
        box.tabs.forEach((t, index) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'op-tab';
            b.classList.toggle('op-tab--on', index === tab);
            b.textContent = t.label;
            b.addEventListener('click', () => {
                this.openCategory(box, index);
                this.refresh();
            });
            tabs.appendChild(b);
        });
        return [label, tabs];
    }

    /** SAVE: the picks stand; back to the categories. */
    private saveCategory(): void {
        this.closeList();
        this.refresh();
    }

    /** CANCEL: the class as it was when the category opened; back to the categories. */
    private cancelCategory(): void {
        const open = this.open;
        if (open === null) return;
        this.edit((slot) => assignSlot(slot, open.snapshot));
        this.closeList();
        this.refresh();
    }

    /** The page arrows and the count. Hidden when everything fits on one page. */
    private paintPager(options: readonly HTMLElement[], pageSize: number): HTMLElement {
        const pager = document.createElement('div');
        pager.className = 'lo-pager';
        const prev = arrowButton('‹', 'Previous page', () => {
            this.page = Math.max(0, this.page - 1);
            this.refresh();
        });
        const next = arrowButton('›', 'Next page', () => {
            this.page = Math.min(this.pageCount - 1, this.page + 1);
            this.refresh();
        });
        const count = document.createElement('span');
        count.className = 'lo-pager__count op-label';
        pager.append(prev, count, next);
        this.refreshers.push(() => {
            pager.hidden = this.pageCount <= 1;
            prev.disabled = this.page === 0;
            next.disabled = this.page >= this.pageCount - 1;
            count.textContent = `${this.page + 1} / ${this.pageCount}`;
            options.forEach((el, i) => {
                el.hidden = Math.floor(i / pageSize) !== this.page;
            });
        });
        return pager;
    }

    /**
     * Close the zone, and forget the refreshers that belonged to it.
     *
     * The tiles of a closed list are gone from the document, so a closure still holding one is
     * work done on a detached node — harmless, and exactly the kind of quiet accumulation that
     * turns into a leak. `refreshers` is truncated back to the length it had before the list
     * opened, which is possible because a list's refreshers are always appended last.
     */
    private closeList(showCategories = true): void {
        const open = this.open;
        if (open === null) return;
        this.cancelHoverDebounce();
        this.opts?.replaceChildren();
        this.open = null;
        this.refreshers.length = this.staticRefresherCount;
        this.hoveredWeaponId = null;
        if (!showCategories) return;
        if (this.listHead !== null) this.listHead.hidden = true;
        if (this.opts !== null) this.opts.hidden = true;
        if (this.cats !== null) this.cats.hidden = false;
        if (this.band !== null) this.band.hidden = true;
    }

    /** The bars one list holds. Every case captures the unlock state once, at build time. */
    private optionsFor(list: ListKind): HTMLElement[] {
        switch (list.kind) {
            case 'weapon':
                return this.weaponOptions(list.slot);
            case 'attachments':
                return this.attachmentOptions(list.slot);
            case 'camo':
                return this.camoOptions(list.slot);
            case 'lethal':
            case 'tactical':
                return this.equipmentOptions(list.kind);
            case 'perk':
                return this.perkOptions(list.tier);
            case 'streak':
                return this.streakOptions(list.index);
            case 'field':
                return this.fieldOptions();
        }
    }

    private weaponOptions(which: WeaponSlot): HTMLElement[] {
        const unlocks = this.deps.profile.unlocks;
        const free = this.range;
        const out: HTMLElement[] = [];
        for (const def of ALL_WEAPONS) {
            // The secondary slot takes sidearms, and primaries too once Overkill is on —
            // which is the entire perk, expressed as a filter rather than as a special case.
            if (which === 'secondary' && def.slot === 'primary' && !this.slot.perks.includes('overkill')) {
                continue;
            }
            if (which === 'primary' && def.slot === 'secondary') continue;
            const el = this.tile({
                name: def.name,
                blurb: () => this.weaponBlurb(def),
                isOn: () => this.slot[which].weaponId === def.id,
                isLocked: () => !free && !unlocks.weaponUnlocked(def.id),
                requirement: () => unlocks.weaponRequirement(def.id),
                apply: () =>
                    this.edit((s) => {
                        s[which].weaponId = def.id;
                        s[which].attachments = [];
                    }),
                icon: makeIconSvg(iconFor(def.id), ICON_VIEWBOX, 'lo-bar__silhouette'),
            });
            // F15: the operator holds the weapon under the cursor, so "the weapon you are
            // choosing" is visible before the choice is made rather than after it.
            this.holdOnHover(el, def.id);
            this.warmWeaponFile(def.id);
            out.push(el);
        }
        return out;
    }

    /**
     * The weapon's file is fetched now, while the cards are being painted (2026-10-18).
     *
     * The preview waits for the template instead of leading with the primitives
     * (`WeaponPreview.show`), and a wait the player can see is a wait worth moving off the
     * hover. `Game.warmWeaponAssets` warms the two weapons in the equipped class and
     * deliberately not the arsenal — a match needs two of twelve — so every other card was a
     * cold fetch at the moment the pointer arrived on it. This is the moment the list opens,
     * which is seconds earlier and is time the player spends reading the first card either way.
     *
     * `preload` is a no-op for a template already in hand and joins the request for one in
     * flight, so a list repainted on every edit costs nothing after the first paint. The
     * failures are the service’s to log: a weapon whose file does not arrive keeps the
     * procedural picture, which is the catalogue’s own promise, so there is nothing for this
     * screen to do about one.
     */
    private warmWeaponFile(weaponId: string): void {
        void this.deps.weaponAssets?.preload(weaponId).catch(() => undefined);
    }

    private attachmentOptions(which: WeaponSlot): HTMLElement[] {
        const unlocks = this.deps.profile.unlocks;
        const free = this.range;
        const def = requireWeapon(this.slot[which].weaponId);
        const out: HTMLElement[] = [];
        for (const id of attachmentsForWeapon(def)) {
            const attachment = attachmentDef(id);
            out.push(
                this.tile({
                    name: attachment.name,
                    blurb: () => `${attachment.benefit} — ${attachment.cost}`,
                    isOn: () => this.slot[which].attachments.includes(id),
                    isLocked: () => !free && !unlocks.attachmentUnlocked(def.id, id),
                    requirement: () => unlocks.attachmentRequirement(def.id, id),
                    apply: () => this.edit((s) => toggleAttachment(s[which].attachments, id)),
                    icon: glyphIcon('attachment'),
                }),
            );
        }
        if (out.length === 0) out.push(emptyNote('This weapon takes no attachments'));
        return out;
    }

    private camoOptions(which: WeaponSlot): HTMLElement[] {
        const unlocks = this.deps.profile.unlocks;
        const free = this.range;
        const out: HTMLElement[] = [
            this.tile(
                noneOption('Factory finish', 'camo', {
                    isOn: () => this.slot[which].camo === null,
                    apply: () =>
                        this.edit((s) => {
                            s[which].camo = null;
                        }),
                }),
            ),
        ];
        for (const id of CAMO_IDS) {
            const camo = camoDef(id);
            out.push(
                this.tile({
                    name: camo.name,
                    blurb: () => camo.requirement,
                    isOn: () => this.slot[which].camo === id,
                    isLocked: () => !free && !this.deps.profile.camoOwned(this.slot[which].weaponId, id),
                    requirement: () => unlocks.camoRequirement(this.slot[which].weaponId, id),
                    apply: () =>
                        this.edit((s) => {
                            s[which].camo = id;
                        }),
                    icon: glyphIcon('camo'),
                    // The pattern itself on the bar (R4.5): the texture's canvas, read back once.
                    pictureUrl: camoPicture(id, this.deps.anisotropy()),
                }),
            );
        }
        return out;
    }

    /**
     * The grenades of one slot, with the unlock level this list did not draw (playtest round 4,
     * B7): every requirement on this screen comes from `UnlockState`, and
     * `scripts/check-unlocks.mjs` fails if a category stops asking.
     */
    private equipmentOptions(wantSlot: 'lethal' | 'tactical'): HTMLElement[] {
        const unlocks = this.deps.profile.unlocks;
        const free = this.range;
        const out: HTMLElement[] = [];
        for (const eq of ALL_EQUIPMENT) {
            if (eq.slot !== wantSlot) continue;
            out.push(
                this.tile({
                    name: eq.name,
                    blurb: () => equipmentBlurb(eq.id),
                    isOn: () => this.slot[wantSlot] === eq.id,
                    isLocked: () => !free && !unlocks.equipmentUnlocked(eq.id),
                    requirement: () => unlocks.equipmentRequirement(eq.id),
                    apply: () =>
                        this.edit((s) => {
                            s[wantSlot] = eq.id;
                        }),
                    icon: glyphIcon(equipmentGlyph(eq.id, wantSlot)),
                }),
            );
        }
        return out;
    }

    private perkOptions(tier: PerkTier): HTMLElement[] {
        const unlocks = this.deps.profile.unlocks;
        const free = this.range;
        const out: HTMLElement[] = [
            this.tile(
                noneOption('Leave this tier empty', 'perk', {
                    isOn: () => (this.slot.perks[tier - 1] ?? null) === null,
                    apply: () =>
                        this.edit((s) => {
                            s.perks[tier - 1] = null;
                        }),
                }),
            ),
        ];
        for (const perk of perksOfTier(tier)) {
            const blurb = perk.inert === true ? `${perk.blurb} (no consumer until M7)` : perk.blurb;
            out.push(
                this.tile({
                    name: perk.name,
                    blurb: () => blurb,
                    isOn: () => this.slot.perks[tier - 1] === perk.id,
                    isLocked: () => !free && !unlocks.perkUnlocked(perk.id),
                    requirement: () => unlocks.perkRequirement(perk.id),
                    apply: () =>
                        this.edit((s) => {
                            s.perks[tier - 1] = perk.id;
                        }),
                    icon: glyphIcon('perk'),
                }),
            );
        }
        return out;
    }

    private streakOptions(index: 0 | 1 | 2): HTMLElement[] {
        // NONE first: three is a maximum, not a quota.
        const out: HTMLElement[] = [
            this.tile(
                noneOption('Leave this key empty', 'streak', {
                    isOn: () => this.slot.streaks[index] == null,
                    apply: () =>
                        this.edit((s) => {
                            s.streaks[index] = null;
                        }),
                }),
            ),
        ];
        for (const def of STREAK_DEFS) {
            out.push(
                this.tile({
                    name: def.name,
                    // "Costs", not "at": after round 4's B9 the number is a price that is debited
                    // from a balance, not a threshold that opens something and stays crossed.
                    blurb: () => `Costs ${def.requirement} kills · ${def.blurb}`,
                    isOn: () => this.slot.streaks[index] === def.id,
                    // A streak already on another key is shown but not selectable: equipping the
                    // same one twice would waste a key and is never what somebody meant to do.
                    isLocked: () => this.slot.streaks.some((held, i) => held === def.id && i !== index),
                    requirement: () => 'ON ANOTHER KEY',
                    apply: () =>
                        this.edit((s) => {
                            s.streaks[index] = def.id;
                        }),
                    icon: glyphIcon('streak'),
                }),
            );
        }
        return out;
    }

    private fieldOptions(): HTMLElement[] {
        const unlocks = this.deps.profile.unlocks;
        const free = this.range;
        const out: HTMLElement[] = [];
        for (const id of FIELD_UPGRADE_IDS) {
            const def = fieldUpgradeDef(id);
            out.push(
                this.tile({
                    name: def.name,
                    blurb: () => `${def.blurb} · ${def.chargeSeconds}s charge`,
                    isOn: () => this.slot.fieldUpgrade === id,
                    isLocked: () => !free && !unlocks.fieldUpgradeUnlocked(id),
                    requirement: () => unlocks.fieldUpgradeRequirement(id),
                    apply: () =>
                        this.edit((s) => {
                            s.fieldUpgrade = id;
                        }),
                    icon: glyphIcon('field'),
                }),
            );
        }
        return out;
    }

    /** Per-weapon progress, printed under every weapon in the picker. */
    private weaponBlurb(def: WeaponDef): string {
        const stats = this.deps.profile.weapon(def.id);
        const level = weaponLevelProgress(stats.xp);
        const accuracy = this.deps.profile.weaponAccuracy(def.id);
        const parts = [
            `${def.class} · LV ${level.level}`,
            `${stats.kills} kills`,
            `${stats.headshots} hs`,
            accuracy < 0 ? 'no shots' : `${accuracy.toFixed(0)}% acc`,
        ];
        if (stats.longestShot > 0) parts.push(`longest ${stats.longestShot.toFixed(0)} m`);
        if (stats.timeUsed > 0) parts.push(`${formatDuration(stats.timeUsed)} used`);
        return parts.join(' · ');
    }

    /** One tile, and the closure that keeps it current. See `Option`. */
    private tile(option: Option): HTMLElement {
        const parts = createOptionBar(option);
        parts.el.addEventListener('click', () => {
            if (option.isLocked()) return;
            option.apply();
        });
        this.refreshers.push(() => writeOptionBar(parts, option));
        return parts.el;
    }

    /** Put a weapon in the operator's hands while the pointer or the keyboard is on its tile. */
    private holdOnHover(el: HTMLElement, weaponId: string): void {
        bindHoverAndFocus(
            el,
            () => this.debounceHover(() => this.holdWeapon(weaponId)),
            () => this.debounceHover(() => this.dropWeapon(weaponId)),
        );
    }

    /**
     * One pending hover decision at a time.
     *
     * The timer is cleared and replaced on every event, and nulled inside the callback *before*
     * the decision runs, so a pointer crossing four bars leaves one decision rather than four
     * and the one it leaves is the last bar's.
     */
    private debounceHover(decide: () => void): void {
        this.cancelHoverDebounce();
        this.hoverDebounceTimer = window.setTimeout(() => {
            this.hoverDebounceTimer = null;
            decide();
        }, HOVER_DEBOUNCE_MS);
    }

    private cancelHoverDebounce(): void {
        if (this.hoverDebounceTimer === null) return;
        window.clearTimeout(this.hoverDebounceTimer);
        this.hoverDebounceTimer = null;
    }

    private holdWeapon(weaponId: string): void {
        if (this.hoveredWeaponId === weaponId) return;
        this.hoveredWeaponId = weaponId;
        this.refreshStage();
    }

    private dropWeapon(weaponId: string): void {
        if (this.hoveredWeaponId !== weaponId) return;
        this.hoveredWeaponId = null;
        this.refreshStage();
    }

    /**
     * One tooltip for the screen, moved to whatever is hovered or focused.
     *
     * Positioned in frame pixels — the rects come back in window pixels and the frame is
     * zoomed, so the division by the frame's scale is what puts it where the chip is — and
     * flipped above the chip when below would leave the frame, which is a rect test rather
     * than a guess.
     */
    private attachTip(el: HTMLElement, text: () => string): void {
        bindHoverAndFocus(
            el,
            () => this.showTip(el, text()),
            () => this.hideTip(),
        );
    }

    private showTip(anchor: HTMLElement, text: string): void {
        const tip = this.tip;
        const frameRect = this.frame.getBoundingClientRect();
        const scale = frameRect.width / 1920 || 1;
        const a = anchor.getBoundingClientRect();
        tip.textContent = text;
        tip.hidden = false;
        // Measure after the text is set: the tip's size is the text's.
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        const frameW = 1920;
        const frameH = frameRect.height / scale;
        const anchorLeft = (a.left - frameRect.left) / scale;
        const anchorTop = (a.top - frameRect.top) / scale;
        const anchorBottom = (a.bottom - frameRect.top) / scale;
        let left = anchorLeft;
        if (left + w > frameW - 16) left = Math.max(16, frameW - 16 - w);
        let top = anchorBottom + 8;
        tip.classList.remove('is-above');
        if (top + h > frameH - 16) {
            top = anchorTop - h - 8;
            tip.classList.add('is-above');
        }
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    }

    private hideTip(): void {
        this.tip.hidden = true;
    }

    private edit(mutate: (slot: LoadoutSlot) => void): void {
        if (this.range) {
            mutate(this.deps.profile.rangeLoadout());
            this.deps.profile.flush();
        } else {
            this.deps.profile.editLoadout(this.slotIndex, mutate);
        }
        this.refresh();
    }

    /** Every mutable value on screen, from the state that produced it. No DOM is created here. */
    private refresh(): void {
        for (const fn of this.refreshers) fn();
        this.refreshStats();
        this.refreshStage();
    }

    /**
     * Repaint the band from a fresh resolve.
     *
     * The same `resolveLoadout` the match uses, called with no caching, which is what makes
     * "these are the numbers you will play with" true rather than asserted.
     */
    private refreshStats(): void {
        const slot = this.slot;
        const resolved = resolveLoadout(slot, this.slotIndex);
        const modifiers: string[] = [];
        for (const id of slot.primary.attachments) modifiers.push(attachmentDef(id).name);
        for (const tier of PERK_TIERS) {
            const perk = slot.perks[tier - 1];
            if (perk !== null && perk !== undefined) modifiers.push(perkDef(perk).name);
        }
        this.stats.show(
            resolved.primaryBase,
            resolved.primary,
            modifiers.length === 0 ? 'BASE WEAPON' : modifiers.join(' · '),
        );
    }

    /**
     * What the operator holds and what the camo preview shows.
     *
     * The hands: the weapon under the cursor, or the open box's own, or the primary. The
     * preview: the open weapon box's equipped weapon in its finish — a hovered weapon has not
     * been equipped, so painting the class's finish onto it would show a combination that does
     * not exist, and the preview is only on screen for the SKIN tab anyway.
     */
    private refreshStage(): void {
        if (this.screen.hidden) return;
        const list = this.openList();
        const which = list === null ? 'primary' : weaponSlotOf(list);
        const equipped = this.slot[which];
        const onStage = this.weaponOnStage();

        this.showStageParts(onStage);
        if (onStage) this.showWeaponOnStage(equipped);
        else this.showOperatorOnStage(equipped);
    }

    /** The list the open tab shows, or null when the list shows the categories. */
    private openList(): ListKind | null {
        const open = this.open;
        if (open === null) return null;
        return open.box.tabs[open.tab]?.list ?? null;
    }

    private showStageParts(onStage: boolean): void {
        for (const part of this.stageParts) part.hidden = onStage;
        // The skin toggle and SAVE / CANCEL share the row's stage cell: one or the other, never both.
        if (this.stageSkins !== null) this.stageSkins.hidden = onStage || this.open !== null;
        this.preview.element.hidden = !onStage;
        if (this.stageActions !== null) this.stageActions.hidden = this.open === null;
    }

    private showWeaponOnStage(equipped: WeaponLoadout): void {
        // The weapon under the pointer, or the equipped one — in its finish only when it is the
        // equipped one, because a hovered weapon has not been given this class's camo.
        const shown = this.hoveredWeaponId ?? equipped.weaponId;
        const isEquipped = shown === equipped.weaponId;
        const camo = isEquipped ? equipped.camo : null;
        // The attachments too (M19, stage 2): the class's, on the class's weapon; a hovered
        // weapon has not been fitted with them any more than it has been painted.
        this.preview.show(shown, camo, requireWeapon(shown).name, isEquipped ? equipped.attachments : []);
    }

    private showOperatorOnStage(equipped: WeaponLoadout): void {
        this.preview.release();
        this.stage.setWeapon(equipped.weaponId, equipped.camo, equipped.attachments);
    }

    /** Whether the open list is one of the two weapons', which is when the weapon takes the stage. */
    private weaponOnStage(): boolean {
        const list = this.openList();
        return list !== null && isWeaponList(list);
    }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** Which weapon a list is about, for the stage's hands and the stat band. */
function weaponSlotOf(list: ListKind): WeaponSlot {
    switch (list.kind) {
        case 'weapon':
        case 'attachments':
        case 'camo':
            return list.slot;
        default:
            return 'primary';
    }
}

/** The lists whose tiles move a number the band shows — which is also when the weapon is on the stage. */
function isWeaponList(list: ListKind): boolean {
    return list.kind === 'weapon' || list.kind === 'attachments' || list.kind === 'camo';
}

/** The weapon on the stage, at the stage's size. */
function createStagePreview(deps: LoadoutEditorDeps): WeaponPreview {
    return new WeaponPreview({
        anisotropy: deps.anisotropy,
        weaponAssets: deps.weaponAssets,
        width: STAGE_PREVIEW_WIDTH,
        height: STAGE_PREVIEW_HEIGHT,
        className: 'lo-preview--stage',
    });
}

function createTip(): HTMLElement {
    const tip = document.createElement('div');
    tip.className = 'lo-tip';
    tip.hidden = true;
    return tip;
}

/** A button on the action row: the shared CTA, quiet unless a class says otherwise. */
function cta(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'op-cta op-cta--quiet';
    const label = document.createElement('span');
    label.textContent = text;
    b.appendChild(label);
    b.addEventListener('click', onClick);
    return b;
}

/**
 * The four listeners a bar needs to answer the pointer *and* the keyboard, in the order both
 * the hover hold and the tooltip registered them in.
 */
function bindHoverAndFocus(el: HTMLElement, enter: () => void, leave: () => void): void {
    el.addEventListener('pointerenter', enter);
    el.addEventListener('focus', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('blur', leave);
}

/** One option bar's structure, built once. Its values are `writeOptionBar`'s. */
function createOptionBar(option: Option): BarParts {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lo-bar lo-bar--opt';
    if (option.pictureUrl !== undefined) {
        el.classList.add('lo-bar--camo');
        el.style.setProperty('--lo-picture', `url("${option.pictureUrl}")`);
    }

    const picture = document.createElement('span');
    picture.className = 'lo-bar__icon';
    picture.appendChild(option.icon);
    const text = document.createElement('span');
    text.className = 'lo-bar__text';
    const label = document.createElement('span');
    label.className = 'lo-bar__name lo-metal';
    label.textContent = option.name;
    const detail = document.createElement('span');
    detail.className = 'lo-bar__blurb';
    text.append(label, detail);
    const state = document.createElement('span');
    state.className = 'lo-bar__state op-label';
    // The padlock before a locked bar's requirement (R4.2): the opacity alone did not read.
    const lock = makeIconSvg(categoryIcon('lock'), CATEGORY_VIEWBOX, 'lo-bar__lock');
    const need = document.createElement('span');
    state.append(lock, need);
    el.append(picture, text, state);
    return { el, detail, lock, need };
}

/** What a bar says this frame: its two states, its blurb, and its padlock or its EQUIPPED. */
function writeOptionBar(parts: BarParts, option: Option): void {
    const isLocked = option.isLocked();
    const isOn = option.isOn();
    parts.el.classList.toggle('is-on', isOn);
    parts.el.classList.toggle('is-locked', isLocked);
    parts.el.disabled = isLocked;
    parts.detail.textContent = option.blurb();
    parts.lock.style.display = isLocked ? '' : 'none';
    parts.need.textContent = isLocked ? option.requirement() : isOn ? 'EQUIPPED' : '';
}

/**
 * The NONE bar the camo, perk and killstreak lists each lead with: never locked, no
 * requirement, and its list's own glyph.
 */
function noneOption(
    blurb: string,
    glyph: CategoryIconId,
    choice: { isOn: () => boolean; apply: () => void },
): Option {
    return {
        name: 'NONE',
        blurb: () => blurb,
        isOn: choice.isOn,
        isLocked: () => false,
        requirement: () => '',
        apply: choice.apply,
        icon: glyphIcon(glyph),
    };
}

function glyphIcon(id: CategoryIconId): SVGSVGElement {
    return makeIconSvg(categoryIcon(id), CATEGORY_VIEWBOX, 'lo-bar__glyph');
}

/** Smoke is its own picture whichever slot it sits in; the rest take their slot's. */
function equipmentGlyph(id: EquipmentId, slot: 'lethal' | 'tactical'): CategoryIconId {
    if (id === 'smoke') return 'smoke';
    return slot === 'lethal' ? 'lethal' : 'tactical';
}

/** Fit an attachment, or take it off again: a bar is a toggle, not a radio. */
function toggleAttachment(held: AttachmentId[], id: AttachmentId): void {
    const at = held.indexOf(id);
    if (at >= 0) held.splice(at, 1);
    else held.push(id);
}

/**
 * The icon a box shows: the weapon's own outline for the two weapon bars; the category's glyph
 * for the rest (`CategoryIcons`), there being no image assets (M12's first paragraph).
 */
function writeBoxIcon(kind: BoxKind, icon: HTMLElement, weaponId: string | null): void {
    const iconKey = weaponId ?? kind;
    if (icon.dataset['key'] === iconKey) return;
    icon.dataset['key'] = iconKey;
    icon.replaceChildren(
        weaponId !== null
            ? makeIconSvg(iconFor(weaponId), ICON_VIEWBOX, 'lo-bar__silhouette')
            : makeIconSvg(categoryIcon(CATEGORY_GLYPH[kind]), CATEGORY_VIEWBOX, 'lo-bar__glyph'),
    );
}

/** A detail chip is plain; a lead or a peer is metal, and an empty one says so. */
function chipClass(chip: Chip): string {
    if (chip.rank === 'detail') return 'lo-chip';
    return `lo-chip lo-chip--${chip.rank} lo-metal${chip.empty === true ? ' lo-chip--empty' : ''}`;
}

/** The two grenades: peers, each one the whole answer for its slot. */
function pushEquipmentChips(slot: LoadoutSlot, chips: Chip[]): void {
    chips.push({ text: equipmentDef(slot.lethal).name, tip: equipmentBlurb(slot.lethal), rank: 'peer' });
    chips.push({ text: equipmentDef(slot.tactical).name, tip: equipmentBlurb(slot.tactical), rank: 'peer' });
}

/** One chip per tier, an em dash where the tier is empty. */
function pushPerkChips(slot: LoadoutSlot, chips: Chip[]): void {
    for (const tier of PERK_TIERS) {
        const id = slot.perks[tier - 1];
        if (id === null || id === undefined) chips.push({ text: '—', tip: `Perk ${tier}: empty`, rank: 'peer', empty: true });
        else chips.push({ text: perkDef(id).name, tip: perkDef(id).blurb, rank: 'peer' });
    }
}

/** One chip per key, each tip naming the key that spends it and what it costs. */
function pushStreakChips(slot: LoadoutSlot, chips: Chip[]): void {
    ([0, 1, 2] as const).forEach((index) => {
        const id = slot.streaks[index];
        if (id === null || id === undefined) chips.push({ text: '—', tip: `Key ${index + 3}: empty`, rank: 'peer', empty: true });
        else {
            const def = streakDef(id);
            chips.push({ text: def.name, tip: `Key ${index + 3} · costs ${def.requirement} kills · ${def.blurb}`, rank: 'peer' });
        }
    });
}

function pushFieldChips(slot: LoadoutSlot, chips: Chip[]): void {
    const def = fieldUpgradeDef(slot.fieldUpgrade);
    chips.push({ text: def.name, tip: `${def.blurb} · ${def.chargeSeconds}s charge`, rank: 'lead' });
}

/** A copy of a class deep enough to restore from: every array its own. */
function cloneSlot(slot: LoadoutSlot): LoadoutSlot {
    return {
        name: slot.name,
        primary: cloneWeapon(slot.primary),
        secondary: cloneWeapon(slot.secondary),
        lethal: slot.lethal,
        tactical: slot.tactical,
        perks: [...slot.perks],
        fieldUpgrade: slot.fieldUpgrade,
        streaks: [...slot.streaks],
    };
}

function cloneWeapon(weapon: WeaponLoadout): WeaponLoadout {
    return { weaponId: weapon.weaponId, attachments: [...weapon.attachments], camo: weapon.camo };
}

/** Put `from` into `target` in place: the profile owns `target`, so it is written, not replaced. */
function assignSlot(target: LoadoutSlot, from: LoadoutSlot): void {
    target.name = from.name;
    assignWeapon(target.primary, from.primary);
    assignWeapon(target.secondary, from.secondary);
    target.lethal = from.lethal;
    target.tactical = from.tactical;
    target.perks = [...from.perks];
    target.fieldUpgrade = from.fieldUpgrade;
    target.streaks = [...from.streaks];
}

function assignWeapon(target: WeaponLoadout, from: WeaponLoadout): void {
    target.weaponId = from.weaponId;
    target.attachments = [...from.attachments];
    target.camo = from.camo;
}

/** The pager's arrows (the stage's went in R3.6). */
function arrowButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lo-arrow';
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
}

function emptyNote(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lo-empty op-label';
    el.textContent = text;
    return el;
}

function equipmentBlurb(id: EquipmentId): string {
    const def = equipmentDef(id);
    const parts = [`x${def.count} per life`];
    if (def.damageProfile !== null) parts.push(`${def.damageProfile.damage.near} dmg · ${def.effectRadius} m`);
    if (def.flashSeconds > 0) parts.push(`${def.flashSeconds}s blind`);
    if (def.smokeSeconds > 0) parts.push(`${def.smokeSeconds}s cover`);
    if (def.cookable) parts.push('cookable');
    return parts.join(' · ');
}

function formatDuration(seconds: number): string {
    if (seconds < 90) return `${seconds.toFixed(0)}s`;
    const minutes = seconds / 60;
    if (minutes < 90) return `${minutes.toFixed(0)}m`;
    return `${(minutes / 60).toFixed(1)}h`;
}
//#endregion
