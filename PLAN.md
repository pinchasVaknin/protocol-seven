# PROTOCOL SEVEN — PLAN

Browser arena FPS. This file is the handover: what exists, what was decided, and what the next
milestone needs to know. A fresh session inherits the repository and this file, nothing else.

M1–M8 built a complete single-player browser game. M9–M11 moved it onto a dedicated external
server: the split first, then the netcode, then everything else on top of it. M12 is the scoped
content backlog, M13 (archived) put skinned bodies on the bots and moved the board and the XP
award to the server, M14 (archived) put vitest in the gate and legacy decorators behind a fence,
M15 (archived) rebuilt the front end to fit one screen, and Milestone 16 is the milestone in
progress; the backlog and M16 are below, in full.

**Survival mode is cancelled** — permanently, not deferred. See "Roadmap update — post-M8" in
[12-post-m8-round-4.md](docs/archive/plan/12-post-m8-round-4.md).

---

## Where the record is

The closed sections of this file were moved to `docs/archive/plan/` on 2026-09-14 (baseline
`29533b2`), one file per section, verbatim, in the order they were written. Each file opens
with the line range it came from. A code comment that says "see PLAN.md, M5 notes" resolves
here: find the row, open the file.

This index makes no claim about what is complete. The honest answer to that question is the
"What Gate B still needs" list in [17-m11-gate-b-in-progress.md](docs/archive/plan/17-m11-gate-b-in-progress.md), as the Milestone 12 section below says.

| # | Section, title as written | Lines | File |
|---|---|---|---|
| 1 | Milestone 1 — Core Loop and Movement | 281 | [01-m01-core-loop-and-movement.md](docs/archive/plan/01-m01-core-loop-and-movement.md) |
| 2 | Milestone 2 — Gunplay | 332 | [02-m02-gunplay.md](docs/archive/plan/02-m02-gunplay.md) |
| 3 | Milestone 3 — Bots | 253 | [03-m03-bots.md](docs/archive/plan/03-m03-bots.md) |
| 4 | Milestone 4 — Map and Team Deathmatch | 353 | [04-m04-map-and-team-deathmatch.md](docs/archive/plan/04-m04-map-and-team-deathmatch.md) |
| 5 | Milestone 5 — Arsenal | 422 | [05-m05-arsenal.md](docs/archive/plan/05-m05-arsenal.md) |
| 6 | Milestone 6 — Progression and Loadouts | 361 | [06-m06-progression-and-loadouts.md](docs/archive/plan/06-m06-progression-and-loadouts.md) |
| 7 | Milestone 7 — Killstreaks and Modes | 255 | [07-m07-killstreaks-and-modes.md](docs/archive/plan/07-m07-killstreaks-and-modes.md) |
| 8 | Milestone 8 — Content and Polish | 296 | [08-m08-content-and-polish.md](docs/archive/plan/08-m08-content-and-polish.md) |
| 9 | Post-M8 — Polish and Bugfix | 252 | [09-post-m8-polish-and-bugfix.md](docs/archive/plan/09-post-m8-polish-and-bugfix.md) |
| 10 | Post-M8, round 2 — the re-opened reports | 161 | [10-post-m8-round-2.md](docs/archive/plan/10-post-m8-round-2.md) |
| 11 | Post-M8, round 3 — the regression, and two things that were never measured | 134 | [11-post-m8-round-3.md](docs/archive/plan/11-post-m8-round-3.md) |
| 12 | Post-M8, round 4 — the jitter, found | 250 | [12-post-m8-round-4.md](docs/archive/plan/12-post-m8-round-4.md) |
| 13 | Milestone 9 — Headless Server Split | 499 | [13-m09-headless-server-split.md](docs/archive/plan/13-m09-headless-server-split.md) |
| 14 | Milestone 10 — Netcode Foundation | 595 | [14-m10-netcode-foundation.md](docs/archive/plan/14-m10-netcode-foundation.md) |
| 15 | M10.5 — Tier 1 fixes carried back from M11 | 103 | [15-m10.5-tier-1-fixes.md](docs/archive/plan/15-m10.5-tier-1-fixes.md) |
| 16 | Milestone 11 — Skirmish Multiplayer Flow | 295 | [16-m11-skirmish-multiplayer-flow.md](docs/archive/plan/16-m11-skirmish-multiplayer-flow.md) |
| 17 | M11 Gate B — in progress | 337 | [17-m11-gate-b-in-progress.md](docs/archive/plan/17-m11-gate-b-in-progress.md) |
| 18 | M11 Gate B — playtest round 2 | 3,494 | [18-m11-gate-b-playtest-round-2.md](docs/archive/plan/18-m11-gate-b-playtest-round-2.md) |
| 19 | Milestone 12 — the playtest round 4 and round 5 fix records | 4,120 | [19-m12-playtest-rounds-4-5-fixes.md](docs/archive/plan/19-m12-playtest-rounds-4-5-fixes.md) |
| 20 | Milestone 13 — proposed: bodies that read, and one answer to "is this an enemy" | 1,207 | [20-m13-bodies-that-read.md](docs/archive/plan/20-m13-bodies-that-read.md) |
| 21 | Milestone 14 — decorators where a concern is written by hand, and a unit-test runner that shares the gate | 339 | [21-m14-decorators-and-vitest.md](docs/archive/plan/21-m14-decorators-and-vitest.md) |
| 22 | Milestone 15 — proposed: the front end, rebuilt to fit one screen | 1,566 | [22-m15-front-end.md](docs/archive/plan/22-m15-front-end.md) |

What stays in this file: **Milestone 12 — proposed** (the content backlog) and **Milestone 16**
(the body other players see — B6, the wire — proposed; one "done" subsection per step as each
closes).

## How this file stays short

This file holds exactly three things: the index above, the content backlog, and the one
milestone in progress. Nothing else. When a milestone closes — in the session that closes it,
before the summary — its whole section moves, verbatim, to `docs/archive/plan/NN-slug.md` with
the provenance line the other files carry, and gets a row in the index; the `## Playtest round`
sections that accumulated under it go with it. Lines move; nothing is rewritten. `npm run
check:plan` refuses a third `# ` section here and an index that disagrees with the folder, so this
is a gate rather than a habit — the same reason the boundary check exists.

---

# Milestone 12 — proposed: the large content

Playtest round 4's remaining five items — **F4** (character skins and 3D models), **F5** (a
story), **F6** (more maps), **F16** (minigun, flamethrower, riot shield) and **F17** (a detailed
grenade-throw animation). None of them is a defect and none of them is small. This section is a
scoped estimate in the shape of the one that cancelled Survival: what the existing structure
already answers, what it does not, what each item breaks, and the decisions that are the human's
rather than mine. **No product code was written in this session.**

## The constraint that decides nearly everything

