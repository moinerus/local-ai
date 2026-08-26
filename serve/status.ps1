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

# Print status for each service
$services.Keys | ForEach-Object {
    $svc = $_
    $port = $services[$svc].port
    $status = if ($services[$svc].status) { 'UP' } else { 'DOWN' }
    Write-Host "$svc - $port - $status"
}

# Exit 0 if both are up, 1 if either is down
$allUp = $services.Values | Where-Object { $_.status } | Measure-Object | Select-Object -ExpandProperty Count
if ($allUp -eq 2) {
    exit 0
} else {
    exit 1
}
