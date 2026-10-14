import { describe, expect, it } from 'vitest';
import { CHEAT_CODE_MAX } from '../cheats/Cheats';
import type { ReplicatedScoreRow } from '../combat/ScoreSystem';
import type { InputCommand, MutableInputCommand } from '../core/InputCommand';
import type { BombInfo, TagInfo } from '../modes/GameMode';
import { makePlayerSimState } from '../player/PlayerState';
import { ALL_WEAPONS } from '../weapons/WeaponDefs';
import { STREAK_WEAPON_IDS } from '../streaks/StreakWeapons';
import {
  beginEvents,
  bombStateCode,
  decodeHeader,
  Ev,
  finishEvents,
  makeSnapshotHeader,
  MAX_SCORE_ROWS,
  phaseAt,
  phaseIndex,
  readCommand,
  readEntity,
  readEvents,
  readOwnerState,
  readSnapshotHeader,
  readSnapshotOwnerPresent,
  SFlag,
  WIRE_PHASES,
  writeBomb,
  writeBye,
  writeCheatRequest,
  writeCheats,
  writeCommands,
  writeDamage,
  writeFired,
  writeFootstep,
  writeHello,
  writeImpact,
  writeKilled,
  writeLoadout,
  writeNotice,
  writeObjectives,
  writePing,
  writePong,
  writePose,
  writePrepare,
  writeProjectiles,
  writeReady,
  writeReject,
  writeScoreboard,
  writeSnapshotEntities,
  writeSnapshotHeader,
  writeSnapshotOwner,
  writeStateHash,
  writeStreakRequest,
  writeStreaks,
  writeSummary,
  writeTags,
  writeVote,
  writeVoteState,
  writeWelcome,
  type DamageEvent,
  type Decoded,
  type EventSink,
  type FiredEvent,
  type FootstepEvent,
  type ImpactEvent,
  type KilledEvent,
  type PoseEvent,
  type SnapshotHeader,
  type SummaryInfo,
  type VoteInfo,
  type WelcomeInfo,
} from './Messages';
import {
  dequantAngle,
  dequantMove,
  dequantPitch,
  dequantPos,
  MAGIC,
  MAX_COMMANDS_PER_BATCH,
  MsgC,
  MsgS,
  PROTOCOL_VERSION,
  quantAngle,
  quantMove,
  quantPitch,
  quantPos,
  RECONNECT_TOKEN_BYTES,
} from './Protocol';
import {
  MAX_OBJECTIVES,
  MAX_PROJECTILES,
  MAX_STREAK_OFFERS,
  MAX_TAGS,
  type NetLoadout,
  type ObjectiveState,
  type ProjectileState,
  type SmokeState,
  type StreakView,
} from './Skirmish';
import { makeEntitySnapshot, weaponIdAt, weaponIndexOf } from './Snapshot';
import { ByteReader, ByteWriter } from './Wire';
/**
 * The two halves of protocol v19 (2026-09-24), each one a place where a wrong bit is silent.
 *
 * The damage message's zone byte now carries three things — the zone, `lethal` and
 * `autonomous` — and a mask that is one bit wide in the wrong place reads a torso hit as a
 * head hit, or a sentry's burst as the player's own. The weapon table gained a tail, and a
 * tail that shifts the head renames every weapon in every killfeed at once.
 */

function roundTripDamage(e: DamageEvent): DamageEvent {
  const w = new ByteWriter(64);
  writeDamage(w, e);
  const bytes = w.bytes();
  const r = new ByteReader(bytes);
  let seen: DamageEvent | null = null;
  const ok = readEvents(r, 1, {
    onDamage: (got) => {
      // The reader hands back a reused scratch record, so it is copied before it is kept.
      seen = { ...got };
    },
  });
  expect(ok).toBe(true);
  if (seen === null) throw new Error('no damage event decoded');
  return seen;
}

describe('the damage message', () => {
  const base: DamageEvent = {
    sourceId: 3,
    targetId: 7,
    amount: 42.5,
    zone: 'torso',
    lethal: false,
    autonomous: false,
    x: 1.5,
    y: 2.25,
    z: -3.75,
  };

  it('round-trips every combination of the three things packed into one byte', () => {
    for (const zone of ['head', 'torso', 'arm', 'leg'] as const) {
      for (const lethal of [false, true]) {
        for (const autonomous of [false, true]) {
          const got = roundTripDamage({ ...base, zone, lethal, autonomous });
          expect({ zone: got.zone, lethal: got.lethal, autonomous: got.autonomous }).toEqual({
            zone,
            lethal,
            autonomous,
          });
        }
      }
    }
  });

  it('carries the rest of the record across unchanged', () => {
    const got = roundTripDamage({ ...base, zone: 'head', lethal: true, autonomous: true });
    expect(got.sourceId).toBe(base.sourceId);
    expect(got.targetId).toBe(base.targetId);
    expect(got.amount).toBeCloseTo(base.amount, 2);
    expect(got.x).toBeCloseTo(base.x, 2);
    expect(got.y).toBeCloseTo(base.y, 2);
    expect(got.z).toBeCloseTo(base.z, 2);
  });

  it('costs no more bytes than it did before the flag', () => {
    const w = new ByteWriter(64);
    writeDamage(w, base);
    // 1 kind + 2 ids + 2 amount + 1 packed zone + 6 position.
    expect(w.bytes().length).toBe(12);
  });
});

