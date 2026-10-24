# PROTOCOL SEVEN — Side-task backlog (opened 2026-10-12)

> **Read this at Step 0 of every unit.** Section 7 of `REFACTOR-PROMPT.md` makes it binding: any
> task below whose files are the unit's files goes into that unit's Step 2 plan, named, and is
> done under the unit's approval rather than left here. The table in §1 is the lookup.

This is the record of everything the refactor programme found and deliberately did not do. Each
entry says **why it was not done in its unit**, because that reason is the expensive part — it is
usually a rule (R2 freezes the public surface, R3 fences the unit, R7 protects hot paths) or a
measurement nobody has taken yet.

**38 open entries.** #1–#21 came over from chat across units A1–A12, unedited in substance; #22
and #24 were opened since, **#26 and #27 by A16** on 2026-10-12, **#28 by A17** on 2026-10-13, **#29 by A19** on 2026-10-14, **#30 and #31 by A20** on the same day, **A21 none** and **#32 by A22** on 2026-10-14; **A23 closed #1's shared half** on 2026-10-17 and **A24 folded `IntroPlan`'s copy** on 2026-10-18, neither opening any. **#33, #34 and #35 are the user's own field reports**, filed on 2026-10-19 from playing the game rather than from writing a test; §5b holds them. **B1 opened #36–#41** on 2026-10-19, the first entries from division B, and **#40 was closed the same day** by the session that corrected §6's NET oracle — which opened **#42** and **#43** with the first findings that corrected oracle produced. **B3 closed #31 and opened #48** on 2026-10-19, and **B4 opened #49** the same day, having found
nothing bound to its own four files — and #49 was closed in the same sitting, in a commit of its own; **B2b opened #44–#46** the same day, and **#44 was closed** on the same day by the session that cleared `lastImpactMaterial` per tick — whose own finding became **#47**, opened and closed on 2026-10-19 by the sixth oracle it asked for. Thirteen numbers are gone and
are not reused: **#19** is folded into #2 (the same defect from both ends), **#23** was closed by
A13 and **#25** by A15, both on 2026-10-12, and **#40**, **#44** and **#47** on 2026-10-19, with **#39**, **#41** and **#46** closed together the same day — the leaked snapshot, the write-only field and the guard that cannot fire, all three in files B1 and B2 had already finished and no later unit could touch — and **#31** by B3, in the one file it owned. **#32** and **#48** went together on 2026-10-19 — five comments naming two things that had moved or gone, in files §10 and R3 keep out of every unit's reach; #32's own count was one short, and the fourth was in `skirmishHarness.ts`. **#49** followed on
the same day: the arena's boot log and the README promised an `instant respawn` that playtest
round 4 had removed, and the fix needed a session outside the unit rules because R1 makes a log
line observable output. **B5 opened #50** on 2026-10-20 — four comments naming members that its
own split had moved — and **rewrote #30** rather than closing it: it absorbed the call site the
entry was bound to, which left the function with no production caller and turned the question
into whether it stays at all. **B6 declined #13 with the same reason B5 gave** — the move is in
a finished unit's files and reaches thirty files — and opened **#51**.

That accounts for 22 of the chat list's items against a count of 24, so **one item from the
original list is missing**; §6 records where to look for it. (#22, #24, #26, #27, #28, #29, #30 and #31 were
opened by units since and are not from that list.)

Status values: `open`, `bound to <unit>` (the next unit that owns these files — do it there),
`blocked on <task>`, `needs measurement`, `needs a decision from the user`.

---

## 1. Lookup by unit: what to fold in at Step 0

Find the unit you are about to start. If it is listed, those tasks are **in scope for that unit**
and belong in its Step 2 plan.

| Unit | Files | Tasks to fold in |
|---|---|---|
| ~~A13~~ | `shared/ai/BotDirector.ts` | **closed** — #23 was absorbed by A13 on 2026-10-12 |
| ~~A14~~ | `shared/modes/` | none were bound; A14 opened #24 and #25 |
| ~~A15~~ | `shared/modes/` SND, MatchFlow, ModeRegistry | **closed** — #25 was absorbed by A15 on 2026-10-12, under an approved fence exception |
| ~~A16~~ | `shared/streaks/` | **declined with a reason** — #1 cannot be closed from inside a unit; see its entry. A16 opened #26 and #27 |
| ~~A17~~ | `shared/streaks/` StreakSystem, StreakLedger, StreakDefs, StreakPresentation | **closed** — none were bound; A17 opened #28 |
| ~~A18~~ | `shared/perks/`, `shared/meta/` Camos, Challenges, ChallengeTracker, FieldUpgrades, Levels, XpRules, XpSimulator, Skins | **closed** — A18 read the whole list and nothing was bound to its twelve files; it opened none, and merged `LONGSHOT_METRES`'s in-unit duplicate itself |
| ~~A19~~ | `shared/meta/` SaveData, Unlocks, LoadoutRules, Loadouts, MatchLedger, MatchProgression, ProgressionStore | **closed** — nothing was bound to its seven files; A19 opened #29 |
| ~~A20~~ | `shared/net/` Wire, Protocol, Snapshot, UrlFlags, DisplayText | **declined with a reason** — #1 owns no A20 file: the edit is in `MathUtil.ts` (A1) and both call sites are A23 (`Interpolation`) and A12 (`ai/Bot`). A20 opened #30 and #31 |
| ~~A21~~ | `shared/net/Messages.ts` + the seven files it was split into | **declined with a reason** — `Messages.ts` calls neither angle helper, so #1 has no edit to make here. A21 opened none |
| ~~A22~~ | `shared/net/NetClient.ts` + `CommandPipeline.ts` | **closed** — nothing was bound to it; A22 opened #32 |
| ~~A23~~ | `shared/net/` Prediction, Interpolation, ClockSync, NetSim, Transport, Skirmish | **closed** — A23 absorbed #1's shared half under an approved fence exception: `shortestAngle` is gone and both call sites moved. What is left of #1 is the three local copies, which are not the same function |
| ~~B4~~ | `server/instance/` InstanceClock, LiveMatch, VoteCycle, WarmupMatch | **closed** — nothing was bound to its four files: #13 is B5/B6's and its edit is in `shared/combat`, #42's and #30's file is `MatchInstance.ts` which is B5's. B4 opened #49, which was closed the same day |
| ~~B5~~ | `server/instance/MatchInstance.ts` + the three files it was split into | **closed** — B5 absorbed #30's call site: `writePlayer` now reads the table this file already built, and `equipmentIndexOf` has no production caller left (see #30, rewritten). #13 was **declined with a reason**: `PLAYER_ENTITY_ID` appears nowhere in `server/instance/`, so B5 has no edit to make — the server-side importers are `Match.ts` (B6) and `Spectator.ts` (B8). #42 stays open but its four rules are now pinned by tests. B5 opened #50 |
| ~~B6~~ | `server/Match.ts` + the two files it was split into | **declined with a reason** — #13's only edit in B6's file is the one argument `equipment.simulate` passes, and the move itself is in `shared/combat/DamageSystem.ts` and `LocalIdentity.ts`: A9's files, in the `check:style` ratchet, outside R3's fence. `grep` reaches **30 files** across all three partitions, four of them `client/debug`. No unit can close it; see #13, re-scoped. B6 opened #51 |
| C1 | `client/cinematic/IntroCamera.ts` | #1 (local copy, `[-PI, PI]`) |
| C2 | `client/engine/` CameraRig, FrameLoop | #34 — reproduce the local camera jitter *before* refactoring these files |
| C4 | `client/engine/` Decals, Fx | #33's other half, and only if clearing one target's marks needs an API they do not have |
| C11 | `client/combat/TargetDummy.ts` | #33 (a killed dummy's holes left hanging) |
| C23 | `client/Game.ts` | #35 (preload the arsenal's viewmodels) |
| C24 | `client/ClientMatch.ts` | #1 (local `angleDeltaRad`, `while` loops) |

Everything else below lands in a **completed** unit's files and therefore needs a session of its
own. Those sessions are not refactor units: they may change behaviour where the task says so, and
they are not fenced by R3.

---

## 3. Sequenced clusters — order matters

### Cluster I — the collision core: **#6 → #12 → #5**

Three tasks converge on `src/shared/world/Geometry.ts`. In the wrong order the later ones redo
the earlier ones' work.

#### #6 — Retire Geometry's duplicate `clamp` helpers · `open` · *do first*

**Files** `src/shared/world/Geometry.ts`, possibly `src/shared/core/MathUtil.ts`. **Origin** A4.

Geometry ends with non-exported `clamp(v, lo, hi)` and `clamp01(v)` whose bodies are byte-identical
to the exported pair in `core/MathUtil.ts`. The local pair is reachable only from
`capsuleBoxPenetration`.

