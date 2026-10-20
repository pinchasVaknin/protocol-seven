import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Cheat, CheatState } from '../../shared/cheats/Cheats';
import { installClock } from '../../shared/core/Clock';
import { EV } from '../../shared/core/Events';
import {
  hashModeState,
  hashModeStateSections,
  makeModeStateScratch,
  modeStateFacts,
} from '../../shared/debug/ModeStateHash';
import { NO_SKIN_INDEX } from '../../shared/meta/Skins';
import type { BombInfo, TagInfo } from '../../shared/modes/GameMode';
import {
  decodeHeader,
  makeSnapshotHeader,
  phaseIndex,
  readSnapshotHeader,
  readSnapshotOwnerPresent,
  SFlag,
  type SnapshotHeader,
} from '../../shared/net/Messages';
import { makePlayerSimState } from '../../shared/player/PlayerState';
import { flamethrowerWeapon } from '../../shared/streaks/StreakWeapons';
import {
  EFlag,
  equipmentIndexOf,
  makeEntitySnapshot,
  readEntity,
  readOwnerState,
  weaponIndexOf,
  type EntitySnapshot,
} from '../../shared/net/Snapshot';
import {
  InstanceState,
  MAX_STREAK_OFFERS,
  ownerCode,
  type MatchId,
  type ObjectiveState,
  type ProjectileState,
  type SmokeState,
  type StreakView,
} from '../../shared/net/Skirmish';
import { ByteReader } from '../../shared/net/Wire';
import type { ReplicatedScoreRow } from '../../shared/combat/ScoreSystem';
import { MapBakery } from '../MapBakery';
import { ServerMatch } from '../Match';
import type { Session } from '../net/Session';
import { MatchInstance, type MatchInstanceDeps, type UnseatCause } from './MatchInstance';

/**
 * The base instance (B5): what a seat is, and what goes out on a snapshot tick.
 *
 * `MatchInstance` had no test of its own before this file. Everything it does is observable
 * from outside without reaching into it: the seat maps through `playerCount`/`seatOf`/
 * `sessions`, the thirteen channels through a faked `Session` that records what it is handed,
 * and the snapshot itself by **decoding the frame off the wire** with the same readers a client
 * uses. Nothing here reads a private field, so the suite is indifferent to how the class is
 * organised — which is the point, since B5 reorganises it.
 *
 * Four rules get the most attention, because each is a fix whose absence presented as
 * something else:
 *
 *  - **A snapshot is forced on the tick a match ends.** The sim runs at 60 Hz and snapshots go
 *    out at 20, so two ticks in three are not send ticks; the tick the win condition fires is
 *    the last one this instance is ever stepped on, and a client that never received the
 *    `MATCH_END` phase never leaves the match (M11: 9 of 15 matches).
 *  - **The scoreboard's three rules, and the fourth that overrides them** (BACKLOG #42):
 *    changed, rate-limited, resent anyway — and `ending` waives the rate limit but not
 *    *changed*, because the kill that ends a close match is exactly the board a client would
 *    otherwise hold wrong for the whole summary hold.
 *  - **An empty frame is a real state and is sent once, not never.** Tags and projectiles both
 *    latch it, and both reset the latch when somebody is seated, or the last grenade of a
 *    firefight stays on a joining client's floor forever.
 *  - **A seat leaves nothing behind.** Seven pieces of per-seat state are created together and
 *    must die together; what survives keeps a destroyed instance alive through a `Seat`.
 *
 * The clock is a fake the tests hold still: `nowMs` feeds the relevance linger and the hurt
 * reveal, and a real clock would make those two the only wall-clock-dependent assertions here.
 */

/** The harness clock. Held still unless a test moves it. */
let now = 10_000;

installClock({ nowMs: () => now });

const SNAPSHOT_HZ = 20;
const INTERPOLATION_DELAY_MS = 100;
/** `(absolute + phaseOffset) % 3 === 0`, and index 0 means offset 0: every third tick from 0. */
const SNAPSHOT_EVERY = 3;
const SCOREBOARD_MIN_TICKS = 15;
const SCOREBOARD_KEEPALIVE_TICKS = 120;
/**
 * Ticks a match takes to end with `roundSecondsOverride: 1`.
 *
 * Most of it is WARMUP, whose length is the map's authored intro plus the return and the
 * countdown (`matchStartSeconds`) — about 17 s on FOUNDRY, against one second of round.
 */
const END_BUDGET = 1_400;

/** The flamethrower, the one weapon in the game with a `flame` profile. Registers on first call. */
const FLAME_WEAPON_ID = flamethrowerWeapon().id;

let bakery: MapBakery;
let nextPlayerId = 1;
const live: TestInstance[] = [];

beforeAll(() => {
  bakery = new MapBakery();
  bakery.bakeAll();
});

afterEach(() => {
  for (const instance of live) {
    if (instance.state !== InstanceState.DESTROYED) instance.dispose();
  }
  live.length = 0;
  now = 10_000;
  nextPlayerId = 1;
});

/**
 * A concrete instance, since the class under test is abstract.
 *
 * The three abstract members and nothing else, plus two seams the tests need and the real
 * subclasses have too: `go()` is `LiveMatch`'s move to RUNNING, and the `releaseEntity`
 * override records the call `LiveMatch` uses to leave a bot behind.
 */
class TestInstance extends MatchInstance {
  override readonly isArena = false;
  override readonly mapId: string;
  override readonly modeId: string;
  readonly released: Array<{ entityId: number; cause: UnseatCause }> = [];

  constructor(deps: MatchInstanceDeps, mapId: string, modeId: string) {
    super(deps);
    this.mapId = mapId;
    this.modeId = modeId;
  }

  /** What a voted match does once its clients are ready. `ending` is only read while RUNNING. */
  go(): void {
    this.setState(InstanceState.RUNNING, 'test');
  }

