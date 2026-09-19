import {
  ACTIONS,
  defaultBindings,
  inputLabel,
  mouseInput,
  type ActionDef,
  type ActionId,
  type BindingMap,
} from '../../shared/core/Keybinds';
import {
  COLORBLIND_MODES,
  SHADOW_QUALITIES,
  type ColorblindMode,
  type SettingsV1,
  type ShadowQuality,
} from '../../shared/meta/SaveData';
import { characterDefinition } from '../characters/CharacterCatalog';
import type { Profile } from '../meta/Profile';
import { createScreen } from './Frame';
import { buildKeyCard, FULLSCREEN_HINT } from './KeyCard';
import { PlayerCard } from './PlayerCard';
import { ProfilePanel } from './ProfilePanel';
import { makeScreenFooter, makeScreenHeader } from './ScreenChrome';
import { makeIconSvg } from './WeaponIcons';

/**
 * The settings screen (brief S6.3; the reference's SYSTEM CONTROL since M17, C4).
 *
 * S6.3 opens with the rule the whole screen is built around: *"A setting that does not do
 * anything is worse than a missing setting."* So there is nothing here that is not wired —
 * every control below writes through `onPreview`, which hands the whole record to `Game` to
 * apply immediately. Nothing waits for a restart.
 *
 * ## Live, and kept, are two different things (decision 2)
 *
 * The screen edits a **draft** — a copy of the saved record taken on `show()`. Every change
 * is applied live through `onPreview(draft)`, so a sensitivity is felt on the frame the
 * slider moves; nothing is persisted until **APPLY** hands the draft to `onCommit`, and
 * **BACK** (the button, or Escape) previews the saved record again and leaves, which is the
 * revert. The two buttons therefore mean what they say, which is the only reason to have two.
 * The rail and the panel repaint from the draft, never from the save.
 *
 * ## The shape
 *
 * The shared chrome (`ScreenChrome.ts`) with the place SYSTEM CONTROL / CONFIGURE OPERATIVE
 * PARAMETERS; a **rail** of five categories on the left — an icon, a number and a name, the
 * open one lit with a bar and a chevron; the **panel** — the category's title and subtitle,
 * its controls in bordered sections, and beside them a column with the input device and
 * the chosen skin's portrait under ADJUST YOUR CONTROLS FOR MAXIMUM PERFORMANCE (decision
 * 8: B5's render, an asset that exists); and at the panel's foot BACK and APPLY, on the
 * action bar the other screens end on.
 *
 * ## Rebinding captures at the window, in the capture phase
 *
 * The rebinding rows have to see a raw key *before* `core/Input` does, or pressing `W` to
 * rebind would also walk the player forward. A capture-phase listener on `window` runs
 * ahead of every bubble-phase listener in the project, and `stopPropagation` there ends the
 * dispatch before `Input` is reached. That is the only place in the project outside
 * `core/Input.ts` that touches a raw keyboard event, and it exists to stop the input layer
 * seeing something rather than to do gameplay with it.
 *
 * ## Five categories, none of them scrolling (M15, A4)
 *
 * Under the design frame nothing scrolls: the 22 actions stand in three columns — Movement,
 * Combat, and Equipment with Interface beneath it — and the tallest column is eight rows, so
 * the whole category fits the panel. **INFO** is the fifth: the controls card, the fullscreen
 * hint and the reset control that used to stack under the main menu's buttons. The card is
 * built from the draft's bindings, so it can never disagree with BINDINGS beside it. Reset
 * progress keeps its two-step arm, cleared on every category change and every `show`.
 */

export interface SettingsDeps {
  readonly host: HTMLElement;
  /** The saved record. Read on `show`, and on BACK to revert. */
  readonly read: () => SettingsV1;
  /** Apply, without persisting: the draft, live. */
  readonly onPreview: (settings: SettingsV1) => void;
  /** Apply and persist: APPLY. */
  readonly onCommit: (settings: SettingsV1) => void;
  /** Leave. The screen has already previewed the saved record if it is reverting. */
  readonly onBack: () => void;
  /** M6: wipe the profile. The confirmation is this file's, the wipe is `Profile`'s. */
  readonly onResetProgress: () => void;
  /** The player, for the chrome's card and the profile panel behind its gear. */
  readonly profile: Profile;
  readonly serverConfigured: () => boolean;
  readonly onDisplayName: (name: string) => void;
}

