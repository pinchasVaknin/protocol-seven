
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    SKIP_FAST_FORWARD,
    SKIP_HOLD_SECONDS,
    SKIP_TAPS_TO_LEAVE,
    SKIP_TAP_WINDOW_SECONDS,
} from '../../shared/ui/SkipGesture';
import { SpaceSkip } from './SpaceSkip';
import { installFakeDom, type FakeDom, type FakeEvent } from './testing/dom';

/**
 * Characterization tests for the Space key adapter (refactor unit C19, written before the
 * refactor).
 *
 * `SkipGesture` holds the rule and has its own tests; this file is the half that touches the
 * browser -- three window listeners, the key test that takes `key` as well as `code`, the
 * repeat that is not a press, and the `enabled` gate that the debrief's second of grace is.
 *
 * The clock is `performance.now`, which is the rig's: a hold is `env.nowMs += 200`, not a wait.
 */

// ---------------------------------------------------------------------------- the DOM double

/**
 * The element class and the environment are shared: `ui/testing/dom.ts` (BACKLOG #79).
 *
 * What stood here was 296 lines of hand-grown double. It is the same double -- the file it
 * moved to was written from this one -- so nothing this suite sees has changed.
 */

let env: FakeDom;

beforeEach(() => {
    env = installFakeDom();
});

afterEach(() => {
    env.restore();
});

// ---------------------------------------------------------------------------- the rig

interface Rig {
    readonly skip: SpaceSkip;
    readonly leaves: number[];
    enabled: boolean;
}

function rig(onLeave: boolean = true): Rig {
    const leaves: number[] = [];
    const state = { enabled: true };
    const skip = new SpaceSkip({
        enabled: () => state.enabled,
        onLeave: onLeave
            ? (): void => {
                  leaves.push(env.nowMs);
              }
            : null,
    });
    return {
        skip,
        leaves,
        get enabled(): boolean {
            return state.enabled;
        },
        set enabled(value: boolean) {
            state.enabled = value;
        },
    };
}

/** Advance the clock by seconds. */
function wait(seconds: number): void {
    env.nowMs += seconds * 1000;
}

function down(over: Partial<FakeEvent> = { code: 'Space' }): void {
    env.fireWindow('keydown', over);
}

function up(over: Partial<FakeEvent> = { code: 'Space' }): void {
    env.fireWindow('keyup', over);
}

/** One tap: down, a moment, up. Shorter than the hold threshold. */
function tap(): void {
    down();
    wait(0.05);
    up();
}

// ---------------------------------------------------------------------------- listening

describe('listening', () => {
    it('listens on nothing until asked', () => {
        rig();
        expect(env.windowListeners.size).toBe(0);
    });

    it('takes keydown, keyup and blur', () => {
        const r = rig();
        r.skip.listen();
        expect(env.windowListeners.get('keydown')).toHaveLength(1);
        expect(env.windowListeners.get('keyup')).toHaveLength(1);
        expect(env.windowListeners.get('blur')).toHaveLength(1);
    });

    it('listens once however often it is asked', () => {
        const r = rig();
        r.skip.listen();
        r.skip.listen();
        expect(env.windowListeners.get('keydown')).toHaveLength(1);
    });

    it('gives all three back', () => {
        const r = rig();
        r.skip.listen();
        r.skip.unlisten();
        expect(env.windowListeners.get('keydown')).toHaveLength(0);
        expect(env.windowListeners.get('keyup')).toHaveLength(0);
        expect(env.windowListeners.get('blur')).toHaveLength(0);
    });

    it('is safe to unlisten twice, and before listening', () => {
        const r = rig();
        r.skip.unlisten();
        r.skip.listen();
        r.skip.unlisten();
        r.skip.unlisten();
        expect(env.windowListeners.get('keydown')).toHaveLength(0);
    });

    it('forgets whatever was held when it stops listening', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.holding).toBe(true);
        r.skip.unlisten();
        expect(r.skip.holding).toBe(false);
    });

    it('forgets whatever was held when it starts listening', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        r.skip.unlisten();
        r.skip.listen();
        expect(r.skip.holding).toBe(false);
    });
});

// ---------------------------------------------------------------------------- the key

describe('which key it takes', () => {
    it('takes Space by code', () => {
        const r = rig();
        r.skip.listen();
        down({ code: 'Space' });
        wait(0.3);
        expect(r.skip.holding).toBe(true);
    });

    it('takes a synthetic press that carries key and not code', () => {
        const r = rig();
        r.skip.listen();
        down({ key: ' ' });
        wait(0.3);
        expect(r.skip.holding).toBe(true);
    });

    it('takes the old Spacebar spelling', () => {
        const r = rig();
        r.skip.listen();
        down({ key: 'Spacebar' });
        wait(0.3);
        expect(r.skip.holding).toBe(true);
    });

    it('takes no other key', () => {
        const r = rig();
        r.skip.listen();
        for (const over of [{ code: 'KeyW' }, { key: 'w' }, { code: 'Enter', key: 'Enter' }]) {
            down(over);
            wait(0.3);
            expect(r.skip.holding).toBe(false);
            up(over);
        }
    });

    it('claims the key whether or not the screen wants it', () => {
        const r = rig();
        r.skip.listen();
        r.enabled = false;
        let prevented = 0;
        let stopped = 0;
        env.fireWindow('keydown', {
            code: 'Space',
            preventDefault: () => {
                prevented++;
            },
            stopPropagation: () => {
                stopped++;
            },
        });
        expect(prevented).toBe(1);
        expect(stopped).toBe(1);
    });

    it('claims nothing for a key that is not Space', () => {
        const r = rig();
        r.skip.listen();
        let prevented = 0;
        env.fireWindow('keydown', {
            code: 'KeyW',
            preventDefault: () => {
                prevented++;
            },
        });
        expect(prevented).toBe(0);
    });
});

