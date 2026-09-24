/**
 * The unlock audit, as a check that can fail (M11 Gate B, playtest round 4, B7).
 *
 * B7 was reported as *"the gas grenade shows no unlock level in the picker"*, and the obvious
 * reading — a table with a missing row — was wrong. `EQUIPMENT_UNLOCK_LEVEL.smoke` has said 3
 * since M6. What was missing was the other half of a gate: **something that turns the level
 * into the sentence the player reads.** `UnlockState` had `weaponRequirement` and
 * `attachmentRequirement` and nothing for equipment, so `LoadoutEditor` passed the literal
 * string `'LOCKED'` and the number never reached the screen. Semtex (8) and the claymore (16)
 * had the same hole; smoke is simply the first one a low-level player meets.
 *
 * So this checks both halves, because either alone is a silent failure:
 *
 *   1. **Every gated item has an unlock record.** A weapon, perk or field upgrade declares
 *      `unlockLevel` on its def; equipment has a row in `EQUIPMENT_UNLOCK_LEVEL`; a camo has a
 *      `requirement` line. A missing one is not a crash — `Profile` would gate it at level one
 *      or draw a blank chip — which is why it needs a check rather than a test.
 *   2. **Every gated category has a requirement accessor, and the editor asks for it.**
 *      This is the half that was actually broken, and no amount of table-checking would have
 *      found it. The rule is: for each category, `UnlockState` exports `<x>Requirement` and
 *      `LoadoutEditor` calls it. A picker that goes back to a hand-written literal fails here.
 *
 * ## What it cannot see
 *
 * It reads sources with regular expressions, like `check-cosmetics.mjs`, so it knows that the
 * editor *names* `unlocks.equipmentRequirement` and not that the string reaches a DOM node.
 * That is a real limit and it is the same one the cosmetic audit has: the check is a tripwire
 * across the specific way this broke, not a proof that the screen is right. What is on the
 * screen is a browser claim and belongs on the "needs a browser" list.
 */

import { readFileSync } from 'node:fs';

const UNLOCKS = 'src/shared/meta/Unlocks.ts';
const EDITOR = 'src/client/ui/LoadoutEditor.ts';

/**
 * The gated categories. Each names where its ids come from, where its unlock record lives, and
 * the accessor the picker has to ask.
 */
const CATEGORIES = [
  {
    name: 'weapons',
    // Six files, one per class. The catalogue in WeaponDefs.ts only spreads them.
    sources: [
      'src/shared/weapons/defs/assaultRifles.ts',
      'src/shared/weapons/defs/smgs.ts',
      'src/shared/weapons/defs/shotguns.ts',
      'src/shared/weapons/defs/lmgs.ts',
      'src/shared/weapons/defs/snipers.ts',
      'src/shared/weapons/defs/pistols.ts',
    ],
  },
  { name: 'perks', sources: ['src/shared/perks/PerkDefs.ts'] },
  { name: 'field upgrades', sources: ['src/shared/meta/FieldUpgrades.ts'] },
];

/**
 * `id: 'ar_carbine',` and `unlockLevel: 6,` as property lines, at whatever depth the file
 * nests them. Anchored to the whole line so the interface declarations above
 * (`readonly unlockLevel: number;`) and any prose in a comment fall out.
 */
const ID_LINE = /^\s+id: '([a-z0-9_]+)',$/gm;
const LEVEL_LINE = /^\s+unlockLevel: \d+,$/gm;

function fail(lines) {
  console.error('unlock audit FAILED (S6.2, playtest round 4 B7):');
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(1);
}

const problems = [];
const counted = [];

// -- 1a. one unlock level per def, in the categories that carry their own ----------------

for (const category of CATEGORIES) {
  let ids = 0;
  for (const source of category.sources) {
    const src = readFileSync(source, 'utf8');
    const found = [...src.matchAll(ID_LINE)].map((m) => m[1]);
    const levels = [...src.matchAll(LEVEL_LINE)].length;
    if (found.length === 0) {
      problems.push(`found no ids in ${source} — this check has stopped checking it.`);
      continue;
    }
    if (levels !== found.length) {
      problems.push(
        `${source} declares ${found.length} ${category.name} (${found.join(', ')}) and ` +
          `${levels} unlockLevel entries. Every gated item needs one, or it gates at whatever ` +
          'the reader defaults to and its picker chip says nothing.',
      );
    }
    ids += found.length;
  }
  if (ids > 0) counted.push(`${ids} ${category.name}`);
}

// -- 1b. equipment, whose level lives in a side table rather than on the def --------------

