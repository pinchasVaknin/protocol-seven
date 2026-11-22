#!/usr/bin/env node
/**
 * Function metrics for the refactor (REFACTOR-PROMPT.md, section 4).
 *
 * Run from the repo root:
 *   node "Claude outputs/refactor/measure.mjs" <file|dir> [...more] [--all] [--json]
 *        [--max-loc 50] [--max-cc 15] [--max-depth 3]
 *
 * Per function (declarations, methods, accessors, constructors, and arrow/function
 * expressions with a block body):
 *   loc    lines that hold code: comment lines and blank lines inside the function do not count
 *   depth  deepest nesting of if / loop / switch / try-catch / ternary inside the body
 *   cc     cognitive complexity, an approximation of SonarSource S3776
 *
 * Nested closures are counted inside their parent too (as ESLint max-lines-per-function does),
 * and are also listed on their own when they are large.
 *
 * The parser is `rolldown/parseAst` (oxc), which Vite 8 already installs, so this needs nothing
 * new. Test files (*.test.ts) are skipped. Exit code is always 0: this reports, it does not gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'rolldown/parseAst';

// ==================== ARGUMENTS ==================== //

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const num = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : fallback;
};
const MAX_LOC = num('--max-loc', 50);
const MAX_CC = num('--max-cc', 15);
const MAX_DEPTH = num('--max-depth', 3);
const SHOW_ALL = flag('--all');
const AS_JSON = flag('--json');
const targets = argv.filter((a, i) => !a.startsWith('--') && !String(argv[i - 1]).startsWith('--max'));

if (targets.length === 0) {
  console.error('usage: node measure.mjs <file|dir> [...] [--all] [--json] [--max-loc N] [--max-cc N] [--max-depth N]');
  process.exit(2);
}

// ==================== FILE DISCOVERY ==================== //

function collect(target, out) {
  if (!fs.existsSync(target)) {
    console.error(`missing: ${target}`);
    return;
  }
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (/\.ts$/.test(target) && !/\.test\.ts$/.test(target)) out.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const p = path.join(target, entry.name);
    // A directory target means its own files only: subdirectories are other units.
    if (entry.isFile()) collect(p, out);
  }
}

// ==================== CODE-LINE MASK ==================== //

/**
 * One boolean per source line: does it hold code? Comments become blank; string and template
 * contents become non-blank, so a line that is only a string literal still counts as code.
 */
function codeLineMask(src) {
  const BACKSLASH = String.fromCharCode(92);
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += 'x';
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === BACKSLASH) { out += 'xx'; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : 'x';
        i++;
      }
      out += 'x';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out.split('\n').map((line) => line.trim().length > 0);
}

// ==================== AST HELPERS ==================== //

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v.type === 'string') out.push(v);
    } else if (value && typeof value.type === 'string') {
      out.push(value);
    }
  }
  return out;
}

/** Cognitive complexity (approximate S3776) and the deepest control-flow nesting of a body. */
function complexityOf(body) {
  let cc = 0;
  let maxDepth = 0;

  const visit = (node, nesting, depth, inElseIf = false) => {
    if (!node || typeof node.type !== 'string') return;
    const t = node.type;

    if (t === 'IfStatement') {
      // An `else if` costs +1 without a nesting increment; a plain `if` costs 1 + nesting.
      cc += inElseIf ? 1 : 1 + nesting;
      const d = inElseIf ? depth : depth + 1;
      maxDepth = Math.max(maxDepth, d);
      visit(node.test, nesting, d);
      visit(node.consequent, nesting + 1, d);
      if (node.alternate) {
        if (node.alternate.type === 'IfStatement') {
          visit(node.alternate, nesting, d - (inElseIf ? 0 : 1), true);
        } else {
          cc += 1; // else
          visit(node.alternate, nesting + 1, d);
        }
      }
      return;
    }
    if (LOOP_TYPES.has(t) || t === 'SwitchStatement' || t === 'CatchClause' || t === 'ConditionalExpression') {
      cc += 1 + nesting;
      const d = depth + 1;
      maxDepth = Math.max(maxDepth, d);
      for (const child of children(node)) visit(child, nesting + 1, d);
      return;
    }
    if (t === 'TryStatement') {
      // The try block itself is free; the catch clause pays (handled above).
      for (const child of children(node)) visit(child, nesting, depth);
      return;
    }
    if (t === 'LogicalExpression') {
      // +1 per run of the same operator: `a && b && c` is 1, `a && b || c` is 2.
      const runs = (n, parentOp) => {
        if (n.type !== 'LogicalExpression') {
          visit(n, nesting, depth);
          return;
        }
        if (n.operator !== parentOp) cc += 1;
        runs(n.left, n.operator);
        runs(n.right, n.operator);
      };
      runs(node, null);
      return;
    }
    if ((t === 'BreakStatement' || t === 'ContinueStatement') && node.label) cc += 1;
    if (FUNCTION_TYPES.has(t)) {
      // A closure nests whatever it contains.
      visit(node.body, nesting + 1, depth);
      return;
    }
    for (const child of children(node)) visit(child, nesting, depth);
  };

  visit(body, 0, 0);
  return { cc, depth: maxDepth };
}

