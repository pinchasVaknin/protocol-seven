<!-- Moved verbatim from PLAN.md lines 526–651 at 974f9d7 (2026-09-22). Part of the PROTOCOL SEVEN plan record; PLAN.md holds the index. -->

# Milestone 18 — the debrief: the result, the podium, the XP, and the board on a tab

Opened 2026-09-20 from the human's brief in chat, with two reference images (a result card —
VICTORY over two team plates, a match summary and an XP bar — and a two-column scoreboard with
an awards row) and three playtest reports. The plan was described to the human before any code
was written and built after their answers, which are the decisions below. Everything here was
built in the session that opened it; what remains is the human's playtest.

## The brief, as read

The end-of-match screen as *two screens in one*. **The first** opens on the result card: how
much each side made, against whom, on which map, how much XP was earned. Then the team plates
rise and go, the word shrinks to the top, the map card drops and goes, the XP stays at the
foot — and the best players of the match come in, stand on a podium (gold, silver, bronze;
MVP on the first) and their statistics rise under them. PLAY AGAIN and a way back to the menu
at the side. **The second** is the full board: score, kills, deaths, assists for everybody on
both sides, the reference's second image. Space is PLAY AGAIN. And the second button is *not*
"return to lobby" — in multiplayer PLAY AGAIN already is the lobby — it returns to the main
menu, under another name.

The three reports: Play Solo has no way back; the intro's overview stands beside the map rather
than over it; the device gate on a phone is small and cluttered.

## Decisions taken (2026-09-20, the human's answers)