type Tab = 'CONTROLS' | 'BINDINGS' | 'AUDIO' | 'VIDEO' | 'INFO';

interface TabDef {
  readonly id: Tab;
  readonly subtitle: string;
  readonly glyph: string;
}

/** The rail's glyphs: one path each in a 24-box, filled with `currentColor`. */
const TABS: readonly TabDef[] = [
  {
    id: 'CONTROLS',
    subtitle: 'OPERATIVE INPUT CONFIGURATION',
    // A mouse.
    glyph:
      'M12 2 a7 7 0 0 0 -7 7 v6 a7 7 0 0 0 14 0 V9 a7 7 0 0 0 -7 -7 Z M12 4 a5 5 0 0 1 5 5 v1 h-4.2 V4.1 ' +
      'A5 5 0 0 1 12 4 Z M11.2 4.1 V10 H7 V9 a5 5 0 0 1 4.2 -4.9 Z M7 12 h10 v3 a5 5 0 0 1 -10 0 Z',
  },
  {
    id: 'BINDINGS',
    subtitle: 'KEY ASSIGNMENTS',
    // A keyboard.
    glyph:
      'M2 6 h20 a1 1 0 0 1 1 1 v10 a1 1 0 0 1 -1 1 H2 a1 1 0 0 1 -1 -1 V7 a1 1 0 0 1 1 -1 Z M3 8 v8 h18 V8 Z ' +
      'M5 9.5 h2 v2 H5 Z M8.5 9.5 h2 v2 h-2 Z M12 9.5 h2 v2 h-2 Z M15.5 9.5 h2 v2 h-2 Z M5 13 h2 v2 H5 Z M8.5 13 h7 v2 h-7 Z M17 13 h2 v2 h-2 Z',
  },
  {
    id: 'AUDIO',
    subtitle: 'MIX AND LEVELS',
    // A speaker with two arcs.
    glyph:
      'M3 9 h4 l5 -4 v14 l-5 -4 H3 Z M14.5 8.2 a4.5 4.5 0 0 1 0 7.6 l-1 -1.6 a2.6 2.6 0 0 0 0 -4.4 Z ' +
      'M16.8 5.2 a8 8 0 0 1 0 13.6 l-1 -1.6 a6.1 6.1 0 0 0 0 -10.4 Z',
  },
  {
    id: 'VIDEO',
    subtitle: 'DISPLAY AND RENDERING',
    // A monitor.
    glyph: 'M2 4 h20 a1 1 0 0 1 1 1 v11 a1 1 0 0 1 -1 1 H2 a1 1 0 0 1 -1 -1 V5 a1 1 0 0 1 1 -1 Z M3 6 v9 h18 V6 Z M8 19 h8 v2 H8 Z',
  },
  {
    id: 'INFO',
    subtitle: 'REFERENCE AND ACCOUNT',
    // A document.
    glyph: 'M6 2 h8 l5 5 v15 H6 Z M8 4 v16 h9 V8 h-4 V4 Z M9.5 11 h6 v1.6 h-6 Z M9.5 14 h6 v1.6 h-6 Z M9.5 17 h4 v1.6 h-4 Z',
  },
];

const CHEVRON = 'M9 4 L17 12 L9 20 L7.4 18.4 L13.8 12 L7.4 5.6 Z';
const ARROW_LEFT = 'M11 4 l1.6 1.6 -5.3 5.4 H21 v2 H7.3 l5.3 5.4 L11 20 l-8 -8 Z';
const CHECK = 'M9.5 17.5 L3.5 11.5 5.3 9.7 9.5 13.9 18.7 4.7 20.5 6.5 Z';

/** The binding groups as they stand in the three columns, left to right. */
const BINDING_COLUMNS: readonly (readonly ActionDef['group'][])[] = [
  ['Movement'],
  ['Combat'],
  ['Equipment', 'Interface'],
];

