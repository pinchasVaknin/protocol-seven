import { describe, expect, it } from 'vitest';
import { Btn } from './InputCommand';
import {
  ACTIONS,
  defaultBindings,
  inputLabel,
  Keybinds,
  LocalBtn,
  mouseInput,
  normaliseBindings,
} from './Keybinds';

/**
 * Characterisation of the binding table: a `BindingMap` round-trips through `Keybinds`, a
 * physical input resolves to the bit its action carries and nothing else, rebinding steals,
 * and a save missing an action gets that action's defaults back.
 */

describe('BindingMap round-trip', () => {
  it('the defaults come back out of snapshot() unchanged, as a copy', () => {
    const kb = new Keybinds();
    const snap = kb.snapshot();
    expect(snap).toEqual(defaultBindings());
    snap.jump?.push('KeyJ');
    expect(kb.inputsFor('jump')).toEqual(['Space']);
  });

  it('a custom map survives set() -> snapshot() -> set()', () => {
    const custom = defaultBindings();
    custom.sprint = ['KeyE'];
    custom.use = ['KeyF'];
    custom.tactical = ['KeyH'];
    const a = new Keybinds(custom);
    const b = new Keybinds(a.snapshot());
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.inputsFor('sprint')).toEqual(['KeyE']);
    expect(b.bitsFor('KeyE')).toBe(Btn.Sprint);
  });
});

describe('bitsFor', () => {
  it('resolves every default input to its action\'s bit', () => {
    const kb = new Keybinds();
    for (const action of ACTIONS) {
      for (const input of action.defaults) expect(kb.bitsFor(input) & action.bit).toBe(action.bit);
    }
  });

  it('movement resolves to local bits above the wire, and an unbound input to 0', () => {
    const kb = new Keybinds();
    expect(kb.bitsFor('KeyW')).toBe(LocalBtn.Forward);
    expect(kb.bitsFor('KeyD')).toBe(LocalBtn.Right);
    expect(LocalBtn.Forward).toBeGreaterThan(0xffffff);
    expect(kb.bitsFor('KeyZ')).toBe(0);
  });

  it('ADS is the right mouse button, as the DOM numbers it', () => {
    const kb = new Keybinds();
    expect(kb.bitsFor('Mouse2')).toBe(Btn.Ads);
    expect(kb.bitsFor('Mouse1')).toBe(0);
    expect(inputLabel('Mouse2')).toBe('Right mouse');
    expect(inputLabel('Mouse1')).toBe('Middle mouse');
  });
});

describe('rebind', () => {
  it('steals the input from its previous owner and reports who that was', () => {
    const kb = new Keybinds();
    const { stolenFrom } = kb.rebind('sprint', 0, 'KeyE');
    expect(stolenFrom).toBe('use');
    expect(kb.inputsFor('sprint')).toEqual(['KeyE']);
    expect(kb.inputsFor('use')).toEqual(['KeyT']);
    expect(kb.bitsFor('KeyE')).toBe(Btn.Sprint);
  });

  it('collapses a duplicate on the same action', () => {
    const kb = new Keybinds();
    kb.rebind('crouch', 0, 'KeyC');
    expect(kb.inputsFor('crouch')).toEqual(['KeyC']);
  });

  it('clear() leaves an action legally unbound', () => {
    const kb = new Keybinds();
    kb.clear('jump', 0);
    expect(kb.inputsFor('jump')).toEqual([]);
    expect(kb.bitsFor('Space')).toBe(0);
    kb.resetToDefaults();
    expect(kb.inputsFor('jump')).toEqual(['Space']);
  });
});

describe('normaliseBindings', () => {
  it('a missing action gets its defaults; an empty list is kept as deliberately cleared', () => {
    const out = normaliseBindings({ jump: [], fire: ['Mouse0', 7, '', 'Mouse0'] });
    expect(out.jump).toEqual([]);
    expect(out.fire).toEqual(['Mouse0']);
    expect(out.streak1).toEqual(['Digit3']);
  });

  it('non-object input yields the defaults', () => {
    expect(normaliseBindings(null)).toEqual(defaultBindings());
    expect(normaliseBindings('KeyW')).toEqual(defaultBindings());
  });
});

/**
 * `inputLabel`, pinned over the whole input namespace before it was split into a lookup table
 * plus two helpers (refactor A1).
 *
 * The degenerate rows at the end are deliberate. `'Mouse'`, `'MouseX'`, `'Key'` and `'Digit'`
 * are not inputs any device produces, but `inputLabel` takes whatever is in the save file, and
 * what it currently answers for them is behaviour the split has to reproduce — `Number('')` is
 * 0, so a bare `'Mouse'` reads as the left button, and `Number('X')` is `NaN`, which survives
 * the `+ 1`. Pinned as it is, not as it should be.
 */