**This project has no asset files.** Not "few" — none. Measured this session: `src/`, `public/`
and `index.html` hold **296 `.ts` files, 5 `.css` files and 0 files of any image, model, audio,
font or environment format**. The only thing under `public/` is eight verification scripts.
Everything the player sees and hears is generated at runtime by code, and the code that does it
is **5 118 lines across sixteen files** — `ProceduralTextures`, `ProceduralAudio`, `AudioSpecs`,
`FxAssets`, `CamoTextures`, `BotMesh`, `StreakMeshes`, `WeaponMesh`, `WeaponMeshParts`,
`WeaponModelSpecs`, `WeaponSilhouette`, `KnifeMesh`, `MapMesher`, and the three map data tables.
Five per cent of the tree, standing in for an entire discipline.

That is not a stylistic preference, and its consequences are already load-bearing in three
places this milestone has touched:

- **`ProceduralAudio.playAnnouncer` says it outright**: *"Speech synthesis of actual lines is out
  of reach without assets and worse than nothing when it lands badly."* Ten announcer cues are
  formant-shaped noise bursts, not words. **F5 has to be read, not heard.**
- **`BotMesh`: "The mesh IS the rig: same boxes, same offsets, nothing to drift out of sync."**
  `buildZoneGeometry` walks `HUMANOID_RIG.boxes` — the same boxes `Ballistics` tests a round
  against. What you shoot is what you see, by construction rather than by discipline. **F4 is a
  proposal to break that identity**, and that is the whole of F4.

  **Round 5 executed F4 and broke it, in one direction and by a measured amount.** The paragraph
  above stands as the statement of what was at stake; what actually happened is in *"bodies, and
  the identity that had to be broken in exactly one direction"* below. The short version: the
  head and the torso are still exactly the rig and diverge by zero, the legs swing and the arms
  are posed onto the weapon, and the worst divergence is 0.412 m on a leg and 0.257 m on an arm
  — both on the two zones carrying the lowest multipliers in the game. It is measured every run
  by `npm run readability` rather than promised here. The identity is now a rule about *which*
  boxes rather than about all of them, and that is the thing a later session must not quietly
  widen.
- **F9, one session ago**, found the darkest map in the game was dark because a number in a
  *painter* was 0.019 where it should have been 0.07. With no assets there is no texture to
  inspect in an image editor; the only way to know what a surface looks like is to compute it,
  which is why `npm run readability` exists at all.

Today's client build, measured this session: **1 370.06 kB raw, 391.06 kB gzip**, plus 43.01 kB
of CSS. There is no loading screen for content because there is no content to load — §6.5's
background map build exists to hide *mesh construction*, not downloads.

## F4 — the fork in the road, and it is not a feature

"Skins and 3D models" is two different milestones wearing one sentence.

### (a) Stay procedural — skins as parameters

`CamoTextures` is the working precedent: six weapon camos, 333 lines, six *different
constructions* rather than six recolourings, each a seeded `Rng` drawing into a 256px canvas,
cached once per process. A character skin in the same idiom is a small parameter set — body,
head and gear tint, a pattern generator, maybe a silhouette accent — applied to geometry that
does not change.

| | |
|---|---|
| **Cost** | Days, not weeks. One new generator file, a `SkinId` beside `CamoId`, a picker row in the loadout editor, six or so unlock records |
| **Load time** | **Zero change.** Six 256px canvases is roughly 1.5 MiB of GPU texture, built once per process |
| **Risk** | Low, with one real edge: the hostile-body colour is taken from `ui/Palette` so it moves with colourblind mode, and a skin that painted its own colours would be a **second writer of the same fact** — the exact shape P0 bans. A skin must tint *within* the palette's answer, not around it |
| **Ceiling** | Genuinely low. Nobody will mistake it for a character model |

### (b) Build an asset pipeline — glTF, loading, caching, versioning

| | |
|---|---|
| **Cost** | A milestone in itself, and the loader is the smallest part of it: a cache with eviction, an asset manifest with content hashes, a CDN or a served directory, a licence audit for every model, and a build step that does not exist |
| **Load time** | This is the number that should decide it. The whole client is **391 kB gzipped** today. One rigged character with a 1k texture set is typically 2-10 MB. That is not a percentage on the download, it is a **multiplier**, and it arrives before the first frame unless a streaming path is built too |
| **What it breaks** | Everything above about the rig. A skinned mesh is not a stack of oriented boxes, so either the visual stops matching the hitboxes — which is a fairness defect, not a cosmetic one — or a second rig-to-mesh binding is built and kept honest by something that does not exist yet |
| **What else it breaks** | `npm run leak` watches heap and live subscriptions across 100 cycles. GPU resources behind an asset cache are a new class of leak it does not currently see. §8.7's 5 ms build budget is sized against *mesh construction*; a decode-and-upload pass is a different cost with a different shape |

**Recommendation: (a).** Not because (b) is wrong in principle but because of the order: (b)
spends a milestone on infrastructure whose first visible output is one character model, while
(a) reaches the same player-facing sentence — *"my operator looks different from yours"* — in
days and leaves (b) available afterwards. Route (b) also has to be taken *before* F6 rather than
after, because a map authored as data and a map authored as meshes are not the same file, and
authoring a map twice is the expensive mistake.

**Start neither until the human picks.** The two paths diverge at the first line of code.

## F16 — three new killstreaks

P4 made streaks a **currency**: `StreakLedger` holds a balance in kills, `charge` refuses what
the balance cannot cover and what has already been bought this life, and P4's measurement was
that the balance model affords **38 streaks across 705 lives where the threshold model handed out
75**. Nine streaks against three class slots is therefore a *choice* problem, not an inflation
one — the wallet still buys about one thing per life. *(Written before the cooldown pivot. The
wallet is still what bounds a purchase; what has changed is that a long life can now buy the
same thing twice, so a fourth streak competes for repeats as well as for slots.)*

Two facts from P4 that all three inherit: **no bot has ever spent a killstreak** (there is no
call site — bots bank a balance and never spend it), and **`EV.StreakEarned` has no gameplay
subscriber**, so a streak becoming affordable is announced to nobody. Three more streaks is
three more things the ten opponents will never call in and three more things nothing will
announce.

### What all three have in common, and it is new

Every shipped streak is either an **entity in the world** (sentry, care package), an **effect**
(UAV, counter-UAV, mortar) or a **camera takeover** (chopper). None of them puts a weapon in the
player's own hands while the player keeps playing. All three of F16's do, and that is the
mechanism the estimate turns on:

- **`WeaponSystem` has exactly two slots**, `primary` and `secondary`, and `equip(slotIndex,
  def)` sets one. So a streak weapon replaces the class's primary on activation and is put back
  on expiry — and the Chopper Gunner's rule applies verbatim and for the same reason: *"there is
  exactly one exit path… two things that can restore state are two things that can disagree
  about whether it has been restored."* `onExpire` is idempotent and `StreakSystem` already
  guarantees it runs on the timer, on death, on `MatchEnded`, on `dispose` and — since S8.23's
  case 4 — on the owner disconnecting.
- **`weaponIndexOf` returns 255 for anything not in `ALL_WEAPONS`.** The three synthetic streak
  weapons in `StreakWeapons.ts` are built by cloning the carbine and are not registered, which is
  correct today because nobody carries them. The moment a *player* carries one, that 255 is what
  remote clients receive in `EntitySnapshot.weaponIndex` — see "Found while here" for what it
  already costs.