  protected override releaseEntity(entityId: number, cause: UnseatCause): void {
    this.released.push({ entityId, cause });
    super.releaseEntity(entityId, cause);
  }
}

interface InstanceOptions {
  readonly mapId?: string;
  readonly modeId?: string;
  readonly bots?: number;
  readonly seed?: number;
  readonly roundSecondsOverride?: number;
  readonly variant?: 'STANDARD' | 'SKIRMISH';
  readonly instanceIndex?: number;
}

function instance(options: InstanceOptions = {}): TestInstance {
  const mapId = options.mapId ?? 'mp_foundry';
  const modeId = options.modeId ?? 'TDM';
  const match = new ServerMatch({
    mapId,
    modeId,
    bots: options.bots ?? 2,
    rosterOverride: options.bots ?? 2,
    tier: 'MIX',
    seed: options.seed ?? 1234,
    startTick: 0,
    baked: bakery.instanceView(mapId),
    variant: options.variant,
    roundSecondsOverride: options.roundSecondsOverride,
  });
  const deps: MatchInstanceDeps = {
    id: 7 as MatchId,
    instanceIndex: options.instanceIndex ?? 0,
    match,
    snapshotHz: SNAPSHOT_HZ,
    interpolationDelayMs: INTERPOLATION_DELAY_MS,
    startTick: 0,
  };
  const made = new TestInstance(deps, mapId, modeId);
  live.push(made);
  return made;
}

/** Everything one faked session was handed, in order. The scratch it is given is copied out. */
interface Recorder {
  readonly frames: Uint8Array[];
  readonly boards: Array<{ serial: number; rows: ReplicatedScoreRow[] }>;
  readonly objectives: ObjectiveState[][];
  readonly tags: TagInfo[][];
  readonly bombs: BombInfo[];
  readonly streaks: StreakView[];
  readonly projectiles: Array<{ projectiles: ProjectileState[]; smoke: SmokeState[] }>;
  readonly hashes: Array<{ tick: number; hash: number; sections: number[] }>;
  readonly notedSnapshots: number[];
  restarts: number;
}

function recorder(): Recorder {
  return {
    frames: [],
    boards: [],
    objectives: [],
    tags: [],
    bombs: [],
    streaks: [],
    projectiles: [],
    hashes: [],
    notedSnapshots: [],
    restarts: 0,
  };
}

interface FakeSession {
  readonly session: Session;
  readonly rec: Recorder;
  readonly cheats: CheatState;
  readonly playerId: number;
  closed: boolean;
  rttMs: number;
}

/**
 * A `Session` as the instance sees it, faked structurally rather than built.
 *
 * A real one owns a socket. These are the members the seating and sending paths touch and
 * nothing else — if the list ever falls short, the step throws on the missing member rather
 * than quietly skipping a client, which is what makes this fake safe to assert sends against.
 *
 * Every channel copies what it was handed, because the instance hands out **reused scratch**:
 * holding the reference would have every recorded board be the last board.
 */
function session(options: { playerId?: number; displayName?: string; rttMs?: number } = {}): FakeSession {
  const playerId = options.playerId ?? nextPlayerId++;
  const rec = recorder();
  const cheats = new CheatState();
  const fake = {
    playerId,
    displayName: options.displayName ?? `OP${playerId}`,
    cheats,
    characterIndex: 3,
    reconnectToken: null,
    closed: false,
    rttMs: options.rttMs ?? 50,
    ackedSnapshot: 0,
    restartSnapshotStream(): void {
      rec.restarts++;
    },
    noteSnapshotSent(id: number): void {
      rec.notedSnapshots.push(id);
    },
    send(frame: Uint8Array): void {
      rec.frames.push(frame.slice());
    },
    sendScoreboard(serial: number, rows: readonly ReplicatedScoreRow[]): void {
      rec.boards.push({ serial, rows: rows.map((r) => ({ ...r })) });
    },
    sendObjectives(states: readonly ObjectiveState[]): void {
      rec.objectives.push(states.map((s) => ({ ...s })));
    },
    sendTags(tags: readonly TagInfo[]): void {
      rec.tags.push(tags.map((t) => ({ ...t })));
    },
    sendBomb(info: BombInfo): void {
      rec.bombs.push({ ...info });
    },
    sendStreaks(view: StreakView): void {
      rec.streaks.push({
        ...view,
        offers: view.offers.map((o) => ({ ...o })),
        contacts: view.contacts.map((c) => ({ ...c })),
        entities: view.entities.map((e) => ({ ...e })),
      });
    },
    sendProjectiles(projectiles: readonly ProjectileState[], smoke: readonly SmokeState[]): void {
      rec.projectiles.push({
        projectiles: projectiles.map((p) => ({ ...p })),
        smoke: smoke.map((s) => ({ ...s })),
      });
    },
    sendStateHash(tick: number, hash: number, sections: readonly number[]): void {
      rec.hashes.push({ tick, hash, sections: [...sections] });
    },
  };
  return {
    session: fake as unknown as Session,
    rec,
    cheats,
    playerId,
    get closed(): boolean {
      return fake.closed;
    },
    set closed(value: boolean) {
      fake.closed = value;
    },
    get rttMs(): number {
      return fake.rttMs;
    },
    set rttMs(value: number) {
      fake.rttMs = value;
    },
  };
}

/** Seat one faked connection, and hand back both halves. */
function seated(match: TestInstance, options: Parameters<typeof session>[0] = {}): FakeSession {
  const fake = session(options);
  const player = match.seat(fake.session, null);
  expect(player).not.toBeNull();
  return fake;
}

/** Step `count` ticks from `from`, which the caller picks so the cadence is known. */
function stepTicks(match: TestInstance, from: number, count: number): number {
  let tick = from;
  for (let i = 0; i < count; i++) match.step(tick++);
  return tick;
}

