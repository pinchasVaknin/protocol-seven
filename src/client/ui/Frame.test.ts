import { describe, expect, it } from 'vitest';
import { FRAME_HEIGHT, FRAME_WIDTH, frameScale, frameViewport } from './Frame';

/**
 * The design frame's one number (M15, Phase A1). Pure, so it is tested here; the element half
 * of `Frame.ts` needs a document and is measured by the layout probe instead.
 */
describe('frameScale', () => {
  it('is exactly 1 at the design size', () => {
    expect(frameScale(FRAME_WIDTH, FRAME_HEIGHT)).toBe(1);
  });

  it('is bound by the tighter axis', () => {
    // 16:9 windows scale by either axis alike.
    expect(frameScale(1280, 720)).toBeCloseTo(2 / 3, 12);
    // The round-5 playtest window: the height is the constraint, and the frame is 58% wide.
    expect(frameScale(1366, 626)).toBeCloseTo(626 / 1080, 12);
    // An ultrawide: the height caps it at 1, the extra width is gutter.
    expect(frameScale(2560, 1080)).toBe(1);
    // Taller than wide: the width caps it.
    expect(frameScale(375, 812)).toBeCloseTo(375 / 1920, 12);
  });

  it('has no lower clamp — the rule holds below the floor', () => {
    expect(frameScale(800, 600)).toBeCloseTo(800 / 1920, 12);
    expect(frameScale(0, 0)).toBe(0);
  });
});

/**
 * The viewport box (playtest round 3, R1.1): the window over the scale, so a header mounted
 * on it reaches the window's edges. At least the frame on both axes, exact on the one that
 * set the scale.
 */
describe('frameViewport', () => {
  it('is the frame at the design size and at any 16:9 window', () => {
    expect(frameViewport(1920, 1080)).toEqual({ scale: 1, width: 1920, height: 1080 });
    const box = frameViewport(1280, 720);
    expect(box.width).toBeCloseTo(1920, 9);
    expect(box.height).toBeCloseTo(1080, 9);
  });

  it('is wider than the frame where the window is wider than 16:9, and exactly as tall', () => {
    // The maximised-browser shape the round-3 report was made on: 107 px of gutter each side.
    const box = frameViewport(1280, 600);
    expect(box.height).toBeCloseTo(1080, 9);
    expect(box.width).toBeCloseTo(2304, 9);
    expect(box.width * box.scale).toBeCloseTo(1280, 9);
  });

  it('is taller than the frame where the window is taller, and exactly as wide', () => {
    const box = frameViewport(375, 812);
    expect(box.width).toBeCloseTo(1920, 9);
    expect(box.height).toBeCloseTo(812 / (375 / 1920), 9);
  });

  it('is the frame for a window that has no size yet', () => {
    expect(frameViewport(0, 0)).toEqual({ scale: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT });
  });
});
