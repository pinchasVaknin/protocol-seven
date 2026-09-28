import * as THREE from 'three';
import type { TeamRelation } from '../../shared/ui/TeamColour';
import { palette, type GameplayPalette } from '../ui/Palette';
import { SENTRY_IFF_MATERIAL, SENTRY_NODES, sentryModel } from './SentryModel';

/**
 * The bodies killstreaks used to build for themselves (M9).
 *
 * Lifted verbatim out of `shared/streaks/SentryGun.ts` and `shared/streaks/CarePackage.ts`.
 * Nothing about the geometry changed — the sentry was three splayed legs, a tinted body and a
 * barrel, and the crate is still a box under a bright post. What changed is who owns them:
 * `StreakRenderer` builds these against the live streak list, and the streaks no longer know a
 * scene exists.
 *
 * The sentry's boxes are now the **fallback** rather than the picture: `SentryModel` fetches a
 * real turret and `SentryMesh` clones it when it is there. The boxes stay because a sentry you
 * cannot see is a sentry you cannot shoot back at, so a download that never arrives has to
 * leave something standing.
 */

/** Team colour at full strength: this is a lamp, and a lamp is the one thing allowed to be loud. */
function iffColour(p: GameplayPalette, relation: TeamRelation): number {
  return relation === 'FRIENDLY' ? p.friendly : relation === 'HOSTILE' ? p.hostile : p.neutral;
}

/**
 * The tint of the fallback sentry's body, from the palette and the relation (M13 Phase A).
 *
 * Was `team === 'A' ? 0x2f5d7c : 0x7c3a2f` — the last absolute team colour in `client/`, and
 * the same defect B12 removed from three HUD surfaces: from a team-B seat your own sentry was
 * the red one. It is a relation now, and the two hex literals are gone with it: the tint is
 * the palette's friendly or hostile colour at half brightness, which under the base palette
 * lands within a few units of the two values that were here (0x2b547f / 0x743026 against
 * 0x2f5d7c / 0x7c3a2f) and under a colourblind palette moves with everything else.
 *
 * Half brightness because this is a painted turret, not a marker: the emissive points on a
 * body are the IFF tell, and a sentry lit like one would read as a fifth marker. On the model
 * that argument is finally carried out properly — the armour is neutral gunmetal and the band
 * round the mount is the only thing wearing the team's colour. A box has nowhere to put a
 * band, so the box keeps painting itself.
 */
function sentryTint(p: GameplayPalette, relation: TeamRelation): number {
  const base = iffColour(p, relation);
  return new THREE.Color(base).multiplyScalar(0.5).getHex();
}

export class SentryMesh {
  readonly group = new THREE.Group();
  /** Turned about Y by `aim`. The model's own yaw node, or the box turret's one group. */
  private readonly yawNode: THREE.Object3D;
  /** Turned about X by `aim`. On a box turret this is the yaw node, which pitches with it. */
  private readonly pitchNode: THREE.Object3D;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(x: number, y: number, z: number, restYaw: number, relation: TeamRelation) {
    const model = sentryModel();
    if (model === null) {
      const boxes = this.buildBoxes(relation);
      this.yawNode = boxes;
      this.pitchNode = boxes;
    } else {
      const parts = this.buildModel(model, relation);
      this.yawNode = parts.yaw;
      this.pitchNode = parts.pitch;
    }

    this.group.position.set(x, y, z);
    this.group.rotation.y = restYaw;
  }

  /**
   * A clone of the shipped turret, with the IFF band repainted for this viewer.
   *
   * The clone shares the template's geometries and materials, which is why `dispose` frees
   * neither: they belong to the one model every sentry in the match is a copy of. The band is
   * the exception — it gets a material of its own here, because two sentries on opposite sides
   * of the same match need two different colours out of one file.
   */
  private buildModel(template: THREE.Object3D, relation: TeamRelation): { yaw: THREE.Object3D; pitch: THREE.Object3D } {
    const clone = template.clone(true);
    const yaw = clone.getObjectByName(SENTRY_NODES.yaw);
    const pitch = clone.getObjectByName(SENTRY_NODES.pitch);
    if (yaw === undefined || pitch === undefined) {
      throw new Error(`the sentry model has no ${SENTRY_NODES.yaw}/${SENTRY_NODES.pitch}; the build's node contract changed`);
    }
    // `MeshBasicMaterial` and `toneMapped: false`, the same as the care package's beacon: a
    // marker light has to read at the colour it names in a dark corner as well as in the sun,
    // and a lit surface that the tone mapper is free to wash out does not.
    const band = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.disposables.push(band);
    this.disposables.push({ dispose: palette.onChange((p) => band.color.setHex(iffColour(p, relation))) });
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh.material as THREE.Material).name === SENTRY_IFF_MATERIAL) {
        mesh.material = band;
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    this.group.add(clone);
    return { yaw, pitch };
  }

  /** The turret before there was a model: three legs, a tinted body and a barrel. */
  private buildBoxes(relation: TeamRelation): THREE.Object3D {
    const legGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.62, 6);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.7, metalness: 0.35 });
    this.disposables.push(legGeo, legMat);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(legGeo, legMat);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.16, 0.31, Math.sin(a) * 0.16);
      leg.rotation.z = Math.cos(a) * 0.28;
      leg.rotation.x = -Math.sin(a) * 0.28;
      leg.castShadow = true;
      this.group.add(leg);
    }

    const turret = new THREE.Group();
    turret.position.y = 0.62;
    this.group.add(turret);

    const bodyGeo = new THREE.BoxGeometry(0.3, 0.22, 0.34);
    // Tinted by what the sentry is *to the viewer* so the player can tell theirs from an
    // enemy's at a glance, and repainted with the palette so a colourblind mode reaches it.
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.4 });
    this.disposables.push(bodyGeo, bodyMat);
    // Called once immediately, which is what paints the body in the first place.
    const unsubscribe = palette.onChange((p) => bodyMat.color.setHex(sentryTint(p, relation)));
    this.disposables.push({ dispose: unsubscribe });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    turret.add(body);

    const barrelGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.42, 8);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.45, metalness: 0.6 });
    this.disposables.push(barrelGeo, barrelMat);
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.28;
    turret.add(barrel);

    return turret;
  }

  /** Both angles are relative to the base's placed facing. See `SentryGun.turretYaw`. */
  aim(turretYaw: number, turretPitch: number): void {
    this.yawNode.rotation.y = turretYaw;
    this.pitchNode.rotation.x = turretPitch;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

export class CarePackageMesh {
  readonly group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(x: number, y: number, z: number) {
    const geometry = new THREE.BoxGeometry(0.9, 0.72, 0.9);
    const material = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.78, metalness: 0.08 });
    const beaconGeometry = new THREE.CylinderGeometry(0.045, 0.045, 3.2, 6);
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffb340, toneMapped: false });
    this.disposables.push(geometry, material, beaconGeometry, beaconMaterial);

    const crate = new THREE.Mesh(geometry, material);
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.group.add(crate);

    // A thin bright post so the crate is findable across a map without a HUD marker.
    const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
    beacon.position.y = 1.9;
    this.group.add(beacon);

    this.group.position.set(x, y, z);
  }

  /** The crate falls; x and z never change after the drop. */
  setHeight(y: number): void {
    this.group.position.y = y;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
