# The animation library

Every skinned body in the game — bots and remote players alike — is drawn with the clips in
this folder. Nothing here is discovered at runtime: a file is used only once
`src/client/characters/CharacterCatalog.ts` names it in a **slot**, and `npm run
check:animations` refuses a file nobody catalogued, a catalogue entry nobody shipped, and a
slot the selector could ask for and find empty. A slot is a pose the game asks for
(`crouchIdleAiming`, `deathStand`, …); it can hold several clips — **variants** — and which one
a body wears is dealt from facts every client shares (`AnimationVariant.ts`), never at random.

## Folders

| Folder | What goes in it | Slots |
|---|---|---|
| `locomotion/stand/` | standing loops: idle, walk, run and sprint, relaxed and weapon-ready. `_Pistol` marks the sidearm set | `idleRelaxed`, `idleWeaponReady`, `walkRelaxed`, `walkWeaponReady`, `runRelaxed`, `idleWeaponReadyPistol`, `walkWeaponReadyPistol`, `runWeaponReadyPistol` |
| `locomotion/crouch/` | the kneel and the crouched walk and run. The hitbox rig wears a layout per crouch loop (`HUMANOID_CROUCH_*_RIG`), so a new loop here is measured with `scripts/measure-crouch.mjs --pose` before it is admitted | `crouchIdleAiming`, `crouchWalkAiming`, `crouchRunAiming`, `crouchIdleAimingPistol` |
| `locomotion/slide/` | a slide loop, when one is authored. Until then a slide draws the crouch loops and wears their layouts | — |
| `transitions/` | one-shots between stances and between the ground and the air, named `Transition_<From>_To_<To>`. `_Pistol` marks a sidearm's version of a pair, which exists because the kneel and the half-squat are 10.9 cm apart | `crouchToStand`, `standToCrouch`, `crouchToStandPistol`, `standToCrouchPistol`, `jumpLaunch`, `jumpLand` |
| `actions/` | one-shots the body does while otherwise standing still or walking: the reloads, the three throws and the knife | `reloadStand`, `reloadWalk`, `reloadCrouch`, `throwStand`, `throwWalk`, `throwCrouch`, `meleeStand` |
| `deaths/` | falls. Variants are indexed by the simulation's `deathVariant`, so `DEATH_VARIANTS` (`shared/ai/BotVisualState.ts`) must be a multiple of each death slot's count | `deathStand`, `deathCrouch` |
| `incoming/` | **dropped here, never loaded.** Where a new export waits to be read and sorted | — |

There is deliberately no flinch folder. `BotVisualState.flinchSerial` is still replicated and still
drives a hit reaction, but that reaction is the procedural lean in `CharacterAvatar.flinch` — a
0.075 rad rotation away from the round over 0.18 s — and the human's call (2026-09-25) is that an
authored clip is not wanted. A flinch clip would also have to interrupt whatever the body was
doing at a rate set by incoming fire, which is the one thing the transition channel is worst at.

## Adding a clip

1. Drop the export in `incoming/`.
2. `node scripts/animation-manifest.mjs incoming` — what is actually in the file: how many
   clips, their names and lengths, which bones they animate, which of those bones the skins
   lack, and the hips' height through the clip (a kneel is ~0.42 m, the half-squat family
   ~0.49, standing ~0.9). Decide the slot from that, not from the file name.
3. For a crouch loop, `node scripts/measure-crouch.mjs --pose` — the crown against the layout
   the rig wears for that slot. A delta past the layout's padding means the layout moves with
   the clip, or the clip does not go in.
4. `node scripts/animation-import.mjs incoming/<File>.glb <folder>` — writes
   `<folder>/<File>.glb` with exactly one clip, named `<File>`, and removes the source. This
   is the **export contract**: one named clip per file. A Blender/Mixamo session export
   carries every clip of the session and only the last is the one wanted; the tool keeps that
   one, byte for byte, and drops the rest.
