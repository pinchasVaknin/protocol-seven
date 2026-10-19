# PROTOCOL SEVEN — Refactor Prompt (v1, 2026-10-06)

> **Kickoff — paste this to start a session:**
> `Run refactor unit <ID> following "Claude outputs/refactor/REFACTOR-PROMPT.md". Read the whole file first, then BACKLOG.md beside it.`
>
> One unit per session. Order: **A1 (pilot) → S0 → A2 … A24 → B1 … B8 → C1 … C24** (section 9).
>
> `BACKLOG.md` is the open side-task list. Step 0 reads it; Step 2 absorbs every task whose files
> are the unit's files (sections 7 and 8).

---

## 1. Role and goal

Act as an Expert Software Architect and Senior Developer.

Refactor **one unit** of PROTOCOL SEVEN (a TypeScript arena FPS: `src/shared` simulation, `src/server`
Node server, `src/client` browser client) to improve **readability and maintainability**, without
changing behaviour. The rules below are strict. Where a rule and the code disagree, the rule wins,
unless following it would change behaviour. Behaviour always wins (section 2).

Performance is a separate track that is not part of this work. Here the only performance rule is
**do no harm** (section 2, R7).

All reports to the user are in **Hebrew**; code identifiers, file paths and commands stay in English.
Never paste large code blocks into the chat. You edit the files directly (section 7).

---

## 2. Non-negotiable rules

**R1. No behaviour change.** Every observable output stays the same: simulation state bit for bit,
wire bytes, save data, what is rendered and heard, log lines the harnesses read. The oracles
(section 6) must pass byte-for-byte. If an oracle differs, you find and undo the cause. You never
adjust a test, an oracle or a baseline to match.

**R2. Public API frozen.** Do not rename, move, delete or change the signature of any export, and do
not move or rename files or folders. Do not add exports to existing files just to test something.
Adding a public member to an exported class or interface is an API change too: it is allowed only if
Step 2 lists it and the user approves it. Anything else that "should" change in the public surface
becomes a **side task** (section 8).

**R3. Scope fence.** Touch only the unit's files (section 9), their co-located `*.test.ts` files and
new test files beside them. New source files are allowed only in units marked **design** in section 9,
only in the same directory, and only when Step 2 lists them and the user approves. A change needed
anywhere else becomes a side task.

**R4. No new dependencies and no config changes.** Do not touch `package.json`, `tsconfig*`,
`vite*.config.ts`, `vitest.config.ts` or `.github/`. The one exception is unit S0, which adds the
`check:style` script.

**R5. Determinism (anything under `src/shared`, and the server).**
- Never reorder or regroup floating-point arithmetic. `a*b + a*c` does not become `a*(b+c)`.
  Summation order stays. Do not merge or split expressions in a way that changes evaluation order.
- Never change the order or count of `Rng` calls. Never swap `simSin`/`simCos` for `Math.*` or the
  other way round. Keep every `| 0`, `Math.fround`, `Math.round` and similar exactly as it is.
- Never change iteration order: array order, `Map`/`Set` insertion order, sort comparators.
- No `Math.random`, no wall clock. Time comes from `shared/core/Clock`.

**R6. Evaluation order.**
- `useDefineForClassFields` is on, so instance fields initialise **in declaration order** before the
  constructor body runs. **Keep the original relative order of all instance fields.** Static
  initialisers likewise keep their relative order.
- `readonly` fields assigned in the constructor stay assigned in the constructor. To shorten a
  constructor, extract `private createX(…)` methods that **return** values, and assign them in the
  constructor.
- Classes and module-level `const`/`let` are not hoisted. A value used at module load must stay
  below its declaration. When the skeleton would change load order, use the DERIVED CONSTANTS or
  MODULE INITIALISATION sections (section 3) rather than reorder.
- Multiple classes in one file keep their original order, because `extends` depends on it.

**R7. Performance: do no harm on hot paths.**
A hot path is:
- any method named `simulate`, `step`, `onTick` or `tick` (the `check:decorators` set);
- everything under `src/shared/net`, `src/shared/player`, `src/shared/combat` and `src/shared/ai`;
- per-tick server code: `src/server/net` and the step path of `src/server/instance`;
- per-frame client code: `update`, `render` and `draw` methods and what they call each frame.

On a hot path:
- Do not create new objects, arrays, closures, bound functions, spreads, array destructuring,
  `map/filter/reduce/slice/concat` results or per-call template strings.
- Extracted helpers take and return primitives, or write into an object that already exists.
- Keep call sites monomorphic. Do not introduce dispatch tables or class hierarchies inside
  per-entity per-tick loops. Keep the `switch` and extract each case body into a named function.
- Keep loop forms as they are. Do not add `try/catch`. Do not change object shapes: add fields only
  in declarations, in the same order.

**R8. Comments are kept.** About a third of this code is comments explaining *why*. Every comment
moves with the code it explains. A function's JSDoc stays on it. A comment explaining a block that
becomes a helper becomes that helper's JSDoc. Delete a comment only if the refactor made it false,
and list every deletion in the report. Do not add narration comments.

**R9. Out of bounds.** `src/client/ui/CreditsData.ts` is generated and never edited. The collision
box values in `src/shared/world/maps/props.ts` are generated ("paste them, do not edit them"). The
skeleton may wrap them, but no value changes. Test files get no skeleton. Everything listed in
section 10 is out of scope.

