import { describe, expect, it } from 'vitest';
import { CHEAT_SIMULATION } from '../cheats/Cheats';
import type { ReplicatedScoreRow } from '../combat/ScoreSystem';
import { installClock } from '../core/Clock';
import { createGameBus } from '../core/Events';
import { Btn, type InputCommand, type MutableInputCommand } from '../core/InputCommand';
import { DT } from '../core/Loop';
import type { BombInfo, TagInfo } from '../modes/GameMode';
import { NO_SKIN_INDEX } from '../meta/Skins';
import { DEFAULT_INTERPOLATION_DELAY_MS } from './Interpolation';
import { MAX_REWIND_MS } from './Protocol';
import { DEFAULT_MOVEMENT_CONFIG } from '../player/MovementConfig';
import { PlayerController } from '../player/PlayerController';
import { makePlayerSimState } from '../player/PlayerState';
import { ColliderSet } from '../world/ColliderSet';
import { CollisionWorld } from '../world/CollisionWorld';
import {
  decodeHeader,
  Ev,
  beginEvents,
  finishEvents,
  makeSnapshotHeader,
  readCommand,
  writeBye,
  writeCheats,
  writeNotice,
  writeObjectives,
  writePong,
  writePose,
  writePrepare,
  writeProjectiles,
  writeReject,
  writeScoreboard,
  writeSnapshotEntities,
  writeSnapshotHeader,
  writeSnapshotOwner,
  writeStateHash,
  writeStreaks,
  writeSummary,
  writeTags,
  writeBomb,
  writeVoteState,
  writeWelcome,
  SFlag,
  type SnapshotHeader,
  type SummaryInfo,
  type VoteInfo,
  type WelcomeInfo,
} from './Messages';
import { NetClient, type NetClientDeps, type SkirmishSink } from './NetClient';
import {
  dequantAngle,
  dequantMove,
  dequantPitch,
  quantAngle,
  quantMove,
  quantPitch,
  RECONNECT_TOKEN_BYTES,
} from './Protocol';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from './Snapshot';
import type { INetLink, LinkState } from './Transport';
import { ByteReader, ByteWriter } from './Wire';

/**
 * The client half of the protocol, driven through a fake link (A22).
 *
 * This file had no tests at all, which is the gap A22 closed before it moved a line: every
 * seam below — the seat assignment, the snapshot application, the catch-up loop and the
 * command pipeline — is state a wrong edit would corrupt silently, and the symptom would be
 * rubberbanding in a browser rather than a red test.
 *
 * Nothing here is mocked except the link and the clock. The `PlayerController` is the real
 * one over a real `CollisionWorld`, the frames are written by the real writers, and the
 * assertions are on what the public surface reports.
 */

let fakeNow = 0;
installClock({ nowMs: () => fakeNow });

class FakeLink implements INetLink {
  state: LinkState = 'open';
  readonly sent: Uint8Array[] = [];
  readonly inbox: Uint8Array[] = [];
  closedWith: string | null = null;
  lastRecvMs = 0;
  readonly remoteAddress = 'test';
  bytesIn = 0;
  bytesOut = 0;
  framesIn = 0;
  framesOut = 0;