1. **Three on the podium, from the whole match.** Gold, silver and bronze are a set of three,
   and the podium ranks individuals: the ladder's top three whichever side they were on, the
   crowned winner pinned first where a mode crowns one. A hostile MVP on a DEFEAT screen says
   what happened. (It was the winning side's five; `Lineup.ts` now says why.)
2. **The board is a tab.** PODIUM | SCOREBOARD in the head, and Tab turns it, as in a match.
   Never automatic: the podium is the moment.
3. **PLAY AGAIN restarts the same match in single-player** — map, mode, difficulty as they
   stand. Connected it reads NEXT MATCH with the server's countdown, because the server runs
   the ballot and the rotation and there is no "again" to give.
4. **MAIN MENU** is the secondary's name, with the arrow BACK carries elsewhere. Offered in
   single-player too, now that the primary no longer goes there.
5. **AFTER ACTION REPORT** names the place in the header, with the mode and the map under it
   — which is also where the map's name stays once the mission card has left.
6. **The XP accordion stays**, and the cadence starts when the podium has landed. It does not
   open on its own here (D2's rule): the list would open over the stat cards. The strip
   says how many unlocks it holds and a click opens it.
7. **Team emblems — the human's two, later the same day.** A wolf on a shield with the blue
   edge and a horned demon on the same shield with the red edge, supplied as JPEGs with the
   checkerboard baked in and keyed to alpha (`public/brand/team-allies.png`, `team-axis.png`;
   `Emblem.ts` says how). On the result card's plates, over the top edge, and before ALLIES /
   AXIS on the board's headings. The colours are the artwork's: the sides are relative, so the
   wolf is always the viewer's own and the demon always the other, and a colourblind palette
   recolours the plate and the name around them.
8. **The keys arm a second in.** Space, Escape and Tab mean nothing for the first second —
   the hand still holding jump, the Escape aimed at the pause menu — and any other key or a
   click on nothing skips the choreography to its rest.
9. **The score stays with the word.** When the plates lift, `75 — 62` docks beside VICTORY in
   the head rather than leaving with them.
10. **Sharp motion, no bounce.** One ease, decisive.
11. **The hold is thirty seconds, not fourteen.** The human's change to the plan: the
    choreography is not to be squeezed into five seconds; it has ten, and twenty remain for the
    board. `SUMMARY_HOLD_SECONDS` defaults to 30 (README, DEPLOY.md).
12. **The gate's copy is two lines**, the human's own: *PROTOCOL SEVEN is a desktop shooter* ·
    *Open it on a computer.*

## What was built

### The three fixes (commit `aa1ef08`)

- **Play Solo**: BACK at the action bar's left end, Settings' button in Settings' place, and
  Escape is the same press (`Menus.handleEscape`).
- **The intro's overview** (`IntroPlan.ts`): the heading eases once, with the climb, from the
  approach's onto the map's centre — a heading that held while the ray turned put the camera
  beside the map looking past it. Measured before: 30° to 150° off-axis on twelve of
  Foundry's sixteen spawns and six of Depot's eighteen. After: every spawn within 1°. The
  fan now prefers the *smallest* turn that clears, in two bands — up to 60° at every
  elevation before anything wider at any — so Foundry B's spawns take 36° straight back over
  45° from across the map, and the largest turn left on any map is 60°. `npm run intro` green.
- **The device gate** off the frame's scale: `op-screen--gate` takes the zoom off its viewport
  and the screen is laid out in window pixels as a portrait column — the lockup at two thirds
  of the width, the two lines, FIGHT · SURVIVE · WIN at the foot.

### The debrief (`EndOfMatch.ts`, rewritten; `app.css` `.dbf`)

The shared chrome, then three rows in the frame: the head (64), the body (694), the band
(84). The choreography runs on the render clock (`tick`), one class per phase on the frame,
the staggers inside a phase as `transition-delay`s in the stylesheet:

| at | phase | what |
|---|---|---|
| 0.0 | `dbf--card` | the word lands (a hit), the reason, the plates in from the sides with VS, the mission card up, the band |
| 4.2 | `dbf--dock` | the plates lift and fade, the card drops, the word is FLIPped onto the head's box; a sweep |
| 4.8 | `dbf--docked` | the head takes over: the small word, the score, the reason, the tabs |
| 4.9 | `dbf--podium` | the stage fades in; bronze, silver, gold walk onto their blocks, 0.3 s apart |
| 7.0 | `dbf--plates` | the medal and the name under each, bronze first, a note each |
| 7.6 | `dbf--stats` | the stat cards: score, kills, deaths, K/D |
| 8.2 | `dbf--rest` | the XP cadence starts |

`settle` is the skip and the layout probe's: every phase at once, the transitions off for
the frame it takes, the bodies on their marks, the cadence started. `settleCard` holds the
card alone for the probe's `summary/card`.

- **The podium** is `CharacterStage` with a new platform (`PODIUM_STAGE`): three blocks at
  `PODIUM_X` and `PODIUM_STEPS` (`Lineup.ts`, pure, tested), the lens tilted down so the feet
  land in the upper two thirds of the canvas and the plates hang in the lower third.
  `walkIn` puts each body 3.2 m behind its block and moves it onto the mark at 2.4 m/s; the
  avatar reads its own planar speed and its selector answers with the walk clip, so the walk
  is the same walk a bot walks. A body is invisible until its turn.
- **The board tab** is the same `Scoreboard`, each side a plate with its name on the top edge
  in its colour, and an awards row under it: MVP, BEST K/D, MOST ASSISTS, LONGEST STREAK.
- **The header's card follows the bar**: `XpSummary.onLevel` → `EndOfMatch.setShownLevel`,
  so LEVEL 55 beside the callsign flips with the flourish rather than before it.
  `XpSummary.prime` paints the strip before the cadence so it reads from the first second.
- **Three cues** in `ProceduralAudio`: `playDebriefHit` (the splash's hit with a bright
  partial on a win), `playDebriefSweep` (the dock), `playDebriefMedal` (523 / 659 / 784 Hz
  as bronze, silver, gold land — a chord, the gold's with a second partial).
- **PLAY AGAIN in single-player**: `Game.leaveSummary` tears the world down and enters MATCH,
  which builds a fresh one on the same selection — a fresh intro, deck and seed.
- **Edge cases**: Free-for-All's plates are the winner and the runner-up with their kills; a
  draw's podium is the ladder's top three under DRAW; the Range has no summary, as before.

### Verified

`npm run check` (150 tests, the podium's among them), `npm run layout` (every surface at six
viewports, the debrief at `summary/card`, `summary/{2,6,10}`, `/xp`, `/board`, `/ffa`), and the
screen driven end to end in the browser pane: the choreography, Tab, the click that skips,
Space into a new match, Escape to the menu.

## Open

- **The human's playtest**, with sound.
