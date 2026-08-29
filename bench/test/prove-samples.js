// The two public samples are the zero-setup front door to the session scorer.
// One must match its record and one must fail for the reason printed beside it.
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const SCORER = path.join(REPO, 'bench', 'score-session.js');

let failures = 0;

function run(name, file, expectedCode, expectedText) {
  const result = spawnSync(process.execPath, [SCORER, path.join(REPO, 'samples', file)], {
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== expectedCode || !expectedText.test(output)) {
    console.log(`FAIL ${name}: exit ${result.status}; output: ${output.trim()}`);
    failures++;
    return;
  }
  console.log(`ok   ${name}`);
}

run('clean constructed sample matches', 'clean-account.jsonl', 0, /the account matches the record/);
run(
  'mismatched constructed sample names the invented write',
  'mismatched-account.jsonl',
  1,
  /MISMATCH written.*never-written\.py.*record does not show/s
);

if (failures) process.exit(1);
console.log('all 2 sample arms passed');
