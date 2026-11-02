import { describe, expect, it } from 'vitest';
import {
  HAND_POSES,
  HAND_WRAPS,
  handPoseFor,
  handPoseSource,
  handWrapFor,
  handWrapSource,
  NEUTRAL_HAND_POSE,
  SHIELD_PLATE_OFFSET_ID,
  VIEWMODEL_OFFSETS,
  viewmodelOffsetFor,
  viewmodelOffsetSource,
  ZERO_VIEWMODEL_OFFSET,
  type HandSide,
} from './HandPoses';

/**
 * Three tables, their fallbacks, and the three printers the hand tuner writes back with.
 *
 * Every number in here was posed by a person with a slider, so there is nothing to derive and
 * nothing to check against a formula. What there is to check is the shape: that a weapon with
 * no row still holds its weapon, that nobody left half a row behind, and that what the tuner
 * prints is what the file would have to contain for the pose to survive a refresh.
 */

const SIDES: readonly HandSide[] = ['grip', 'support', 'reload'];

/** Every id any of the three tables knows about. */
const KNOWN = [...new Set([...Object.keys(HAND_POSES), ...Object.keys(HAND_WRAPS), ...Object.keys(VIEWMODEL_OFFSETS)])];


describe('handPoseFor', () => {
  it('holds a weapon with no entry with the neutral pose', () => {
    expect(handPoseFor('no_such_weapon', 'grip')).toBe(NEUTRAL_HAND_POSE);
    expect(handPoseFor('no_such_weapon', 'support')).toBe(NEUTRAL_HAND_POSE);
  });
});

describe('handPoseSource', () => {
  it('prints an entry in the table\'s own shape, with no negative zeros', () => {
    const text = handPoseSource('ar_carbine', {
      grip: { position: [0.01, -0.0004, 0], rotation: [-5, 0, 12.34], curl: 1.1 },
      support: { position: [-0.02, 0.015, -0.03], rotation: [0, -0.04, 0], curl: 0.9 },
      reload: { position: [0, 0, 0.01], rotation: [10, 0, 0], curl: 1 },
    });
    expect(text).toBe(
      [
        '  ar_carbine: {',
        '    grip: { position: [0.010, 0.000, 0.000], rotation: [-5.0, 0.0, 12.3], curl: 1.10 },',
        '    support: { position: [-0.020, 0.015, -0.030], rotation: [0.0, 0.0, 0.0], curl: 0.90 },',
        '    reload: { position: [0.000, 0.000, 0.010], rotation: [10.0, 0.0, 0.0], curl: 1.00 },',
        '  },',
      ].join('\n'),
    );
  });
});

