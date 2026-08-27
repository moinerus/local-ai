# Roadmap: taking this repo public

Private as of 27 August 2026, and nothing here has been published. This file
records the release plan so it can be picked up cold, months later, without
rebuilding the reasoning.

## Where it stands

A redaction pass ran on 27 August 2026 across every tracked file and the whole
commit history.

**F1. There is no employer, client or colleague reference anywhere in the
tree.** Zero matches for any work system, project name or ticket prefix. Both
fixtures are wholly synthetic: the decoy report describes a made-up sorting bug
in a file that exists only inside the fixture. The control for that scan fired,
so the zero is a real zero rather than a broken query.

**F2. The history is clean.** No session log, no `.log`, no `.gguf` and no
`.env` has ever been committed on any branch. `.gitignore` landed early enough.
The one deleted file, `serve/claude-local.ps1`, sets `ANTHROPIC_AUTH_TOKEN` to
`local` against a keyless server, which is a placeholder rather than a secret.
So visibility can be flipped on this repo rather than squashing into a fresh
one, and the commit messages survive. They carry a fair share of the value here,
because each one records what was wrong before it was right.

**F3. The only blocker is hardcoded paths, and it is a portability problem
rather than a privacy one.** Thirteen lines across eight files, listed under A1.
A username in a path is not a secret. It only makes the repo unrunnable for
anyone else.

Re-run F1 and F2 against the working tree immediately before flipping, never
against the last commit. A scan of a commit says nothing about what is staged
beside it.

## What goes public, ranked

**P1. The session recorder and scorer.** `serve/record-proxy.js`,
`bench/score-session.js`, `serve/run-live-session.sh`, both fixtures, and the
proof and mutation suites under `serve/test/`. This is the piece with no
equivalent elsewhere. Published work on local coding models scores the model's
answer. This scores the model's account of itself against the wire record and
against what changed on disk, and keeps three things apart that everyone else
merges: what was asked for, what came back, and what changed. It also has the
least platform coupling in the repo, because it works against any
Anthropic-compatible endpoint and knows nothing about AMD, Vulkan or Windows.
If only one thing goes out, it is this.

**P2. The benchmark harness.** `bench/run-tasks.js`, `bench/tasks.js`,
`bench/tasks-tools.js`, `bench/tasks-twins.js`, `bench/sandbox.js`,
`bench/summarise.js` and `bench/test/`. Depth arms, a padding-shape control,
every checker driven against a good and a bad fixture before any model runs,
mutation runs requiring each arm to kill its own mutant, and the renamed twins
for detecting recall. Most local model benchmarks are a scoring function nobody
proved could go red. `bench/test/` is the argument that this one is not, and it
is as much of the value as the harness itself.

**P3. The measurements.** `bench/results/`, sixteen dated files and about 1.0 MB,
plus the tables in `README.md`. These are the evidence behind every claim made
about this work anywhere else, and a claim nobody can check is worth less than
one they can.

**P4. The launch scripts.** `serve/gptoss.ps1`, `serve/qwen.ps1`,
`serve/qwen3coder.ps1`, `bench/vram.ps1`, `serve/status.ps1` and the patched
chat template. Narrow audience, being an RX 9070 XT on Windows under Vulkan, but
that audience has almost nothing written for it, and the `-dev Vulkan0` and
`-ncmoe` findings are not on any page found while doing this work.

## What stays private

`.gitignore` is the control, it is already written, and its reasoning is inline.
None of this is a manual step at release time.

- Recorded sessions, `bench/results/*.jsonl`. A proxy log holds every tool call,
  every file the tools handed back, and the absolute path each came from. The
  scored summary travels. The log stays on the machine that recorded it.
- Model weights and binaries.
- `logs/`, which holds server stdout.

The dated exception in `.gitignore` keeps baseline result files and drops
scratch runs. Confirm that rule still does what it claims before flipping,
because a results file is the one thing in that directory meant to be published,
and an ignore rule that over-matches would silently take P3 with it.

## The model recommender