- **A weapon swap the server owns has to reach the client's prediction.** P3 established the
  shape: `meta.setLoadout` re-runs the perk hooks and one of them writes
  `PlayerController.speedScale`, so a class swapped on a standing body made the client predict a
  different speed than the server — *"a constant per-tick disagreement about speed, which is what
  rubberbanding is."* A minigun that slows its carrier is exactly that, arriving mid-life with no
  spawn to hide behind.

### Minigun

| | |
|---|---|
| **Price** | 9 kills — between the sentry (8) and the chopper (12) |
| **Simulated by** | The server, through `WeaponSystem` like any other weapon. Nothing new in the damage path |
| **Wire** | `weaponIndex` only, *if* the def is registered. `MsgS.Streaks` needs no new field — `kind` is already a `u8` index into `STREAK_DEFS` and `MAX_STREAK_OFFERS` stays 3 |
| **Owner disconnects** | `onOwnerRemoved` already fires; the exit path restores the class primary to a body that is being removed anyway. **No new case** |
| **Without assets** | Cheapest of the three. `WeaponModelSpecs` builds guns from boxes and tubes; a minigun is a barrel cluster on a spin. `WeaponSilhouette` projects its killfeed glyph from the same spec for free, which is F15's payoff arriving early |
| **The real cost** | Spin-up and a movement penalty are both `speedScale`-shaped, which is the misprediction above. The chopper's belt (`chopperMagSize` / `chopperReloadSeconds`) is the precedent for bounding a held trigger without bounding the streak's length |

### Flamethrower

This is the one that does not fit the combat model, and it should be built as though it does.

`Ballistics` is hitscan with a penetration budget; `projectileSpeed` marks the only exceptions
(*"absent = hitscan. Only launchers and thrown equipment set this"*). A flame is neither.
Continuous damage has no representation anywhere: `DamageSystem.apply` is one request and one
answer, so a burn would be N small applies per tick flooding the damage-event channel, the
hitmarker and the damage numbers — and would want a `Burning` bit on an entity flags byte that
has none left (below).

**The cheap correct model is the shotgun's.** `pellets` and `pelletSpread` already resolve
several rays per trigger pull against the rig separately, and `damageFalloff` already collapses
damage with distance. A very short range, a very high rate, a wide cone and a brutal falloff is a
flamethrower's *behaviour*; the fire is presentation, which is exactly where §4.15 puts it — `Fx`
draws an additive cone with no texture, and `check:cosmetics` stays green because nothing about
it is in a snapshot.

| | |
|---|---|
| **Price** | 7 kills — the mortar's, and for the same reason: it buys a short decisive window rather than a presence |
| **Simulated by** | The server. No new damage kind if the pellet model is taken |
| **Wire** | `weaponIndex` only |
| **Owner disconnects** | The same door as the minigun |
| **Without assets** | The item that looks *best* without assets, because a flame is light rather than surface |
| **What a real burn costs instead** | A damage-over-time source, an entity flag bit that does not exist, a per-tick damage channel it would flood, and a bot question nothing answers today — `BotDirector` has no notion of "standing somewhere that hurts". Smoke blocks LOS; it does not injure |

### Riot shield and pistol — the heaviest of the three, and it is not close

The shield is **not a weapon**. The pistol half is nearly free: `equip(0, classPistol)`. The
shield half changes the hitbox model, and three facts make it the expensive one:

1. **`HitboxRig.layout` is `readonly`**, fixed at construction, and every one of the six
   construction sites passes `HUMANOID_RIG` — `Bot`, `NetPlayer`, `RemoteActor`, `Spectator`,
   `TargetDummy` and the default argument. `buildLayout` exists, so a second layout is
   anticipated; nothing swaps one.
2. **`RigHistory` stores five numbers per tick** — x, y, z, yaw, `heightScale` — and its own
   comment explains why: *"A rig is fully described by five numbers… store its history, do not
   invent a second representation."* It does **not** store which layout the rig had. A body whose
   *shape* changes during a life is therefore invisible to S4.13's lag compensation: a shot
   rewound 150 ms resolves against the shape the body has **now**, not the shape it had then.
   That is a silent hit-registration bug in the exact system M10 was spent getting right.
3. **`ColliderSet` is baked at boot and shared read-only across instances** (`MapBakery`,
   S4.19). A shield modelled as a moving world collider does not fit that structure at all.

Three ways to do it, and they are not equivalent:

| Route | What it costs | Verdict |
|---|---|---|
| **A second `RigLayout` with a shield box**, plus one `Uint8Array` of layout ids in `RigHistory` | `layout` stops being `readonly`; `push` / `fill` / rewind gain one field; `BotMesh` builds the shield from the same boxes, so *"the mesh is the rig"* survives intact | **Recommended.** The only route where what you shoot stays what you see |
| **A damage-side predicate** — "did this ray arrive in the front hemisphere of a shielded entity" | No geometry and no history change. But `Ballistics` has already resolved the hit by the time `DamageSystem` is asked, so the shooter gets a hitmarker for a round that did nothing — and it is a second place that decides a hit outcome | Rejected: the second-writer shape, and it lies to the shooter |
| **A moving world collider** | Honest physics, and it does not fit `ColliderSet`'s immutable shared bake | Rejected on structure |

| | |
|---|---|
| **Price** | 8 kills — the sentry's. It buys survival rather than damage |
| **Simulated by** | The server. The raise/lower state is per-entity and needs a wire bit (below) |
| **Wire** | The shape has to reach clients, or a remote shielded body both draws and rewinds wrong |
| **Owner disconnects** | The same door, and the rig must be put back to `HUMANOID_RIG` on the way out — the one restore path again |
| **Without assets** | A box. A riot shield is genuinely a slab, which is the one place this art style is not a compromise |

### The wire has no spare bits, and this is the finding to act on first

Both flag bytes are **full**, read directly:

- **`EFlag`** — `Alive`, `Firing`, `Reloading`, `Ads`, `Sprinting`, `Bot`, `Grounded`, `TeamB`.
  Eight of eight, written as `w.u8v(e.flags & 0xff)`.
- **`OF`**, the owner-state byte — `Grounded`, `WasGrounded`, `SprintActive`, `TacSprintActive`,
  `SlideActive`, `MantleActive`, `JumpedThisTick`, `JustLanded`. Eight of eight.

So *every* new per-entity boolean in this milestone — a shield raised, a grenade being cooked —
needs a field widened, and that is a protocol bump. Current version is **12**; the first wire
change in M12 is **v13**. Widen once, deliberately, rather than three times.

## F17 — the grenade animation, and where the line runs

Today there is no grenade in hand at all. `ViewmodelDrive.throwing` is one boolean derived from
`ThrowController.busy`, and `ViewmodelAnim` uses it to **lower the weapon off screen** through a
damped `throwPose`. The comment is honest about it: the throw *"used to read as the grenade
appearing from nowhere"*, and lowering the gun was the fix available at the time.

