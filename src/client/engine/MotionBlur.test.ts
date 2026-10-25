import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MotionBlur } from './MotionBlur';

/**
 * Accumulation motion blur, pinned before unit C2's refactor.
 *
 * The effect itself is three GPU passes, and what matters about it is the *order* of those
 * passes and the opacity each one is given — the two things that decide whether the history
 * survives, and the two things a reordering refactor would break silently. Both cross a real
 * boundary: the renderer is asked to bind a target, clear it and draw the quad, so a fake
 * renderer that records what it was asked to do pins the whole mechanism without a GL context.
 *
 * `WebGLRenderTarget` is only a descriptor until something renders into it, so the targets here
 * are the real class and their identity is what tells reallocation from reuse.
 */

// ====================================== the fake renderer =====================================

interface RenderCall {
  readonly op: 'render';
  /** The target bound when the quad was drawn. */
  readonly target: THREE.WebGLRenderTarget | null;
  readonly opacity: number;
  readonly texture: THREE.Texture | null;
}

interface TargetCall {
  readonly op: 'setRenderTarget';
  readonly target: THREE.WebGLRenderTarget | null;
}

interface ClearCall {
  readonly op: 'clear';
  readonly args: readonly [boolean, boolean, boolean];
}

interface DrawCall {
  readonly op: 'draw';
  readonly target: THREE.WebGLRenderTarget | null;
}

type Call = RenderCall | TargetCall | ClearCall | DrawCall;

interface Fake {
  readonly renderer: THREE.WebGLRenderer;
  readonly calls: Call[];
  /** What the canvas pass has to be put back to. */
  readonly canvasTarget: THREE.WebGLRenderTarget | null;
  size: { x: number; y: number };
}

function fakeRenderer(size = { x: 320, y: 180 }): Fake {
  const calls: Call[] = [];
  let bound: THREE.WebGLRenderTarget | null = null;
  const fake: Fake = {
    calls,
    canvasTarget: null,
    size,
    renderer: {
      outputColorSpace: THREE.SRGBColorSpace,
      getDrawingBufferSize: (target: THREE.Vector2): THREE.Vector2 => target.set(fake.size.x, fake.size.y),
      getRenderTarget: (): THREE.WebGLRenderTarget | null => bound,
      setRenderTarget: (target: THREE.WebGLRenderTarget | null): void => {
        bound = target;
        calls.push({ op: 'setRenderTarget', target });
      },
      clear: (color: boolean, depth: boolean, stencil: boolean): void => {
        calls.push({ op: 'clear', args: [color, depth, stencil] });
      },
      render: (scene: THREE.Scene): void => {
        const quad = scene.children[0] as THREE.Mesh | undefined;
        const material = quad?.material as THREE.ShaderMaterial | undefined;
        calls.push({
          op: 'render',
          target: bound,
          opacity: material?.uniforms['uOpacity']?.value as number,
          texture: (material?.uniforms['uTexture']?.value as THREE.Texture | null) ?? null,
        });
      },
    } as unknown as THREE.WebGLRenderer,
  };
  return fake;
}

/** Render one frame, recording where the scene itself was asked to be drawn. */
function frame(blur: MotionBlur, fake: Fake): void {
  blur.render(fake.renderer, () => {
    fake.calls.push({ op: 'draw', target: fake.renderer.getRenderTarget() });
  });
}

function ops(fake: Fake): string[] {
  return fake.calls.map((call) => call.op);
}

function renders(fake: Fake): RenderCall[] {
  return fake.calls.filter((call): call is RenderCall => call.op === 'render');
}

function targets(fake: Fake): Array<THREE.WebGLRenderTarget | null> {
  return fake.calls
    .filter((call): call is TargetCall => call.op === 'setRenderTarget')
    .map((call) => call.target);
}

// ======================================== the test cases ======================================