describe('the wire weapon table', () => {
  it('names every loadout weapon at the index it always had', () => {
    ALL_WEAPONS.forEach((def, index) => {
      expect(weaponIndexOf(def.id)).toBe(index);
      expect(weaponIdAt(index)).toBe(def.id);
    });
  });

  it('names the killstreak weapons in the tail, so a sentry kill is not "no weapon"', () => {
    for (const id of STREAK_WEAPON_IDS) {
      const index = weaponIndexOf(id);
      expect(index).toBeGreaterThanOrEqual(ALL_WEAPONS.length);
      expect(index).toBeLessThan(255);
      expect(weaponIdAt(index)).toBe(id);
    }
  });

  it('still answers 255 for a stranger, and the table fits under it', () => {
    expect(weaponIndexOf('no_such_weapon')).toBe(255);
    expect(weaponIdAt(255)).toBeNull();
    expect(ALL_WEAPONS.length + STREAK_WEAPON_IDS.length).toBeLessThan(255);
  });

  it('carries a streak weapon through the killed message', () => {
    const e: KilledEvent = {
      targetId: 4,
      sourceId: 1,
      weaponIndex: weaponIndexOf('streak_sentry'),
      zone: 'torso',
      killerHealth: 100,
    };
    const w = new ByteWriter(32);
    writeKilled(w, e);
    const r = new ByteReader(w.bytes());
    let index = -1;
    readEvents(r, 1, { onKilled: (got) => void (index = got.weaponIndex) });
    expect(weaponIdAt(index)).toBe('streak_sentry');
  });
});

/**
 * Protocol v27: whether a shot pings the minimap rides bit 7 of the byte the tracer and the
 * connected count already share. A wrong mask here would read a suppressed shot as eight more
 * pellets, or a sixteen-pellet hit as silent.
 */
describe('the fired message', () => {
  const base: FiredEvent = {
    sourceId: 4,
    weaponIndex: 2,
    x: 1,
    y: 1.5,
    z: -2,
    endX: 10,
    endY: 1.2,
    endZ: 7.5,
    material: 3,
    tracer: false,
    pelletsHit: 0,
    minimapPing: true,
  };

  function roundTripFired(e: FiredEvent): FiredEvent {
    const w = new ByteWriter(64);
    writeFired(w, e);
    let seen: FiredEvent | null = null;
    const ok = readEvents(new ByteReader(w.bytes()), 1, {
      onFired: (got) => {
        seen = { ...got };
      },
    });
    expect(ok).toBe(true);
    if (seen === null) throw new Error('no fired event decoded');
    return seen;
  }

  it('round-trips the minimap ping beside every tracer and pellet count the byte holds', () => {
    for (const minimapPing of [true, false]) {
      for (const tracer of [false, true]) {
        for (const pelletsHit of [0, 1, 8, 16]) {
          const got = roundTripFired({ ...base, minimapPing, tracer, pelletsHit });
          expect({ minimapPing: got.minimapPing, tracer: got.tracer, pelletsHit: got.pelletsHit }).toEqual({
            minimapPing,
            tracer,
            pelletsHit,
          });
        }
      }
    }
  });
});


/**
 * Every message id through its own writer and back out of `decodeHeader`, pinned before A21
 * split this file into one module per message family and turned the 383-line decode switch
 * into a table.
 *
 * The decoders are the half with no safety net: a writer that is wrong usually shows up as a
 * wrong number on screen, while a decoder that reads one byte too few turns the *rest* of the
 * frame into garbage and the symptom lands somewhere else entirely. So every id is asserted
 * field by field, and every refusal path — a short frame, a foreign magic, an unknown id, a
 * truncated body, a count past its cap — is asserted to come back as `bad` rather than as a
 * throw (S4.16).
 */
function frameOf(write: (w: ByteWriter) => Uint8Array): Decoded {
  const w = new ByteWriter(8192);
  const bytes = write(w);
  expect(w.overflowed).toBe(false);
  return decodeHeader(new ByteReader(bytes));
}

const A_LOADOUT: NetLoadout = {
  name: 'ASSAULT',
  primary: { weaponId: 'ar_carbine', attachments: ['sight_holo', 'grip_vertical'], camo: 'gold' },
  secondary: { weaponId: 'pistol_g17', attachments: [], camo: null },
  lethal: 'frag',
  tactical: 'flashbang',
  fieldUpgrade: 'ammo_box',
  perks: ['lightweight', null, 'ghost'],
  streaks: ['uav', 'sentry', null],
};

const A_SEAT: WelcomeInfo = {
  entityId: 4,
  team: 'B',
  mapId: 'mp_foundry',
  modeId: 'DOM',
  serverTick: 12_345,
  serverMs: 678.5,
  snapshotHz: 30,
  matchId: 7,
  effectiveTick: 12_350,
  migrated: false,
};

