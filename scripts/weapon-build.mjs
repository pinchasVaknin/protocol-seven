#!/usr/bin/env node
/**
 * The weapon asset build (M19, stage 0).
 *
 * The viewmodels were primitives from `WeaponModelSpecs` since M2, and the five attachments
 * were numbers only: nothing on the gun changed when a suppressor went on. M19 moves the
 * weapons to GLB files behind the same `WeaponModel` contract, and mounts an attachment pack
 * on sockets each file carries. This script is where a Sketchfab download becomes a file that
 * contract can read — one recipe per output, and the recipe is the whole record of what was
 * taken from the source and where the sockets were measured.
 *
 * ## What a recipe does
 *
 * A source is a scene as the artist left it: the M4 kit is an assembled rifle with every
 * alternative part spread around it, the AK-74 pack is eight rifles in a row, the laser is a
 * box in inches lying on its side. A recipe names the nodes to keep, groups them under the
 * contract's names (`body`, `magazine`, `charge`, `optic_default`), and places the file in the
 * viewmodel's space — metres, the barrel down -Z, +Y up, the origin at the receiver — by
 * baking every kept node's world matrix through one fix. The sockets are empty nodes at
 * measured points: the bore at the barrel tip (`socket_muzzle`), the rail surface where an
 * optic sits (`socket_rail_top`), the handguard's top rail where the laser sits
 * (`socket_rail_front`), the rail under the handguard (`socket_rail_bottom`), the iron
 * sight line (`socket_sight`, whose Y is `WeaponModel.sightHeight`), and the two hands
 * (`socket_grip`, `socket_support`, where the first-person gloves and a body's palms go), and
 * where the support hand takes the magazine on a reload (`socket_mag_grip`, the middle of the
 * magazine unless a recipe places it). Two are optional: `socket_sight_front`, a front post whose line from `socket_sight` is not
 * parallel to the bore (the ADS pose turns the weapon onto it), and `socket_reticle`, an empty
 * collimator window the runtime puts its dot in. A pack part is the same recipe with its
 * origin on the mating face, so mounting is `socket.add(part)`.
 *
 * The measurements are taken from the vertices, not typed in: the bore is the mean of the
 * barrel's vertices at its tip, the rail is the top of the receiver. A number typed from a
 * screenshot drifts the first time the source is swapped; a number measured from the mesh
 * moves with it.
 *
 * ## The two passes
 *
 * 1. **The JSON chunk, edited directly.** A `.glb` is a header, a JSON chunk and a binary
 *    chunk; selecting, re-parenting, renaming and baking matrices is a rewrite of the JSON
 *    with the binary chunk carried through untouched, so the buffer views stay valid. Forty
 *    lines of matrix maths and no parser package — `glb-images.mjs` set that precedent.
 * 2. **`@gltf-transform/cli` at a pinned version through `npx`**, as `skin-compress.mjs` runs
 *    it and for the same reason (S2 admits no new package): `prune` drops everything the kept
 *    nodes do not reference, `dedup`, `resize` to 1024, `webp`; then `weld` and `simplify` for
 *    the bodies' LOD. The CLI cannot select or rename a node, which is why pass 1 exists.
 *
 * ## Running it
 *
 * Sources live outside the repository in `../GLB_files/weapons/` (the sibling of
 * `../FBX_files`, where the bodies came from) — 313 MB of downloads do not belong in git.
 * `node scripts/weapon-build.mjs` builds every recipe; `node scripts/weapon-build.mjs ar_carbine`
 * builds one. The outputs are committed like any other asset and `check:weapons` holds them to
 * the budget. Attribution is a condition of CC-BY, not a courtesy: every output carries its
 * source's title, author, licence and URL in `asset.extras`, and `CREDITS.md` beside the files
 * is regenerated from the same records. A Sketchfab download carries the same four facts in its
 * own `asset.extras`, and the build refuses a recipe whose record disagrees with its file — the
 * credit line is copied from the artist's upload, not typed from memory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGlb } from './glb-images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = path.resolve(ROOT, '../GLB_files/weapons');
export const OUT_DIR = path.join(ROOT, 'public/models/weapons');
/** Pinned: the pass should produce the same bytes next year as today. */
const CLI = '@gltf-transform/cli@4.5.0';
const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');

/**
 * The viewmodel's texture ceiling, and the bodies' LOD takes a quarter of it. A recipe may set
 * `textureSide` lower: the pistol is a fifth of a rifle's screen and its nine materials at
 * 1024 were 2.8 MB.
 */
const MAX_SIDE = 1024;
const LOD_SIDE = 256;
const WEBP_QUALITY = 85;
/**
 * The LOD asks for this fraction of the vertices, with the error limit loose (a fraction of the
 * mesh radius). meshopt cannot collapse across UV seams and hard edges, and a kit mesh is
 * mostly seams — the M4 stalls at about a third whatever the ratio — so `check:weapons` holds
 * the result to 10k triangles rather than the 5k first written down, and the draw calls are
 * what `join` cuts: one primitive per material, five for the M4.
 */
const LOD_RATIO = 0.15;
const LOD_ERROR = 0.1;
/** A plateau bin counts as a surface when it holds this share of the fullest bin. See `plateau`. */
const PLATEAU_SHARE = 0.4;
/** Metres the optic's clamp plate sinks below the rail surface it mounts on. See `att_optic`. */
const OPTIC_CLAMP_SINK = 0.006;
/**
 * Metres from the eye to `socket_sight` at full ADS — `SIGHT_DISTANCE` in `WeaponMesh.ts`,
 * restated for `sightOver`, which needs to know where the eye is to know what it sees.
 */
const SIGHT_EYE_DISTANCE = 0.2;

// -- the sources ---------------------------------------------------------------

/**
 * The licence a source is used under, as a deed the reader can open. A licence name on its own
 * ("CC-BY-4.0") is a label; the attribution Creative Commons asks for names the licence *and*
 * links to it, and Sketchfab's own copy button writes exactly that sentence — see
 * `creditSentence` below, which is the form reproduced in `CREDITS.md` and in the game.
 */
export const CC_BY_4 = 'http://creativecommons.org/licenses/by/4.0/';
export const SKETCHFAB_STANDARD = 'https://sketchfab.com/licenses';

const M4_KIT = {
  file: 'free_-_m4_modular_kit_gun.glb',
  title: 'Free - M4 Modular Kit Gun',
  author: 'Karnaval',
  authorUrl: 'https://sketchfab.com/amadions',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/free-m4-modular-kit-gun-1665416c071747bb9c20aa652849b579',
};
const AK74_PACK = {
  file: 'ak-74_pack_game_asset.glb',
  title: 'AK-74 Pack (game asset)',
  author: 'Armored Wave',
  authorUrl: 'https://sketchfab.com/armoredwave',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/ak-74-pack-game-asset-29978f495f824173b44a3ba40cb8ebd8',
};
const P90 = {
  file: 'modular_p90_tactical.glb',
  title: 'Modular P90 Tactical',
  author: 'doomsentinel',
  authorUrl: 'https://sketchfab.com/doomsentinel',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/modular-p90-tactical-080897fc0366455884b1a916684313fe',
};
const MP5_KIT = {
  file: 'free_modular_mp5_kit.glb',
  title: 'Free Modular MP5 Kit',
  author: 'Karnaval',
  authorUrl: 'https://sketchfab.com/amadions',
  license: 'SKETCHFAB Standard',
  licenseUrl: SKETCHFAB_STANDARD,
  url: 'https://sketchfab.com/3d-models/free-modular-mp5-kit-d381a0438a8b45c2bac6f59120fbb52f',
};
const TAVOR = {
  file: 'tar-21_tavor.glb',
  title: 'TAR - 21 (Tavor). Black and White.',
  author: 'Nik Vega',
  authorUrl: 'https://sketchfab.com/Nik_Vega',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/tar-21-tavor-black-and-white-40dc15941e0b456692c83a97bfcd2474',
};
const SPAS_12 = {
  file: 'spas_12.glb',
  title: 'Spas 12',
  author: 'Luiz Bueno',
  authorUrl: 'https://sketchfab.com/Luiz159753',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/spas-12-614140daf5e4467fa0e36b6c23d70621',
};
const BERETTA_M9 = {
  file: 'beretta_m9.glb',
  title: 'Beretta M9',
  author: 'eNse7en',
  authorUrl: 'https://sketchfab.com/ense7en.design',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/beretta-m9-348015284eca46fe8e1822508381dfd8',
};
const M150 = {
  file: 'm150_sniper_rifle_game_ready.glb',
  title: 'M150 Sniper Rifle (Game Ready)',
  author: 'Bl4ckGh0st',
  authorUrl: 'https://sketchfab.com/Bl4ckGh0st',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/m150-sniper-rifle-game-ready-0f71498f1f694b30be77c9779361c6cc',
};
const L1A1 = {
  file: 'free_-_modular_l1a1_slr.glb',
  title: '[FREE - Modular] L1A1 SLR',
  author: 'Aperture Aerospace',
  authorUrl: 'https://sketchfab.com/Apeture_Aerospace',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/free-modular-l1a1-slr-d63c3e0d97464bc5b2a58cadf35e52f5',
};
const L115A3 = {
  file: 'l115a3.glb',
  title: 'L115A3',
  author: 'Mortavex',
  authorUrl: 'https://sketchfab.com/Mortavex',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/l115a3-3b732b97c72440229c17b78e565f965e',
};
const MTECH_KNIFE = {
  file: 'mtech_usa_xtreme_tactical_knife_low-poly.glb',
  title: 'MTech USA Xtreme Tactical Knife Low-poly',
  author: 'xivxiy',
  authorUrl: 'https://sketchfab.com/xivxiy',
  license: 'SKETCHFAB Standard',
  licenseUrl: SKETCHFAB_STANDARD,
  url: 'https://sketchfab.com/3d-models/mtech-usa-xtreme-tactical-knife-low-poly-789da4919af740479eb8dc7c4901ae89',
};
const HAND_WITH_GLOVES = {
  file: 'hand_with_gloves.glb',
  title: 'Hand With Gloves',
  author: 'JUST',
  authorUrl: 'https://sketchfab.com/teenjust500',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/hand-with-gloves-5a6a434b8ec943ffacc581358781eecb',
};
const DBAL_A2 = {
  file: 'rifle_laser_sight.glb',
  title: 'Rifle Laser Sight',
  author: 'trolosqlfod',
  authorUrl: 'https://sketchfab.com/trolosqlfod',
  license: 'CC-BY-4.0',
  licenseUrl: CC_BY_4,
  url: 'https://sketchfab.com/3d-models/rifle-laser-sight-55d74d7d4f6a4071af856d2ffc2c429a',
};

// -- the recipes ---------------------------------------------------------------

/**
 * A selector names mesh nodes in the source. `name` matches the node or its parent (Sketchfab
 * exports put the mesh on a child called `defaultMaterial`), `material` the first primitive's
 * material, `joint` the joint most of a skinned mesh's vertices are bound to (a rigged rifle's
 * magazine is the mesh on the magazine bone); a selector must match exactly one node unless
 * `all` is set; `match` is a regular expression over the same names and takes every hit,
 * `except` a regular expression that drops a hit, and `within` keeps a hit only when the
 * centre of its bounds lies inside the given axis ranges — one of two pistols in a scene.
 * `useMaterial` swaps the kept primitives onto another of the source's materials by name —
 * the Tavor's white body onto its black set's texture.
 *
 * `forward` and `up` are the source's axes for the barrel and the top of the weapon, and the
 * fix rotates them onto -Z and +Y. `unit` is metres per source unit. `origin` and `sockets`
 * receive the measurements (`m`) and answer in source world space, before the fix.
 *
 * `moves` assembles a spread kit: each entry carries every part in `parts` by the vector from
 * the centre of `anchor`'s bounds to the centre of `target`'s — the alternative handguard onto
 * the place the assembled one occupies — before anything is measured, so the sockets see the
 * assembled weapon. `magazineExit` is the direction the magazine leaves along on a reload,
 * in the source's axes; absent means straight down, which is every weapon but the P90.
 */
