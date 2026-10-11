import { describe, expect, it } from 'vitest';
import type { Combatant } from '../ai/Combatant';
import { EV, createGameBus, type GameBus } from '../core/Events';
import { Health } from '../player/Health';
import { HitboxRig } from './HitboxRig';
import { Killfeed, type CombatantDirectory, type KillfeedLine } from './Killfeed';
import { LocalIdentity } from './LocalIdentity';

/**
 * The feed's model, pinned.
 *
 * Two things here have been bugs. The **directory** was a `Combatant[]`, which is empty on a
 * networked client, and every line read `WORLD killed UNKNOWN` without crashing or warning — so
 * the tests below cover both sources and the two fallback names on purpose. The **ring** is the
 * other half: newest-first indexing over a preallocated buffer that wraps, which is the kind of
 * arithmetic that is right for 31 entries and wrong for the 33rd.
 */

const HEALTH = { max: 100, regenDelay: 5, regenRate: 40 };

/** A roster entry, as the single-player and server-side path hands them over. */
function combatant(entityId: number, displayName: string, team: 'A' | 'B'): Combatant {
  return {
    entityId,
    displayName,
    health: new Health(HEALTH),
    rig: new HitboxRig(),
    team,
    px: 0,
    py: 0,
    pz: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    eyeHeight: 1.6,
    aimHeight: 1.26,
    quiet: false,
    participating: true,
    glinting: false,
  };
}

const ROSTER: readonly Combatant[] = [
  combatant(1, 'ALPHA', 'A'),
  combatant(2, 'BRAVO', 'B'),
  combatant(3, 'CINDER', 'B'),
];

/** The snapshot-backed source a networked client uses instead of a roster. */
function directory(names: Record<number, [string, 'A' | 'B']>): CombatantDirectory {
  return {
    nameOf: (id) => names[id]?.[0] ?? null,
    teamOf: (id) => names[id]?.[1] ?? null,
  };
}

interface Feed {
  readonly bus: GameBus;
  readonly feed: Killfeed;
  readonly entries: Array<Record<string, unknown>>;
}

function feedOn(
  source: readonly Combatant[] | CombatantDirectory = ROSTER,
  identity = new LocalIdentity(),
): Feed {
  const bus = createGameBus();
  const feed = new Killfeed(bus, source, identity);
  const entries: Array<Record<string, unknown>> = [];
  // The payload is a module-level singleton, so a copy is taken as each one arrives.
  bus.on(EV.KillfeedEntry, (p) => entries.push({ ...p }));
  return { bus, feed, entries };
}

describe('a feed nothing has happened in', () => {
  it('has no lines and hands none out', () => {
    const { feed } = feedOn();
    expect(feed.count).toBe(0);
    expect(feed.at(0)).toBe(undefined);
    expect(feed.at(-1)).not.toBe(undefined);
  });
});

describe('a line the feed wrote', () => {
  it('names both bodies and both sides from the roster', () => {
    const { feed, entries } = feedOn();
    feed.push(1, 2, 'ar_carbine', 'head', 77);
    expect(feed.count).toBe(1);
    expect(feed.at(0)).toEqual({
      killerId: 1,
      victimId: 2,
      killerName: 'ALPHA',
      victimName: 'BRAVO',
      killerTeam: 'A',
      victimTeam: 'B',
      weaponId: 'ar_carbine',
      zone: 'head',
      headshot: true,
      suicide: false,
      involvesLocal: false,
      tick: 77,
    } satisfies KillfeedLine);
    expect(entries).toEqual([
      {
        killerName: 'ALPHA',
        victimName: 'BRAVO',
        killerTeam: 'A',
        victimTeam: 'B',
        weaponId: 'ar_carbine',
        headshot: true,
        suicide: false,
        involvesLocal: false,
      },
    ]);
  });

  it('is a headshot only when the zone is the head', () => {
    const { feed } = feedOn();
    feed.push(1, 2, 'ar_carbine', 'torso', 1);
    expect(feed.at(0)?.headshot).toBe(false);
    feed.push(1, 2, 'ar_carbine', 'leg', 2);
    expect(feed.at(0)?.headshot).toBe(false);
  });

  it('names a killer the directory has never heard of WORLD, and calls it a suicide', () => {
    const { feed } = feedOn();
    feed.push(404, 2, 'fall', 'torso', 5);
    expect(feed.at(0)?.killerName).toBe('WORLD');
    expect(feed.at(0)?.killerTeam).toBe('NONE');
    expect(feed.at(0)?.suicide).toBe(true);
  });

  it('names an unknown victim UNKNOWN', () => {
    const { feed } = feedOn();
    feed.push(1, 404, 'ar_carbine', 'torso', 5);
    expect(feed.at(0)?.victimName).toBe('UNKNOWN');
    expect(feed.at(0)?.victimTeam).toBe('NONE');
    expect(feed.at(0)?.suicide).toBe(false);
  });

  it('is a suicide when one body is both ends of it', () => {
    const { feed } = feedOn();
    feed.push(2, 2, 'frag', 'torso', 5);
    expect(feed.at(0)?.suicide).toBe(true);
    expect(feed.at(0)?.killerName).toBe('BRAVO');
  });
});

