import { describe, expect, it } from 'vitest';
import { consoleApiWanted } from './ConsoleGate';

/**
 * Who gets `window.__p7` (security audit 2026-10-04, S5): the dev server always, a deployed build
 * only when asked.
 */
describe('consoleApiWanted', () => {
  it('is on under the dev server whatever the URL says', () => {
    expect(consoleApiWanted('', true)).toBe(true);
    expect(consoleApiWanted('?debug=0', true)).toBe(true);
  });

  it('is off on a deployed build by default, and with any other flag', () => {
    expect(consoleApiWanted('', false)).toBe(false);
    expect(consoleApiWanted('?server=1&name=ALICE', false)).toBe(false);
    expect(consoleApiWanted('?debug=0', false)).toBe(false);
    expect(consoleApiWanted('?debug=true', false)).toBe(false);
  });

  it('is on on a deployed build with ?debug=1, or for the bot harness that reports through it', () => {
    expect(consoleApiWanted('?debug=1', false)).toBe(true);
    expect(consoleApiWanted('?server=1&debug=1', false)).toBe(true);
    expect(consoleApiWanted('?harness', false)).toBe(true);
    expect(consoleApiWanted('?harness=1&bots=6', false)).toBe(true);
  });
});
