import { BlockList, isIP, isIPv4 } from 'node:net';

/**
 * Who is on the other end of a connection, and whether their page may open one (security audit
 * 2026-10-04, part 3: findings S2 and S7).
 *
 * Pure functions of a request's peer address and headers, so every rule here is a unit test
 * rather than a deploy.
 *
 * ## The address (S2)
 *
 * The per-address connection cap counted `req.socket.remoteAddress`, and on a managed host that
 * is not the player. On Render every request arrives from Render's own proxy inside the
 * container (127.0.0.1 or a 10.x address), behind Cloudflare: `X-Forwarded-For` reads
 * `visitor, cloudflare-edge, render-hop`, and the visitor's address is also in
 * `CF-Connecting-IP`, which Cloudflare overwrites on every request and refuses to let a client
 * forge. So the cap of four was four connections *per proxy* — a fifth player behind the same
 * hop was refused, and four sockets from anybody locked out everybody who shared it.
 *
 * `CLIENT_IP_HEADER` names the header the platform puts the visitor in. It is believed **only
 * when the connection comes from a private or loopback address** — the platform's own proxy —
 * because a header is something any client can send, and a process exposed directly to the
 * internet with the variable set by mistake must not hand the cap to whoever writes the header.
 * Unset, the peer address is the answer, which is right for a process that faces the internet
 * itself and for a bare-metal proxy that does not forward one.
 *
 * `X-Forwarded-For` is deliberately not parsed. Its leftmost entries are the client's to write,
 * and which entry from the right is the visitor depends on how many proxies the platform runs —
 * a number that is Render's to change. A header the edge sets whole is the stable answer.
 */

/**
 * Where the platform's proxies live: loopback, the three RFC 1918 blocks, carrier-grade NAT
 * (some platforms' internal range), and IPv6 loopback, unique-local and link-local.
 */
const INTERNAL = new BlockList();
INTERNAL.addSubnet('127.0.0.0', 8, 'ipv4');
INTERNAL.addSubnet('10.0.0.0', 8, 'ipv4');
INTERNAL.addSubnet('172.16.0.0', 12, 'ipv4');
INTERNAL.addSubnet('192.168.0.0', 16, 'ipv4');
INTERNAL.addSubnet('100.64.0.0', 10, 'ipv4');
INTERNAL.addAddress('::1', 'ipv6');
INTERNAL.addSubnet('fc00::', 7, 'ipv6');
INTERNAL.addSubnet('fe80::', 10, 'ipv6');

/**
 * IPv4-mapped IPv6 (`::ffff:1.2.3.4`) collapsed to the v4 form, and an IPv6 zone dropped.
 *
 * Without the first the same host counts twice against the per-address cap depending on how it
 * connected, which makes the limit unreliable in exactly the case it exists for.
 */
export function normaliseIp(addr: string): string {
  const bare = addr.trim().replace(/%.*$/, '');
  const lower = bare.toLowerCase();
  if (lower.startsWith('::ffff:') && isIPv4(bare.slice(7))) return bare.slice(7);
  return lower;
}

/** Whether an address belongs to the machine or its private network rather than the internet. */
export function isInternalAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return false;
  return INTERNAL.check(ip, kind === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The visitor's address for one request.
 *
 * `header` is `CLIENT_IP_HEADER`, empty when unset. The answer is always a syntactically valid
 * address or, failing that, the peer exactly as the socket reported it.
 */
export function resolveClientIp(
  peer: string,
  headers: Readonly<Record<string, string | string[] | undefined>>,
  header: string,
): string {
  const peerIp = normaliseIp(peer);
  if (header === '' || !isInternalAddress(peerIp)) return peerIp;
  const raw = headers[header.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return peerIp;
  // One address. A list here is not what the edge writes, and the first entry of a list is the
  // client's own to choose.
  const candidate = normaliseIp(value);
  return isIP(candidate) === 0 ? peerIp : candidate;
}

/**
 * What the per-address cap counts: the address, or for IPv6 its /64.
 *
 * One IPv6 subscriber is handed a /64 — eighteen quintillion addresses — so a cap per IPv6
 * address is no cap at all: every connection can come from a new one. The /64 is the unit an
 * ISP assigns to a household, which is the same unit an IPv4 address is.
 */
export function addressKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const groups = expandIpv6(ip);
  return groups === null ? ip : `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(ip: string): string[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' || halves[0] === undefined ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' && halves[1] !== undefined ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const all = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  return all.map((g) => (g === '' ? '0' : g.replace(/^0+(?=.)/, '')));
}

/**
 * Whether a page at `origin` may open a socket here (S7).
 *
 * `ws` performs no origin check, and a WebSocket is exempt from the same-origin policy, so any
 * site could open sockets to this server from its visitors' browsers — each from the visitor's
 * own address, which walks straight past the per-address cap — to fill seats or swing a ballot.
 *
 * Allowed:
 *
 * - **No `Origin` at all.** A browser always sends one; its absence is a tool — the headless
 *   harnesses, a test client — and a tool can send any `Origin` it likes, so refusing the absent
 *   one would stop nothing and break the instruments.
 * - **The page this server served**: the `Origin`'s host is the request's own `Host`. Scheme is
 *   not compared, because TLS ends at the proxy and the socket sees `http` either way.
 * - **A page on the player's own machine** (localhost, 127.x, [::1]) — the Vite dev server on
 *   5173 talking to a server on 8080 is the documented developer workflow, and a page on
 *   somebody's own loopback can only ever be theirs.
 * - **Anything in `ALLOWED_ORIGINS`**, exact, for a client served from a second hostname.
 *
 * Everything else — another site, the opaque `null` of a sandboxed frame or a file — is refused
 * before the upgrade, so the page learns nothing but that it did not connect.
 */
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (host !== undefined && url.host === host.toLowerCase()) return true;
  if (isLoopbackHostname(url.hostname)) return true;
  return allowed.includes(url.origin);
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (bare === '::1') return true;
  return isIPv4(bare) && bare.startsWith('127.');
}
