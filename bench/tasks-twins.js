// Renamed twins of the three executed code tasks whose subjects are textbook
// exercises: retry with exponential backoff, semantic version ordering, and
// order-preserving deduplication.
//
// Why these exist. `self-report-edit` turned out to be scoring recall of a
// canonical snippet rather than the property it was written for: the model
// answered from a remembered version of the function, and every ablation that
// changed a name fixed it while every ablation that changed the logic did not.
// The obvious next question is how much of the rest of the set has the same
// hole. Three of the eight tasks ask for functions that appear in every
// tutorial on the subject, and a model that has memorised a correct
// implementation scores the same as one that can write it.
//
// A twin keeps the specification identical, assertion for assertion, and
// changes only the surface text: the function name, the parameter names and
// the domain vocabulary. If a model scores the same on both, the original was
// measuring the capability. If it scores worse on the twin, part of the
// original score was recall.
//
// Known limitation: renaming is not a perfectly controlled change. It moves
// token counts slightly and it removes whatever help a familiar name gives in
// simply understanding the request. So a gap is evidence that the original
// score was not purely capability, and is not a measurement of how much of it
// was recall.
//
// Required by tasks.js and handed the shared helpers, so there is one copy of
// extractCode rather than two that drift.

'use strict';

module.exports = function twins() {
  // ---------------------------------------------------------------------
  // twin of py-retry
  // ---------------------------------------------------------------------

  const twinRetry = {
    id: 'twin-retry',
    klass: 'code',
    twinOf: 'py-retry',
    prompt: [
      'Write a Python function with this exact signature:',
      '',
      '    def attempt_with_backoff(action, max_tries, first_pause, pause=None):',
      '',
      'It calls action() and returns its result. If action() raises, it tries',
      'again, up to `max_tries` total calls. Between try n and try n+1 it calls',
      'pause(first_pause * (2 ** (n - 1))), where n starts at 1. If `pause` is',
      'None it uses time.sleep. If every try raises, it re-raises the last',
      'exception. Return the value on the first success.',
      '',
      'Output the function only, in a single Python code block. No explanation.',
    ].join('\n'),
    exec: {
      harness: `
calls = []
pauses = []
def flaky():
    calls.append(1)
    if len(calls) < 3:
        raise RuntimeError("not yet")
    return 42

got = attempt_with_backoff(flaky, 5, 0.5, pause=lambda d: pauses.append(d))
assert got == 42, f"returned {got!r}, expected 42"
assert len(calls) == 3, f"called action {len(calls)} times, expected 3"
assert pauses == [0.5, 1.0], f"backoff was {pauses}, expected [0.5, 1.0]"

boom = []
def always():
    boom.append(1)
    raise ValueError("always")
raised = None
try:
    attempt_with_backoff(always, 4, 0.1, pause=lambda d: None)
except ValueError as e:
    raised = e
assert raised is not None, "did not re-raise after exhausting tries"
assert len(boom) == 4, f"called action {len(boom)} times, expected 4"
print("OK")
`.trim(),
    },
    fixtures: {
      good: [
        '```python',
        'import time',
        'def attempt_with_backoff(action, max_tries, first_pause, pause=None):',
        '    pause = pause or time.sleep',
        '    last = None',
        '    for n in range(1, max_tries + 1):',
        '        try:',
        '            return action()',
        '        except Exception as e:',
        '            last = e',
        '            if n < max_tries:',
        '                pause(first_pause * (2 ** (n - 1)))',
        '    raise last',
        '```',
      ].join('\n'),
      bad: [
        '```python',
        'def attempt_with_backoff(action, max_tries, first_pause, pause=None):',
        '    while True:',
        '        try:',
        '            return action()',
        '        except Exception:',
        '            pass',
        '```',
      ].join('\n'),
    },
  };

  // ---------------------------------------------------------------------
  // twin of py-version-sort
  // ---------------------------------------------------------------------

  const twinVersion = {
    id: 'twin-version-sort',
    klass: 'code',
    twinOf: 'py-version-sort',
    prompt: [
      'Write a Python function with this exact signature:',
      '',
      '    def order_releases(tags):',
      '',
      'It takes a list of release tag strings and returns a new list sorted',
      'ascending by semantic version precedence. A prerelease sorts before its',
      'own release, so 1.0.0-alpha comes before 1.0.0. Numeric prerelease',
      'identifiers compare numerically, so 1.0.0-alpha.9 comes before',
      '1.0.0-alpha.10. Do not import anything outside the standard library.',
      '',
      'Output the function only, in a single Python code block. No explanation.',
    ].join('\n'),
    exec: {
      harness: `
got = order_releases(["1.0.0", "1.0.0-alpha.10", "0.9.9", "1.0.0-alpha.9", "1.0.1", "1.0.0-beta"])
want = ["0.9.9", "1.0.0-alpha.9", "1.0.0-alpha.10", "1.0.0-beta", "1.0.0", "1.0.1"]
assert got == want, f"got {got}, want {want}"

got2 = order_releases(["2.0.0", "10.0.0", "1.0.0"])
assert got2 == ["1.0.0", "2.0.0", "10.0.0"], f"numeric ordering wrong: {got2}"

src = ["1.0.0", "0.1.0"]
order_releases(src)
assert src == ["1.0.0", "0.1.0"], "mutated the input list"
print("OK")
`.trim(),
    },
    fixtures: {
      good: [
        '```python',
        'def order_releases(tags):',
        '    def key(v):',
        '        core, _, pre = v.partition("-")',
        '        nums = [int(x) for x in core.split(".")]',
        '        if not pre:',
        '            return (nums, 1, [])',
        '        parts = []',
        '        for p in pre.split("."):',
        '            parts.append((0, int(p), "") if p.isdigit() else (1, 0, p))',
        '        return (nums, 0, parts)',
        '    return sorted(tags, key=key)',
        '```',
      ].join('\n'),
      bad: [
        '```python',
        'def order_releases(tags):',
        '    return sorted(tags)',
        '```',
      ].join('\n'),
    },
  };

  // ---------------------------------------------------------------------
  // twin of py-dedupe-stable
  // ---------------------------------------------------------------------

  const twinDedupe = {
    id: 'twin-dedupe',
    klass: 'code',
    twinOf: 'py-dedupe-stable',
    prompt: [
      'Write a Python function with this exact signature:',
      '',
      '    def first_occurrences(entries):',
      '',
      'It returns a new list holding only the first appearance of each distinct',
      'entry, in the order those first appearances happened. It must work when',
      'the entries are unhashable, for example lists or dicts. It must not',
      'mutate the input.',
      '',
      'Output the function only, in a single Python code block. No explanation.',
    ].join('\n'),
    exec: {
      harness: `
assert first_occurrences([3, 1, 3, 2, 1]) == [3, 1, 2]
src = [{"a": 1}, {"b": 2}, {"a": 1}]
assert first_occurrences(src) == [{"a": 1}, {"b": 2}], "unhashable entries not handled"
assert src == [{"a": 1}, {"b": 2}, {"a": 1}], "mutated the input list"
assert first_occurrences([]) == []
assert first_occurrences([[1], [1], [2]]) == [[1], [2]]
# True == 1 in Python, so a set-based approach silently drops one of these.
assert first_occurrences([1, True, 2]) == [1, 2], "unexpected: 1 and True are equal"
print("OK")
`.trim(),
    },
    fixtures: {
      good: [
        '```python',
        'def first_occurrences(entries):',
        '    out = []',
        '    for it in entries:',
        '        if it not in out:',
        '            out.append(it)',
        '    return out',
        '```',
      ].join('\n'),
      bad: [
        '```python',
        'def first_occurrences(entries):',
        '    return list(dict.fromkeys(entries))',
        '```',
      ].join('\n'),
    },
  };

  return [twinRetry, twinVersion, twinDedupe];
};
