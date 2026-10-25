import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Btn } from '../../shared/core/InputCommand';
import { LocalBtn } from '../../shared/core/Keybinds';
import { clamp, wrapAngle, DEG2RAD } from '../../shared/core/MathUtil';
import { Input } from './Input';

/**
 * The one place that touches keyboard, mouse and pointer lock, pinned before unit C1's
 * refactor.
 *
 * Every rule in this file is reachable only through a DOM event, so the DOM is faked: a window
 * and a document that record their listeners, a canvas that can refuse a pointer lock, and an
 * `HTMLElement` for the focus guard to recognise. The fakes are installed per case and removed
 * after it, so nothing leaks into another test file — the suite runs on `environment: 'node'`
 * and a stray global `window` would be read by somebody else as a browser.
 *
 * What is asserted is only what crosses the public surface: the command a tick is given, the
 * view angles, the lock getters, and the listeners the class registered.
 */

// ========================================== the fakes =========================================

type Handler = (event: unknown) => void;

class FakeTarget {
  readonly handlers = new Map<string, Set<Handler>>();

  addEventListener(type: string, handler: Handler): void {
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set<Handler>();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler);
  }

  count(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  dispatch(type: string, event: Record<string, unknown> = {}): Record<string, unknown> {
    const full = { preventDefault: (): void => void (full.defaultPrevented = true), defaultPrevented: false, ...event };
    if (event.preventDefault === undefined) {
      full.preventDefault = (): void => void (full.defaultPrevented = true);
    }
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(full);
    return full;
  }
}

class FakeCanvas extends FakeTarget {
  lockRequests = 0;
  /** What `requestPointerLock` returns: older builds answer `undefined`. */
  lockResult: unknown = undefined;

  requestPointerLock(): unknown {
    this.lockRequests++;
    return this.lockResult;
  }
}

class FakeElement {
  constructor(
    readonly tagName: string,
    readonly isContentEditable = false,
  ) {}
}

let windowTarget: FakeTarget;
let documentTarget: FakeTarget & {
  pointerLockElement: unknown;
  fullscreenElement: unknown;
  exitPointerLock(): void;
  body: { classList: { toggle(name: string, on: boolean): void } };
};
let canvas: FakeCanvas;
let bodyClasses: Map<string, boolean>;

beforeEach(() => {
  windowTarget = new FakeTarget();
  canvas = new FakeCanvas();
  bodyClasses = new Map<string, boolean>();

  const doc = new FakeTarget() as FakeTarget & Record<string, unknown>;
  doc.pointerLockElement = null;
  doc.fullscreenElement = null;
  doc.exitPointerLock = (): void => void (doc.pointerLockElement = null);
  doc.body = { classList: { toggle: (name: string, on: boolean): void => void bodyClasses.set(name, on) } };
  documentTarget = doc as unknown as typeof documentTarget;

  const globals = globalThis as Record<string, unknown>;
  globals.window = windowTarget;
  globals.document = documentTarget;
  globals.HTMLElement = FakeElement;
});

afterEach(() => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.window;
  delete globals.document;
  delete globals.HTMLElement;
});

function makeInput(options: { sensitivity?: number; invertY?: boolean } = {}): Input {
  return new Input({
    canvas: canvas as unknown as HTMLCanvasElement,
    sensitivity: options.sensitivity ?? 1,
    invertY: options.invertY ?? false,
  });
}

function keyDown(code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return windowTarget.dispatch('keydown', { code, key: '', repeat: false, ...extra });
}

function keyUp(code: string): void {
  windowTarget.dispatch('keyup', { code, key: '' });
}

/** The buttons a tick would be handed right now. */
function buttonsNow(input: Input): number {
  return input.sample(0, 0).buttons;
}

/** Pretend the browser granted (or dropped) the lock on the canvas. */
function setLocked(on: boolean): void {
  documentTarget.pointerLockElement = on ? canvas : null;
  documentTarget.dispatch('pointerlockchange');
}

// ========================================= the latching =======================================

