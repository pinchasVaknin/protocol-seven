import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import {
  addressKey,
  isInternalAddress,
  normaliseIp,
  originAllowed,
  resolveClientIp,
} from './ClientAddress';
import { nowMs } from '../../shared/core/Clock';
import { logger } from '../../shared/core/Log';
import { NetSim, NET_PERFECT, type NetConditions } from '../../shared/net/NetSim';
import {
  MAX_CLIENT_FRAME_BYTES,
  MAX_CONNECTIONS,
  MAX_CONNECTIONS_PER_IP,
  MAX_MESSAGES_PER_SEC,
} from '../../shared/net/Protocol';
import type { INetLink, LinkState } from '../../shared/net/Transport';
import { RateLimiter } from './Validation';

const log = logger('net');

/**
 * The WebSocket listener and one link per connection (M10, S4.9 and S6.1).
 *
 * ## Hardening is not a later pass
 *
 * S6.1 says *"Hardening per S4.16 from the first line of transport code, not as a later
 * pass"*, and this file is where that is either true or false. The server is internet-facing
 * and a crash is now a denial-of-service vector rather than a friend's bug report, so every
 * limit is applied **before** the bytes reach a decoder:
 *
 * - `maxPayload` on the `ws` server itself, so an oversized frame is refused by the library
 *   and never allocated by us.
 * - Text frames rejected outright. The protocol is binary; a text frame is either a probe or
 *   a broken client, and either way there is nothing to do with it.
 * - A page this server did not serve refused at the upgrade (`ClientAddress.originAllowed`).
 * - Connections per address capped, so one host cannot occupy every seat — the *visitor's*
 *   address behind a platform proxy, and an IPv6 /64 as one address
 *   (`ClientAddress.resolveClientIp`, `addressKey`).
 * - Connections in total capped, so no number of addresses can make the process hold more.
 * - Messages per second capped per connection, so a flood costs the flooder a socket.
 * - Nothing from an exception path ever reaches a client. Close codes and short reasons only.
 *
 * ## TLS
 *
 * S4.9 requires `wss://` when the page is served over HTTPS, and S6.6 permits terminating at
 * a reverse proxy. Both are supported and neither is hardcoded: with `TLS_CERT` and `TLS_KEY`
 * set this listens as HTTPS directly; without them it listens as plain HTTP for a proxy or a
 * tunnel to terminate in front of. The deployment doc in `README.md` covers both.
 */

export interface WsServerOptions {
  readonly port: number;
  readonly host: string;
  /** PEM paths. Both or neither; without them the listener is plain HTTP. */
  readonly tlsCertPath?: string | undefined;
  readonly tlsKeyPath?: string | undefined;
  /** Applied to every new connection. The debug endpoint can change it per link later. */
  readonly conditions?: NetConditions | undefined;
  /**
   * Simultaneous connections from one address. Defaults to `MAX_CONNECTIONS_PER_IP`.
   *
   * Harnesses run every headless client from loopback, and against the shipped cap a
   * multi-client run spends its time proving that the cap works rather than that the flow does.
   * It stays a cap in every case — only *which* cap is configurable.
   */
  readonly maxConnectionsPerIp?: number | undefined;
  /**
   * Sockets open at once, from everybody together (security audit S6). Past it a connection is
   * refused with the same close a per-address refusal gets. Defaults to `MAX_CONNECTIONS`.
   *
   * The per-address cap alone bounds one host, not the process: every handshaking socket is a
   * link, a session and a slot in the per-tick drain, and enough addresses could open them
   * without limit.
   */
  readonly maxConnections?: number | undefined;
  /**
   * The request header the platform's proxy writes the visitor's address into (S2), or '' to
   * count by the socket's peer. See `ClientAddress.resolveClientIp` for when it is believed.
   */
  readonly clientIpHeader?: string | undefined;
  /** Origins besides this server's own and loopback that may open a socket (S7). Exact. */
  readonly allowedOrigins?: readonly string[] | undefined;
  /**
   * Directory of built client files to serve over the same port, or undefined for none.
   *
   * **This is what makes the game one deployable unit** (M11, deployment). Until now the
   * process answered a plain HTTP request with a flat 426 — correct for a machine that sits
   * behind a reverse proxy serving the client from somewhere else, which is the documented
   * bare-metal deployment. A managed host like Render gives you *one* service on *one* port,
   * and standing up a second one to serve four megabytes of static files is both a cost and a
   * second origin to keep in step.
   *
   * Serving them here collapses that: the page and the socket share a scheme, a host and a
   * port, so `resolveServerUrl` needs no configuration, the browser's mixed-content rule is
   * satisfied by construction, and there is no cross-origin request to allow in the first
   * place.
   *
   * Undefined keeps the old behaviour exactly, so the proxy deployment is unchanged.
   */
  readonly staticDir?: string | undefined;
  readonly onConnection: (link: WsLink) => void;
}

