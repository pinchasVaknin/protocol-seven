import { describe, expect, it } from 'vitest';
import { LocalIdentity } from '../../shared/combat/LocalIdentity';
import { installClock } from '../../shared/core/Clock';
import { createGameBus, EV, type GameBus } from '../../shared/core/Events';
import type { InputCommand, MutableInputCommand } from '../../shared/core/InputCommand';
import {
  beginEvents,
  decodeHeader,
  Ev,
  finishEvents,
  makeSnapshotHeader,
  writeBomb,
  writeDamage,
  writeFired,
  writeFootstep,
  writeImpact,
  writeKilled,
  writeNotice,
  writeObjectives,
  writePose,
  writePrepare,
  writeScoreboard,
  writeSnapshotEntities,
  writeSnapshotHeader,
  writeSnapshotOwner,
  writeStateHash,
  writeStreaks,
  writeTags,
  writeVoteState,
  writeWelcome,
  SFlag,
  type SnapshotHeader,
  type WelcomeInfo,
} from '../../shared/net/Messages';
import type { ReplicatedScoreRow } from '../../shared/combat/ScoreSystem';
import { DEFAULT_MOVEMENT_CONFIG } from '../../shared/player/MovementConfig';
import { PlayerController } from '../../shared/player/PlayerController';
import { makePlayerSimState } from '../../shared/player/PlayerState';
import { dequantPos, quantPos } from '../../shared/net/Protocol';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import type { INetLink, LinkState } from '../../shared/net/Transport';
import { ByteReader, ByteWriter } from '../../shared/net/Wire';
import { ColliderSet } from '../../shared/world/ColliderSet';
import { CollisionWorld } from '../../shared/world/CollisionWorld';
import type { BrowserLink } from './BrowserLink';
import { NetSession, type NetSessionDeps } from './NetSession';

/**
 * The socket turned into things the rest of the client can draw (C13).
 *
 * The link is the only stub. The `NetClient` underneath is the real one, the frames are
 * written by the real writers, the `PlayerController` is real over a real `CollisionWorld`,
 * and every assertion is on the public surface — the bus, the actor table, the callbacks
 * `MatchWorld` sets. That is the seam S3 built and this file exists to keep.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow });

class FakeLink implements INetLink {
  state: LinkState = 'open';
  readonly sent: Uint8Array[] = [];
  readonly inbox: Uint8Array[] = [];
  closedWith: string | null = null;
  lastRecvMs = 0;
  readonly remoteAddress = 'ws://test:8080';
  bytesIn = 0;
  bytesOut = 0;
  framesIn = 0;
  framesOut = 0;

  send(bytes: Uint8Array): void {
    this.sent.push(bytes.slice());
    this.bytesOut += bytes.length;
    this.framesOut++;
  }

  poll(handler: (bytes: Uint8Array) => void): void {
    const batch = this.inbox.splice(0, this.inbox.length);
    for (const bytes of batch) {
      this.bytesIn += bytes.length;
      this.framesIn++;
      handler(bytes);
    }
  }

  close(reason: string): void {
    this.closedWith = reason;
    this.state = 'closed';
  }

  deliver(bytes: Uint8Array): void {
    this.inbox.push(bytes.slice());
  }

  kinds(): string[] {
    return this.sent.map((bytes) => decodeHeader(new ByteReader(bytes)).kind);
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
  effectiveTick: 600,
  migrated: false,
};

interface Seen {
  readonly fired: unknown[];
  readonly impacts: unknown[];
  readonly damage: unknown[];
  readonly killed: unknown[];
  readonly steps: unknown[];
  readonly lands: unknown[];
  readonly jumps: unknown[];
  readonly scores: unknown[];
}

interface SnapshotOpts {
  readonly header?: Partial<SnapshotHeader>;
  readonly owner?: ReturnType<typeof makePlayerSimState> | null;
  readonly entities?: readonly EntitySnapshot[];
  readonly removed?: readonly number[];
}

interface Rig {
  readonly session: NetSession;
  readonly link: FakeLink;
  readonly bus: GameBus;
  readonly identity: LocalIdentity;
  readonly seen: Seen;
  readonly w: ByteWriter;
  /** Every `(health, alive, spawnSerial)` the session pushed at the local player. */
  readonly local: Array<readonly [number, boolean, number]>;
  readonly hashes: Array<readonly [number, number]>;
  readonly matchStates: Array<Record<string, number | string>>;
  readonly authoritative: SnapshotHeader[];
  readonly newMatches: WelcomeInfo[];
  snapshot(opts?: SnapshotOpts): void;
  events(write: (w: ByteWriter) => number): void;
}

