# Weapon asset pipeline

The weapons were primitives from `WeaponModelSpecs` since M2. M19 moves them to GLB files,
one weapon at a time, behind the same `WeaponModel` contract the primitives satisfy — and puts
an attachment pack on sockets each file carries, so a suppressor is a thing on the gun rather
than a number in `Attachments.ts`. This is the handover for that pipeline: what a file must
contain, how it is built, and who owns it at runtime. PLAN.md's Milestone 19 is the record of
why.

```text
../GLB_files/weapons/*.glb          the Sketchfab downloads, outside the repository
              |
              v
scripts/weapon-build.mjs            one recipe per output: select, group, place, measure
              |                     (JSON pass, no package) then gltf-transform (pinned, npx)
              v
public/models/weapons/<id>.glb      the weapon, in viewmodel space, with its sockets
public/models/weapons/<id>.lod1.glb the same weapon for the bodies at twenty metres
public/models/weapons/att_*.glb     the pack: optic, suppressor, grip, laser
public/models/weapons/CREDITS.md    regenerated from the recipes' attribution records
              |
              v
scripts/check-weapons.mjs           the gate: budgets, the contract's nodes, attribution,
              |                     and the client's list against the recipes
              v
WeaponAssetCatalog (client)         which weapon ids have a file, and their versioned URLs
WeaponAssetService (Game lifetime)  fetch and parse once, validate the contract, share the template
buildWeaponModel (WeaponMesh)       clone the template into a WeaponModel, or build the primitives
ClientMatch / WeaponPreview         hold a model; upgrade in place when a late file lands
```

## The file's contract

Everything is in the viewmodel's space so nothing downstream converts: **metres, the barrel
down -Z, +Y up, the origin at the centre of the receiver** (`WeaponMesh`'s local space).

| node | what it is |
|---|---|
| `<weaponId>` | the root, named for the weapon |
| `body` | everything static |
| `magazine` | dropped and re-seated by the reload; identity transform at rest |
| `charge` | the charging handle, bolt or pump, pulled on the empty reload; may be empty |
| `magazine_ext` | the extended magazine where the source had one; absent, the stretch is used |
| `optic_default` | the irons, hidden when an optic mounts; may be empty |
| `socket_muzzle` | the barrel tip, on the bore: the flash's parent, the suppressor's mount |
| `socket_rail_top` | the receiver's rail: the optic's mount |
| `socket_rail_front` | the handguard's top rail: the laser's mount |
| `socket_rail_bottom` | the rail under the handguard: the grip's mount |
| `socket_sight` | the iron sight line; its Y is `WeaponModel.sightHeight` |
| `socket_grip`, `socket_support` | where the hands go: the first-person gloves, later a body's palms |

A socket is an empty node whose +Y is the mount's up and -Z its forward. A pack part
(`att_*.glb`) has its origin on its mating face and a single `part` group, so mounting is
`socket.add(part)`; the optic carries its own `socket_sight` (the line the ADS pose cancels
once it is on), the suppressor its own `socket_muzzle` (where the flash moves to).

Budgets, held by `npm run check:weapons`: a weapon ≤ 30k triangles and 4 MB, its LOD ≤ 10k
and 1 MB, a pack part ≤ 8k and 1 MB; textures ≤ 1024 on a side (the LOD 256), WebP or JPEG;
a weapon between 0.15 and 1.5 m long; an `asset.extras.attribution` record on every file.

## Building

```bash
node scripts/weapon-build.mjs             # every recipe
node scripts/weapon-build.mjs ar_carbine  # one
```

A recipe names the source, the unit and the source's forward and up axes, the nodes to keep
under each group, and two functions — `origin` and `sockets` — that answer in source space
from measurements the script takes on the mesh (`bounds`, `tip`, `top`). Numbers are measured
rather than typed: the bore is the mean of the barrel's vertices at its tip, the rail is the
top of the receiver where no sight stands. The build refuses a recipe whose attribution
record disagrees with the source file's own `asset.extras` (Sketchfab writes the title,
author, licence and URL into every download), and rewrites `CREDITS.md` from the records.

Sources are not in git. `../GLB_files/weapons/` beside the repository holds them, as
`../FBX_files` holds the bodies'. A rebuild is byte-identical; after one that changes a file,
bump `WEAPON_ASSET_VERSION` in `WeaponAssetCatalog.ts` so cached clients fetch it.

Never build from a game rip. The tells are in the file — `.smd` mesh names, `tag_*` bones,
`wpn_*`/`att_*` materials, gunsmith-style variants in a "free" model — and the licence on the
page is not the uploader's to give.

## Runtime ownership

- **`WeaponAssetService`** is `Game`'s, for the application's life. One fetch and parse per
  file; the template is validated against the contract once and shared. `Game` warms the
  equipped class's two weapons on every screen outside a match, so a match usually starts
  with its templates ready.
- **`buildWeaponModel`** is synchronous. With a template it clones the file; without one — no
  file for this weapon, still loading, failed — it builds the primitives as before, and
  `WeaponModel.source` says which. The gloves are the procedural boxes carried to the file's
  hand sockets (`handBoxesAt`).
- **`ClientMatch` and `WeaponPreview`** upgrade in place: a model built on the primitives asks
  `preload` to tell it when the file lands and rebuilds the mesh only, checking the slot still
  holds that weapon. The weapon object, its ammunition and the animation state never move.
- **A template is never disposed by an instance.** `dispose` on a model from a file releases
  the gloves' geometry and clears the tree; the service releases the templates when the
  application is torn down.

## Where it stands

| weapon | file |
|---|---|
| `ar_carbine` | `ar_carbine.glb`, from the M4 kit |
| every other weapon | the primitives, until its stage-3 recipe lands |

The attachment pack mounts on any weapon with a file: the optic on `socket_rail_top` (and the
sight line moves to its own `socket_sight`), the suppressor on `socket_muzzle` (and the flash
moves to its own), the grip on `socket_rail_bottom`, the laser on `socket_rail_front`, and the
extended magazine as the `magazine` group stretched along the well. The camo is not applied to
a file yet (decision 4: an overlay on the albedo, stage 3), and the bodies still carry
`buildHeldWeapon`'s primitives (stage 3).
