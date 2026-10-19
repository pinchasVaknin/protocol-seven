# PROTOCOL SEVEN — Side-task backlog (opened 2026-10-12)

> **Read this at Step 0 of every unit.** Section 7 of `REFACTOR-PROMPT.md` makes it binding: any
> task below whose files are the unit's files goes into that unit's Step 2 plan, named, and is
> done under the unit's approval rather than left here. The table in §1 is the lookup.

This is the record of everything the refactor programme found and deliberately did not do. Each
entry says **why it was not done in its unit**, because that reason is the expensive part — it is
usually a rule (R2 freezes the public surface, R3 fences the unit, R7 protects hot paths) or a
measurement nobody has taken yet.

**41 open entries.** #1–#21 came over from chat across units A1–A12, unedited in substance; #22
and #24 were opened since, **#26 and #27 by A16** on 2026-10-12, **#28 by A17** on 2026-10-13, **#29 by A19** on 2026-10-14, **#30 and #31 by A20** on the same day, **A21 none** and **#32 by A22** on 2026-10-14; **A23 closed #1's shared half** on 2026-10-17 and **A24 folded `IntroPlan`'s copy** on 2026-10-18, neither opening any. **#33, #34 and #35 are the user's own field reports**, filed on 2026-10-19 from playing the game rather than from writing a test; §5b holds them. **B1 opened #36–#41** on 2026-10-19, the first entries from division B, and **#40 was closed the same day** by the session that corrected §6's NET oracle — which opened **#42** and **#43** with the first findings that corrected oracle produced. **B2b opened #44–#46** on 2026-10-19, and **#44 was closed** on the same day by the session that cleared `lastImpactMaterial` per tick — whose own finding became **#47**, opened and closed on 2026-10-19 by the sixth oracle it asked for. Six numbers are gone and
are not reused: **#19** is folded into #2 (the same defect from both ends), **#23** was closed by
A13 and **#25** by A15, both on 2026-10-12, and **#40**, **#44** and **#47** on 2026-10-19.

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
| B3 | `server/net/` Session, WsServer | #31 (`wantsRewindDebug`, written and never read — B3 is the only unit allowed to touch it) |
| B5, B6 | `server/instance/`, `server/Match.ts` | #13 (`PLAYER_ENTITY_ID` importers) |
| B5 | `server/instance/MatchInstance.ts` | #30's call site (`equipmentIndexOf`, per player per snapshot) — the edit itself is A20's file, so fold in what can be done here and leave the rest |
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

### #13 — Move `PLAYER_ENTITY_ID` out of `DamageSystem` · `open` · also §1 for B5/B6

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

### #46 — `EventCollector`'s frame-overflow branch cannot be reached · `open` *(opened 2026-10-19 by B2b)* · *note, not a defect*
**Files** `src/server/net/EventCollector.ts` (`write`, `overflowNoted`). **Origin** B2b.