/**
 * One client connection as an `INetLink`.
 *
 * Received frames are queued and handed over in `poll()` rather than dispatched from the
 * socket's own event. That is the whole reason `INetLink` is pull-shaped: a `message` handler
 * firing mid-tick would be re-entrancy into the simulation from an I/O callback, and the
 * fixed timestep exists precisely so nothing can do that.
 */
export class WsLink implements INetLink {
  bytesIn = 0;
  bytesOut = 0;
  framesIn = 0;
  framesOut = 0;

  /** Monotonic ms of the last frame received. The timeout clock (S6.1). */
  lastRecvMs = 0;

  /** Set when the connection is dropped for abuse, so the reason survives into the log. */
  dropReason = '';

  readonly remoteAddress: string;

  /** Per-link condition simulator, so one client can be given latency and others not (S7). */
  readonly outbound: NetSim;

  private readonly socket: WsSocketLike;
  private readonly queue: Uint8Array[] = [];
  private state_: LinkState = 'open';
  private readonly limiter = new RateLimiter(MAX_MESSAGES_PER_SEC);

  constructor(socket: WsSocketLike, remoteAddress: string, conditions: NetConditions) {
    this.socket = socket;
    this.remoteAddress = remoteAddress;
    this.outbound = new NetSim(conditions);
    this.lastRecvMs = nowMs();

    socket.on('message', (data: unknown, isBinary: boolean) => {
      if (!isBinary) {
        this.drop('text frame');
        return;
      }
      const bytes = toBytes(data);
      if (bytes === null) {
        this.drop('undecodable frame');
        return;
      }
      if (bytes.length > MAX_CLIENT_FRAME_BYTES) {
        this.drop('oversize frame');
        return;
      }
      const now = nowMs();
      if (!this.limiter.allow(now)) {
        this.drop('message flood');
        return;
      }
      this.lastRecvMs = now;
      this.bytesIn += bytes.length;
      this.framesIn++;
      // Copied: `ws` reuses its receive buffers, and this frame is consumed on a later tick.
      this.queue.push(bytes.slice());
    });

    /**
     * The socket is gone; what it already delivered is not (playtest round 4, F8).
     *
     * This used to clear the queue, and that threw away the one frame it most mattered to
     * keep. `ws` emits `message` and then `close` in the same event-loop batch when a client
     * sends a `Bye` and closes immediately after — which is exactly what a clean disconnect
     * *is* — so unless the server's tick happened to land between the two, the `Bye` was
     * discarded and the departure was indistinguishable from a pulled cable. The whole point of
     * `MsgC.Bye` is that it says which one it was.
     *
     * It cost a ten-second timeout on a seat that could have been freed at once, which is
     * invisible; round 4 made it cost something visible, because `LeaveCause` decides whether
     * the seat is *held* for a reconnect, and a quit read as a loss holds a seat the player has
     * said they do not want. `Session.receive` drains a closed link once, which is what makes
     * keeping these frames worth anything.
     *
     * Outbound is still cleared: those frames have nowhere to go.
     */
    socket.on('close', () => {
      this.state_ = 'closed';
      this.outbound.clear();
    });

    // A socket error is ordinary on the internet — a client's wifi drops, a NAT entry
    // expires. It closes the link and is never allowed to reach the process as an unhandled
    // 'error' event, which in Node would terminate it.
    socket.on('error', (err: Error) => {
      log.warn(`socket error from ${this.remoteAddress}: ${err.message}`);
      this.state_ = 'closed';
    });
  }

  get state(): LinkState {
    return this.state_;
  }

  send(bytes: Uint8Array): void {
    if (this.state_ !== 'open') return;
    this.bytesOut += bytes.length;
    this.framesOut++;
    if (this.outbound.idle) {
      this.write(bytes);
      return;
    }
    // Held by the condition simulator and written when its delay expires. `pumpOutbound`
    // below is what releases them.
    this.outbound.send(bytes);
  }

