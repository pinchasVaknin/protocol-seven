#!/usr/bin/env node
/**
 * The bot AI's measuring bench (bot AI plan, S0). No dependencies.
 *
 *   node scripts/tactics-bench.mjs run <out.json> [--seed 1000] [--matches 10]
 *   node scripts/tactics-bench.mjs compare <a.json> <b.json>
 *
 * `run` builds the server, then plays `--matches` bot-only matches in each of seven cells
 * (three TDM maps, then DOM, KC, SND and FFA on Foundry) with `main.js --tactics`, reads the
 * `match.tactics` and `match.end` lines, **sums the raw counters over the matches and only then
 * divides**, prints the table and writes it as JSON. A ratio of ratios would weight a short
 * match like a long one; a ratio of sums does not.
 *
 * The column definitions are in the plan, section 4. They are computed here and nowhere else.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// ---------------------------------------------------------------------------------------------
// Cells and columns
// ---------------------------------------------------------------------------------------------

const CELLS = [
  { id: 'foundry TDM', map: 'mp_foundry', mode: 'TDM', bots: 10 },
  { id: 'dunes TDM', map: 'mp_dunes', mode: 'TDM', bots: 10 },
  { id: 'depot TDM', map: 'mp_depot', mode: 'TDM', bots: 10 },
  { id: 'foundry DOM', map: 'mp_foundry', mode: 'DOM', bots: 10 },
  { id: 'foundry KC', map: 'mp_foundry', mode: 'KC', bots: 10 },
  { id: 'foundry SND', map: 'mp_foundry', mode: 'SND', bots: 10 },
  { id: 'foundry FFA', map: 'mp_foundry', mode: 'FFA', bots: 8 },
];

const STATES = [
  'IDLE', 'PATROL', 'INVESTIGATE', 'ENGAGE', 'SUPPRESS', 'RELOAD',
  'SEEK_COVER', 'FLANK', 'PUSH', 'OBJECTIVE', 'DEAD',
];

/** The counters `match.tactics` carries per match, summed over the matches as they are. */
const SUMMED = [
  'decisions', 'rejected', 'losDecisions', 'idleLosDecisions', 'hurtDecisions', 'hurtInCover',
  'steerTicks', 'coverNoPathTicks', 'stuckLive', 'stuckFrozen', 'knownTargetTicks',
  'deadTargetTicks', 'seenTargets', 'multiTargets', 'crossTargets', 'closeSamples', 'closeBots',
  'uninformed', 'livingSamples', 'deaths', 'deathsObjective', 'deathsObjOutnumbered',
  'deathsReloadSeeing', 'deathsEmpty', 'deathsRunToCover', 'deathsInCover', 'freshContacts',
  'firstBursts', 'ticks',
  // Counters later stages add; absent in S0 and then simply zero.
  'holds', 'holdTimeouts',
];

const pct = (n, d) => (d > 0 ? (100 * n) / d : 0);
const round1 = (x) => Math.round(x * 10) / 10;

/** [key, label, how to compute from a cell's summed counters `s`] */
const COLUMNS = [
  ['min', 'min/match', (s) => s.ticks / 3600 / s.matches, 'min'],
  ['rej', 'rej%', (s) => pct(s.rejected, s.decisions)],
  ['idleLOS', 'idleLOS%', (s) => pct(s.idleLosDecisions, s.losDecisions)],
  ['fb', 'fb%', (s) => pct(s.firstBursts, s.freshContacts)],
  ['dead', 'dead%', (s) => pct(s.deadTargetTicks, s.knownTargetTicks)],
  ['inCov', 'inCov%', (s) => pct(s.coverNoPathTicks, s.steerTicks)],
  ['hurtCov', 'hurtCov%', (s) => pct(s.hurtInCover, s.hurtDecisions)],
  ['OBJ', 'OBJ%', (s) => pct(s.stateTicks.OBJECTIVE, s.steerTicks)],
  ['FLANK', 'FLANK%', (s) => pct(s.stateTicks.FLANK, s.steerTicks)],
  ['multi', 'multi%', (s) => pct(s.multiTargets, s.seenTargets)],
  ['cross', 'cross%', (s) => pct(s.crossTargets, s.multiTargets)],
  ['close', 'close%', (s) => pct(s.closeBots, s.closeSamples)],
  ['uninf', 'uninf%', (s) => pct(s.uninformed, s.livingSamples)],
];

