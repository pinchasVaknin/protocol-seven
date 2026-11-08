import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { BrowserLink, resolveServerUrl } from './BrowserLink';

/**
 * The browser half of the transport, driven through a fake `WebSocket` (C13).
 *
 * The socket is the only thing stubbed. The `NetSim` layered over it is the real one with the
 * real seeds, the queue and the counters are the real ones, and every assertion is on what the
 * public `INetLink` surface reports — which is all `NetClient` above it can see.
 */

// ---------------------------------------------------------------------------
// The environment: a clock this file owns, a window, and a socket it can drive.
// ---------------------------------------------------------------------------

let fakeNow = 0;
installClock({ nowMs: () => fakeNow });

type Listener = (ev: unknown) => void;

/** The handful of `WebSocket` a `BrowserLink` touches, with the events raised by hand. */
class FakeSocket {
  static last: FakeSocket | null = null;
  /** When set, the constructor throws it — the "the URL is not openable" path. */
  static throwOnConstruct: Error | null = null;

  binaryType = '';
  readonly sent: ArrayBuffer[] = [];
  closedWith: { code: number; reason: string } | null = null;
  throwOnSend: Error | null = null;

  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    if (FakeSocket.throwOnConstruct !== null) throw FakeSocket.throwOnConstruct;
    FakeSocket.last = this;
  }

  addEventListener(type: string, fn: Listener, opts?: { once?: boolean }): void {
    const list = this.listeners.get(type) ?? [];
    list.push(opts?.once === true ? once(fn, () => this.removeEventListener(type, fn)) : fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  }

  send(buf: ArrayBuffer): void {
    if (this.throwOnSend !== null) throw this.throwOnSend;
    this.sent.push(buf);
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
  }

  /** Raise `type` on every listener registered for it. */
  raise(type: string, ev: unknown = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }

  /** Raise a `message` carrying `bytes`, the way a browser hands one over. */
  deliver(bytes: readonly number[]): void {
    this.raise('message', { data: new Uint8Array(bytes).buffer });
  }
}

function once(fn: Listener, drop: () => void): Listener {
  let done = false;
  return (ev) => {
    if (done) return;
    done = true;
    drop();
    fn(ev);
  };
}

interface StubLocation {
  protocol: string;
  host: string;
}

function installWindow(protocol: string, host: string): StubLocation {
  const location: StubLocation = { protocol, host };
  (globalThis as unknown as { window: unknown }).window = { location };
  return location;
}

beforeEach(() => {
  fakeNow = 1000;
  FakeSocket.last = null;
  FakeSocket.throwOnConstruct = null;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  installWindow('http:', 'example.test:5173');
});

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  delete (globalThis as unknown as { window?: unknown }).window;
});

/** An opened link and the socket behind it. */
async function opened(): Promise<{ link: BrowserLink; socket: FakeSocket }> {
  const link = new BrowserLink('ws://host:8080');
  const promise = link.open();
  const socket = FakeSocket.last;
  if (socket === null) throw new Error('no socket');
  socket.raise('open');
  await promise;
  return { link, socket };
}

// ---------------------------------------------------------------------------

describe('BrowserLink: opening', () => {
  it('asks for binary frames and reports itself open once the socket is', async () => {
    const link = new BrowserLink('ws://host:8080');
    expect(link.state).toBe('idle');
    expect(link.remoteAddress).toBe('ws://host:8080');

    const promise = link.open();
    expect(link.state).toBe('connecting');
    const socket = FakeSocket.last;
    expect(socket?.url).toBe('ws://host:8080');
    expect(socket?.binaryType).toBe('arraybuffer');

    fakeNow = 2500;
    socket?.raise('open');
    await promise;

    expect(link.state).toBe('open');
    expect(link.lastRecvMs).toBe(2500);
    expect(link.reason).toBe('');
  });

  it('rejects with the one thing a browser will say, when the handshake fails', async () => {
    const link = new BrowserLink('ws://host:8080');
    const promise = link.open();
    FakeSocket.last?.raise('error');

    await expect(promise).rejects.toThrow('could not reach the server');
    expect(link.state).toBe('closed');
    expect(link.reason).toBe('could not reach the server');
  });

  it('rejects with the thrown text when the URL itself is refused', async () => {
    FakeSocket.throwOnConstruct = new Error('SyntaxError: bad url');
    const link = new BrowserLink('nonsense');
    await expect(link.open()).rejects.toThrow('SyntaxError: bad url');
    expect(link.state).toBe('closed');
    expect(link.reason).toBe('SyntaxError: bad url');
  });

  it('stops being open, without a reject, when the socket errors after connecting', async () => {
    const { link, socket } = await opened();
    socket.raise('error');
    expect(link.state).toBe('closed');
  });

  it('takes the close reason off the event, and falls back when there is none', async () => {
    const a = await opened();
    a.socket.raise('close', { reason: 'server restarting' });
    expect(a.link.state).toBe('closed');
    expect(a.link.reason).toBe('server restarting');

    const b = await opened();
    b.socket.raise('close', { reason: '' });
    expect(b.link.reason).toBe('connection closed');
  });

  it('keeps the reason it already had when the close event arrives afterwards', async () => {
    const { link, socket } = await opened();
    link.close('left');
    socket.raise('close', { reason: 'whatever' });
    expect(link.reason).toBe('left');
  });
});