const SHADOW_LABELS: Readonly<Record<ShadowQuality, string>> = {
  off: 'Off',
  low: 'Low — 1024, hard',
  medium: 'Medium — 2048',
  high: 'High — 4096, soft',
};

const COLORBLIND_LABELS: Readonly<Record<ColorblindMode, string>> = {
  off: 'Off — green / red',
  deuteranopia: 'Deuteranopia — blue / orange',
  protanopia: 'Protanopia — blue / orange',
  tritanopia: 'Tritanopia — teal / magenta',
};

const PLATE_CAPTION = 'ADJUST YOUR CONTROLS FOR MAXIMUM PERFORMANCE';

export class Settings {
  private readonly deps: SettingsDeps;
  private readonly screen: HTMLElement;
  /** The window-sized box the chrome mounts on (R1.1). `screen` is the layer. */
  private readonly viewport: HTMLElement;
  /** The 1920x1080 box the rail and the panel are painted into (M15, A1). */
  private readonly frame: HTMLElement;
  private readonly card: PlayerCard;
  private readonly panel: ProfilePanel;
  private tab: Tab = 'CONTROLS';

  /** The record being edited: the save's copy on `show`, live through `onPreview`, kept by APPLY. */
  private draft: SettingsV1;

  /** Which binding slot is waiting for a key, or null. */
  private capturing: { action: ActionId; slot: number } | null = null;
  /** Shown under the binding list after a rebind took a key off something else. */
  private notice = '';
  /** Whether the reset-progress button is one click from doing it. Cleared on `show` and on a category change. */
  private resetArmed = false;

  constructor(deps: SettingsDeps) {
    this.deps = deps;
    const { layer, viewport, frame } = createScreen('op-screen st');
    this.screen = layer;
    this.viewport = viewport;
    this.frame = frame;
    this.screen.hidden = true;
    this.draft = cloneSettings(deps.read());
    this.panel = new ProfilePanel({
      profile: deps.profile,
      onDisplayName: deps.onDisplayName,
      onChange: () => this.card.refresh(),
      onClose: () => {
        this.card.refresh();
        // A skin picked in the panel is on the plate when it closes.
        this.paint();
      },
    });
    this.card = new PlayerCard({
      profile: deps.profile,
      online: deps.serverConfigured,
      onOpenProfile: () => this.panel.open(),
    });
    deps.host.appendChild(this.screen);
  }

  show(): void {
    this.screen.hidden = false;
    this.capturing = null;
    this.notice = '';
    this.resetArmed = false;
    this.draft = cloneSettings(this.deps.read());
    this.panel.close();
    this.paint();
  }

  hide(): void {
    this.stopCapture();
    this.panel.close();
    this.screen.hidden = true;
  }

  get isVisible(): boolean {
    return !this.screen.hidden;
  }

  /**
   * Escape, forwarded from the state machine.
   *
   * Returns whether it was consumed: while a binding row is armed, Escape cancels the
   * capture rather than leaving the screen — a player who opened a rebind by accident
   * should not be thrown back to the menu by the key they used to back out of it — and the
   * profile panel, if open, closes and consumes it the way it does on the menu. Otherwise
   * the caller leaves, and leaving without APPLY is BACK: the saved record is previewed
   * again first, so the revert is the same whichever way the screen is left.
   */
  handleEscape(): boolean {
    if (this.capturing !== null) {
      this.stopCapture();
      this.paint();
      return true;
    }
    if (this.panel.handleEscape()) return true;
    this.revert();
    return false;
  }

  /** For the layout probe: open a category directly. */
  openTab(tab: Tab): void {
    this.tab = tab;
    this.paint();
  }

  dispose(): void {
    this.stopCapture();
    this.screen.remove();
  }

  // -- the draft ---------------------------------------------------------------

  /** A change: into the draft, and live. */
  private edit(patch: Partial<SettingsV1>): void {
    Object.assign(this.draft, patch);
    this.deps.onPreview(this.draft);
  }

