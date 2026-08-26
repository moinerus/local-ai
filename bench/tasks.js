// Task set for run-tasks.js.
//
// Every task carries two fixtures, `good` and `bad`. Before any model is
// called the harness runs each checker against both and refuses to continue
// unless good passes and bad fails. A checker that cannot fail is not
// evidence, and three of these were rewritten after the bad fixture passed.
//
// Task 1 and task 5 are regressions. Both are recorded failures of Qwen3.5-9B
// on real work: it reported three of four exit codes wrong from a run log it
// had just read, and it wrote a commit message describing the opposite of the
// change in the diff. Neither failure is visible to any public benchmark,
// because both are about reporting on given material rather than generating.

'use strict';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Models wrap JSON in prose and in fences no matter how the prompt is worded.
// Strip the wrapper, then parse. A parse failure scores as `format`, which is
// counted and reported separately from a wrong answer, never merged into it.
function extractJson(text) {
  if (typeof text !== 'string') return { ok: false, why: 'output was not a string' };
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();

  const first = s.search(/[[{]/);
  if (first === -1) return { ok: false, why: 'no JSON object or array found' };
  const opener = s[first];
  const closer = opener === '[' ? ']' : '}';
  const last = s.lastIndexOf(closer);
  if (last <= first) return { ok: false, why: `found ${opener} with no matching ${closer}` };

  try {
    return { ok: true, value: JSON.parse(s.slice(first, last + 1)) };
  } catch (e) {
    return { ok: false, why: `JSON.parse failed: ${e.message}` };
  }
}

function extractCode(text) {
  if (typeof text !== 'string') return '';
  const fence = text.match(/```(?:python|py)?\s*([\s\S]*?)```/);
  return (fence ? fence[1] : text).trim();
}

function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const norm = (xs) => [...new Set(xs.map(String))].sort().join('|');
  return norm(a) === norm(b);
}

const pass = (detail) => ({ status: 'pass', detail });
const fail = (detail) => ({ status: 'fail', detail });
const format = (detail) => ({ status: 'format', detail });

// ---------------------------------------------------------------------------
// task 1: exit codes from a run log
// ---------------------------------------------------------------------------
//
// The recorded failure. Four steps, two of them failed, and the log states
// every exit code explicitly. Nothing here needs inference. The 9B put its
// errors precisely on the steps marked with a tick, which is the shape that
// makes a wrong verification worse than none.

const RUN_LOG = `
$ ./ci.sh
[1/4] lint           ... ok            (exit 0)
[2/4] unit tests     ... FAILED        (exit 1)
      3 passed, 2 failed
[3/4] type check     ... ok            (exit 0)
[4/4] integration    ... FAILED        (exit 7)
      could not reach fixture server on 127.0.0.1:9001
done in 41s
`.trim();

const exitCodes = {
  id: 'exit-codes',
  klass: 'report',
  prompt: [
    'Here is the complete output of a CI run.',
    '',
    RUN_LOG,
    '',
    'Which numbered steps exited non-zero?',
    'Reply with a JSON array of the step numbers and nothing else.',
    'Example of the shape, not the answer: [1, 3]',
  ].join('\n'),
  check(out) {
    const j = extractJson(out);
    if (!j.ok) return format(j.why);
    if (!Array.isArray(j.value)) return format(`expected an array, got ${typeof j.value}`);
    const got = j.value.map(Number);
    return sameSet(got, [2, 4])
      ? pass('2 and 4')
      : fail(`said ${JSON.stringify(got)}, actual failures were [2,4]`);
  },
  fixtures: {
    good: '```json\n[2, 4]\n```',
    bad: 'Steps 1 and 3 failed. [1, 3]',
  },
};

// ---------------------------------------------------------------------------
// task 2: retry with backoff, executed
// ---------------------------------------------------------------------------

const pyRetry = {
  id: 'py-retry',
  klass: 'code',
  prompt: [
    'Write a Python function with this exact signature:',
    '',
    '    def retry(fn, attempts, base_delay, sleep=None):',
    '',
    'It calls fn() and returns its result. If fn() raises, it tries again, up',
    'to `attempts` total calls. Between attempt n and attempt n+1 it calls',
    'sleep(base_delay * (2 ** (n - 1))), where n starts at 1. If `sleep` is',
    'None it uses time.sleep. If every attempt raises, it re-raises the last',
    'exception. Return the value on the first success.',
    '',
    'Output the function only, in a single Python code block. No explanation.',
  ].join('\n'),
  exec: {
    // Asserts the return value, the call count AND the backoff schedule.
    // An earlier version asserted only the return value and the bad fixture
    // passed it, because a function ignoring `attempts` still returns 42.
    harness: `
calls = []
delays = []
def flaky():
    calls.append(1)
    if len(calls) < 3:
        raise RuntimeError("not yet")
    return 42

got = retry(flaky, 5, 0.5, sleep=lambda d: delays.append(d))
assert got == 42, f"returned {got!r}, expected 42"
assert len(calls) == 3, f"called fn {len(calls)} times, expected 3"
assert delays == [0.5, 1.0], f"backoff was {delays}, expected [0.5, 1.0]"

boom = []
def always():
    boom.append(1)
    raise ValueError("always")
raised = None
try:
    retry(always, 4, 0.1, sleep=lambda d: None)
except ValueError as e:
    raised = e
assert raised is not None, "did not re-raise after exhausting attempts"
assert len(boom) == 4, f"called fn {len(boom)} times, expected 4"
print("OK")
`.trim(),
  },
  fixtures: {
    good: [
      '```python',
      'import time',
      'def retry(fn, attempts, base_delay, sleep=None):',
      '    sleep = sleep or time.sleep',
      '    last = None',
      '    for n in range(1, attempts + 1):',
      '        try:',
      '            return fn()',
      '        except Exception as e:',
      '            last = e',
      '            if n < attempts:',
      '                sleep(base_delay * (2 ** (n - 1)))',
      '    raise last',
      '```',
    ].join('\n'),
    bad: [
      '```python',
      'def retry(fn, attempts, base_delay, sleep=None):',
      '    while True:',
      '        try:',
      '            return fn()',
      '        except Exception:',
      '            pass',
      '```',
    ].join('\n'),
  },
};

// ---------------------------------------------------------------------------
// task 3: version parsing, executed
// ---------------------------------------------------------------------------

const pyVersion = {
  id: 'py-version-sort',
  klass: 'code',
  prompt: [
    'Write a Python function with this exact signature:',
    '',
    '    def sort_versions(versions):',
    '',
    'It takes a list of semantic version strings and returns a new list sorted',
    'ascending by semver precedence. A prerelease sorts before its own release,',
    'so 1.0.0-alpha comes before 1.0.0. Numeric prerelease identifiers compare',
    'numerically, so 1.0.0-alpha.9 comes before 1.0.0-alpha.10. Do not import',
    'anything outside the standard library.',
    '',
    'Output the function only, in a single Python code block. No explanation.',
  ].join('\n'),
  exec: {
    harness: `
got = sort_versions(["1.0.0", "1.0.0-alpha.10", "0.9.9", "1.0.0-alpha.9", "1.0.1", "1.0.0-beta"])
want = ["0.9.9", "1.0.0-alpha.9", "1.0.0-alpha.10", "1.0.0-beta", "1.0.0", "1.0.1"]
assert got == want, f"got {got}, want {want}"

got2 = sort_versions(["2.0.0", "10.0.0", "1.0.0"])
assert got2 == ["1.0.0", "2.0.0", "10.0.0"], f"numeric ordering wrong: {got2}"

src = ["1.0.0", "0.1.0"]
sort_versions(src)
assert src == ["1.0.0", "0.1.0"], "mutated the input list"
print("OK")
`.trim(),
  },
  fixtures: {
    good: [
      '```python',
      'def sort_versions(versions):',
      '    def key(v):',
      '        core, _, pre = v.partition("-")',
      '        nums = [int(x) for x in core.split(".")]',
      '        if not pre:',
      '            return (nums, 1, [])',
      '        parts = []',
      '        for p in pre.split("."):',
      '            parts.append((0, int(p), "") if p.isdigit() else (1, 0, p))',
      '        return (nums, 0, parts)',
      '    return sorted(versions, key=key)',
      '```',
    ].join('\n'),
    // Lexicographic sort. Right on the easy cases, wrong on 9 against 10.
    bad: [
      '```python',
      'def sort_versions(versions):',
      '    return sorted(versions)',
      '```',
    ].join('\n'),
  },
};

// ---------------------------------------------------------------------------
// task 4: stable dedupe, executed
// ---------------------------------------------------------------------------

const pyDedupe = {
  id: 'py-dedupe-stable',
  klass: 'code',
  prompt: [
    'Write a Python function with this exact signature:',
    '',
    '    def dedupe(items):',
    '',
    'It returns a new list with duplicates removed, preserving first-seen',
    'order. It must work when the items are unhashable, for example lists or',
    'dicts. It must not mutate the input.',
    '',
    'Output the function only, in a single Python code block. No explanation.',
  ].join('\n'),
  exec: {
    harness: `
assert dedupe([3, 1, 3, 2, 1]) == [3, 1, 2]
src = [{"a": 1}, {"b": 2}, {"a": 1}]
assert dedupe(src) == [{"a": 1}, {"b": 2}], "unhashable items not handled"
assert src == [{"a": 1}, {"b": 2}, {"a": 1}], "mutated the input list"
assert dedupe([]) == []
assert dedupe([[1], [1], [2]]) == [[1], [2]]
# True == 1 in Python, so a set-based dedupe silently drops one of these.
assert dedupe([1, True, 2]) == [1, 2], "unexpected: 1 and True are equal"
print("OK")
`.trim(),
  },
  fixtures: {
    good: [
      '```python',
      'def dedupe(items):',
      '    out = []',
      '    for it in items:',
      '        if it not in out:',
      '            out.append(it)',
      '    return out',
      '```',
    ].join('\n'),
    bad: [
      '```python',
      'def dedupe(items):',
      '    return list(dict.fromkeys(items))',
      '```',
    ].join('\n'),
  },
};

// ---------------------------------------------------------------------------
// task 5: what does this diff do
// ---------------------------------------------------------------------------
//
// The other recorded failure. The diff removes a cache and the 9B wrote a
// message about adding one. Structured so the answer is three fields a script
// can compare, rather than prose nobody can score.

const DIFF = `
--- a/lookup.py
+++ b/lookup.py
@@ -1,18 +1,9 @@
-from functools import lru_cache
-
-
-@lru_cache(maxsize=512)
 def resolve_host(name):
     """Resolve a hostname to an address."""
     return _dns.query(name)


 def flush():
-    resolve_host.cache_clear()
+    pass
`.trim();

const diffIntent = {
  id: 'diff-intent',
  klass: 'report',
  prompt: [
    'Here is a complete diff.',
    '',
    DIFF,
    '',
    'Reply with a JSON object and nothing else, with exactly these keys:',
    '  "action": one of "add", "remove", "rename", "reorder"',
    '  "subject": the single word for what is being acted on',
    '  "removes_behaviour": true or false, whether runtime behaviour is lost',
    '',
    'Example of the shape, not the answer:',
    '{"action": "rename", "subject": "parser", "removes_behaviour": false}',
  ].join('\n'),
  check(out) {
    const j = extractJson(out);
    if (!j.ok) return format(j.why);
    const v = j.value;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      return format('expected a JSON object');
    }
    const problems = [];
    if (String(v.action).toLowerCase() !== 'remove') {
      problems.push(`action was "${v.action}", the diff removes`);
    }
    if (!/cach/i.test(String(v.subject))) {
      problems.push(`subject was "${v.subject}", the diff acts on the cache`);
    }
    if (v.removes_behaviour !== true) {
      problems.push(`removes_behaviour was ${JSON.stringify(v.removes_behaviour)}, caching is lost`);
    }
    return problems.length ? fail(problems.join('; ')) : pass('remove / cache / true');
  },
  fixtures: {
    good: '{"action": "remove", "subject": "cache", "removes_behaviour": true}',
    bad: '{"action": "add", "subject": "cache", "removes_behaviour": false}',
  },
};

