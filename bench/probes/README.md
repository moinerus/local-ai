# probes

One-off scripts that answered a question the scored task set could not. They are
kept because the finding they produced changed how a task in that set is read,
and a finding whose method lives only in a session transcript cannot be checked
by anyone later.

These are not part of the harness. They contact a running endpoint directly,
they are not scored, and their results do not belong in a bench table.

## The line-count probes

`self-report-edit` asks a model to rewrite a function and then say how many
lines its own rewrite has. Qwen3-Coder-30B failed it 0 of 6, saying 7 where its
own output had 8, identically at both depths across every repetition. That reads
as a clean self-report failure and the project carried it as one.

Run in order, each answering what the last one ruled out:

| Script | Question | Answer |
| --- | --- | --- |
| `inspect-selfreport.js` | What did it actually write? | The same 8-line rewrite every time, byte for byte |
| `probe-linecount.js` | Is it self-report, or counting? | Neither. Correct on 5 and 11 lines, wrong on this 8-line function whether or not it wrote it, correct when told to enumerate first |
| `probe-linecount2.js` | Is it the length, or the shape? | Neither. Same-length generated functions are not reliably miscounted |
| `probe-linecount3.js` | Which part of the text triggers it? | Renaming the function, the argument or the literals fixes it. Changing the condition or reordering the branches does not |
| `probe-linecount4.js` | Then is it recall of a familiar snippet? | Three of four canonical exercises wrong, every renamed twin correct |

```bash
./bench/node22.sh bench/probes/probe-linecount3.js http://127.0.0.1:8080 qwen3-coder-30b 3
./bench/node22.sh bench/probes/inspect-selfreport.js bench/results/<file>.json
```

## The live-session probes

Two scripts that read a recorder log directly, kept because the figures they
produced went into a write-up and nothing else on disk could reproduce them.

| Script | Question | Answer, for the 26 Aug long session |
| --- | --- | --- |
| `session-depth.js` | How deep did it get, and did the history ever shrink? | 175,450 bytes peak, about 43,900 tokens, 41 messages. History fell 8 times, all of them subagents opening their own conversation on the same connection rather than compaction |
| `inspect-failed-calls.js` | What did the failed calls actually return? | Every `Read` of the 4,000-line log refused it at 259.5 KB against a 256 KB cap, which is why the model grepped instead |

```bash
./bench/node22.sh bench/probes/session-depth.js <log.jsonl>
./bench/node22.sh bench/probes/inspect-failed-calls.js <log.jsonl>
```

`session-depth.js` reads a drop in the message count as a possible compaction
and says so. On this harness it is usually a subagent, so read the sequence
numbers against the tool calls before concluding anything. Counting a subagent's
first turn as compaction would be the same mistake, one level along, as the
scorer counting a readiness probe as a conversation turn.

Two things in the line-count probes are worth copying and one is worth avoiding.

Every probe from 3 onwards re-runs the untouched original as a positive control
in the same pass and reports its verdict first, because a probe whose trigger
has stopped firing is measuring nothing and every row under it reads as a
finding anyway.

Every arm computes the true answer from the text it sends rather than from a
constant, so the expected value cannot drift from the question.

`probe-linecount2.js` ends by naming which hypothesis held, with the branch
conditions written while the arms were being designed. The run produced rows
fitting neither, one branch matched on a technicality, and it printed "H4 holds"
under a table contradicting it. A probe should report its rows and let the
reader conclude. Left in as it was rather than quietly fixed, because the
mistake is the useful part.