  /** Release any frames the condition simulator is holding. Called once per tick. */
  pumpOutbound(): void {
    if (this.outbound.idle) return;
    this.outbound.pump((bytes) => this.write(bytes));
  }

  poll(handler: (bytes: Uint8Array) => void): void {
    if (this.queue.length === 0) return;
    for (const frame of this.queue) handler(frame);
    this.queue.length = 0;
  }

  close(reason: string): void {
    if (this.state_ === 'closed') return;
    this.state_ = 'closed';
    this.queue.length = 0;
    this.outbound.clear();
    try {
      // 1000 is a normal closure. The reason is short and carries nothing internal (S4.16).
      this.socket.close(1000, reason.slice(0, 100));
    } catch {
      // Already gone. Nothing to do and nothing worth logging.
    }
  }

  /** Close for cause and record why, for the connection log. */
  drop(reason: string): void {
    if (this.dropReason === '') this.dropReason = reason;
    log.warn(`dropping ${this.remoteAddress}: ${reason}`);
    this.close(reason);
  }

  private write(bytes: Uint8Array): void {
    try {
      this.socket.send(bytes);
    } catch (err) {
      // A send on a socket that closed between the state check and here. Ordinary.
      this.state_ = 'closed';
      log.warn(`send failed to ${this.remoteAddress}: ${errText(err)}`);
    }
  }
}

/**
 * The minimum of a `ws` socket this file uses.
 *
 * Structural rather than importing `ws`'s own `WebSocket` type: it keeps the surface this
 * code depends on to five members, and it documents that surface where a reader will look for
 * it. A real `ws` socket satisfies it without a cast.
 */
export interface WsSocketLike {
  on(event: 'message', cb: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export class WsServer {
  private readonly wss: WebSocketServer;
  private readonly http: HttpServer;
  /** Open sockets per `addressKey` — an address, or an IPv6 /64. */
  private readonly perIp = new Map<string, number>();
  /** Open sockets in total. */
  private open = 0;
  /** Upgrades refused for their `Origin` since boot (S7). */
  originRefusals = 0;
  private warnedNoClientIp = false;
  /** Absolute path of the built client, or null when this port serves only the socket. */
  private staticRoot: string | null = null;
  readonly secure: boolean;

  constructor(private readonly opts: WsServerOptions) {
    const cert = opts.tlsCertPath;
    const key = opts.tlsKeyPath;
    this.secure = cert !== undefined && key !== undefined && cert !== '' && key !== '';

    this.http = this.secure
      ? (createHttpsServer({
          cert: readFileSync(cert ?? ''),
          key: readFileSync(key ?? ''),
        }) as unknown as HttpServer)
      : createHttpServer();

    /**
     * The static root, resolved once and verified once.
     *
     * Resolved to an absolute path at construction so the traversal guard below can be a
     * cheap prefix test rather than a filesystem question per request, and checked for
     * existence here so a mistyped `STATIC_DIR` is one line in the boot log rather than a
     * 404 on every request with nothing to explain it.
     */
    const wanted = opts.staticDir;
    if (wanted !== undefined && wanted !== '') {
      const root = resolve(wanted);
      if (existsSync(join(root, 'index.html'))) {
        this.staticRoot = root;
        log.info(`serving the client from ${root}`);
      } else {
        log.warn(`STATIC_DIR "${root}" has no index.html — serving no client from this port.`);
      }
    }

    this.http.on('request', (req, res) => {
      // Liveness, for a managed host's health check. Answered before anything touches the
      // disk so it stays true even if the static root is missing.
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok\n');
        return;
      }
      const root = this.staticRoot;
      // No client to serve: a flat 426 and nothing else. It is not a web server and saying
      // so in four words is the whole correct response.
      if (root === null) {
        res.writeHead(426, { 'content-type': 'text/plain' });
        res.end('upgrade required\n');
        return;
      }
      this.serveStatic(root, req.method ?? 'GET', req.url ?? '/', req.headers['if-none-match'], res);
    });

    this.wss = new WebSocketServer({
      // The upgrade is ours to accept (below), so a page this server does not serve is refused
      // before a WebSocket exists for it.
      noServer: true,
      // The library refuses anything larger before allocating it. This is the first and
      // cheapest of the S4.16 limits and the only one that costs us nothing at all.
      maxPayload: MAX_CLIENT_FRAME_BYTES,
      // No compression: snapshots are already packed binary, and permessage-deflate on
      // small frames costs CPU per client to make them slightly bigger.
      perMessageDeflate: false,
      clientTracking: false,
    });

    const allowedOrigins = opts.allowedOrigins ?? [];
    this.http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      // A socket error during the handshake is the client's network, and must not reach the
      // process as an unhandled 'error'. `ws` takes the socket over once the upgrade completes.
      socket.on('error', () => socket.destroy());
      if (!originAllowed(req.headers.origin, req.headers.host, allowedOrigins)) {
        this.originRefusals++;
        // Once per process at warn: a site embedding the game is worth one line, not one per
        // visitor. The count is in the metrics.
        if (this.originRefusals === 1) {
          log.warn(`refused a socket from origin ${JSON.stringify(req.headers.origin)} — not this server's page (ALLOWED_ORIGINS).`);
        }
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });

    this.wss.on('connection', (socket, req) => {
      const ip = this.clientIp(req);
      const key = addressKey(ip);
      const open = this.perIp.get(key) ?? 0;
      const refusal =
        this.open >= (this.opts.maxConnections ?? MAX_CONNECTIONS)
          ? `${this.open} connections open in total`
          : open >= (this.opts.maxConnectionsPerIp ?? MAX_CONNECTIONS_PER_IP)
            ? `${open} connections already open from ${key}`
            : null;
      if (refusal !== null) {
        log.warn(`refusing ${ip}: ${refusal}`);
        try {
          socket.close(1013, 'too many connections');
        } catch {
          // Nothing to clean up.
        }
        return;
      }
      this.open++;
      this.perIp.set(key, open + 1);
      socket.on('close', () => {
        this.open--;
        const n = (this.perIp.get(key) ?? 1) - 1;
        if (n <= 0) this.perIp.delete(key);
        else this.perIp.set(key, n);
      });

      const link = new WsLink(socket, ip, this.opts.conditions ?? NET_PERFECT);
      this.opts.onConnection(link);
    });

    this.wss.on('error', (err: Error) => {
      log.error(`listener error: ${err.message}`);
    });
  }

