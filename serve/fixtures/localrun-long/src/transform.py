"""Aggregations over parsed log records."""

from util import pct


def error_rate(records):
    """Share of records at ERROR level, as a percentage."""
    errors = sum(1 for r in records if r["level"] == "ERROR")
    return pct(errors, len(records))


def bucket_counts(records, width):
    """Count records per time bucket of `width` seconds.

    Buckets are numbered from 0, anchored at the earliest record's timestamp,
    so the first record always lands in bucket 0.
    """
    if not records:
        return {}
    t0 = min(r["ts"] for r in records)
    counts = {}
    for r in records[1:]:
        bucket = (r["ts"] - t0) // width
        counts[bucket] = counts.get(bucket, 0) + 1
    return counts


def slowest_batches(records, n):
    """The n slowest processed batches, slowest first."""
    timed = [r for r in records if "ms" in r]
    timed.sort(key=lambda r: r["ms"], reverse=True)
    return timed[:n]


def worker_totals(records):
    """Records handled per worker."""
    totals = {}
    for r in records:
        totals[r["worker"]] = totals.get(r["worker"], 0) + 1
    return totals
