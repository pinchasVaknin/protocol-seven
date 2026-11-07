import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRelation } from '../../shared/ui/TeamColour';
import { palette } from '../ui/Palette';
import { CarePackageMesh, SentryMesh } from './StreakMeshes';

/**
 * `sentryModel()` is mocked so both halves are reachable: null gives the box fallback, a scene
 * gives the shipped turret. Everything else is three.js and the palette, which need no DOM —
 * only `document.documentElement.style`, because `palette.set` writes custom properties.
 */

let template: THREE.Object3D | null = null;

vi.mock('./SentryModel', async (importOriginal) => {
  const original = await importOriginal<typeof import('./SentryModel')>();
  return { ...original, sentryModel: (): THREE.Object3D | null => template };
});

function turret(): THREE.Object3D {
  const root = new THREE.Object3D();
  const yaw = new THREE.Object3D();
  yaw.name = 'sentry_turret_yaw';
  const pitch = new THREE.Object3D();
  pitch.name = 'sentry_turret_pitch';
  const band = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'iff' }));
  const armour = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'armour' }));
  pitch.add(band, armour);
  yaw.add(pitch);
  root.add(yaw);
  return root;
}

function sprites(mesh: SentryMesh): { frame?: THREE.Sprite; fill?: THREE.Sprite } {
  const all = mesh.group.children.filter((c): c is THREE.Sprite => c.type === 'Sprite');
  return {
    frame: all.find((s) => s.renderOrder === 10),
    fill: all.find((s) => s.renderOrder === 11),
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>)['document'] = {
    documentElement: { style: { setProperty: (): undefined => undefined } },
  };
  palette.set('off');
  template = null;
});

afterEach(() => {
  palette.set('off');
});

describe('CarePackageMesh', () => {
  it('stands a crate under a bright post where it was dropped', () => {
    const crate = new CarePackageMesh(2, 9, -3);
    expect(crate.group.position.toArray()).toEqual([2, 9, -3]);
    expect(crate.group.children).toHaveLength(2);
    expect(crate.group.children[1]?.position.y).toBeCloseTo(1.9, 10);
  });

  it('casts and receives shadows on the crate, and lights the beacon flat', () => {
    const crate = new CarePackageMesh(0, 0, 0);
    const box = crate.group.children[0] as THREE.Mesh;
    const beacon = crate.group.children[1] as THREE.Mesh;
    expect(box.castShadow).toBe(true);
    expect(box.receiveShadow).toBe(true);
    expect((beacon.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
  });

  it('falls on y alone', () => {
    const crate = new CarePackageMesh(2, 9, -3);
    crate.setHeight(1.25);
    expect(crate.group.position.toArray()).toEqual([2, 1.25, -3]);
  });

  it('unparents itself and releases what it owns on dispose', () => {
    const scene = new THREE.Group();
    const crate = new CarePackageMesh(0, 0, 0);
    scene.add(crate.group);
    let disposed = 0;
    (crate.group.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => disposed++);
    crate.dispose();
    expect(crate.group.children).toHaveLength(0);
    expect(crate.group.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect(disposed).toBe(1);
  });
});

describe('SentryMesh, as boxes', () => {
  it('stands three legs, a turret and a health bar where it was placed', () => {
    const sentry = new SentryMesh(1, 0, -5, 0.4, 'HOSTILE');
    expect(sentry.group.position.toArray()).toEqual([1, 0, -5]);
    expect(sentry.group.rotation.y).toBeCloseTo(0.4, 10);
    const meshes = sentry.group.children.filter((c) => c.type === 'Mesh');
    expect(meshes).toHaveLength(3);
    expect(sentry.group.children.filter((c) => c.type === 'Group')).toHaveLength(1);
  });

  it('tints the body by what the sentry is to the viewer, at half brightness', () => {
    const friendly = new SentryMesh(0, 0, 0, 0, 'FRIENDLY');
    const hostile = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const bodyOf = (m: SentryMesh): THREE.MeshStandardMaterial => {
      const turretGroup = m.group.children.find((c) => c.type === 'Group') as THREE.Group;
      return (turretGroup.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    };
    expect(bodyOf(friendly).color.getHex()).not.toBe(bodyOf(hostile).color.getHex());
    const half = new THREE.Color(palette.current.hostile).multiplyScalar(0.5).getHex();
    expect(bodyOf(hostile).color.getHex()).toBe(half);
  });

  it('pitches with the yaw node, because a box turret has only one', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const turretGroup = sentry.group.children.find((c) => c.type === 'Group') as THREE.Group;
    sentry.aim(0.9, -0.3);
    expect(turretGroup.rotation.y).toBeCloseTo(0.9, 10);
    expect(turretGroup.rotation.x).toBeCloseTo(-0.3, 10);
  });
});

describe('SentryMesh, as the shipped turret', () => {
  beforeEach(() => {
    template = turret();
  });

  it('clones the model rather than adding the template itself', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const clone = sentry.group.children.find((c) => c.type === 'Object3D');
    expect(clone).toBeDefined();
    expect(clone).not.toBe(template);
  });

  it('aims the two authored nodes separately', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    sentry.aim(1.1, -0.4);
    const clone = sentry.group.children.find((c) => c.type === 'Object3D');
    const yaw = clone?.getObjectByName('sentry_turret_yaw');
    const pitch = clone?.getObjectByName('sentry_turret_pitch');
    expect(yaw?.rotation.y).toBeCloseTo(1.1, 10);
    expect(pitch?.rotation.x).toBeCloseTo(-0.4, 10);
  });

  it('repaints only the IFF band, and leaves the armour alone', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const clone = sentry.group.children.find((c) => c.type === 'Object3D');
    const materials: THREE.Material[] = [];
    clone?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh === true) materials.push(mesh.material as THREE.Material);
    });
    const basic = materials.filter((m) => m instanceof THREE.MeshBasicMaterial);
    expect(basic).toHaveLength(1);
    expect((basic[0] as THREE.MeshBasicMaterial).color.getHex()).toBe(palette.current.hostile);
    expect(materials.filter((m) => m.name === 'armour')).toHaveLength(1);
  });

  it('gives two sentries on opposite sides two different bands out of one file', () => {
    const friendly = new SentryMesh(0, 0, 0, 0, 'FRIENDLY');
    const hostile = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const bandOf = (m: SentryMesh): THREE.MeshBasicMaterial => {
      let found: THREE.MeshBasicMaterial | null = null;
      m.group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh === true && mesh.material instanceof THREE.MeshBasicMaterial) found = mesh.material;
      });
      return found as unknown as THREE.MeshBasicMaterial;
    };
    expect(bandOf(friendly).color.getHex()).toBe(palette.current.friendly);
    expect(bandOf(hostile).color.getHex()).toBe(palette.current.hostile);
  });

  it('throws when the build’s node contract has changed', () => {
    template = new THREE.Object3D();
    expect(() => new SentryMesh(0, 0, 0, 0, 'HOSTILE')).toThrow(/node contract/);
  });
});

