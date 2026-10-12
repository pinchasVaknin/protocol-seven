import { describe, expect, it } from 'vitest';
import type { GameModeId } from './GameMode';
import {
  DEFAULT_MAP_ID,
  DEFAULT_MODE_ID,
  MAPS,
  MODES,
  PLAYABLE_MAPS,
  auditModeBriefs,
  findMap,
  findMode,
  modesForMap,
  resolveMapId,
  resolveModeId,
  rollBackdropMap,
} from './ModeRegistry';

/**
 * The backdrop roll (M17, C2): the greybox never, the previous map never while there is
 * another, and every real map reachable.
 */
describe('rollBackdropMap', () => {
  it('never names the testbed', () => {
    for (let i = 0; i < 64; i++) {
      const entry = rollBackdropMap(i / 64, null);
      expect(entry.testbed).toBe(false);
    }
  });

  it('skips the previous map while there is anything else to show', () => {
    for (const previous of PLAYABLE_MAPS) {
      for (let i = 0; i < 16; i++) {
        expect(rollBackdropMap(i / 16, previous.id).id).not.toBe(previous.id);
      }
    }
  });

  it('reaches every playable map and clamps the roll', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) seen.add(rollBackdropMap(i / 64, null).id);
    expect([...seen].sort()).toEqual(PLAYABLE_MAPS.map((m) => m.id).sort());
    expect(rollBackdropMap(-1, null).testbed).toBe(false);
    expect(rollBackdropMap(2, null).testbed).toBe(false);
  });

  it('marks exactly the greybox as the testbed', () => {
    expect(MAPS.filter((m) => m.testbed).map((m) => m.id)).toEqual(['mp_testbed']);
  });
});

/**
 * The registry's lookups, and the audit that keeps every mode's pre-match banner honest.
 *
 * Two kinds of lookup, and the difference is the point: `findMode`/`findMap` **throw**, because
 * a caller naming a mode that does not exist is a bug in this build, while
 * `resolveModeId`/`resolveMapId` **fall back and warn**, because the name came off a save file
 * written by an older build and the player should still get a match.
 *
 * `modesForMap` is what the menu offers, and it answers out of map *data*: a mode that needs
 * bombsites is not offered on a map that authors none, and a mode pinned to one map is offered
 * nowhere else. That is why neither the menu nor the registry has a hand-written table of which
 * mode plays where.
 */

describe('finding a mode or a map by name', () => {
  it('returns the entry a live caller asked for', () => {
    expect(findMode('TDM').id).toBe('TDM');
    expect(findMap(DEFAULT_MAP_ID).id).toBe(DEFAULT_MAP_ID);
  });

  it('throws for a name this build does not have', () => {
    // A caller inventing an id is a bug here and now, so it is loud.
    expect(() => findMode('NOPE' as GameModeId)).toThrow(/unknown game mode/i);
    expect(() => findMap('mp_nowhere')).toThrow(/unknown map/i);
  });

  it('every registered mode and map can be found by its own id', () => {
    for (const mode of MODES) expect(findMode(mode.id)).toBe(mode);
    for (const map of MAPS) expect(findMap(map.id)).toBe(map);
  });
});

describe('resolving a name off a save file', () => {
  it('returns the entry when it still exists', () => {
    expect(resolveModeId('DOM').id).toBe('DOM');
    expect(resolveMapId(DEFAULT_MAP_ID).id).toBe(DEFAULT_MAP_ID);
  });

  it('falls back rather than throwing, because the name came from an older build', () => {
    expect(resolveModeId('GUN_GAME').id).toBe(DEFAULT_MODE_ID);
    expect(resolveMapId('mp_retired').id).toBe(DEFAULT_MAP_ID);
  });

  it('falls back for an empty string too', () => {
    expect(resolveModeId('').id).toBe(DEFAULT_MODE_ID);
    expect(resolveMapId('').id).toBe(DEFAULT_MAP_ID);
  });
});

describe('which modes a map can offer', () => {
  it('offers a mode that needs no objective everywhere', () => {
    for (const map of MAPS) {
      expect(modesForMap(map.id).map((m) => m.id)).toContain('TDM');
    }
  });

  it('withholds a mode whose objective the map does not author', () => {
    // Read out of map data rather than from a table of which mode plays where.
    for (const map of MAPS) {
      const kinds = new Set(map.def.objectives.map((o) => o.kind));
      for (const mode of MODES) {
        const offered = modesForMap(map.id).some((m) => m.id === mode.id);
        if (mode.requiresObjective !== undefined && !kinds.has(mode.requiresObjective)) {
          expect(offered, `${mode.id} on ${map.id}`).toBe(false);
        }
      }
    }
  });

  it('offers a map-locked mode on its own map and nowhere else', () => {
    for (const mode of MODES) {
      if (mode.forcedMapId === null) continue;
      for (const map of MAPS) {
        const offered = modesForMap(map.id).some((m) => m.id === mode.id);
        expect(offered, `${mode.id} on ${map.id}`).toBe(map.id === mode.forcedMapId);
      }
    }
  });

  it('offers nothing for a map it has never heard of', () => {
    // No map means no objectives, so only the modes that need none survive the filter.
    const offered = modesForMap('mp_nowhere').map((m) => m.id);
    for (const id of offered) expect(findMode(id).requiresObjective).toBeUndefined();
  });

  it('offers at least one mode on every playable map', () => {
    for (const map of PLAYABLE_MAPS) expect(modesForMap(map.id).length).toBeGreaterThan(0);
  });
});

describe('the brief audit', () => {
  it('passes: every mode has a brief, and no two share one', () => {
    const audit = auditModeBriefs();
    expect(audit.problems).toEqual([]);
  });

  it('builds one row per registered mode, each naming the map it was built on', () => {
    const audit = auditModeBriefs();
    expect(audit.rows).toHaveLength(MODES.length);
    for (const row of audit.rows) {
      expect(row.brief.length).toBeGreaterThan(0);
      expect(() => findMap(row.mapId)).not.toThrow();
      expect(modesForMap(row.mapId).some((m) => m.id === row.id)).toBe(true);
    }
  });

  it('reports briefs that are genuinely distinct, which is what it is for', () => {
    // A banner that reads the same for two modes tells the player nothing about either.
    const briefs = auditModeBriefs().rows.map((r) => r.brief);
    expect(new Set(briefs).size).toBe(briefs.length);
  });
});
