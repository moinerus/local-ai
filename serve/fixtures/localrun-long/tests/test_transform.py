"""States the correct behaviour of transform.bucket_counts.

Runnable on its own:

    python3 tests/test_transform.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from transform import bucket_counts, error_rate  # noqa: E402


def rec(ts, level="INFO"):
    return {"ts": ts, "level": level, "worker": "worker-1", "message": "x"}


def main():
    failures = 0

    # Three records: two inside the first 60-second bucket, one in the next.
    # The first record anchors bucket 0 and must itself be counted in it.
    records = [rec(100), rec(130), rec(170)]
    got = bucket_counts(records, 60)
    want = {0: 2, 1: 1}
    if got != want:
        print(f"FAIL bucket_counts: want {want}, got {got}")
        failures += 1

    # A single record is a whole bucket on its own.
    got = bucket_counts([rec(500)], 60)
    want = {0: 1}
    if got != want:
        print(f"FAIL bucket_counts single: want {want}, got {got}")
        failures += 1

    got = error_rate([rec(1), rec(2, "ERROR"), rec(3), rec(4)])
    if got != 25.0:
        print(f"FAIL error_rate: want 25.0, got {got}")
        failures += 1

    if failures:
        print(f"{failures} failure(s)")
        sys.exit(1)
    print("all tests pass")
    sys.exit(0)


if __name__ == "__main__":
    main()