Not done in A4 for two reasons worth keeping: R4.3 sends cross-unit duplication here, and
`MathUtil` belongs to A1 which is finished and in the `check:style` ratchet; and these are the two
innermost functions on the hottest path in the project — `capsuleBoxPenetration` calls `clamp` six
times per collider per entity per tick. Today they are module-local and monomorphic. V8 inlines
across modules in one bundle so importing them is very likely free, but "very likely free" on that
path is a decision to take deliberately.

**Decide** import from `core/MathUtil` and delete the local pair, or keep the pair and document why
it exists. Either is defensible; two identical copies with nothing saying which is which is not.
If importing: this is a new `shared/world` → `shared/core` edge, which is directionally fine and
`check:boundaries` permits it. While there: `SpatialHash.clampInt` is the integer sibling with no
`MathUtil` equivalent — it is **not** a duplicate, should stay, and should be mentioned in the
commit so the next reader does not go looking.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`. The bodies are identical so the
arithmetic cannot move; the oracle proves the wiring.

#### #12 — Unify the rig slab test with Geometry's · `needs a decision from the user` · *do second*

**Files** `src/shared/combat/HitboxRig.ts`, `src/shared/world/Geometry.ts`, plus a home for the
shared helper. **Origin** A9.

`HitboxRig.narrowSlab(o, d, h, axis)` and `Geometry.entrySlab(o, d, h, axis)` are the same ray-slab
test: same `EPS = 1e-6`, the same arithmetic character for character, and the same module-level
state pattern for the axis and the sign, chosen in both places because the test must not allocate.

A4's commit `389db4e` records that this test was written out **seven** times across the collision
core and that A4 reduced it to two. HitboxRig's copy was in another unit, outside A4's fence, so it
stayed — and A9 found it as the third.

**The one real difference has to be settled first:** `entrySlab` tests a parallel ray's in-range
case as `o >= -h && o <= h`; `narrowSlab` writes `!(o < -h || o > h)`. A9 kept the second form
deliberately because it is the form the three inline copies it replaced had — **and the two differ
for a NaN coordinate.** Settle that with a test either way before merging.

Then decide where one shared helper belongs: neither `combat/` nor `world/` obviously owns it,
`combat/` already imports from `core/`, so `shared/core/` or an exported `Geometry.entrySlab` are
the candidates. Note `entrySlab` is currently **not exported**, so exporting it is a public-API
change.

**Why before #5:** #5 restructures Geometry around these helpers. Moving or exporting `entrySlab`
afterwards means touching the same code twice.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`; the 3,600-tick hash is what proves a
bullet still stops where it used to. `HitboxRig.test.ts` (A9) pins the rig side: hits per zone, the
nearest-box choice, normals under yaw, a ray starting inside a box, the parallel-axis case.

#### #5 — Split `capsuleBoxPenetration` in its own unit · `open` · *do last*

**Files** `src/shared/world/Geometry.ts`. **Origin** A4.

144 lines at cognitive complexity 32, against limits of 50 and 15. A4 brought five of its unit's
seven over-limit functions inside the limits and left this one completely untouched, on purpose. It
is the last unexplained violation in `shared/world` apart from `Raycaster.cast`, whose remainder is
an agreed exception.

Why it was left: one numerical kernel with about twenty live locals. The two phases that carry the
complexity — the three-round alternating-projection loop that finds the closest point between the
capsule segment and the box, and the "capsule axis is inside the box, escape along the shallowest
face" branch — cannot be handed to helpers without either signatures of eight to ten parameters
(which the guidance refuses, and which read worse than the original) or roughly twenty
module-level scratch slots. Twenty slots is a big enough surface that one mis-wired slot is a
silent collision bug, and it should not ride along in a unit already carrying six other changes.

What A4 established that this task should use:
- **The pattern is proven.** `entrySlab` (new in A4) and the pre-existing `exitSlab` both work over
  module-level `let`s, and A4 added `toBoxLocalRay`, which writes six local-space values plus the
  nine basis values into module slots so its two callers do not pay for the basis reads twice.
  `capsuleBoxPenetration` wants the same treatment, with a sibling that transforms two *points*
  (segment A and B) rather than a point and a vector.
- **The tests exist.** `Geometry.test.ts` has 31 tests; the `capsuleBoxPenetration` half covers
  clear, exactly tangent (which reports no contact — the test is strict), overlapping from the
  side, standing on the top face, axis inside the box dead centre and off centre, a degenerate
  capsule whose endpoints coincide, the grown-AABB early reject on each axis, all against both an
  axis-aligned and a yawed box. Do not weaken them.

**Scope** (1) add the segment transform and use it to remove the third copy of the world-to-local
block — `rayBox` and `rayBoxExit` already share `toBoxLocalRay`; (2) split the closest-point solve
and the shallowest-face escape into named helpers over module scratch; (3) carry every expression
over character for character — R5 forbids reordering or regrouping any floating-point arithmetic,
and this function's output feeds the collision resolver and therefore the per-tick hashes.

