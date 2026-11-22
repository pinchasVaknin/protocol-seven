/**
 * The splash (M17, C6): the logo assembled on black before the menu, once per page load.
 *
 * ## The four stages, as the brief wrote them
 *
 *  1. **Black, and the skull.** The skull fades in at the centre of the screen. PRESS ANY KEY
 *     stands under it, because the rest needs a user gesture (decision 1): the browser will
 *     not run an `AudioContext` before one, and a splash with its sounds missing is worse
 *     than a splash that waits. The key or the click is the gesture; `onGesture` starts the
 *     audio graph, and stage 2 runs from it.
 *  2. **The collision.** PROTOCOL is thrown in from the right, strikes the skull and pushes it
 *     from the screen's centre to its place in the logo; SEVEN follows and joins under it;
 *     the rule between them snaps in. Three bass hits, one to each — *"boom boom boom"*.
 *  3. **The shockwave.** A ring expands out of the logo and fades, with the energy hiss.
 *  4. **The light.** The logo itself lights up — the glow on every piece swells and settles,
 *     the eyes flare — while a ring of the accent goes out with sparks streaking off it; the
 *     chime; and the layer fades away over the menu, which `onReveal` has put up underneath.
 *     A first version washed the whole screen white here; the human asked for the light on
 *     the logo and a ring with sparks instead, and this is that.
 *
 * ## The artwork is the logo, cut
 *
 * The skull is `mark.png` and its breathing eyes `mark-eyes.png` (`Emblem.ts`), which were
 * cut from `logo.png` at (40, 208); PROTOCOL, the rule and SEVEN are three more cuts of the
 * same file (`splash-*.png`), each placed at the offset it was cut from. Assembled, the four
 * are the logo pixel for pixel — the human's artwork, not a typesetting of it — and the
 * lockup on the boot screen is the same picture.
 *
 * ## Driven, not timed
 *
 * The moves are Web Animations (`element.animate`), and the timeline is a list of steps at
 * absolute seconds from the gesture, each on its own timer; a sound is a step like any
 * other. A skip (any key or click once stage 2 has begun) cancels every
 * step still to come, finishes the moves already running, reveals the menu if it has not
 * been, and fades the layer out. `prefers-reduced-motion` goes from the gesture to the fade
 * with the chime alone.
 *
 * ## One stage, one method
 *
 * Each of the six moments after the gesture is a private method named for it, scheduled by
 * `run` at its second from `AT`. A keyframe list that is the same every time is a module
 * constant below; a keyframe list that reads a measurement — the skull's shift, a shake's
 * amplitude, a spark's angle — is built where that measurement is taken, because moving it
 * out would mean passing the number back in.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { el } from './Dom';
import type { ProceduralAudio } from '../engine/ProceduralAudio';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface SplashDeps {
  readonly host: HTMLElement;
  readonly audio: ProceduralAudio;
  /** The gesture arrived: start the audio graph. Called before stage 2's first sound. */
  readonly onGesture: () => void;
  /** The light has peaked: put the menu up under the layer. */
  readonly onReveal: () => void;
  /** The layer is gone. */
  readonly onDone: () => void;
}

type Piece = 'skull' | 'protocol' | 'rule' | 'seven';

/** Where one cut sits in the logo's canvas. */
interface Cut {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const BRAND_ROOT = '/brand';
/** The logo's canvas, which every offset below is in. */
const LOGO = 1024;
/** Where each cut sits in the logo's canvas: x, y, width, height. */
const SKULL = { x: 40, y: 208, w: 438, h: 611 } as const;
const PROTOCOL = { x: 480, y: 400, w: 504, h: 87 } as const;
const RULE = { x: 478, y: 487, w: 514, h: 40 } as const;
const SEVEN = { x: 479, y: 527, w: 509, h: 177 } as const;

/** Seconds from the gesture. */
const AT = {
  protocolFly: 0.3,
  protocolHit: 0.62,
  sevenFly: 1.1,
  sevenHit: 1.42,
  rule: 1.7,
  shock: 2.1,
  light: 3.5,
  reveal: 4.2,
  fadeEnd: 5.2,
} as const;
const SPARK_COUNT = 14;
const FLY_MS = 320;
const PUSH_MS = 260;
const SHAKE_MS = 240;
const SKIP_FADE_MS = 450;

/** How far the fade-out starts after the reveal, so the menu is up before the layer goes. */
const FADE_LAG_SECONDS = 0.1;

/** The accent, written out: every glow below is this colour at some radius and opacity. */
const ACCENT = '63, 169, 199';

/** Stage 1: the skull out of black. */
const SKULL_IN = [
  { opacity: 0, filter: 'brightness(0.6)' },
  { opacity: 1, filter: 'brightness(1)' },
];

/** PRESS ANY KEY, held back so it does not arrive with the skull. */
const PROMPT_IN = [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }];
const PROMPT_OUT = [{ opacity: 1 }, { opacity: 0 }];