describe('the tables', () => {
  it('names something in all three', () => {
    expect(Object.keys(HAND_POSES).length).toBeGreaterThan(5);
    expect(Object.keys(HAND_WRAPS).length).toBeGreaterThan(0);
    expect(Object.keys(VIEWMODEL_OFFSETS).length).toBeGreaterThan(0);
  });

  it('leaves no half-written row: every pose has all three numbers', () => {
    for (const [id, row] of Object.entries(HAND_POSES)) {
      for (const side of SIDES) {
        const pose = row[side];
        if (pose === undefined) continue;
        expect(pose.position, `${id}.${side}`).toHaveLength(3);
        expect(pose.rotation, `${id}.${side}`).toHaveLength(3);
        for (const v of [...pose.position, ...pose.rotation, pose.curl]) {
          expect(Number.isFinite(v), `${id}.${side}`).toBe(true);
        }
        // A curl multiplier of zero is a hand that does not close; negative is nonsense.
        expect(pose.curl, `${id}.${side}`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every wrap five fingers of three segments', () => {
    for (const [id, row] of Object.entries(HAND_WRAPS)) {
      for (const side of ['grip', 'support'] as const) {
        const wrap = row[side];
        if (wrap === undefined) continue;
        for (const finger of ['thumb', 'index', 'middle', 'ring', 'pink'] as const) {
          expect(wrap[finger], `${id}.${side}.${finger}`).toHaveLength(3);
          for (const v of wrap[finger]) expect(Number.isFinite(v), `${id}.${side}.${finger}`).toBe(true);
        }
      }
    }
  });

  it('gives every offset a position and a rotation', () => {
    for (const [id, offset] of Object.entries(VIEWMODEL_OFFSETS)) {
      expect(offset.position, id).toHaveLength(3);
      expect(offset.rotation, id).toHaveLength(3);
      for (const v of [...offset.position, ...offset.rotation]) expect(Number.isFinite(v), id).toBe(true);
    }
  });

  it('keeps the shield’s plate under an id of its own', () => {
    // The weapon under the animator in shield mode is the pistol the streak gives you, so the
    // plate cannot share its row: reading one offset for both put the plate on the pistol.
    expect(SHIELD_PLATE_OFFSET_ID).toBe('streak_shield_plate');
    expect(VIEWMODEL_OFFSETS[SHIELD_PLATE_OFFSET_ID]).toBeDefined();
    expect(viewmodelOffsetFor(SHIELD_PLATE_OFFSET_ID)).not.toBe(viewmodelOffsetFor('streak_shield'));
  });
});

describe('the fallbacks', () => {
  it('holds a weapon with no row in every table, rather than failing', () => {
    for (const side of SIDES) expect(handPoseFor('no_such_weapon', side)).toBe(NEUTRAL_HAND_POSE);
    for (const side of ['grip', 'support'] as const) expect(handWrapFor('no_such_weapon', side)).toBeNull();
    expect(viewmodelOffsetFor('no_such_weapon')).toBe(ZERO_VIEWMODEL_OFFSET);
  });

  it('falls back a side at a time, so a row with one hand posed keeps the other neutral', () => {
    const partial = KNOWN.find((id) => SIDES.some((s) => HAND_POSES[id]?.[s] === undefined) && HAND_POSES[id] !== undefined);
    if (partial === undefined) return;
    for (const side of SIDES) {
      const own = HAND_POSES[partial]?.[side];
      expect(handPoseFor(partial, side), `${partial}.${side}`).toBe(own ?? NEUTRAL_HAND_POSE);
    }
  });

  it('is neutral in the only way neutral can mean: nothing added anywhere', () => {
    expect(NEUTRAL_HAND_POSE.position).toEqual([0, 0, 0]);
    expect(NEUTRAL_HAND_POSE.rotation).toEqual([0, 0, 0]);
    expect(NEUTRAL_HAND_POSE.curl).toBe(1);
    expect(ZERO_VIEWMODEL_OFFSET.position).toEqual([0, 0, 0]);
    expect(ZERO_VIEWMODEL_OFFSET.rotation).toEqual([0, 0, 0]);
  });

  it('hands back the table’s own object, which is what the tuner then edits', () => {
    const id = Object.keys(HAND_POSES)[0] as string;
    const side = SIDES.find((s) => HAND_POSES[id]?.[s] !== undefined) as HandSide;
    expect(handPoseFor(id, side)).toBe(HAND_POSES[id]?.[side]);
  });
});

describe('what the tuner prints', () => {
  it('prints only the hands it was asked for, since a knife holds with one', () => {
    const one = handPoseSource('knife', { grip: NEUTRAL_HAND_POSE, support: NEUTRAL_HAND_POSE, reload: NEUTRAL_HAND_POSE }, ['grip']);
    expect(one.split('\n')).toHaveLength(3);
    expect(one).toContain('grip:');
    expect(one).not.toContain('support:');
  });

  it('prints a wrap as whole degrees, which is all a finger needs', () => {
    const text = handWrapSource('eq_frag', {
      grip: { thumb: [10.4, 20.6, 30], index: [1, 2, 3], middle: [1, 2, 3], ring: [1, 2, 3], pink: [1, 2, 3] },
    });
    expect(text.startsWith('  eq_frag: {')).toBe(true);
    expect(text).toContain('thumb: [10, 21, 30]');
    expect(text).not.toContain('support:');
    expect(text.endsWith('  },')).toBe(true);
  });

  it('prints an offset on one line, with no negative zeros', () => {
    const text = viewmodelOffsetSource('streak_minigun', { position: [0.208, -0.0004, 0], rotation: [6.5, -0.04, 0] });
    expect(text).toBe('  streak_minigun: { position: [0.208, 0.000, 0.000], rotation: [6.5, 0.0, 0.0] },');
  });

  it('prints every shipped row in a shape the file would accept back', () => {
    for (const [id, offset] of Object.entries(VIEWMODEL_OFFSETS)) {
      const text = viewmodelOffsetSource(id, offset);
      expect(text.startsWith(`  ${id}: { position: [`), id).toBe(true);
      expect(text.endsWith('] },'), id).toBe(true);
      expect(text, id).not.toContain('-0.000');
      expect(text, id).not.toContain('-0.0,');
    }
  });
});
