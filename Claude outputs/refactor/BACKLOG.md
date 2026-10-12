# PROTOCOL SEVEN — Side-task backlog (opened 2026-10-12)

> **Read this at Step 0 of every unit.** Section 7 of `REFACTOR-PROMPT.md` makes it binding: any
> task below whose files are the unit's files goes into that unit's Step 2 plan, named, and is
> done under the unit's approval rather than left here. The table in §1 is the lookup.

This is the record of everything the refactor programme found and deliberately did not do. Each
entry says **why it was not done in its unit**, because that reason is the expensive part — it is
usually a rule (R2 freezes the public surface, R3 fences the unit, R7 protects hot paths) or a
measurement nobody has taken yet.

**21 open entries**, carried over from chat across units A1–A12 unedited in substance. Two numbers
are already gone and are not reused: **#19** is folded into #2 (the same defect from both ends),
and **#23** was closed by unit A13 on 2026-10-12. **#22** is the only one not from the chat list —
it was opened on 2026-10-12 from the Render build failure.

That accounts for 22 of the chat list's items against a count of 24, so **one item from the
original list is missing**; §6 records where to look for it.

Status values: `open`, `bound to <unit>` (the next unit that owns these files — do it there),
`blocked on <task>`, `needs measurement`, `needs a decision from the user`.

---

## 1. Lookup by unit: what to fold in at Step 0

Find the unit you are about to start. If it is listed, those tasks are **in scope for that unit**
and belong in its Step 2 plan.

| Unit | Files | Tasks to fold in |
|---|---|---|
| ~~A13~~ | `shared/ai/BotDirector.ts` | **closed** — #23 was absorbed by A13 on 2026-10-12 |
| A14/A15 | `shared/modes/` | — |
| A16/A17 | `shared/streaks/` | #1 (`SentryGun` is a caller of `angleDelta`) |
| A20–A23 | `shared/net/` | #1 (`Interpolation` is a caller of `shortestAngle`) |
| B5, B6 | `server/instance/`, `server/Match.ts` | #13 (`PLAYER_ENTITY_ID` importers) |
| C1 | `client/cinematic/IntroCamera.ts` | #1 (local `angleDelta` copy) |
| C6 | `client/weapons/ViewmodelAnim.ts` | #1 (caller of `angleDelta`) |
| A24 | `shared/cinematic/IntroPlan.ts` | #1 (local `angleDelta` copy) |

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

### #1 — Retire the duplicate angle helper export · `needs a decision from the user`

**Files** `src/shared/core/MathUtil.ts` and every caller. **Origin** A1. **Touches four upcoming
units** — see §1.

`MathUtil` exports two names for one function: `angleDelta(from, to)` and
`shortestAngle(from, to)`. Before A1 their bodies were byte-identical, five lines each. The JSDoc
on `shortestAngle` argues it was moved out of `ai/Bot.ts` at M10 precisely so there would not be
two copies of an angle-wrapping helper that *"ends with one of them fixed and the other not"* —
while sitting directly below the other copy. A1 merged the bodies (`shortestAngle` now returns
`angleDelta(from, to)`) so they can no longer drift, and the SIM oracles confirmed bit-identical
output. What A1 could not do is remove the redundant export, because R2 freezes the public surface.

**Pick the name to keep.** `angleDelta` is the better one: `wrapAngle` already delegates to it and
`shortestAngle`'s range comment duplicates what `angleDelta` documents. `shortestAngle` is arguably
more descriptive at its call sites — **the user chooses.**

Callers of `shortestAngle`: `shared/net/Interpolation.ts` (`sample`, `extrapolate`),
`shared/ai/Bot.ts` (`renderYaw`). Callers of `angleDelta`: `shared/ai/CombatBehaviour.ts`
(`updateAim`, `lookToward`), `shared/streaks/SentryGun.ts` (`acquire`, `applyPose`),
`client/weapons/ViewmodelAnim.ts` (`updateSway`), and `wrapAngle` in `MathUtil` itself.
`client/cinematic/IntroCamera.ts` and `shared/cinematic/IntroPlan.ts` define their **own local
`angleDelta`** — decide whether those fold into the shared one.

Merge the two JSDoc blocks so the survivor keeps the history both carry, including the M10
provenance note. Both call sites are hot paths (per-entity per-tick), so the result must stay a
direct call to a primitive-in/primitive-out function. `MathUtil.test.ts` (A1) asserts the two agree
on a 15-row argument table — fold those rows into the survivor's tests rather than dropping them.

**Verify** `npm run check` + SIM snapshot/compare → `PASS`.

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

---

## 6. Documentation and housekeeping

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
