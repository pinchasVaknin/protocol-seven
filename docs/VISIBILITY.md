# PROTOCOL SEVEN — Server-side visibility

Security audit 2026-10-04, finding S4: every client was told where every player is, so a modified
client could draw enemies through walls. This document says what leaked, what the server sends
instead, what that costs, how it is proved, and which decisions were the human's.

**Phase 1 is built** (2026-10-04) — snapshots are culled per seat; see *Phase 1, as built* below,
which records where the build departed from this design and what it measured. **Phase 2, the
event stream, is being built** (see *Phase 2* below): until it lands, `Fired`, `Damage`, `Footstep`
and `Pose` still go to every client with positions, so a modified client can still place a body
that moves or shoots.

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
| R9 | **Hurt by**: the target damaged the viewer within the last 0.5 s (not a sentry's round) | The hit-direction chevron and the death report's distance need the shooter's body, and the chevron gives its bearing away regardless. Added in phase 2 — see below |

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

## Phase 1, as built

`server/net/Relevance.ts` (the rules), `server/net/SeatView.ts` (each seat's list and its frozen
records), `MatchInstance.sendSnapshots` (per seat), `EFlag.Dormant` (protocol 28), and the client's
`NetClient` reset, `RemoteActor.dormant` and `BotRenderer`. Where it departs from the design above:

- **R7 moved into phase 1** (P1). Without it a dead spectator in Search & Destroy would have seen
  only what its own corpse could, and the spectator camera would have watched empty corridors.
- **R4 reaches sideways, not only along the velocity.** The first build extrapolated velocities and
  the audit found what that misses: a body standing still behind a corner that starts to move.
  Both ends are now also tested displaced across the line of sight by sprint speed × the
  look-ahead (or the body's own speed, if faster), and the head and the eye are measured as if
  standing, so a crouched body behind low cover is sent before it stands.
- **The feet are among the displaced points.** With head and chest alone, 34 of 40 late wakes on
  FOUNDRY were bodies that came into view feet-first — under a catwalk, past a ledge's lip.
- **Dormant records keep alive and death live.** The design froze everything; the HUD's alive strip
  counts living enemies from the alive flag, and a death is public in the killfeed anyway.
- **`Unseen` is now invisible to humans** (P2), not only to bots.

**Measured** with the skirmish harness's audit (`VisibilityAudit.ts`; every flow run reports it),
FOUNDRY, TDM, three headless players and ten bots, one 60 s match:

| Link | Enemy records sent dormant | Bodies coming into view | Late | Worst | Cost per seat-snapshot |
|---|---|---|---|---|---|
| none | 59% | 152 | 8 (5.3%) | 108 ms | 195 µs |
| 100 ms | 51% | 219 | 6 (2.7%) | 61 ms | 200 µs |
| 100 ±30 ms, 2% loss | 51% | 185 | 5 (2.7%) | 113 ms | 252 µs |

*Hard misses* — a body in plain view sent dormant — were **0** in every run. A *late* appearance is
a body that came into view having been relevant for less than the client draws behind the server,
so it appears on screen up to that much late; what is left is slivers (a foot, a shoulder) and
bodies moving between levels or faster than sprint. The flow fails above 15% (a look-ahead that has
stopped working makes nearly every appearance late) and on any hard miss.

**Cost**: ~0.2 ms per seat per snapshot on the development machine — at 20 Hz, ~4 ms a second per
human seat; a full live match of ten humans is ~40 ms a second here, roughly three to four times
that on Render's half CPU. Most of it is the hidden pairs, which test every ray before giving up;
the first optimisation if it ever matters is evaluating those at 10 Hz with a look-ahead one
snapshot longer.

## Phase 2, as built

Decisions E1–E4, taken by the human on 2026-10-04, each as recommended, revise this design:

- **E1 replaces R5's snapshot half (and D3).** Every sound event carries its own position, and the
  client places the sound from it, not from the body — so hearing a body is no reason to send it.
  Hearing filters the *events* only; it makes nobody relevant.
- **E2:** an enemy's footsteps, jumps and landings are sent within **12 m** (S6.3's radius, and the
  bots'). The client's footstep curve runs to 26 m, so steps between 12 and 26 m — at 9% down to
  4% of full level — are no longer heard.
- **E3 replaces D5.** An enemy's health already follows visibility: a dormant record freezes it
  where it was last seen, and the plate over a visible enemy shows what any player sees. What
  still leaked is `killerHealth` on every `Killed`; it goes to the victim only.
- **E4:** smoke as an occluder moves to phase 3.

**Part 1 — R9, the hurt-by rule.** Phase 1 broke the hit-direction chevron: `ClientMatch.bodyAt`
returns nothing for a dormant body, so a round from a shooter the player was not told about — a
wallbang, an eye line blocked where the muzzle's was not — hurt from nowhere, and the death report
lost the killer's distance. Now the instance hears `damage.dealt` and reveals the source to the
target's seat (`SeatView.reveal`) for the linger, so the next snapshot carries it awake; the client
waits up to `WAKE_WAIT_MS` (300 ms) for that snapshot before pointing the chevron or measuring the
distance (`client/net/WakeWait`), because the damage rides the event frame of its own tick and the
snapshot that wakes the shooter can be a snapshot interval behind it. A sentry's round reveals
nobody: its `sourceId` is the owner, who may be anywhere. The audit counts hits from a shooter the
seat had dormant, and fails the flow if one is still dormant in the next snapshot.

Measured on FOUNDRY, three headless players and ten bots, 120 s: 48 hits on players with no added
latency and 36 on the bad profile, **none** from a dormant shooter — bots do not shoot through
walls, so with them the case is rare, and R9 is there for the players who do. Late appearances
in these runs and two 60 s ones were 0–1.3% (phase 1's: 2.7–5.5%) — R9 lengthens the linger on
whoever is shooting, which may be part of it; the two were not measured apart. Hard misses: 0.
In the browser, a chevron for a shooter that woke 134 ms after its hit appeared on the frame it
woke, and chevrons for awake shooters appeared at once as before (43 of 43).

## Phases

1. **Entities — built.** Per-recipient relevance (R1–R4, R6, R7, R8, `Unseen`), `EFlag.Dormant`,
   the client honouring it. Protocol 28. Tests 1, 3 and 4.
2. **Events and the rest — being built.** R9; per-recipient events (D2) filtered by hearing (E1,
   E2, D4); `killerHealth` to the victim only (E3); the S&D bomb's carrier. Test 2.
3. **Smoke** as an occluder (E4), and only if the cost asks for it, the baked visibility set.

## Decisions

All taken by the human on 2026-10-04, each as recommended — D1–D5 with the design, E1–E4 before
phase 2 was built. They are binding on the build.

| | Question | Decided |
|---|---|---|
| D1 | Remove culled entities, or mark them dormant? | **Dormant** — no avatar rebuilds, no pop-in from an empty buffer |
| D2 | A suppressed shot from a body nobody can see: send the terminus only, or nothing? | **Terminus only** — the impact and the decal are real, and they reveal nothing the victim's damage event does not |
| D3 | Accept that bodies within hearing range are sent? | **Yes** — the alternative is silent footsteps, which is a different game |
| D4 | Crouch-walking and Dead Silence are silent to bots today but their footsteps reach every human. Make them silent to humans too (not sent to enemies)? | **Yes** — it is what the perk says it does, and it removes a leak |
| D5 | Hide an enemy's exact health from the other team? | **Yes**, phase 2 — alive or dead only. *Revised by E3* |
| E1 | Make a body relevant because it can be heard (R5), or filter only the sound events? | **Events only** — each carries its own position. *Revises D3* |
| E2 | An enemy's footsteps, jumps and landings: within 12 m, or the client's 26 m curve? | **12 m** — the game's rule and the bots' |
| E3 | Hide an enemy's health altogether (the plate over a visible enemy goes), or let it follow visibility? | **Follow visibility**, and `killerHealth` to the victim only. *Revises D5* |
| E4 | Smoke as an occluder in phase 2? | **No** — phase 3; the server cannot foresee a cloud thinning, so bodies would pop out of it |
