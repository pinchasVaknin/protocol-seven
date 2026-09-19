<!-- Moved verbatim from PLAN.md lines 524–790 at 7d58a0b (2026-09-20). Part of the PROTOCOL SEVEN plan record; PLAN.md holds the index. -->

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

### Playtest report (2026-09-20), fixed the same day: the tab, the light, the Dunes picture, the plates

Four items from the human, on the build above.

- **The favicon read white.** The keyed mark alone on a light tab strip. Now the mark on a
  near-black rounded plate (`--c-void`, radius 20 %), 256² and 16/32/48 — the human's own
  example, the skull on black.
- **The splash's ending washed the screen.** The bloom scaled to the screen was a flat light
  blue with the logo in it; the human asked for the light *on the logo* and a ring with
  sparks instead. Stage 4 is now: every piece's glow swells and settles (`drop-shadow` at 22
  then 12 px, brightness 1.45 → 1.12), the eyes flare white-cyan, a thinner halo ring goes
  out to 2.6× with fourteen sparks streaking off it at fixed angles with a little
  irregularity — and the layer fades from black over the menu. No screen-filling light.
- **Dunes' picture was the side street.** The pictures are taken through a **vista** camera
  now (`MenuBackdrop.vistaCamera`, `planVista`): on the spine lane, walked from the centre
  toward each end with the standing capsule, standing on the longer free side up to 14 m back
  and 0.6 m over eye height, looking through the centre — Dunes shows its market and the
  houses beyond, Depot its yard under the bridge, Foundry the hall. The menu's dolly is
  unchanged.
- **A nameplate and a health bar stayed over every corpse** — a regression from C2's
  spectator fix. `BotRenderer.update` wrote `visible = true` to every actor that was not the
  spectated one, after `ActorIndicator.update` had hidden the indicator for a body that was
  not participating. Now only the spectated body is touched (hidden), and its avatar is shown
  again on the frame it stops being the eyes (`hiddenFor`); the indicator decides for itself.
  Measured in a solo match over 25 s: 266 dead-bot samples, 0 with a plate visible.

**Closed (2026-09-20).** The human closed the milestone after the playtest report above was
fixed the same day. All six phases and the report are recorded above with their numbers: the
gate is green (`check` 151 tests, `intro` 299 plans / 0 failures, `skirmish` FLOW CHECK
PASSED, `layout` every surface at eight viewports), and seven commits on `main` from
`7227b27` to `7d58a0b` carry the work. This section moves to
`docs/archive/plan/24-m17-front-end-second-pass.md`; the milestone after opens on M12's
content, as M16's close said.
