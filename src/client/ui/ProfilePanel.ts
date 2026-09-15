import { camoDef } from '../../shared/meta/Camos';
import { CHALLENGES, type ChallengeDef } from '../../shared/meta/Challenges';
import { prestigeLabel } from '../../shared/meta/Levels';
import { BOT_CHARACTER_IDS, characterDefinition, type CharacterId } from '../characters/CharacterCatalog';
import type { Profile } from '../meta/Profile';
import { levelLine } from './PlayerCard';

/**
 * The player profile (playtest round 3, R2.2): everything about the player that is not a
 * class, behind the card's gear.
 *
 * *"Not the general settings — a player profile: level, achievements, edit the picture, edit
 * the name, and so on."* A panel over whichever screen the card is on, with three tabs:
 *
 *  - **OVERVIEW** — the avatar large, the callsign (moved here from the menu's header, with
 *    its rules intact: prefilled, written on every keystroke, never a gate), the level with
 *    its bar and the XP to go (moved here from the editor's header, R3.2), prestige and
 *    tokens, and the record.
 *  - **ACHIEVEMENTS** — the thirty challenges, by category, each with its description, its
 *    progress against its target, the XP it pays and the camo it awards. Thirty rows do not
 *    fit a panel under the no-scroll rule; a category's five do, so the categories are tabs.
 *  - **APPEARANCE** — the seven skins as B5's thumbnails; picking writes the profile exactly
 *    as the editor's strip does. The strip stays where it is.
 *
 * **Not a game state** (decision 12). The panel reads and writes the profile and nothing about
 * it needs the state machine: it mounts on the screen's viewport, opens and closes in place,
 * and Escape closes it before it does anything else on that screen. A `PROFILE` state would
 * have been a `shared/core/GameStates.ts` change with a transition table to argue, for a
 * thing the menu already has a shape for — Play Solo is a panel over the frame, not a page.
 *
 * Built once; `open()` repaints the tab it shows from the profile, so nothing here holds a
 * value the profile can change behind it.
 */

export type ProfileTab = 'overview' | 'achievements' | 'appearance';

export interface ProfilePanelDeps {
  readonly profile: Profile;
  /** The callsign's writer — `Game` patches the settings, as it did for the header's field. */
  readonly onDisplayName: (name: string) => void;
  /** Something on the profile changed (a name, a skin): the host redraws what shows it. */
  readonly onChange: () => void;
  /** The panel closed; the host puts focus back where it was. */
  readonly onClose: () => void;
}

const TABS: readonly Readonly<{ id: ProfileTab; label: string }>[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'achievements', label: 'ACHIEVEMENTS' },
  { id: 'appearance', label: 'APPEARANCE' },
];

type Category = ChallengeDef['category'];
const CATEGORIES: readonly Category[] = ['COMBAT', 'PRECISION', 'MOVEMENT', 'TACTICAL', 'MASTERY', 'CAMO'];

export class ProfilePanel {
  /** The overlay: the scrim and the panel in it. Hidden until `open()`. */
  readonly element: HTMLElement;
  private readonly deps: ProfilePanelDeps;
  private readonly tabs: HTMLElement;
  private readonly body: HTMLElement;
  private tab: ProfileTab = 'overview';
  private category: Category = 'COMBAT';

