import { describe, expect, it } from 'vitest';
import { NO_SKIN_INDEX } from '../meta/Skins';
import { decodeHeader, writeHello } from './Messages';
import {
  dequantAngle,
  dequantPitch,
  dequantPos,
  dequantVel,
  PROTOCOL_VERSION,
  quantAngle,
  quantPitch,
  quantPos,
  quantVel,
} from './Protocol';
import { makePlayerSimState, type PlayerSimState } from '../player/PlayerState';
import { ALL_EQUIPMENT } from '../equipment/EquipmentDefs';
import {
  copyEntitySnapshot,
  EFlag,
  equipmentIdAt,
  equipmentIndexOf,
  makeEntitySnapshot,
  readEntity,
  readOwnerState,
  THROW_PHASES,
  writeEntity,
  writeOwnerState,
  type EntitySnapshot,
} from './Snapshot';
import { ByteReader, ByteWriter } from './Wire';

/**
 * The body on the wire (M16, B6): a full write carries `characterIndex`, a delta carries it
 * only when it moved, 255 survives the round trip as "declared none", and the `Hello` carries
 * the same byte after the name. Written against the codec rather than the server, so the
 * shape is pinned where it is defined.
 */

function roundTrip(e: EntitySnapshot, base: EntitySnapshot | null, into: EntitySnapshot): number {
  const w = new ByteWriter(256);
  writeEntity(w, e, base);
  expect(w.overflowed).toBe(false);
  const bytes = w.bytes();
  readEntity(new ByteReader(bytes), into);
  return bytes.length;
}

function standing(entityId: number): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.displayName = 'OPERATOR-011';
  e.x = 3.25;
  e.z = -1.5;
  e.yaw = 0.5;
  return e;
}

describe('EntitySnapshot.characterIndex', () => {
  it('defaults to "declared none" and is copied with the rest', () => {
    expect(makeEntitySnapshot().characterIndex).toBe(NO_SKIN_INDEX);
    const a = standing(1);
    a.characterIndex = 4;
    const b = makeEntitySnapshot();
    copyEntitySnapshot(a, b);
    expect(b.characterIndex).toBe(4);
  });

  it('rides every full write, at 255 as well as at an index', () => {
    for (const index of [0, 6, NO_SKIN_INDEX]) {
      const e = standing(1);
      e.characterIndex = index;
      // A zeroed baseline: the reader must be told, not left to its default.
      const out = makeEntitySnapshot();
      out.characterIndex = 99;
      roundTrip(e, null, out);
      expect(out.characterIndex).toBe(index);
    }
  });

  it('costs nothing on a delta that did not move it, and one byte when it did', () => {
    const base = standing(1);
    base.characterIndex = 2;
    const same = standing(1);
    same.characterIndex = 2;
    const out = makeEntitySnapshot();
    copyEntitySnapshot(base, out);
    const quiet = roundTrip(same, base, out);
    // The id and an empty mask: nothing changed, so nothing is sent.
    expect(quiet).toBe(3);
    expect(out.characterIndex).toBe(2);

    const moved = standing(1);
    moved.characterIndex = 5;
    const changed = roundTrip(moved, base, out);
    expect(changed).toBe(4);
    expect(out.characterIndex).toBe(5);
  });
});

describe('Hello', () => {
  it('carries the skin byte after the name, with no presence byte', () => {
    for (const index of [0, 3, NO_SKIN_INDEX]) {
      const bytes = writeHello(new ByteWriter(256), 'OPERATOR-011', index, null, null);
      const msg = decodeHeader(new ByteReader(bytes));
      expect(msg.kind).toBe('hello');
      if (msg.kind !== 'hello') return;
      expect(msg.version).toBe(PROTOCOL_VERSION);
      expect(msg.name).toBe('OPERATOR-011');
      expect(msg.skinIndex).toBe(index);
      expect(msg.loadout).toBeNull();
      expect(msg.reconnectToken).toBeNull();
    }
  });

  it('is one byte longer than a v17 frame would be, and only that', () => {
    const w = new ByteWriter(256);
    writeHello(w, 'A', 0, null, null);
    // magic u32 + id u8 + version u16 + name (len + 1) + skin u8 + two presence bytes.
    expect(w.bytes().length).toBe(4 + 1 + 2 + 2 + 1 + 1 + 1);
  });
});