  /**
   * The visitor's address for this upgrade (S2). See `ClientAddress.resolveClientIp`.
   *
   * A configured header that is missing from a proxied request means every player is being
   * counted as the proxy again — the failure this exists to fix, arriving silently — so it is
   * said once, at warn, naming the header and the peer.
   */
  private clientIp(req: IncomingMessage): string {
    const peer = req.socket.remoteAddress ?? 'unknown';
    const header = this.opts.clientIpHeader ?? '';
    const ip = resolveClientIp(peer, req.headers, header);
    if (header !== '' && !this.warnedNoClientIp && ip === normaliseIp(peer) && isInternalAddress(ip)) {
      this.warnedNoClientIp = true;
      log.warn(
        `CLIENT_IP_HEADER is "${header}", but a connection through the proxy at ${ip} did not carry ` +
          'a usable one — connections are being counted by the proxy address.',
      );
    }
    return ip;
  }

  /**
   * Serve one file out of the built client.
   *
   * Deliberately small: this exists to put the game on one origin, not to be a web server.
   * No compression (Vite's output is already minified and a managed host's edge will gzip it),
   * no directory listing. The caching is `staticCacheControl` plus an `ETag`, and that is all.
   *
   * **The traversal guard is the part that matters.** The path comes off the wire, so it is
   * decoded, normalised and then checked to still sit under the root — a prefix test on the
   * resolved absolute path, which `..` cannot survive. Anything that fails is a 403 rather
   * than a 404: the two are different facts and only one of them is worth looking at in a log.
   */
  private serveStatic(
    root: string,
    method: string,
    url: string,
    ifNoneMatch: string | undefined,
    res: ServerResponse,
  ): void {
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }

