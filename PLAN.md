# PROTOCOL SEVEN — PLAN

Browser arena FPS. This file is the handover: what exists, what was decided, and what the next
milestone needs to know. A fresh session inherits the repository and this file, nothing else.

M1–M8 built a complete single-player browser game. M9–M11 moved it onto a dedicated external
server: the split first, then the netcode, then everything else on top of it. M12 is the scoped
content backlog, M13 (archived) put skinned bodies on the bots and moved the board and the XP
award to the server, M14 (archived) put vitest in the gate and legacy decorators behind a fence,
M15 (archived) rebuilt the front end to fit one screen, M16 (archived) put the player's chosen
body on the wire, M17 (archived) gave the front end its second pass from the human's "Fixes /
Design" brief, M18 (archived) built the debrief — the end-of-match screen as the human's two-screen
choreography — and M19, the weapons as GLB assets with the attachments visible on the gun, is the
milestone now in progress, under Milestone 12, the content backlog. Both are below, in full.

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
| 24 | Milestone 17 — the front end's second pass: the chrome, Play Solo, Settings, the splash, and six fixes | 267 | [24-m17-front-end-second-pass.md](docs/archive/plan/24-m17-front-end-second-pass.md) |
| 25 | Milestone 18 — the debrief: the result, the podium, the XP, and the board on a tab | 126 | [25-m18-the-debrief.md](docs/archive/plan/25-m18-the-debrief.md) |

What stays in this file: **Milestone 12 — proposed** (the content backlog) and **Milestone 19 —
the weapons as assets**, the milestone now in progress.

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

# Milestone 19 — the weapons as assets: GLB viewmodels, and the attachments visible on the gun

Opened 2026-09-22 from the human's request in chat: twenty-five Sketchfab GLBs brought over
three rounds — *"go over the project and tell me which models fit, which do not, and what is
missing; and the attachments must be visible on the weapon"*. The review, its verdicts and the
plan were described to the human before any code was written; the decisions below are their
answers. Stage 0 was built in the session that opened it.

## The brief, as read

This changes the oldest assumption the viewmodels carry — S2's *"zero external assets"*,
which M13 already broke for the bodies — and it does so for a reason the procedural guns
cannot answer: **the five attachments are numbers only.** `Attachments.ts` scales ADS time,
range and spread; nothing in `WeaponMeshParts` reads the loadout, and the `optic` field in
`WeaponModelSpecs` is the weapon's own fixed sight, not the HYBRID OPTIC. A player fitting a
suppressor sees the same rifle. The human wants the rifle to change.

So: the twelve weapons and the knife move from `WeaponModelSpec` records to GLB files, weapon by
weapon, behind the **same `WeaponModel` contract** (`WeaponMesh.ts`: a root, a `magazine` group
the reload drops, a `chargingHandle` group the empty reload pulls, a `muzzle` point, a
`sightHeight` the ADS pose cancels); and a shared attachment pack — one red dot, one suppressor,
one vertical grip, one laser box — mounts on named sockets every weapon file carries. The
procedural builder stays as the fallback, exactly as `CharacterAvatarProvider` falls back to the
box rig when a skin is missing.

## The review, in one table

Twenty-five files, 313 MB. What fits, per weapon id:

| weapon | source (Sketchfab, licence) | note |
|---|---|---|
| `ar_carbine` | *Free – M4 Modular Kit*, Karnaval, CC-BY | an exploded kit: the assembled core plus alternates spread around it; two suppressors, a large magazine, a vertical grip |
| `ar_vulcan` | *AK-74 Pack*, Armored Wave, CC-BY | eight assembled rifles; the tactical one (rail handguard, `tactical_grip`, AimPoint Pro, side-folding stock) |
| `ar_halcyon` | *TAR-21 Tavor*, Nik Vega, CC-BY | the black set; collimator, suppressor, grip and under-rail as separate nodes |
| `ar_longbow` | *[FREE – Modular] L1A1 SLR*, Aperture Aerospace, CC-BY | the polymer rig; 20- and 30-round magazines; skinned, no rail |
| `smg_wasp` | *Free Modular MP5 Kit*, Karnaval, Sketchfab Standard | exploded kit; SD handguard, drum, retractable stock, bolt separate |
| `smg_meridian` | *Modular P90 Tactical*, doomsentinel, CC-BY | assembled; silencer, collimator, foregrip, flashlight as modules |
| `shotgun_breacher` | *Spas 12*, Luiz Bueno, CC-BY | the pump is its own mesh (`Plane.003`) |
| `sniper_kestrel` | *L115A3*, Mortavex, CC-BY | 195k triangles and the suppressor baked into the body — usable after a decimate and a cut |
| `sniper_vantage` | *M150 Sniper Rifle*, Bl4ckGh0st, CC-BY | skinned; magazine, charging handle and foregrip on bones |
| `pistol_talon` | *Beretta M9*, eNse7en, CC-BY | a display scene: two pistols and loose rounds, 113 meshes; slide and magazine separate |
| knife | *MTech USA Xtreme Tactical Knife*, xivxiy, Sketchfab Standard | |
| `lmg_bastion`, `lmg_monolith` | **none** | every LMG brought was a rip (below); the 1963 M60 has no UVs and no textures |

Attachment pack: the **AimPoint Pro** from the AK-74 pack (glass and an emissive reticle), the
M4 kit's **suppressor** and **vertical grip**, and *Rifle Laser Sight* (a DBAL-A2, trolosqlfod,
CC-BY, 2k triangles) for the laser. The PEQ-15 brought beside it needs a spec-gloss to
metal-rough conversion first — three r185 dropped `KHR_materials_pbrSpecularGlossiness`, and it
loads white.

**Six files are game rips and never ship**, whatever their Sketchfab page says: the CS2 USP
(Valve), and everything from the user `ardickasaretas` — *FN Minimi* (materials named
`BruenMk9_*`, Call of Duty's name for it), *XM250*, *Pulemyot Kalashnikova*, *M249 SAW*, *Negev
NG7* (`wpn_p17_lm_ngolf7_*`, the "Sakin MG38"). The tell is in the file: `.smd` mesh names,
`tag_*` bones, `wpn_*`/`att_*` materials, and gunsmith-style variants (`mag_extended`,
`barrel_long`, `stock_light`) in a "free" model. They were the best-built LMGs in the set, which
is exactly why the rule is written down.

## Decisions taken (2026-09-22, the human's answers)

1. **The rips go.** The two LMGs stay procedural beside the GLB weapons until a legitimate M249 /
   M60 / PKM / MG3 is found; a mixed arsenal for a while beats an asset that cannot ship.
2. **The laser is the DBAL-A2**, not the PEQ-15: a third of the triangles and no conversion.
3. **The L115A3's suppressor is cut** in Blender (headless; 5.2 is installed, not on PATH) so
   `KESTREL` keeps its SUPPRESSOR toggle, rather than searching for another AWM.
4. **Camo over PBR is an overlay**: the pattern multiplied onto the albedo through a short
   `onBeforeCompile` on the shared material, keeping the model's detail, rather than replacing the
   base map as the procedural surfaces do today.
5. **The M4 alone proves the path** — ADS, reload, hip, camo, the loadout preview — before a
   second weapon enters. The sight line under an optic is where this will break, and it should
   break on one weapon.

## The authoring contract

Every `public/models/weapons/<weaponId>.glb` is built by `scripts/weapon-build.mjs` from a
recipe and a source outside the repository (`../GLB_files/weapons/`, the sibling of
`../FBX_files` the bodies came from; 313 MB of sources do not belong in git). The built file
carries:

- **Units and axes as the viewmodel's**: metres, the barrel down **-Z**, +Y up, the origin at
  the centre of the receiver — `WeaponMesh`'s local space, so nothing downstream converts.
- **Groups by the contract's names**: `body` (everything static), `magazine` (dropped on
  reload), `charge` (the charging handle, bolt or pump; may be empty), `magazine_ext` (the
  extended magazine, present where the kit had one), `optic_default` (the irons, hidden when an
  optic mounts).