describe('BrowserLink: frames in', () => {
  it('counts inbound bytes and frames, and stamps the arrival', async () => {
    const { link, socket } = await opened();
    fakeNow = 4000;
    socket.deliver([1, 2, 3]);
    fakeNow = 4100;
    socket.deliver([9]);

    expect(link.bytesIn).toBe(4);
    expect(link.framesIn).toBe(2);
    expect(link.lastRecvMs).toBe(4100);
  });

  it('ignores a message that is not binary', async () => {
    const { link, socket } = await opened();
    socket.raise('message', { data: 'hello' });
    expect(link.framesIn).toBe(0);
    let delivered = 0;
    link.poll(() => delivered++);
    expect(delivered).toBe(0);
  });

  it('hands the whole batch to the handler in arrival order, then clears it', async () => {
    const { link, socket } = await opened();
    socket.deliver([1]);
    socket.deliver([2]);
    socket.deliver([3]);

    const seen: number[] = [];
    link.poll((bytes) => seen.push(bytes[0] ?? -1));
    expect(seen).toEqual([1, 2, 3]);

    seen.length = 0;
    link.poll((bytes) => seen.push(bytes[0] ?? -1));
    expect(seen).toEqual([]);
  });

  it('polls to nothing when the queue is empty', async () => {
    const { link } = await opened();
    let called = 0;
    link.poll(() => called++);
    expect(called).toBe(0);
  });
});

describe('BrowserLink: frames out', () => {
  it('writes straight through on a perfect link, and counts what it wrote', async () => {
    const { link, socket } = await opened();
    link.send(new Uint8Array([7, 8]));

    expect(link.bytesOut).toBe(2);
    expect(link.framesOut).toBe(1);
    expect(socket.sent.length).toBe(1);
    expect([...new Uint8Array(socket.sent[0] ?? new ArrayBuffer(0))]).toEqual([7, 8]);
  });

  it('sends the live bytes only, not the whole encode buffer behind them', async () => {
    const { link, socket } = await opened();
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    link.send(backing.subarray(2, 5));
    expect([...new Uint8Array(socket.sent[0] ?? new ArrayBuffer(0))]).toEqual([3, 4, 5]);
  });

  it('drops a send while the link is not open, and counts nothing', async () => {
    const link = new BrowserLink('ws://host:8080');
    link.send(new Uint8Array([1]));
    expect(link.bytesOut).toBe(0);
    expect(link.framesOut).toBe(0);

    const { link: open, socket } = await opened();
    open.close('left');
    open.send(new Uint8Array([1]));
    expect(open.framesOut).toBe(0);
    expect(socket.sent.length).toBe(0);
  });

  it('closes the link when the socket refuses the write', async () => {
    const { link, socket } = await opened();
    socket.throwOnSend = new Error('still connecting');
    link.send(new Uint8Array([1]));
    expect(link.state).toBe('closed');
    // Counted on the way out, before the write that failed.
    expect(link.framesOut).toBe(1);
  });
});

describe('BrowserLink: closing', () => {
  it('closes once, keeps the reason, empties the queue and cuts it short for the socket', async () => {
    const { link, socket } = await opened();
    socket.deliver([1]);

    const reason = 'x'.repeat(150);
    link.close(reason);

    expect(link.state).toBe('closed');
    expect(link.reason).toBe(reason);
    expect(socket.closedWith?.code).toBe(1000);
    expect(socket.closedWith?.reason.length).toBe(100);

    let delivered = 0;
    link.poll(() => delivered++);
    expect(delivered).toBe(0);
  });

  it('is a no-op the second time, so the first reason stands', async () => {
    const { link, socket } = await opened();
    link.close('left');
    socket.closedWith = null;
    link.close('something else');
    expect(link.reason).toBe('left');
    expect(socket.closedWith).toBeNull();
  });

  it('survives a socket that throws on close', async () => {
    const { link, socket } = await opened();
    socket.close = (): never => {
      throw new Error('already gone');
    };
    expect(() => link.close('left')).not.toThrow();
    expect(link.state).toBe('closed');
  });
});