**The first-person half is free, and it is free because the simulation already holds the whole
sequence.** `ThrowController` runs on sim ticks off the input bitfield and exposes `phase`
(`IDLE` / `COOKING`), `cook` in seconds, `slot`, `followThrough` and `remainingFuse`. Pin pull,
arm cock, release and recovery are four poses keyed off values that already exist and that both
runtimes compute identically. The animation reads them; it must never write them, and it must
never keep its own clock — the fuse starts when the button goes **down**, and an animation that
decided when the hand opened would be a second authority on a timing the server owns.

That is the line, stated once: **`ThrowController` decides when the grenade leaves the hand;
`ViewmodelAnim` decides what that looks like.** Nothing new is replicated, nothing new is
recorded, and `check:cosmetics` is untouched because the snapshot is untouched.

**The third-person half splits in two, and the split is the decision:**

| What | Derivable today? |
|---|---|
| **The release**, on somebody else's body | **Yes, free.** `ProjectileState` carries `ownerId` and a `serial` that is *"already unique per throw and already stable for a projectile's whole life"*. The frame a new serial appears owned by entity N, entity N threw something. No wire change |
| **The wind-up** — pin, cock, hold | **No.** It happens entirely before the projectile exists. Nothing in the snapshot says a grenade is being cooked, and `EFlag` has no bit left to say it |

**Recommendation: take the release for nothing now**, and take the wind-up only if `EFlag` is
being widened for the riot shield anyway — one bump, two features. A wind-up also has a gameplay
consequence worth naming before it is built: seeing an enemy cook is *information*, and adding it
changes fights, which makes it a balance decision rather than an animation one.

## F6 — what a map actually costs, measured

The only item here whose cost is fully known, because three of them exist. Measured this session
— the counts from the built map defs, the bake times from a real server boot (`npm run
skirmish`), the ground luminance from `npm run readability`:

| | Foundry | Dunes | Depot | (Testbed) |
|---|---|---|---|---|
| Brushes | 48 | 109 | 50 | 71 |
| Prop placements | 76 | 60 | 84 | 34 |
| Spawn zones | 16 | 18 | 18 | 13 |
| Lights | 4 | 2 | 8 | 2 |
| Objectives | 6 — `flag×3 bombsite×2 bombspawn×1` | 6, identical | 6, identical | 0 |
| Lanes | 3 | 3 | 3 | 0 |
| Cover points | 220 | 164 | 172 | 72 |
| Nav layers | 2 | 2 | **3** | 2 |
| Playable area | 3 348 m² | 5 440 m² | 4 480 m² | 2 080 m² |
| Collision bake | 2.45 ms | 0.45 ms | 0.34 ms | 0.23 ms |
| **Navmesh bake** | **55.28 ms** | 19.71 ms | 26.17 ms | 7.09 ms |
| Resident | 0.37 MiB | 0.59 MiB | 0.71 MiB | 0.24 MiB |
| Source | 514 lines | 601 | 899 | 499 |
| Ground, as the screen shows it | 61.7 / 255 | 185.0 | 21.3 | — |

Four maps bake in **112.87 ms for 1.90 MiB** at boot. A fifth adds one of those rows and nothing
else on the server: `MapBakery` bakes every map in `MAPS` before the listener opens, so the cost
lands at boot rather than in a transition, by design.

**What is free and what is not:**

- **Cover points are free.** `cover.ts` derives them from prop placements and the shape's own
  profile — *"a 1 m cube is cover from every side; a container is a wall and only its long faces
  are"*. The 164-220 above were authored as 60-84 props. `navStats.coverRejected` is the data-bug
  signal on a new map and should be read before anybody plays it.
- **The navmesh is free.** *"A map therefore needs no nav authoring at all — only honest
  `navBounds`."*
- **Objectives are not free and are not optional.** `modesForMap` filters the ballot by authored
  objective kinds, so a map that skips them silently offers three modes instead of five. All
  three real maps author the identical six, and the flag positions have to be balanced *before*
  the lanes are — `types.ts` says why: moving three flags after the lanes are balanced means
  re-balancing the lanes.
- **The ballot has a ceiling of five and it is nearly reached.** `MAP_BALLOT` holds three; digits
  1-5 cast votes and are shared with the quick class selector, which takes them only while the
  ballot is hidden (round 3). A fourth map fits. A **sixth has no key**, and at five maps the
  class selector is unreachable for the whole map-vote phase.
- **The lighting bar is measurable before it is played.** `npm run readability` reports the ground
  as the screen shows it: Foundry 61.7, Dunes 185.0, Depot 21.3 — a spread of nine to one. A new
  map lands somewhere on that line, and F9's lesson is that the number to check is the **albedo in
  `albedo.ts`**, not the light intensity.
- **The client build time is the one unknown, and it is the one that matters.**
  `MapBuildQueue`'s 5 ms budget and the 20 s readiness timeout are *"one decision, not two"*,
  sized against an assumed two-second build, and the file says plainly that the measured build
  time per map *"needs a real browser"*. It has never been measured for **any** map. A fourth map
  is precisely the thing that would break that pair, and this session cannot say by how much.
  **Measure the three existing maps in a browser before authoring a fourth**, or the fourth will
  be the first data point and a timeout will be the first symptom.

Weight, from the Survival estimate this file already accepted: *"The same effort spent on a fourth
and fifth map… buys more variety per unit of risk."* That reasoning has not changed, and F6 is the
only item here with no architectural unknown in it.

## F5 — a story, honestly

**Do not assume the answer is a campaign.** Three different things hide behind the word and they
differ by two orders of magnitude.

### (a) A frame — a faction, a place, names

Nearly free, and the surfaces already exist and are already read: `ModeEntry.blurb` (six),
`GameMode.brief` (six, and F10 built the window they appear in one session ago), four map names
and blurbs, the loading screen, the summary, and the player's own default callsign — `OPERATOR`,
which is also the game's name. A frame is written into strings that are already on screen.
**Zero engineering.**

### (b) An order of battle — the opposition as characters

Bots have tiers (`RECRUIT` / `REGULAR` / `HARDENED` / `VETERAN`), a per-map authored `tierMix`,
and names already resolved through the directory the killfeed and scoreboard share. Giving the
opposing side a persistent identity across a session — a named unit, ranks that match tiers, a
roster that recurs — is small work on top of structure that exists. Medium cost, and it is the
item that would make the *existing* content feel authored rather than generated.

### (c) A campaign

The Survival estimate's argument applies without modification: a campaign is *"the first mode
that is not a variation on two teams, a score limit and a respawn rule"*. It needs mission flow
as a state, scripted triggers, objectives that are not the five modes, per-mission authoring and
a fail-and-retry loop. And then it needs dialogue — and this build **cannot speak**. Ten
announcer cues are formant-shaped noise, and the file that makes them says speech is out of reach
without assets. **A campaign in this build is a silent, text-delivered campaign**, which is a
different product from what the word suggests to whoever asked for it.

**Recommendation: (a) now, (b) with F6, not (c).** A new map that arrives with a name, a place
and an opposing unit is most of the story at a fraction of the cost, and it is the half that
survives however the F4 fork is decided.

## Dependency order

The first item unblocks the most, which is the ordering rule this file has used since Gate B.

1. **The F4 fork** — decided, not built. It gates F6: a map authored as data and a map authored
   as meshes are not the same file, and route (b) taken after F6 means authoring the map twice.