export const RECIPES = {
  ar_carbine: {
    kind: 'weapon',
    source: M4_KIT,
    unit: 0.01,
    forward: 'z+',
    up: 'y+',
    parts: {
      body: [
        { name: 'Upper', material: 'Body' },
        { name: 'Lower', material: 'Body' },
        { name: 'Handguard', material: 'Keymod_material' },
        { name: 'Grip', material: 'Grip_Default' },
        { name: 'Stock', material: 'Classic_Stock' },
        { name: 'Trigger', material: 'Body', pick: 'highest' },
      ],
      // The kit's assembled magazine; its "Large" is thicker, not longer, so the extended
      // magazine is the stretch, not a second mesh.
      magazine: [{ name: 'Magazine', material: 'Magazine_Light' }],
      irons: [],
      charge: [],
      optic_default: [],
    },
    /**
     * The kit's own sights stand 3.5 cm over the receiver and 7.1 cm over the bore — a
     * millimetre under a mounted red dot's line, which is where the playtest found them: in
     * the middle of the sight picture. Each is a hand's width of vertices above the flat top
     * of its part, so a box over that top takes the sight and leaves the rail it stands on.
     */
    splits: [
      { part: { name: 'Upper', material: 'Body' }, group: 'irons', name: 'irons_rear', box: { y: [0.045, 1], z: [0.02, 0.05] } },
      { part: { name: 'Handguard', material: 'Keymod_material' }, group: 'irons', name: 'irons_front', box: { y: [0.045, 1], z: [-0.33, -0.29] } },
    ],
    // The receiver's centre: the bore's height, the upper and lower's middle along the barrel.
    origin: (m) => {
      const bore = m.tip({ name: 'Handguard', material: 'Keymod_material' });
      const upper = m.bounds({ name: 'Upper', material: 'Body' });
      const lower = m.bounds({ name: 'Lower', material: 'Body' });
      return [0, bore[1], (Math.min(upper.min[2], lower.min[2]) + Math.max(upper.max[2], lower.max[2])) / 2];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'Handguard', material: 'Keymod_material' });
      const upper = m.bounds({ name: 'Upper', material: 'Body' });
      const guard = m.bounds({ name: 'Handguard', material: 'Keymod_material' });
      const grip = m.bounds({ name: 'Grip', material: 'Grip_Default' });
      // The rail surface: the slat tops of the receiver's rail over its middle half, where no
      // sight stands. `top` answered 3 mm proud of them (a notch), and an optic sat on the
      // notch with daylight under its clamp.
      const railTop = m.plateau({ name: 'Upper', material: 'Body' }, 0.35, 0.85);
      return {
        socket_muzzle: bore,
        // Over the receiver, where a red dot sits: the rear third of the rail.
        socket_rail_top: [0, railTop, upper.min[2] + (upper.max[2] - upper.min[2]) * 0.62],
        // Under the handguard, at the middle of its length.
        socket_rail_bottom: [0, guard.min[1], (guard.min[2] + guard.max[2]) / 2],
        // The handguard's right-hand face at the bore's height, halfway along: the laser's.
        // On the top rail it stood in the optic's line of sight (playtest 3).
        socket_rail_front: { at: [m.side({ name: 'Handguard', material: 'Keymod_material' }, 0.3, 0.6), bore[1], guard.min[2] + (guard.max[2] - guard.min[2]) * 0.45], roll: -90 },
        // The irons' line: the aperture sits just under the sight's top edge.
        socket_sight: [0, upper.max[1] - 0.4, 0],
        // Where the hands go (stage 1). The trigger hand's centre sits on the pistol grip,
        // two fifths of the way down it; the support palm cups the handguard's underside a
        // little short of halfway along. The first-person gloves are built on these.
        socket_grip: [0, grip.max[1] - (grip.max[1] - grip.min[1]) * 0.4, (grip.min[2] + grip.max[2]) / 2],
        socket_support: [0, guard.min[1] - 1.8, guard.min[2] + (guard.max[2] - guard.min[2]) * 0.42],
      };
    },
    lod: true,
  },

  /**
   * MERIDIAN P40: the P90, assembled with every module on. The body and the rail frame are
   * the weapon; the silencer, foregrip and flashlight are the pack's job and are left out; the
   * collimator stays as `optic_default` — the def's sight is a red dot and this is it — and
   * hides when the HYBRID OPTIC mounts. The magazine lies along the top and leaves upward and
   * backward, which `magazineExit` says.
   *
   * The source's unit is not a millimetre: the body is 854 units for a 500 mm bullpup. The
   * magazine's 488 units for FN's 260 mm agrees within 10%, so the body sets the scale.
   */
  smg_meridian: {
    kind: 'weapon',
    source: P90,
    unit: 0.5 / 854,
    forward: 'x-',
    up: 'y+',
    parts: {
      body: [{ name: 'P90Low003' }, { name: 'FrameLP001' }],
      magazine: [{ name: 'MagBody' }, { name: 'MagazineLPB001' }],
      charge: [],
      optic_default: [{ name: 'ColimatorLP001' }],
    },
    // Back along the receiver's top with a little lift: it used to be mostly up, and a
    // magazine thrown 20 cm into the air over the gun read as a part flying off (playtest 3).
    magazineExit: [1, 0.3, 0],
    // The receiver: the bore's height, and the body's middle along the barrel.
    origin: (m) => {
      const bore = m.tip({ name: 'P90Low003' });
      const body = m.bounds({ name: 'P90Low003' });
      return [(body.min[0] + body.max[0]) / 2, bore[1], 0];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'P90Low003' });
      const body = m.bounds({ name: 'P90Low003' });
      const frame = m.bounds({ name: 'FrameLP001' });
      const optic = m.bounds({ name: 'ColimatorLP001' });
      // The collimator's head — the frame around its window, standing on a long low base.
      const head = m.boundsAbove({ name: 'ColimatorLP001' }, 0.75);
      // The window's middle: at 0.78 of the housing's height (playtest 5), on its centre line.
      const windowY = optic.min[1] + (optic.max[1] - optic.min[1]) * 0.78;
      const windowZ = (optic.min[2] + optic.max[2]) / 2;
      const length = body.max[0] - body.min[0];
      // The body's own rail, under the collimator, for the optic; the frame's top for the
      // laser and its underside for the grip, where the kit's own foregrip sat.
      const railTop = m.plateau({ name: 'P90Low003' }, 0.66, 0.92);
      return {
        socket_muzzle: bore,
        socket_rail_top: [(optic.min[0] + optic.max[0]) / 2, railTop, 0],
        // The frame's right-hand face, at its middle height, for the laser.
        socket_rail_front: { at: [(frame.min[0] + frame.max[0]) / 2 - (frame.max[0] - frame.min[0]) * 0.15, (frame.min[1] + frame.max[1]) / 2, m.side({ name: 'FrameLP001' }, 0.3, 0.8)], roll: -90 },
        socket_rail_bottom: [(frame.min[0] + frame.max[0]) / 2, frame.min[1], 0],
        /**
         * The collimator's **window**, not its housing: the glass is the upper part of the box
         * and the dot belongs in the middle of it. At 0.62 of the height the dot sat along the
         * window's bottom edge and the weapon rode correspondingly high (playtest 5, finding 4).
         * Along the barrel it stays at the base's rear end, which is the distance from the eye
         * the ADS picture was accepted at; only its height and its line have to be the dot's.
         */
        socket_sight: [0, windowY, windowZ],
        /**
         * This source draws an empty window, so the runtime puts the project's dot in it. A
         * weapon whose own sight already carries a reticle — the Tavor's — has no such node and
         * gets nothing, which is what stopped it wearing two (playtest 5, finding 2). **In** the
         * window, halfway through the head's depth: at x = 0 it was at the base's rear end,
         * 7.8 cm behind the glass, a dot floating in the air beside the sight from the hip
         * (playtest 6).
         */
        socket_reticle: [(head.min[0] + head.max[0]) / 2, windowY, windowZ],
        /**
         * The trigger hand on the grip; the support hand **in the front loop**, a quarter of
         * the weapon ahead of it and under the body (playtest 4). They were 4.5 cm apart, and
         * a body given two hand targets that close pulls its arms through each other — the
         * report's *"hands completely twisted, flipped and broken"*. On a P90 the support hand
         * is at the front of the shroud, which is where this now is.
         */
        socket_grip: [body.min[0] + length * 0.42, body.min[1] + (body.max[1] - body.min[1]) * 0.3, 0],
        socket_support: [body.min[0] + length * 0.12, frame.min[1] - 0.02, 0],
      };
    },
    lod: true,
  },

  /**
   * WASP 9: the MP5 kit's assembled core — the SD's fat handguard swapped for the kit's
   * Picatinny handguard and its plain gas block, carried from where they lie below the rifle
   * onto the place the SD gas block occupies (the two gas blocks are the same casting). The
   * fixed stock is the assembled one and stays; the retractable stock lies apart with nothing
   * assembled to align it to. The drum is left out: the extended magazine is the stretch.
   */
  smg_wasp: {
    kind: 'weapon',
    source: MP5_KIT,
    unit: 1,
    forward: 'x+',
    up: 'y+',
    moves: [
      {
        parts: [{ name: 'Gas Block Picat_low_7' }, { name: 'Picat Handguard_low_6' }],
        anchor: { name: 'Gas Block Picat_low_7' },
        target: { name: 'Gas Block SD_low_8' },
      },
    ],
    parts: {
      body: [
        { name: 'Upper_low_40' },
        { name: 'Lower_low_41' },
        { name: 'Trigger_low_28' },
        { name: 'Mag Catch_low_29' },
        { name: 'Fire Selector_low_30' },
        { name: 'Bolt Plate_low_31' },
        { name: 'Rail_low_32' },
        { match: /^Sight (Cylinder|Housing|Holder)_low/ },
        { match: /^Lower (Screw|Back Screw|Bolt|Insides)_low/ },
        { name: 'Mag Release Button_low_37' },
        { name: 'Picatinny Fixation_low_39' },
        { name: 'Rail Catch_low_43' },
        { match: /^Mag Well/ },
        { match: /^Stock Full/ },
        { name: 'Interns_low_61' },
        { name: 'Gas Block Picat_low_7' },
        { name: 'Picat Handguard_low_6' },
      ],
      magazine: [{ match: /^Magazine Standard/ }],
      charge: [{ name: 'Bolt_low_60' }],
      optic_default: [],
    },
    /** The drum at the back and the hooded post at the front, both under a red dot's line. */
    splits: [
      { part: { match: /^Sight (Cylinder|Housing)_low/ }, group: 'irons', name: 'irons_rear', box: { y: [0.046, 1] } },
      { part: { name: 'Gas Block Picat_low_7' }, group: 'irons', name: 'irons_front', box: { y: [0.046, 1], z: [-0.29, -0.26] } },
    ],
    origin: (m) => {
      const bore = m.tip({ name: 'Gas Block Picat_low_7' });
      const upper = m.bounds({ name: 'Upper_low_40' });
      return [(upper.min[0] + upper.max[0]) / 2, bore[1], 0];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'Gas Block Picat_low_7' });
      const rail = m.bounds({ name: 'Rail_low_32' });
      const guard = m.bounds({ name: 'Picat Handguard_low_6' });
      const lower = m.bounds({ name: 'Lower_low_41' });
      const trigger = m.bounds({ name: 'Trigger_low_28' });
      const drum = m.bounds({ name: 'Sight Cylinder_low_33' });
      return {
        socket_muzzle: bore,
        socket_rail_top: [(rail.min[0] + rail.max[0]) / 2, m.plateau({ name: 'Rail_low_32' }, 0.1, 0.9), 0],
        // The handguard's top is the cocking tube; the laser goes on its right-hand rail.
        socket_rail_front: { at: [(guard.min[0] + guard.max[0]) / 2, (guard.min[1] + guard.max[1]) / 2, guard.max[2]], roll: -90 },
        socket_rail_bottom: [(guard.min[0] + guard.max[0]) / 2, guard.min[1], 0],
        /**
         * The line the two sights share. The drum's *axis* is 2.2 cm below the front post's tip
         * in this kit, and aiming along it stood the post and its hood over the target — the
         * weapon "raised far above the eye" (playtest 5, finding 3). Halfway between the drum's
         * top and the post's tip puts one just under the line and the other just over it.
         */
        socket_sight: [0, (drum.max[1] + m.top({ name: 'Gas Block Picat_low_7' }, 0.55, 0.8)) / 2, 0],
        socket_grip: [trigger.min[0] - 0.03, lower.min[1] + (lower.max[1] - lower.min[1]) * 0.35, 0],
        socket_support: [(guard.min[0] + guard.max[0]) / 2, guard.min[1] - 0.015, 0],
      };
    },
    lod: true,
  },

  /**
   * VULCAN 74: the AK-74 pack's tactical rifle — the eighth body in the row, with its rail
   * handguard, side-folding stock, tactical pistol grip, bakelite magazine, the receiver's
   * side rail and the Picatinny side mount that stands over it. The AimPoint that sat on the
   * mount is the pack's part; the mount stays, and is the optic's socket.
   */
  ar_vulcan: {
    kind: 'weapon',
    source: AK74_PACK,
    unit: 1,
    forward: 'z-',
    up: 'y+',
    parts: {
      body: [
        { name: 'AK-74_body.007' },
        { name: 'side_rail.004' },
        { name: 'SideMount_picantiny.002' },
        { name: 'stock_2.001' },
        { name: 'rails2.001' },
        { name: 'tactical_grip' },
      ],
      magazine: [{ name: 'AK-74_bak_mag30.002' }],
      charge: [],
      optic_default: [],
    },
    /**
     * The receiver: from the stock's hinge at the body's rear to the handguard's rear, on the
     * **bore's** centre line. The body's bounding box is 1.07 cm right of it — the charging
     * handle sticks out of the right-hand side — and every socket measured from the box's
     * centre sat that far right of the gun: the muzzle, the hands and the sight line
     * (playtest 6). The tip's mean is the bore: the brake is symmetric about it.
     */
    origin: (m) => {
      const bore = m.tip({ name: 'AK-74_body.007' });
      const body = m.bounds({ name: 'AK-74_body.007' });
      const guard = m.bounds({ name: 'rails2.001' });
      return [bore[0], bore[1], (body.max[2] + guard.max[2]) / 2];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'AK-74_body.007' });
      const x = bore[0];
      const mount = m.bounds({ name: 'SideMount_picantiny.002' });
      const guard = m.bounds({ name: 'rails2.001' });
      const grip = m.bounds({ name: 'tactical_grip' });
      // The front post's tip, in a strip 3 mm wide down the middle so the hood's ears either
      // side of it (3 mm taller) are not what answers; and the rear sight's block.
      const post = m.peak({ name: 'AK-74_body.007' }, 0.8, 0.95, [x - 0.0015, x + 0.0015]);
      const block = m.peak({ name: 'AK-74_body.007' }, 0.3, 0.42, [x - 0.02, x + 0.02]);
      return {
        socket_muzzle: bore,
        /**
         * On the **rail's** own centre line: the vertices on the mount's top surface, which lie
         * exactly over the bore. Its box is no answer — the clamp arm runs down the receiver's
         * left flank to the side rail, which put the box's centre 1.3 cm left of the rail and
         * every optic off it (playtest 6); the body's box, before that, was 1.1 cm right of it
         * (playtest 5).
         */
        socket_rail_top: [m.midline({ name: 'SideMount_picantiny.002' }, 0.1, 0.9), m.plateau({ name: 'SideMount_picantiny.002' }, 0.1, 0.9), (mount.min[2] + mount.max[2]) / 2],
        // The quad rail's right-hand rail at the bore's height, for the laser.
        socket_rail_front: { at: [m.side({ name: 'rails2.001' }, 0.2, 0.8), bore[1], (guard.min[2] + guard.max[2]) / 2], roll: -90 },
        socket_rail_bottom: [x, guard.min[1], (guard.min[2] + guard.max[2]) / 2],
        /**
         * The irons are a **line**, not a point (playtest 6). Measured over the bore: the post's
         * tip 4.7 cm, the rear block 5.1, the side mount's rail 5.2, the quad rail's top 5.3 —
         * the rail stands 6 mm over the post, so no line level with the bore sees the post, and
         * the level line over the rail that stood here (7.2 cm) put the post under the screen's
         * centre. `socket_sight` is over the rear block, where an AK's rear leaf would be, on
         * the line through the post's tip that shows its top 4 mm over the rail's front edge;
         * `socket_sight_front` is the tip; the ADS pose turns the weapon by the slope between
         * them (2.8°, the muzzle up) so the line is the camera's axis. Under an optic neither
         * applies: the optic's line is parallel to the bore.
         */
        socket_sight: m.sightOver({
          post,
          edge: [x, m.plateau({ name: 'rails2.001' }, 0.1, 0.9), guard.min[2]],
          rear: [x, 0, block[2]],
          show: 0.004,
          eye: SIGHT_EYE_DISTANCE,
        }),
        socket_sight_front: [x, post[1], post[2]],
        socket_grip: [x, grip.max[1] - (grip.max[1] - grip.min[1]) * 0.45, (grip.min[2] + grip.max[2]) / 2],
        socket_support: [x, guard.min[1] - 0.018, guard.min[2] + (guard.max[2] - guard.min[2]) * 0.55],
      };
    },
    lod: true,
  },

  /**
   * HALCYON B5: the Tavor. The source is two rifles — a white one assembled with its black
   * accessories, and a black one lying apart with its white ones — so the assembled body is
   * kept and put on the black set's texture (`useMaterial`): the two bodies are one mesh with
   * two maps. The collimator is the def's red dot and stays as `optic_default`; the
   * suppressor and the grip are the pack's job and are left with the rounds on the floor.
   */
  ar_halcyon: {
    kind: 'weapon',
    source: TAVOR,
    unit: 1,
    forward: 'x-',
    up: 'y+',
    parts: {
      body: [{ name: 'TAR - 21', useMaterial: 'Tavor_Dark' }, { name: 'Rail_Down' }],
      magazine: [{ name: 'Mag' }, { name: 'Bullets' }],
      charge: [],
      optic_default: [{ name: 'Collimator' }],
    },
    // A bullpup's receiver is behind the grip: the body's rear third.
    origin: (m) => {
      const bore = m.tip({ name: 'TAR - 21' });
      const body = m.bounds({ name: 'TAR - 21' });
      return [body.max[0] - (body.max[0] - body.min[0]) * 0.25, bore[1], (body.min[2] + body.max[2]) / 2];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'TAR - 21' });
      const body = m.bounds({ name: 'TAR - 21' });
      const z = (body.min[2] + body.max[2]) / 2;
      const length = body.max[0] - body.min[0];
      const height = body.max[1] - body.min[1];
      const optic = m.bounds({ name: 'Collimator' });
      const zOptic = (optic.min[2] + optic.max[2]) / 2;
      const rail = m.bounds({ name: 'Rail_Down' });
      return {
        socket_muzzle: [bore[0], bore[1], z],
        // The top rail, under the collimator for the optic and over the handguard for the laser.
        /**
         * Over the collimator's **own centre line**, not the body's: this Tavor's sight sits
         * 1.35 cm to the right of the receiver's axis, and a rail socket on the body's centre
         * put a mounted optic that far off it (playtest 5, finding 2).
         */
        socket_rail_top: [(optic.min[0] + optic.max[0]) / 2, m.plateau({ name: 'TAR - 21' }, 0.45, 0.62), zOptic],
        // The body's right-hand face ahead of the trigger, at the bore's height, for the laser.
        socket_rail_front: { at: [body.min[0] + length * 0.22, bore[1], m.side({ name: 'TAR - 21' }, 0.72, 0.9)], roll: -90 },
        socket_rail_bottom: [(rail.min[0] + rail.max[0]) / 2, rail.min[1], z],
        // The collimator's window.
        /**
         * The collimator's own window, laterally as well: its reticle is drawn in the glass,
         * so the ADS pose has to bring *that* onto the camera's axis. On the body's centre line
         * the drawn ring sat 1.35 cm to the side of where the round went, and the dot the
         * runtime used to add sat beside it — the report's two reticles (playtest 5).
         */
        socket_sight: [(optic.min[0] + optic.max[0]) / 2, optic.min[1] + (optic.max[1] - optic.min[1]) * 0.693, zOptic],
        // The grip hangs under the body's middle, the support hand under its front.
        socket_grip: [body.min[0] + length * 0.44, body.min[1] + height * 0.32, z],
        socket_support: [body.min[0] + length * 0.2, body.min[1] + height * 0.42, z],
      };
    },
    lod: true,
  },

  /**
   * BREACHER 12: the SPAS-12, nine meshes named by the modeller's primitives. `Plane` is the
   * receiver with the grip, `Plane.002` the barrel and its magazine tube, `Plane.003` the
   * pump — the one part that moves, as `charge` — and the rest are the folding stock, the
   * sights and the trigger. The tube feeds from below and nothing drops on a reload, so the
   * magazine group is empty, as the procedural shotgun's was. The source is twice life size.
   */
  shotgun_breacher: {
    kind: 'weapon',
    source: SPAS_12,
    unit: 0.52,
    forward: 'z+',
    up: 'y+',
    parts: {
      body: [{ name: 'Plane' }, { name: 'Plane.002' }, { name: 'Plane.004' }, { name: 'Plane.005' }, { name: 'Plane.006' }, { name: 'Cube' }, { name: 'Cube.001' }, { name: 'Circle' }],
      magazine: [],
      charge: [{ name: 'Plane.003' }],
      optic_default: [],
    },
    /** The receiver's rear notch and the bead at the muzzle: both stand in a mounted dot's line. */
    splits: [
      { part: { name: 'Cube.001' }, group: 'irons', name: 'irons_rear', box: { y: [0.028, 1], z: [-0.16, -0.12] } },
      { part: { name: 'Plane.002' }, group: 'irons', name: 'irons_bead', box: { y: [0.034, 1], z: [-0.58, -0.55] } },
    ],
    origin: (m) => {
      const bore = m.tip({ name: 'Plane.002' });
      const receiver = m.bounds({ name: 'Plane' });
      return [(receiver.min[0] + receiver.max[0]) / 2, bore[1], (receiver.min[2] + receiver.max[2]) / 2];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'Plane.002' });
      const receiver = m.bounds({ name: 'Plane' });
      const x = (receiver.min[0] + receiver.max[0]) / 2;
      const barrel = m.bounds({ name: 'Plane.002' });
      const pump = m.bounds({ name: 'Plane.003' });
      const rz = receiver.max[2] - receiver.min[2];
      // The bead's top, in a 3 mm strip down the barrel's middle, and the ghost ring's opening
      // at the height the bead is cut to (a keyhole: a round hole over a slot).
      const bead = m.peak({ name: 'Plane.002' }, 0.8, 1, [bore[0] - 0.0015 / 0.52, bore[0] + 0.0015 / 0.52]);
      const ring = m.aperture({ name: 'Cube.001' }, 0, 1, [bead[0] - 0.0012 / 0.52, bead[0] + 0.0012 / 0.52], bead[1], 0.006 / 0.52);
      return {
        socket_muzzle: [x, bore[1], bore[2]],
        // No rail on a SPAS: the optic on the receiver's top, the laser on the barrel behind the pump.
        socket_rail_top: [x, m.plateau({ name: 'Plane' }, 0.35, 0.8), receiver.min[2] + rz * 0.6],
        // The barrel is an extrusion with vertices only at its ends: the rear ring's top, and
        // the front section's for the sight line.
        socket_rail_front: { at: [m.side({ name: 'Plane.002' }, 0, 0.1), bore[1], barrel.min[2] + (barrel.max[2] - barrel.min[2]) * 0.15], roll: -90 },
        socket_rail_bottom: [x, pump.min[1], (pump.min[2] + pump.max[2]) / 2],
        /**
         * The ghost ring's opening, and the bead (playtest 7). This stood at z = 0 of the
         * source, which is the folded stock — 41 cm behind the ring, so the ADS pose held the
         * whole gun that far out — and 1 cm over the barrel's top, with the bead under the
         * screen's centre. The two sights are 1.6 mm apart in height over 44 cm, so the line
         * turns the weapon 0.2°: the bead sits in the middle of the ring.
         */
        socket_sight: ring,
        socket_sight_front: bead,
        /**
         * A tube feed has no magazine to take: the reload hand goes to the loading port, where
         * the tube meets the receiver's underside — 1.5 cm over the lowest point of the barrel
         * and tube, 3 cm behind the receiver's front face.
         */
        socket_mag_grip: [x, barrel.min[1] + 0.015 / 0.52, receiver.max[2] - 0.03 / 0.52],
        socket_grip: [x, receiver.min[1] + (receiver.max[1] - receiver.min[1]) * 0.28, receiver.min[2] + rz * 0.22],
        socket_support: [x, pump.min[1] - 0.012 / 0.52, (pump.min[2] + pump.max[2]) / 2],
      };
    },
    lod: true,
  },

  /**
   * TALON 9: the Beretta M9. The source is a display of two pistols lying flat among loose
   * rounds; the second — the threaded-barrel one, with its magazine in the grip — is taken by
   * where it lies (`within`), the rounds by their names are left. Lying flat means its up is
   * +Z and its forward -X. The slide, with the sights, safeties and extractor that ride on
   * it, is `charge`: the empty reload racks it. The source's unit is about 1.45 cm.
   */
  pistol_talon: {
    kind: 'weapon',
    source: BERETTA_M9,
    unit: 0.217 / 15,
    textureSide: 512,
    forward: 'x-',
    up: 'z+',
    parts: {
      body: [
        {
          match: /^LP /,
          except: /Bullet|Slide|Sight|Safety|Magazine|Extractor/,
          within: { z: [-10, 2] },
        },
      ],
      magazine: [{ match: /^LP Magazine(002| Stock Pad002)$/ }],
      charge: [{ match: /Slide|Sight|Safety|Extractor/, except: /Bullet|001$|003$|004$/, within: { z: [-10, 2] } }],
      optic_default: [],
    },
    origin: (m) => {
      const bore = m.tip({ name: 'LP *Threaded* Barrel' });
      const frame = m.bounds({ name: 'LP *Standart* Frame' });
      return [(frame.min[0] + frame.max[0]) / 2, bore[1], bore[2]];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'LP *Threaded* Barrel' });
      const frame = m.bounds({ name: 'LP *Standart* Frame' });
      const slide = m.bounds({ name: 'LP *Standart* Slide' });
      const grip = m.bounds({ match: /^LP Stock Grip (Right|Left)$/ });
      const rear = m.bounds({ name: 'LP Parts Tail Sight Stock' });
      const y = bore[1];
      return {
        socket_muzzle: [bore[0], y, bore[2]],
        // The optic on the slide's rear; the laser under the dust cover, hung upside down.
        socket_rail_top: [slide.max[0] - (slide.max[0] - slide.min[0]) * 0.28, y, m.plateau({ name: 'LP *Standart* Slide' }, 0.05, 0.4)],
        socket_rail_front: { at: [frame.min[0] + (frame.max[0] - frame.min[0]) * 0.18, y, bore[2] - 1.2], roll: 180 },
        socket_rail_bottom: { at: [frame.min[0] + (frame.max[0] - frame.min[0]) * 0.3, y, bore[2] - 1.2], roll: 180 },
        // The rear sight's notch.
        socket_sight: [(rear.min[0] + rear.max[0]) / 2, y, rear.max[2] - 0.15],
        socket_grip: [(grip.min[0] + grip.max[0]) / 2, y, grip.max[2] - (grip.max[2] - grip.min[2]) * 0.45],
        // Two-handed: the support hand wraps the firing hand, a little ahead, left and low.
        socket_support: [(grip.min[0] + grip.max[0]) / 2 - 1.2, y - 2, grip.max[2] - (grip.max[2] - grip.min[2]) * 0.5],
      };
    },
    lod: true,
  },

  /**
   * VANTAGE SR: the M150, a rigged rifle whose parts are rigid pieces bound each to one bone,
   * so they are named here by joint. The scope is the def's — a scoped weapon keeps it, and
   * the HYBRID OPTIC does not replace it (`mountAttachments` skips the red dot on a scope) —
   * and stays in the body, without its lids. The vertical grip on the handguard is the pack's
   * job and is left out. Twice life size.
   */
  sniper_vantage: {
    kind: 'weapon',
    source: M150,
    unit: 0.5,
    forward: 'z+',
    up: 'y+',
    parts: {
      body: [
        { joint: 'Grip3_00', all: true },
        { joint: 'Rail7_031', all: true },
        { joint: 'Canister_06', all: true },
        { joint: 'Lid_027', all: true },
        { joint: 'Trigger_02', all: true },
        { joint: 'Scope_010', all: true },
        // The objective glass hangs on the front lid's bone; the two lid discs themselves are
        // posed open in mid-air a hand above the tube, and stay out.
        { joint: 'ScopeLid1_012', all: true, except: /^Object_57$/ },
        { joint: 'Nossle1_018', all: true },
        { joint: 'Nossle2_016', all: true },
        { joint: 'Nossle3_014', all: true },
      ],
      magazine: [{ joint: 'Magazine_04', all: true }],
      charge: [{ joint: 'Reloader_029', all: true }],
      optic_default: [],
    },
    origin: (m) => {
      const bore = m.tip({ name: 'Object_43' });
      const upper = m.bounds({ name: 'Object_74' });
      return [0, bore[1], (upper.min[2] + upper.max[2]) / 2];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'Object_43' });
      const upper = m.bounds({ name: 'Object_74' });
      const guardBottom = m.bounds({ name: 'Object_24' });
      const foregrip = m.bounds({ joint: 'Grip2_08', all: true });
      const grip = m.bounds({ name: 'Object_45' });
      const glass = m.bounds({ name: 'Object_55' });
      const zGrip = (foregrip.min[2] + foregrip.max[2]) / 2;
      return {
        socket_muzzle: [0, bore[1], bore[2]],
        socket_rail_top: [0, m.plateau({ name: 'Object_74' }, 0.4, 0.9), (upper.min[2] + upper.max[2]) / 2],
        // The handguard's right-hand rail at the bore's height, ahead of the scope's objective.
        socket_rail_front: { at: [m.side({ name: 'Object_27' }, 0.6, 0.9), bore[1], guardBottom.min[2] + (guardBottom.max[2] - guardBottom.min[2]) * 0.75], roll: -90 },
        socket_rail_bottom: [0, guardBottom.min[1], zGrip],
        // The scope's axis: the centre of its ocular glass.
        socket_sight: [0, (glass.min[1] + glass.max[1]) / 2, 0],
        socket_grip: [0, grip.min[1] + (grip.max[1] - grip.min[1]) * 0.42, (grip.min[2] + grip.max[2]) / 2],
        socket_support: [0, guardBottom.min[1] - 0.02 / 0.5, zGrip],
      };
    },
    lod: true,
  },

  /**
   * LONGBOW MK3: the L1A1 in its polymer furniture, a rigged rifle whose three meshes are
   * the receiver with the barrel, the furniture and the 20-round magazine. The bolt and the
   * charging handle are bones inside the receiver mesh, not meshes, so `charge` is empty. In
   * the file's node space the rifle stands on end: its length runs down -Y and its top faces
   * +Z, which the axes below say. No rail: the optic sits on the dust cover, the laser on the
   * handguard.
   */
  ar_longbow: {
    kind: 'weapon',
    source: L1A1,
    unit: 1,
    forward: 'y-',
    up: 'z+',
    parts: {
      body: [{ name: 'Object_31' }, { name: 'Object_33' }],
      magazine: [{ name: 'Object_29' }],
      charge: [],
      optic_default: [],
    },
    /** The aperture on the receiver's rear and the post over the gas block. */
    splits: [
      { part: { name: 'Object_31' }, group: 'irons', name: 'irons_rear', box: { y: [0.038, 1], z: [0.11, 0.17] } },
      { part: { name: 'Object_31' }, group: 'irons', name: 'irons_front', box: { y: [0.038, 1], z: [-0.43, -0.38] } },
    ],
    origin: (m) => {
      const bore = m.tip({ name: 'Object_31' });
      const mag = m.bounds({ name: 'Object_29' });
      // The receiver's centre sits just behind the magazine well.
      return [bore[0], mag.max[1] + 0.02, bore[2]];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'Object_31' });
      const x = bore[0];
      const receiver = m.bounds({ name: 'Object_31' });
      const furniture = m.bounds({ name: 'Object_33' });
      const mag = m.bounds({ name: 'Object_29' });
      const guardY = receiver.max[1] - (receiver.max[1] - receiver.min[1]) * 0.62;
      // The front post's tip, in a 3 mm strip so its protective ears (6 mm taller) do not
      // answer, and the rear aperture's hole at the post's height.
      const post = m.peak({ name: 'Object_31' }, 0.66, 0.74, [x - 0.0015, x + 0.0015]);
      const ring = m.aperture({ name: 'Object_31' }, 0.15, 0.25, [post[0] - 0.0012, post[0] + 0.0012], post[2], 0.006);
      return {
        socket_muzzle: [x, bore[1], bore[2]],
        socket_rail_top: [x, mag.max[1] + 0.04, m.plateau({ name: 'Object_31' }, 0.32, 0.5)],
        // The furniture's right-hand face at the bore's height, for the laser.
        socket_rail_front: { at: [m.side({ name: 'Object_33' }, 0.6, 0.78), guardY, bore[2]], roll: -90 },
        socket_rail_bottom: [x, guardY, m.bottom({ name: 'Object_33' }, 0.55, 0.78)],
        /**
         * The rear aperture's hole, and the front post's tip (playtest 7). This was 12 cm from
         * the receiver's rear, on the stock's comb — 9 cm behind the aperture, so the ADS pose
         * held the rifle that much too far out — and 2 mm under the aperture. The L1A1's two
         * sights are cut to one height (0.03 mm apart over 55 cm), so the line is level.
         */
        socket_sight: ring,
        socket_sight_front: post,
        socket_grip: [x, mag.max[1] + 0.09, furniture.min[2] + 0.06],
        socket_support: [x, guardY, m.bottom({ name: 'Object_33' }, 0.55, 0.78) - 0.018],
      };
    },
    lod: true,
  },

  /**
   * KESTREL .338: the L115A3, two meshes — the rifle and its scope — at 195k triangles, four
   * times life size, with the suppressor modelled as part of the barrel. The suppressor is cut
   * off (`cuts`: the barrel steps from a 0.13-unit can to a 0.08-unit tube at z −2.05 in the
   * source's frame, and everything beyond goes) so the SUPPRESSOR attachment has a bare muzzle
   * to mount on, and the whole is simplified to a sixth before the textures. The magazine and
   * the bolt are in the rifle's mesh, so both groups are empty: a bolt gun reloads with nothing
   * moving, as the procedural one did. The scope is the def's and stays.
   */
  sniper_kestrel: {
    kind: 'weapon',
    source: L115A3,
    unit: 0.25,
    forward: 'z-',
    up: 'y+',
    simplify: 0.145,
    cuts: [{ part: { name: 'Cube.001' }, axis: 'z', at: -2.05, keep: 'above' }],
    parts: {
      body: [{ name: 'Cube.001' }, { name: 'Scope ' }],
      magazine: [],
      charge: [],
      optic_default: [],
    },
    /**
     * The scope's objective lens, into a node of its own so the runtime can give it the
     * project's `lens` material (playtest 4). Tube, rings and glass share one material in this
     * source, so the whole scope is opaque — which is right for the tube and a wall at the far
     * end of it for the eye. The ocular is an open ring; the objective is a disc 3 mm across at
     * its centre, and this box is that disc.
     */
    splits: [
      { part: { name: 'Scope ' }, name: 'scope_glass', box: { x: [-0.02, 0.02], y: [0.029, 0.069], z: [-0.171, -0.149] } },
    ],
    origin: (m) => {
      const bore = m.tip({ name: 'Cube.001' });
      const scope = m.bounds({ name: 'Scope ' });
      // The receiver sits under the scope.
      return [(scope.min[0] + scope.max[0]) / 2, bore[1], (scope.min[2] + scope.max[2]) / 2];
    },
    sockets: (m) => {
      const bore = m.tip({ name: 'Cube.001' });
      const body = m.bounds({ name: 'Cube.001' });
      const scope = m.bounds({ name: 'Scope ' });
      const x = (scope.min[0] + scope.max[0]) / 2;
      const zScope = (scope.min[2] + scope.max[2]) / 2;
      const length = body.max[2] - body.min[2];
      // The forend: the chassis ahead of the scope, two thirds of the way to the muzzle.
      const zForend = body.max[2] - length * 0.66;
      return {
        socket_muzzle: [x, bore[1], bore[2]],
        socket_rail_top: [x, m.plateau({ name: 'Cube.001' }, 0.55, 0.7), zScope],
        socket_rail_front: { at: [m.side({ name: 'Cube.001' }, 0.6, 0.72), bore[1], zForend], roll: -90 },
        socket_rail_bottom: [x, m.bottom({ name: 'Cube.001' }, 0.6, 0.72), zForend],
        // The scope's ocular: the eye goes behind *this*, at eye relief, and a socket on the
        // tube's middle would have put the eyepiece behind the camera (playtest 3).
        socket_sight: [x, (scope.min[1] + scope.max[1]) / 2, scope.max[2] - 0.12],
        /**
         * The L115A3's magazine is modelled into the rifle, so there is no part to measure: the
         * reload hand goes to its bottom, under the scope's middle — 3.5 cm above the lowest
         * point of the rifle there.
         */
        socket_mag_grip: [x, m.bottom({ name: 'Cube.001' }, (body.max[2] - zScope) / length - 0.03, (body.max[2] - zScope) / length + 0.03) + 0.035 / 0.25, zScope],
        // The thumbhole grip hangs behind the receiver; the support hand under the forend.
        socket_grip: [x, bore[1] - 0.45, zScope + length * 0.17],
        socket_support: [x, m.bottom({ name: 'Cube.001' }, 0.6, 0.72) - 0.1, zForend],
      };
    },
    lod: true,
  },

  /**
   * The knife: the MTech without its lanyard, life size, the blade already down -Z. The
   * origin is the handle's centre, where `KnifeMesh` closes the fist; the procedural blade
   * began at the guard 7 cm ahead of it and this one does too. A knife has no sockets and
   * nothing that moves, so the file is a root and a `body`.
   */
  knife: {
    kind: 'knife',
    source: MTECH_KNIFE,
    unit: 1,
    forward: 'z-',
    up: 'y+',
    textureSide: 512,
    parts: { body: [{ name: 'kn01_nolace' }] },
    origin: (m) => {
      const b = m.bounds({ name: 'kn01_nolace' });
      // The handle: the rear half.
      return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2 + 0.004, b.max[2] - 0.062];
    },
    sockets: () => ({}),
  },

  /**
   * The first-person arms (M19, stage 4): *Hand With Gloves*, a Blender FPS rig — two forearms
   * in rolled sleeves and hard-knuckle gloves, cut at the elbow, on a 61-bone skeleton with every
   * finger, a camera bone where the artist put the eye, and IK controllers the runtime does not
   * use. Unlike every other recipe this one keeps its **skin**: the arms are posed at runtime
   * (`ViewmodelHands`), so the build only takes the arms (not the framing crosshair or the
   * pose-shape card), names the bones plainly, puts the eye at the origin in the viewmodel's
   * axes, and halves the triangles. Its space: +Z forward from the camera bone, +Y up; 0.03 m
   * a unit — the forearm is 8.57 units for a 26 cm forearm, the hand 3.43 for 10.3 cm.
   */
  hands: {
    kind: 'hands',
    source: HAND_WITH_GLOVES,
    unit: 0.03,
    forward: 'z+',
    up: 'y+',
    keepMaterials: ['glove_hardknuckle', 'sleeve_st6_generalist'],
    eye: 'camera_2',
    simplify: 0.45,
    /**
     * `upperarm_L.R_56` → `upperarm_R`, `index_L.003.R_37` → `index_003_R`: the source spells
     * the side twice and numbers every node. `body` would shadow a weapon's `body` group once
     * the rig hangs under a weapon's root, so it is the torso; the camera bone is the eye.
     */
    rename: (name) => {
      const limb = /^(.+?)_L(?:\.(\d+))?\.([LR])_\d+$/.exec(name);
      if (limb !== null) return `${limb[1]}${limb[2] !== undefined ? `_${limb[2]}` : ''}_${limb[3]}`;
      const plain = name.replace(/_\d+$/, '');
      return { body: 'torso', camera: 'eye', camera_target: 'eye_target', pose_controller: 'pose', hardknuckle: 'glove' }[plain] ?? plain;
    },
  },

  att_suppressor: {
    kind: 'attachment',
    source: M4_KIT,
    unit: 0.01,
    forward: 'z+',
    up: 'y+',
    parts: { part: [{ name: 'Suppressor', material: 'Suppressor' }] },
    // The rear face's centre: the face that meets the muzzle.
    origin: (m) => {
      const b = m.bounds({ name: 'Suppressor', material: 'Suppressor' });
      return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    },
    sockets: (m) => {
      const b = m.bounds({ name: 'Suppressor', material: 'Suppressor' });
      // Where the flash leaves once the can is on: its front face.
      return { socket_muzzle: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]] };
    },
  },

  att_grip: {
    kind: 'attachment',
    source: M4_KIT,
    unit: 0.01,
    forward: 'z+',
    up: 'y+',
    parts: { part: [{ name: 'Front', material: 'Front_grip_vert' }] },
    // The top's centre: the face that meets the rail.
    origin: (m) => {
      const b = m.bounds({ name: 'Front', material: 'Front_grip_vert' });
      return [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
    },
    sockets: () => ({}),
  },

  att_optic: {
    kind: 'attachment',
    source: AK74_PACK,
    unit: 1,
    forward: 'z-',
    up: 'y+',
    // The AimPoint Pro on the pack's tactical rifle: the tube, its glass and the reticle.
    parts: { part: [{ name: 'Cylinder.002', all: true }] },
    // The clamp's underside less `OPTIC_CLAMP_SINK`, centred. The pack's AimPoint comes off an
    // AK side mount: a 1.2 cm plate under a stem under the tube. Set on the rail by its
    // underside the plate hovers over the slats and the tube stands 4.2 cm up (the human's
    // "floating"); sunk 6 mm it wraps the rail as a clamp does, and the axis lands 3.6 cm
    // above it — Aimpoint's own lower-third co-witness height, the front post just under the dot.
    //
    // Laterally on the **reticle**, which is the tube's axis and is where the artist stood it
    // over the rifle's rail. The part's box is 1.3 mm left of it — the clamp's lever — and a
    // box-centred origin and sight put every mounted optic's dot that far right of the screen's
    // centre, five pixels at full ADS (playtests 4–6).
    origin: (m) => {
      const b = m.bounds({ name: 'Cylinder.002', all: true });
      const dot = m.bounds({ name: 'Cylinder.002', material: 'M_Reticle' });
      return [(dot.min[0] + dot.max[0]) / 2, b.min[1] + OPTIC_CLAMP_SINK, (b.min[2] + b.max[2]) / 2];
    },
    sockets: (m) => {
      const glass = m.bounds({ name: 'Cylinder.002', material: 'M_glass' });
      const dot = m.bounds({ name: 'Cylinder.002', material: 'M_Reticle' });
      const b = m.bounds({ name: 'Cylinder.002', all: true });
      // The tube's axis: the sight line the ADS pose cancels once this is mounted.
      return { socket_sight: [(dot.min[0] + dot.max[0]) / 2, (glass.min[1] + glass.max[1]) / 2, (b.min[2] + b.max[2]) / 2] };
    },
  },

  att_laser: {
    kind: 'attachment',
    source: DBAL_A2,
    // Modelled in inches, lying on its side: its height runs along +Z, and the emitters face +X.
    unit: 0.0254,
    forward: 'x+',
    up: 'z+',
    parts: { part: [{ name: 'Object_4' }] },
    // The clamp's underside, centred.
    origin: (m) => {
      const b = m.bounds({ name: 'Object_4' });
      return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    },
    sockets: () => ({}),
  },
};