describe('keys become bits', () => {
  it('latches a bound key and drops it on the way up', () => {
    const input = makeInput();
    keyDown('Space');
    expect(buttonsNow(input) & Btn.Jump).toBe(Btn.Jump);
    keyUp('Space');
    expect(buttonsNow(input) & Btn.Jump).toBe(0);
  });

  it('keeps a bit while any other binding for it is still held', () => {
    const input = makeInput();
    keyDown('ControlLeft');
    keyDown('KeyC');
    expect(buttonsNow(input) & Btn.Crouch).toBe(Btn.Crouch);
    keyUp('ControlLeft');
    expect(buttonsNow(input) & Btn.Crouch).toBe(Btn.Crouch);
    keyUp('KeyC');
    expect(buttonsNow(input) & Btn.Crouch).toBe(0);
  });

  it('ignores an auto-repeat, which describes one press rather than reporting another', () => {
    const input = makeInput();
    keyDown('Space', { repeat: true });
    expect(buttonsNow(input) & Btn.Jump).toBe(0);
  });

  it('suppresses the browser under anything bound, and under the four it always takes', () => {
    makeInput();
    expect(keyDown('KeyW').defaultPrevented).toBe(true);
    expect(keyDown('Tab').defaultPrevented).toBe(true);
    expect(keyDown('F1').defaultPrevented).toBe(true);
    expect(keyDown('ArrowUp').defaultPrevented).toBe(true);
    // Nothing is bound to it and the page may have its own use for it.
    expect(keyDown('KeyZ').defaultPrevented).toBe(false);
  });

  it('drops everything on blur', () => {
    const input = makeInput();
    keyDown('Space');
    windowTarget.dispatch('blur');
    expect(buttonsNow(input)).toBe(0);
  });
});

describe('the movement axes', () => {
  it('comes out of the same bitfield as everything else, and off the wire', () => {
    const input = makeInput();
    keyDown('KeyW');
    const cmd = input.sample(3, 100);
    expect(cmd.moveZ).toBe(1);
    expect(cmd.moveX).toBe(0);
    // The local movement bits ride above the wire mask and are stripped from the command.
    expect(cmd.buttons & LocalBtn.Forward).toBe(0);
  });

  it('normalises a diagonal once, here', () => {
    const input = makeInput();
    keyDown('KeyW');
    keyDown('KeyD');
    const cmd = input.sample(0, 0);
    expect(cmd.moveX).toBe(Math.SQRT1_2);
    expect(cmd.moveZ).toBe(Math.SQRT1_2);
  });

  it('cancels opposing keys rather than preferring one', () => {
    const input = makeInput();
    keyDown('KeyA');
    keyDown('KeyD');
    const cmd = input.sample(0, 0);
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveZ).toBe(0);
  });
});

// ======================================== the guards ==========================================

describe('while a DOM control has focus', () => {
  function focusAForm(): void {
    documentTarget.dispatch('focusin', { target: new FakeElement('INPUT') });
  }

  it('leaves the page alone and latches nothing', () => {
    const input = makeInput();
    keyDown('Space');
    focusAForm();
    // The guard clears what was held, so nothing is latched across the gap.
    expect(buttonsNow(input)).toBe(0);

    expect(keyDown('KeyW').defaultPrevented).toBe(false);
    expect(buttonsNow(input)).toBe(0);

    documentTarget.dispatch('focusout');
    keyDown('KeyW');
    expect(input.sample(0, 0).moveZ).toBe(1);
  });

  it('still takes the four keys it always takes', () => {
    makeInput();
    focusAForm();
    expect(keyDown('Tab').defaultPrevented).toBe(true);
    expect(keyDown('F1').defaultPrevented).toBe(true);
  });

  it('is not fooled by a focused button, only by a form control', () => {
    const input = makeInput();
    documentTarget.dispatch('focusin', { target: new FakeElement('BUTTON') });
    keyDown('KeyW');
    expect(input.sample(0, 0).moveZ).toBe(1);
  });

  it('reads a contenteditable as a form control', () => {
    const input = makeInput();
    documentTarget.dispatch('focusin', { target: new FakeElement('DIV', true) });
    keyDown('KeyW');
    expect(input.sample(0, 0).moveZ).toBe(0);
  });
});

