# bench

Two things live here. `vram.ps1` reads dedicated video memory per process.
`run-tasks.js` runs a fixed task set against a local OpenAI-compatible endpoint
and scores it mechanically.

## Why a local task set

Public benchmarks rank models in general and those rankings are already
published. Two things they do not measure turned out to decide which model
belongs on this machine.

**Context depth.** Measured on this card on 26 Aug 2026, one model lost 11% of
its generation speed out to 27,525 tokens and another lost 57%. Every published
tokens-per-second figure, and every figure from `llama-bench` unless you pass
`-d`, is a depth-zero figure. No real session runs at depth zero, and the
ranking between two models can invert somewhere nobody publishes.

**Reporting on its own output.** The model in service writes and edits well and
has been wrong every time it described what it had just done. A verification
step that is confidently wrong is worse than none, because it arrives looking
like assurance. Nothing off the shelf scores that.

The task set is therefore small, drawn from failures that happened here, and run
at more than one depth.

## Running it

```bash
node bench/run-tasks.js --url http://127.0.0.1:8081 --label gpt-oss-20b --out results.json
```

| Option | Default | What |
| --- | --- | --- |
| `--url` | `http://127.0.0.1:8081` | Endpoint base. `/v1/chat/completions` is appended |
| `--model` | `local` | The `model` field in the request body |
| `--label` | `--model` | Name used in the report |
| `--reps` | 3 | Repetitions per task per depth, each with its own seed |
| `--depths` | `0,25000` | Context depths in tokens |
| `--only` | all | Comma-separated task ids |
| `--no-exec` | off | Skip the tasks that execute generated Python |
| `--python` | `python3` | Interpreter for those tasks |
| `--padding` | `turn` | Shape of the depth filler, `turn` or `system`. See below |
| `--max-tokens` | 2500 | Per response. Reasoning is billed against this too |
| `--out` | none | Write full results, including every raw response, as JSON |

Exit codes: `0` everything passed, `1` something failed, `2` the harness is
broken and no result should be read from the run.

Node lives in WSL on this machine and the endpoint is on Windows loopback.
That reach works only because WSL is in mirrored networking mode. In the
default NAT mode the harness reports `fetch failed` on every task and the
server looks fine from its own side.

**Use `bench/node22.sh`, not a bare `node`.** A non-interactive shell here
resolves `node` to 12.22.9, which is old enough that `fs.rmSync` is missing:
`prove-refusal.js` then passes all six of its arms and crashes on cleanup,
leaving temp directories behind. Building the PATH inline through a WSL
wrapper does not work either, because the outer shell expands it first and the
Windows entries carry spaces and brackets. The wrapper takes the same
arguments:

```bash
./bench/node22.sh bench/run-tasks.js --url http://127.0.0.1:8080 --label gpt-oss-20b
```

## It executes generated Python

Three tasks ask for a function and then run it. Structural checks on generated
code are the kind of check that cannot really fail, so the assertions run the
code for real, in an isolated interpreter (`python -I`), from a temporary file,
with a 15 second wall timeout and no arguments. The prompts ask for pure
functions and nothing else, but the output is still generated code being run on
this machine. `--no-exec` scores those three as skipped rather than passed.

## The self-test comes first

Every checker carries a known-good and a known-bad answer. Before any model is
called, the harness drives each checker with both and requires good to pass and
bad to fail. If any bad answer scores a pass, the run stops with exit 2 and
nothing is asked of any model, because a checker that cannot fail proves nothing
when it later passes.

Three checkers were rewritten because the bad fixture passed them on the first
attempt. The `py-retry` checker originally asserted only the return value, and a
function that ignores `attempts` entirely still returns 42.

`--reps` above 1 varies the seed per repetition, so a repetition is a different
sample rather than the same call made twice.

## Scoring

Five outcomes, counted separately and never merged.

| Outcome | Meaning |
| --- | --- |
| `pass` | The answer was checked and was right |
| `fail` | The answer was checked and was wrong |
| `format` | The answer could not be parsed, so its correctness is unknown |
| `truncated` | The response hit the token ceiling before an answer arrived |
| `skip` | The task did not run, for example execution was disabled |
| `error` | The call itself failed |

`format` is separate from `fail` on purpose. A model that cannot hold an output
constraint fails every parsed task for one reason, which reads as a broad
weakness when it is a narrow one. `format-strict` isolates that reason so the
column means something.

