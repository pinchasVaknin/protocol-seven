/**
 * The DOM double the client's unit tests run against, in one place instead of thirty.
 *
 * The suite runs on `environment: 'node'` (see `vitest.config.ts`, which says why: S2 admits
 * vitest and nothing else, so there is no jsdom). Every client test that reaches a screen
 * therefore installs its own `document`, and before this file each one carried its own copy of
 * the element class and the environment around it.
 *
 * Measured on 2026-11-22 before the move: **38 `*.test.ts` files under `src/client/` carried a
 * double, 26 distinct element-and-environment texts between them** (29 if the per-file rig
 * helpers that sit in the same section are counted), from 46 to 561 lines of double apiece, and
 * only 14 of the 38 shared a text with any other file.
 *
 * ## Why one file is worth the care it takes
 *
 * The cost is not the line count, it is the drift. A double that differs between files is a set
 * of tests that disagree about what a browser does, and the disagreement is silent: C19 had to
 * teach its own copy that `setAttribute('class', …)` writes the token set — which is how every
 * SVG icon in this project is classed, because an SVG element has no settable `className` — and
 * that one line revealed suites which had stopped finding icons they were written to assert on.
 * They were green the whole time.
 *
 * ## What it doubles
 *
 * `FakeElement` is the element: the token set behind `className` and `classList`, the child
 * list, attributes, listeners, `dataset`, an inline `style`, the measured box, a 2D canvas
 * context that refuses nothing, and a class-selector `querySelector` over the subtree.
 * `FakeAnimation` is one move handed back by `element.animate`. `FakeDom` is the environment —
 * `document`, `window`, `localStorage`, the timers, `performance.now` and the frame hook —
 * installed on `globalThis` and taken off again.
 *
 * ## What it deliberately does not do
 *
 * - **No CSS.** Nothing cascades, nothing computes, and `style` holds only what was assigned.
 *   A key never written reads back `undefined`, not `''` — `Splash.test.ts` pins that. The six
 *   files whose own double pre-seeded keys to `''` pass that seed to the constructor, because
 *   three of them assert on it; see the constructor for why neither answer is the default.
 * - **No layout.** `getBoundingClientRect` hands back whatever `rect` holds, and `offsetWidth`
 *   and friends are fields a test sets. Nothing moves when a child is appended.
 * - **No selector engine.** `querySelector` understands one class token and nothing else — not
 *   a tag, not a descendant combinator, not an attribute. Every call site in the suite passes
 *   `.one-class`, and a double that pretended to more would be read as a promise it cannot keep.
 * - **No event propagation.** A listener list per type per element, and `fire` calls the ones on
 *   the element it is given. Nothing bubbles, nothing captures, `stopPropagation` records
 *   nothing because there is nothing for it to stop.
 * - **No timers of its own.** The clock does not advance unless a test advances it, and a
 *   `setTimeout` fires only when `runTimers` or `runTo` reaches it.
 * - **Not a browser.** Where a file's own double answered a question differently — the two
 *   `matchMedia` answers, a recording canvas context, the extra `instanceof` globals one file
 *   registers — the difference is a parameter or a subclass in that file, not a default here.
 *   See BACKLOG #79 for which files kept their own and why.
 */

// =========================================== TYPES ============================================ \\
//#region Types
/**
 * A listener as the double stores it: it is handed a `FakeEvent`, never a real one.
 *
 * The parameter is optional because two suites dispatch by calling the stored function with no
 * argument at all — the handlers they exercise are `() => void` and read nothing off the event,
 * so passing one would be inventing a value they never saw. A handler that does take an event
 * is still assignable here, and nothing about this changes at run time: it is a type.
 */
export type Listener = (event?: FakeEvent) => void;

/**
 * The event shape the suite dispatches.
 *
 * Every field is optional because a test names only the ones the code under test reads; the two
 * methods are not, because the code calls them unconditionally.
 */
export interface FakeEvent {
  key?: string;
  code?: string;
  button?: number;
  repeat?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** What `getBoundingClientRect` hands back — a plain record, not a `DOMRect`. */
export interface FakeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** An inline `style`: assigned keys only, plus the one method the screens call on it. */
export type FakeStyle = Record<string, string> & { setProperty: (name: string, value: string) => void };

/** The `localStorage` double — the whole `Storage` surface the client actually uses. */
export interface FakeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  readonly length: number;
}

/** One pending `setTimeout`, with the moment it is due and whether it was cancelled. */
export interface FakeTimer {
  readonly at: number;
  readonly fn: () => void;
  cancelled: boolean;
}

