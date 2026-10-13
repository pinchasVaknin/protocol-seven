#!/usr/bin/env node
/**
 * The file skeleton, held to its spec (refactor unit S0).
 *
 * The refactor programme gives every source file the same shape: a sequence of sections, each
 * one a 100-character header line, a `//#region` naming it, the section's content, and an
 * `//#endregion` — in a fixed order, so a reader who knows the shape knows where to look in a
 * file they have never opened. REFACTOR-PROMPT.md section 3 is the spec; this is what keeps it.
 *
 * ## Why a ratchet rather than a sweep
 *
 * The tree is 432 files and the programme works through it one unit at a time, so a check that
 * demanded the skeleton everywhere would be red for months and would therefore be switched
 * off. Instead `FINISHED` lists the files a unit has actually finished, and only those are
 * checked. Every unit's commit appends its own files to that list. The gate is green from the
 * first day, it can never go backwards on a file already done, and the list doubles as the
 * record of how far the programme has got.
 *
 * A file not in the list is not checked — that is the point, and it is also the one way to
 * fool this script. The list is appended to in the same commit as the unit, so the review that
 * approves the unit is the review that sees the list grow.
 *
 * ## What is checked
 *
 *  1. **Header lines.** A header is rebuilt from its name and indentation and compared whole,
 *     so the `=` padding, the single spaces, the two trailing backslashes and the exact
 *     100-character width are all one assertion. `\r` is not counted: the tree has both line
 *     endings and a CRLF file's header is still 100 characters of content.
 *  2. **Known names, in order.** The file-level names and their order, the class-body names and
 *     their order, and `CLASS <Name>` once per class. A file whose sections include DATA is
 *     read as a data file (IMPORTS, TYPES, DATA only); everything else as a module file.
 *  3. **The region line.** Every header is followed immediately by `//#region <Title Case>` at
 *     the same indentation, and every `//#region` is preceded immediately by its header — so a
 *     stray region somewhere in the middle of a file is a violation too.
 *  4. **Regions balanced, and never inside a function.** A region may open at file level, or in
 *     a class body; anywhere else means it has been put inside a function, which the spec
 *     refuses because a region that hides part of a function body hides the thing a reader
 *     came for.
 *  5. **Blank lines.** None directly after a `//#region` or directly before an `//#endregion`,
 *     and exactly one before each header. Two exceptions, both from the pilot unit (A1):
 *     a header on the first line of a file has nothing before it, and the first header in a
 *     class body follows the declaration line directly — which is how section 3.4's own
 *     example is written.
 *
 * Test files are skipped, and listing one is itself a violation: `*.test.ts` gets no skeleton
 * (R9), so a test path in the list can only be a mistake.
 *
 * ## What is not checked, and where it lives instead
 *
 * **The function limits** (50 lines, cognitive complexity 15, nesting 3). They are measured by
 * `Claude outputs/refactor/measure.mjs`, which is gitignored: a gate that shelled out to it
 * would pass here and fail on a fresh clone, which is worse than not checking. Rather than
 * grow a second, text-based approximation of a metric that already has an AST implementation,
 * the limits stay what they are today — measured per unit and recorded, with its numbers, in
 * that unit's report. This is the deliberate gap, written down so the next reader does not
 * assume it is covered.
 *
 * Text, not types, like the rest of the audits: comments and string bodies are blanked before
 * the braces are counted, so a `{` in a doc comment or a string is not a block. The region
 * lines are read off the raw text first, since blanking would erase them.
 *
 * Exit code is 1 on any violation, which is what makes it a gate rather than a report. It was
 * proved red on twelve planted violations — a header one character short, a misplaced `=`, an
 * unknown name, a file section out of order, a class section out of order, a missing region
 * line, a misnamed region, a region inside a function, an unclosed region, a misindented
 * `//#endregion`, a blank line after a region, and a missing blank line before a header —
 * with a thirteenth case running an untouched file to prove it still goes green, before it
 * joined the chain, as `check-plan` and `check-decorators` were.
 *
 *   node scripts/check-style.mjs                  the ratchet; what the gate runs
 *   node scripts/check-style.mjs <file> [...]      those files instead, for a unit in progress
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// The ratchet
// ---------------------------------------------------------------------------

/**
 * Files whose skeleton is finished, by the unit that finished them.
 *
 * Append a unit's non-test files here in the same commit as the unit. Never remove a row: a
 * file leaving this list is a file whose shape stopped being guaranteed, and the only honest
 * reason for that is deleting the file itself.
 */
