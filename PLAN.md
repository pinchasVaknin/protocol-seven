# PROTOCOL SEVEN — PLAN

Browser arena FPS. This file is the handover: what exists, what was decided, and what the next
milestone needs to know. A fresh session inherits the repository and this file, nothing else.

M1–M8 built a complete single-player browser game. M9–M11 moved it onto a dedicated external
server: the split first, then the netcode, then everything else on top of it. M12 is the scoped
content backlog, M13 (archived) put skinned bodies on the bots and moved the board and the XP
award to the server, M14 (archived) put vitest in the gate and legacy decorators behind a fence,
M15 (archived) rebuilt the front end to fit one screen, M16 (archived) put the player's chosen
body on the wire, and Milestone 17 — the front end's second pass, from the human's "Fixes /
Design" brief — is the milestone now in progress. Milestone 12, the content backlog, stays
below it in full.

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
| 23 | Milestone 16 — proposed: the body other players see (B6, the wire) | 234 | [23-m16-body-on-the-wire.md](docs/archive/plan/23-m16-body-on-the-wire.md) |

What stays in this file: **Milestone 12 — proposed** (the content backlog) and **Milestone
17** (the milestone now in progress).

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

---

# Milestone 17 — the front end's second pass: the chrome, Play Solo, Settings, the splash, and six fixes

Opened 2026-09-19 from the human's brief *"Fixes / Design"* (`../הכנה M15/Fixes _ Design.md`,
with three reference images: the PLAY SOLO screen, the SETTINGS screen, and the logo). The
brief is nine design items and six fixes; the plan below was described to the human before
any code was written and built after their answers, which are the decisions.

## The brief, as read

1. **Favicon** — the skull on the browser tab.
2. **A cinematic splash** before the menu: the skull fades in on black; PROTOCOL is thrown in
   from the right and strikes it, SEVEN follows; three bass hits; a shockwave with an energy
   sweep; a bright light and a chime, then a fade to the menu.
3. **One header and one footer** on the menu, Play Solo, Create-a-Class and Settings. Header:
   the mark with its breathing eyes, the place's name, the player card. Footer: the tick and
   FIGHT · SURVIVE · WIN at the left; beneath, a line ending in `PROTOCOL 7 // <PLACE> //
   V <version>` and three bars, two lit.
4. **Settings** as the reference: a rail of five categories on the left, the panel in the
   centre, an image plate at the bottom right, BACK and APPLY inside the panel above the footer.
5. **Create-a-Class**: CHANGE A SKIN and SAVE AND EXIT re-homed in a structured row above the
   footer rather than floating.
6. **Play Solo** as the reference: the map's picture with its name and three tags, a carousel
   of map cards, the mode cards, the difficulty cards, a TESTBED card, and START MATCH.
7. **Fixes**: the menu's backdrop decoupled from the solo pick and rolled at random from the
   real maps, never the testbed; Dunes' static backdrop camera; the spectator's camera inside
   the followed body's head in Search & Destroy; the callsign lost to OPERATOR in a solo match;
   the intro camera's sharp turns, and the wait before the round.

## Decisions taken (2026-09-19, the human's answers to the eight questions)

1. **The splash is gated.** Stage 1 — the skull on black — carries PRESS ANY KEY; the key or
   the click is the user gesture the AudioContext needs, and stages 2–4 run from it with their
   sounds. A splash that ran on load would be silent under the autoplay policy.
2. **APPLY is real.** Settings apply live so a sensitivity can be felt, but persist only on
   APPLY; BACK reverts to the last saved record.
3. **The map pictures are rendered once** — `scripts/map-thumbs.mjs`, in `skin-thumbs.mjs`'s
   idiom — and committed; no live render behind the cards.
4. **MIXED stays**, the fifth difficulty card and the default.
5. **The testbed is the reference's**: reached by ENTER TESTBED alone, as the Shooting Range,
   with modes and difficulty disabled; the greybox is no longer offered with the four modes.
