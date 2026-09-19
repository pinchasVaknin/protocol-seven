<!-- Moved verbatim from PLAN.md lines 518–2083 at 6f924c4 (2026-09-19). Part of the PROTOCOL SEVEN plan record; PLAN.md holds the index. -->

# Milestone 15 — proposed: the front end, rebuilt to fit one screen

Planned by the human on 2026-09-15 from five requirements and five reference images — a main
menu, a Create-a-Class screen, a match intro, an end-of-match screen, and one rule over all of
them: **nothing scrolls, anywhere, at any window size.** The references are the look (an
asymmetric menu over a cinematic left half, nav buttons that are smeared rather than boxed, a
character on a lit platform, a right-hand loadout column of six boxes that each show only what
is equipped); the numbers below are what this tree already has and what each item costs
against it. The four decisions the brief turned on were taken the same day, on the
recommendation: **the menu backdrop is a live render of the game, not a video** (no video file
exists, and none is wanted at 5–20 MB against a 391 kB client); **the skin picker ships
local-first**, the wire field after; **1280×720 is the floor** the no-scroll rule is measured
at; and **Milestone 14 was archived** to make room for this section — its record is
[21-m14-decorators-and-vitest.md](docs/archive/plan/21-m14-decorators-and-vitest.md).

Five phases, in dependency order: **A** the frame (one scale, no scroll), the menu with its
backdrop dolly, and the controls card moved into Settings; **B** Create-a-Class — the stage,
six boxes, the strips, the skin picker; **C** the match intro, a camera the round-one freeze
already pays for; **D** the end of the match — the lineup and the accordion; **E** combat
behind the menu — the solo simulation running under the backdrop, last, because it is the one
piece whose cost has to be measured by `npm run leak`-shaped instruments before it ships.
Zero gameplay change throughout: nothing in `shared/` moves before B6, the server is not
touched by any phase but B6, and the seeded harness and the content probe are byte-identical
after every commit. **No product code was written in this session.**

## The rule that decides the layout: nothing scrolls

