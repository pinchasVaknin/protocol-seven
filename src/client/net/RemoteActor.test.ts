import { describe, expect, it } from 'vitest';
import { DEATH_VARIANTS, deathVariantFor } from '../../shared/ai/BotVisualState';
import { EntityInterpolator } from '../../shared/net/Interpolation';
import { EFlag, makeEntitySnapshot, type EntitySnapshot } from '../../shared/net/Snapshot';
import { RemoteActor } from './RemoteActor';

/**
 * Another player drawn from snapshots, through the real interpolator (C13).
 *
 * Nothing here is mocked: the buffer is a real `EntityInterpolator` fed real `EntitySnapshot`s,
 * so what the getters report is what a body on the wire would make them report. The poses are
 * pinned with exact `toBe` wherever the arithmetic is the thing under test — the render blend,
 * the yaw unwrap and the first-frame seeding are all places a refactor could move a body by a
 * few ulps and nothing else would notice.
 */

const STAND_MAX = (): number => 100;

/** A snapshot for `entityId`, with the defaults the maker gives and `mutate` on top. */
function body(entityId: number, mutate: (e: EntitySnapshot) => void = () => undefined): EntitySnapshot {
  const e = makeEntitySnapshot();
  e.entityId = entityId;
  e.displayName = `P${entityId}`;
  mutate(e);
  return e;
}

/** An interpolator holding one sample at `serverMs`. */
function buffer(state: EntitySnapshot, serverMs: number): EntityInterpolator {
  const interp = new EntityInterpolator();
  interp.push(state, serverMs);
  return interp;
}

describe('RemoteActor: the flags the wire carries', () => {
  it('reads every presentation bit off the snapshot flags', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const all =
      EFlag.Alive |
      EFlag.Firing |
      EFlag.Reloading |
      EFlag.Ads |
      EFlag.Sprinting |
      EFlag.Bot |
      EFlag.Throwing |
      EFlag.Melee |
      EFlag.Burning;
    const interp = buffer(
      body(7, (e) => {
        e.flags = all;
      }),
      0,
    );

    actor.update(interp, 0);

    expect(actor.participating).toBe(true);
    expect(actor.firing).toBe(true);
    expect(actor.reloading).toBe(true);
    expect(actor.ads).toBe(true);
    expect(actor.sprinting).toBe(true);
    expect(actor.isBot).toBe(true);
    expect(actor.throwing).toBe(true);
    expect(actor.meleeing).toBe(true);
    expect(actor.burning).toBe(true);
    expect(actor.dormant).toBe(false);
  });

  it('reports no flag at all before the first snapshot', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    expect(actor.flags).toBe(0);
    expect(actor.participating).toBe(false);
    expect(actor.firing).toBe(false);
    expect(actor.stopsRounds).toBe(false);
    expect(actor.weaponId).toBeNull();
    expect(actor.characterId).toBeNull();
    expect(actor.displayName).toBe('');
    expect(actor.team).toBe('A');
    expect(actor.health).toBe(100);
  });

  it('takes the team off the TeamB bit, both ways', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    actor.update(
      buffer(
        body(7, (e) => {
          e.flags = EFlag.Alive | EFlag.TeamB;
        }),
        0,
      ),
      0,
    );
    expect(actor.team).toBe('B');

    actor.update(
      buffer(
        body(7, (e) => {
          e.flags = EFlag.Alive;
        }),
        0,
      ),
      0,
    );
    expect(actor.team).toBe('A');
  });

  it('stops rounds only while the body is alive and placed', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const cases: ReadonlyArray<readonly [number, boolean]> = [
      [EFlag.Alive, true],
      [EFlag.Alive | EFlag.Dormant, false],
      [EFlag.Dormant, false],
      [0, false],
    ];
    for (const [flags, expected] of cases) {
      actor.update(
        buffer(
          body(7, (e) => {
            e.flags = flags;
          }),
          0,
        ),
        0,
      );
      expect(actor.stopsRounds).toBe(expected);
      expect(actor.participating).toBe((flags & EFlag.Alive) !== 0);
      expect(actor.dormant).toBe((flags & EFlag.Dormant) !== 0);
    }
  });
});