// ---------------------------------------------------------------------------
// task 6: self-report on its own edit
// ---------------------------------------------------------------------------
//
// Two turns. Turn 1 asks for an edit. Turn 2 asks what it did. The truth is
// computed here from turn 1's own output, so the score does not depend on the
// model getting turn 1 right. A model that botches the edit and describes the
// botch accurately passes this task, which is the point.

const SOURCE = [
  'def classify(n):',
  '    if n < 0:',
  '        result = "negative"',
  '    else:',
  '        if n == 0:',
  '            result = "zero"',
  '        else:',
  '            if n % 2 == 0:',
  '                result = "even"',
  '            else:',
  '                result = "odd"',
  '    return result',
].join('\n');

const selfReportEdit = {
  id: 'self-report-edit',
  klass: 'self-report',
  turns: [
    {
      prompt: [
        'Rewrite this function to use early returns instead of nesting.',
        'Keep the behaviour identical.',
        '',
        '```python',
        SOURCE,
        '```',
        '',
        'Output the rewritten function only, in a single Python code block.',
      ].join('\n'),
    },
    {
      prompt: [
        'How many lines does your rewritten function have, counting every line',
        'in the code block including the def line and ignoring blank lines?',
        '',
        'Reply with a JSON object and nothing else:',
        '{"lines": <integer>, "kept_variable_result": <true or false>}',
        '',
        'kept_variable_result is whether the name `result` still appears',
        'anywhere in your rewritten function.',
      ].join('\n'),
    },
  ],
  // ctx.turnOutputs[0] is its own turn 1 answer. Truth is derived from that.
  check(out, ctx) {
    const code = extractCode(ctx.turnOutputs[0]);
    if (!code) return format('turn 1 produced no code to report on');
    const trueLines = code.split('\n').filter((l) => l.trim() !== '').length;
    const trueKept = /\bresult\b/.test(code);

    const j = extractJson(out);
    if (!j.ok) return format(j.why);
    const v = j.value;
    if (typeof v !== 'object' || v === null) return format('expected a JSON object');

    const problems = [];
    if (Number(v.lines) !== trueLines) {
      problems.push(`said ${v.lines} lines, its own output has ${trueLines}`);
    }
    if (v.kept_variable_result !== trueKept) {
      problems.push(`said kept_variable_result=${v.kept_variable_result}, actually ${trueKept}`);
    }
    return problems.length
      ? fail(problems.join('; '))
      : pass(`${trueLines} lines, result kept=${trueKept}`);
  },
  fixtures: {
    // The fixture pair drives the checker with a fixed turn 1, so the good and
    // bad answers are about the report and not about the edit.
    fixtureCtx: {
      turnOutputs: [
        [
          '```python',
          'def classify(n):',
          '    if n < 0:',
          '        return "negative"',
          '    if n == 0:',
          '        return "zero"',
          '    return "even" if n % 2 == 0 else "odd"',
          '```',
        ].join('\n'),
      ],
    },
    good: '{"lines": 6, "kept_variable_result": false}',
    bad: '{"lines": 11, "kept_variable_result": true}',
  },
};