/** What a caller may change about the environment. Anything left out keeps the default. */
export interface FakeDomOptions {
  /**
   * What `window.matchMedia(query).matches` answers.
   *
   * The default reads `reducedMotion` off the handle and ignores the query, which is what
   * sixteen of the suite's doubles did. One file asks about `pointer: fine` instead and passes
   * its own, because the two are different answers to the same call and a shared default would
   * change what one of them sees.
   */
  readonly matchMedia?: (query: string) => boolean;
  /** The moment `performance.now()` starts at, in ms. The doubles all used 100,000. */
  readonly startMs?: number;
  /** Builds the element a `document.createElement` hands back. For a file that subclasses. */
  readonly createElement?: (tag: string) => FakeElement;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * The globals `install` writes and `restore` deletes, in the order the doubles listed them.
 *
 * One list for both directions: a global installed and not removed is the failure mode this
 * suite cannot afford, because `environment: 'node'` means a stray `window` is read by the next
 * file as a browser.
 */
const INSTALLED = [
  'document',
  'HTMLElement',
  'KeyboardEvent',
  'localStorage',
  'setTimeout',
  'clearTimeout',
  'window',
  'performance',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

/**
 * The environment currently installed, so `FakeElement.animate` can find the animation list.
 *
 * Module state is safe here only because `vitest.config.ts` keeps `isolate` on: every test file
 * gets its own module registry, so this is never shared between two files. The config comment
 * says why `isolate: false` stays off, and this is one more reason.
 */
let active: FakeDom | null = null;
//#endregion

// ==================================== CLASS FakeAnimation ===================================== \\
//#region Class FakeAnimation
/** One move handed back by `element.animate`, with the hooks the screens use on it. */
export class FakeAnimation {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  onfinish: null | (() => void) = null;
  oncancel: null | (() => void) = null;
  playbackRate = 1;
  cancelled = false;
  finished = false;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(
    readonly el: FakeElement,
    readonly frames: readonly Record<string, unknown>[],
    readonly options: Record<string, unknown>,
  ) {}
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** What `skip` does to a move already running: run it out, do not throw it away. */
  finish(): void {
    this.finished = true;
    this.onfinish?.();
  }

  cancel(): void {
    this.cancelled = true;
    this.oncancel?.();
  }
  //#endregion
}
//#endregion

// ===================================== CLASS FakeElement ====================================== \\
//#region Class FakeElement
/**
 * The element. One class for every tag, because nothing in the suite asks what tag it is except
 * by reading `tag`.
 *
 * A file that needs a different answer to one question subclasses this and overrides the one
 * method — four files override `getContext` to record the calls made into it — rather than
 * growing a flag here for a behaviour only they want.
 */
export class FakeElement {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly tokens = new Set<string>();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly dataset: Record<string, string> = {};
  readonly anims: FakeAnimation[] = [];
  readonly style: FakeStyle = Object.assign({} as Record<string, string>, {
    setProperty: (name: string, value: string): void => {
      this.style[name] = value;
    },
  });

  textContent = '';
  hidden = false;
  disabled = false;
  type = '';
  value = '';
  title = '';
  src = '';
  alt = '';
  draggable = true;
  width = 0;
  height = 0;
  /**
   * The form and anchor properties the screens assign, at a real element's own defaults.
   *
   * Only four doubles carried any of these and no two disagreed on a default, so they are here
   * as one set rather than four. They are inert for the rest: a field nothing reads and nothing
   * writes is a field, and TypeScript is the only reason they have to exist at all — a screen
   * that sets `input.maxLength` will not compile against a class that has no such property.
   */
  tabIndex = -1;
  placeholder = '';
  maxLength = -1;
  readOnly = false;
  spellcheck = true;
  autocomplete = '';
  min = '';
  max = '';
  step = '';
  href = '';
  target = '';
  rel = '';
  /** How many times `focus()` and `blur()` were called. Three suites assert on these. */
  focusCount = 0;
  blurCount = 0;
  offsetWidth = 200;
  offsetHeight = 40;
  /** `Splash.skullShift` measures the box with this; 0 unless a test sets it. */
  clientWidth = 0;
  clientHeight = 0;
  parent: FakeElement | null = null;
  rect: FakeRect = { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 };

  readonly classList = {
    add: (...tokens: string[]): void => {
      for (const token of tokens) this.tokens.add(token);
    },
    remove: (...tokens: string[]): void => {
      for (const token of tokens) this.tokens.delete(token);
    },
    toggle: (token: string, on?: boolean): void => {
      if (on ?? !this.tokens.has(token)) this.tokens.add(token);
      else this.tokens.delete(token);
    },
    contains: (token: string): boolean => this.tokens.has(token),
  };
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  /**
   * `styleSeed` pre-writes inline style keys, so that reading one back before anything assigned
   * it gives `''` rather than `undefined`.
   *
   * Six of the suite's own doubles seeded `opacity`, `transform` and sometimes `visibility` that
   * way, with the note *"unset properties read back as `''`, which is what a real
   * `CSSStyleDeclaration` does"* — and three files assert on exactly that: `HudTactical` twice on
   * a cook bar and a breath bar that have not been touched yet, `Hud` on the crosshair's
   * `visibility`, `BearingIndicator` on an arrow's `transform`.
   *
   * It is a seed and not the default because the default is also pinned, the other way:
   * `Splash.test.ts` asserts `protocol.style['visibility']` is **undefined** before the stage
   * that writes it runs. The two groups want opposite answers, so neither gets to be the rule —
   * the file that needs the seed passes it, and the rest read back `undefined`.
   */
  constructor(
    readonly tag: string,
    styleSeed: Readonly<Record<string, string>> = {},
  ) {
    Object.assign(this.style, styleSeed);
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get className(): string {
    return [...this.tokens].join(' ');
  }

  set className(value: string) {
    this.tokens.clear();
    for (const token of value.split(' ')) if (token !== '') this.tokens.add(token);
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    const siblings = this.parent?.children;
    if (siblings !== undefined) siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }

  /**
   * A deep clone: the tag, the attributes, and every child cloned in turn.
   *
   * Four of the suite's doubles carried exactly this and a fifth (`MatchHud`) carried a shallow
   * one that dropped the children, which is drift rather than a decision — a real
   * `cloneNode(true)` is deep and `cloneNode(false)` is not, and neither of them read the flag.
   * The deep one is here because it is what a killfeed row needs: the row is cloned from a
   * template and the weapon icon inside it has to come along.
   *
   * The class comes with it only because `setAttribute` reflects `class` into the token set. In
   * the copies where it did not, a clone came out unclassed and `querySelector` could not find
   * it — the same silent hole C19 found, one step further along.
   */
  cloneNode(_deep?: boolean): FakeElement {
    const copy = new FakeElement(this.tag);
    for (const [key, value] of this.attributes) copy.setAttribute(key, value);
    for (const child of this.children) copy.appendChild(child.cloneNode(true));
    return copy;
  }

  /**
   * `setAttribute('class', …)` writes the token set, as a real element's does.
   *
   * This is how `makeIconSvg` names its icons: an SVG element has no settable `className`, so
   * every glyph in the project is classed by attribute, and a double that did not reflect it
   * would hide every icon from `querySelector`. That was C19's finding and it is the reason
   * this file exists — see the overview.
   */
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, fn: Listener): void {
    const held = this.listeners.get(type);
    if (held === undefined) this.listeners.set(type, [fn]);
    else held.push(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    const held = this.listeners.get(type);
    if (held === undefined) return;
    const at = held.indexOf(fn);
    if (at >= 0) held.splice(at, 1);
  }

  /** The Web Animations API. Every move lands in `anims`, and in the environment's own list. */
  animate(frames: readonly Record<string, unknown>[] = [], options: Record<string, unknown> = {}): FakeAnimation {
    const anim = new FakeAnimation(this, frames, options);
    this.anims.push(anim);
    active?.animations.push(anim);
    return anim;
  }

  /**
   * A 2D context that refuses nothing: the camo and weapon textures are drawn into one.
   *
   * The lesson from C18 -- `CharacterAssetService` throws *2D canvas context unavailable*
   * without it, and the throw happens deep inside a weapon build rather than at the call.
   *
   * The `Proxy` is what makes it refuse nothing: an unknown property reads back as a function
   * that does nothing, so a drawing routine runs to the end without the double having to list
   * every call it makes. A file that needs to *assert* on those calls overrides this.
   */
  getContext(kind: string): unknown {
    if (kind !== '2d') return null;
    return makeContext2d(this);
  }

  toDataURL(): string {
    return 'data:image/png;base64,x';
  }

  requestPointerLock(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}

  getBoundingClientRect(): FakeRect {
    return this.rect;
  }

  /**
   * Counts the call and does nothing else.
   *
   * Three of the suite's doubles counted and the rest were empty, so counting is the superset:
   * a suite that never reads `focusCount` cannot tell the difference. What it deliberately does
   * *not* do is move `document.activeElement` — one file's double did that, and a focus call
   * that silently rewrites a global is the kind of reach a shared double should not have. That
   * file overrides this method and says so.
   */
  focus(): void {
    this.focusCount++;
  }

  blur(): void {
    this.blurCount++;
  }

  /** One class token, searched over the subtree. See the overview on what this is not. */
  querySelector(selector: string): FakeElement | null {
    return this.queryAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.queryAll(selector);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private queryAll(selector: string): FakeElement[] {
    const token = selector.replace(/^\./, '');
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      if (el.tokens.has(token)) out.push(el);
      for (const child of el.children) walk(child);
    };
    for (const child of this.children) walk(child);
    return out;
  }
  //#endregion
}
//#endregion

// ======================================= CLASS FakeDom ======================================== \\
//#region Class FakeDom
/**
 * The environment around the element, and the handle a test holds on it.
 *
 * A handle rather than a drawer of module-level `let`s, which is what every copy of this used:
 * the state a test wants to read — the listeners `window` was given, the timers still pending,
 * the animations that ran — is reachable from the one object `install` hands back, and
 * `restore` is a method on the same object instead of a list of global names repeated in an
 * `afterEach`.
 */
export class FakeDom {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  /** Listeners `window.addEventListener` was given, by type, in registration order. */
  readonly windowListeners = new Map<string, Listener[]>();
  /** Every `setTimeout` since `install`, in the order it was set; the id is the index plus one. */
  readonly timers: FakeTimer[] = [];
  /** Every move `element.animate` handed out since `install`, across all elements, in order. */
  readonly animations: FakeAnimation[] = [];
  /** What `performance.now()` answers. A test moves this; nothing else does. */
  nowMs: number;
  /** What `matchMedia('(prefers-reduced-motion: reduce)')` answers, under the default. */
  reducedMotion = false;
  /** The root `document.documentElement` hands back, built once per `install`. */
  readonly documentElement = new FakeElement('html');

  private readonly options: FakeDomOptions;
  private readonly storage = new Map<string, string>();
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(options: FakeDomOptions = {}) {
    this.options = options;
    this.nowMs = options.startMs ?? 100_000;
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** Writes the environment onto `globalThis`. Call it once, from a `beforeEach`. */
  install(): this {
    active = this;
    const globals = globalThis as Record<string, unknown>;
    globals['document'] = this.makeDocument();
    globals['HTMLElement'] = FakeElement;
    globals['KeyboardEvent'] = FakeKeyboardEvent;
    globals['localStorage'] = this.makeStorage();
    globals['setTimeout'] = (fn: () => void, ms = 0): number => this.setTimer(fn, ms);
    globals['clearTimeout'] = (id: number): void => this.clearTimer(id);
    globals['window'] = this.makeWindow();
    globals['performance'] = { now: (): number => this.nowMs };
    globals['requestAnimationFrame'] = (): number => 1;
    globals['cancelAnimationFrame'] = (): void => undefined;
    return this;
  }

  /** Takes every global back off. Call it from an `afterEach`, whatever the test did. */
  restore(): void {
    if (active === this) active = null;
    for (const key of INSTALLED) delete (globalThis as Record<string, unknown>)[key];
  }

  /** A keydown or a click dispatched at one element. Nothing bubbles — see the overview. */
  fire(el: FakeElement, type: string, over: Partial<FakeEvent> = {}): void {
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn(makeEvent(over));
  }

  /** The same, at `window`. */
  fireWindow(type: string, over: Partial<FakeEvent> = {}): void {
    for (const fn of [...(this.windowListeners.get(type) ?? [])]) fn(makeEvent(over));
  }

  /**
   * A `window` event that passes `e instanceof KeyboardEvent`.
   *
   * `Splash.onInput` tests for that to let a lone modifier through, so a plain object is not
   * enough: `install` registers a `KeyboardEvent` class globally and this makes one.
   */
  fireKey(type: string, over: Partial<FakeEvent> = {}): void {
    const event = Object.assign(new FakeKeyboardEvent(), makeEvent(over)) as unknown as FakeEvent;
    for (const fn of [...(this.windowListeners.get(type) ?? [])]) fn(event);
  }

  /** Runs every timer whose moment has come, in the order they were set. Answers how many. */
  runTimers(): number {
    let ran = 0;
    for (const timer of [...this.timers]) {
      if (timer.cancelled || timer.at > this.nowMs) continue;
      timer.cancelled = true;
      timer.fn();
      ran++;
    }
    return ran;
  }

  /** Advances the clock to `seconds` after `install`, running what falls due on the way. */
  runTo(seconds: number): void {
    this.nowMs = (this.options.startMs ?? 100_000) + seconds * 1000;
    this.runTimers();
  }

  pendingTimers(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private makeDocument(): Record<string, unknown> {
    const make = this.options.createElement ?? ((tag: string): FakeElement => new FakeElement(tag));
    return {
      createElement: (tag: string): FakeElement => make(tag),
      createElementNS: (_ns: string, tag: string): FakeElement => make(tag),
      documentElement: this.documentElement,
      activeElement: null,
    };
  }

  private makeWindow(): Record<string, unknown> {
    const matches = this.options.matchMedia ?? ((): boolean => this.reducedMotion);
    return {
      localStorage: this.makeStorage(),
      setTimeout: (fn: () => void, ms = 0): number => this.setTimer(fn, ms),
      clearTimeout: (id: number): void => this.clearTimer(id),
      matchMedia: (query: string) => ({ matches: matches(query), media: query }),
      addEventListener: (type: string, fn: Listener): void => {
        const held = this.windowListeners.get(type);
        if (held === undefined) this.windowListeners.set(type, [fn]);
        else held.push(fn);
      },
      removeEventListener: (type: string, fn: Listener): void => {
        const held = this.windowListeners.get(type);
        if (held === undefined) return;
        const at = held.indexOf(fn);
        if (at >= 0) held.splice(at, 1);
      },
    };
  }

  /**
   * One store behind both `localStorage` and `window.localStorage`, as a browser has.
   *
   * The copies each built two closures over one `Map`, which came to the same thing; this
   * returns a fresh façade over `this.storage` and the identity is not something the suite
   * asserts on.
   */
  private makeStorage(): FakeStorage {
    const held = this.storage;
    return {
      getItem: (key: string): string | null => held.get(key) ?? null,
      setItem: (key: string, value: string): void => void held.set(key, value),
      removeItem: (key: string): void => void held.delete(key),
      clear: (): void => held.clear(),
      key: (index: number): string | null => [...held.keys()][index] ?? null,
      get length(): number {
        return held.size;
      },
    };
  }

  private setTimer(fn: () => void, ms: number): number {
    this.timers.push({ at: this.nowMs + ms, fn, cancelled: false });
    return this.timers.length;
  }

  private clearTimer(id: number): void {
    const timer = this.timers[id - 1];
    if (timer !== undefined) timer.cancelled = true;
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Builds the environment and installs it. The one call a `beforeEach` makes.
 *
 * The handle it answers is what the test holds for the rest of the case: `env.runTo(3)`,
 * `env.fireWindow('keydown', { code: 'Space' })`, `env.windowListeners`, and `env.restore()`
 * from the `afterEach`.
 */
export function installFakeDom(options: FakeDomOptions = {}): FakeDom {
  return new FakeDom(options).install();
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * The global `KeyboardEvent` the double registers.
 *
 * Empty on purpose: the only thing the client asks of it is `e instanceof KeyboardEvent`, and a
 * class with fields would invite a test to set them instead of passing them in the event.
 */
class FakeKeyboardEvent {}

/** Fills in the two methods the code calls unconditionally, over whatever the test named. */
function makeEvent(over: Partial<FakeEvent>): FakeEvent {
  return { preventDefault: (): void => undefined, stopPropagation: (): void => undefined, ...over };
}

/** The 2D context behind `FakeElement.getContext`. See that method for why it is a `Proxy`. */
function makeContext2d(canvas: FakeElement): unknown {
  const target: Record<string, unknown> = {
    canvas,
    createLinearGradient: () => ({ addColorStop: (): void => undefined }),
    createRadialGradient: () => ({ addColorStop: (): void => undefined }),
    createPattern: () => null,
    createImageData: (w: number, h: number) => makeImageData(w, h),
    getImageData: (_x: number, _y: number, w: number, h: number) => makeImageData(w, h),
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key as string] : () => undefined),
    set: (t, key, value) => {
      t[key as string] = value;
      return true;
    },
  });
}

/** Pixels for `createImageData` and `getImageData`: zeroed, and never empty. */
function makeImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
  return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
}
//#endregion