`write` has two ceilings and only one of them can bite. The count ceiling is
`MAX_TICK_EVENTS = 255`, and the biggest event is a `Fired` at about 24 bytes (nine `i16`s and
six bytes), so 255 of them is roughly 6 KiB against `MAX_SERVER_FRAME_BYTES = 8192`. **The frame
cannot overflow before the count refuses**, which makes `if (this.writer.overflowed)` and the
`open = false` it performs unreachable from the bus — and `overflowNoted`, which it is the only
writer of, write-only dead state as well (the same shape as #31 and #41).

Not a defect: it is a guard that is currently redundant, and a guard whose condition is
impossible is cheaper to keep than to re-derive. Worth a decision rather than a deletion,
because the two numbers are what make it redundant: raise `MAX_SERVER_FRAME_BYTES`'s consumers
or add a fatter event kind and it becomes live again. **Decide**: keep it with a comment saying
why it cannot fire today, or delete it and the field with it and let the count ceiling be the one
rule. `EventCollector.test.ts` records the arithmetic beside the ceiling's own case.

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

### #39 — `Rewind.end()` scans the roster instead of what it saved · `open` *(opened 2026-10-19 by B1)* · *not pinned: unreachable today*
**Files** `src/server/net/Rewind.ts`. **Origin** B1.

`begin` saves a snapshot per rewound entity into `this.saved` and `end` iterates
`this.entities` to put them back. An entity unregistered between the two would keep its
snapshot: it is never restored (harmless — the entity is gone) and never returned to `pool`,
which `saved.clear()` then drops, so the pool loses one object per occurrence. Iterating
`this.saved` would be both correct and cheaper, since it is exactly the set that was moved.

**Why B1 did not change it, and why no test pins it.** `begin` and `end` bracket one
synchronous `Ballistics` trace, so nothing can unregister in between and the defect is
unreachable from any caller that exists — a characterization test would have to call
`unregister` between them, which would pin a sequence the server never performs. Recorded here
instead, so the next reader of `end` does not have to re-derive that it is safe only by
accident of the call site.

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

### #41 — `RigHistory.newest` is written and never read · `open` *(opened 2026-10-19 by B1)*
**Files** `src/server/net/RigHistory.ts`. **Origin** B1.

`push` maintains it (`if (tick > this.newest) this.newest = tick;`) and `fill` sets it, and
**nothing anywhere reads it** — not the class, not `Rewind`, not the panels; `has` and `applyAt`
both work off the per-slot tick tag instead, which is what makes a stale slot detectable. The
same shape as #31, one file over: two assignments on the per-entity per-tick path keeping a
number for a reader that does not exist.

**Why B1 did not delete it.** It is a private field, so removing it is neither an API change
(R2) nor a behaviour change (R1) — but it was not in the unit's approved Step 2 plan, and
deleting a field on a hot path is exactly the kind of edit this programme does under an
approval rather than in passing. One line of deletion, one line out of `push` and one out of
`fill`, and the oracles should not move.

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

### #30 — Give `equipmentIndexOf` the table the weapons already have · `open` · *call site bound to B5* *(opened 2026-10-14 by A20)*

**Files** `src/shared/net/Snapshot.ts` (`equipmentIndexOf`), caller `src/server/instance/MatchInstance.ts:1060`.
**Origin** A20.

`equipmentIndexOf(id)` resolves a grenade to its wire index with `ALL_EQUIPMENT.findIndex((def) => def.id === id)`.
That allocates a closure per call, and the call is per player per snapshot — `MatchInstance` sets
`e.heldEquipment` on the send path, which is the hot path R7 names. The weapon side of the same
file already has the answer: `WIRE_WEAPON_IDS` is built once at load and `weaponIndexOf` walks it
with an index loop and no closure. One `ReadonlyMap<EquipmentId, number>` built beside it, or the
same index loop over an `EQUIPMENT_IDS` array, removes the allocation without touching a byte of
the wire — the order `ALL_EQUIPMENT` defines stays the order.

**Why A20 did not do it.** R7 on this programme is *"do no harm"*, not *"make it faster"*:
performance is a separate track, and this is an improvement rather than a repair of something the
unit broke. A20 therefore left the body exactly as it was. The measurement nobody has taken is
whether V8's escape analysis already elides the closure, which decides whether this is worth a
commit at all.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`, plus `Snapshot.test.ts`'s
*"names every piece of equipment and nothing else"*, which already pins every index both ways.

### #31 — `Session.wantsRewindDebug` is written and never read · `bound to B3` *(opened 2026-10-14 by A20)*

**Files** `src/server/net/Session.ts` (B3), reading `src/shared/net/UrlFlags.ts` and
`src/shared/net/NetClient.ts`. **Origin** A20.

The `?rewinddebug=1` chain is complete in every link but the last: the client appends `#rw` to its
name (`withRewindSuffix`), the server strips it and records the request (`readIncomingName` →
`Session.wantsRewindDebug`), and **nothing ever reads that field** — no message on the wire carries
a per-shot rewind feed, and `NetPanel` computes all three of its Rewind fields from the client's own
RTT. `UNDOCUMENTED_URL_KEYS` already says so in prose, which is how A20 found it; this entry is so
that the prose has a task behind it.

**Decide** one of three: build the feed the plumbing was laid for, delete the field and leave the
name convention (the `#rw` suffix is harmless and `UrlFlags` is tested), or leave it and keep the
note. A20 recommends the third until something wants the feed — the scaffolding is what it will be
built on, and the comment in `UrlFlags.ts` already carries the reason.

**Why A20 could not do it.** The field is in `server/net/Session.ts`, which belongs to **B3** and is
outside A20's fence (R3). A20 owns only the shared half of the convention, and that half is correct:
the suffix is stripped before the cap, which is the fix round 5 made.

**Verify** `npm run check` + SIM + NET. `UrlFlags.test.ts` (A20) pins both halves of the suffix
convention, including the eighteen-character callsign that the old ordering silently ignored.

### #32 — Three comments still name `NetClient.neutralise` · `open` *(opened 2026-10-14 by A22)*

**Files** `src/server/debug/HeadlessClient.ts`, lines 345, 913 and 2091. **Origin** A22.

A22 moved `neutralise` out of `NetClient` and into the new `CommandPipeline`, where the rest of
the command-shaping lives. Three comments in `HeadlessClient.ts` refer to it by its old home —
*"the bit as it survived `NetClient.neutralise`"*, *"`neutralise` zeroing `Btn.Scoreboard`"*, and
*"`NetClient.neutralise` — so holding it changes no prediction, no hit and no score"*. They
describe the rule correctly; only the owner's name has moved.

Nothing is broken: these are prose, not calls, and the B6 behaviour they document is pinned by
`NetClient.test.ts` (*"strips movement and actions while input is frozen, and keeps the view"*)
and by `CommandPipeline.neutralise`'s own JSDoc, which keeps the whole B6 paragraph.

**Why A22 could not do it.** `src/server/debug/` is out of scope for the whole refactor
programme (REFACTOR-PROMPT.md §10: the debug folders and the harnesses are the instruments), so
the unit that caused the drift is the one unit not allowed to fix it.

**The work**: change `NetClient.neutralise` to `CommandPipeline.neutralise` in those three
comments. No behaviour, no test, no oracle — `npm run check` is enough.

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