**Target** within 50 lines and complexity 15, or a documented exception with its numbers and a
better reason than this one.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`. The 3,600-tick hash is the real test;
A4's version of this change passed it unchanged and so must this one.

---

### Cluster II — layering: **#2 (absorbs #19)**

#### #2 — Fix `shared/core`'s upward type dependencies, by moving the vocabulary · `needs a decision from the user`

**Files** `src/shared/core/Events.ts`, `src/shared/ai/Combatant.ts`, and every importer across
`shared/`, `server/` and `client/`. **Origin** A1 and A11; the refactor prompt names both halves
itself (§8 and §9's A11 note).

**#19 of the chat list is folded in here**, because it is the same defect seen from the other end.
#2 said the lowest layer of the simulation imports types from four layers above it; #19 said the
vocabulary those types belong to lives in a leaf. One move fixes both, and doing them separately
means the second session finds half its work done.

`shared/core/Events.ts` imports upward:

```
import type { BotTeam }   from '../ai/Combatant'
import type { BotTier }   from '../ai/DifficultyTiers'
import type { BotState }  from '../ai/BotStates'
import type { HitZone }   from '../combat/HitboxRig'
import type { StanceId }  from '../player/Stance'
import type { WeaponSlot } from '../weapons/WeaponDefs'
```

`shared/core` is the foundation every other partition sits on, and today it cannot be loaded or
reasoned about without `ai`, `combat`, `player` and `weapons`.

`shared/ai/Combatant.ts` exports `BotTeam` (the `'A' | 'B'` every system keys off), `Combatant`
("a participant in a firefight" — a `Damageable` plus a pose, a facing and a team) and
`opposingTeam`. The file's own comment explains why it is the right abstraction: it is what makes
S6.1's symmetry real, so "can a bot see the player" and "can a bot see another bot" are one piece
of code. Only its address is wrong — `grep -rln "from '.*ai/Combatant'" src/` reaches
`shared/combat`, `shared/equipment`, `shared/streaks`, `shared/modes`, `shared/net`, the server and
the client.

**The project has already paid for this twice**, both as deliberate workarounds:
- `Damageable.team` in `combat/DamageSystem.ts` is the literal union `'A' | 'B'`, not `BotTeam`,
  with a comment saying *"combat/ sits below ai/ and should not depend upward on it. The two are
  structurally identical, so a Combatant satisfies this without a cast."*
- `combat/Hostility.ts` is written *"against the literal union rather than BotTeam for the reason
  Damageable.team gives"*.

**Scope** (1) decide the home — `shared/core/` is the candidate the whole tree already depends on;
`shared/combat/` is the other, since `Damageable` is half of what `Combatant` extends; (2) move the
three exports and update every importer; (3) collapse the two duplicated literal unions onto
`BotTeam` once the new home makes that legal; (4) also handle `HitZone` / `StanceId` /
`WeaponSlot`, or record why they stay; (5) **add the missing rule to
`scripts/check-boundaries.mjs`** — it enforces the partition rules but *not* layering inside
`shared/`, so without it the next upward import goes in unnoticed. That rule is a large part of the
value here.

**Do not start without agreeing the move with the user.** This renames and relocates exports across
the whole tree, which is exactly what A1 and A11 were forbidden from doing.

**Verify** `npm run check` (including `check:boundaries`) + SIM snapshot/compare → `PASS`.
`Combatant.test.ts` (A11) covers `opposingTeam`, and the twelve other `ai/` test files build
`Combatant` literals, so a bad move surfaces as a compile error rather than silently.

---

### Cluster III — the scoreboard: **#14 + #15 in one sitting**

Both are in `src/shared/combat/ScoreSystem.ts`, both are gated on the same measurement of the
client snapshot path, and both are pinned by the same test file. Measuring once serves both.

#### #14 — Make the scoreboard prune linear · `needs measurement`

`pruneRowsMissingFrom` (extracted by A9 out of `applyReplicated`, logic unchanged) decides which
rows the server has stopped listing with `rows.some((r) => r.entityId === row.entityId)` inside a
descending loop over held rows. That allocates one arrow closure per held row and scans the
replicated set once per held row — O(n·m) with a closure per iteration, on the networked client's
snapshot path, which runs whenever the board's serial moves. `shared/combat` is on R7's hot-path
list, which is why A9 did not touch it.

**Measure first.** A dozen rows is small, so this may well be the right code already and the
finding is then *"measured, left alone"* — record that. If it is worth changing, replace the `some`
with something that allocates nothing: one pass over `rows` into a reused scratch `Set` or sorted
id array held on the instance as `assistScratch` already is, then one pass over `this.all`. Keep
the removal order descending, because it splices.

#### #15 — Settle the fifteen scoreboard columns · `needs measurement`

The fifteen counter columns of `PlayerScore` (kills, deaths, assists, score, streak, bestStreak,
shotsFired, shotsHit, damageDealt, headshots, captures, defends, plants, defuses, tags) are written
out in full in **five** places: `register`'s zeroed literal, `reset`, `haveColumnsChanged`'s
fifteen-term comparison, `copyColumns`' fifteen assignments, and `ReplicatedScoreRow` on the wire.

They change for one reason: a new scoreboard column. So adding one means editing five places and
the compiler catches two of them — the other three fail silently as a column of zeroes or a column
that never updates. The modes' `getScoreboardColumns` reads these back by name, which is why
`ObjectiveStat` is a closed union in the first place.

Why A9 left it: all of `shared/combat` is on R7's hot-path list, which forbids dispatch over a
per-entity path, and the only mergers available are keyed access (`row[key] = r[key]` over a
`const COLUMNS = [...] as const`) — a megamorphic keyed write on a nineteen-field object V8
currently sees as one shape — or code generation. Neither is obviously better than five honest
lists, and deciding needs a measurement rather than an opinion.

**Three honest outcomes:** (a) adopt keyed access if the cost is noise; (b) keep the five lists and
add a compile-time guard that they cannot drift — a `satisfies Record<keyof ScoreColumns, …>` table
or a type-level exhaustiveness check that fails to compile when a column is added without touching
every site; (c) record the measurement and leave it. **(b) is probably the best outcome**: it keeps
the monomorphic writes and removes the silent-failure mode, which is the actual defect.

**Verify both** `npm run check`. `ScoreSystem.test.ts` (A9) covers upsert, in-place update of a
cached row object, team moves, the prune, the empty set, that `serial` does not move when nothing
changed, and all fifteen columns through `applyReplicated` and `reset`. Do not weaken it.

---

## 4. Independent — one decision each

### #1 — Two local angle helpers that are **not** the shared one · `needs a decision from the user`

**Files** `src/client/cinematic/IntroCamera.ts:83` and `src/client/ClientMatch.ts:3444`.
**Origin** A1; the export half was **closed by A23** and `IntroPlan`'s copy **folded by A24**,
both on 2026-10-17/18. **Touches two upcoming units** — see §1.

**What A23 finished.** `MathUtil` exported one function under two names, `angleDelta` and
`shortestAngle`, and the duplicate export is gone: the two call sites moved onto the survivor
(`shared/net/Interpolation.ts`'s `sample` and `extrapolate`, `shared/ai/Bot.ts`'s `renderYaw`),
`shortestAngle` was deleted, the two JSDoc blocks were merged onto `angleDelta` with the M10
provenance note intact, and `MathUtil.test.ts`'s fifteen-row agreement table now asserts
`angleDelta(from, to) === wrapAngle(to - from)` on every row — the same rows, between the two
helpers that are left. The 3,600-tick SIM hash was byte-identical across the change, which is
what a no-op looks like. It took an approved fence exception (R2 and R3) because the edit lands
in A1's finished files.

**What is left, and it is not a no-op.** Two files still define their own copy, and **neither of
them is the shared function**:

```
MathUtil.angleDelta   if (d > PI) d -= TAU;  if (d <= -PI) d += TAU;   ->  (-PI, PI]
IntroCamera           if (d > PI) d -= TAU;  if (d <  -PI) d += TAU;   ->  [-PI, PI]
ClientMatch.angleDeltaRad while (d > PI) d -= TAU; while (d < -PI) d += TAU;  ->  [-PI, PI], no %
```

The difference is `<=` against `<` at exactly **d = -PI**: the shared helper maps a half turn to
`+PI`, the local copies keep `-PI`. `ClientMatch`'s is a third spelling again — `while` loops
rather than `%`, which agrees everywhere the modulus does but is its own code.

So folding them in is a **behaviour change at one input value**, in two places that are both
about where a camera or an overlay points: the camera rig's follow and the mortar overlay's
bearing. A24 folded the third — the intro plan's yaw blend — and `intro.txt` was byte-identical
across every map and mode, which is the evidence the other two can be judged against.

At d = -PI the two answers are a half turn apart in sign, which is the one input where a blend
would visibly swing the other way.

**Decide** per site: fold it in and accept the `(-PI, PI]` boundary (and pin the new value in
that unit's tests), or keep the local copy and write down *why* it wants `[-PI, PI]`. What is
not acceptable is a fourth copy.

**Where each one is done:** `IntroCamera.ts` in **C1** and `ClientMatch.ts` in **C24** — each
inside its own unit's fence, under that unit's approval, because each is a behaviour question
about that unit's code rather than a mechanical merge.

**Verify** `npm run check` + SIM snapshot/compare. Both are camera work and need the BROWSER
check their units already run; neither is covered by an oracle the way `IntroPlan` was.

### #3 — Replace greybox's two hand-computed ramps with `rampAlongX` / `rampAlongZ` · `needs measurement`

**Files** `src/shared/world/maps/greybox.ts`, reading `maps/build.ts`. **Origin** A3a.

`greybox.ts` was the only one of the four map files that did not import from `build.ts` at all. A3a
fixed half of that: the local `add` closure went in favour of `build.addBox`. What remains is the
two ramps, pushed inline with `out.push({...})`: the main ramp in `stepAndLedge` (top surface
`(x=-18, y=0)` → `(x=-13.5, y=1.5)`, `rotationZ`) and the pit ramp in `pit` (`(z=8, y=-3)` →
`(z=2, y=0)`, `rotationX`). `build.ts` exports exactly these two helpers, taking the two endpoints
of the top surface — exactly what greybox's comments already describe in words.

**The gap in the maths, and why A3a did not touch it.** Both sides reach the same geometry by two
different floating-point routes:

| | greybox (today) | `build.rampAlongX` |
|---|---|---|
| length | `Math.hypot(RISE, RUN)` | `Math.hypot(dx, dy)` — **arguments the other way round** |
| angle | `Math.atan2(RISE, RUN)`, once, into a constant | `Math.atan2(dy, dx)`, from the deltas |
| normal | `nx = -simSin(angle)`, `ny = simCos(angle)` | `nx = -dy / len`, `ny = dx / len` |

The last two rows are the serious ones: `-simSin(atan2(a,b))` and `-a/hypot(b,a)` are equal
mathematically with no guarantee of equality in the last bit, and `Math.hypot` is not guaranteed
symmetric in its argument order. R5 forbids changing the order or grouping of floating-point
arithmetic, and this brush's position feeds the collision world — the 3,600 hashes.

**Steps** (1) measure before replacing: build both ramps both ways and compare `position` and
`rotation` bit for bit. Identical → the swap is free. Different → decide which route is right
(`rampAlongX` is the one the other three maps use, so probably that) and accept a last-bit change
knowingly. (2) If replacing:
`rampAlongX(out, 'metal', -18, 0, -13.5, 1.5, 6, 3.5, MAIN_RAMP_THICK)` and
`rampAlongZ(out, 'metal', 8, -3, 2, 0, 10.3, 3.0, PIT_RAMP_THICK)` — check the arguments against
the geometry in the comments. (3) `MAIN_RAMP_ANGLE`, `MAIN_RAMP_LEN`, `PIT_RAMP_ANGLE`,
`PIT_RAMP_LEN` then become dead and `simSin`/`simCos` probably leave greybox's imports entirely.

Note the measurement is a **same-engine** question and is unaffected by the cross-V8 finding of
2026-10-12; but if a last-bit change *is* accepted, the re-baseline must be taken on the engine the
gate runs (see §5).

`greybox.test.ts` already pins both ramps ("the two ramps keep their authored pitch") — and pins
them **against the formula** (`toBe(Math.atan2(1.5, 4.5))`), not against a baked literal, so it
moves with the engine and will go red exactly when the maths moves. That is the signal to watch.

**Why it is worth it** `greybox` is the room the movement system is calibrated in, and two ramp
formulas that are supposed to agree are the same shape as the second finding in A2 — one rule
written twice, ending up not agreeing.

### #13 — Move `PLAYER_ENTITY_ID` out of `DamageSystem` · `open` · *needs a session of its own (B5 and B6 both declined it)*

**Files** `src/shared/combat/DamageSystem.ts`, `src/shared/combat/LocalIdentity.ts`, every
importer. **Origin** A9.

`export const PLAYER_ENTITY_ID = 0` is declared in `DamageSystem.ts`. It is not a fact about
damage: it is the entity id of the single-player seat, and it is what every piece of local
presentation compares against. `LocalIdentity.ts` — the class whose entire subject is which entity
this client is — imports it from `DamageSystem`, which reads backwards. A9 could not move it: R2
freezes the public API.

**Scope** `grep -rn "PLAYER_ENTITY_ID" src/ scripts/ public/ probes/`, decide the home —
`combat/LocalIdentity.ts` is the obvious candidate since that file is about exactly this and
`DamageSystem` needs it only as `makeDamageRequest`'s default `sourceId`; `shared/core/` is the
alternative if a lower layer turns out to need it — then move it, re-exporting from the old
location only if something outside `src/` depends on the old path.

**Watch for** the constant is reachable at runtime through `window.__p7` and the verification
scripts under `public/verify/`, so check those as well as `src/`.

**Why neither B5 nor B6 could do it** (2026-10-20 and 2026-10-24). The entry was bound to
"B5, B6" on the strength of them being importers. B5's files do not mention the constant at
all. B6's does, in exactly one place — the `PLAYER_ENTITY_ID` argument
`equipment.simulate(0, 0, 0, PLAYER_TEAM, PLAYER_ENTITY_ID, false)` passes — and the *move* is
in `DamageSystem.ts` and `LocalIdentity.ts`, which belong to A9 and are in the ratchet. A
`grep -rn "PLAYER_ENTITY_ID" src/` reaches **30 files**: `shared`, the server, four
`client/debug` panels, `client/perks`, and the presentation files that compare against it. That
is a tree-wide rename, which is precisely what R2 and R3 exist to keep out of a unit's commit.
So this is an unbound task and needs its own session, as #32, #48 and #49 did.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`.

