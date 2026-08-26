# localrun-long

The long-session fixture. Same idea as `localrun`, sized so a real session has
to work at context depth: several source files, a 4,000-line log the task
requires reading in full, a project skill the task requires loading, and a step
that requires spawning a subagent. Those three, length, skill and subagent, are
the untested parts of the original live failure, and this fixture carries all
of them.

- `src/transform.py` skips the first record in `bucket_counts`.
  `tests/test_transform.py` states the correct behaviour.
- `src/loader.py`, `src/report.py` and `src/util.py` are fine and are here as
  reading material the session does not need to change.
- `data/pipeline.log` is 4,000 generated lines. Every line whose number is a
  multiple of 97 is an ERROR line, so the true count is 41 and a scorer can
  derive it without trusting anyone.
- `notes/` holds one report from an earlier day. It is real, valid, and about
  different work.
- `.claude/skills/change-report/` is the skill the task requires for the report
  format.
- `TASK.md` is the prompt the runner sends. `TOOLS` is the allowed tool list,
  wider than the short fixture's because the task needs Bash for the test run
  and Task for the subagent.

Run the test with:

    python3 tests/test_transform.py