describe('the client to server messages', () => {
  it('Hello carries the version, the name, the skin and nothing it was not given', () => {
    const d = frameOf((w) => writeHello(w, 'ALICE', 3));
    expect(d.kind).toBe('hello');
    if (d.kind !== 'hello') return;
    expect(d.version).toBe(PROTOCOL_VERSION);
    expect(d.name).toBe('ALICE');
    expect(d.skinIndex).toBe(3);
    expect(d.loadout).toBe(null);
    expect(d.reconnectToken).toBe(null);
  });

  it('Hello carries a whole class when it has one, ids and all', () => {
    const d = frameOf((w) => writeHello(w, 'ALICE', 255, A_LOADOUT));
    expect(d.kind).toBe('hello');
    if (d.kind !== 'hello') return;
    expect(d.skinIndex).toBe(255);
    expect(d.loadout).toEqual(A_LOADOUT);
  });

  it('Hello carries a reconnect token of exactly the right length, and refuses any other', () => {
    const token = new Uint8Array(RECONNECT_TOKEN_BYTES).fill(9);
    const withToken = frameOf((w) => writeHello(w, 'ALICE', 0, null, token));
    expect(withToken.kind).toBe('hello');
    if (withToken.kind !== 'hello') return;
    expect(withToken.reconnectToken).toEqual(token);

    // A token of the wrong size is not sent at all: the length is the credential's shape and a
    // short one is a client this server has nothing to look up.
    const short = frameOf((w) => writeHello(w, 'ALICE', 0, null, new Uint8Array(4)));
    expect(short.kind).toBe('hello');
    if (short.kind !== 'hello') return;
    expect(short.reconnectToken).toBe(null);
  });

  it('Hello carries the class and the token together, in that order', () => {
    const token = new Uint8Array(RECONNECT_TOKEN_BYTES).fill(1);
    const d = frameOf((w) => writeHello(w, 'BOB', 1, A_LOADOUT, token));
    expect(d.kind).toBe('hello');
    if (d.kind !== 'hello') return;
    expect(d.loadout).toEqual(A_LOADOUT);
    expect(d.reconnectToken).toEqual(token);
  });

  it('Commands carries the ack and the count, and the bodies stream out of the same reader', () => {
    const cmds: InputCommand[] = [
      {
        seq: 100,
        tickIndex: 500,
        moveX: 0.5,
        moveZ: -0.25,
        yaw: 1.25,
        pitch: -0.5,
        buttons: 0b1010,
        sampledAtMs: 0,
      },
      {
        seq: 101,
        tickIndex: 501,
        moveX: -1,
        moveZ: 1,
        yaw: -2.5,
        pitch: 0.75,
        buttons: 0,
        sampledAtMs: 0,
      },
    ];
    const w = new ByteWriter(256);
    const bytes = writeCommands(w, cmds, cmds.length, 42);
    const r = new ByteReader(bytes);
    const d = decodeHeader(r);
    expect(d).toEqual({ kind: 'commands', count: 2, snapshotAck: 42 });

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
    readCommand(r, out);
    expect(out.seq).toBe(100);
    expect(out.tickIndex).toBe(500);
    expect(out.moveX).toBe(dequantMove(quantMove(0.5)));
    expect(out.moveZ).toBe(dequantMove(quantMove(-0.25)));
    expect(out.yaw).toBe(dequantAngle(quantAngle(1.25)));
    expect(out.pitch).toBe(dequantPitch(quantPitch(-0.5)));
    expect(out.buttons).toBe(0b1010);
    readCommand(r, out);
    expect(out.seq).toBe(101);
    expect(out.moveX).toBe(-1);
    expect(out.moveZ).toBe(1);
    expect(r.overran).toBe(false);
  });

  it('Commands sends at most one batch worth, however many it is handed', () => {
    const one: InputCommand = {
      seq: 1,
      tickIndex: 1,
      moveX: 0,
      moveZ: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      sampledAtMs: 0,
    };
    const many = Array.from({ length: MAX_COMMANDS_PER_BATCH + 5 }, () => one);
    const d = frameOf((w) => writeCommands(w, many, many.length, 0));
    expect(d).toEqual({ kind: 'commands', count: MAX_COMMANDS_PER_BATCH, snapshotAck: 0 });
  });

  it('Ping round-trips its id and its millisecond clock untouched', () => {
    const d = frameOf((w) => writePing(w, 7, 1234.5));
    expect(d).toEqual({ kind: 'ping', id: 7, clientMs: 1234.5 });
  });

  it('Bye decodes the same from either direction', () => {
    expect(frameOf((w) => writeBye(w, false, 'quit'))).toEqual({ kind: 'bye', reason: 'quit' });
    expect(frameOf((w) => writeBye(w, true, 'idle'))).toEqual({ kind: 'bye', reason: 'idle' });
  });

  it('Loadout carries the class on its own', () => {
    const d = frameOf((w) => writeLoadout(w, A_LOADOUT));
    expect(d).toEqual({ kind: 'loadout', loadout: A_LOADOUT });
  });

  it('Vote and Ready carry their two numbers', () => {
    expect(frameOf((w) => writeVote(w, 1, 2))).toEqual({ kind: 'vote', phase: 1, option: 2 });
    expect(frameOf((w) => writeReady(w, 9))).toEqual({ kind: 'ready', matchId: 9 });
  });

  it('Streak carries the kind and the marked point, to the centimetre', () => {
    const d = frameOf((w) => writeStreakRequest(w, 3, 12.34, -5.67));
    expect(d).toEqual({
      kind: 'streakRequest',
      streakKind: 3,
      x: dequantPos(quantPos(12.34)),
      z: dequantPos(quantPos(-5.67)),
    });
  });

  it('Cheat carries the text, cut to the length the server will consider', () => {
    expect(frameOf((w) => writeCheatRequest(w, 'bighead'))).toEqual({
      kind: 'cheatRequest',
      code: 'bighead',
    });
    const long = frameOf((w) => writeCheatRequest(w, 'x'.repeat(CHEAT_CODE_MAX + 10)));
    expect(long.kind).toBe('cheatRequest');
    if (long.kind !== 'cheatRequest') return;
    expect(long.code).toBe('x'.repeat(CHEAT_CODE_MAX));
  });
});

