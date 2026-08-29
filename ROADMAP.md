# Roadmap

local-ai has two reusable parts:

- a fixed task benchmark for any OpenAI-compatible model endpoint
- a recording proxy and scorer that compare an agent's report with its tool record

The AMD and Windows launch scripts support one desktop. The benchmark and
scorer are portable. Hardware readings in this repository come from one
machine and are not claims about the models in general.

## Current state

The benchmark runs text, code and tool-use tasks at more than one context
depth. Every checker sees a known-good and known-bad fixture before a model is
called. A broken checker stops the run.

The recording proxy captures tool calls, tool results and model prose. The
session scorer keeps three questions separate:

1. What did the model ask a tool to do?
2. What result came back?
3. What does the model later claim happened?

The repository now includes two constructed sample records. One account
matches its tool record. The other claims a file that was never written and
exits 1 with a named mismatch. Both run offline.

The scorer has 17 proof arms. Eight mutations disable its main decisions one
at a time, and each mutation must be killed by the arm written for it. CI also
runs the tool checker and proxy mutation suites.

## Release checklist

- [x] Remove private and machine-specific paths from tracked files.
- [x] Keep model weights, binaries, secrets and recorded sessions ignored.
- [x] Add an MIT licence.
- [x] State the runtime and platform prerequisites.
- [x] Split portable tools from machine-specific launch scripts.
- [x] Add offline proof suites and mutation runs to CI.
- [x] Add constructed scorer samples that need no model or endpoint.
- [x] Put the offline scorer command on the first screen of README.md.
- [x] Record the 28 August Whisper-on/off correctness repeat without a speed
  or VRAM claim.
- [x] Keep raw 28 August benchmark output local.
- [ ] Re-run tracked-tree and full-history sensitive-data scans against the
  final working tree.
- [ ] Run the complete offline proof suite from a clean checkout.
- [ ] Review the final public diff and GitHub Actions result.
- [ ] Change repository visibility.

The last four checks happen in that order. A clean scan from an older commit
does not cover a new documentation edit.

## What remains Andy's call

Repository visibility is the owner's decision. The final review should show:

- the exact files added since the last private commit
- the commands and exit codes from every proof suite
- any scan finding and why it is safe
- the untracked local outputs that were deliberately excluded

Changing visibility is not part of an automated release script.

## Known limits

- The public samples are constructed fixtures. They demonstrate the scorer,
  not a real model's failure rate.
- The task set supports decisions on this machine. It is not a general model
  leaderboard.
- A passing synthetic tool-use task does not prove a long coding session will
  remain accurate.
- The 28 August Whisper pairs matched on pass, fail and truncation count. The
  pair did not measure latency, throughput or VRAM.
- Windows launch scripts assume a llama.cpp build and local GGUF files supplied
  through LLAMA_EXE and MODEL_DIR.

## After release

1. Watch whether readers use the scorer, benchmark, or machine launch scripts.
   Split the scorer into its own repository only if that boundary proves useful.
2. Add a real, safely constructed regression sample when a new scorer defect
   is found. Do not publish a recorded work session.
3. Expand the task set only when a real decision exposes a missing behaviour.
   Each new checker needs good and bad fixtures before it can call a model.
4. Repeat model measurements after runtime, quantisation or hardware changes.
   Keep the date, context depth and resident desktop load beside every figure.
5. Treat model recommendations as measured configuration choices, not names
   copied from a specification table.