### #16 — Settle the three hard-coded body heights · `needs a decision from the user`

**Files** `src/shared/equipment/EquipmentSystem.ts`, `src/shared/equipment/BotThrower.ts`.
**Origin** A10. **This one can change behaviour** — read the last paragraph.

Three different numbers stand in for "how far up a body is" inside `shared/equipment`, and they
disagree:
1. `EquipmentSystem.tripsTrigger` (extracted by A10 from `stepTrigger`, logic unchanged) does the
   claymore's height test against `c.py + 0.9`;
2. the same method then raycasts to `c.py + c.aimHeight` for line of sight — a different height on
   the same body in the same test;
3. `BotThrower.isSafe` measures its safe radius from `c.py + 1`, twice.

Meanwhile `Combatant.aimHeight` is documented as *"Torso-centre height above the feet, metres.
Where a bot aims"* and `HitboxRig.layout.aimY` is the authored figure behind it — 1.26 m standing,
lower in every low layout. The rig knows the answer and these three sites each invented their own.

**Why it matters** 0.9 and 1 are standing-body guesses, so a crouching or sliding body is measured
from the wrong place. For the claymore that shifts the band it will and will not fire through; for
the bot's safe radius it shifts where a grenade counts as too close to a team-mate. Both are small,
and both are wrong in exactly the pose a player notices.

**Scope** decide what each site actually wants — the claymore's band is about a floor-to-floor
separation so it may legitimately not be `aimHeight`; the safe radius plainly wants a body centre —
name the ones that stay as constants with a comment saying what they mean, and move the rest onto
the rig.

**If a figure changes, that is a behaviour change**: the oracles must be re-baselined deliberately,
with the difference explained, not silently. `EquipmentSystem.test.ts` and `BotThrower.test.ts`
(A10) encode today's numbers — the claymore's radius, cone, height band, line of sight, owner and
team-mate; the thrower's safe radius against self, team-mate, enemy and free-for-all — so a
deliberate change means updating those assertions with a reason.

### #17 — Remove the no-op blast-radius `Math.max` · `needs a decision from the user`

**Files** `src/shared/equipment/EquipmentSystem.ts`. **Origin** A10.

`detonate` computes its search radius as
`Math.max(def.effectRadius, def.flashSeconds > 0 ? def.effectRadius : 0)`. Both arms of the ternary
are `def.effectRadius` or `0`, so the expression is `Math.max(def.effectRadius, 0)` at best and
simply `def.effectRadius` for every piece of equipment in the table — the smallest `effectRadius`
is the smoke's 0, and smoke never reaches this branch, having neither a damage profile nor flash
seconds. The `flashSeconds` test cannot change the result.

It reads like the remains of a version where a flash had its own radius separate from the blast's —
a reasonable thing to want, since `flashbang.effectRadius` is 11 against the frag's 6 and a flash
does reach further than shrapnel. So there are **two honest outcomes and they are different
changes**: (a) the expression is dead and should be `def.effectRadius`; or (b) a flash was meant to
have its own radius, `EquipmentDef` should carry one and the line should read it — a behaviour
change and a balance decision, not a cleanup. A10 pinned the current behaviour because telling (a)
from (b) is a design question.

**Note while deciding** `resolveBlast` (extracted by A10, logic unchanged) uses `radius` for the
distance cull and then passes `def.effectRadius` separately to `this.flash.apply`, so the flash's
own falloff is already measured against `effectRadius` inside `FlashField.intensityFor`. Under (b)
those two would have to agree.

**Verify** under (a) the oracles must be unchanged → `PASS`; under (b) they will differ and the
difference has to be explained and re-baselined deliberately.

### #18 — Share the gravity and drag integration step · `open` · *note, not a defect*

**Files** `src/shared/equipment/Projectile.ts`. **Origin** A10.

A10 unified two of the three blocks shared between `ProjectilePool.step` and `previewTrajectory` —
`averageContactNormal` (fourteen lines each) and `reflectOffSurface` (eight each), both module-level
functions over module-level state so they allocate nothing. Still written twice, four lines each:
`dvy -= cfg.gravity * DT`, `const decay = Math.max(0, 1 - cfg.drag * DT)`, and the three
multiplies.

`step` has the velocity on the projectile (`p.vx`) and `previewTrajectory` has it in three locals,
so a shared helper either takes and returns three numbers — a module-level scratch triple plus six
lines of copying in and out at each site, more than the four it saves — or takes an object, making
the call site polymorphic across a `Projectile` and the preview's scratch. Both are worse than the
duplication, which is why A10 stopped.

**Worth revisiting if `previewTrajectory` ever gets a record of its own** (a pooled scratch
`Projectile`, say), because then one helper over one shape serves both and the copying disappears.
Until then this is a note, not a defect.

If it is done, every expression must be carried over character for character — this is the arc
every grenade in the game flies — and `Projectile.test.ts` (A10) steps one projectile, previews the
same arc, and asserts they agree point for point at float32 precision.

### #20 — Put the cover candidate arrays on the instance · `needs a decision from the user`

**Files** `src/shared/ai/Cover.ts`. **Origin** A11.

`Cover.ts` keeps `candidateIndex`, `candidateDist`, `worstDist` and `worstAt` at module level,
shared by every `CoverIndex` ever constructed. **Two earlier units decided the same question the
other way**, each with the reason written down: `world/Raycaster.ts` (A4) holds its ray in six
private fields — *"on the instance and not at module level, so two Raycasters in one process — a
menu skirmish beside a match — cannot read each other's ray"* — and `equipment/SmokeField.ts` (A10)
holds its sight line in seven private fields with the same sentence.

A11 kept Cover's at module level deliberately: the arrays are written and read entirely inside one
synchronous `select` call, so there is no live defect — the same argument that justifies `evDamage`,
`RESULT` and `LAUNCH`. But the project now answers one question two ways in three files, and the
odd one out is the one whose state spans two calls (`gatherNearest` fills the arrays, `select`
reads them).

**Decide which rule the project wants and make all three agree:** move Cover's four onto the
instance like the other two, or write down in `Cover.ts` why a per-call scratch shared across
instances is fine here and a ray was not. Moving them costs 16 ints and 16 doubles per
`CoverIndex`, of which a match has one. Note `findWorstCandidate` and `offerCandidate` (both
extracted by A11) are module-level functions *because* the arrays are, so moving the arrays means
moving those two onto the class as private methods.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`. `Cover.test.ts` (A11) includes a case
offering thirty-two candidates against the cap of sixteen, which is the path this scratch exists
for.

### #21 — Restructure the Gait load-time guard · `open`

**Files** `src/shared/ai/Gait.ts`. **Origin** A11 — and the one skeleton deviation that unit
shipped, approved at the time. `Gait.ts` is in the `check:style` ratchet, so the gate will check the
result.

`Gait.ts` reads two boxes off the rig with `.find(...)`, validates them with a top-level
`if (... === undefined) throw`, and then derives `LEG_PIVOT_Y` and `LEG_LENGTH` from the narrowed
values. Section 3.2 puts a top-level side-effecting statement in a MODULE INITIALISATION section at
the foot of the file and moves the interleaved declarations with it — which here would either drag
every constant in the file down, or, if only the `throw` moved, lose the narrowing that lets
`LEG_PIVOT_Y` read `LEG_BOX.oy` without `?.`. Writing `LEG_BOX?.oy ?? 0` turns a loud failure at
load into a silent zero in a published measurement, which is a behaviour change, so A11 left the
guard in place with a comment saying why.

**The shape that satisfies both** is probably a small internal helper that does the lookup and the
validation together and returns a non-optional box:

```ts
function requireRigBox(name: string): HitboxDef { ... }
const LEG_BOX = requireRigBox('legL');
```

It keeps the loud failure, removes the top-level statement, removes the `?.` in `legDivergence`
and `armDivergence` too, and lets the file's sections be exactly what 3.2 describes. `HitboxDef`
is exported from `combat/HitboxRig.ts`. Check whether anything else in the tree wants the same
helper before adding a second copy.

**Behaviour to preserve** the error is thrown at module load, with that message, when the rig has
no such box; `LEG_PIVOT_Y`, `LEG_LENGTH` and the two divergence figures keep their exact values.
`Gait.test.ts` (A11) asserts the two come off the rig's own `legL` box. `npm run readability` prints
the figures this file produces — compare its output before and after; those figures go through
`toFixed`, so they are engine-stable (see §5).

---

## 5. Suspected bugs, pinned in tests, awaiting a fix

Each of these is wrong today, was found while writing characterization tests, and was **pinned
rather than fixed** under §5.9 of the prompt — the test carries
`// Pins current behaviour; suspected bug: <title>`. Fixing one means updating its pinning test in
the same commit, with the reason.

