#!/usr/bin/env node
/**
 * Behaviour oracles for the refactor (REFACTOR-PROMPT.md, section 6).
 *
 * Run from the repo root:
 *   node "Claude outputs/refactor/oracles.mjs" snapshot <dir> [--net]
 *   node "Claude outputs/refactor/oracles.mjs" compare <beforeDir> <afterDir>
 *
 * `snapshot` builds the server bundle and records, into <dir>:
 *   hashes.json          per-tick state hashes of the fixed determinism scenario (hashRun)
 *   content.txt          every mode's columns and win condition, every map's spawns (content)
 *   progression.txt      the XP-bar stepping regression (progression)
 *   readability.txt      crosshair gaps, team-colour invariant, ground luminance (readability)
 *   intro.txt            the intro cinematic plan (intro)
 *   match-<MODE>.jsonl   one seeded headless match per mode (main.js --seed 99 --asap --json),
 *                        with the wall-clock fields t, heapMb, simMsMean and pid removed
 *   skirmish.txt         only with --net: the socket-level flow check (about 3-7 minutes),
 *                        run with MATCH_ROUND_SECONDS set for that child alone — see
 *                        NET_ROUND_SECONDS below for why it has to be, and why only there
 *   manifest.json        exit code of every step
 *
 * Every file except skirmish.txt is byte-identical between two runs on one tree (measured
 * 2026-10-06). `compare` therefore demands byte equality for them, the hash differ's verdict
 * for hashes.json, and "FLOW CHECK PASSED." for skirmish. Exit 0 = PASS, 1 = FAIL, 2 = usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// ==================== CONSTANTS ==================== //

const MODES = ['TDM', 'DOM', 'KC', 'SND', 'FFA'];
/**
 * The live match's round length for the NET step, seconds (BACKLOG #40, 2026-10-19).
 *
 * Without it this step was **unsound**, which B1 found at Step 0 by taking a baseline on a clean
 * tree. The harness budgets its own run as `cycleSeconds + (cfg.matchRoundSeconds || 90) +
 * summaryHold + 20`; with the variable unset that is 200 s against a match running the mode's
 * own full round, so the match never ends inside the run. Measured on five runs:
 *
 *   round    budget   drop fired   verdict   NOT EXERCISED / SAMPLED
 *   unset    200 s    never        FAILED    3
 *   unset    200 s    never        FAILED    3
 *   unset    400 s    128.3 s      passed    3
 *   90       200 s    125.3 s      passed    1
 *   150      260 s    99.0/112.4s  passed    1
 *
 * Two separate things, and the table is the evidence for both. **The flow check is flaky with
 * the variable unset** — the same command failed twice and passed once — because the drop waits
 * for the dropped seat to have earned something (`hasSomethingToLose`) and that moment moves
 * between runs. And **the match only ends when the round is set**, which is what the post-match
 * hold, the return to the arena and the final scoreboard need: the 400 s run passed its flow
 * check and still reported all three NOT EXERCISED, so a passing verdict was never proof that
 * they ran.
 *
 * 150 rather than 90 because the slack between the budget and the match timeline is a constant
 * 20 s whichever value is chosen, so a longer round is purely more room for a late drop: the
 * latest observed is 128 s and 150 leaves about 177 s of live match for it, against 117 s at 90.
 * It also keeps every NET run from B1 onward comparable, since B1's own baseline used it. The
 * cost is one minute per snapshot.
 *
 * Passed to **that child only**. `src/server/Config.ts` reads this variable, so exporting it for
 * the whole snapshot would shorten the five seeded matches as well and every SIM file would
 * differ for a reason that has nothing to do with the unit under test.
 */
const NET_ROUND_SECONDS = 150;
const MATCH_SEED = '99';
const WALL_CLOCK_KEYS = new Set(['t', 'heapMb', 'simMsMean', 'pid']);
const TEXT_ORACLES = ['content', 'progression', 'readability', 'intro'];

// ==================== HELPERS ==================== //

function fail(message) {
  console.error(message);
  process.exit(2);
}

function assertRepoRoot() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath) || JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name !== 'protocol-seven') {
    fail('run this from the PROTOCOL_SEVEN repo root');
  }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function node(args) {
  return run(process.execPath, args);
}

function stripWallClock(value) {
  if (Array.isArray(value)) return value.map(stripWallClock);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !WALL_CLOCK_KEYS.has(key))
        .map(([key, v]) => [key, stripWallClock(v)]),
    );
  }
  return value;
}

function normaliseJsonLines(text) {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.stringify(stripWallClock(JSON.parse(line)));
      } catch {
        return line;
      }
    })
    .join('\n') + '\n';
}

function firstDifference(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, before: la[i] ?? '<missing>', after: lb[i] ?? '<missing>' };
  }
  return null;
}

// ==================== SNAPSHOT ==================== //