describe('the seat messages', () => {
  it('Welcome carries the whole seat, and says it is not a migration', () => {
    const d = frameOf((w) => writeWelcome(w, A_SEAT, null));
    expect(d.kind).toBe('welcome');
    if (d.kind !== 'welcome') return;
    expect(d.version).toBe(PROTOCOL_VERSION);
    expect(d.reconnectToken).toBe(null);
    expect(d.entityId).toBe(4);
    expect(d.team).toBe('B');
    expect(d.mapId).toBe('mp_foundry');
    expect(d.modeId).toBe('DOM');
    expect(d.serverTick).toBe(12_345);
    expect(d.serverMs).toBe(678.5);
    expect(d.snapshotHz).toBe(30);
    expect(d.matchId).toBe(7);
    expect(d.effectiveTick).toBe(12_350);
    expect(d.migrated).toBe(false);
  });

  it('Migrate is the same body under a different id, and says so', () => {
    const d = frameOf((w) => writeWelcome(w, { ...A_SEAT, migrated: true }, null));
    expect(d.kind).toBe('migrate');
    if (d.kind !== 'migrate') return;
    expect(d.migrated).toBe(true);
    expect(d.effectiveTick).toBe(12_350);
    expect(d.mapId).toBe('mp_foundry');
  });

  it('a seat carries the token when it is stamped with one', () => {
    const token = new Uint8Array(RECONNECT_TOKEN_BYTES).fill(7);
    const d = frameOf((w) => writeWelcome(w, A_SEAT, token));
    expect(d.kind).toBe('welcome');
    if (d.kind !== 'welcome') return;
    expect(d.reconnectToken).toEqual(token);
  });

  it('team A is the clear bit, so a seat on either team survives the round trip', () => {
    const d = frameOf((w) => writeWelcome(w, { ...A_SEAT, team: 'A' }, null));
    expect(d.kind).toBe('welcome');
    if (d.kind !== 'welcome') return;
    expect(d.team).toBe('A');
  });

  it('Reject carries its code, and Notice its text', () => {
    expect(frameOf((w) => writeReject(w, 2))).toEqual({ kind: 'reject', code: 2 });
    expect(frameOf((w) => writeNotice(w, 'the match is over'))).toEqual({
      kind: 'notice',
      text: 'the match is over',
    });
  });

  it('Pong echoes the client clock and adds the server pair', () => {
    const d = frameOf((w) => writePong(w, 11, 100.25, 200.5, 3000));
    expect(d).toEqual({
      kind: 'pong',
      id: 11,
      clientMs: 100.25,
      serverMs: 200.5,
      serverTick: 3000,
    });
  });
});

describe('the match-flow messages', () => {
  it('the ballot carries its tally, its deadline and the three signed sentinels', () => {
    const info: VoteInfo = {
      phase: 2,
      phaseEndsTick: 9_000,
      tally: [3, 0, 1, 4, 2],
      selfVote: -1,
      decidedMode: 3,
      decidedMap: -1,
      humans: 6,
    };
    const d = frameOf((w) => writeVoteState(w, info));
    expect(d).toEqual({ kind: 'voteState', ...info });
  });

  it('Prepare names the match it is about to be', () => {
    const d = frameOf((w) => writePrepare(w, 5, 'mp_dunes', 'SND'));
    expect(d).toEqual({ kind: 'prepare', matchId: 5, mapId: 'mp_dunes', modeId: 'SND' });
  });

  it('the summary carries every row, every XP line and the hold deadline', () => {
    const info: SummaryInfo = {
      matchId: 3,
      mapId: 'mp_depot',
      modeId: 'TDM',
      winner: 'A',
      winnerEntityId: 12,
      reason: 'score limit',
      scoreA: 75,
      scoreB: 61,
      endsTick: 20_000,
      rows: [
        {
          entityId: 1,
          displayName: 'ALICE',
          team: 'A',
          kills: 20,
          deaths: 7,
          assists: 3,
          score: 2400,
          isBot: false,
        },
        {
          entityId: 2,
          displayName: 'BOT-01',
          team: 'B',
          kills: 4,
          deaths: 19,
          assists: 1,
          score: -50,
          isBot: true,
        },
      ],
      xp: [
        { source: 0, count: 20, amount: 2000 },
        { source: 4, count: 1, amount: 250 },
      ],
    };
    const d = frameOf((w) => writeSummary(w, info));
    expect(d).toEqual({ kind: 'summary', ...info });
  });

  it('a summary with no individual winner says so by absence, not by a number', () => {
    const info: SummaryInfo = {
      matchId: 1,
      mapId: 'mp_foundry',
      modeId: 'DOM',
      winner: 'DRAW',
      reason: 'time',
      scoreA: 50,
      scoreB: 50,
      endsTick: 100,
      rows: [],
      xp: [],
    };
    const d = frameOf((w) => writeSummary(w, info));
    expect(d.kind).toBe('summary');
    if (d.kind !== 'summary') return;
    expect(d.winnerEntityId).toBeUndefined();
    expect('winnerEntityId' in d).toBe(true);
  });

  it('the scoreboard carries all fifteen columns of every row, with its serial', () => {
    const rows: ReplicatedScoreRow[] = [
      {
        entityId: 3,
        displayName: 'ALICE',
        team: 'A',
        kills: 11,
        deaths: 5,
        assists: 2,
        score: 1500,
        streak: 4,
        bestStreak: 7,
        shotsFired: 240,
        shotsHit: 96,
        damageDealt: 1234.6,
        headshots: 3,
        captures: 2,
        defends: 1,
        plants: 1,
        defuses: 0,
        tags: 5,
      },
      {
        entityId: 9,
        displayName: 'BOB',
        team: 'B',
        kills: 0,
        deaths: 0,
        assists: 0,
        score: 0,
        streak: 0,
        bestStreak: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageDealt: 0,
        headshots: 0,
        captures: 0,
        defends: 0,
        plants: 0,
        defuses: 0,
        tags: 0,
      },
    ];
    const d = frameOf((w) => writeScoreboard(w, 77, rows));
    expect(d.kind).toBe('scoreboard');
    if (d.kind !== 'scoreboard') return;
    expect(d.serial).toBe(77);
    // Damage is rounded to whole points on the wire; everything else is exact.
    expect(d.rows).toEqual([{ ...rows[0], damageDealt: 1235 }, rows[1]]);
  });

  it('the scoreboard drops the rows past its cap rather than overflowing the frame', () => {
    const row: ReplicatedScoreRow = {
      entityId: 1,
      displayName: 'X',
      team: 'A',
      kills: 0,
      deaths: 0,
      assists: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      shotsFired: 0,
      shotsHit: 0,
      damageDealt: 0,
      headshots: 0,
      captures: 0,
      defends: 0,
      plants: 0,
      defuses: 0,
      tags: 0,
    };
    const many = Array.from({ length: MAX_SCORE_ROWS + 6 }, () => row);
    const d = frameOf((w) => writeScoreboard(w, 1, many));
    expect(d.kind).toBe('scoreboard');
    if (d.kind !== 'scoreboard') return;
    expect(d.rows.length).toBe(MAX_SCORE_ROWS);
  });
});