### #8 — `NavBakeStats.stacked` is not recounted after pruning · `open`
**Files** `src/shared/world/NavBake.ts`. **Origin** A5. The `stacked` figure — columns carrying
more than one surface — keeps the raw count from the first pass while `walkable` and `links` are
updated after pruning. On Depot it reports **1,810 instead of 430**. Fix the counting so it runs
after the prune, and update the test.

### #9 — Dead no-op in `Movement.tryStepUp` · `open`
**Files** `src/shared/player/Movement.ts`. **Origin** A6. `vxBefore` / `vzBefore` are captured and
written back to `sim.vx` / `sim.vz`, but nothing modifies the velocity in between, so the
assignment rewrites the same value. Left in place during the refactor because this is the hottest
path in the game. Delete the capture and the restore, and confirm the oracles do not move.

### #10 — `PlayerSim.reset` leaves stale `Mantle` pose fields · `open`
**Files** `src/shared/player/PlayerState.ts` (and `Mantle.ts`). **Origin** A6. `reset` clears
`mantleActive` but not `mantleFrom`, `mantleTo`, `mantleEndStance` and the rest. Because the flag is
false the game never reads the stale pose, so there is no gameplay bug — but a snapshot taken
immediately after a spawn still carries ghost data from the previous life, which can reach
reconciliation and the wire. Clear all the mantle fields in `reset` and update the test.

### #11 — Kestrel's base values fall outside its own tuning sliders · `needs a decision from the user`
**Files** `src/shared/weapons/WeaponTuning.ts` or `src/shared/weapons/defs/snipers.ts`. **Origin**
A8. The Kestrel ships `rpm: 48` against a slider minimum of 60, and `adsFovScale: 0.34` against a
minimum of 0.4. Touching either slider in the F1 debug panel snaps the value to the bound and the
weapon's authored figure cannot be restored through the UI. **Decide**: widen the bounds in
`WEAPON_TUNABLES` to contain the authored values, or change the weapon's base values. The second is
a balance change.

### #45 — One roster lookup, written twice in one unit · `open` *(opened 2026-10-19 by B2b)*
**Files** `src/server/net/SeatEvents.ts` (`find`) and `src/server/net/VisibilityAudit.ts`
(`bodyById`). **Origin** B2b.

The same linear scan over the same array for the same answer. B2b removed the closure form —
`VisibilityAudit` built a `byId` arrow per `observeEvents` call — so what is left is two
identical module-level functions in two files.

**Why B2b could not do it.** The same wall as #36: a shared helper needs a new file (R3, and B2
is not a **design** unit) or a new export on an existing file (R2, and Step 2 approved exactly
one — `collectTeammates`). `Relevance.ts` is the natural home, beside `collectTeammates` and the
`teamOf`/`isAlive` pair both files already import from it; that is one export and two call sites,
and it should be done with #36, which has the same shape and the same destination.

### #38 — The input ring's accept window is one tick wider than the ring, and narrower than the skew limit · `open` *(opened 2026-10-19 by B1)*
**Files** `src/server/net/InputBuffer.ts`. **Origin** B1.

Two defects in one window, both pinned by `InputBuffer.test.ts` and both about the same two
numbers: `RING = 128` and `MAX_TICK_SKEW = 120`.

1. **The two ends of the window share a slot.** `accept` takes any tick in
   `[currentTick - 64, currentTick + 64]`, which is **129 ticks over 128 slots**, and
   `(c - 64) % 128 === (c + 64) % 128`. A command for a tick 64 ahead silently overwrites one
   for a tick 64 behind; the earlier tick then starves and repeats instead. Pinned by *"loses a
   command 64 ticks behind when one 64 ticks ahead claims its slot"*.
2. **The validator is wider than the buffer.** `validateCommand` accepts a skew of up to 120
   ticks, so a command 65–120 ticks from the present passes the boundary and is then counted
   here as `outOfWindow`. The file's own comment claimed the opposite — *"comfortably past
   `MAX_TICK_SKEW` in both directions"* — and **B1 corrected that comment**, which is text, not
   behaviour. Pinned by *"drops a command the validator accepted, because the skew limit is
   wider than the ring"*.

**Why B1 could not fix it.** Either fix changes which command survives, which is behaviour
(R1): narrowing the window to `RING / 2 - 1` drops a tick that is accepted today, and widening
the ring or narrowing `MAX_TICK_SKEW` changes what the wire admits — and `MAX_TICK_SKEW` lives
in `src/shared/net/Protocol.ts`, which is **A20's** file and outside B1's fence (R3). The two
pinning tests carry `// Pins current behaviour; suspected bug:`, so fixing either means
rewriting its case in the same commit, with the reason.

### #24 — `Range` ignores the harness clock override · `open` *(opened 2026-10-12 by A14)*
**Files** `src/shared/modes/Range.ts`. **Origin** A14.

`Range.onRoundStart` seeds its clock with `Math.round(config.timeLimitSeconds / DT)` where the
other five modes call the inherited `this.roundTicks(...)` — the single place
`ModeDeps.roundSecondsOverride` is read. So the range is the one mode a harness cannot shorten,
which is the opposite of what that field's own documentation promises: *"Both are overridden from
this one value, so they cannot be shortened apart. A harness that shortened only `MatchFlow`'s
clock got a HUD that hit zero and a match that carried on for another nine minutes."* That is
exactly what a shortened range run gets. `docs/archive/plan/15-m10.5-tier-1-fixes.md` line 65
already noted it in passing, so it is long-standing.

The fix is almost certainly the one line, but it changes behaviour for any harness run that
shortens the range, so A14 pinned it instead. Pinned by `Range.test.ts`, "ignores the harness clock
override, unlike every other mode", which carries the `// Pins current behaviour; suspected bug:`
comment — **fixing the code means rewriting that case in the same commit, with the reason.** Check
first whether any harness depends on the range being un-shortenable.

---

## 5b. Field reports from play — the same kind of bug, with no test holding it

Reported by the user on 2026-10-19, from **playing the game** rather than from writing a
characterization test. That is the difference from §5: none of these is pinned, so no test records
what happens today and no oracle will notice when it changes. All three are client-side and all
three land in division C files, so each is bound to the unit that owns them (§1) and is done under
that unit's approval, not here.

### #33 — A killed target dummy leaves its bullet holes hanging in the air · `bound to C11`
**Files** `src/client/combat/TargetDummy.ts`; `src/client/engine/Decals.ts` / `Fx.ts` (C4) only if
the clear needs an API they do not have. **Origin** reported from play, 2026-10-19.

Shoot a dummy until it dies and the holes stay where they were with nothing behind them.
`TargetDummy.decals` reasoned about exactly this once, and only half way: it allows holes on
`static` and `infinite` dummies as "the two that never move", and refuses them on `strafe`, `popup`
and `faller` because `DecalField` places a mark in **world** space, so a hole punched in a moving
target slides off it and reads as a miss hanging in mid-air. What the getter did not consider is
that a dummy which never moves while *alive* still moves — or vanishes — when it **dies**:
`updateVisual` sets `body.visible = false` on the frame health reaches zero, so a `static` dummy's
mesh is gone and its world-space holes are not. `infinite` never dies, which leaves `static` as the
one that reproduces; a `faller` tipping flat is the same picture for whoever re-enables its holes
later.

Note what this is **not**: the decal veto (`combat/BodyVolume` through `ClientMatch.insideBody`) is
the veto for *drawn bodies* — players and bots — and dummies were never in it. `Ballistics` gates
a dummy's impact on `Damageable.decals` instead, in one line (`Ballistics.ts:446`), and that gate
does what it says. The defect is that nothing clears the marks afterwards.