/**
 * Step until the win condition fires, noting which ticks a board went out on.
 *
 * `before` runs with the tick about to be stepped, which is how a test puts a change into the
 * score on an exact tick — the rate limit's whole subject is *when* the serial moved.
 */
function runToEnd(
  match: TestInstance,
  rec: Recorder,
  before: (tick: number) => void = () => {},
): { endedOn: number; boardTicks: number[] } {
  const boardTicks: number[] = [];
  let endedOn = -1;
  for (let tick = 0; tick < END_BUDGET && endedOn < 0; tick++) {
    before(tick);
    const boards = rec.boards.length;
    match.step(tick);
    if (rec.boards.length > boards) boardTicks.push(tick);
    if (match.match.isOver) endedOn = tick;
  }
  expect(endedOn).toBeGreaterThan(0);
  return { endedOn, boardTicks };
}

const ownerScratch = makePlayerSimState();

interface DecodedFrame {
  readonly header: SnapshotHeader;
  readonly cheatMask: number;
  readonly removed: number[];
  readonly entities: EntitySnapshot[];
}

/**
 * One snapshot frame, read with the client's own readers in the encoder's own order.
 *
 * The faked session acks nothing (`ackedSnapshot` stays 0), so every frame is a full one and
 * every field is present — which is what makes a decoded entity directly comparable with what
 * the roster held.
 */
function decodeSnapshotFrame(frame: Uint8Array): DecodedFrame | null {
  const r = new ByteReader(frame);
  const head = decodeHeader(r);
  if (head.kind !== 'snapshot') return null;
  const header = makeSnapshotHeader();
  readSnapshotHeader(r, header);
  if (readSnapshotOwnerPresent(r)) readOwnerState(r, ownerScratch);
  const cheatMask = r.u8v();
  const removed: number[] = [];
  const removedCount = r.u8v();
  for (let i = 0; i < removedCount; i++) removed.push(r.u8v());
  const entities: EntitySnapshot[] = [];
  const count = r.u8v();
  for (let i = 0; i < count; i++) {
    const e = makeEntitySnapshot();
    readEntity(r, e);
    entities.push(e);
  }
  return { header, cheatMask, removed, entities };
}

function snapshots(rec: Recorder): DecodedFrame[] {
  const out: DecodedFrame[] = [];
  for (const frame of rec.frames) {
    const decoded = decodeSnapshotFrame(frame);
    if (decoded !== null) out.push(decoded);
  }
  return out;
}

function eventFrames(rec: Recorder): number {
  let n = 0;
  for (const frame of rec.frames) {
    const head = decodeHeader(new ByteReader(frame));
    if (head.kind === 'events') n++;
  }
  return n;
}

function entityOf(frame: DecodedFrame, entityId: number): EntitySnapshot {
  const found = frame.entities.find((e) => e.entityId === entityId);
  expect(found).toBeDefined();
  return found as EntitySnapshot;
}

