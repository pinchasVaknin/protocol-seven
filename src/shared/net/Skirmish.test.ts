import { describe, expect, it } from 'vitest';
import { cloneLoadout, defaultLoadouts, resolveLoadout, type LoadoutSlot } from '../meta/Loadouts';
import { decodeHeader, writeLoadout } from './Messages';
import { MAX_CLIENT_FRAME_BYTES } from './Protocol';
import {
  ballotOpened,
  InstanceState,
  instanceStateName,
  isArenaInstance,
  OBJ_TEAM_A,
  OBJ_TEAM_B,
  ownerCode,
  ownerFromCode,
  sanitiseNetLoadout,
  toNetLoadout,
  VotePhase,
  votePhaseName,
  WARMUP_MATCH_ID,
  type NetLoadout,
} from './Skirmish';
import { ByteReader, ByteWriter } from './Wire';

/**
 * The class as the server receives it (security audit 2026-10-04, S1).
 *
 * Through the real encoder and the real decoder, because the exploit was a `Loadout` frame and
 * the defence has to hold at the point the bytes become a class — not only when a well-formed
 * `LoadoutSlot` is handed to the rules directly.
 */

function overTheWire(loadout: NetLoadout): NetLoadout {
  const w = new ByteWriter(MAX_CLIENT_FRAME_BYTES);
  const bytes = writeLoadout(w, loadout);
  expect(bytes.length).toBeLessThanOrEqual(MAX_CLIENT_FRAME_BYTES);
  const msg = decodeHeader(new ByteReader(bytes));
  if (msg.kind !== 'loadout') throw new Error(`decoded as ${msg.kind}`);
  return msg.loadout;
}

function assault(): LoadoutSlot {
  const slot = defaultLoadouts()[0];
  if (slot === undefined) throw new Error('no default class');
  return cloneLoadout(slot);
}

describe('sanitiseNetLoadout', () => {
  it('accepts every shipped class unchanged and reports nothing', () => {
    for (const slot of defaultLoadouts()) {
      const losses: string[] = [];
      const clean = sanitiseNetLoadout(overTheWire(toNetLoadout(slot)), losses);
      expect(losses).toEqual([]);
      expect(clean).toEqual(slot);
    }
  });

  it('refuses to stack a perk the client sent three times', () => {
    const cheat = { ...toNetLoadout(assault()), perks: ['sleight_of_hand', 'sleight_of_hand', 'sleight_of_hand'] };
    const losses: string[] = [];
    const clean = sanitiseNetLoadout(overTheWire(cheat), losses);
    if (clean === null) throw new Error('refused outright');

    expect(clean.perks).toEqual(['sleight_of_hand', null, null]);
    expect(losses.length).toBeGreaterThan(0);
    // What the server will simulate: one copy's reload, not three.
    const reference = assault();
    reference.perks = ['sleight_of_hand', null, null];
    expect(resolveLoadout(clean, 0).primary.reloadTime).toBe(resolveLoadout(reference, 0).primary.reloadTime);
  });

  it('refuses two primaries without OVERKILL and the wrong grenade in each slot', () => {
    const net = toNetLoadout(assault());
    const cheat: NetLoadout = {
      ...net,
      secondary: { weaponId: 'sniper_vantage', attachments: [], camo: null },
      lethal: 'smoke',
      tactical: 'claymore',
      streaks: ['sentry', 'sentry', 'sentry'],
    };
    const clean = sanitiseNetLoadout(overTheWire(cheat));
    expect(clean?.secondary.weaponId).toBe('pistol_talon');
    expect(clean?.lethal).toBe('frag');
    expect(clean?.tactical).toBe('flashbang');
    expect(clean?.streaks).toEqual(['sentry', null, null]);
  });
});

/**
 * The rest of the validator and the small wire vocabulary (A23).
 *
 * `sanitiseNetLoadout`'s three cases were pinned; the weapon it leans on, the slot padding and
 * the enum names were not. Each one is a place where a client's claim becomes a server's fact,
 * which is the whole reason this file is in `shared/`.
 */