// -- matrices, column-major as glTF stores them ---------------------------------

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return o;
}

function localMatrix(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function apply(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

const AXES = { 'x+': [1, 0, 0], 'x-': [-1, 0, 0], 'y+': [0, 1, 0], 'y-': [0, -1, 0], 'z+': [0, 0, 1], 'z-': [0, 0, -1] };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The fix: source world space to the viewmodel's. Translate the origin to zero, scale to
 * metres, then rotate the source's forward onto -Z and its up onto +Y. Rotation columns are
 * the images of the source's basis vectors, which for an orthonormal frame is the transpose
 * of the frame.
 */
function fixMatrix(recipe, origin) {
  const f = AXES[recipe.forward];
  const u = AXES[recipe.up];
  if (f === undefined || u === undefined) throw new Error(`unknown axis in recipe: ${recipe.forward} / ${recipe.up}`);
  const r = cross(f, u);
  // Rows of [f u r] are the source frame; R = [F U X] · [f u r]^T with F=-Z, U=+Y, X=+X.
  const F = [0, 0, -1], U = [0, 1, 0], X = [1, 0, 0];
  const R = new Array(16).fill(0);
  R[15] = 1;
  for (let col = 0; col < 3; col++) {
    // Image of source basis vector e_col = f[col]·F + u[col]·U + r[col]·X.
    for (let row = 0; row < 3; row++) R[col * 4 + row] = f[col] * F[row] + u[col] * U[row] + r[col] * X[row];
  }
  const s = recipe.unit;
  const S = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -origin[0], -origin[1], -origin[2], 1];
  return mul(mul(R, S), T);
}

// -- reading the source ----------------------------------------------------------

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** The positions of one primitive, as float triples, honouring the buffer view's stride. */
function* positions(glb, accessorIndex) {
  const { json, bin } = glb;
  const acc = json.accessors[accessorIndex];
  if (acc.componentType !== 5126 || acc.type !== 'VEC3') throw new Error('POSITION is not float VEC3');
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? COMPONENT_BYTES[acc.componentType] * TYPE_COUNT[acc.type];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    yield [bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)];
  }
}

