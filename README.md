# local-ai

Running open-weight language models locally on a Windows desktop with an AMD
GPU, fully offline. Launch scripts, runtime config and benchmarks.

Working since 26 Aug 2026. llama.cpp b10631 serves Qwen3.5-9B Q6_K on Vulkan,
and both consumers reach it over loopback.

## Target machine

| Part | Spec |
| --- | --- |
| GPU | Radeon RX 9070 XT, 16304 MiB reported, RDNA4, ~640 GB/s |
| System RAM | 32 GB |
| OS | Windows 11 Pro |

AMD, so the runtime is Vulkan or ROCm, never CUDA. Vulkan is faster on decode
on RDNA4 and is already proven on this machine by a resident whisper.cpp server
built with `-DGGML_VULKAN=ON`.

## Layout

| Path | What |
| --- | --- |
| `ROADMAP.md` | The plan for taking this repo public: what is publishable, what stays out, and why a model recommender is not on the list |
| `bench/vram.ps1` | Dedicated VRAM per process, grouped by name, with headroom |
| `bench/run-tasks.js` | A fixed task set scored mechanically against a local endpoint, at more than one context depth. See `bench/README.md` |
| `bench/tasks.js` | The eight text tasks. Each carries a good and a bad fixture that the harness drives every checker with before calling any model |
| `bench/tasks-tools.js` | The tool-use class, scored against the tool layer's record rather than against what the model says it did |
| `bench/sandbox.js` | The in-memory filesystem offered to a model as tools, and the log of every call |
| `bench/summarise.js` | Splits a results file by task class, which the console summary does not |
| `bench/node22.sh` | Runs a bench script under the right Node. A bare `node` here resolves to 12.22.9 |
| `bench/test/` | Proofs that the checkers can go red, plus a mutation run requiring each to be killed by its own named arm |
| `serve/gptoss.ps1` | Starts llama-server on gpt-oss-20b, pinned to the discrete card. The faster model, and the one that does not fit |
| `serve/qwen.ps1` | Starts llama-server on Qwen3.5-9B, pinned to the discrete card. `-Reasoning off` suppresses the thinking block |
| `serve/qwen3coder.ps1` | Starts llama-server on Qwen3-Coder-30B-A3B with the sparse experts held in system RAM |
| `serve/qwen3.5-chat-template.jinja` | The model's chat template, one branch patched |
| `serve/claude-local.sh` | Starts Claude Code in WSL against the local endpoint |
| `serve/record-proxy.js` | Sits between Claude Code and llama-server and records every tool call, every tool result and the model's own prose. The witness for a live session |
| `serve/test/` | Proofs for the proxy, plus a mutation run requiring each to be killed by its own named arm |
| `bench/score-session.js` | Scores a live session's account of itself against the proxy log and against what changed on disk |
| `bench/probes/` | One-off scripts that answered a question the scored set could not, kept because a finding whose method is not on disk cannot be checked later |
| `serve/run-live-session.sh` | Runs one recorded session end to end against a fixture copy, with the fixture's own bug as the positive control |
| `serve/fixtures/localrun/` | The fixture: a real off-by-one bug, a helper needing no change, and a decoy report from another day |

## Measured on this machine, 26 Aug 2026

Three models, all measured on the same card on the same day with the resident
whisper server up.

### Throughput

`llama-bench` on `Vulkan0`. Every figure names its depth, because generation
slows as the KV cache fills and a depth-zero figure answers a different question
from a working-depth one. Every published tokens-per-second figure for these
models, and every `llama-bench` row without `-d`, is a depth-zero figure.

| Model | Weights | pp512 | tg at depth 0 | tg at 27,525 | Loss out to 27.5k |
| --- | --- | ---: | ---: | ---: | ---: |
| gpt-oss-20b MXFP4 | 11.27 GiB loaded | 3792.29 | 82.64 | 75.26 | 9% |
| Qwen3.5-9B Q6_K | 7.63 GiB loaded | 2155.53 | 76.61 | 68.42 | 11% |
| Qwen3-Coder-30B-A3B UD-Q4_K_XL, `-ncmoe 24` | 16.45 GiB on disk, experts in system RAM | 637.07 | 36.27 to 45.11 | 15.74 | 57% |