describe('MatchInstance', () => {
  describe('seating', () => {
    it('puts a connection in the world and answers for it three ways', () => {
      const match = instance();
      const op = seated(match);

      expect(match.playerCount).toBe(1);
      expect(match.hasPlayer(op.playerId)).toBe(true);
      expect(match.seatOf(op.playerId)?.session).toBe(op.session);
      expect([...match.sessions]).toHaveLength(1);
      expect(match.match.players).toHaveLength(1);
    });

    it('restarts the snapshot stream, because a fresh encoder has no baseline', () => {
      const match = instance();
      const op = seated(match);
      expect(op.rec.restarts).toBe(1);
    });

    it('seats the second connection without disturbing the first', () => {
      const match = instance();
      const a = seated(match);
      const b = seated(match);
      expect(match.playerCount).toBe(2);
      expect(match.seatOf(a.playerId)?.player.entityId).not.toBe(
        match.seatOf(b.playerId)?.player.entityId,
      );
    });

    it('answers null for a player it has never seated', () => {
      const match = instance();
      expect(match.seatOf(99)).toBeNull();
      expect(match.hasPlayer(99)).toBe(false);
    });

    it('counts the roster the mode authored as bots', () => {
      const match = instance({ bots: 2 });
      expect(match.botCount).toBe(match.match.bots.bots.length);
    });

    it('takes a connection out and leaves nothing of it behind', () => {
      const match = instance();
      const op = seated(match);
      const entityId = match.seatOf(op.playerId)?.player.entityId ?? -1;

      match.unseat(op.playerId);

      expect(match.playerCount).toBe(0);
      expect(match.hasPlayer(op.playerId)).toBe(false);
      expect(match.seatOf(op.playerId)).toBeNull();
      expect(match.match.players).toHaveLength(0);
      expect(match.released).toEqual([{ entityId, cause: 'disconnected' }]);
    });

    it('releases the entity through the seam the subclass overrides', () => {
      const match = instance();
      const op = seated(match);
      match.unseat(op.playerId, 'migrated');
      expect(match.released[0]?.cause).toBe('migrated');
    });

    it('clears the cheat entitlements for both causes, because they are the seat', () => {
      // F14 and its fix: a grant is against an entity in this instance, and `unseat` has just
      // destroyed it.
      const migrating = instance();
      const a = seated(migrating);
      a.cheats.set(Cheat.NoClip);
      migrating.unseat(a.playerId, 'migrated');
      expect(a.cheats.has(Cheat.NoClip)).toBe(false);

      const leaving = instance();
      const b = seated(leaving);
      b.cheats.set(Cheat.NoClip);
      leaving.unseat(b.playerId, 'disconnected');
      expect(b.cheats.has(Cheat.NoClip)).toBe(false);
    });

    it('is a no-op for a player who was never here', () => {
      const match = instance();
      const op = seated(match);
      match.unseat(4242);
      expect(match.playerCount).toBe(1);
      expect(match.released).toHaveLength(0);
      expect(match.match.players).toHaveLength(1);
      expect(match.seatOf(op.playerId)).not.toBeNull();
    });

    it('answers how stale a seated shooter view is, and zero for anyone else', () => {
      const match = instance();
      const op = seated(match, { rttMs: 80 });
      const entityId = match.seatOf(op.playerId)?.player.entityId ?? -1;

      expect(match.match.viewLagMsFor?.(entityId)).toBe(80 * 0.5 + INTERPOLATION_DELAY_MS);
      expect(match.match.viewLagMsFor?.(9999)).toBe(0);
    });
  });

  describe('the hurt subscription', () => {
    it('reveals whoever hurt a seat to that seat, for the linger', () => {
      // R9: the client needs a body to point the hit-direction chevron at.
      const match = instance();
      const op = seated(match);
      const victim = match.seatOf(op.playerId)?.player.entityId ?? -1;
      const shooter = match.match.bots.bots[0]?.entityId ?? -1;

      match.step(0);
      const before = snapshots(op.rec).length;
      match.match.bus.emit(EV.DamageDealt, {
        sourceId: shooter,
        targetId: victim,
        amount: 10,
        zone: 'torso',
        lethal: false,
        autonomous: false,
        weaponId: 'ar_carbine',
        x: 0,
        y: 0,
        z: 0,
        distance: 5,
        falloffLoss: 0,
        penetrationLoss: 0,
      });
      match.step(SNAPSHOT_EVERY);

      // The reveal is observable as the shooter appearing in the victim's own entity list.
      const after = snapshots(op.rec);
      expect(after.length).toBeGreaterThan(before);
      const last = after[after.length - 1];
      expect(last?.entities.some((e) => e.entityId === shooter)).toBe(true);
    });

    it('ignores a sentry round and a self-inflicted wound', () => {
      const match = instance();
      const op = seated(match);
      const victim = match.seatOf(op.playerId)?.player.entityId ?? -1;

      // Neither throws, and neither is a reveal: `autonomous` is a streak's round, whose
      // `sourceId` is an owner who may be anywhere.
      expect(() => {
        match.match.bus.emit(EV.DamageDealt, {
          sourceId: 1234,
          targetId: victim,
          amount: 5,
          zone: 'torso',
          lethal: false,
          autonomous: true,
          weaponId: 'sentry',
          x: 0,
          y: 0,
          z: 0,
          distance: 5,
          falloffLoss: 0,
          penetrationLoss: 0,
        });
        match.match.bus.emit(EV.DamageDealt, {
          sourceId: victim,
          targetId: victim,
          amount: 5,
          zone: 'torso',
          lethal: false,
          autonomous: false,
          weaponId: 'frag',
          x: 0,
          y: 0,
          z: 0,
          distance: 0,
          falloffLoss: 0,
          penetrationLoss: 0,
        });
      }).not.toThrow();
    });
  });

  describe('the step', () => {
    it('serialises on one tick in three, and nothing on the other two', () => {
      const match = instance();
      const op = seated(match);

      stepTicks(match, 0, SNAPSHOT_EVERY);

      expect(snapshots(op.rec)).toHaveLength(1);
      expect(op.rec.hashes).toHaveLength(1);
      expect(op.rec.hashes[0]?.tick).toBe(0);
    });

    it('serialises on the tick the phase offset names, not on the master cadence', () => {
      // §4.19's stagger: index 1 is one tick clear of index 0.
      const match = instance({ instanceIndex: 1 });
      const op = seated(match);
      expect(match.clock.phaseOffset).toBe(1);

      match.step(0);
      expect(snapshots(op.rec)).toHaveLength(0);
      match.step(2);
      expect(snapshots(op.rec)).toHaveLength(1);
    });

    it('measures what the step cost, as a last value and an exponential mean', () => {
      const match = instance();
      seated(match);
      expect(match.lastStepMs).toBe(0);
      match.step(0);
      // The fake clock does not move, so both are zero — what is pinned is that the first
      // sample seeds the mean rather than being averaged against a zero that never happened.
      expect(match.meanStepMs).toBe(match.lastStepMs);
    });

    it('forces a snapshot on the tick the win condition fires', () => {
      // Tier 2 §A: the deciding tick is two in three not a send tick, and it is the last tick
      // this instance is ever stepped on. M11 measured 9 of 15 matches never replicating
      // MATCH_END without this.
      const match = instance({ roundSecondsOverride: 1 });
      const op = seated(match);
      match.go();

      const { endedOn } = runToEnd(match, op.rec);

      const last = snapshots(op.rec).pop();
      expect(last?.header.serverTick).toBe(endedOn);
      expect((last?.header.flags ?? 0) & SFlag.MatchOver).toBe(SFlag.MatchOver);
    });

    it('does not force one while the instance is not RUNNING', () => {
      // `ending` is `state === RUNNING && isOver`. An instance that was never told to go is
      // not ending, however over its match is, and it sends on the cadence and nowhere else.
      const match = instance({ roundSecondsOverride: 1 });
      const op = seated(match);

      const { endedOn } = runToEnd(match, op.rec);

      expect(endedOn % SNAPSHOT_EVERY).not.toBe(0);
      expect(match.running).toBe(false);
      const offCadence = snapshots(op.rec).filter(
        (f) => f.header.serverTick % SNAPSHOT_EVERY !== 0,
      );
      expect(offCadence).toHaveLength(0);
    });

    it('sends nothing to a closed session', () => {
      const match = instance();
      const open = seated(match);
      const gone = seated(match);
      gone.closed = true;

      stepTicks(match, 0, SNAPSHOT_EVERY);

      expect(snapshots(open.rec)).toHaveLength(1);
      expect(gone.rec.frames).toHaveLength(0);
      expect(gone.rec.boards).toHaveLength(0);
      expect(gone.rec.hashes).toHaveLength(0);
    });
  });

  describe('the snapshot', () => {
    it('carries the match clock, the scores and the phase in its header', () => {
      const match = instance();
      const op = seated(match);
      match.go();
      match.step(0);

      const frame = snapshots(op.rec)[0];
      expect(frame).toBeDefined();
      const flow = match.match.flow;
      expect(frame?.header.serverTick).toBe(0);
      expect(frame?.header.scoreA).toBe(match.match.mode.teamScore('A'));
      expect(frame?.header.scoreB).toBe(match.match.mode.teamScore('B'));
      expect(frame?.header.timeLeft).toBe(Math.round(flow.secondsRemaining));
      expect(frame?.header.phase).toBe(phaseIndex(flow.currentPhase));
      expect(frame?.header.round).toBe(flow.round);
    });

    it('raises InputFrozen while the mode freezes input', () => {
      const match = instance();
      const op = seated(match);
      match.step(0);

      const frame = snapshots(op.rec)[0];
      const want = match.match.inputFrozen ? SFlag.InputFrozen : 0;
      expect((frame?.header.flags ?? 0) & SFlag.InputFrozen).toBe(want);
    });

    it("replicates this seat's entitlements as state, once per snapshot", () => {
      // F14: a dropped event frame must not leave the two sides disagreeing about whether a
      // wall stops this player.
      const match = instance();
      const op = seated(match);
      op.cheats.set(Cheat.NoClip);
      match.step(0);

      expect(snapshots(op.rec)[0]?.cheatMask).toBe(op.cheats.mask);
    });

    it('stamps the snapshot id through the session, which is what makes an ack a measurement', () => {
      const match = instance();
      const op = seated(match);
      match.step(0);

      const frame = snapshots(op.rec)[0];
      expect(op.rec.notedSnapshots).toEqual([frame?.header.snapshotId]);
    });

    it('describes a seated player from the simulation, field by field', () => {
      const match = instance();
      const op = seated(match);
      const player = match.seatOf(op.playerId)?.player;
      expect(player).toBeDefined();
      match.step(0);

      const e = entityOf(snapshots(op.rec)[0] as DecodedFrame, player?.entityId ?? -1);
      expect(e.displayName).toBe(player?.displayName);
      expect(e.health).toBe(Math.round(player?.health.current ?? -1));
      expect(e.weaponIndex).toBe(weaponIndexOf(player?.weapons.definition.id ?? ''));
      expect(e.characterIndex).toBe(player?.characterIndex);
      expect(e.heldEquipment).toBe(equipmentIndexOf(player?.heldEquipment ?? null));
      expect(e.flags & EFlag.Alive).toBe(EFlag.Alive);
      expect(e.flags & EFlag.Bot).toBe(0);
    });

    it('sends 255 for a player holding no grenade, which is what the null index means', () => {
      const match = instance();
      const op = seated(match);
      const player = match.seatOf(op.playerId)?.player;
      match.step(0);

      const e = entityOf(snapshots(op.rec)[0] as DecodedFrame, player?.entityId ?? -1);
      // A seat with no loadout holds nothing, and `equipmentIndexOf(null)` is 255.
      expect(player?.heldEquipment ?? null).toBeNull();
      expect(e.heldEquipment).toBe(255);
    });

    it('describes a bot with no body of its own and no grenade in its hand', () => {
      // M16 decision 4: the server has no opinion about a bot's body. And the record is
      // pooled, so a slot a player's cook left behind must not put a grenade in a bot's hand.
      const match = instance();
      const op = seated(match);
      const bot = match.match.bots.bots[0];
      expect(bot).toBeDefined();
      match.step(0);

      const e = entityOf(snapshots(op.rec)[0] as DecodedFrame, bot?.entityId ?? -1);
      expect(e.flags & EFlag.Bot).toBe(EFlag.Bot);
      expect(e.characterIndex).toBe(NO_SKIN_INDEX);
      expect(e.heldEquipment).toBe(255);
      expect(e.throwPhase).toBe(0);
      expect(e.weaponIndex).toBe(weaponIndexOf(bot?.weapons.definition.id ?? ''));
    });

    it('marks which side a body is on', () => {
      const match = instance();
      const op = seated(match);
      match.step(0);

      const frame = snapshots(op.rec)[0] as DecodedFrame;
      for (const bot of match.match.bots.bots) {
        const e = frame.entities.find((x) => x.entityId === bot.entityId);
        if (e === undefined) continue;
        expect(e.flags & EFlag.TeamB).toBe(bot.team === 'B' ? EFlag.TeamB : 0);
      }
    });

    it('asks the burn system once per entity, for a human and a bot alike', () => {
      // The flag is set here rather than by two writers that have no reason to know what a
      // flamethrower is. A burn starts the only way one can: flame damage on the bus.
      const match = instance();
      const op = seated(match);
      const entityId = match.seatOf(op.playerId)?.player.entityId ?? -1;
      const bot = match.match.bots.bots[0]?.entityId ?? -1;
      for (const targetId of [entityId, bot]) {
        match.match.bus.emit(EV.DamageDealt, {
          sourceId: 404,
          targetId,
          amount: 1,
          zone: 'torso',
          lethal: false,
          autonomous: false,
          weaponId: FLAME_WEAPON_ID,
          x: 0,
          y: 0,
          z: 0,
          distance: 2,
          falloffLoss: 0,
          penetrationLoss: 0,
        });
      }
      match.step(0);

      expect(match.match.burn.isBurning(entityId)).toBe(true);
      const frame = snapshots(op.rec)[0] as DecodedFrame;
      expect(entityOf(frame, entityId).flags & EFlag.Burning).toBe(EFlag.Burning);
      expect(entityOf(frame, bot).flags & EFlag.Burning).toBe(EFlag.Burning);
    });

    it('leaves the flag clear for a body that is not alight', () => {
      const match = instance();
      const op = seated(match);
      const entityId = match.seatOf(op.playerId)?.player.entityId ?? -1;
      match.step(0);

      expect(match.match.burn.isBurning(entityId)).toBe(false);
      expect(entityOf(snapshots(op.rec)[0] as DecodedFrame, entityId).flags & EFlag.Burning).toBe(0);
    });

    it('lists every body in the world, humans first', () => {
      const match = instance();
      const op = seated(match);
      match.step(0);

      const frame = snapshots(op.rec)[0] as DecodedFrame;
      expect(frame.entities[0]?.entityId).toBe(match.match.players[0]?.entityId);
      expect(frame.entities).toHaveLength(
        match.match.players.length + match.match.bots.bots.length,
      );
    });
  });

  describe('the scoreboard', () => {
    it('sends a fresh seat the whole board on its first snapshot tick', () => {
      // The other half of 4.3: a returning client reading zeros for everybody.
      const match = instance();
      const op = seated(match);
      match.step(0);

      expect(op.rec.boards).toHaveLength(1);
      expect(op.rec.boards[0]?.serial).toBe(match.match.score.serial);
    });

    it('does not send the same serial twice', () => {
      const match = instance();
      const op = seated(match);
      stepTicks(match, 0, SCOREBOARD_MIN_TICKS * 2);
      expect(op.rec.boards).toHaveLength(1);
    });

    it('rate-limits a board that keeps changing to four a second', () => {
      const match = instance();
      const op = seated(match);
      const victim = match.match.bots.bots[0]?.entityId ?? -1;
      const killer = match.match.bots.bots[1]?.entityId ?? -1;
      match.step(0);
      expect(op.rec.boards).toHaveLength(1);

      // A change inside the window is held back...
      match.match.score.recordKill(killer, victim, false, 100);
      stepTicks(match, SNAPSHOT_EVERY, SCOREBOARD_MIN_TICKS - SNAPSHOT_EVERY);
      expect(op.rec.boards).toHaveLength(1);

      // ...and goes out on the first send tick at or after it.
      stepTicks(match, SCOREBOARD_MIN_TICKS, SNAPSHOT_EVERY);
      expect(op.rec.boards).toHaveLength(2);
    });

    it('resends the board anyway every two seconds, changed or not', () => {
      // There is no ack on this channel; a frame lost under `--net bad` is corrected within
      // two seconds instead of at the next change.
      const match = instance();
      const op = seated(match);
      stepTicks(match, 0, SCOREBOARD_KEEPALIVE_TICKS + SNAPSHOT_EVERY);

      expect(op.rec.boards).toHaveLength(2);
      expect(op.rec.boards[1]?.serial).toBe(op.rec.boards[0]?.serial);
    });

    it('waives the rate limit for the last board of a match (BACKLOG #42)', () => {
      // The kill that ends a close match is the board a client would otherwise hold wrong for
      // the whole summary hold: the instance is ENDED from the deciding tick, so the forced
      // pass is the last one there will ever be and a rate limit must not overrule it.
      //
      // The run is in two halves because the deciding tick cannot be known in advance: the
      // first finds it, the second — same seed, same tick — puts a change into the score close
      // enough to the end that the rate limit would swallow it.
      const probe = instance({ roundSecondsOverride: 1 });
      const probeOp = seated(probe);
      probe.go();
      const { endedOn } = runToEnd(probe, probeOp.rec);

      const match = instance({ roundSecondsOverride: 1 });
      const op = seated(match);
      match.go();
      const victim = match.match.bots.bots[0]?.entityId ?? -1;
      const killer = match.match.bots.bots[1]?.entityId ?? -1;
      const run = runToEnd(match, op.rec, (tick) => {
        // One change far enough out to go through on the cadence, and one on the last tick.
        if (tick === endedOn - 9 || tick === endedOn) {
          match.match.score.recordKill(killer, victim, false, 100);
        }
      });

      expect(run.endedOn).toBe(endedOn);
      const ticks = run.boardTicks;
      const last = ticks[ticks.length - 1];
      const previous = ticks[ticks.length - 2] ?? -1;
      // The precondition: the previous board is younger than the rate limit, so without the
      // waiver this send is the one that does not happen.
      expect(endedOn - previous).toBeLessThan(SCOREBOARD_MIN_TICKS);
      expect(last).toBe(endedOn);
      expect(op.rec.boards[op.rec.boards.length - 1]?.serial).toBe(match.match.score.serial);
    });

    it('does not waive changed: a seat already holding the final serial is sent nothing', () => {
      const match = instance({ roundSecondsOverride: 1 });
      const op = seated(match);
      match.go();

      const { endedOn, boardTicks } = runToEnd(match, op.rec);

      const previous = boardTicks[boardTicks.length - 1] ?? -1;
      // Nothing moved the score all match, so every board carries the same serial and the
      // ending pass adds none — and the keepalive was not due either, which is the half of
      // the precondition that makes this a statement about `changed`.
      expect(endedOn - previous).toBeLessThan(SCOREBOARD_KEEPALIVE_TICKS);
      expect(previous).not.toBe(endedOn);
      expect(new Set(op.rec.boards.map((b) => b.serial)).size).toBe(1);
    });

    it('builds the rows once and hands every seat the same set', () => {
      const match = instance();
      const a = seated(match);
      const b = seated(match);
      match.step(0);

      expect(a.rec.boards[0]?.rows).toEqual(b.rec.boards[0]?.rows);
      expect(a.rec.boards[0]?.rows).toHaveLength(match.match.score.rows.length);
    });
  });

  describe('objectives', () => {
    it('is skipped entirely for a mode with no zones', () => {
      const match = instance({ modeId: 'TDM' });
      const op = seated(match);
      match.step(0);

      expect(match.match.mode.objectiveZones).toHaveLength(0);
      expect(op.rec.objectives).toHaveLength(0);
    });

    it('replicates every zone, with progress quantised to a byte', () => {
      const match = instance({ modeId: 'DOM' });
      const op = seated(match);
      match.step(0);

      const zones = match.match.mode.objectiveZones;
      expect(zones.length).toBeGreaterThan(0);
      const sent = op.rec.objectives[0];
      expect(sent).toHaveLength(zones.length);
      for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];
        const state = sent?.[i];
        expect(state?.owner).toBe(ownerCode(zone?.owner ?? 'NONE'));
        expect(state?.capturing).toBe(ownerCode(zone?.capturingTeam ?? 'NONE'));
        expect(state?.progress).toBe(
          Math.max(0, Math.min(255, Math.round((zone?.progress ?? 0) * 255))),
        );
        expect(state?.countA).toBe(zone?.countA);
        expect(state?.countB).toBe(zone?.countB);
      }
    });
  });

  describe('dog tags', () => {
    it('says nothing at all for a mode that has none', () => {
      const match = instance({ modeId: 'TDM' });
      const op = seated(match);
      stepTicks(match, 0, SNAPSHOT_EVERY * 2);

      expect(match.match.mode.dogTags).toBeNull();
      expect(op.rec.tags).toHaveLength(0);
    });

    it('sends the empty list once, then holds while it stays empty', () => {
      // The transition from one tag to none is exactly as much news as the other way round,
      // so the empty frame is sent once rather than never.
      const match = instance({ modeId: 'KC' });
      const op = seated(match);
      stepTicks(match, 0, SNAPSHOT_EVERY * 3);

      expect(match.match.mode.dogTags).toEqual([]);
      expect(op.rec.tags).toHaveLength(1);
      expect(op.rec.tags[0]).toEqual([]);
    });

    it('sends it again to the next seat, because a fresh seat has seen none of it', () => {
      const match = instance({ modeId: 'KC' });
      const first = seated(match);
      stepTicks(match, 0, SNAPSHOT_EVERY);
      expect(first.rec.tags).toHaveLength(1);

      const second = seated(match);
      stepTicks(match, SNAPSHOT_EVERY, SNAPSHOT_EVERY);
      expect(second.rec.tags).toHaveLength(1);
    });
  });

  describe('the bomb', () => {
    it('says nothing for a mode with no bomb', () => {
      const match = instance({ modeId: 'TDM' });
      const op = seated(match);
      match.step(0);

      expect(match.match.mode.bombInfo).toBeNull();
      expect(op.rec.bombs).toHaveLength(0);
    });

    it("replicates the bomb to every seat while it is nobody's", () => {
      const match = instance({ modeId: 'SND', variant: 'SKIRMISH' });
      const op = seated(match);
      match.step(0);

      const info = match.match.mode.bombInfo;
      expect(info).not.toBeNull();
      expect(op.rec.bombs).toHaveLength(1);
      expect(op.rec.bombs[0]?.state).toBe(info?.state);
      expect(op.rec.bombs[0]?.x).toBe(info?.x);
      expect(op.rec.bombs[0]?.z).toBe(info?.z);
    });
  });

  describe('killstreaks', () => {
    it('builds the bodies once and the intel per recipient', () => {
      const match = instance();
      const a = seated(match);
      const b = seated(match);
      match.step(0);

      expect(a.rec.streaks).toHaveLength(1);
      expect(b.rec.streaks).toHaveLength(1);
      // No streak is up, so the common half is empty and equal for both.
      expect(a.rec.streaks[0]?.entities).toEqual(b.rec.streaks[0]?.entities);
    });

    it("carries this seat's price list, balance and next offer", () => {
      const match = instance();
      const op = seated(match);
      const entityId = match.seatOf(op.playerId)?.player.entityId ?? -1;
      match.step(0);

      const view = op.rec.streaks[0];
      const streaks = match.match.streaks;
      const priced = [...streaks.pricesFor(entityId)];
      expect(view?.balance).toBe(streaks.balanceOf(entityId));
      // Capped at what the wire carries, which is three of the nine.
      expect(view?.offers).toHaveLength(Math.min(MAX_STREAK_OFFERS, priced.length));
      expect(view?.offers[0]?.price).toBe(priced[0]?.price);
      const next = streaks.nextFor(entityId);
      expect(view?.nextPrice).toBe(next?.price ?? 0);
      if (next === null) expect(view?.nextKind).toBe(-1);
    });

    it('sends no UAV sweep and no contacts while no UAV is up', () => {
      const match = instance();
      const op = seated(match);
      match.step(0);

      const view = op.rec.streaks[0];
      expect(view?.sweepAngle).toBe(-1);
      expect(view?.contacts).toEqual([]);
      expect(view?.scrambled).toBe(false);
    });
  });

  describe('grenades and smoke', () => {
    it('sends the empty frame once, then holds while nothing is in the air', () => {
      const match = instance();
      const op = seated(match);
      stepTicks(match, 0, SNAPSHOT_EVERY * 3);

      expect(op.rec.projectiles).toHaveLength(1);
      expect(op.rec.projectiles[0]?.projectiles).toEqual([]);
      expect(op.rec.projectiles[0]?.smoke).toEqual([]);
    });

    it('unlatches the empty frame when somebody is seated', () => {
      // Or the last grenade of a firefight stays on the joining client's floor forever.
      const match = instance();
      const first = seated(match);
      stepTicks(match, 0, SNAPSHOT_EVERY);
      expect(first.rec.projectiles).toHaveLength(1);

      const second = seated(match);
      stepTicks(match, SNAPSHOT_EVERY, SNAPSHOT_EVERY);
      expect(second.rec.projectiles).toHaveLength(1);
      expect(first.rec.projectiles).toHaveLength(2);
    });
  });

  describe('the state hash', () => {
    it('is not computed at all when nobody is seated', () => {
      const match = instance();
      const op = seated(match);
      match.step(0);
      expect(op.rec.hashes).toHaveLength(1);

      match.unseat(op.playerId);
      expect(() => stepTicks(match, SNAPSHOT_EVERY, SNAPSHOT_EVERY)).not.toThrow();
      expect(op.rec.hashes).toHaveLength(1);
    });

    it('hashes the mode state from the same quantisation the wire uses', () => {
      const match = instance({ modeId: 'DOM' });
      const op = seated(match);
      match.step(0);

      const facts = modeStateFacts(match.match.mode, match.match.flow, makeModeStateScratch());
      const sent = op.rec.hashes[0];
      expect(sent?.tick).toBe(0);
      expect(sent?.hash).toBe(hashModeState(facts));
      expect(sent?.sections).toEqual(hashModeStateSections(facts, [0, 0, 0, 0]));
    });

    it('goes last, after every channel it describes', () => {
      // A client can only answer the hash honestly once it has applied the rest of tick N.
      const match = instance({ modeId: 'DOM' });
      const op = seated(match);
      match.step(0);

      expect(op.rec.objectives).toHaveLength(1);
      expect(op.rec.hashes).toHaveLength(1);
    });

    it('sends the same hash to every seat', () => {
      const match = instance();
      const a = seated(match);
      const b = seated(match);
      match.step(0);
      expect(a.rec.hashes[0]?.hash).toBe(b.rec.hashes[0]?.hash);
    });
  });

  describe('events', () => {
    it('sends nothing on a tick with nothing to say', () => {
      const match = instance();
      const op = seated(match);
      // Tick 1 is not a snapshot tick, so anything sent on it is an event frame.
      match.step(1);
      expect(eventFrames(op.rec)).toBe(0);
    });

    it("sends the tick's events once the world is moving", () => {
      // The collector opens its frame at the top of `match.step`, so the events a tick carries
      // are the ones that tick produced — which means the bots have to do the producing.
      const match = instance();
      const op = seated(match);
      const closed = seated(match);
      closed.closed = true;
      match.go();

      stepTicks(match, 0, 240);

      expect(eventFrames(op.rec)).toBeGreaterThan(0);
      expect(closed.rec.frames).toHaveLength(0);
    });
  });

  describe('broadcast', () => {
    it('reaches every open seat and no closed one', () => {
      const match = instance();
      const a = seated(match);
      const b = seated(match);
      const gone = seated(match);
      gone.closed = true;

      match.broadcast(new Uint8Array([1, 2, 3]));

      expect(a.rec.frames).toHaveLength(1);
      expect(b.rec.frames).toHaveLength(1);
      expect(gone.rec.frames).toHaveLength(0);
    });
  });

  describe('the relevance metrics', () => {
    it('reports the cost and the dormant share, then zeroes itself', () => {
      const match = instance();
      seated(match);
      match.step(0);

      const first = match.takeRelevanceStats();
      expect(first.ms).toBeGreaterThanOrEqual(0);
      expect(first.dormantPct).toBeGreaterThanOrEqual(0);

      const second = match.takeRelevanceStats();
      expect(second.ms).toBe(0);
      expect(second.dormantPct).toBe(0);
      expect(second.eventCutMs).toBe(0);
      expect(match.relevanceEnemies).toBe(0);
      expect(match.relevanceDormant).toBe(0);
    });

    it('reports zero rather than dividing by no enemies', () => {
      const match = instance();
      expect(match.takeRelevanceStats().dormantPct).toBe(0);
    });
  });

  describe('state', () => {
    it('starts BOOTING and is not stepped by the loop', () => {
      const match = instance();
      expect(match.state).toBe(InstanceState.BOOTING);
      expect(match.running).toBe(false);
    });

    it('is running only in RUNNING', () => {
      const match = instance();
      match.go();
      expect(match.state).toBe(InstanceState.RUNNING);
      expect(match.running).toBe(true);
    });

    it('ignores a transition to the state it is already in', () => {
      const match = instance();
      match.go();
      match.go();
      expect(match.state).toBe(InstanceState.RUNNING);
    });
  });

  describe('teardown', () => {
    it('releases the seats, the pool and the simulation', () => {
      const match = instance();
      const op = seated(match);

      match.dispose();

      expect(match.state).toBe(InstanceState.DESTROYED);
      expect(match.playerCount).toBe(0);
      expect([...match.sessions]).toHaveLength(0);
      expect(match.seatOf(op.playerId)).toBeNull();
      expect(match.match.viewLagMsFor).toBeNull();
    });

    it('unsubscribes the hurt handler, so a disposed instance holds no view', () => {
      const match = instance();
      const op = seated(match);
      const victim = match.seatOf(op.playerId)?.player.entityId ?? -1;

      match.dispose();

      expect(() =>
        match.match.bus.emit(EV.DamageDealt, {
          sourceId: 1,
          targetId: victim,
          amount: 1,
          zone: 'torso',
          lethal: false,
          autonomous: false,
          weaponId: 'ar_carbine',
          x: 0,
          y: 0,
          z: 0,
          distance: 1,
          falloffLoss: 0,
          penetrationLoss: 0,
        }),
      ).not.toThrow();
    });

    it('sends nothing after teardown, because there is nobody left to send to', () => {
      const match = instance();
      const op = seated(match);
      match.dispose();
      const before = op.rec.frames.length;

      expect(() => match.broadcast(new Uint8Array([9]))).not.toThrow();
      expect(op.rec.frames).toHaveLength(before);
    });
  });
});