describe('while a front-end screen is up', () => {
  it('takes no input at the DOM edge, and clears what was held on the way down', () => {
    const input = makeInput();
    keyDown('Space');
    input.setBindingsActive(false);
    expect(input.bindingsEnabled).toBe(false);
    expect(buttonsNow(input)).toBe(0);
    expect(keyDown('KeyW').defaultPrevented).toBe(false);
    expect(buttonsNow(input)).toBe(0);

    input.setBindingsActive(true);
    keyDown('Space');
    expect(buttonsNow(input) & Btn.Jump).toBe(Btn.Jump);
  });

  it('lets the wheel reach the page, so a panel scrolls both ways', () => {
    const input = makeInput();
    input.setBindingsActive(false);
    const event = windowTarget.dispatch('wheel', { deltaY: -1 });
    expect(event.defaultPrevented).toBe(false);
    expect(buttonsNow(input) & Btn.SwapWeapon).toBe(0);
  });
});

// ========================================= the digits =========================================

describe('the digit keys', () => {
  it('are offered to a consumer before their binding, and consumed if taken', () => {
    const input = makeInput();
    const seen: number[] = [];
    input.onDigit((digit) => {
      seen.push(digit);
      return digit === 3;
    });

    const taken = keyDown('Digit3');
    expect(seen).toEqual([3]);
    expect(taken.defaultPrevented).toBe(true);
    // Voting for mode 3 must not also call in a UAV.
    expect(buttonsNow(input) & Btn.Streak1).toBe(0);

    keyDown('Digit1');
    expect(seen).toEqual([3, 1]);
    expect(buttonsNow(input) & Btn.Slot1).toBe(Btn.Slot1);
  });

  it('reads the numpad, and a synthetic press that carries no physical key', () => {
    const input = makeInput();
    const seen: number[] = [];
    input.onDigit((digit) => {
      seen.push(digit);
      return true;
    });

    keyDown('Numpad4');
    keyDown('', { key: '7' });
    expect(seen).toEqual([4, 7]);
  });

  it('are left alone behind the focus guard', () => {
    makeInput();
    const seen: number[] = [];
    makeInputDigitListenerOn(seen);
    documentTarget.dispatch('focusin', { target: new FakeElement('INPUT') });
    keyDown('Digit3');
    expect(seen).toEqual([]);
  });

  function makeInputDigitListenerOn(seen: number[]): void {
    // The second Input instance listens on the same window; both see the key, which is what
    // the focus guard has to hold for.
    const extra = makeInput();
    extra.onDigit((digit) => {
      seen.push(digit);
      return true;
    });
  }
});

describe('Escape', () => {
  it('reaches the state machine without being prevented, even from a focused control', () => {
    const input = makeInput();
    let fired = 0;
    input.onEscape(() => {
      fired++;
    });

    expect(keyDown('Escape').defaultPrevented).toBe(false);
    expect(fired).toBe(1);

    documentTarget.dispatch('focusin', { target: new FakeElement('INPUT') });
    keyDown('Escape');
    expect(fired).toBe(2);

    keyDown('Escape', { repeat: true });
    expect(fired).toBe(2);
  });
});

// ========================================== the mouse =========================================

