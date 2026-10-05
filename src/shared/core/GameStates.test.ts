import { describe, expect, it } from 'vitest';
import { type GameStateId, isLegalGameTransition } from './GameStates';

/**
 * The transition table, pinned edge by edge.
 *
 * `Game.setState` throws `Illegal game transition` on anything this returns false for, so an
 * edge added or dropped by accident changes what the front end can do. The whole 7x7 grid is
 * asserted against the table below rather than a handful of spot checks, which is what makes a
 * route added by accident fail here instead of being caught by a grep.
 *
 * Two of these rows are the ones the history notes argue about: LOADOUT leaves only to MENU
 * (playtest round 4), and SUMMARY -> MATCH exists for the dedicated server's map rotation.
 */

const STATES: readonly GameStateId[] = ['BOOT', 'MENU', 'LOADOUT', 'SETTINGS', 'MATCH', 'PAUSED', 'SUMMARY'];

const EXPECTED: Readonly<Record<GameStateId, readonly GameStateId[]>> = {
  BOOT: ['MENU'],
  MENU: ['LOADOUT', 'SETTINGS', 'MATCH'],
  LOADOUT: ['MENU'],
  SETTINGS: ['MENU', 'MATCH', 'PAUSED'],
  MATCH: ['SUMMARY', 'MENU', 'PAUSED'],
  PAUSED: ['MATCH', 'MENU', 'SETTINGS'],
  SUMMARY: ['MENU', 'MATCH'],
};

describe('isLegalGameTransition', () => {
  it('answers every pair of states exactly as the table says', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        expect(isLegalGameTransition(from, to)).toBe(EXPECTED[from].includes(to));
      }
    }
  });

  it('allows the main walk: BOOT -> MENU -> MATCH -> SUMMARY -> MENU', () => {
    expect(isLegalGameTransition('BOOT', 'MENU')).toBe(true);
    expect(isLegalGameTransition('MENU', 'MATCH')).toBe(true);
    expect(isLegalGameTransition('MATCH', 'SUMMARY')).toBe(true);
    expect(isLegalGameTransition('SUMMARY', 'MENU')).toBe(true);
  });

  it('pauses and resumes without leaving the match', () => {
    expect(isLegalGameTransition('MATCH', 'PAUSED')).toBe(true);
    expect(isLegalGameTransition('PAUSED', 'MATCH')).toBe(true);
    expect(isLegalGameTransition('PAUSED', 'MENU')).toBe(true);
    expect(isLegalGameTransition('PAUSED', 'SETTINGS')).toBe(true);
    expect(isLegalGameTransition('SETTINGS', 'PAUSED')).toBe(true);
  });

  it('never leaves PAUSED straight to SUMMARY', () => {
    expect(isLegalGameTransition('PAUSED', 'SUMMARY')).toBe(false);
  });

  it('keeps LOADOUT a leaf off the menu', () => {
    expect(isLegalGameTransition('MENU', 'LOADOUT')).toBe(true);
    expect(isLegalGameTransition('LOADOUT', 'MENU')).toBe(true);
    expect(isLegalGameTransition('MATCH', 'LOADOUT')).toBe(false);
    expect(isLegalGameTransition('LOADOUT', 'MATCH')).toBe(false);
    expect(isLegalGameTransition('LOADOUT', 'SETTINGS')).toBe(false);
  });

  it('lets SETTINGS leave straight into a match, unlike LOADOUT', () => {
    expect(isLegalGameTransition('SETTINGS', 'MATCH')).toBe(true);
  });

  it('allows SUMMARY -> MATCH, which is the dedicated server rotating the map', () => {
    expect(isLegalGameTransition('SUMMARY', 'MATCH')).toBe(true);
  });

  it('refuses the shortcuts out of BOOT', () => {
    expect(isLegalGameTransition('BOOT', 'MATCH')).toBe(false);
    expect(isLegalGameTransition('BOOT', 'LOADOUT')).toBe(false);
    expect(isLegalGameTransition('BOOT', 'SETTINGS')).toBe(false);
  });

  it('refuses every state as a transition to itself', () => {
    for (const state of STATES) {
      expect(isLegalGameTransition(state, state)).toBe(false);
    }
  });
});