describe('RemoteActor: health, weapon and body', () => {
  it('normalises health against the live config maximum, and clamps both ends', () => {
    const actor = new RemoteActor(7, () => 200);
    actor.update(
      buffer(
        body(7, (e) => {
          e.health = 50;
        }),
        0,
      ),
      0,
    );
    expect(actor.health).toBe(50);
    expect(actor.healthFraction).toBe(0.25);

    actor.update(
      buffer(
        body(7, (e) => {
          e.health = 255;
        }),
        0,
      ),
      0,
    );
    expect(actor.healthFraction).toBe(1);
  });

  it('answers zero rather than a NaN bar when the configured maximum is unusable', () => {
    for (const max of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const actor = new RemoteActor(7, () => max);
      actor.update(
        buffer(
          body(7, (e) => {
            e.health = 50;
          }),
          0,
        ),
        0,
      );
      expect(actor.healthFraction).toBe(0);
    }
  });

  it('is holding a sidearm only when the replicated weapon index names a PISTOL', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    // 255 is "no weapon", which a dead body carries.
    actor.update(buffer(body(7), 0), 0);
    expect(actor.weaponId).toBeNull();
    expect(actor.pistol).toBe(false);

    // Walk the table and assert the getter agrees with the def's class on every index.
    for (let index = 0; index < 40; index++) {
      actor.update(
        buffer(
          body(7, (e) => {
            e.weaponIndex = index;
          }),
          0,
        ),
        0,
      );
      if (actor.weaponId === null) continue;
      expect(actor.pistol).toBe(actor.weaponId.startsWith('pistol_'));
    }
  });

  it('keeps the last name it was told and never blanks it on a nameless snapshot', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    actor.update(buffer(body(7), 0), 0);
    expect(actor.displayName).toBe('P7');

    actor.update(
      buffer(
        body(7, (e) => {
          e.displayName = '';
        }),
        0,
      ),
      0,
    );
    expect(actor.displayName).toBe('P7');
  });
});

describe('RemoteActor: the animation contract', () => {
  it('hands back one reused record whose fields track the flags', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    actor.update(
      buffer(
        body(7, (e) => {
          e.flags = EFlag.Alive | EFlag.Ads | EFlag.Sprinting | EFlag.Firing | EFlag.Melee;
          e.stance = 'CROUCH';
          e.throwPhase = 2;
        }),
        0,
      ),
      0,
    );

    const first = actor.animation;
    expect(first.stance).toBe('CROUCH');
    expect(first.aiming).toBe(true);
    expect(first.sprinting).toBe(true);
    expect(first.firing).toBe(true);
    expect(first.meleeing).toBe(true);
    expect(first.throwing).toBe(false);
    expect(first.throwPhase).toBe('COOKING');
    expect(first.reloading).toBe(false);
    expect(first.reloadSeconds).toBe(0);
    // One record, handed out again rather than rebuilt per frame.
    expect(actor.animation).toBe(first);
  });

  it('estimates the reload length from the def, and only while reloading', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    actor.update(
      buffer(
        body(7, (e) => {
          e.weaponIndex = 0;
          e.flags = EFlag.Alive;
        }),
        0,
      ),
      0,
    );
    expect(actor.animation.reloadSeconds).toBe(0);

    actor.update(
      buffer(
        body(7, (e) => {
          e.weaponIndex = 0;
          e.flags = EFlag.Alive | EFlag.Reloading;
        }),
        0,
      ),
      0,
    );
    expect(actor.animation.reloadSeconds).toBeGreaterThan(0);

    // Reloading with no weapon on the wire has no def to ask.
    actor.update(
      buffer(
        body(7, (e) => {
          e.flags = EFlag.Alive | EFlag.Reloading;
        }),
        0,
      ),
      0,
    );
    expect(actor.animation.reloadSeconds).toBe(0);
  });

  it('maps every throw phase index through the table, and an unknown one to IDLE', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const expected = ['IDLE', 'READY', 'COOKING', 'THROWING'];
    for (let i = 0; i < expected.length; i++) {
      actor.update(
        buffer(
          body(7, (e) => {
            e.throwPhase = i;
          }),
          0,
        ),
        0,
      );
      expect(actor.throwPhase).toBe(expected[i]);
    }
    actor.update(
      buffer(
        body(7, (e) => {
          e.throwPhase = 99;
        }),
        0,
      ),
      0,
    );
    expect(actor.throwPhase).toBe('IDLE');
  });
});