**R10. Decorators.** Keep `check:decorators` true: no decorator on `simulate/step/onTick/tick`, none
under `shared/net|player|combat|ai`, and never on a field.

---

## 3. The file skeleton (exact)

### 3.1 Header line + region

Every section is one header line, then a region line, the section's content, and an `//#endregion`:

```ts
// ========================================== IMPORTS =========================================== \\
//#region Imports
import { Rng } from './Rng';
//#endregion
```

- The header line is **exactly 100 characters including its indentation**. It starts with `// `,
  then `=` padding, a space, the NAME, a space, more padding, then ` \\`. With an odd remainder the
  extra `=` goes on the right.
- Generate headers with the tool; never type them by hand:
  `node "Claude outputs/refactor/header.mjs" "CLASS Tdm"` and, inside a class body,
  `node "Claude outputs/refactor/header.mjs" "PRIVATE METHODS" 2`.
- The `//#region` line follows the header immediately, with no blank line between them. The region
  name is the section name in Title Case: `Imports`, `Exported Functions`, `Class Tdm`.
- `//#endregion` sits on its own line right after the section's last line.
- No blank line directly after `//#region` or directly before `//#endregion`.
- Exactly one blank line between one section's `//#endregion` and the next header.
- Regions only at file level and class-body level. **Never inside a function.**
- Section names are UPPER CASE. The one exception is the class name in `CLASS <Name>`.

Ready-made header lines:

```text
// ========================================== IMPORTS =========================================== \\
// =========================================== TYPES ============================================ \\
// ========================================= CONSTANTS ========================================== \\
// ============================================ DATA ============================================ \\
// ===================================== DERIVED CONSTANTS ====================================== \\
// ===================================== EXPORTED FUNCTIONS ===================================== \\
// ====================================== INTERNAL HELPERS ====================================== \\
// =================================== MODULE INITIALISATION ==================================== \\
  // ========================================== STATIC ========================================== \\
  // ========================================== FIELDS ========================================== \\
  // ======================================= CONSTRUCTOR ======================================== \\
  // ====================================== PUBLIC METHODS ====================================== \\
  // ==================================== PROTECTED METHODS ===================================== \\
  // ===================================== PRIVATE METHODS ====================================== \\
```

### 3.2 File kinds and section order

Sections always appear in this order. **Empty sections are omitted.**

| Kind | How to tell | Sections |
|---|---|---|
| **Module file** | has at least one function (any form) or class | IMPORTS → TYPES → CONSTANTS → CLASS `<Name>` (one per class, original order) → DERIVED CONSTANTS → EXPORTED FUNCTIONS → INTERNAL HELPERS → MODULE INITIALISATION |
| **Data file** | no function and no class anywhere (object-literal methods and arrows count as functions) | IMPORTS → TYPES → DATA |
| **Test file** (`*.test.ts`) | — | no skeleton at all |

What goes where:
- **IMPORTS**: `import` statements and `export … from` re-exports.
- **TYPES**: `interface`, `type`, `enum` / `const enum`, `declare global`, `declare module`.
- **CONSTANTS**: module-level values (`const`/`let` that are not functions), including exported
  config objects and tables, in their original relative order. In a data file these go under DATA.
- **CLASS `<Name>`**: the class with its JSDoc and decorators.
- **DERIVED CONSTANTS**: only when needed for R6, i.e. values that read a class or a later
  declaration at load time.
- **EXPORTED FUNCTIONS**: exported `function` declarations and exported `const f = (…) => …`.
- **INTERNAL HELPERS**: non-exported functions. A non-exported `const f = (…) => {…}` that CONSTANTS
  calls at load time may be converted to `function f(…) {…}` (hoisted), but only if it uses neither
  `this` nor `arguments`. Exported ones keep their form (R2).
- **MODULE INITIALISATION**: top-level statements with side effects (registrations,
  `installClock(…)`, `game.start()`), in original order. If keeping load order requires it, the
  declarations interleaved with them move here too, still in original order. `src/client/main.ts`
  is the typical case.

A **file overview** comment (one that describes the file as a whole) goes at the very top, above
the IMPORTS header. A comment that documents the main class stays directly on the class.

### 3.3 Class body sections

Order: STATIC → FIELDS → CONSTRUCTOR → PUBLIC METHODS → PROTECTED METHODS → PRIVATE METHODS.
Headers are indented 2 spaces, and the line is still exactly 100 characters.

- **STATIC**: static fields, static blocks and static methods of any visibility, with static
  initialisers in original relative order.
- **FIELDS**: all instance fields, including `abstract`, `declare`, `#private` and index signatures,
  in **original relative order** (R6).
- **CONSTRUCTOR**: the constructor, with parameter properties as they are.
- **PUBLIC / PROTECTED / PRIVATE METHODS**: methods, getters/setters (a get/set pair stays adjacent)
  and abstract methods, by visibility. No modifier means public; `#method` counts as private.
  Overload signatures stay adjacent to their implementation.
- Within a methods section, use the step-down order: entry points first, then helpers in the order
  they are first called.
- Interfaces and object types get no internal sections.

### 3.4 A complete example (shape only)

