<!-- Moved verbatim from PLAN.md lines 520–753 at 32d8eed (2026-09-19). Part of the PROTOCOL SEVEN plan record; PLAN.md holds the index. -->

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

**Closed (2026-09-19).** The human closed the milestone after B6.4's browser proof — a remote
human rendered as the apex it declared, every bot dealt locally. All four steps are recorded
above with their numbers; the wire is v18 and the gate is green (`check` 146 tests, `leak`
flat, `content` byte-identical, `skirmish` FLOW CHECK PASSED, `--skins` skinFailures 0). This
section moves to `docs/archive/plan/23-m16-body-on-the-wire.md`; the milestone after opens on
M12's content.