2. **F5 (a), the frame** — costs nothing and decides the names F6 and F4 then use.
3. **Measure the client map build in a browser** — the §8.7 number open since M11, and the one
   F6 cannot be sized without.
4. **F6, map four** — the highest player-hours per unit of risk, and the only item with no
   architectural unknown.
5. **The `EFlag` widening (protocol v13)** — one bump, taken deliberately, because F16 and F17
   both need bits and neither can have one.
6. **F17** — release-only third person costs nothing; the wind-up rides v13.
7. **F16, in this order: minigun → flamethrower → riot shield.** The minigun establishes the
   streak-carries-a-weapon path — equip, restore, the one exit, the prediction question. The
   flamethrower reuses it plus the shotgun's pellet model. The shield goes last because it is the
   only one that touches lag compensation, and it should not be built on a path that is still
   moving.
8. **F4, as (a)** — genuinely last, and the only item that can be deferred indefinitely with no
   loss to anything else.

## What each item breaks

| Item | What it puts at risk |
|---|---|
| F4 (a) | The palette's single authority over team colour — a skin that paints its own is a second writer, and `npm run readability`'s 12-pair colour invariant is the probe that would have to grow to cover it |
| F4 (b) | *"The mesh is the rig."* Hit registration stops being verifiable by looking. Plus a leak class the 100-cycle harness does not watch, and a download budget currently at 391 kB gzip |
| F16 minigun | Prediction: a server-owned weapon swap mid-life, with a movement penalty, is P3's `speedScale` rubberband with no spawn to hide behind |
| F16 flamethrower | The damage path, if a real burn is chosen over the pellet cone |
| F16 riot shield | S4.13 lag compensation. A body whose shape changes during a life rewinds to the wrong shape, silently |
| F17 | Nothing, if the animation reads `ThrowController` and never writes it. A second clock over the fuse would be the banned shape exactly |
| F6 | The §8.7 budget/timeout pair, and the ballot's five-key ceiling |
| F5 (a)/(b) | Nothing |
| F5 (c) | Everything Survival would have broken, and it ships mute |

## Decisions waiting on the human

Each with a recommendation, and none of them started.

| # | Decision | Recommendation |
|---|---|---|
| 1 | **F4: procedural parameters, or an asset pipeline?** | **Procedural.** (b) spends a milestone on infrastructure to ship one model, and breaks the mesh-is-the-rig identity |
| 2 | **Are the three streak weapons registered in `ALL_WEAPONS`?** | **Yes**, with an unreachable `unlockLevel`. It is what makes `weaponIndex`, the killfeed glyph and the silhouette work with no parallel table. It moves `check:unlocks`'s count off 12 weapons and will want unlock records |
| 3 | **`EFlag` is full. Widen to 16 bits, or go without?** | **Widen, once, as v13.** The shield's raise state and the throw wind-up both need a bit and neither can be derived |
| 4 | **Flamethrower: pellet cone, or a real burn?** | **Pellet cone.** It reuses the shotgun's machinery and adds no damage kind, no flag bit and no bot question |
| 5 | **Riot shield hitbox: second `RigLayout`, damage predicate, or moving collider?** | **Second layout**, plus one array in `RigHistory`. The only route where what you shoot stays what you see |
| 6 | **Are the new streaks unlock-gated?** | **No.** All six shipped ones are ungated; gating three of nine makes the picker inconsistent for no gain |
| 7 | **Prices: minigun / flamethrower / shield** | **9 / 7 / 8.** P4 measured the balance model at 38 streaks per 705 lives, so nine streaks over three slots is a choice problem rather than inflation. These are a starting point for the human to feel, not a result |
| 8 | **F17 third person: release only, or wind-up too?** | **Release now** — free, off `ProjectileState.ownerId`. Wind-up only alongside #3, and note that it is a balance change rather than an animation |
| 9 | **Does map four author all six objectives?** | **Yes.** Otherwise `modesForMap` silently offers three modes instead of five, and flags moved later mean lanes re-balanced later |
| 10 | **F5 scope** | **Frame now, order of battle with F6, no campaign.** A campaign here ships mute |

## Measured, this session

Every number in this section came out of a run in this session, named with the probe that
produced it. No product code was written, so there is nothing here to regress; the gate was run
to confirm the tree was clean before the documentation commit.

| Probe | Result |
|---|---|
| Asset-file census — `find src public index.html` over 17 image/model/audio/font extensions | **0 files.** 296 `.ts`, 5 `.css`, 101 369 lines |
| Procedural generators, `wc -l` over the sixteen files | **5 118 lines** — 5.0% of the tree |
| `npm run build` — client bundle | **1 370.06 kB raw / 391.06 kB gzip**, CSS 43.01 kB |
| `npm run skirmish` — boot bake, four maps | **112.87 ms / 1.90 MiB**; Foundry navmesh **55.28 ms**, Dunes 19.71, Depot 26.17, Testbed 7.09 |
| Map defs at runtime — brushes / props / spawns / cover / objectives / lanes | the F6 table above |
| `npm run readability` — ground as the screen shows it | Foundry **61.7**, Dunes **185.0**, Depot **21.3** of 255 |
| `npm run check` | boundaries, cosmetics (**19 snapshot fields**), unlocks (**12 weapons, 12 perks, 4 field upgrades, 5 equipment, 6 camos, 6 requirement accessors**), cheats (**6 codes, 5 entitlement bits**) and all three typecheck targets pass |

Read by inspection rather than measured, and named as such because they are the load-bearing
claims above: `EFlag` and `OF` each assign 8 of 8 bits; `HitboxRig.layout` is `readonly` and
`RigHistory` stores five per-tick fields with no layout among them; `WeaponSystem` has two slots;
`weaponIndexOf` returns 255 for any id outside `ALL_WEAPONS`; `PROTOCOL_VERSION` is 12.

## Needs a browser

This session drew no pixels and claims none. Two items below are prerequisites rather than
checks — they are inputs to decisions above, not verifications of them:

- **The client map build time, per map** (§8.7, open since M11). Load each of Foundry, Dunes and
  Depot from the arena and read `BuildReport` — `elapsedMs`, `workMs`, `chunks`, `worstChunkMs`,
  `frames`. **F6 cannot be sized without this**, and if any map costs materially more than two
  seconds of work then `DEFAULT_BUDGET_MS` (5) and `READY_TIMEOUT_MS` (20 s) both move, together.
- **Depot at 21.3 counts**, still on P9's list. If the yard still reads as black after the albedo
  change, the next lever is the irradiance floor rather than the albedo — and that answer changes
  how a fourth map should be lit before it is authored.

Everything else on the earlier browser lists is unchanged; this session neither added to them nor
removed from them.

## Found while here