```ts
/**
 * File overview, only if the comment describes the whole file.
 */

// ========================================== IMPORTS =========================================== \\
//#region Imports
import { GameMode, type ModeDeps } from './GameMode';
//#endregion

// =========================================== TYPES ============================================ \\
//#region Types
export interface TdmConfig {
  readonly scoreLimit: number;
}
//#endregion

// ========================================= CONSTANTS ========================================== \\
//#region Constants
const TDM_CONFIG: TdmConfig = { scoreLimit: 75 };
//#endregion

// ========================================= CLASS Tdm ========================================== \\
//#region Class Tdm
/** Team Deathmatch: first to 75 kills or ten minutes. */
export class Tdm extends GameMode {
  // ========================================== FIELDS ========================================== \\
  //#region Fields
  override readonly id = 'TDM';
  private kills = 0;
  //#endregion

  // ======================================= CONSTRUCTOR ======================================== \\
  //#region Constructor
  constructor(deps: ModeDeps) {
    super(deps);
  }
  //#endregion

  // ====================================== PUBLIC METHODS ====================================== \\
  //#region Public Methods
  override onKill(): void {
    this.kills = this.countKill(this.kills);
  }
  //#endregion

  // ===================================== PRIVATE METHODS ====================================== \\
  //#region Private Methods
  private countKill(kills: number): number {
    return kills + 1;
  }
  //#endregion
}
//#endregion
```

---

## 4. Code rules: SRP, naming, DRY, Open/Closed

Only these four principles apply. Do not bring in others.

### 4.1 SRP: small single-purpose functions
Limits per function, as measured by `node "Claude outputs/refactor/measure.mjs" <files>`:
- **≤ 50 lines of code** (comment lines and blank lines do not count);
- **cognitive complexity ≤ 15** (an approximation of SonarSource S3776);
- **nesting depth ≤ 3**.

Allowed exceptions, each listed in the report with its numbers and reason:
1. a function whose body is mostly a data literal (table rows, geometry boxes);
2. a hot-path `switch` whose cases are one-line calls to named functions (R7);
3. a wiring-only constructor: one assignment or call per line, no branching.

Guards against over-splitting:
- Every extracted helper must hide a real decision or a named step.
- No pass-through wrappers.
- No helper that needs more than 4 parameters; if it does, the split line is wrong.
- Extract into private methods of the same class first. Extract new classes or files only in
  **design** units (section 9), and only with approval.

### 4.2 Descriptive naming
- Functions are verb + object and say what they do: `applyFallDamage`, `findNearestCoverPoint`.
  `handle`, `process`, `do`, `manage` and bare `update` are only acceptable when qualified.
- Booleans start with `is`, `has`, `can` or `should`. Event handlers are `on<Event>`.
- Keep the project's established vocabulary: tick, rig, cmd, seat, snapshot, streak, ADS, mode.
- Rename **only non-exported identifiers**, and only if the name appears nowhere outside the unit.
  Before renaming, search `src/` (including the out-of-scope debug folders), `scripts/`,
  `public/verify/`, `probes/` and every `*.md`.
  TS-private members are reachable at runtime through `window.__p7` and the verification scripts,
  so a rename can break them silently. If the name is used elsewhere, keep it and open a side task.

### 4.3 DRY
- Merge duplicated logic **within the unit** into one helper.
- Do not merge code that only looks alike but changes for different reasons.
- Duplication that spans units becomes a side task.

### 4.4 Open/Closed through polymorphism
- **Type checks on concrete classes** (`instanceof SearchAndDestroy`, `mode.id === 'SND'`) repeated
  in more than one place:
  - If the behaviour belongs in the same partition, move it behind a member of the existing
    abstraction. Adding a member to an exported class counts as an API change under R2.
  - If the behaviour is client-only for a shared type (HUD, rendering), add a client-side registry
    in the unit's own files: an interface plus `Record<GameModeId, …>` (for example a
    `ModePresenter`). Shared code never imports client code or `three` (`check:boundaries`).
- **Long `switch` on a union, enum or message id** (one that pushes its function over a limit):
  - Replace it with a lookup table typed for exhaustiveness, for example
    `const DECODERS = { … } satisfies Record<MsgId, Decoder>`.
  - Do not create classes or inheritance for plain data.
  - Short switches stay.
- **Hot paths** (R7): no table dispatch per entity per tick. Keep the switch and extract the case
  bodies into named functions.
- Never introduce an interface or abstract class that has a single implementation.

---

## 5. Tests: pin first, then refactor

The setup:
- Vitest only, `environment: 'node'`, no jsdom, no coverage tool. The config admits vitest and
  nothing else.
- Tests are co-located as `X.test.ts` beside `X.ts`.
- Import `describe/it/expect` from `'vitest'` explicitly; there are no globals.
- A `shared/` test compiles without the DOM lib.
- A client test covers pure functions only.

Rules:
1. **Before changing code**, list every function or method the plan rewrites or splits, and find the
   tests that exercise it. Search the `*.test.ts` files; graphify helps.
2. For each one without coverage, write **characterization tests against the current code** that pin
   its observable behaviour through the **public surface**: exported functions, public methods,
   events published on the bus, state the public API exposes. Cover normal cases, edge cases, and
   every branch the refactor touches.
3. Run them on the **unmodified** code. They must pass before a single line of production code
   changes, and the report must say so.
4. Never make something public, and never export a helper, just to test it (R2). An extracted
   private helper is covered through the public function that calls it.
