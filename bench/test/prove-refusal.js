#!/usr/bin/env node
//
// Proves run-tasks.js refuses to run when a checker cannot fail.
//
// The self-test in run-tasks.js is the whole reason its results mean anything,
// and a self-test that always passes is worth nothing. This drives it with a
// deliberately broken task file: one bad fixture is made identical to its good
// fixture, so that checker can no longer distinguish them.
//
// Expected: exit 2, a message naming the checker, and no endpoint contacted.
//
// Copies bench/ to a temporary directory. The real files are never touched.
//
// Run it:
//   node bench/test/prove-refusal.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BENCH = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proverefusal-'));

// Everything run-tasks.js requires, other than tasks.js which is rewritten
// below. A module added to the harness and not added here does not make this
// test pass for the wrong reason, it makes it die on a module resolution
// error, which is how tasks-tools.js was caught.
const COPIED = ['run-tasks.js', 'sandbox.js', 'tasks-tools.js'];
for (const f of COPIED) {
  const src = path.join(BENCH, f);
  if (!fs.existsSync(src)) {
    console.error(`REFUSED: ${f} is not in ${BENCH}. Update COPIED in this file.`);
    process.exit(2);
  }
  fs.copyFileSync(src, path.join(tmp, f));
}

// Anchored on the exact fixture string, and refuses rather than proceeding if
// it is not there exactly once. A silent no-op replace would leave this test
// passing against an unmodified file, which is the failure it exists to catch.
const NEEDLE = "bad: 'Steps 1 and 3 failed. [1, 3]',";
const original = fs.readFileSync(path.join(BENCH, 'tasks.js'), 'utf8');
const hits = original.split(NEEDLE).length - 1;
if (hits !== 1) {
  console.error(`REFUSED: expected the exit-codes bad fixture exactly once, found ${hits}.`);
  console.error('tasks.js has changed. Update NEEDLE in this file to the current fixture.');
  process.exit(2);
}
fs.writeFileSync(
  path.join(tmp, 'tasks.js'),
  original.replace(NEEDLE, "bad: '```json\\n[2, 4]\\n```',")
);

const args = ['--only', 'exit-codes', '--reps', '1'];
const broken = spawnSync(process.execPath, [path.join(tmp, 'run-tasks.js'), ...args], {
  encoding: 'utf8',
  timeout: 60000,
});
const brokenOut = `${broken.stdout || ''}${broken.stderr || ''}`;

// The control on the control. An unmodified file must still get through its
// self-test and reach the endpoint, or this test would pass for a reason that
// has nothing to do with the sabotage.
const clean = spawnSync(process.execPath, [path.join(BENCH, 'run-tasks.js'), ...args], {
  encoding: 'utf8',
  timeout: 60000,
});
const cleanOut = `${clean.stdout || ''}${clean.stderr || ''}`;

console.log(brokenOut.trim());
console.log('---');

let ok = true;
function want(name, cond) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) ok = false;
}

want('sabotaged run exits 2', broken.status === 2);
want('names the checker that cannot fail', /BAD fixture scored pass/.test(brokenOut));
want('says nothing was asked of any model', /nothing was asked of any model/i.test(brokenOut));
want('no endpoint was contacted', !/fetch failed|HTTP \d/.test(brokenOut));
want('unmodified file passes its self-test', /self-test passed/.test(cleanOut));
want('unmodified file then reaches the endpoint', /fetch failed|d0\s+exit-codes/.test(cleanOut));

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