function snapshot(dir, withNet) {
  assertRepoRoot();
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { taken: new Date().toISOString(), head: run('git', ['rev-parse', 'HEAD']).stdout.trim(), dirty: run('git', ['status', '--porcelain']).stdout.trim().length > 0, steps: {} };

  console.log('building the server bundle ...');
  const build = run('npm run build:server', [], { shell: true });
  manifest.steps.build = build.code;
  if (build.code !== 0) {
    fs.writeFileSync(path.join(dir, 'build.err'), build.stdout + build.stderr);
    fail(`build:server failed (exit ${build.code}); see ${path.join(dir, 'build.err')}`);
  }

  console.log('hashes ...');
  const hashes = node(['dist-server/hashRun.js', '--out', path.join(dir, 'hashes.json')]);
  manifest.steps.hashes = hashes.code;

  for (const name of TEXT_ORACLES) {
    console.log(`${name} ...`);
    const r = node([`dist-server/${name}.js`]);
    manifest.steps[name] = r.code;
    fs.writeFileSync(path.join(dir, `${name}.txt`), r.stdout + (r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''));
  }

  for (const mode of MODES) {
    console.log(`match ${mode} ...`);
    const r = node(['dist-server/main.js', '--seed', MATCH_SEED, '--mode', mode, '--matches', '1', '--asap', '--json']);
    manifest.steps[`match-${mode}`] = r.code;
    fs.writeFileSync(path.join(dir, `match-${mode}.jsonl`), normaliseJsonLines(r.stdout));
  }

  if (withNet) {
    console.log('skirmish (socket-level flow check, a few minutes) ...');
    const r = run(
      process.execPath,
      ['--expose-gc', 'dist-server/skirmishHarness.js', '--cycles', '1', '--drop-return', '1'],
      { env: { ...process.env, MATCH_ROUND_SECONDS: String(NET_ROUND_SECONDS) } },
    );
    manifest.steps.skirmish = r.code;
    fs.writeFileSync(path.join(dir, 'skirmish.txt'), r.stdout + r.stderr);
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const failed = Object.entries(manifest.steps).filter(([, code]) => code !== 0);
  console.log(failed.length === 0 ? `snapshot written to ${dir}` : `snapshot written to ${dir}, with non-zero exits: ${failed.map(([k, c]) => `${k}=${c}`).join(', ')}`);
}

// ==================== COMPARE ==================== //

function compare(before, after) {
  assertRepoRoot();
  const problems = [];
  const read = (dir, file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : null);
  const mBefore = JSON.parse(read(before, 'manifest.json') ?? fail(`no manifest in ${before}`));
  const mAfter = JSON.parse(read(after, 'manifest.json') ?? fail(`no manifest in ${after}`));

  for (const [step, code] of Object.entries(mBefore.steps)) {
    const now = mAfter.steps[step];
    if (now === undefined) problems.push(`${step}: missing from the after snapshot`);
    else if (now !== code) problems.push(`${step}: exit code ${code} before, ${now} after`);
  }

  const differ = node(['scripts/diff-hashes.mjs', path.join(before, 'hashes.json'), path.join(after, 'hashes.json')]);
  const verdict = differ.stdout.trim().split('\n').filter((l) => l.trim()).slice(-3).join(' | ');
  // The differ compares the per-tick hash; the byte comparison also catches a sample field that
  // moved while its hash did not, which on one machine and one Node is never legitimate.
  const sameBytes = read(before, 'hashes.json') === read(after, 'hashes.json');
  if (differ.code !== 0) problems.push(`hashes: ${verdict}`);
  else if (!sameBytes) problems.push(`hashes: the differ agrees but hashes.json is not byte-identical (${verdict})`);
  else console.log(`hashes:      PASS  (${verdict})`);

  const files = [...TEXT_ORACLES.map((n) => `${n}.txt`), ...MODES.map((m) => `match-${m}.jsonl`)];
  for (const file of files) {
    const a = read(before, file);
    const b = read(after, file);
    if (a === null || b === null) {
      problems.push(`${file}: missing (${a === null ? 'before' : 'after'})`);
      continue;
    }
    const diff = firstDifference(a, b);
    if (diff) problems.push(`${file}: first difference at line ${diff.line}\n      before: ${diff.before.slice(0, 220)}\n      after:  ${diff.after.slice(0, 220)}`);
    else console.log(`${file.padEnd(20)} PASS  (byte-identical, ${a.split('\n').length - 1} lines)`);
  }

  if ('skirmish' in mBefore.steps || 'skirmish' in mAfter.steps) {
    const s = read(after, 'skirmish.txt') ?? '';
    if (!s.includes('FLOW CHECK PASSED.')) problems.push(`skirmish: no "FLOW CHECK PASSED." in the after run (${s.split('\n').filter((l) => l.includes('FLOW CHECK')).join(' | ') || 'no verdict line'})`);
    else console.log('skirmish:    PASS  (FLOW CHECK PASSED.)');
  }

  if (problems.length > 0) {
    console.log('\nFAIL');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nPASS: every oracle matches.');
}

// ==================== ENTRY ==================== //

const [command, a, b] = process.argv.slice(2);
if (command === 'snapshot' && a) snapshot(a, process.argv.includes('--net'));
else if (command === 'compare' && a && b) compare(a, b);
else fail('usage: oracles.mjs snapshot <dir> [--net] | oracles.mjs compare <beforeDir> <afterDir>');