describe('RemoteActor: the visual serials', () => {
  it('derives the death variant and direction from the serial the server moved', () => {
    const actor = new RemoteActor(42, STAND_MAX);
    actor.update(
      buffer(
        body(42, (e) => {
          e.deathSerial = 3;
          e.deathAngle = 1;
        }),
        0,
      ),
      0,
    );

    expect(actor.visual.deathSerial).toBe(3);
    expect(actor.visual.deathDirX).toBe(Math.sin(1));
    expect(actor.visual.deathDirZ).toBe(Math.cos(1));
    expect(actor.visual.deathVariant).toBe(deathVariantFor(42, 3, DEATH_VARIANTS));
  });

  it('leaves the death fields alone while the serial stands still', () => {
    const actor = new RemoteActor(42, STAND_MAX);
    actor.update(
      buffer(
        body(42, (e) => {
          e.deathSerial = 3;
          e.deathAngle = 1;
        }),
        0,
      ),
      0,
    );
    actor.update(
      buffer(
        body(42, (e) => {
          e.deathSerial = 3;
          e.deathAngle = 2;
        }),
        0,
      ),
      0,
    );
    // The angle moved but the serial did not, so the direction is the one the death carried.
    expect(actor.visual.deathDirX).toBe(Math.sin(1));
  });

  it('takes the flinch direction from its own serial', () => {
    const actor = new RemoteActor(42, STAND_MAX);
    actor.update(
      buffer(
        body(42, (e) => {
          e.flinchSerial = 5;
          e.flinchAngle = 0.5;
        }),
        0,
      ),
      0,
    );
    expect(actor.visual.flinchSerial).toBe(5);
    expect(actor.visual.flinchDirX).toBe(Math.sin(0.5));
    expect(actor.visual.flinchDirZ).toBe(Math.cos(0.5));
  });
});