describe('the mode-state messages', () => {
  it('objectives pack the owner and the capturing team into one byte', () => {
    const states: ObjectiveState[] = [
      { owner: 1, capturing: 2, progress: 128, countA: 2, countB: 1 },
      { owner: 0, capturing: 0, progress: 0, countA: 0, countB: 0 },
    ];
    const d = frameOf((w) => writeObjectives(w, states));
    expect(d).toEqual({ kind: 'objectives', states });
  });

  it('tags carry an id and a quantised position each, newest kept when they overflow', () => {
    const tags: TagInfo[] = [
      { id: 1, team: 'A', x: 1.5, y: 0.25, z: -2.5 },
      { id: 65_535, team: 'B', x: -10.75, y: 1, z: 3.25 },
    ];
    const d = frameOf((w) => writeTags(w, tags));
    expect(d).toEqual({
      kind: 'tags',
      tags: tags.map((t) => ({
        ...t,
        x: dequantPos(quantPos(t.x)),
        y: dequantPos(quantPos(t.y)),
        z: dequantPos(quantPos(t.z)),
      })),
    });

    const many: TagInfo[] = Array.from({ length: MAX_TAGS + 3 }, (_unused, i) => ({
      id: i,
      team: 'A' as const,
      x: 0,
      y: 0,
      z: 0,
    }));
    const capped = frameOf((w) => writeTags(w, many));
    expect(capped.kind).toBe('tags');
    if (capped.kind !== 'tags') return;
    expect(capped.tags.length).toBe(MAX_TAGS);
    // The front is dropped, so the last tag dealt is still on the wire.
    expect(capped.tags[MAX_TAGS - 1]?.id).toBe(many.length - 1);
    expect(capped.tags[0]?.id).toBe(many.length - MAX_TAGS);
  });

  it('the bomb carries its state, its fuse in hundredths and its interaction', () => {
    const bomb: BombInfo = {
      state: 'PLANTED',
      carrierId: -1,
      attackers: 'B',
      x: 4.25,
      y: 0.5,
      z: -7.75,
      secondsLeft: 12.34,
      interactFraction: 0.5,
      interactEntity: 6,
      plantedSiteIndex: 1,
    };
    const d = frameOf((w) => writeBomb(w, bomb));
    expect(d.kind).toBe('bomb');
    if (d.kind !== 'bomb') return;
    expect(d.bomb).toEqual({
      ...bomb,
      x: dequantPos(quantPos(bomb.x)),
      y: dequantPos(quantPos(bomb.y)),
      z: dequantPos(quantPos(bomb.z)),
      secondsLeft: Math.round(bomb.secondsLeft * 100) / 100,
      interactFraction: Math.round(bomb.interactFraction * 255) / 255,
    });
  });

  it('every bomb state survives its own code, and the hash spells them the same way', () => {
    for (const state of ['CARRIED', 'PLANTED', 'DEFUSED', 'EXPLODED'] as const) {
      const d = frameOf((w) =>
        writeBomb(w, {
          state,
          carrierId: 0,
          attackers: 'A',
          x: 0,
          y: 0,
          z: 0,
          secondsLeft: 0,
          interactFraction: 0,
          interactEntity: -1,
          plantedSiteIndex: -1,
        }),
      );
      expect(d.kind).toBe('bomb');
      if (d.kind !== 'bomb') return;
      expect(d.bomb.state).toBe(state);
    }
    expect(bombStateCode('CARRIED')).toBe(0);
    expect(bombStateCode('PLANTED')).toBe(1);
    expect(bombStateCode('DEFUSED')).toBe(2);
    expect(bombStateCode('EXPLODED')).toBe(3);
  });

  it('the streak view carries its three lists, its balance and the sweep sentinel', () => {
    const view: StreakView = {
      offers: [
        { kind: 1, price: 4, lockoutCs: 1200 },
        { kind: 2, price: 7, lockoutCs: 0 },
      ],
      balance: 5,
      nextKind: 2,
      nextPrice: 7,
      scrambled: true,
      sweepAngle: 1.5,
      contacts: [{ entityId: 3, x: 2.5, z: -4.25, ageCs: 150 }],
      entities: [
        {
          instanceId: 900,
          kind: 1,
          ownerId: 4,
          team: 2,
          x: 1.25,
          y: 2.5,
          z: -3.75,
          yaw: 0.5,
          pitch: -0.25,
          health: 150,
          fraction: 128,
          flags: 3,
        },
      ],
    };
    const d = frameOf((w) => writeStreaks(w, view));
    expect(d.kind).toBe('streaks');
    if (d.kind !== 'streaks') return;
    expect(d.view.offers).toEqual(view.offers);
    expect(d.view.balance).toBe(5);
    expect(d.view.nextKind).toBe(2);
    expect(d.view.nextPrice).toBe(7);
    expect(d.view.scrambled).toBe(true);
    expect(d.view.sweepAngle).toBe(dequantAngle(quantAngle(1.5)));
    expect(d.view.contacts).toEqual([
      { entityId: 3, x: dequantPos(quantPos(2.5)), z: dequantPos(quantPos(-4.25)), ageCs: 150 },
    ]);
    expect(d.view.entities).toEqual([
      {
        ...view.entities[0],
        x: dequantPos(quantPos(1.25)),
        y: dequantPos(quantPos(2.5)),
        z: dequantPos(quantPos(-3.75)),
        yaw: dequantAngle(quantAngle(0.5)),
        pitch: dequantPitch(quantPitch(-0.25)),
      },
    ]);
  });

  it('no UAV up is -1 on the way out, not an angle of zero', () => {
    const view: StreakView = {
      offers: [],
      balance: 0,
      nextKind: -1,
      nextPrice: 0,
      scrambled: false,
      sweepAngle: -1,
      contacts: [],
      entities: [],
    };
    const d = frameOf((w) => writeStreaks(w, view));
    expect(d.kind).toBe('streaks');
    if (d.kind !== 'streaks') return;
    expect(d.view.sweepAngle).toBe(-1);
    expect(d.view.nextKind).toBe(-1);
  });

  it('projectiles and smoke travel together, each with its own cap', () => {
    const projectiles: ProjectileState[] = [
      { serial: 12, kind: 1, ownerId: 3, x: 1.5, y: 2.25, z: -3.5, yaw: 2, flags: 1 },
    ];
    const smoke: SmokeState[] = [{ x: -1.25, y: 0.5, z: 2.75, radius: 4.5, remainingDs: 120 }];
    const d = frameOf((w) => writeProjectiles(w, projectiles, smoke));
    expect(d.kind).toBe('projectiles');
    if (d.kind !== 'projectiles') return;
    expect(d.projectiles).toEqual([
      {
        ...projectiles[0],
        x: dequantPos(quantPos(1.5)),
        y: dequantPos(quantPos(2.25)),
        z: dequantPos(quantPos(-3.5)),
        yaw: dequantAngle(quantAngle(2)),
      },
    ]);
    // The radius travels in decimetres, so it comes back on a tenth.
    expect(d.smoke).toEqual([
      {
        x: dequantPos(quantPos(-1.25)),
        y: dequantPos(quantPos(0.5)),
        z: dequantPos(quantPos(2.75)),
        radius: 4.5,
        remainingDs: 120,
      },
    ]);
  });

  it('the cheat answer carries the outcome and the whole mask', () => {
    expect(frameOf((w) => writeCheats(w, 2, 0b101))).toEqual({
      kind: 'cheats',
      outcome: 2,
      mask: 0b101,
    });
  });

  it('the state hash carries the tick and all four sections', () => {
    const d = frameOf((w) => writeStateHash(w, -9, 0xdead_beef, [1, 2, 3, 4]));
    expect(d).toEqual({
      kind: 'stateHash',
      tick: -9,
      hash: 0xdead_beef,
      sections: [1, 2, 3, 4],
    });
  });

  it('the state hash sends four sections even when it was handed fewer', () => {
    const d = frameOf((w) => writeStateHash(w, 0, 0, [7]));
    expect(d.kind).toBe('stateHash');
    if (d.kind !== 'stateHash') return;
    expect(d.sections).toEqual([7, 0, 0, 0]);
  });
});