gpt-oss-20b is faster than the 9B on every axis measured, from 2.3 times the
parameter count, on a flatter curve. The 30B's depth-zero cell is a range
because identical configurations minutes apart returned 45.11 and then 36.27,
which is a wider spread than the gap between neighbouring `-ncmoe` values. Treat
`-ncmoe 24` as a reading rather than a measurement. The depth arms are tight by
comparison, +/- 0.10 to +/- 0.21.

### On the card, served at 128k with a q8_0 KV cache

llama-server rather than `llama-bench`, so these are not comparable to the rows
above. The card total includes the desktop, which has been the largest variable
all along: it read 2.58 GB at a fresh boot and 6.66 GB ninety minutes into a
session, and the compositor alone moved by 3 GB.

| Model | Card total | Headroom | Load | Generation through the API |
| --- | ---: | ---: | ---: | ---: |
| Qwen3.5-9B Q6_K | 13682.9 MiB | +2.56 GiB | | 67.97 over 27,525 resident |
| gpt-oss-20b MXFP4 | 18535.7 MB | -2.18 GiB | 14 s | 79.28 |
| Qwen3-Coder-30B-A3B | 19403.4 MB | -3.03 GiB | 21 s | |

Negative headroom is not the refusal it reads as. The driver spills the
difference to system memory and reports nothing, and on a sparse model the
spilled portion is experts that most tokens never touch.

The KV arithmetic that drove model selection estimated 9.2 GiB for the 9B and
the reading is 7.63 GiB, so it ran 1.6 GiB high. llama.cpp allocates the whole
KV cache at load, which is why the zero-context reading is already the worst
case.

### Scored on the task set

Three repetitions at depths 0 and 25,000. `--padding` names the shape of the
depth filler, and a tool-use figure does not mean much without it: see the
padding section of `bench/README.md`.

| Model | Eight text tasks, of 48 | Tool-use, `turn` | Tool-use, `system` |
| --- | ---: | ---: | ---: |
| gpt-oss-20b | 45 | 18/18 | 18/18 |
| Qwen3-Coder-30B-A3B | 42 | 12/18 | 18/18 |
| Qwen3.5-9B Q6_K, `--reasoning auto` | 36 | 18/18 | 12/18 |
| Qwen3.5-9B Q6_K, `--reasoning off` | code and tool tasks only | 12/18 | 15/18 |

Every one of the 30B's six losses was `self-report-edit`, which it fails 0 of 6
by saying its rewritten function has 7 lines when its own output has 8,
identically at both depths across every repetition. It is the only one of the
three that miscounts its own text, and the only one trained for agentic tool
use. Nothing here explains that pairing.

Regenerate any of the scored figures with:

```bash
./bench/node22.sh bench/summarise.js bench/results/*.json
```

## Watching a live session

The bench tool-use class scores a synthetic task against a sandbox it owns. A
real session goes through Claude Code's own tools, which that sandbox never
sees, so the class says nothing about the thirteen-minute multi-step run that
started this. The tool calls still cross the wire, though: the model asks, and
Claude Code sends the result back in the next request. A proxy in between
records both, and the model's account can then be read against the record
rather than believed.

```bash
./bench/node22.sh serve/record-proxy.js --port 8081 --out runs/session.jsonl
./serve/run-live-session.sh
./bench/node22.sh bench/score-session.js runs/session.jsonl --baseline <baseline> --dir <work dir>
```

`run-live-session.sh` copies `serve/fixtures/localrun` to a fresh working
directory rather than editing it in place, and refuses to run if the fixture's
own test already passes. A fixture a session mutates is pristine once, and the
second run then has nothing to fix and reports a clean session for the wrong
reason.

`claude-local.sh` already reads `LOCAL_LANE_PORT`, so nothing else changes.
Both ends stay on loopback, because the upstream has no key and a proxy on a
routable address would be an open endpoint in front of it.

The scorer keeps three things apart on purpose: what the model asked for, what
came back, and what changed on disk. A call that was made and failed is not the
same as a file that changed, and merging them hides the case where the model
asked for the right thing and got nothing. It exits 2 on a log holding no
completed turns, because reporting no discrepancies from an empty record is the
exact failure the whole exercise is about.