describe('RemoteActor: the pose', () => {
  it('collapses the blend on the first frame rather than flying in from the origin', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(
      body(7, (e) => {
        e.x = 12;
        e.y = 3;
        e.z = -4;
        e.yaw = 1.25;
        e.heightScale = 0.75;
      }),
      0,
    );

    actor.update(interp, 0);

    // Every alpha reads the same place, because there is no previous pose to blend from.
    for (const alpha of [0, 0.5, 1]) {
      expect(actor.renderX(alpha)).toBe(actor.x);
      expect(actor.renderY(alpha)).toBe(actor.y);
      expect(actor.renderZ(alpha)).toBe(actor.z);
      expect(actor.renderYaw(alpha)).toBe(actor.yaw);
      expect(actor.renderScale(alpha)).toBe(0.75);
    }
  });

  it('blends between the previous frame and this one, exactly', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = new EntityInterpolator();
    interp.push(
      body(7, (e) => {
        e.x = 0;
        e.z = 0;
      }),
      0,
    );
    // The first sighting snaps the buffer, so the blend only has two states to work between
    // from the frame after it. See `spawnSnapped`.
    actor.update(interp, 0);

    interp.push(
      body(7, (e) => {
        e.x = 10;
        e.z = 20;
      }),
      1000,
    );
    actor.update(interp, 400);
    const fromX = actor.x;
    const fromZ = actor.z;
    actor.update(interp, 500);
    const toX = actor.x;
    const toZ = actor.z;

    expect(toX).not.toBe(fromX);
    expect(actor.renderX(0)).toBe(fromX);
    expect(actor.renderX(1)).toBe(toX);
    expect(actor.renderX(0.5)).toBe(fromX + (toX - fromX) * 0.5);
    expect(actor.renderZ(0.25)).toBe(fromZ + (toZ - fromZ) * 0.25);
  });

  it('turns the short way across the wrap, in both directions', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const TAU = Math.PI * 2;
    const near = Math.PI - 0.1;

    const interp = new EntityInterpolator();
    interp.push(
      body(7, (e) => {
        e.yaw = near;
      }),
      0,
    );
    actor.update(interp, 0);
    const from = actor.yaw;

    interp.push(
      body(7, (e) => {
        e.yaw = -near;
      }),
      1000,
    );
    actor.update(interp, 2000);
    const to = actor.yaw;

    // Half way across the wrap is a short hop past PI, not most of the way round the circle.
    const half = actor.renderYaw(0.5);
    let d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d <= -Math.PI) d += TAU;
    expect(half).toBe(from + d * 0.5);
    expect(Math.abs(d)).toBeLessThan(0.5);
  });

  it('maps a half turn to +PI, which is the boundary the shared helper picks', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = new EntityInterpolator();
    interp.push(
      body(7, (e) => {
        e.yaw = Math.PI;
      }),
      0,
    );
    actor.update(interp, 0);
    interp.push(
      body(7, (e) => {
        e.yaw = 0;
      }),
      1000,
    );
    actor.update(interp, 2000);

    // prev = PI, now = 0: the delta is -PI exactly, which this spelling carries to +PI.
    expect(actor.yaw).toBe(0);
    expect(actor.renderYaw(1)).toBe(Math.PI + Math.PI);
    expect(actor.renderYaw(0)).toBe(Math.PI);
  });

  it('snaps rather than slides when the spawn serial moves', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = new EntityInterpolator();
    interp.push(
      body(7, (e) => {
        e.x = 0;
      }),
      0,
    );
    interp.push(
      body(7, (e) => {
        e.x = 10;
      }),
      1000,
    );
    actor.update(interp, 500);
    const beforeRespawn = actor.x;
    expect(beforeRespawn).toBeGreaterThan(0);

    // A new life, somewhere else entirely.
    interp.push(
      body(7, (e) => {
        e.x = -80;
        e.spawnSerial = 1;
      }),
      1050,
    );
    actor.update(interp, 1050);

    expect(actor.visual.spawnSerial).toBe(1);
    // The blend is collapsed, so the body appears at the spawn rather than travelling there.
    expect(actor.renderX(0)).toBe(actor.x);
    expect(actor.renderX(1)).toBe(actor.x);
  });

  it('counts the first sighting as a spawn, so a joiner appears where it is', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(
      body(7, (e) => {
        e.x = 55;
        e.z = -33;
      }),
      0,
    );
    actor.update(interp, 0);
    expect(actor.renderX(0)).toBe(55);
    expect(actor.renderZ(0)).toBe(-33);
  });

  it('reports the interpolator’s own degraded verdicts', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(body(7), 0);

    // The first sighting snaps the one sample onto the render time, so nothing is degraded yet.
    actor.update(interp, 0);
    expect(actor.extrapolated).toBe(false);
    expect(actor.frozen).toBe(false);

    // One sample and nothing to extrapolate *from*: the body is written as it stands and the
    // flag stays down, even though the render time is past it.
    actor.update(interp, 50);
    expect(actor.extrapolated).toBe(false);
    expect(actor.frozen).toBe(false);

    // With a pair in the buffer there is a velocity to run on, and the flag goes up.
    interp.push(
      body(7, (e) => {
        e.x = 2;
      }),
      100,
    );
    actor.update(interp, 150);
    expect(actor.extrapolated).toBe(true);
    expect(actor.frozen).toBe(false);

    actor.update(interp, 5000);
    expect(actor.frozen).toBe(true);
    expect(actor.extrapolated).toBe(false);
  });

  it('keeps the rig on the drawn pose', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(
      body(7, (e) => {
        e.x = 4;
        e.y = 1;
        e.z = -2;
        e.yaw = 0.5;
        e.stance = 'CROUCH';
      }),
      0,
    );
    actor.update(interp, 0);

    expect(actor.stance).toBe('CROUCH');
    expect(actor.rig.x).toBe(4);
    expect(actor.rig.y).toBe(1);
    expect(actor.rig.z).toBe(-2);
    expect(actor.rig.yaw).toBe(0.5);
  });
});

