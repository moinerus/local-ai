# Constructed scorer samples

These are small constructed fixtures, not recorded model sessions. They carry
no prompts, private paths or model output. Their job is to show the session
scorer's useful distinction without a model, GPU or agent.

The clean account names the write in the record and exits 0:

```bash
./bench/node22.sh bench/score-session.js samples/clean-account.jsonl
```

The mismatched account claims a different file and exits 1 with a named
`MISMATCH written` result:

```bash
./bench/node22.sh bench/score-session.js samples/mismatched-account.jsonl
```

The second command failing is the expected result. The scorer has caught an
account that is fluent, valid JSON and unsupported by the recorded tool call.