5. Simulation values use exact `toBe`/`toEqual`, which pins bit-exactness. Use fixed seeds. Use no
   wall clock.
6. Do not create `__snapshots__` files. `toMatchInlineSnapshot` is allowed for large structures.
7. Logic that is only reachable through DOM/WebGL/WebAudio:
   - extract its pure decision part into a function in the unit (good SRP anyway) and test that;
   - cover the rest with the browser check (section 6), and mark it in the coverage table as
     "browser-verified".
8. Existing tests: you may add cases, but you may never weaken or change existing assertions. If an
   existing assertion has to change, the refactor changed behaviour: stop.
9. If a characterization test exposes what looks like a bug, pin the current behaviour, add the
   comment `// Pins current behaviour; suspected bug: <side-task title>`, and open a side task.
   Never fix it in the refactor.

---

## 6. Verification

**Gate**: `npm run check`. It covers boundaries, 13 audits, all tests and typecheck for three
targets, and takes about 25 seconds. It must be green on the clean tree before you start (if not,
stop and report) and green at the end.

**Metrics**: `node "Claude outputs/refactor/measure.mjs" <unit files>`, before and after.

**Style**: once S0 is done, run `npm run check:style`; it is part of the gate from then on. Before
S0, check the skeleton by hand against section 3.

**Oracles**: snapshot before you touch any code, snapshot after, then compare. Write the snapshots
to the session scratchpad.

| Set | Command | What must hold |
|---|---|---|
| **SIM** | `node "Claude outputs/refactor/oracles.mjs" snapshot <dir>` | per-tick state hashes (3,600 ticks), `content`, `progression`, `readability`, `intro`, and one seeded bot match per mode (TDM, DOM, KC, SND, FFA) are **byte-identical**. About 9 seconds. |
| **NET** | add `--net` to the snapshot | `skirmishHarness --cycles 1 --drop-return 1`, run with `MATCH_ROUND_SECONDS=150` for that child alone (see below), ends in `FLOW CHECK PASSED.`: real sockets, warmup, vote, migration, a match that **ends**, a reconnect, the post-match hold and the final board. About 4.5 minutes. |
| **BROWSER** | Claude's browser pane (below) | no console errors; the unit's screens and flows look and behave as before |
| **LAYOUT** | `npm run layout` | prints `PASS — every surface fits its frame` (about 13 seconds) |

Then `node "Claude outputs/refactor/oracles.mjs" compare <before> <after>` must print
`PASS: every oracle matches.`

**Why the NET run sets `MATCH_ROUND_SECONDS`** (added 2026-10-19; B1 found it at Step 0, taking a
baseline on a clean tree). Without it this oracle was unsound in two separate ways, measured over
five runs:

| round | budget | drop fired | verdict | `NOT EXERCISED` / `NOT SAMPLED` |
|---|---|---|---|---|
| unset | 200 s | never | **FAILED** | 3 |
| unset | 200 s | never | **FAILED** | 3 |
| unset | 400 s | 128.3 s | passed | **3** |
| 90 | 200 s | 125.3 s | passed | 1 |
| 150 | 260 s | 99.0 s / 112.4 s | passed | 1 |

1. **It was flaky.** The same unset command failed twice and passed once. `--drop-return` waits
   for the dropped seat to have earned something (`hasSomethingToLose`), and that moment moves
   between runs; the harness budgets `cycleSeconds + (cfg.matchRoundSeconds || 90) + summaryHold
   + 20`, which unset is 200 s, leaving no room for a late one. A failure reads
   `FLOW CHECK FAILED … (F8)`.
2. **The match never ended**, because the round ran the mode's own full length — so the
   post-match hold, the return to the arena and the final scoreboard were reported
   `NOT EXERCISED` / `NOT SAMPLED` *even in the run that passed*. A passing verdict was never
   proof that those three ran.

The slack between the budget and the match timeline is a constant 20 s whatever the round, so a
longer round is purely more room for a late drop: 150 leaves about 177 s of live match against
117 s at 90, and it keeps every NET run from B1 onward comparable. `oracles.mjs` passes it to
**that child only**, on purpose: `src/server/Config.ts` reads the variable, so exporting it for
the whole snapshot would shorten the five seeded matches too and every SIM file would differ for
a reason that is not the unit's.

**If the NET run goes red on the final scoreboard**, with
`FLOW CHECK FAILED: N of 30 scoreboard row(s) on clients disagree with the server's final rows
(4.3)` and the `scoreboard:` line above it reporting a non-zero mismatch count: **that is not
your unit.** It is BACKLOG #42, an intermittent client/server divergence at match end that only
became visible when this oracle started sampling the board at all — one run in five on an
untouched tree (four clean, one with two rows off on each of three clients). Re-run the NET
snapshot once. If the second run is clean, use it and say in the report that you re-ran and why.
If it reproduces, **stop and report** rather than hunting it inside the unit: a unit's own change
cannot make three clients disagree with the server about a bot's kills, and #42 is where that
work belongs. Every other line of the flow check still has to be green.

One warning line is expected and stale: `background build: the return to the arena was NOT
EXERCISED — no match ended in this run ... Shorten MATCH_ROUND_SECONDS to reach it`. A match does
end now — the `post-match hold` line two below it reports the real hold and the migrations back —
and the variable it asks for is already set. It is BACKLOG #43; ignore it.

