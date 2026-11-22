#!/usr/bin/env node
/**
 * Prints one section header line of the refactor skeleton (REFACTOR-PROMPT.md, section 3),
 * exactly 100 characters long including its indentation.
 *
 *   node "Claude outputs/refactor/header.mjs" "CLASS Tdm"
 *   node "Claude outputs/refactor/header.mjs" "PRIVATE METHODS" 2
 *
 * Layout: <indent>// <=×L> <NAME> <=×R> \\   with L = floor(rest / 2) and R = rest - L,
 * so an odd remainder puts the extra "=" on the right. The line starts with "//" (a comment)
 * and ends with two backslashes, the mirror the user chose; a JS line comment has no line
 * continuation, so the trailing backslashes are inert.
 */

const name = process.argv[2];
const indent = Number(process.argv[3] ?? 0);
const WIDTH = 100;

if (!name || !Number.isInteger(indent) || indent < 0) {
  console.error('usage: node header.mjs "<SECTION NAME>" [indent]');
  process.exit(2);
}

const rest = WIDTH - indent - 8 - name.length;
if (rest < 6) {
  console.error(`"${name}" is too long for a ${WIDTH}-character header at indent ${indent}`);
  process.exit(2);
}

const left = Math.floor(rest / 2);
const line = `${' '.repeat(indent)}// ${'='.repeat(left)} ${name} ${'='.repeat(rest - left)} ${String.fromCharCode(92).repeat(2)}`;
if (line.length !== WIDTH) throw new Error(`internal: built ${line.length} characters`);
console.log(line);
