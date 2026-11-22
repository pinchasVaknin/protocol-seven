/**
 * The three lines every screen in this division writes to make an element.
 *
 * ```
 * const label = document.createElement('span');
 * label.className = 'op-label ps-fact__label';
 * label.textContent = text;
 * ```
 *
 * C19 counted that idiom about 150 times in its own eight files and upwards of 500 across the
 * division (BACKLOG #78). Measured again on 2026-11-22 before converting: **416 sites in 37
 * files** match it exactly, out of 596 `createElement` calls in non-test client code. The other
 * 180 do something else on the way — a type annotation, an attribute between the class and the
 * text, a tag built in a loop — and are left alone, because a helper that swallowed those would
 * be a helper nobody could read a call to.
 *
 * ## Why this file rather than `ScreenChrome`
 *
 * `ScreenChrome` holds the furniture every screen shares: a header, a footer, a pager arrow.
 * Putting `el` there would make it the division's DOM library by accident rather than by
 * decision, which is the shape the entry warned about. A file called `Dom.ts` says what it is
 * and holds nothing else.
 *
 * ## What it does not do
 *
 * No children, no attributes, no listeners, no `dataset`. Those are the places where screens
 * genuinely differ, and a builder that took all of them would need an options object per call
 * and would read worse than the three lines it replaced. This replaces the part that is the
 * same everywhere and stops there.
 */

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * An element with a class, and text when there is text.
 *
 * The tag's own type comes back — `el('input', …)` is an `HTMLInputElement` — so a caller that
 * then sets `.value` or `.disabled` still typechecks without a cast.
 *
 * `text` left out means `textContent` is **not assigned at all**, which is what the two-line
 * sites did; passing `''` would clear the children of an element that has none, which is the
 * same thing by a longer route but not the same code.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
//#endregion