/** The first joint index of every vertex of a primitive, whatever the component type. */
function* jointIndices(glb, accessorIndex) {
  const { json, bin } = glb;
  const acc = json.accessors[accessorIndex];
  const view = json.bufferViews[acc.bufferView];
  const bytes = COMPONENT_BYTES[acc.componentType];
  const stride = view.byteStride ?? bytes * TYPE_COUNT[acc.type];
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    yield bytes === 1 ? bin.readUInt8(at) : bytes === 2 ? bin.readUInt16LE(at) : bin.readUInt32LE(at);
  }
}

class Source {
  constructor(glb, unit, up) {
    this.glb = glb;
    this.json = glb.json;
    /** The source's up axis: `top` and `plateau` measure along it. A pistol lying flat is up +Z. */
    const upAxis = AXES[up];
    this.upK = upAxis.findIndex((c) => c !== 0);
    this.upSign = upAxis[this.upK];
    /** Centimetres per source unit, so the plateau bins are half a millimetre whatever the unit. */
    this.cmPerUnit = unit * 100;
    this.parent = new Map();
    this.json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => this.parent.set(c, i)));
    this.worlds = new Map();
  }

  world(i) {
    const cached = this.worlds.get(i);
    if (cached !== undefined) return cached;
    const local = localMatrix(this.json.nodes[i]);
    const p = this.parent.get(i);
    const w = p === undefined ? local : mul(this.world(p), local);
    this.worlds.set(i, w);
    return w;
  }

  materialName(node) {
    const mesh = this.json.meshes[node.mesh];
    const mat = mesh.primitives[0].material;
    return mat === undefined ? '' : (this.json.materials[mat].name ?? '');
  }

  /**
   * The joint most of a skinned mesh node's vertices are bound to, by name; '' for a rigid
   * node. A rigged rifle's parts are rigid pieces each weighted wholly to one bone, so the
   * first weight's joint on a sample of vertices names the part.
   */
  jointName(nodeIndex) {
    const node = this.json.nodes[nodeIndex];
    if (node.skin === undefined) return '';
    const skin = this.json.skins[node.skin];
    const counts = new Map();
    for (const prim of this.json.meshes[node.mesh].primitives) {
      const acc = prim.attributes.JOINTS_0;
      if (acc === undefined) continue;
      for (const j of jointIndices(this.glb, acc)) counts.set(j, (counts.get(j) ?? 0) + 1);
    }
    let best = -1;
    let n = -1;
    for (const [j, c] of counts) if (c > n) { n = c; best = j; }
    if (best < 0) return '';
    return this.json.nodes[skin.joints[best]]?.name ?? '';
  }

  /**
   * A cut takes a slice off a part along a world axis — the L115A3's suppressor, modelled as
   * one mesh with its barrel. The measurements stop seeing the cut-away vertices here; the
   * triangles go in `applyCuts`, where the index buffer is rewritten.
   */
  setCuts(cuts) {
    this.cuts = new Map();
    for (const cut of cuts ?? []) {
      const k = cut.axis === 'x' ? 0 : cut.axis === 'y' ? 1 : 2;
      for (const i of this.select(cut.part)) this.cuts.set(i, { k, at: cut.at, keep: cut.keep });
    }
  }

  /** Whether a world-space vertex of node `i` lies on the cut-away side of its cut. */
  cutAway(i, v) {
    const cut = this.cuts?.get(i);
    if (cut === undefined) return false;
    return cut.keep === 'above' ? v[cut.k] < cut.at : v[cut.k] > cut.at;
  }

  /** A per-node translation applied before the fix: the spread kit assembled. */
  setMoves(moves) {
    this.moves = new Map();
    for (const move of moves ?? []) {
      const a = this.centre(this.bounds(move.anchor));
      const b = this.centre(this.bounds(move.target));
      const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      for (const sel of move.parts) for (const i of this.select(sel)) this.moves.set(i, delta);
    }
  }

  centre(b) {
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  }

  /** The world matrix with the node's move, if any, applied on top. */
  placed(i) {
    const w = this.world(i);
    const d = this.moves?.get(i);
    if (d === undefined) return w;
    return mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d[0], d[1], d[2], 1], w);
  }

  /** Mesh node indices a selector names. */
  select(sel) {
    const hits = [];
    this.json.nodes.forEach((n, i) => {
      if (n.mesh === undefined) return;
      // The node's own name and its two nearest ancestors': Sketchfab puts the mesh on a child
      // named for its material, sometimes under an anonymous `Object_N` between it and the
      // object the artist named.
      const names = [n.name ?? ''];
      for (let p = this.parent.get(i), depth = 0; p !== undefined && depth < 2; p = this.parent.get(p), depth++) {
        names.push(this.json.nodes[p].name ?? '');
      }
      const parentName = names[1] ?? '';
      if (sel.name !== undefined && !names.includes(sel.name)) return;
      if (sel.match !== undefined && !names.some((name) => sel.match.test(name))) return;
      if (sel.material !== undefined && this.materialName(n) !== sel.material) return;
      if (sel.joint !== undefined && this.jointName(i) !== sel.joint) return;
      if (sel.within !== undefined) {
        const c = this.centre(this.bounds({ index: i }));
        for (const [axis, [lo, hi]] of Object.entries(sel.within)) {
          const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
          if (c[k] < lo || c[k] > hi) return;
        }
      }
      if (sel.except !== undefined && names.some((name) => sel.except.test(name))) return;
      hits.push(i);
    });
    if (hits.length === 0) throw new Error(`selector ${JSON.stringify(sel)} matched nothing`);
    if (sel.all || sel.match !== undefined) return hits;
    if (hits.length > 1 && sel.pick === 'highest') {
      hits.sort((a, b) => this.bounds({ index: b }).max[1] - this.bounds({ index: a }).max[1]);
      return [hits[0]];
    }
    if (hits.length > 1) throw new Error(`selector ${JSON.stringify(sel)} matched ${hits.length} nodes; add material, pick or all`);
    return hits;
  }

  /** World-space bounds of a selection, from the vertices. */
  bounds(sel) {
    const indices = sel.index !== undefined ? [sel.index] : this.select(sel);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const i of indices) {
      const m = this.placed(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (this.cutAway(i, v)) continue;
          for (let k = 0; k < 3; k++) {
            if (v[k] < min[k]) min[k] = v[k];
            if (v[k] > max[k]) max[k] = v[k];
          }
        }
      }
    }
    return { min, max };
  }

  /**
   * The highest point of a selection within a band along `forward` — the band given as
   * fractions of the selection's extent, rear to front. The rail surface is the top of the
   * receiver where nothing stands on it; the band leaves the flip-up sight out.
   */
  top(sel, forward, from, to) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const b = this.bounds(sel);
    const span = b.max[k] - b.min[k];
    const rear = axis[k] > 0 ? b.min[k] : b.max[k];
    const dir = axis[k];
    let best = -Infinity;
    for (const i of indices) {
      const m = this.placed(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (this.cutAway(i, v)) continue;
          const f = ((v[k] - rear) * dir) / span;
          if (f < from || f > to) continue;
          const h = v[this.upK] * this.upSign;
          if (h > best) best = h;
        }
      }
    }
    if (best === -Infinity) throw new Error(`top(${JSON.stringify(sel)}): no vertices in the band`);
    return best * this.upSign;
  }

  /**
   * The right-hand face of a selection within a band along `forward`: the extreme along the
   * source's right axis (forward × up), returned as that axis's raw coordinate so a recipe
   * can drop it into the lateral slot of a socket. The laser sockets sit here (playtest 3,
   * finding 7): a DBAL on the top-front rail stood in the optic's line of sight.
   */
  side(sel, forward, from, to) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const up = [0, 0, 0];
    up[this.upK] = this.upSign;
    const right = cross(axis, up);
    const rK = right.findIndex((c) => c !== 0);
    const rSign = right[rK];
    const b = this.bounds(sel);
    const span = b.max[k] - b.min[k];
    const rear = axis[k] > 0 ? b.min[k] : b.max[k];
    const dir = axis[k];
    let best = -Infinity;
    for (const i of indices) {
      const m = this.placed(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (this.cutAway(i, v)) continue;
          const f = ((v[k] - rear) * dir) / span;
          if (f < from || f > to) continue;
          const s = v[rK] * rSign;
          if (s > best) best = s;
        }
      }
    }
    if (best === -Infinity) throw new Error(`side(${JSON.stringify(sel)}): no vertices in the band`);
    return best * rSign;
  }

  /** The lowest point of a selection within a band along `forward`, as `top` is the highest. */
  bottom(sel, forward, from, to) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const b = this.bounds(sel);
    const span = b.max[k] - b.min[k];
    const rear = axis[k] > 0 ? b.min[k] : b.max[k];
    const dir = axis[k];
    let best = Infinity;
    for (const i of indices) {
      const m = this.placed(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (this.cutAway(i, v)) continue;
          const f = ((v[k] - rear) * dir) / span;
          if (f < from || f > to) continue;
          const h = v[this.upK] * this.upSign;
          if (h < best) best = h;
        }
      }
    }
    if (best === Infinity) throw new Error(`bottom(${JSON.stringify(sel)}): no vertices in the band`);
    return best * this.upSign;
  }

  /**
   * The highest surface many vertices in a band share: a Picatinny rail's slat tops, where
   * `top` would answer with the one screw head or notch that stands a few millimetres proud
   * of them, and the most populated bin would be the rail's base flange a centimetre under
   * them. Bins of half a millimetre over the top 1.5 cm of the band; the highest bin holding
   * at least `PLATEAU_SHARE` of the fullest bin's count is the surface. On the M4 kit the
   * slat tops are 120 vertices, the notch 16, the flange 227.
   */
  plateau(sel, forward, from, to) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const b = this.bounds(sel);
    const span = b.max[k] - b.min[k];
    const rear = axis[k] > 0 ? b.min[k] : b.max[k];
    const dir = axis[k];
    const inBand = [];
    let top = -Infinity;
    for (const i of indices) {
      const m = this.placed(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (this.cutAway(i, v)) continue;
          const f = ((v[k] - rear) * dir) / span;
          if (f < from || f > to) continue;
          const h = v[this.upK] * this.upSign;
          inBand.push(h);
          if (h > top) top = h;
        }
      }
    }
    if (inBand.length === 0) throw new Error(`plateau(${JSON.stringify(sel)}): no vertices in the band`);
    const bins = new Map();
    for (const y of inBand) {
      if ((top - y) * this.cmPerUnit > 1.5) continue;
      const bin = Math.round(y * this.cmPerUnit * 20) / 20;
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    const fullest = Math.max(...bins.values());
    let best = -Infinity;
    for (const [bin, n] of bins) {
      if (n >= fullest * PLATEAU_SHARE && bin > best) best = bin;
    }
    return (best / this.cmPerUnit) * this.upSign;
  }

  /**
   * The bore at the barrel's tip: the mean of the vertices within a sliver of the selection's
   * furthest extent along `forward`. A barrel ends in a ring; the ring's centre is the bore.
   */
  tip(sel, forward) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const sign = axis[k];
    const b = this.bounds(sel);
    const edge = sign > 0 ? b.max[k] : b.min[k];
    const sliver = (b.max[k] - b.min[k]) * 0.02;
    const sum = [0, 0, 0];
    let n = 0;
    for (const i of indices) {
      const m = this.placed(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (this.cutAway(i, v)) continue;
          if (Math.abs(v[k] - edge) > sliver) continue;
          for (let j = 0; j < 3; j++) sum[j] += v[j];
          n++;
        }
      }
    }
    if (n === 0) throw new Error(`tip(${JSON.stringify(sel)}): no vertices at the edge`);
    const out = sum.map((s) => s / n);
    out[k] = edge;
    return out;
  }

  /** The world-space vertices of a selection within a band along `forward`, as `top` walks them. */
  *inBand(sel, forward, from, to) {
    const indices = this.select(sel);
    const axis = AXES[forward];
    const k = axis.findIndex((c) => c !== 0);
    const b = this.bounds(sel);
    const span = b.max[k] - b.min[k];
    const rear = axis[k] > 0 ? b.min[k] : b.max[k];
    const dir = axis[k];
    for (const i of indices) {
      const m = this.placed(i);
      for (const prim of this.json.meshes[this.json.nodes[i].mesh].primitives) {
        for (const p of positions(this.glb, prim.attributes.POSITION)) {
          const v = apply(m, p);
          if (this.cutAway(i, v)) continue;
          const f = ((v[k] - rear) * dir) / span;
          if (f >= from && f <= to) yield v;
        }
      }
    }
  }

  /** The source's right axis (forward × up) as an index and a sign, as `side` derives it. */
  rightOf(forward) {
    const up = [0, 0, 0];
    up[this.upK] = this.upSign;
    const right = cross(AXES[forward], up);
    const k = right.findIndex((c) => c !== 0);
    return { k, sign: right[k] };
  }

  /**
   * The lateral centre of the surface `plateau` finds (playtest 6): the middle of the vertices
   * lying on it, across the barrel, as that axis's raw coordinate. The bounding box is the
   * whole part and a part is rarely symmetric about its own rail: the AK's side mount has a
   * clamp arm down the receiver's left flank, so its box centre stood 1.3 cm left of the rail
   * on its top, and the optic floated there. The rail is the vertices on the rail.
   */
  midline(sel, forward, from, to) {
    const surface = this.plateau(sel, forward, from, to) * this.upSign;
    const tolerance = 0.1 / this.cmPerUnit;
    const { k } = this.rightOf(forward);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of this.inBand(sel, forward, from, to)) {
      if (Math.abs(v[this.upK] * this.upSign - surface) > tolerance) continue;
      if (v[k] < lo) lo = v[k];
      if (v[k] > hi) hi = v[k];
    }
    if (lo === Infinity) throw new Error(`midline(${JSON.stringify(sel)}): no vertices on the surface`);
    return (lo + hi) / 2;
  }

  /**
   * The highest point of a selection within a band along `forward` and a strip `across` it
   * (raw coordinates on the right axis): the mean of the vertices within half a millimetre of
   * the highest. A front post's tip, where `top` would answer with the hood's ears either side
   * of it, three millimetres taller.
   */
  peak(sel, forward, from, to, across) {
    const { k } = this.rightOf(forward);
    const hits = [];
    let best = -Infinity;
    for (const v of this.inBand(sel, forward, from, to)) {
      if (v[k] < across[0] || v[k] > across[1]) continue;
      const h = v[this.upK] * this.upSign;
      hits.push([v, h]);
      if (h > best) best = h;
    }
    if (hits.length === 0) throw new Error(`peak(${JSON.stringify(sel)}): no vertices in the band and strip`);
    const near = hits.filter(([, h]) => best - h <= 0.05 / this.cmPerUnit);
    const sum = [0, 0, 0];
    for (const [v] of near) for (let j = 0; j < 3; j++) sum[j] += v[j];
    return sum.map((s) => s / near.length);
  }

  /**
   * The centre of a rear aperture's opening (playtest 7): within a band along `forward` and a
   * strip `across` it (raw coordinates on the right axis), the middle of the widest gap
   * between the vertices' heights within `reach` of `near` — the front sight's tip, the height
   * an aperture is cut to look through. Only that window, because under the LONGBOW's ring
   * there is open air down to its base, a wider gap than the hole; and the strip is the
   * sight's middle column, where the ring's top and bottom are and its sides are not. Along
   * the barrel, the mean of the vertices on the gap's two edges. A raw point, as `peak`'s.
   */
  aperture(sel, forward, from, to, across, near, reach) {
    const { k } = this.rightOf(forward);
    const fk = AXES[forward].findIndex((c) => c !== 0);
    const target = near * this.upSign;
    const hits = [];
    for (const v of this.inBand(sel, forward, from, to)) {
      if (v[k] < across[0] || v[k] > across[1]) continue;
      const h = v[this.upK] * this.upSign;
      if (Math.abs(h - target) <= reach) hits.push([h, v]);
    }
    if (hits.length < 2) throw new Error(`aperture(${JSON.stringify(sel)}): fewer than two vertices in the window`);
    hits.sort((a, b) => a[0] - b[0]);
    let widest = 0;
    let at = 1;
    for (let i = 1; i < hits.length; i++) {
      const gap = hits[i][0] - hits[i - 1][0];
      if (gap > widest) { widest = gap; at = i; }
    }
    const lo = hits[at - 1][0];
    const hi = hits[at][0];
    const edge = 0.025 / this.cmPerUnit;
    const rim = hits.filter(([h]) => Math.abs(h - lo) <= edge || Math.abs(h - hi) <= edge);
    const out = [0, 0, 0];
    out[k] = (across[0] + across[1]) / 2;
    out[this.upK] = ((lo + hi) / 2) * this.upSign;
    out[fk] = rim.reduce((sum, [, v]) => sum + v[fk], 0) / rim.length;
    return out;
  }

  /**
   * The bounds of the vertices above a fraction of a selection's height: the head of a
   * collimator standing on its base, whose middle along the barrel is where its window is.
   */
  boundsAbove(sel, fraction) {
    const b = this.bounds(sel);
    const lo = Math.min(b.min[this.upK] * this.upSign, b.max[this.upK] * this.upSign);
    const hi = Math.max(b.min[this.upK] * this.upSign, b.max[this.upK] * this.upSign);
    const floor = lo + (hi - lo) * fraction;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of this.inBand(sel, 'x+', 0, 1)) {
      if (v[this.upK] * this.upSign < floor) continue;
      for (let j = 0; j < 3; j++) {
        if (v[j] < min[j]) min[j] = v[j];
        if (v[j] > max[j]) max[j] = v[j];
      }
    }
    return { min, max };
  }
}

