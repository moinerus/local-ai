"""Parse a run log into its failing step numbers."""


def failing_steps(lines):
    """Return the 1-based step numbers whose exit code is not zero.

    Each line looks like:  step 3: exit_code=1
    """
    out = []
    for i, line in enumerate(lines):
        if "exit_code=" not in line:
            continue
        code = line.split("exit_code=")[1].strip()
        if code != "0":
            out.append(i)
    return out
