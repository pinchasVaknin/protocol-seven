import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PauseMenu } from './PauseMenu';
import { FakeElement, type FakeEvent } from './testing/dom';

/**
 * Characterization tests for the pause screen (refactor unit C17, written before the refactor).
 *
 * Four buttons, a status line and a cheat field, and almost all of what is worth pinning is
 * about *focus*: this screen is the one place where the DOM holds the keyboard while a match
 * is paused behind it, so what `show` focuses and what `hide` blurs is the difference between
 * resuming into a game and resuming into a text field that eats W, A, S and D.
 *
 * The debug button is an entitlement rather than a setting — `setDebugAvailable` is called
 * every frame from one pass — so its hidden-ness is pinned as a pure function of that call.
 */

// ---------------------------------------------------------------------------- the DOM double

/**

 * The element class is shared: `testing/dom.ts` (BACKLOG #79).

 *

 * What stood here was 82 lines of it. This file keeps its own environment: the shared

 * `installFakeDom` installs globals this suite has never run with, and handing a suite a

 * `window` on the way past is how a green suite starts meaning something else.

 *

 * Its own `setAttribute` did not reflect `class`; the shared one does. The focus and blur

 * counters this suite asserts on are in the shared class now, at the same defaults.

 */


function fire(el: FakeElement, type: string): void {
    const event: FakeEvent = { preventDefault: () => undefined, stopPropagation: () => undefined };
    for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
}

beforeEach(() => {
    (globalThis as Record<string, unknown>)['document'] = {
        createElement: (tag: string) => new FakeElement(tag),
    };
    (globalThis as Record<string, unknown>)['HTMLElement'] = FakeElement;
});

afterEach(() => {
    delete (globalThis as Record<string, unknown>)['document'];
    delete (globalThis as Record<string, unknown>)['HTMLElement'];
});

// ---------------------------------------------------------------------------- the rig

interface Rig {
    readonly menu: PauseMenu;
    readonly host: FakeElement;
    readonly layer: FakeElement;
    readonly frame: FakeElement;
    readonly calls: string[];
    status: string;
}

function rig(): Rig {
    const host = new FakeElement('div');
    const calls: string[] = [];
    const state = { status: 'FOUNDRY · TEAM DEATHMATCH · 12 — 9' };
    const menu = new PauseMenu({
        host: host as unknown as HTMLElement,
        onResume: () => calls.push('resume'),
        onToggleDebug: () => calls.push('debug'),
        onQuit: () => calls.push('quit'),
        statusLine: () => state.status,
        onCheatCode: (code) => calls.push(`code:${code}`),
    });
    const layer = host.children[0];
    if (layer === undefined) throw new Error('the pause screen mounted nothing');
    const frame = layer.children[0]?.children[0];
    if (frame === undefined) throw new Error('the pause screen has no frame');
    return {
        menu,
        host,
        layer,
        frame,
        calls,
        get status() {
            return state.status;
        },
        set status(value: string) {
            state.status = value;
        },
    };
}

function buttons(r: Rig): FakeElement[] {
    const actions = r.frame.children[2];
    if (actions === undefined) throw new Error('the pause screen has no action stack');
    return actions.children;
}

function codeForm(r: Rig): { form: FakeElement; input: FakeElement; submit: FakeElement } {
    const form = r.frame.children[4];
    const input = form?.children[0];
    const submit = form?.children[1];
    if (form === undefined || input === undefined || submit === undefined) {
        throw new Error('the pause screen has no code form');
    }
    return { form, input, submit };
}

function result(r: Rig): FakeElement {
    const el = r.frame.children[5];
    if (el === undefined) throw new Error('the pause screen has no result line');
    return el;
}

// ---------------------------------------------------------------------------- the tests