  send(bytes: Uint8Array): void {
    // A copy, because every caller hands in a view over a reused encode buffer.
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

  /** Queue a frame as if the server had sent it. */
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
  snapshotHz: 30,
  matchId: 7,
  effectiveTick: 600,
  migrated: false,
};

interface Rig {
  readonly net: NetClient;
  readonly link: FakeLink;
  readonly sink: SkirmishSink;
  readonly seen: string[];
  readonly commands: MutableInputCommand[];
  sample(tick: number): InputCommand;
  cmd: MutableInputCommand;
  seat(info?: Partial<WelcomeInfo>, token?: Uint8Array | null): void;
  snapshot(opts?: SnapshotOpts): void;
  newMatches: WelcomeInfo[];
  migrated: WelcomeInfo[];
}

interface SnapshotOpts {
  readonly header?: Partial<SnapshotHeader>;
  readonly owner?: ReturnType<typeof makePlayerSimState> | null;
  readonly cheatMask?: number;
  readonly entities?: readonly EntitySnapshot[];
  readonly removed?: readonly number[];
}

function rig(deps: Partial<NetClientDeps> = {}): Rig {
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

  const seen: string[] = [];
  const newMatches: WelcomeInfo[] = [];
  const migrated: WelcomeInfo[] = [];
  const sink: SkirmishSink = {
    onVoteState: () => seen.push('voteState'),
    onPrepare: () => seen.push('prepare'),
    onSummary: () => seen.push('summary'),
    onNotice: () => seen.push('notice'),
    onCheats: () => seen.push('cheats'),
    onObjectives: () => seen.push('objectives'),
    onTags: () => seen.push('tags'),
    onBomb: () => seen.push('bomb'),
    onStreaks: () => seen.push('streaks'),
    onScoreboard: () => seen.push('scoreboard'),
    onProjectiles: () => seen.push('projectiles'),
    onStateHash: () => seen.push('stateHash'),
    onMigrated: (info) => migrated.push(info),
  };

  const net = new NetClient({
    link,
    controller,
    sample,
    displayName: 'ALICE',
    skirmish: sink,
    onNewMatch: (info) => newMatches.push(info),
    ...deps,
  });

  const w = new ByteWriter(4096);
  const out: Rig = {
    net,
    link,
    sink,
    seen,
    commands: [],
    sample,
    cmd,
    newMatches,
    migrated,
    seat(info = {}, token = null) {
      link.deliver(writeWelcome(w, { ...SEAT, ...info }, token));
      net.update();
    },
    snapshot(opts = {}) {
      const header = { ...makeSnapshotHeader(), snapshotId: 1, serverTick: 600, ...opts.header };
      writeSnapshotHeader(w, header);
      writeSnapshotOwner(w, opts.owner ?? null, opts.cheatMask ?? 0);
      const entities = opts.entities ?? [];
      const removed = opts.removed ?? [];
      writeSnapshotEntities(w, entities, entities.length, () => null, removed, removed.length);
      link.deliver(w.bytes());
      net.update();
    },
  };
  return out;
}

function body(entityId: number, mutate: (e: EntitySnapshot) => void = () => undefined): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.displayName = `P${entityId}`;
  mutate(e);
  return e;
}

describe('the handshake', () => {
  it('sends one Hello carrying the name, the body and the class', () => {
    const r = rig({ skinIndex: 3 });
    r.net.connect();
    expect(r.link.kinds()).toEqual(['hello']);
    const msg = decodeHeader(new ByteReader(r.link.sent[0] ?? new Uint8Array(0)));
    expect(msg.kind).toBe('hello');
    if (msg.kind !== 'hello') return;
    expect(msg.name).toBe('ALICE');
    expect(msg.skinIndex).toBe(3);
    expect(msg.loadout).toBe(null);
    expect(r.net.state).toBe('connecting');
  });

  it('defaults the body to "declared none"', () => {
    const r = rig();
    r.net.connect();
    const msg = decodeHeader(new ByteReader(r.link.sent[0] ?? new Uint8Array(0)));
    if (msg.kind !== 'hello') throw new Error('not a hello');
    expect(msg.skinIndex).toBe(NO_SKIN_INDEX);
  });

  it('asks for the rewind feed by riding the name, never the protocol', () => {
    const r = rig({ wantRewindDebug: true });
    r.net.connect();
    const msg = decodeHeader(new ByteReader(r.link.sent[0] ?? new Uint8Array(0)));
    if (msg.kind !== 'hello') throw new Error('not a hello');
    expect(msg.name).toBe('ALICE#rw');
  });

  it('refuses to connect twice over a live connection', () => {
    const r = rig();
    r.net.connect();
    r.net.connect();
    expect(r.link.sent.length).toBe(1);
  });

  it('presents the token from the last seat assignment on the next connect', () => {
    const r = rig();
    const token = new Uint8Array(RECONNECT_TOKEN_BYTES).fill(5);
    r.seat({}, token);
    r.net.disconnect('bye');
    r.link.state = 'open';
    r.net.connect();
    const hello = r.link.sent.map((b) => decodeHeader(new ByteReader(b))).find((m) => m.kind === 'hello');
    expect(hello?.kind).toBe('hello');
    if (hello?.kind !== 'hello') return;
    expect(hello.reconnectToken).toEqual(token);
  });

  it('adopt seats the client without sending a second Hello', () => {
    const r = rig();
    r.net.adopt(SEAT, 900, null);
    expect(r.link.sent.length).toBe(0);
    expect(r.net.state).toBe('joined');
    expect(r.net.entityId).toBe(4);
  });
});

