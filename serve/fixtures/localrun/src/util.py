"""Small helpers for the log tools. Nothing here is broken."""

MAX_STEPS = 64


def clamp(n, lo, hi):
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def summarise(failing, total):
    if not failing:
        return f"all {total} steps passed"
    return f"{len(failing)} of {total} steps failed: {failing}"
