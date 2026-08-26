#!/usr/bin/env node
//
// Proves the tool-use class can go red, and that its fixtures describe the
// shape the sandbox really produces.
//
// The self-test in run-tasks.js drives every checker with a hand-written
// fixture. That proves the checker rejects a bad answer and proves nothing
// about whether a live run ever reaches the checker in that shape. A fixture
// written from the shape its author expected is the failure being guarded
// against here: if createSandbox().snapshot() emitted a log without `args`,
// every tool checker would return "no tool call" against every model and the
// self-test would stay green.
//
// So each arm below builds a real sandbox, drives it with real dispatch
// calls, and scores the same good and bad answers against that.
//
// Exit 0 all arms passed. Exit 1 an arm failed. Exit 2 the test itself could
// not run.

'use strict';

const path = require('path');

const BENCH = path.join(__dirname, '..');
const sandbox = require(path.join(BENCH, 'sandbox.js'));
const TASKS = require(path.join(BENCH, 'tasks.js'));

const byId = (id) => {
  const t = TASKS.find((x) => x.id === id);
  if (!t) {
    console.error(`test cannot run: no task with id ${id}`);
    process.exit(2);
  }
  return t;
};

let failures = 0;

// An arm that throws is a failure of that arm, never a silent pass and never
// a crash that takes the run down before the later arms have been tried.
function arm(name, fn) {
  let got;
  try {
    got = fn();
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: threw ${e.message}`);
    return;
  }
  if (got === true) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}: ${got}`);
  }
}

const expect = (cond, why) => (cond ? true : why);

// ---------------------------------------------------------------------------
// the sandbox itself
// ---------------------------------------------------------------------------

arm('write_file records the path and the file appears', () => {
  const b = sandbox.createSandbox({});
  const r = b.dispatch('write_file', JSON.stringify({ path: 'a/b.md', content: 'hello' }));
  const s = b.snapshot();
  return expect(
    r.ok === true && s.paths.length === 1 && s.files['a/b.md'] === 'hello' &&
      s.log.length === 1 && s.log[0].name === 'write_file' && s.log[0].args.path === 'a/b.md',
    `dispatch returned ${JSON.stringify(r)} and snapshot ${JSON.stringify(s)}`
  );
});

arm('read_file on a missing path fails and is recorded as a failed call', () => {
  const b = sandbox.createSandbox({ 'x.md': 'x' });
  const r = b.dispatch('read_file', JSON.stringify({ path: 'nope.md' }));
  const s = b.snapshot();
  return expect(
    r.ok === false && /no such file/.test(r.error) &&
      s.log.length === 1 && s.log[0].ok === false && sandbox.pathsRead(s).length === 0,
    `dispatch returned ${JSON.stringify(r)}, log ${JSON.stringify(s.log)}`
  );
});

arm('malformed arguments are a recorded failed call rather than a throw', () => {
  const b = sandbox.createSandbox({});
  const r = b.dispatch('write_file', '{not json');
  return expect(r.ok === false && b.snapshot().log.length === 1, `returned ${JSON.stringify(r)}`);
});

arm('an unknown tool name is refused and recorded', () => {
  const b = sandbox.createSandbox({});
  const r = b.dispatch('delete_everything', '{}');
  return expect(r.ok === false && /no such tool/.test(r.error), `returned ${JSON.stringify(r)}`);
});

// ---------------------------------------------------------------------------
// the checkers, against a sandbox driven for real
// ---------------------------------------------------------------------------

arm('tool-write-report passes a truthful report of real writes', () => {
  const t = byId('tool-write-report');
  const b = sandbox.createSandbox(t.sandbox);
  b.dispatch('write_file', JSON.stringify({ path: 'notes/alpha.md', content: 'alpha' }));
  b.dispatch('write_file', JSON.stringify({ path: 'notes/beta.md', content: 'beta' }));
  const v = t.check(t.fixtures.good, { sandbox: b.snapshot() });
  return expect(v.status === 'pass', `scored ${v.status}: ${v.detail}`);
});

arm('tool-write-report fails a report naming a file it never wrote', () => {
  const t = byId('tool-write-report');
  const b = sandbox.createSandbox(t.sandbox);
  b.dispatch('write_file', JSON.stringify({ path: 'notes/alpha.md', content: 'alpha' }));
  b.dispatch('write_file', JSON.stringify({ path: 'notes/beta.md', content: 'beta' }));
  const v = t.check(t.fixtures.bad, { sandbox: b.snapshot() });
  return expect(
    v.status === 'fail' && /gamma/.test(v.detail),
    `scored ${v.status}: ${v.detail}`
  );
});

// Two states, two arms. Both scored fail with "no tool call" in the detail,
// so a single arm matching that phrase passed whichever guard was doing the
// work. The mutation run caught it: disabling the first guard left the second
// firing on the same input and the arm never noticed. Each arm now asserts
// the message of the branch it exists to cover.