/**
 * The rear point of an irons line that sees its front post over something standing taller
 * than the post (playtest 6), in source units along the recipe's axes.
 *
 * The VULCAN's quad rail stands 6 mm over its front post's tip, so a line level with the bore
 * through the two sights runs inside the rail, and a line level over the rail puts the post
 * 2.5 cm under the eye — beneath the screen's centre. The line that works goes through the
 * post's tip and falls toward it from over the rail, and the ADS pose turns the weapon by that
 * slope so the line is the camera's axis (`WeaponModel.adsPitch`). The slope is the least that
 * lets `show` of the post's top be seen over `edge` — the obstruction's top edge nearest the
 * post — from an eye `eye` behind the rear point, which is where the ADS pose holds it.
 */
function sightOver({ post, edge, rear, show, eye }, forward, up) {
  const f = AXES[forward];
  const k = f.findIndex((c) => c !== 0);
  const u = AXES[up];
  const uk = u.findIndex((c) => c !== 0);
  const behind = (p) => (post[k] - p[k]) * f[k];
  const height = (p) => p[uk] * u[uk];
  const toEdge = behind(edge);
  const toEye = behind(rear) + eye;
  const slope = (height(edge) - height(post) + show - (show * toEdge) / toEye) / toEdge;
  const out = [...rear];
  out[uk] = (height(post) + slope * behind(rear)) * u[uk];
  return out;
}

