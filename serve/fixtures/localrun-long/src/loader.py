"""Read the pipeline log into records.

A log line looks like:

    2026-08-25T09:00:01 INFO worker-3 processed batch 0412 in 187 ms

Malformed lines are counted, not raised, because the log is appended to by
several workers and a torn line at a rotation boundary is normal.
"""

from util import parse_ts

LEVELS = ("INFO", "WARN", "ERROR")


def parse_line(line):
    """One log line to a dict, or None if the line does not parse."""
    parts = line.strip().split(" ", 3)
    if len(parts) < 4:
        return None
    stamp, level, worker, rest = parts
    if level not in LEVELS:
        return None
    try:
        ts = parse_ts(stamp)
    except (ValueError, IndexError):
        return None
    record = {"ts": ts, "level": level, "worker": worker, "message": rest}
    if rest.startswith("processed batch"):
        bits = rest.split()
        try:
            record["batch"] = int(bits[2])
            record["ms"] = int(bits[4])
        except (ValueError, IndexError):
            pass
    return record


def load(path):
    """Parse a whole file. Returns (records, skipped_count)."""
    records = []
    skipped = 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            record = parse_line(line)
            if record is None:
                skipped += 1
            else:
                records.append(record)
    return records, skipped


def by_level(records):
    """Count records per level. Levels with no records still appear."""
    counts = {level: 0 for level in LEVELS}
    for r in records:
        counts[r["level"]] += 1
    return counts