// ---------------------------------------------------------------------------- the hold

describe('holding', () => {
    it('is not a hold before the threshold', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(SKIP_HOLD_SECONDS - 0.01);
        expect(r.skip.holding).toBe(false);
    });

    it('is a hold at the threshold', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(SKIP_HOLD_SECONDS);
        expect(r.skip.holding).toBe(true);
    });

    it('is not a hold once the key is up', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        up();
        expect(r.skip.holding).toBe(false);
    });

    it('boosts a frame by the fast-forward, less the one times it already had', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.boost(0.016)).toBeCloseTo(0.016 * (SKIP_FAST_FORWARD - 1), 10);
    });

    it('boosts nothing before the threshold', () => {
        const r = rig();
        r.skip.listen();
        down();
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('boosts nothing when nobody is touching it', () => {
        const r = rig();
        r.skip.listen();
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('boosts nothing from a negative frame', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.boost(-1)).toBe(0);
    });

    it('treats a repeat as the same press, not another', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        down({ code: 'Space', repeat: true });
        expect(r.skip.holding).toBe(true);
        expect(r.skip.boost(0.016)).toBeGreaterThan(0);
    });

    it('does not leave on a hold, however long', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(5);
        up();
        expect(r.leaves).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- the taps

describe('the taps', () => {
    it('leaves on the third quick tap and no sooner', () => {
        const r = rig();
        r.skip.listen();
        tap();
        expect(r.leaves).toEqual([]);
        tap();
        expect(r.leaves).toEqual([]);
        tap();
        expect(r.leaves).toHaveLength(1);
    });

    it('needs the taps that the shared rule names', () => {
        const r = rig();
        r.skip.listen();
        for (let i = 0; i < SKIP_TAPS_TO_LEAVE - 1; i++) tap();
        expect(r.leaves).toEqual([]);
        tap();
        expect(r.leaves).toHaveLength(1);
    });

    it('starts a new run when a tap comes too late', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        wait(SKIP_TAP_WINDOW_SECONDS + 0.1);
        tap();
        expect(r.leaves).toEqual([]);
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
    });

    it('a hold between taps ends the run', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        down();
        wait(0.3);
        up();
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('starts a fresh run after leaving', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
        tap();
        expect(r.leaves).toHaveLength(2);
    });

    it('is nothing at all on a screen with nowhere to go', () => {
        const r = rig(false);
        r.skip.listen();
        tap();
        tap();
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('does not count a keyup with no press behind it', () => {
        const r = rig();
        r.skip.listen();
        up();
        up();
        up();
        expect(r.leaves).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- the gate

describe('the enabled gate', () => {
    it('records no press while the screen is not taking the key', () => {
        const r = rig();
        r.skip.listen();
        r.enabled = false;
        down();
        wait(0.3);
        expect(r.skip.holding).toBe(false);
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('reports no hold while the screen is not taking the key, even with one recorded', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        r.enabled = false;
        expect(r.skip.holding).toBe(false);
        expect(r.skip.boost(0.016)).toBe(0);
    });

    /** The debrief's second of grace: a hand still on jump must not be taps into leaving. */
    it('clears the run on a release the screen was not taking', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        r.enabled = false;
        down();
        wait(0.05);
        up();
        r.enabled = true;
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('takes the key normally once the screen wants it', () => {
        const r = rig();
        r.skip.listen();
        r.enabled = false;
        down();
        up();
        r.enabled = true;
        tap();
        tap();
        tap();
        expect(r.leaves).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------- focus

describe('losing focus', () => {
    it('forgets a key that was down, so the screen does not scrub on its own', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        expect(r.skip.holding).toBe(true);
        env.fireWindow('blur');
        expect(r.skip.holding).toBe(false);
        expect(r.skip.boost(0.016)).toBe(0);
    });

    it('ends the run of taps as well', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        env.fireWindow('blur');
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('does not leave when the keyup went somewhere else', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        down();
        env.fireWindow('blur');
        up();
        expect(r.leaves).toEqual([]);
    });
});

// ---------------------------------------------------------------------------- reset

describe('reset', () => {
    it('is the same as losing focus', () => {
        const r = rig();
        r.skip.listen();
        down();
        wait(0.3);
        r.skip.reset();
        expect(r.skip.holding).toBe(false);
    });

    it('ends the run of taps', () => {
        const r = rig();
        r.skip.listen();
        tap();
        tap();
        r.skip.reset();
        tap();
        expect(r.leaves).toEqual([]);
    });

    it('leaves the listeners alone', () => {
        const r = rig();
        r.skip.listen();
        r.skip.reset();
        expect(env.windowListeners.get('keydown')).toHaveLength(1);
    });
});