    // Query and hash are not part of the path. `decodeURIComponent` can throw on a malformed
    // escape, which is exactly the sort of input S4.16 says must not reach anything else.
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.split('?')[0]?.split('#')[0] ?? '/');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    // A bare path, or one with no extension, is the app itself: this is a single-page client
    // and every route it has is served by the same document.
    const wantsIndex = pathname === '/' || pathname.endsWith('/') || extname(pathname) === '';
    const relative = wantsIndex ? 'index.html' : normalize(pathname).replace(/^[/\\]+/, '');
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + sep)) {
      log.warn(`refused a request that escaped the static root: ${pathname}`);
      res.writeHead(403);
      res.end();
      return;
    }

    let size = 0;
    let modifiedMs = 0;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) throw new Error('not a file');
      size = stat.size;
      modifiedMs = stat.mtimeMs;
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }

    /**
     * `Access-Control-Allow-Origin: *` on a same-origin deployment is redundant, and it is
     * here anyway (deployment item 4).
     *
     * It costs one header and it removes a whole class of confusing failure for anyone who
     * later splits the client onto a CDN or a second hostname: the socket has no CORS to
     * satisfy — WebSocket is exempt from the same-origin policy and `ws` performs no origin
     * check — but the *assets* would, and discovering that at deploy time is the avoidable
     * afternoon S4.9 talks about.
     */
    const query = url.split('#')[0]?.split('?')[1] ?? '';
    const caching = {
      'access-control-allow-origin': '*',
      'cache-control': staticCacheControl(wantsIndex ? 'index.html' : pathname, query),
      etag: staticEtag(size, modifiedMs),
    };
    // Unchanged since the browser last fetched it: the headers and no body. This is what turns
    // `no-cache` from "download it again" into "ask, and get two hundred bytes back".
    if (etagMatches(ifNoneMatch, caching.etag)) {
      res.writeHead(304, caching);
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': contentTypeFor(file),
      'content-length': String(size),
      ...caching,
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => res.end());
    stream.pipe(res);
  }

  /** The port actually bound — the one the OS chose when `port` was 0. */
  get port(): number {
    const address = this.http.address();
    return typeof address === 'object' && address !== null ? address.port : this.opts.port;
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => {
        this.http.off('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        this.http.off('error', onError);
        resolve();
      };
      this.http.once('error', onError);
      this.http.once('listening', onListening);
      this.http.listen(this.opts.port, this.opts.host);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.http.close(() => resolve());
      });
    });
  }
}

/** Whatever `ws` handed us, as bytes, or null if it is not something we can read. */
function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    // `ws` delivers a fragmented message as an array of buffers.
    let total = 0;
    for (const part of data) {
      if (!(part instanceof Uint8Array)) return null;
      total += part.length;
    }
    if (total > MAX_CLIENT_FRAME_BYTES) return null;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of data) {
      if (!(part instanceof Uint8Array)) return null;
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
  return null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Content type by extension, for the handful the client actually ships.
 *
 * A table rather than a dependency: the built client is HTML, JS, CSS, a source map and
 * whatever `public/` holds. Anything unrecognised is served as a byte stream, which is the
 * honest answer and lets the browser decide — the one thing that must never happen is a
 * script served as `text/plain`, and every extension that could be a script is listed.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
};

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * How long a browser may keep a file this server sent, by its URL (part 5).
 *
 * Two kinds of URL name content that can never change, and both are kept for a year without
 * asking again:
 *
 * - **`/assets/`**, which Vite fingerprints — a changed file is a different name.
 * - **`/models/` with a `?v=`**, the weapon and character GLBs. Their catalogues put a release
 *   string on every URL (`WEAPON_ASSET_VERSION`, `CHARACTER_VERSION`) for exactly this, and a
 *   republished model ships with a new string, so the old URL still means the old bytes. These
 *   are the heaviest things the game downloads, megabytes each, and under `no-cache` without a
 *   validator every match a player started fetched every one of them again.
 *
 * Everything else is `no-cache` — kept, but asked about each time, and with the `ETag` below a
 * question costs a 304 rather than the file. The entry document must be in that set or a deploy
 * would never reach anybody's browser, and so must a model with no version on its URL: nothing
 * would change the name when its bytes did.
 */
export function staticCacheControl(pathname: string, query: string): string {
  const first = pathname.replace(/^[/\\]+/, '').split(/[/\\]/)[0];
  if (first === 'assets') return IMMUTABLE;
  if (first === 'models' && /(?:^|&)v=[^&]/.test(query)) return IMMUTABLE;
  return 'no-cache';
}

/** A weak validator from the file's size and modification time. Weak: no byte is hashed. */
function staticEtag(size: number, modifiedMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(modifiedMs).toString(16)}"`;
}

/** Whether `If-None-Match` names this validator — a list, or `*` (RFC 9110 §13.1.2). */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some((tag) => {
    const t = tag.trim();
    return t === '*' || t.replace(/^W\//, '') === bare;
  });
}
