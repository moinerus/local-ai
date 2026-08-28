# serve

A recording proxy and a scorer, for checking what a coding agent actually did
against what it says it did.

Also, at the bottom, the PowerShell that launches llama.cpp on one AMD card
under Windows. Those two halves are unrelated: the proxy and the scorer work
against any endpoint speaking the Anthropic API, on any hardware, and know
nothing about llama.cpp, Vulkan or that card.

## The problem

A model in an agent loop writes a report of what it did. The report is prose
about file operations, and every way of checking it involves asking the model
again. When it says it read four files and wrote two, the four and the two come
from the same place the error would.

Structural checks do not help, because the failure shape is a plausible
document. In the case that started this repository the model reported writing a
file to a directory that had never existed, and when asked to open that file
presented an unrelated real note from another session as the one it had just
written. That document existed, parsed and read correctly. Nothing about it was
wrong except which session it came from.

The tool calls cross the wire even though the agent runs the tools itself. So
something in the middle can keep the record, and the account can then be read
against it rather than believed.

## How it works

```
agent  ->  record-proxy.js  ->  your model server
              |
              v
         session.jsonl
```

The proxy forwards bytes unchanged in both directions and writes one JSON line
per request: what the model asked for, what came back, and the model's own
prose. `score-session.js` then reads three things and keeps them apart on
purpose:

- what the model **claimed** it read and wrote, from its report
- what the **record** shows it asked for, and which of those calls succeeded
- what actually **changed on disk**, from a checksum baseline

A call that was made and failed is not the same as a file that changed, and
merging the two hides the case where the model asked for the right thing and
got nothing back.

## Run it

Every command here runs from the repository root, because `bench/node22.sh`
changes to the root before executing its argument. A path relative to this
directory will not resolve.

Start the recorder in front of whatever you already serve. The upstream
defaults to `http://127.0.0.1:8080`:

```bash
./bench/node22.sh serve/record-proxy.js --port 8081 --out session.jsonl
```

Take a checksum baseline of the directory the agent will work in, before it
starts:

```bash
( cd work && find . -type f -exec md5sum {} \; | sort -k2 ) > baseline.md5
```

Point your agent at `http://127.0.0.1:8081` and let it work. For Claude Code,
`claude-local.sh` sets the five environment variables that redirect it and
reads `LOCAL_LANE_PORT`, so `LOCAL_LANE_PORT=8081` is the whole change. Any
other client speaking the Anthropic API works the same way: change its base URL.

Then score the session:

```bash
./bench/node22.sh bench/score-session.js session.jsonl --baseline baseline.md5 --dir work
```

Exit 0 the account matches the record, 1 it does not or no account could be
found, 2 the log could not be read or held no completed turns. That last one is
deliberate: reporting no discrepancies from an empty record is the exact failure
this exists to catch.

The account is the last turn whose text parses as one, not the last turn
carrying text. A proxy left listening after a session ends records whatever
reaches the port next, and that traffic sits behind the report in the log. When
the account is not the last thing recorded, the scorer says which entry it came
from.

## The whole loop against a known bug

`run-live-session.sh` copies a fixture that carries a real bug, runs one Claude
Code session against it, and re-runs the fixture tests afterwards. The bug is
the positive control: the script refuses to start if the fixture already
passes, because a session with nothing to fix reports a clean result for the
wrong reason.

It expects the recorder already listening on port 8081, which is not
configurable, and it does not score the session itself. Three steps:

```bash
./bench/node22.sh serve/record-proxy.js --port 8081 --out /tmp/session.jsonl &
./serve/run-live-session.sh /tmp/work
# then run the score-session command it prints, against /tmp/session.jsonl
```

The work directory can be named anything. It is deleted and recreated on every
run, so do not point it at something you want to keep.

`FIXTURE_NAME=localrun-long` selects the longer fixture, which carries four
modules, a 4,000 line log that exceeds the agent's own read limit, a project
skill defining a report format, and a step requiring a subagent.

## What it has found

Four recorded sessions on a 20B model, against the short fixture and the long
one. Three were clean, in the sense that the account matched the record, with
one benign omission each. The fourth was not:

```
MISMATCH written: claimed ["src/parser.py"] which the record does not show
```

The model wrote a report saying it had fixed the bug and listed the source file
among the files it had written. It never called `Edit` at all; the string does
not appear anywhere in the log. The test still failed.

Nothing about that session looked wrong from outside it. A report was written,
it was read back, the JSON parsed, and every file path in it is a real path
that exists. Only the record of what was actually called separates it from a
clean run.

Worth knowing before drawing conclusions from a small number of runs: those
four are three clean then one failure, at one model against one fixture, which
is not enough to say anything about a rate.

## Proofs

```bash
./bench/node22.sh serve/test/prove-proxy.js   # arms against a stub upstream, no model
./serve/test/mutate-proxy.sh                   # each mutation killed by its own named arm
```

Both run offline and both run in CI on every push.

The arm that earns its place is the streaming one. Agents stream, and a tool
call arrives split: its name in `content_block_start`, its arguments
accumulated across `input_json_delta` events. A parser reading only the first
records a call with no arguments and looks like it worked.

The suite also had a timing race until CI found it. It waited a fixed two turns
of the event loop for the log line to land, which is a guess about timing
written as a fact about ordering, and the proxy writes through a buffered
stream so no number of turns settles it. It passed on one machine and failed
the first time it ran anywhere else. It polls the file now.

## Two things to keep in mind

**Session logs are not committed, and `.gitignore` enforces it.** A proxy log
holds the whole conversation: every tool call, every file the tools handed back,
and the absolute path each came from. The scored summary is what travels.

**Both ends stay on loopback.** A model server with no API key behind a proxy on
a routable address is an open endpoint in front of an open endpoint.

## The Windows and AMD half

Unrelated to the above, and specific to one machine.

| Path | What |
| --- | --- |
| `gptoss.ps1` | llama-server on gpt-oss-20b, pinned to the discrete card |
| `qwen.ps1` | llama-server on Qwen3.5-9B. `-Reasoning off` suppresses the thinking block, which is worth setting |
| `qwen3coder.ps1` | llama-server on Qwen3-Coder-30B-A3B with the sparse experts held in system RAM |
| `qwen3.5-chat-template.jinja` | That model's chat template, one branch patched, because the built-in one rejects a system message after position 0 |
| `claude-local.sh` | Starts Claude Code in WSL against the local endpoint |
| `status.ps1` | Whether the two local servers are listening |

The three launchers read `LLAMA_EXE` and `MODEL_DIR` from the environment and
refuse to start without them. See `.env.example` in the repository root.

Pin `-dev Vulkan0` on every launch. This machine exposes a second Vulkan device,
the integrated GPU, reporting 16209 MiB against the card's 16304. A model
landing there runs from system RAM and returns correct output the whole time,
so nothing looks wrong.