  constructor(deps: ProfilePanelDeps) {
    this.deps = deps;

    const overlay = document.createElement('div');
    overlay.className = 'op-profile';
    overlay.hidden = true;
    // The scrim closes it; the panel does not (a click inside stops here).
    overlay.addEventListener('click', () => this.close());

    const panel = document.createElement('section');
    panel.className = 'op-profile__panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Player profile');
    panel.addEventListener('click', (e) => e.stopPropagation());
    // The screen under this is a DOM surface over a canvas that owns the keyboard.
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation();
    });

    const head = document.createElement('div');
    head.className = 'op-profile__head';
    const title = document.createElement('span');
    title.className = 'op-label op-profile__title';
    title.textContent = 'PLAYER PROFILE';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'op-profile__close';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    head.append(title, close);

    this.tabs = document.createElement('div');
    this.tabs.className = 'op-tabs op-profile__tabs';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'op-tab';
      b.dataset['tab'] = t.id;
      b.textContent = t.label;
      b.addEventListener('click', () => {
        this.tab = t.id;
        this.paint();
      });
      this.tabs.appendChild(b);
    }

    this.body = document.createElement('div');
    this.body.className = 'op-profile__body';

    panel.append(head, this.tabs, this.body);
    overlay.appendChild(panel);
    this.element = overlay;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(tab: ProfileTab = 'overview'): void {
    this.tab = tab;
    this.element.hidden = false;
    this.paint();
    this.tabs.querySelector<HTMLElement>('.op-tab--on')?.focus();
  }

  close(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.deps.onClose();
  }

  /** Escape closes an open panel and is consumed; a closed one lets it through. */
  handleEscape(): boolean {
    if (this.element.hidden) return false;
    this.close();
    return true;
  }

  // -- painting ---------------------------------------------------------------

  private paint(): void {
    for (const b of this.tabs.querySelectorAll<HTMLElement>('.op-tab')) {
      b.classList.toggle('op-tab--on', b.dataset['tab'] === this.tab);
    }
    switch (this.tab) {
      case 'overview':
        this.body.replaceChildren(this.paintOverview());
        break;
      case 'achievements':
        this.body.replaceChildren(this.paintAchievements());
        break;
      case 'appearance':
        this.body.replaceChildren(this.paintAppearance());
        break;
    }
  }

  private paintOverview(): HTMLElement {
    const profile = this.deps.profile;
    const wrap = document.createElement('div');
    wrap.className = 'op-profile__overview';

    // The portrait: the chosen skin, large, named.
    const portrait = document.createElement('div');
    portrait.className = 'op-profile__portrait';
    const skin = characterDefinition(profile.skinId);
    const img = document.createElement('img');
    img.className = 'op-profile__portrait-img';
    img.src = skin.thumbUrl;
    img.alt = '';
    img.draggable = false;
    const skinName = document.createElement('span');
    skinName.className = 'op-label';
    skinName.textContent = skin.name;
    portrait.append(img, skinName);

    // The facts, stacked: the name (editable), the level, prestige and tokens, the record.
    const facts = document.createElement('div');
    facts.className = 'op-profile__facts';

    const nameField = document.createElement('label');
    nameField.className = 'op-profile__field';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'op-label';
    nameLabel.textContent = 'CALLSIGN';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'op-profile__name';
    input.maxLength = 20;
    input.value = profile.settings.callsign;
    input.spellcheck = false;
    input.autocomplete = 'off';
    // Written on every keystroke and never validated before entry — the header's field's rules
    // (§6.1), kept where the field moved.
    input.addEventListener('input', () => {
      this.deps.onDisplayName(input.value);
      this.deps.onChange();
    });
    nameField.append(nameLabel, input);

    const progress = profile.progress;
    const level = document.createElement('div');
    level.className = 'op-profile__level';
    const num = document.createElement('span');
    num.className = 'op-profile__level-num op-num';
    num.textContent = String(progress.level);
    const levelText = document.createElement('div');
    levelText.className = 'op-profile__level-text';
    const cap = document.createElement('span');
    cap.className = 'op-label';
    cap.textContent = levelLine(profile);
    const bar = document.createElement('div');
    bar.className = 'op-profile__bar';
    const fill = document.createElement('i');
    fill.style.transform = `scaleX(${progress.fraction.toFixed(4)})`;
    bar.appendChild(fill);
    const detail = document.createElement('span');
    detail.className = 'op-label op-profile__dim';
    detail.textContent = progress.atCap
      ? 'MAX LEVEL · PRESTIGE AVAILABLE'
      : `${progress.into.toLocaleString()} / ${progress.span.toLocaleString()} XP TO ${progress.level + 1}`;
    levelText.append(cap, bar, detail);
    level.append(num, levelText);

    const record = profile.save.profile;
    const rows = document.createElement('dl');
    rows.className = 'op-profile__rows';
    const row = (k: string, v: string): void => {
      const dt = document.createElement('dt');
      dt.className = 'op-label';
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.className = 'op-profile__value';
      dd.textContent = v;
      rows.append(dt, dd);
    };
    row('PRESTIGE', profile.prestige > 0 ? prestigeLabel(profile.prestige) : '—');
    row('UNLOCK TOKENS', String(profile.unlockTokens));
    row('RECORD', `${record.matchesWon} / ${record.matchesPlayed} WON`);
    row('ACHIEVEMENTS', `${CHALLENGES.filter((c) => this.state(c).completed).length} / ${CHALLENGES.length}`);

    facts.append(nameField, level, rows);
    wrap.append(portrait, facts);
    return wrap;
  }

  private paintAchievements(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'op-profile__achievements';

    const cats = document.createElement('div');
    cats.className = 'op-tabs op-profile__cats';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'op-tab';
      b.classList.toggle('op-tab--on', c === this.category);
      const done = CHALLENGES.filter((ch) => ch.category === c && this.state(ch).completed).length;
      const all = CHALLENGES.filter((ch) => ch.category === c).length;
      b.textContent = `${c} ${done}/${all}`;
      b.addEventListener('click', () => {
        this.category = c;
        this.paint();
      });
      cats.appendChild(b);
    }

    const list = document.createElement('div');
    list.className = 'op-profile__list';
    for (const def of CHALLENGES) {
      if (def.category !== this.category) continue;
      const state = this.state(def);
      const rowEl = document.createElement('div');
      rowEl.className = 'op-profile__row';
      rowEl.classList.toggle('is-done', state.completed);

      const text = document.createElement('div');
      text.className = 'op-profile__row-text';
      const name = document.createElement('span');
      name.className = 'op-profile__row-name';
      name.textContent = def.name;
      const desc = document.createElement('span');
      desc.className = 'op-profile__row-desc';
      desc.textContent = def.description;
      text.append(name, desc);

      const progressEl = document.createElement('div');
      progressEl.className = 'op-profile__row-progress';
      const bar = document.createElement('div');
      bar.className = 'op-profile__bar';
      const fill = document.createElement('i');
      const fraction = def.target > 0 ? Math.min(1, state.progress / def.target) : state.completed ? 1 : 0;
      fill.style.transform = `scaleX(${fraction.toFixed(4)})`;
      bar.appendChild(fill);
      const count = document.createElement('span');
      count.className = 'op-label op-num';
      count.textContent = state.completed ? 'DONE' : `${Math.min(state.progress, def.target)} / ${def.target}`;
      progressEl.append(bar, count);

      const reward = document.createElement('div');
      reward.className = 'op-profile__row-reward';
      const xp = document.createElement('span');
      xp.className = 'op-label';
      xp.textContent = `+${def.xp} XP`;
      reward.appendChild(xp);
      if (def.camo !== undefined) {
        const camo = camoDef(def.camo);
        const swatch = document.createElement('span');
        swatch.className = 'op-profile__swatch';
        swatch.style.background = camo.swatch;
        swatch.title = `${camo.name} camo`;
        const camoName = document.createElement('span');
        camoName.className = 'op-label';
        camoName.textContent = camo.name;
        reward.append(swatch, camoName);
      }

      rowEl.append(text, progressEl, reward);
      list.appendChild(rowEl);
    }

    wrap.append(cats, list);
    return wrap;
  }

  private paintAppearance(): HTMLElement {
    const profile = this.deps.profile;
    const grid = document.createElement('div');
    grid.className = 'op-profile__skins';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', 'Skins');
    for (const id of BOT_CHARACTER_IDS) {
      const def = characterDefinition(id);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'op-profile__skin';
      tile.setAttribute('role', 'option');
      const on = profile.skinId === id;
      tile.classList.toggle('is-on', on);
      tile.setAttribute('aria-selected', on ? 'true' : 'false');
      const img = document.createElement('img');
      img.className = 'op-profile__skin-img';
      img.src = def.thumbUrl;
      img.alt = '';
      img.draggable = false;
      const name = document.createElement('span');
      name.className = 'op-label';
      name.textContent = def.name;
      tile.append(img, name);
      tile.addEventListener('click', () => this.pickSkin(id));
      grid.appendChild(tile);
    }
    return grid;
  }

  private pickSkin(id: CharacterId): void {
    this.deps.profile.setSkin(id);
    this.deps.onChange();
    this.paint();
  }

  /** A challenge's state, read without creating an entry for one the save has not met yet. */
  private state(def: ChallengeDef): { progress: number; completed: boolean } {
    return this.deps.profile.save.challenges[def.id] ?? { progress: 0, completed: false };
  }
}
