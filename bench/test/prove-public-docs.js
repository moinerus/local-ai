'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
const roadmap = fs.readFileSync(path.join(REPO, 'ROADMAP.md'), 'utf8');
let failures = 0;

function requireText(name, pattern) {
  if (!pattern.test(readme)) {
    console.log(`FAIL ${name}`);
    failures++;
    return;
  }
  console.log(`ok   ${name}`);
}

requireText(
  'the clean offline sample command is on the front page',
  /\.\/bench\/node22\.sh bench\/score-session\.js samples\/clean-account\.jsonl/
);
requireText(
  'the mismatched offline sample command is on the front page',
  /\.\/bench\/node22\.sh bench\/score-session\.js samples\/mismatched-account\.jsonl/
);
requireText('the samples are labelled as constructed', /constructed sample/i);
requireText('the readings retain the one-machine caveat', /one machine/i);

const roadmapLines = roadmap.split('\n').length;
if (roadmapLines > 180) {
  console.log(`FAIL the roadmap stays under 180 lines: ${roadmapLines}`);
  failures++;
} else {
  console.log(`ok   the roadmap stays under 180 lines: ${roadmapLines}`);
}
for (const heading of ['Release checklist', "What remains Andy's call", 'After release']) {
  if (!roadmap.includes(`## ${heading}`)) {
    console.log(`FAIL the roadmap carries the ${heading} heading`);
    failures++;
  } else {
    console.log(`ok   the roadmap carries the ${heading} heading`);
  }
}

if (failures) process.exit(1);
console.log('all public document checks passed');
