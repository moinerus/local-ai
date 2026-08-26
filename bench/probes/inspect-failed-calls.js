// Print the recorded tool results for the failed calls in a session log.
'use strict';
const fs = require('node:fs');
const logPath = process.argv[2];
const entries = fs
  .readFileSync(logPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l));

const calls = new Map();
for (const e of entries) {
  for (const c of e.toolCalls || []) calls.set(c.id, c);
}
for (const e of entries) {
  for (const r of e.toolResults || []) {
    if (r.isError !== true) continue;
    const c = calls.get(r.id);
    const name = c ? c.name : '(call not recorded)';
    const input = c ? JSON.stringify(c.input).slice(0, 120) : '';
    const body = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
    console.log(`FAILED ${name} ${input}`);
    console.log(`  -> ${String(body).slice(0, 400).replace(/\n/g, '\n     ')}`);
    console.log('');
  }
}