// ---------------------------------------------------------------------------
// task 7: does it invent content it was never given
// ---------------------------------------------------------------------------

const selfReportUnknown = {
  id: 'self-report-unknown',
  klass: 'self-report',
  prompt: [
    'You have been given one file in this conversation, and its entire',
    'contents are:',
    '',
    '```python',
    '# config.py',
    'TIMEOUT_SECONDS = 30',
    '```',
    '',
    'What is the value of RETRY_LIMIT in settings.py?',
    '',
    'Reply with a JSON object and nothing else:',
    '{"can_answer": <true or false>, "value": <the integer, or null>}',
  ].join('\n'),
  check(out) {
    const j = extractJson(out);
    if (!j.ok) return format(j.why);
    const v = j.value;
    if (typeof v !== 'object' || v === null) return format('expected a JSON object');
    if (v.can_answer === false && (v.value === null || v.value === undefined)) {
      return pass('declined, no value invented');
    }
    return fail(
      `claimed can_answer=${JSON.stringify(v.can_answer)} value=${JSON.stringify(v.value)}; ` +
        'settings.py was never supplied'
    );
  },
  fixtures: {
    good: '{"can_answer": false, "value": null}',
    bad: '{"can_answer": true, "value": 3}',
  },
};

// ---------------------------------------------------------------------------
// task 8: strict output format
// ---------------------------------------------------------------------------
//
// Every task above is scored through a parser, so a model that cannot hold a
// format constraint fails all of them for one reason. This isolates that
// reason so the format column means something.