/**
 * Protocol 20: the flags are sixteen bits. The byte was full at `EFlag.TeamB`, and the two clips
 * the animation library was waiting on — a throw and a knife swing — each needed one. The tests
 * that matter are that a bit above 8 survives the round trip at all (a `u8` write would have
 * silently truncated it and the throw would simply never be drawn) and that the flags still cost
 * nothing on a body whose flags did not change.
 */
describe('EntitySnapshot.flags, widened', () => {
  it('carries a bit above the old byte through a full write', () => {
    const e = standing(1);
    e.flags = EFlag.Alive | EFlag.Throwing;
    const out = makeEntitySnapshot();
    roundTrip(e, null, out);
    expect(out.flags & EFlag.Throwing).toBe(EFlag.Throwing);
    expect(out.flags).toBe(e.flags);
  });

  it('carries every bit at once, which a u8 could not', () => {
    const all = Object.values(EFlag).reduce((mask, bit) => mask | bit, 0);
    expect(all).toBeGreaterThan(0xff);
    const e = standing(2);
    e.flags = all;
    const out = makeEntitySnapshot();
    roundTrip(e, null, out);
    expect(out.flags).toBe(all);
  });

  it('spends two bytes on a delta that changed the flags and none on one that did not', () => {
    const base = standing(3);
    base.flags = EFlag.Alive;
    const out = makeEntitySnapshot();
    roundTrip(base, null, out);

    const still = standing(3);
    still.flags = EFlag.Alive;
    // The mask alone: entity id and the field mask, with no field behind it.
    const unchanged = roundTrip(still, base, out);

    const swinging = standing(3);
    swinging.flags = EFlag.Alive | EFlag.Melee;
    const changed = roundTrip(swinging, base, out);
    expect(changed - unchanged).toBe(2);
    expect(out.flags & EFlag.Melee).toBe(EFlag.Melee);
  });

  it('copies the new bits with the rest of the struct', () => {
    const a = standing(4);
    a.flags = EFlag.Alive | EFlag.Throwing | EFlag.Melee;
    const b = makeEntitySnapshot();
    copyEntitySnapshot(a, b);
    expect(b.flags).toBe(a.flags);
  });
});

/**
 * Protocol 24: what is in the hand that throws. `EFlag.Throwing` said a grenade was out and nothing
 * more, so every client drew the body throwing its rifle; the grenade and the stage of the throw are
 * on the wire now, and these hold the codec to carrying them and to costing nothing when idle.
 */
describe('EntitySnapshot.heldEquipment and throwPhase', () => {
  it('names every piece of equipment and nothing else', () => {
    for (const def of ALL_EQUIPMENT) expect(equipmentIdAt(equipmentIndexOf(def.id))).toBe(def.id);
    expect(equipmentIndexOf(null)).toBe(255);
    expect(equipmentIdAt(255)).toBeNull();
    expect(THROW_PHASES).toEqual(['IDLE', 'READY', 'COOKING', 'THROWING']);
  });

  it('starts empty-handed, and a full write of an empty hand spends nothing on it', () => {
    const idle = standing(5);
    expect(idle.heldEquipment).toBe(255);
    expect(idle.throwPhase).toBe(0);
    const w = new ByteWriter(256);
    writeEntity(w, idle, null);
    const cocked = standing(5);
    cocked.heldEquipment = equipmentIndexOf('frag');
    cocked.throwPhase = THROW_PHASES.indexOf('COOKING');
    const w2 = new ByteWriter(256);
    writeEntity(w2, cocked, null);
    expect(w2.bytes().length - w.bytes().length).toBe(2);
  });

  it('carries the grenade and the phase through a full write and a delta, and copies them', () => {
    const e = standing(6);
    e.heldEquipment = equipmentIndexOf('flashbang');
    e.throwPhase = THROW_PHASES.indexOf('READY');
    const out = makeEntitySnapshot();
    roundTrip(e, null, out);
    expect(equipmentIdAt(out.heldEquipment)).toBe('flashbang');
    expect(THROW_PHASES[out.throwPhase]).toBe('READY');

    // The release: the phase moves and the grenade stays, for 0.18 s — then the follow-through.
    const swinging = standing(6);
    swinging.heldEquipment = e.heldEquipment;
    swinging.throwPhase = THROW_PHASES.indexOf('THROWING');
    const changed = roundTrip(swinging, e, out);
    expect(THROW_PHASES[out.throwPhase]).toBe('THROWING');
    const gone = standing(6);
    roundTrip(gone, swinging, out);
    expect(out.heldEquipment).toBe(255);
    expect(THROW_PHASES[out.throwPhase]).toBe('IDLE');

    // And a hand that did not move costs nothing on the delta.
    const still = standing(6);
    still.heldEquipment = swinging.heldEquipment;
    still.throwPhase = swinging.throwPhase;
    expect(roundTrip(still, swinging, out)).toBe(changed - 2);

    const copy = makeEntitySnapshot();
    copyEntitySnapshot(swinging, copy);
    expect(copy.heldEquipment).toBe(swinging.heldEquipment);
    expect(copy.throwPhase).toBe(swinging.throwPhase);
  });
});

