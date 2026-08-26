# Generate this fixture's data/pipeline.log.
#
# Deterministic: line i (1-based) is ERROR when i % 97 == 0, WARN when
# i % 41 == 0 (and not ERROR), else INFO. 4000 lines gives exactly 41 ERROR
# lines, so the count a session reports can be checked against arithmetic
# rather than against another grep of the same file.
#
# Re-running this must reproduce the committed log byte for byte. If it does
# not, the fixture and its generator have drifted and the ERROR count in the
# write-ups is no longer derivable.
#
# The destination is derived from this script's location. It was a hardcoded
# absolute path, which is the same defect that made a worktree comparison run
# the wrong tree in the session this fixture was built for.
$out = Join-Path $PSScriptRoot 'data\pipeline.log'
$dir = Split-Path $out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$lines = New-Object System.Collections.Generic.List[string]
$t0 = 9 * 3600
for ($i = 1; $i -le 4000; $i++) {
  $ts = $t0 + $i
  $h = [int][math]::Floor($ts / 3600); $m = [int][math]::Floor(($ts % 3600) / 60); $s = $ts % 60
  $stamp = '2026-08-25T{0:d2}:{1:d2}:{2:d2}' -f $h, $m, $s
  $worker = 'worker-{0}' -f (($i % 5) + 1)
  if ($i % 97 -eq 0) {
    $line = '{0} ERROR {1} failed batch {2:d4}: upstream timeout after 3000 ms' -f $stamp, $worker, $i
  } elseif ($i % 41 -eq 0) {
    $line = '{0} WARN {1} retrying batch {2:d4} after slow response' -f $stamp, $worker, $i
  } else {
    $ms = 120 + (($i * 37) % 400)
    $line = '{0} INFO {1} processed batch {2:d4} in {3} ms' -f $stamp, $worker, $i, $ms
  }
  $lines.Add($line)
}
[IO.File]::WriteAllLines($out, $lines)
$err = ($lines | Where-Object { $_ -match ' ERROR ' }).Count
Write-Output ("wrote {0} lines, {1} ERROR lines" -f $lines.Count, $err)