All SIM files were measured to be byte-identical across repeated runs on 2026-10-06, so any
difference is a finding.

**BROWSER procedure**:
1. Start the dev server with `preview_start` and the name `operator`.
2. The console handle is `window.__p7`: `__p7.game`, `__p7.profile`, `__p7.match()`. TS-private
   fields are reachable from JS.
3. Standard smoke flow, run **before** the change (screenshots) and **after**: splash → main menu →
   Play Solo → a TDM bot match → about 20 seconds of play → end the match with
   `__p7.game.world.match.mode.ticksLeft = 0` → end-of-match and XP summary → menu.
   `read_console_messages` with `onlyErrors` must be empty.
4. Pane limitations:
   - It throttles `requestAnimationFrame` when it is not in front. Batch a `screenshot` before a
     `javascript_tool` measurement.
   - It cannot hold pointer lock, so synthetic keys do not reach a match. To drive input, wrap
     `match.deps.input.sample`.
5. Step 2 adds **unit-specific checks**: the screens, sounds or effects the unit's code produces,
   and how to trigger each.
6. C13 (client net) also needs a local server: `preview_start` with `serve-local`, then load the
   client with `?server=127.0.0.1:8080`.
7. Stop every server you started before the turn ends.

---

## 7. Workflow per unit

**Step 0: Orient (no edits).**
1. Read this file.
2. **Read `BACKLOG.md` beside this file** (section 8). Its §1 is a lookup by unit: every task whose
   files are this unit's files is **in scope for this unit** and must be carried into Step 2. This
   is not optional and it is not a judgement call — a task left behind because the unit's own work
   looked tidier is how a file gets refactored twice.
3. Run `git status`. The tree must be clean. Commit on the current branch; never push.
4. Run `python -m graphify query "<the unit's topic>"`, as `CLAUDE.md` requires before grepping.
5. Read every file in the unit.
6. Run the gate, the metrics, and the oracle "before" snapshot for the unit's sets. For BROWSER,
   take the "before" screenshots.

**Step 1: Flaws (report in Hebrew).** Per file, concisely:
- functions over a limit, with numbers;
- duplicated logic;
- type-conditionals and long switches;
- naming problems;
- skeleton gaps;
- hot-path code;
- missing tests.

**Step 2: Plan (report in Hebrew), then STOP and wait for explicit approval.**
- The target skeleton for each file.
- Each function to split: old function → new helpers, one line each on purpose.
- Polymorphism and table changes.
- New public members or new files (design units only), each needing approval.
- The tests to pin, as a list.
- The oracle sets, and for BROWSER the unit-specific checks.
- **The backlog tasks this unit absorbs**, by number, each with what it changes and whether it
  changes behaviour — a `BACKLOG.md` task may, where its entry says so, which an ordinary unit may
  not. One that would change behaviour is listed separately and needs its own approval, because it
  means the oracles are expected to differ and must be re-baselined deliberately.
- Any backlog task whose files are this unit's but which you propose **not** to do here, with the
  reason. Leaving one is allowed; leaving one silently is not.
- The side tasks you will open.
- Risks.

**Step 3: Execute (only after approval).**
1. Write the characterization tests. Run them against the original code; they must be green.
2. Refactor in small steps. Run the unit's tests and `npm run typecheck` often.
3. Apply the skeleton (section 3).
4. Run the gate, the metrics, the oracle "after" snapshot and compare, and BROWSER/LAYOUT as
   required.
5. On any difference, find the cause and undo it. If you cannot resolve it, **stop and report**,
   and do not commit.

**Step 4: Commit and report, then STOP.** Do not start the next unit.
- **One commit for the unit**: code and tests together, created only after everything passes.
- Write the message to a file in the scratchpad and run `git commit -F <file>`. On this Windows
  machine a here-string passed after `-F -` is read as a pathspec.
- Subject format: `S: refactor <ID> (<scope>) — <one sentence on what became simpler>.`
- Body: per file, what changed; metrics before → after; tests added (count and names); oracle
  verdicts; side tasks opened; and the attribution line the session asks for.
- Never `--amend`, never `--no-verify`.
- The post-commit hook runs `graphify update`. Then run `python scripts/graph-relabel.py`.
- **Final report (Hebrew)**:
  - what changed;
  - the metrics table before/after: max LOC, max cognitive complexity, functions over a limit,
    file lines;
  - the **coverage table**: every touched exported function or public method, and every extracted
    helper → the test(s) that exercise it, or "browser-verified";
  - the oracle verdicts, quoted;
  - deleted comments, if any;
  - exceptions to the limits, with reasons;
  - side tasks;
  - anything that deviated from the approved plan.

---

## 8. Side tasks

Open a side task, and do not do the work in this unit, when:
- an export or file should be renamed or moved;
- a change is needed outside the unit;
- duplication spans units;
- a characterization test exposes a suspected bug;
- the layering is wrong (for example `shared/core/Events.ts` importing types from `ai`, `combat`,
  `player` and `weapons`, or `Combatant`/`BotTeam` living in `shared/ai` while all of `shared` uses
  them);
- something would need a new dependency or a config change.

