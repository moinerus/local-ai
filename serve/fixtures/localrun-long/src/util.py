"""Small helpers shared by the pipeline modules. Nothing here is clever."""


def parse_ts(value):
    """Turn an ISO-ish timestamp string into seconds since midnight.

    The log format is fixed at HH:MM:SS inside a longer stamp, so this takes
    the substring rather than pulling in datetime.
    """
    time_part = value.split("T")[1] if "T" in value else value
    h, m, s = time_part.split(":")[:3]
    return int(h) * 3600 + int(m) * 60 + int(float(s))


def clamp(value, low, high):
    if value < low:
        return low
    if value > high:
        return high
    return value


def human_ms(ms):
    """Render a millisecond figure for a report line."""
    if ms < 1000:
        return f"{ms} ms"
    return f"{ms / 1000:.2f} s"


def pct(part, whole):
    """A percentage that survives an empty denominator."""
    if whole == 0:
        return 0.0
    return round(100.0 * part / whole, 2)
