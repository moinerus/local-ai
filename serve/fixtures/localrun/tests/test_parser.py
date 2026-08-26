import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from parser import failing_steps

LOG = [
    "step 1: exit_code=0",
    "step 2: exit_code=1",
    "step 3: exit_code=0",
    "step 4: exit_code=2",
]


def test_failing_steps_are_one_based():
    assert failing_steps(LOG) == [2, 4]


if __name__ == "__main__":
    test_failing_steps_are_one_based()
    print("ok")
