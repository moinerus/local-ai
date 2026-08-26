<#
.SYNOPSIS
    Reports dedicated GPU memory in use, per process and in total.

.DESCRIPTION
    Answers one question: how much of the 16 GB card is already spoken for, and
    what is holding it. Run it before loading a model, then again after, and
    subtract.

    Uses the Windows GPU Process Memory performance counters, so it needs no
    vendor tooling and works on the AMD card.

.PARAMETER Watch
    Keep sampling until interrupted, instead of taking one reading.

.PARAMETER IntervalSeconds
    Seconds between samples when watching. Default 5.

.PARAMETER Label
    Free text recorded in the output line. Use it to mark what was loaded, for
    example -Label "gpt-oss-20b at 32k".

.EXAMPLE
    .\vram.ps1 -Label "baseline, whisper-server only"

.EXAMPLE
    .\vram.ps1 -Watch -IntervalSeconds 10 -Label "loading gpt-oss-20b"
#>
[CmdletBinding()]
param(
    [switch] $Watch,
    [switch] $ByProcess,
    [switch] $Json,
    [int]    $IntervalSeconds = 5,
    [string] $Label = ''
)

# PS 5.1 turns native stderr into a terminating error under Stop. Do not.
$ErrorActionPreference = 'Continue'

function Get-GpuMemorySample {
    $samples = (Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples
    if (-not $samples) {
        Write-Warning 'No GPU memory counters returned. Counters may be disabled, or this shell may lack permission.'
        return $null
    }

    $byPid = @{}
    foreach ($s in $samples) {
        if ($s.CookedValue -le 0) { continue }
        # Instance names look like: pid_1234_luid_0x00000000_0x0000ABCD_phys_0
        if ($s.InstanceName -notmatch '^pid_(\d+)_') { continue }
        $processId = [int] $Matches[1]
        $byPid[$processId] = [int64] $byPid[$processId] + [int64] $s.CookedValue
    }

    if ($byPid.Count -eq 0) {
        Write-Warning 'Counters returned but every reading was zero. Treat this as a failed measurement, not an idle GPU.'
        return $null
    }

    $rows = foreach ($processId in $byPid.Keys) {
        $name = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
        if (-not $name) { $name = '(exited)' }
        [pscustomobject]@{
            ProcessId = $processId
            Name      = $name
            MB        = [math]::Round($byPid[$processId] / 1MB, 1)
        }
    }

    return $rows | Sort-Object MB -Descending
}

function Group-ByName {
    param($Rows)

    # Browsers and chat clients spread across many processes, so a per-pid list
    # hides where the memory actually goes. Group before deciding what to close.
    $Rows |
        Group-Object Name |
        ForEach-Object {
            [pscustomobject]@{
                Name      = $_.Name
                Processes = $_.Count
                MB        = [math]::Round(($_.Group | Measure-Object -Property MB -Sum).Sum, 1)
            }
        } |
        Sort-Object MB -Descending
}

function Show-Sample {
    param([string] $Tag, [switch] $Json)

    $rows = Get-GpuMemorySample
    if (-not $rows) { return }

    $totalMb = ($rows | Measure-Object -Property MB -Sum).Sum
    $stamp   = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

    # 16304 MiB, not the 16384 a "16 GB card" implies. Read from the card on
    # 26 Aug 2026 via llama.cpp's --list-devices, which asks Vulkan rather than
    # rounding the marketing figure. The old value made every headroom reading
    # 80 MiB optimistic.
    #
    # Declared once, above the branch. The -Json path arrived with its own
    # copy, which is how a card size gets corrected in one mode and not the
    # other.
    $cardMb   = 16304
    $headroom = [math]::Round(($cardMb - $totalMb) / 1024, 2)

    if ($Json) {
        $processRows = $rows | Where-Object { $_.MB -ge 1 } | Sort-Object MB -Descending | ForEach-Object {
            [pscustomobject]@{
                ProcessId = $_.ProcessId
                Name      = $_.Name
                MB        = $_.MB
            }
        }
        [pscustomobject]@{
            Timestamp        = $stamp
            Label            = $Label
            CardMB           = $cardMb
            TotalDedicatedMB = $totalMb
            HeadroomGib      = $headroom
            ProcessRows      = $processRows
        } | ConvertTo-Json -Depth 10
        return
    }

    Write-Host ''
    Write-Host "$stamp  total dedicated: $totalMb MB ($([math]::Round($totalMb / 1024, 2)) GB)$Tag"
    Write-Host "against a $cardMb MiB card, headroom: $headroom GiB"

    if ($ByProcess) {
        $rows | Where-Object { $_.MB -ge 1 } | Format-Table -AutoSize
    }
    else {
        Group-ByName -Rows $rows | Where-Object { $_.MB -ge 1 } | Format-Table -AutoSize
    }
}

$tag = if ($Label) { "  [$Label]" } else { '' }

if ($Watch) {
    Write-Host "Sampling every $IntervalSeconds s. Ctrl+C to stop."
    while ($true) {
        Show-Sample -Tag $tag -Json:$Json
        Start-Sleep -Seconds $IntervalSeconds
    }
}
else {
    Show-Sample -Tag $tag -Json:$Json
}
