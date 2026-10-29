/*
 * Runs every tests/*.test.js in sequence and reports one summary.
 *
 * Each suite is a standalone `node` script that exits non-zero on failure, so
 * this just spawns them and aggregates. No framework — these suites need no
 * more than assert-and-count, and a dependency-free runner keeps them runnable
 * on any machine with node.
 *
 * Run:  npm test   (or: node tests/run-all.js)
 * Exit: 0 = every suite passed, 1 = at least one failed
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const suites = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .sort();

if (!suites.length) {
  console.log('No test suites found in ' + __dirname);
  process.exitCode = 1;
  return;
}

const results = [];
for (const s of suites) {
  process.stdout.write('\n' + '#'.repeat(62) + '\n# ' + s + '\n' + '#'.repeat(62) + '\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  results.push({ suite: s, code: r.status });
}

console.log('\n' + '='.repeat(62));
console.log('SUITE SUMMARY');
console.log('='.repeat(62));
let bad = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) bad++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + r.suite);
}
console.log('\n' + (bad ? bad + ' of ' + results.length + ' suite(s) failing'
                        : 'all ' + results.length + ' suites passing'));
process.exit(bad ? 1 : 0);
