import { describe, expect, it } from 'vitest';
import { cloneLoadout, defaultLoadouts, resolveLoadout, type LoadoutSlot } from '../meta/Loadouts';
import { decodeHeader, writeLoadout } from './Messages';
import { MAX_CLIENT_FRAME_BYTES } from './Protocol';
import { sanitiseNetLoadout, toNetLoadout, type NetLoadout } from './Skirmish';
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