- **Killstreak kills have no icon of their own, in either runtime, and F16 would add three more.**
  `DamageSystem` emits `EV.EntityKilled` with `weaponId = def.id`, so a sentry kill carries
  `streak_sentry`. Solo, `iconFor('streak_sentry')` reaches `modelSpecFor`, which returns
  `WEAPON_MODEL_SPECS[id] ?? AR_BASE` — so the feed draws a **carbine** for a kill by a turret.
  Over the network it is worse in a way that matters for the fix: `EventCollector` writes
  `weaponIndexOf('streak_sentry')`, which is **255** because the synthetic defs are deliberately
  not in `ALL_WEAPONS`, and `NetSession` decodes it back as `weaponIdAt(255) ?? ''` — so the
  client is handed an empty string and the id is gone. The two runtimes therefore need different
  fixes: solo has the information and lacks a spec, networked lacks the information. Not this
  session's item and nobody reported it, but decision #2 above is exactly the lever that would
  close both halves at once.
- **The milestone status table at the top of this file is stale** — it lists milestones 10 and 11
  as "Planned" while M11 Gate B is part-done and four playtest rounds have landed on top of it.
  Left alone deliberately: correcting it is a claim about what is complete, and Gate B's own
  "What Gate B still needs" list is the honest answer to that question rather than a table row. (2026-09-14: the table is gone — the header now carries an index of the archived sections and makes no completion claim, for this reason.)

*The playtest round 4 and round 5 fix records that followed this section are in [19-m12-playtest-rounds-4-5-fixes.md](docs/archive/plan/19-m12-playtest-rounds-4-5-fixes.md).*

---

# Milestone 16 — proposed: the body other players see (B6, the wire)

Opened at Milestone 15's close (2026-09-19, the human's "finish the milestone and continue").
B5 put a skin picker on the profile and deferred the wire twice — at B5, because the phase's
budget had gone on two GPU leaks and a first green probe, and at E, the human's call — so a
player who picks VIPER sees VIPER on their own stage and lineup while every other client deals
them a body from a shuffled deck. This milestone is the one `shared/net` change M15 declined:
**a skin index on `EntitySnapshot` and on the join, and `RandomCharacterSelector` demoted to
the fallback for a body that declared none.** It is small — a table, a byte, a bit, a field —
and it is a protocol bump, which is the reason it is a milestone and not a fix: every gate
that reads the wire has to be run, and the netharness has to say the byte costs what a byte
costs. Zero gameplay change: the body is cosmetic in every rule the game has — nothing in
`shared/player`, `shared/combat` or `shared/ai`'s simulation reads it — and the seeded
harness and the content probe are byte-identical by construction.
**No product code was written in this session.** Everything below was read from the tree.

## What exists, measured this session

| What | Number |
|---|---|
| Skins | **7**: `BOT_CHARACTER_IDS` in `client/characters/CharacterCatalog.ts` — apex, echo, hazard, pulse, rhino, sentry, viper — and `CharacterId` is that union, written by hand beside it. The catalogue is **client-only**; `shared/` knows exactly one skin fact, `DEFAULT_SKIN_ID = 'echo'` in `shared/meta/SaveData.ts`, and the catalogue asserts at module load that it names a real one |
| The pick | `settings.skin: string` at save **v4** (B5); `Profile.skinId` checks it against the catalogue and falls back to the default; `Profile.setSkin` from the editor's strip and the panel's APPEARANCE tab. Nothing on the wire carries it |
| `EntitySnapshot` | **19 fields**; the delta mask is a `u16` with **13 bits used** (`F.Pos` … `F.Name`), so bit 13 is free. A full write is `entityId` + mask + 6 pos + 2 yaw + 2 pitch + 4 vel + stance + height + health + weapon + flags = **22 bytes plus the name**; a standing player's delta is the id and an empty mask, **3 bytes**. `weaponIndex` is the precedent: an index into `ALL_WEAPONS`, **255 for none**, `weaponIndexOf` / `weaponIdAt` in `Snapshot.ts`, and `RemoteActor` reads it back through `weaponIdAt(latest.weaponIndex)` into `RenderableActor.weaponId` |
| `Hello` | `PROTOCOL_VERSION` **17**; the frame is version, name, a presence byte and the class, a presence byte and the reconnect token — the token last *"so the class, which every connection has an opinion about, is not behind a field most of them omit"*. `writeHello` has two callers, `NetClient` and `Handshake` |
| The join | `Session` decodes the `Hello`, `events.onJoin(session, name, claim)` → `Server` → `instance.seat(session, session.loadout)` → `Match.addPlayer(displayName, …, loadout)` → `new NetPlayer(…)`. **The loadout is a property of the session** and the session outlives the instance: `Migration` reads `session.loadout` at migration time and seats it in the destination, and a reconnect restores `held.loadout ?? session.loadout`. A second per-session fact rides the same road with no new plumbing |
| The server's fill | `writePlayer` and `writeBot` in `server/instance/MatchInstance.ts`, one line per field, *"lifted verbatim from M10's `GameServer`"* |
| The client's deal | `CharacterAvatarProviderResolver` — `(actor: RenderableActor) => CharacterAvatarProvider` — whose own comment says *"a future player-selected appearance can replace the deterministic bot selection at this boundary, without coupling the renderer to account or networking code."* `Game` resolves it through `RandomCharacterSelector.characterIdFor(actor.entityId)`, seeded per match from `CHARACTER_DECK_SALT`, the matches played and the worlds built; D's `lineupSource` returns the profile's pick for the local id and the selector's for everyone else; `MenuSkirmish` deals its own deck to bodies nobody else sees |
| `RenderableActor` | `shared/ai/BotVisualState.ts`; thirteen members, no character; implemented by `Bot` (shared) and `RemoteActor` (client), faked by the layout probe's fixtures |
| `check:authority` | **one row** — the team score — a grep for the local copy under `src/client` with the accessor to use instead |
| `check:cosmetics` | **pins the snapshot's field set**: *"adding a field to `EntitySnapshot` fails this check until it is listed below with a reason, which makes 'is this gameplay or is this presentation' a question somebody has to answer out loud"*. Nineteen fields listed; `displayName` is there as *identity* |
| The netharness | reports `bytesInPerSec` / `bytesOutPerSec` per headless client, mispredictions, hit rate; `--clients N --seconds S --net MS`; the skirmish harness runs the whole flow and `--leak 100` |
| Validation | `server/net/Validation.ts` clamps and refuses at the boundary (S4.16) — commands today; the `Hello`'s name and class are checked structurally in `Messages.ts` and the class is resolved through the same `resolveLoadout` the editor calls |
| `heightScale` | on the wire since M10, *"redundant since M13 C2"* with `stance` and velocity, and *"leaves the wire with the v13 widening rather than on its own version bump"* — its one reader is `BotRenderer`'s `mesh.update(…, scale)` |

## The shape, in five steps

**B6.1 — the table, in `shared/`.** `shared/meta/Skins.ts`: `SKIN_IDS` as a `readonly`
tuple in a fixed order — **the order is the wire** — `skinIndexOf(id): number` (255 for a
name not in the table) and `skinIdAt(index): string | null`, the two `weaponIndexOf` /
`weaponIdAt` have; `DEFAULT_SKIN_ID` moves here from `SaveData.ts`, which imports it. The
client's `CharacterId` becomes `(typeof SKIN_IDS)[number]` and `CHARACTER_DEFINITIONS` is
keyed by it, so a skin added to the catalogue without the table — or to the table without the
catalogue — is a type error rather than a runtime 255. `check:skins` gains the third
description: the folder, the catalogue and the table agree. `Skins.test.ts`: the round trip,
255 for a stranger, the default in the table.