// -- the rewrite -----------------------------------------------------------------

function round(v) {
  return v.map((x) => Math.round(x * 1e6) / 1e6);
}

/**
 * The new node list: a root named for the output, one group per part list, the kept mesh
 * nodes under their groups with the fix baked into a `matrix`, and the sockets as empties
 * under the root. Everything else in the JSON — meshes, materials, textures, accessors — is
 * left in place for `prune` to sweep.
 */
/**
 * Drop every triangle of a cut node whose three corners lie on the cut-away side. The new
 * index list is appended to the binary chunk as its own buffer view and accessor; the old
 * accessor is left for `prune`. Vertices are not compacted — the cut-away ones stay in the
 * position buffer, unreferenced, a tenth of the L115A3's — and `weld` and `simplify` on the
 * LOD do not mind them.
 */
function applyCuts(json, bin, src, written) {
  if (src.cuts === undefined || src.cuts.size === 0) return bin;
  const chunks = [bin];
  let length = bin.length;
  for (const [i, cut] of src.cuts) {
    const node = json.nodes[i];
    const m = src.placed(i);
    for (const prim of json.meshes[node.mesh].primitives) {
      const pos = [...positions(src.glb, prim.attributes.POSITION)].map((p) => apply(m, p));
      const away = pos.map((v) => (cut.keep === 'above' ? v[cut.k] < cut.at : v[cut.k] > cut.at));
      const indices = readIndices(src, written, prim, pos.length);
      const kept = [];
      for (let k = 0; k + 2 < indices.length; k += 3) {
        const a = indices[k], b = indices[k + 1], c = indices[k + 2];
        if (away[a] && away[b] && away[c]) continue;
        kept.push(a, b, c);
      }
      const data = Buffer.alloc(kept.length * 4);
      kept.forEach((v, k) => data.writeUInt32LE(v, k * 4));
      const pad = (4 - (length % 4)) % 4;
      if (pad > 0) {
        chunks.push(Buffer.alloc(pad));
        length += pad;
      }
      json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length, target: 34963 });
      chunks.push(data);
      length += data.length;
      json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5125, count: kept.length, type: 'SCALAR' });
      prim.indices = json.accessors.length - 1;
      written.set(prim.indices, kept);
    }
  }
  const out = Buffer.concat(chunks);
  json.buffers[0].byteLength = out.length;
  return out;
}