/**
 * The rest of the entity codec, pinned field by field before A20 split `writeEntity` and
 * `readEntity` into their three wire groups (movement, state, serials).
 *
 * Every assertion is on bytes or on exact values: a delta's length is what says a field was
 * left out, and `toBe` on a dequantised number is what says the rounding did not move.
 */
describe('writeEntity, a full write', () => {
  it('carries every field, each through its own quantisation', () => {
    const e = makeEntitySnapshot();
    e.entityId = 7;
    e.displayName = 'BRAVO-ONE';
    e.x = 12.34;
    e.y = -5.67;
    e.z = 0.08;
    e.yaw = 1.75;
    e.pitch = -0.6;
    e.vx = 4.5;
    e.vz = -2.25;
    e.stance = 'CROUCH';
    e.heightScale = 0.8;
    e.health = 73;
    e.weaponIndex = 3;
    e.characterIndex = 4;
    e.flags = EFlag.Alive | EFlag.Sprinting | EFlag.Dormant;

    const out = makeEntitySnapshot();
    roundTrip(e, null, out);

    expect(out.entityId).toBe(7);
    expect(out.displayName).toBe('BRAVO-ONE');
    expect(out.x).toBe(dequantPos(quantPos(e.x)));
    expect(out.y).toBe(dequantPos(quantPos(e.y)));
    expect(out.z).toBe(dequantPos(quantPos(e.z)));
    expect(out.yaw).toBe(dequantAngle(quantAngle(e.yaw)));
    expect(out.pitch).toBe(dequantPitch(quantPitch(e.pitch)));
    expect(out.vx).toBe(dequantVel(quantVel(e.vx)));
    expect(out.vz).toBe(dequantVel(quantVel(e.vz)));
    expect(out.stance).toBe('CROUCH');
    expect(out.heightScale).toBe(Math.round(0.8 * 255) / 255);
    expect(out.health).toBe(73);
    expect(out.weaponIndex).toBe(3);
    expect(out.characterIndex).toBe(4);
    expect(out.flags).toBe(EFlag.Alive | EFlag.Sprinting | EFlag.Dormant);
  });

  it('round-trips every stance by name, not by index', () => {
    const out = makeEntitySnapshot();
    for (const stance of ['STAND', 'CROUCH', 'SLIDE', 'AIRBORNE', 'MANTLE'] as const) {
      const e = makeEntitySnapshot();
      e.stance = stance;
      roundTrip(e, null, out);
      expect(out.stance).toBe(stance);
    }
  });

  it('leaves the three serials out while they are zero, and carries them once they are not', () => {
    const quiet = makeEntitySnapshot();
    const out = makeEntitySnapshot();
    const quietBytes = roundTrip(quiet, null, out);
    expect(out.deathSerial).toBe(0);
    expect(out.spawnSerial).toBe(0);
    expect(out.flinchSerial).toBe(0);

    const hit = makeEntitySnapshot();
    hit.deathSerial = 9;
    hit.deathAngle = 1.2;
    hit.spawnSerial = 4;
    hit.flinchSerial = 2;
    hit.flinchAngle = -0.75;
    // Death: a serial byte and a quantised angle. Spawn: a byte. Flinch: a byte and an angle.
    expect(roundTrip(hit, null, out)).toBe(quietBytes + 3 + 1 + 3);
    expect(out.deathSerial).toBe(9);
    expect(out.deathAngle).toBe(dequantAngle(quantAngle(1.2)));
    expect(out.spawnSerial).toBe(4);
    expect(out.flinchSerial).toBe(2);
    expect(out.flinchAngle).toBe(dequantAngle(quantAngle(-0.75)));
  });

  it('sends a serial as its low byte, which is what makes it a serial and not a count', () => {
    const e = makeEntitySnapshot();
    e.deathSerial = 258;
    e.spawnSerial = 257;
    e.flinchSerial = 256;
    const out = makeEntitySnapshot();
    roundTrip(e, null, out);
    expect(out.deathSerial).toBe(2);
    expect(out.spawnSerial).toBe(1);
    expect(out.flinchSerial).toBe(0);
  });
});