const FINISHED = {
  A1: [
    'src/shared/core/Clock.ts',
    'src/shared/core/Decorators.ts',
    'src/shared/core/Disposable.ts',
    'src/shared/core/EventBus.ts',
    'src/shared/core/Events.ts',
    'src/shared/core/GameStates.ts',
    'src/shared/core/InputCommand.ts',
    'src/shared/core/Keybinds.ts',
    'src/shared/core/Log.ts',
    'src/shared/core/Loop.ts',
    'src/shared/core/MathUtil.ts',
    'src/shared/core/ObjectPool.ts',
    'src/shared/core/Rng.ts',
    'src/shared/core/SimMath.ts',
    'src/shared/core/StateHash.ts',
  ],
  A2: [
    'src/shared/cheats/Cheats.ts',
    'src/shared/ui/Capabilities.ts',
    'src/shared/ui/Crosshair.ts',
    'src/shared/ui/HudSurfaces.ts',
    'src/shared/ui/ScreenProjection.ts',
    'src/shared/ui/SkipGesture.ts',
    'src/shared/ui/TeamColour.ts',
  ],
  A3a: [
    'src/shared/world/maps/depot.ts',
    'src/shared/world/maps/dunes.ts',
    'src/shared/world/maps/foundry.ts',
    'src/shared/world/maps/greybox.ts',
  ],
  A3b: [
    'src/shared/world/maps/albedo.ts',
    'src/shared/world/maps/build.ts',
    'src/shared/world/maps/cover.ts',
    'src/shared/world/maps/materials.ts',
    // The programme's first data file: IMPORTS -> DATA, and nothing else.
    'src/shared/world/maps/props.ts',
    'src/shared/world/maps/types.ts',
  ],
  A4: [
    'src/shared/world/ColliderSet.ts',
    'src/shared/world/CollisionWorld.ts',
    'src/shared/world/Geometry.ts',
    'src/shared/world/MapLoader.ts',
    'src/shared/world/Raycaster.ts',
    'src/shared/world/SpatialHash.ts',
  ],
  A5: [
    'src/shared/world/MapLuminance.ts',
    'src/shared/world/NavBake.ts',
    'src/shared/world/NavGrid.ts',
    // A barrel: two re-exports, so IMPORTS is the only section it has.
    'src/shared/world/Navmesh.ts',
    'src/shared/world/SkyProfile.ts',
    'src/shared/world/SupplySystem.ts',
  ],
  A6: [
    'src/shared/player/Health.ts',
    'src/shared/player/Mantle.ts',
    'src/shared/player/Movement.ts',
    // No imports at all, so TYPES is its first section.
    'src/shared/player/MovementConfig.ts',
    'src/shared/player/PlayerController.ts',
    'src/shared/player/PlayerState.ts',
    'src/shared/player/Slide.ts',
    'src/shared/player/Stance.ts',
  ],
  A7: [
    'src/shared/weapons/AnyWeapon.ts',
    'src/shared/weapons/Ballistics.ts',
    'src/shared/weapons/FlameCone.ts',
    'src/shared/weapons/Melee.ts',
    'src/shared/weapons/Recoil.ts',
    'src/shared/weapons/Scope.ts',
    'src/shared/weapons/WeaponBase.ts',
    'src/shared/weapons/WeaponSystem.ts',
  ],
  A8: [
    'src/shared/weapons/Attachments.ts',
    'src/shared/weapons/Inventory.ts',
    'src/shared/weapons/ViewmodelConfig.ts',
    'src/shared/weapons/WeaponDefs.ts',
    'src/shared/weapons/WeaponTuning.ts',
    // The arsenal's data: no function and no class anywhere, so IMPORTS -> DATA and nothing else.
    'src/shared/weapons/defs/assaultRifles.ts',
    'src/shared/weapons/defs/lmgs.ts',
    'src/shared/weapons/defs/pistols.ts',
    'src/shared/weapons/defs/shotguns.ts',
    'src/shared/weapons/defs/smgs.ts',
    'src/shared/weapons/defs/snipers.ts',
  ],
  A9: [
    'src/shared/combat/BurnSystem.ts',
    'src/shared/combat/DamageSystem.ts',
    'src/shared/combat/HitboxRig.ts',
    'src/shared/combat/Hostility.ts',
    'src/shared/combat/Killfeed.ts',
    'src/shared/combat/LocalIdentity.ts',
    'src/shared/combat/ScoreSystem.ts',
    'src/shared/combat/ShotAccounting.ts',
  ],
  A10: [
    'src/shared/equipment/BotThrower.ts',
    'src/shared/equipment/EquipmentConfig.ts',
    'src/shared/equipment/EquipmentDefs.ts',
    'src/shared/equipment/EquipmentSystem.ts',
    'src/shared/equipment/FlashField.ts',
    'src/shared/equipment/LifeStockAudit.ts',
    'src/shared/equipment/Projectile.ts',
    'src/shared/equipment/SmokeField.ts',
    'src/shared/equipment/ThrowController.ts',
  ],
  A11: [
    'src/shared/ai/AiScheduler.ts',
    'src/shared/ai/BotBlackboard.ts',
    'src/shared/ai/BotVisualState.ts',
    'src/shared/ai/CombatBehaviour.ts',
    'src/shared/ai/Combatant.ts',
    'src/shared/ai/Cover.ts',
    // The guard between `LEG_BOX` and `LEG_PIVOT_Y` stays inside CONSTANTS: moving it to a
    // MODULE INITIALISATION section would lose the narrowing the two derived constants rely on.
    'src/shared/ai/Gait.ts',
    'src/shared/ai/ObjectiveIntent.ts',
    'src/shared/ai/Pathing.ts',
    'src/shared/ai/Perception.ts',
    'src/shared/ai/PlayerCombatant.ts',
    'src/shared/ai/WeaponProfile.ts',
  ],
  A12: [
    'src/shared/ai/Bot.ts',
    'src/shared/ai/BotBrain.ts',
    // The module scratch the path follower writes moved up into CONSTANTS from the foot of
    // the file: it is module-level state, and nothing reads it at load.
    'src/shared/ai/BotStates.ts',
  ],
  A13: [
    'src/shared/ai/BotArsenal.ts',
    // `TIER_CONFIG_KEYS` and `PERCEPTION_CONFIG_KEYS` are `Object.keys` of a literal, read at
    // load, so CONSTANTS keeps the original relative order of every value in the file.
    'src/shared/ai/DifficultyTiers.ts',
    'src/shared/ai/RosterDeal.ts',
    'src/shared/ai/SpawnSelector.ts',
    'src/shared/ai/BotDirector.ts',
  ],
  A14: [
    'src/shared/modes/GameMode.ts',
    'src/shared/modes/Tdm.ts',
    'src/shared/modes/FreeForAll.ts',
    'src/shared/modes/Range.ts',
    'src/shared/modes/KillConfirmed.ts',
    'src/shared/modes/Domination.ts',
    'src/shared/modes/ObjectiveZone.ts',
    'src/shared/modes/MatchOutcome.ts',
    'src/shared/modes/SpectatorTarget.ts',
  ],
  A15: [
    'src/shared/modes/SearchAndDestroy.ts',
    'src/shared/modes/MatchFlow.ts',
    'src/shared/modes/ModeRegistry.ts',
  ],
  A16: [
    'src/shared/streaks/KillstreakBase.ts',
    'src/shared/streaks/CarePackage.ts',
    'src/shared/streaks/CarriedWeapon.ts',
    'src/shared/streaks/ChopperGunner.ts',
    'src/shared/streaks/CounterUav.ts',
    'src/shared/streaks/MortarStrike.ts',
    'src/shared/streaks/SentryGun.ts',
    'src/shared/streaks/Uav.ts',
    'src/shared/streaks/StreakWeapons.ts',
  ],
  A17: [
    'src/shared/streaks/StreakSystem.ts',
    'src/shared/streaks/StreakLedger.ts',
    'src/shared/streaks/StreakDefs.ts',
    'src/shared/streaks/StreakPresentation.ts',
  ],
  A18: [
    'src/shared/perks/FieldUpgrade.ts',
    'src/shared/perks/PerkDefs.ts',
    'src/shared/perks/PerkState.ts',
    'src/shared/perks/PerksRuntime.ts',
    'src/shared/meta/Camos.ts',
    'src/shared/meta/Challenges.ts',
    'src/shared/meta/ChallengeTracker.ts',
    'src/shared/meta/FieldUpgrades.ts',
    'src/shared/meta/Levels.ts',
    'src/shared/meta/XpRules.ts',
    'src/shared/meta/XpSimulator.ts',
    'src/shared/meta/Skins.ts',
  ],
  A19: [
    'src/shared/meta/SaveData.ts',
    'src/shared/meta/Unlocks.ts',
    'src/shared/meta/LoadoutRules.ts',
    'src/shared/meta/Loadouts.ts',
    'src/shared/meta/MatchLedger.ts',
    'src/shared/meta/MatchProgression.ts',
    'src/shared/meta/ProgressionStore.ts',
  ],
  A20: [
    'src/shared/net/Wire.ts',
    'src/shared/net/Protocol.ts',
    'src/shared/net/Snapshot.ts',
    'src/shared/net/UrlFlags.ts',
    'src/shared/net/DisplayText.ts',
  ],
};

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

