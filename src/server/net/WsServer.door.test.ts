import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { installClock } from '../../shared/core/Clock';
import { installLogSink } from '../../shared/core/Log';
import { nodeClock } from '../NodeClock';
import { WsServer, type WsLink, type WsServerOptions } from './WsServer';

/**
 * The door, with real sockets (security audit 2026-10-04, part 3).
 *
 * A real `WsServer` on a port the OS picks and real `ws` clients on loopback — which is exactly
 * the Render shape: every connection arrives from 127.0.0.1, and only a header says who it is.
 */

installClock(nodeClock);
installLogSink({ log: () => undefined });

let server: WsServer | null = null;
const links: WsLink[] = [];

async function start(opts: Partial<WsServerOptions>): Promise<number> {
  server = new WsServer({
    port: 0,
    host: '127.0.0.1',
    onConnection: (link) => links.push(link),
    ...opts,
  });
  await server.listen();
  return server.port;
}

afterEach(async () => {
  for (const link of links) link.close('test over');
  links.length = 0;
  await server?.close();
  server = null;
});

type Outcome = { kind: 'open'; socket: WebSocket } | { kind: 'refused'; status: number } | { kind: 'closed'; code: number };

/** Connect, and report whether the socket stayed open, was refused, or was closed at once. */
function connect(port: number, options: WebSocket.ClientOptions = {}): Promise<Outcome> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, options);
    let settled = false;
    const settle = (o: Outcome): void => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    socket.on('unexpected-response', (_req, res) => {
      settle({ kind: 'refused', status: res.statusCode ?? 0 });
      socket.terminate();
    });
    socket.on('error', () => settle({ kind: 'refused', status: 0 }));
    socket.on('close', (code) => settle({ kind: 'closed', code }));
    // A refusal by cap is an accept and an immediate close, so "open" is only believed once
    // the close has had a moment to arrive.
    socket.on('open', () => setTimeout(() => settle({ kind: 'open', socket }), 100));
  });
}

describe('the Origin check', () => {
  it('refuses a page from another site before the upgrade', async () => {
    const port = await start({});
    expect(await connect(port, { origin: 'https://evil.example' })).toEqual({ kind: 'refused', status: 403 });
    expect(server?.originRefusals).toBe(1);
    expect(links).toHaveLength(0);
  });

  it('lets in this server\'s own page, a listed origin and a tool with no Origin', async () => {
    const port = await start({ allowedOrigins: ['https://play.example.com'] });
    expect((await connect(port, { origin: `http://127.0.0.1:${port}` })).kind).toBe('open');
    expect((await connect(port, { origin: 'https://play.example.com' })).kind).toBe('open');
    expect((await connect(port)).kind).toBe('open');
  });
});

describe('the per-address cap behind a proxy', () => {
  it('counts visitors by the header, so two players on one proxy are two addresses', async () => {
    const port = await start({ clientIpHeader: 'x-real-ip', maxConnectionsPerIp: 2 });
    const alice = { headers: { 'x-real-ip': '203.0.113.9' } };
    const bob = { headers: { 'x-real-ip': '203.0.113.10' } };

    expect((await connect(port, alice)).kind).toBe('open');
    expect((await connect(port, alice)).kind).toBe('open');
    expect(await connect(port, alice)).toEqual({ kind: 'closed', code: 1013 });
    // Same peer (loopback), different visitor: not refused. Before the fix this was the proxy's
    // third connection and was.
    expect((await connect(port, bob)).kind).toBe('open');
    expect(links.map((l) => l.remoteAddress)).toEqual(['203.0.113.9', '203.0.113.9', '203.0.113.10']);
  });

  it('counts by the peer when no header is configured', async () => {
    const port = await start({ maxConnectionsPerIp: 1 });
    expect((await connect(port, { headers: { 'x-real-ip': '203.0.113.9' } })).kind).toBe('open');
    expect(await connect(port, { headers: { 'x-real-ip': '203.0.113.10' } })).toEqual({ kind: 'closed', code: 1013 });
  });

  it('frees an address\'s slot when its socket closes', async () => {
    const port = await start({ clientIpHeader: 'x-real-ip', maxConnectionsPerIp: 1 });
    const first = await connect(port, { headers: { 'x-real-ip': '203.0.113.9' } });
    if (first.kind !== 'open') throw new Error(`first connection ${first.kind}`);
    await new Promise<void>((resolve) => {
      first.socket.on('close', () => resolve());
      first.socket.close();
    });
    // The server hears the close a moment after the client does. A refused attempt holds no slot,
    // so asking again until it opens is safe — and a slot that never frees fails the test.
    let again: Outcome = { kind: 'closed', code: 0 };
    for (let i = 0; i < 20 && again.kind !== 'open'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      again = await connect(port, { headers: { 'x-real-ip': '203.0.113.9' } });
    }
    expect(again.kind).toBe('open');
  });
});

describe('the total cap', () => {
  it('refuses past MAX_CONNECTIONS whatever the addresses', async () => {
    const port = await start({ clientIpHeader: 'x-real-ip', maxConnections: 2 });
    expect((await connect(port, { headers: { 'x-real-ip': '198.51.100.1' } })).kind).toBe('open');
    expect((await connect(port, { headers: { 'x-real-ip': '198.51.100.2' } })).kind).toBe('open');
    expect(await connect(port, { headers: { 'x-real-ip': '198.51.100.3' } })).toEqual({ kind: 'closed', code: 1013 });
  });
});
