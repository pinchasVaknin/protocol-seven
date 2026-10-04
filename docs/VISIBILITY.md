# PROTOCOL SEVEN — Server-side visibility

A design, not yet built. Security audit 2026-10-04, finding S4: every client is told where every
player is, so a modified client can draw enemies through walls. This document says what leaks
today, what the server should send instead, what that costs, how to prove it works, and which
decisions are the human's. Nothing here has been implemented.

---

## What leaks today

Two channels carry positions, and both go to every seat in an instance regardless of who could
perceive what.

**Snapshots.** `MatchInstance.buildEntities` flattens the whole roster — every player and every
bot — once per snapshot tick, and `sendSnapshots` hands that one list to every seat's encoder
at 20 Hz. Each `EntitySnapshot` carries position, yaw, pitch, velocity, stance, height, **health**,
weapon, character and the `EFlag` bits (alive, firing, ADS, sprinting, throwing, burning…).

**Events.** `EventCollector` turns the authoritative bus into one encoded frame per tick and sends
it to every client. Four of its events carry positions:

| Event | Carries | What a modified client gets |
|---|---|---|
| `Fired` | muzzle origin and the round's terminus | every shooter's position — **suppressed ones too**: the ping itself is right since protocol v27 (the server carries the resolved weapon's answer, so a suppressed shot no longer pings), but the origin of every shot is on the wire either way |
| `Damage` | the hit position, source and target | where fights are, map-wide |
| `Footstep` | the stepping body's position | every moving body, through any wall. Crouch-walking and Dead Silence are silent to *bots* (`BotDirector`) but the event still reaches every human client |
| `Pose` | jump and land positions | the same |

**Already right, and the model for the rest:** UAV contacts are built per recipient and sent only
to the team whose UAV recorded them (`MatchInstance.sendStreaks`), and Ghost keeps a body out of
that list. The scoreboard and the killfeed carry no positions.

**What that buys a cheater**, with no change to anything the server decides: boxes on every enemy
through every wall, a full radar, enemy health bars, and suppressed shooters on the minimap.

## Goal and non-goals

**Goal.** A client receives an enemy's state only while it could plausibly perceive that enemy —
sees it, hears it, or the game reveals it — and receives it *early enough* that nobody ever sees a
body pop in.

**Not a goal:**

- **Aimbots.** The client owns its view angles; no amount of culling stops an aimbot from aiming at
  an enemy that is visible. Culling makes an aimbot worse at finding targets, nothing more.
- **Perfect secrecy.** A body within hearing range has to be sent, because the audio graph pans
  and occludes footsteps from their positions. That is a residual leak inside the hearing radius
  and is accepted (decision D3).
- **Teammates.** Always sent: the minimap draws them and nothing about them is secret from their
  own side.

## Relevance: who is told about whom

Evaluated per (viewer, entity) pair on the server, at snapshot rate. An entity is **relevant** to a
viewer when any rule holds:

| # | Rule | Why |
|---|---|---|
| R1 | Same team, or the viewer itself | Friendlies are on the minimap; nothing to hide |
| R2 | Within **6 m** | No corner is tight enough to hide a body at that range for long, and melee lives there |
| R3 | **Line of sight**, conservatively: a clear segment from the viewer's eye to any of five points on the target's bounds (head, chest, feet, both shoulders), each expanded by the target's speed × the look-ahead | Seeing it |
| R4 | **Peek look-ahead**: R3 is also tested from the viewer's eye moved along its velocity by (RTT/2 + interpolation delay + one snapshot interval), and to the target moved likewise | Neither side may round a corner faster than the data arrives — this is what prevents pop-in |
| R5 | **Heard**: the target produced a sound the viewer can hear within the last 1.0 s — a footstep within 12 m (not crouched, not Dead Silence — see D4), gunfire within 40 m unsuppressed, a jump or landing within 12 m | The audio graph pans and occludes from the position. The radii are the game's own: S6.3's 12 m and the bots' `gunfireHearing` of 40 m |
| R6 | **Linger**: relevant at any time in the last 0.5 s | Stops flicker at the edge of a doorway and covers a lost snapshot |
| R7 | **Spectating**: a dead viewer in a one-life mode gets the union of its living teammates' relevant sets | The client picks which teammate to follow (`ClientMatch.spectatorTargetId`) and may switch at any frame |
| R8 | **Cheats on this seat** (`Cheat.NoClip`, free cam) | A server running cheats already gave the player everything |

And one rule that removes rather than adds: an entity holding `Cheat.Unseen` is **never** relevant
to anyone but itself. Today `writePlayer` sends its full state to every client like anybody else's
— `Unseen` only takes it out of `participating`, which is what bots read — so it is invisible to
bots and drawn by every human client.

**Bots** are entities like any other and are culled the same way; their own perception is
server-side and unaffected.

**Smoke** (`SmokeField.blocksSight`, which bot perception already uses) can be added to R3 as an
occluder. Left for phase 2: a silhouette at the edge of a smoke cloud is legitimately visible, and
the threshold needs measuring rather than guessing.

## Events

The same relevance applies to the event stream, which therefore becomes per recipient (encoded per
seat, or tagged by source entity and filtered — whichever measures cheaper):

- **`Fired`** from a relevant shooter: unchanged. From an irrelevant one: unsuppressed gunfire is
  audible, so R5 has usually made the shooter relevant already; a suppressed shot from an
  irrelevant shooter is sent **without its origin** (terminus only — the impact, the decal and the
  sound of the round arriving) or dropped (decision D2).
- **`Damage`**: always to the target and to the source. To anybody else only if either party is
  relevant to them.
- **`Footstep`, `Pose`**: only to viewers inside the hearing radius (that is R5 itself).
- **`Killed`**: unchanged — the killfeed is public.

## On the wire

Two ways to stop sending an entity, and the second is recommended (decision D1):

**A. Remove it.** The protocol already supports it: `SnapshotEncoder` lists removals, and the client
deletes the interpolator and, the next frame, the `RemoteActor` and its avatar. No protocol change.
But visibility changes many times a minute, and each return costs a skinned avatar rebuilt from the
character asset, an interpolation buffer started empty (a body that appears ~100 ms late), and a
hitch.

**B. Mark it dormant — recommended.** A new `EFlag.Dormant` bit. A dormant entity stays in the list
with its fields **frozen at their last relevant values** — never updated while dormant, so nothing
about it moves on the wire — and the client keeps the actor and its avatar but hides it and stops
interpolating it. When it wakes, the client **resets** its interpolation buffer and places it at
the new state, so it never slides across the map from where it was last seen. Costs a protocol
bump (28 at the time of writing; 27 carried the suppressor fix) and a few bytes per dormant entity per full snapshot; a delta for an unchanged dormant
entity is nothing.

Either way the entity list becomes **per recipient**. Today it is built once and shared; the encoder
is already per seat (it keeps per-client delta baselines), so the change is to build the list —
or the dormancy mask — per seat, which is a copy per seat of at most `MAX_PLAYERS` + bots records.

**Field minimisation**, phase 2: an enemy's exact `health` is a cheat's health bar. Send enemies
alive or dead only, and real health to self and teammates (decision D5).

## Client changes

- `NetClient` / `RemoteActor`: honour `Dormant` — hide, stop interpolating, reset on wake.
- `BotRenderer`: a hidden actor keeps its avatar (no dispose, no rebuild).
- Minimap: unchanged — friendlies from snapshots, enemies from pings and the UAV, both of which
  already have what they need.
- Audio: unchanged — footsteps still arrive as events, now only the audible ones.
- Spectator: unchanged — R7 makes sure the data is there.
- Prediction: unaffected. Players do not collide with each other, and hit registration is the
  server's rewind against its own state.

## Cost

Measured on this machine, 2026-10-04: `CollisionWorld.segmentClear` between 100,000 random pairs of
points at eye height on each map —

| Map | per ray | pairs with a clear line |
|---|---|---|
| FOUNDRY | 0.63 µs | 13% |
| DUNES | 0.47 µs | 10% |
| DEPOT | 0.48 µs | 20% |
| TESTBED | 0.51 µs | 42% |

The second column is the case for doing this at all: on the three real maps, four pairs in five
cannot see each other, so most enemies would be dormant most of the time.

Budget, worst case: 10 viewers × 10 enemies × 6 rays × 20 Hz = 12,000 rays a second ≈ **7 ms per
second per instance** here; allow 3–4× for Render's half CPU, and two instances — **roughly 5% of
the core**, before any of these:

- Stop at the first clear ray (most visible pairs need one).
- Line of sight is symmetric for the same pair of points: test each pair once.
- Skip teammates and R2's 6 m entirely — no rays.
- Evaluate at 10 Hz with R6's linger covering the gap.
- If it is ever needed: a coarse potentially-visible-set baked at boot in `MapBakery` (grid cell to
  grid cell), so most pairs are culled without a ray.

## Proving it

1. **Relevance rules as pure functions** with unit tests against the real map collision: a body
   behind a wall is not relevant, the same body one step into a doorway is, the peek look-ahead
   catches a body about to round a corner, the linger holds, a teammate always is.
2. **A leak audit in the skirmish harness**: every headless client records each enemy position it
   receives; the server records true line of sight with a stricter margin. Any received position
   the stricter test says was invisible *and* inaudible is a leak, and the run fails.
3. **A pop-in measurement**, the other half: the headless client counts enemies that become visible
   from its eye *before* they arrive non-dormant. Must be zero at 100 ms and at 200 ms of RTT.
4. **Cost**: the metrics line already reports per-instance step time; compare before and after on
   the skirmish harness with a full room.

## Phases

1. **Entities.** Per-recipient relevance (R1–R4, R6, R8, `Unseen`), `EFlag.Dormant`, the client
   honouring it. The next protocol version. Tests 1, 3 and 4.
2. **Events and the rest.** Per-recipient events (D2), the hearing rule R5, spectating R7, smoke as
   an occluder, enemy health minimised (D5). Test 2.
3. **Only if the cost asks for it.** The baked visibility set.

## Decisions

All five taken by the human on 2026-10-04, each as recommended. They are binding on the build.

| | Question | Decided |
|---|---|---|
| D1 | Remove culled entities, or mark them dormant? | **Dormant** — no avatar rebuilds, no pop-in from an empty buffer |
| D2 | A suppressed shot from a body nobody can see: send the terminus only, or nothing? | **Terminus only** — the impact and the decal are real, and they reveal nothing the victim's damage event does not |
| D3 | Accept that bodies within hearing range are sent? | **Yes** — the alternative is silent footsteps, which is a different game |
| D4 | Crouch-walking and Dead Silence are silent to bots today but their footsteps reach every human. Make them silent to humans too (not sent to enemies)? | **Yes** — it is what the perk says it does, and it removes a leak |
| D5 | Hide an enemy's exact health from the other team? | **Yes**, phase 2 — alive or dead only |
