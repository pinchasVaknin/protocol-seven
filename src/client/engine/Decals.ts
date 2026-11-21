// ========================================== IMPORTS =========================================== \\
//#region Imports
import * as THREE from 'three';
import type { Rng } from '../../shared/core/Rng';
import { ATTACHMENT_IDS, attachmentDef } from '../../shared/weapons/Attachments';
import { ALL_WEAPONS } from '../../shared/weapons/WeaponDefs';
import { buildDecalTexture } from './FxAssets';
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
/**
 * Two full magazines of the largest magazine in the arsenal — **derived**, not asserted.
 *
 * The rule has been the same since M7 and the reason is the accuracy wall: 96 recycled inside a
 * single LMG magazine, so a group being measured lost its earliest holes while the burst that
 * made them was still going, which is precisely the case the wall exists to serve. Two full
 * magazines means a group survives a reload and can be compared against the next one.
 *
 * The number written down was **192, and the rule said 250 at best** (playtest round 5, F3).
 * The MONOLITH's magazine is 125, so two is 250 — and an extended magazine multiplies it by
 * 1.5, so the honest answer is 376. The comment had been describing a rule the constant did not
 * implement since the day the LMGs landed, which is why it is computed here instead: the next
 * weapon or attachment that moves the ceiling moves this with it, and the comment cannot go
 * stale because there is no number in it.
 *
 * Nearly free, and that is the frame-cost note F3 asks for: the whole field is one
 * `InstancedMesh` and therefore one draw call whatever the count, so 192 -> 376 buys 184 more
 * instance matrices — about 14 KB of `Float32Array` — and no additional draw calls, state
 * changes or per-frame work. Nothing iterates the pool per frame; `place` writes one slot.
 */
const CAPACITY = 2 * largestMagazine();

/** Lift off the surface, metres. Backed up by a polygon offset in the material. */
const SURFACE_LIFT = 0.006;
//#endregion

// ====================================== CLASS DecalField ====================================== \\
//#region Class DecalField
/**
 * Bullet-hole decals: a fixed pool with LRU recycling (brief S6.5).
 *
 * One `InstancedMesh`, so the whole field is a single draw call however many holes are on
 * the wall, and a ring cursor, so hole 97 quietly reuses the slot of hole 1. There is no
 * growth path and no fade-out timer — a hard cap with recycling is both cheaper and more
 * predictable than a lifetime, and it is what acceptance criterion 6 asks to see hold.
 */
export class DecalField {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  readonly mesh: THREE.InstancedMesh;

  private cursor = 0;
  private count = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly planeNormal = new THREE.Vector3(0, 0, 1);
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(anisotropy: number, private readonly disposables: Array<{ dispose(): void }>) {
    const texture = buildDecalTexture(anisotropy);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.disposables.push(texture, material, geometry);

    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.name = 'fx:decals';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < CAPACITY; i++) {
      mesh.setMatrixAt(i, this.hidden);
      mesh.setColorAt(i, this.color.setHex(0xffffff));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    this.mesh = mesh;
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  get live(): number {
    return this.count;
  }

  get capacity(): number {
    return CAPACITY;
  }

  /** `strength` darkens the hole; `radius` is the decal's half-size in metres. */
  place(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    radius: number,
    strength: number,
    rng: Rng,
  ): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    if (this.count < CAPACITY) this.count++;

    // Lift off the surface and spin randomly about it so repeated hits on one wall do not
    // read as a stamped pattern. The spin composes into the same quaternion, so no second
    // matrix is needed and nothing allocates.
    this.position.set(x + nx * SURFACE_LIFT, y + ny * SURFACE_LIFT, z + nz * SURFACE_LIFT);
    this.normal.set(nx, ny, nz).normalize();
    this.quat.setFromUnitVectors(this.planeNormal, this.normal);
    this.spin.setFromAxisAngle(this.planeNormal, rng.float() * Math.PI * 2);
    this.quat.multiply(this.spin);

    const size = radius * 2 * rng.range(0.85, 1.2);
    this.scale.set(size, size, 1);
    this.matrix.compose(this.position, this.quat, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    const v = Math.round(255 * (1 - Math.min(1, Math.max(0, strength)) * 0.75));
    this.mesh.setColorAt(index, this.color.setRGB(v / 255, v / 255, v / 255));
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Hide every mark inside an upright cylinder, and answer how many went (BACKLOG #33).
   *
   * A cylinder rather than a box because the caller is a body and a body has a yaw: a
   * world-space box would have to be rotated, and the thing being described — "roughly where
   * this person is standing" — is round in plan anyway. `y` is the **feet**, so the test is a
   * horizontal distance against `radius` and a height within `[y, y + height]`.
   *
   * A full pass over the ring rather than an index, which is the honest cost of not tracking
   * ownership per slot: it runs on a death or a respawn, never on a shot. `place` stays the
   * O(1) write this class is built around.
   *
   * The ring's cursor is **not** rewound. A cleared slot keeps its place in the queue and is
   * reused in turn, exactly as a slot that aged out would be; rewinding would make the next
   * hole overwrite a live one somewhere else.
   */
  clearCylinder(x: number, y: number, z: number, radius: number, height: number): number {
    const r2 = radius * radius;
    let cleared = 0;
    for (let i = 0; i < CAPACITY; i++) {
      this.mesh.getMatrixAt(i, this.matrix);
      // A hidden slot is a zero scale, and `elements[0]` is the x column's length: skip it
      // rather than count it, so the answer is marks removed and not slots visited.
      if (this.matrix.elements[0] === 0 && this.matrix.elements[5] === 0) continue;
      const px = this.matrix.elements[12] ?? 0;
      const py = this.matrix.elements[13] ?? 0;
      const pz = this.matrix.elements[14] ?? 0;
      if (py < y || py > y + height) continue;
      const dx = px - x;
      const dz = pz - z;
      if (dx * dx + dz * dz > r2) continue;
      this.mesh.setMatrixAt(i, this.hidden);
      if (this.count > 0) this.count--;
      cleared++;
    }
    if (cleared > 0) this.mesh.instanceMatrix.needsUpdate = true;
    return cleared;
  }

  clear(): void {
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cursor = 0;
    this.count = 0;
  }
  //#endregion
}
//#endregion

// ====================================== INTERNAL HELPERS ====================================== \\
//#region Internal Helpers
/**
 * The biggest magazine anything in the arsenal can be built with.
 *
 * The base table's ceiling times the largest magazine multiplier any attachment offers, because
 * the case this pool exists for is somebody emptying the largest magazine they can assemble into
 * a wall. Computed once at module load over two shipped tables.
 */
function largestMagazine(): number {
  let mult = 1;
  for (const id of ATTACHMENT_IDS) {
    const effects = attachmentDef(id)?.effects.magSizeMult;
    if (effects !== undefined && effects > mult) mult = effects;
  }
  let biggest = 1;
  for (const def of ALL_WEAPONS) {
    const size = Math.round(def.magSize * mult);
    if (size > biggest) biggest = size;
  }
  return biggest;
}
//#endregion
