import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS, findMap } from '../../shared/modes/ModeRegistry';
import { SKY_PROFILE_SAMPLES, skylineProfile } from '../../shared/world/SkyProfile';
import type { MapDef } from '../../shared/world/maps/types';
import { SKY_LAYER } from '../engine/Renderer';
import { SkyDome } from './SkyDome';

/**
 * Characterization tests for the sky dome (C10).
 *
 * Written against the unmodified file and green on it before a line of production code moved.
 * Everything the dome decides — the uniforms, the disc's direction, the ridge texture, the
 * layer and the render order — is CPU-side three.js, so it is all reachable without WebGL.
 */

/** A map stripped to the fields the dome reads, so a case can be stated in one object. */
function skyMap(overrides: Partial<MapDef['ambient']> & { lights?: MapDef['lights'] } = {}): MapDef {
  const { lights, ...ambient } = overrides;
  return {
    id: 'mp_case',
    name: 'CASE',
    brushes: [],
    props: [],
    spawns: [],
    lights: lights ?? [],
    ambient: {
      fogColor: 0x203040,
      fogNear: 10,
      fogFar: 100,
      sky: {
        zenith: 0x4060a0,
        falloff: 1.4,
        disc: { color: 0xfff0d0, sizeDeg: 1.5, glowDeg: 12, intensity: 2 },
      },
      ...ambient,
    } as MapDef['ambient'],
    coverPoints: [],
    navBounds: { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 6, z: 10 } },
  } as unknown as MapDef;
}

function uniformsOf(dome: SkyDome): Record<string, THREE.IUniform> {
  return (dome.mesh.material as THREE.ShaderMaterial).uniforms;
}