describe('the seat assignment', () => {
  it('takes the whole seat off the welcome', () => {
    const r = rig();
    r.seat();
    expect(r.net.state).toBe('joined');
    expect(r.net.entityId).toBe(4);
    expect(r.net.team).toBe('B');
    expect(r.net.matchInfo()).toEqual({
      entityId: 4,
      team: 'B',
      mapId: 'mp_foundry',
      modeId: 'DOM',
      serverTick: r.net.stats.serverTick,
      serverMs: 0,
      snapshotHz: 0,
      matchId: 7,
      effectiveTick: 600,
      migrated: false,
    });
  });

  it('seeds the clock from the welcome rather than claiming a zero round trip', () => {
    const r = rig();
    r.seat();
    expect(r.net.clock.rttMs).toBe(0);
    expect(r.net.tick).toBeGreaterThan(0);
    // Seated is only half of it: `synchronised` waits for the first owner block, which is
    // what a reconnect has to wait out before it can claim to be back.
    expect(r.net.synchronised).toBe(false);
    r.snapshot({ owner: makePlayerSimState() });
    expect(r.net.synchronised).toBe(true);
  });

  it('reports a rotation through onNewMatch and a migration through onMigrated, never both', () => {
    const r = rig();
    r.seat();
    expect(r.newMatches.length).toBe(0);

    r.seat({ matchId: 8 });
    expect(r.newMatches.length).toBe(1);
    expect(r.migrated.length).toBe(0);

    r.seat({ matchId: 9, migrated: true });
    expect(r.newMatches.length).toBe(1);
    expect(r.migrated.length).toBe(1);
    expect(r.net.migrations).toBe(1);
  });

  it('clears everything keyed to the seat it is leaving', () => {
    const r = rig();
    r.seat();
    r.snapshot({ entities: [body(9)], cheatMask: CHEAT_SIMULATION });
    const board: ReplicatedScoreRow[] = [];
    const w = new ByteWriter(512);
    r.link.deliver(writeScoreboard(w, 5, board));
    r.net.update();
    expect(r.net.interpolatorFor(9)).toBeDefined();
    expect(r.net.cheatMask).not.toBe(0);

    r.seat({ matchId: 8, migrated: true });
    expect(r.net.interpolatorFor(9)).toBeUndefined();
    expect(r.net.cheatMask).toBe(0);
    expect(r.net.localSpawnSerial).toBe(-1);

    // The board's serials start over with the instance, so an old serial is accepted again.
    r.link.deliver(writeScoreboard(w, 1, board));
    r.net.update();
    expect(r.seen.filter((s) => s === 'scoreboard').length).toBe(2);
  });
});

describe('the frames that end a connection', () => {
  it('a reject names the reason and closes the link', () => {
    const r = rig();
    const w = new ByteWriter(64);
    r.link.deliver(writeReject(w, 2));
    r.net.update();
    expect(r.net.state).toBe('rejected');
    expect(r.net.closeReason).toBe('server full');
    expect(r.link.closedWith).toBe('rejected');
  });

  it('a bye carries the server’s own reason', () => {
    const r = rig();
    r.seat();
    const w = new ByteWriter(64);
    r.link.deliver(writeBye(w, true, 'idle'));
    r.net.update();
    expect(r.net.state).toBe('disconnected');
    expect(r.net.closeReason).toBe('idle');
  });

  it('a link that closed under a joined client becomes a lost connection', () => {
    const r = rig();
    r.seat();
    r.link.state = 'closed';
    r.net.update();
    expect(r.net.state).toBe('disconnected');
    expect(r.net.closeReason).toBe('connection lost');
  });

  it('disconnect says goodbye before closing', () => {
    const r = rig();
    r.seat();
    r.net.disconnect('left');
    expect(r.link.kinds()).toContain('bye');
    expect(r.link.closedWith).toBe('left');
    expect(r.net.state).toBe('disconnected');
  });

  it('ignores a frame it cannot decode', () => {
    const r = rig();
    r.seat();
    r.link.deliver(new Uint8Array([1, 2, 3, 4, 5, 6]));
    r.net.update();
    expect(r.net.state).toBe('joined');
  });
});