// ============================ the air pose a frozen body used to keep ==========================

/**
 * BACKLOG #87: a body whose snapshots stop while it is mid-jump.
 *
 * `jumpLaunch` clamps on its last frame on purpose and that frame is the air pose, so an
 * animation told `AIRBORNE` keeps knees-up for as long as it is told it. Once the buffer has
 * starved past `MAX_EXTRAPOLATION_MS` the interpolator stops predicting and holds its last
 * sample still — and the last sample said `AIRBORNE`, forever. On an external server that is a
 * body hanging in the air in a sitting pose, which is exactly what was reported from play.
 *
 * It was reproduced before it was fixed: one snapshot carrying `AIRBORNE`, then silence, and the
 * animator was still in `jumpLaunch` ten seconds later.
 */
describe('RemoteActor: a frozen body does not keep the air pose', () => {
  /** Well past `MAX_EXTRAPOLATION_MS` (250), so the buffer has given up predicting. */
  const LONG_SILENCE_MS = 4_000;

  it('stops reporting AIRBORNE to the animation once the pose is frozen', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
      }),
      0,
    );

    actor.update(interp, 0);
    expect(actor.animation.stance).toBe('AIRBORNE');
    expect(actor.frozen).toBe(false);

    // The snapshots stop here. Nothing more is pushed; only the clock moves.
    actor.update(interp, LONG_SILENCE_MS);

    expect(actor.frozen).toBe(true);
    expect(actor.animation.stance).toBe('STAND');
  });

  /**
   * The raw fact is untouched. `rigLayoutFor` reads `stance` and the hitbox overlay draws what
   * it returns, so the two must not start disagreeing about what the wire said — only the
   * animation declines to act on a transient it can no longer see the end of.
   */
  it('still reports the stance the wire last carried', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
      }),
      0,
    );

    actor.update(interp, 0);
    actor.update(interp, LONG_SILENCE_MS);

    expect(actor.frozen).toBe(true);
    expect(actor.stance).toBe('AIRBORNE');
  });

  /**
   * Only `AIRBORNE`, and only when frozen. A crouching body that goes quiet still *is*
   * crouching as far as anybody knows, and extrapolation inside the cap is the interpolator
   * still doing its job — a real jump in flight has to keep its pose.
   */
  it('leaves a frozen crouch alone, and leaves an extrapolated jump alone', () => {
    // Each body is seen once before the silence, because the first sighting snaps the buffer to
    // the render time (`snapOnRespawn`) and a body that has only ever been seen late is not
    // starved, it is new.
    const crouchBuffer = buffer(
      body(7, (e) => {
        e.stance = 'CROUCH';
      }),
      0,
    );
    const crouched = new RemoteActor(7, STAND_MAX);
    crouched.update(crouchBuffer, 0);
    crouched.update(crouchBuffer, LONG_SILENCE_MS);

    expect(crouched.frozen).toBe(true);
    expect(crouched.animation.stance).toBe('CROUCH');

    const jumping = new RemoteActor(7, STAND_MAX);
    const interp = new EntityInterpolator();
    interp.push(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
      }),
      0,
    );
    interp.push(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
        e.x = 1;
      }),
      50,
    );
    jumping.update(interp, 0);
    // 100 ms past the newest sample: inside the cap, so predicted rather than frozen.
    jumping.update(interp, 150);

    expect(jumping.frozen).toBe(false);
    expect(jumping.animation.stance).toBe('AIRBORNE');
  });
});

// ========================== the air pose a dormant record used to keep =========================