describe('SkyDome mesh', () => {
  it('is one unlit back-faced sphere that never writes depth and is never culled', () => {
    const dome = new SkyDome(skyMap());
    const material = dome.mesh.material as THREE.ShaderMaterial;
    expect(dome.mesh.name).toBe('sky');
    expect(dome.mesh.frustumCulled).toBe(false);
    expect(dome.mesh.renderOrder).toBe(-1);
    expect(dome.mesh.castShadow).toBe(false);
    expect(dome.mesh.receiveShadow).toBe(false);
    expect(material.side).toBe(THREE.BackSide);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
  });

  it('sits on the sky layer alone, so the thermal and shadow cameras never see it', () => {
    const dome = new SkyDome(skyMap());
    expect(dome.mesh.layers.mask).toBe(1 << SKY_LAYER);
    expect(dome.mesh.layers.test(new THREE.Layers())).toBe(false);
  });

  it('reports the triangles it adds to a frame', () => {
    const dome = new SkyDome(skyMap());
    // 24 x 16 segments on a unit sphere.
    expect(dome.triangleCount).toBe(720);
  });

  it('pins the vertex and fragment shaders it compiles', () => {
    const material = new SkyDome(skyMap()).mesh.material as THREE.ShaderMaterial;
    expect(material.vertexShader).toContain('gl_Position = pos.xyww');
    expect(material.vertexShader).toContain('mat4(mat3(modelViewMatrix))');
    expect(material.fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
    // The horizon floor that keeps pow(0, x) out of the drivers' hands.
    expect(material.fragmentShader).toContain('clamp(dir.y, 1e-5, 1.0)');
  });
});

describe('SkyDome uniforms', () => {
  it('decodes the authored colours into the renderer working space', () => {
    const dome = new SkyDome(skyMap());
    const u = uniformsOf(dome);
    expect((u['uHorizon']?.value as THREE.Color).getHex()).toBe(0x203040);
    expect((u['uZenith']?.value as THREE.Color).getHex()).toBe(0x4060a0);
    expect((u['uDiscColor']?.value as THREE.Color).getHex()).toBe(0xfff0d0);
  });

  it('holds the falloff to a floor of 0.05', () => {
    expect(uniformsOf(new SkyDome(skyMap()))['uFalloff']?.value).toBe(1.4);
  });

  it('turns the disc angles into cosines, with the glow never tighter than the disc', () => {
    const u = uniformsOf(new SkyDome(skyMap()));
    const discRad = (1.5 * Math.PI) / 180;
    const glowRad = (12 * Math.PI) / 180;
    expect(u['uDiscCos']?.value).toBe(Math.cos(discRad));
    expect(u['uDiscEdge']?.value).toBe(Math.cos(discRad * 0.55));
    expect(u['uGlowCos']?.value).toBe(Math.cos(glowRad));
  });

  it('widens a glow that was authored narrower than the disc', () => {
    const def = skyMap();
    def.ambient.sky.disc = { color: 0xffffff, sizeDeg: 10, glowDeg: 2, intensity: 1 };
    const u = uniformsOf(new SkyDome(def));
    expect(u['uGlowCos']?.value).toBe(Math.cos((10 * Math.PI) / 180));
  });
});

describe('SkyDome disc placement', () => {
  const directional = (x: number, y: number, z: number): MapDef['lights'] => [
    {
      kind: 'directional',
      color: 0xffffff,
      intensity: 2,
      direction: { x, y, z },
      castShadow: false,
      shadowExtent: 40,
    } as MapDef['lights'][number],
  ];

  it('puts the disc at the negation of the key light, normalised', () => {
    const u = uniformsOf(new SkyDome(skyMap({ lights: directional(-0.6, -0.8, 0) })));
    const sun = u['uSunDir']?.value as THREE.Vector3;
    expect(sun.x).toBeCloseTo(0.6, 12);
    expect(sun.y).toBeCloseTo(0.8, 12);
    expect(sun.z).toBeCloseTo(0, 12);
    expect(sun.length()).toBeCloseTo(1, 12);
    expect(u['uDiscIntensity']?.value).toBe(2);
  });

  it('reads the first directional light and ignores the rest', () => {
    const lights = [
      { kind: 'hemisphere', skyColor: 0x202020, groundColor: 0x101010, intensity: 1 },
      ...directional(0, -1, 0),
      ...directional(1, 0, 0),
    ] as MapDef['lights'];
    const sun = uniformsOf(new SkyDome(skyMap({ lights })))['uSunDir']?.value as THREE.Vector3;
    expect(sun.toArray().map((v) => v + 0)).toEqual([0, 1, 0]);
  });

  it('draws no disc at all on a map with no directional light', () => {
    const u = uniformsOf(new SkyDome(skyMap({ lights: [] })));
    expect((u['uSunDir']?.value as THREE.Vector3).toArray()).toEqual([0, 1, 0]);
    expect(u['uDiscIntensity']?.value).toBe(0);
  });

  it('draws no disc for a degenerate direction either', () => {
    const u = uniformsOf(new SkyDome(skyMap({ lights: directional(0, 0, 0) })));
    expect((u['uSunDir']?.value as THREE.Vector3).toArray()).toEqual([0, 1, 0]);
    expect(u['uDiscIntensity']?.value).toBe(0);
  });

  it('never lets a negative authored intensity reach the shader', () => {
    const def = skyMap({ lights: directional(0, -1, 0) });
    def.ambient.sky.disc = { color: 0xffffff, sizeDeg: 1, glowDeg: 1, intensity: -3 };
    expect(uniformsOf(new SkyDome(def))['uDiscIntensity']?.value).toBe(0);
  });
});

describe('SkyDome ridge profile', () => {
  it('uploads no profile and no ridge for a map without a skyline', () => {
    const u = uniformsOf(new SkyDome(skyMap()));
    expect(u['uProfile']?.value).toBe(null);
    expect(u['uHasSkyline']?.value).toBe(0);
    expect(u['uSkylinePeak']?.value).toBe(0);
    expect((u['uSkylineColor']?.value as THREE.Color).getHex()).toBe(0x000000);
  });

  it('builds a 512 x 1 red texture that wraps in azimuth and does not mip', () => {
    const def = skyMap();
    def.ambient.sky.skyline = { color: 0x30262a, heightDeg: 9, count: 26, hardness: 0.2, seed: 7 };
    const texture = uniformsOf(new SkyDome(def))['uProfile']?.value as THREE.DataTexture;
    expect(texture.image.width).toBe(SKY_PROFILE_SAMPLES);
    expect(texture.image.height).toBe(1);
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.generateMipmaps).toBe(false);
  });

  it('stores each sample as its fraction of the authored peak, in a byte', () => {
    const skyline = { color: 0x30262a, heightDeg: 9, count: 26, hardness: 0.2, seed: 7 };
    const def = skyMap();
    def.ambient.sky.skyline = skyline;
    const texture = uniformsOf(new SkyDome(def))['uProfile']?.value as THREE.DataTexture;
    const data = texture.image.data as Uint8Array;
    const profile = skylineProfile(skyline, SKY_PROFILE_SAMPLES);
    const peak = (skyline.heightDeg * Math.PI) / 180;
    for (let i = 0; i < SKY_PROFILE_SAMPLES; i++) {
      expect(data[i]).toBe(Math.max(0, Math.min(255, Math.round(((profile[i] ?? 0) / peak) * 255))));
    }
    expect(uniformsOf(new SkyDome(def))['uSkylinePeak']?.value).toBe(peak);
    expect(uniformsOf(new SkyDome(def))['uHasSkyline']?.value).toBe(1);
  });

  it('writes a flat profile rather than dividing by a zero peak', () => {
    const def = skyMap();
    def.ambient.sky.skyline = { color: 0x111111, heightDeg: 0, count: 8, hardness: 0, seed: 1 };
    const texture = uniformsOf(new SkyDome(def))['uProfile']?.value as THREE.DataTexture;
    const data = texture.image.data as Uint8Array;
    expect([...data].every((v) => v === 0)).toBe(true);
  });
});