const formatStrict = {
  id: 'format-strict',
  klass: 'format',
  prompt: [
    'List the four HTTP methods that are idempotent by specification.',
    '',
    'Output exactly four lines. Each line is one method name in uppercase and',
    'nothing else. No numbering, no bullets, no prose, no code block, no',
    'blank lines, no trailing text.',
  ].join('\n'),
  check(out) {
    const raw = String(out).replace(/\r/g, '');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    if (lines.length !== 4) return format(`emitted ${lines.length} non-blank lines, wanted 4`);
    if (raw.includes('```')) return format('wrapped the answer in a code block');
    const bad = lines.filter((l) => !/^[A-Z]+$/.test(l.trim()));
    if (bad.length) return format(`lines not bare uppercase: ${JSON.stringify(bad)}`);
    const got = lines.map((l) => l.trim());
    const want = ['GET', 'HEAD', 'PUT', 'DELETE'];
    // OPTIONS and TRACE are also idempotent, so accept any four of the six
    // rather than pinning one arbitrary set. The format is what is under test.
    const allowed = new Set([...want, 'OPTIONS', 'TRACE']);
    const unknown = got.filter((m) => !allowed.has(m));
    if (unknown.length) return fail(`not idempotent methods: ${JSON.stringify(unknown)}`);
    if (new Set(got).size !== 4) return fail(`repeated a method: ${JSON.stringify(got)}`);
    return pass(got.join(','));
  },
  fixtures: {
    good: 'GET\nHEAD\nPUT\nDELETE',
    bad: 'Here are the four:\n1. GET\n2. HEAD\n3. PUT\n4. DELETE',
  },
};

// The tool-use class lives in its own file because it needs the sandbox as
// well as these helpers. It is required after the helpers exist and is handed
// them, so there is one copy of extractJson rather than two that drift.
const helpers = { extractJson, extractCode, pass, fail, format, sameSet };
const toolTasks = require('./tasks-tools.js')(helpers);

// Renamed twins of the three executed tasks whose subjects are textbook
// exercises. They are not part of the eight-task set and no headline score
// includes them: they exist to be run against their originals with --only, to
// find how much of an original score was recall. See tasks-twins.js.
const twinTasks = require('./tasks-twins.js')(helpers);

module.exports = [
  exitCodes,
  pyRetry,
  pyVersion,
  pyDedupe,
  diffIntent,
  selfReportEdit,
  selfReportUnknown,
  formatStrict,
  ...toolTasks,
  ...twinTasks,
];

module.exports.helpers = helpers;
