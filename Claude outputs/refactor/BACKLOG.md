# PROTOCOL SEVEN — Side-task backlog (opened 2026-10-12)

> **Read this at Step 0 of every unit.** Section 7 of `REFACTOR-PROMPT.md` makes it binding: any
> task below whose files are the unit's files goes into that unit's Step 2 plan, named, and is
> done under the unit's approval rather than left here. The table in §1 is the lookup.

This is the record of everything the refactor programme found and deliberately did not do. Each
entry says **why it was not done in its unit**, because that reason is the expensive part — it is
usually a rule (R2 freezes the public surface, R3 fences the unit, R7 protects hot paths) or a
measurement nobody has taken yet.

**0 open entries** — #87 was the last and closed on 2026-11-23, the day it opened, so every heading in this file is now marked `closed`: §3 is empty, and the sequenced clusters it held — the collision core and the layering — are both done. (Counted, not remembered — and counted *both* ways, because counting the headings alone is how this line goes wrong: batch F's first attempt at it read the headings and forgot the clusters, exactly as an earlier reading had drifted eight low. **This line was itself stale until 2026-11-23**: it said four open and, in the same parenthesis, six in §9, and both numbers had been wrong since the evening #78 closed — which is the failure mode it warns about, committed by the warning. Batch A closed ten on 2026-11-17; batches B, C, D and E closed eight, six, five and three on 2026-11-21; batch F closed seven, batch G four, batch H three, batch I two, batch J two, batch K two, batch L two, the whole of Cluster I and #2 with #19 on 2026-11-22, which emptied §3; #77, #69, #63, #76, #85, #53, #22 and #42 on the same day; **#78 on 2026-11-22, and #79, #34 and #55 on 2026-11-23** — the last two by the user looking at them rather than by an edit, and neither fixed by anything here. and #87 on the same day it opened, once the reporter's note that it happened on the external server and not the local one ruled out everything a local match can do. Nothing is left; §9 says so and says what the two loose findings from #79 are.) #1–#21 came over from chat across units A1–A12, unedited in substance; #22
and #24 were opened since, **#26 and #27 by A16** on 2026-10-12, **#28 by A17** on 2026-10-13, **#29 by A19** on 2026-10-14, **#30 and #31 by A20** on the same day, **A21 none** and **#32 by A22** on 2026-10-14; **A23 closed #1's shared half** on 2026-10-17 and **A24 folded `IntroPlan`'s copy** on 2026-10-18, neither opening any. **#33, #34 and #35 are the user's own field reports**, filed on 2026-10-19 from playing the game rather than from writing a test; §5b holds them. **B1 opened #36–#41** on 2026-10-19, the first entries from division B, and **#40 was closed the same day** by the session that corrected §6's NET oracle — which opened **#42** and **#43** with the first findings that corrected oracle produced. **B3 closed #31 and opened #48** on 2026-10-19, and **B4 opened #49** the same day, having found
nothing bound to its own four files — and #49 was closed in the same sitting, in a commit of its own; **C1 folded #1's `IntroCamera` half** on 2026-10-25, under an approved behaviour change at one input, leaving the entry open against its last file, and **opened #54**; **B2b opened #44–#46** the same day, and **#44 was closed** on the same day by the session that cleared `lastImpactMaterial` per tick — whose own finding became **#47**, opened and closed on 2026-10-19 by the sixth oracle it asked for. Fourteen numbers are gone and
are not reused: **#19** is folded into #2 (the same defect from both ends), **#23** was closed by
A13 and **#25** by A15, both on 2026-10-12, and **#40**, **#44** and **#47** on 2026-10-19, with **#39**, **#41** and **#46** closed together the same day — the leaked snapshot, the write-only field and the guard that cannot fire, all three in files B1 and B2 had already finished and no later unit could touch — and **#31** by B3, in the one file it owned. **#32** and **#48** went together on 2026-10-19 — five comments naming two things that had moved or gone, in files §10 and R3 keep out of every unit's reach; #32's own count was one short, and the fourth was in `skirmishHarness.ts`. **#49** followed on
the same day: the arena's boot log and the README promised an `instant respawn` that playtest
round 4 had removed, and the fix needed a session outside the unit rules because R1 makes a log
line observable output. **B5 opened #50** on 2026-10-20 — four comments naming members that its
own split had moved — and **rewrote #30** rather than closing it: it absorbed the call site the
entry was bound to, which left the function with no production caller and turned the question
into whether it stays at all. **B6 declined #13 with the same reason B5 gave** — the move is in
a finished unit's files and reaches thirty files — and opened **#51**. **B7 opened #52** on
2026-10-25, the same shape again: four comments naming flow members its own split had moved,
three of them in the harness §10 keeps out of reach. **B8 opened #53** on 2026-10-25 from its
own Step 0: the NET oracle failed three different ways on an untouched tree when run behind the
SIM ones, and passed both times it was run alone. **C2 reproduced #34** on 2026-10-25 — the
first entry answered by measurement rather than by an edit — and left it open, rewritten with
its numbers and pointed somewhere else; it opened **#55** from its own BROWSER check. **C9 answered #56's watch-for on 2026-11-03** —
the first entry a later unit closed a question for rather than opening a new question — and the
answer made **#60**: the same shared-scratch slip, three times, in the file #56 pointed at. Its
tests opened **#61**, **#62** and **#63** as well, which makes C9 the unit that filed the most
and wrote none of the defects. **C11 answered #33's own question on 2026-11-05** and the answer
was *neither half, from inside a refactor unit*: the owner API is in C4's finished files and the
cheap alternative deletes what the range exists to read. It measured the orphaned window instead
— bounded at 2.5 s, on exactly one dummy of twelve — so #33 stays open, re-scoped to a session of
its own with a number in hand. C11 opened **#66** (which its own oracle found), **#67**, and
**#68**, the first entry about the test suite's own running time rather than about the game —
and **#68 was closed on 2026-11-07**, two days later, when it stopped being a warning and went
red on an untouched tree: the per-test timeout was a hang detector being used as a performance
budget, and it is now thirty seconds instead of five. The reasoning lives in `vitest.config.ts`,
beside the number.

**C16 opened #71, #72 and #73** on 2026-11-09 and **declined #35** with a reason rather than
leaving it silent: the entry names one of C16's files, but only as the call site, and the edit
it asks for is in `Game.ts`. That makes C16 the second unit after C11 to answer an entry it
could not do, and the third division-C unit in a row to find nothing bound to it at all.

**C17 opened #74, #75 and #76** on 2026-11-09, and is the first unit whose files turned out to
need **no browser-verified row at all** - there is no WebGL under the settings screen, the pause
screen or the palette, so the rebinding capture, which registers on `window` in the capture
phase, is driven by a test rather than described by one. #75 and #76 are both the same shape as
#69 and #72 before them: a comment that states a rule its own code does not keep.

**C18 opened #77** on 2026-11-09 — the second entry about the test suite's own running time
after #68, and the first opened by a *gate run* rather than by a unit's files. It is also the
first unit whose **live browser check could not be run at all**: the desktop window was hidden,
`requestAnimationFrame` never fired, and a match cannot reach its debrief without frames. The
dump oracle was unaffected, because it was written to need no frames — which is the lesson
worth keeping from this one. The live check **was** run on 2026-11-10, a day after the commit
that said it had not been, and it passed; the C18 row says what it covered. Nothing in it moved
the unit, so there is no re-baseline: it is a record, not a correction.

**C19 corrected #74 on 2026-11-10** and opened **#78** and **#79**. It is the first unit to find
that an entry it inherited had **miscounted its own evidence**: #74 said four files build the
same pager arrow and named `VoteOverlay.ts` as the fourth, and `VoteOverlay.ts` has no arrow.
The entry was written from C16's note about `optionsFor`, which both files do have, and the two
were conflated. Three copies, not four — and because they sit in three different units, the
moment #74 was waiting for (one unit owning two of them) will never arrive. That is now said in
the entry rather than left as a watch.

C19 is also the **second unit in the programme with nothing left browser-verified**, after C17,
and the first to say so after actually running the live check rather than instead of it: every
one of its eight surfaces builds and drives in node, there is no WebGL anywhere under it, and
the live run was for the things the browser *adds* — 36 Web Animations composited at once, a
`clientWidth` for `skullShift` to measure, a real `zoom` from `applyFrameScale`, and the build's
own version on the footer stamp where a test run sees `dev`.

**C20 opened #80, #81 and #82 on 2026-11-11.** It is the unit that owns the WebGL, and the
thing worth keeping from it is where that boundary actually fell: **two methods**, both named
`tick`, both failing on one line of a function that existed in two copies. Everything else in
the unit — fifteen public members across the two renderer classes, and all five small files —
runs in node. And a `tick` that throws on its last line has already done all of its work, so
the turntable, the fling's decay and the whole walk-in are measured in node through a frame
that never draws.

**#80 is the first entry in the programme opened by a number rather than by a reading.** The
weapon preview frames every weapon to the same bounding diagonal, and for five of the twelve
it does not: the test that was written to pin *0.62* found *0.612802* instead, and the five
that miss are the two SMGs, the two LMGs and one sniper. It is a tenth of a per cent of a
panel and it is wrong, and nothing but a characterization test would ever have looked.

**C21 opened #83 on 2026-11-14** and found nothing bound to its seven files. It is the unit
that owns the last of the client's match plumbing, and the entry it opened is the one kind this
programme keeps finding: a comment that states a rule its own code does not keep. `MatchMeta`
says of the Shooting Range that *"it simply never writes any of it"*, and the path it takes
writes all of it.

C21 is also the unit with the **largest single function the programme has reduced**: `subscribe`
at 111 lines and a cognitive complexity of 31, down to ten subscription lines and ten handlers.
The handlers are arrow-function **fields** rather than methods, because R7 owns that decision:
`WeaponFired` and `DamageDealt` arrive on every round fired in the match, and a field is
allocated once with the object where `this.onX.bind(this)` would allocate per subscription.
And it is the first unit to replace an `instanceof` chain under §4.4 with a registry that is a
`private static` field — which is also where its one real surprise came from: a static field
initialiser runs when the class is *defined*, so the `const` it read was still in its temporal
dead zone. The constant is above the class now, with a comment saying why.

**C22 closed the last client reference in #50 on 2026-11-15** and opened **#84**. It is the
one-file unit at the end of division C's match plumbing, and its whole subject was a single
function: a 198-line constructor at a cognitive complexity of 37 — the second largest the
programme has reduced — which built five collaborators and hung ten replication channels in one
body. It is **seventeen lines** now, and every one of them is a name. C22 is also the first unit
in the division to put a *constructor* under test rather than a screen: `ClientMatch`,
`DebugSuite`, `BotHarness` and `NetSession` are doubled and everything else is real — a real
scene, the real `loadMap`, the real `PlayerController`, the real `DivergenceChecker` — so its 51
tests assert the thing this file actually decides, which is what each collaborator is handed and
in what order.