const WIDTH = 100;

/** File-level sections, in the only order they may appear in. `CLASS` stands for every class. */
const MODULE_ORDER = [
  'IMPORTS',
  'TYPES',
  'CONSTANTS',
  'CLASS',
  'DERIVED CONSTANTS',
  'EXPORTED FUNCTIONS',
  'INTERNAL HELPERS',
  'MODULE INITIALISATION',
];

/** A data file has no function and no class, so it has three sections and no more. */
const DATA_ORDER = ['IMPORTS', 'TYPES', 'DATA'];

/** Class-body sections, in the only order they may appear in. */
const CLASS_ORDER = [
  'STATIC',
  'FIELDS',
  'CONSTRUCTOR',
  'PUBLIC METHODS',
  'PROTECTED METHODS',
  'PRIVATE METHODS',
];

const FILE_NAMES = new Set([...MODULE_ORDER.filter((n) => n !== 'CLASS'), 'DATA']);
const CLASS_NAMES = new Set(CLASS_ORDER);

/** A line that is trying to be a header. Parsed strictly once it has been recognised. */
const HEADER_SHAPE = /^( *)\/\/ =+ (.+?) =+ \\\\$/;

const REGION = /^( *)\/\/#region(?: .*)?$/;
const ENDREGION = /^( *)\/\/#endregion$/;