/** A word thrown in from off the right. */
const FLY_IN = [
  { transform: 'translateX(140vw)', opacity: 0.4, filter: 'blur(6px)' },
  { transform: 'translateX(0)', opacity: 1, filter: 'blur(0)' },
];

/** The flash on a word that has just been struck. */
const FLASH = [{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }];

/** The rule, snapped out from nothing. */
const RULE_IN = [
  { transform: 'scaleX(0)', opacity: 0.6 },
  { transform: 'scaleX(1)', opacity: 1 },
];

/** The eyes on the third hit: lit from almost nothing. */
const EYES_IN = [
  { opacity: 0.35, filter: `drop-shadow(0 0 0 rgba(${ACCENT}, 0))` },
  { opacity: 1, filter: `drop-shadow(0 0 10px rgba(${ACCENT}, 1)) drop-shadow(0 0 28px rgba(${ACCENT}, 0.8))` },
];

/** The eyes again under the light: white-hot and back. */
const EYES_FLARE = [
  { opacity: 1, filter: `drop-shadow(0 0 10px rgba(${ACCENT}, 1)) drop-shadow(0 0 28px rgba(${ACCENT}, 0.8))` },
  { opacity: 1, filter: `drop-shadow(0 0 18px rgba(200, 245, 255, 1)) drop-shadow(0 0 60px rgba(${ACCENT}, 1))`, offset: 0.3 },
  { opacity: 1, filter: `drop-shadow(0 0 12px rgba(${ACCENT}, 1)) drop-shadow(0 0 36px rgba(${ACCENT}, 0.85))` },
];

/** A shockwave ring, out of the logo's centre. */
const RING_OUT = [
  { transform: 'translate(-50%, -50%) scale(0.12)', opacity: 0.95, borderWidth: '6px' },
  { transform: 'translate(-50%, -50%) scale(3.4)', opacity: 0, borderWidth: '1px' },
];

/** The halo, which goes out with the sparks rather than with the shockwave. */
const HALO_OUT = [
  { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0.9, borderWidth: '4px' },
  { transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0, borderWidth: '1px' },
];

/** The light on one piece of the logo: swells, then settles brighter than it began. */
const GLOW = [
  { filter: `drop-shadow(0 0 0 rgba(${ACCENT}, 0)) brightness(1)` },
  { filter: `drop-shadow(0 0 22px rgba(${ACCENT}, 0.95)) drop-shadow(0 0 60px rgba(${ACCENT}, 0.6)) brightness(1.45)`, offset: 0.35 },
  { filter: `drop-shadow(0 0 12px rgba(${ACCENT}, 0.7)) drop-shadow(0 0 32px rgba(${ACCENT}, 0.35)) brightness(1.12)` },
];

/** One spark: out from the halo, drawn long, gone. */
const SPARK_OUT = [
  { transform: 'rotate(var(--angle)) translateX(14vmin) scaleX(0.2)', opacity: 0 },
  { transform: 'rotate(var(--angle)) translateX(22vmin) scaleX(1)', opacity: 1, offset: 0.25 },
  { transform: 'rotate(var(--angle)) translateX(52vmin) scaleX(0.6)', opacity: 0 },
];
//#endregion