/**
 * Scope glass and optic windows arrive as `KHR_materials_transmission` (and sometimes
 * `KHR_materials_volume`): three loads them as a transmissive `MeshPhysicalMaterial`, and a
 * transmissive material on screen makes the renderer draw the whole scene a second time into a
 * texture, every frame — the sniper's lag (playtest 3, finding 10), and a body's LOD carried it
 * too. Only the extensions go: the alpha mode and the base colour the artist authored are left
 * exactly as they are, because they are what the material looks like. Clamping the alpha here
 * instead (playtest 3) turned the L115A3's whole scope into a ghost — its tube, its rings and its
 * glass are one material, and a third of an alpha applied to that is a transparent rifle scope.
 */
function stripTransmission(json) {
  const gone = new Set(['KHR_materials_transmission', 'KHR_materials_volume']);
  let stripped = false;
  for (const material of json.materials ?? []) {
    const ext = material.extensions;
    if (ext === undefined || ![...gone].some((name) => name in ext)) continue;
    for (const name of gone) delete ext[name];
    if (Object.keys(ext).length === 0) delete material.extensions;
    stripped = true;
  }
  if (!stripped) return;
  const stillUsed = new Set();
  for (const material of json.materials ?? []) for (const name of Object.keys(material.extensions ?? {})) stillUsed.add(name);
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (!Array.isArray(json[key])) continue;
    json[key] = json[key].filter((name) => !gone.has(name) || stillUsed.has(name));
    if (json[key].length === 0) delete json[key];
  }
}

/**
 * Carve the triangles inside a box out of a part and give them their own node (playtest 4).
 *
 * The box is in **output space** — metres, barrel −Z, origin at the weapon's origin — because
 * that is the space a human can read off a screenshot and the space every socket is written in;
 * the vertices are carried there through `fix` before the test. A triangle moves only when all
 * three of its corners are inside, so a box drawn around a front sight post takes the post and
 * leaves the barrel it stands on.
 *
 * Two jobs, both from playtest 3's findings. `group: 'irons'` puts a weapon's own iron sights
 * where the runtime can hide them when an optic is fitted — they stood in the middle of the
 * sight picture, which is what the report showed. A `name` of `scope_glass` marks a lens the
 * runtime swaps for the project's own, which is how the L115A3's objective becomes something
 * you can see through while its tube stays solid.
 *
 * The split node shares the part's vertex buffers and carries its own index accessor, so this
 * costs an index list and a mesh entry and no geometry at all.
 */
/**
 * The triangle list a primitive has *now*: the source's, or the one an earlier cut or split
 * wrote. Re-reading the source after a rewrite was the L1A1's crash — its receiver carries two
 * splits, and the second asked the source for an accessor only this build had ever had.
 */
function readIndices(src, written, prim, vertexCount) {
  if (prim.indices === undefined) return Array.from({ length: vertexCount }, (_, k) => k);
  const already = written.get(prim.indices);
  if (already !== undefined) return already;
  return [...jointIndices(src.glb, prim.indices)];
}

function applySplits(json, bin, src, recipe, nodes, fix, written) {
  const splits = recipe.splits ?? [];
  if (splits.length === 0) return bin;
  const chunks = [bin];
  let length = bin.length;
  const groups = new Map();
  nodes.forEach((n, i) => {
    if (n.children !== undefined && n.name !== undefined) groups.set(n.name, i);
  });
  const byMesh = new Map();
  for (const n of nodes) if (n.mesh !== undefined) byMesh.set(n.mesh, (byMesh.get(n.mesh) ?? 0) + 1);

  const appendIndices = (list) => {
    const data = Buffer.alloc(list.length * 4);
    list.forEach((v, k) => data.writeUInt32LE(v, k * 4));
    const pad = (4 - (length % 4)) % 4;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad));
      length += pad;
    }
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length, target: 34963 });
    chunks.push(data);
    length += data.length;
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5125, count: list.length, type: 'SCALAR' });
    written.set(json.accessors.length - 1, list);
    return json.accessors.length - 1;
  };

  for (const split of splits) {
    const box = split.box;
    const inside = (v) =>
      ['x', 'y', 'z'].every((axis, k) => {
        const range = box[axis];
        return range === undefined || (v[k] >= range[0] && v[k] <= range[1]);
      });
    const parentName = split.group ?? 'body';
    let parent = groups.get(parentName);
    if (parent === undefined) {
      parent = nodes.push({ name: parentName, children: [] }) - 1;
      groups.set(parentName, parent);
      nodes[0].children.push(parent);
    }
    let taken = 0;
    for (const i of src.select(split.part)) {
      const node = src.json.nodes[i];
      if ((byMesh.get(node.mesh) ?? 0) > 1) {
        throw new Error(`split "${split.name ?? parentName}": mesh ${node.mesh} is used by more than one kept node`);
      }
      const world = mul(fix, src.placed(i));
      for (const prim of json.meshes[node.mesh].primitives) {
        const pos = [...positions(src.glb, prim.attributes.POSITION)].map((p) => apply(world, p));
        const inBox = pos.map(inside);
        const indices = readIndices(src, written, prim, pos.length);
        const mine = [];
        const rest = [];
        for (let k = 0; k + 2 < indices.length; k += 3) {
          const a = indices[k], b = indices[k + 1], c = indices[k + 2];
          (inBox[a] && inBox[b] && inBox[c] ? mine : rest).push(a, b, c);
        }
        if (mine.length === 0) continue;
        taken += mine.length / 3;
        prim.indices = appendIndices(rest);
        const mesh = json.meshes.push({ name: `${split.name ?? parentName}.mesh`, primitives: [{ ...prim, indices: appendIndices(mine) }] }) - 1;
        const placed = nodes.find((n) => n.mesh === node.mesh);
        const ni = nodes.push({ name: split.name ?? parentName, mesh, matrix: placed?.matrix }) - 1;
        nodes[parent].children.push(ni);
      }
    }
    if (taken === 0) {
      throw new Error(`split "${split.name ?? parentName}": the box caught no triangles — check it is in output space`);
    }
  }
  const out = Buffer.concat(chunks);
  json.buffers[0].byteLength = out.length;
  return out;
}

/**
 * Where the support hand takes the magazine on a reload (stage 4): the middle of the magazine
 * the recipe keeps, from its own vertices — every magazine part's bounds, together. The runtime
 * hangs the hand's target on the magazine node there, so the glove rides the magazine out and
 * back wherever the base grip was posed; the tuner's `reload` pose corrects it per weapon. A
 * weapon with no magazine part — a tube feed, a magazine modelled into the rifle — places its
 * own `socket_mag_grip`, and one that does not is refused here.
 */
function magazineMiddle(id, recipe, src) {
  const selectors = recipe.parts.magazine ?? [];
  if (selectors.length === 0) throw new Error(`${id}: no magazine part to measure socket_mag_grip from; the recipe must place it`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const sel of selectors) {
    const b = src.bounds(sel);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.min[k]);
      max[k] = Math.max(max[k], b.max[k]);
    }
  }
  return [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
}

function rewrite(id, recipe, src) {
  const forward = recipe.forward;
  src.setMoves(recipe.moves);
  src.setCuts(recipe.cuts);
  const measure = {
    bounds: (sel) => src.bounds(sel),
    tip: (sel) => src.tip(sel, forward),
    top: (sel, from, to) => src.top(sel, forward, from, to),
    bottom: (sel, from, to) => src.bottom(sel, forward, from, to),
    plateau: (sel, from, to) => src.plateau(sel, forward, from, to),
    side: (sel, from, to) => src.side(sel, forward, from, to),
    midline: (sel, from, to) => src.midline(sel, forward, from, to),
    peak: (sel, from, to, across) => src.peak(sel, forward, from, to, across),
    aperture: (sel, from, to, across, near, reach) => src.aperture(sel, forward, from, to, across, near, reach),
    boundsAbove: (sel, fraction) => src.boundsAbove(sel, fraction),
    // `show` and `eye` in metres, the points in source units.
    sightOver: ({ show, eye, ...points }) => sightOver({ ...points, show: show / recipe.unit, eye: eye / recipe.unit }, forward, recipe.up),
  };
  const origin = recipe.origin(measure);
  const fix = fixMatrix(recipe, origin);
  const sockets = recipe.sockets(measure);
  if (recipe.kind === 'weapon' && sockets.socket_mag_grip === undefined) {
    sockets.socket_mag_grip = magazineMiddle(id, recipe, src);
  }

  const nodes = [];
  const root = { name: id, children: [] };
  nodes.push(root);

  const kept = [];
  const materialSwaps = new Map();
  for (const [group, selectors] of Object.entries(recipe.parts)) {
    const g = { name: group, children: [] };
    const gi = nodes.push(g) - 1;
    root.children.push(gi);
    for (const sel of selectors) {
      for (const i of src.select(sel)) {
        const n = src.json.nodes[i];
        const parentName = src.parent.has(i) ? src.json.nodes[src.parent.get(i)].name : undefined;
        const label = n.name && n.name !== 'defaultMaterial' ? n.name : (parentName ?? `node${i}`);
        // A skinned node keeps its mesh and loses its skin: the vertices are at the bind pose
        // and the loader draws a rigid mesh, which is what a part of a rifle is.
        const ni = nodes.push({ name: label, mesh: n.mesh, matrix: mul(fix, src.placed(i)).map((x) => Math.round(x * 1e7) / 1e7) }) - 1;
        g.children.push(ni);
        kept.push(i);
        if (sel.useMaterial !== undefined) materialSwaps.set(n.mesh, sel.useMaterial);
      }
    }
  }

  const placed = {};
  for (const [name, socket] of Object.entries(sockets)) {
    // A socket is a point, or `{ at, roll }` for a mount on the weapon's side: `roll` turns
    // the socket's up about the barrel, in degrees, negative toward the right-hand side.
    const point = Array.isArray(socket) ? socket : socket.at;
    const t = round(apply(fix, point));
    placed[name] = t;
    const node = { name, translation: t };
    if (!Array.isArray(socket) && socket.roll !== undefined) {
      const half = (socket.roll * Math.PI) / 360;
      node.rotation = [0, 0, Math.round(Math.sin(half) * 1e6) / 1e6, Math.round(Math.cos(half) * 1e6) / 1e6];
    }
    root.children.push(nodes.push(node) - 1);
  }
  if (recipe.magazineExit !== undefined) {
    // A direction, carried as a point one metre along it from the origin: the fix's rotation
    // without its translation or scale.
    const R = fixMatrix({ ...recipe, unit: 1 }, [0, 0, 0]);
    const d = apply(R, recipe.magazineExit);
    const len = Math.hypot(d[0], d[1], d[2]);
    const t = round([d[0] / len, d[1] / len, d[2] / len]);
    placed.socket_mag_exit = t;
    root.children.push(nodes.push({ name: 'socket_mag_exit', translation: t }) - 1);
  }

  const json = structuredClone(src.json);
  stripTransmission(json);
  // Index lists this build has rewritten, by accessor: a part can be cut and split, or split
  // twice, and each edit works on what the last one left rather than on the source.
  const written = new Map();
  const bin = applySplits(json, applyCuts(json, src.glb.bin, src, written), src, recipe, nodes, fix, written);
  for (const [meshIndex, materialName] of materialSwaps) {
    const target = json.materials.findIndex((m) => m.name === materialName);
    if (target < 0) throw new Error(`${id}: useMaterial "${materialName}" names no material in the source`);
    for (const prim of json.meshes[meshIndex].primitives) prim.material = target;
  }
  json.nodes = nodes;
  // The scene is not the root: three's loader would rename the second of two nodes called
  // `id` to `id_1`, and the root is the one the runtime looks up by name.
  json.scenes = [{ name: `${id}.scene`, nodes: [0] }];
  json.scene = 0;
  delete json.skins;
  delete json.animations;
  delete json.cameras;
  json.asset = json.asset ?? { version: '2.0' };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    attribution: { title: recipe.source.title, author: recipe.source.author, authorUrl: recipe.source.authorUrl, license: recipe.source.license, licenseUrl: recipe.source.licenseUrl, url: recipe.source.url },
    protocolSeven: { recipe: id, kind: recipe.kind, source: recipe.source.file, sockets: placed },
  };
  return { json, bin, sockets: placed, kept, origin };
}