describe('the snapshot frame', () => {
  it('the header round-trips every field, with the signed ack sentinel intact', () => {
    const h: SnapshotHeader = {
      snapshotId: 1234,
      baselineId: 1200,
      serverTick: 54_321,
      ackSeq: -1,
      ackTick: -2,
      scoreA: 40,
      scoreB: 35,
      timeLeft: 123,
      flags: SFlag.InputFrozen | SFlag.MatchOver,
      starvation: 17,
      phase: 2,
      phaseSeconds: 2.5,
      round: 3,
    };
    const w = new ByteWriter(256);
    writeSnapshotHeader(w, h);
    const r = new ByteReader(w.bytes());
    expect(decodeHeader(r)).toEqual({ kind: 'snapshot' });
    const out = makeSnapshotHeader();
    readSnapshotHeader(r, out);
    expect(out).toEqual(h);
    expect(r.overran).toBe(false);
  });

  it('a fresh header starts outside a running clock and on round one', () => {
    const fresh = makeSnapshotHeader();
    expect(fresh.timeLeft).toBe(-1);
    expect(fresh.round).toBe(1);
    expect(fresh.phase).toBe(0);
  });

  it('the owner block is flagged, and the cheat mask follows it either way', () => {
    const present = new ByteWriter(512);
    const s = makePlayerSimState();
    s.x = 2.5;
    writeSnapshotOwner(present, s, 0b11);
    const rp = new ByteReader(present.bytes());
    expect(readSnapshotOwnerPresent(rp)).toBe(true);
    const owner = makePlayerSimState();
    readOwnerState(rp, owner);
    expect(owner.x).toBe(2.5);
    expect(rp.u8v()).toBe(0b11);

    const absent = new ByteWriter(64);
    writeSnapshotOwner(absent, null, 0b100);
    const ra = new ByteReader(absent.bytes());
    expect(readSnapshotOwnerPresent(ra)).toBe(false);
    expect(ra.u8v()).toBe(0b100);
    expect(ra.remaining).toBe(0);
  });

  it('the entity block carries the removals first, then the deltas', () => {
    const e = makeEntitySnapshot();
    e.entityId = 6;
    e.x = 1.5;
    const w = new ByteWriter(512);
    writeSnapshotEntities(w, [e], 1, () => null, [3, 4], 2);
    const r = new ByteReader(w.bytes());
    expect(r.u8v()).toBe(2);
    expect(r.u8v()).toBe(3);
    expect(r.u8v()).toBe(4);
    expect(r.u8v()).toBe(1);
    expect(r.peekU8()).toBe(6);
    const into = makeEntitySnapshot();
    readEntity(r, into);
    expect(into.entityId).toBe(6);
    expect(into.x).toBe(dequantPos(quantPos(1.5)));
    expect(r.overran).toBe(false);
  });

  it('the phase byte names every phase, and anything else is WARMUP', () => {
    for (const [i, phase] of WIRE_PHASES.entries()) {
      expect(phaseIndex(phase)).toBe(i);
      expect(phaseAt(i)).toBe(phase);
    }
    expect(phaseIndex('NOT_A_PHASE')).toBe(0);
    expect(phaseAt(99)).toBe('WARMUP');
  });
});