describe('the screen it builds', () => {
    it('mounts one hidden layer on the host', () => {
        const { host, layer } = rig();
        expect(host.children).toHaveLength(1);
        expect(layer.className).toBe('op-screen op-screen--pause');
        expect(layer.hidden).toBe(true);
    });

    it('lays the frame out as a title, a status, the actions, a hint, the code form and its result', () => {
        const r = rig();
        expect(r.frame.children.map((c) => c.className)).toEqual([
            'op-screen__title',
            'op-screen__sub',
            'op-actions op-actions--stack',
            'op-screen__sub',
            'op-code',
            'op-screen__sub op-code__result',
        ]);
    });

    it('says PAUSED, with the status line left empty until it is shown', () => {
        const r = rig();
        expect(r.frame.children[0]?.textContent).toBe('PAUSED');
        expect(r.frame.children[1]?.textContent).toBe('');
    });

    it('offers the four things a paused player wants, in that order', () => {
        const r = rig();
        expect(buttons(r).map((b) => b.textContent)).toEqual([
            'Resume',
            'Settings',
            'Debug overlay',
            'Quit to menu',
        ]);
        expect(buttons(r).every((b) => b.type === 'button')).toBe(true);
    });

    it('leads with Resume and ends quietly with Quit', () => {
        const r = rig();
        const [resume, settings, debug, quit] = buttons(r);
        expect(resume?.className).toBe('op-btn op-btn--primary');
        expect(settings?.className).toBe('op-btn');
        expect(debug?.className).toBe('op-btn');
        expect(quit?.className).toBe('op-btn op-btn--quiet');
    });

    it('names the three routes out, and 1-5 as the only one that changes class', () => {
        const r = rig();
        expect(r.frame.children[3]?.textContent).toBe('Esc to resume · 1-5 to change class · Tab for the scoreboard');
    });

    it('reports itself invisible before it is shown', () => {
        expect(rig().menu.isVisible).toBe(false);
    });
});

describe('the debug entitlement', () => {
    it('hides the button until a session has unlocked it', () => {
        const r = rig();
        expect(buttons(r)[2]?.hidden).toBe(true);
    });

    it('shows and hides it as a pure function of the call', () => {
        const r = rig();
        const debug = buttons(r)[2];
        r.menu.setDebugAvailable(true);
        expect(debug?.hidden).toBe(false);
        r.menu.setDebugAvailable(true);
        expect(debug?.hidden).toBe(false);
        r.menu.setDebugAvailable(false);
        expect(debug?.hidden).toBe(true);
    });

    it('survives being called before and after a show', () => {
        const r = rig();
        r.menu.setDebugAvailable(true);
        r.menu.show();
        expect(buttons(r)[2]?.hidden).toBe(false);
        r.menu.hide();
        r.menu.setDebugAvailable(false);
        r.menu.show();
        expect(buttons(r)[2]?.hidden).toBe(true);
    });
});

describe('the four buttons', () => {
    it('resumes, quits and toggles the overlay through their callbacks', () => {
        const r = rig();
        fire(buttons(r)[0] as FakeElement, 'click');
        fire(buttons(r)[2] as FakeElement, 'click');
        fire(buttons(r)[3] as FakeElement, 'click');
        expect(r.calls).toEqual(['resume', 'debug', 'quit']);
    });

    it('does nothing on Settings until `Game` has bound the route', () => {
        const r = rig();
        expect(() => fire(buttons(r)[1] as FakeElement, 'click')).not.toThrow();
        expect(r.calls).toEqual([]);
    });

    it('takes the settings route once it is bound', () => {
        const r = rig();
        r.menu.setOnSettings(() => r.calls.push('settings'));
        fire(buttons(r)[1] as FakeElement, 'click');
        expect(r.calls).toEqual(['settings']);
    });

    it('calls the latest route a second bind installed', () => {
        const r = rig();
        r.menu.setOnSettings(() => r.calls.push('first'));
        r.menu.setOnSettings(() => r.calls.push('second'));
        fire(buttons(r)[1] as FakeElement, 'click');
        expect(r.calls).toEqual(['second']);
    });

    it('fires a button’s callback whether or not the screen is up', () => {
        const r = rig();
        r.menu.show();
        fire(buttons(r)[0] as FakeElement, 'click');
        r.menu.hide();
        fire(buttons(r)[0] as FakeElement, 'click');
        expect(r.calls).toEqual(['resume', 'resume']);
    });
});