/**
 * The recipe's credit against the file's own. Sketchfab writes `author` as "Name (profile
 * URL)", `license` as "CC-BY-4.0 (deed URL)", `source` as the model page and `title` as
 * shown; a recipe that says otherwise is a typo in a legal record, and the build stops on it.
 */
/**
 * The rig's pass 1 (stage 4): the source's tree kept whole — skin, joints and inverse bind
 * matrices — under one new root carrying the fix, so the skeleton the runtime poses is the
 * artist's. Only the meshes on `keepMaterials` keep their mesh; `prune` drops the rest with
 * what they alone referenced. The origin is the rig's own camera bone: the eye the arms were
 * framed for, which the runtime's shoulders and elbows are placed against.
 */
function rewriteRig(id, recipe, src) {
  const json = structuredClone(src.json);
  const eye = src.json.nodes.findIndex((n) => n.name === recipe.eye);
  if (eye < 0) throw new Error(`${id}: the source has no node "${recipe.eye}" to put the eye at`);
  const w = src.world(eye);
  const origin = [w[12], w[13], w[14]];
  const fix = fixMatrix(recipe, origin);
  const kept = [];
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    if (recipe.keepMaterials.includes(src.materialName(src.json.nodes[i]))) kept.push(i);
    else delete n.mesh;
  });
  if (kept.length !== recipe.keepMaterials.length) throw new Error(`${id}: expected ${recipe.keepMaterials.length} meshes on ${recipe.keepMaterials.join(', ')}, found ${kept.length}`);
  for (const n of json.nodes) if (n.name !== undefined) n.name = recipe.rename(n.name);
  const roots = json.scenes[json.scene ?? 0].nodes;
  const root = json.nodes.push({ name: id, matrix: fix.map((v) => Math.round(v * 1e9) / 1e9), children: [...roots] }) - 1;
  json.scenes = [{ name: `${id}.scene`, nodes: [root] }];
  json.scene = 0;
  delete json.animations;
  delete json.cameras;
  stripTransmission(json);
  json.asset = json.asset ?? { version: '2.0' };
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    attribution: { title: recipe.source.title, author: recipe.source.author, authorUrl: recipe.source.authorUrl, license: recipe.source.license, licenseUrl: recipe.source.licenseUrl, url: recipe.source.url },
    protocolSeven: { recipe: id, kind: recipe.kind, source: recipe.source.file, sockets: {} },
  };
  return { json, bin: src.glb.bin, sockets: {}, kept, origin };
}

function verifyAttribution(id, source, extras) {
  const problems = [];
  if (!extras) {
    problems.push('the source file carries no asset.extras; supply the credit by hand and note where it came from');
  } else {
    if (extras.title !== undefined && extras.title !== source.title) problems.push(`title: recipe "${source.title}", file "${extras.title}"`);
    if (extras.source !== undefined && extras.source !== source.url) problems.push(`url: recipe ${source.url}, file ${extras.source}`);
    if (extras.author !== undefined && extras.author !== `${source.author} (${source.authorUrl})`) problems.push(`author: recipe "${source.author} (${source.authorUrl})", file "${extras.author}"`);
    if (extras.license !== undefined && !extras.license.startsWith(source.license)) problems.push(`license: recipe ${source.license}, file "${extras.license}"`);
  }
  if (problems.length > 0) {
    throw new Error([`${id}: the recipe's attribution disagrees with ${source.file}:`, ...problems.map((p) => `  ${p}`)].join('\n'));
  }
}

/** Write a GLB: the 12-byte header, the JSON chunk padded with spaces, the binary chunk padded with zeros. */
export function writeGlb(file, json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBytes.length + jsonPad, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(out, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const binAt = 20 + jsonBytes.length + jsonPad;
  out.writeUInt32LE(bin.length + binPad, binAt);
  out.writeUInt32LE(0x004e4942, binAt + 4);
  bin.copy(out, binAt + 8);
  writeFileSync(file, out);
}

/** Put a root named for the output over a flattened scene, and the sockets under it. */
function reroot(from, to, id, sockets) {
  const glb = readGlb(from);
  const json = glb.json;
  const scene = json.scenes[json.scene ?? 0];
  scene.name = `${id}.scene`;
  const rootIndex = json.nodes.push({ name: id, children: [...scene.nodes] }) - 1;
  for (const [name, translation] of Object.entries(sockets)) {
    json.nodes[rootIndex].children.push(json.nodes.push({ name, translation }) - 1);
  }
  scene.nodes = [rootIndex];
  writeGlb(to, json, glb.bin);
}

// -- the CLI pass --------------------------------------------------------------------

function run(args) {
  execFileSync(process.execPath, [NPX_CLI, '--yes', CLI, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function triangles(json) {
  let n = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const count = prim.indices !== undefined ? json.accessors[prim.indices].count : json.accessors[prim.attributes.POSITION].count;
      if ((prim.mode ?? 4) === 4) n += count / 3;
    }
  }
  return Math.round(n);
}

export function buildOne(id, work) {
  const recipe = RECIPES[id];
  if (recipe === undefined) throw new Error(`no recipe "${id}"; known: ${Object.keys(RECIPES).join(', ')}`);
  const sourceFile = path.join(SOURCE_DIR, recipe.source.file);
  if (!existsSync(sourceFile)) throw new Error(`source ${path.relative(ROOT, sourceFile)} is missing; the sources live outside the repository`);

  const glb = readGlb(sourceFile);
  verifyAttribution(id, recipe.source, glb.json.asset?.extras);
  const src = new Source(glb, recipe.unit, recipe.up);
  const { json, bin, sockets, kept, origin } = recipe.kind === 'hands' ? rewriteRig(id, recipe, src) : rewrite(id, recipe, src);

  const staged = path.join(work, `${id}.staged.glb`);
  writeGlb(staged, json, bin);
  const pruned = path.join(work, `${id}.pruned.glb`);
  run(['prune', staged, pruned, '--keep-leaves', 'true']);
  const dedupedRaw = path.join(work, `${id}.dedup.glb`);
  run(['dedup', pruned, dedupedRaw]);
  // A source over the viewmodel's budget is simplified here, before the textures: the L115A3
  // is 195k triangles, most of them on its scope.
  let deduped = dedupedRaw;
  if (recipe.simplify !== undefined) {
    const welded = path.join(work, `${id}.welded0.glb`);
    run(['weld', dedupedRaw, welded]);
    deduped = path.join(work, `${id}.simplified0.glb`);
    run(['simplify', welded, deduped, '--ratio', String(recipe.simplify), '--error', String(LOD_ERROR), '--lock-border', 'false']);
  }
  const resized = path.join(work, `${id}.resized.glb`);
  const side = recipe.textureSide ?? MAX_SIDE;
  run(['resize', deduped, resized, '--width', String(side), '--height', String(side)]);
  const out = path.join(OUT_DIR, `${id}.glb`);
  run(['webp', resized, out, '--quality', String(WEBP_QUALITY)]);

  const report = { id, kept: kept.length, origin: round(origin), sockets, triangles: triangles(readGlb(out).json), bytes: statSync(out).size };

  if (recipe.lod) {
    const welded = path.join(work, `${id}.welded.glb`);
    run(['weld', deduped, welded]);
    const simplified = path.join(work, `${id}.simplified.glb`);
    run(['simplify', welded, simplified, '--ratio', String(LOD_RATIO), '--error', String(LOD_ERROR), '--lock-border', 'false']);
    // `join` flattens the scene to one primitive per material and drops the empties with it,
    // so the sockets go back in afterwards: a body at twenty metres still has a muzzle.
    const joined = path.join(work, `${id}.joined.glb`);
    run(['join', simplified, joined]);
    const rerooted = path.join(work, `${id}.rerooted.glb`);
    reroot(joined, rerooted, id, sockets);
    const small = path.join(work, `${id}.small.glb`);
    const lodSide = Math.min(LOD_SIDE, side / 4);
    run(['resize', rerooted, small, '--width', String(lodSide), '--height', String(lodSide)]);
    const lod = path.join(OUT_DIR, `${id}.lod1.glb`);
    run(['webp', small, lod, '--quality', String(WEBP_QUALITY)]);
    report.lod1 = { triangles: triangles(readGlb(lod).json), bytes: statSync(lod).size };
  }
  return report;
}

/**
 * The attribution itself, in the words the licence asks for.
 *
 * CC-BY 4.0 §3(a) wants the title, the author, a link to the material and the licence with a
 * link to the deed, and Sketchfab's "copy attribution" button writes that as one sentence —
 * the form every author sees and expects back. The table above it says which of our files came
 * out of which source; this is the part that has to be reproduced wherever the models go, so
 * it is the part the game shows and the part a reader can copy.
 */
export function creditSentence(source) {
  const licence =
    source.license === 'CC-BY-4.0'
      ? `Creative Commons Attribution (${source.licenseUrl})`
      : `the Sketchfab Standard licence (${source.licenseUrl})`;
  return `"${source.title}" (${source.url}) by ${source.author} is licensed under ${licence}.`;
}

/** Every source a recipe draws on, once each, with the files built from it. Title order. */
export function sources() {
  const bySource = new Map();
  for (const [id, r] of Object.entries(RECIPES)) {
    const list = bySource.get(r.source.url) ?? { source: r.source, outputs: [] };
    list.outputs.push(`${id}.glb`);
    bySource.set(r.source.url, list);
  }
  return [...bySource.values()].sort((a, b) => a.source.title.localeCompare(b.source.title));
}

/** `CREDITS.md`: one row per source, regenerated so the file cannot drift from the recipes. */
export function creditsMarkdown() {
  const list = sources();
  const rows = list.map(
    ({ source, outputs }) => `| [${source.title}](${source.url}) | [${source.author}](${source.authorUrl}) | [${source.license}](${source.licenseUrl}) | ${outputs.join(', ')} |`,
  );
  return [
    '# Weapon model credits',
    '',
    'Every file in this folder is built by `scripts/weapon-build.mjs` from a Sketchfab source',
    'outside the repository. The licences below are conditions of use: CC-BY requires this',
    'attribution wherever the models are distributed, and each `.glb` carries the same record in',
    '`asset.extras.attribution`. This file is regenerated by the build; edit the recipes, not this.',
    'The whole project’s credits, including the hands and the characters, are in `CREDITS.md`',
    'at the root, and the game shows them under SETTINGS → INFO.',
    '',
    '| Source | Author | Licence | Built files |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Attribution',
    '',
    'The sentence each licence asks to be reproduced, as the author wrote it:',
    '',
    ...list.map(({ source }) => `- ${creditSentence(source)}`),
    '',
  ].join('\n');
}

/**
 * `--list <file>`: every mesh node of a source with the names a selector can use, its
 * material, the joint it hangs on if skinned, and its world bounds. What a recipe is written
 * from.
 */
function listSource(file) {
  const glb = readGlb(path.isAbsolute(file) ? file : path.join(SOURCE_DIR, file));
  const src = new Source(glb, 1, 'y+');
  src.json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const names = [n.name ?? ''];
    for (let p = src.parent.get(i), depth = 0; p !== undefined && depth < 2; p = src.parent.get(p), depth++) names.push(src.json.nodes[p].name ?? '');
    const b = src.bounds({ index: i });
    const f = (v) => v.map((x) => x.toFixed(3)).join(',');
    const joint = src.jointName(i);
    console.log(
      `${String(i).padStart(4)}  ${names.map((s) => JSON.stringify(s)).join(' < ')}  mat=${src.materialName(n)}${joint ? `  joint=${joint}` : ''}  min=[${f(b.min)}] max=[${f(b.max)}]`,
    );
  });
}

function main() {
  const listAt = process.argv.indexOf('--list');
  if (listAt >= 0) {
    listSource(process.argv[listAt + 1]);
    return;
  }
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const ids = wanted.length > 0 ? wanted : Object.keys(RECIPES);
  mkdirSync(OUT_DIR, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'operator-weapons-'));
  try {
    for (const id of ids) {
      const r = buildOne(id, work);
      const lod = r.lod1 ? `; lod1 ${r.lod1.triangles.toLocaleString('en-US')} tris, ${(r.lod1.bytes / 1048576).toFixed(2)} MB` : '';
      console.log(`${id.padEnd(16)} ${r.kept} node(s), ${r.triangles.toLocaleString('en-US')} tris, ${(r.bytes / 1048576).toFixed(2)} MB${lod}`);
      console.log(`${''.padEnd(16)} origin ${JSON.stringify(r.origin)}; sockets ${JSON.stringify(r.sockets)}`);
    }
    writeFileSync(path.join(OUT_DIR, 'CREDITS.md'), creditsMarkdown());
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\nWrote ${ids.length} recipe(s) to ${path.relative(ROOT, OUT_DIR)}; now run npm run check:weapons.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