describe('a line about the human at this keyboard', () => {
  it('is flagged when they killed and when they were killed', () => {
    const identity = new LocalIdentity();
    identity.adopt(2);
    const { feed } = feedOn(ROSTER, identity);

    feed.push(2, 3, 'ar_carbine', 'torso', 1);
    expect(feed.at(0)?.involvesLocal).toBe(true);

    feed.push(3, 2, 'ar_carbine', 'torso', 2);
    expect(feed.at(0)?.involvesLocal).toBe(true);

    feed.push(1, 3, 'ar_carbine', 'torso', 3);
    expect(feed.at(0)?.involvesLocal).toBe(false);
  });

  it('is the single-player seat when no server ever assigned one', () => {
    const { feed } = feedOn();
    feed.push(0, 2, 'ar_carbine', 'torso', 1);
    expect(feed.at(0)?.involvesLocal).toBe(true);
  });
});

describe('the ring of recent lines', () => {
  it('hands them out newest first', () => {
    const { feed } = feedOn();
    feed.push(1, 2, 'a', 'torso', 1);
    feed.push(2, 3, 'b', 'torso', 2);
    feed.push(3, 1, 'c', 'torso', 3);
    expect(feed.count).toBe(3);
    expect([feed.at(0)?.tick, feed.at(1)?.tick, feed.at(2)?.tick]).toEqual([3, 2, 1]);
    expect(feed.at(3)).toBe(undefined);
  });

  it('holds thirty-two and no more, dropping the oldest', () => {
    const { feed } = feedOn();
    for (let tick = 1; tick <= 40; tick++) feed.push(1, 2, 'a', 'torso', tick);
    expect(feed.count).toBe(32);
    expect(feed.at(0)?.tick).toBe(40);
    expect(feed.at(31)?.tick).toBe(9);
    expect(feed.at(32)).toBe(undefined);
  });

  it('indexes correctly across the wrap, which is where the arithmetic earns its keep', () => {
    const { feed } = feedOn();
    for (let tick = 1; tick <= 33; tick++) feed.push(1, 2, 'a', 'torso', tick);
    expect(feed.at(0)?.tick).toBe(33);
    expect(feed.at(1)?.tick).toBe(32);
    expect(feed.at(31)?.tick).toBe(2);
  });

  it('starts over on reset without forgetting its own buffer', () => {
    const { feed } = feedOn();
    for (let tick = 1; tick <= 5; tick++) feed.push(1, 2, 'a', 'torso', tick);
    feed.reset();
    expect(feed.count).toBe(0);
    expect(feed.at(0)).toBe(undefined);
    feed.push(1, 2, 'a', 'torso', 99);
    expect(feed.count).toBe(1);
    expect(feed.at(0)?.tick).toBe(99);
  });

  it('publishes one event per line', () => {
    const { feed, entries } = feedOn();
    feed.push(1, 2, 'a', 'torso', 1);
    feed.push(2, 1, 'b', 'head', 2);
    expect(entries.length).toBe(2);
    expect(entries[1]?.headshot).toBe(true);
  });
});

describe('the name source', () => {
  it('can be a snapshot-backed directory instead of a roster', () => {
    const { feed } = feedOn(directory({ 7: ['ECHO', 'A'], 8: ['FOX', 'B'] }));
    feed.push(7, 8, 'ar_carbine', 'torso', 1);
    expect(feed.at(0)?.killerName).toBe('ECHO');
    expect(feed.at(0)?.victimTeam).toBe('B');
  });

  it('can be swapped when a match becomes networked', () => {
    const { feed } = feedOn();
    feed.setDirectory(directory({ 1: ['REMOTE', 'B'] }));
    feed.push(1, 2, 'ar_carbine', 'torso', 1);
    expect(feed.at(0)?.killerName).toBe('REMOTE');
    expect(feed.at(0)?.killerTeam).toBe('B');
    expect(feed.at(0)?.victimName).toBe('UNKNOWN');
  });

  it('answers the death panel with the same name it put in the line', () => {
    const { feed } = feedOn();
    expect(feed.nameOf(3)).toBe('CINDER');
    expect(feed.nameOf(404)).toBe(null);
    feed.setDirectory(directory({ 3: ['RENAMED', 'A'] }));
    expect(feed.nameOf(3)).toBe('RENAMED');
  });

  it('defaults to the single-player seat when no identity is handed over', () => {
    const feed = new Killfeed(createGameBus(), ROSTER);
    feed.push(0, 1, 'ar_carbine', 'torso', 1);
    expect(feed.at(0)?.involvesLocal).toBe(true);
  });
});