describe('writeEntity, a delta', () => {
  it('spends three bytes — id and mask — on an entity that did not change', () => {
    const base = standing(2);
    const same = standing(2);
    const out = makeEntitySnapshot();
    expect(roundTrip(same, base, out)).toBe(3);
  });

  it('spends on exactly the fields that moved, and nothing on the ones that did not', () => {
    const out = makeEntitySnapshot();
    const cost = (mutate: (e: EntitySnapshot) => void): number => {
      const base = standing(2);
      const e = standing(2);
      mutate(e);
      return roundTrip(e, base, out) - 3;
    };

    expect(cost((e) => (e.x += 1))).toBe(6);
    expect(cost((e) => (e.yaw += 0.5))).toBe(2);
    expect(cost((e) => (e.pitch += 0.5))).toBe(2);
    expect(cost((e) => (e.vx += 1))).toBe(4);
    expect(cost((e) => (e.stance = 'CROUCH'))).toBe(1);
    expect(cost((e) => (e.heightScale = 0.5))).toBe(1);
    expect(cost((e) => (e.health = 42))).toBe(1);
    expect(cost((e) => (e.weaponIndex = 5))).toBe(1);
    expect(cost((e) => (e.characterIndex = 6))).toBe(1);
    expect(cost((e) => (e.flags = 0))).toBe(2);
    expect(cost((e) => (e.deathSerial = 1))).toBe(3);
    expect(cost((e) => (e.spawnSerial = 1))).toBe(1);
    expect(cost((e) => (e.flinchSerial = 1))).toBe(3);
    expect(cost((e) => (e.displayName = 'AB'))).toBe(3);
  });

  it('compares after quantisation, so two millimetres cost nothing at all', () => {
    const base = standing(3);
    const nudged = standing(3);
    nudged.x += 0.002;
    nudged.z -= 0.002;
    nudged.vx += 0.002;
    const out = makeEntitySnapshot();
    expect(roundTrip(nudged, base, out)).toBe(3);
  });

  it('leaves an absent field at the baseline the reader was handed', () => {
    const base = standing(4);
    base.health = 88;
    base.displayName = 'KEEP-ME';
    const moved = standing(4);
    moved.health = 88;
    moved.displayName = 'KEEP-ME';
    moved.x = 20;

    const out = makeEntitySnapshot();
    copyEntitySnapshot(base, out);
    roundTrip(moved, base, out);
    expect(out.x).toBe(20);
    expect(out.health).toBe(88);
    expect(out.displayName).toBe('KEEP-ME');
  });
});

/**
 * The owner block: the receiving client's own authoritative state, at full `f32` precision and
 * with four optional sub-blocks. Nothing pinned any of this before A20.
 */
