#!/usr/bin/env node
//
// Reads result JSON files and prints a per-class tally.
//
// Written because the console summary groups by depth across every task in
// the run, so a run mixing code tasks and tool tasks reports one number that
// answers neither question. The class split is derived from each task's own
// `klass` in the file rather than from a list typed here, so a class added
// later appears without this script being edited.

'use strict';

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: summarise.js <results.json> [...]');
  process.exit(2);
}

const rows = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const padding = (r.opts && r.opts.padding) || 'turn';
  const byClass = new Map();

  for (const g of r.results) {
    for (const depth of [g.depth]) {
      const key = `${g.klass}|${depth}`;
      const acc = byClass.get(key) || { klass: g.klass, depth, pass: 0, total: 0, reasons: new Map() };
      for (const run of g.runs) {
        acc.total++;
        if (run.status === 'pass') acc.pass++;
        else {
          const why = run.status === 'fail' && /no tool call/.test(run.detail || '')
            ? 'no tool call'
            : run.status;
          acc.reasons.set(why, (acc.reasons.get(why) || 0) + 1);
        }
      }
      byClass.set(key, acc);
    }
  }

  for (const acc of byClass.values()) {
    const why = [...acc.reasons.entries()].map(([k, v]) => `${v} ${k}`).join(', ');
    rows.push({
      label: r.label,
      padding,
      klass: acc.klass,
      depth: acc.depth,
      score: `${acc.pass}/${acc.total}`,
      why: why || '',
      file: path.basename(f),
    });
  }
}

const cols = ['label', 'padding', 'klass', 'depth', 'score', 'why'];
// Widths derived from the data rather than typed, because a typed pad stops
// padding silently the moment a longer label turns up.
const w = {};
for (const c of cols) w[c] = Math.max(c.length, ...rows.map((r) => String(r[c]).length));
const line = (vals) => cols.map((c, i) => String(vals[i]).padEnd(w[c])).join('  ');

console.log(line(cols));
console.log(cols.map((c) => '-'.repeat(w[c])).join('  '));
for (const r of rows.sort((a, b) => a.klass.localeCompare(b.klass) || a.label.localeCompare(b.label) || a.depth - b.depth)) {
  console.log(line(cols.map((c) => r[c])));
}