function rig(overrides: Partial<NetSessionDeps> = {}): Rig {
  fakeNow = 1000;
  const link = new FakeLink();
  const set = new ColliderSet(1);
  set.add({ x: 0, y: -1, z: 0 }, { x: 80, y: 2, z: 80 }, 0, 0, 0, 'concrete');
  const world = new CollisionWorld(
    set,
    { min: { x: -40, y: -8, z: -40 }, max: { x: 40, y: 24, z: 40 } },
    8,
  );
  const controller = new PlayerController(DEFAULT_MOVEMENT_CONFIG, world, createGameBus(), 4);
  controller.spawn(0, 0, 0, 0);

  const cmd: MutableInputCommand = {
    seq: 0,
    tickIndex: 0,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    sampledAtMs: 0,
  };
  let seq = 1;
  const sample = (tick: number): InputCommand => {
    cmd.seq = seq++;
    cmd.tickIndex = tick;
    return cmd;
  };

  const bus = createGameBus();
  const seen: Seen = {
    fired: [],
    impacts: [],
    damage: [],
    killed: [],
    steps: [],
    lands: [],
    jumps: [],
    scores: [],
  };
  // Payloads are transient by contract, so every listener keeps a copy rather than the record.
  bus.on(EV.WeaponFired, (e) => seen.fired.push({ ...e }));
  bus.on(EV.BulletImpact, (e) => seen.impacts.push({ ...e }));
  bus.on(EV.DamageDealt, (e) => seen.damage.push({ ...e }));
  bus.on(EV.EntityKilled, (e) => seen.killed.push({ ...e }));
  bus.on(EV.PlayerFootstep, (e) => seen.steps.push({ ...e }));
  bus.on(EV.PlayerLanded, (e) => seen.lands.push({ ...e }));
  bus.on(EV.PlayerJumped, (e) => seen.jumps.push({ ...e }));
  bus.on(EV.ScoreChanged, (e) => seen.scores.push({ ...e }));

  const identity = new LocalIdentity();
  const newMatches: WelcomeInfo[] = [];

  const session = new NetSession({
    link: link as unknown as BrowserLink,
    welcome: SEAT,
    receivedAtMs: 1000,
    displayName: 'ALICE',
    healthMax: () => 100,
    bus,
    controller,
    sample,
    applyWeapon: () => undefined,
    moveScale: () => 1,
    identity,
    onNewMatch: (info) => newMatches.push(info),
    ...overrides,
  });

  const local: Array<readonly [number, boolean, number]> = [];
  session.onLocalState = (health, alive, spawnSerial) => local.push([health, alive, spawnSerial]);
  const hashes: Array<readonly [number, number]> = [];
  session.onStateHash = (tick, hash) => hashes.push([tick, hash]);
  const matchStates: Array<Record<string, number | string>> = [];
  session.onMatchState = (s) => matchStates.push({ ...s } as Record<string, number | string>);
  const authoritative: SnapshotHeader[] = [];
  session.onAuthoritativeState = (h) => authoritative.push({ ...h });

  const w = new ByteWriter(4096);
  return {
    session,
    link,
    bus,
    identity,
    seen,
    w,
    local,
    hashes,
    matchStates,
    authoritative,
    newMatches,
    snapshot(opts = {}) {
      const header = { ...makeSnapshotHeader(), snapshotId: 1, serverTick: 600, ...opts.header };
      writeSnapshotHeader(w, header);
      writeSnapshotOwner(w, opts.owner ?? null, 0);
      const entities = opts.entities ?? [];
      const removed = opts.removed ?? [];
      writeSnapshotEntities(w, entities, entities.length, () => null, removed, removed.length);
      link.deliver(w.bytes());
      session.update();
    },
    events(write) {
      beginEvents(w);
      const count = write(w);
      link.deliver(finishEvents(w, count));
      session.update();
    },
  };
}

