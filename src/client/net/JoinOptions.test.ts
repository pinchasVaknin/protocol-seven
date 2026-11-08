import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NET_PERFECT } from '../../shared/net/NetSim';
import { foreignServerHost, isServerConfigured, multiplayerJoinOptions } from './JoinOptions';

/**
 * A page for `resolveServerUrl` to read its scheme and host off. Installed for every test so
 * the address ladder has somewhere to land; the cases that care set their own.
 */
function withPage(protocol: string, host: string, run: () => void): void {
  (globalThis as unknown as { window: unknown }).window = { location: { protocol, host } };
  run();
}

/** `__SERVER_URL__` is a Vite `define`, which compiles to exactly this global. */
function withBuildDefault(value: string, run: () => void): void {
  const slot = globalThis as unknown as { __SERVER_URL__?: string };
  const had = '__SERVER_URL__' in slot;
  const before = slot.__SERVER_URL__;
  slot.__SERVER_URL__ = value;
  try {
    run();
  } finally {
    if (had) slot.__SERVER_URL__ = before;
    else delete slot.__SERVER_URL__;
  }
}

beforeEach(() => {
  withPage('http:', 'example.test:5173', () => undefined);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

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

/**
 * The rest of the join flow, pinned before C13 moved a line.
 *
 * `__SERVER_URL__` is a Vite `define`, so it does not exist under vitest at all — which is
 * itself one of the cases below: the client has to boot into single-player when nothing has
 * been baked in. The tests that want a baked address put one on `globalThis`, because that is
 * exactly what the `define` compiles to.
 */
describe('isServerConfigured', () => {
  it('is true for any ?server=, including the spellings that mean this origin', () => {
    expect(isServerConfigured('?server=host:8080')).toBe(true);
    expect(isServerConfigured('?server=1')).toBe(true);
    expect(isServerConfigured('?server=')).toBe(true);
    expect(isServerConfigured('?server=/ws')).toBe(true);
  });

  it('is false with no flag and nothing baked in', () => {
    expect(isServerConfigured('')).toBe(false);
    expect(isServerConfigured('?name=ALICE&net=bad')).toBe(false);
  });

  it('is true for a build-time address, and false for an empty one', () => {
    withBuildDefault('wss://baked.example/ws', () => {
      expect(isServerConfigured('')).toBe(true);
    });
    withBuildDefault('', () => {
      expect(isServerConfigured('')).toBe(false);
    });
  });
});

describe('multiplayerJoinOptions', () => {
  it('says nothing at all when no address is configured, so the game boots single-player', () => {
    expect(multiplayerJoinOptions('', 'ALICE')).toBeNull();
    expect(multiplayerJoinOptions('?name=BOB', 'ALICE')).toBeNull();
    withBuildDefault('', () => {
      expect(multiplayerJoinOptions('', 'ALICE')).toBeNull();
    });
  });

  it('resolves a ?server= host against the page’s scheme', () => {
    withPage('http:', 'example.test:5173', () => {
      expect(multiplayerJoinOptions('?server=127.0.0.1:8080', 'ALICE')?.url).toBe(
        'ws://127.0.0.1:8080',
      );
    });
    withPage('https:', 'example.test', () => {
      expect(multiplayerJoinOptions('?server=127.0.0.1:8080', 'ALICE')?.url).toBe(
        'wss://127.0.0.1:8080',
      );
    });
  });

  it('reads 1, the empty value and /ws as this page’s own origin, from either half', () => {
    withPage('http:', 'example.test:5173', () => {
      for (const spelling of ['1', '', '/ws', '  1  ']) {
        expect(multiplayerJoinOptions(`?server=${encodeURIComponent(spelling)}`, 'ALICE')?.url).toBe(
          'ws://example.test:5173/ws',
        );
      }
      // The build-time half means the same thing by the same strings — which it did not
      // before B9, when a baked `1` went out as the hostname `1`.
      for (const spelling of ['1', '/ws']) {
        withBuildDefault(spelling, () => {
          expect(multiplayerJoinOptions('', 'ALICE')?.url).toBe('ws://example.test:5173/ws');
        });
      }
    });
  });

  it('lets ?server= win over the baked address', () => {
    withPage('http:', 'example.test', () => {
      withBuildDefault('wss://baked.example/ws', () => {
        expect(multiplayerJoinOptions('?server=other:9000', 'ALICE')?.url).toBe('ws://other:9000');
        expect(multiplayerJoinOptions('', 'ALICE')?.url).toBe('wss://baked.example/ws');
      });
    });
  });

  it('takes the name from the URL, then the profile, then the generated default', () => {
    withPage('http:', 'example.test', () => {
      expect(multiplayerJoinOptions('?server=h&name=ZULU', 'ALICE')?.displayName).toBe('ZULU');
      expect(multiplayerJoinOptions('?server=h', 'ALICE')?.displayName).toBe('ALICE');
      expect(multiplayerJoinOptions('?server=h', '')?.displayName).toBe('OPERATOR');
      expect(multiplayerJoinOptions('?server=h&name=', 'ALICE')?.displayName).toBe('ALICE');
    });
  });

  it('runs on a perfect link unless ?net= names conditions it recognises', () => {
    withPage('http:', 'example.test', () => {
      expect(multiplayerJoinOptions('?server=h', 'A')?.conditions).toBe(NET_PERFECT);
      expect(multiplayerJoinOptions('?server=h&net=', 'A')?.conditions).toBe(NET_PERFECT);
      expect(multiplayerJoinOptions('?server=h&net=100,30,2', 'A')?.conditions).toEqual({
        latencyMs: 100,
        jitterMs: 30,
        lossPct: 2,
      });
    });
  });

  it('refuses an unrecognised ?net= loudly and falls back to a perfect link', () => {
    withPage('http:', 'example.test', () => {
      // A test that quietly ran at zero latency is worse than one that refused to start.
      expect(multiplayerJoinOptions('?server=h&net=sideways', 'A')?.conditions).toBe(NET_PERFECT);
      expect(multiplayerJoinOptions('?server=h&net=-5', 'A')?.conditions).toBe(NET_PERFECT);
    });
  });

  it('opts into the rewind feed only for exactly 1', () => {
    withPage('http:', 'example.test', () => {
      expect(multiplayerJoinOptions('?server=h&rewinddebug=1', 'A')?.wantRewindDebug).toBe(true);
      expect(multiplayerJoinOptions('?server=h&rewinddebug=true', 'A')?.wantRewindDebug).toBe(false);
      expect(multiplayerJoinOptions('?server=h&rewinddebug=0', 'A')?.wantRewindDebug).toBe(false);
      expect(multiplayerJoinOptions('?server=h', 'A')?.wantRewindDebug).toBe(false);
    });
  });
});

describe('foreignServerHost: the rest of the ladder', () => {
  it('says nothing about a baked address, which is the operator’s own choice', () => {
    withBuildDefault('wss://baked.example/ws', () => {
      expect(foreignServerHost('', 'this.example')).toBeNull();
    });
  });

  it('compares against the page host case-insensitively', () => {
    expect(foreignServerHost('?server=host.example', 'HOST.EXAMPLE')).toBeNull();
  });

  it('says nothing when the address parses to no host at all', () => {
    // Parses, and names nobody: there is no host to warn about.
    expect(foreignServerHost('?server=file:///x', 'page.example')).toBeNull();
  });

  it('shows an address that will not parse as typed, rather than hiding it', () => {
    // `://` with nothing round it: `new URL` throws and the text is shown instead.
    expect(foreignServerHost('?server=http://', 'page.example')).toBe('http://');
  });
});