describe('showing and hiding it', () => {
    it('reads the status line afresh on every show', () => {
        const r = rig();
        r.menu.show();
        expect(r.frame.children[1]?.textContent).toBe('FOUNDRY · TEAM DEATHMATCH · 12 — 9');
        r.status = 'DUNES · DOMINATION · 80 — 44';
        r.menu.show();
        expect(r.frame.children[1]?.textContent).toBe('DUNES · DOMINATION · 80 — 44');
    });

    it('unhides the layer and reports itself visible', () => {
        const r = rig();
        r.menu.show();
        expect(r.layer.hidden).toBe(false);
        expect(r.menu.isVisible).toBe(true);
    });

    it('puts the keyboard on Resume', () => {
        const r = rig();
        r.menu.show();
        expect(buttons(r)[0]?.focusCount).toBe(1);
    });

    it('clears last pause’s answer and last pause’s half-typed code', () => {
        const r = rig();
        const { input } = codeForm(r);
        r.menu.setCodeResult('Code accepted.');
        input.value = 'HALF-TYPED';
        r.menu.show();
        expect(result(r).textContent).toBe('');
        expect(input.value).toBe('');
    });

    it('hides the layer and reports itself invisible', () => {
        const r = rig();
        r.menu.show();
        r.menu.hide();
        expect(r.layer.hidden).toBe(true);
        expect(r.menu.isVisible).toBe(false);
    });

    it('blurs both the button and the field, so the match gets its keys back', () => {
        const r = rig();
        const { input } = codeForm(r);
        r.menu.show();
        r.menu.hide();
        expect(buttons(r)[0]?.blurCount).toBe(1);
        expect(input.blurCount).toBe(1);
    });

    it('blurs even when it was never shown', () => {
        const r = rig();
        r.menu.hide();
        expect(buttons(r)[0]?.blurCount).toBe(1);
        expect(r.layer.hidden).toBe(true);
    });
});

describe('the code field', () => {
    it('is a short text field with no autocomplete and no spellcheck', () => {
        const r = rig();
        const { form, input, submit } = codeForm(r);
        expect(form.tag).toBe('form');
        expect(input.type).toBe('text');
        expect(input.className).toBe('op-code__input');
        expect(input.placeholder).toBe('Code');
        expect(input.autocomplete).toBe('off');
        expect(input.spellcheck).toBe(false);
        expect(input.maxLength).toBe(24);
        expect(submit.type).toBe('submit');
        expect(submit.textContent).toBe('Enter');
    });

    it('hands a submitted code to the one door that parses it, and clears the field', () => {
        const r = rig();
        const { form, input } = codeForm(r);
        // Not a real code: this screen does not parse them, and `check-cheats` refuses a
        // literal from the table anywhere in src/.
        input.value = 'OPEN-SESAME';
        fire(form, 'submit');
        expect(r.calls).toEqual(['code:OPEN-SESAME']);
        expect(input.value).toBe('');
    });

    it('trims what was typed, brackets and all', () => {
        const r = rig();
        const { form, input } = codeForm(r);
        input.value = '  SPEC[]n  ';
        fire(form, 'submit');
        expect(r.calls).toEqual(['code:SPEC[]n']);
    });

    it('submits nothing for an empty field, and leaves it alone', () => {
        const r = rig();
        const { form, input } = codeForm(r);
        input.value = '   ';
        fire(form, 'submit');
        expect(r.calls).toEqual([]);
        expect(input.value).toBe('   ');
    });

    it('writes whatever answer came back, and overwrites it next time', () => {
        const r = rig();
        r.menu.setCodeResult('Code accepted.');
        expect(result(r).textContent).toBe('Code accepted.');
        r.menu.setCodeResult('Unknown code.');
        expect(result(r).textContent).toBe('Unknown code.');
    });
});

describe('disposing of it', () => {
    it('takes the layer off the host', () => {
        const r = rig();
        r.menu.show();
        r.menu.dispose();
        expect(r.host.children).toEqual([]);
    });
});
