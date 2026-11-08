import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installClock } from '../../shared/core/Clock';
import { decodeHeader, writeBye, writeReject, writeWelcome } from '../../shared/net/Messages';
import { NET_PERFECT } from '../../shared/net/NetSim';
import {
  HANDSHAKE_TIMEOUT_MS,
  PROTOCOL_VERSION,
  RECONNECT_TOKEN_BYTES,
  RejectCode,
  rejectText,
} from '../../shared/net/Protocol';
import { NO_SKIN_INDEX } from '../../shared/meta/Skins';
import { ByteReader, ByteWriter } from '../../shared/net/Wire';
import { makeSnapshotHeader, writeSnapshotHeader } from '../../shared/net/Messages';
import type { NetLoadout } from '../../shared/net/Skirmish';
import type { WelcomeInfo } from '../../shared/net/Messages';
import { handshake, HandshakeError, type HandshakeOptions } from './Handshake';

/**
 * One `Hello` out, one `Welcome` back, over a fake socket (C13).
 *
 * The frames are written by the real writers and decoded by the real decoder, so what this
 * pins is the exchange rather than a paraphrase of it. The only stub is the `WebSocket`: the
 * `BrowserLink` under the handshake is the real one, queue, counters and all.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow });

type Listener = (ev: unknown) => void;

class FakeSocket {
  static last: FakeSocket | null = null;
  static throwOnConstruct: Error | null = null;

  binaryType = '';
  readonly sent: ArrayBuffer[] = [];
  closedWith: { code: number; reason: string } | null = null;

  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    if (FakeSocket.throwOnConstruct !== null) throw FakeSocket.throwOnConstruct;
    FakeSocket.last = this;
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  }

  send(buf: ArrayBuffer): void {
    this.sent.push(buf);
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
  }

  raise(type: string, ev: unknown = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }

  deliver(bytes: Uint8Array): void {
    this.raise('message', { data: bytes.slice().buffer });
  }
}

const SEAT: WelcomeInfo = {
  entityId: 4,
  team: 'B',
  mapId: 'mp_foundry',
  modeId: 'DOM',
  serverTick: 600,
  serverMs: 20_000,
  snapshotHz: 20,
  matchId: 7,
  effectiveTick: 601,
  migrated: false,
};

const OPTIONS: HandshakeOptions = {
  url: 'ws://host:8080',
  displayName: 'ALICE',
  conditions: NET_PERFECT,
  wantRewindDebug: false,
};

const LOADOUT: NetLoadout = {
  name: 'ASSAULT',
  primary: { weaponId: 'ar_vector', attachments: ['optic_red_dot'], camo: null },
  secondary: { weaponId: 'pistol_m9', attachments: [], camo: null },
  lethal: 'frag',
  tactical: 'flash',
  perks: ['perk_light_foot', null, null],
  fieldUpgrade: 'fu_munitions',
  streaks: ['uav', null, null],
};

function welcomeFrame(info: Partial<WelcomeInfo> = {}, token: Uint8Array | null = null): Uint8Array {
  return writeWelcome(new ByteWriter(1024), { ...SEAT, ...info }, token).slice();
}

/**
 * The same frame with another protocol number in it.
 *
 * The version is the first `u16` of the body, so it is found by its own little-endian bytes
 * rather than by an offset this test would have to keep in step with the frame header.
 */
function withVersion(frame: Uint8Array, version: number): Uint8Array {
  const out = frame.slice();
  const lo = PROTOCOL_VERSION & 0xff;
  const hi = (PROTOCOL_VERSION >> 8) & 0xff;
  for (let i = 4; i < 10; i++) {
    if (out[i] === lo && out[i + 1] === hi) {
      out[i] = version & 0xff;
      out[i + 1] = (version >> 8) & 0xff;
      return out;
    }
  }
  throw new Error('version not found in the welcome frame');
}

