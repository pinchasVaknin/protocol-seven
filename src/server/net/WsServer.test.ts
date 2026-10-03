import { describe, expect, it } from 'vitest';
import { staticCacheControl } from './WsServer';

/**
 * What a browser may keep without asking (part 5).
 *
 * The models were `no-cache` with no validator, so every match fetched every GLB again. A
 * versioned model URL is immutable now; anything whose bytes could change under the same name
 * must stay `no-cache`, or a deploy would never reach a browser that already has the old file.
 */
describe('staticCacheControl', () => {
  const IMMUTABLE = 'public, max-age=31536000, immutable';

  it('keeps fingerprinted build output for a year', () => {
    expect(staticCacheControl('/assets/index-3f9a.js', '')).toBe(IMMUTABLE);
  });

  it('keeps a model for a year when its URL carries a version', () => {
    expect(staticCacheControl('/models/weapons/m4.glb', 'v=2026-09-28-lods')).toBe(IMMUTABLE);
    expect(staticCacheControl('/models/bots/skins/Echo.glb', 'x=1&v=2026-09-28-slide')).toBe(IMMUTABLE);
  });

  it('asks again about a model with no version, since nothing would rename it', () => {
    expect(staticCacheControl('/models/props/sentry_turret.glb', '')).toBe('no-cache');
    expect(staticCacheControl('/models/props/sentry_turret.glb', 'v=')).toBe('no-cache');
    expect(staticCacheControl('/models/props/sentry_turret.glb', 'nv=1')).toBe('no-cache');
  });

  it('never lets the entry document or anything else outside the two be kept', () => {
    expect(staticCacheControl('index.html', '')).toBe('no-cache');
    expect(staticCacheControl('/maps/dunes.jpg', 'v=1')).toBe('no-cache');
    expect(staticCacheControl('/brand/logo.png', '')).toBe('no-cache');
    // Only the top-level folder counts: an "assets" deeper down is not Vite's.
    expect(staticCacheControl('/models/assets/x.glb', '')).toBe('no-cache');
  });
});