const DEATH_COLUMNS = [
  ['dthOBJ', 'dthOBJ%', (s) => pct(s.deathsObjective, s.deaths)],
  ['objOut', 'objOut%', (s) => pct(s.deathsObjOutnumbered, s.deathsObjective)],
  ['reloadSee', 'reloadSee%', (s) => pct(s.deathsReloadSeeing, s.deaths)],
  ['empty', 'empty%', (s) => pct(s.deathsEmpty, s.deaths)],
  ['runToCover', 'runToCover%', (s) => pct(s.deathsRunToCover, s.deaths)],
  ['inCover', 'inCover%', (s) => pct(s.deathsInCover, s.deaths)],
];

// ---------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const o = JSON.parse(line);
      if (o.tag === 'harness') out.push(o);
    } catch {
      // A log line that is not ours.
    }
  }
  return out;
}

function runCell(cell, seed, matches) {
  const args = [
    'dist-server/main.js', '--seed', String(seed), '--map', cell.map, '--mode', cell.mode,
    '--bots', String(cell.bots), '--matches', String(matches), '--asap', '--json', '--tactics',
  ];
  const r = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cell.id}: main.js exited ${r.status}\n${r.stderr}`);
  const lines = parseLines(r.stdout);
  const tactics = lines.filter((l) => l.event === 'match.tactics');
  const ends = lines.filter((l) => l.event === 'match.end');
  if (tactics.length !== matches || ends.length !== matches) {
    throw new Error(`${cell.id}: expected ${matches} matches, got ${tactics.length}/${ends.length}`);
  }
  return summarise(cell, tactics, ends);
}

function summarise(cell, tactics, ends) {
  const s = { matches: tactics.length, stateTicks: {}, wins: { A: 0, B: 0, DRAW: 0, other: 0 } };
  for (const key of SUMMED) s[key] = tactics.reduce((n, t) => n + (t[key] ?? 0), 0);
  for (const state of STATES) {
    s.stateTicks[state] = tactics.reduce((n, t) => n + (t.stateTicks?.[state] ?? 0), 0);
  }
  for (const t of tactics) {
    const w = t.winner === 'A' || t.winner === 'B' ? t.winner : t.winner === 'DRAW' ? 'DRAW' : 'other';
    s.wins[w]++;
  }
  s.scoresSummed = ends.reduce((n, e) => n + (e.scoreA ?? 0) + (e.scoreB ?? 0), 0);
  s.aiP99 = tactics[tactics.length - 1].aiP99;
  s.aiMean = tactics.reduce((n, t) => n + t.aiMean, 0) / tactics.length;
  s.hitRateByTier = {};
  for (const e of ends) {
    for (const [tier, r] of Object.entries(e.hitRateByTier ?? {})) {
      const into = (s.hitRateByTier[tier] ??= { shots: 0, hits: 0 });
      into.shots += r.shots;
      into.hits += r.hits;
    }
  }
  const row = { id: cell.id, ...Object.fromEntries([...COLUMNS, ...DEATH_COLUMNS].map(([k, , f]) => [k, round1(f(s))])) };
  row.stuckLive = s.stuckLive;
  row.stuckFrozen = s.stuckFrozen;
  row.holds = s.holds;
  row.holdTimeouts = s.holdTimeouts;
  row.aiP99 = Math.round(s.aiP99 * 1000) / 1000;
  row.wins = s.wins;
  row.scores = s.scoresSummed;
  row.states = Object.fromEntries(STATES.map((st) => [st, round1(pct(s.stateTicks[st], s.steerTicks))]));
  row.hitRate = Object.fromEntries(
    Object.entries(s.hitRateByTier).map(([t, r]) => [t, round1(pct(r.hits, r.shots))]),
  );
  return { raw: s, row };
}

function printTable(title, rows, columns) {
  console.log(`\n${title}`);
  const head = ['cell', ...columns.map((c) => c[1])];
  const body = rows.map((r) => [r.id, ...columns.map((c) => String(r[c[0]]))]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const b of body) console.log(fmt(b));
}

function printResult(result) {
  const rows = result.cells.map((c) => c.row);
  printTable(`Tactics (seed ${result.seed}, ${result.matches} matches per cell)`, rows, COLUMNS);
  printTable('Deaths (share of all bot deaths; objOut is a share of the OBJECTIVE deaths)', rows, DEATH_COLUMNS);
  console.log('\nState shares (% of steer ticks)');
  console.log(['cell', ...STATES].join('\t'));
  for (const r of rows) console.log([r.id, ...STATES.map((s) => r.states[s])].join('\t'));
  console.log('\nOther');
  for (const r of rows) {
    console.log(
      `${r.id}: stuckLive ${r.stuckLive}, stuckFrozen ${r.stuckFrozen}, aiP99 ${r.aiP99} ms, ` +
        `wins A ${r.wins.A} / B ${r.wins.B} / DRAW ${r.wins.DRAW}` +
        `${r.wins.other > 0 ? ` / other ${r.wins.other}` : ''}, scores summed ${r.scores}`,
    );
  }
  console.log('\nHit rate by tier, % (hits / shots over all matches)');
  for (const r of rows) console.log(`${r.id}: ${JSON.stringify(r.hitRate)}`);
}

function run(outPath, seed, matches) {
  console.log('building the server bundle ...');
  const build = spawnSync('npm run build:server', { encoding: 'utf8', shell: true });
  if (build.status !== 0) throw new Error(`build:server failed\n${build.stdout}\n${build.stderr}`);
  const started = Date.now();
  const cells = [];
  for (const cell of CELLS) {
    process.stdout.write(`${cell.id} ... `);
    cells.push(runCell(cell, seed, matches));
    console.log('done');
  }
  const result = { seed, matches, seconds: Math.round((Date.now() - started) / 1000), cells };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  printResult(result);
  console.log(`\nwrote ${outPath} (${result.seconds} s)`);
}

// ---------------------------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------------------------

function compare(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  console.log(`A: ${aPath} (seed ${a.seed})\nB: ${bPath} (seed ${b.seed})`);
  const keys = [...COLUMNS, ...DEATH_COLUMNS].map((c) => c[0]).concat(['stuckLive', 'holds', 'holdTimeouts', 'scores']);
  for (const cb of b.cells) {
    const ca = a.cells.find((c) => c.row.id === cb.row.id);
    if (ca === undefined) continue;
    console.log(`\n${cb.row.id}`);
    for (const k of keys) {
      const x = ca.row[k];
      const y = cb.row[k];
      if (x === y) continue;
      const d = Math.round((y - x) * 10) / 10;
      console.log(`  ${k.padEnd(11)} ${String(x).padStart(8)} -> ${String(y).padStart(8)}  (${d > 0 ? '+' : ''}${d})`);
    }
    for (const st of STATES) {
      const x = ca.row.states[st];
      const y = cb.row.states[st];
      if (x !== y) console.log(`  state ${st.padEnd(11)} ${x} -> ${y}`);
    }
  }
  console.log('\n--- A ---');
  printResult(a);
  console.log('\n--- B ---');
  printResult(b);
}

// ---------------------------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? Number.parseInt(rest[i + 1], 10) : fallback;
};

if (cmd === 'run' && rest[0] !== undefined) run(rest[0], flag('--seed', 1000), flag('--matches', 10));
else if (cmd === 'compare' && rest.length >= 2) compare(rest[0], rest[1]);
else {
  console.error('usage: tactics-bench.mjs run <out.json> [--seed N] [--matches N] | compare <a.json> <b.json>');
  process.exit(2);
}