/** `PUBLIC METHODS` -> `Public Methods`, and `CLASS Tdm` -> `Class Tdm` (the name is a name). */
function titleOf(name) {
  if (name.startsWith('CLASS ')) return `Class ${name.slice(6)}`;
  return name
    .split(' ')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * The one true header line for a name at an indentation — the same arithmetic as header.mjs.
 *
 * Rebuilding and comparing whole is deliberate: it makes the padding, the spacing, the
 * trailing backslashes and the width a single assertion that cannot be partly satisfied.
 */
function headerFor(name, indent) {
  const rest = WIDTH - indent - 8 - name.length;
  if (rest < 6) return null;
  const left = Math.floor(rest / 2);
  return `${' '.repeat(indent)}// ${'='.repeat(left)} ${name} ${'='.repeat(rest - left)} \\\\`;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Blank out comments and string/template bodies, preserving offsets and newlines. */
function stripCommentsAndStrings(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * For each line, the brace stack above it: one entry per open block, 'class' or 'other'.
 *
 * A region is legal at file level and in a class body, so what the check needs is not the
 * depth but whether every enclosing block is a class. An `interface` or a `type` body counts
 * as a class here — neither can contain a function body, so a region inside one is not the
 * mistake this rule is about, and the section rules refuse it anyway.
 */
function blockStacks(code) {
  const lines = code.split('\n');
  const stacks = [];
  const stack = [];
  const opener = /\b(class|interface)\b/;
  for (const line of lines) {
    stacks.push(stack.slice());
    const isClassish = opener.test(line);
    for (const ch of line) {
      if (ch === '{') stack.push(isClassish ? 'class' : 'other');
      else if (ch === '}') stack.pop();
    }
  }
  return stacks;
}

// ---------------------------------------------------------------------------

const violations = [];

function report(rel, line, message) {
  violations.push(`${rel}:${line}  ${message}`);
}

function checkFile(rel, absolute = null) {
  const abs = absolute ?? path.join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`${rel}  listed as finished but the file does not exist`);
    return null;
  }
  if (rel.endsWith('.test.ts')) {
    violations.push(`${rel}  a test file gets no skeleton (R9) and must not be listed`);
    return null;
  }

  const raw = readFileSync(abs, 'utf8');
  // Line endings are mixed across the tree, and a CRLF header is still 100 characters of
  // content, so the carriage return is dropped before anything is measured.
  const lines = raw.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const stacks = blockStacks(stripCommentsAndStrings(lines.join('\n')));

  const headers = [];          // { name, indent, line }
  const regionStack = [];      // { line, indent }
  let sawData = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const no = i + 1;
    const shape = HEADER_SHAPE.exec(line);

    if (shape !== null) {
      const indent = shape[1].length;
      const name = shape[2];
      const want = headerFor(name, indent);

      if (indent !== 0 && indent !== 2) {
        report(rel, no, `header indented ${indent}; file sections take 0 and class sections 2`);
      }
      if (want === null) {
        report(rel, no, `section name '${name}' is too long for a ${WIDTH}-character header`);
      } else if (line !== want) {
        report(
          rel,
          no,
          `header is not the exact line for '${name}' at indent ${indent} ` +
            `(${line.length} characters, expected ${WIDTH})\n      found    ${line}\n      expected ${want}`,
        );
      }

      const atClassLevel = indent === 2;
      if (atClassLevel && !CLASS_NAMES.has(name)) {
        report(rel, no, `'${name}' is not a class-body section name`);
      }
      if (!atClassLevel && !name.startsWith('CLASS ') && !FILE_NAMES.has(name)) {
        report(rel, no, `'${name}' is not a file-level section name`);
      }
      if (name === 'DATA') sawData = true;
      headers.push({ name, indent, line: no });

      // The region line follows immediately, at the same indentation.
      const next = lines[i + 1] ?? '';
      const wantRegion = `${' '.repeat(indent)}//#region ${titleOf(name)}`;
      if (next !== wantRegion) {
        report(
          rel,
          no + 1,
          `the header is not followed by its region line\n      found    ${JSON.stringify(next)}\n      expected ${JSON.stringify(wantRegion)}`,
        );
      }

      // Exactly one blank line before a header. Not for a header on line 1, and not for the
      // first header in a class body, which follows the declaration line (section 3.4).
      const prev = i > 0 ? lines[i - 1] : null;
      const opensBody = prev !== null && prev.trimEnd().endsWith('{');
      if (prev !== null && !opensBody) {
        if (prev.trim() !== '') {
          report(rel, no, 'no blank line before the header');
        } else if (i > 1 && lines[i - 2].trim() === '') {
          report(rel, no, 'more than one blank line before the header');
        }
      }
      continue;
    }

    const region = REGION.exec(line);
    if (region !== null) {
      const indent = region[1].length;
      // Its header must be the line above; the header branch checked the other direction.
      const above = i > 0 ? lines[i - 1] : '';
      if (HEADER_SHAPE.exec(above) === null) {
        report(rel, no, 'a region that is not part of a section — every region follows its header');
      }
      const stack = stacks[i] ?? [];
      if (stack.some((k) => k !== 'class')) {
        report(
          rel,
          no,
          'a region opened inside a function — regions sit at file level and in a class body only',
        );
      }
      if ((lines[i + 1] ?? '').trim() === '') {
        report(rel, no, 'blank line directly after //#region');
      }
      regionStack.push({ line: no, indent });
      continue;
    }

    const end = ENDREGION.exec(line);
    if (end !== null) {
      if (regionStack.length === 0) {
        report(rel, no, '//#endregion with no region open');
      } else {
        const open = regionStack.pop();
        if (end[1].length !== open.indent) {
          report(
            rel,
            no,
            `//#endregion indented ${end[1].length}, but its region on line ${open.line} ` +
              `is indented ${open.indent}`,
          );
        }
      }
      if (i > 0 && lines[i - 1].trim() === '') {
        report(rel, no, 'blank line directly before //#endregion');
      }
    }
  }

  for (const open of regionStack) {
    report(rel, open.line, 'region never closed');
  }

  if (headers.length === 0) {
    violations.push(`${rel}  listed as finished but has no section headers at all`);
    return null;
  }

  checkOrder(rel, headers, sawData);
  return headers;
}