// ======================================== CLASS Splash ======================================== \\
//#region Class Splash
export class Splash {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  private readonly deps: SplashDeps;
  private readonly layer: HTMLElement;
  private readonly box: HTMLElement;
  private readonly pieces: Record<Piece, HTMLElement>;
  private readonly eyes: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly ring2: HTMLElement;
  private readonly halo: HTMLElement;
  private readonly sparks: HTMLElement[] = [];
  private readonly live: Animation[] = [];
  private readonly timers: number[] = [];
  private gestured = false;
  private revealed = false;
  private finished = false;
  private listening = false;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: SplashDeps) {
    this.deps = deps;
    this.layer = document.createElement('div');
    this.layer.className = 'splash';
    this.box = document.createElement('div');
    this.box.className = 'splash__box';

    const skull = createSkull();
    this.eyes = skull.querySelector('.splash__eyes') as HTMLElement;
    this.pieces = {
      skull,
      protocol: createWord(PROTOCOL, `${BRAND_ROOT}/splash-protocol.png`, 'splash__word'),
      rule: createWord(RULE, `${BRAND_ROOT}/splash-rule.png`, 'splash__rule'),
      seven: createWord(SEVEN, `${BRAND_ROOT}/splash-seven.png`, 'splash__word'),
    };

    this.ring = createRing('');
    this.ring2 = createRing('splash__ring--second');
    this.halo = createRing('splash__halo');
    for (let i = 0; i < SPARK_COUNT; i++) this.sparks.push(createSpark(i));

    this.prompt = document.createElement('span');
    this.prompt.className = 'splash__prompt';
    this.prompt.textContent = 'PRESS ANY KEY';

    const { protocol, rule, seven } = this.pieces;
    this.box.append(this.ring, this.ring2, this.halo, ...this.sparks, skull, protocol, rule, seven);
    this.layer.append(this.box, this.prompt);
    deps.host.appendChild(this.layer);
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  /** Stage 1: the skull, and the gate. */
  play(): void {
    const skull = this.pieces.skull;
    // The skull starts at the screen's centre: shifted right by the distance from its centre
    // in the logo to the logo's centre, in the box's own pixels.
    skull.style.transform = `translateX(${this.skullShift()}px)`;
    this.track(skull.animate(SKULL_IN, { duration: 900, easing: 'ease-out', fill: 'forwards' }));
    this.track(this.prompt.animate(PROMPT_IN, { duration: 1400, delay: 400, fill: 'forwards' }));
    this.listen();
  }

  /**
   * A key or a click once stage 2 has begun: straight to the end.
   *
   * The moves already running are *finished*, not cancelled — a cancelled `fill: forwards`
   * animation snaps its element back to where it started, and a skull jumping back to the
   * centre under the fade is not an ending — and the steps not yet taken are dropped.
   */
  skip(): void {
    if (this.finished) return;
    this.dropTimers();
    for (const a of this.live) a.finish();
    this.live.length = 0;
    this.reveal();
    this.fadeOut(SKIP_FADE_MS);
  }

  dispose(): void {
    this.dropTimers();
    for (const a of this.live) a.cancel();
    this.live.length = 0;
    this.unlisten();
    this.layer.remove();
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  /** Any key or click: the gesture, then the skip. */
  private readonly onInput = (e: Event): void => {
    // A modifier on its own is not a press: somebody reaching for a shortcut, or the console.
    if (e instanceof KeyboardEvent && (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta')) return;
    if (!this.gestured) {
      this.gestured = true;
      this.deps.onGesture();
      void this.run();
      return;
    }
    this.skip();
  };

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('keydown', this.onInput, true);
    window.addEventListener('pointerdown', this.onInput, true);
  }

  private unlisten(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('keydown', this.onInput, true);
    window.removeEventListener('pointerdown', this.onInput, true);
  }

  // -- stages 2 to 4 -----------------------------------------------------------

  /** The whole timeline, scheduled from the gesture. One line per moment. */
  private async run(): Promise<void> {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.prompt.animate(PROMPT_OUT, { duration: 200, fill: 'forwards' });
    if (reduced) {
      this.runReduced();
      return;
    }

    // PROTOCOL: in from the right; on impact the skull is pushed to its place, a little past
    // it and back, the screen shakes and the word flashes.
    this.flyIn(this.pieces.protocol, AT.protocolFly);
    this.at(AT.protocolHit, () => this.strikeProtocol());
    this.flashAt(this.pieces.protocol, AT.protocolHit);
    this.shakeAt(AT.protocolHit, 7);

    // SEVEN: the same, and the skull takes the hit without moving.
    this.flyIn(this.pieces.seven, AT.sevenFly);
    this.at(AT.sevenHit, () => this.deps.audio.playSplashHit(1));
    this.flashAt(this.pieces.seven, AT.sevenHit);
    this.shakeAt(AT.sevenHit, 9);

    // The rule snaps in from the left; the third hit; the eyes flare.
    this.at(AT.rule, () => this.snapRule());
    this.shakeAt(AT.rule, 5);

    this.at(AT.shock, () => this.shockwave());
    this.at(AT.light, () => this.light());
    this.at(AT.reveal, () => this.reveal());
    this.at(AT.reveal + FADE_LAG_SECONDS, () => {
      this.fadeOut((AT.fadeEnd - AT.reveal - FADE_LAG_SECONDS) * 1000);
    });
  }

  /** `prefers-reduced-motion`: the chime, the menu, the fade, and nothing that moves. */
  private runReduced(): void {
    this.at(0.2, () => this.deps.audio.playSplashChime());
    this.at(0.4, () => this.reveal());
    this.at(0.5, () => this.fadeOut(900));
  }

  /** The first hit: the sound, and the push that puts the skull in its place. */
  private strikeProtocol(): void {
    this.deps.audio.playSplashHit(0);
    const shift = this.skullShift();
    this.track(
      this.pieces.skull.animate(
        [
          { transform: `translateX(${shift}px)` },
          { transform: `translateX(${-shift * 0.06}px)`, offset: 0.7 },
          { transform: 'translateX(0)' },
        ],
        { duration: PUSH_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
      ),
    );
  }

  /** The third hit: the rule out from nothing, and the eyes lit behind it. */
  private snapRule(): void {
    this.deps.audio.playSplashHit(2);
    const rule = this.pieces.rule;
    rule.style.visibility = 'visible';
    this.track(
      rule.animate(RULE_IN, { duration: 180, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'forwards' }),
    );
    this.track(this.eyes.animate(EYES_IN, { duration: 420, easing: 'ease-out', fill: 'forwards' }));
  }

  /** Stage 3: two rings out of the logo's centre, the second a beat behind. */
  private shockwave(): void {
    this.deps.audio.playSplashShock();
    for (const [ring, delay] of [
      [this.ring, 0],
      [this.ring2, 140],
    ] as const) {
      this.track(
        ring.animate(RING_OUT, { duration: 1300, delay, easing: 'cubic-bezier(0.1, 0.7, 0.2, 1)', fill: 'forwards' }),
      );
    }
  }

  /**
   * Stage 4: the logo's own glow swells and settles, the eyes flare again, the halo goes out
   * with its sparks; the menu goes up under the layer, which fades away over it.
   */
  private light(): void {
    this.deps.audio.playSplashChime();
    const { skull, protocol, rule, seven } = this.pieces;
    for (const piece of [skull, protocol, rule, seven]) {
      this.track(piece.animate(GLOW, { duration: 1300, easing: 'ease-out', fill: 'forwards' }));
    }
    this.track(this.eyes.animate(EYES_FLARE, { duration: 1200, easing: 'ease-out', fill: 'forwards' }));
    this.track(
      this.halo.animate(HALO_OUT, { duration: 1100, easing: 'cubic-bezier(0.1, 0.7, 0.2, 1)', fill: 'forwards' }),
    );
    this.sparks.forEach((spark, i) => {
      this.track(
        spark.animate(SPARK_OUT, {
          duration: 900 + (i % 4) * 90,
          delay: (i * 23) % 140,
          easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)',
          fill: 'forwards',
        }),
      );
    });
  }

  /** A word in from off the right, made visible as it starts rather than before. */
  private flyIn(el: HTMLElement, at: number): void {
    this.at(at, () => {
      el.style.visibility = 'visible';
      this.track(el.animate(FLY_IN, { duration: FLY_MS, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'forwards' }));
    });
  }

  private flashAt(el: HTMLElement, at: number): void {
    this.at(at, () => {
      this.track(el.animate(FLASH, { duration: 220, easing: 'ease-out' }));
    });
  }

  /** The screen taking a hit: the box knocked `px` and back, in four steps. */
  private shakeAt(at: number, px: number): void {
    this.at(at, () => {
      this.track(
        this.box.animate(
          [
            { transform: 'translate(0, 0)' },
            { transform: `translate(${px}px, ${-px * 0.6}px)` },
            { transform: `translate(${-px * 0.8}px, ${px * 0.5}px)` },
            { transform: `translate(${px * 0.5}px, ${px * 0.3}px)` },
            { transform: 'translate(0, 0)' },
          ],
          { duration: SHAKE_MS, easing: 'ease-out' },
        ),
      );
    });
  }

  // -- the ending --------------------------------------------------------------

  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.deps.onReveal();
  }

  private fadeOut(ms: number): void {
    if (this.finished) return;
    this.finished = true;
    this.unlisten();
    const fade = this.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    fade.onfinish = () => this.finish();
    fade.oncancel = () => this.finish();
  }

  private finish(): void {
    this.unlisten();
    this.layer.remove();
    this.deps.onDone();
  }

  // -- helpers -----------------------------------------------------------------

  /** Schedule `fn` at `seconds` from now. */
  private at(seconds: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, seconds * 1000));
  }

  /** Every step still to come, dropped. Both the skip and the teardown start here. */
  private dropTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.length = 0;
  }

  private track(a: Animation): void {
    this.live.push(a);
  }

  /** The skull's centre in the logo to the logo's centre, in the box's rendered pixels. */
  private skullShift(): number {
    const centre = SKULL.x + SKULL.w / 2;
    return ((LOGO / 2 - centre) / LOGO) * this.box.clientWidth;
  }
  //#endregion
}
//#endregion