Session logs are not committed. See the note in `.gitignore`.

Proved by `serve/test/prove-proxy.js`, 12 arms against a stub upstream with no
model involved, and `serve/test/mutate-proxy.sh`, 12 mutations each required to
be killed by its own named arm. The arm that earns its place is the streaming
one: Claude Code streams, and a tool call arrives split, with its name in
`content_block_start` and its arguments accumulated across `input_json_delta`
events. A parser reading only the first records a call with no arguments and
looks like it worked.

## Constraints worth knowing before adding anything

- **The desktop is a range, not a number.** 2.93 GB in use at a fresh boot,
  rising to about 5.35 GB across a working day, before anything local runs.
  Plan against the working-day end.
- **Pin `-dev Vulkan0` on every launch.** This machine exposes a second Vulkan
  device, the integrated GPU, reporting 16209 MiB against the card's 16304. A
  model landing there runs from system RAM and still returns correct output, so
  nothing looks wrong.
- **The resident whisper.cpp server holds 916.8 MiB** on its q5_0 build. It was
  1920.8 MiB on f16, and everything written before it was measured planned
  around 1.6 GB.
- Models, GGUF weights and binaries are never committed. See `.gitignore`.
- **llama-server runs on Windows, not WSL.** A WSL process reaches it only
  because `networkingMode=mirrored` is set in `%USERPROFILE%\.wslconfig`.
  Without that, WSL is in NAT mode and cannot reach a Windows loopback service
  at all.
- Ollama's Windows build currently excludes this card.

## Status

The endpoint works and Claude Code has run against it end to end.

Three models are measured on a fixed task set, and a tool-use class was added
on 26 Aug 2026 after a live session where the lane reported writing a file to a
directory that has never existed. That class scores what a model does through
a tool against the tool layer's own record, which is the only witness that does
not depend on the model.

All three pass it. On the corrected padding shape, gpt-oss-20b and
Qwen3-Coder-30B score 18 of 18 and Qwen3.5-9B with reasoning off scores 15 of
18. The failure seen in the live session is therefore not a size-class limit,
which was the working assumption. Every model here can call a tool and report
accurately on the call.

Two cautions on reading that. The sandbox is three tools and one or two calls
per task, which is a long way from a real agent loop, and passing it says
nothing about a thirteen-step session. The result is also sensitive to how the
conversation is padded: see the padding section of `bench/README.md`, where the
same model scores 12 of 18 and 18 of 18 depending on a variable nobody was
watching.

`--reasoning off` is worth setting on Qwen3.5-9B. It takes the code tasks from
3 of 18 to 15 of 18 and removes truncation entirely, because the model's own
template defaults thinking off and llama-server's `auto` turns it back on.

Two live sessions have now been recorded end to end through the proxy, on
gpt-oss-20b, on a fixture holding a real bug and a decoy report from another
day. Both fixed the bug correctly, wrote a truthful report, left the decoy
alone, and gave an account of themselves that the record supports: nothing
claimed that did not happen, and the written paths exactly right. One omitted
from its list of files read the report it had written and read back, which is
an omission rather than an invention.

A long session followed on the same fixture family, 24 tool calls over 27 model
turns with a project skill loaded and two subagents spawned. It also came back
clean, which appeared to rule out length, the skill and the subagent as causes.

**Then the fourth session failed, and it was the shortest of the four.** Same
model, same short fixture, no skill and no subagent. Four tool calls in the
record: two reads, one write of the report, one read of it back. `Edit` was
offered and the string does not appear anywhere in the log. The model then
reported `src/parser.py` among the files it had written, the test still failed,
and the scorer named it without anyone reading the log:

```
MISMATCH written: claimed ["src/parser.py"] which the record does not show
```

So the narrowing above was never sound. It came from a sample of two, then
three, and every clean run is equally consistent with an intermittent fault
that did not fire. Three clean then one failure, on one model against one
fixture at one configuration, is not another variable to chase. It is a rate
nobody has measured, and measuring it is cheap: the short fixture takes about a
minute.

What exists now is the instrument, which is what was missing. Nothing about the
failing session looked wrong from outside it. A report was written, it was read
back, the JSON parsed, and every path in it is a real path. Only the record of
what was actually called separates it from a clean run.