describe('the frames this client only passes on', () => {
  it('hands every match message to the sink exactly once', () => {
    const r = rig();
    r.seat();
    const w = new ByteWriter(2048);
    const vote: VoteInfo = {
      phase: 1,
      phaseEndsTick: 10,
      tally: [1],
      selfVote: -1,
      decidedMode: -1,
      decidedMap: -1,
      humans: 1,
    };
    const summary: SummaryInfo = {
      matchId: 7,
      mapId: 'mp_foundry',
      modeId: 'DOM',
      winner: 'A',
      reason: 'score',
      scoreA: 1,
      scoreB: 0,
      endsTick: 100,
      rows: [],
      xp: [],
    };
    const bomb: BombInfo = {
      state: 'CARRIED',
      carrierId: -1,
      attackers: 'A',
      x: 0,
      y: 0,
      z: 0,
      secondsLeft: 0,
      interactFraction: 0,
      interactEntity: -1,
      plantedSiteIndex: -1,
    };
    const tags: TagInfo[] = [{ id: 1, team: 'A', x: 0, y: 0, z: 0 }];

    r.link.deliver(writeVoteState(w, vote));
    r.link.deliver(writePrepare(w, 8, 'mp_dunes', 'TDM'));
    r.link.deliver(writeSummary(w, summary));
    r.link.deliver(writeNotice(w, 'hello'));
    r.link.deliver(writeObjectives(w, [{ owner: 1, capturing: 0, progress: 0, countA: 0, countB: 0 }]));
    r.link.deliver(writeTags(w, tags));
    r.link.deliver(writeBomb(w, bomb));
    r.link.deliver(
      writeStreaks(w, {
        offers: [],
        balance: 0,
        nextKind: -1,
        nextPrice: 0,
        scrambled: false,
        sweepAngle: -1,
        contacts: [],
        entities: [],
      }),
    );
    r.link.deliver(writeProjectiles(w, [], []));
    r.link.deliver(writeStateHash(w, 1, 2, [1, 2, 3, 4]));
    r.net.update();

    expect(r.seen).toEqual([
      'voteState',
      'prepare',
      'summary',
      'notice',
      'objectives',
      'tags',
      'bomb',
      'streaks',
      'projectiles',
      'stateHash',
    ]);
  });

  it('refuses a scoreboard older than the one it holds', () => {
    const r = rig();
    r.seat();
    const w = new ByteWriter(512);
    r.link.deliver(writeScoreboard(w, 5, []));
    r.net.update();
    r.link.deliver(writeScoreboard(w, 4, []));
    r.net.update();
    expect(r.seen.filter((s) => s === 'scoreboard').length).toBe(1);
    r.link.deliver(writeScoreboard(w, 6, []));
    r.net.update();
    expect(r.seen.filter((s) => s === 'scoreboard').length).toBe(2);
  });

  it('applies the cheat mask from its own frame, through the simulation filter', () => {
    const r = rig();
    r.seat();
    const w = new ByteWriter(64);
    r.link.deliver(writeCheats(w, 1, 0xff));
    r.net.update();
    expect(r.net.cheatMask).toBe(0xff & CHEAT_SIMULATION);
    expect(r.seen).toContain('cheats');
  });

  it('streams the event list into the sink it was given', () => {
    const jumps: number[] = [];
    const r = rig({ events: { onJump: (e) => jumps.push(e.entityId) } });
    r.seat();
    const w = new ByteWriter(128);
    beginEvents(w);
    writePose(w, Ev.Jump, { entityId: 9, x: 0, y: 0, z: 0, speed: 0, material: 0 });
    r.link.deliver(finishEvents(w, 1));
    r.net.update();
    expect(jumps).toEqual([9]);
  });
});

