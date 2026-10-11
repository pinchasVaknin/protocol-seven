import { describe, expect, it } from 'vitest';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { LocalIdentity } from './LocalIdentity';
import {
  ScoreSystem,
  accuracy,
  compareRows,
  killDeath,
  type PlayerScore,
  type ReplicatedScoreRow,
} from './ScoreSystem';

/**
 * The single answer to "what is the score", pinned.
 *
 * Five of the comments in this class name a bug it is the fix for, and each of those is a test
 * below: the FFA kills credited to nobody (`freeForAll`), the ladder in the waiting room
 * (`records`), the leaver who came eleventh in an eight-body match (`remove`/`adopt`), the board
 * that read 267% (`shotsFrom`/`hitsFrom` through `weapon.fired`), and the replica that counted
 * every replicated shot twice (`authoritative`).
 *
 * `applyReplicated` gets the most attention because it is the one path where the rows are
 * somebody else's: it upserts, it updates in place so a cached row object stays cached, and it
 * removes whatever the server stopped listing.
 */

const ZERO_COLUMNS = {
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

interface Board {
  readonly bus: GameBus;
  readonly score: ScoreSystem;
  readonly identity: LocalIdentity;
}

/** A board with three bodies on it: one on A and two on B. */
function board(authoritative = true, identity = new LocalIdentity()): Board {
  const bus = createGameBus();
  const score = new ScoreSystem(bus, identity, authoritative);
  score.register(1, 'ALPHA', 'A');
  score.register(2, 'BRAVO', 'B');
  score.register(3, 'CINDER', 'B');
  return { bus, score, identity };
}

/**
 * The same board with a fourth body, DELTA, on A.
 *
 * An assist goes through `isHostile` exactly as the kill does, so the three-body board cannot
 * express one: the only body on the killer's side *is* the killer.
 */
function assistBoard(): Board {
  const made = board();
  made.score.register(4, 'DELTA', 'A');
  return made;
}

/** One trigger pull on the bus, as `WeaponSystem` publishes it. */
function fire(bus: GameBus, sourceId: number, pellets: number, pelletsHit: number): void {
  bus.emit(EV.WeaponFired, {
    weaponId: 'ar_carbine',
    sourceId,
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dy: 0,
    dz: 1,
    endX: 0,
    endY: 0,
    endZ: 10,
    distance: 10,
    shotIndex: 0,
    spreadDeg: 0,
    tracer: false,
    hitTarget: pelletsHit > 0,
    ammoInMag: 29,
    pellets,
    pelletsHit,
    minimapPing: true,
  });
}

/** One damage event on the bus, which is what fills the assist ledger. */
function hurt(bus: GameBus, sourceId: number, targetId: number, amount: number): void {
  bus.emit(EV.DamageDealt, {
    sourceId,
    targetId,
    weaponId: 'ar_carbine',
    zone: 'torso',
    amount,
    x: 0,
    y: 0,
    z: 0,
    distance: 10,
    falloffLoss: 0,
    penetrationLoss: 0,
    lethal: false,
    autonomous: false,
  });
}

/** A replicated row, with every column the wire carries. */
function wireRow(
  entityId: number,
  displayName: string,
  team: 'A' | 'B',
  over: Partial<ReplicatedScoreRow> = {},
): ReplicatedScoreRow {
  return { entityId, displayName, team, ...ZERO_COLUMNS, ...over };
}

describe('a row the board registered', () => {
  it('starts at zero in every column', () => {
    const { score } = board();
    expect(score.row(1)).toEqual({
      entityId: 1,
      displayName: 'ALPHA',
      team: 'A',
      isLocal: false,
      ...ZERO_COLUMNS,
    } satisfies PlayerScore);
  });

  it('is the same row when the same id is registered again', () => {
    const { score } = board();
    const first = score.row(1);
    expect(score.register(1, 'SOMEBODY ELSE', 'B')).toBe(first);
    expect(score.rows.length).toBe(3);
    expect(score.row(1)?.displayName).toBe('ALPHA');
  });

  it('is flagged as the local one when the identity says so', () => {
    const identity = new LocalIdentity();
    identity.adopt(2);
    const { score } = board(true, identity);
    expect(score.row(1)?.isLocal).toBe(false);
    expect(score.row(2)?.isLocal).toBe(true);
  });

  it('is re-flagged when the server assignment lands after registration', () => {
    const { score, identity } = board();
    expect(score.row(2)?.isLocal).toBe(false);
    identity.adopt(2);
    expect(score.row(2)?.isLocal).toBe(true);
    expect(score.row(1)?.isLocal).toBe(false);
  });

  it('is on the flat array the scoreboard sorts, in registration order', () => {
    const { score } = board();
    expect(score.rows.map((r) => r.entityId)).toEqual([1, 2, 3]);
  });
});

describe('the waiting room, which records nothing', () => {
  it('registers no row at all, which switches every counter off', () => {
    const bus = createGameBus();
    const score = new ScoreSystem(bus);
    score.records = false;
    expect(score.register(1, 'ALPHA', 'A')).toBe(undefined);
    expect(score.rows.length).toBe(0);
    score.recordKill(1, 2, true, 100);
    score.recordObjective(1, 'captures', 50);
    fire(bus, 1, 1, 1);
    hurt(bus, 1, 2, 40);
    expect(score.rows.length).toBe(0);
    expect(score.row(1)).toBe(undefined);
  });

  it('keeps none of a replicated set either', () => {
    const { score } = board();
    score.clear();
    score.records = false;
    score.applyReplicated([wireRow(1, 'ALPHA', 'A', { kills: 9 })]);
    expect(score.rows.length).toBe(0);
  });
});

describe('a kill', () => {
  it('credits the killer and charges the victim', () => {
    const { score } = board();
    score.recordKill(1, 2, false, 100);
    expect(score.row(1)?.kills).toBe(1);
    expect(score.row(1)?.score).toBe(100);
    expect(score.row(1)?.streak).toBe(1);
    expect(score.row(1)?.bestStreak).toBe(1);
    expect(score.row(1)?.headshots).toBe(0);
    expect(score.row(2)?.deaths).toBe(1);
    expect(score.team('A').kills).toBe(1);
    expect(score.team('B').deaths).toBe(1);
  });

  it('counts a headshot separately from the points it was worth', () => {
    const { score } = board();
    score.recordKill(1, 2, true, 150);
    expect(score.row(1)?.headshots).toBe(1);
    expect(score.row(1)?.score).toBe(150);
  });

  it('ends the victim streak and keeps their best', () => {
    const { score } = board();
    // Both rounds on 1, because a team-mate kill is not a kill and does not extend a streak.
    score.recordKill(2, 1, false, 100);
    score.recordKill(2, 1, false, 100);
    expect(score.row(2)?.streak).toBe(2);
    expect(score.row(2)?.bestStreak).toBe(2);
    score.recordKill(1, 2, false, 100);
    expect(score.row(2)?.streak).toBe(0);
    expect(score.row(2)?.bestStreak).toBe(2);
  });

  it('on a team-mate is not a kill', () => {
    const { score } = board();
    score.recordKill(2, 3, false, 100);
    expect(score.row(2)?.kills).toBe(0);
    expect(score.row(2)?.score).toBe(0);
    expect(score.team('B').kills).toBe(0);
    // The death still happened.
    expect(score.row(3)?.deaths).toBe(1);
    expect(score.team('B').deaths).toBe(1);
  });

  it('on somebody sharing your substrate side is a kill once there are no teams', () => {
    const { score } = board();
    score.freeForAll = true;
    score.recordKill(2, 3, false, 100);
    expect(score.row(2)?.kills).toBe(1);
    expect(score.row(2)?.score).toBe(100);
  });

  it('on yourself credits nobody', () => {
    const { score } = board();
    score.recordKill(2, 2, false, 100);
    expect(score.row(2)?.kills).toBe(0);
    expect(score.row(2)?.deaths).toBe(1);
    expect(score.row(2)?.streak).toBe(0);
  });

  it('by a body with no row charges the victim and credits nobody', () => {
    const { score } = board();
    score.recordKill(404, 2, false, 100);
    expect(score.row(2)?.deaths).toBe(1);
    expect(score.team('B').deaths).toBe(1);
    expect(score.team('A').kills).toBe(0);
  });

  it('of a body with no row still credits the killer', () => {
    const { score } = board();
    score.recordKill(1, 404, false, 100);
    expect(score.row(1)?.kills).toBe(1);
    expect(score.team('A').kills).toBe(1);
  });
});

describe('an assist', () => {
  it('goes to everybody who softened the victim up', () => {
    const { bus, score } = assistBoard();
    score.setTick(100);
    hurt(bus, 4, 2, 40);
    score.recordKill(1, 2, false, 100);
    expect(score.row(4)?.assists).toBe(1);
    expect(score.row(1)?.assists).toBe(0);
  });

  it('is one however many rounds the burst was', () => {
    const { bus, score } = assistBoard();
    score.setTick(100);
    for (let i = 0; i < 6; i++) hurt(bus, 4, 2, 10);
    score.recordKill(1, 2, false, 100);
    expect(score.row(4)?.assists).toBe(1);
  });

  it('never goes to the killer or to the victim', () => {
    const { bus, score } = assistBoard();
    score.setTick(100);
    hurt(bus, 1, 2, 40);
    hurt(bus, 2, 2, 10);
    score.recordKill(1, 2, false, 100);
    expect(score.row(1)?.assists).toBe(0);
    expect(score.row(2)?.assists).toBe(0);
  });

  it('never goes to a team-mate of the victim', () => {
    const { bus, score } = assistBoard();
    score.setTick(100);
    // 3 and the victim 2 are both on B.
    hurt(bus, 3, 2, 40);
    score.recordKill(1, 2, false, 100);
    expect(score.row(3)?.assists).toBe(0);
  });

  it('does go to a substrate-mate once there are no teams', () => {
    const { bus, score } = assistBoard();
    score.freeForAll = true;
    score.setTick(100);
    hurt(bus, 3, 2, 40);
    score.recordKill(1, 2, false, 100);
    expect(score.row(3)?.assists).toBe(1);
  });

  it('expires eight seconds after the damage landed', () => {
    const { bus, score } = assistBoard();
    score.setTick(10);
    hurt(bus, 4, 2, 40);
    // 480 ticks is the window; the kill one tick past it credits nobody.
    score.setTick(10 + 481);
    score.recordKill(1, 2, false, 100);
    expect(score.row(4)?.assists).toBe(0);
  });

  it('still counts at the last tick of the window', () => {
    const { bus, score } = assistBoard();
    score.setTick(10);
    hurt(bus, 4, 2, 40);
    score.setTick(10 + 480);
    score.recordKill(1, 2, false, 100);
    expect(score.row(4)?.assists).toBe(1);
  });

  it('is not credited for damage on somebody else', () => {
    const { bus, score } = assistBoard();
    score.setTick(100);
    hurt(bus, 4, 1, 40);
    score.recordKill(1, 2, false, 100);
    expect(score.row(4)?.assists).toBe(0);
  });
});

describe('an objective action', () => {
  it('counts the action and pays the points the mode priced it at', () => {
    const { score } = board();
    score.recordObjective(1, 'captures', 200);
    score.recordObjective(1, 'defends', 50);
    score.recordObjective(1, 'plants', 100);
    score.recordObjective(1, 'defuses', 100);
    score.recordObjective(1, 'tags', 25);
    expect(score.row(1)?.captures).toBe(1);
    expect(score.row(1)?.defends).toBe(1);
    expect(score.row(1)?.plants).toBe(1);
    expect(score.row(1)?.defuses).toBe(1);
    expect(score.row(1)?.tags).toBe(1);
    expect(score.row(1)?.score).toBe(475);
  });

  it('never touches a team total, because that is the mode decision', () => {
    const { score } = board();
    score.recordObjective(1, 'captures', 200);
    expect(score.team('A').score).toBe(0);
  });

  it('is ignored for a body with no row', () => {
    const { score } = board();
    score.recordObjective(404, 'captures', 200);
    expect(score.rows.every((r) => r.captures === 0)).toBe(true);
  });
});

describe('the team totals', () => {
  it('take the mode score and its round wins', () => {
    const { score } = board();
    score.addTeamScore('A', 120);
    score.addTeamScore('A', 80);
    score.addRoundWin('B');
    expect(score.team('A').score).toBe(200);
    expect(score.team('B').rounds).toBe(1);
    expect(score.team('A').rounds).toBe(0);
  });
});

describe('the accuracy column', () => {
  it('comes off one event, so it cannot exceed one hundred', () => {
    const { bus, score } = board();
    fire(bus, 1, 8, 3);
    fire(bus, 1, 8, 8);
    expect(score.row(1)?.shotsFired).toBe(16);
    expect(score.row(1)?.shotsHit).toBe(11);
    expect(accuracy(score.row(1) as PlayerScore)).toBeLessThanOrEqual(100);
  });

  it('is clamped the way the fire loop clamps its own pull', () => {
    const { bus, score } = board();
    fire(bus, 1, 0, 9);
    expect(score.row(1)?.shotsFired).toBe(1);
    expect(score.row(1)?.shotsHit).toBe(1);
  });

  it('ignores a pull by a body with no row', () => {
    const { bus, score } = board();
    fire(bus, 404, 8, 8);
    expect(score.rows.every((r) => r.shotsFired === 0)).toBe(true);
  });

  it('reads as -1 before anything has been fired', () => {
    const { score } = board();
    expect(accuracy(score.row(1) as PlayerScore)).toBe(-1);
  });

  it('is a plain percentage once something has', () => {
    const { bus, score } = board();
    fire(bus, 1, 4, 1);
    expect(accuracy(score.row(1) as PlayerScore)).toBe(25);
  });
});

describe('the damage column', () => {
  it('takes everything that dealt damage under this body id', () => {
    const { bus, score } = board();
    hurt(bus, 1, 2, 34);
    hurt(bus, 1, 3, 12.5);
    expect(score.row(1)?.damageDealt).toBe(46.5);
  });

  it('never touches the shot counters, so a grenade cannot inflate accuracy', () => {
    const { bus, score } = board();
    hurt(bus, 1, 2, 120);
    expect(score.row(1)?.shotsFired).toBe(0);
    expect(score.row(1)?.shotsHit).toBe(0);
    expect(accuracy(score.row(1) as PlayerScore)).toBe(-1);
  });
});

describe('a replica', () => {
  it('counts nothing for itself, because the rows are the server', () => {
    const { bus, score } = board(false);
    fire(bus, 1, 8, 8);
    hurt(bus, 1, 2, 50);
    expect(score.authoritative).toBe(false);
    expect(score.row(1)?.shotsFired).toBe(0);
    expect(score.row(1)?.damageDealt).toBe(0);
  });

  it('still re-flags the local row when the welcome lands', () => {
    const { score, identity } = board(false);
    identity.adopt(3);
    expect(score.row(3)?.isLocal).toBe(true);
  });
});

describe('the serial the replication decides on', () => {
  it('moves on every change to the row set or to any row', () => {
    const { bus, score } = board();
    const after = score.serial;
    score.recordKill(1, 2, false, 100);
    expect(score.serial).toBeGreaterThan(after);

    const afterKill = score.serial;
    fire(bus, 1, 1, 1);
    expect(score.serial).toBeGreaterThan(afterKill);

    const afterFire = score.serial;
    hurt(bus, 1, 2, 10);
    expect(score.serial).toBeGreaterThan(afterFire);

    const afterHurt = score.serial;
    score.recordObjective(1, 'tags', 25);
    expect(score.serial).toBeGreaterThan(afterHurt);
  });

  it('does not move when a replicated set says nothing new', () => {
    const { score } = board();
    const rows = [wireRow(1, 'ALPHA', 'A'), wireRow(2, 'BRAVO', 'B'), wireRow(3, 'CINDER', 'B')];
    score.applyReplicated(rows);
    const settled = score.serial;
    score.applyReplicated(rows);
    expect(score.serial).toBe(settled);
  });
});

describe('a board the server owns', () => {
  it('creates a row for an id it has never seen', () => {
    const bus = createGameBus();
    const score = new ScoreSystem(bus, new LocalIdentity(), false);
    score.applyReplicated([wireRow(5, 'ECHO', 'B', { kills: 3, score: 300 })]);
    expect(score.rows.map((r) => r.entityId)).toEqual([5]);
    expect(score.row(5)?.displayName).toBe('ECHO');
    expect(score.row(5)?.kills).toBe(3);
    expect(score.row(5)?.score).toBe(300);
  });

  it('updates a row in place, so a cached row object stays cached', () => {
    const { score } = board();
    const cached = score.row(2);
    score.applyReplicated([wireRow(2, 'BRAVO', 'B', { kills: 7, deaths: 2, damageDealt: 912.5 })]);
    expect(score.row(2)).toBe(cached);
    expect(cached?.kills).toBe(7);
    expect(cached?.deaths).toBe(2);
    expect(cached?.damageDealt).toBe(912.5);
  });

  it('carries every column the wire has', () => {
    const { score } = board();
    const full: ReplicatedScoreRow = wireRow(1, 'ALPHA', 'A', {
      kills: 1,
      deaths: 2,
      assists: 3,
      score: 4,
      streak: 5,
      bestStreak: 6,
      shotsFired: 7,
      shotsHit: 8,
      damageDealt: 9,
      headshots: 10,
      captures: 11,
      defends: 12,
      plants: 13,
      defuses: 14,
      tags: 15,
    });
    score.applyReplicated([full]);
    const row = score.row(1) as PlayerScore;
    for (const key of Object.keys(ZERO_COLUMNS) as Array<keyof typeof ZERO_COLUMNS>) {
      expect(row[key]).toBe(full[key]);
    }
  });

  it('moves a row to the side the server put it on', () => {
    const { score } = board();
    score.applyReplicated([wireRow(1, 'ALPHA', 'B')]);
    expect(score.row(1)?.team).toBe('B');
  });

  it('removes anything the server no longer lists', () => {
    const { score } = board();
    score.applyReplicated([wireRow(1, 'ALPHA', 'A'), wireRow(3, 'CINDER', 'B')]);
    expect(score.rows.map((r) => r.entityId)).toEqual([1, 3]);
    expect(score.row(2)).toBe(undefined);
  });

  it('empties the board when the server lists nobody', () => {
    const { score } = board();
    score.applyReplicated([]);
    expect(score.rows.length).toBe(0);
    expect(score.row(1)).toBe(undefined);
  });

  it('re-flags the local row it had to create', () => {
    const identity = new LocalIdentity();
    identity.adopt(5);
    const score = new ScoreSystem(createGameBus(), identity, false);
    score.applyReplicated([wireRow(5, 'ECHO', 'B'), wireRow(6, 'FOX', 'A')]);
    expect(score.row(5)?.isLocal).toBe(true);
    expect(score.row(6)?.isLocal).toBe(false);
  });
});

describe('a leaver row', () => {
  it('comes off the board when a bot gives up its seat', () => {
    const { score } = board();
    score.remove(2);
    expect(score.rows.map((r) => r.entityId)).toEqual([1, 3]);
    expect(score.row(2)).toBe(undefined);
    score.remove(2);
    expect(score.rows.length).toBe(2);
  });

  it('follows its owner onto the entity they came back as', () => {
    const { score } = board();
    score.recordKill(2, 1, false, 100);
    const row = score.row(2);
    expect(score.adopt(2, 9, 'A')).toBe(row);
    expect(score.row(2)).toBe(undefined);
    expect(score.row(9)).toBe(row);
    expect(row?.entityId).toBe(9);
    expect(row?.team).toBe('A');
    expect(row?.kills).toBe(1);
    expect(row?.displayName).toBe('BRAVO');
  });

  it('leaves the team totals where the kills were earned', () => {
    const { score } = board();
    score.recordKill(2, 1, false, 100);
    score.adopt(2, 9, 'A');
    expect(score.team('B').kills).toBe(1);
    expect(score.team('A').kills).toBe(0);
  });

  it('needs nothing when the returning player reclaimed their own id', () => {
    const { score } = board();
    const row = score.row(2);
    expect(score.adopt(2, 2, 'B')).toBe(row);
    expect(score.row(2)).toBe(row);
  });

  it('is nothing to adopt when there was no such row', () => {
    const { score } = board();
    expect(score.adopt(404, 9, 'A')).toBe(undefined);
  });

  it('takes over a blank row the fresh seat had already registered', () => {
    const { score } = board();
    score.recordKill(2, 1, false, 100);
    const leaver = score.row(2);
    score.register(9, 'BRAVO', 'A');
    expect(score.adopt(2, 9, 'A')).toBe(leaver);
    expect(score.row(9)).toBe(leaver);
    expect(score.rows.filter((r) => r.entityId === 9).length).toBe(1);
  });

  it('keeps somebody else record standing on that id rather than overwriting it', () => {
    const { score } = board();
    const standing = score.row(3);
    score.recordKill(3, 1, false, 100);
    const leaver = score.row(2);
    expect(score.adopt(2, 3, 'B')).toBe(standing);
    expect(score.row(3)).toBe(standing);
    expect(score.row(2)).toBe(leaver);
  });

  it('is re-flagged local when the id it adopted is this client', () => {
    const identity = new LocalIdentity();
    identity.adopt(9);
    const { score } = board(true, identity);
    const row = score.adopt(2, 9, 'A');
    expect(row?.isLocal).toBe(true);
  });
});

describe('the end of a round and the end of a match', () => {
  it('zeroes the streaks and keeps everything else', () => {
    const { score } = board();
    score.recordKill(1, 2, false, 100);
    score.resetRound();
    expect(score.row(1)?.streak).toBe(0);
    expect(score.row(1)?.bestStreak).toBe(1);
    expect(score.row(1)?.kills).toBe(1);
    expect(score.team('A').kills).toBe(1);
  });

  it('zeroes every column and both totals for a fresh match on the same roster', () => {
    const { bus, score } = board();
    score.recordKill(1, 2, true, 100);
    score.recordObjective(1, 'captures', 50);
    score.addTeamScore('A', 200);
    score.addRoundWin('A');
    fire(bus, 1, 8, 4);
    score.reset();
    for (const row of score.rows) {
      expect({
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        score: row.score,
        streak: row.streak,
        bestStreak: row.bestStreak,
        shotsFired: row.shotsFired,
        shotsHit: row.shotsHit,
        damageDealt: row.damageDealt,
        headshots: row.headshots,
        captures: row.captures,
        defends: row.defends,
        plants: row.plants,
        defuses: row.defuses,
        tags: row.tags,
      }).toEqual(ZERO_COLUMNS);
    }
    expect(score.rows.length).toBe(3);
    expect(score.team('A')).toEqual({ score: 0, kills: 0, deaths: 0, rounds: 0 });
    expect(score.team('B')).toEqual({ score: 0, kills: 0, deaths: 0, rounds: 0 });
  });

  it('takes every row off the board on clear', () => {
    const { score } = board();
    score.addTeamScore('A', 200);
    score.clear();
    expect(score.rows.length).toBe(0);
    expect(score.row(1)).toBe(undefined);
    expect(score.team('A').score).toBe(0);
  });

  it('clears the board and stops listening when disposed', () => {
    const { bus, score } = board();
    score.dispose();
    expect(score.rows.length).toBe(0);
    // The subscriptions are gone, so a late event cannot resurrect a row.
    fire(bus, 1, 8, 8);
    hurt(bus, 1, 2, 40);
    expect(score.rows.length).toBe(0);
  });
});

describe('the figures the board is read through', () => {
  it('reads a kill/death ratio, and no deaths as the kill count', () => {
    const { score } = board();
    const row = score.row(1) as PlayerScore;
    row.kills = 7;
    expect(killDeath(row)).toBe(7);
    row.deaths = 2;
    expect(killDeath(row)).toBe(3.5);
  });

  it('ranks by score, then kills, then fewest deaths', () => {
    expect(compareRows({ score: 200, kills: 1, deaths: 0 }, { score: 100, kills: 9, deaths: 0 }))
      .toBeLessThan(0);
    expect(compareRows({ score: 100, kills: 1, deaths: 0 }, { score: 100, kills: 9, deaths: 0 }))
      .toBeGreaterThan(0);
    expect(compareRows({ score: 100, kills: 5, deaths: 1 }, { score: 100, kills: 5, deaths: 9 }))
      .toBeLessThan(0);
    expect(compareRows({ score: 100, kills: 5, deaths: 5 }, { score: 100, kills: 5, deaths: 5 }))
      .toBe(0);
  });

  it('is the same order the summary turns into a place', () => {
    const rows = [
      { score: 100, kills: 2, deaths: 4 },
      { score: 300, kills: 3, deaths: 1 },
      { score: 100, kills: 2, deaths: 1 },
    ];
    expect([...rows].sort(compareRows)).toEqual([rows[1], rows[2], rows[0]]);
  });
});