**B6.2 — the wire.** `EntitySnapshot.characterIndex: number` — **255 means "declared none",
and the client deals** — with `F.Character = 1 << 13`, on every full write and on a change
(there is none in practice; the delta rule stays uniform because a rule with an exception is
the shape S8 taught). `make`, `copy`, `write`, `read`: four places, one bit, one byte. `Hello`
gains `w.u8v(skinIndex)` **after the name and before the class**: a byte every connection
sends is not what the token's rule was about, and the class stays ahead of the token. The
`Loadout` message does not carry it — the skin is a *setting*, not a class, and a respawn
changes classes, not bodies. `PROTOCOL_VERSION` **17 → 18** with the entry in `Protocol.ts`'s
log. `Wire.test.ts` (or a `Snapshot.test.ts`): a full write carries the byte, a delta with the
same index carries the bit clear, 255 round-trips, and a v17 `Hello` is refused at the version
and not by a decode.

**B6.3 — the server.** `Session.characterIndex` from the `Hello`, checked at the boundary —
**less than `SKIN_IDS.length` or 255, else 255** — the S4.16 shape: clamp, do not judge.
`seat(session, loadout)` reads it off the session as it reads the loadout, `addPlayer` takes
it, `NetPlayer` keeps it, `writePlayer` writes it, `writeBot` writes **255** — the server has
no opinion about a bot's body, and a client that deals one is the fallback working as
designed. `Migration` and the reconnect path change **nothing**: the fact is the session's,
and the session is what crosses instances.

