import { rigLayoutFor, type RigLayout } from '../../shared/combat/HitboxRig';
import type { StanceId } from '../../shared/player/Stance';

/**
 * Whether a point in the world is inside a body that is drawn there (2026-10-18).
 *
 * The one question the client has to answer before it stamps a bullet hole into the world.
 * `Ballistics` has refused to leave a hole in anything that does not ask for one since M8 —
 * and every person refuses, see `Damageable.decals` — but the client has two impact paths
 * that reach `Fx` without going through a trace at all:
 *
 *  - the impact synthesised from a replicated shot's terminus (`NetSession`), for a shooter
 *    this client is not told about, which carries a point and a material and no way to say
 *    that the point is an operator's chest;
 *  - its own predicted trace online, where the remote bodies are not registered as targets
 *    — the server owns hit registration — so a round travels straight through the enemy it
 *    just killed and marks whatever is behind them.
 *
 * A decal is placed in *world* space by `DecalField`, which is the whole reason this matters:
 * a hole that lands inside a body hangs in mid-air the moment that body walks on or is
 * killed. `TargetDummy.decals` wrote that rule down for a strafing range target; this applies
 * it to the two paths that never asked a rig.
 *
 * ## The shape is a cylinder, not the rig
 *
 * The drawn pose's own layout gives the height and its boxes give the radius, and nothing
 * here raycasts. Two reasons: a point-in-rig test is not something `HitboxRig` offers, and
 * the rig is a dozen boxes whose *gaps* — between the legs, under the arms, beside the neck
 * — are exactly where a hole still reads as being on the body. Yaw is ignored, which is what
 * makes the cylinder conservative: the radius is the furthest horizontal corner of any box,
 * so it covers the silhouette at every facing.
 *
 * It is a veto on a decal and not a hit test, so the error that matters is the one it makes
 * visible. It costs a hole on a wall a body is standing flush against — a mark nobody
 * notices is missing — and it buys the one hanging in the air.
 */

/** Just enough of a drawn body to measure. A `RenderableActor` satisfies it as it stands. */
export interface DrawnBody {
  readonly animation: { readonly stance: StanceId };
  /** A networked body this viewer cannot place (protocol 28); it is not drawn, so it vetoes nothing. */
  readonly dormant?: boolean;
  renderX(alpha: number): number;
  renderY(alpha: number): number;
  renderZ(alpha: number): number;
}

/** Cached per layout id: the walk over the boxes has the same answer every time. */
const radiusByLayout = new Map<string, number>();

export function insideDrawnBody(body: DrawnBody, x: number, y: number, z: number): boolean {
  if (body.dormant === true) return false;
  /**
   * The pose's boxes, by the rule `RemoteActor` keeps its own rig in step with.
   *
   * Zero velocity and no pistol, which picks the crouched idle among the crouch variants; the
   * heights they disagree about are centimetres. The alternative is carrying a remote body's
   * speed into presentation to decide the shape of a decal, which is a worse trade than a
   * centimetre.
   */
  const layout = rigLayoutFor(body.animation.stance, 0, 0, false);
  const dx = x - body.renderX(1);
  const dz = z - body.renderZ(1);
  const radius = silhouetteRadius(layout);
  if (dx * dx + dz * dz > radius * radius) return false;
  // `renderY` is the feet, as `bodyAt` reads it; the layout's height is the top of its
  // highest box, which is the crown of the head.
  const base = body.renderY(1);
  return y >= base && y <= base + layout.height;
}

/**
 * The radius of the circle that covers this layout at any yaw, metres.
 *
 * The furthest horizontal corner of any box: a box is centred at `(ox, oz)` and is `sx` by
 * `sz` across, so its corner is `hypot(|ox| + sx/2, |oz| + sz/2)` from the spine. For a
 * standing operator that is the shoulder, a little over a third of a metre.
 */
function silhouetteRadius(layout: RigLayout): number {
  const cached = radiusByLayout.get(layout.id);
  if (cached !== undefined) return cached;
  let radius = 0;
  for (const box of layout.boxes) {
    const corner = Math.hypot(Math.abs(box.ox) + box.sx * 0.5, Math.abs(box.oz) + box.sz * 0.5);
    if (corner > radius) radius = corner;
  }
  radiusByLayout.set(layout.id, radius);
  return radius;
}