- **Sockets as empty nodes**: `socket_muzzle` (barrel tip, on the bore), `socket_rail_top`
  (the optic's mount, on the receiver's rail), `socket_rail_front` (the handguard's top rail,
  the laser's), `socket_rail_bottom` (the grip's), `socket_sight` (the iron sight line — its Y is `WeaponModel.sightHeight`). A socket's +Y is
  the mount's up and -Z its forward; the pack's parts have their origin at the mating face so
  an attachment is `parent.add(part)` and nothing else.
- **Budgets, as a gate** (`check:weapons`): <= 30k triangles, <= 4 MB, textures <= 1024 on a side
  and WebP or JPEG, the contract nodes present, and an `asset.extras.attribution` block (title,
  author, licence, URL) — CC-BY is a condition, not a courtesy — mirrored in
  `public/models/weapons/CREDITS.md`.
- **A second file per weapon, `<id>.lod1.glb`**, <= 10k triangles and one primitive per
  material, for the ten bodies at twenty metres (`buildHeldWeapon`'s replacement). 5k was
  written first; meshopt cannot collapse across UV seams and a kit mesh is mostly seams, so the
  M4 stalls at a third whatever the ratio, and the number that matters at that distance — the
  draw calls — is what `join` cuts.

The geometry pass is the JSON chunk edited directly — select, re-parent, rename, bake the world
matrices, add the sockets — with no parser package (`glb-images.mjs` set that precedent), and
then `npx @gltf-transform/cli@4.5.0` pinned, as `skin-compress.mjs` runs it: `prune`, `dedup`,
`resize`, `webp`, and `simplify` for the LOD. S2 admits no new package; none is added.

## The stages

- **Stage 0 — the assets, as a script.** `weapon-build.mjs` with the M4 recipe and the pack's
  four; `check-weapons.mjs` in the gate; `CREDITS.md`. Nothing at runtime changes. **Built.**
- **Stage 1 — the loading path.** `WeaponAssetService` beside `CharacterAssetService` (a cache
  for the application's life, a clone per instance, warmed for the loadout only, never the
  arsenal); `buildWeaponModel` gains a GLB branch that returns the same `WeaponModel` from the
  file's nodes, and falls back to the procedural builder when the file is missing or fails.
  `sightHeight` comes from `socket_sight`. Proved on the M4 and nothing else (decision 5).
  **Built.**
- **Stage 2 — the attachments, visible.** One function, `attachVisuals(model, attachmentIds)`:
  the optic hides `optic_default`, mounts on `socket_rail_top` and **moves the sight line** —
  `ViewmodelAnim` cancels `sightHeight`, and under an optic that number is the optic's; the
  suppressor mounts on `socket_muzzle` and moves the flash's `muzzle` point forward by its
  length; grip and laser on `socket_rail_bottom`, the laser wired to the existing
  `laserVisible`; the extended magazine shows `magazine_ext` where the file has one and
  stretches `magazine` x1.4 along the well where it does not. **Built.**
- **Stage 3 — the arsenal and the bodies.** The kits first (P90, MP5, AK-74, Tavor), then the
  SPAS-12, the M150 and L1A1 (skinned: `SkeletonUtils.clone`, the bodies' path), the Beretta and
  the knife, the L115A3 last after its cut. `<id>.lod1.glb` into `BotRenderer`'s held-weapon
  cache, with the suppressor and nothing else at that distance. The killfeed glyphs stay
  projected from `WeaponModelSpec`; the camo overlay (decision 4) lands here. **Built**, in
  two parts; the LMGs stay procedural (no legitimate source), the bodies carry the bare LOD.

## What was built — stage 0 (2026-09-22)

- **`scripts/weapon-build.mjs`**: five recipes — `ar_carbine` from the M4 kit's assembled core
  (upper, lower, Keymod handguard, grip, classic stock, trigger; the "Light" magazine as
  `magazine`), and the pack — `att_suppressor` and `att_grip` from the same kit,
  `att_optic` (the AimPoint Pro, its glass and its reticle from the AK-74 pack's tactical
  rifle), `att_laser` (the DBAL-A2). The measurements are the mesh's: the bore is the mean of
  the handguard's vertices at its tip, the rail the receiver's top over its middle half where
  no sight stands, the sight line the rear sight's top less 4 mm. Two things were found by
  looking rather than by measuring and are now in the recipes: the kit's "Large" magazine is
  thicker, not longer, so the extended magazine will be the stretch; and the DBAL's emitters
  face +X in the source, not -X — the first build mounted it backwards.
- **The M4, measured** (source cm, origin at the bore's height and the receiver's middle):
  0.715 m long, 24,276 triangles, 2.21 MB (15 WebP textures at 1024, 0.71 MB of it);
  sockets at muzzle z=-0.370, rail top y=+0.038, rail front y=+0.039 z=-0.226, rail bottom
  y=-0.029, sight y=+0.068. The pack: suppressor 842 triangles / 0.09 MB, grip 1,416 / 0.12,
  optic 7,618 / 0.50, laser 1,967 / 0.24. The LOD 8,396 triangles / 0.75 MB, five primitives.
  **3.91 MB in all**, and the build is byte-identical on a second run.
- **The pack, mounted**: the four parts on the four sockets in a viewer, by `socket.add(part)`
  and nothing else — the red dot on the receiver's rail, the laser on the handguard forward of
  it with the emitters forward, the grip under the handguard, the can on the muzzle. The
  picture the human asked for, as a file.
- **`scripts/check-weapons.mjs`** in `npm run check` (the seven rules in its header), and
  `glb-images.mjs` reads WebP dimensions now. **`CREDITS.md`** regenerated by the build, and
  the credit is never typed from memory: a Sketchfab download carries title, author, licence
  and URL in its own `asset.extras`, and the build refuses a recipe whose record disagrees with
  its file (the human's ask, after stage 0: *"I want to ensure we never miss an attribution"*).
- **M18 closed** into the archive (`25-m18-the-debrief.md`); its open item was the human's
  playtest, and two playtest rounds have landed since (`897c14d`, `974f9d7`).

### Verified

`npm run check` green with `check:weapons` in it (150 tests). The M4 and the mounted pack
inspected in a three.js viewer with an axes helper: metres, the barrel down -Z, +Y up, every
socket where the recipe says. Nothing at runtime reads the files yet.

## What was built — stage 1 (2026-09-22)

- **`WeaponAssetCatalog.ts`**: the list of weapon ids with a file (`ar_carbine`), the
  versioned URL, and the contract's node names restated where the loader reads them.
  `check-weapons` rule 8 holds the list to the recipes.
- **`WeaponAssetService.ts`**: `CharacterAssetService`'s shape — one fetch and parse per
  file for the application's life, a promise cache, a failed request evicted for the retry,
  and a synchronous `template()` for the callers that build on a frame. The contract is
  validated once at load; the socket positions are read once into the template.
- **`buildWeaponModel`** gains the branch: with a template it clones the file
  (`buildFromTemplate`), returning the same `WeaponModel` — `magazine` and `charge` are the
  file's groups, `muzzle` is `socket_muzzle`, `sightHeight` is `socket_sight`'s Y. Without
  one it builds the primitives as before, and `WeaponModel.source` says which. The three
  node fields widened from `Group` to `Object3D`; nothing read the flag.
- **The gloves** follow the file: `handBoxesAt` carries the procedural hand and forearm pairs
  to the file's `socket_grip` and `socket_support`, which the M4 recipe now measures (the
  grip two fifths down the pistol grip, the palm under the handguard). The M4 kit's receiver
  stands 16.6 cm tall where `AR_BASE` is 8.2, so the spec's anchors would have put the
  trigger hand inside it.
- **`ClientMatch`** builds both slots with the service and upgrades a slot in place when a
  late file lands (`upgradeWhenLoaded`: mesh only, the weapon and its ammunition untouched,
  the slot checked before the swap); `equip` goes through the same path. **`WeaponPreview`**
  does the same by forgetting its key and showing again. **`Game`** owns the service and
  warms the equipped class's two weapons on every screen outside a match.
- **A found bug, fixed on the way**: `Fx.attachMuzzle` built the flash once and returned on
  every later call, so after a swap or an `equip` the flash stayed on the first weapon's
  muzzle — invisible under its hidden root. It re-parents now, and the flash follows the
  active muzzle through a swap and through the upgrade.
- **`docs/WEAPON-ASSETS.md`**: the pipeline's handover beside `CHARACTER-ASSETS.md`.

### Verified

`npm run check` green. In the browser pane: the template logged ready at the splash (the
warm), the loadout editor's stage drew the M4 from its file and the VULCAN from the
primitives, a solo match on Foundry held the M4 from its file (`model.source === 'glb'`,
`sightHeight` 0.0677) — hip, ADS with the front post inside the rear aperture on the screen
centre, a reload dropping the `magazine` group (y −0.192 mid-reload), the flash mesh
parented to `socket_muzzle` — the swap to the procedural pistol and back with the flash
following, and the upgrade path driven by hand (`template()` answering null once: the slot
went primitives → file with the animation's model and the flash current). No console errors.

## What was built — stage 2 (2026-09-22)

- **The pack rides with the weapon.** `WeaponAssetService.preload(weaponId)` fetches the four
  parts with the first weapon file (a megabyte, once), validates each against its own
  contract (`part` under a root named for it; the optic's `socket_sight`, the suppressor's
  `socket_muzzle`), and `template()` answers null until the pack is there — so a model built
  from a file always has every part it might mount, and there is no half state to handle.
- **`mountAttachments`** in `WeaponMesh.buildFromTemplate`: each part a clone of its template
  under the weapon's socket (`ATTACHMENT_PART_SOCKETS` in the catalog), and then the two
  numbers the contract hands out — an optic's own sight line above the rail socket becomes
  `sightHeight` (0.0677 bare, **0.0806** with the AimPoint), a suppressor's own `socket_muzzle`
  becomes `muzzle`, inside the clone so the flash rides the can (13.75 cm forward, measured in
  the match). The extended magazine is the `magazine` group stretched ×1.4 along the well
  (`MAGAZINE_EXTENDED_STRETCH`); the reload writes position and rotation and leaves scale
  alone. The optic's glass and reticle take the project's `lens` and `reticle` materials in
  place of the artist's transmission glass, so the dot is the same emissive dot the procedural
  red dot draws.
- **The ids travel with the loadout.** `ResolvedLoadout` carries `primaryAttachments` /
  `secondaryAttachments` (copies) beside the camos; `ClientMatch` keeps them per slot as it
  keeps the camo, `equip` takes them as a fourth argument on the same "undefined keeps"
  rule, and the editor's preview key includes them — the class's, on the class's weapon; a
  hovered weapon is shown bare, as it is shown unpainted.
- The glTF scene of a built file is now named `<id>.scene` rather than `<id>`: three's loader
  renamed the second of two nodes called `att_suppressor` to `att_suppressor_1`, and the root
  is the one the runtime finds by name. Rebuilt (byte-identical otherwise) and
  `WEAPON_ASSET_VERSION` bumped to `stage-2`.
- Nothing in the procedural builder changed: a weapon without a file still shows no
  attachment, as before M19. Stage 3 brings the files.

### Verified

`npm run check` green. In the browser pane, in the Range (every attachment unlocked): the
editor's stage with all five on the M4 — the AimPoint with its red dot on the receiver, the
DBAL on the handguard, the grip under it, the can on the muzzle, the long magazine — toggled
live from the ATTACHMENTS tab; then the match: `sightHeight` 0.0806, ADS looking through the
tube with the dot on the screen centre and the front post in the lower half of the window, the
flash mesh parented to the suppressor's `socket_muzzle` 13.75 cm ahead of the bare one, eight
rounds fired (45 → 37, the extended magazine's count), a reload dropping the stretched
magazine. No console errors.

### Playtest (2026-09-22, the human): the optic floated

*"It looks like it is floating or mounted on an unnaturally tall gap above the actual
picatinny rail during ADS."* Two causes, both in the build script, both measured:

- **The rail socket was 3 mm proud of the rail.** `top()` answered with the highest vertex in
  the band — a notch at 7.30 cm in the kit's units, sixteen vertices — where the slat tops are
  at 7.05 (120 vertices) and the rail's base flange at 6.35 (227). `plateau()` replaces it for
  the rail sockets: half-millimetre bins over the top 1.5 cm of the band, the highest bin
  holding at least 40% of the fullest bin's count (`PLATEAU_SHARE`). `socket_rail_top` moved
  from 0.0383 to 0.0355, `socket_rail_front` from 0.0385 to 0.0355.
- **The AimPoint carries an AK side-mount's clamp** — a 1.2 cm plate under a stem under the
  tube. Set on the rail by its underside, the plate hovered over the slats and the tube stood
  4.2 cm up. The part's origin is now 6 mm above its underside (`OPTIC_CLAMP_SINK`), so the
  plate wraps the rail the way a clamp does and the axis lands 3.6 cm above it — Aimpoint's
  own lower-third co-witness height. `sightHeight` with the optic: 0.0806 → **0.0719**, the
  front post 4 mm under the dot.

**The suppressor's flash, decided:** `AttachmentEffects.muzzleFlashMult`, ×0.4 on the
SUPPRESSOR — the mesh and the muzzle light both scale by `muzzleFlashScale`, so a can flashes
smaller and dimmer; nothing the simulation reads changes. The benefit line says so, and the
arsenal panel shows the row.

Verified in the pane: the clamp meets the rail from the side and from behind in the viewer,
the DBAL's clamp sits on the handguard's slat tops; in the Range, ADS with the tube seated,
`sightHeight` 0.0719, the resolved def's `muzzleFlashScale` 0.4. Asset version `stage-2b`.

## What was built — stage 3 (2026-09-22)

**Part 1 — eight weapons from their files.** Each a recipe in `weapon-build.mjs`, each
measured, each verified in the viewer with the pack mounted before it went in:

| weapon | source | what the recipe had to do |
|---|---|---|
| VULCAN 74 | AK-74 pack (the tactical rifle of the set) | the `body.007` node set; the muzzle centred on the bore, since the brake's ports pulled `tip` sideways |
| HALCYON B5 | Tavor | the white body given the black set's texture (`useMaterial`); its own collimator as `optic_default`, hidden under the red dot; magazine and bullets as one group |
| LONGBOW MK3 | L1A1 polymer | a rigged rifle taken rigid at bind pose; forward `y−`, up `z+` |
| WASP 9 | MP5 kit | the Picatinny handguard and gas block **moved** onto the SD's place (`moves`); the front rail socket rolled −90° to the side |
| MERIDIAN P40 | P90 | forward `x−`; the collimator as the default optic; `socket_mag_exit` up and back — the magazine leaves along the receiver's top |
| BREACHER 12 | SPAS-12 | the pump as the charge group; the measurement bands moved onto the extruded barrel's vertex rings |
| VANTAGE SR | M150 | nodes chosen by **joint** (the dominant `JOINTS_0` of each mesh); the scope's lids excluded |
| TALON 9 | Beretta M9 (threaded barrel) | the slide as the charge group, the parts chosen by where they lie (`within`); textures held to 512 (2.76 → 1.62 MB); the rail sockets rolled 180° for the under-barrel laser |

The build grew for them: `moves` (a translation per node before the fix, for a kit laid out
flat), material swaps, `joint` / `match` / `except` / `within` selectors, `pick: 'highest'`,
sockets as `{ at, roll }`, a per-recipe `textureSide`, `magazineExit`, and `--list <file>`
to read a source's tree. The rail sockets measure the plateau along the recipe's own up
axis. At runtime: a weapon whose spec says `optic: 'scope'` keeps its scope and the OPTIC
does not mount; a file's own sight (`optic_default`) hides under the red dot; the magazine
leaves along the file's exit (`WeaponModel.magazineExit`; `ViewmodelAnim` tumbles it only
when it drops). Asset version `stage-3`.

**Part 2 — the L115A3, the knife, the bodies, the camo.**

- **KESTREL .338** from the L115A3: two meshes at 195k triangles, four times life size, the
  suppressor modelled into the barrel. `cuts` takes it off — every triangle of `Cube.001`
  beyond z −2.05 in the source's frame is dropped from a new index buffer, the measurements
  stop seeing those vertices, and the SUPPRESSOR mounts on the bare muzzle that is left. A
  per-recipe `simplify` (0.145) brings the viewmodel under the 30k budget before the
  textures (27,744; 1.41 MB). A bolt gun reloads with nothing moving, as the procedural one
  did: both groups empty.
- **The knife** from the MTech: `kind: 'knife'`, a root and a `body`, no sockets, the origin
  at the handle's centre where `KnifeMesh` closes the fist. `buildKnifeModel(anisotropy,
  template)` clones the file's blade in place of the grip, guard and blade boxes; the fist,
  the cuff and the forearm stay boxes. `WeaponAssetService.preloadKnife` rides with the
  warm-up. 4,433 triangles, 0.31 MB.
- **The bodies carry the files.** `HeldWeaponAsset` gains a `template`; `CharacterSkin` and
  `BotMesh` clone it in place of the geometry-and-material mesh when it is there
  (`BotMesh` now compares by asset, not by id, the way `CharacterSkin` already did). The
  service loads `<id>.lod1.glb` on demand (`preloadLod` / `lod`: the root and its two hand
  sockets, which are the anchors); `BotRenderer.heldWeapon` and `CharacterStage.heldWeapon`
  build on the primitives, ask for the LOD once, and drop their cache entry when it lands,
  so the next frame's `setWeapon` sees a new asset and swaps the mesh. Ten bodies carrying
  four weapons fetch four files. The bodies wear no attachments — the bare LOD, at that
  distance.
- **The camo, as an overlay (decision 4).** `camoMaterial(material, camo)` is the file's own
  material cloned with the pattern multiplied into the albedo after `map_fragment`
  (`onBeforeCompile`, a `customProgramCacheKey` per camo): the artist's normal map,
  roughness and baked wear show through the paint, and the pattern is scaled by the file's
  own brightness so a black albedo keeps the paint dark and a worn edge lifts it. The
  sampler reads the mesh's `uv` through a varying of its own (`CAMO_OVERLAY_REPEAT` 6 across
  the atlas), so a plain-colour part paints the same as a textured one. GOLD and OBSIDIAN
  take the metalness the procedural set gives them. One variant per (material, camo), kept
  for the process like the surfaces. `paintCamo(root)` applies it to every opaque material
  under a root — `buildFromTemplate` before the hands and the pack parts arrive (a
  suppressor is not painted with the weapon's camo, the gloves stay grey), and the editor's
  stage on the LOD. Transparent materials — a file's own optic glass — are left.
- The gate: rule 5 knows a knife (root and `body`); rule 8 holds the catalog's ten ids to
  the recipes. 25 files, 27.29 MB, 15 recipes.

Not built, and not going to be from these sources: the LMGs (BASTION and MONOLITH) stay
procedural — every LMG file offered was a game rip.

### Verified

`npm run check` green. In the browser pane: the editor's stage fetches `ar_carbine.lod1.glb`
and the operator holds the M4's LOD; with the camos earned (the pane's own save edited), the
preview paints the M4's file in DIGITAL, TIGER and GOLD with the file's shading through the
pattern, the optic on top unpainted, and the stage's LOD wears the same TIGER; a FOUNDRY
match fetches eight LODs for the bots' weapons, each once, a GLB body seen up close carrying
its rifle's file, the viewmodel in TIGER with the AimPoint and the can on it; the KESTREL
.338 in the match — the green chassis, the scope, the pack's suppressor on the cut muzzle,
5 / 40. The knife's file loads (`GLB knife is ready`) and was verified in the viewer; the
swing itself needs pointer lock, which the pane does not grant — the human's playtest. No
shader errors, no console errors.

## Open

- **The knife's swing in the match** — a look at the file's blade in the hand during a melee,
  which the pane could not trigger.
- **The camo's tuning.** `CAMO_OVERLAY_REPEAT` (6) and the brightness curve
  (`0.6 + 1.4·lum`) are first values, chosen against the M4; a playtest across the ten files
  decides whether the pattern reads at one size on the P90's atlas and the L115A3's.
- The LMGs stay procedural until a legitimate source appears.
- The M4's geometry is 1.5 MB of its 2.21 — split normals at every hard edge. `quantize` would
  roughly halve it; left for when the budget bites rather than done on a guess.
- The optic's glass carries `KHR_materials_transmission`; three loads it as a
  `MeshPhysicalMaterial` with a transmission pass. Stage 2 swaps it for the project's `lens`
  material, as the procedural red dot uses.