describe('owner state', () => {
  const ownerRoundTrip = (s: PlayerSimState, into: PlayerSimState): number => {
    const w = new ByteWriter(512);
    writeOwnerState(w, s);
    expect(w.overflowed).toBe(false);
    const bytes = w.bytes();
    readOwnerState(new ByteReader(bytes), into);
    return bytes.length;
  };

  it('round-trips the base block to the bit, through f32', () => {
    const s = makePlayerSimState();
    s.x = 1.1;
    s.y = 2.2;
    s.z = 3.3;
    s.vx = -4.4;
    s.vy = 5.5;
    s.vz = -6.6;
    s.yaw = 0.7;
    s.pitch = -0.8;
    s.stance = 'AIRBORNE';
    s.groundMaterial = 3;
    s.capsuleHeight = 1.4;
    s.eyeHeight = 1.25;
    s.bobPhase = 2.5;
    s.distanceSinceStep = 0.375;
    s.airSpeedCap = 9.5;
    s.coyote = 0.05;
    s.jumpBuffer = 0.1;
    s.landImpact = 0.9;
    s.prevButtons = 0xdead_beef;
    s.tick = -12_345;

    const out = makePlayerSimState();
    ownerRoundTrip(s, out);

    expect(out.x).toBe(Math.fround(1.1));
    expect(out.y).toBe(Math.fround(2.2));
    expect(out.z).toBe(Math.fround(3.3));
    expect(out.vx).toBe(Math.fround(-4.4));
    expect(out.vy).toBe(5.5);
    expect(out.vz).toBe(Math.fround(-6.6));
    expect(out.yaw).toBe(Math.fround(0.7));
    expect(out.pitch).toBe(Math.fround(-0.8));
    expect(out.stance).toBe('AIRBORNE');
    expect(out.groundMaterial).toBe(3);
    expect(out.capsuleHeight).toBe(Math.fround(1.4));
    expect(out.eyeHeight).toBe(1.25);
    expect(out.bobPhase).toBe(2.5);
    expect(out.distanceSinceStep).toBe(0.375);
    expect(out.airSpeedCap).toBe(9.5);
    expect(out.coyote).toBe(Math.fround(0.05));
    expect(out.jumpBuffer).toBe(Math.fround(0.1));
    expect(out.landImpact).toBe(Math.fround(0.9));
    expect(out.prevButtons).toBe(0xdead_beef);
    expect(out.tick).toBe(-12_345);
  });

  it('carries all eight booleans in one byte, set and clear', () => {
    const all = makePlayerSimState();
    all.grounded = true;
    all.wasGrounded = true;
    all.sprintActive = true;
    all.tacSprintActive = true;
    all.slideActive = true;
    all.mantleActive = true;
    all.jumpedThisTick = true;
    all.justLanded = true;

    const out = makePlayerSimState();
    ownerRoundTrip(all, out);
    expect(out.grounded).toBe(true);
    expect(out.wasGrounded).toBe(true);
    expect(out.sprintActive).toBe(true);
    expect(out.tacSprintActive).toBe(true);
    expect(out.slideActive).toBe(true);
    expect(out.mantleActive).toBe(true);
    expect(out.jumpedThisTick).toBe(true);
    expect(out.justLanded).toBe(true);

    ownerRoundTrip(makePlayerSimState(), out);
    expect(out.grounded).toBe(false);
    expect(out.wasGrounded).toBe(false);
    expect(out.sprintActive).toBe(false);
    expect(out.tacSprintActive).toBe(false);
    expect(out.slideActive).toBe(false);
    expect(out.mantleActive).toBe(false);
    expect(out.jumpedThisTick).toBe(false);
    expect(out.justLanded).toBe(false);
  });

  it('pays for a sub-block only when it carries something', () => {
    const out = makePlayerSimState();
    const inert = ownerRoundTrip(makePlayerSimState(), out);

    const sprinting = makePlayerSimState();
    sprinting.sprintHeldTime = 0.5;
    expect(ownerRoundTrip(sprinting, out)).toBe(inert + 4 * 4 + 4);

    const sliding = makePlayerSimState();
    sliding.slideActive = true;
    expect(ownerRoundTrip(sliding, out)).toBe(inert + 6 * 4);

    const mantling = makePlayerSimState();
    mantling.mantleActive = true;
    expect(ownerRoundTrip(mantling, out)).toBe(inert + 10 * 4 + 1);

    const onASlope = makePlayerSimState();
    onASlope.groundNy = 0.9;
    expect(ownerRoundTrip(onASlope, out)).toBe(inert + 3 * 4);
  });

  it('round-trips every sub-block that is present', () => {
    const s = makePlayerSimState();
    s.sprintHeldTime = 1.5;
    s.tacSprintElapsed = 0.25;
    s.tacSprintCooldown = 0.75;
    s.tacLockout = 0.5;
    s.lastSprintPressTick = 42;
    s.slideActive = true;
    s.slideElapsed = 0.125;
    s.slideCooldown = 0.25;
    s.slideDirX = -0.5;
    s.slideDirZ = 0.5;
    s.slideSpeed = 7.5;
    s.slideAirTime = 0.0625;
    s.mantleActive = true;
    s.mantleElapsed = 0.375;
    s.mantleCooldown = 1.25;
    s.mantleFromX = 1.5;
    s.mantleFromY = 2.5;
    s.mantleFromZ = 3.5;
    s.mantleToX = 4.5;
    s.mantleToY = 5.5;
    s.mantleToZ = 6.5;
    s.mantleDirX = 0.25;
    s.mantleDirZ = -0.25;
    s.mantleEndStance = 'CROUCH';
    s.groundNx = 0.25;
    s.groundNy = 0.875;
    s.groundNz = -0.125;

    const out = makePlayerSimState();
    ownerRoundTrip(s, out);

    expect(out.sprintHeldTime).toBe(1.5);
    expect(out.tacSprintElapsed).toBe(0.25);
    expect(out.tacSprintCooldown).toBe(0.75);
    expect(out.tacLockout).toBe(0.5);
    expect(out.lastSprintPressTick).toBe(42);
    expect(out.slideElapsed).toBe(0.125);
    expect(out.slideCooldown).toBe(0.25);
    expect(out.slideDirX).toBe(-0.5);
    expect(out.slideDirZ).toBe(0.5);
    expect(out.slideSpeed).toBe(7.5);
    expect(out.slideAirTime).toBe(0.0625);
    expect(out.mantleElapsed).toBe(0.375);
    expect(out.mantleCooldown).toBe(1.25);
    expect(out.mantleFromX).toBe(1.5);
    expect(out.mantleFromY).toBe(2.5);
    expect(out.mantleFromZ).toBe(3.5);
    expect(out.mantleToX).toBe(4.5);
    expect(out.mantleToY).toBe(5.5);
    expect(out.mantleToZ).toBe(6.5);
    expect(out.mantleDirX).toBe(0.25);
    expect(out.mantleDirZ).toBe(-0.25);
    expect(out.mantleEndStance).toBe('CROUCH');
    expect(out.groundNx).toBe(0.25);
    expect(out.groundNy).toBe(0.875);
    expect(out.groundNz).toBe(-0.125);
  });

  it('writes an absent sub-block back to its inert values rather than leaving it alone', () => {
    const out = makePlayerSimState();
    out.sprintHeldTime = 9;
    out.tacSprintElapsed = 9;
    out.tacSprintCooldown = 9;
    out.tacLockout = 9;
    out.lastSprintPressTick = 9;
    out.slideElapsed = 9;
    out.slideCooldown = 9;
    out.slideDirX = 9;
    out.slideDirZ = 9;
    out.slideSpeed = 9;
    out.slideAirTime = 9;
    out.mantleElapsed = 9;
    out.mantleCooldown = 9;
    out.mantleEndStance = 'CROUCH';
    out.groundNx = 9;
    out.groundNy = 9;
    out.groundNz = 9;

    ownerRoundTrip(makePlayerSimState(), out);

    expect(out.sprintHeldTime).toBe(0);
    expect(out.tacSprintElapsed).toBe(0);
    expect(out.tacSprintCooldown).toBe(0);
    expect(out.tacLockout).toBe(0);
    expect(out.lastSprintPressTick).toBe(-1000);
    expect(out.slideElapsed).toBe(0);
    expect(out.slideCooldown).toBe(0);
    expect(out.slideDirX).toBe(0);
    expect(out.slideDirZ).toBe(1);
    expect(out.slideSpeed).toBe(0);
    expect(out.slideAirTime).toBe(0);
    expect(out.mantleElapsed).toBe(0);
    expect(out.mantleCooldown).toBe(0);
    expect(out.mantleEndStance).toBe('STAND');
    expect(out.groundNx).toBe(0);
    expect(out.groundNy).toBe(1);
    expect(out.groundNz).toBe(0);
  });

  it('leaves the mantle geometry where it was when the block is absent, inert being enough', () => {
    const out = makePlayerSimState();
    out.mantleFromX = 3;
    out.mantleToZ = 4;
    out.mantleDirX = 5;
    ownerRoundTrip(makePlayerSimState(), out);
    // Not reset, and harmless: `mantleActive` is false and `mantleElapsed` is zero, so nothing
    // reads them. Pins the current behaviour, which the split must not change either way.
    expect(out.mantleFromX).toBe(3);
    expect(out.mantleToZ).toBe(4);
    expect(out.mantleDirX).toBe(5);
  });

  it('never replicates the per-tick scratch, whatever the reader held before', () => {
    const out = makePlayerSimState();
    out.blockedHorizontally = true;
    out.steppedUp = true;
    const s = makePlayerSimState();
    s.blockedHorizontally = true;
    s.steppedUp = true;
    ownerRoundTrip(s, out);
    expect(out.blockedHorizontally).toBe(false);
    expect(out.steppedUp).toBe(false);
  });
});