describe('SkyDome over the shipped maps', () => {
  it('pins each map\'s uniforms', () => {
    const rows = MAPS.map((entry) => {
      const u = uniformsOf(new SkyDome(entry.def));
      const sun = u['uSunDir']?.value as THREE.Vector3;
      const profile = u['uProfile']?.value as THREE.DataTexture | null;
      return [
        entry.id,
        (u['uHorizon']?.value as THREE.Color).getHexString(),
        (u['uZenith']?.value as THREE.Color).getHexString(),
        `falloff=${String(u['uFalloff']?.value)}`,
        `sun=${sun.x.toFixed(4)},${sun.y.toFixed(4)},${sun.z.toFixed(4)}`,
        `disc=${String(u['uDiscIntensity']?.value)}`,
        `skyline=${String(u['uHasSkyline']?.value)}`,
        `profile=${profile === null ? 'none' : String(profile.image.width)}`,
      ].join(' ');
    });
    expect(rows).toMatchInlineSnapshot(`
      [
        "mp_foundry 272b33 0f1730 falloff=0.85 sun=-0.3813,0.8228,-0.4214 disc=1.25 skyline=1 profile=512",
        "mp_dunes c9ae83 5f8fc4 falloff=0.62 sun=-0.2004,0.9416,-0.2705 disc=1.5 skyline=1 profile=512",
        "mp_depot 2c3444 0d1424 falloff=1.45 sun=0.2998,0.8794,0.3698 disc=0.9 skyline=1 profile=512",
        "mp_testbed 1b2028 2c3d5c falloff=1 sun=-0.4197,0.7995,-0.4297 disc=1.1 skyline=0 profile=none",
      ]
    `);
  });

  it('frees the geometry, the material and the profile', () => {
    const dome = new SkyDome(findMap('mp_dunes').def);
    const freed: string[] = [];
    dome.mesh.geometry.addEventListener('dispose', () => freed.push('geometry'));
    (dome.mesh.material as THREE.Material).addEventListener('dispose', () => freed.push('material'));
    (uniformsOf(dome)['uProfile']?.value as THREE.DataTexture).addEventListener('dispose', () => freed.push('profile'));
    dome.dispose();
    expect(freed.sort()).toEqual(['geometry', 'material', 'profile']);
  });

  it('frees cleanly on a map that has no profile to free', () => {
    const dome = new SkyDome(skyMap());
    expect(() => dome.dispose()).not.toThrow();
  });
});
