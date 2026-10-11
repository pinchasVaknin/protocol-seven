import { describe, expect, it } from 'vitest';
import {
  OBJECTIVE_IGNORE_BELOW,
  isObjectiveProvider,
  makeObjectiveTarget,
  type ObjectiveProvider,
} from './ObjectiveIntent';

/**
 * The seam that lets a bot play the objective without `ai/` knowing what a mode is, pinned.
 *
 * `isObjectiveProvider` is a **structural** test on purpose: a composition root is handed modes
 * by the registry and has no business importing four concrete classes to ask them what they
 * are. That makes its failure modes structural too — a mode with one of the two methods, or
 * with a property of the right name that is not a function, must not pass. Both are below.
 *
 * It also has a history: it lived in `ClientMatch`, so `BotDirector.objectives` was null in
 * every networked match and no Search & Destroy round on a server was ever decided by a plant.
 */

describe('a fresh objective target', () => {
  it('is blank, with a radius a bot can actually arrive inside', () => {
    expect(makeObjectiveTarget()).toEqual({
      id: '',
      label: '',
      x: 0,
      y: 0,
      z: 0,
      radius: 2,
      action: 'capture',
      priority: 0,
    });
  });

  it('is writable, which is the point of handing one out', () => {
    const target = makeObjectiveTarget();
    target.id = 'flag-b';
    target.label = 'B';
    target.action = 'defuse';
    target.priority = 1;
    expect(target.id).toBe('flag-b');
    expect(target.action).toBe('defuse');
  });

  it('is a fresh record each time, so two bots cannot be handed the same one by accident', () => {
    expect(makeObjectiveTarget()).not.toBe(makeObjectiveTarget());
  });
});

describe('the priority a bot will break off a firefight for', () => {
  it('sits in the middle, so a mode has room either side of it', () => {
    expect(OBJECTIVE_IGNORE_BELOW).toBe(0.5);
    expect(OBJECTIVE_IGNORE_BELOW).toBeGreaterThan(0);
    expect(OBJECTIVE_IGNORE_BELOW).toBeLessThan(1);
  });
});

describe('whether a mode also plays the provider role', () => {
  it('accepts one that answers both questions', () => {
    const mode: ObjectiveProvider = {
      assign: () => null,
      onArrived: () => undefined,
    };
    expect(isObjectiveProvider(mode)).toBe(true);
  });

  it('refuses a mode that is only a mode', () => {
    expect(isObjectiveProvider({ id: 'TDM' })).toBe(false);
    expect(isObjectiveProvider({})).toBe(false);
  });

  it('refuses one that has half the contract', () => {
    expect(isObjectiveProvider({ assign: () => null })).toBe(false);
    expect(isObjectiveProvider({ onArrived: () => undefined })).toBe(false);
  });

  it('refuses a property of the right name that is not a function', () => {
    expect(isObjectiveProvider({ assign: true, onArrived: true })).toBe(false);
    expect(isObjectiveProvider({ assign: () => null, onArrived: 7 })).toBe(false);
  });

  it('accepts a class instance, which is what a real mode is', () => {
    class Domination {
      assign(): null {
        return null;
      }
      onArrived(): void {
        // The mode owns the rule; the bot only reports that it arrived.
      }
    }
    expect(isObjectiveProvider(new Domination())).toBe(true);
  });
});