describe('the sentry health bar', () => {
  const relations: TeamRelation[] = ['FRIENDLY', 'HOSTILE', 'NEUTRAL'];

  it('wears the IFF colour, so it reads as whose before how much', () => {
    for (const relation of relations) {
      const sentry = new SentryMesh(0, 0, 0, 0, relation);
      const { fill } = sprites(sentry);
      const expected =
        relation === 'FRIENDLY' ? palette.current.friendly : relation === 'HOSTILE' ? palette.current.hostile : palette.current.neutral;
      expect((fill?.material as THREE.SpriteMaterial).color.getHex()).toBe(expected);
    }
  });

  it('floats clear of the barrel, with the frame behind the fill', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const { frame, fill } = sprites(sentry);
    expect(frame?.position.y).toBeCloseTo(1.3, 10);
    expect(fill?.position.y).toBeCloseTo(1.3, 10);
    expect((frame?.renderOrder ?? 0) < (fill?.renderOrder ?? 0)).toBe(true);
  });

  it('draws the frame larger than the fill by the border, on both axes', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const { frame } = sprites(sentry);
    expect(frame?.scale.x).toBeCloseTo(0.7 + 0.025 * 2, 10);
    expect(frame?.scale.y).toBeCloseTo(0.07 + 0.025 * 2, 10);
  });

  it('gives up length from the right, keeping its left edge on the frame’s', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const { fill } = sprites(sentry);
    for (const fraction of [1, 0.75, 0.5, 0.25]) {
      sentry.setHealth(fraction);
      expect(fill?.scale.x).toBeCloseTo(0.7 * fraction, 10);
      expect(fill?.center.x).toBeCloseTo(0.5 / fraction, 10);
      expect(fill?.visible).toBe(true);
    }
  });

  it('hides the fill at nothing left, and clamps outside 0..1', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const { fill } = sprites(sentry);
    sentry.setHealth(0);
    expect(fill?.visible).toBe(false);
    sentry.setHealth(-5);
    expect(fill?.visible).toBe(false);
    sentry.setHealth(9);
    expect(fill?.scale.x).toBeCloseTo(0.7, 10);
    expect(fill?.center.x).toBeCloseTo(0.5, 10);
  });

  it('does no work when the fraction has not moved', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const { fill } = sprites(sentry);
    sentry.setHealth(0.4);
    const scale = fill?.scale.x;
    sentry.setHealth(0.4);
    expect(fill?.scale.x).toBe(scale);
  });

  it('follows the palette while it is alive, and stops once disposed', () => {
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    const { fill } = sprites(sentry);
    const material = fill?.material as THREE.SpriteMaterial;
    palette.set('deuteranopia');
    expect(material.color.getHex()).toBe(palette.current.hostile);
    sentry.dispose();
    const after = material.color.getHex();
    palette.set('tritanopia');
    expect(material.color.getHex()).toBe(after);
  });
});

describe('SentryMesh dispose', () => {
  it('unparents itself and empties the group', () => {
    const scene = new THREE.Group();
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    scene.add(sentry.group);
    sentry.dispose();
    expect(sentry.group.children).toHaveLength(0);
    expect(sentry.group.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it('leaves the shared template’s own materials alone', () => {
    template = turret();
    const armour = (template.getObjectByName('sentry_turret_pitch')?.children[1] as THREE.Mesh).material as THREE.Material;
    let disposed = false;
    armour.addEventListener('dispose', () => {
      disposed = true;
    });
    const sentry = new SentryMesh(0, 0, 0, 0, 'HOSTILE');
    sentry.dispose();
    expect(disposed).toBe(false);
  });
});