describe('the mouse', () => {
  it('latches a button and stamps the press for the latency probe', () => {
    const input = makeInput();
    windowTarget.dispatch('mousedown', { button: 0 });
    expect(buttonsNow(input) & Btn.Fire).toBe(Btn.Fire);

    const at = input.takeFirePress();
    expect(at).toBeGreaterThan(0);
    // Taken once: the next consumer is told there is nothing waiting.
    expect(input.takeFirePress()).toBe(-1);

    windowTarget.dispatch('mouseup', { button: 0 });
    expect(buttonsNow(input) & Btn.Fire).toBe(0);
  });

  it('spends an armed click on getting the cursor back rather than on the trigger', () => {
    const input = makeInput();
    input.armPointerLock(true);
    expect(canvas.lockRequests).toBe(1);

    windowTarget.dispatch('mousedown', { button: 0 });
    expect(canvas.lockRequests).toBe(2);
    expect(buttonsNow(input) & Btn.Fire).toBe(0);
    expect(input.takeFirePress()).toBe(-1);

    // Once locked, a click is a click again.
    setLocked(true);
    windowTarget.dispatch('mousedown', { button: 0 });
    expect(buttonsNow(input) & Btn.Fire).toBe(Btn.Fire);
  });

  it('gives a wheel notch a duration, so one notch is one press', () => {
    const input = makeInput();
    const event = windowTarget.dispatch('wheel', { deltaY: -1 });
    expect(event.defaultPrevented).toBe(true);

    const now = performance.now();
    expect(input.sample(0, now).buttons & Btn.SwapWeapon).toBe(Btn.SwapWeapon);
    // 34 ms later it has expired, and the sampler sees it exactly once.
    expect(input.sample(1, now + 40).buttons & Btn.SwapWeapon).toBe(0);
  });

  it('leaves an unbound wheel direction to the page', () => {
    const input = makeInput();
    const event = windowTarget.dispatch('wheel', { deltaY: 1 });
    expect(event.defaultPrevented).toBe(false);
    expect(buttonsNow(input) & Btn.SwapWeapon).toBe(0);

    const flat = windowTarget.dispatch('wheel', { deltaY: 0 });
    expect(flat.defaultPrevented).toBe(false);
  });

  it('refuses the context menu over the canvas', () => {
    makeInput();
    expect(canvas.dispatch('contextmenu').defaultPrevented).toBe(true);
  });
});

// ======================================== the view angles =====================================

describe('the view angles', () => {
  function move(dx: number, dy: number): void {
    windowTarget.dispatch('mousemove', { movementX: dx, movementY: dy });
  }

  it('ignores the mouse until the pointer is locked', () => {
    const input = makeInput();
    move(100, 0);
    expect(input.yaw).toBe(0);
  });

  it('swallows the first delta after a lock, so re-clicking never snaps the view', () => {
    const input = makeInput();
    setLocked(true);
    move(500, 500);
    expect(input.yaw).toBe(0);
    expect(input.pitch).toBe(0);

    move(100, 0);
    expect(input.yaw).toBe(wrapAngle(-100 * 0.0022));
  });

  it('turns by the raw delta times the sensitivity, with no smoothing', () => {
    const input = makeInput({ sensitivity: 2 });
    setLocked(true);
    move(0, 0); // the settle event
    move(50, -20);
    expect(input.yaw).toBe(wrapAngle(-50 * 0.0022 * 2));
    expect(input.pitch).toBe(20 * 0.0022 * 2);
  });

  it('inverts the vertical axis on request', () => {
    const input = makeInput({ invertY: true });
    setLocked(true);
    move(0, 0);
    move(0, 20);
    expect(input.pitch).toBe(20 * 0.0022);
  });

  it('clamps one enormous delta, which Chrome delivers after a re-lock', () => {
    const input = makeInput();
    setLocked(true);
    move(0, 0);
    move(100_000, 0);
    expect(input.yaw).toBe(wrapAngle(-400 * 0.0022));
  });

  it('stops the pitch just short of straight up and straight down', () => {
    const input = makeInput({ sensitivity: 50 });
    setLocked(true);
    move(0, 0);
    for (let i = 0; i < 40; i++) move(0, -400);
    expect(input.pitch).toBe(89 * DEG2RAD);
    for (let i = 0; i < 80; i++) move(0, 400);
    expect(input.pitch).toBe(-(89 * DEG2RAD));
  });

  it('blends the ADS multiplier in by how far the sights are up', () => {
    const input = makeInput();
    input.setAdsSensitivity(0.5);
    input.setAdsFraction(0.5);
    setLocked(true);
    move(0, 0);
    move(100, 0);
    // Half way into the sights is half way to the multiplier: 1 + (0.5 - 1) * 0.5.
    expect(input.yaw).toBe(wrapAngle(-100 * 0.0022 * 0.75));
  });

  it('clamps what the settings may ask for', () => {
    const input = makeInput();
    input.setAdsSensitivity(99);
    input.setAdsFraction(5);
    setLocked(true);
    move(0, 0);
    move(100, 0);
    expect(input.yaw).toBe(wrapAngle(-100 * 0.0022 * 2));
  });

  it('wraps the yaw and clamps the pitch wherever the angles are written', () => {
    const input = makeInput();
    input.setView(Math.PI * 3, 90 * DEG2RAD);
    expect(input.yaw).toBe(wrapAngle(Math.PI * 3));
    expect(input.pitch).toBe(89 * DEG2RAD);

    input.setView(0, 0);
    input.addViewOffset(-Math.PI * 2 - 0.5, -90 * DEG2RAD);
    expect(input.yaw).toBe(wrapAngle(-Math.PI * 2 - 0.5));
    expect(input.pitch).toBe(clamp(-90 * DEG2RAD, -(89 * DEG2RAD), 89 * DEG2RAD));
  });
});