const equipmentSrc = readFileSync('src/shared/equipment/EquipmentDefs.ts', 'utf8');
const equipmentUnion = /export type EquipmentId =([^;]+);/.exec(equipmentSrc);
if (equipmentUnion === null) {
  problems.push('could not read EquipmentId — this check has stopped checking equipment.');
} else {
  const ids = [...equipmentUnion[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const unlocksSrc = readFileSync(UNLOCKS, 'utf8');
  const table = /EQUIPMENT_UNLOCK_LEVEL: Readonly<Record<EquipmentId, number>> = \{([^}]*)\}/.exec(
    unlocksSrc,
  );
  if (table === null) {
    problems.push(`could not read EQUIPMENT_UNLOCK_LEVEL in ${UNLOCKS}.`);
  } else {
    const rows = [...table[1].matchAll(/^\s{2}([a-z0-9_]+):\s*\d+,$/gm)].map((m) => m[1]);
    for (const id of ids) {
      if (!rows.includes(id)) {
        problems.push(
          `equipment "${id}" has no row in EQUIPMENT_UNLOCK_LEVEL. It would be gated at ` +
            'whatever the reader defaults to and its picker chip would say nothing. This is ' +
            'exactly B7, one type error away from being silent.',
        );
      }
    }
    for (const row of rows) {
      if (!ids.includes(row)) {
        problems.push(
          `EQUIPMENT_UNLOCK_LEVEL names "${row}", which is not an EquipmentId. Remove it, so ` +
            'the table keeps describing the code rather than its history.',
        );
      }
    }
    counted.push(`${ids.length} equipment`);
  }
}

// -- 1c. camos, gated by a challenge rather than by a level -------------------------------

const camoSrc = readFileSync('src/shared/meta/Camos.ts', 'utf8');
const camoIds = [...camoSrc.matchAll(ID_LINE)].map((m) => m[1]);
const camoRequirements = [...camoSrc.matchAll(/^\s+requirement: '[^']+',$/gm)].length;
if (camoIds.length === 0) {
  problems.push('found no camos — this check has stopped checking them.');
} else if (camoRequirements !== camoIds.length) {
  problems.push(
    `Camos.ts declares ${camoIds.length} camos and ${camoRequirements} requirement lines. A ` +
      'camo with no requirement draws an empty chip, which reads as "locked, for no reason".',
  );
} else {
  counted.push(`${camoIds.length} camos`);
}

// -- 2. every category's requirement reaches the picker ----------------------------------

const unlocksSrc = readFileSync(UNLOCKS, 'utf8');
const editorSrc = readFileSync(EDITOR, 'utf8');

/** Category -> the accessor that turns its gate into the line the player reads. */
const ACCESSORS = [
  'weaponRequirement',
  'attachmentRequirement',
  'equipmentRequirement',
  'perkRequirement',
  'fieldUpgradeRequirement',
  'camoRequirement',
];

for (const accessor of ACCESSORS) {
  if (!unlocksSrc.includes(`  ${accessor}(`)) {
    problems.push(
      `UnlockState has no ${accessor}. Every gated category needs one, or its picker will ` +
        'hand-write a chip and the level the gate enforces will never reach the screen — ' +
        'which is what B7 was.',
    );
  }
  if (!editorSrc.includes(`unlocks.${accessor}(`)) {
    problems.push(
      `${EDITOR} does not call unlocks.${accessor}. A locked row is drawing something this ` +
        'file made up rather than the requirement the gate is actually testing.',
    );
  }
}

// -- 3. and every requirement says where the player *is*, not only where the bar is -------

/**
 * The human's §6 (2026-09-24), as a rule rather than as a habit.
 *
 * B7 was a chip that printed nothing; this is the other half of the same mistake — a chip
 * that prints the target alone. `LEVEL 16` and `12 MORE KILLS` are both answers to *what
 * does it cost*, and neither is an answer to *how far am I*, which is the question somebody
 * looking at a locked row is actually asking. `12 MORE KILLS` is the worse of the two,
 * because a distance reads identically at 0 of 12 and at 88 of 100.
 *
 * So every accessor has to route its line through one of the two formatters, which are the
 * only two things in the file that know the `have / need` shape. A regex over a body, like
 * the rest of this script: it knows that the accessor *names* the formatter, not that the
 * string reaches a DOM node — that half is `npm run layout` and a pair of eyes.
 */
const PROGRESS_FORMATTERS = ['progressLabel', 'levelProgressLabel'];

for (const formatter of PROGRESS_FORMATTERS) {
  const def = new RegExp(`function ${formatter}\\([^)]*\\): string \\{[^}]*\\$\\{[^}]*\\} / \\$`);
  if (!def.test(unlocksSrc)) {
    problems.push(
      `${UNLOCKS}'s ${formatter} no longer prints "have / need". It is the shape every ` +
        'locked chip is held to, and the challenge list already uses it.',
    );
  }
}

for (const accessor of ACCESSORS) {
  const at = unlocksSrc.indexOf(`\n  ${accessor}(`);
  if (at < 0) continue; // Already reported above as missing.
  const end = unlocksSrc.indexOf('\n  }\n', at);
  const body = end < 0 ? unlocksSrc.slice(at) : unlocksSrc.slice(at, end);
  if (PROGRESS_FORMATTERS.some((formatter) => body.includes(`${formatter}(`))) continue;
  problems.push(
    `UnlockState.${accessor} builds its own line instead of calling ${PROGRESS_FORMATTERS.join(' or ')}. ` +
      'A locked chip names the target and the progress towards it — "18 / 25 KILLS", ' +
      '"LEVEL 9 / 16" — so the player can see the gate moving.',
  );
}

// A literal requirement in the editor is the exact shape B7 shipped as.
for (const match of editorSrc.matchAll(/^\s*\(\) => '([A-Z][A-Z ]+)',$/gm)) {
  if (match[1] === 'ON ANOTHER KEY') continue; // Not a gate: a streak already on another key.
  problems.push(
    `${EDITOR} passes the literal requirement "${match[1]}". Requirements come from ` +
      'UnlockState so the chip and the gate cannot say different things.',
  );
}

if (problems.length > 0) fail(problems);

console.log(
  `unlock audit ok — ${counted.join(', ')}, every one with an unlock record, and all ` +
    `${ACCESSORS.length} requirement accessors reach the picker, each printing progress.`,
);