6. **The intro takes the time it needs.** The camera's approach and overview are not to be
   fitted into a shorter budget; *"the 5 seconds is strictly the countdown after the camera
   finishes its overview, right before the player can move."* So the freeze is the intro plus a
   five-second countdown, not ten seconds shared between them.
7. **The version is `package.json`'s** — `0.1.0` — not the reference's illustrative number.
8. **The Settings image plate is the chosen skin's thumbnail** — B5's render, an asset that
   exists — with the caption.

## The order

C0 favicon · C1 the chrome · C2 the six fixes · C3 Play Solo · C4 Settings · C5 Create-a-Class
· C6 the splash. Each phase ends on `npm run check` and `npm run layout`; the screens on a
browser pass at 1920×1080 and 1280×720.

### C0 / C1 — done (session of 2026-09-19): the favicon and the chrome

- `public/brand/favicon.png` (256², the mark fitted into a square with a 6 % margin, on alpha)
  and `favicon.ico` (16/32/48), a one-off Pillow pass like the one that cut the mark; linked
  from `index.html`.
- `ui/ScreenHeader.ts` → **`ui/ScreenChrome.ts`**: `makeScreenHeader(modifier, place, card)`
  and `makeScreenFooter(modifier, place)`, where `place` is a title and a subtitle. The header
  is the mark, the wordmark, a rule, the place, the card; the footer the tick and the line, and
  beneath them the hairline, the stamp and the three bars. Two insets: `--menu` (the frame
  fills the viewport; bars at the window's padding) and `--frame` (level with the frame's
  top and bottom). The menu's own wordmark, rule, tag and one-line footer went with it.
- The version: `__APP_VERSION__`, defined in `vite.config.ts` from `package.json`, read by
  `appVersion()`; `dev` where the define is absent.
- Applied to the menu's two pages — MAIN MENU / ARENA FPS, PLAY SOLO / SELECT COMBAT SCENARIO —
  with the menu grid's bottom padding at 96 for the footer's second row. The editor and
  Settings take the chrome in their own phases, where their frames are re-budgeted for it.

### C2 — done (session of 2026-09-19): the six fixes

- **The backdrop, rolled.** `MapEntry.testbed` on the registry (the greybox `true`, the three
  real maps `false`) — one flag, the blacklist and the TESTBED card's fact both; `PLAYABLE_MAPS`
  and `rollBackdropMap(roll, previous)`, pure, never the testbed, never the previous while there
  is another (`ModeRegistry.test.ts`). `Game` rolls on entering MENU **when there is no
  backdrop** — boot, and the way back from a match, which disposed it — from an `Rng` seeded on
  the clock at boot (the one clock-seeded draw in the client: nothing gameplay reads it; S2's
  ban on `Math.random` stands). A return from Settings or Create-a-Class keeps the map that is
  there: a re-roll is a rebuild, a few hundred frames of bare canvas, for a hop to a sibling
  screen and back.