**B6.4 — the client.** `RenderableActor` gains `readonly characterId: string | null` (a local
`Bot` answers null; the probe's fixtures answer null); `RemoteActor` fills it from
`skinIdAt(latest.characterIndex)` where it fills `weaponId`. `Game`'s resolver becomes
`actor.characterId ?? selector.characterIdFor(actor.entityId)` — the selector is now the
fallback the `CharacterAvatarProvider.ts` comment promised — and `lineupSource` the same for
the podium, the local id still the profile's. The pick is sent once, at the `Hello`, from
`Profile.skinId`; a skin changed in the menu's panel is the next connection's. `MenuSkirmish`
is untouched (bots only, dealt locally, nobody else sees them). An index the client's table
does not know renders as dealt rather than as nothing — but a client with a shorter table is
a client on an older protocol, and the version gate refuses it before a snapshot arrives.

**B6.5 — the gates.** `check:authority` gains its **second row**: the remote body's skin is
now the server's fact, and `characterIdFor(` reached for on a path that has a `RenderableActor`
in hand without asking `actor.characterId` first is the local copy — the script may need an
`except` list for the two fallback sites (`Game`'s resolver and `MenuSkirmish`), and it grows
one if the pattern cannot be written without it. `check:cosmetics` **refuses the field until it is
listed**, which is the audit doing its job: `characterIndex` goes into `ALLOWED` as *identity*,
with the argument written where the audit asks for it (decision 5). The
netharness: `--skins` — each headless client sends a different index and, once seated,
asserts every other client's entity carries the index that client sent, which is the whole
claim in one run; and `bytesOutPerSec` before and after at `--clients 2 --seconds 60`, where
the difference is one byte per entity per *full* write and zero per delta, so the number is
expected to be flat to the rounding. `npm run skirmish` end to end; `npm run leak` flat (a
field is not an allocation); `npm run content` and the seeded harness byte-identical; `check`
green with the new tests.

### B6.1 — done (session of 2026-09-19): the table

**Built** (`e9f4a76`; `shared/meta/Skins.ts` 50 new, `Skins.test.ts` 31 new, `check-skins.mjs`
+20). `SKIN_IDS` is a `const` tuple of the seven in the catalogue's order — apex, echo, hazard,
pulse, rhino, sentry, viper — and the order is the wire; `SkinId` its type; `DEFAULT_SKIN_ID`
moved here from `SaveData.ts`, which imports it (the v3 → v4 migration and its test read the
same constant); `NO_SKIN_INDEX = 255`; `skinIndexOf` / `skinIdAt` on `weaponIndexOf`'s shape;
`isSkinId`. The client's `CharacterId` is `(typeof SKIN_IDS)[number]` and
`CHARACTER_DEFINITIONS` is keyed by it, so a skin in one list and not the other does not
compile — the load-time assert on the default went with the reason for it, and
`BOT_CHARACTER_IDS` is the table. `Profile.skinId` checks the save's string with `isSkinId`.
`check:skins` gains rule 5 — every table row catalogued, every catalogued skin in the table,
no repeats — **proved to fire** on a `'ghost'` row before the commit (*"'ghost' is in
Skins.ts's SKIN_IDS but CharacterCatalog.ts has no character('ghost', …) for it"*), then
restored.

**Measured.** `npm run check` green — **141 tests** (three new: the round trip in table order,
255 for a stranger and null back, the default in the table below the byte that means none),
boundaries **368 files** (shared 182). Pane, a fresh load: the editor's strip with the seven
tiles, ECHO marked, `skinIndexOf('viper')` 6; no console error. Nothing on the wire yet:
`PROTOCOL_VERSION` is still 17 and the harnesses are untouched.

### B6.2 / B6.3 — done (session of 2026-09-19): the wire, and the server that writes it

**Built** (`090a43b`). The wire: `EntitySnapshot.characterIndex` under `F.Character` (bit 13),
on every full write and on a change; `NO_SKIN_INDEX` 255 is "declared none". The `Hello`
carries the same byte after the name and ahead of the class, **no presence byte** (decision 3):
255 is the absence. `PROTOCOL_VERSION` **17 → 18** with the log entry; `heightScale` stays
(decision 1). `Snapshot.test.ts` (5 tests): the byte rides a full write at any index, a delta
costs a byte only when it moved (3 bytes when it did not), 255 round-trips, the `Hello` is
exactly one byte longer than a v17 frame. The server: `Session.characterIndex` off the `Hello`,
clamped `< SKIN_IDS.length or 255` at the boundary (S4.16 — a longer table is a newer client the
version check already refused); `seat` and `addPlayer` carry it beside the loadout; `NetPlayer`
keeps it as a **required** dep, as `cheats` is and for the same reason; `writePlayer` writes it,
`writeBot` writes 255 (decision 4). `Migration` and reconnect change nothing — the fact is the
session's.

**The cosmetic audit did its job.** `check:cosmetics` **refused** `characterIndex` until it was
listed (*"is serialised into every snapshot and is not in the §4.15 allowlist"*), then passed
with it in `ALLOWED` as **identity** (decision 5) — the row `displayName` sits in, the argument
written where the audit asks for it.

**Measured — the netharness `--skins`.** Every client declares a different skin and, at the end,
every client's snapshots are read back: the body each is told about for every other must be the
one that client declared, every bot must be "declared none", and the disagreement count is the
exit code. Three clients on Testbed: every client sees **HEADLESS1 apex / HEADLESS2 echo /
HEADLESS3 hazard**, all six bots `none`, **`skinFailures` 0**. Live snapshot bytes overlap
across three runs a side (v17 202.8–208.2, v18 203.0–204.6) — the field is flat to the rounding
because it moves once and rides only full writes; the exact **+1 byte per full write, +0 per
quiet delta** is `Snapshot.test.ts`'s.

### B6.4 — done (session of 2026-09-19): the client draws it, and the authority row that holds it

**Built** (`49af5f3`). `RenderableActor.characterId: SkinId | null` — a remote player's is
`skinIdAt(latest.characterIndex)` in `RemoteActor.applyLatest`, a bot's is `null` (`Bot`'s
getter: the server writes 255 and every client deals). `Game`'s live resolver and the podium's
`lineupSource` both read `actor.characterId ?? selector.characterIdFor(…)` — the selector is now
the fallback the `CharacterAvatarProvider` comment promised, reached only for a body that
declared none. `MenuSkirmish` takes the same shape (its bots are `null`, so it is still the
deal), so the rule has one form and no exception.

**`check:authority` gains its second row** — the body a player wears — and a `guardedBy`
mechanism: a `selector.characterIdFor` call with no `??` on its line is the local copy standing
where the wire should. **Proved to fire** on an unguarded `MenuSkirmish` (*"reads the local
copy of the body a player wears"*), then restored. The audit is `2 migrated fact(s), 294 client
file(s)`.

**Measured — the browser.** A live server, a headless client declaring **apex** (index 0), and
the real browser client joined against it (`localId` 2): the browser reads the remote human
**HEADLESS1 as `characterId` `'apex'`** — the skin it declared — and every bot (100–108) as
`null`. The full path in a real browser: declare → replicate → `RemoteActor` reads
`skinIdAt` → the resolver draws `characterDefinition('apex')`. `npm run leak` **flat**
(29 → 29 subscriptions over 100 cycles, heap +0.71 MiB of GC noise, PASSED — a field is not an
allocation); `npm run content` byte-identical across two runs; `npm run check` green (146
tests). `heightScale` untouched (decision 1); nothing in `shared/player`, `shared/combat` or
`shared/ai`'s simulation reads the body.

## What each item breaks

- **Every client on protocol 17 is refused at the `Hello`.** By design (S6.1: *"reject a
  version mismatch"*); a deploy ships the server and the client together, and there is one
  of each.
- **`RenderableActor` grows a member**, so `Bot`, `RemoteActor` and the layout probe's fixture
  actors all change — the interface is in `shared/ai`, which `check:decorators` fences for
  decorators and nothing else.
- **`CharacterId` stops being hand-written.** `CharacterCatalog.ts` derives it from the table;
  every `satisfies readonly CharacterId[]` still holds.
- **`SaveData.ts` imports `DEFAULT_SKIN_ID`** rather than owning it; the v3 → v4 migration and
  its test read the same constant from a new file.
- **`EntitySnapshot` is five places** — the interface, `make`, `copy`, `write`, `read` — and
  the bit is a sixth; `Interpolation.ts` copies the pose fields and does not need the index,
  but it is the file to read before saying so.
- **The netharness gains a mode**, its first that asserts a cosmetic fact.

## Decisions waiting on the human

| # | Decision | Recommendation |
|---|---|---|
| 1 | ~~**The bump is the moment to take `heightScale` off the wire** — redundant since M13 C2, one byte per full write and one bit, waiting for *"its own version bump"*. Take it in the same v18, or leave it?~~ **Taken (2026-09-19): leave it this milestone.** Its reader (`BotRenderer`'s `mesh.update(…, scale)`) has not been measured with a glTF body, and B6 is one change; a second in the same bump is two things to bisect if the netharness moves. The first item of the next wire change | — |
| 2 | ~~E's open item, carried from M15: the page's first menu pays the seven skins' **~500 ms parse** once, where the first match used to pay it under the intro. Accept, preload the way `echo` is preloaded at boot (a line), or hold the skirmish until the first match has warmed them (a rule)?~~ **Taken (2026-09-19): accept, and measure on a real machine first.** The pane's number was a hand-driven frame; the human's display is the instrument. If it reads as a hitch, the line — preload — over the rule | — |
| 3 | ~~The `Hello` byte's position: after the name (a byte every connection sends), or behind the class with its own presence byte (the token's shape)?~~ **Taken (2026-09-19): after the name, no presence byte.** 255 *is* the absence; a presence byte would be a second way to say it | — |
| 4 | ~~Bots on the wire: 255 (dealt by every client independently, so two clients see the same bot in different skins), or the server deals from the same shuffled deck and sends the index (every client agrees)?~~ **Taken (2026-09-19): 255 now**; the server's deal is a follow-up if anyone notices. `RandomCharacterSelector`'s comment already says separate clients will not agree; a server deal is a `shared/ai` change (`Bot` learns a skin) for a fact nobody has reported | — |
| 5 | ~~The cosmetic audit's judgement call: is a replicated skin **identity**, like `displayName`, or **presentation**, which §8.25 bans from the snapshot?~~ **Taken (2026-09-19): identity.** *Who is this* already has two replicated halves — the name and the team — and the body is the third: two clients that deal the same player two bodies are showing two different people, and the point of the milestone is that they stop. The client still owns everything about how a body is drawn (the rig, the clips, the pads, the plain gunmetal). The reason goes into `ALLOWED` in those words, which is the audit's whole mechanism | — |

## Dependency order

1. **B6.1** first and alone — the table, `check:skins`' third description, the test — because
   every later step imports it and nothing in it touches the wire.
2. **B6.2** with its tests, then **B6.3** — the server can be built and run against the
   netharness before any client draws the result.
3. **B6.4**, then **B6.5**'s `--skins` run, which is the milestone's proof.
4. **M12's content**, in M12's order — unchanged by anything here; the F4 row's answer is now
   *"M13's glTF skins, B5's picker, B6's wire"* and should say so when M12 is next touched.

## Needs a browser

Two clients against one server, each with a different pick, each seeing the other's — the
netharness proves the index and only a browser proves the body. And decision 2's half second
on the page's first menu, on the human's machine.

## How to start — the next brief

**Every step of Milestone 16 is done** — B6.1 (the table), B6.2/B6.3 (the wire and the server,
proved by the netharness `--skins` run at `skinFailures` 0), B6.4 (the client draws it, the
authority row holds it, the browser sees a remote's declared apex) — each recorded above with
its numbers, and the five decisions taken on the recommendation. The wire is **v18**. What is
left is the close: the human's eye on two bodies in a browser wearing what they picked, then
this section moves verbatim to `docs/archive/plan/23-m16-body-on-the-wire.md` with the
provenance line and an index row, the way M15 closed — `npm run check:plan` holds the file to
it. **Two carried forward** into the next wire change's decision table: `heightScale` off the
wire (redundant since M13 C2, deferred here so one bump is one thing to bisect), and the server
dealing bots a shared skin so every client agrees on a bot's body (decision 4; nobody has
reported the disagreement). The milestone after opens on **M12's content**, in M12's order —
F4(a)'s "skins as parameters" is now answered by M13's glTF skins, B5's picker and B6's wire,
and the F4 row should say so when M12 is next touched.