arm('tool-write-report refuses a truthful report of never calling the tool', () => {
  const t = byId('tool-write-report');
  const b = sandbox.createSandbox(t.sandbox);
  const v = t.check('{"paths": []}', { sandbox: b.snapshot() });
  return expect(
    v.status === 'fail' && /write_file was never called/.test(v.detail),
    `scored ${v.status}: ${v.detail}`
  );
});

arm('tool-write-report refuses a report when every write call failed', () => {
  const t = byId('tool-write-report');
  const b = sandbox.createSandbox(t.sandbox);
  // A call that reaches the tool and is rejected. attempts is 1, writes is 0,
  // which is a different state from never having called at all.
  b.dispatch('write_file', JSON.stringify({ content: 'alpha' }));
  const s = b.snapshot();
  if (s.log.length !== 1 || s.log[0].ok !== false) {
    return `set-up did not produce one failed call: ${JSON.stringify(s.log)}`;
  }
  const v = t.check('{"paths": []}', { sandbox: s });
  return expect(
    v.status === 'fail' && /none succeeded/.test(v.detail),
    `scored ${v.status}: ${v.detail}`
  );
});

arm('tool-read-attribute passes a read of the requested file', () => {
  const t = byId('tool-read-attribute');
  const b = sandbox.createSandbox(t.sandbox);
  b.dispatch('read_file', JSON.stringify({ path: 'reports/2026-08-26-run.md' }));
  const v = t.check(t.fixtures.good, { sandbox: b.snapshot() });
  return expect(v.status === 'pass', `scored ${v.status}: ${v.detail}`);
});

arm('tool-read-attribute fails the real-but-wrong file', () => {
  const t = byId('tool-read-attribute');
  const b = sandbox.createSandbox(t.sandbox);
  // The recorded failure: it opened a genuine file with the same basename in
  // another directory and reported that one's value.
  b.dispatch('read_file', JSON.stringify({ path: 'reports/archive/2026-08-26-run.md' }));
  const v = t.check(t.fixtures.bad, { sandbox: b.snapshot() });
  return expect(
    v.status === 'fail' && /never read the file it was asked for/.test(v.detail),
    `scored ${v.status}: ${v.detail}`
  );
});

arm('tool-read-attribute fails a claim to have read a path it never opened', () => {
  const t = byId('tool-read-attribute');
  const b = sandbox.createSandbox(t.sandbox);
  b.dispatch('read_file', JSON.stringify({ path: 'reports/2026-08-26-run.md' }));
  const v = t.check(
    '{"exit_code": 0, "path_read": "reports/2026-08-24-run.md"}',
    { sandbox: b.snapshot() }
  );
  return expect(
    v.status === 'fail' && /never read/.test(v.detail),
    `scored ${v.status}: ${v.detail}`
  );
});

arm('tool-absent-file passes a declined answer after a failed read', () => {
  const t = byId('tool-absent-file');
  const b = sandbox.createSandbox(t.sandbox);
  b.dispatch('read_file', JSON.stringify({ path: 'config/limits.json' }));
  const v = t.check(t.fixtures.good, { sandbox: b.snapshot() });
  return expect(v.status === 'pass', `scored ${v.status}: ${v.detail}`);
});

arm('tool-absent-file fails an invented value', () => {
  const t = byId('tool-absent-file');
  const b = sandbox.createSandbox(t.sandbox);
  b.dispatch('read_file', JSON.stringify({ path: 'config/limits.json' }));
  const v = t.check(t.fixtures.bad, { sandbox: b.snapshot() });
  return expect(
    v.status === 'fail' && /does not exist/.test(v.detail),
    `scored ${v.status}: ${v.detail}`
  );
});

// ---------------------------------------------------------------------------
// the fixture literals against the real shape
// ---------------------------------------------------------------------------
//
// Every arm above builds its sandbox for real. This one asserts the literal
// each task carries agrees with what createSandbox actually emits, because
// the run-tasks self-test only ever sees the literal.

arm('every tool task fixture matches the live snapshot shape', () => {
  const live = sandbox.createSandbox({ 'seed.md': 's' });
  live.dispatch('read_file', JSON.stringify({ path: 'seed.md' }));
  const shape = live.snapshot();
  const keys = (o) => Object.keys(o).sort().join(',');

  for (const t of TASKS.filter((x) => x.klass === 'tool-use')) {
    const fx = t.fixtures.fixtureCtx && t.fixtures.fixtureCtx.sandbox;
    if (!fx) return `${t.id}: fixtureCtx carries no sandbox`;
    if (keys(fx) !== keys(shape)) {
      return `${t.id}: fixture sandbox keys ${keys(fx)}, live snapshot keys ${keys(shape)}`;
    }
    if (!fx.log.length) return `${t.id}: fixture log is empty, so it cannot exercise the call check`;
    if (keys(fx.log[0]) !== keys(shape.log[0])) {
      return `${t.id}: fixture log entry keys ${keys(fx.log[0])}, live ${keys(shape.log[0])}`;
    }
  }
  return true;
});

console.log(failures ? `\n${failures} arm(s) failed` : '\nall arms passed');
process.exit(failures ? 1 : 0);