The fix is to drop a dummy's own decals when it dies, and again when it respawns — which needs
`Decals`/`Fx` to be able to forget the marks placed on *one* target rather than all of them, an API
they do not have today. **Decide inside C11** whether a per-target owner on a decal is worth it, or
whether the cheap answer is to take `static` out of `TargetDummy.decals` and lose the holes on the
range altogether.

### #34 — The camera trembles while walking the arena · `bound to C2` · `needs reproduction`
**Files** most likely `src/client/engine/CameraRig.ts` and `FrameLoop.ts` (C2); `CameraConfig.ts`
and `CameraShake.ts` (C1, already completed) are the other candidates. **Origin** reported from
play, 2026-10-19.

Walking freely around the arena the view shakes slightly — small, continuous, and **local**: it is
there with no server in the picture, so it is none of the remote-pose work f5d1e72 and df7d87b
closed. Nothing is diagnosed and nothing is measured yet. Three candidates are worth separating
first, because each wants a different fix:

1. **The render-pass alpha.** A camera that reads the *simulation* pose on a frame that is not a
   tick boundary gets a sawtooth at the beat between the frame rate and `DT` — the same class of
   defect `MapRender.ts:429` records for props that "jitter and shake as you approach them".
2. **A curve on the wrong clock.** Sway or landing shake advanced per *frame* instead of per `DT`
   trembles at exactly the rate the frame time varies.
3. **Float precision.** `Renderer.ts:125` already discusses this for ordinary combat range and says
   twenty-four bits is two orders short; a camera far from the origin is where that shows.

**C2 reproduces it with the frame stats up before it changes anything.** A trembling camera is the
one defect a refactor can silently "fix" by reordering two assignments, after which nobody knows
which of the three it was.

### #35 — The arsenal's viewmodels are fetched on demand, so a grey primitive stands in · `bound to C23` · `needs a decision from the user`
**Files** `src/client/Game.ts` — `warmWeaponAssets` and `warmWorldAssets`. The service itself,
`src/client/weapons/WeaponAssetService.ts` (C9), already has every loader this needs. **Origin**
reported from play, 2026-10-19.

Land on a weapon in the Create Class editor, or carry a class edited between spawns into a match,
and the grey primitive fallback stands in for as long as the file takes to arrive.
`Game.warmWeaponAssets` warms **only the two equipped weapons'** full templates — its own doc
comment says so and gives the reason — while `warmWorldAssets` warms the whole arsenal at *LOD*
detail, the quarter-sized file a body carries, about nine megabytes for the fifteen. Nothing warms
the arsenal's **viewmodels**, so the editor and the preview ask per weapon as the player reaches it
(`LoadoutEditor.ts:999`, `WeaponPreview.ts:245`), and that request is what the grey is waiting on.

The request is a global asynchronous preload at boot, so the weapons are already in memory. The
mechanism exists — `warmWorldAssets` is that loop for the LODs — so the edit is a few lines, and
the cost is the whole question: a full template is roughly four times an LOD, so warming the
arsenal is tens of megabytes fetched on a connection that may not want them, against cache headers
that keep them for a version. **Decide**: warm the whole arsenal at boot; warm it behind the menu
once the equipped class is ready, which is the middle answer and costs nothing at the moment the
player presses Play; or leave it on demand and spend the fix on a placeholder better than a grey
primitive.

---

## 6. Documentation and housekeeping

### #43 — The harness's "background build" warning tells you to set a variable that is already set · `open` *(opened 2026-10-19)*
**Files** `src/server/skirmishHarness.ts` (~line 1451, the `background build` warning). **Origin**
the session that closed #40, on 2026-10-19.

Since #40, the NET oracle's run ends a match properly — the `post-match hold` line in the same
report now reads *"3 client(s) held, 3 migrated back; screen said 30.0/29.9/29.9s, actual
summary→arena 30022/30020/30022ms"*. The warning three lines above it still says *"the return to
the arena was NOT EXERCISED — no match ended in this run ... Shorten `MATCH_ROUND_SECONDS` to
reach it"*, which is now false twice over: a match did end, and the variable it asks for is set.
Its condition is presumably about the *next* cycle's background build, which `--cycles 1` cannot
reach — in which case the text should say so instead of naming a remedy that is already applied.

**Why the session that found it did not fix it.** It is in the harness, which §10 of
`REFACTOR-PROMPT.md` keeps out of scope for the whole programme. §6 now warns the reader to
expect that one line and ignore it.

### #42 — Three clients disagree with the server's final scoreboard, one run in five · `open` · *a fix is in place; the cause is still unconfirmed* *(opened 2026-10-19)*
**Files** `src/server/instance/MatchInstance.ts` (`sendScoreboard`) — B5's file; the check is
`src/server/skirmishHarness.ts`'s 4.3 comparison. **Origin** the session that closed #40.

The NET oracle reports, on an untouched tree, one run in five:

```
scoreboard: server ended with 10 row(s); 30 row(s) compared across 3 client(s), 6 mismatch(es)
            (must be 0); OP1 ... 2 off; OP2 ... 2 off; OP3 ... 2 off
ERR FLOW CHECK FAILED: 6 of 30 scoreboard row(s) on clients disagree with the server's final
                       rows (4.3)
```

**Two rows off on each of three clients, the same count on all three.** Four other runs clean.

## The mechanism, and what has been done about it

`sendScoreboard` sends a seat's board when `ScoreSystem.serial` moved, **rate-limited** to no
sooner than `SCOREBOARD_MIN_TICKS` (15 ticks, 250 ms) and resent anyway every
`SCOREBOARD_KEEPALIVE_TICKS` (120). There is exactly **one** forced pass at the end of a match —
`step`'s `ending = state === RUNNING && match.isOver` — and `LiveMatch` is careful to order its
move to `ENDED` after it, *"so this must move to `ENDED` only **after** `super.step` has had its
chance to send"*. The rate limit overruled that forced pass: a seat whose last board was under
250 ms old was skipped, and from that tick the instance is `ENDED`, so no later pass exists. The
client then holds a board missing the last change for the whole summary hold — and the last
change is the kill that *ended* the match, which is two rows: the killer's kills and the victim's
deaths. That is the reported signature exactly.

**`ending` now waives the rate limit** (not `changed`: a seat already holding the final serial is
sent nothing). That is right on its own terms whatever causes #42 — a deliberately forced pass
that a rate limit can silently overrule is a bug in intent — and it is committed.

## Why this entry is still open

**The fix has not been shown to remove #42.** Three NET runs after it are clean, which at a
one-in-five base rate is weak (0.8³ ≈ 51% of seeing nothing even unfixed), and the experiment
meant to settle it **failed to reproduce the defect at all**: with `SCOREBOARD_MIN_TICKS` widened
to 600 ticks and the fix's clause removed, the run still reported `0 mismatch(es)`.

The reason that experiment could not work is itself the next clue. Every harness match ends on
**TIME** — `MATCH_ROUND_SECONDS=150` guarantees it — and a timed ending usually has no kill in
its final seconds, so `changed` is already false at the forced pass and there is nothing for the
rate limit to skip. #42's trigger needs a match that ends **on a kill**, with that kill inside
the window. No environment knob sets a score limit (`Config.ts` has `MATCH_ROUND_SECONDS` and no
score cap), so reaching it needs a code-level change to the mode's limit — which is why this was
not settled here.

**To settle it**: run the flow check against a mode whose score limit a kill can reach inside the
run, and compare the 4.3 line with the fix and without it. If the defect reproduces and the fix
clears it, delete this entry. If it reproduces *with* the fix, the cause is elsewhere and the
first place to look is whether `ScoreSystem.serial` moves after the forced pass at all — the
other candidate is the harness comparing the client's last board against rows copied at a later
instant, which would make the check unsound rather than the server wrong.

Until then the decision of 2026-10-19 stands: a unit that meets this red line re-runs the NET
snapshot once, says so in its report, and carries on.

**Since B5 (2026-10-20) the four rules are pinned by tests, and the code has moved.**
`sendScoreboard` is now `SeatChannels.sendScoreboard` and the decision itself is
`SeatChannels.isBoardDue`; `src/server/instance/MatchInstance.test.ts` pins changed,
rate-limited, keepalive, *and* that `ending` waives the rate limit but not `changed` — the last
two by running a seeded match to the tick its win condition fires and asserting that the board
went out on that tick with the previous one younger than `SCOREBOARD_MIN_TICKS`. That is the
fix's own behaviour held in place; it still is not evidence that the fix removes #42, which
needs the match that ends **on a kill** described above.

### #4 — Fix the false comment about the ammo stations in the `props.ts` generator · `open`
**Files** the script that generates `src/shared/world/maps/props.ts` (find it under `scripts/`).
**Origin** A3b. A comment in the generator states something untrue about the ammo stations, which
misleads anyone reading the generated file. The generated values themselves are never edited (R9) —
only the comment.