**The list lives in `BACKLOG.md`, beside this file.** It is the programme's record of everything
found and deliberately not done, organised by dependency rather than by discovery order, and it is
read at Step 0 of every unit (section 7). Its own §7 carries the rules for working it: a task bound
to a unit is done in that unit and deleted in the same commit; an unbound task gets its own
session, which is not a refactor unit and is not fenced by R3.

How to open one:
- Use the `spawn_task` tool (the side-task chip in Claude desktop). Give it an imperative title and
  a self-contained prompt with file paths and the reason.
- If the tool is unavailable, describe the task in the report.
- **Either way, add it to `BACKLOG.md`** in the same commit as the unit, with its number, its origin
  unit, its files, and — the part that is expensive to reconstruct later — *why the unit could not
  do it*. A task recorded without that reason gets re-litigated from scratch by whoever picks it up.
- Either way, list it in the commit body, so git keeps the record.

---

## 9. Units

The **Tests** column counts files that already have a co-located `X.test.ts`. The oracle sets are
defined in section 6.

| ID | Files (under `src/`) | Lines | Tests | Oracles |
|---|---|---|---|---|
| A1 | `shared/core/` Clock, Decorators, Disposable, EventBus, Events, GameStates, InputCommand, Keybinds, Log, Loop, MathUtil, ObjectPool, Rng, SimMath, StateHash | 2.2K | 7/15 | SIM |
| S0 | new: `scripts/check-style.mjs` + `check:style` npm script (spec below) | — | — | gate |
| A2 | `shared/cheats/` Cheats; `shared/ui/` Capabilities, Crosshair, HudSurfaces, ScreenProjection, SkipGesture, TeamColour | 1.6K | 2/7 | SIM |
| A3a | `shared/world/maps/` depot, dunes, foundry, greybox | 2.7K | 0/4 | SIM |
| A3b | `shared/world/maps/` albedo, build, cover, materials, props, types | 1.7K | 1/6 | SIM |
| A4 | `shared/world/` Geometry, CollisionWorld, ColliderSet, SpatialHash, Raycaster, MapLoader | 1.7K | 0/6 | SIM |
| A5 | `shared/world/` NavBake, NavGrid, Navmesh, SkyProfile, MapLuminance, SupplySystem | 1.7K | 1/6 | SIM |
| A6 | `shared/player/` Health, Mantle, Movement, MovementConfig, PlayerController, PlayerState, Slide, Stance | 2.5K | 1/8 | SIM |
| A7 | `shared/weapons/` AnyWeapon, WeaponBase, WeaponSystem, Ballistics, Recoil, Melee, FlameCone, Scope | 2.4K | 2/8 | SIM |
| A8 | `shared/weapons/` WeaponDefs, WeaponTuning, Attachments, Inventory, ViewmodelConfig; `shared/weapons/defs/` assaultRifles, lmgs, pistols, shotguns, smgs, snipers | 3.3K | 1/11 | SIM |
| A9 | `shared/combat/` BurnSystem, DamageSystem, HitboxRig, Hostility, Killfeed, LocalIdentity, ScoreSystem, ShotAccounting | 2.4K | 1/8 | SIM |
| A10 | `shared/equipment/` BotThrower, EquipmentConfig, EquipmentDefs, EquipmentSystem, FlashField, LifeStockAudit, Projectile, SmokeField, ThrowController | 2.5K | 1/9 | SIM |
| A11 | `shared/ai/` AiScheduler, BotBlackboard, BotVisualState, CombatBehaviour, Combatant, Cover, Gait, ObjectiveIntent, Pathing, Perception, PlayerCombatant, WeaponProfile | 2.5K | 0/12 | SIM |
| A12 | `shared/ai/` BotBrain, Bot, BotStates | 1.6K | 0/3 | SIM |
| A13 | `shared/ai/` BotDirector, SpawnSelector, RosterDeal, DifficultyTiers, BotArsenal | 2.3K | 1/5 | SIM |
| A14 | `shared/modes/` GameMode, Tdm, FreeForAll, Range, KillConfirmed, Domination, ObjectiveZone, MatchOutcome, SpectatorTarget | 2.2K | 2/9 | SIM |
| A15 | `shared/modes/` SearchAndDestroy, MatchFlow, ModeRegistry | 2.1K | 1/3 | SIM |
| A16 | `shared/streaks/` KillstreakBase, CarePackage, CarriedWeapon, ChopperGunner, CounterUav, MortarStrike, SentryGun, Uav, StreakWeapons | 2.0K | 1/9 | SIM |
| A17 | `shared/streaks/` StreakSystem, StreakLedger, StreakDefs, StreakPresentation | 1.9K | 1/4 | SIM |
| A18 | `shared/perks/` FieldUpgrade, PerkDefs, PerkState, PerksRuntime; `shared/meta/` Camos, Challenges, ChallengeTracker, FieldUpgrades, Levels, XpRules, XpSimulator, Skins | 2.3K | 2/12 | SIM |
| A19 | `shared/meta/` SaveData, Unlocks, LoadoutRules, Loadouts, MatchLedger, MatchProgression, ProgressionStore | 2.6K | 4/7 | SIM |
| A20 | `shared/net/` Wire, Protocol, Snapshot, UrlFlags, DisplayText | 2.0K | 4/5 | SIM + NET |
| A21 | `shared/net/` Messages — **design** | 2.0K | 1/1 | SIM + NET |
| A22 | `shared/net/` NetClient — **design** | 1.3K | 0/1 | SIM + NET |
| A23 | `shared/net/` Prediction, Interpolation, ClockSync, NetSim, Transport, Skirmish | 2.3K | 3/6 | SIM + NET |
| A24 | `shared/cinematic/` IntroPlan | 1.0K | 1/1 | SIM |
| B1 | `server/net/` Validation, InputBuffer, ClientAddress, ReconnectRegistry, Rewind, RigHistory | 1.2K | 2/6 | SIM + NET |
| B2 | `server/net/` Relevance, SeatView, SeatEvents, EventCollector, SnapshotEncoder, VisibilityAudit | 1.6K | 5/6 | SIM + NET |
| B3 | `server/net/` Session, WsServer | 1.7K | 2/2 | SIM + NET |
| B4 | `server/instance/` InstanceClock, LiveMatch, VoteCycle, WarmupMatch | 1.1K | 0/4 | SIM + NET |
| B5 | `server/instance/` MatchInstance — **design** | 1.2K | 0/1 | SIM + NET |
| B6 | `server/` Match — **design** | 1.7K | 0/1 | SIM + NET |
| B7 | `server/` Server — **design** | 1.5K | 0/1 | SIM + NET |
| B8 | `server/` Config, Loop, MapBakery, MatchAllocator, Migration, NetPlayer, NodeClock, Router, Spectator, log, serve | 2.2K | 2/11 | SIM + NET |
| C1 | `client/input/` DeviceCapabilities, Input; `client/player/` CameraConfig, CameraShake, Viewmodel; `client/perks/` PerksRenderer; `client/cinematic/` IntroCamera | 1.6K | 0/7 | BROWSER |
| C2 | `client/engine/` Renderer, FrameLoop, CameraRig, BrowserClock, GpuWarmup, MotionBlur | 1.5K | 1/6 | BROWSER |
| C3 | `client/engine/` AudioGraph, AudioMix, AudioSpecs, ProceduralAudio | 1.8K | 0/4 | BROWSER |
| C4 | `client/engine/` Fx, FxAssets, FlameFx, Decals, ProceduralTextures | 1.9K | 0/5 | BROWSER |
| C5 | `client/characters/` ActorAvatar, AnimationSelector, AnimationVariant, CharacterAnimator, CharacterAssetImport, CharacterAssetRepository, CharacterAssetService, CharacterAvatar, CharacterAvatarFactory, CharacterAvatarProvider, CharacterCatalog, CharacterSkin, RandomCharacterSelector, ThrowLayer, WeaponSupportHandConstraint | 2.9K | 1/15 | BROWSER |
| C6 | `client/weapons/` ViewmodelAnim — **design** | 1.2K | 1/1 | BROWSER |
| C7 | `client/weapons/` WeaponMesh, WeaponMeshParts — **design** | 1.8K | 0/2 | BROWSER |
| C8 | `client/weapons/` ViewmodelHands, HandPoses, KnifeMesh, GrenadeMesh, ShieldMesh, WeaponSilhouette | 1.8K | 2/6 | BROWSER |
| C9 | `client/weapons/` WeaponAssetService, WeaponAssetCatalog, WeaponModelSpecs, WeaponAudio | 1.6K | 0/4 | BROWSER |
| C10 | `client/world/` MapBuildQueue, MapMesher, MapRender, MenuBackdrop, MenuSkirmish, Particulate, PropModels, SkyDome | 2.4K | 0/8 | BROWSER |
| C11 | `client/ai/` ActorIndicator, BotMesh, BotRenderer; `client/combat/` TargetDummy, TargetRange | 2.4K | 0/5 | BROWSER |
| C12 | `client/equipment/` EquipmentAudio, EquipmentFx; `client/streaks/` ChopperCamera, ClientStreakPresentation, ReplicatedStreaks, SentryModel, StreakAudio, StreakMeshes, StreakRenderer; `client/meta/` CamoTextures, Profile, SaveStore | 2.8K | 0/12 | BROWSER |
| C13 | `client/net/` BrowserLink, Handshake, JoinOptions, NetSession, RemoteActor, WakeWait | 1.9K | 2/6 | BROWSER (local server) |
| C14 | `client/ui/` Hud, HudBanner, HudStreaks, HudTactical | 2.0K | 0/4 | BROWSER + LAYOUT |
| C15 | `client/ui/` MatchHud, Killfeed, Scoreboard, Minimap, MortarOverlay, BearingIndicator | 1.8K | 0/6 | BROWSER + LAYOUT |
| C16 | `client/ui/` LoadoutEditor, LoadoutStats, QuickLoadout | 1.9K | 0/3 | BROWSER + LAYOUT |
| C17 | `client/ui/` Settings, Palette, PauseMenu | 1.5K | 0/3 | BROWSER + LAYOUT |
| C18 | `client/ui/` EndOfMatch, XpSummary, ProfilePanel, PlayerCard | 2.0K | 0/4 | BROWSER + LAYOUT |
| C19 | `client/ui/` Menus, PlaySolo, Splash, SpaceSkip, LoadingScreen, VoteOverlay, Frame, ScreenChrome | 2.3K | 1/8 | BROWSER + LAYOUT |
| C20 | `client/ui/` CharacterStage, WeaponPreview, Lineup, Emblem, CategoryIcons, WeaponIcons, FpsCounter | 1.3K | 1/7 | BROWSER + LAYOUT |
| C21 | `client/` MatchEquipment, MatchFeedback, MatchMeta, MatchObjectives, GameLoadout, GameScreens, main | 2.2K | 0/7 | BROWSER |
| C22 | `client/` MatchWorld | 0.8K | 0/1 | BROWSER |
| C23 | `client/` Game — **design, split into C23a/b in Step 2** | 3.1K | 0/1 | BROWSER |
| C24 | `client/` ClientMatch — **design, split into C24a/b/c in Step 2** | 3.4K | 0/1 | BROWSER |

