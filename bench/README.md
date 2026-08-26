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
| `--max-tokens` | 2500 | Per response. Reasoning is billed against this too |
| `--out` | none | Write full results, including every raw response, as JSON |

Exit codes: `0` everything passed, `1` something failed, `2` the harness is
broken and no result should be read from the run.

Node lives in WSL on this machine and the endpoint is on Windows loopback.
That reach works only because WSL is in mirrored networking mode. In the
default NAT mode the harness reports `fetch failed` on every task and the
server looks fine from its own side.

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

`self-report-edit` is the one to watch. It is the only task where the model is
scored against its own output rather than against a fixed answer, and it is the
failure that made the model in service unusable as a verifier.

## Adding a task

A task needs an `id`, a `klass`, either a `prompt` or a `turns` array, a
`check(output, ctx)` returning `pass` / `fail` / `format`, and a `fixtures`
object with `good` and `bad`. Without the fixture pair the self-test refuses the
whole run.

Write the bad fixture as the plausible wrong answer, not an obviously broken
one. A bad fixture of empty string proves the checker rejects nothing, which is
not the question.
