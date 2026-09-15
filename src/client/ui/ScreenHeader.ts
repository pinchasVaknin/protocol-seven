import { makeMark } from './Emblem';

/**
 * The header a front-end screen shares (playtest round 3, R3.1): the mark, the place, the
 * player card.
 *
 * *"We have a bar at the top that persists across the windows, where only the name of the
 * place changes on the left."* So one element shape on the menu and on Create-a-Class: the
 * skull mark (`Emblem.ts`) with its breathing eyes, then whatever names the place — the
 * wordmark with `ARENA FPS` on the menu, CREATE A CLASS with its subtitle on the editor — and
 * the player card (`PlayerCard.ts`) at the right end. The header mounts on the screen's
 * *viewport*, not its frame (R1.1), which is what puts the mark at the window's edge on a
 * window wider than 16:9; each screen sets the header's inset with a modifier class, because
 * the menu's frame fills the viewport and the editor's does not.
 */
export function makeScreenHeader(modifier: string, place: readonly HTMLElement[], card: HTMLElement): HTMLElement {
  const head = document.createElement('header');
  head.className = `op-head ${modifier}`;

  const brand = document.createElement('div');
  brand.className = 'op-head__brand';
  brand.append(makeMark('op-head__mark'), ...place);

  head.append(brand, card);
  return head;
}