describe('the snapshot', () => {
  it('takes the header, latches the match being over, and counts the frame', () => {
    const r = rig();
    r.seat();
    r.snapshot({ header: { scoreA: 12, scoreB: 7, timeLeft: 45, phase: 1, flags: SFlag.MatchOver } });
    expect(r.net.header.scoreA).toBe(12);
    expect(r.net.header.scoreB).toBe(7);
    expect(r.net.header.timeLeft).toBe(45);
    expect(r.net.header.phase).toBe(1);
    expect(r.net.sawMatchOver).toBe(true);
    expect(r.net.stats.snapshotsReceived).toBe(1);
    expect(r.net.stats.lastSnapshotBytes).toBeGreaterThan(0);
  });

  it('infers downstream loss from the gap in the ids', () => {
    const r = rig();
    r.seat();
    r.snapshot({ header: { snapshotId: 10 } });
    r.snapshot({ header: { snapshotId: 14 } });
    expect(r.net.stats.snapshotsLost).toBe(3);
    r.snapshot({ header: { snapshotId: 15 } });
    expect(r.net.stats.snapshotsLost).toBe(3);
  });

  it('gives every remote body its own interpolation buffer, on the tick-derived axis', () => {
    const r = rig();
    r.seat();
    r.snapshot({ entities: [body(9), body(11)] });
    const nine = r.net.interpolatorFor(9);
    expect(nine).toBeDefined();
    expect(r.net.interpolatorFor(11)).toBeDefined();
    expect(nine?.sampleCount).toBe(1);
    expect(r.net.renderTimeMs(100)).toBeCloseTo(600 * DT * 1000 - 100, 6);
  });

  it('drops a removed body’s buffer rather than letting it age out', () => {
    const r = rig();
    r.seat();
    r.snapshot({ entities: [body(9)] });
    expect(r.net.interpolatorFor(9)).toBeDefined();
    r.snapshot({ header: { snapshotId: 2 }, removed: [9] });
    expect(r.net.interpolatorFor(9)).toBeUndefined();
  });

  it('reads its own body for the spawn serial and whether it is alive', () => {
    const r = rig();
    r.seat();
    r.snapshot({
      entities: [
        body(4, (e) => {
          e.spawnSerial = 3;
          e.flags = EFlag.Alive;
        }),
      ],
    });
    expect(r.net.localSpawnSerial).toBe(3);
    expect(r.net.localAlive).toBe(true);

    r.snapshot({
      header: { snapshotId: 2 },
      entities: [
        body(4, (e) => {
          e.spawnSerial = 3;
          e.flags = 0;
        }),
      ],
    });
    expect(r.net.localAlive).toBe(false);
  });

  it('adopts the first authoritative pose instead of calling the join a misprediction', () => {
    const r = rig();
    r.seat();
    const owner = makePlayerSimState();
    owner.x = 12.5;
    owner.z = -3.25;
    r.snapshot({ owner, entities: [body(4)] });
    expect(r.net.prediction.stats.mispredictions).toBe(0);
    expect(r.net.prediction.stats.comparisons).toBe(0);
  });

  it('adopts after a respawn too, and reconciles once the serial stops moving', () => {
    const r = rig();
    r.seat();
    const owner = makePlayerSimState();
    r.snapshot({ owner, entities: [body(4, (e) => (e.spawnSerial = 1))] });
    expect(r.net.prediction.stats.comparisons).toBe(0);

    // A new serial: the server put this player somewhere of its own choosing.
    r.snapshot({
      header: { snapshotId: 2 },
      owner,
      entities: [body(4, (e) => (e.spawnSerial = 2))],
    });
    expect(r.net.prediction.stats.comparisons).toBe(0);

    // Same serial: ordinary reconciliation, which is allowed to compare.
    r.snapshot({
      header: { snapshotId: 3, ackSeq: 1 },
      owner,
      entities: [body(4, (e) => (e.spawnSerial = 2))],
    });
    expect(r.net.prediction.stats.comparisons).toBeGreaterThan(0);
  });

  it('applies the cheat mask from the snapshot whether or not an owner block rode with it', () => {
    const r = rig();
    r.seat();
    r.snapshot({ owner: null, cheatMask: 0xff });
    expect(r.net.cheatMask).toBe(0xff & CHEAT_SIMULATION);
    r.snapshot({ header: { snapshotId: 2 }, owner: makePlayerSimState(), cheatMask: 0 });
    expect(r.net.cheatMask).toBe(0);
  });

  it('stops reading a truncated snapshot without throwing', () => {
    const r = rig();
    r.seat();
    const w = new ByteWriter(512);
    writeSnapshotHeader(w, { ...makeSnapshotHeader(), snapshotId: 4 });
    writeSnapshotOwner(w, null, 0);
    const full = w.bytes();
    r.link.deliver(full.slice(0, full.length - 1));
    expect(() => r.net.update()).not.toThrow();
    expect(r.net.state).toBe('joined');
  });
});