  /** BACK: the saved record, live again. */
  private revert(): void {
    this.deps.onPreview(this.deps.read());
  }

  // -- painting --------------------------------------------------------------

  private paint(): void {
    const body = document.createElement('div');
    body.className = 'st-body';
    body.append(this.paintRail(), this.paintPanel());
    this.card.refresh();
    const place = { title: 'SYSTEM CONTROL', subtitle: 'CONFIGURE OPERATIVE PARAMETERS' };
    this.frame.replaceChildren(body);
    this.viewport.replaceChildren(
      makeScreenHeader('op-head--frame', place, this.card.element),
      this.frame,
      makeScreenFooter('op-foot--frame', place),
      this.panel.element,
    );
  }

  /** The rail: the five categories, the open one lit. */
  private paintRail(): HTMLElement {
    const rail = document.createElement('nav');
    rail.className = 'st-rail';
    rail.setAttribute('aria-label', 'Settings categories');
    TABS.forEach((def, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-rail__item';
      b.classList.toggle('is-on', def.id === this.tab);
      b.setAttribute('aria-current', def.id === this.tab ? 'page' : 'false');
      b.appendChild(makeIconSvg(def.glyph, '0 0 24 24', 'st-rail__glyph'));
      const num = document.createElement('span');
      num.className = 'st-rail__num op-num';
      num.textContent = `0${i + 1}`;
      const name = document.createElement('span');
      name.className = 'st-rail__name';
      name.textContent = def.id;
      b.append(num, name, makeIconSvg(CHEVRON, '0 0 24 24', 'st-rail__chevron'));
      b.addEventListener('click', () => {
        this.stopCapture();
        this.tab = def.id;
        this.resetArmed = false;
        this.paint();
      });
      rail.appendChild(b);
    });
    return rail;
  }