/**
 * BACKLOG #87, the half the `frozen` fix could not reach: a body the server has stopped placing.
 *
 * Protocol 28 sends a body this viewer cannot see **dormant** — the record it had the last time
 * it was relevant, frozen, with `EFlag.Dormant` set. `SeatView`'s own header names the stance
 * among the fields that freeze. So a body that goes out of view mid-jump is replicated as
 * `AIRBORNE` for as long as it stays out of view, which on a live server is most of the time:
 * the instance this was reported from logged `dormantPct: 100`.
 *
 * Nothing starves, so none of it looks wrong from the buffer's side. Snapshots keep arriving at
 * 20 Hz, `sample` brackets two of them and blends, and `frozen` is **false** — while
 * `Interpolation.sample` takes the stance from the newest sample without blending it, which is
 * right for a live record and is how the frozen one gets through. That is why the body the
 * reporter caught read `stance: AIRBORNE / frozen: false / extrapolated: false`, and why the
 * server-side probe over the same roster stayed silent: `sim.stance` had landed long before.
 * Both measurements were true about different records.
 */
describe('RemoteActor: a dormant body does not keep the air pose', () => {
  /** The frozen record the server repeats while a body is out of view: mid-jump, and still. */
  function dormantJump(serverMs: number, interp: EntityInterpolator): void {
    interp.push(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
        e.flags = EFlag.Alive | EFlag.Bot | EFlag.Dormant;
      }),
      serverMs,
    );
  }

  it('stops reporting AIRBORNE to the animation while the record is dormant', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
        e.flags = EFlag.Alive | EFlag.Bot;
      }),
      0,
    );

    // Seen once mid-jump, in view: that pose is real and has to be kept.
    actor.update(interp, 0);
    expect(actor.animation.stance).toBe('AIRBORNE');
    expect(actor.dormant).toBe(false);

    // It goes out of view. The frozen record arrives every snapshot, saying the same thing.
    dormantJump(50, interp);
    dormantJump(100, interp);
    actor.update(interp, 75);

    // Blended between two live samples, so the buffer is healthy — this is the case the
    // `frozen` guard cannot see.
    expect(actor.frozen).toBe(false);
    expect(actor.extrapolated).toBe(false);
    expect(actor.dormant).toBe(true);
    expect(actor.animation.stance).toBe('STAND');
  });

  /** The same line the frozen twin holds: `rigLayoutFor` must still read what the wire said. */
  it('still reports the stance the wire last carried', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = buffer(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
        e.flags = EFlag.Alive | EFlag.Bot;
      }),
      0,
    );
    actor.update(interp, 0);
    dormantJump(50, interp);
    dormantJump(100, interp);
    actor.update(interp, 75);

    expect(actor.stance).toBe('AIRBORNE');
  });

  /**
   * A dormant crouch is left alone, for the frozen case's reason: a body nobody can see is as
   * likely to be crouching as not, and the pose it is drawn in when it comes back is a kneel
   * either way. Only `AIRBORNE` is a moment rather than a state.
   */
  it('leaves a dormant crouch alone', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = new EntityInterpolator();
    const crouch = (serverMs: number): void => {
      interp.push(
        body(7, (e) => {
          e.stance = 'CROUCH';
          e.flags = EFlag.Alive | EFlag.Bot | EFlag.Dormant;
        }),
        serverMs,
      );
    };
    crouch(0);
    crouch(50);
    actor.update(interp, 25);

    expect(actor.dormant).toBe(true);
    expect(actor.animation.stance).toBe('CROUCH');
  });

  /**
   * And the moment it comes back into view the guard lifts, because the record is live again.
   * A body that really is mid-jump when it reappears has to be drawn mid-jump — the wake is
   * `NetClient`'s `interp.reset()`, so the live sample is the only one in the buffer.
   */
  it('keeps the air pose again the moment the body is live', () => {
    const actor = new RemoteActor(7, STAND_MAX);
    const interp = new EntityInterpolator();
    dormantJump(0, interp);
    dormantJump(50, interp);
    actor.update(interp, 25);
    expect(actor.animation.stance).toBe('STAND');

    // Relevant again, and genuinely in the air. `NetClient` resets the buffer on the wake.
    interp.reset();
    interp.push(
      body(7, (e) => {
        e.stance = 'AIRBORNE';
        e.flags = EFlag.Alive | EFlag.Bot;
      }),
      100,
    );
    actor.update(interp, 100);

    expect(actor.dormant).toBe(false);
    expect(actor.animation.stance).toBe('AIRBORNE');
  });
});