**R1. This is the one item on the wish list that the repo's own findings argue
against.** Every "will this model fit my card" calculator does headroom
arithmetic against a spec-sheet memory figure and a published tokens-per-second
number. The four central findings here are that this method was wrong on this
machine four separate times: the desktop's own video memory use is a range
rather than a number, negative headroom is not the refusal it reads as, file
size never bound the sparse 30B once `-ncmoe` moved the experts into system RAM,
and every published tokens-per-second figure is a depth-zero figure against a
loss reaching 57% at working depth. The figures for all four are in `README.md`
and are deliberately not repeated here, so that correcting one corrects it once.
A recommender fed spec sheets reproduces the exact error this repo exists to
correct.

**R2. It is also one card, three models, one day.** That does not support a
lookup table, and a lookup table is what a recommender is.

**R3. The shape that survives both objections is a measurement tool, not a
database.** Run `bench/vram.ps1` with nothing loaded, run `llama-bench` at two
depths, then print what this machine can actually hold and how fast, with the
naive arithmetic shown alongside so the gap between the two is visible. It
recommends from the machine in front of it rather than from a specification.
Most of it is existing scripts behind one entry point. Nothing has been built.

## Options for repo shape

**O1, recommended. Flip this repo to public after A1 to A4.** The history is
clean, and the findings are interlinked: a benchmark result means little without
the memory measurement and the launch config beside it, and splitting them means
maintaining the same machine description in more than one place.

**O2. Extract P1 into its own repo now.** Widest audience and least platform
coupling. Against it: this splits the evidence, needs a second README restating
the whole setup, and costs real work before anyone has shown they want it.

**O3. Both, in that order.** Publish as O1, and extract as O2 only if P1 draws
interest. Extraction is cheap once it is wanted, and free if it never is.

## Work before flipping

**A1. Replace the thirteen hardcoded paths with environment variables and add
`.env.example`.** In full, so this needs no rediscovery:

| File | Line | What |
| --- | ---: | --- |
| `bench/node22.sh` | 20 | `NODE=` pinned to one nvm patch version |
| `bench/test/mutate-tools.sh` | 17 | `REPO=` literal |
| `serve/claude-local.sh` | 16 | comment naming a user profile path |
| `serve/claude-local.sh` | 38, 39 | usage text naming launcher paths |
| `serve/gptoss.ps1` | 85, 86 | `$Exe`, `$Model` |
| `serve/qwen.ps1` | 89, 90 | `$Exe`, `$Model` |
| `serve/qwen3coder.ps1` | 83, 84 | `$Exe`, `$Model` |
| `serve/run-live-session.sh` | 31 | `REPO=` literal |
| `serve/test/mutate-proxy.sh` | 22 | `REPO=` literal |

Proposed variables: `LLAMA_EXE` and `MODEL_DIR` for the launchers. Derive `REPO`
from `git rev-parse --show-toplevel` rather than any literal. Resolve `NODE` by
finding a v22 install under the nvm directory rather than pinning a patch
version, since pinning is what makes it break on the next machine. The
`claude-local.sh` comment should name `%USERPROFILE%\.wslconfig`, which is the
correct instruction anyway.

**A2. Re-run all four proof suites, both mutation runs, and one live session end
to end after A1.** A path change is precisely the class of edit that leaves every
offline test green while breaking the thing that actually runs, and three of the
edits above are inside the test harness itself.

**A3. Add a licence.** MIT unless there is a reason not to.

**A4. Add a scope paragraph to the top of `README.md`.** One machine, one day,
three models, and the numbers are readings rather than a specification. Without
it the tables read as general claims about these models, which they are not.

**A5. Flip visibility, having re-run F1 and F2 against the working tree.**

A1 and A2 together are about an hour. A3 and A4 are minutes.

## Do not

- Do not flip visibility on the strength of a scan older than the working tree.
- Do not commit a session log, whatever the ignore rules happen to say that day.
- Do not present the measurements as generalisable. They are one machine on one
  day, and saying so is what makes the rest of it trustworthy.
- Do not build the recommender as a spec-sheet lookup. See R1.