function body(entityId: number, mutate: (e: EntitySnapshot) => void = () => undefined): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.displayName = `P${entityId}`;
  mutate(e);
  return e;
}

/** A position as it comes back off the wire, so an assertion can be exact. */
function onWire(v: number): number {
  return dequantPos(quantPos(v));
}

const SCORE_ROW: ReplicatedScoreRow = {
  entityId: 9,
  displayName: 'P9',
  team: 'A',
  kills: 3,
  deaths: 1,
  assists: 0,
  score: 300,
  streak: 2,
  bestStreak: 3,
  shotsFired: 40,
  shotsHit: 12,
  damageDealt: 400,
  headshots: 1,
  captures: 0,
  defends: 0,
  plants: 0,
  defuses: 0,
  tags: 0,
};

// ---------------------------------------------------------------------------

describe('NetSession: taking up the connection', () => {
  it('adopts the server’s seat before anything can ask about it', () => {
    const r = rig();
    // The constructor does it, not `start`: every "is this me?" test downstream compares
    // against this, and a session built but not started would answer for seat 0.
    expect(r.identity.is(4)).toBe(true);
  });

  it('joins on start, and reports what the server said it is running', () => {
    const r = rig();
    expect(r.session.connected).toBe(false);
    r.session.start();
    expect(r.session.state).toBe('joined');
    expect(r.session.connected).toBe(true);
    expect(r.session.welcome.mapId).toBe('mp_foundry');
    expect(r.session.welcome.modeId).toBe('DOM');
    expect(r.session.link.remoteAddress).toBe('ws://test:8080');
  });

  it('replays what the handshake drained behind the Welcome, onto a joined client', () => {
    const w = new ByteWriter(1024);
    writeSnapshotHeader(w, { ...makeSnapshotHeader(), snapshotId: 1, serverTick: 600 });
    writeSnapshotOwner(w, null, 0);
    const entities = [body(9)];
    writeSnapshotEntities(w, entities, 1, () => null, [], 0);
    const pending = [w.bytes().slice()];

    const r = rig({ pending });
    r.session.start();

    // The frame was applied, so the body it carried is already known.
    expect(r.session.client.remotes.has(9)).toBe(true);
  });

  it('starts with no pending frames at all on an ordinary join', () => {
    const r = rig();
    r.session.start();
    expect(r.session.client.remotes.size).toBe(0);
  });

  it('says goodbye and closes on disconnect', () => {
    const r = rig();
    r.session.start();
    r.session.disconnect('left');
    expect(r.link.kinds()).toContain('bye');
    expect(r.link.closedWith).toBe('left');
  });
});