**Design units** (A21, A22, B5, B6, B7, C6, C7, C23, C24): Step 2 proposes the decomposition into
collaborators. Name each new file and class, in the same directory, with a one-line responsibility,
and say which of today's methods move there. For C23 and C24, Step 2 also splits the work into
sub-units, and each sub-unit gets its own approval, commit and report.

**Unit notes:**
- **A1 (pilot):** `SimMath` and `Rng` are the determinism core, so the hashes must stay
  byte-identical. `Events.ts` imports types upward; that is a side task, not a move. After A1 the
  user may amend this prompt before S0.
- **A3a/A3b:** the map files contain helper functions, so they are module files, not data files.
  The `props.ts` box values are never edited (R9).
- **A8:** `shared/weapons/defs/*` are data files (IMPORTS / TYPES / DATA).
- **A11:** `Combatant`/`BotTeam` stay where they are (side task).
- **A14/A15:** these are the `GameMode` subclasses. The `instanceof SearchAndDestroy/Domination/…`
  checks live in C21, C24, B5 and B6 and are handled there (section 4.4).
- **A17:** `StreakSystem` has 13 `instanceof` checks, a candidate for section 4.4.
- **A19:** `SaveData.normaliseSave` migrates player saves. Pin it with old save shapes.
- **A20–A23:** the wire format must stay byte-compatible. `decodeHeader` becomes a decoder table;
  it runs per message, not per entity, so a table is allowed there.