  /** The panel: the category's head, its controls beside the side column, and the foot. */
  private paintPanel(): HTMLElement {
    const def = TABS.find((t) => t.id === this.tab) ?? TABS[0]!;
    const panel = document.createElement('section');
    panel.className = 'st-panel';

    const head = document.createElement('div');
    head.className = 'st-panel__head';
    head.appendChild(makeIconSvg(def.glyph, '0 0 24 24', 'st-panel__glyph'));
    const titles = document.createElement('div');
    titles.className = 'st-panel__titles';
    const title = document.createElement('h2');
    title.className = 'st-panel__title';
    title.textContent = def.id;
    const sub = document.createElement('span');
    sub.className = 'op-label st-panel__sub';
    sub.textContent = def.subtitle;
    titles.append(title, sub);
    head.appendChild(titles);

    const main = document.createElement('div');
    main.className = 'st-main';
    if (this.tab === 'CONTROLS') this.paintControls(main);
    else if (this.tab === 'BINDINGS') this.paintBindings(main);
    else if (this.tab === 'AUDIO') this.paintAudio(main);
    else if (this.tab === 'VIDEO') this.paintVideo(main);
    else this.paintInfo(main);

    const columns = document.createElement('div');
    columns.className = 'st-columns';
    // BINDINGS takes the whole width: three columns of labels and two key chips each do not
    // fit beside the side column without truncating the labels, and a label cut to "CROUC…"
    // is a binding row that cannot be read.
    if (this.tab === 'BINDINGS') {
      columns.classList.add('st-columns--wide');
      columns.appendChild(main);
    } else {
      columns.append(main, this.paintSide());
    }

    const foot = document.createElement('div');
    foot.className = 'op-actionbar op-actionbar--bare st-foot';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'op-cta op-cta--quiet st-back';
    back.appendChild(makeIconSvg(ARROW_LEFT, '0 0 24 24', 'op-cta__lead'));
    const bt = document.createElement('span');
    bt.textContent = 'BACK';
    back.appendChild(bt);
    back.addEventListener('click', () => {
      this.revert();
      this.deps.onBack();
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'op-cta op-cta--primary st-apply';
    apply.appendChild(makeIconSvg(CHECK, '0 0 24 24', 'op-cta__lead'));
    const at = document.createElement('span');
    at.textContent = 'APPLY';
    apply.appendChild(at);
    apply.addEventListener('click', () => {
      this.deps.onCommit(this.draft);
      this.deps.onBack();
    });
    foot.append(back, apply);

    panel.append(head, columns, foot);
    return panel;
  }

  /** The side column: the input device, and the operator's portrait under the caption. */
  private paintSide(): HTMLElement {
    const side = document.createElement('div');
    side.className = 'st-side';

    const device = document.createElement('div');
    device.className = 'st-card';
    device.appendChild(makeIconSvg(TABS[0]!.glyph, '0 0 24 24', 'st-card__glyph'));
    const dt = document.createElement('div');
    dt.className = 'st-card__text';
    const dl = document.createElement('span');
    dl.className = 'op-label';
    dl.textContent = 'INPUT DEVICE';
    const dv = document.createElement('span');
    dv.className = 'st-card__value';
    // The device gate (round 5, F1) admits nothing else: a keyboard and a mouse are what a
    // client that reached this screen has.
    dv.textContent = 'MOUSE / KEYBOARD';
    dt.append(dl, dv);
    device.appendChild(dt);

    const plate = document.createElement('div');
    plate.className = 'st-plate';
    const img = document.createElement('img');
    img.className = 'st-plate__img';
    img.src = characterDefinition(this.deps.profile.skinId).thumbUrl;
    img.alt = '';
    img.draggable = false;
    const shade = document.createElement('div');
    shade.className = 'st-plate__shade';
    const caption = document.createElement('span');
    caption.className = 'st-plate__caption';
    caption.textContent = PLATE_CAPTION;
    const bars = document.createElement('span');
    bars.className = 'st-plate__bars';
    for (let i = 0; i < 3; i++) {
      const bar = document.createElement('i');
      bar.className = 'st-plate__bar';
      bars.appendChild(bar);
    }
    plate.append(img, shade, caption, bars);

    side.append(device, plate);
    return side;
  }

  // -- the categories ---------------------------------------------------------

  private paintControls(host: HTMLElement): void {
    const s = this.draft;
    const look = this.section('SENSITIVITY', 'M12 4 A8 8 0 1 0 12 20 A8 8 0 1 0 12 4 Z M12 7 A5 5 0 1 1 12 17 A5 5 0 1 1 12 7 Z M11 1h2v4h-2z M11 19h2v4h-2z M1 11h4v2H1z M19 11h4v2h-4z');
    look.append(
      this.slider('Look sensitivity', s.sensitivity, 0.1, 5, 0.05, (v) => this.edit({ sensitivity: v })),
      this.slider(
        'ADS sensitivity',
        s.adsSensitivity,
        0.1,
        2,
        0.05,
        (v) => this.edit({ adsSensitivity: v }),
        'Applied in proportion to how far the sights are up, so it arrives with the picture.',
      ),
    );
    const view = this.section('VIEW', 'M2 12 c3 -5 6.5 -7 10 -7 s7 2 10 7 c-3 5 -6.5 7 -10 7 s-7 -2 -10 -7 Z M12 8 a4 4 0 1 0 0 8 a4 4 0 1 0 0 -8 Z');
    view.append(
      this.slider('Field of view', s.fov, 60, 120, 1, (v) => this.edit({ fov: v }), undefined, (v) => `${v.toFixed(0)}°`),
      this.toggle('Invert vertical look', s.invertY, (v) => this.edit({ invertY: v })),
    );
    host.append(look, view);
  }

  private paintBindings(host: HTMLElement): void {
    host.classList.add('st-main--bindings');
    const groups = new Map<ActionDef['group'], ActionDef[]>();
    for (const a of ACTIONS) {
      const list = groups.get(a.group);
      if (list === undefined) groups.set(a.group, [a]);
      else list.push(a);
    }

    const bindings = this.draft.bindings;
    const columns = document.createElement('div');
    columns.className = 'st-bindings';
    for (const column of BINDING_COLUMNS) {
      const col = document.createElement('div');
      col.className = 'st-bindings__column';
      for (const group of column) {
        const sec = this.section(group.toUpperCase());
        for (const action of groups.get(group) ?? []) sec.appendChild(this.bindingRow(action, bindings));
        col.appendChild(sec);
      }
      columns.appendChild(col);
    }
    host.appendChild(columns);

    const foot = document.createElement('div');
    foot.className = 'st-bindings__foot';
    const note = document.createElement('p');
    note.className = 'st-note';
    note.textContent =
      this.notice !== ''
        ? this.notice
        : this.capturing !== null
          ? 'Press any key or mouse button. Escape cancels.'
          : 'Click a binding to change it. A key taken from another action is removed from it.';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'op-cta op-cta--quiet st-reset';
    const rt = document.createElement('span');
    rt.textContent = 'RESET ALL BINDINGS';
    reset.appendChild(rt);
    reset.addEventListener('click', () => {
      this.edit({ bindings: defaultBindings() });
      this.notice = 'Bindings restored to defaults — APPLY keeps them.';
      this.paint();
    });
    foot.append(note, reset);
    host.appendChild(foot);
  }

  /**
   * INFO (M15, A4): what the main menu used to carry under its buttons.
   *
   * The card is a reminder, built from the draft's bindings so it can never disagree with
   * the BINDINGS category beside it. Reset progress is a two-step button rather than a
   * `window.confirm`: the page owns pointer lock and a native modal steals focus in a way
   * the input layer then has to recover from. The second press has to be a deliberate second
   * click, and clicking any other category — or re-entering the screen — puts it back.
   */
  private paintInfo(host: HTMLElement): void {
    const controls = this.section('CONTROLS');
    controls.appendChild(buildKeyCard(this.draft.bindings));
    const hint = document.createElement('p');
    hint.className = 'st-note';
    hint.textContent = FULLSCREEN_HINT;
    controls.appendChild(hint);

    const progress = this.section('PROGRESS');
    const wrap = document.createElement('div');
    wrap.className = 'st-danger';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'op-cta op-cta--quiet st-reset';
    reset.classList.toggle('op-cta--danger', this.resetArmed);
    const rt = document.createElement('span');
    rt.textContent = this.resetArmed ? 'CONFIRM — ERASE ALL PROGRESS' : 'RESET PROGRESS';
    reset.appendChild(rt);
    reset.addEventListener('click', () => {
      if (!this.resetArmed) {
        this.resetArmed = true;
        this.paint();
        return;
      }
      this.resetArmed = false;
      this.deps.onResetProgress();
      this.notice = '';
      this.paint();
    });
    wrap.appendChild(reset);
    if (this.resetArmed) {
      const warn = document.createElement('span');
      warn.className = 'op-label st-danger__warn';
      warn.textContent = 'LEVEL, UNLOCKS, CAMOS AND CLASSES. SETTINGS ARE KEPT.';
      wrap.appendChild(warn);
    }
    progress.appendChild(wrap);

    host.append(controls, progress);
  }

  private bindingRow(action: ActionDef, bindings: BindingMap): HTMLElement {
    const row = document.createElement('div');
    row.className = 'st-bind';

    const label = document.createElement('span');
    label.className = 'st-bind__label';
    label.textContent = action.label;
    row.appendChild(label);

    const keys = document.createElement('div');
    keys.className = 'st-bind__keys';
    const list = bindings[action.id] ?? [];
    // Two slots always, so an action with one binding still offers somewhere to add a second.
    for (let slot = 0; slot < 2; slot++) {
      const current = list[slot];
      const armed = this.capturing?.action === action.id && this.capturing.slot === slot;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-key';
      b.classList.toggle('is-armed', armed);
      b.classList.toggle('is-empty', current === undefined);
      b.textContent = armed ? 'PRESS…' : current === undefined ? '—' : inputLabel(current);
      b.addEventListener('click', () => this.startCapture(action.id, slot));
      keys.appendChild(b);
    }
    row.appendChild(keys);
    return row;
  }

  private paintAudio(host: HTMLElement): void {
    const s = this.draft;
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const levels = this.section('LEVELS', TABS[2]!.glyph);
    levels.append(
      this.slider('Master', s.masterVolume, 0, 1, 0.01, (v) => this.edit({ masterVolume: v }), undefined, pct),
      this.slider(
        'Effects',
        s.sfxVolume,
        0,
        1,
        0.01,
        (v) => this.edit({ sfxVolume: v }),
        'Gunfire, footsteps, impacts and equipment. Ducks under announcer stings.',
        pct,
      ),
      this.slider('Music', s.musicVolume, 0, 1, 0.01, (v) => this.edit({ musicVolume: v }), undefined, pct),
      this.slider(
        'Interface',
        s.uiVolume,
        0,
        1,
        0.01,
        (v) => this.edit({ uiVolume: v }),
        'Hitmarkers, the announcer and menu sounds. Routed around the world filter, so it stays clear when you are hurt.',
        pct,
      ),
    );
    host.appendChild(levels);
  }

  private paintVideo(host: HTMLElement): void {
    const s = this.draft;
    const rendering = this.section('RENDERING', TABS[3]!.glyph);
    rendering.append(
      this.slider(
        'Render scale',
        s.renderScale,
        0.5,
        1,
        0.05,
        (v) => this.edit({ renderScale: v }),
        'The first thing to lower on integrated graphics. Resizes the backing buffer, not the page.',
        (v) => `${Math.round(v * 100)}%`,
      ),
      this.picker('Shadow quality', SHADOW_QUALITIES, s.shadowQuality, (v) => this.edit({ shadowQuality: v }), (v) => SHADOW_LABELS[v]),
      this.toggle('Motion blur', s.motionBlur, (v) => this.edit({ motionBlur: v }), 'A short trail on fast camera movement. Off by default; some players find it nauseating.'),
    );
    const access = this.section('ACCESSIBILITY');
    access.append(
      this.picker(
        'Colourblind mode',
        COLORBLIND_MODES,
        s.colorblind,
        (v) => this.edit({ colorblind: v }),
        (v) => COLORBLIND_LABELS[v],
        'Changes the real team, hitmarker, minimap and objective colours — not a filter over the picture.',
      ),
      this.toggle('FPS counter', s.showFps, (v) => this.edit({ showFps: v })),
    );
    host.append(rendering, access);
  }

  // -- capture ---------------------------------------------------------------

  private startCapture(action: ActionId, slot: number): void {
    this.stopCapture();
    this.capturing = { action, slot };
    this.notice = '';
    window.addEventListener('keydown', this.onCaptureKey, true);
    window.addEventListener('mousedown', this.onCaptureMouse, true);
    window.addEventListener('wheel', this.onCaptureWheel, { capture: true, passive: false });
    this.paint();
  }

  private stopCapture(): void {
    if (this.capturing === null) return;
    this.capturing = null;
    window.removeEventListener('keydown', this.onCaptureKey, true);
    window.removeEventListener('mousedown', this.onCaptureMouse, true);
    window.removeEventListener('wheel', this.onCaptureWheel, true);
  }

  /**
   * Every capture handler ends the dispatch.
   *
   * `stopPropagation` in the capture phase at `window` stops the event reaching anything
   * else at all, which is the point: pressing `W` to bind it must not also walk the player
   * forward, and clicking to bind a mouse button must not fire the weapon.
   */
  private readonly onCaptureKey = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      this.stopCapture();
      this.paint();
      return;
    }
    this.commit(e.code);
  };

