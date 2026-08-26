# Reports whether the two local servers are listening.
#
# Written by the local Qwen3.5-9B lane on 26 Aug 2026 and kept as it came,
# apart from this header. It is here as evidence as much as tooling: it is the
# first thing the local model produced that survived review. Verified on both
# arms, with both ports listening and with one pointed at a closed port, so the
# UP and DOWN paths and both exit codes have each been observed.
#
# Two things a reviewer would change and which are deliberately left alone, so
# the artefact stays honest: the port numbers are written twice, once in the
# hashtable and once in the if/elseif, so changing one means editing two
# places; and the if/elseif adds nothing that reading the port from the
# hashtable would not.
#
# Exit 0 if both are up, 1 if either is down.

[CmdletBinding()]
param(
    [switch] $Json
)

$services = @{
    'llama-server' = @{ port = 8080; status = $false }
    'whisper-server' = @{ port = 8756; status = $false }
}

$services.Values | ForEach-Object {
    if ($_.port -eq 8080) {
        $conn = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    }
    elseif ($_.port -eq 8756) {
        $conn = Get-NetTCPConnection -LocalPort 8756 -State Listen -ErrorAction SilentlyContinue
    }

    if ($conn) {
        $_.status = $true
    }
}

# Computed once, above the branch, and used by the single exit at the bottom.
# The -Json branch originally carried its own copy and inverted it: it wrote
# `exit [int] $allUp` against a boolean, so both-servers-up exited 1 while the
# human path exited 0. Two copies of one rule is what let the two modes
# disagree, so there is now one copy and one exit.
$allUp = ($services.Values | Where-Object { $_.status } | Measure-Object).Count -eq 2

if ($Json) {
    [pscustomobject]@{
        Service = $services.Keys | ForEach-Object {
            [pscustomobject]@{
                Service = $_
                Port    = $services[$_].port
                Up      = $services[$_].status
            }
        }
    } | ConvertTo-Json -Depth 2
}
else {
    $services.Keys | ForEach-Object {
        $port = $services[$_].port
        $state = if ($services[$_].status) { 'UP' } else { 'DOWN' }
        Write-Host "$_ - $port - $state"
    }
}

# Exit 0 if both are up, 1 if either is down. Both modes, one rule.
if ($allUp) { exit 0 } else { exit 1 }