describe('sanitiseWeapon, through the class', () => {
  it('refuses the whole class when it cannot read the weapon, and says nothing', () => {
    const net = toNetLoadout(assault());
    const forged: NetLoadout = {
      ...net,
      primary: { weaponId: 'ar_nonexistent', attachments: [], camo: null },
    };
    const losses: string[] = [];
    // Null, not a patched-up class — and no loss note. `Session.onLoadout` is where that is
    // answered: *"an unreadable class from a client one build out of step falls back to the
    // server defaults, which is a working game."*
    expect(sanitiseNetLoadout(overTheWire(forged), losses)).toBe(null);
    expect(losses).toEqual([]);
  });

  it('keeps one copy of an attachment the client sent twice', () => {
    const net = toNetLoadout(assault());
    const attachment = 'optic_reflex';
    const forged: NetLoadout = {
      ...net,
      primary: { ...net.primary, attachments: [attachment, attachment, attachment] },
    };
    const clean = sanitiseNetLoadout(overTheWire(forged));
    // A duplicate would stack its modifier twice on the server and once on the client.
    expect(clean?.primary.attachments.filter((a) => a === attachment).length).toBe(1);
  });

  it('drops an attachment it does not know', () => {
    const net = toNetLoadout(assault());
    const forged: NetLoadout = {
      ...net,
      primary: { ...net.primary, attachments: ['optic_xray'] },
    };
    const clean = sanitiseNetLoadout(overTheWire(forged));
    expect(clean?.primary.attachments).toEqual([]);
  });

  it('refuses a camo nobody has earned the right to send', () => {
    const net = toNetLoadout(assault());
    const forged: NetLoadout = { ...net, primary: { ...net.primary, camo: 'camo_ultraviolet' } };
    const clean = sanitiseNetLoadout(overTheWire(forged));
    expect(clean?.primary.camo).toBe(null);
  });

  it('refuses the whole class only when there is no class to refuse', () => {
    expect(sanitiseNetLoadout(null)).toBe(null);
  });
});

describe('the slot lists', () => {
  it('always come back at the length the rules expect, padded with nothing', () => {
    const net = toNetLoadout(assault());
    const forged: NetLoadout = { ...net, perks: [], streaks: [] };
    const clean = sanitiseNetLoadout(overTheWire(forged));
    expect(clean?.perks.length).toBe(net.perks.length);
    expect(clean?.streaks.length).toBe(net.streaks.length);
    expect(clean?.perks.every((p) => p === null)).toBe(true);
  });
});

describe('the wire vocabulary', () => {
  it('round-trips an objective owner through its code', () => {
    expect(ownerFromCode(ownerCode('A'))).toBe('A');
    expect(ownerFromCode(ownerCode('B'))).toBe('B');
    expect(ownerFromCode(ownerCode('NONE'))).toBe('NONE');
    expect(ownerCode('A')).toBe(OBJ_TEAM_A);
    expect(ownerCode('B')).toBe(OBJ_TEAM_B);
    // Anything else is neutral rather than an error: this decodes a byte a client sent.
    expect(ownerFromCode(99)).toBe('NONE');
    expect(ownerCode('Z')).toBe(0);
  });

  it('names the warmup arena apart from a live match', () => {
    expect(isArenaInstance(WARMUP_MATCH_ID)).toBe(true);
    expect(isArenaInstance(WARMUP_MATCH_ID + 1)).toBe(false);
  });

  it('names every instance state and vote phase, and refuses to invent one', () => {
    expect(instanceStateName(InstanceState.RUNNING)).toBe('RUNNING');
    expect(instanceStateName(InstanceState.FAILED)).toBe('FAILED');
    expect(votePhaseName(VotePhase.MODE_VOTE)).toBe('MODE_VOTE');
    expect(votePhaseName(VotePhase.MAP_VOTE)).toBe('MAP_VOTE');
    expect(instanceStateName(99)).toBe('UNKNOWN');
    expect(votePhaseName(99)).toBe('UNKNOWN');
  });

  it('reports the ballot that just opened, and nothing when none did', () => {
    expect(ballotOpened(VotePhase.PLAY, VotePhase.MODE_VOTE)).toBe(VotePhase.MODE_VOTE);
    expect(ballotOpened(VotePhase.MODE_VOTE, VotePhase.MAP_VOTE)).toBe(VotePhase.MAP_VOTE);
    // Still in the same ballot is not an opening, and neither is leaving one.
    expect(ballotOpened(VotePhase.MODE_VOTE, VotePhase.MODE_VOTE)).toBe(null);
    expect(ballotOpened(VotePhase.MAP_VOTE, VotePhase.ALLOCATING)).toBe(null);
    expect(ballotOpened(VotePhase.IDLE, VotePhase.PLAY)).toBe(null);
  });
});