That accounts for 22 of the chat list's items against a count of 24, so **one item from the
original list is missing**; §6 records where to look for it. (#22, #24, #26, #27, #28, #29, #30 and #31 were
opened by units since and are not from that list.)

Status values: `open`, `bound to <unit>` (the next unit that owns these files — do it there),
`blocked on <task>`, `needs measurement`, `needs a decision from the user`.

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
| ~~B7~~ | `server/Server.ts` + the three files it was split into | **closed** — nothing was bound to it: all 38 entries were read and none names `Server.ts`. B7 opened #52 |
| ~~B8~~ | `server/` Config, Loop, MapBakery, MatchAllocator, Migration, NetPlayer, NodeClock, Router, Spectator, log, serve | **closed** — #51's two `NetPlayer` references were absorbed; #13 was **declined a third time** (`Spectator.ts` imports the constant, but the move is in A9's `shared/combat` files and reaches thirty files); #52's `LiveMatch.ts` line is **not** a B8 file and stays. B8 opened #53 at Step 0 |
| ~~C1~~ | `client/input/`, `client/player/`, `client/perks/`, `client/cinematic/` | **closed** — C1 absorbed #1's `IntroCamera` half under its own approval: the local `angleDelta` is gone and the file is on `MathUtil.angleDelta`, which moves `d = -PI` from `-PI` to `+PI`. What is left of #1 is `ClientMatch.angleDeltaRad`, which is C24's. C1 opened #54 |
| ~~C2~~ | `client/engine/` BrowserClock, CameraRig, FrameLoop, GpuWarmup, MotionBlur, Renderer | **reproduction done, entry stays open** — C2 drove the real frame path with a clock it controlled and ruled out all three of #34's candidates *inside its own files*: the render-pass alpha tracks wall clock to 1.5e-11 ms under ±8 ms of jitter, the only layers integrated with `dt` move 0.0041° under a 6–36 ms clock disagreement, and one float32 ulp at 40 m is 4.8 µm against a 32 mm bob. #34 is rewritten with the numbers and re-pointed at the five things the reproduction could not cover — and, with the shadow tier the user then supplied, at the two earlier rounds that found this same symptom in the *simulation* both times. C2 noted `CameraRig.interpolatePhase` in #1 and opened #55 |
| ~~C3~~ | `client/engine/` AudioGraph, AudioMix, AudioSpecs, ProceduralAudio | **closed** — nothing was bound to its four files: no §1 row, no entry naming any of them, and the only hits for "audio", "sound" or "sfx" in this whole file are the words *unsound* and *sound baseline*. C3 opened #56, which its own characterization tests found |
| ~~C4~~ | `client/engine/` Decals, Fx, FxAssets, FlameFx, ProceduralTextures | **#33 declined with a reason** — its C4 half is conditional on a decision the entry says is **C11's** ("Decide inside C11 whether a per-target owner on a decal is worth it"), and C11 has not run; C4 cannot absorb half a task whose shape another unit has yet to choose, and building an unused API is what R2 refuses. C4 measured the cost of that API into #33 instead, so C11 can decide with a number. C4 noted `ProceduralTextures.smooth` in #54 and opened nothing |
| ~~C5~~ | `client/characters/` ActorAvatar, AnimationSelector, AnimationVariant, CharacterAnimator, CharacterAssetImport, CharacterAssetRepository, CharacterAssetService, CharacterAvatar, CharacterAvatarFactory, CharacterAvatarProvider, CharacterCatalog, CharacterSkin, RandomCharacterSelector, ThrowLayer, WeaponSupportHandConstraint | **closed** — nothing was bound to its fifteen files: no §1 row, and not one of the fifteen names, nor `client/characters`, appears anywhere in this file. The broader sweep is empty too — *animator*, *avatar*, *skinned*, *bind pose*, *mixamo* and *clip* have no hits at all, every *character* hit is the phrase “character for character” or “characterization test”, and every *rig* hit is inside *forbids*, *original* or *right*. C5 opened nothing: its 109 characterization tests found no behaviour worth an entry — the one surprise, a crouch edge whose `pendingLocomotion` is still the *old* settled loop, is `LOOP_SETTLE_SECONDS` working as written, and is pinned in both halves |
| ~~C6~~ | `client/weapons/ViewmodelAnim.ts` + the seven files it was split into | **closed** — nothing was bound to it: no §1 row, and *ViewmodelAnim*, *recoil*, *sway*, *charging handle* and *ViewmodelHands* have no hits anywhere in this file. #35 names viewmodels but is **C23's** and its edit is in `Game.ts`, outside R3's fence — declined with a reason. Every *bob* hit is #34's camera bob. **C6 opened #57**, which its own characterization tests found: the base matrix the arms are solved against is one shared scratch, and a grenade or a knife posed later in the frame overwrites it before the riot shield's glove reads it |
| ~~C7~~ | `client/weapons/` WeaponMesh, WeaponMeshParts + the five files they were split into | **closed** — nothing was bound to it: no §1 row, and *WeaponMesh*, *WeaponMeshParts*, *suppressor*, *silhouette*, *held weapon* and *BoxPart* have no hits anywhere in this file. Every *camo* hit is **#29**, whose file is `shared/meta/`'s `sanitiseLoadout` (A19's), and the two *attachment* hits are inside it. **C7 opened #58**: the canvas-and-texture helper here is the same one `engine/ProceduralTextures.ts` carries, and that file is C4's and already in the ratchet |
| ~~C8~~ | `client/weapons/` ViewmodelHands, HandPoses, KnifeMesh, GrenadeMesh, ShieldMesh, WeaponSilhouette | **closed** — nothing was bound to it: none of the six names appears anywhere in this file, and every *shield*, *grenade* and *arm* hit is inside #57 itself. **#57's watch-for is answered**: `ViewmodelHands` carries fourteen scratch objects and none of them escapes — `place` builds its result with `new THREE.Vector3()` and `new THREE.Quaternion()`, so the class does not have #57's defect. **C8 opened #59** |
| ~~C9~~ | `client/weapons/` WeaponAssetService, WeaponAssetCatalog, WeaponModelSpecs, WeaponAudio | **closed** — nothing was bound to it: no §1 row, and none of the four names appears anywhere in this file except **#35**, which is **C23's** and whose edit is in `Game.ts` (`warmWeaponAssets`), outside R3's fence — declined with a reason, and the entry already says the service "already has every loader this needs". What C9 did close is **#56's watch-for**: `WeaponAudio` has the shared-scratch defect C3 found, three times, and it is now **#60**. C9 also opened **#61**, **#62** and **#63**, all three found by its own 104 characterization tests |
| ~~C10~~ | `client/world/` MapBuildQueue, MapMesher, MapRender, MenuBackdrop, MenuSkirmish, Particulate, PropModels, SkyDome | **closed** — nothing was bound to it: no §1 row, and none of the eight names appears anywhere in this file except one parenthesis in #56 that says so itself — *"(The file is C9's, not C10's.)"*. The broader sweep is empty too: *particulate*, *dust*, *backdrop*, *mesher*, *map build*, *client/world*, *thumbnail* and *terrain* have no hits at all, every *sky* hit is #55's `SKY_LAYER` note, every *skirmish* hit is the NET harness, and every *prop* hit is #4's `props.ts` generator. **C10 opened #64 and #65**, both from its own 204 characterization tests and its own skeleton work |
| ~~C11~~ | `client/ai/` ActorIndicator, BotMesh, BotRenderer; `client/combat/` TargetDummy, TargetRange | **#33 declined with a reason** — the fix that keeps the range's holes needs per-target ownership on a decal, which lives in `engine/Decals.ts`/`Fx.ts`: **C4's files**, finished, in the `check:style` ratchet and outside R3's fence — exactly why C4 declined it too. The cheap half C11 *could* do inside its own file (drop `'static'` from `TargetDummy.decals`) is a behaviour change that deletes the holes from the four measurement targets and the DPS dummy, which is what the range exists to read. C11 measured the window instead (see #33, rewritten): it is bounded at `RESPAWN_SECONDS` = **2.5 s**, on exactly one dummy. C11 opened #66, #67 and #68 |
| ~~C12~~ | `client/equipment/` EquipmentAudio, EquipmentFx; `client/streaks/` ChopperCamera, ClientStreakPresentation, ReplicatedStreaks, SentryModel, StreakAudio, StreakMeshes, StreakRenderer; `client/meta/` CamoTextures, Profile, SaveStore | **closed** — nothing was bound to it: no §1 row, and none of the twelve names appears anywhere in this file except the three *watch-fors* aimed at it, and **C12 answered all three**. **#60**: of the two files it named, only `EquipmentAudio` has the defect — it writes the shared scratches and never sets `roll`, verified at runtime; `StreakAudio` holds its own specs and is clean, which is also the fix's shape. **#58**: confirmed, `CamoTextures` is the third copy. **#29**: answered, and not in the entry's favour — the load path sanitises **once**. C12 opened nothing: its 240 characterization tests found no new defect, and the two surprises they did find (`mortarInbound` whistles 18 m up, `SaveStore` hands an array to the migrator but not a number) are both working as written and are pinned in both halves |
| ~~C13~~ | `client/net/` BrowserLink, Handshake, JoinOptions, NetSession, RemoteActor, WakeWait | **closed** — nothing was bound to it: no §1 row, and none of the six names, nor `client/net`, appears anywhere in this file. The broader sweep is empty too — every *reconnect*, *socket*, *handshake*, *join*, *transport* and *latency* hit belongs to `shared/net` or to the NET harness, and the one *interpolat* hit is #34's camera bob. What C13 did close is the **fourth** copy of #1's unwrap: `RemoteActor.renderYaw` was the shared `angleDelta` character for character, so folding it was a bit-exact no-op rather than the behaviour question the other copies are (see #1, which stays bound to C24). C13 opened nothing: its 129 characterization tests found no new defect |
| ~~C14~~ | `client/ui/` Hud, HudBanner, HudStreaks, HudTactical | **closed** — nothing was bound to it: no §1 row, and none of the four names appears anywhere in this file. The broader sweep is empty too — *crosshair*, *banner*, *ammo*, *reticle*, *compass*, *threat*, *hit-direction*, *HudSurfaces* and *nameplate* have no hits that belong to these files, and the three *HUD* hits are #34's clock, #55's Chopper Gunner optic (C4 and C23's files) and #28. What C14 did close is **#28's `src/client/ui/` half**, which that entry asked a later unit to sweep: it is empty, and #28 now says so. C14 opened nothing: its 209 characterization tests found no new defect |
| ~~C15~~ | `client/ui/` MatchHud, Killfeed, Scoreboard, Minimap, MortarOverlay, BearingIndicator | **closed** — nothing was bound to it: no §1 row, and none of the six names appears anywhere in this file. Three words looked dangerous and all three belong elsewhere: every *scoreboard* hit is `shared/combat/ScoreSystem.ts` (Cluster III, A9's file) or `MatchInstance`/`SeatChannels` (#42, B5's); the *mortar* hit inside #1 is the place that entry's last copy is **used**, while the copy itself is `ClientMatch.angleDeltaRad` (C24's file); and a sweep of all six files for `PI`, `TAU` and `angleDelta` found no unwrap at all, only canvas arcs. **C15 opened #69 and #70**, both from its own 164 characterization tests |
| ~~C16~~ | `client/ui/` LoadoutEditor, LoadoutStats, QuickLoadout | **closed** — nothing was bound to it: no §1 row, and none of the three names appears anywhere in this file. Two entries name a C16 file and neither is C16's: **#35** points at `LoadoutEditor.ts:999` as the *call site* where a weapon's file is fetched on demand, but the edit it asks for is `Game.warmWeaponAssets` in `Game.ts` — C23's file, outside R3's fence — so C16 declined it with that reason and it stays bound where it is; **#28**'s `src/client/ui/` half was already closed by C14, and the only *six* in this directory is this screen's six category bars, which is a different six and a true one. The broader sweep is empty too: every *loadout* hit is `sanitiseLoadout` in `shared/meta/` (A19's files, #29) or `ServerMatch`'s `setPendingLoadout` (#42); every *camo* hit is one of those two or #58's `client/meta/CamoTextures.ts`, which C12 already answered; and *perk*, *streak*, *attachment* and *create-a-class* have no hit that belongs to these three files — the 34 *streak* hits are all the streak systems themselves. **C16 opened #71, #72 and #73**, all three from its own 219 characterization tests |
| ~~C17~~ | `client/ui/` Settings, Palette, PauseMenu | **closed** — nothing was bound to it: no §1 row, and none of the three names appears anywhere in this file. Five words looked dangerous and all five belong elsewhere: *binding* is the word in this file's own opening sentence; *sensitivity* and *shadow* are **#34**, whose mouse-path measurement and shadow-tier elimination are in C2's files; *volume* is `combat/BodyVolume`; and all five *slider* hits are the F1 debug panel's tuning sliders in `WeaponTuning.ts` (**#11**, A8's file) and the two voice sliders beside them — not one of them is a control on this screen. **C17 opened #74, #75 and #76**: the first from its own Step 0, the other two measured in the browser during its live check |
| ~~C18~~ | `client/ui/` EndOfMatch, XpSummary, ProfilePanel, PlayerCard | **closed** — nothing was bound to it: no §1 row, and none of the four names appears anywhere in this file. Twenty words were swept and five returned something, all of it elsewhere: *summary* is the summary→arena migration of **#42** and the NET harness's; *prestige* is `doPrestige` inside **#2**'s account of the save's load path; *challenge* is A18's file list; *skip* is a tick **#42** says was skipped. **`\bXP\b` returned nothing at all** — the sixty-nine case-insensitive hits were *xp* inside *expression* and *experiment*. **C18 opened #77**, from its own gate run rather than from its files. Its live BROWSER check was **run the next day, 2026-11-10**, once the desktop window was brought forward, and passed: a real solo match on FOUNDRY driven to its debrief, all seven phases, the FLIP's measured transform, three podium bodies rendered through a real WebGL context with their medals and stat cards, Tab both ways, Escape out, and the profile panel's three tabs reading the save the match had just banked — no console errors anywhere |
| ~~C19~~ | `client/ui/` Frame, ScreenChrome, LoadingScreen, SpaceSkip, Splash, PlaySolo, Menus, VoteOverlay | **closed** — one entry was bound to it, **#74**, whose own instruction was *"watch for C19, which owns the other two"*. C19 **corrected it**: there are three copies of the pager arrow, not four, because `VoteOverlay` has no pager and no arrow at all — its options are disabled `op-vote__option` buttons with a fill bar. So C19 owns **one** of the three, which is the one case the entry said would not settle it, and #74 stays open, re-scoped. Eighteen words were swept; every other hit is elsewhere (`vote` is B4's `VoteCycle` row, `the menu` is **#35**'s *"warm it behind the menu"*, and `chrome` is mostly **Chrome the browser** inside #34's mouse-path analysis). **C19 opened #78 and #79**, both duplication that spans the division |
| ~~C20~~ | `client/ui/` CharacterStage, WeaponPreview, Lineup, Emblem, CategoryIcons, WeaponIcons, FpsCounter | **closed** — one entry names a file of its: **#35**, which cites `WeaponPreview.ts:245`. The fix it asks for is in `Game.warmWeaponAssets`, outside this fence, so it stays `bound to C23`; the line moved to **336** when `show` came apart, and the entry now says so. Twenty words were swept and the rest is elsewhere: every *renderer* hit is the main one, *camo* is the finish table's, *skin* is the catalogue's, and *CharacterStage*, *Lineup*, *Emblem*, *CategoryIcons*, *WeaponIcons* and *FpsCounter* return nothing at all. **C20 opened #80, #81 and #82** — the first from a number its own tests measured, the second and third from running its own oracles |
| ~~C21~~ | `client/` MatchEquipment, MatchFeedback, MatchMeta, MatchObjectives, GameLoadout, GameScreens, main | **closed** — nothing was bound to it: no §1 row, and **none of the seven file names appears anywhere in this file** — not one, which no earlier unit could say of all of its files. Thirteen words were swept and every hit is somewhere else: all 37 *equipment* hits are `shared/equipment` (#13's `equipment.simulate` argument, #16's three body heights, #17, #18) or C12's `client/equipment/`; *objectives* is one hit, `ObjectiveStat` in #14/#15's scoreboard cluster; *bomb* is one, `MatchInstance.sendBomb` in #50's comment list; *feedback* is one, the English word inside #33; the 20 *loadout* hits are #71 and #72 in C16's finished editor and the `shared/meta/` rules; and `client/Match` finds only `MatchWorld.ts:795`, which is C22's file and not this unit's. **C21 opened #83**, from the one file in the unit that writes its rule down |
| ~~C22~~ | `client/MatchWorld.ts` | **closed** — **#50's fifth reference was absorbed**: `MatchWorld.ts:795` is this unit's own file and the one bullet of that entry no session had a fence for, so the client's streak-index table now names `SnapshotRecords.streakKindIndex`. Nothing else was bound: there was no §1 row, and *MatchWorld* has no other hit in this file outside #50 and C21's row above. Eleven words were swept and every hit is elsewhere — *Particulate* and *PropModels* are C10's row and **#64**'s pair of matrix freezes, *NetSession* is C13's row, *LocalIdentity* is **#13**'s `shared/combat` move, *loadMap* is **#7**'s misplaced JSDoc on `loadMapCollision` in A4's `MapLoader.ts`, every *station* hit is **#4**'s generator comment or #64, and all three *divergence* hits are the leg and arm figures in `HitboxDef`, not the checker this file owns; *prebuilt*, *BotHarness*, *DebugSuite* and *resupply* return nothing at all. **C22 opened #84**, from its own Step 1 |
| ~~C23~~ | `client/Game.ts` + `GameSession.ts`, `GameSurfaces.ts`, `GameFrame.ts` | **closed** — **#35 was absorbed** by C23b under its own approval, as a behaviour change: `warmArsenalViewmodels` warms the whole arsenal's full templates behind the equipped class, the grenades, the knife, the arms and the world's LODs, which is the middle of the three answers the entry offered. **#75 was answered and closed** — its premise is the browser pane's own `requestAnimationFrame` throttle and not the game; the measurement that replaces it is **#85**. **#83 was declined**: its `Game.ts:1148` half is one ternary, and the fix it points at is a *compute-but-do-not-bank* path in `MatchProgression.finish`, which is A19's file, in the ratchet and outside R3's fence — the same reason C21 could not do it. **#55 was declined**: this unit owns only the gunship pass's *call site*, which moved to `GameFrame.renderGunship` and still only picks the hot and cold groups; the fix is in `Renderer.ts`, C2's finished file. **C23 opened #85** |
| ~~C24~~ | `client/ClientMatch.ts` + `MatchArsenal.ts`, `MatchLife.ts`, `MatchStreakLedger.ts`, `MatchSurfaces.ts` | **closed** — **#1 was absorbed** by C24c under its own approval, as a behaviour change at one input: `ClientMatch.angleDeltaRad` is gone, the mortar overlay is on `MathUtil.angleDelta`, and `d = -PI` now answers `+PI` instead of `-PI`. Unlike C1’s half, this boundary **is** reachable through the public surface — `mortarOverlay.show()` does not write `overlayYaw`, so one `simulate` at `yaw = -PI` constructs it exactly — and `ClientMatch.test.ts` holds both the new answer and the direction the mark now travels. That was the fourth of #1’s five copies, and the entry **stays open, re-scoped**: the fifth is `CameraRig.interpolatePhase`, which is C2’s finished file and which no unit can now reach — C24 was the last one. **C24a opened #86**; C24b and C24c opened none |

Everything else below lands in a **completed** unit's files and therefore needs a session of its
own. Those sessions are not refactor units: they may change behaviour where the task says so, and
they are not fenced by R3.

## 5. Suspected bugs, pinned in tests, awaiting a fix

## 5b. Field reports from play — the same kind of bug, with no test holding it

Reported by the user on 2026-10-19, from **playing the game** rather than from writing a
characterization test. That is the difference from §5: none of these is pinned, so no test records
what happens today and no oracle will notice when it changes. All three are client-side and all
three land in division C files, so each is bound to the unit that owns them (§1) and is done under
that unit's approval, not here.

### #34 — The camera trembles while walking the arena · `closed` · *not reproducible on the reporter's own machine; nothing was fixed* *(rewritten 2026-10-25, extended and corrected 2026-10-26, by C2; closed 2026-11-23 by the reporter)*
**Files** **not** `src/client/engine/CameraRig.ts` or `FrameLoop.ts` — those are measured clean
below. The four places left to look are named at the end. **Origin** reported from play,
2026-10-19; reproduced and measured by C2 on 2026-10-25, on the clean tree before it edited
anything; the shadow tier it was played on was supplied by the user the same day, and a second
reproduction that day closed the two gaps the first one left. **C3 opened #56** on 2026-10-26,
found by its own characterization tests: the one caller in `ProceduralAudio` that fills the shared
scratch spec without setting every field it depends on. **C4 opened nothing** on 2026-10-26 and
declined #33 with a reason — its half is conditional on a choice the entry reserves for C11 — but
measured into that entry what the API it asks about would cost, so C11 decides with a number
rather than an impression.

Walking freely around the arena the view shakes slightly — small, continuous, and **local**: it is
there with no server in the picture, so it is none of the remote-pose work f5d1e72 and df7d87b
closed.

**How it was measured.** The browser pane cannot hold pointer lock and throttles
`requestAnimationFrame`, so neither a real clock nor real input was available. Instead the match
was driven through `__p7`: `loop.stop()`, `requestAnimationFrame` replaced with a no-op, and
`loop.frame(t)` called by hand with a timestamp chosen per frame. That is the real path —
`TickAccumulator.take` → the sim steps → `Game.draw` → `CameraRig.update` → the WebGL draw — with
the one variable under control, which is the only way to tell a timing defect from the bob itself.
The bots' input was frozen (`BotDirector.inputFrozen`) and every `brain.steer` stubbed so no shot
could raise `CameraShake.trauma`, and the subject walked a circle at 4.92 m/s to stay off walls.
Nine hundred frames per configuration. The full write-up, with the four experiment tables, is in
the session notes for C2.

**All three candidates are ruled out inside C2's files.**

1. **The render-pass alpha — ruled out by measurement.** The rendered simulation time
   `tau = (currentTick - 1 + alpha) * DT` tracked the injected wall-clock delta to a maximum error
   of **7.3e-12 ms** at uniform frame times, **1.5e-11 ms** at ±4 ms of jitter and **1.5e-11 ms**
   at ±8 ms. That is float noise, not a sawtooth, and it is analytic rather than lucky: `take`
   banks the whole elapsed interval and `alpha` is read *after* the steps run, so
   `tau = elapsed − DT` identically. There is a constant one-tick latency and no beat.
2. **A curve on the wrong clock — bounded three orders below visibility.** Of the layers
   `CameraRig.update` composes, only `roll`, `fov` and `dipPos` are integrated with `dt`; position,
   eye height and both bob offsets are pure functions of the alpha-interpolated snapshot and read
   no clock at all. `fov` and `dipPos` measured a residual of **exactly 0** while walking. In the
   adversarial run `performance.now` was left real, so `Game.draw`'s own `dt` ranged **6.2–35.6 ms**
   against an exact 16.667 ms frame delta — a wider disagreement between the two clocks than any
   real browser produces. The roll residual moved from 6.2e-5 to 7.1e-5 rad, which is
   **0.0041 degrees**.
3. **Float precision — ruled out by magnitude.** Within 40 m of the origin one float32 ulp is
   **4.8 µm**, three orders under `cfg.bobAmplitude` (32 mm). `Renderer.ts:125` is about
   *depth-buffer bits*, which is a different quantity from camera position.

**Two more things the entry did not name, measured clean as well.** `curr.grounded` is read raw
rather than interpolated and gates `bobAmount`, so a one-tick flicker would snap the bob 32 mm —
over 900 frames of walking it never flickered. And `interpolatePhase` would fold if `bobPhase`
advanced more than π in a tick; the maximum measured was **0.736 rad/tick** at 4.92 m/s (about
0.15 rad/tick per m/s), better than 2× headroom at any reachable speed.

**The user was playing on the `low` shadow tier** (answered 2026-10-25). That is worth less than
C2 first thought, and the correction matters: `biasScale` shipped on **2026-08-03** in `836cc02`,
more than two months *before* this report, and that commit's own measurement reads *"the low tier
was running half a texel of bias on every map, which is textbook acne. **1.05 texels at all three
tiers now, verified live.**"* So on bias, `low` was already no worse than `medium` or `high` when
this was played, and C2's first reading of `Renderer.ts:19–32` — which describes the state
**before** that fix — overstated it. What survives is thinner: `low` has `radiusScale: 0.6`, the
hardest shadow edge of any tier, over the fewest texels (1024), so whatever per-texel error is
left is sharpest there.

**Settle that in ten seconds before spending anything else.** Set shadows to `off` (which disables
the shadow map outright, not a smaller one) or to `high`, and say whether the trembling changes. It
is one setting, applied live, and it separates "the shadows shimmer" from "the camera moves"
completely. Nobody has run it for *this* report.

**This project has found this symptom twice before, and both times it was the simulation.** That is
the strongest signal on the entry and it points away from rendering:

- **Round 3** (`836cc02`, 2026-08-03) blamed `Movement.tryStepUp`: *"Pressed against a wall it ran
  three sweeps and took their result every tick, so the camera was re-seated every tick from a
  de-penetration chain that lands differently each time — a per-tick camera wobble, most visible on
  whatever is nearest."* It also ruled out z-fighting by measurement — 24-bit depth resolves
  0.050 mm at 10 m against the 1–2 cm a trim lip stands proud — which is an independent
  confirmation of candidate 3 above.
- **Round 4** (`docs/archive/plan/12-post-m8-round-4.md`, "the jitter, found") found the real one,
  and says the three rounds before it failed because none of them asked the first question:
  **"what does the camera do when the player is standing perfectly still?"** The answer was a
  5 mm vertical limit cycle at about 20 Hz — `collisionSkin` overshoot, gravity applied while
  grounded, `groundSnap` pulling back down, forever — which is 0.82° of pitch against a wall
  0.35 m away, *"which is why the report always said 'up close'"*.

C2's first reproduction answered neither question — it walked for all 900 frames, kept away from
walls on purpose, and ran on flat ground — so **both were measured in a second pass the same day**,
on the same tree, with the same harness. Full tables in the session notes
(`C2-backlog-34-round-two.md`).

**A — standing perfectly still, 600 ticks, zero input.** Round 4's own first question.

| `sim.y` distinct values | `sim.vy` | `grounded` | `steppedUp` | camera `y` spread |
|---|---|---|---|---|
| **1** (−2.08e-17 m) | exactly 0 every tick | true every tick | never | **1.1 picometres** |

Round 4's signature was 5 mm alternating at ~20 Hz. This is thirteen orders of magnitude under it.
The gate at `Movement.ts:452–457` — ground snap only when not already grounded — is holding.

**B — pressed against a wall with the input still held, 600 ticks.** Round 3's configuration: the
subject walked into a wall (z 21 → 17.565, speed to exactly 0) and kept pushing.

| camera max per-tick step | camera `y` spread | `sim.y` distinct | `steppedUp` ticks |
|---|---|---|---|
| **exactly 0** | exactly 0 | 1 | **0** |

Round 3 measured 120 step-ups in 120 ticks in this configuration. Zero in 600, and a camera that
does not move by one float ulp.

**C — 3,080 ticks of varied traverse**, reaching 705 mm of elevation, 45 airborne ticks, 2 step-up
events, 3 landings. **The 5 mm skin overshoot is still there, as a one-tick transient, every time:**

```
 tick   2574   2575   2576   2577   2578   2579      <- a 525 mm fall, then contact
 y/mm  146.3   76.3    1.3    5.0    0.0    0.0
 gr       0      0      0      1      1      1
```

All three landings: `y = 5.000 mm` on the contact tick, `0.000` on the next, duration **1 tick**,
deterministically. The step-up completes the same way — `704.989 → 700.000`, corrected on the
following tick. That is `collisionSkin`: `resolve` pushes out by `depth + skin` and overshoots,
exactly as round 4 describes. What round 4 removed was not the overshoot but the thing that made it
*cycle*. Every "reversal" anywhere in the 3,080 ticks is one of these one-tick corrections; there is
no sustained oscillation at any point.

**Verdict: neither historical cause reproduces.** A single 16.7 ms pop of 5 mm when you land, or
when a step-up completes, is a pop on an *event*. This report says the view trembles **while
walking**, which is continuous, and walking on the flat produced a camera static to the picometre.

**Do not spend more on `src/client/engine/` or on `src/shared/player/Movement.ts` for this entry.**
Both are measured clean, twice. The shadow tier was also ruled out by the user on 2026-10-25.

---

### Closed 2026-11-23 — the reporter looked again and it is gone

The one thing this entry always needed was a look on the machine that saw it, and §9 said so for
a month. On 2026-11-23 the reporter reviewed it and reported the camera fine.

**Closed as not reproducible, and that is not the same as fixed.** No edit in this programme was
ever aimed at it: both historical causes were measured not to reproduce, `src/client/engine/` and
`src/shared/player/Movement.ts` are clean twice over, the shadow tier was ruled out, and the mouse
path came out *prior strongly against* without ever being confirmed against the user's own browser
and mouse. So nothing here earned the closure — the symptom simply is not there any more, on the
only machine whose answer counts.

**Everything measured above stays, and it stays for a reason.** If the trembling comes back, this
entry is the map: four places are already eliminated with numbers, and the one candidate still
unmeasured is named with the recorder written and ready for it — `p7-mouse-recorder.js`, needing
Claude in Chrome connected and ten seconds of the user moving the mouse. Reopen rather than
rediscover.

## The mouse path, measured — the first candidate with a visible number *(2026-10-26)*

`Input.onMouseMove` (`src/client/input/Input.ts:209`) integrates the view angle **per event**, and
`CameraRig.update` is handed `input.yaw` **raw at render rate** — the deliberate S4.1 exception and
the one camera input with no interpolation anywhere. The rendered yaw at frame *k* is therefore the
sum of whichever mouse deltas happened to arrive before frame *k*: two unsynchronised clocks
deciding how one continuous motion is cut into frames.

Measured against the shipped handler (the pane cannot hold pointer lock, so `input.locked` was set
directly; everything downstream of that one line is the shipped code, verified by a single
`movementX: 10` event moving `input.yaw` by exactly −0.022 rad). A virtual mouse clock dispatches
real `MouseEvent('mousemove')`s at a chosen poll rate, carrying the fractional remainder the way a
real mouse carries counts; the hand moves at a **constant** angular velocity throughout, so every
variation below is produced by the code.

Rendered turn rate for a steady hand, with ±2 ms of frame jitter:

| hand | event rate | rendered | spread |
|---|---|---|---|
| 25 °/s | 1000 Hz | 17 – 33 °/s | ±61% |
| 25 °/s | 125 Hz | 8 – 39 °/s | **±123%** |
| 25 °/s | ~60 Hz coalesced | **0 – 51 °/s** | **±203%** |
| 101 °/s | 1000 Hz | 92 – 110 °/s | ±18% |
| 101 °/s | 125 Hz | 49 – 148 °/s | **±98%** |
| 101 °/s | ~60 Hz coalesced | **0 – 196 °/s** | **±195%** |

On a perfectly uniform frame clock the same runs give 7.5% at 1000 Hz and 52.6% at 125 Hz, so the
mouse rate alone is already the dominant term and frame jitter multiplies it. **Hand still → exactly
0 in every configuration**: this is on the turning axis only, and only while turning. **The mean is
always right** — 100.6–100.9 °/s against a 101 °/s hand, 25.1–25.2 against 25 — so nothing is lost
or gained and only the per-frame distribution is wrong, which is why three rounds of looking at
positions never found it.

**The tidiest arrival pattern is the worst row.** `~60 Hz coalesced` is Chrome delivering one
coalesced `mousemove` per animation frame, and its `minVel` is exactly 0: when the event rate and
the frame rate are nearly equal, a few milliseconds of jitter gives some frames two events and
others none, so the view renders no rotation at all on one frame and double on the next. The
sensitivity is governed by the *ratio* — near 1 beats hardest, ~2 (125 Hz) is bad, ~16 (1000 Hz) is
mildest.

For scale, against everything else measured for this entry: 0.0041° for the whole camera
composition and frame-timing path without a mouse, 5 mm for one tick on a landing, 4.8 µm for float
precision at 40 m — against 8–39 °/s around a 25 °/s hand here. Three to four orders of magnitude
above anything else, on the most visible axis.

### The arrival pattern above is **not** Chrome's, and that demotes this candidate *(2026-10-26, same day)*

The table is a true measurement of the shipped code, but it is only as good as the arrival pattern
fed into it, and the model used an **independent** event source free-running against the frame
clock. Chrome does not behave that way, and checking the platform behaviour rather than assuming it
is what turned this up:

- **Since Chrome 60 continuous events are frame-aligned.** `mousemove` and `pointermove` are
  dispatched *just before* the `requestAnimationFrame` callback, not when the device produces them.
  So there is one per frame — never the two-then-zero beat the `~60 Hz coalesced` row models.
  **That row does not describe Chrome and is withdrawn as a prediction about it.**
- **Chrome sums the movement it coalesces.** Where Chrome drops events for performance, the
  dispatched event's `movementX`/`movementY` are the *sum* of the individual values of the
  coalesced samples. The Pointer Events spec leaves this non-normative ("could be the sum"), but
  Chrome does it.

Put together: `Input.onMouseMove` receives, once per frame, the total movement for that frame's
window. The per-frame yaw increment is therefore the true hand movement over that interval, and
the rendered angular velocity is correct. **The mouse's polling rate is not the variable this entry
needs**, and the 125 Hz / 250 Hz rows describe a stream Chrome does not deliver.

What the measurement does still establish is a **sensitivity**: this path has no interpolation and
no time-alignment of its own, so it is entirely at the mercy of how the host groups events into
frames. It is correct *because Chrome groups them well*, not because the code defends itself. That
is worth knowing and worth a comment, but it is not a defect and not a cause.

**Residual uncertainty, and the one thing still unmeasured.** The sources for the summing behaviour
are a W3C issue and spec text about `pointermove`, not Chrome's own documentation about `mousemove`
under pointer lock, and the spec language is explicitly non-normative. Claude in Chrome was never
connected in this session, so nothing here was confirmed against the user's actual browser and
mouse. A recorder is written and ready
(`p7-mouse-recorder.js` in the C2 session scratchpad): it reports the real event rate, the real
events-per-frame histogram, `getCoalescedEvents()` counts, the real frame-time distribution and the
yaw actually rendered. It needs the extension connected and about ten seconds of the user moving
the mouse. Until then the honest status is **prior strongly against the mouse path**, not closed.

**If it were ever confirmed, the fix would be a design decision and not refactor work.** S4.1 takes the angles
raw *on purpose* — zero added look latency is the stated reason. The standard remedy is to stop
treating a mouse event as instantaneous: give each delta its own `event.timeStamp`, pull sub-frame
events out with `getCoalescedEvents()`, and resolve the angle at the frame's display time — the
alpha idea the position path already uses, applied to the view angle, for well under one frame of
latency instead of the full tick the position path pays. That changes the input contract and a
documented design decision, so it needs the user's call and a session of its own; `Input.ts` is
**C1**'s file and in the `check:style` ratchet, so no later unit can reach it under R3 either.

### #55 — The Chopper Gunner optic draws a flat grey field and no map · `closed` · *it was the browser pane, as C2 suspected from the first day* *(opened 2026-10-25 by C2; closed 2026-11-23 in a real browser)*
**Files** `src/client/engine/Renderer.ts` (`renderGunship`, `GUNSHIP_VERT`, `GUNSHIP_WORLD_FRAG`)
and whatever hands it the scene and the camera — `src/client/Game.ts` (C23) is the caller.
**Origin** C2's BROWSER check, 2026-10-25.

Call in a Chopper Gunner and the optic shows a flat dark grey field with the HUD over it: no
terrain, no containers, no bodies — the clear colour and nothing else. The normal view comes back
intact when the streak ends, so everything `renderGunship` saves and restores is working.

**It is not C2's change, and that is measured rather than argued.** C2's edit in this file is the
three lazy material getters collapsing onto one `thermalMaterial(fragment)` helper; a
position-independent diff of every non-comment line shows nothing else in the gunship path moved,
and all four shader strings hash identically to `HEAD`. More directly: C2 put the **original**
`Renderer.ts` back on disk, reloaded, played a match and called the streak again, and the optic was
flat in exactly the same way. The file was then restored and re-verified by hash.

**What was established.** Instrumenting the instance showed `renderGunship` called **419 times** in
one run, with the camera at y = 34 (airborne, so the streak's camera is live), one hot group, one
cold group, 12 scene children, and `camera.layers.mask === 1` — layer 0 only, which is what the
`SKY_LAYER` note says it should be. All three thermal materials were built
(`thermalWorldMaterial`, `thermalHotMaterial`, `thermalColdMaterial` all non-null), so the override
materials exist and the three passes ran. **No console error, in a dev build where
`checkShaderErrors` is on** — so the programs linked. What is missing is the geometry.

**Where to start.** Either the world pass draws nothing (the override material compiles but
produces nothing visible, or the objects fail the camera's layer test), or the picture is drawn and
then overwritten. `renderer.info.render` could not answer this from the console because
`autoReset` resets it at the start of every `render` call and `renderGunship` makes three — read it
*inside* the pass, between the three `render` calls, with `autoReset` off.

**Watch for** this may be the browser pane rather than the game: C2 saw it only there, and never in
a normal browser window. Reproduce it in Chrome before spending anything on the shader.

**That suspicion got much stronger on 2026-11-22, and the attempt is recorded so the next one is
cheaper.** A session tried to take the measurement above and could not, because the pane was
rendering **nothing at all**: `requestAnimationFrame` fired **0 times in 1,000 ms** and **0 times
in 1,500 ms** again straight after a screenshot, with the Claude window behind another. A
screenshot forces a *paint* — it came back correctly rendered — but it does not restart the loop.
`renderGunship` is called from the render pass, so at zero frames it is called zero times and
every number a console probe could report would be a false negative. See #85, now written into
§6 of the prompt along with a one-line frame-rate proof to run first.

So: **before touching the shader, run that proof.** If it reads zero, this entry cannot be worked
on from that session at all — and C2's observation that the flat grey appears only in the pane
becomes the leading explanation rather than a footnote.

**Verify** BROWSER: call in a chopper on Foundry and on Depot (the map the pass's own notes were
written against) and compare against the three descriptions in `renderGunship`'s JSDoc — grey
terrain, near-black team-mates, orange enemies.

---

### Closed 2026-11-23 — looked at in a real browser, and the optic is correct

The user reviewed it in the game and reported the optic fine. That is the one observation this
entry was waiting for, and it settles it in the direction the entry had been pointing since the
day it was opened.

**`renderGunship` was never the defect.** C2's **Watch for** said it on 2026-10-25 — *"this may be
the browser pane rather than the game: C2 saw it only there, and never in a normal browser
window"* — and every measurement after that strengthened it rather than the shader: all three
thermal materials built, three passes run, no console error in a dev build with
`checkShaderErrors` on, the camera airborne at y = 34 with `layers.mask === 1`. Then the 2026-11-22
attempt could not take a single honest reading because the pane was rendering **nothing at all**:
`requestAnimationFrame` fired **0 times in 1,000 ms**, twice. At zero frames `renderGunship` is
called zero times and every console number is a false negative — which is #85, and which is also
the whole explanation of a flat grey field.

**So the flat grey was an artefact of where it was being looked at.** Nothing in
`src/client/engine/Renderer.ts` is changed by this closure, and nothing should be: C2 had already
proved by substitution and by hash that its own edit was not the cause, putting the original file
back on disk and seeing the same flat optic.

**The lesson is #85's and it is already written into §6 of the prompt** — run the one-line
frame-rate proof before believing anything the pane renders, or does not render. This entry is the
case that proves why: a month of a shader bug that was a stalled animation frame.

## 5c. Field report from play — the mid-air leg pose *(2026-11-23)*

Reported by the user on 2026-11-23, from **playing the game**, and its own section rather than a
fourth entry under §5b because that section's three were all filed on 2026-10-19 and its preamble
counts them. Same difference from §5, though: nothing pins this, so no test records it and no
oracle will notice when it changes.

### #87 — A body keeps the mid-air leg pose while walking normally along the ground · `closed` · *a dormant record held a transient stance; fixed in `RemoteActor`* *(opened 2026-11-23 by the user, from play; closed twice the same day — see the correction at the end)*
**Files** `src/client/characters/CharacterAnimator.ts` (`handleGroundOrSlideEdge`) and
`src/client/characters/AnimationSelector.ts` (`isAirborne`, `selectGroundTransition`) at the
reading end; `src/shared/player/PlayerController.ts` (the two `setStance('AIRBORNE')` calls and the
`sim.grounded && sim.stance === 'AIRBORNE'` clear) at the writing end. **Origin** reported from
play, 2026-11-23. **Unit** `client/characters/` is **C5**, which is closed and in the `check:style`
ratchet; `shared/player/` is **A8**'s. Neither can be reached under R3, so this needs a session of
its own whichever end it turns out to be.

Intermittently during a match, across maps, a body gets stuck in the jumping-or-falling leg pose
while it goes on moving and walking normally along the ground. The legs are in the air and the body
is not.

**Why that symptom is a precise clue rather than a vague one.** `selectGroundTransition` is two
clips on purpose, and `AnimationSelector` says why on itself: *"the launch clamps on its last frame
and that frame **is** the air pose, whether the body is up for a hop or falling down"*. So the
mid-air pose is not a glitched blend or a missing clip — it is `jumpLaunch`, clamped and holding,
exactly as designed, for a body the animator still believes is airborne. And the walking looks
normal at the same time because position replication is independent of stance: the locomotion layer
keeps running whatever the stance says.

So the question is not *why is the leg pose wrong* but **why does the ground edge never arrive**.

**Where to start — two candidates, neither measured.**

1. **The replicated stance stays `AIRBORNE` after the body has landed.** `isAirborne` reads
   `input.stance === 'AIRBORNE'` off the replicated stance and nothing else — deliberately, since
   `AIRBORNE` has been a `StanceId` on the wire since S5.3. The clear-on-landing is one branch in
   `PlayerController`, `if (sim.grounded && sim.stance === 'AIRBORNE')`. If `sim.grounded` is false
   on the tick that would have cleared it, or that branch is skipped, the stance stays `AIRBORNE`,
   `selectGroundTransition` keeps answering `jumpLaunch`, and **no edge is ever detected at all**,
   because `this.wasAirborne !== airborne` never becomes true. This is the candidate that matches
   the symptom with nothing left over, and it is the one to measure first.
2. **The edge arrives and is consumed by the slide branch.** In `handleGroundOrSlideEdge` the
   airborne-change edge is handled before the slide edge, and if `sliding` is true on that frame it
   calls `beginSlide()` and **never begins `jumpLand`** — one edge, spent on the slide. A landing
   that coincides with a slide would take this path. It fits a *missed* landing transition, though
   it fits the held air pose less well than (1), since `beginSlide` does put a clip on the legs.

**What would settle it in one reading.** The stance is on the wire, so log or watch the replicated
`stance` for a stuck body at the moment the symptom appears. If it reads `AIRBORNE` while the body
walks, it is (1) and the defect is in `shared/player/`, not in the animator. If it reads `STAND`
while the legs are in the air, it is the animator's edge and (2) or something near it.

**Watch for** two things that make an intermittent report like this expensive. The symptom is on
*another* body as the viewer sees it, so it is the replicated path and not the local player's
prediction — check whether it ever happens to the player's own legs, because that answers which
path on its own. And `check:animations` will not catch any of this: it proves every slot the
selector can return is non-empty and asked for, which is true here — the wrong clip is a correctly
catalogued one, held too long.

**Verify** nothing yet. No reproduction, so there is nothing to pin: the first piece of work is a
reproduction, not a fix.

---

### Hunted 2026-11-23, not caught — and what is now ruled out, with numbers

A session went looking for it and failed, which is worth as much as the entry itself: four of
the five places it could have been are now measured clean, so the next person starts at the
fifth rather than at the beginning.

| Layer | How it was tested | Result |
|---|---|---|
| The simulation | Real `PlayerController`, 400 random input scripts x 600 ticks, then scripted slides, jump-cancels, mantles, ledges and a low ceiling | **Clean.** 6,023 jumps, 6,006 landings, and `AIRBORNE>STAND` 4,227 + `AIRBORNE>CROUCH` 1,779 = 6,006 — every landing cleared the stance. Never `grounded && AIRBORNE` for more than one tick. Bots run the same controller, so this covers them |
| The height squash | Read both avatar paths | **Not it.** `CharacterAvatar` and `BotMesh` both `void heightScale` and set `scale(1,1,1)`; the compression was retired in M13 C2 |
| The animator | 600 seeds x 900 frames of random stance scripts over all five stances | **Clean.** Never held `jumpLaunch` for 30 frames with the stance off `AIRBORNE` |
| The replicated chain | Real controller -> real `EntityInterpolator` with jitter and 0/12/24/36 % packet loss -> real animator, 120 runs x 1,800 ticks | **Bounded, not stuck.** Worst hold **317 ms**, in the `frozen` and `extrapolated` outcomes. That is the interpolation delay plus `MAX_EXTRAPOLATION_MS` (250), and it is a flicker |
| A live match | 24 bots, `?nosplash`, two runs of about a minute | **Did not occur.** Twelve airborne-and-moving episodes, longest **567 ms**, none over 600 |

The last row is the useful one: **an ordinary jump taken while moving holds the air pose for up
to about 570 ms**, so the honest population and the defect are an order of magnitude apart.

**The sideways-movement lead, checked on its own and answered.** There is **no directional
locomotion in the game at all** — `selectLocomotion` takes `planarSpeed`, the stance and the
weapon, and never a direction — so strafing plays the *forward* walk loop. That is a real
limitation of the asset pack and worth its own entry if anybody minds it, but it cannot be this
bug: every slot the selector can return is catalogued and loaded, so strafing cannot select a
missing clip, and selecting a missing clip was the one way it could have mattered. `resolve`
throws on an unloaded slot, and that throw would land *before* `setLocomotion` updates
`wasAirborne`, which would strand exactly this pose. It cannot happen from here.

**So the instrument, rather than another guess: `?airpose`.** `src/client/characters/AirPoseWatch.ts`,
off unless the page asks for it, costing one property read per body per frame while off. It
times every episode of airborne-and-moving per body, keeps the distribution, and warns once with
the whole state the moment one runs past **1,200 ms** — twice the longest honest jump and nearly
four times the worst thing the network can do. Read it with `__p7.airPose()`; clear it with
`__p7.airPoseReset()`.

Verified live on 2026-11-23, both ways: with the flag off the report is `{ on: false }` and
nothing is measured through a whole match; with `?airpose` it recorded a real jump at **566 ms**
and tripped nothing.

**What a trip will settle in one line.** The row carries `stance`, `rawAirborne` (before
`GROUND_EDGE_GRACE`) and `airborne` (after it), so the two ends separate themselves: if the raw
and settled answers agree on `AIRBORNE` while the body walks, the stance being fed in is wrong
and the defect is upstream of the animator; if they disagree, it is the grace. It also carries
`active` and `transition`, which say whether the body is holding the clamped launch or stuck in
a one-shot that never finished.

---

### Thought fixed 2026-11-23 — a real bug, and not this one *(superseded; see the correction below)*

**The reporter's own observation closed it**: it happens on the external server and never on the
local one. That is decisive on its own, because a local match has no interpolation at all — a
bot's stance is read straight off its `PlayerController`, which is the thing already measured
clean above. Only a networked body goes through `EntityInterpolator`, and only a networked body
can starve.

**The mechanism, reproduced deterministically.** `EntityInterpolator.sample` hands the newest
sample's stance to anything that asks. When the buffer starves past `MAX_EXTRAPOLATION_MS`
(250 ms) it stops predicting and **freezes**: `write(newest.state, out)` with `out.frozen = true`
— the last pose it was told, held still, for as long as the silence lasts. If the last thing it
was told was `AIRBORNE`, that is what it keeps answering.

And `jumpLaunch` clamps on its last frame **on purpose**, because that frame *is* the air pose.
So the animation does exactly what it is built to do, forever:

```
one snapshot carrying AIRBORNE, then silence
  0.5 s   jumpLaunch   frozen: true
  2.0 s   jumpLaunch   frozen: true
  5.0 s   jumpLaunch   frozen: true
 10.0 s   jumpLaunch   frozen: true
```

A body hanging in the air with its knees up, not moving — which is the screenshot the report
came with.

**The fix is one condition, in the one place that already knows the pose is stale.**
`RemoteActor.animation` drops `AIRBORNE` for `STAND` when `frozen`. Everything else survives the
freeze honestly: a body that was crouching still *is* crouching as far as anyone knows. But
`AIRBORNE` is not a state, it is a moment, and the animation reads it as one — so the client
stops asserting a transient whose end it can no longer see. After the fix the same replay lands
`jumpLand` and settles into `walkWeaponReady`.

**What was deliberately not changed.** `get stance()` still reports what the wire last carried,
so `rigLayoutFor` and the hitbox overlay are untouched and cannot start disagreeing with it —
and `isLowStance` is false for both `AIRBORNE` and `STAND`, so the layout does not move either
way. Extrapolation *inside* the cap keeps the air pose, because that is the interpolator still
doing its job and a jump in flight should look like one. `Interpolation` itself is untouched:
freezing and reporting the last known stance is the correct contract for a buffer that has run
dry; acting on a stale transient is the consumer's mistake, not the buffer's.

Pinned by three cases in `src/client/net/RemoteActor.test.ts`: the frozen jump drops to `STAND`,
the raw stance stays `AIRBORNE`, and a frozen *crouch* and an extrapolated jump are both left
alone.

### The instrument was wrong in a way worth recording

`?airpose` shipped a commit earlier tripping on a body that was airborne **and moving**, on the
reasoning that a body standing still in the air is simply mid-jump. That is backwards, and it is
the kind of mistake this file exists to write down: **the defect freezes a body at a dead stop**,
so `planarSpeed` is zero for the whole episode and the instrument would have watched #87 happen
and reported nothing. It now trips on duration alone and keeps `planarSpeed` on the row as data.

The measurements that set its threshold still stand and are still useful: an ordinary
jump-while-moving holds the air pose for at most **567 ms** live, and the replicated chain at
36 % packet loss for **317 ms**, against a threshold of 1,200.

### The correction — it was **dormancy**, not starvation, and the reporter said so

The fix above shipped and the reporter played the build and answered **"לא תוקן"**, with
screenshots and `[air-pose]` rows. It was a real bug and it stays fixed; it was not the reported
one. Writing that down matters more than the fix, because the reasoning that produced it looked
airtight and was not: *"only a networked body can starve"* is true, and the body in the report was
never starving.

**What the instruments measured, and why the two sides looked impossible.** The client caught
bodies holding `stance: AIRBORNE` past 1,200 ms with **`frozen: false` and `extrapolated: false`**
— snapshots were arriving, so the buffer was healthy and the stance on the wire was simply wrong.
A server-side probe over the stepped roster, with no filter on `grounded` and none on `alive`,
stayed **completely silent** across a deployed session and eight headless matches: no bot held
`AIRBORNE` for 60 consecutive ticks. Both measurements were sound and could not both be about the
same record. That was the whole puzzle, and the answer is that they were not.

**The mechanism.** Protocol 28 sends a body this viewer cannot see **dormant**: the record it had
the last time it was relevant, frozen, with `EFlag.Dormant` set. `SeatView`'s own header names
what freezes — *"position, view, velocity, **stance**, height, weapon, health…"*. So a body that
leaves this viewer's relevance set mid-jump is replicated as `AIRBORNE` for as long as it stays
out of view. The instance the report came from logged **`dormantPct: 100`**: every enemy, dormant,
all the time.

Nothing starves, which is why the first fix could not see it. Snapshots keep arriving at 20 Hz,
`sample` brackets two of them and blends, `frozen` stays false — and `Interpolation.sample` takes
the stance from the newest sample **unblended**, which is right for a live record and is exactly
how a frozen one gets through. Meanwhile `sim.stance` landed within a tick of the ground, so the
server probe was right to say nothing. Two records, two true answers.

**The fix**, in the same line as the first and for the same reason, which is the argument that the
line is the right place: `RemoteActor.animation` refuses `AIRBORNE` when the record is `frozen`
**or `dormant`**. Both are stale records asserting a transient whose end they cannot see; the
difference is that the server states dormancy outright in a flag instead of leaving the client to
infer it from silence. Nothing else changes: `get stance()` still reports what the wire carried,
a dormant *crouch* is left alone, and the moment the record is live again the guard lifts, so a
body that really is mid-jump when it comes back into view is drawn mid-jump.

Reproduced as a failing test first — a live `AIRBORNE` sample, then two dormant records, sampled
between them: `frozen: false`, `dormant: true`, animation told `AIRBORNE`. Four cases in
`src/client/net/RemoteActor.test.ts` hold it now, beside the three the frozen fix left.

### Three instruments, four wrong filters, and the lesson that cost the most

Every instrument built for this hunt was first written with a filter that would have hidden the
thing it was built to find, and each filter came from an argument rather than a measurement:

1. `?airpose` tripped only on a body that was airborne **and moving** — and the frozen case stands
   at a dead stop, so it would have watched the bug happen and said nothing.
2. The server probe required `sim.grounded` — and its silence on the deployed server was the
   evidence, not an absence of one.
3. The same probe excluded dead bodies, on the argument that a corpse is drawn with a death clip.
   Three of the four bodies it later caught were dead.
4. And the one that mattered: **no instrument recorded `dormant`.** The field that separated the
   two true measurements was on the wire the whole time, in a flag the client already reads, and
   nothing asked for it. The contradiction stood for hours because of an omission, not a mystery.

Measure the thing; filter afterwards, and only against a measurement — and when two sound
measurements contradict each other, the next question is which record each one is about.

**The instruments are gone from the tree**, as the reporter asked: `AirPoseWatch`, `StanceProbe`,
`StanceTrace`, the `?airpose` key, the four `__p7` handles and `readEntity`'s field-mask return
are all removed, and nothing from them is in the fix's commit. The numbers they produced are
above and are the only part worth keeping: an honest jump-while-moving holds the air pose for at
most **567 ms** live and **317 ms** through the replicated chain at 36 % packet loss; the
simulation cleared the stance on **6,006 of 6,006** landings.

## 6. Documentation and housekeeping

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

## 6b. Duplication that spans units — opened by A16

### #78 — Division C writes the same three lines of DOM about five hundred times · `closed` *(opened 2026-11-10 by C19; done 2026-11-22)*

**Files** every screen in `src/client/ui/`. **Origin** C19's Step 1, counted across its own
eight files first and then the division.

```
const x = document.createElement('span');
x.className = 'op-label ps-fact__label';
x.textContent = label;
```

That idiom — create, class, text — appears about **150 times in C19's eight files alone** and
upwards of **500 across division C**. One helper collapses each to a line:

```ts
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string)
```

**Why no unit has done it.** It needs a module both halves of the division can import, and R3
allows a **new source file** only in a unit marked *design*. Putting it in one screen's file and
importing sideways is the wrong shape — and putting it in `ScreenChrome.ts`, which everything
already imports, would make that file the division's DOM library by accident rather than by
decision.

**Decided 2026-11-22: yes, and `src/client/ui/Dom.ts` is the home.** The reasoning, so nobody
has to take it again:

- The helper cannot change what is rendered. `el(tag, className, text)` produces the same
  element with the same class and the same text as the three lines it replaces, so the division's
  BROWSER checksums should not move at all — and a checksum that *does* move is a conversion
  mistake, which makes them a usefully sharp check rather than a cost.
- Every screen has a characterization suite now (C14–C19 together), which is exactly the
  condition the entry names as making this the cheapest it will ever be. That condition will not
  improve and will decay as screens change.
- ~500 sites of three lines become ~500 of one. That is the largest single piece of duplication
  left anywhere in this project.
- `ScreenChrome.ts` is **not** the home, for the reason the entry gives: it would become the
  division's DOM library by accident. A file named `Dom.ts` says what it is.

**Done 2026-11-22.** `src/client/ui/Dom.ts` exists and **340 sites across 33 files** go
through `el()` — 792 lines deleted for 394 added, in two commits: 275 sites in the bulk pass and
65 more in a second pass over the files the first one refused. The conversion was mechanical where
the shape was exact and refused everywhere else, which is the only way a pass over this many
sites is safe:

- Only `const v = createElement(tag); v.className = …;` optionally followed by
  `v.textContent = …;`, consecutive, same variable, no type annotation. Anything that sets an
  attribute in between, or builds the element over several statements, was left alone.
- A site whose own variable is named `el` was skipped, and so was any line that would pass 110
  columns.
- **The compiler was the judge, not the regex.** Files were converted, `tsc` was run, and every
  file it rejected was reverted whole and re-examined — which is how the real hazard surfaced:
  a handful of files bind `el` as a local or a parameter, so the import is shadowed at some
  sites and not others. Those are the seven still untouched.

**The second pass took the files the first one refused**, by renaming the local `el` to `node`
inside its own block before converting — again with `tsc` as the judge, one file at a time.
`HudTactical`, `LoadoutStats` and `PlaySolo` took 59 sites between them that way, and six single
sites followed in `EndOfMatch`, `AiPanel`, `EquipmentPanel`, `MetaPanel`, `SaveInspector` and
`StreakPanel`.

**76 sites in 7 files are deliberately left**, and the reason is the same one in five of them:
`el` is not only a local there, it is an **interface field name** — `Row.el`, `Slot.el` — so
`{ el, … }` shorthand carries it into an object literal, and renaming the local to `node` makes
the literal stop typechecking. `Killfeed`, `Scoreboard` and `LoadoutEditor` each failed exactly
that way and were reverted whole; `Hud` has two such fields and failed the same way in the second
pass. `XpSummary` binds `el` as a parameter *and* as a local in adjacent functions. The last few
are `this.body = document.createElement('div')` — an assignment to a field rather than a `const`
declaration, which the pass never matched on purpose, since the two shapes read differently and
one regex covering both is a regex nobody can check.

Those seven want a human reading each site, not a third pass. Nothing waits on a decision: the
helper exists, the division imports it, and the remaining 76 are the sites where the three lines
are the clearer code.

**Verify** `npm run check` and every division-C BROWSER checksum, which between them hold the
element tree of every screen in the game.

---

### #79 — The DOM double is copied whole into every test file that needs it · `closed` *(opened 2026-11-10 by C19; another copy added 2026-11-16 by C23a; done 2026-11-23)*

**Files** 38 `*.test.ts` files across `src/client/` — every one of them, not only `ui/`.
**Origin** C19's Step 3; counted properly on 2026-11-22 by the batch that closed #58 and #67,
which found the entry's own figures low.

**Measured, 2026-11-22.** 38 files carry a double and there are **29 distinct texts** among
them, from **41 lines to 351**, and from **one capability to nineteen**. Every capability a
browser has is split across the set — `setAttribute` in 28 of 38, `querySelector` in 21,
`createElementNS` in 26, `getBoundingClientRect` in 21, `requestAnimationFrame` in 20, a
`localStorage` double in 23, a `window` double in exactly one. Only five texts are shared by
more than one file at all (the largest group is four: `Emblem`, `FpsCounter`, `WeaponIcons`,
`WeaponPreview`).

So this is not fifteen copies of one double. It is 29 hand-grown doubles of wildly different
capability, and that changes the shape of the work: **a test written against a thin double
asserts what a thin double does**, and putting the richest one under all 38 files can change
what a suite sees — C19's own `setAttribute('class', …)` fix is the example the entry already
gives, where a suite silently stopped looking for icons it could not find. Each file has to be
read when it is converted, not just re-pointed, which is why this is a session of its own and
not a line in a batch.

`FakeElement` and the environment around it are up to **351 lines**, and each test file carries
its own copy, because R9 gives a test file no skeleton and R3 gives a unit nowhere shared to put
one. The copies have **already drifted**: C19 had to teach its own copy that
`setAttribute('class', …)` writes the token set — which is how every SVG icon in the project is
classed, so the earlier copies cannot find an icon with `querySelector` and the tests written
against them silently do not look.

That drift is the cost, not the line count. A double that differs between files is a set of
tests that disagree about what a browser does.

**Decided 2026-11-22: `src/client/ui/testing/dom.ts`** — inside `src/`, beside the code it
doubles for, which is the first of the two the entry offers and the same answer #78 got.

- A `test/` tree outside `src/` would need its own place in three `tsconfig`s and in
  `check-boundaries`' partition map, which classifies every file under `src/` and would have to
  learn a fourth kind. That is a change to the project's shape to hold one fixture.
- `src/client/ui/testing/` is already classified: it is `client`, and the boundary rules it
  inherits are the right ones — a test double for the DOM has no business importing `server/`
  either.
- `vitest.config.ts` includes `src/**/*.test.ts`, so a non-test file in that folder is not
  collected as a suite and needs no exclusion.

**The labour is still a session of its own, and bigger than the line count suggests.** Measured
2026-11-22: 38 files, **29 distinct texts**, 41 to 351 lines, one capability to nineteen, and
every capability split across the set — `setAttribute` in 28 of 38, `querySelector` in 21,
`createElementNS` in 26, `requestAnimationFrame` in 20, a `window` double in exactly one. Only
five texts are shared by more than one file.

So this is not re-pointing 38 imports at one file. **A test written against a thin double
asserts what a thin double does**, and putting the richest one under all of them can change what
a suite sees — which is the failure this entry already records once, where C19's
`setAttribute('class', …)` fix revealed suites that had silently stopped finding icons. Every
file has to be read as it is converted and its suite run, and the conversion order should start
with the five groups that already share a text (14 files) because those are the ones where the
shared double is provably what they already had.

**Verify** the whole suite, twice: once to see it pass on the shared double, and once with a
deliberate break per file to see that the suites still bite.

---

## Done, 2026-11-23 — `src/client/ui/testing/dom.ts`, 715 lines, 37 of the 38 files on it

Commits `d3cbded`, `70b8b72` and the one that carries this note. **6,813 lines of hand-grown
double out, 1,440 in**, across 39 files. The gate is green on the whole tree at each commit: 14
audits, `check:style` (the new file is registered under the BACKLOG unit and passes the
skeleton check), 317 test files / 7,203 tests, three typechecks. `measure.mjs` puts `dom.ts` at
59 functions with none over the §4.1 limits — longest 20 lines, highest complexity 8.

### The measurement, re-taken before any of it

The entry's own figures were close and one of them was an artefact. 38 files is right. **29
distinct texts** is right only if the per-file rig helpers that sit inside the same `the DOM
double` section are counted as part of the double; strip those and it is **26 distinct
element-and-environment texts**, in which **14 files share a text with another file** — which
is the entry's own 14, reached a different way. The share groups are three, not five: seven
files (`LoadingScreen`, `Menus`, `PlaySolo`, `ScreenChrome`, `SpaceSkip`, `Splash`,
`VoteOverlay`), five (`CharacterStage`, `Emblem`, `FpsCounter`, `WeaponIcons`,
`WeaponPreview`) and two (`HudStreaks`, `HudTactical`). The entry's "largest group is four" was
the raw-text grouping; on the double proper `CharacterStage` joins those four. The range is 46
to 561 lines of double per file, not 41 to 351 — the entry measured from a tighter boundary.

Everything else in the entry held, including the thing it was written about.

### What one file is, and what it is not

`FakeElement`, `FakeAnimation` and a `FakeDom` handle that installs the environment on
`globalThis` and takes it off again. `installFakeDom()` returns the handle; the state a test
reads — the listeners `window` was given, the timers pending, the animations that ran — hangs
off it instead of off a drawer of module-level `let`s, and `restore()` replaces the list of
global names that every `afterEach` repeated.

**The element is shared; the environment mostly is not.** Measured per file: of the 24 files
that still had a double after the first pass, 17 would have *gained* globals from
`installFakeDom` that they have never run with — a `window`, a `localStorage`, a fake clock,
`performance`, `requestAnimationFrame`. A suite that is green today without a global `window`
is not a suite to hand one to on the way past: a `typeof window` guard anywhere under it takes
the other branch and nothing says so. So 12 files use the whole environment (the three share
groups' richest text was written into the file verbatim, plus the four `src/client/` files
whose double was that text plus `getAttributeNames`/`hasAttribute`) and 25 import the element
class alone and keep their own `beforeEach` untouched. That is where the duplication actually
was.

Six files subclass the shared element to keep one answer of their own, and each subclass says
why on itself: `XpElement`, `BoardElement`, `EditorElement`, `MapElement`, `OverlayElement`,
`HudElement`, `MatchHudElement`.

### What reading each file turned up

This is the part the entry asked for and the reason it could not be a sweep.

- **Ten of the copies still had C19's bug.** `setAttribute('class', …)` did not write the token
  set, so every SVG icon — which is how this whole project classes its glyphs, an SVG element
  having no settable `className` — was invisible to `querySelector`. C19 fixed its own copy on
  2026-11-10 and the fix never travelled: `EndOfMatch`, `Hud`, `Killfeed`, `LoadoutEditor`,
  `MatchHud`, `PauseMenu`, `PlayerCard`, `ProfilePanel`, `Settings`, `XpSummary`. All ten now
  reflect it. **Every one of their suites stayed green**, so the holes were latent rather than
  load-bearing — but they were holes, and a tenth of this suite was asserting against a
  document in which icons cannot be found.
- **`appendChild` is wrong in the shared double and in 28 of the 30 copies.** A real
  `appendChild` *moves* a node that already has a parent, by unlinking it first. `Scoreboard`'s
  double and `MatchHud`'s were the only two that did; the rest push without unlinking, which
  leaves a moved node in two children lists at once. Both keep their own as an override and the
  shared one is unchanged, because fixing it there would change what twenty-odd suites see and
  that is not this entry's job. **It is the next one** — see §9.
- **`cloneNode` had drifted four-deep-to-one-shallow.** Four copies cloned children and
  `MatchHud`'s did not, and none of the five read the `deep` flag. `Killfeed` calls it with
  `true` to bring a weapon icon along, so under `MatchHud`'s double the cloned icon arrives
  empty. The deep one is shared; `MatchHudElement` keeps the shallow one, and of all the
  divergence found here this is the one that looks like a defect rather than a choice.
- **`style` is pinned in two opposite directions.** Six copies pre-seeded `opacity`, `transform`
  and sometimes `visibility` to `''` so an untouched key read back empty, with the note *"which
  is what a real `CSSStyleDeclaration` does"* — and three of them assert on it (`HudTactical`
  twice, on a cook bar and a breath bar nothing has touched; `Hud` on the crosshair's
  `visibility`; `BearingIndicator` on an arrow's `transform`). Meanwhile `Splash` asserts
  `protocol.style['visibility']` is **undefined** before the stage that writes it runs. So
  neither answer could be the rule: `FakeElement` takes an optional style seed and the six that
  want it pass it.
- **`focus()` had three behaviours** — empty, a counter, and one that rewrites
  `document.activeElement`. The counter is the superset (a suite that never reads `focusCount`
  cannot tell) and is shared; the one that reaches into a global is `EditorElement`'s, because a
  focus call that silently rewrites a global is not a reach a double shared by thirty files
  should have.
- **Four files' `getContext` records**, and what the screen drew is the assertion. The shared one
  answers a `Proxy` that refuses nothing and records nothing — right for a screen that only has
  to finish drawing, useless here. The four recorders had themselves drifted three ways
  (`Minimap` and `MortarOverlay` identical, `Hud` recording method calls but not property
  writes, `MatchHud`'s methods recording nothing at all). The *canvas* double is a second
  decision and a second file, so it stays local in all four and only the element is shared.
- **Smaller divergence, each checked rather than assumed.** `XpSummary` measures a 100x20 box
  where every other copy says 200x40 and reads `offsetWidth` to force the reflow its
  transitions depend on, so the number is asserted — `XpElement` keeps it. `Settings`'
  `getBoundingClientRect` answered a zero box and is called by nothing, in the suite or in
  `Settings` itself, so the shared one replaced a dead method. `LoadoutEditor` leaves most
  elements unmeasured and `EditorElement` keeps zero as the default, *although the suite stays
  green either way* — which is why it was kept rather than dropped. `ClientMatch` held
  `clientWidth`/`clientHeight` at 240x160 and nothing in the tree reads either outside
  `probes/`. `Minimap` and `MortarOverlay` held `className` as a plain string field rather than
  a view over a token set; every write in those two screens is one class string read back
  whole, so the shared getter answers identically. `EndOfMatch`'s and `LoadoutEditor`'s
  `getContext` took no kind and always answered where the shared one answers `null` for
  anything but `2d`, and no client code asks for another kind. The form and anchor fields
  (`tabIndex`, `maxLength`, `placeholder`, `readOnly`, `href`, …) were in four copies at
  identical defaults and are one set now; they exist for the typechecker, since a screen that
  assigns `input.maxLength` will not compile without them. `Listener`'s event parameter is
  optional, because two suites dispatch by calling the stored function with no argument against
  handlers that read nothing off it — type-only, nothing changes at run time.

### Does the suite still bite — per file, as asked

For each of the 37: something the suite should catch was broken in the module under test, that
one suite was run and had to fail, then the module was restored and the suite had to pass
again. **All 37 bit.** The first-choice mutation (the module's first CSS-class literal) was
wrong for twelve of them and each needed a hand-picked target, which is the hazard's own shape:

- `Menus` does not assert `op-menu__stage` **or** `op-menu` anywhere; `op-menu__nav` bites.
- The first string literal in `Splash.ts` is an easing name, not a class.
- `SpaceSkip`, `BearingIndicator`, `Scoreboard`, `ClientMatch`, `MatchHud` and `Game` have no
  mutable class literal in the relevant path, so the targets were `MS_PER_SECOND`, the
  `hud-bearing` template literal, `sb__title`, the `Btn.Streak1` slot map, `minimap.friendlies`
  and `Game`'s initial state.
- `MatchEquipment`, `GameScreens`, `MatchMeta` and `GameLoadout` have no CSS classes at all —
  they are logic — and the first constants tried (`REPLICATED_EASE_RATE`,
  `SUMMARY_ROWS_PER_TEAM`, `speedScale`) turned out not to be exercised either. The targets
  that bit were `adoptProjectiles`, `createMenus` and `asModeId`.

### The one file left, and why

**`src/client/input/Input.test.ts`** keeps its own double, and should. It is not this double at
all: `FakeTarget` and `FakeCanvas` are event-target doubles whose `dispatch` synthesises
`defaultPrevented`, its own `FakeElement` is two fields (`tagName`, `isContentEditable`) that
exist only for the focus guard to recognise, and its document carries `pointerLockElement`,
`fullscreenElement` and `exitPointerLock`. There is no element tree in it. Forcing it into
`dom.ts` would put two unrelated doubles in one file to make a count come out even.

## 9. Nothing is waiting

Written 2026-11-22, when the backlog came down from 70 to six over one week; amended that
evening when #78 was done, again on 2026-11-23 when #79 was done, and **rewritten the same day,
when #34 and #55 were both closed and the section had nothing left to describe**. Every entry
this section was written about is now gone, and the one entry open is new.

**Every entry this file has ever held is closed.** #87 was the last, and it closed the same day
it opened: the reporter's note that it happened on the external server and not the local one
ruled out everything a local match can do, and the defect was a frozen interpolation holding a
transient stance. See the entry.

The table this section carried is gone with it.

**All four entries this section has ever listed are closed, and they closed in two different
ways, which is worth keeping straight.**

*The two that were work, and were done.* #78 on 2026-11-22 (commits `5833072` and `7c8c44c`):
340 sites across 33 files on `src/client/ui/Dom.ts`, with 76 left in seven files because `el` is
an interface field there and the local cannot be renamed out of the way. #79 on 2026-11-23
(commits `d3cbded`, `70b8b72`, `bde9a64`): 37 of the 38 test files on
`src/client/ui/testing/dom.ts`, 6,813 lines of double out and 1,440 in, with
`input/Input.test.ts` left because what it doubles is an event target and not an element tree.

*The two that waited on a person or a machine, and were looked at.* Both closed on 2026-11-23,
when the user reviewed them and reported both fine — and **neither was fixed by anything in this
programme**, which is the part to remember. #34 is closed **as not reproducible**: nothing was
ever aimed at it, both historical causes were measured not to reproduce, and the one candidate
still unmeasured is named in the entry with a recorder written and ready, so if the trembling
returns the entry is a map and not a blank page. #55 is closed **because it was the browser
pane**, which is what C2's **Watch for** said on the day it was opened and what the 2026-11-22
attempt proved by failing — `requestAnimationFrame` fired 0 times in 1,000 ms, twice, and at
zero frames every console number about a render pass is a false negative. `Renderer.ts` is
unchanged and should stay so.

So the thing §9 existed to say — *these wait on a person, a machine or a decision this programme
cannot supply* — is now true of exactly one entry, and what #87 waits on is the cheapest kind of
help there is: somebody seeing it happen twice.

**Two findings are loose and neither has an entry yet.** Recorded here rather than lost, because
both came with a measurement that nobody will want to retake.

1. **The shared DOM double's `appendChild` does not unlink a node from its previous parent**, so
   a moved node sits in two children lists at once. A real one unlinks; two of the thirty copies
   did (`Scoreboard`'s and `MatchHud`'s, which keep theirs as overrides) and twenty-eight did
   not. The fix in `ui/testing/dom.ts` is one line and changes what every suite on the shared
   double sees, which is why #79 did not do it — it is a behaviour change wanting its own run of
   the gate, not a line in a conversion. *(From #79. Left here deliberately on 2026-11-23 rather
   than opened as an entry.)*
2. **`MatchHud`'s `cloneNode` is shallow where the other four copies were deep**, and none of the
   five read the `deep` flag. `Killfeed` calls it with `true` to bring a weapon icon along, so
   under that double a cloned icon arrives empty and anything asserting on its contents there is
   vacuous. Kept as an override under R1. Of all the drift #79 found this is the one that looks
   like a defect rather than a choice. *(From #79.)*