describe('the tick loop', () => {
  it('steps to the tick the clock derives, never past the frame cap', () => {
    const r = rig();
    r.seat();
    const before = r.net.tick;
    fakeNow += 10 * DT * 1000;
    const steps = r.net.update();
    expect(steps).toBe(5);
    expect(r.net.tick).toBe(before + 5);
  });

  it('runs no steps at all when the clock has not moved', () => {
    const r = rig();
    r.seat();
    expect(r.net.update()).toBe(0);
  });

  it('resynchronises instead of grinding through a backlog it cannot pay', () => {
    const r = rig();
    r.seat();
    fakeNow += 40 * DT * 1000;
    const steps = r.net.update();
    expect(steps).toBe(0);
    expect(r.net.stats.resyncs).toBe(1);
    expect(r.net.tick).toBe(r.net.clock.targetTick());
  });

  it('counts a frame that owed more than the cap as a catch-up', () => {
    const r = rig();
    r.seat();
    fakeNow += 8 * DT * 1000;
    r.net.update();
    expect(r.net.stats.catchUps).toBe(1);
    expect(r.net.stats.resyncs).toBe(0);
  });

  it('sends one command batch per frame that stepped, and none for a frame that did not', () => {
    const r = rig();
    r.seat();
    fakeNow += 2 * DT * 1000;
    r.net.update();
    expect(r.link.kinds().filter((k) => k === 'commands').length).toBe(1);
    r.net.update();
    expect(r.link.kinds().filter((k) => k === 'commands').length).toBe(1);
  });

  it('fills the redundant batch with the newest commands, oldest first', () => {
    const r = rig();
    r.seat();
    fakeNow += 3 * DT * 1000;
    r.net.update();
    const frame = r.link.sent.filter((b) => decodeHeader(new ByteReader(b)).kind === 'commands').pop();
    expect(frame).toBeDefined();
    const reader = new ByteReader(frame ?? new Uint8Array(0));
    const msg = decodeHeader(reader);
    expect(msg.kind).toBe('commands');
    if (msg.kind !== 'commands') return;
    const seqs: number[] = [];
    const out: MutableInputCommand = {
      seq: 0,
      tickIndex: 0,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: 0,
    };
    for (let i = 0; i < msg.count; i++) {
      readCommand(reader, out);
      seqs.push(out.seq);
    }
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs[seqs.length - 1]).toBe(3);
  });

  it('acks the newest snapshot it has applied', () => {
    const r = rig();
    r.seat();
    r.snapshot({ header: { snapshotId: 77 } });
    fakeNow += DT * 1000;
    r.net.update();
    const frame = r.link.sent.filter((b) => decodeHeader(new ByteReader(b)).kind === 'commands').pop();
    const msg = decodeHeader(new ByteReader(frame ?? new Uint8Array(0)));
    if (msg.kind !== 'commands') throw new Error('no batch');
    expect(msg.snapshotAck).toBe(77);
  });
});