5. Add it to the slot in `CharacterCatalog.ts` as `'<folder>/<File>'`, bump
   `CHARACTER_VERSION`, and run `npm run check`.

## One clip family per weapon class, and the rule that makes a partial one safe

The library has two standing-and-kneeling sets: the rifle's and the sidearm's (`_Pistol`). The
sidearm's is **incomplete** — four standing loops, one kneel, two transitions, and nothing for the
crouched walk, the crouched run, the reloads, the relaxed loops or the falls.

An incomplete set is admissible because of one rule, and only because of it: **`selectLocomotion`
and `rigLayoutFor` are given the same three facts and fall back together.** Where the sidearm has
no clip the body is drawn in the rifle's, and the hitbox layout it wears is the one that clip was
measured against. The clip and the boxes therefore cannot disagree about which pose a body is in,
whatever it is holding — which is what M13 decision 11 was protecting when it refused to admit half
a family, and `AnimationSelector.test.ts` asserts it over every (stance, speed, weapon) rather than
leaving it as a claim. A new class-specific clip must keep that property or it does not go in.

The one pose that does need its own layout is the sidearm's kneel: `Crouch_Idle_Aiming_Pistol` is a
half-squat with the crown **10.9 cm above** `humanoid-crouch`'s head box, so it wears
`humanoid-crouch-pistol`, built from `measure-crouch.mjs --pose` the way the other three were.

## The jump is two clips, not one

`jumpLaunch` and `jumpLand` meet exactly — the launch ends with the hips at 0.914 m, the landing
starts there, and the landing ends where `Idle_Aiming` sits. The air between them is the physics',
not a clip's: the launch is a one-shot, it clamps on its last frame, and that frame *is* the air
pose for however long the body is off the ground. Nothing was added to the wire for it, because
`AIRBORNE` has been a `StanceId` since S5.3 and on the snapshot ever since.

A full-cycle jump export (wind-up, air, landing in one clip) cannot be used here for that reason,
and neither can a drop authored from a ledge height: under the root lock its planar travel is
discarded while its **height** track plays, so the body is drawn a metre above its own feet and
then falls. Three such exports are in `incoming/` with this note as their reason.

Every file here is on the contract — the eleven originals were session exports until
2026-09-14, when the same tool rewrote them in place (identical track data, 6.9 → 1.4 MiB).
`check:animations` refuses a file that is not, and the runtime asks for the clip by name and
throws if the name is missing, so a session export dropped straight into a slot folder fails at
the gate rather than at a match.

## Skeletons

The skins are 65-bone Mixamo rigs (Apex and Pulse 67 with eye bones, Sentry 69 with `Neck1`
and `Jaw`). The original files were exported on the 65-bone skeleton; the newer ones on a
69-bone one whose `mixamorigNeck1` six of the seven skins lack, so on those skins the head
lands 3–4 cm lower than authored (measured in PLAN.md, M13 C1 and D). `importClip` drops a
track for a bone the skin does not have; nothing is retargeted. Export on the 65-bone skeleton
when you can.

**This cannot be fixed in the file**, and it is worth saying once so nobody tries (asked and
answered, 2026-09-25). Deleting the extra bones changes nothing — `importClip` already drops
their tracks on a skin that lacks them, so the pose they carried is already gone, and removing
them would only take it away from Sentry too, which *can* bind them. Baking `Neck1`'s rotation
down into `Neck` recovers the angle but not the 3–4 cm, because that distance is the bone's own
length in a chain the 65-bone skin does not have; putting it back means writing a `Head`
translation track computed against one skin's bind pose, and these files are one template shared
by all seven. It is retargeting, it belongs in an animation tool, and the fix is to re-export the
clip having picked a 65-bone character in Mixamo.

Twelve of the shipped files are still on the 69-bone skeleton: the three reloads,
`Death_Stand_01`, `Sprint_Relaxed`, `Transition_Stand_To_Crouch_Aiming`, and the six remaining
pistol files. `scripts/animation-manifest.mjs` prints the column, so the list is never a guess.