// ======================================== the pointer lock ====================================

describe('pointer lock', () => {
  it('reports the state, marks the body and tells its listeners once per change', () => {
    const input = makeInput();
    const seen: boolean[] = [];
    input.onLockChange((locked) => seen.push(locked));

    setLocked(true);
    expect(input.isLocked).toBe(true);
    expect(bodyClasses.get('op-locked')).toBe(true);
    // The same event again is not a change.
    documentTarget.dispatch('pointerlockchange');
    expect(seen).toEqual([true]);

    setLocked(false);
    expect(input.isLocked).toBe(false);
    expect(bodyClasses.get('op-locked')).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('drops held keys when the lock goes away', () => {
    const input = makeInput();
    setLocked(true);
    keyDown('Space');
    setLocked(false);
    expect(buttonsNow(input)).toBe(0);
  });

  it('reports a refusal only while it wants the lock and has not got it', () => {
    const input = makeInput();
    expect(input.pointerLockRefused).toBe(false);

    documentTarget.dispatch('pointerlockerror');
    expect(input.pointerLockRefused).toBe(false); // nothing has asked for it yet

    input.armPointerLock(true);
    expect(input.pointerLockArmed).toBe(true);
    documentTarget.dispatch('pointerlockerror');
    expect(input.pointerLockRefused).toBe(true);

    // Success is what clears it, not the next attempt.
    setLocked(true);
    expect(input.pointerLockRefused).toBe(false);
  });

  it('forgets a refusal when the arming goes away', () => {
    const input = makeInput();
    input.armPointerLock(true);
    documentTarget.dispatch('pointerlockerror');
    expect(input.pointerLockRefused).toBe(true);

    input.armPointerLock(false);
    expect(input.pointerLockArmed).toBe(false);
    expect(input.pointerLockRefused).toBe(false);
  });

  it('asks the document to let go only when it is the one holding it', () => {
    const input = makeInput();
    documentTarget.pointerLockElement = null;
    input.exitPointerLock();
    expect(documentTarget.pointerLockElement).toBeNull();

    documentTarget.pointerLockElement = canvas;
    input.exitPointerLock();
    expect(documentTarget.pointerLockElement).toBeNull();
  });

  it('does not ask twice while it already has the lock', () => {
    const input = makeInput();
    setLocked(true);
    const before = canvas.lockRequests;
    input.requestPointerLock();
    expect(canvas.lockRequests).toBe(before);
  });
});

describe('keyboard lock', () => {
  it('is deferred until the page is fullscreen, where it is grantable at all', () => {
    const input = makeInput();
    expect(input.keyboardCaptureActive).toBe(false);
    // No `navigator.keyboard` in this environment, so the request can only be deferred —
    // what is pinned is that asking outside fullscreen never throws.
    expect(() => input.lockKeyboard()).not.toThrow();
    expect(() => input.unlockKeyboard()).not.toThrow();
    documentTarget.fullscreenElement = {};
    expect(() => documentTarget.dispatch('fullscreenchange')).not.toThrow();
    expect(input.keyboardCaptureActive).toBe(false);
  });
});

// ========================================= the sampling =======================================

describe('the three samples', () => {
  it('stamps a live command with the view, the axes and the state bits', () => {
    const input = makeInput();
    input.setView(0.5, 0.25);
    keyDown('Space');

    const cmd = input.sample(12, 345, Btn.Targeting);
    expect(cmd.tickIndex).toBe(12);
    expect(cmd.sampledAtMs).toBe(345);
    expect(cmd.yaw).toBe(input.yaw);
    expect(cmd.pitch).toBe(input.pitch);
    expect(cmd.buttons & Btn.Jump).toBe(Btn.Jump);
    expect(cmd.buttons & Btn.Targeting).toBe(Btn.Targeting);
  });

  it('gives the neutral command the angles and nothing else', () => {
    const input = makeInput();
    input.setView(0.5, 0.25);
    keyDown('Space');
    keyDown('KeyW');

    const cmd = input.sampleNeutral(4, 99);
    expect(cmd.tickIndex).toBe(4);
    expect(cmd.sampledAtMs).toBe(99);
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveZ).toBe(0);
    expect(cmd.buttons).toBe(0);
    expect(cmd.yaw).toBe(input.yaw);
    expect(cmd.pitch).toBe(input.pitch);
  });

  it('lets a dead player look at the scoreboard and nothing else', () => {
    const input = makeInput();
    keyDown('Tab');
    keyDown('Space');
    keyDown('KeyW');
    windowTarget.dispatch('mousedown', { button: 0 });

    const cmd = input.sampleSpectating(7, 70);
    expect(cmd.buttons).toBe(Btn.Scoreboard);
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveZ).toBe(0);
    expect(cmd.tickIndex).toBe(7);
    expect(cmd.sampledAtMs).toBe(70);
  });

  it('numbers every command from one sequence, whichever sampler produced it', () => {
    const input = makeInput();
    const first = input.sample(0, 0).seq;
    expect(input.sampleNeutral(1, 0).seq).toBe(first + 1);
    expect(input.sampleSpectating(2, 0).seq).toBe(first + 2);
    expect(input.sample(3, 0).seq).toBe(first + 3);
  });

  it('reuses its ring slots rather than allocating per tick', () => {
    const input = makeInput();
    const slots = new Set<unknown>();
    for (let i = 0; i < 300; i++) slots.add(input.sample(i, i));
    expect(slots.size).toBe(128);
  });
});