  private readonly onCaptureMouse = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.commit(mouseInput(e.button));
  };

  private readonly onCaptureWheel = (e: WheelEvent): void => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.commit(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
  };

  /**
   * Write the captured input into the draft's binding table.
   *
   * The rebind happens on a *copy* of the map, which is then handed to `edit` like any other
   * setting — so a binding change previews, persists on APPLY and reverts on BACK through
   * exactly the same path a volume slider does, and there is no second mechanism to keep in
   * step.
   */
  private commit(input: string): void {
    const target = this.capturing;
    if (target === null) return;
    this.stopCapture();

    const next = cloneBindings(this.draft.bindings);
    let stolenFrom: ActionId | null = null;
    for (const action of ACTIONS) {
      if (action.id === target.action) continue;
      const list = next[action.id];
      if (list === undefined) continue;
      const at = list.indexOf(input);
      if (at < 0) continue;
      list.splice(at, 1);
      stolenFrom = action.id;
    }

    const list = next[target.action] ?? [];
    const dup = list.indexOf(input);
    if (dup >= 0 && dup !== target.slot) list.splice(dup, 1);
    list[Math.min(target.slot, list.length)] = input;
    next[target.action] = list;

    this.edit({ bindings: next });
    this.notice =
      stolenFrom === null
        ? ''
        : `${inputLabel(input)} was taken off "${labelOf(stolenFrom)}", which is now unbound on that key.`;
    this.paint();
  }

  // -- primitives ------------------------------------------------------------

  /** A bordered group with a heading, and a glyph beside it where the group has one. */
  private section(title: string, glyph?: string): HTMLElement {
    const sec = document.createElement('div');
    sec.className = 'st-sec';
    const head = document.createElement('div');
    head.className = 'st-sec__head';
    if (glyph !== undefined) head.appendChild(makeIconSvg(glyph, '0 0 24 24', 'st-sec__glyph'));
    const label = document.createElement('span');
    label.className = 'st-sec__title';
    label.textContent = title;
    head.appendChild(label);
    sec.appendChild(head);
    return sec;
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onInput: (v: number) => void,
    help?: string,
    format: (v: number) => string = (v) => v.toFixed(2),
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'st-row';

    const name = document.createElement('span');
    name.className = 'st-row__label';
    name.textContent = label;

    const readout = document.createElement('span');
    readout.className = 'st-row__value op-num';
    readout.textContent = format(value);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'st-range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      readout.textContent = format(v);
      onInput(v);
    });

    row.append(name, input, readout);
    if (help !== undefined) row.appendChild(helpText(help));
    return row;
  }

  private toggle(label: string, value: boolean, onChange: (v: boolean) => void, help?: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'st-row st-row--toggle';

    const name = document.createElement('span');
    name.className = 'st-row__label';
    name.textContent = label;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-toggle';
    b.classList.toggle('is-on', value);
    b.textContent = value ? 'ON' : 'OFF';
    b.setAttribute('aria-pressed', value ? 'true' : 'false');
    b.addEventListener('click', () => {
      const next = !b.classList.contains('is-on');
      b.classList.toggle('is-on', next);
      b.textContent = next ? 'ON' : 'OFF';
      b.setAttribute('aria-pressed', next ? 'true' : 'false');
      onChange(next);
    });

    row.append(name, b);
    if (help !== undefined) row.appendChild(helpText(help));
    return row;
  }

  private picker<T extends string>(
    label: string,
    options: readonly T[],
    value: T,
    onChange: (v: T) => void,
    format: (v: T) => string,
    help?: string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'st-row st-row--stack';

    const name = document.createElement('span');
    name.className = 'st-row__label';
    name.textContent = label;
    row.appendChild(name);

    const list = document.createElement('div');
    list.className = 'st-choices';
    for (const option of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-choice';
      b.classList.toggle('is-on', option === value);
      b.textContent = format(option);
      b.setAttribute('aria-pressed', option === value ? 'true' : 'false');
      b.addEventListener('click', () => {
        onChange(option);
        this.paint();
      });
      list.appendChild(b);
    }
    row.appendChild(list);
    if (help !== undefined) row.appendChild(helpText(help));
    return row;
  }
}

/** A copy the draft can be edited on: every field is a primitive but the binding lists. */
function cloneSettings(source: SettingsV1): SettingsV1 {
  return { ...source, bindings: cloneBindings(source.bindings) };
}

function cloneBindings(source: BindingMap): BindingMap {
  const out: BindingMap = {};
  for (const action of ACTIONS) out[action.id] = [...(source[action.id] ?? [])];
  return out;
}

function labelOf(id: ActionId): string {
  return ACTIONS.find((a) => a.id === id)?.label ?? id;
}

function helpText(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'st-row__help';
  p.textContent = text;
  return p;
}