/** Section order, at file level and inside each class body. */
function checkOrder(rel, headers, isDataFile) {
  const order = isDataFile ? DATA_ORDER : MODULE_ORDER;
  const kind = isDataFile ? 'data' : 'module';

  let filePos = -1;
  let classPos = -1;
  let inClass = false;
  const seen = new Set();

  for (const h of headers) {
    if (h.indent === 2) {
      if (!inClass) {
        report(rel, h.line, `'${h.name}' is a class section but no class section is open`);
        continue;
      }
      const at = CLASS_ORDER.indexOf(h.name);
      if (at < 0) continue; // already reported as an unknown name
      if (at < classPos) {
        report(
          rel,
          h.line,
          `'${h.name}' out of order in the class body — ${CLASS_ORDER.join(' -> ')}`,
        );
      }
      if (at === classPos) {
        report(rel, h.line, `a second '${h.name}' section in the same class body`);
      }
      classPos = Math.max(classPos, at);
      continue;
    }

    const isClass = h.name.startsWith('CLASS ');
    const key = isClass ? 'CLASS' : h.name;
    const at = order.indexOf(key);
    if (at < 0) {
      report(rel, h.line, `'${h.name}' does not belong in a ${kind} file — ${order.join(' -> ')}`);
      continue;
    }
    // Several classes may follow one another; any other section may appear once.
    if (!isClass) {
      if (seen.has(key)) {
        report(rel, h.line, `a second '${h.name}' section in one file`);
      }
      seen.add(key);
    }
    if (at < filePos) {
      report(rel, h.line, `'${h.name}' out of order — a ${kind} file runs ${order.join(' -> ')}`);
    }
    filePos = Math.max(filePos, at);
    inClass = isClass;
    if (isClass) classPos = -1;
  }
}

