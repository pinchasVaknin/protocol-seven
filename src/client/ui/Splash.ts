import type { ProceduralAudio } from '../engine/ProceduralAudio';

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
 */

/**
 * Whether the splash plays before the menu: not for the bot harness, which starts its match
 * from the menu and cannot press a key, and not when asked not to (`?nosplash`, declared in
 * `shared/net/UrlFlags.ts`).
 */
export function splashWanted(search: string): boolean {
  const params = new URLSearchParams(search);
  return !params.has('harness') && !params.has('nosplash');
}

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

const BRAND_ROOT = '/brand';
/** The logo's canvas, which every offset below is in. */
const LOGO = 1024;
/** Where each cut sits in the logo's canvas: x, y, width, height. */
const SKULL = { x: 40, y: 208, w: 438, h: 611 } as const;
const PROTOCOL = { x: 480, y: 400, w: 504, h: 87 } as const;
const RULE = { x: 478, y: 487, w: 514, h: 40 } as const;
const SEVEN = { x: 479, y: 527, w: 509, h: 177 } as const;

/** Seconds from the gesture. */
const T = {
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

type Piece = 'skull' | 'protocol' | 'rule' | 'seven';

export class Splash {
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

  constructor(deps: SplashDeps) {
    this.deps = deps;
    this.layer = document.createElement('div');
    this.layer.className = 'splash';
    this.box = document.createElement('div');
    this.box.className = 'splash__box';

    const place = (el: HTMLElement, at: { x: number; y: number; w: number; h: number }): void => {
      el.style.left = `${(at.x / LOGO) * 100}%`;
      el.style.top = `${(at.y / LOGO) * 100}%`;
      el.style.width = `${(at.w / LOGO) * 100}%`;
      el.style.height = `${(at.h / LOGO) * 100}%`;
    };
    const img = (src: string, className: string): HTMLImageElement => {
      const i = document.createElement('img');
      i.className = className;
      i.src = src;
      i.alt = '';
      i.draggable = false;
      return i;
    };

    const skull = document.createElement('div');
    skull.className = 'splash__piece splash__skull';
    place(skull, SKULL);
    skull.appendChild(img(`${BRAND_ROOT}/mark.png`, 'splash__img'));
    this.eyes = img(`${BRAND_ROOT}/mark-eyes.png`, 'splash__img splash__eyes');
    skull.appendChild(this.eyes);

    const protocol = document.createElement('div');
    protocol.className = 'splash__piece splash__word';
    place(protocol, PROTOCOL);
    protocol.appendChild(img(`${BRAND_ROOT}/splash-protocol.png`, 'splash__img'));
    const rule = document.createElement('div');
    rule.className = 'splash__piece splash__rule';
    place(rule, RULE);
    rule.appendChild(img(`${BRAND_ROOT}/splash-rule.png`, 'splash__img'));
    const seven = document.createElement('div');
    seven.className = 'splash__piece splash__word';
    place(seven, SEVEN);
    seven.appendChild(img(`${BRAND_ROOT}/splash-seven.png`, 'splash__img'));
    this.pieces = { skull, protocol, rule, seven };

    this.ring = document.createElement('div');
    this.ring.className = 'splash__ring';
    this.ring2 = document.createElement('div');
    this.ring2.className = 'splash__ring splash__ring--second';
    this.halo = document.createElement('div');
    this.halo.className = 'splash__ring splash__halo';
    // Sparks off the halo: streaks at fixed angles with a little irregularity, each its own
    // length, so the ring reads as energy rather than as geometry.
    for (let i = 0; i < SPARK_COUNT; i++) {
      const spark = document.createElement('i');
      spark.className = 'splash__spark';
      const angle = (360 / SPARK_COUNT) * i + ((i * 37) % 11) - 5;
      spark.style.setProperty('--angle', `${angle}deg`);
      spark.style.setProperty('--length', `${6 + ((i * 53) % 9)}vmin`);
      this.sparks.push(spark);
    }

    this.prompt = document.createElement('span');
    this.prompt.className = 'splash__prompt';
    this.prompt.textContent = 'PRESS ANY KEY';

    this.box.append(this.ring, this.ring2, this.halo, ...this.sparks, skull, protocol, rule, seven);
    this.layer.append(this.box, this.prompt);
    deps.host.appendChild(this.layer);
  }

  /** Stage 1: the skull, and the gate. */
  play(): void {
    const skull = this.pieces.skull;
    // The skull starts at the screen's centre: shifted right by the distance from its centre
    // in the logo to the logo's centre, in the box's own pixels.
    skull.style.transform = `translateX(${this.skullShift()}px)`;
    this.track(
      skull.animate([{ opacity: 0, filter: 'brightness(0.6)' }, { opacity: 1, filter: 'brightness(1)' }], {
        duration: 900,
        easing: 'ease-out',
        fill: 'forwards',
      }),
    );
    this.track(
      this.prompt.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], {
        duration: 1400,
        delay: 400,
        fill: 'forwards',
      }),
    );
    this.listen();
  }

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

  private async run(): Promise<void> {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.prompt.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    if (reduced) {
      this.at(0.2, () => this.deps.audio.playSplashChime());
      this.at(0.4, () => this.reveal());
      this.at(0.5, () => this.fadeOut(900));
      return;
    }

    const { skull, protocol, rule, seven } = this.pieces;
    const fly = (el: HTMLElement, at: number): void => {
      this.at(at, () => {
        el.style.visibility = 'visible';
        this.track(
          el.animate(
            [
              { transform: 'translateX(140vw)', opacity: 0.4, filter: 'blur(6px)' },
              { transform: 'translateX(0)', opacity: 1, filter: 'blur(0)' },
            ],
            { duration: FLY_MS, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'forwards' },
          ),
        );
      });
    };
    const flash = (el: HTMLElement, at: number): void => {
      this.at(at, () => {
        this.track(
          el.animate([{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], { duration: 220, easing: 'ease-out' }),
        );
      });
    };
    const shake = (at: number, px: number): void => {
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
    };

    // PROTOCOL: in from the right; on impact the skull is pushed to its place, a little past
    // it and back, the screen shakes and the word flashes.
    fly(protocol, T.protocolFly);
    this.at(T.protocolHit, () => {
      this.deps.audio.playSplashHit(0);
      const shift = this.skullShift();
      this.track(
        skull.animate(
          [
            { transform: `translateX(${shift}px)` },
            { transform: `translateX(${-shift * 0.06}px)`, offset: 0.7 },
            { transform: 'translateX(0)' },
          ],
          { duration: PUSH_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' },
        ),
      );
    });
    flash(protocol, T.protocolHit);
    shake(T.protocolHit, 7);

    // SEVEN: the same, and the skull takes the hit without moving.
    fly(seven, T.sevenFly);
    this.at(T.sevenHit, () => this.deps.audio.playSplashHit(1));
    flash(seven, T.sevenHit);
    shake(T.sevenHit, 9);

    // The rule snaps in from the left; the third hit; the eyes flare.
    this.at(T.rule, () => {
      this.deps.audio.playSplashHit(2);
      rule.style.visibility = 'visible';
      this.track(
        rule.animate([{ transform: 'scaleX(0)', opacity: 0.6 }, { transform: 'scaleX(1)', opacity: 1 }], {
          duration: 180,
          easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
          fill: 'forwards',
        }),
      );
      this.track(
        this.eyes.animate(
          [
            { opacity: 0.35, filter: 'drop-shadow(0 0 0 rgba(63, 169, 199, 0))' },
            { opacity: 1, filter: 'drop-shadow(0 0 10px rgba(63, 169, 199, 1)) drop-shadow(0 0 28px rgba(63, 169, 199, 0.8))' },
          ],
          { duration: 420, easing: 'ease-out', fill: 'forwards' },
        ),
      );
    });
    shake(T.rule, 5);

    // The shockwave: two rings out of the logo's centre.
    this.at(T.shock, () => {
      this.deps.audio.playSplashShock();
      for (const [ring, delay] of [
        [this.ring, 0],
        [this.ring2, 140],
      ] as const) {
        this.track(
          ring.animate(
            [
              { transform: 'translate(-50%, -50%) scale(0.12)', opacity: 0.95, borderWidth: '6px' },
              { transform: 'translate(-50%, -50%) scale(3.4)', opacity: 0, borderWidth: '1px' },
            ],
            { duration: 1300, delay, easing: 'cubic-bezier(0.1, 0.7, 0.2, 1)', fill: 'forwards' },
          ),
        );
      }
    });

    // The light: the logo's own glow swells and settles, the eyes flare again, the halo
    // goes out with its sparks; the menu goes up under the layer, which fades away over it.
    this.at(T.light, () => {
      this.deps.audio.playSplashChime();
      for (const piece of [skull, protocol, rule, seven]) {
        this.track(
          piece.animate(
            [
              { filter: 'drop-shadow(0 0 0 rgba(63, 169, 199, 0)) brightness(1)' },
              { filter: 'drop-shadow(0 0 22px rgba(63, 169, 199, 0.95)) drop-shadow(0 0 60px rgba(63, 169, 199, 0.6)) brightness(1.45)', offset: 0.35 },
              { filter: 'drop-shadow(0 0 12px rgba(63, 169, 199, 0.7)) drop-shadow(0 0 32px rgba(63, 169, 199, 0.35)) brightness(1.12)' },
            ],
            { duration: 1300, easing: 'ease-out', fill: 'forwards' },
          ),
        );
      }
      this.track(
        this.eyes.animate(
          [
            { opacity: 1, filter: 'drop-shadow(0 0 10px rgba(63, 169, 199, 1)) drop-shadow(0 0 28px rgba(63, 169, 199, 0.8))' },
            { opacity: 1, filter: 'drop-shadow(0 0 18px rgba(200, 245, 255, 1)) drop-shadow(0 0 60px rgba(63, 169, 199, 1))', offset: 0.3 },
            { opacity: 1, filter: 'drop-shadow(0 0 12px rgba(63, 169, 199, 1)) drop-shadow(0 0 36px rgba(63, 169, 199, 0.85))' },
          ],
          { duration: 1200, easing: 'ease-out', fill: 'forwards' },
        ),
      );
      this.track(
        this.halo.animate(
          [
            { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0.9, borderWidth: '4px' },
            { transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0, borderWidth: '1px' },
          ],
          { duration: 1100, easing: 'cubic-bezier(0.1, 0.7, 0.2, 1)', fill: 'forwards' },
        ),
      );
      this.sparks.forEach((spark, i) => {
        this.track(
          spark.animate(
            [
              { transform: 'rotate(var(--angle)) translateX(14vmin) scaleX(0.2)', opacity: 0 },
              { transform: 'rotate(var(--angle)) translateX(22vmin) scaleX(1)', opacity: 1, offset: 0.25 },
              { transform: 'rotate(var(--angle)) translateX(52vmin) scaleX(0.6)', opacity: 0 },
            ],
            { duration: 900 + (i % 4) * 90, delay: (i * 23) % 140, easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'forwards' },
          ),
        );
      });
    });
    this.at(T.reveal, () => this.reveal());
    this.at(T.reveal + 0.1, () => this.fadeOut((T.fadeEnd - T.reveal - 0.1) * 1000));
  }

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

  /**
   * A key or a click once stage 2 has begun: straight to the end.
   *
   * The moves already running are *finished*, not cancelled — a cancelled `fill: forwards`
   * animation snaps its element back to where it started, and a skull jumping back to the
   * centre under the fade is not an ending — and the steps not yet taken are dropped.
   */
  skip(): void {
    if (this.finished) return;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.length = 0;
    for (const a of this.live) a.finish();
    this.live.length = 0;
    this.reveal();
    this.fadeOut(SKIP_FADE_MS);
  }

  private finish(): void {
    this.unlisten();
    this.layer.remove();
    this.deps.onDone();
  }

  dispose(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.length = 0;
    for (const a of this.live) a.cancel();
    this.live.length = 0;
    this.unlisten();
    this.layer.remove();
  }

  // -- helpers -----------------------------------------------------------------

  /** Schedule `fn` at `seconds` from now. */
  private at(seconds: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, seconds * 1000));
  }

  private track(a: Animation): void {
    this.live.push(a);
  }

  /** The skull's centre in the logo to the logo's centre, in the box's rendered pixels. */
  private skullShift(): number {
    const centre = SKULL.x + SKULL.w / 2;
    return ((LOGO / 2 - centre) / LOGO) * this.box.clientWidth;
  }
}