describe('the command pipeline', () => {
  function lastCommand(r: Rig): MutableInputCommand {
    const frame = r.link.sent.filter((b) => decodeHeader(new ByteReader(b)).kind === 'commands').pop();
    const reader = new ByteReader(frame ?? new Uint8Array(0));
    const msg = decodeHeader(reader);
    if (msg.kind !== 'commands') throw new Error('no batch');
    const out: MutableInputCommand = {
      seq: 0,
      tickIndex: 0,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: 0,
    };
    for (let i = 0; i < msg.count; i++) readCommand(reader, out);
    return out;
  }

  it('predicts with exactly what the wire will carry', () => {
    const r = rig();
    r.seat();
    r.cmd.moveX = 0.37;
    r.cmd.yaw = 1.2345;
    r.cmd.pitch = -0.4321;
    fakeNow += DT * 1000;
    r.net.update();
    const sent = lastCommand(r);
    expect(sent.moveX).toBe(dequantMove(quantMove(0.37)));
    expect(sent.yaw).toBe(dequantAngle(quantAngle(1.2345)));
    expect(sent.pitch).toBe(dequantPitch(quantPitch(-0.4321)));
  });

  it('strips movement and actions while input is frozen, and keeps the view', () => {
    const r = rig();
    r.seat();
    r.snapshot({ header: { flags: SFlag.InputFrozen } });
    r.cmd.moveX = 1;
    r.cmd.moveZ = -1;
    r.cmd.yaw = 0.5;
    r.cmd.pitch = 0.25;
    r.cmd.buttons = Btn.Fire | Btn.Jump | Btn.Scoreboard;
    fakeNow += DT * 1000;
    r.net.update();
    const sent = lastCommand(r);
    expect(sent.moveX).toBe(0);
    expect(sent.moveZ).toBe(0);
    expect(sent.yaw).toBe(dequantAngle(quantAngle(0.5)));
    expect(sent.pitch).toBe(dequantPitch(quantPitch(0.25)));
    // B6: the scoreboard bit survives, because the death screen is when you want the board.
    expect(sent.buttons).toBe(Btn.Scoreboard);
  });

  it('does the same for a dead player, and resumes when it is alive again', () => {
    const r = rig();
    r.seat();
    r.snapshot({ entities: [body(4, (e) => (e.flags = 0))] });
    r.cmd.moveX = 1;
    r.cmd.buttons = Btn.Fire;
    fakeNow += DT * 1000;
    r.net.update();
    expect(lastCommand(r).moveX).toBe(0);
    expect(lastCommand(r).buttons).toBe(0);

    r.snapshot({ header: { snapshotId: 2 }, entities: [body(4, (e) => (e.flags = EFlag.Alive))] });
    r.cmd.moveX = 1;
    r.cmd.buttons = Btn.Fire;
    fakeNow += 2 * DT * 1000;
    expect(r.net.update()).toBeGreaterThan(0);
    expect(lastCommand(r).moveX).toBe(dequantMove(quantMove(1)));
    expect(lastCommand(r).buttons).toBe(Btn.Fire);
  });

  it('asks the caller what the weapon does to the speed, once per step', () => {
    const scales: number[] = [];
    const r = rig({
      moveScale: () => {
        scales.push(1.07);
        return 1.07;
      },
    });
    r.seat();
    fakeNow += 2 * DT * 1000;
    r.net.update();
    expect(scales.length).toBe(2);
  });

  it('hands every command to applyNonReplayed as well, suppressed or not', () => {
    const seen: number[] = [];
    const r = rig({ applyNonReplayed: (cmd) => seen.push(cmd.tickIndex) });
    r.seat();
    fakeNow += 2 * DT * 1000;
    r.net.update();
    expect(seen.length).toBe(2);
  });
});

/**
 * Where this client draws everybody else (2026-10-18).
 *
 * The render time used to be the server's clock minus the interpolation delay alone, which
 * put it ahead of the newest sample the buffer actually held as soon as half a round trip
 * plus a snapshot interval passed the delay — about 100 ms of RTT. Past that the
 * interpolator extrapolated every frame and cut back each time a real sample landed, which
 * is what was reported as other players jumping. The rule now is the one the server has
 * always rewound by.
 */