/** Let the 16 ms poll run a few times. */
function settle(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a handshake and give the socket back once it is open.
 *
 * `handshake` runs synchronously as far as `link.open()`, so the socket exists by the time
 * this returns; raising `open` is what lets the `Hello` go out.
 */
function start(options: Partial<HandshakeOptions> = {}): {
  result: ReturnType<typeof handshake>;
  socket: FakeSocket;
} {
  const result = handshake({ ...OPTIONS, ...options });
  const socket = FakeSocket.last;
  if (socket === null) throw new Error('no socket');
  socket.raise('open');
  return { result, socket };
}

beforeEach(() => {
  fakeNow = 1000;
  FakeSocket.last = null;
  FakeSocket.throwOnConstruct = null;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
});

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

describe('handshake: the Hello', () => {
  it('opens the configured address and sends exactly one Hello', async () => {
    const { result, socket } = start();
    await settle(30);
    socket.deliver(welcomeFrame());
    await result;

    expect(socket.url).toBe('ws://host:8080');
    expect(socket.sent.length).toBe(1);
    const msg = decodeHeader(new ByteReader(new Uint8Array(socket.sent[0] ?? new ArrayBuffer(0))));
    expect(msg.kind).toBe('hello');
  });

  it('carries the name, the body and the class the caller asked for', async () => {
    const { result, socket } = start({ displayName: 'ZULU', skinIndex: 3, loadout: LOADOUT });
    await settle(30);
    socket.deliver(welcomeFrame());
    await result;

    const msg = decodeHeader(new ByteReader(new Uint8Array(socket.sent[0] ?? new ArrayBuffer(0))));
    expect(msg.kind === 'hello' && msg.name).toBe('ZULU');
    expect(msg.kind === 'hello' && msg.skinIndex).toBe(3);
  });

  it('declares no body as the "none" index rather than leaving it out', async () => {
    const { result, socket } = start();
    await settle(30);
    socket.deliver(welcomeFrame());
    await result;

    const msg = decodeHeader(new ByteReader(new Uint8Array(socket.sent[0] ?? new ArrayBuffer(0))));
    expect(msg.kind === 'hello' && msg.skinIndex).toBe(NO_SKIN_INDEX);
  });

  it('appends the rewind opt-in to the name, after the cap', async () => {
    const { result, socket } = start({ displayName: 'ALICE', wantRewindDebug: true });
    await settle(30);
    socket.deliver(welcomeFrame());
    await result;

    const msg = decodeHeader(new ByteReader(new Uint8Array(socket.sent[0] ?? new ArrayBuffer(0))));
    expect(msg.kind === 'hello' && msg.name).toBe('ALICE#rw');
  });

  it('presents a reconnect claim on the Hello, which is the only frame that can carry one', async () => {
    const token = new Uint8Array(RECONNECT_TOKEN_BYTES).fill(9);
    const { result, socket } = start({ reconnectToken: token });
    await settle(30);
    socket.deliver(welcomeFrame());
    await result;

    const msg = decodeHeader(new ByteReader(new Uint8Array(socket.sent[0] ?? new ArrayBuffer(0))));
    expect(msg.kind === 'hello' && msg.reconnectToken).not.toBeNull();
  });
});

describe('handshake: the Welcome', () => {
  it('reports what the server said it is running, field for field', async () => {
    const { result, socket } = start();
    await settle(30);
    socket.deliver(welcomeFrame());
    const out = await result;

    expect(out.welcome.entityId).toBe(4);
    expect(out.welcome.team).toBe('B');
    expect(out.welcome.mapId).toBe('mp_foundry');
    expect(out.welcome.modeId).toBe('DOM');
    expect(out.welcome.serverTick).toBe(600);
    expect(out.welcome.serverMs).toBe(20_000);
    expect(out.welcome.snapshotHz).toBe(20);
    expect(out.welcome.matchId).toBe(7);
    expect(out.welcome.effectiveTick).toBe(601);
    expect(out.welcome.migrated).toBe(false);
    expect(out.link.state).toBe('open');
    expect(out.receivedAtMs).toBeGreaterThan(0);
    expect(out.pending).toEqual([]);
    expect(out.reconnectToken).toBeNull();
  });

  it('carries the token the server minted for this socket', async () => {
    const token = new Uint8Array(RECONNECT_TOKEN_BYTES).fill(7);
    const { result, socket } = start();
    await settle(30);
    socket.deliver(welcomeFrame({}, token));
    const out = await result;

    expect(out.reconnectToken).not.toBeNull();
    expect([...(out.reconnectToken ?? [])]).toEqual([...token]);
  });

  it('keeps what arrived behind the Welcome in the same drain, rather than dropping it', async () => {
    const { result, socket } = start();
    await settle(30);
    // Both land before the next 16 ms poll, so `poll` hands them over in one batch — which
    // is the reconnect case: a seat assignment follows the welcome microseconds later.
    socket.deliver(welcomeFrame());
    socket.deliver(writeBye(new ByteWriter(256), true, 'behind the welcome'));
    const out = await result;

    expect(out.pending.length).toBe(1);
    const msg = decodeHeader(new ByteReader(out.pending[0] ?? new Uint8Array(0)));
    expect(msg.kind).toBe('bye');
  });

  it('drops a snapshot that arrives before the Welcome, because the next one is whole', async () => {
    const { result, socket } = start();
    await settle(30);
    // At most one of these: the server's snapshot tick landing between the seating and the
    // microtask that sends the welcome. The encoder keeps sending full snapshots until the
    // client acks one, so nothing is lost by throwing it away.
    const w = new ByteWriter(1024);
    writeSnapshotHeader(w, { ...makeSnapshotHeader(), snapshotId: 1, serverTick: 599 });
    socket.deliver(w.bytes());
    await settle(40);
    socket.deliver(welcomeFrame());
    const out = await result;

    expect(out.pending).toEqual([]);
    expect(out.welcome.entityId).toBe(4);
  });
});

describe('handshake: the failures', () => {
  it('reports a socket that never connected, and says it was not a refusal', async () => {
    const result = handshake(OPTIONS);
    FakeSocket.last?.raise('error');

    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandshakeError);
    expect((err as HandshakeError).message).toBe('could not reach the server');
    expect((err as HandshakeError).refused).toBe(false);
  });

  it('reports a URL the browser would not even open', async () => {
    FakeSocket.throwOnConstruct = new Error('SyntaxError: bad url');
    const err = await handshake(OPTIONS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandshakeError);
    expect((err as HandshakeError).message).toBe('SyntaxError: bad url');
    expect((err as HandshakeError).refused).toBe(false);
  });

  it('refuses a server speaking another protocol, and names both numbers', async () => {
    const { result, socket } = start();
    await settle(30);
    socket.deliver(withVersion(welcomeFrame(), PROTOCOL_VERSION + 1));

    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandshakeError);
    expect((err as HandshakeError).refused).toBe(true);
    expect((err as HandshakeError).message).toBe(
      `server speaks protocol v${PROTOCOL_VERSION + 1}, this build speaks v${PROTOCOL_VERSION}`,
    );
    expect(socket.closedWith?.reason).toBe('handshake failed');
  });

  it('turns a Reject into the sentence that code stands for', async () => {
    const { result, socket } = start();
    await settle(30);
    socket.deliver(writeReject(new ByteWriter(256), RejectCode.ServerFull));

    const err = await result.catch((e: unknown) => e);
    expect((err as HandshakeError).message).toBe(rejectText(RejectCode.ServerFull));
    expect((err as HandshakeError).refused).toBe(true);
  });

  it('passes a Bye’s own reason through', async () => {
    const { result, socket } = start();
    await settle(30);
    socket.deliver(writeBye(new ByteWriter(256), true, 'match over, come back later'));

    const err = await result.catch((e: unknown) => e);
    expect((err as HandshakeError).message).toBe('match over, come back later');
    expect((err as HandshakeError).refused).toBe(true);
  });

  it('reports a socket that closed while it was waiting', async () => {
    const { result, socket } = start();
    await settle(30);
    socket.raise('close', { reason: 'server restarting' });

    const err = await result.catch((e: unknown) => e);
    expect((err as HandshakeError).message).toBe('server restarting');
    expect((err as HandshakeError).refused).toBe(true);
  });

  it(`gives up after ${HANDSHAKE_TIMEOUT_MS} ms of a server that said nothing`, async () => {
    const { result, socket } = start();
    const err = await result.catch((e: unknown) => e);

    expect((err as HandshakeError).message).toBe(
      'the server accepted the connection but never replied',
    );
    expect((err as HandshakeError).refused).toBe(false);
    expect(socket.closedWith?.reason).toBe('handshake failed');
  });

  it('settles once, whatever arrives afterwards', async () => {
    const { result, socket } = start();
    const settled = result.catch((e: unknown) => e);
    await settle(30);
    socket.deliver(writeReject(new ByteWriter(256), RejectCode.ServerFull));
    await settle(40);
    socket.deliver(welcomeFrame());
    await settle(40);

    const err = await settled;
    expect((err as HandshakeError).message).toBe(rejectText(RejectCode.ServerFull));
  });
});
