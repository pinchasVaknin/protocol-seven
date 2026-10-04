import { logger } from '../../shared/core/Log';
import { NET_PERFECT, describeConditions, parseConditions, type NetConditions } from '../../shared/net/NetSim';
import { resolveDisplayName } from '../../shared/net/UrlFlags';
import { resolveServerUrl } from './BrowserLink';
import type { HandshakeOptions } from './Handshake';

const log = logger('join');

/**
 * Join-by-URL (M10, S6).
 *
 * S6 scopes this milestone to *"Join by URL"* with no lobby — S9 puts the lobby in M11 — so
 * the whole join flow is a query string.
 *
 * **The flags themselves are declared in `shared/net/UrlFlags`, not here.** There used to be a
 * table in this comment, one in `README.md` and a parser below, and B9 is what three copies of
 * an interface produce: `?name=` appeared in all three and worked in none of them.
 * `scripts/check-flags.mjs` holds the README and the declaration to each other, and holds this
 * file to reading no key that neither declares.
 *
 * The address is **never hardcoded** (S4.9). `?server` wins, then the build-time
 * `VITE_SERVER_URL`, then the page's own origin — which is what makes the documented
 * deployment, where a reverse proxy serves the client and the socket from one hostname,
 * need no configuration at all.
 *
 * Absent `?server`, the game boots into single-player exactly as it did at M9. That default
 * is deliberate and is HARD RULE 8 made operational: nothing about this milestone changes
 * what happens when you open the page.
 */

/** Injected at build time by Vite. Absent in a plain `npm run dev`. */
declare const __SERVER_URL__: string | undefined;

/**
 * Whether a server address is configured at all (M11, §6.1).
 *
 * §4.9 forbids hardcoding one, so "configured" means `?server=` on the URL or `VITE_SERVER_URL`
 * baked in at build time. When neither is present the Play Multiplayer button is disabled with
 * a reason rather than failing on click — §6.2's rule that a known-broken feature with a cause
 * attached beats an inert button.
 */
export function isServerConfigured(search: string): boolean {
  const params = new URLSearchParams(search);
  if (params.get('server') !== null) return true;
  return typeof __SERVER_URL__ === 'string' && __SERVER_URL__ !== '';
}

/**
 * The join options for the Play Multiplayer button (M11, §6.1; playtest round 5, B9).
 *
 * There used to be two of these. `parseJoinOptions` read `?name=` off the URL and this one, its
 * only caller, replaced the result with the profile callsign on the next line — so the URL flag
 * was parsed, discarded, and documented in `README.md` as a feature. That is B9's first half,
 * and a second entry point whose whole purpose was to overwrite the first is how it survived.
 *
 * One function now, with the display name resolved by `resolveDisplayName`: **URL, then profile,
 * then the generated default** — the same ladder the address below already uses. See
 * `shared/net/UrlFlags` for why that precedence and not the other one.
 */
export function multiplayerJoinOptions(search: string, profileName: string): HandshakeOptions | null {
  const params = new URLSearchParams(search);

  const serverParam = params.get('server');
  const buildDefault = typeof __SERVER_URL__ === 'string' ? __SERVER_URL__ : '';

  // No `?server` and no build-time address: single-player, as before.
  if (serverParam === null && buildDefault === '') return null;

  /**
   * `1`, an empty value and `/ws` all mean **this page's own origin**.
   *
   * The runtime half (`?server=1`) has meant that since M10. The build-time half did not: a
   * `VITE_SERVER_URL` of `1` went to `resolveServerUrl` as if it were a hostname, and the
   * client would have tried to open `wss://1/ws`. Nobody hit it because the documented
   * deployment baked a full `wss://host/ws` in — but it is the value a *managed* host wants,
   * where the page and the socket are the same service and the hostname is not known until
   * the first deploy has already happened.
   *
   * One predicate for both halves, so the two cannot mean different things by the same string.
   */
  const raw = serverParam === null ? buildDefault : serverParam;
  const url = resolveServerUrl(meansThisOrigin(raw) ? null : raw);

  const conditions = parseNetFlag(params.get('net'));

  const options: HandshakeOptions = {
    url,
    displayName: resolveDisplayName(params.get('name'), profileName),
    conditions,
    wantRewindDebug: params.get('rewinddebug') === '1',
  };

  log.info(
    `joining ${url} as ${options.displayName}` +
      (conditions === NET_PERFECT ? '' : ` with simulated conditions: ${describeConditions(conditions)}`),
  );
  return options;
}

/** See `parseJoinOptions`. The one place the "same origin" spellings are listed. */
/**
 * The host a `?server=` link sends PLAY to, when that is not this page's own (security audit
 * 2026-10-04, S10). Null when there is no flag, when it means this origin, or when it names this
 * same host.
 *
 * `?server=` is a documented flag and was kept (audit item 5), but on the deployed site it means a
 * link can point the game at somebody else's server, and nothing on screen said so: the player
 * pressed the same PLAY and was somewhere else. The menu prints this under the button instead.
 * Only the flag counts — a build-time `VITE_SERVER_URL` is the operator's own choice, not a
 * link's.
 *
 * `URL` gives the host back in ASCII, so an internationalised lookalike shows as its punycode
 * (`xn--…`) rather than as the name it imitates. Unparseable text is shown as typed, cut short:
 * it will not connect anywhere, and saying so beats hiding it.
 */
export function foreignServerHost(search: string, pageHost: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get('server');
  if (raw === null || meansThisOrigin(raw)) return null;
  const spelled = raw.trim();
  let host: string;
  try {
    host = new URL(spelled.includes('://') ? spelled.replace(/^ws/i, 'http') : `http://${spelled}`).host;
  } catch {
    return spelled.slice(0, 64);
  }
  return host === '' || host === pageHost.toLowerCase() ? null : host;
}

function meansThisOrigin(raw: string): boolean {
  const v = raw.trim();
  return v === '' || v === '1' || v === '/ws';
}

/**
 * `?net=` — the S7 condition simulator, settable by URL flag as S7 requires.
 *
 * An unrecognised value is refused loudly and falls back to a perfect link, rather than being
 * silently ignored. A test that quietly ran at zero latency is worse than one that refused to
 * start, because its numbers look plausible.
 */
function parseNetFlag(raw: string | null): NetConditions {
  if (raw === null || raw.trim() === '') return NET_PERFECT;
  const parsed = parseConditions(raw);
  if (parsed === null) {
    log.error(`unrecognised ?net=${raw} — running with no simulated conditions.`);
    return NET_PERFECT;
  }
  return parsed;
}

/*
 * `sanitiseName` lives in `shared/net/UrlFlags` now.
 *
 * It was here and, character for character, in `server/net/Session` as well — the same loop
 * over the same code points with the same cap, differing only in what each returned for an
 * empty name. Two spellings of one rule is two rules, and this one had already drifted in a way
 * that mattered: see `withRewindSuffix` for the order-of-operations bug the duplication hid.
 */
