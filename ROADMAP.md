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

## What decides whether this is useful to anyone else

**The benchmark harness and the recording proxy have nothing to do with AMD,
Windows, Vulkan or llama.cpp, and nothing in the repo says so.** `run-tasks.js`
takes `--url` and `--model` and speaks OpenAI-compatible HTTP. The proxy sits on
loopback and speaks the Anthropic API. Anyone running Ollama, vLLM or LM Studio
on any card can use both, unchanged, today. But `README.md` opens with a table
of one specific card's specifications, and the layout table lists a Windows-only
PowerShell launcher and a platform-agnostic Node harness in the same column, so
a reader gets three paragraphs in and concludes none of it applies to them.

That framing is the difference between an audience of people who own an
RX 9070 XT and an audience of people who run a local model. It costs an
afternoon. It is worth more than the rest of the list below put together, which
is why W7 to W9 sit above the licence in priority even though the licence is
what makes publication legal.

The second thing that decides it is W10, continuous integration. This repo's
whole argument is that its checkers were proved able to go red. A reader cannot
see that without running everything, and most will not. A green tick per push is
what turns the claim into evidence, and all four suites already run offline.

## Options for repo shape

**O1, recommended. Flip this repo to public after W1 to W13.** The history is
clean, and the findings are interlinked: a benchmark result means little without
the memory measurement and the launch config beside it, and splitting them means
maintaining the same machine description in more than one place.

**O2. Extract P1 into its own repo now.** Widest audience and least platform
coupling. Against it: this splits the evidence, needs a second README restating
the whole setup, and costs real work before anyone has shown they want it.

**O3. Both, in that order.** Publish as O1, and extract as O2 only if P1 draws
interest. Extraction is cheap once it is wanted, and free if it never is.

## Work before flipping

Three groups. Clean is what makes publication safe, portable is what makes the
repo runnable by anyone, and useful is what makes it worth finding. They
supersede an earlier A1 to A5 list, which is folded in as W1 to W5.

Mark each one done in place as it lands, so a cold pickup can tell what is left
without reading the diff.

### Clean

**W1. Replace the thirteen hardcoded paths with environment variables and add
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

**Done.** `LLAMA_EXE` and `MODEL_DIR` for the launchers, with no invented
default: a typed fallback would be wrong on every machine but this one, and
would fail as a missing file rather than as an unset variable, which is the
error that tells someone what to do. `REPO` is derived as
`$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)` rather than from
`git rev-parse --show-toplevel`, which is what this said first: `node22.sh`
already used the `BASH_SOURCE` idiom for the same reason, and it works in a
checkout that is not a git repository. `claude-local.sh` now names
`%USERPROFILE%\.wslconfig` and prints repo-relative launcher paths.

**And `.env.example` was invisible to git, which the file list did not
predict.** `.gitignore` carries `.env.*`, so the one file documenting the two
variables every launcher now needs would never have been committed, and its
absence would have read as having forgotten to write it. `!.env.example` is
now there, proved both ways: the example is untracked and listed, and
`.env.local` is still ignored.

**W2. Re-run all four proof suites, both mutation runs, and one live session end
to end after W1. Done.** A path change is precisely the class of edit that leaves
every offline test green while breaking the thing that actually runs, and three
of the edits above are inside the test harness itself.

`prove-scorer` 13 arms, `prove-tools` all arms, `prove-refusal` all arms,
`prove-proxy` all arms. `mutate-tools` 6 mutations and `mutate-proxy` 12, each
killed by its own named arm, both restoring their source. Then a real session:
llama-server started through the rewritten launcher and served the model out of
`MODEL_DIR`, the recorder took it on 8081, and `run-live-session.sh` copied the
fixture, ran its positive control, drove the session and ran the test after.

The session itself failed, and that is the stronger result. The model wrote a
report claiming it had fixed `src/parser.py`, the test still failed, and the
scorer said why: `MISMATCH written: claimed ["src/parser.py"] which the record
does not show`. It never made the edit. That is the original failure this whole
repository was built to catch, caught by the instrument rather than by someone
noticing, on the fourth recorded session and the first one where it happened.
A clean pass would have proved the chain runs. This proves it still reports.

**W3. Add a licence. Done.** MIT, copyright 2026. Worth recording that writing
it needed a change elsewhere: the prose guard on this machine flags "in
connection with" as a vague-connection tell, which is a phrase the MIT text
contains, and rewording a standard licence to satisfy a prose check makes it a
different licence. The guard now exempts `LICENSE`, `LICENCE`, `COPYING` and
`NOTICE` by filename, proved both ways: the licence writes, and the same phrase
in a file that is not a licence is still blocked.