describe('inputLabel', () => {
  it('names the wheel', () => {
    expect(inputLabel('WheelUp')).toBe('Wheel up');
    expect(inputLabel('WheelDown')).toBe('Wheel down');
  });

  it('names the three mouse buttons the way the DOM numbers them', () => {
    expect(inputLabel('Mouse0')).toBe('Left mouse');
    expect(inputLabel('Mouse1')).toBe('Middle mouse');
    expect(inputLabel('Mouse2')).toBe('Right mouse');
  });

  it('counts the extra mouse buttons from one, not from zero', () => {
    expect(inputLabel('Mouse3')).toBe('Mouse 4');
    expect(inputLabel('Mouse4')).toBe('Mouse 5');
    expect(inputLabel('Mouse12')).toBe('Mouse 13');
  });

  it('strips the Key and Digit prefixes', () => {
    expect(inputLabel('KeyW')).toBe('W');
    expect(inputLabel('KeyC')).toBe('C');
    expect(inputLabel('Digit3')).toBe('3');
  });

  it('rewrites the numpad and the arrows', () => {
    expect(inputLabel('Numpad7')).toBe('Num 7');
    expect(inputLabel('NumpadEnter')).toBe('Num Enter');
    expect(inputLabel('ArrowLeft')).toBe('Left arrow');
    expect(inputLabel('ArrowUp')).toBe('Up arrow');
  });

  it('abbreviates the six left/right modifiers', () => {
    expect(inputLabel('ControlLeft')).toBe('L Ctrl');
    expect(inputLabel('ControlRight')).toBe('R Ctrl');
    expect(inputLabel('ShiftLeft')).toBe('L Shift');
    expect(inputLabel('ShiftRight')).toBe('R Shift');
    expect(inputLabel('AltLeft')).toBe('L Alt');
    expect(inputLabel('AltRight')).toBe('R Alt');
  });

  it('returns anything it does not recognise unchanged', () => {
    expect(inputLabel('Tab')).toBe('Tab');
    expect(inputLabel('Space')).toBe('Space');
    expect(inputLabel('Escape')).toBe('Escape');
    expect(inputLabel('')).toBe('');
  });

  it('pins what the degenerate inputs currently answer', () => {
    expect(inputLabel('Mouse')).toBe('Left mouse');
    expect(inputLabel('MouseX')).toBe('Mouse NaN');
    expect(inputLabel('Key')).toBe('');
    expect(inputLabel('Digit')).toBe('');
    expect(inputLabel('Numpad')).toBe('Num ');
    expect(inputLabel('Arrow')).toBe(' arrow');
  });

  it('labels every default binding in the table', () => {
    for (const action of ACTIONS) {
      for (const input of action.defaults) {
        expect(inputLabel(input).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('mouseInput', () => {
  it('spells a MouseEvent.button number the way the binding table is keyed', () => {
    expect(mouseInput(0)).toBe('Mouse0');
    expect(mouseInput(1)).toBe('Mouse1');
    expect(mouseInput(2)).toBe('Mouse2');
    expect(mouseInput(4)).toBe('Mouse4');
  });

  it('round-trips through inputLabel for the three real buttons', () => {
    expect(inputLabel(mouseInput(0))).toBe('Left mouse');
    expect(inputLabel(mouseInput(1))).toBe('Middle mouse');
    expect(inputLabel(mouseInput(2))).toBe('Right mouse');
  });
});

describe('inputsFor', () => {
  it('reports what an action is bound to, including the doubled defaults', () => {
    const kb = new Keybinds();

    expect(kb.inputsFor('jump')).toEqual(['Space']);
    expect(kb.inputsFor('crouch')).toEqual(['ControlLeft', 'KeyC']);
    expect(kb.inputsFor('use')).toEqual(['KeyT', 'KeyE']);
    expect(kb.inputsFor('ads')).toEqual(['Mouse2']);
  });

  it('is empty for an action whose bindings were cleared', () => {
    const kb = new Keybinds();
    kb.clear('jump', 0);

    expect(kb.inputsFor('jump')).toEqual([]);
  });
});

describe('boundKeyCodes', () => {
  it('lists every bound keyboard code, in binding-table order, and no pointer input', () => {
    const kb = new Keybinds();

    expect(kb.boundKeyCodes()).toEqual([
      'KeyW',
      'KeyS',
      'KeyA',
      'KeyD',
      'Space',
      'ControlLeft',
      'KeyC',
      'ShiftLeft',
      'KeyR',
      'KeyQ',
      'Digit1',
      'Digit2',
      'KeyG',
      'KeyF',
      'KeyX',
      'Digit3',
      'Digit4',
      'Digit5',
      'KeyV',
      'KeyT',
      'KeyE',
      'Tab',
    ]);
  });

  it('excludes the mouse buttons and the wheel, which have no key to preventDefault', () => {
    const codes = new Keybinds().boundKeyCodes();

    expect(codes).not.toContain('Mouse0');
    expect(codes).not.toContain('Mouse2');
    expect(codes).not.toContain('WheelUp');
  });

  it('follows a rebind', () => {
    const kb = new Keybinds();
    kb.rebind('jump', 0, 'KeyZ');

    const codes = kb.boundKeyCodes();
    expect(codes).toContain('KeyZ');
    expect(codes).not.toContain('Space');
  });
});

describe('resetToDefaults', () => {
  it('puts every action back, after rebinding and clearing', () => {
    const kb = new Keybinds();
    kb.rebind('jump', 0, 'KeyZ');
    kb.clear('crouch', 0);

    kb.resetToDefaults();

    expect(kb.snapshot()).toEqual(defaultBindings());
    expect(kb.bitsFor('Space')).toBe(Btn.Jump);
    expect(kb.bitsFor('KeyZ')).toBe(0);
  });
});