describe('MotionBlur: the three passes', () => {
  it('draws the frame into its own target, blends it onto the history, and blits that', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    expect(ops(fake)).toEqual([
      'setRenderTarget',
      'clear',
      'draw',
      'setRenderTarget',
      'render',
      'setRenderTarget',
      'clear',
      'render',
    ]);
    blur.dispose();
  });

  it('binds its scene target for the draw and the canvas for the blit', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    const bound = targets(fake);
    const sceneTarget = bound[0];
    const accumTarget = bound[1];
    expect(sceneTarget).not.toBeNull();
    expect(accumTarget).not.toBeNull();
    expect(accumTarget).not.toBe(sceneTarget);
    // The history is never the thing the world was drawn into, or the fade has nothing to fade.
    expect(bound[2]).toBe(null);
    blur.dispose();
  });

  it('clears colour and depth for the two passes that clear, and never stencil', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    const clears = fake.calls.filter((call): call is ClearCall => call.op === 'clear');
    expect(clears.length).toBe(2);
    expect(clears[0]?.args).toEqual([true, true, false]);
    expect(clears[1]?.args).toEqual([true, true, false]);
    blur.dispose();
  });

  it('samples the scene target onto the history and the history onto the canvas', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    const bound = targets(fake);
    const drawn = renders(fake);
    expect(drawn[0]?.texture).toBe((bound[0] as THREE.WebGLRenderTarget).texture);
    expect(drawn[1]?.texture).toBe((bound[1] as THREE.WebGLRenderTarget).texture);
    blur.dispose();
  });

  it('calls the frame closure exactly once, with its own target bound', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    const draws = fake.calls.filter((call): call is DrawCall => call.op === 'draw');
    expect(draws.length).toBe(1);
    expect(draws[0]?.target).toBe(targets(fake)[0]);
    blur.dispose();
  });
});

describe('MotionBlur: the accumulation strength', () => {
  it('blends the first frame at full strength, so the effect does not fade in from black', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    expect(renders(fake)[0]?.opacity).toBe(1);
    blur.dispose();
  });

  it('blends every later frame at the configured strength', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    fake.calls.length = 0;
    frame(blur, fake);
    frame(blur, fake);
    const drawn = renders(fake);
    expect(drawn[0]?.opacity).toBe(0.44999999999999996);
    expect(drawn[2]?.opacity).toBe(0.44999999999999996);
    blur.dispose();
  });

  it('blits the history to the canvas opaque', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    frame(blur, fake);
    expect(renders(fake)[3]?.opacity).toBe(1);
    blur.dispose();
  });

  it('reset puts the next frame back to full strength', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    frame(blur, fake);
    blur.reset();
    fake.calls.length = 0;
    frame(blur, fake);
    expect(renders(fake)[0]?.opacity).toBe(1);
    blur.dispose();
  });
});

describe('MotionBlur: the render targets', () => {
  it('reuses its targets while the drawing buffer keeps its size', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    const first = targets(fake).slice(0, 2);
    fake.calls.length = 0;
    frame(blur, fake);
    expect(targets(fake).slice(0, 2)).toEqual(first);
    blur.dispose();
  });

  it('reallocates on a size change and starts cold again', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    frame(blur, fake);
    const before = targets(fake)[0];
    fake.calls.length = 0;
    fake.size = { x: 640, y: 360 };
    frame(blur, fake);
    const after = targets(fake)[0];
    expect(after).not.toBe(before);
    expect((after as THREE.WebGLRenderTarget).width).toBe(640);
    expect((after as THREE.WebGLRenderTarget).height).toBe(360);
    // A reallocated history holds nothing, so the frame after a resize is a first frame.
    expect(renders(fake)[0]?.opacity).toBe(1);
    blur.dispose();
  });

  it('gives the scene target a depth buffer and the history none', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    const bound = targets(fake);
    expect((bound[0] as THREE.WebGLRenderTarget).depthBuffer).toBe(true);
    expect((bound[1] as THREE.WebGLRenderTarget).depthBuffer).toBe(false);
    expect((bound[0] as THREE.WebGLRenderTarget).stencilBuffer).toBe(false);
    blur.dispose();
  });

  it('floors a fractional drawing buffer, and never below one texel', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer({ x: 0.4, y: 10.9 });
    frame(blur, fake);
    const sceneTarget = targets(fake)[0] as THREE.WebGLRenderTarget;
    expect(sceneTarget.width).toBe(1);
    expect(sceneTarget.height).toBe(10);
    blur.dispose();
  });

  it('dispose drops the targets, so the frame after it allocates fresh ones', () => {
    const blur = new MotionBlur();
    const fake = fakeRenderer();
    frame(blur, fake);
    const before = targets(fake)[0];
    blur.dispose();
    fake.calls.length = 0;
    frame(blur, fake);
    expect(targets(fake)[0]).not.toBe(before);
    expect(renders(fake)[0]?.opacity).toBe(1);
    blur.dispose();
  });
});