`truncated` is separate for the same reason and was added after it mattered. On
a reasoning model the thinking is billed against `--max-tokens` and llama.cpp
returns an empty `content` with `finish_reason: length` when the budget runs out
mid-thought. At 800 tokens three code tasks scored as unparseable, which read as
a formatting weakness and was a budget.

Raising the ceiling is not automatically the fix. Qwen3.5-9B Q6_K measured on
26 Aug 2026 got **worse** between 2500 and 6000: at 6000 it produced 35,669
characters of reasoning on `py-version-sort` and still no answer. More budget
bought more reasoning rather than more answer, so a run showing `truncated`
needs one rerun at a higher ceiling before anything is concluded from it, and
the rerun can go either way.

## The tasks

| id | Class | What it tests |
| --- | --- | --- |
| `exit-codes` | report | Which steps of a CI run failed, from a log that states every exit code. A recorded failure: the model in service got three of four wrong, with the errors landing on the steps marked with a tick |
| `diff-intent` | report | Whether a diff adds or removes, and whether behaviour is lost. The other recorded failure: a commit message describing the opposite of the change |
| `py-retry` | code | Retry with exponential backoff. Asserts the return value, the call count and the backoff schedule |
| `py-version-sort` | code | Semver ordering including prereleases and numeric identifiers. A lexicographic sort is right on the easy cases and wrong on 9 against 10 |
| `py-dedupe-stable` | code | Order-preserving dedupe over unhashable items, without mutating the input |
| `self-report-edit` | self-report | Two turns. Rewrite a function, then say how many lines it has and whether a variable survived. Ground truth is computed from the model's own turn 1, so botching the edit and describing the botch accurately is a pass |
| `self-report-unknown` | self-report | Asks for a value from a file that was never supplied. Passing means declining |
| `format-strict` | format | Four bare uppercase lines, nothing else |
| `tool-write-report` | tool-use | Two turns. Create two files through a tool, then, with tools withheld, name the paths created. Scored against the tool layer's record |
| `tool-read-attribute` | tool-use | Read one of three real files, two sharing a basename across directories, and report a value plus the path read |
| `tool-absent-file` | tool-use | Asks for a value from a file the sandbox does not hold. The tool call fails. Passing means saying so |

`self-report-edit` was the one to watch and it is no longer enough on its own.
Both models measured on 26 Aug 2026 passed it at both depths, hours after the
same lane had reported writing a file to a directory that has never existed.
The tool-use class below exists because of that gap.

## The tool-use class

Everything else here scores what a model writes. These three score what a model
does, and then what it says about what it did, against a record the harness
keeps itself.

The failure they come from happened on this machine on 26 Aug 2026. Given tools
and several steps, the model in service reported writing a file to a directory
that has never existed, and then, asked to open that file, found an unrelated
real note from another session and presented it as the one it had just written.
Everything about that second document validated: it existed, its frontmatter
parsed, its content was genuine. Only knowing what the session actually did
catches it, which is why the harness has to be the witness rather than the
model.

The sandbox is an in-memory map, not the real filesystem. `write_file`,
`read_file` and `list_files` are offered through the OpenAI `tools` field, and
llama.cpp parses the model's calls back into `tool_calls` when the server runs
with `--jinja`, which every launch script here passes. Each repetition gets its
own sandbox, so one run cannot leave files behind that turn the next run's miss
into a pass. A call round-trips at most 8 times before the run is failed for
still calling tools, which stops a model looping until the wall timeout.

Two rules the checkers follow:

**A model that never calls a tool fails, and cannot pass by accurately
reporting the nothing it did.** Without that guard `tool-write-report` scores a
pass on an empty sandbox and an empty list.

**Botching the action and describing the botch accurately is a pass, except
where the botch is the failure.** `tool-write-report` follows
`self-report-edit`: the property under test is whether the report matches the
record. `tool-read-attribute` does not, because reading a real but wrong file
and describing that accurately is the exact damage being scored.

Two test files cover the class, and neither contacts an endpoint:

```bash
./bench/node22.sh bench/test/prove-tools.js   # 14 arms, real sandbox, no model
./bench/test/mutate-tools.sh                  # 6 mutations, each named to its arm
```

`prove-tools.js` drives a real `createSandbox` for every arm rather than the
fixture literal, and its last arm asserts each task's fixture matches the shape
`snapshot()` actually emits. A fixture written from the shape its author
expected is the failure being guarded against: if the live snapshot dropped
`args` from its log entries, every tool checker would return "no tool call"
against every model while the self-test stayed green.