describe('NetSession: the event bridge', () => {
  it('re-emits a remote shot as the bus entry the presentation layer already listens for', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeFired(w, {
        sourceId: 9,
        weaponIndex: 0,
        x: 1,
        y: 2,
        z: 3,
        endX: 1,
        endY: 2,
        endZ: 13,
        material: 2,
        tracer: true,
        pelletsHit: 0,
        minimapPing: true,
      });
      return 1;
    });

    expect(r.seen.fired.length).toBe(1);
    const e = r.seen.fired[0] as Record<string, number | string | boolean>;
    expect(e.sourceId).toBe(9);
    expect(e.x).toBe(onWire(1));
    expect(e.endZ).toBe(onWire(13));
    expect(e.tracer).toBe(true);
    expect(e.hitTarget).toBe(false);
    expect(e.shotIndex).toBe(0);
    expect(e.spreadDeg).toBe(0);
    expect(e.ammoInMag).toBe(0);
    expect(e.minimapPing).toBe(true);
    // The direction is normalised from the two ends the shot carried.
    expect(e.dx).toBe(0);
    expect(e.dy).toBe(0);
    expect(e.dz).toBe(1);
    expect(e.distance).toBe(onWire(13) - onWire(3));
  });

  it('never replays our own shot, which the local weapon has already drawn', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeFired(w, {
        sourceId: 4,
        weaponIndex: 0,
        x: 0,
        y: 0,
        z: 0,
        endX: 0,
        endY: 0,
        endZ: 5,
        material: 0,
        tracer: false,
        pelletsHit: 0,
        minimapPing: true,
      });
      return 1;
    });
    expect(r.seen.fired).toEqual([]);
    expect(r.seen.impacts).toEqual([]);
  });

  it('says nothing for a weapon index that names no weapon', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeFired(w, {
        sourceId: 9,
        weaponIndex: 254,
        x: 0,
        y: 0,
        z: 0,
        endX: 0,
        endY: 0,
        endZ: 5,
        material: 0,
        tracer: false,
        pelletsHit: 0,
        minimapPing: true,
      });
      return 1;
    });
    expect(r.seen.fired).toEqual([]);
  });

  it('synthesises the impact at the shot’s terminus, facing back along the travel', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeFired(w, {
        sourceId: 9,
        weaponIndex: 0,
        x: 0,
        y: 0,
        z: 0,
        endX: 0,
        endY: 0,
        endZ: 10,
        material: 3,
        tracer: false,
        pelletsHit: 0,
        minimapPing: true,
      });
      return 1;
    });

    expect(r.seen.impacts.length).toBe(1);
    const i = r.seen.impacts[0] as Record<string, number | boolean>;
    expect(i.z).toBe(onWire(10));
    expect(i.nz).toBe(-1);
    expect(i.material).toBe(3);
    expect(i.penetrated).toBe(false);
  });

  it('leaves no hole in a body: a round that connected synthesises nothing', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeFired(w, {
        sourceId: 9,
        weaponIndex: 0,
        x: 0,
        y: 0,
        z: 0,
        endX: 0,
        endY: 0,
        endZ: 10,
        material: 3,
        tracer: false,
        pelletsHit: 1,
        minimapPing: true,
      });
      return 1;
    });

    expect(r.seen.fired.length).toBe(1);
    expect((r.seen.fired[0] as Record<string, boolean>).hitTarget).toBe(true);
    expect(r.seen.impacts).toEqual([]);
  });

  it('turns a bare impact toward the player, because it carries no direction', () => {
    const r = rig();
    r.session.start();
    // The local sim is at the origin; the round landed 5 m down +z.
    r.events((w) => {
      writeImpact(w, { x: 0, y: 0, z: 5, material: 4 });
      return 1;
    });

    expect(r.seen.impacts.length).toBe(1);
    const i = r.seen.impacts[0] as Record<string, number>;
    expect(i.z).toBe(onWire(5));
    // Pointing from the impact back at the eye, normalised.
    expect(i.nz).toBeLessThan(0);
    expect(Math.hypot(i.nx ?? 0, i.ny ?? 0, i.nz ?? 0)).toBeCloseTo(1, 12);
    expect(i.material).toBe(4);
  });

  it('passes damage through with the zone, the amount and the two bits', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeDamage(w, {
        sourceId: 9,
        targetId: 4,
        amount: 37.5,
        zone: 'head',
        x: 1,
        y: 2,
        z: 3,
        lethal: true,
        autonomous: true,
      });
      return 1;
    });

    expect(r.seen.damage.length).toBe(1);
    const d = r.seen.damage[0] as Record<string, number | string | boolean>;
    expect(d.sourceId).toBe(9);
    expect(d.targetId).toBe(4);
    expect(d.amount).toBe(37.5);
    expect(d.zone).toBe('head');
    expect(d.lethal).toBe(true);
    expect(d.autonomous).toBe(true);
    expect(d.weaponId).toBe('');
    // Not on the wire, and left at zero rather than guessed.
    expect(d.distance).toBe(0);
    expect(d.falloffLoss).toBe(0);
    expect(d.penetrationLoss).toBe(0);
  });

  it('passes a kill through, with the killer’s health at the moment it was true', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeKilled(w, { targetId: 9, sourceId: 4, weaponIndex: 0, zone: 'torso', killerHealth: 8 });
      return 1;
    });

    expect(r.seen.killed.length).toBe(1);
    const k = r.seen.killed[0] as Record<string, number | string>;
    expect(k.targetId).toBe(9);
    expect(k.sourceId).toBe(4);
    expect(k.zone).toBe('torso');
    expect(k.killerHealth).toBe(8);
    expect(typeof k.weaponId).toBe('string');
    expect(k.weaponId).not.toBe('');
  });

  it('names no weapon for a kill whose index names none', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeKilled(w, { targetId: 9, sourceId: 0, weaponIndex: 255, zone: 'torso', killerHealth: 0 });
      return 1;
    });
    expect((r.seen.killed[0] as Record<string, string>).weaponId).toBe('');
  });

  it('plays another body’s footstep, and never our own', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writeFootstep(w, { entityId: 9, x: 1, y: 0, z: 2, material: 5, heavy: true, quiet: false });
      writeFootstep(w, { entityId: 4, x: 0, y: 0, z: 0, material: 5, heavy: false, quiet: false });
      return 2;
    });

    expect(r.seen.steps.length).toBe(1);
    const s = r.seen.steps[0] as Record<string, number | boolean>;
    expect(s.entityId).toBe(9);
    expect(s.heavy).toBe(true);
    expect(s.quiet).toBe(false);
    expect(s.material).toBe(5);
    // Not on the wire: the speed is the local path's, and this one has none.
    expect(s.speed).toBe(0);
  });

  it('plays another body’s landing and jump, and never our own', () => {
    const r = rig();
    r.session.start();
    r.events((w) => {
      writePose(w, Ev.Land, { entityId: 9, x: 1, y: 0, z: 2, speed: 6, material: 2 });
      writePose(w, Ev.Land, { entityId: 4, x: 0, y: 0, z: 0, speed: 6, material: 2 });
      writePose(w, Ev.Jump, { entityId: 9, x: 1, y: 0, z: 2, speed: 4, material: 0 });
      writePose(w, Ev.Jump, { entityId: 4, x: 0, y: 0, z: 0, speed: 4, material: 0 });
      return 4;
    });

    expect(r.seen.lands.length).toBe(1);
    const l = r.seen.lands[0] as Record<string, number | string>;
    expect(l.entityId).toBe(9);
    expect(l.impactSpeed).toBe(6);
    expect(l.stance).toBe('STAND');
    expect(l.material).toBe(2);

    expect(r.seen.jumps.length).toBe(1);
    const j = r.seen.jumps[0] as Record<string, number>;
    expect(j.entityId).toBe(9);
    expect(j.horizontalSpeed).toBe(4);
  });
});