describe('the event list', () => {
  function eventsOf(write: (w: ByteWriter) => void, count: number): EventSink & { seen: string[] } {
    const w = new ByteWriter(1024);
    beginEvents(w);
    write(w);
    const bytes = finishEvents(w, count);
    const r = new ByteReader(bytes);
    expect(decodeHeader(r)).toEqual({ kind: 'events', count });
    const seen: string[] = [];
    const sink = {
      seen,
      onImpact: () => seen.push('impact'),
      onFootstep: () => seen.push('footstep'),
      onJump: () => seen.push('jump'),
      onLand: () => seen.push('land'),
    };
    expect(readEvents(r, count, sink)).toBe(true);
    return sink;
  }

  it('patches the count into the byte the header reserved', () => {
    const w = new ByteWriter(64);
    beginEvents(w);
    writeImpact(w, { x: 0, y: 0, z: 0, material: 1 });
    const bytes = finishEvents(w, 1);
    expect(decodeHeader(new ByteReader(bytes))).toEqual({ kind: 'events', count: 1 });
  });

  it('carries an impact with its terminus and material and nothing else', () => {
    const w = new ByteWriter(64);
    beginEvents(w);
    writeImpact(w, { x: 1.5, y: 2.25, z: -3.75, material: 4 });
    const r = new ByteReader(finishEvents(w, 1));
    decodeHeader(r);
    let seen: ImpactEvent | null = null;
    expect(readEvents(r, 1, { onImpact: (e) => void (seen = { ...e }) })).toBe(true);
    expect(seen).toEqual({
      x: dequantPos(quantPos(1.5)),
      y: dequantPos(quantPos(2.25)),
      z: dequantPos(quantPos(-3.75)),
      material: 4,
    });
  });

  it('carries a footstep with both of its bits', () => {
    for (const heavy of [false, true]) {
      for (const quiet of [false, true]) {
        const w = new ByteWriter(64);
        beginEvents(w);
        writeFootstep(w, { entityId: 5, x: 1, y: 2, z: 3, material: 2, heavy, quiet });
        const r = new ByteReader(finishEvents(w, 1));
        decodeHeader(r);
        let seen: FootstepEvent | null = null;
        expect(readEvents(r, 1, { onFootstep: (e) => void (seen = { ...e }) })).toBe(true);
        expect(seen).toEqual({
          entityId: 5,
          x: dequantPos(quantPos(1)),
          y: dequantPos(quantPos(2)),
          z: dequantPos(quantPos(3)),
          material: 2,
          heavy,
          quiet,
        });
      }
    }
  });

  it('tells a jump from a land, and sends the impact speed in tenths', () => {
    const w = new ByteWriter(128);
    beginEvents(w);
    writePose(w, Ev.Jump, { entityId: 1, x: 0, y: 0, z: 0, speed: 0, material: 0 });
    writePose(w, Ev.Land, { entityId: 2, x: 0, y: 0, z: 0, speed: -6.25, material: 3 });
    const r = new ByteReader(finishEvents(w, 2));
    decodeHeader(r);
    const seen: Array<{ what: string; e: PoseEvent }> = [];
    expect(
      readEvents(r, 2, {
        onJump: (e) => void seen.push({ what: 'jump', e: { ...e } }),
        onLand: (e) => void seen.push({ what: 'land', e: { ...e } }),
      }),
    ).toBe(true);
    expect(seen.map((s) => s.what)).toEqual(['jump', 'land']);
    expect(seen[0]?.e.entityId).toBe(1);
    expect(seen[0]?.e.speed).toBe(0);
    // Absolute, in tenths: a landing speed of -6.25 arrives as 6.2.
    expect(seen[1]?.e.speed).toBe(Math.round(6.25 * 10) / 10);
    expect(seen[1]?.e.material).toBe(3);
  });

  it('reads several events of mixed kinds in the order they were written', () => {
    const sink = eventsOf((w) => {
      writeImpact(w, { x: 0, y: 0, z: 0, material: 0 });
      writeFootstep(w, { entityId: 1, x: 0, y: 0, z: 0, material: 0, heavy: false, quiet: false });
      writePose(w, Ev.Land, { entityId: 1, x: 0, y: 0, z: 0, speed: 1, material: 0 });
    }, 3);
    expect(sink.seen).toEqual(['impact', 'footstep', 'land']);
  });

  it('aborts the rest of the frame on an event id it does not know', () => {
    const w = new ByteWriter(64);
    beginEvents(w);
    w.u8v(99);
    w.u8v(0);
    const r = new ByteReader(finishEvents(w, 1));
    decodeHeader(r);
    expect(readEvents(r, 1, {})).toBe(false);
  });

  it('refuses a truncated event rather than handing a half-read record to the sink', () => {
    const w = new ByteWriter(64);
    beginEvents(w);
    writeImpact(w, { x: 1, y: 2, z: 3, material: 4 });
    const full = finishEvents(w, 1);
    const cut = full.slice(0, full.length - 2);
    const r = new ByteReader(cut);
    decodeHeader(r);
    let called = false;
    expect(readEvents(r, 1, { onImpact: () => void (called = true) })).toBe(false);
    expect(called).toBe(false);
  });

  it('refuses a frame that claims more events than it carries', () => {
    const w = new ByteWriter(64);
    beginEvents(w);
    writeImpact(w, { x: 0, y: 0, z: 0, material: 0 });
    const r = new ByteReader(finishEvents(w, 1));
    decodeHeader(r);
    expect(readEvents(r, 4, {})).toBe(false);
  });
});