// ---------------------------------------------------------------------------

/**
 * With no arguments it checks the ratchet, which is what `npm run check:style` does and the
 * only mode the gate uses. Named files are checked instead — for a unit in progress, whose
 * files are not in the list yet, and for the planted violations that proved this script red.
 */
const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const explicit = targets.length > 0;

const units = explicit ? ['(explicit)'] : Object.keys(FINISHED);
const files = explicit ? targets : units.flatMap((u) => FINISHED[u]);

if (!explicit) {
  const duplicates = files.filter((f, i) => files.indexOf(f) !== i);
  for (const dup of new Set(duplicates)) {
    violations.push(`${dup}  listed as finished more than once`);
  }
}

let sections = 0;
let classes = 0;
for (const rel of files) {
  const headers = checkFile(rel, explicit ? path.resolve(process.cwd(), rel) : null);
  if (headers === null) continue;
  sections += headers.length;
  classes += headers.filter((h) => h.name.startsWith('CLASS ')).length;
}

if (violations.length > 0) {
  console.error(`\nSTYLE VIOLATIONS (${violations.length})\n`);
  for (const v of violations) console.error(`  ${v}\n`);
  console.error(
    'The skeleton is REFACTOR-PROMPT.md section 3. Generate header lines with ' +
      '`node "Claude outputs/refactor/header.mjs" "<SECTION NAME>" [indent]` rather than typing ' +
      'them, and keep the section order for the file kind.\n',
  );
  process.exit(1);
}

console.log(
  `style audit ok — ${files.length} finished file(s) over ${units.length} unit(s) ` +
    `(${units.join(', ')}), ${sections} section(s) and ${classes} class section(s), every header ` +
    `exactly ${WIDTH} characters, every region balanced and in order.`,
);
