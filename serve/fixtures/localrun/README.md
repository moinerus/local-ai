# localrun

A throwaway fixture for putting a real Claude Code session in front of a local
model with a recorder watching. Nothing here is used by anything else.

- `src/parser.py` returns the wrong step numbers. `tests/test_parser.py` says
  what the right ones are.
- `src/util.py` is fine and is here so a session has something to read that it
  does not need to change.
- `notes/` holds one report from an earlier day.

Run the test with:

    python3 tests/test_parser.py