describe('NetSession: the replicated match', () => {
  it('mirrors the header’s score, clock and two flags', () => {
    const r = rig();
    r.session.start();
    r.snapshot({
      header: { scoreA: 3, scoreB: 5, timeLeft: 42, flags: SFlag.InputFrozen | SFlag.MatchOver },
    });

    expect(r.session.scoreA).toBe(3);
    expect(r.session.scoreB).toBe(5);
    expect(r.session.timeLeft).toBe(42);
    expect(r.session.frozen).toBe(true);
    expect(r.session.matchOver).toBe(true);
  });

  it('pushes the replicated clock into the client’s own inert MatchFlow', () => {
    const r = rig();
    r.session.start();
    r.snapshot({
      header: { scoreA: 1, scoreB: 2, timeLeft: 90, phaseSeconds: 4, round: 3, serverTick: 611 },
    });

    expect(r.matchStates.length).toBe(1);
    const s = r.matchStates[0] ?? {};
    expect(s.secondsRemaining).toBe(90);
    expect(s.phaseSeconds).toBe(4);
    expect(s.round).toBe(3);
    expect(s.scoreA).toBe(1);
    expect(s.scoreB).toBe(2);
    expect(s.serverTick).toBe(611);
  });

  it('never reports a negative clock to the HUD', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ header: { timeLeft: -1 } });
    expect(r.session.timeLeft).toBe(-1);
    expect((r.matchStates[0] ?? {}).secondsRemaining).toBe(0);
  });

  it('emits the score as an event only when it moves', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ header: { scoreA: 1, scoreB: 0 } });
    r.snapshot({ header: { scoreA: 1, scoreB: 0, snapshotId: 2 } });
    r.snapshot({ header: { scoreA: 1, scoreB: 1, snapshotId: 3 } });

    expect(r.seen.scores.length).toBe(2);
    expect(r.seen.scores[0]).toEqual({ teamA: 1, teamB: 0, limit: 0 });
    expect(r.seen.scores[1]).toEqual({ teamA: 1, teamB: 1, limit: 0 });
  });

  it('hands the raw header to the divergence checker, after the interpretation', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ header: { scoreA: 2, serverTick: 640 } });
    expect(r.authoritative.length).toBe(1);
    expect(r.authoritative[0]?.serverTick).toBe(640);
    expect(r.authoritative[0]?.scoreA).toBe(2);
  });

  it('applies the local player’s own health and liveness on every snapshot', () => {
    const r = rig();
    r.session.start();
    const me = body(4, (e) => {
      e.health = 55;
      e.flags = EFlag.Alive;
    });
    r.snapshot({ entities: [me] });
    r.snapshot({ entities: [me], header: { snapshotId: 2 } });

    // Twice for the same value: the server's answer wins over the client's, not only over
    // the server's own previous answer.
    expect(r.local.length).toBe(2);
    expect(r.local[0]?.[0]).toBe(55);
    expect(r.local[0]?.[1]).toBe(true);
  });

  it('carries the spawn serial along, because it says whether this is the same body', () => {
    const r = rig();
    r.session.start();
    r.snapshot({
      entities: [
        body(4, (e) => {
          e.health = 100;
          e.spawnSerial = 2;
        }),
      ],
    });
    expect(r.local[0]?.[2]).toBe(2);
  });

  it('says nothing about the local player while our own body is not in the snapshot', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ entities: [body(9)] });
    expect(r.local).toEqual([]);
  });
});