**W4. Add a scope paragraph to the top of `README.md`. Done**, as a "Scope of
the numbers" section rather than a paragraph, and paired with W13. It says one
card over two days, three models, and that the desktop's own memory use moved by
more than 3 GB while the figures were being taken. It closes on the line that
does the work: the tools are the reusable part, and the tables are evidence that
the tools work.

**W5. Flip visibility, having re-run F1 and F2 against the working tree.** The
owner's call, and no session does it on the owner's behalf.

### Portable

**W6. Stop `bench/node22.sh` pinning an nvm patch version. Done.** It named
`v22.20.0`. It now takes `NODE22` if set, else the highest `v22.*` under
`NVM_DIR`, else a `node` on `PATH` that reports v22 or newer, and exits 2 with
an instruction when there is none. Both arms were run: it resolves v22.20.0
unchanged on this machine and derives the repo root correctly when invoked from
another directory, and with `NVM_DIR` and `HOME` pointed at nothing it exits 2
and says what to set.

**W7. State the prerequisites, which appeared nowhere. Done.** A "What you need"
table with a row per use: the harness, its three executing code tasks, the proxy
and scorer, a live recorded session, and the launch scripts. It also says that
`LLAMA_EXE` and `MODEL_DIR` are read by the launch scripts and by nothing else,
which is the question a reader would otherwise have to answer by grepping.

**W8. Split the layout table into what runs anywhere and what is this machine.
Done.** One table held a Windows-only PowerShell launcher beside a
platform-agnostic Node harness, which is what hid W7 from a reader. Two tables
now, and the portable one comes first. `tasks-twins.js`, `localrun-long/` and
`status.ps1` were missing from the old table and are in.

### Useful

**W9. Reorder `README.md` for a reader who has never seen the machine. Done.**
The order was machine, layout, measurements, with the runnable part below the
tables. It is now: what the two tools are and that neither is AMD or Windows
specific, scope of the numbers, what you need, five minutes, layout in two
tables, the machine, then the readings. The opening paragraph no longer leads
with a card nobody else owns.

**W10. Add CI: a workflow running the four proof suites on push. Done.**
`.github/workflows/proofs.yml`, ten steps on `ubuntu-latest` with Node 22:
`prove-scorer`, `prove-tools`, `prove-refusal`, `prove-proxy`, both mutation
runs, and a final `git diff --exit-code` asserting every mutation restored its
source. All offline, `prove-proxy` starting its own stub upstream rather than
reaching a model. A badge is in the README, which is the point: this repo's
argument is that its checkers were proved able to go red, and until now a reader
had to clone and run everything to see it.

Three things this turned up. **The five shell scripts were not executable in
git**, all mode 100644, because the authoring machine is Windows and does not
store the bit, so `./bench/node22.sh` in the README quickstart would have failed
on any fresh Linux or macOS clone. Now 100755, and `core.filemode false` here
means it costs no local diff noise. **CI is the only place `node22.sh`'s PATH
fallback gets exercised**, since this machine always has nvm, so the runner
proves the arm that cannot be proved at home. And the clean-tree step was proved
both ways before being trusted: exit 1 against a planted change, exit 0 after
restoring it, so it is not a check that can only ever pass.

**W11. Give `serve/` its own README for the proxy and scorer.** They are the most
novel thing here and are currently documented as a section of the root README,
under a heading about one machine. A quickstart that does not assume Claude Code
gets most of the benefit of extracting them into a separate repo, at a fraction
of the cost, and makes that extraction easy later if it turns out to be wanted.

**W12. Put one copy-paste bench command against an arbitrary endpoint in the
first screen of `README.md`. Done.** A "Five minutes" section with the bench
command and the proxy pair, and the default ports for llama.cpp, Ollama and
vLLM so `--url` is obvious. The command was run rather than typed: against a
closed port it self-tests, reports the checker proved able to fail, then errors
on the connection, which is the documented behaviour and proves the invocation
form is right.

**W13. Head the measurement tables with what they are. Done.** The heading is
now "Readings from this machine, 26 Aug 2026" rather than "Measured on this
machine", and W4's scope section sits above it. As written before, the tables
read as claims about these models rather than readings from one card, which is
the opposite of what the rest of the repo argues.

### Sizing

W1 to W4 and W6 to W9, W12 and W13 are done. W10 and W11 are about two hours.
W5 is the owner's.

Original estimate, kept because it held: W1 and W2 about ninety minutes, the
README pass roughly an hour, W10 and W11 about two hours, W3 and W4 minutes.
Everything except W5 can be done without the owner.

## Do not

- Do not flip visibility on the strength of a scan older than the working tree.
- Do not commit a session log, whatever the ignore rules happen to say that day.
- Do not present the measurements as generalisable. They are one machine on one
  day, and saying so is what makes the rest of it trustworthy.
- Do not build the recommender as a spec-sheet lookup. See R1.
- Do not extract the proxy into its own repo before W11 has been tried. See O2.