### #7 — Move the misplaced JSDoc in `MapLoader.ts` · `open`
**Files** `src/shared/world/MapLoader.ts` (~lines 44–49). **Origin** A4 — the defect was introduced
during that unit. `loadMapCollision`'s JSDoc ended up above `shareMapCollision`, so
`loadMapCollision` is undocumented and the reader gets the wrong description for the function
below. Move it back.

### #22 — Extend the M9 maths table to the engines the project actually runs on · `open` *(opened 2026-10-12)*
**Files** `src/shared/core/SimMath.ts` (the table in its header), using
`src/shared/debug/Determinism.ts`.

The table in `SimMath.ts` measured `hypot`, `sqrt`, `exp`, `pow`, `atan2` and `log` as agreeing and
only `sin`/`cos` as differing — **between Node 24 (V8 13.6) and Chrome 148 (V8 14.x)**. On
2026-10-12 a Render build on **Node 22 (V8 12.4)** produced a one-ULP difference in
`MapLuminance`'s `Math.pow`/`Math.hypot` path, which that table never covered. So the "same" row is
version-scoped and the header does not say so.

That finding was harmless — `MapLuminance` is an instrument, with `server/readability.ts` as its
only importer — but the **simulation** uses `Math.atan2` and `Math.hypot` on hot paths (`BotBrain`,
`Movement`, `Projectile`, `CombatBehaviour`), and its cross-runtime guarantee rests on this table.

**The instrument already exists:** `mathDigest()` sweeps 20,000 arguments through all ten functions
and `npm run hashes` prints the digests. Run it on Node 22 and on a browser build, diff the digests
against a Node 24 run, and write the result into the table with the engine versions named. If
`atan2` or `hypot` differ on an engine a player might run, that is a real finding of the same class
`simSin`/`simCos` were written for; if they agree, the table gets the scope note it is missing.

**Also record there** that a SIM snapshot/compare pair is only meaningful on **one machine and one
Node build** — the state hashes depend on these functions — and that `npm run readability` is
immune, because its figures go through `toFixed(3)`/`toFixed(4)`.

---

## 6b. Duplication that spans units — opened by A16

### #36 — One ring index, written twice in one unit · `open` *(opened 2026-10-19 by B1)*
**Files** `src/server/net/InputBuffer.ts` (`slotIndex`) and `src/server/net/RigHistory.ts`
(`index`). **Origin** B1.

The same wrap-safe expression, `((tick % SIZE) + SIZE) % SIZE`, with a different constant: 128
ticks of commands and 60 ticks of rig history. B1 removed the *within-file* duplication —
`InputBuffer` had it inline twice — so what is left is two one-line functions that differ only
in their modulus, and a shared `ringIndex(tick, size)` would be the honest form.

**Why B1 could not do it.** There is no home for it inside the fence. A new file needs a
**design** unit (R3) and B1 is not one; exporting one file's helper for the other to import adds
a public export (R2) and points `RigHistory` at `InputBuffer` or the reverse, which is a
dependency between two modules that share nothing else. The natural home is a shared ring helper
in `src/shared/core/`, which is **A1**'s territory. Worth doing with #37, which has the same
shape and the same destination.

### #37 — `InputBuffer.blank()` is a second `makeCommand()` · `open` *(opened 2026-10-19 by B1)*
**Files** `src/server/net/InputBuffer.ts` (`blank`) and `src/shared/core/InputCommand.ts`
(`makeCommand`, not exported). **Origin** B1.

Both build the same eight-field zero command, and `InputCommand.ts` already has one for
`CommandRing`'s backing store. A field added to `MutableInputCommand` has to be remembered in
two places, in two partitions.

**Why B1 could not do it.** `makeCommand` is private to `InputCommand.ts` and exporting it is an
API change in **A1**'s file, outside B1's fence (R2, R3). The edit is one export and one import,
but it belongs to whoever owns that file.

### #26 — Unify the downward ground probe · `open` *(opened 2026-10-12 by A16)*

**Files** `src/shared/streaks/CarePackage.ts` (`probeGround`), `src/shared/streaks/MortarStrike.ts`
(`groundAt`), plus a home for one helper — `src/shared/world/CollisionWorld.ts` or
`src/shared/world/Geometry.ts`. **Origin** A16.

Two functions in the same unit cast the same ray straight down to find the floor under a point, and
differ only in where they start and how far they look: `probeGround` from `packageDropHeight + 12`
for `from + 8` metres and allocating a `RayHit` per call (it runs once, at activation);
`groundAt` from a hard 40 for `from + 10` and reading a module-level scratch ray (it runs once per
shell, on the sim path). Both answer "where is the floor here" and both return 0 on a miss.

**Why A16 did not merge them.** A helper shared by two files in the unit has nowhere to live:
R3 forbids a new source file outside a design unit, and putting it in one of the two and importing
it from the other means adding a public export — an API change under R2 that would have to be
approved for a helper whose real home is neither file. The right home is `world/`, where the
raycaster is, and the right scope is wider than this unit: the same probe pattern recurs across the
project, which is exactly the cross-unit duplication R4.3 sends here.