describe('the render time', () => {
  it('draws the world half a round trip further back than the delay alone', () => {
    const r = rig();
    r.seat();

    r.net.clock.rttMs = 0;
    const atZero = r.net.renderTimeMs(DEFAULT_INTERPOLATION_DELAY_MS);
    r.net.clock.rttMs = 120;
    const atLag = r.net.renderTimeMs(DEFAULT_INTERPOLATION_DELAY_MS);

    // Exactly RTT/2 further into the past, which is the transit the samples spent in flight.
    expect(atZero - atLag).toBeCloseTo(60, 6);
  });

  it('is the sum the server rewinds by, and stops where the server stops', () => {
    const r = rig();
    r.seat();

    r.net.clock.rttMs = 0;
    expect(r.net.viewLagMs(100)).toBe(100);

    r.net.clock.rttMs = 120;
    expect(r.net.viewLagMs(100)).toBe(160);

    // Past the ceiling the server clamps its own rewind to. Agreeing on a clamped number
    // beats disagreeing on an exact one.
    r.net.clock.rttMs = 400;
    expect(r.net.viewLagMs(100)).toBe(MAX_REWIND_MS);
  });

  it('leaves a client with no measured round trip exactly where it was', () => {
    const r = rig();
    r.seat();
    r.net.clock.rttMs = 0;
    const expected = r.net.clock.serverTickFractional() * DT * 1000 - DEFAULT_INTERPOLATION_DELAY_MS;
    expect(r.net.renderTimeMs(DEFAULT_INTERPOLATION_DELAY_MS)).toBeCloseTo(expected, 6);
  });
});

describe('the clock exchange and the rate window', () => {
  it('pings at most once an interval, and a pong feeds the clock', () => {
    const r = rig();
    r.seat();
    r.net.update();
    const pings = r.link.kinds().filter((k) => k === 'ping').length;
    r.net.update();
    expect(r.link.kinds().filter((k) => k === 'ping').length).toBe(pings);

    fakeNow += 300;
    r.net.update();
    expect(r.link.kinds().filter((k) => k === 'ping').length).toBe(pings + 1);

    const sent = r.link.sent.filter((b) => decodeHeader(new ByteReader(b)).kind === 'ping').pop();
    const msg = decodeHeader(new ByteReader(sent ?? new Uint8Array(0)));
    if (msg.kind !== 'ping') throw new Error('no ping');
    fakeNow += 40;
    const w = new ByteWriter(64);
    r.link.deliver(writePong(w, msg.id, msg.clientMs, 20_100, 603));
    r.net.update();
    expect(r.net.stats.rttMs).toBeGreaterThan(0);
  });

  it('reports the per-second window once a second of it has passed', () => {
    const r = rig();
    r.seat();
    r.snapshot();
    fakeNow += 1001;
    r.net.update();
    expect(r.net.stats.snapshotsPerSecond).toBeGreaterThan(0);
    expect(r.net.stats.bytesInPerSecond).toBeGreaterThan(0);
    expect(r.net.stats.meanSnapshotBytes).toBeGreaterThan(0);
  });

  it('keeps the lead and the tick in the stats it publishes', () => {
    const r = rig();
    r.seat();
    fakeNow += 2 * DT * 1000;
    r.net.update();
    expect(r.net.stats.clientTick).toBe(r.net.tick);
    expect(r.net.stats.serverTick).toBeGreaterThan(0);
    expect(r.net.stats.leadTicks).toBe(r.net.tick - r.net.stats.serverTick);
  });
});

describe('replay', () => {
  it('applies frames the handshake drained before this client existed', () => {
    const r = rig();
    const w = new ByteWriter(512);
    const welcome = writeWelcome(w, SEAT, null).slice();
    r.net.replay([welcome]);
    expect(r.net.state).toBe('joined');
    expect(r.net.entityId).toBe(4);
  });
});