describe('NetSession: the state hash', () => {
  it('holds the hash until the state it describes has been applied', () => {
    const r = rig();
    r.session.start();
    // Arrives with no snapshot behind it: held, not compared.
    const w = new ByteWriter(512);
    r.link.deliver(writeStateHash(w, 640, 1234, [1, 2]));
    r.session.update();
    expect(r.hashes).toEqual([]);
  });

  it('reports it once the client is synchronised and a snapshot has landed', () => {
    const r = rig();
    r.session.start();
    // An owner block is what clears `awaitingFirstAuthoritativePose`.
    r.snapshot({ owner: makePlayerSimState() });

    const w = new ByteWriter(512);
    r.link.deliver(writeStateHash(w, 640, 1234, [1, 2]));
    r.snapshot({ header: { snapshotId: 2 } });

    expect(r.hashes).toEqual([[640, 1234]]);
  });

  it('keeps only the newest, because only the newest has an answer coming', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ owner: makePlayerSimState() });

    const w = new ByteWriter(512);
    r.link.deliver(writeStateHash(w, 640, 1, []));
    r.link.deliver(writeStateHash(w, 641, 2, []));
    r.snapshot({ header: { snapshotId: 2 } });

    expect(r.hashes).toEqual([[641, 2]]);
  });
});

describe('NetSession: the actors', () => {
  it('builds a body for everybody but us, and pulls this frame’s pose', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ entities: [body(4), body(9), body(10)] });

    expect([...r.session.actors.keys()].sort((a, b) => a - b)).toEqual([9, 10]);
    expect(r.session.actors.get(9)?.displayName).toBe('P9');
  });

  it('keeps the same instance for a body across snapshots', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ entities: [body(9)] });
    const first = r.session.actors.get(9);
    r.snapshot({ entities: [body(9)], header: { snapshotId: 2 } });
    expect(r.session.actors.get(9)).toBe(first);
  });

  it('lets a body leave the scene when the server stops sending it', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ entities: [body(9), body(10)] });
    expect(r.session.actors.size).toBe(2);

    r.snapshot({ entities: [body(9)], removed: [10], header: { snapshotId: 2 } });
    expect([...r.session.actors.keys()]).toEqual([9]);
    expect(r.session.roundBlockers().length).toBe(1);
  });

  it('hands the shot path the live array, refilled after the removals', () => {
    const r = rig();
    r.session.start();
    const blockers = r.session.roundBlockers();
    r.snapshot({ entities: [body(9), body(10)] });

    // The instance never changes, so whoever holds it holds the live set.
    expect(r.session.roundBlockers()).toBe(blockers);
    expect(blockers.length).toBe(2);
  });

  it('rebuilds the renderable set per frame, in the actor table’s order', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ entities: [body(9), body(10)] });

    const once = [...r.session.renderables()];
    expect(once.length).toBe(2);
    expect([...r.session.renderables()].length).toBe(2);
  });
});