Today the opposite is policy, and it was a fix. Playtest round 5's B1/B2 found the main menu
at 879 px of content in a 626 px window with half of it at a negative offset; the answer was
`justify-content: safe center` and `overflow: auto` on the `.op-screen` layer
(`styles/app.css`, the comment at the layer's `overflow`), so *"a screen taller than the
window scrolls from its own top, and no individual screen has to know how tall it is."* B11
then rebuilt the loadout editor so that its option list is never destroyed, *because* it
scrolls. The layout probe (`scripts/layout-probe.mjs`, `probes/layout.ts`) asserts two rules
at six viewports: every element is **reachable** by some scroll, and nothing scrolls
**sideways**. Vertical scrolling is, in that probe's own words, *"a legitimate answer to a
long screen."*

This milestone withdraws that answer. The mechanism is one thing rather than a decision per
screen:

- **A design frame.** The front end is authored at 1920×1080 and the UI root carries
  `zoom: var(--ui-scale)` with `--ui-scale = min(vw / 1920, vh / 1080)`, set from the same
  `resize` listener that calls `Renderer.setSize`. `zoom` rather than `transform: scale()`
  because it re-lays out at the scaled size — text is rasterised at its final size and
  `getBoundingClientRect()` reports what is on screen, so the probe measures the truth. Chrome
  has always had it; Firefox since 126. The frame is centred; the backdrop layer is full-bleed,
  so a 16:10 or an ultrawide window gets more sky, not black bars.
- **A third probe rule, and the first rewritten.** *No overflow*: for every element in a
  mounted screen, `scrollHeight <= clientHeight` and `scrollWidth <= clientWidth`, and no
  element's rect leaves the viewport — which is *reachable* with the scroll taken away, so it
  subsumes it; *sideways* stays as the named special case. Viewports: the six in
  `Viewports.ts` plus **1920×1080** and **1280×720**, the floor. Below the floor the frame
  still fits — the formula has no lower clamp and the rule holds at 375×812 too — but nothing
  is promised about legibility there; that width is the device gate's territory already.
- **Where the length goes.** The things that are long today become tabs, paged strips or
  collapsibles, screen by screen: the menu's key card (13 actions and Esc) → a Settings tab;
  the editor's 14 rows → six boxes, each opening one strip, paged where a list outruns the
  strip; the 22 rebindable actions → the BINDINGS tab that already exists, in two columns;
  the ten-player board on the summary → a toggle over the lineup. Nothing gets an
  `overflow: auto`, and the probe is what refuses one.
- **`html, body { overflow: hidden }`** stays; it is what keeps the canvas still.

## What exists, measured this session

| What | Number |
|---|---|
| Front end | `client/ui/`: 23 files, **8 000 lines** of TS; 5 stylesheets, **3 604 lines** of CSS; `tokens.css` holds the palette, the 4 px grid and the type ramp every value resolves to |
| `Menus.ts` | 464 lines; one centred column — title, status, profile line, Play Multiplayer, callsign, Play Solo, Create a class, Settings, the key card, the fullscreen hint, reset — then a mode/map/difficulty page |
| `LoadoutEditor.ts` | 864 lines; 5 slots, **14 rows** (primary, attachments, camo, secondary, sidearm attachments, lethal, tactical, perk ×3, field upgrade, streak ×3), one open at a time, `WeaponPreview` + `LoadoutStats` on the right; `.lo-options` scrolls (B11) |
| `Settings.ts` | 590 lines, four tabs already (CONTROLS, BINDINGS, AUDIO, VIDEO); **22** rebindable actions |
| `EndOfMatch.ts` + `XpSummary.ts` | 264 + 352 lines; the XP rows land on a 0.34 s cadence with a bar and a level-up flourish (S6.1, *"the payoff moment of the whole loop"*); the board is the match's own `Scoreboard`, embedded, 8 rows a side |
| Layout probe | 2 rules × 6 viewports (1366×626 … 375×812), headless Chrome over CDP, an instrument (`npm run layout`), not a gate — the deploy host has no browser |
| Video and image assets | **0** of either. The only assets are M13's: 7 skins in `public/models/bots/skins/` — **Apex 4.4 MB, Pulse 4.5, Rhino 4.9, Sentry 5.2, Viper 24.3, Echo 28.2, Hazard 37.6; 109 MB** — and 8.5 MB of animation clips. One skin preloads at boot (`echo`, the default, 28 MB); the rest load when an actor is dealt them |
| A character stage's precedent | `WeaponPreview` builds its own `THREE.Scene` and `WebGLRenderer` on the editor's first tick; `CharacterAssetService.avatarProvider(def).create()` hands back a posed `CharacterSkin` with a weapon socket and an animator |
| The freeze | `MATCH_START_SECONDS = 10`, round one only, every roster mode; the quick class selector (keys 1–5) is a HUD panel that lives in exactly this window |
| A camera that is not the player's | `ChopperCamera.cameraFor(chopper, aspect)`: `Game` *asks* once per render frame and renders through the answer or through the rig — *"nothing for Game to undo"* |
| Routes | `Pathfinder` over `NavGrid`, resumable and budgeted; `ModePanel.measureLanes` already solves spawn → centre synchronously with a large budget on the match's own instance; `LaneDef.center` is authored on all three real maps, three lanes each, *"where the two teams meet"* |
| Objectives | Foundry, Dunes and Depot each author **3 flags + 2 bombsites** (`MapDef.objectives`: kind, position, radius, label); Greybox authors none |
| Movement, for the camera | sprint 6.9 m/s (`MovementConfig`), eye 1.65 m (`PlayerState`); `CollisionWorld.overlapCapsule` is the one test movement uses |
| Save | `SAVE_VERSION = 3`; a `LoadoutSlot` has a `name`; nothing on the profile names a character skin |
| Wire | `MAX_PLAYERS = 10`; `EntitySnapshot` carries `weaponIndex` and `heightScale` and no character index; a body's skin is dealt client-side by `RandomCharacterSelector` from the entity id and a per-match salt |
| Client build | 1 370 kB raw / 391 kB gzip (M12's measurement; re-taken at Phase A) |

## Phase A — the frame, the menu, and the controls card moved

**A1, the scale.** `--ui-scale` on `#ui-root`, the 1920×1080 frame, the resize hook, the
third probe rule and the two new viewports, and the comment at `.op-screen`'s `overflow`
rewritten to say what replaced the rule and why — the B1/B2 reasoning is history now, and a
comment that argues for a rule the file no longer has is worse than none. Every existing
screen is run through the probe at the eight viewports **before** any screen is redesigned,
so the list of what overflows is measured rather than guessed; those screens are then fixed
in the phase that owns them, and the probe stays red on them until then — a red probe is a
finding, which is S8's rule for tests applied to an instrument.

**A2, the menu.** Two halves. **Right:** the navigation — PLAY (multiplayer, primary, one
click to the arena as §6.1 requires), PLAY SOLO (the mode/map/difficulty page, which becomes a
panel sliding over the same frame rather than a second page), CREATE A CLASS, SETTINGS — four,
not the reference's six: no ZOMBIES or STORE exists here, and QUIT is out (decision 7: a
browser tab closes itself). Each button is a `clip-path` polygon with a skewed leading edge, a `mask-image`
gradient that frays its trailing edge into the backdrop, and a hover sweep along the skew —
the "smeared" reading is three declarations and a pseudo-element, no image. The callsign
field, the profile line (level, class, record) and the status line move to a header strip at
the top right, where the references put the player card. **Left:** the backdrop, and the fade
between the halves is a `mask-image` on the backdrop layer — a canvas whose right and top
edges dissolve into `--c-void`, so the picture has no edge to read as a box.

**A3, the backdrop dolly.** The backdrop is the game's own renderer drawing a real map: the
map mesh, the sky dome and the particulate, with the camera on a slow dolly along one of the
map's authored lanes at eye height — the bots' own route, smoothed the way Phase C smooths (C
lands after A, so A ships with a straight dolly along `lane.a → lane.center` and takes C's
spline when it exists). **No simulation runs**: no `Match`, no bots, no bus subscriptions — the
world is `MapRender` + `SkyDome` + a camera, built through `MapBuildQueue` at its 5 ms budget
while the boot screen is up, which is what the queue was built for (§6.5). Which map: the one
the player last played (`save.mapId`), so the menu shows where they are going. This is the
whole of "the backdrop" for Phase A; the bodies and the shooting are Phase E, and the reason
they are separate is stated there.

**A4, the controls card.** `CONTROL_ROWS` and `FULLSCREEN_HINT` move from `Menus.ts` to a
fifth Settings tab, **INFO**, built from the live bindings exactly as they are today — M8's
reasoning (a card that says W A S D to a player on the arrow keys is worse than none) does
not change with the address. The reset control goes with them, keeping its two-step arm.
`Menus.ts` loses `resetArmed`, the card and the hint; `paintMain` becomes the two halves.

**Gate A.** `npm run layout` green at eight viewports on the menu, the play panel and the
settings; `npm run check` green; seeded harness and content probe byte-identical (nothing in
`shared/` moves); the client bundle re-measured and recorded. **Pane:** the menu at 1920×1080,
1366×626 and 1280×720, screenshots in the record; the dolly stepped by hand (`loop.frame`) and
its edge measured — a pixel column at the mask's boundary reads `--c-void` on the menu side.

### A1 — done (session of 2026-09-15): the frame, the rule, and the first measurement

**The frame.** `ui/Frame.ts`: `FRAME_WIDTH/HEIGHT = 1920/1080`, `frameScale(vw, vh) =
min(vw / 1920, vh / 1080)` (three vitest cases, no lower clamp), `applyFrameScale(root, vw,
vh)` writing `--ui-scale` onto `#ui-root`, and `createScreen(layerClass)` returning a
full-bleed **layer** and the 1920×1080 **frame** inside it. `.op-screen` is the layer now —
the backdrop, the blur, the z-order, `hidden`, and a flex centre for its one child; `.op-frame`
is the box: `zoom: var(--ui-scale)`, `overflow: hidden`, `justify-content: safe center`, the
padding. The five screens create theirs through it and append to the frame (`Menus`,
`LoadoutEditor`, `Settings`, `PauseMenu`, `EndOfMatch` — eight mount sites); `.eom`'s and
`.lo`'s `gap` moved to their frames. `Game` calls `applyFrameScale` beside `Renderer.setSize`
in the constructor and in `onResize`. The B1/B2 comment at `.op-screen`'s `overflow` is
rewritten to say what the rule was, why it is gone, and not to bring it back. `LoadingScreen`
(`.op-loading`, three elements on its own layer, the §4.18 fallback) and `VoteOverlay` (HUD)
are not in a frame: neither is a front-end screen, and neither has anything to overflow with.

**One departure from the brief, and why.** The brief put the zoom on `#ui-root`. It is on the
frame instead: `MatchFeedback` and `ClientMatch` place the HUD's hit markers and direction
indicators from `window.innerWidth` / `innerHeight`, in window pixels, and a zoomed `#ui-root`
would have moved every one of them by `1 / scale`. The HUD stays in window pixels and outside
the frame; the variable is still written on `#ui-root`, so a later phase can read it there.

**The rule.** `probes/layout.ts` asserts one thing now — *outside* (no laid-out element's rect
leaves the window; no scroll is tried first, and an element larger than the window is a
violation rather than a thing to skip) and *overflow* (any element whose `overflow` is not
`visible` on an axis has `scrollHeight <= clientHeight` and `scrollWidth <= clientWidth`;
a single-line ellipsis is exempt, being a designed truncation of one string). One finding per
cause: an element an ancestor clips is not also reported as outside — the first run of this
version reported one binding list as thirty-eight lines. Content sizes are reported in
**frame** pixels. `Viewports.ts` gains 1920×1080 (the frame, scale 1) and 1280×720 (the
floor) at the head of the list; the driver prints the scale beside each viewport and says
`fits its frame` where it said `fits or scrolls`.

**Measured — the tree as it was, under the frame, at eight viewports. The red list:**

| Screen | Frame px at 1920×1080 | Verdict |
|---|---|---|
| menu | 497 × 879 | fits |
| unsupported | 322 × 195 | fits |
| solo-setup | 840 × 568 | fits |
| settings/CONTROLS · AUDIO · VIDEO | 780 × 362 · 371 · 544 | fit |
| **settings/BINDINGS** | 780 × 1336 | **`.op-settings` scrolls — 1184 px of rows in a 605 px box** (`max-height: 56vh; overflow-y: auto`). A4's |
| pause | 431 × 496 | fits |
| summary · summary/ffa | 1040 × 476 · 644 | fit |
| create-a-class | 1240 × 931 | fits |
| **create-a-class/open-row** | 1240 × 1021 | **`.lo-options` scrolls — 606 px in a 319 px box** (B11's list) **and the frame clips the screen by 5 px** (1085 in 1080). B's |

`FAIL — 24 violations` over 96 screen × viewport cells: the same three causes on the same two
screens at each of the eight sizes, nothing else red at any. The probe stays red until A4 and
B close them; a red instrument is a finding (S8).

**Two things the frame found that the brief did not predict:**

- **A media query folds on the window, not the frame.** `meta.css` carried `@media (max-width:
  1080px) { .lo-columns { grid-template-columns: 1fr } }`; at 1024×640 the editor — still
  1920 frame px wide — folded to one column and ran to 1970 frame px, 81 violations at that
  one size in the first run. Deleted, with the reason in its place: nothing inside the frame
  may vary with the window.
- **`vh` and `vw` inside the frame are not the window's.** Chrome resolves a viewport unit
  inside a zoomed element in the element's own pixels: `56vh` on `.op-settings` is 605 frame
  px at 1920×1080 and 455 at 375×812 — the window's height, in frame units. Every `vh`/`vw` in
  front-end CSS (`.op-settings`' 56vh; `.sb`'s 94vw where the board is embedded) becomes a
  frame-pixel value in the phase that owns the screen, and none may be added.

**Uniformity, measured.** With the fold gone, a screen's frame-px height drifts under 1 %
across the viewports down to the floor (menu 879 at 1920×1080, 875 at 1280×720, 863 at
1366×626) and up to 10 % at 375×812 (965): text zoomed to two or three pixels rasterises to
whole ones. Below the floor the rule holds and the drift is the price of it; at and above the
floor the frame is uniform.

**Pane:** the real client at 1024×768 — `--ui-scale 0.533`, the frame 1024×576 at y = 96 with
equal bands, `scrollHeight = clientHeight = 1080`, no console error; resized to 1280×720 —
scale 0.667, the frame exactly the window; Create-a-Class opened, `WeaponPreview` rendering
inside the frame. **Gate:** `npm run check` green (**119** tests in 14 files; boundaries 350
files). Eleven files changed, all under `client/`, `client/probes/` and `scripts/`; nothing in
`shared/` or `server/`, so the seeded harness and the content probe — built from those two
partitions alone — are byte-identical by construction.

### A2 — done (session of 2026-09-15): the menu on the frame — and A4 with it

**A4 came with A2, not after it.** The brief ordered the menu before the controls card, and
the first thing the menu's layout showed was that it cannot be drawn *around* the card: a
fourteen-row key list has no place in a header, a stage and a footer. So the card, the
fullscreen hint and the reset control moved first (`KeyCard.ts` — `CONTROL_ROWS`,
`FULLSCREEN_HINT`, `buildKeyCard(bindings)`, built from the live bindings exactly as M8 built
it), into a fifth Settings tab, **INFO**; `MenuDeps` lost `bindings` and `onResetProgress`,
`SettingsDeps` gained `onResetProgress`, and the two-step arm went with it, cleared on `show`
and on every tab change. Gate A also names the settings screen, so the A1 red list's first
row was closed here too: `.op-settings` is no longer a `56vh` scroller — the 22 actions stand
in **three columns** (Movement · Combat · Equipment with Interface beneath), the tallest
eight rows, and the post-M8 `scrollTop` carry-over (`body`, `rememberScroll`) is deleted with
the scroller, there being no offset left to keep.

**The menu** (`Menus.ts`, 464 → 459 lines with the card gone). The frame is a grid — `head`,
`stage`, `foot` — under a layer that *fades* the backdrop rather than dimming it: left to
right, transparent over the canvas to `--c-void` under the navigation, with a second gradient
bringing the top edge down, and no blur (`.op-screen--menu`). **Header:** the wordmark, a
rule and `ARENA FPS` on the left; the player card on the right — the callsign as a name (no
box, a rule beneath, the accent while it is being written; still written to the profile on
every keystroke, still never a gate) with the profile line under it. **Stage:** the left half
holds nothing, because the canvas under it is the backdrop (A3's); the right holds the
navigation in a 600 px column, four buttons — PLAY (primary, disabled with its reason when no
server is configured), PLAY SOLO, CREATE A CLASS, SETTINGS — and no fifth: no ZOMBIES or
STORE exists here and QUIT is out (decision 7). **Footer:** the status line, bottom right.
`showBoot` and `showUnsupported` keep the plain centred frame: a one-line status has nothing
to navigate.

**The buttons are cut, not boxed**, and it is CSS alone: a `clip-path` polygon skews the
leading edge 26 px and pulls the trailing corner in 10; on the primary a `mask-image`
dissolves the leading 11 % into the backdrop instead of ending it on a line, with the
accent as a rule beneath; a skewed `::after` band sweeps the length on hover and on keyboard
focus. Four glyphs — play, a crosshair, a loadout list, sliders — are one `path` each in
`Menus.ts`, drawn through `makeIconSvg` for the reason `WeaponIcons` draws the rifles (no
image assets), filled with `currentColor` so they take the button's state. Chevron the same.

**Play Solo is a panel, not a page.** The three pickers and Back / Start match are a
`section.op-setup` (1000 px, accent rule on the left) that spans the stage and right-aligns,
so opening it moves neither the header nor the footer; it slides 16 px and fades over
`--dur-med`, and the frame's side padding is 64, so even the first keyframe is inside the
window — which is what lets the probe measure the panel on the frame it was inserted into
without waiting. `prefers-reduced-motion` turns the slide and the sweep off.

**Measured.** `npm run layout`, 13 surfaces × 8 viewports (INFO is the thirteenth):

| Screen | Frame px at 1920×1080 | Verdict |
|---|---|---|
| menu | 1792 × 1004 | fits — the header, stage and footer fill the frame less its padding |
| solo-setup | 1808 × 1004 | fits — 16 wider is the panel's first keyframe |
| settings/BINDINGS | 1240 × 701 | **fits** — was 1336 with a 1184-in-605 scroller |
| settings/INFO | 780 × 655 | fits — the card, the hint and the reset |
| settings/CONTROLS · AUDIO · VIDEO, pause, both summaries, create-a-class | unchanged | fit |
| create-a-class/open-row | 1240 × 1021 | the same two violations — B's |

`FAIL — 16 violations`, all sixteen the editor's open row at each of the eight viewports;
the menu, the play panel and every settings tab are green at every size, which is the layout
half of Gate A. **Pane**, the real client at 1024×768: the frame 1024×576, header 956 wide at
y = 117, the nav column at x 670–990, the player card at 841–990; PLAY SOLO opened — header
rect identical before and after, the panel at 465–998, three 264 px picker columns, *Start
match* focused; BINDINGS in three columns with Back on screen; INFO with the card, the hint
and *Reset progress*; no console error on any of them. (The pane's screenshot crops to
800 device pixels wide, so the right of the frame was verified by rect and by
`elementFromPoint`, not by picture; a red fixed-position probe at `right: 0` confirmed the
crop is the capture's, not the layout's.) **Gate:** `npm run check` green (119 tests;
boundaries 351 files). Six files, all `client/`; `shared/` and `server/` untouched.

**Needs a browser (the human's):** whether the leading dissolve and the sweep read as a
smear rather than a fade, on a real display at play distance; and the fade against a bright
map, which does not exist until A3.

### A3 — done (session of 2026-09-15): a world that is not a match, and Gate A closed

**`client/world/MenuBackdrop.ts`** (284 lines, 45 of them code the rest says why). A
`LoadedMap` plus `applyAmbient` plus the map's `Particulate` plus a camera this class moves —
the three things `MatchWorld` puts in the scene before it builds a player into them, and
nothing else: no `Match`, no bots, no `PlayerController`, no bus subscription, no navmesh
bake. Built through its own `MapBuildQueue` at the 5 ms budget, pumped from the render pass;
its `onComplete` takes the map and adopts it. Its own queue rather than `Game`'s, because that
one's `onComplete` reports readiness to a server for a match being prepared, and the arena is
`MATCH`, where this is already gone. `Game`: `MENU`'s `enter` calls `prepare(selection.mapId)`
— the map the solo picker names, so the menu shows where the player is going; idempotent for
the map already up — and `buildWorld` calls `dispose()` before it constructs a `MatchWorld`,
which is the whole of the rule that keeps the scene at **one map, ever**: the backdrop exists
only while `Game.world` is null. `draw`'s no-world branch renders the scene through the
backdrop's camera with no viewmodel, or clears the canvas while the map is still building,
exactly as it did before.

**The dolly.** The middle lane by index — the spine on all three shipped maps — from `a` to
`center` at 1.65 m (the player's eye), FOV 62°, a cosine push-and-pull at 0.55 m/s, a ±2.5°
sway over 14 s, pitch −2°. The straight line is checked before it is ridden: the segment is
sampled every 25 cm with a standing capsule against the map's own `CollisionWorld`, and the
dolly runs over the free prefix; under 4 m it holds at `a` and sways. A map with no lanes
(the greybox, the range) rides `spawns[0] → navBounds' centre`, `measureLanes`' fallback.
Phase C's spline replaces the line; the check stays.

**Measured, in the pane.** Dunes behind the menu: **34 chunks, 79 ms of work**, landing in
5–7 frames of 5 ms pumping once the texture cache is warm (11 on the cold first build). The
canvas at 15 % of the width reads **(111, 89, 64)** — the souk's sandstone, not the clear
colour (12, 14, 17) — and the menu layer's computed gradient is `rgb(7, 8, 10)` from 78 %
with `backdrop-filter: none`: the map on the left, the void on the right, no edge. The dolly
moves — two screenshots five seconds apart show the wall's end and the far beams closer.
The header sat on a sunlit wall, so the top fade went from 0.78 → 0 at 26 % to 0.9 → 0 at
34 % and the header text carries a shadow; whether that is enough on a display is below.

**GPU, with a new instrument.** `__p7.gpu()` reads `renderer.info.memory` (one console
entry, in DEBUG.md's list). Frames stepped by hand in the hidden pane (`loop.frame`, the
pane suspends rAF):

| Cycle | Result |
|---|---|
| Backdrop prepare → dispose × 10, Dunes | **32 geometries / 12 textures with the map, 0 / 10 without, every cycle identical**; the map ready after 7 frames each time |
| MENU ↔ MATCH × 6, backdrop *disabled* (the isolation run) | geometries flat, 15 at the menu and 67 in a match; **textures +7 per cycle**, 113 → 146 |
| MENU ↔ MATCH × 8, backdrop on, after the fix below | geometries flat, 35 / 55; textures **+2 per cycle**, 27 → 45 |

**Found while here — a leak in every map build since M4, not the backdrop's.** The
isolation run is the attribution: with the backdrop off, the match cycle alone grew the
texture count. The map's shadow-casting `DirectionalLight` was never disposed — `root.clear()`
takes it out of the scene, and `DirectionalLight.dispose` is what frees the render target the
first shadow pass allocates — so every build left a shadow map on the GPU. Fixed in
`MapRender` by pushing the light onto the map's own disposables (`d7482ff`, its own commit).
The +2 per cycle that remain are in the match path and unattributed; the recipe and the
suspects (`EquipmentFx`'s canvas texture, `WeaponMesh`'s, the indicators' dispose being
reached for every actor) are handed to a bug session rather than chased here.

**Bundle, re-measured.** **1 522.38 kB raw / 437.83 kB gzip, 49.63 kB CSS** (M12 recorded
1 370 / 391 / 43; M13's glTF and animation code sits between the two measurements, so the
frame, the menu and the backdrop are a small part of the difference and the 6.6 kB of CSS is
theirs).

**Gate A, closed.** `npm run layout` green on the menu, the play panel and every settings tab
at eight viewports (the sixteen violations left are the editor's open row, B's); `npm run
check` green (119 tests; boundaries 352 files); nothing in `shared/` or `server/` touched by
A1–A3, so the seeded harness and the content probe are byte-identical by construction.

**Needs a browser (the human's):** the fade against a sunlit wall at play distance, and
whether the wordmark holds on it; the dolly's speed and sway; which lane reads best per map —
Foundry's CENTRE is the hall, Dunes' the covered street, Depot's the night yard — a
`lanes[Math.floor(n / 2)]` today, a per-map choice if one of them is wrong.

### Playtest report (2026-09-15), fixed the same day: the frame's ramp

*"Everything except the main menu is too small — it strains the eyes."* Three screenshots at
1920 wide: Settings, the Play Solo panel, Paused. Correct, and the frame is why. The type
ramp in `tokens.css` — 10 / 11 / 13 / 16 / 22 / 40 — was tuned for a HUD and a responsive
front end, in *window* pixels; under the frame a token is a *frame* pixel, and at 1920×1080 a
13 px body and 10 px labels are the same numbers they always were, except that every screen
now sits inside a 1920-wide layout designed to be read from further away, and on a
1366-wide laptop the same tokens are 0.71 of that. The main menu escaped only because A2 had
sized its wordmark (40) and its buttons (20) for the frame by hand.

**The fix is a second ramp, scoped to the frame.** Custom properties inherit and every
front-end rule already resolves to a token, so `.op-frame { --t-*, --s-* }` in `tokens.css`
rescales every screen inside a frame and nothing outside — the HUD, the scoreboard overlay,
the killfeed and the debug layer keep the ramp they had. Type ×1.4 (**14 / 16 / 18 / 22 / 30 /
56**), spacing ×1.5 (a 6 px grid: 6 / 12 / 18 / 24 / 30 / 36 / 48 / 72). The fixed widths of
frame content scaled where they stand: `.op-settings` 780 → 1080, the binding tab 1240 →
1560, `.op-pickers` 840 → 1180 (three columns of ~370, `minmax(320px, 1fr)`), the Play Solo
panel 1000 → 1380, the pause stack and the code row 240 → 336, the slider track 220 → 320 with
a 90 px readout, the binding caps 96 → 132, inputs 180 → 250, the callsign 220 → 300, the
range thumbs 12 → 16. **Two screens are pinned to the old ramp** with the values restated on
their own frames — the editor (`.lo`, B rebuilds it; 931 tall at 13 px would not fit at 18)
and the summary (`.eom`, D's; the sixteen-row FFA board) — each with a comment saying which
phase deletes the pin.

**Measured.** At 1920×1080 the settings title is 56 px, tabs 16, labels and buttons 18, help
16, the settings column 1080 wide. `npm run layout` on the first run: BINDINGS **1021** tall
in the 1016-px box — one violation, the frame clipping it. The binding rows went one step
tighter (column gap `--s-2`, key caps padded `--s-1` vertically — a key cap, not a button):
**871**, green. The probe now reads menu 1792 × 1004, unsupported 446 × 277, CONTROLS 1080 ×
524, BINDINGS 1560 × 871, AUDIO 538, VIDEO 788, INFO 935, pause 626 × 723 — all green at
eight viewports; `FAIL — 16 violations`, still only the editor's open row. "Reset all
bindings" had stretched to the 1560 px column and is label-wide now. `npm run check` green.

**Needs a browser:** whether 18 / 16 / 14 is enough at the distance the human plays from —
it is a 40 % step and the smallest text is now 14 — or whether the ramp wants one more step
(20 / 17 / 15), which the INFO tab's fourteen-row card would then need two columns for.

## Phase B — Create-a-Class: the stage, six boxes, the strips, the skins

### B0 — done (session of 2026-09-15): the skins at a twentieth of their weight

**What the weight was.** Read from the GLBs without a parser package (`scripts/glb-images.mjs`
— a `.glb` is a header, a JSON chunk and a binary chunk the images sit in): Viper, Echo and
Hazard carried two or three material sets each with a **2048×2048 PNG normal map and a
2048×2048 PNG diffuse, 6–8 MB apiece**; the four light skins carried the same maps at 1024
(1–1.6 MB). Geometry was never the cost — 24–32 k vertices is 1.5–1.9 MB. Every material in
the library is `OPAQUE` metallic-roughness with `KHR_materials_specular`, so nothing reads an
alpha channel.

**The pass.** `scripts/skin-compress.mjs`: `gltf-transform resize` to at most 1024 on a side
(Lanczos3, never enlarging) and `gltf-transform jpeg` at quality 88 over the PNGs, through
`npx` at a pinned `@gltf-transform/cli@4.5.0` — run once, not a build dependency (S2 holds).
It replaces a file only if `rigSignature` — node names in order, joint counts, animation
names and channel counts — is byte-for-byte the same before and after; all seven were.
**109.0 MB → 17.3 MB**: Apex 4.38 → 1.62, Echo 28.24 → 3.95, Hazard 37.56 → 3.85, Pulse
4.45 → 1.49, Rhino 4.93 → 1.52, Sentry 5.15 → 1.65, Viper 24.26 → 3.21. The default skin
stays `echo`, now 3.95 MB — decision 5's "a 4 MB skin as the default" is met by the skin
that was there. `CHARACTER_VERSION` moved to `2026-09-15-skins-jpeg` so a client holding the
old bytes fetches the new ones.

**The gate.** `scripts/check-skins.mjs`, `check:skins` in `check` after `check:animations`:
every catalogued skin exists and every shipped one is catalogued; none over **5 MB**; no
texture over 1024 on a side or a PNG — the last two so the message names the cause and the
script to run. Proved red on the shipped tree before the pass (65 problems: three skins over
the limit, every 2048 map, every PNG) and green after: `7 skins, 17.3 MB in all, 47 textures`.

**Measured in the pane:** a solo match on Foundry loads all seven re-encoded skins (`GLB
character template … is ready` × 7), nine actors drawn, no console error. `npm run check`
green (119 tests). **Needs a browser:** JPEG at 88 on a normal map — whether a seam or a
block shows on a body at play distance is a display question; the quality constant is one
number in the script.

**B1, the stage.** Left half: the selected skin on a lit disc, `idleWeaponReady` looping,
holding the class's primary through the weapon socket (`CharacterSkin.setWeapon`, the call
the match makes), turning at 0.1 rad/s with the two arrows below it to grab. Rendered
exactly as `WeaponPreview` renders the gun — its own scene, its own renderer, built on the
first tick, disposed on exit. The skin loads through `CharacterAssetService.preload` on
selection; until it resolves the disc holds the skin the stage last showed, and the default
is preloaded at boot, so the first paint is never empty (decision 5 is about how long that
first paint waits). The stat panel does not leave the screen — M6 called `LoadoutStats`
*"the point of the screen"*, and that has not changed — it becomes a compact strip under the
weapon strip's tabs, visible while a weapon box is open.

**B2, six boxes.** The right column: **PRIMARY** (silhouette, name, camo swatch),
**SECONDARY**, **EQUIPMENT** (lethal + tactical), **PERKS** (three icons), **KILLSTREAKS**
(three icons, each labelled with its key), **FIELD UPGRADE**. Each shows only what is
equipped. Six boxes under the header in a 1080 frame is 120 px each — room for an icon and
two lines; fourteen would have been 60. The five class slots are tabs across the top right,
where the reference puts them, and the slot's `name` is edited in place beneath them.

**B3, the strips.** Clicking a box opens one strip beneath it — the in-place model B11 built
(`refreshers`, one `openRow`) kept, the elements re-shaped — with the boxes above staying
put. A weapon box's strip has three tabs: **WEAPON** (the list, paged at the strip's width),
**ATTACHMENTS** (per slot, the fit rules unchanged), **SKIN** — the reference's word for what
this project has called camo since M5; the label changes, `CamoId` does not. Equipment's
strip has LETHAL / TACTICAL tabs; Perks' has 1 / 2 / 3; Killstreaks' has 3 / 4 / 5. A strip
longer than its width is **paged**, never scrolled — the arrows at each end are the
reference's, and the probe is what holds it to that. Locked items keep M5's rule: drawn with
their requirement, never hidden.

**B4, tooltips.** One tooltip element on the screen, positioned by the hovered item, filled
from the def's existing `blurb` (perks, equipment, field upgrades, streaks and attachments all
carry one). It never leaves the frame: it flips above when below would overflow, which is a
rect test, not a guess.

**B5, the skin picker.** CHANGE A SKIN at the bottom left, opening a horizontal strip of the
seven skins with a thumbnail each. **The thumbnails are generated, not loaded:** rendering
seven live models to fill a strip means fetching 109 MB to open a menu, so
`scripts/skin-thumbs.mjs` drives the headless Chrome that `layout-probe` already knows how to
find, renders each skin once to a 160 px canvas and writes
`public/models/bots/skins/thumbs/*.png` — committed, ~15 kB each, regenerated when a skin
changes, and `check:animations`' folder rule extends to them: a skin without a thumbnail
fails the gate. Picking writes `skinId` to the profile — `SAVE_VERSION` 4, a migration in
`SaveData.ts` with its test — and the stage reloads. **Local-first (decision 2):** the picked
skin is what the stage and Phase D's lineup show; other players still see the dealt body. The
wire step is **B6**: a `characterIndex: u8` on `EntitySnapshot` and on the join,
`RandomCharacterSelector` becoming the fallback for a body that declared none — a
`shared/net` change with `check:authority` and the netharness over it — taken in this
milestone if B1–B5 land with room, else the first item of the next.

**Gate B.** `npm run layout` green on the editor at eight viewports with every box's strip
open in turn — the probe mounts the editor and opens each box, because a probe that measures
only the closed state measures the easy state; `check:unlocks` and `check:cosmetics` green;
`progression` byte-identical (the editor's gating is a courtesy over `sanitiseLoadout`, and
this phase must not have moved it); the pane, 50 cycles of MENU → LOADOUT → MENU with
`renderer.info.memory.geometries`, `.textures` and the bus's live count flat.

### B1–B4 — done (session of 2026-09-15): the stage, six boxes, the docked zone, the tooltip

**The stage** (`ui/CharacterStage.ts`, 307 lines). The figure is an `ActorAvatar` from
`CharacterAssetService.avatarProvider(def).create()` — the object `BotRenderer` makes for a
body in a match — driven each tick by `update` with a standing, armed, idle
`ActorAnimationInput`, which the selector answers with `idleWeaponReady`; the weapon in its
hands is `buildHeldWeapon` with the shared gunmetal, a bot's own asset. So the operator on
this screen is the one other players see, by construction. It stands on a plinth with an
accent ring (two primitives, no texture), turns at 0.1 rad/s, can be dragged, and the two
arrows nudge it an eighth of a turn with an ease. Its own `WebGLRenderer` on its own
860×800 canvas, built on the first tick as `WeaponPreview`'s is, its backing store sized
from the on-screen rect so a frame at 0.58 does not rasterise 860×800 to show 500×464. The
first paint faced the camera at its back — a body at yaw 0 faces −Z — so the turntable starts
at a half turn. `LOADING OPERATOR…` is written from `tick`, because the body arrives between
edits and a refresher only runs on one.

**Six boxes** (`LoadoutEditor.ts`, 864 → 1 173 lines with the zone, the pager and the tooltip
in it): PRIMARY and SECONDARY (the weapon's own silhouette from `iconFor`, its name, its
finish, its attachments as chips), EQUIPMENT (lethal + tactical), PERKS (three chips, `—`
for an empty tier), KILLSTREAKS (three, the box's tab labels carry the keys), FIELD UPGRADE.
70 px each: six of them, the 16 px gap and the 430 px zone are 916 of the column's 928. The
five class slots are tabs across the header with the equipped one marked, the name field
and Equip beside them, the level and *Save and exit* at the right; the frame's padding is
32/48 here rather than 48/72 because this screen has the most on it.

**The zone is docked, not dropped.** A box's options open in one place, under the column,
with tabs where a box holds more than one list — WEAPON / ATTACHMENTS / SKIN, LETHAL /
TACTICAL, PERK 1 / 2 / 3, KEY 3 / 4 / 5. The reference drops the strip directly under the box;
under a rule that nothing may leave the frame, a strip under KILLSTREAKS would push FIELD
UPGRADE off the bottom or cover it, and one that flips above its box for the last two rows is
a strip in two places. So opening PERKS does not move KILLSTREAKS, and the frame never grows.
Tiles are four across, two rows over the stat band or three without, and a longer list is
**paged** — the pager shares the tabs' row, because a row of its own was 28 px the zone did
not have. The **stat band** is `LoadoutStats` restyled to five columns of four lines (the
reference has no stat panel; M6 called this one *"the point of the screen"*, and it stays);
the **SKIN** tab shows the finish on the `WeaponPreview` in the band, because a held weapon
is one shared material and does not carry a camo. B11's mechanism is kept whole — one
`paint()` per `show()`, refreshers, truncation on close — and its test is now that the open
zone's *page* survives an edit: picking VULCAN 74 on page 1 of 2 changed the box, the
profile and the operator's hands and left the pager at 1 / 2.

**The tooltip** (B4): one `.lo-tip` on the frame, moved to whichever chip is hovered or
focused, filled from the def's `blurb`, positioned in frame pixels (window rects divided by
the frame's scale) and flipped above when below would leave the frame. `+7% movement speed`
under LIGHTWEIGHT, measured at (1058, 429).

**Measured.** `npm run layout`, now 21 surfaces × 8 viewports — the editor closed, every box
open, the weapon box on each of its three tabs: **`PASS — every surface fits its frame`**,
the first green run under the no-scroll rule. Getting there was four probe runs: the first
zone at 400 px held 575 of content (the pager on its own row, the stats in four columns, and
`openBox` not refreshing so twelve tiles showed instead of eight); the third fit by one pixel
at 1920×1080 and was over by 4–15 at every smaller viewport — text zoomed to a fraction
rasterises to whole pixels, so a screen that fits by a pixel at scale 1 does not fit at 0.6,
and the zone now carries **5 % of slack** by design. Two tile-level findings on the way: the
heavy capitals overran their line box by two pixels under `overflow: hidden` (`line-height:
1.45`, `flex: none`), and the probe learned that a `-webkit-line-clamp` is a designed
truncation like an ellipsis. `npm run check` green (119 tests; `check:unlocks` still finds
all six requirement accessors in the picker). **Pane**, 1920×1080: the operator on the disc
holding the M4, the six boxes with their chips, the zone with eight weapon tiles and the
band; SKIN with seven camo tiles and the preview; no console error.

**Found while here — the +2 textures per match cycle, closed.** The stage's show/hide cycle
grew *its* renderer's texture count by two per cycle (15 → 73 over 30). `SkeletonUtils.clone`
gives every skinned mesh its own `Skeleton`, a `Skeleton` uploads its bone matrices as a
`DataTexture`, and `CharacterSkin.dispose` never disposed them — which is also where A3's
unattributed +2 per MATCH ↔ MENU cycle came from, every retired body leaving two behind.
Fixed in `CharacterSkin.dispose` (`cb4399a`, its own commit): stage **5 g / 11 t flat over
30 cycles**, MATCH ↔ MENU **35 g / 25 t flat over 6**. Two GPU leaks in one milestone, both
found by an instrument that did not exist a day ago.

**Needs a browser:** the stage's key light on the darker skins; whether 0.1 rad/s is the
right idle turn; the tile blurbs at two lines on a real display.

### B5 — done (session of 2026-09-15): the skin picker, and the thumbnails rendered once

**The save.** `settings.skin: string` — a setting beside the callsign rather than a profile
fact, because it is the same kind of thing (who the player looks like) and a progress reset
keeps settings: a wiped level should not also change a face. `shared/` holds the name only;
`Profile.skinId` is the one reader that checks it against `BOT_CHARACTER_IDS` and falls back
to the default for a name the catalogue does not carry. **`SAVE_VERSION` 3 → 4**, `upgradeV3`
dressing an older save in `DEFAULT_SKIN_ID` — the M8 kind of bump, where `normaliseSave`
would have defaulted the field anyway and the migration exists so that *"a v3 save loads
wearing the skin it was always shown"* is a tested sentence: two new cases in
`SaveData.test.ts` (v3 → v4 with everything else intact; a v4 naming `viper` keeps it, a
blank falls to the default). `DEFAULT_SKIN_ID` lives in `shared/` and the client's
`DEFAULT_CHARACTER_ID` is that name asserted against the catalogue at module load — one
fact, checked at the seam rather than restated.

**The thumbnails are rendered, not loaded.** `probes/skin-thumb.html` +
`client/probes/skinThumb.ts` put one skin on the editor's own `CharacterStage` — same
lights, same disc, same lens — held at a three-quarter pose (`hold(angle, distance)`, the
stage's one concession to a script) and read back as a PNG (`snapshot`, in the same task as
the draw); `scripts/skin-thumbs.mjs` drives it through the headless Chrome the layout probe
uses and writes `public/models/bots/skins/thumbs/<File>.png`. Software WebGL on purpose, so
the bytes are the same on every machine that regenerates them. **Seven renders, 50–71 kB
each, 335–647 ms each**, committed. The Chrome plumbing — `findChrome`, `Cdp`, `evaluate`,
the dev server, the launch, `withPage` — moved out of `layout-probe.mjs` into
`scripts/headless-chrome.mjs` for both to share; the probe driver is 95 lines now (was 310)
and does what it did. `check:skins` gained rule 4: every skin has its thumbnail.

**The picker.** CHANGE A SKIN over the foot of the stage's canvas — the strip opens *upward
over the picture*, so the column's height is the same open and closed and the frame never
grows — seven tiles of thumbnail and name, the chosen one in the accent. Picking writes the
profile, puts the new body on the disc and marks the tile; the canvas's arrow bar is pinned to
the column's foot (`margin-top: auto`) so the toggle stands in the room between it and the
canvas rather than on it. `CharacterDefinition` gained `name` and `thumbUrl`, both versioned
with the skin. **Local-first (decision 2):** the stage and, in D, the lineup show the pick;
other players see the dealt body until B6.

**Measured.** `npm run layout`: **22 surfaces × 8 viewports, PASS** (the strip open is the
twenty-second). `npm run check` green — **121 tests**, `check:skins` reporting every skin
with a thumbnail, `check:flags` with the probe's `?skin` declared undocumented. **Pane**,
1920×1080: the strip's seven `<img>`s at 320×400, ECHO marked; VIPER picked — `settings.skin
= "viper"`, the save at v4, the stage on `viper`, the bar at y 992–1048 under the strip's
980; ECHO restored. No console error on a fresh load.

**B6 — the wire — is not taken.** B1–B5 landed with the phase's budget spent on two GPU
leaks and a probe that is green for the first time; B6 is `shared/net` (`characterIndex: u8`
on `EntitySnapshot` and the join, `RandomCharacterSelector` becoming the fallback for a body
that declared none) with `check:authority` and the netharness over it, and it opens the
milestone's only `shared/` change. It is the first item of whatever comes next, per the
brief.

**Needs a browser:** the thumbnails against the strip's dark tiles on a real display; whether
a portrait at a third of its size still reads which skin is which (Apex and Sentry are the
close pair).

## Phase C — the match intro: a camera the freeze already pays for

**Where it plays, and what it hides.** The brief calls this a hidden loading screen. In this
project there is nothing to hide: the connected path builds the next map during the previous
match's summary and warmup (§6.5) and adopts it at the transition, and the solo path builds
it before `MATCH`. What there *is* is the round-one freeze — ten seconds in which the player
stands at spawn unable to move, ten rather than three (`MatchFlow.ts`) so there is time to
read the quick class selector. The intro plays over that: **client-only presentation over a
built world during a freeze the server already runs.** Conditions: `flow.currentPhase ===
'WARMUP'`, `flow.round <= 1`, not the warmup arena (§6.1's lobby), not the Shooting Range, and
the world built — if the fallback `LoadingScreen` is up, there is no intro. Nothing goes on
the wire; the server does not know it happened.

**The timeline** is driven by `flow.phaseSecondsRemaining`, not a local clock, so a client
that joined with four seconds left gets four seconds of intro and the FIGHT cue lands on the
player's own eyes regardless. Budget, of the 10 s: **Phase 1 ≤ 4.0 s, Phase 2 1.5 s, Phase 3
≤ 3.0 s, return blend 0.5 s, and 1.0 s of the player's own view before the freeze lifts** —
the last is not negotiable; a player looking through a cinematic camera when the round goes
live has been ambushed by their own UI. TDM, FFA and Kill Confirmed have no Phase 3 and hold
the overview instead.

**Phase 1, the approach.** The route is the bots' route: a second `Pathfinder` over the
match's `NavGrid` (its own arrays, so the bots' queue is untouched; disposed after), solved
synchronously with `measureLanes`' budget from `nav.nearestCell(spawn)` to the **map centre —
the `navBounds` centre snapped to its nearest walkable cell**. The waypoints become a
Catmull-Rom spline; the eye rides it at 1.65 m over the cell surface; yaw follows the tangent
with a 0.3 s lag and pitch holds −6°; speed is a distance/time profile with an ease at each
end and a ceiling of 9 m/s against a 6.9 m/s sprint. A route longer than 4 s at the ceiling
is trimmed from the spawn end, not sped up — the approach reads as a person moving, or it
does not read.

**Phase 2, the overview.** From the centre, a pull-back along a 45° elevation ray whose
azimuth points from the centre toward the player's spawn — so the player's own side lands at
the bottom of the frame, which is the reading "this is where I am" — to the distance at which
the `navBounds` half-diagonal fits the vertical FOV. Computed from the bounds and the lens,
not tuned per map.

**Phase 3, the objectives.** Domination: the flags in label order, A → B → C; Search &
Destroy: the two bombsites, A → B. From the overview the camera drops to 3 m over the first
objective in 0.6 s with an ease-out (the snap), holds 0.4 s with the objective's label in the
HUD, then travels to the next along a nav route at eye height with the speed profile
inverted — ease-in, up to 40 m/s in the middle, ease-out into the hold — which is what a whip
is when it is not allowed through walls. Routes here are solved the way Phase 1's is; a route
the grid cannot find (two sites on disconnected surfaces) falls back to an arc *above* the
map, never through it.

**The return.** 0.5 s from the last pose to the rig's eye — position lerped, yaw and pitch
the short way round — ending exactly at the 1.0 s mark. Any bound action or mouse button
skips to the return blend; keys 1–5 do not, because the quick selector is the reason the
window exists and a class pick must not cost the player the overview.

**The seam.** `IntroCamera.cameraFor(intro, aspect)` in `client/`, asked in `Game`'s render
pass before the chopper, the same shape and for the same reason (there can be no chopper in a
freeze, but the order is a fact rather than an assumption). While it answers: no viewmodel,
no crosshair, no compass; the mode title, the objective labels and the quick selector stay.
`MotionBlur` is left as it is.

**Gate C.** A harness, `npm run intro`, beside `readability`: for every map × mode, bake the
navmesh, solve the three phases, sample the whole camera path at 0.25 m and assert **zero
samples inside a collider** (`overlapCapsule` at 0.3 m) and **total time within budget**;
prints the route lengths and the trims. Pure `shared/` geometry, so it runs on the server
build with no browser. The timeline arithmetic is a vitest test. `npm run check` green;
seeded harness byte-identical (the harness never renders, so the intro never runs there).
**Needs a browser:** whether the whip reads as a whip and whether −6° is the right pitch are
display questions.

### Between phases — a report from the chopper (2026-09-15), fixed the same day

*"When I activate the Chopper Gunner and look through its thermal camera, the character
bodies are completely invisible. I can only see their weapons floating in the air."* Correct,
and the suspicion in the report was right: the three thermal override materials share
`GUNSHIP_VERT`, which round 2 taught to apply `instanceMatrix` by hand and nobody taught to
skin. three sets `USE_SKINNING` from the object, not the material, and a vertex stage that
reads `position` raw draws a `SkinnedMesh` unposed, in rig space — nowhere the optic looks.
The held weapons are plain meshes in the hand bone's frame and were right all along, which is
what made the report read the way it did. **Measured on Dunes from the chopper, the same
frame, the shader swapped in place:** the one enemy in the open reads **50/81 hot pixels at
its torso with the fix and 9/81 (the weapon) without**; 81 hot pixels on screen against 9.
Bodies under the covered street stay occluded, as the depth pass intends. `723630a`, on its
own. The instrument was `gl.readPixels` on the game's own canvas from the pane, projecting
each body's torso through the chopper's camera — no screenshot was needed, which is as well,
since the pane could not take one.

### C — done (session of 2026-09-15): the intro, planned, proved, and played

**The plan** (`shared/cinematic/IntroPlan.ts`, 885 lines): pure geometry — loose numbers,
`simSin`/`simCos`, no `three`, no clock — so the same function runs in the client on the
freeze's first frame and in the harness on the server build. Three phases in one budget:
of the ten seconds, **1.0 is the player's own view** and **0.5 the blend back to it**; the
plan's segments fill the 8.5 that remain. **Approach** ≤ 3.5 s: the bots' route (a second
`Pathfinder` over the match's `NavGrid`, solved synchronously with `measureLanes`' budget)
from where the player *stands* — the spawn de-penetrated with the player's own capsule, the
way the sim does it on tick one — to the nav bounds' centre on its nearest walkable cell, at
1.65 m, a smoothstep profile whose peak is 9 m/s, **trimmed from the spawn end** past
21 m rather than sped up. **Overview** 1.5 s: a pull-back from the centre to the distance
at which the map's half-diagonal fits a 60° lens, along the clearest of a fan of rays — the
spawn's azimuth at 45° when it reaches 80 % of the way, else twelve azimuths at three
elevations, each *marched with the eye's own sphere* rather than cast as a line, because the
first line ray passed the edge of Foundry's bridge deck by a centimetre and the eye did not.
**Objectives** ≤ 3.5 s: the pull-back *reversed* (0.5 s, clear because the pull-back was),
then a whip along the nav route at eye height to each objective's stand-off (4 m back along
the arrival, 3 m up, the first of five stand-offs the eye finds clear), a 0.3 s hold with
the label, on to the next; the speed profile inverted, peak 40 m/s, a whip capped at 1.0 s;
a route the grid cannot find falls back to an arc above the map (**none did**); an
objective that would overrun the budget is left out. Domination visits **A → B** — the
third flag does not fit 3.5 s at 40 m/s on any shipped map, and the plan says which it
visited; Search & Destroy visits both sites. The deathmatch modes hold the overview.

**Three things the geometry taught, all found by the harness before a frame was drawn:**

- **A Catmull-Rom cuts corners into crates.** The first spline's first bad sample was 0.95 m
  from the nearest waypoint, inside the crate the route was string-pulled around. The route
  is a polyline with 12 cm fillets now; the *heading* is what the eye smooths (a 0.3 s lag on
  the approach), not the position.
- **The bots' route mantles.** Two waypoints a ledge apart are joined by a line the capsule
  is carried through; the camera on that line went through Foundry's box 31 at head height.
  Where the rise exceeds a step the camera goes *up first*, over the lower waypoint, then
  across — and the mirror for a drop.
- **The route hugs corners at the capsule's clearance, and the eye is in the capsule's top
  cap.** At 1.65 m a 0.35 capsule is 0.287 wide, so an eye sphere of 0.3 flagged the route
  the bots walk by millimetres. `EYE_RADIUS` is **0.25** — twice the lens's 0.12 near plane —
  and a `relax` pass pushes any tabulated point the sphere still touches off it with the
  movement system's own `resolveAt`, up to four rounds and 30 cm, then retakes the table;
  a plan reports how many it nudged (one to three, typically).

**`npm run intro`** (`server/intro.ts`, 166 lines; `intro` in `vite.server.config.ts`):
every map × every roster mode × every spawn zone — **299 plans** — collision and navmesh
baked as `MapBakery` bakes them, sampled every 25 cm, asserting zero samples inside a
collider and every phase inside its budget; `--debug` names the collider the first bad
sample is in. The first run failed **106 of 299**; four fixes later, **`INTRO CHECK PASSED —
299 plans`**, 104 of them with objectives (52 A → B, 52 the two sites), 283 approaches
trimmed, 0 arcs. The timeline arithmetic and the Foundry plan are four vitest cases
(`IntroPlan.test.ts`): the budgets phase by phase, the deathmatch hold and S&D's two sites,
the eye clear of every collider from the first spawn, `poseAt` continuous across every seam.

**The client** (`client/cinematic/IntroCamera.ts`, 250 lines). `Game` asks
`introCamera.cameraFor(world, rig, aspect)` once per render frame, before the chopper — the
same asked-not-pushed shape — and while it answers renders the scene through it with no
viewmodel and `hud.setIntro(true)` (`hud--intro` takes down the crosshair, ammo, health,
the tactical strip, the compass and the minimap; the header, the banner and the quick
selector stay). Eligible only for `WARMUP` in round one, not the arena, not the range; the
timeline is `flow.phaseSecondsTotal − phaseSecondsRemaining` (the getter is new on
`MatchFlow`), so a late joiner gets the tail; planned on the first eligible frame and
played once per world. Three blends the plan does not know about: 0.35 s from the rig's eye
into the plan (a push, not a cut — the trim can start it 20 m up the route), 0.5 s back, and
the lens with it, 90° → 60° → 90°. Any key or button skips to the return blend; the digits
that pick a class and `Escape` do not.

**Measured in the pane** — Dunes, Domination, from spawn A, frames stepped by hand: the plan
`approach 3.30 · pullback 1.50 · snap 0.50 · whip[A] 1.00 · hold 0.30 · whip[B] 1.00 · hold
0.30 · hold 0.60 = 8.50 s`, objectives A → B, overview 95 m. The camera at t = 0.05 in the
rig's eye at (−25, 1.7, 32.6) and 88°; t = 2.7 at the centre at 1.6 m; t = 4.7 at
(−41, 69, 53), the overview; t = 5.4 back at the centre with the label A; t = 6.05 at A's
stand-off; t = 8.05 at B's; t = 8.73 blending back at 74°; **t = 9.40 `active = false`,
90°, at the eye, `hud--intro` off** — a second before the freeze lifts, as the budget says.
**Seeded harness normalised-identical** before and after (stash → build → run; pop → build →
run; 142 lines, `t`/`pid`/`simMsMean`/`heapMb` stripped): the harness never renders, and the
one `shared/` seam it can see, `MatchFlow.phaseSecondsTotal`, is a getter. Content probe:
not re-run; nothing under `modes/` or `maps/` changed. `npm run check` green, **125 tests**.

**Found while here — two spawn zones authored against a crate.** Foundry B (−27, 2) and
Depot B (−28, −19): the eye at the zone's position is inside a rotated 6 × 2.6 m crate,
half a metre deep on Depot. The sim de-penetrates the body on its first tick, so nobody has
noticed; the plan starts from the de-penetrated point for the same reason. The zones should
move; a map-data fix, not this phase's.

**Needs a browser:** whether the whip reads as a whip; whether −6° on the approach and the
60° lens are right; the overview's azimuth on Foundry (the fan picked a 75 m ray — which
one, a display will say); and the push out of the eyes at 0.35 s. The pane could not take a
screenshot this session, so the record is poses and pixels, not pictures.

**Gate C is where this stops**, as asked. Phase D — the end of the match — and B6 are the
open items; E after D.

### Between phases — the spawn zones (2026-09-15): seven, not two

The brief named two — Foundry B (−27, 2) and Depot B (−28, −19), the intro harness's first
bad sample on each map. Measured before moving anything, with the standing capsule (r 0.35,
h 1.8) at every zone's authored centre on every map: **seven zones in a solid**, from four
authored positions. Both maps author team A's half and rotate it; the props are
rotationally symmetric and the zones were written mirror-symmetric, so the east flank of
each carries a container where its west twin has open floor. Foundry `put(26.5, −2)` was
10 cm inside the container at (25, −4), `put(26.5, 14)` 10 cm into the corner of the one at
(25, 17); Depot `put(28, 19)` 0.6 m inside the stack at (27, 20); Testbed A (−22, −10) 15 cm
into the west end of the bay divider, under a comment that says every zone is open floor.
The sim's first-tick de-penetration had hidden all seven; the selector snaps every jittered
sample to a nav cell, so only sample 0 — the authored point — ever stood there.

**Two `B:` commits** (`68e8bfd` the brief's two, `966307a` the other three), each placed
by a horizontal clearance sweep against the west twin's number: Foundry's flip zone into
the back alley behind the spine at **(27.6, −2)**, 1.05 m each side — the alley is the
lane's designed feature and it keeps the author's 12 m spacing from B's flank; the flank
to **(26.5, 11.5)**, 2.2 m to the wall like its twin; Depot to **(28, 14)**, the stack's
foot, 1.7 m like its twin; Testbed to **(−22, −11.5)**, 1.4 m. The capsule test reads
**0 hits** after.

**The one place in M15 where byte-identical is not the claim, measured both ways.**
`npm run content` (stash → build → run; pop → build → run): exactly the moved zones and
their rotated twins — four lines, then three. Seeded harness (5 TDM on Foundry, 141
lines): lines 1–92 identical — mode briefs, roster deals, XP shapes, the bake — and the
35 line-pairs after are the match outcomes, **structure identical with every numeral
stripped**. `npm run intro`: **299 PASSED** both times, the diff only the moved zones'
rows (Foundry's alley plan is the same 21 m route; Depot's approach 5 m nearer, trimmed
12 m not 18). `npm run check` green, 125 tests.

## Phase D — the end of the match: the lineup and the accordion

**D1, the lineup.** Top half: the winning team — in Free-for-All the top three — on a stage,
MVP centre and a step forward, each a `CharacterSkin` wearing the body the match dealt them
(`characterSelector.characterIdFor(entityId)` from the world's own selector, so the body on
the podium is the body you shot; the local player's is their picked skin once B5 lands),
holding their last weapon, `idleWeaponReady`, nameplates in team colour beneath. A full lobby
puts five on the stage; the frame has room for five at 1920. The scoreboard does not leave: a
SCOREBOARD toggle flips the top half between the lineup and the board the player has held Tab
on all match — the same `Scoreboard` instance, as S6.5 insists.

**D2, the accordion.** Bottom band, fixed height, bottom-anchored. Collapsed: the total XP,
the level bar and the level number — and the existing `XpSummary` animation plays *there*:
rows land, the bar fills behind them, a level-up interrupts, exactly as S6.1 built it; only
the rows are hidden until asked for. Expanded — on click, or on its own when the cadence
finishes — the row list grows **upward** inside the band (`max-height` animated on a
bottom-anchored list) to a ceiling the frame sets, so the page never moves and the probe never
sees an overflow. The unlock list (weapon levels, challenges, camos) is the accordion's last
rows. The buttons — CONTINUE, and EXIT where there is a server, as round 4's B4 settled — sit
in the band's right end and never move.

**Gate D.** `npm run layout` green on the summary at eight viewports, collapsed and expanded,
with 2, 6 and 10 players (the probe already mounts it with fixed rows); `progression`
byte-identical (the numbers the accordion shows are `XpReport`'s, and this phase does not
touch `XpRules`); the pane, the S6.1 cadence timed against its constants.

### D — done (session of 2026-09-15): the lineup, the toggle, the accordion

**The stage is B1's, with a list on it.** `CharacterStage` (327 → 475 lines) takes `StageOptions`
— the editor's disc and turntable are the default, so `LoadoutEditor` and the thumbnail
script are untouched — and a list of `StageFigure`s: `show(id)` is a lineup of one, and
`showLineup(figures)` the same list with five. `LINEUP_STAGE` is an 1824×560 canvas, a
6.8 × 2.6 m platform with the ring's accent as a frame round its edge, a lens 5.3 m back
(6.2 left the bodies a quarter of the height, measured in the pane), and no turning. Every
figure is the same `ActorAvatar` a match draws, `idleWeaponReady`, holding `buildHeldWeapon`.

**Who stands where** is `ui/Lineup.ts` (97 lines, nine vitest cases): `lineupOf` — the
winning side in ladder order, Free-for-All's top three with the crowned winner pinned first
for `personalOutcome`'s reason, a draw's best five — and `slotPositions`: the MVP centre and
0.45 m forward, the rest fanning out by rank at 1.25 m, the flanks turned in. **What each
wears and holds** is `LineupSource`, answered by `Game`: the world's own
`RandomCharacterSelector` (kept on `Game` for the world's life), `profile.skinId` for the
local player, and the weapon in each entity's hands from `Match.actorsForRender` — the
renderer's own supplier, exposed once — or `weapons.definition.id` for the local player.
**Nameplates** are DOM, in viewer-relative team colour (`relationTo`, the board's rule),
placed under the feet by `projectToCanvas` through the stage's lens — pure arithmetic, so
the probe measures them on a page that never draws. **The toggle** is two tabs over the
same `Scoreboard` instance; `.eom .sb--embedded` is 1600 wide so the blocks stand side by
side at the frame's ramp.

**The accordion.** `XpSummary` (352 → 446) is a bottom-anchored column: the strip — one
`<button>`, LEVEL · bar and label · total · chevron — and the list above it, `hidden` until
it opens. The cadence is the constant it was: rows land on `ROW_INTERVAL` into the hidden
list, the bar fills behind them, a level-up interrupts with the flourish now absolute over
the strip. `open()` un-hides, reflows at `max-height: 0` and transitions to
`--xp-list-ceiling` (196 px in a 300 px band); `open(true)` is the probe's instant path;
DONE opens it on its own. The rows are three across, so twelve lines are four rows under
the ceiling with the tail beneath. CONTINUE / EXIT are the band's right cell, `align-items:
end`, on the strip's line. The `.eom .op-frame` old-ramp pin is gone, as it said.

**Gate D.** `npm run layout`: **28 surfaces × 8 viewports, PASS** — `summary/2`, `/6`, `/10`
folded and open (`/xp`) on the fullest report the accordion can be handed (twelve lines,
two of each unlock kind), `summary/board`, and `summary/ffa` on both tabs, the sixteen-row
ladder. The first green run measured the easy state — the probe had never un-hidden
`xpSlot`, which `GameScreens` does — and the picture caught it before the number did.
`progression` byte-identical (stash → build → run, pop → build → run; 50 lines, `cmp`).
`npm run check` green, **134 tests** (boundaries 360 files). **Pane**, a real solo match at
1920×1080 ended by the clock: five bodies on the platform — `hazard` with the sniper as
MVP, `echo` with the shotgun, `sentry` with the SMG, `sentry` with the Vulcan, `apex` — the
plates at 21 / 36 / 50 / 64 / 79 % under the feet, the MVP's lower for its step; a second
match VICTORY with OPERATOR at the end in the picked skin. **The cadence:** rows at +0,
+334, +346 ms — 0.34 s, frame-quantised; the bar 15 → 1,025 through a level-up; the list
opened on its own with `.xp__strip` at y 960 before and after, CONTINUE at 968 unmoved. The
LEVEL 3 flourish caught over the strip (217 × 95 at the accordion's centre). SCOREBOARD tab:
the board at 1600 wide, two 776-px blocks; the strip clicked shut and open again, y 960
throughout. **GPU:** the stage's own renderer at **17 geometries / 44 textures, flat over
20 lineup → release cycles**, every lineup ready within four ticks on the warm cache.
**Bundle:** 1 551.83 kB raw / 447.57 gzip / 60.22 CSS (C left it at 1 545.22 / 445.66 /
57.18). Nothing in `shared/` or `server/`.

**Needs a browser:** whether 5.3 m is the right distance with five bodies at play distance;
the flanks' 0.11 rad/m turn-in; the plates' size against the bodies; whether the list should
open on its own or wait for the click.

## Phase E — combat behind the menu, last

Decision 1 chose a live render over a video, and the reference asks for *combat*. Phase A's
dolly is the map; this is the fight: a solo `Match` on the backdrop map with a full roster of
bots and **no player entity**, the sim stepped by the frame loop in `MENU` as it is in
`MATCH`, the camera on the dolly. What it costs, and why it is last: a `Match` in `MENU` is a
world outside the state the state machine builds worlds for (`Game.buildWorld` is `MATCH`'s);
its bus subscriptions, its bots' `Pathfinder` arrays and its GPU resources are a new thing for
a 100-cycle leak instrument to see — and the menu is entered and left more often than any
match; and ten bots thinking at 60 Hz behind a menu is CPU a laptop on battery notices. So it
ships with three numbers or not at all: the leak count flat over 100 MENU ↔ MATCH cycles, the
sim's ms per frame in the pane, and the bundle delta. If the numbers are wrong, A3's dolly is
the menu — and that is a menu that already meets the brief's *"edges blend and fade"* clause
in full.

### E — done (session of 2026-09-15): the fight, on its three numbers

**What it is** (`client/world/MenuSkirmish.ts`, 275 lines). The shape `server/Match.ts` has
for a match with nobody at the keyboard: the map's own `CollisionWorld`, a `BotDirector`
over a navmesh, `DamageSystem`, `ScoreSystem`, Team Deathmatch, `MatchFlow`, and an empty
seat in the player's place — thirty lines restating the server's `Spectator`, the boundary's
price — with a full roster (the map's team size a side, nobody's seat held back). On top, the
two things a fight needs to be seen: `BotRenderer` with its indicators off (one new switch)
and `Fx` for the muzzle light, tracers and impacts, on a **`GameBus` of its own**, so no HUD,
announcer or audio hears a shot fired behind the menu. `Game.simulate`'s no-world branch
hands the loop's fixed step to `MenuBackdrop.simulate`; `frame` gets the loop's `alpha` and
poses the bodies between steps through the dolly's camera. The round-one freeze is taken at
eight sim steps per loop step — the bots are frozen in it, so nothing is seen to hurry — and
a finished match is replaced by the next seed on the step that found it over. **The navmesh
is baked in `prepare`**, once per map per page, before the map's first frame: in the frame
the map landed it was a 475 ms hitch (bake 228 of it; the second build on a cached grid is
5.5 ms). `backdrop.combat = false` is Phase A's dolly alone, and it is the switch the phase
ships behind. `__p7.leaks()` (DEBUG.md) reads live bus subscriptions, the GPU counts
and the JS heap in one call.

**The three numbers, in the pane** (Foundry, 5 v 5, 1920×1080):

| Number | Measured |
|---|---|
| Leak, **100 MENU ↔ MATCH cycles** | 19 under rAF and 81 with `loop.frame` driven by hand once the pane hid rAF. Bus subscriptions **12 at the menu, 124 in the match, on every cycle**; match geometries **66 every cycle**; textures in an 80–86 band once the first cycle had cached the seven skins (56 → 82). Then, sampled *quietly* — the skirmish disposed at the menu after those cycles — **51 geometries / 63 textures / 0 subscriptions, identical across nine samples**; heap 100–154 MB, GC noise, no trend. Nothing the fight allocates outlives its `dispose` |
| Sim, ms per frame | **0.269 mean, 1.0 max** with the fight on, 0.011 off (300 frames each, the pane at its 30 Hz — two steps a frame, so ~0.13 ms a step); render 2.93 ms against 0.97 for the bodies and their shadows |
| Bundle | **1 555.81 kB raw / 449.42 gzip** (D left it at 1 551.83 / 447.57): **+3.98 / +1.85 kB**, CSS unchanged at 60.22 |

The picture, through the sink: a body in the hall firing with the tracer crossing the lens,
another in the yard, the impacts on the crate — the map the menu's picker names, fighting.
Sixteen kills in the first 45 s of sim.

**Found while measuring — two one-time hitches on the page's first menu.** Hand-driven
frames, which are honest for CPU work: the map's adopt frame **153 ms** (A3's, the mesh
uploads — unchanged by E), and, some seconds later, a **~500 ms frame as the seven skins
land** — the same parse-and-upload the first match has always paid under its intro, now paid
where the menu can show it, once per page. The bake was the third and is gone from the
frame. Whether half a second on the first menu is acceptable is the human's; the alternative
is to preload the skins the way `echo` is preloaded at boot, which is a line, or to hold
the skirmish until the first match has warmed them, which is a rule.

`npm run check` green (134 tests; boundaries 361 files); `npm run layout` PASS, `npm run
intro` 299 PASSED; nothing in `shared/` or `server/`.

**Needs a browser:** whether bodies crossing the dolly's lane at eye height read as a fight or
as a collision; the tracers' brightness against the fade; whether the fight should be
silent — it is — or carry the gunshots at the menu's mix; the first-menu hitch on a real
machine.

### Playtest report (2026-09-15), built the same day: Create-a-Class round 2, and the cyan

The human's brief against a reference screen (an operator on a plinth, a right-hand column
of category bars with big pictures, a skin strip under the stage): bigger pictures; three
states — idle grey-white with a metallic read, hover that grows the whole bar and whitens it
with room between bars, a click that changes colour and does not shrink; the bottom zone
gone — the list opens on the categories and a click replaces it with that category's
options, each shown as it looks; the chosen weapon on the stage in the operator's place;
tabs over the list (the weapon's WEAPON / ATTACHMENTS / SKIN); SAVE and CANCEL under the
stage; and no orange anywhere.

**Built** (`ce18829`; `LoadoutEditor.ts` 1 173 → 1 387, `CategoryIcons.ts` 64 new). One list
in the right column: the six category bars — 112 px, the equipped weapon's silhouette at
140 px or a glyph at 60 (eight paths, no assets: frag, flash, smoke, shield, UAV, case, swatch,
scope) — and, on a click, the category's options as 88 px bars with the same pictures, a
blurb, and EQUIPPED / LEVEL N at the right end; tabs and the pager in a head over the list;
**8 bars a page, 7 with the stat band**, which is the arithmetic the CSS comment carries
(788 in 860, 688 in 708). The states are CSS: `.lo-metal` is a light-to-steel gradient
clipped to the type; hover is `scale(1.035)` on the bar with a 12 px gap; `is-on` is the
accent rule and glow; `:active` is a colour. The **weapon stands on the stage**:
`WeaponPreview` took `width / height / className` and a rect-fitted backing store, and at
860×480 it replaces the operator's canvas, skin strip and arrow bar while a weapon category
is open — the weapon under the pointer, or the equipped one in its finish. SAVE closes the
list; CANCEL restores the class from the snapshot the category opened with (`cloneSlot` /
`assignSlot`, in place, because the profile owns the object). The other four categories keep
the operator — there is no grenade or perk mesh to stand there.

**The cyan.** `--c-accent` #3fa9c7 (dim #2c7d94), `--c-warn` and `Palette.neutral` the
human's gold #c89953, and the three front-end sites that had the amber by hand — the menu's
sweep, the board's local row, the stage's ring. The debug overlays and the maps' hazard
paint keep theirs: instrumentation and environment, not the UI.

**Measured.** `npm run layout` PASS, the ten editor surfaces at **1016 of 1016** at 1920×1080
after three findings on the way: the heavy capitals' 2 px overrun at `line-height: 1.2`
(B1–B4's tile finding, again), the band 13 px short of its four lines, and — the one worth
the sentence — the operator's canvas *not* stepping aside because `.lo-stage__canvas` sets
its own `display` and the `hidden` attribute lost to it (round 4's B13, again; three
`[hidden]` companions). `npm run check` green, 134 tests; the readability probe's colour
invariants unchanged with the new neutral. **Pane**, the real client: WASP 9 picked → on the
stage with its model, the operator hidden; CANCEL → the M4 back, the categories showing;
SAVE → the category bar reads WASP 9. The stage's renderer **5 g / 11 t** and the preview's
**0 g / 3 t**, flat over 20 MENU ↔ LOADOUT cycles with three categories opened each.

**Needs a browser:** whether the gradient reads as metal or as grey; 3.5 % against the
reference's growth; the cyan on the PLAY button against the backdrop; whether a locked bar
at 55 % is dim enough to read as locked and bright enough to read at all.

### Playtest report (2026-09-15), built the same day: the brand — the mark, the lockup, the plates

The human's logo (a split skull mask with cyan eye slits and a light through them, PROTOCOL
over a cyan rule over SEVEN with its V in cyan) and a torn weapon-bar reference, with four
asks: the logo as the screen the game opens on; the menu's buttons in the Create-a-Class
bars' colours and "a little broken" like the reference; the skull alone as the mark to the
left of the name; its eyes breathing.

**First pass, turned down** (`8ddb535`): the mask as SVG paths, on the ground that the
project ships no raster and an attached image never reaches the disk. The human's verdict —
*"I can see you cannot draw it"* — and the correct one: a logo is the artwork, not a
reading of it. The logo *was* on disk, in Downloads.

**Built** (`ab69e36`). `public/brand/` holds the project's first image assets, cut from
that file by a one-off Pillow pass (the numbers are in the commit, not in a build script):
`logo.png` (1024², 272 kB) with its black keyed to alpha, so the boot screen and the device
gate stand it on the canvas's clear without a box; `mark.png` (438 × 611, 160 kB), the
skull cut from the logo and keyed the same way, edge pixels un-premultiplied; and
`mark-eyes.png` (26 kB), the same cut reduced to its cyan — the eyes and the light through
them. **The eyes breathe on the artwork itself**: in `mark.png` the cyan sits at 40 % of
itself, and the eyes layer over it swings the other 60 % in and out (opacity 0.35 → 1 with
a drop-shadow glow, 2.8 s; `prefers-reduced-motion` holds them lit). `Emblem.ts` is
`makeMark` and `makeLockup` over those three files; the paths are gone. The mark is 84 px
beside the wordmark. The nav plates (kept from the first pass) carry the bars' gradient,
left rule and grey-white type, and one jagged `clip-path` — seven irregular steps down the
leading edge, a chipped trailing top corner, a notch in the trailing bottom; PLAY is the
accent rule and glow an equipped bar has.

**Measured.** In the probe's headless Chrome, four captures of the mark over one cycle: the
eyes' mean brightness **157 at the peak, 113 at the trough**, the glow's area 2 860 → 2 073
px — the first cut, before the face layer's cyan was dimmed, could only glow *brighter*
(the area swung ±13 % and the eyes never fell below the artwork's own). `npm run layout`
PASS with a new `boot` surface (880 × 880); `npm run check` green, 134 tests.

**What this changes about the project:** M12's "no asset files" is no longer a fact — three
PNGs, 464 kB, under `public/brand/`. Nothing gates them (`check:skins` scans its own
folder); if the brand grows, a `check:brand` in the shape of `check:skins` is the next
line to write.

### Playtest report (2026-09-16) — proposed: the chrome, the player card, and Create-a-Class round 3

The human's report against the shipped tree, seventeen items over the two screens the brand
landed on: five on the menu and twelve on Create-a-Class. Nothing in it is a gameplay change,
nothing touches `shared/` or `server/`, and every layout item is measured by the probe that
already holds both screens. **No product code was written in this session**; the causes
below were read from the tree and, where the pane could reach them, measured in it (the real
client at 1280×600, `--ui-scale` 0.556 — a maximised browser with its own chrome above it is
this shape, wider than 16:9, which is the human's *"not in fullscreen"*).

**Four groups, in build order.** **R1** the chrome — the header and the footer belong to the
window, not the frame; the status line goes and a line goes in its place; the PLAY hover.
**R2** the player card — one card on both screens, and the profile panel behind its gear.
**R3** the editor's frame — the mark, the card, the class strip on a second row, *Save and
exit* under the list, the arrows gone, the fling. **R4** the editor's list and stage — peers
that read as peers, the unlocked rule, SAVE / CANCEL centred, the finish on the operator's
weapon, the camo bars painted. R2 depends on R1 (the card sits in the window's header); R3
on R2 (the editor's header *is* the card); R4 on nothing but R3.5's arithmetic. Decisions
9–13 in the table below are this report's.

#### R1 — the chrome

**R1.1 The brand is not at the window's edge.** *"When I am not in fullscreen the title at
the top left sits at the top as it should, but it is not pinned left."* Measured: the frame
**1 067 px wide with a 107 px gutter each side**, the brand's left edge **142 px** from the
window's (the gutter plus the frame's 64 px padding at 0.556), the player card 142 from the
right, the footer the same. At 16:9 the gutter is 0 and only the padding stands between the
brand and the edge, which is why fullscreen looks right. Cause: `frameScale = min(vw / 1920,
vh / 1080)` and `.op-screen { justify-content: center }` — A1's frame is a 16:9 box centred
in whatever the window is, by design (*"an ultrawide window gets more sky, not black bars"*
— the sky is there; the header is not on it).

Fix — **the header and the footer belong to the window; the body belongs to the frame.**
`createScreen` returns a third box, `viewport`: the window's size *in frame pixels*
(`--frame-w = vw / scale`, `--frame-h = vh / scale`, written by `applyFrameScale` beside
`--ui-scale`; both ≥ 1920 / 1080 by construction and one of them exact), carrying the `zoom`
**and the frame's ramp tokens** — they sit on `.op-frame` today, and a header outside the
frame would otherwise read the HUD's 13 px body — with the 1920×1080 `.op-frame` centred
inside it and no zoom of its own. The menu and the editor mount their header, and the menu
its footer, on the viewport: `position: absolute`, `left` / `right` the frame's padding from
the *window's* edges, `top` the *frame's* top (`calc((var(--frame-h) - 1080px) / 2)`), so at
a wider window the header spreads to the window's corners over the backdrop the fade was
drawn for, and at a taller one it stays level with the body rather than rising away from it.
Everything else stays in the frame: the menu's stage was centred and reserves nothing; the
editor's frame keeps the header's 72 px as top padding in place of its `head` row. At 16:9
the viewport *is* the frame and nothing moves. No `vw` / `vh` enters the CSS — the two
variables are written by the same listener as the scale, which is A1's rule kept (*"nothing
inside the frame may vary with the window"* — the viewport is not inside the frame). The
probe's skip list (`layout.ts`, the layer and the frame) gains the viewport box; the
*outside* rule holds unchanged, the window being the window. Rejected: the frame filling the
window (every `1fr` on every screen would stretch with the aspect — the editor's bars 916
wide at 16:9 and 1 350 at 1366×626 — which is A1's uniformity given back); `position: fixed`
inside the zoom (works in Chrome, and the probe could no longer say what box a thing is in).

**R1.2 PLAY does not light under the pointer.** *"It does not glow like the buttons under
it until I click somewhere else."* Measured: `paint()` ends with `focus.focus()` on PLAY (on
PLAY SOLO where no server is configured, which is what the pane had), and the focused
button **matches `:focus-visible`** — script-moved focus does in Chrome — so it is already
wearing the hover declarations: background `rgba(40, 45, 54)`, rule `--c-text-dim`, type
`#f4f6f8`, and the sweep's `::after` **parked at 656 px** (its `110%` resting place) before
the pointer arrives. `.op-nav:hover, .op-nav:focus-visible` is one rule (`app.css`), so
hovering the focused button changes nothing, and clicking elsewhere blurs it back to rest,
where hover works again — the report exactly. Fix: the two states stop being one rule. Hover
keeps the lift and the sweep; `:focus-visible` gets its own mark — the accent rule and the
top hairline, no lift — so a focused PLAY reads as where the keyboard is, not where the
pointer is. The sweep becomes a keyframe `animation` on `:hover::after` (and once on
`:focus-visible::after`, under a second name for the same keyframes, because a changed
`animation-name` is what restarts one) rather than a `transition` on `left`: it runs each
time the pointer enters, and never plays backwards on leave. The focus itself stays; the
menu is keyboard-navigable because of it.

**R1.3 The status line goes.** *"FOUNDRY · 48 brushes · 76 props — I do not know what that
means; remove it."* `Game.statusLine()`, a build-stat line from M1 the footer inherited;
nothing else reads it. Deleted with `MenuDeps.statusLine` and the probe fixture's
`'LAYOUT PROBE'`. `PauseMenu`'s `pauseStatusLine` is a different line (the mode and the
score) and stays.

**R1.4 A line at the bottom left.** The human's examples — *"Never back down"*, *"Fight ·
survive · win."* — or one of ours. Recommendation (decision 9): **FIGHT · SURVIVE · WIN** —
the human's own, and already in the house style: every label on these screens is capitals
separated by `·`. Two alternates if it reads flat on the display: **NEVER BACK DOWN**;
**HOLD THE LINE**. One line, static, `op-label` weight, in the footer's left corner, which
has been empty since A2; the right corner is empty after R1.3 and stays so.

#### R2 — the player card, and the profile behind it

**R2.1 The card.** *"A picture of the operator I have chosen, with a small green dot as if I
am online; beside it the name, under it the level, and that is all — clean. Then a divider
like the one on the left, then a gear."* Today the card is a CALLSIGN field and the profile
line (`LEVEL 1 · 4,182 XP TO NEXT · ASSAULT · 0/0 WON`): six facts where the ask is two.
`ui/PlayerCard.ts`, right-aligned in the window's header on both screens: the **avatar** is
the chosen skin's thumbnail (`characterDefinition(profile.skinId).thumbUrl` — B5's 320×400
render, which is a portrait of who the player is), `object-fit: cover` from the top into a
64 px square, with the **presence dot** on its corner; the **callsign** as the name,
`--t-lead` heavy, with **LEVEL N** (PRESTIGE ★ N over 55) beneath in `op-label`; a vertical
**rule** (`.op-menu__rule`'s class, promoted); and the **gear** — a sixth glyph in `GLYPH`,
drawn as the other five are — that opens the panel. The callsign is no longer edited here
(R2.2). `MenuDeps` loses `profileLine` and `displayName` / `onDisplayName` and gains
`profile`, as the editor already has it; `GameLoadout.profileLine` goes with its only reader.
The dot (decision 10): green when `serverConfigured()` is true, grey when not — the fact
PLAY's disabled state already states, so the dot never says *online* on a build with no
server to be online to. Always-green is one line less and one fiction more; the human's
word was *"as if"*, so this is a recommendation, not a reading.

**R2.2 The profile panel.** *"Not the general settings — a player profile: level,
achievements, edit the picture, edit the name, and so on."* `ui/ProfilePanel.ts`: a panel
over the current frame (a `section.op-setup`-shaped box, the play panel's slide), opened by
the card's gear on either screen, closed by its own ✕ and by Escape — `Game.onEscape` asks
the editor first, the way it asks SETTINGS about an armed binding, and on the menu the panel
is Escape's only customer. **Not a `GameStateId`** (decision 12): it reads and writes the
profile and nothing about it needs the state machine; a `PROFILE` state is a
`shared/core/GameStates.ts` change with a transition table to argue, for a thing the menu
already has a shape for. Tabs: **OVERVIEW** — the avatar large (the thumbnail at 160×200),
the callsign field (moved from the card; the same rules — prefilled, written on every
keystroke, never a gate, `keydown` stopped), level with the XP bar and *N XP TO NEXT* (moved
from the editor's header, R3.2), prestige and tokens, the record (`matchesWon /
matchesPlayed`); **ACHIEVEMENTS** — the thirty challenges (`CHALLENGES`;
`Profile.challengeRows()`, which only the debug panel reads today) as name, description,
`progress / target`, done in the accent, the camo one awards as its swatch — by category in
sub-tabs (COMBAT · PRECISION · MOVEMENT · TACTICAL · MASTERY · CAMO), because thirty rows do
not fit a panel and five do; **APPEARANCE** — the seven skins as a grid of B5's thumbnails,
picking through `Profile.setSkin` exactly as the editor's strip does; the strip itself is
untouched (R3.8). A host screen's `refresh` runs on the panel's close, so a skin or a name
picked in it is on the disc and on the card when it closes. Three probe surfaces —
`menu/profile`, `menu/profile/achievements`, `menu/profile/appearance` — at eight viewports.

#### R3 — the editor's frame

**R3.1 The mark.** *"My mark should stay at the top left — it simply removed it."* The
editor's header is a title and a subtitle; the mark is the menu's. R1's header is one
component, `ui/ScreenHeader.ts`: the mark, then the *place* — the wordmark with `ARENA FPS`
on the menu, **CREATE A CLASS** with its subtitle on the editor (*"only the name of the place
changes on the left"*) — and R2.1's card on the right. Settings keeps its own title: not
asked, and it has no card's business.

**R3.2 The right of the header.** *"Remove everything there — the level and the save
button — and put exactly what the menu has."* `paintLevel` (the number, the bar, the XP to
go) and `paintActions` leave the header; the level is on the card, the bar is in the
panel's OVERVIEW, *Save and exit* is R3.4.

**R3.3 The class strip, one floor down.** *"The 1–5, the name for saving and the equipped
mark do not belong on the bar; one floor down at most; think of a way that is not busy."*
Today: five 48 px tabs whose names are `title`s, a 220 px rename field and an *Equip* button
in the header's middle, the equipped one a 6 px dot. Recommendation (decision 13): a
**second row under the header, spanning the frame** — five plates in the nav's torn cut,
**44 px** tall, each carrying its number in mono and **its class's name** (`1 · ASSAULT`,
`2 · RECON` …), so the five are read at once rather than hovered for; the open one in the
accent (`is-on`); the equipped one carrying **EQUIPPED** as a tag at its right end in place
of the dot — and when the open plate is not the equipped one, that end holds the **EQUIP**
action instead, so *Equip* is where the decision is and nowhere else. **The name is edited
on the plate**: the open plate's name is the callsign's kind of field — no box, a rule
beneath while it is being written, the accent on focus — and the other four are labels; the
`keydown` stop stays (keys 1–5 are the range's). Five plates at 300 px with four 24 px gaps
are 1 596 of the 1 824 the frame has inside its padding. Cost: the row is **44 + 16 = 60 px**
off the body (the frame's row gap is 16), 928 → **868**; the arithmetic is R3.5.

**R3.4 *Save and exit*, bottom right.** *"Under the list."* The right column gains a foot
track: `op-actions`, right-aligned, the primary button at `lo-equip`'s padding (12 / 24,
**48 px** tall — the frame-ramp `op-btn` is 68, which the column cannot spare). Escape and
the button keep the one destination, and the exit handler keeps the flush (B5).

**R3.5 The arithmetic.** The right column was 928: 44 head, 860 list, 152 band, and two
12 px gaps that count whether or not a track is empty; the list held **8 bars at 88 with
12 gaps (788 + 8 padding = 796 in 860)**, **7 with the band (696 in 708)**, and the six
category bars 740 with the head hidden. After R3.3 and R3.4 the column is **868**, four
tracks (head · list · band · foot), three gaps, and the head goes **44 → 40**: categories
showing, 868 − 36 − 48 = **784**, the six bars 740 (44 slack, 5.6 %); open, **744** without
the band and **592** with. Two ways to fit, and the plan takes the first (decision 11):
**option bars 88 → 80, gap 12 → 8** — 8 × 80 + 56 + 8 = **704 in 744** (40, 5.4 %) and
6 × 80 + 40 + 8 = **528 in 592** (64, 10.8 %), pages **8 / 6**; or bars kept at 88 and pages
**7 / 5** — 696 in 744 (6.5 %) and 496 in 592 (16 %). Eight pixels off a bar the human
asked to be big is the smaller loss against every attachments list going to a second page;
both keep the 5 % slack B1–B4 learned the hard way, and **the probe takes the numbers before
R3.3 is styled** — a sum on paper fit by one pixel last time. `PAGE_WITH_BAND` /
`PAGE_FULL`, the `.lo-right` comment and the `.lo .op-frame` comment (`72 + 16 + 44 + 16 +
868 = 1016`) are the four places the sum lives. The stage column: **800 canvas + 12 + 56
actions = 868**, exact, with the arrow bar gone (R3.6).

**R3.6 The arrows go.** *"Drag is enough."* `arrowButton` × 2, `.lo-stage__bar`, `nudge()`
and `NUDGE` deleted; `.lo-arrow` stays, the pager's. The status (`LOADING OPERATOR…`)
becomes a label over the canvas's foot; `.lo-skins`' `bottom: 68px` — the bar's height —
re-bases to the canvas's foot.

**R3.7 The fling.** *"When I spin it hard and let go it stops dead and then continues — it
should carry the spin I gave it."* `pointerup` sets `dragging = false` and nothing else;
`tick` then adds `IDLE_TURN · dt` and eases `angle` toward `target` with `SETTLE` — but a
drag writes `angle = target` on every move, so there is nothing to ease and no velocity to
carry: the turntable goes from the hand's speed to 0.1 rad/s in one frame. Fix:
`pointermove` keeps a velocity — the last delta over its `dt`, blended `0.7 · prev + 0.3 ·
new` so a hand that stalled before letting go reads as stalled; `pointerup` hands it to
`spin`, clamped at ±12 rad/s; `tick` turns by `(IDLE_TURN + spin) · dt` and decays `spin` by
`exp(−FLING_DAMPING · dt)`, `FLING_DAMPING = 2.2` (a 6 rad/s fling is under the idle rate in
about 1.9 s). A fling against the idle direction decays *through* zero and the idle takes
over, which is the human's *"until it resets to its regular track"*. `SETTLE` and `target`
go with the arrows — nothing eases toward anything any more — and `hold()` sets `angle`
alone. `prefers-reduced-motion` does not apply: the player made the motion.

**R3.8 CHANGE A SKIN, centred.** *"The bar it opens is excellent; the button is odd — at the
side, half the figure's length, stuck. Do not change the bar."* `.lo-skins__toggle
{ align-self: flex-start }` puts the toggle at the column's left edge under a figure that
stands at its centre (measured: 125 window px wide at the column's `left`, the canvas 478).
`align-self: center`; the strip's `order`, grid and tiles untouched.

#### R4 — the editor's list and stage

**R4.1 Peers read as peers.** *"Two grenades, one large and white, the other looking like
its attachment; only the first killstreak looks like one."* `paintBoxValue`: `i === 0 ?
'lo-chip lo-chip--lead lo-metal' : 'lo-chip'` — the first chip of *every* box is the lead
and the rest are detail chips, which is right for a weapon (name; then finish and
attachments) and wrong for the other four, where the items are peers. Measured: KILLSTREAKS
`UAV` at 22 px metal, `CARE PACKAGE` and `MORTAR STRIKE` at 16 px in chip borders;
EQUIPMENT `FRAG` lead, `FLASHBANG` a chip. Fix: chips carry a rank — `lead` / `peer` /
`detail` — set by the box: weapons `lead + detail…`; equipment, perks and streaks all
`peer`; field `lead`. A peer is the lead's type at `--t-body` (18 px) with the metal, in a
row separated by thin rules rather than boxed each, so three streaks read as three things
of one kind; the streaks keep their key in the tooltip; an empty tier's `—` is a dim peer.

**R4.2 The unlocked rule.** *"Open and locked differ only by colour intensity; give the open
ones a blue bar at the left end."* Measured on PRIMARY: locked and unlocked bars share the
rule `rgb(57, 64, 75)` (`--c-line-hi`); the whole difference is `opacity: 0.55` and the
`LEVEL N` at the right. Fix, three rules: **unlocked** `border-left-color:
var(--c-accent-dim)` — the bar is the player's to take; **equipped** the full accent and the
glow, as now; **locked** the rule `transparent`, the opacity kept, and a padlock glyph (a
ninth path in `CategoryIcons`) before the requirement. The category bars keep the neutral
rule: they are not options.

**R4.3 SAVE / CANCEL centred.** *"They sit at the side under the picture, not under the
platform's middle."* `.lo-stage__actions { justify-content: flex-end }`; measured, the pair's
centre 108 window px right of the stage's (≈ 194 frame px). `center`.

**R4.4 The finish on the operator's weapon.** *"I pick a skin, it paints the weapon in the
weapon view; back on the operator the weapon is the plain one, though in a match it works."*
`refreshStage` calls `stage.setWeapon(equipped.weaponId)` — no camo — and
`CharacterStage.heldWeapon` builds every held weapon with `heldWeaponMaterial(anisotropy)`,
which is `sharedWeaponSurfaces(anisotropy).get('gunmetal')`: the *default* set's gunmetal,
by design for a body at twenty metres (*"three draw calls buying a difference nobody can
resolve"*). On the stage the body is at four. Fix: `heldWeaponMaterial(anisotropy, camo =
null)` → `sharedSurfaces(anisotropy, camo)` — the camo set's gunmetal *is* the pattern
(`buildCamoSurfaces`), so the material is already built and cached per process;
`CharacterStage.setWeapon(weaponId, camo)` keys its asset cache by `weaponId|camo`;
`refreshStage` passes `equipped.camo`. `BotRenderer` keeps the plain gunmetal: the wire
carries no camo (`EntitySnapshot` is `weaponIndex` and `heightScale`), so a match body has no
finish to show; the stage shows the player's own class, which is what the screen is for.

**R4.5 The camo bars, painted.** *"The skins are not visual — a written explanation only.
Paint each bar with its skin from the right toward the middle, where it fades to black, and
the explanation in white on the black."* The SKIN tab's tiles carry `glyphIcon('camo')` and
the bar's dark gradient (`optionsFor`, `case 'camo'`); the only colour is on the
`WeaponPreview` after a click. Fix: `tile()` takes an optional `picture` (a CSS
`background-image`), and the camo list passes the pattern itself — `camoTexture(id,
anisotropy).image` is the 256 px canvas `CamoTextures` already draws for the material, and
`toDataURL()` on it once per camo per process is a data URI a bar's CSS can hold (six camos,
~40 kB each, built on the first SKIN tab and kept in `CamoTextures` beside the textures).
`.lo-bar--camo`: the pattern on the right **45 %** of the bar under `linear-gradient(to
right, rgb(10 12 15) 0 40%, transparent 62%)`, so it fades into the bar's own dark at the
middle; the glyph slot collapses (the picture is the bar); the name and the requirement in
plain white (`#f4f6f8`, not `.lo-metal`) on the dark left. `is-on` keeps the accent rule and
puts the glow *under* the pattern rather than in its place (two background layers, not
one); the hover lift is unchanged; NONE keeps the glyph and a swatch of the plain gunmetal.
A locked camo bar's 55 % dims the pattern too, which is right.

#### What it breaks, the gate, the order

**Breaks.** `Menus.ts` loses the header, the footer, the callsign and `statusLine` (~110
lines) and gains the panel's mount; `LoadoutEditor.ts` loses `paintHeader`'s three parts and
the arrows (~130) and gains the strip and the camo bars (~120); `CharacterStage.ts` loses
`nudge` / `SETTLE` and gains the fling; `Frame.ts` gains the viewport box and two variables,
and its "What is *not* in the frame" paragraph gains the header; `tokens.css` moves the
frame's ramp to the viewport; `WeaponMesh.heldWeaponMaterial` gains a parameter;
`CamoTextures` gains the data-URI cache; `probes/layout.ts` gains the viewport in its skip
list and three surfaces; `Game.ts` loses `statusLine`, and its Escape path asks the editor
first. Three new files under `ui/`: `ScreenHeader.ts`, `PlayerCard.ts`, `ProfilePanel.ts`.
Nothing in `shared/` or `server/`: the seeded harness and the content probe are byte-identical
by construction; `progression` untouched; `check:unlocks` still finds its six accessors.

**Gate.** `npm run layout` **PASS** at eight viewports on every surface, the three new ones
included, R3.5's numbers restated as measured; `npm run check` green. **Pane:** at 1280×600
the brand's rect `64 · scale` from the window's left edge (was 142) and the card the same
from the right; the focused PLAY *not* wearing the hover declarations (the rest gradient,
`::after` at −45 %) and wearing them under `:hover`; `CharacterStage` **5 g / 11 t** flat over
20 MENU ↔ LOADOUT cycles with a camo'd weapon held — the material is shared, so the count
must not move; the fling's `spin` sampled by `loop.frame` at release, 1 s and 2 s, monotone
toward the idle rate; the camo data URIs six, built once (a counter in `CamoTextures`).
**Needs a browser:** whether the peers' row reads as three things or one line; the padlock
at 55 %; the pattern's fade at the bar's middle; 2.2 as the fling's damping; the line at the
bottom left; the plates' torn cut at 44 px.

**Order.** R1.1 alone first, run through the probe before anything mounts on the viewport,
so the eight-viewport list is a measurement; then R1.2–R1.4 and R2 together (the card is the
header's right half); then R3, with R3.5's numbers taken by the probe before R3.3 is styled;
then R4 in any order, each item its own commit, none depending on another. Every commit:
`npm run layout` and `npm run check` green; the pane numbers in this record when each group
closes, as a `done` subsection under this one.

#### R1 — done (session of 2026-09-16): the chrome on the window, two states, a line

**Built** (`77eec4b`, R1.1 alone; `578ece8`, R1.2–R1.4). `createScreen` returns the third
box: `viewport`, the window's size in frame pixels — `--frame-w` and `--frame-h` written by
`applyFrameScale` beside `--ui-scale`, the frame's ramp tokens moved onto it from `.op-frame`
(`tokens.css`), the 1920×1080 frame centred inside it with no zoom of its own; `Frame.test.ts`
holds the arithmetic (both ≥ 1920 / 1080, one exact). The menu's header and footer mount on
the viewport at the frame's padding from the *window's* edges and level with the frame's top;
the probe's skip list gains the box and the *outside* rule is unchanged. Then the two states:
`.op-nav:hover` keeps the lift and runs the sweep as a keyframe (`op-nav-sweep`, 0.55 s, on
`::after` — it plays on every entry and never backwards), `:focus-visible` is the accent on
the leading rule and the top hairline; `Game.statusLine()`, `MenuDeps.statusLine` and the
probe fixture's line deleted (Game −7, GameScreens −2); `MENU_LINE = 'FIGHT · SURVIVE · WIN'`
(decision 9) in the footer's left corner at `op-label`, the right corner empty.

**Measured, in the pane at 1280×600** (`--ui-scale` 0.556, `--frame-w` 2304 px, `--frame-h`
1080): the brand's left edge **35.55 px** from the window's — 64 × 0.556 = 35.56, was 142 —
the card's right edge **35.55** from the window's right, the footer spanning 35.55 → 1244.45.
The focused button at rest (PLAY SOLO — the pane has no server, so PLAY is disabled and the
focus lands one down): the rest gradient `rgba(28, 32, 39, .92)`, the rule `--c-line-hi`,
`::after` at **−45 %** (−268.7 px), no animation; under `:hover` the lift `rgba(40, 45, 54,
.96)`, the accent rule, `#f4f6f8`, and `::after` at 603 px — the sweep's end, `op-nav-sweep`
having run once. One thing the pane could not reproduce: its script-moved focus matched
neither `:focus-visible` nor `:hover`, where the report's Chrome matched the first — the
two rules are separate either way, which is the fix.

#### R2 — done (session of 2026-09-16): the card, and the profile behind its gear

**Built** (`86cc13a`; `PlayerCard.ts` 103 new, `ProfilePanel.ts` 371 new, `app.css` +421/−22,
`Menus.ts` 41/48, `GameLoadout.profileLine` and its only reader gone). The card, right-aligned
in the window's header on both screens: the chosen skin's thumbnail (B5's 320×400 render,
`object-fit: cover` from the top into 64 px) with the presence dot on its corner — **honest**
(decision 10): `is-online` when `serverConfigured()` is, titled *Server configured* / *No
server configured*; the callsign at `--t-lead`, LEVEL N (PRESTIGE ★ N over 55) beneath; the
rule; the gear, a sixth glyph drawn as the other five are. `MenuDeps` loses `profileLine`,
`displayName` and `onDisplayName` and gains `profile`, as the editor already had it. The panel
(decision 12: a panel, not a state) slides over either frame from the gear, closes on its ✕ and
on Escape — `Menus.handleEscape` is the panel's, and it is Escape's only customer on the menu —
with three tabs: **OVERVIEW** (the avatar at 240×300 — the plan said 160×200 and the panel had
the room — the callsign field moved here with its rules, the level with the XP bar and *N XP TO
NEXT*, prestige and tokens, the record); **ACHIEVEMENTS** (`Profile.challengeRows()`, thirty
rows in six category sub-tabs, done in the accent); **APPEARANCE** (the seven thumbnails,
`Profile.setSkin`, the editor's strip untouched). A host's `refresh` runs on the close. Three
probe surfaces — `menu/profile/overview`, `/achievements`, `/appearance` — at the eight
viewports.

**Measured.** The card in the pane: `OPERATOR-011 · LEVEL 1`, the dot grey (no server
configured — the fact PLAY's disabled state states). The three surfaces PASS at the eight
viewports; `npm run check` green.

#### R3 — done (session of 2026-09-16): the editor's frame

**Built** (`31942fa`; `LoadoutEditor.ts` 1 387 → 1 427 with 175/135 lines moved, `meta.css`
185/134, `CharacterStage.ts` 41/22, `ScreenHeader.ts` 26 new). One header for both screens
(`ScreenHeader`: the mark, the place — the wordmark with ARENA FPS on the menu, CREATE A CLASS
with its subtitle on the editor — and the card on the right; Settings keeps its own title),
mounted on the viewport as R1.1 mounts the menu's, the editor's frame keeping the header's 72
px as top padding. `paintLevel` and `paintActions` leave the header (R3.2): the level is on the
card, the bar is in OVERVIEW. The class strip on a second row (R3.3, decision 13): **five
plates at 300 × 44 with the nav's torn cut**, `1 · ASSAULT` … `5 · MARKSMAN`, the open one
`is-on`, the equipped one carrying EQUIPPED at its right end and the open unequipped one EQUIP
in the same place; the name is edited *on* the open plate — no box, a rule beneath while it is
written, the `keydown` stop kept — and the other four are labels. *Save and exit* under the
list (R3.4): a foot track, `op-actions`, right-aligned, the button at 48 px. The arithmetic
(R3.5, decision 11): the column **868**, four tracks and three gaps, the head 40; **option bars
80 with 8 px gaps, pages 8 / 6** — 704 in 744 without the band, 528 in 592 with it, the six
category bars 740 in 784 — and the four places the sum lives agree (`PAGE_WITH_BAND` /
`PAGE_FULL`, the `.lo-right` comment, the `.lo .op-frame` comment: 32 + 72 + 16 + 44 + 16 + 868
+ 32 = 1080). The arrows gone (R3.6): `arrowButton`, `.lo-stage__bar`, `nudge()`, `NUDGE`,
`SETTLE` and `target` deleted, the status a label over the canvas's foot, the skin strip
re-based to it. The fling (R3.7): `pointermove` keeps a velocity blended 0.7 / 0.3, `pointerup`
hands it to `spin` clamped at ±12 rad/s — or zero if the hand had stalled 80 ms before letting
go — and `tick` turns by `(IDLE_TURN + spin) · dt`, decaying `spin` by `exp(−2.2 · dt)`;
`hold()` sets `angle` alone. CHANGE A SKIN at `align-self: center` (R3.8), the strip untouched.

**Measured.** `npm run layout` PASS on the ten editor surfaces at the eight viewports. In
the pane, the bars **80 frame px with an 8 px gap** (44.4 / 4.4 window px at 0.556).
The fling, `flingSpeed` sampled after a synthetic drag of 12 moves at 14 px / 16 ms (the
hand at 12.84 rad/s over the idle, clamped): **12.0 at release, 7.18 at 0.25 s, 3.99 at
0.5 s, 1.33 at 1 s, 0.44 at 1.5 s, 0.14 at 2 s, 0.015 at 3 s** — monotone toward the idle
rate, and within a hundredth of 12 · e^(−2.2 t) at every sample, which is the constant
proved rather than the code read. The plates: five, EQUIPPED on the first, the disc turning
under the operator with the M4.

#### R4 — done (session of 2026-09-16): the list and the stage

**Built** (`a1bd6d0`; `LoadoutEditor.ts` 36/15 → 1 448, `meta.css` +104 → 1 319,
`CamoTextures.ts` +19, `CategoryIcons.ts` a ninth path, `WeaponMesh.ts` 7/2,
`CharacterStage.ts` 22/15 → 501; then `853892c` for the bug the first commit exposed).
**R4.1**: chips carry a rank — `lead` / `peer` / `detail`, set by the box: a weapon `lead +
detail…`, equipment, perks and streaks all `peer`, the field upgrade `lead`; a peer is the
lead's type at `--t-body` with the metal, in a row separated by thin rules, an empty tier a dim
peer. **R4.2**: three rules — `.lo-bar--opt` carries `--c-accent-dim` on its leading edge,
`.is-on` the full accent and the glow, `.is-locked` a transparent edge at 0.55 with the padlock
(`lock` in `CategoryIcons`) before the requirement; the category bars keep the neutral rule.
**R4.3**: `.lo-stage__actions { justify-content: center }`. **R4.4**:
`heldWeaponMaterial(anisotropy, camo = null)` → `sharedSurfaces(anisotropy, camo)`, the camo
set's gunmetal being the pattern and already cached per process;
`CharacterStage.setWeapon(weaponId, camo)` keys its assets by `weaponId|camo`; `refreshStage`
passes `equipped.camo`; `StageFigure.camo` optional, so D's lineup carries none (the wire has
none to give). `BotRenderer` keeps the plain gunmetal. **R4.5**: `camoPicture(id, anisotropy)`
— the texture's own 256 px canvas through `toDataURL` once per camo per process, kept beside
the textures, `camoPicturesBuilt` counting the reads; `tile()` takes a `picture`,
`.lo-bar--camo` puts it on the right 45 % under `linear-gradient(to right, rgb(10 12 15) 0 40%,
transparent 62%)`, the glyph slot collapsed, the name and requirement in plain white on the
dark left; `is-on` puts the glow under the pattern as a second layer; NONE keeps the glyph.

**Found while here — two, fixed.** First (`853892c`, the human's, the same day):
`CharacterSkin.setWeapon` compared the asset's `weaponId` and returned early, so a finish
picked on the stage changed the cached asset and not the mesh in the operator's hands; it
compares the asset now — the same weapon in a new finish is a new asset. That commit also
re-indented the file to four spaces; restored to the tree's two in the close, the fix kept
verbatim. Second (the close): `.lo-bar.is-on` wrote `border-left-color: var(--c-accent)` and
then the `border-color` shorthand *after* it, so the equipped bar's leading edge was the dim
accent — invisible while every other bar was neutral, and after R4.2 the same edge as an
unlocked bar's. Measured before the swap: equipped `rgb(44, 125, 148)`, unlocked the same;
after: equipped **`rgb(63, 169, 199)`**, unlocked `rgb(44, 125, 148)`, locked `transparent`
at 0.55, the category bar `rgb(57, 64, 75)`. Two declarations, one order.

**Measured, in the pane at 1280×600.** SAVE / CANCEL's centre **372.2 window px, the stage's
372.2**. The operator holding the M4 in TIGER; `CharacterStage`'s renderer **5 g / 13 t flat
over 20 MENU ↔ LOADOUT cycles** with the camo'd weapon held — 13 rather than the plain
weapon's 11 because the camo set's two maps are on the GPU beside the default set's, and
*flat* is the claim: the material is shared and the count does not move. The camo data URIs
**six, built once** — `camoPicturesBuilt` 6 on the SKIN tab's first open and 6 after it was
closed, reopened, and the editor left and re-entered; 5 / 12 / 36 / 8 / 107 / 67 kB (PNG;
the estimate said ~40 each, the mean is 39). The padlock shown on every locked bar and
hidden on the rest. No console error.

#### The gate

`npm run layout` **PASS — 32 surfaces × 8 viewports**, the three profile surfaces among them;
`npm run check` green (138 tests; boundaries 366 files); nothing in `shared/` or `server/`, so
the seeded harness and the content probe are byte-identical by construction. The client build
**1 570.37 kB raw / 453.73 gzip, CSS 70.58** — E left it at 1 555.81 / 449.42 / 60.22, so the
round is **+14.56 / +4.31 kB of script and +10.36 of stylesheet**, the panel and the plates
most of it.

**Needs a browser:** the ones the report listed — whether the peers' row reads as three
things or one line; the padlock at 55 %; the pattern's fade at the bar's middle; 2.2 as the
damping on a real wheel; the line at the bottom left; the plates' torn cut at 44 px — and
one more: the sweep at 0.55 s on a pointer that crosses all four buttons at once.

## What each item breaks

- **B1/B2's fix is replaced, not removed.** The `safe center` + `overflow: auto` reasoning in
  `app.css` was right for the rule it served; the comment is rewritten to say the rule changed
  and where the length went, so the next reader does not restore it.
- **B11's test becomes moot.** Preserved scroll was the test that the editor's DOM is not
  rebuilt; with paging there is no scroll to preserve. The in-place refresh stays, for the
  reason it was built — a rebuilt tree is a lost tooltip and a jumped strip — and the test
  becomes "the open strip's page survives an edit".
- **`Menus.ts` and `LoadoutEditor.ts` are rewritten**, 1 328 lines between them; `Settings`
  gains a tab; `EndOfMatch` and `XpSummary` are restructured with S6.1's timing kept to the
  constant.
- **`probes/layout.ts`** gains a rule and loses the premise of one; `Viewports.ts` gains two
  rows.
- **`SaveData`** goes to v4 (B5); **`EntitySnapshot`** gains a byte (B6, if taken).
- **`Game`** gains a world that is not a match (A3), a camera that is not the player's (C) —
  both asked-for rather than pushed — and a state (`MENU`) in which the frame loop renders.
- **Nothing in `shared/` changes before B6**, which is why the harnesses are byte-identical
  through A–D and why B6 is the one step with a netharness bill.

## Decisions waiting on the human

| # | Decision | Recommendation |
|---|---|---|
| 1 | ~~Menu backdrop: live render or a supplied video?~~ **Taken (2026-09-15): live render.** No video asset exists; 5–20 MB against 391 kB is a multiplier, not a percentage | — |
| 2 | ~~Skin picker: local-first, or the wire field in the same milestone?~~ **Taken: local-first**; B6 is the wire step if B1–B5 land with room | — |
| 3 | ~~The floor viewport?~~ **Taken: 1280×720.** The rule still holds below it; legibility is not promised | — |
| 4 | ~~Archive M14 to open this section?~~ **Taken**, this session | — |
| 5 | ~~Three skins are 24–38 MB (Viper, Echo, Hazard) against 4–5 MB for the other four, and the 28 MB one is the default that preloads at boot. Recompress, and change the default?~~ **Taken (2026-09-15): yes, before B1** — a `B0` step: recompress the three to the four's size and make a 4 MB skin the default. A `gltf-transform` pass run once, not a build dependency | — |
| 6 | ~~Phase E: run the fight behind the menu, or stop at the dolly?~~ **Taken: proceed**, provided the three numbers hold — the leak count flat, the sim's ms per frame, the bundle delta. E ships on them or not at all | — |
| 7 | ~~QUIT in a browser: a `MENU → BOOT` edge, or leave the button out?~~ **Taken: no QUIT button.** A tab closes itself; the menu has four entries | — |
| 8 | ~~The intro on Search & Destroy rounds two onward?~~ **Taken: round one only.** The freeze is round one only and exists for the class pick | — |
| 9 | ~~The line at the bottom left of the menu (R1.4)?~~ **Taken (2026-09-16): FIGHT · SURVIVE · WIN.** The human's own, in the house style | — |
| 10 | ~~The presence dot on the card (R2.1): honest, or always green?~~ **Taken: honest** — green when a server is configured, the fact PLAY's disabled state already states | — |
| 11 | ~~The option bars under the class strip and the foot (R3.5): 80 px and pages 8 / 6, or 88 px and pages 7 / 5?~~ **Taken: 80 px, pages 8 / 6.** The probe takes the numbers before R3.3 is styled | — |
| 12 | ~~The profile as a panel over the frame, or a `PROFILE` state (R2.2)?~~ **Taken: a panel.** No `shared/` change; Play Solo is the precedent | — |
| 13 | ~~The class strip as five named plates with EQUIPPED / EQUIP on the open one, or the five tabs kept and moved down (R3.3)?~~ **Taken: the plates.** The name on each is what makes five classes readable without hovering | — |

## Dependency order

1. **A1** first and alone — the scale and the probe rule, run against every screen as it is,
   so the overflow list is a measurement before anything is redesigned.
2. **A2–A4**, then **B**, then **D** — three screens, each behind the probe; B before D
   because D's lineup is B1's stage with five bodies on it.
3. **C** independent of B and D; after A1 only because its HUD labels live in the frame.
4. **B6** after B5, if room.
5. **E** last, on its numbers.
6. **M12's content**, in M12's order — unchanged by anything here. F4(a)'s "skins as
   parameters" is answered by M13's glTF skins and B5's picker; the F4 row should say so when
   M12 is next touched.

## Needs a browser

Everything about *feel*, and nothing about *fit*: whether the nav buttons read as smeared
rather than broken, the backdrop's fade against a bright map, the stage's key light on a dark
skin, the whip, the pitch, the accordion's rise. Fit is the probe's, at eight viewports, and a
report that a screen "looks cut off" is answered by running it.

## How to start — the next brief

**Every phase of Milestone 15 is done** — A, B, C, D and E, each recorded above with its
gate's numbers, plus the seven spawn zones between C and D. E shipped on its three numbers
(the leak flat over 100 cycles, 0.27 ms of sim a frame, +4 kB) and stopped at its gate, as
asked, with one thing for the human: the page's first menu now pays the skins' ~500 ms
parse once, where the first match used to pay it under the intro. **B6 is deferred past
this milestone** (the human's call, 2026-09-15). What is left is the close: the human's
verdict on E's numbers and its hitch, then this section moves verbatim to
`docs/archive/plan/22-m15-front-end.md` with the provenance line the other files carry and
a row in the index, the way M13 and M14 closed — `npm run check:plan` holds the file to it.
The milestone after opens on B6: `characterIndex: u8` on `EntitySnapshot` and the join,
`RandomCharacterSelector` as the fallback for a body that declared none, `check:authority`
and the netharness over it — the one `shared/net` change M15 deliberately did not make.

**Before the close, one more round (2026-09-16).** The human's third playtest report — the
chrome, the player card and Create-a-Class round 3 — is proposed above in full, with its causes
measured and decisions 9–13 in the table; it is built in four groups (R1–R4) in the order its
last paragraph gives, each recorded as a `done` subsection under it, and the milestone closes
after it. **The five decisions were taken the same day, every one on the recommendation**
(FIGHT · SURVIVE · WIN; the dot honest; bars 80 px at 8 / 6; a panel; the plates), so nothing
is waiting: the next thing built is **R1.1**, alone, through the probe, then the rest in the
order the report gives.

**Closed (2026-09-19).** R1–R4 built and recorded above with the pane's numbers; the gate green
— `npm run layout` PASS at 32 surfaces × 8 viewports, `npm run check` green, 138 tests — and
the client at 1 570.37 kB / 453.73 gzip. The open item E left, the ~500 ms skins parse on the
page's first menu, is carried into the next milestone's table rather than decided here. This
section moves to `docs/archive/plan/22-m15-front-end.md`; Milestone 16 opens on B6.