// ===================================== EXPORTED FUNCTIONS ===================================== \\
//#region Exported Functions
/**
 * Whether the splash plays before the menu: not for the bot harness, which starts its match
 * from the menu and cannot press a key, and not when asked not to (`?nosplash`, declared in
 * `shared/net/UrlFlags.ts`).
 */
export function splashWanted(search: string): boolean {
  const params = new URLSearchParams(search);
  return !params.has('harness') && !params.has('nosplash');
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/** One cut of the logo, placed at the offset it was cut from, as a percentage of the canvas. */
function place(el: HTMLElement, at: Cut): void {
  el.style.left = `${(at.x / LOGO) * 100}%`;
  el.style.top = `${(at.y / LOGO) * 100}%`;
  el.style.width = `${(at.w / LOGO) * 100}%`;
  el.style.height = `${(at.h / LOGO) * 100}%`;
}

/** A cut of the logo as an image: never dragged, and never in the accessibility tree. */
function img(src: string, className: string): HTMLImageElement {
  const i = el('img', className);
  i.src = src;
  i.alt = '';
  i.draggable = false;
  return i;
}

/** The skull and the eyes over it, which are two images of one piece. */
function createSkull(): HTMLElement {
  const skull = el('div', 'splash__piece splash__skull');
  place(skull, SKULL);
  skull.appendChild(img(`${BRAND_ROOT}/mark.png`, 'splash__img'));
  skull.appendChild(img(`${BRAND_ROOT}/mark-eyes.png`, 'splash__img splash__eyes'));
  return skull;
}

/** PROTOCOL, the rule or SEVEN: one cut, one image. */
function createWord(at: Cut, src: string, modifier: string): HTMLElement {
  const word = el('div', `splash__piece ${modifier}`);
  place(word, at);
  word.appendChild(img(src, 'splash__img'));
  return word;
}

function createRing(modifier: string): HTMLElement {
  const ring = el('div', modifier === '' ? 'splash__ring' : `splash__ring ${modifier}`);
  return ring;
}

/**
 * One streak off the halo.
 *
 * Sparks at fixed angles with a little irregularity, each its own length, so the ring reads
 * as energy rather than as geometry.
 */
function createSpark(i: number): HTMLElement {
  const spark = el('i', 'splash__spark');
  const angle = (360 / SPARK_COUNT) * i + ((i * 37) % 11) - 5;
  spark.style.setProperty('--angle', `${angle}deg`);
  spark.style.setProperty('--length', `${6 + ((i * 53) % 9)}vmin`);
  return spark;
}
//#endregion
