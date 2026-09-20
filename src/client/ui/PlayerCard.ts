import { MAX_LEVEL, prestigeLabel } from '../../shared/meta/Levels';
import { characterDefinition } from '../characters/CharacterCatalog';
import type { Profile } from '../meta/Profile';
import { makeIconSvg } from './WeaponIcons';

/**
 * The player card (playtest round 3, R2.1): who is playing, in two facts.
 *
 * The right half of the header on the menu and, from R3, on Create-a-Class — the same element
 * in both, so the header is one thing that persists across the screens and only the place's
 * name on its left changes. The **avatar** is the chosen skin's thumbnail — B5's render, a
 * portrait of who the player is on the disc — with the **presence dot** on its corner; beside
 * it the **callsign** as a name and **LEVEL N** beneath; a **rule**; and the **gear** that
 * opens the profile panel (`ProfilePanel.ts`), where the name, the skin and everything else
 * about the player is edited. Nothing is edited on the card: the human's word was *clean* —
 * *"the name, under it the level, and that is all"* — where the card used to be a CALLSIGN
 * field and a six-fact profile line.
 *
 * The dot is honest (decision 10): green when a server is configured, grey when not — the
 * same fact PLAY's disabled state states, so it never says *online* on a build with no server
 * to be online to.
 *
 * `refresh()` re-reads the profile; the host calls it on show and when the panel closes.
 */

export interface PlayerCardDeps {
  readonly profile: Profile;
  /** Whether a server address is configured — the dot's one fact. */
  readonly online: () => boolean;
  readonly onOpenProfile: () => void;
}

/** The gear, one path in a 24-box like the menu's glyphs: a ring with eight teeth. */
const GEAR_GLYPH =
  'M10.6 2h2.8l.5 2.6a7.6 7.6 0 0 1 2 .8l2.2-1.5 2 2-1.5 2.2a7.6 7.6 0 0 1 .8 2l2.6.5v2.8l-2.6.5a7.6 7.6 0 0 1-.8 2l1.5 2.2-2 2-2.2-1.5a7.6 7.6 0 0 1-2 .8l-.5 2.6h-2.8l-.5-2.6a7.6 7.6 0 0 1-2-.8l-2.2 1.5-2-2 1.5-2.2a7.6 7.6 0 0 1-.8-2L2 13.4v-2.8l2.6-.5a7.6 7.6 0 0 1 .8-2L3.9 5.9l2-2 2.2 1.5a7.6 7.6 0 0 1 2-.8L10.6 2z ' +
  'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 1 0 0-6.8z';

export class PlayerCard {
  readonly element: HTMLElement;
  private readonly deps: PlayerCardDeps;
  private readonly avatar: HTMLImageElement;
  private readonly dot: HTMLElement;
  private readonly name: HTMLElement;
  private readonly level: HTMLElement;

  constructor(deps: PlayerCardDeps) {
    this.deps = deps;

    const card = document.createElement('div');
    card.className = 'op-card';

    const portrait = document.createElement('span');
    portrait.className = 'op-card__portrait';
    this.avatar = document.createElement('img');
    this.avatar.className = 'op-card__avatar';
    this.avatar.alt = '';
    this.avatar.draggable = false;
    this.dot = document.createElement('i');
    this.dot.className = 'op-card__dot';
    portrait.append(this.avatar, this.dot);

    const text = document.createElement('div');
    text.className = 'op-card__text';
    this.name = document.createElement('span');
    this.name.className = 'op-card__name';
    this.level = document.createElement('span');
    this.level.className = 'op-card__level op-label';
    text.append(this.name, this.level);

    const rule = document.createElement('span');
    rule.className = 'op-card__rule';

    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'op-card__gear';
    gear.title = 'Player profile';
    gear.setAttribute('aria-label', 'Player profile');
    gear.appendChild(makeIconSvg(GEAR_GLYPH, '0 0 24 24', 'op-card__gear-icon'));
    gear.addEventListener('click', () => this.deps.onOpenProfile());

    card.append(portrait, text, rule, gear);
    this.element = card;
    this.refresh();
  }

  /**
   * Every fact on the card, from the profile as it is now — or, on the debrief (M18), with
   * the level the XP bar is showing, which trails the banked one until the flourish.
   */
  refresh(level?: number): void {
    const profile = this.deps.profile;
    const skin = characterDefinition(profile.skinId);
    if (this.avatar.src !== skin.thumbUrl) this.avatar.src = skin.thumbUrl;
    this.name.textContent = profile.settings.callsign;
    this.level.textContent = levelLine(profile, level);
    const online = this.deps.online();
    this.dot.classList.toggle('is-online', online);
    this.dot.title = online ? 'Server configured' : 'No server configured';
  }
}

/** LEVEL N; PRESTIGE ★ N once the cap has been passed at least once. */
export function levelLine(profile: Profile, shown?: number): string {
  const number = shown ?? profile.progress.level;
  const level = number >= MAX_LEVEL ? `LEVEL ${MAX_LEVEL} (MAX)` : `LEVEL ${number}`;
  return profile.prestige > 0 ? `PRESTIGE ${prestigeLabel(profile.prestige)} · ${level}` : level;
}