describe('NetSession: the directory', () => {
  it('answers for us from the welcome, and for everybody else from the snapshot', () => {
    const r = rig();
    r.session.start();
    r.snapshot({
      entities: [
        body(9, (e) => {
          e.flags = EFlag.Alive | EFlag.TeamB;
        }),
        body(10),
      ],
    });

    const dir = r.session.directory();
    expect(dir.nameOf(4)).toBe('ALICE');
    expect(dir.teamOf(4)).toBe('B');
    expect(dir.nameOf(9)).toBe('P9');
    expect(dir.teamOf(9)).toBe('B');
    expect(dir.teamOf(10)).toBe('A');
  });

  it('says nothing about an id it has never seen', () => {
    const r = rig();
    r.session.start();
    const dir = r.session.directory();
    expect(dir.nameOf(77)).toBeNull();
    expect(dir.teamOf(77)).toBeNull();
  });
});

describe('NetSession: letting go', () => {
  it('cuts every callback and empties the tables on detach', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ entities: [body(9)] });
    r.session.onObjectives = () => undefined;
    r.session.onTags = () => undefined;
    r.session.onBomb = () => undefined;
    r.session.onStreaks = () => undefined;
    r.session.onScoreboard = () => undefined;
    r.session.onProjectiles = () => undefined;

    r.session.detach();

    expect(r.session.onMatchState).toBeNull();
    expect(r.session.onAuthoritativeState).toBeNull();
    expect(r.session.onStateHash).toBeNull();
    expect(r.session.onObjectives).toBeNull();
    expect(r.session.onTags).toBeNull();
    expect(r.session.onBomb).toBeNull();
    expect(r.session.onStreaks).toBeNull();
    expect(r.session.onScoreboard).toBeNull();
    expect(r.session.onProjectiles).toBeNull();
    expect(r.session.onLocalState).toBeNull();
    expect(r.session.actors.size).toBe(0);
    expect(r.session.roundBlockers().length).toBe(0);
    expect([...r.session.renderables()].length).toBe(0);
    // The socket is untouched: the next session takes the same link.
    expect(r.link.closedWith).toBeNull();
  });

  it('moves the identity with a rotation and stops answering for the old world', () => {
    const r = rig();
    r.session.start();
    r.snapshot({ owner: makePlayerSimState() });

    const w = new ByteWriter(1024);
    r.link.deliver(writeWelcome(w, { ...SEAT, entityId: 11, matchId: 8 }, null));
    r.session.update();

    expect(r.newMatches.length).toBe(1);
    expect(r.identity.is(11)).toBe(true);

    // Retired: a question about a match this world is not in has no answer here.
    r.authoritative.length = 0;
    r.hashes.length = 0;
    const h = new ByteWriter(512);
    r.link.deliver(writeStateHash(h, 700, 9, []));
    r.snapshot({ header: { snapshotId: 5 } });
    expect(r.authoritative).toEqual([]);
    expect(r.hashes).toEqual([]);
  });
});

