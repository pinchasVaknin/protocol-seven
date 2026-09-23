import { describe, expect, it } from 'vitest';
import { handPoseFor, handPoseSource, NEUTRAL_HAND_POSE } from './HandPoses';

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
    });
    expect(text).toBe(
      [
        '  ar_carbine: {',
        '    grip: { position: [0.010, 0.000, 0.000], rotation: [-5.0, 0.0, 12.3], curl: 1.10 },',
        '    support: { position: [-0.020, 0.015, -0.030], rotation: [0.0, 0.0, 0.0], curl: 0.90 },',
        '  },',
      ].join('\n'),
    );
  });
});