describe('decodeHeader refuses', () => {
  const craft = (id: number, body: (w: ByteWriter) => void): Decoded => {
    const w = new ByteWriter(512);
    w.u32(MAGIC);
    w.u8v(id);
    body(w);
    return decodeHeader(new ByteReader(w.bytes()));
  };

  it('a frame too short to hold a header', () => {
    expect(decodeHeader(new ByteReader(new Uint8Array(0)))).toEqual({ kind: 'bad' });
    expect(decodeHeader(new ByteReader(new Uint8Array(4)))).toEqual({ kind: 'bad' });
  });

  it('a frame that is not this protocol', () => {
    const w = new ByteWriter(64);
    w.u32(0x1234_5678);
    w.u8v(MsgC.Hello);
    expect(decodeHeader(new ByteReader(w.bytes()))).toEqual({ kind: 'bad' });
  });

  it('a message id nobody decodes', () => {
    expect(craft(200, () => undefined)).toEqual({ kind: 'bad' });
    expect(craft(0, () => undefined)).toEqual({ kind: 'bad' });
  });

  it('every message whose body was cut short', () => {
    const frames: Array<[string, (w: ByteWriter) => Uint8Array]> = [
      ['hello', (w) => writeHello(w, 'ALICE', 1)],
      ['ping', (w) => writePing(w, 1, 2)],
      ['bye', (w) => writeBye(w, false, 'quit')],
      ['welcome', (w) => writeWelcome(w, A_SEAT, null)],
      ['pong', (w) => writePong(w, 1, 2, 3, 4)],
      ['reject', (w) => writeReject(w, 1)],
      ['notice', (w) => writeNotice(w, 'hello')],
      ['loadout', (w) => writeLoadout(w, A_LOADOUT)],
      ['vote', (w) => writeVote(w, 1, 1)],
      ['ready', (w) => writeReady(w, 1)],
      ['streakRequest', (w) => writeStreakRequest(w, 1, 1, 1)],
      ['cheats', (w) => writeCheats(w, 1, 1)],
      ['stateHash', (w) => writeStateHash(w, 1, 2, [1, 2, 3, 4])],
      [
        'voteState',
        (w) =>
          writeVoteState(w, {
            phase: 1,
            phaseEndsTick: 2,
            tally: [1, 2],
            selfVote: 0,
            decidedMode: 0,
            decidedMap: 0,
            humans: 1,
          }),
      ],
      ['prepare', (w) => writePrepare(w, 1, 'mp_depot', 'TDM')],
      [
        'objectives',
        (w) => writeObjectives(w, [{ owner: 1, capturing: 0, progress: 5, countA: 1, countB: 0 }]),
      ],
      ['tags', (w) => writeTags(w, [{ id: 1, team: 'A', x: 1, y: 2, z: 3 }])],
    ];
    for (const [name, write] of frames) {
      const w = new ByteWriter(1024);
      const full = write(w);
      const cut = full.slice(0, full.length - 1);
      expect(decodeHeader(new ByteReader(cut)), name).toEqual({ kind: 'bad' });
    }
  });

  it('a count past the cap, before it allocates anything against it', () => {
    expect(
      craft(MsgC.Commands, (w) => {
        w.u16(0);
        w.u8v(MAX_COMMANDS_PER_BATCH + 1);
      }),
    ).toEqual({ kind: 'bad' });

    expect(
      craft(MsgS.Scoreboard, (w) => {
        w.u32(1);
        w.u8v(MAX_SCORE_ROWS + 1);
      }),
    ).toEqual({ kind: 'bad' });

    expect(
      craft(MsgS.Vote, (w) => {
        w.u8v(1);
        w.i32(0);
        w.u8v(99);
      }),
    ).toEqual({ kind: 'bad' });

    expect(
      craft(MsgS.Objectives, (w) => {
        w.u8v(MAX_OBJECTIVES + 1);
      }),
    ).toEqual({ kind: 'bad' });

    expect(
      craft(MsgS.Tags, (w) => {
        w.u8v(MAX_TAGS + 1);
      }),
    ).toEqual({ kind: 'bad' });

    expect(
      craft(MsgS.Streaks, (w) => {
        w.u8v(MAX_STREAK_OFFERS + 1);
      }),
    ).toEqual({ kind: 'bad' });

    expect(
      craft(MsgS.Projectiles, (w) => {
        w.u8v(MAX_PROJECTILES + 1);
      }),
    ).toEqual({ kind: 'bad' });
  });

  it('a cheat code longer than the server will consider, rather than cutting it down', () => {
    expect(craft(MsgC.Cheat, (w) => w.str('x'.repeat(CHEAT_CODE_MAX + 1)))).toEqual({
      kind: 'bad',
    });
  });

  it('a summary whose row count is past the cap', () => {
    expect(
      craft(MsgS.Summary, (w) => {
        w.u16(1);
        w.str('mp_depot');
        w.str('TDM');
        w.str('A');
        w.i16(-1);
        w.str('time');
        w.u16(1);
        w.u16(2);
        w.i32(100);
        w.u8v(99);
      }),
    ).toEqual({ kind: 'bad' });
  });

  it('an id list longer than any message carries, without reading the strings', () => {
    // `readIdList` caps before the loop, so the perks list comes back empty and the frame is
    // structurally fine — the refusal of nonsense ids is `sanitiseNetLoadout`'s job, not this
    // decoder's. Pins the split between shape and meaning.
    const d = craft(MsgC.Loadout, (w) => {
      w.str('ASSAULT');
      w.str('ar_carbine');
      w.str('');
      w.u8v(0);
      w.str('pistol_g17');
      w.str('');
      w.u8v(0);
      w.str('frag');
      w.str('flashbang');
      w.str('ammo_box');
      w.u8v(99);
      // The capped list consumed its count byte and no strings, so the streaks list that
      // follows is read from here — which is what makes the cap a refusal and not a desync.
      w.u8v(0);
    });
    expect(d.kind).toBe('loadout');
    if (d.kind !== 'loadout') return;
    expect(d.loadout.perks).toEqual([]);
    expect(d.loadout.streaks).toEqual([]);
  });
});
