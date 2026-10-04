import { describe, expect, it } from 'vitest';
import { foreignServerHost } from './JoinOptions';

/**
 * Which `?server=` links PLAY names on the menu (security audit 2026-10-04, S10).
 */
describe('foreignServerHost', () => {
  const PAGE = 'protocol-seven.onrender.com';

  it('names a link that points PLAY at another host, in every spelling the flag takes', () => {
    expect(foreignServerHost('?server=evil.example:8080', PAGE)).toBe('evil.example:8080');
    expect(foreignServerHost('?server=wss://evil.example/ws', PAGE)).toBe('evil.example');
    expect(foreignServerHost('?server=ws://10.0.0.5:8080', PAGE)).toBe('10.0.0.5:8080');
    expect(foreignServerHost('?server=https://evil.example', PAGE)).toBe('evil.example');
  });

  it('shows a lookalike internationalised host as its punycode', () => {
    // Cyrillic "о" in place of the Latin one.
    expect(foreignServerHost('?server=prоtocol-seven.onrender.com', PAGE)).toMatch(/^xn--/);
  });

  it('says nothing when there is no link, or it means this site', () => {
    expect(foreignServerHost('', PAGE)).toBeNull();
    expect(foreignServerHost('?name=ALICE', PAGE)).toBeNull();
    expect(foreignServerHost('?server=1', PAGE)).toBeNull();
    expect(foreignServerHost('?server=', PAGE)).toBeNull();
    expect(foreignServerHost('?server=/ws', PAGE)).toBeNull();
    expect(foreignServerHost(`?server=wss://${PAGE}/ws`, PAGE)).toBeNull();
  });

  it('still names an address that will not parse, cut short', () => {
    const odd = foreignServerHost(`?server=${encodeURIComponent('bad host with spaces')}`, PAGE);
    expect(odd).toBe('bad host with spaces');
  });
});
