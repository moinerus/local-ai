// Pull every self-report-edit run out of a results file and show, side by side,
// the model's own turn 1 code, the line count the checker derived from it, and
// what the model said in turn 2.
//
// Read-only. It touches no model and no endpoint.
//
// The results file is grouped: results[] carries one entry per task and depth,
// each holding a runs[] of repetitions. A first version of this script assumed
// a flat run list, found nothing, and printed "no parseable code block" for
// every entry, which reads as a finding about the model.

'use strict';

const fs = require('fs');

const file = process.argv[2];
const want = process.argv[3] || 'self-report-edit';
if (!file) {
  console.error('usage: inspect-selfreport.js <results.json> [task-id]');
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const groups = (data.results || []).filter((g) => g.task === want);

if (groups.length === 0) {
  console.error(`no ${want} groups found. tasks present: ` +
    [...new Set((data.results || []).map((g) => g.task))].join(', '));
  process.exit(1);
}

const extractCode = (s) => {
  const m = String(s || '').match(/```(?:python)?\n([\s\S]*?)```/);
  return m ? m[1] : null;
};

let seen = 0;
let missing = 0;

for (const g of groups) {
  for (let i = 0; i < g.runs.length; i++) {
    const r = g.runs[i];
    seen++;
    console.log('\n' + '='.repeat(72));
    console.log(`${data.label} task=${g.task} depth=${g.depth} rep=${i + 1} -> ${r.status}: ${r.detail}`);

    if (!Array.isArray(r.turnOutputs)) {
      missing++;
      console.log('no turnOutputs recorded in this file, so turn 1 cannot be read back');
      console.log('final turn was: ' + String(r.output).trim().slice(0, 200));
      continue;
    }

    const code = extractCode(r.turnOutputs[0]);
    if (!code) {
      console.log('turn 1 held no parseable code block. Raw turn 1:');
      console.log(String(r.turnOutputs[0]).slice(0, 800));
      continue;
    }
    const lines = code.split('\n');
    const nonBlank = lines.filter((l) => l.trim() !== '');
    console.log(`--- turn 1 code: ${lines.length} raw lines, ${nonBlank.length} non-blank ---`);
    lines.forEach((l, n) => {
      const blank = l.trim() === '';
      console.log(`${String(n + 1).padStart(3)}${blank ? ' .' : '  '} ${l}`);
    });
    console.log('--- turn 2 answer ---');
    console.log(String(r.turnOutputs[r.turnOutputs.length - 1]).trim().slice(0, 300));
  }
}

console.log(`\n${seen} run(s) read, ${missing} without turnOutputs`);