describe('clearHeld', () => {
  it('drops keys, mouse buttons, the wheel and the pending fire stamp', () => {
    const input = makeInput();
    keyDown('Space');
    windowTarget.dispatch('mousedown', { button: 0 });
    windowTarget.dispatch('wheel', { deltaY: -1 });

    input.clearHeld();
    expect(input.sample(0, performance.now()).buttons).toBe(0);
    expect(input.takeFirePress()).toBe(-1);
  });
});

// ======================================== the teardown ========================================

describe('Input.dispose', () => {
  it('gives back every listener it took', () => {
    const input = makeInput();
    const types = ['keydown', 'keyup', 'blur', 'mousemove', 'mousedown', 'mouseup', 'wheel'];
    for (const type of types) expect(windowTarget.count(type)).toBe(1);
    expect(canvas.count('contextmenu')).toBe(1);
    for (const type of ['pointerlockchange', 'pointerlockerror', 'fullscreenchange', 'focusin', 'focusout']) {
      expect(documentTarget.count(type)).toBe(1);
    }

    input.dispose();
    for (const type of types) expect(windowTarget.count(type)).toBe(0);
    expect(canvas.count('contextmenu')).toBe(0);
    for (const type of ['pointerlockchange', 'pointerlockerror', 'fullscreenchange', 'focusin', 'focusout']) {
      expect(documentTarget.count(type)).toBe(0);
    }
  });

  it('forgets the consumers it was given', () => {
    const input = makeInput();
    let fired = 0;
    input.onEscape(() => {
      fired++;
    });
    input.dispose();
    windowTarget.dispatch('keydown', { code: 'Escape', key: '', repeat: false });
    expect(fired).toBe(0);
  });
});