// ==================== FUNCTION DISCOVERY ==================== //

function nameFor(node, parent, className) {
  if (parent?.type === 'MethodDefinition') {
    const key = parent.key?.name ?? parent.key?.value ?? '<computed>';
    const prefix = parent.kind === 'get' ? 'get ' : parent.kind === 'set' ? 'set ' : '';
    return `${className ?? '<class>'}.${prefix}${key}`;
  }
  if (parent?.type === 'PropertyDefinition') return `${className ?? '<class>'}.${parent.key?.name ?? '<computed>'}`;
  if (parent?.type === 'VariableDeclarator') return parent.id?.name ?? '<destructured>';
  if (parent?.type === 'Property') return parent.key?.name ?? parent.key?.value ?? '<computed>';
  if (node.id?.name) return node.id.name;
  return null;
}

function measureFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const mask = codeLineMask(src);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo; // 0-based
  };

  let ast;
  try {
    ast = parseAst(src, { lang: 'ts' });
  } catch (error) {
    return { file, error: String(error?.message ?? error), functions: [], lines: mask.length };
  }

  const functions = [];
  const walk = (node, parent, className) => {
    if (!node || typeof node.type !== 'string') return;
    let currentClass = className;
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') currentClass = node.id?.name ?? '<anonymous class>';

    if (FUNCTION_TYPES.has(node.type) && node.body?.type === 'BlockStatement') {
      const startLine = lineOf(parent?.type === 'MethodDefinition' ? parent.start : node.start);
      const endLine = lineOf(node.end);
      let loc = 0;
      for (let l = startLine; l <= endLine; l++) if (mask[l]) loc++;
      const { cc, depth } = complexityOf(node.body);
      const name = nameFor(node, parent, currentClass) ?? `<anonymous@${startLine + 1}>`;
      functions.push({ name, line: startLine + 1, loc, cc, depth, anonymous: name.startsWith('<anonymous') });
    }
    for (const child of children(node)) walk(child, node, currentClass);
  };
  walk(ast, null, null);

  return { file, functions, lines: mask.length, codeLines: mask.filter(Boolean).length };
}

// ==================== REPORT ==================== //

const files = [];
for (const t of targets) collect(t, files);
files.sort();
const results = files.map(measureFile);

const over = (f) => f.loc > MAX_LOC || f.cc > MAX_CC || f.depth > MAX_DEPTH;

if (AS_JSON) {
  console.log(JSON.stringify({ limits: { loc: MAX_LOC, cc: MAX_CC, depth: MAX_DEPTH }, results }, null, 1));
  process.exit(0);
}

const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join('/');
let totalFns = 0;
let totalOver = 0;
console.log(`limits: loc <= ${MAX_LOC}, cc <= ${MAX_CC}, depth <= ${MAX_DEPTH}   (loc excludes comments and blank lines)\n`);
console.log('file'.padEnd(52), 'lines'.padStart(6), 'code'.padStart(6), 'fns'.padStart(5), 'maxLoc'.padStart(7), 'maxCc'.padStart(6), 'over'.padStart(5));
for (const r of results) {
  if (r.error) {
    console.log(`${rel(r.file)}  PARSE ERROR: ${r.error}`);
    continue;
  }
  const named = r.functions;
  const maxLoc = Math.max(0, ...named.map((f) => f.loc));
  const maxCc = Math.max(0, ...named.map((f) => f.cc));
  const nOver = named.filter(over).length;
  totalFns += named.length;
  totalOver += nOver;
  console.log(rel(r.file).padEnd(52), String(r.lines).padStart(6), String(r.codeLines).padStart(6), String(named.length).padStart(5), String(maxLoc).padStart(7), String(maxCc).padStart(6), String(nOver).padStart(5));
}
console.log(`\n${results.length} file(s), ${totalFns} function(s), ${totalOver} over a limit.\n`);

const rows = [];
for (const r of results) for (const f of r.functions) if (SHOW_ALL || over(f)) rows.push({ ...f, file: rel(r.file) });
rows.sort((a, b) => b.loc - a.loc || b.cc - a.cc);
if (rows.length > 0) {
  console.log(SHOW_ALL ? 'all functions:' : 'over a limit:');
  console.log('  ' + 'loc'.padStart(5), 'cc'.padStart(4), 'depth'.padStart(6), '  location / name');
  for (const f of rows) {
    const marks = [f.loc > MAX_LOC ? 'LOC' : '', f.cc > MAX_CC ? 'CC' : '', f.depth > MAX_DEPTH ? 'DEPTH' : ''].filter(Boolean).join(',');
    console.log('  ' + String(f.loc).padStart(5), String(f.cc).padStart(4), String(f.depth).padStart(6), `  ${f.file}:${f.line}  ${f.name}${marks ? `   [${marks}]` : ''}`);
  }
}