**While there**: decide whether the two start heights and ranges are two facts or one. They are
unlikely to be one — a crate is placed from above the drop height and a blast is placed on the
floor under an impact — so the helper probably takes them as parameters rather than hiding them.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`. `CarePackage.test.ts` and
`MortarStrike.test.ts` (both A16) pin the landing height and the impact height respectively.

### #27 — Unify the streak shot pipeline · `open` *(opened 2026-10-12 by A16)*

**Files** `src/shared/streaks/SentryGun.ts` (`stepFiring`), `src/shared/streaks/ChopperGunner.ts`
(`stepFiring`), reading `src/shared/weapons/Ballistics.ts`. **Origin** A16.

The two machine guns fire by the same six steps in the same order: turn `yaw`/`pitch` into a
direction, count the shot, announce it, point the shared `DamageRequest` at the streak's weapon
def, call `ballistics.fire`, draw a tracer, then read `hitTarget`/`lethal` off the trace into
counters. The direction triple is identical character for character —

```
const cp = simCos(pitch);
const dx = -simSin(yaw) * cp;
const dy = simSin(pitch);
const dz = -simCos(yaw) * cp;
```

— and the same four lines appear again in `shared/weapons/`. The hit-rate line in the two
`describe()` methods is the same expression as well.

**Why A16 did not merge them.** Same fence as #26: one helper for two files in the unit needs a
home that is not either of them, and the direction triple's real home is `core/SimMath` or
`weapons/Ballistics`, both outside A16. It is also the one merge in this unit where **R5 bites**:
the four lines must stay in that order, with those signs and that `cp` factored out exactly as it
is, because `simSin`/`simCos` and the multiplication order are what make a shot land in the same
place on two engines. A helper is fine; re-deriving the maths inside it is not.

**Do not merge the surrounding method.** The two differ in what gates the trigger — a sentry asks
`combat.wantsFire` and a chopper asks the spin and the belt — and in what they count
(`killsOnOwnSubstrate` is the sentry's alone). Those change for different reasons, so R4.3's second
rule applies: the direction triple and perhaps the trace read-out are the shared parts, and the
methods around them are not.

**Verify** `npm run check` + SIM snapshot/compare → `PASS` — the 3,600-tick hash is what proves a
round still goes where it went. `SentryGun.test.ts` and `ChopperGunner.test.ts` (both A16) pin the
shot counters, the eye height a sentry fires from and the chopper's belt.

### #28 — Settle the "six killstreaks" the comments still describe · `open` *(opened 2026-10-13 by A17)*

**Files** `src/shared/streaks/StreakDefs.ts` (the file overview), `src/shared/streaks/StreakSystem.ts`
(the class comment), and any other `streaks/` comment that counts them. **Origin** A17.

There are **nine** streaks — the six of M7 plus the minigun, the flamethrower and the riot shield
of F16 — and several comments still say six. `StreakDefs.ts` opens with *"The six killstreaks, as
data"*, and `StreakSystem`'s class comment says *"which `StreakDef.effectEnds` names for each of
the six"* and *"activate/function/expire for all six"*.

**Why A17 did not just change the number.** Some of them are not arithmetic, they are history, and
a mechanical find-and-replace would make a true sentence false. The clearest case is in
`StreakSystem`:

> *"six shipped streaks against three keys **meant** a player who reached twelve kills **held** six
> things"*

That is a statement about the state of the game at playtest round 4, when there really were six,
and it is the reason the equipped-streaks filter exists. Changing it to nine would misdate the
decision it records. The same question has to be asked of each one: is this sentence counting the
streaks *now*, or recording what was true when something was decided?

So it is a read of every occurrence with a judgement per occurrence, which is a different kind of
work from a refactor unit and does not belong inside one.

**Do while there:** `grep -rn "six" src/shared/streaks/` is the whole corpus, and the same sweep is
worth running for "three keys" and "all six" across `src/client/ui/` and `docs/`, where the HUD's
strip and the acceptance criteria may count them too.

**Verify** `npm run check`. Comments only, so the oracles cannot move; if they do, something other
than a comment changed.

---

### #29 — A reverted weapon keeps its camo for one pass · `open` *(opened 2026-10-14 by A19)*

**Files** `src/shared/meta/Unlocks.ts` (`revertLockedWeapon`, extracted from `sanitiseLoadout` by
A19). **Origin** A19, found by a characterization test. **Pinned**, not fixed — see
`Unlocks.test.ts`, *"takes two passes to clear a camo off a weapon it reverted"*.

`sanitiseLoadout` reverts a locked weapon to the fallback and clears its attachments, because
they were earned on the gun it is no longer holding. It then **returns**, so the camo check that
sits below it on the same path never runs. The result is that a save naming a locked weapon with
a camo on it comes back holding the carbine **and still wearing the camo** — a finish the account
never earned on the gun it is now on. A second `sanitiseLoadout` call clears it.

Measured, as the test records: pass one reports the weapon revert, pass two reports
`ASSAULT primary: camo "gold" not earned on ar_carbine; cleared`, pass three reports nothing.

**Why A19 did not fix it.** It is a behaviour change, and R1 forbids one inside a refactor unit.
It is also not obviously a one-line fix: clearing the camo on the revert path is the likely
answer, but *which* reversion message the player should see is a decision — one line about the
weapon, or two — and whether the camo line should appear at all when the gun it referred to is
gone. The attachments are cleared silently on that path today, which argues the camo should be
too.

**How much it matters.** Acceptance criterion 5 says editing `localStorage` cannot put a locked
item in the player's hands, and a camo is an item. Whether a player ever sees it depends on how
many times the load path sanitises before drawing — worth checking `client/meta/Profile`'s
`sanitiseAll` while fixing, because if it already runs twice the leak never surfaces and the
entry can be closed as a tidy-up rather than a defect.

**Verify** `npm run check` + SIM snapshot/compare. The oracles cannot see this — no oracle loads
a hand-edited save — so the test above is the proof, and it will need its expectation inverted
when the behaviour changes, which is the one case where changing a pinned assertion is correct.

### #30 — `equipmentIndexOf` has no caller left · `open` · *(opened 2026-10-14 by A20, rewritten by B5 on 2026-10-20)*

**Files** `src/shared/net/Snapshot.ts` (`equipmentIndexOf`, `equipmentIdAt`). **Origin** A20.

As opened, this asked for `equipmentIndexOf(id)` — `ALL_EQUIPMENT.findIndex((def) => def.id === id)`,
a closure per call on a path that runs per player per snapshot — to be given the table the weapon
side already has, and it bound the **call site** to B5 because that call site was
`MatchInstance`'s `writePlayer`.

**B5 did the call site and nothing else.** `server/instance/SnapshotRecords.ts` already built
`EQUIPMENT_INDEX` for the projectile channel, so one file held two ways to turn an equipment id
into its wire index; §4.3 says merge that inside the unit, which it did. `writePlayer` now reads
the map (`heldEquipmentIndex`: `null` → 255, a miss → 255, the same indices because both are
`ALL_EQUIPMENT` in order), and the SIM and NET oracles were byte-identical across the change.

**What is left is a different question.** `equipmentIndexOf` now has **no production caller at
all** — `grep -rn "equipmentIndexOf" src/` reaches `Snapshot.ts` itself and `Snapshot.test.ts`,
which pins every index both ways. So the choice is no longer "give it a table":

1. delete it and let `Snapshot.test.ts` assert the indices through `equipmentIdAt` alone — but
   the test's *"names every piece of equipment and nothing else"* is the only guard that the
   wire order of `ALL_EQUIPMENT` has not moved, and it reads it in both directions deliberately;
2. keep it as the decode side's inverse and give it the `Map` anyway, so the two directions are
   one table rather than a table and a scan;
3. keep it exactly as it is and note on it that it is the test's half of the pair, so the next
   reader does not re-measure a closure that nothing on a hot path calls.

(2) is the smallest change that leaves no scan anywhere, and (3) costs nothing; either is
defensible and all three are better than the current silence. `Snapshot.ts` is A20's file and
in the `check:style` ratchet, so this needs a session of its own either way.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`, plus `Snapshot.test.ts`'s *"names
every piece of equipment and nothing else"*.

### #50 — Five references to members that moved out of `MatchInstance` · `open` *(opened 2026-10-20 by B5)*

**Files** `src/server/net/Session.ts:634`, `src/server/Router.ts:15`,
`docs/VISIBILITY.md:37` and `:323`, `src/client/MatchWorld.ts:795`. **Origin** B5.

B5 split `MatchInstance.ts` into four files, and four comments elsewhere still name the old
address:

- `Session.ts:634` — *"See `MatchInstance.sendScoreboard` for when."* → `SeatChannels.sendScoreboard`.
- `Router.ts:15` — *"`MatchInstance.seats` holds the *seat* (the entity, the encoder)"* → the
  field is `roster`, a `SeatRoster`, and what it holds per seat is now one `SeatSlot` rather than
  an entry in each of seven maps.
- `VISIBILITY.md:37` — `MatchInstance.sendStreaks` → `SeatChannels.sendStreaks`.
- `VISIBILITY.md:323` — `MatchInstance.sendBomb` → `SeatChannels.sendBomb`.
- `src/client/MatchWorld.ts:795` — *"The mirror of the server's own lookup in `MatchInstance`"*,
  on the client's streak-index table. That lookup is `SnapshotRecords.streakKindIndex` now.
  Found by B6 on 2026-10-24 while checking its own split for the same defect; B5 missed it
  because it grepped for `MatchInstance.<member>` and this one names the file alone.

Everything else that names a member still names one: `buildEntities`, `sendSnapshots`, `step`,
`seat`, `unseat`, `releaseEntity` and `isArena` all stayed, and `writePlayer`, `writeBot` and
`describeStreak` kept their names in `SnapshotRecords.ts`, so the comments in `NetPlayer.ts`,
`Session.ts:954` and `CarriedWeapon.ts` are still correct.

**Why B5 could not do it.** `Session.ts` is B3's file and in the `check:style` ratchet, `docs/`
is out of scope for the whole programme (§10), and R3 fences a unit to its own files. The
`Router.ts` line is **bound to B8**, which owns that file and has not run yet; the other three
need a session of their own, as #32 and #48 did.

**Verify** reading. No oracle sees a comment.

### #51 — Three references to `ServerMatch.stepThrowers`, which is now `MatchThrows`' · `open` *(opened 2026-10-24 by B6)*

**Files** `src/server/NetPlayer.ts:103`, `src/server/NetPlayer.test.ts:90`, `PLAN.md:1633`.
**Origin** B6.

B6 moved the grenade hands out of `Match.ts` into `server/MatchThrows.ts`, and three comments
name the old address:

- `NetPlayer.ts:103` — *"Written by `ServerMatch.stepThrowers` from the one authority on it,
  the thrower's `busy`"*, on the `handBusy` field. Still true about *what* writes it; wrong
  about where that lives.
- `NetPlayer.test.ts:90` — the same sentence in the test that pins the field.
- `PLAN.md:1633` — *"`ServerMatch.stepThrowers`, is what keeps a muzzle flash off a man holding
  a grenade."*

Everything else still names something that exists: `stepMelee`, `step`, `addPlayer`,
`removePlayer`, `setPendingLoadout`, `applyPendingLoadoutNow`, `perksOf` and `loadoutOf` all
stayed on `ServerMatch`, so `HeadlessClient.ts:206` and `:1534` are **correct** and are named
here only so that the next reader does not "fix" them.

**Why B6 could not do it.** `NetPlayer.ts` and its test are B8's files, and `PLAN.md` is a root
document §10 keeps out of the whole programme. One reading session, no behaviour. The
`NetPlayer.ts` half is **bound to B8**, which owns that file and has not run yet.

**Verify** reading. No oracle sees a comment.

### The missing item
The chat list was counted as 24 and this file received 22 of them. Neither #19 (folded into #2) nor
#23 (closed by A13) is the gap: both are accounted for. The likely candidates are a task recorded
during **A2** (`shared/cheats`, `shared/ui`) or **A7** (`shared/weapons`) — the only two units with
no entry here at all. If one of those rings true, re-add it with its unit and its reason.

---

## 7. Rules for working this list

1. **A task bound to a unit is done in that unit**, under that unit's plan and approval, and
   removed from here in the same commit.
2. **An unbound task gets its own session.** That session is not a refactor unit: R3's fence does
   not apply, and where the task says so it may change behaviour — but then the oracle difference
   must be explained and re-baselined deliberately, never silently.
3. **Nothing here is started without the user's approval**, and the entries marked
   `needs a decision from the user` cannot be started at all until that decision is made.
4. **`needs measurement` means measure before deciding.** "Measured, left alone" is a perfectly
   good outcome and should be recorded in the commit.
5. When a task is finished, delete its entry and name it in the commit body, so git keeps the
   record of why it existed.