describe('BrowserLink: the simulated conditions', () => {
  it('runs on two independent streams, so one direction never drops the other', () => {
    const link = new BrowserLink('ws://host:8080', { latencyMs: 50, jitterMs: 0, lossPct: 0 });
    expect(link.inbound).not.toBe(link.outbound);
    expect(link.inbound.idle).toBe(false);
    expect(link.outbound.idle).toBe(false);
  });

  it('holds an inbound frame for the latency rather than queueing it at once', async () => {
    const link = new BrowserLink('ws://host:8080', { latencyMs: 100, jitterMs: 0, lossPct: 0 });
    const promise = link.open();
    const socket = FakeSocket.last;
    socket?.raise('open');
    await promise;

    socket?.deliver([5]);
    // Counted on arrival, but held by the simulator rather than put on the queue.
    expect(link.framesIn).toBe(1);
    let seen: number[] = [];
    link.poll((b) => seen.push(b[0] ?? -1));
    expect(seen).toEqual([]);

    fakeNow += 200;
    seen = [];
    link.poll((b) => seen.push(b[0] ?? -1));
    expect(seen).toEqual([5]);
  });

  it('holds an outbound frame the same way', async () => {
    const link = new BrowserLink('ws://host:8080', { latencyMs: 100, jitterMs: 0, lossPct: 0 });
    const promise = link.open();
    const socket = FakeSocket.last;
    socket?.raise('open');
    await promise;

    link.send(new Uint8Array([9]));
    expect(socket?.sent.length).toBe(0);

    fakeNow += 200;
    link.poll(() => undefined);
    expect(socket?.sent.length).toBe(1);
  });

  it('is perfect by default', () => {
    const link = new BrowserLink('ws://host:8080');
    expect(link.inbound.idle).toBe(true);
    expect(link.outbound.idle).toBe(true);
  });
});

describe('resolveServerUrl', () => {
  it('falls back to the page’s own origin and the documented proxy path', () => {
    expect(resolveServerUrl(null)).toBe('ws://example.test:5173/ws');
    expect(resolveServerUrl('')).toBe('ws://example.test:5173/ws');
    expect(resolveServerUrl('   ')).toBe('ws://example.test:5173/ws');

    installWindow('https:', 'protocol-seven.example');
    expect(resolveServerUrl(null)).toBe('wss://protocol-seven.example/ws');
  });

  it('gives a bare host the page’s own scheme', () => {
    expect(resolveServerUrl('127.0.0.1:8080')).toBe('ws://127.0.0.1:8080');
    installWindow('https:', 'page.example');
    expect(resolveServerUrl('127.0.0.1:8080')).toBe('wss://127.0.0.1:8080');
  });

  it('turns an http address into its socket scheme, case insensitively', () => {
    expect(resolveServerUrl('http://host:8080/ws')).toBe('ws://host:8080/ws');
    expect(resolveServerUrl('HTTP://host:8080/ws')).toBe('ws://host:8080/ws');
    expect(resolveServerUrl('https://host/ws')).toBe('wss://host/ws');
    expect(resolveServerUrl('HTTPS://host/ws')).toBe('wss://host/ws');
  });

  it('leaves a socket address as it is on a plain page', () => {
    expect(resolveServerUrl('ws://host:8080')).toBe('ws://host:8080');
    expect(resolveServerUrl('wss://host/ws')).toBe('wss://host/ws');
  });

  it('upgrades a plaintext socket on a secure page, because nothing else can work', () => {
    installWindow('https:', 'page.example');
    expect(resolveServerUrl('ws://host:8080')).toBe('wss://host:8080');
    expect(resolveServerUrl('http://host:8080/ws')).toBe('wss://host:8080/ws');
    // Already secure: untouched.
    expect(resolveServerUrl('wss://host/ws')).toBe('wss://host/ws');
  });

  it('trims what it was handed before deciding anything', () => {
    expect(resolveServerUrl('  127.0.0.1:8080  ')).toBe('ws://127.0.0.1:8080');
  });
});