- **Dunes' camera.** Measured: `DUNES behind the menu: dolly run 0.0 m (held — the lane is
  blocked at eye height)` — the middle lane's `a` sits inside geometry at eye height, so the
  free prefix was zero and the camera held and swayed. `planCameraPath` probes **every lane from
  both ends** and takes the longest free run (Dunes: `dolly along WEST, run 33.0 m`; Depot's
  longest is now WEST at 27.0 where the middle lane was shorter); a map on which no lane runs
  `MIN_RUN` gets an **orbit** — a 90 s circle above the middle lane's centre at the first of four
  rings whose whole circle a capsule finds free — and only a map with neither falls back to the
  hold. No map can hold a still camera by the old rule again.
- **The spectator's head.** `BotRenderer.setEyesOf(entityId)`: the body the camera is inside
  is not drawn — its avatar and its indicator hidden while it is the one, shown the frame it is
  not — exactly as the player's own body is not. `ClientMatch.render` passes
  `spectatorTargetId` before the renderer's update.
- **The callsign.** `PlayerCombatant` takes its `displayName` (the constant `'OPERATOR'`
  stays as the default for the harnesses and the audits); `ClientMatch` hands the same
  `localName` to the combatant and the score row; `MatchWorld` resolves single-player's through
  `resolveDisplayName(null, profile.settings.callsign)` — the join's sanitiser, so the two
  paths agree on what an empty name becomes.
- **The intro, and the freeze sized to it (decision 6).** `IntroPlan.ts`: the pull-back now
  rises **straight back along the heading the approach arrived on**, and holds that heading
  while it climbs — it used to pull back along the spawn's azimuth while looking past the
  centre, and the two disagreeing was the rotation the report described; the heading on the
  approach and the whips is the route's tangent **averaged over ±2.5 / ±3 m** (`headingAt`),
  so a corner the route hugs at the bots' clearance is turned into over a second and a half
  rather than snapped; the pace is a jog, not a sprint (approach peak 5.5 m/s, was 9; whips 16,
  was 40); the blends are longer (return 1.0 s, was 0.5; pull-back 3 s, was 1.5; pull-in 1.2,
  was 0.5; objective holds 1.0, was 0.3) and a 1.5 s rest on the overview is a segment of its
  own. The freeze: `matchStartSeconds(def, modeId) = introSeconds + RETURN_SECONDS +
  COUNTDOWN_SECONDS (5)`, computed by the server (`server/Match.ts`) and the client
  (`ClientMatch`) from the same two facts — a replicated client back-computes the phase's
  elapsed time against it — through `MatchFlowDeps.matchStartSeconds`; `DEFAULT_MATCH_START_
  SECONDS` (10) is what the audits and the fight behind the menu run on. In single-player a
  skip also cuts the freeze to the return and the countdown (`MatchFlow.shortenWarmup`); over
  the network the skip ends the camera alone. **The numbers, per mode:** TDM / FFA / KC intro
  10.5 s, freeze **16.5 s**; S&D (two sites) intro 15.2 s, freeze **21.2 s**; Domination (three
  flags) intro 19.2 s, freeze **25.2 s**. Six constants at the top of `IntroPlan.ts` if any of
  them should move. `npm run intro`: **299 plans, 0 failures**, every objective visited, no
  sample inside a collider; `npm run skirmish -- --cycles 1`: FLOW CHECK PASSED, 0
  mispredictions in the 60 ticks after migration into the live match, the two runtimes agreeing
  on the freeze. Watched in the browser: the approach, the rise, the rest on the overview, the
  return, GET READY · 5 → 1; a key at 2 s returned the camera and the banner read 5.

### C3 — done (session of 2026-09-20): Play Solo

- **The pictures** (decision 3): `probes/map-thumb.html` + `client/probes/mapThumb.ts` build
  one map through the menu's own `MenuBackdrop` — the same build, ambient and lane camera,
  the fight off — and read a 1 536 × 864 JPEG at 0.86; `scripts/map-thumbs.mjs` (`npm run
  maps:thumbs`) drives it through the headless Chrome the layout probe uses and writes
  `public/maps/<id>.jpg`: Foundry 143 kB, Dunes 142, Depot 114, the testbed 151 — 550 kB in
  all, fetched only by the page that shows them. The hero and the cards crop the one file.
  While here, `planCameraPath` prefers the **spine** lane while either of its ends runs
  (Foundry and Depot are back on their middle lanes; Dunes' is blocked from both ends, so it
  keeps WEST).
- **The registry**: `MapEntry.tagline`, `tags` (three) and `picture`.
- **The page**, `ui/PlaySolo.ts`, painted into the menu's stage under the same chrome with
  the place PLAY SOLO / SELECT COMBAT SCENARIO. Left: the hero (picture, pager `02 / 04`,
  COMBAT MAP, the name at 52 px, the tagline, the three tags) over the MAPS strip of four
  cards, the testbed's badged with the flask. Right: `01 MAP` as a row that steps to the
  next map; `02 GAME MODE`, five cards with glyphs drawn in the file (skull, flag, tag,
  reticle, charge); `03 BOT DIFFICULTY`, five cards (chevrons one to four, MIXED as two
  facing — decision 4) with the chosen tier's line beneath; the TESTBED plate with ENTER
  TESTBED. The bar: OPERATION SUMMARY (map, mode, difficulty) and START MATCH.
- **The testbed's rule** (decision 5), in `Menus.pickMap`: the greybox picked from the strip
  or the plate makes the mode the Shooting Range and locks the mode and difficulty sections
  (drawn greyed with SHOOTING RANGE ONLY / NO BOTS IN THE RANGE, not hidden); the primary
  reads ENTER TESTBED; a real map picked again restores the mode the player had
  (`rememberedMode`, the default if the map cannot run it). The greybox is offered with no
  other mode.
- **The action bar and the CTA**, shared: `.op-actionbar` (a lead plate cut at two corners
  and the primary beside it) and `.op-cta` (`--primary` lit in the accent with a bloom,
  `--quiet` for a secondary). Settings and Create-a-Class take the same two in C4 and C5.
- The old `.op-setup` panel and the `.op-picker` / `.op-option` columns are gone with the
  `picker` primitive. The stage grid gained `grid-template-rows: minmax(0, 1fr)` so the page
  can stretch to it. `npm run layout`: `solo-setup` ok at all eight viewports; watched at
  1920 × 1080 and 1280 × 720: the strip, the modes, the tiers, the testbed lock and the
  restore.

### C4 — done (session of 2026-09-20): Settings

- **The shape**: `ui/Settings.ts` rebuilt on the reference. The shared chrome with the place
  SYSTEM CONTROL / CONFIGURE OPERATIVE PARAMETERS (the screen has the player card and the
  profile panel now, as the other two do); a rail of the five categories (a glyph, `0N`, the
  name; the open one lit with the accent bar and a chevron); the panel with the category's
  title and subtitle, its controls in bordered sections (CONTROLS: SENSITIVITY, VIEW; AUDIO:
  LEVELS; VIDEO: RENDERING, ACCESSIBILITY; INFO: CONTROLS, PROGRESS), and beside them the
  side column — INPUT DEVICE · MOUSE / KEYBOARD, the one fact the device gate leaves, and
  the chosen skin's thumbnail under ADJUST YOUR CONTROLS FOR MAXIMUM PERFORMANCE (decision
  8). BINDINGS takes the whole panel width: three columns of labels and two key chips each
  did not fit beside the side column without cutting the labels to "CROUC…". The foot is
  BACK and APPLY on the shared action bar. No DEADZONE and no controller: nothing here that
  is not wired (S6.3's rule).
- **APPLY is real** (decision 2): the screen edits a **draft** (a copy of the save on
  `show`), every change goes live through `Game.previewSettings` — `applySettings` is now
  `patchSettings` + `previewSettings`, one description of what a setting does — and nothing
  persists until APPLY hands the draft to `applySettings`; BACK and Escape preview the saved
  record again and leave. The binding table is swapped by identity, so a slider tick does
  not clear the held keys or re-arm the keyboard lock. RESET ALL BINDINGS resets the draft.
  Checked in the browser: FOV to 110 → readout 110°, save 90; BACK → 90°; to 100 and APPLY
  → save 100.
- The probe: `settings/*` opens the category through `openTab` (the rail's label is
  "0N NAME"), the plain screen excludes `.st`; five categories ok at all eight viewports.

### C5 — done (session of 2026-09-20): Create-a-Class's action row

- **The row**: `LoadoutEditor.paintActionRow` — a third grid row across the frame's foot,
  above the shared footer (the editor has both bars now), on the `.op-actionbar` the other
  two screens end on, and it keeps the frame's two columns: under the stage, CHANGE A SKIN
  centred under the figure (R3.8) — or SAVE / CANCEL while a category is open, one or the
  other, never both (`refreshStage`'s rule, unchanged; `.op-cta[hidden]` added, the
  `display` rule having outranked the UA's `[hidden]` as `.op-screen`'s does) — and under the
  list, SAVE AND EXIT. The strip the toggle opens stays over the canvas's foot, so the
  column's height is the same open and closed (B5).
- **The re-budget**: 32 + 72 + 16 + 44 + 16 + 734 + 16 + 64 + 24 + 46 + 16 = 1080. The
  stage is 860 × 734 (`STAGE_HEIGHT`, the preview and the status line with it); the right
  column lost its foot row; the category bars are 100 (were 112) and the pages 7 and 5 (were
  8 and 6), by the arithmetic in `meta.css` beside `.lo-right`. The old `.op-btn` foot and
  the stage's own action row are gone.
- `npm run layout`: eleven editor surfaces ok at all eight viewports. Watched: the row, the
  strip opening over the disc, the weapon list with SAVE / CANCEL taking the cell.

### C6 — done (session of 2026-09-20): the splash

- **The artwork, cut**: `public/brand/splash-protocol.png`, `splash-rule.png`,
  `splash-seven.png` — the word, the rule and the word under it, cut from `logo.png` at
  (480, 400), (478, 487), (479, 527) by a one-off Pillow pass (100 kB in all); the skull is
  `mark.png` with `mark-eyes.png`, which turned out to be the same file's cut at (40, 208).
  `ui/Splash.ts` maps the logo's 1 024 canvas onto an 84 vmin box and places each cut at its
  offset in percent, so assembled they are the logo pixel for pixel.
- **The four stages** (`Splash.ts`): the skull fades in at the *screen's* centre with PRESS
  ANY KEY under it — the gate (decision 1), the key or the click being the user gesture the
  `AudioContext` needs, and `Game.audio.start()` runs on it; then, on timers from the
  gesture: PROTOCOL thrown in from off the right (320 ms, ease-in, blurred) and on impact the
  skull pushed to its place in the logo with a small overshoot, the box shaken, the word
  flashed, the first bass hit; SEVEN the same at 1.1 s; the rule snapping in from the left at
  1.7 s with the third hit and the eyes flaring; two rings out of the logo's centre at 2.1 s
  with the hiss; the bloom from 3.5 s, white at its heart and the accent at its edge, to the
  screen by 4.05 s, where `onReveal` transitions to MENU under it, and the layer fading over
  the menu to 5.0 s. Any key or click after the gesture skips: the timers dropped, the moves
  *finished* (not cancelled — a cancelled `fill: forwards` snaps its element back), reveal,
  a 450 ms fade. `prefers-reduced-motion`: the chime and the fade.
- **The sounds** (`ProceduralAudio`, on the `ui` bus, non-positional): `playSplashHit(i)` —
  a sine dropping 110 → 38 Hz with a click of noise on the front, each of the three a little
  heavier; `playSplashShock` — a noise burst whose low-pass sweeps 9 kHz → 180 Hz over 1.5 s
  with a low swell under it; `playSplashChime` — the level-up's rising sweep a fifth up with
  a partial under it and a band of air rising with it.
- **The boot**: `Game`'s BOOT, after the device gate, shows the splash unless `?harness` or
  `?nosplash` (`splashWanted`; the key declared in `UrlFlags.ts`'s undocumented table with
  its reason), and **rolls and builds the menu's map behind it** (`prepareBackdrop`, the
  same call MENU's `enter` makes), so the menu lands on a built map — the one loading screen
  the project has ever needed, hiding the one build it has. Watched at 1920 × 1080: the four
  stages, the assembled logo, the menu under the fade with Dunes already built; a second key
  at 1.5 s: the logo whole under a fade, the menu in under a second.