describe('NetSession: the skirmish channels', () => {
  /** Everything the session forwards, recorded from both ends of each channel. */
  function wired(): {
    r: Rig;
    own: string[];
    through: string[];
  } {
    const own: string[] = [];
    const through: string[] = [];
    const r = rig({
      skirmish: {
        onVoteState: () => through.push('vote'),
        onObjectives: () => through.push('objectives'),
        onTags: () => through.push('tags'),
        onBomb: () => through.push('bomb'),
        onStreaks: () => through.push('streaks'),
        onScoreboard: () => through.push('scoreboard'),
        onStateHash: () => through.push('stateHash'),
        onPrepare: () => through.push('prepare'),
        onNotice: () => through.push('notice'),
      },
    });
    r.session.onObjectives = () => own.push('objectives');
    r.session.onTags = () => own.push('tags');
    r.session.onBomb = () => own.push('bomb');
    r.session.onStreaks = () => own.push('streaks');
    r.session.onScoreboard = () => own.push('scoreboard');
    r.session.start();
    return { r, own, through };
  }

  it('delivers the objective channels to the world and to the caller’s own sink', () => {
    const { r, own, through } = wired();
    const w = new ByteWriter(2048);

    r.link.deliver(writeObjectives(w, [{ owner: 1, progress: 40, capturing: 2, countA: 1, countB: 0 }]));
    r.link.deliver(writeTags(w, [{ id: 3, team: 'A', x: 1, y: 0, z: 2 }]));
    r.link.deliver(
      writeBomb(w, {
        state: 'PLANTED',
        carrierId: -1,
        attackers: 'A',
        x: 1,
        y: 0,
        z: 2,
        secondsLeft: 30,
        interactFraction: 0,
        interactEntity: -1,
        plantedSiteIndex: 0,
      }),
    );
    r.link.deliver(
      writeStreaks(w, {
        offers: [],
        balance: 2,
        nextKind: -1,
        nextPrice: 0,
        scrambled: false,
        sweepAngle: -1,
        contacts: [],
        entities: [],
      }),
    );
    r.link.deliver(writeScoreboard(w, 1, [SCORE_ROW]));
    r.session.update();

    expect(own).toEqual(['objectives', 'tags', 'bomb', 'streaks', 'scoreboard']);
    expect(through).toEqual(['objectives', 'tags', 'bomb', 'streaks', 'scoreboard']);
  });

  it('keeps the latest vote for the panel, and forwards it too', () => {
    const { r, through } = wired();
    const w = new ByteWriter(1024);
    expect(r.session.lastVote).toBeNull();

    r.link.deliver(
      writeVoteState(w, {
        phase: 2,
        phaseEndsTick: 700,
        tally: [1, 0, 3],
        selfVote: 2,
        decidedMode: -1,
        decidedMap: -1,
        humans: 4,
      }),
    );
    r.session.update();

    expect(r.session.lastVote?.phase).toBe(2);
    expect(r.session.lastVote?.selfVote).toBe(2);
    expect(r.session.lastVote?.humans).toBe(4);
    expect(through).toEqual(['vote']);
  });

  it('passes the channels it does not touch straight through', () => {
    const { r, through } = wired();
    const w = new ByteWriter(1024);
    r.link.deliver(writePrepare(w, 8, 'mp_dunes', 'TDM'));
    r.link.deliver(writeNotice(w, 'the arena was rebuilt'));
    r.session.update();
    expect(through).toEqual(['prepare', 'notice']);
  });

  it('holds and forwards a state hash in the same breath', () => {
    const { r, through } = wired();
    const w = new ByteWriter(512);
    r.link.deliver(writeStateHash(w, 640, 1234, [1]));
    r.session.update();
    // Forwarded at once; the session's own comparison waits for the state it describes.
    expect(through).toEqual(['stateHash']);
  });

  it('moves the identity on a migration and retires this world', () => {
    const migrated: WelcomeInfo[] = [];
    const r = rig({ skirmish: { onMigrated: (info) => migrated.push(info) } });
    r.session.start();
    r.snapshot({ owner: makePlayerSimState() });

    const w = new ByteWriter(1024);
    r.link.deliver(writeWelcome(w, { ...SEAT, entityId: 21, matchId: 9, migrated: true }, null));
    r.session.update();

    expect(migrated.length).toBe(1);
    expect(migrated[0]?.entityId).toBe(21);
    expect(r.identity.is(21)).toBe(true);

    r.authoritative.length = 0;
    r.snapshot({ header: { snapshotId: 4 } });
    expect(r.authoritative).toEqual([]);
  });

  it('works with no skirmish sink at all', () => {
    const r = rig();
    r.session.start();
    const seen: string[] = [];
    r.session.onTags = () => seen.push('tags');
    const w = new ByteWriter(1024);
    r.link.deliver(writeTags(w, [{ id: 1, team: 'B', x: 0, y: 0, z: 0 }]));
    expect(() => r.session.update()).not.toThrow();
    expect(seen).toEqual(['tags']);
  });
});
