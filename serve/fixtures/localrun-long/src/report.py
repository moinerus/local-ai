"""Render a plain-text summary of a parsed log."""

from loader import by_level
from transform import error_rate, slowest_batches, worker_totals
from util import human_ms


def summary(records, skipped):
    """A multi-line summary string for the end of a pipeline run."""
    lines = []
    lines.append(f"records: {len(records)}, skipped: {skipped}")

    counts = by_level(records)
    lines.append(
        "levels: "
        + ", ".join(f"{level} {counts[level]}" for level in ("INFO", "WARN", "ERROR"))
    )
    lines.append(f"error rate: {error_rate(records)}%")

    totals = worker_totals(records)
    for worker in sorted(totals):
        lines.append(f"  {worker}: {totals[worker]}")

    slow = slowest_batches(records, 3)
    if slow:
        lines.append("slowest batches:")
        for r in slow:
            lines.append(f"  batch {r['batch']:04d} at {human_ms(r['ms'])}")

    return "\n".join(lines)