- **B2:** the anti-wallhack visibility code changed recently (commits `0822e4a`…`294bc37`). It has
  5 test files. Extra care.
- **C17:** `CreditsData.ts` is excluded (generated).
- **C12, C21, C24, B5, B6:** the concrete-type `instanceof` sites. Use a registry inside the unit
  (section 4.4).

**S0: `check:style` spec** (written right after the pilot, so it encodes what A1 settled):
- Hand-written `scripts/check-style.mjs`, in the style of the existing `check-*.mjs` scripts, plus
  a `check:style` npm script that joins the `check` chain.
- It enforces only an explicit list of finished files (a ratchet). Every unit's commit appends its
  files to that list.
- What it checks:
  - header lines: exact regex, exactly 100 characters ignoring `\r`, known section names, order per
    file kind;
  - each header is immediately followed by its `//#region <Title Case>`;
  - regions are balanced and never inside a function;
  - blank-line rules;
  - test files are skipped.
- Function limits may reuse `measure.mjs`. Whether to import `rolldown/parseAst`, a transitive
  dependency of Vite, is decided in S0's Step 2.
- It must be **proved red on planted violations** before it joins the chain, as `check-plan` and
  `check-decorators` were.

---

## 10. Out of scope (do not touch)

- `src/client/debug/`, `src/client/probes/`, `src/server/debug/`, `src/shared/debug/`
- `src/server/` main, content, hashRun, intro, progression, readability, netHarness,
  skirmishHarness. These are the instruments and oracles themselves.
- `scripts/` (except S0's new file), `public/`, `probes/`, `docs/`, the root `*.md` files,
  all config.
- `src/client/ui/CreditsData.ts` (generated).

---

## 11. Environment notes

- **Windows**: PowerShell and Git Bash are both available. Commit with `-F <file>`.
- **Graphify** (`CLAUDE.md`): `python -m graphify query|path|explain` before grepping;
  `graphify-out/` is gitignored.
- **Worktree session**: before trusting the gate, run `git lfs pull` and `node scripts/credits.mjs`.
  Otherwise about 32 audits fail on LFS pointers and CRLF. Graphify is not available in a worktree.
- **Background processes**: stop every dev server, harness and background task you started before
  the turn ends (`preview_stop` / `TaskStop`). The user shares port 5173.
- **Tools in this folder**:
  - `measure.mjs`: function metrics;
  - `oracles.mjs`: snapshot and compare;
  - `header.mjs`: exact header lines.

  All three are run from the repo root and need no install.

## 12. Definition of done (per unit)

- [ ] Gate green; `check:style` green (after S0)
- [ ] Oracles `compare` → `PASS: every oracle matches.`; BROWSER/LAYOUT as required, with no
      console errors
- [ ] Every function in the unit is within the limits, or listed as an exception with a reason
- [ ] Skeleton exact in every non-test file of the unit
- [ ] Characterization tests written first and green on the original code; coverage table complete
- [ ] No export, file or folder renamed or moved; no file outside the unit touched
- [ ] Comments preserved; deletions listed
- [ ] `BACKLOG.md` read at Step 0; every task bound to this unit either absorbed, or declined in
      Step 2 with a reason; absorbed entries deleted from it in this unit's commit
- [ ] One commit; side tasks opened, added to `BACKLOG.md` and listed; report delivered in Hebrew;
      then STOP