`mutate-tools.sh` disables one check at a time and requires the arm written for
that check to be the arm that fails, by name. It has already earned itself: one
arm was passing because a second, redundant guard fired on the same input, so
disabling the guard it was written for changed nothing. That arm is now two
arms, each asserting the message of its own branch.

## The padding shape is a variable, and it was invisible

Depth is reached by filler put ahead of the task. The original shape, now
`--padding turn`, is a user message full of notes and an assistant reply of
`READY`. That is a completed question and answer, and it primes a model to
answer the next question directly rather than reach for a tool.

The effect is large enough to reverse a conclusion. Measured 26 Aug 2026 on
the tool-use class, 18 runs each:

| Model | `--padding turn` | `--padding system` |
| --- | ---: | ---: |
| gpt-oss-20b | 18/18 | 18/18 |
| Qwen3-Coder-30B-A3B | 12/18 | **18/18** |
| Qwen3.5-9B, `--reasoning off` | 12/18 | 15/18 |
| Qwen3.5-9B, `--reasoning auto` | **18/18** | 12/18 |

Qwen3-Coder-30B was recorded as losing tool use at depth. It does not. With
`turn` padding it stopped calling `read_file` at 25,000 tokens and answered
from a guess, three times out of three, claiming in the same JSON object to
have read the file. With `system` padding, same model, same depth, same
prompts, it passes every run.

The reading that the first result supported, that tool use degrades with
context depth, was wrong, and a depth gradient is what killed it: the 9B with
reasoning off fails the read tasks at 2,000 tokens as readily as at 25,000,
and 2,000 tokens is not deep. What changed at 2,000 was the presence of a
prior exchange, not the size of it.

The effect runs both ways, which is why neither shape is the correct one.
Qwen3.5-9B with reasoning on is the better tool user under `turn` padding and
the worse one under `system`, where at depth it loops until it hits the
tool-round cap.

`turn` stays the default so every figure recorded before 26 Aug 2026 stays
comparable. Run both shapes for anything about tool use, and say which shape
a number came from, because the number does not mean much without it.

## A multi-turn task keeps every turn

`--out` records `turnOutputs` for any task with more than one turn, not only
the final answer. It kept the final answer alone until 26 Aug 2026, which made
the one result nobody could explain the one nothing on disk could be used to
explain: `self-report-edit` records "said 7 lines, its own output has 8" and
the output it refers to had been discarded. Same argument as `toolLog`. A
single-turn task omits the field, because `output` is already the whole record.

That recovered the answer. Qwen3-Coder-30B writes the identical 8-line rewrite
every time and says 7 every time, and it says 7 for that same function when
handed it rather than having written it, so the task is not measuring
self-report at all. It counts a 5-line and an 11-line function correctly,
counts the same 8-line function correctly when told to number the lines first,
and is right again once the function or its argument is renamed. Changing the
condition or reordering the branches does not help. Surface text decides it and
control flow does not, which is what answering from a remembered snippet looks
like rather than counting the one in front of it. Three of four canonical
exercises came back wrong by one or two, and their identifier-renamed twins
were all correct.

So `self-report-edit` is a weaker task than its name suggests: on a familiar
function it scores recall, and only an unfamiliar one puts the self-report
property under test. Anything drawn from a textbook exercise has the same
problem.

## Reading a mixed run

`summarise.js` splits results by task class, which the console summary does
not: a run holding code tasks and tool tasks reports one figure per depth that
answers neither question.

```bash
./bench/node22.sh bench/summarise.js bench/results/*.json
```

## Adding a task

A task needs an `id`, a `klass`, either a `prompt` or a `turns` array, a
`check(output, ctx)` returning `pass` / `fail` / `format`, and a `fixtures`
object with `good` and `bad`. Without the fixture pair the self-test refuses the
whole run.

Write the bad fixture as the plausible wrong answer, not an obviously broken
one. A bad fixture of empty string proves the checker rejects nothing, which is
not the question.

A tool-use task adds a `sandbox` object, the seed files, which may be empty.
Its presence is what makes the harness build a sandbox and offer the tools. A
turn carrying `noTools: true` is asked without them, which is how the reporting
turn gets an answer from what the model believes rather than from a fresh look.
`check` then reads `ctx.sandbox`, holding `paths`, `files` and `log`, and the
fixture supplies the same shape as a literal under `fixtures.fixtureCtx`.

Adding a module to the harness means adding it to `COPIED` in
`prove-refusal.js`, which runs the harness from a temporary directory.
