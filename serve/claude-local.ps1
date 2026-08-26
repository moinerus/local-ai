<#
.SYNOPSIS
    Starts Claude Code against the local llama-server instead of the API.

.DESCRIPTION
    Sets the three routing variables for one process only, then launches
    Claude Code. Your normal `claude` command is untouched.

    This has to be a separate process. ANTHROPIC_BASE_URL is read once at
    startup and Claude Code's own docs are explicit that it "changes where
    requests are sent, not which model answers them". availableModels is a
    list of plain strings with no per-entry URL, so /model cannot switch
    endpoints mid-session. An LLM gateway in front of both is the only route
    to that, and it puts a proxy in front of the real API too.

    Never put these variables in settings.json. That env block applies to
    every session on this machine, so it would silently route all Claude Code
    work to a 9B model.

.PARAMETER Port
    Where llama-server is listening. Default 8080, matching qwen.ps1.

.EXAMPLE
    .\claude-local.ps1
#>
[CmdletBinding()]
param(
    [int]    $Port = 8080,
    [string[]] $ClaudeArgs = @()
)

$ErrorActionPreference = 'Continue'

$base = "http://127.0.0.1:$Port"

# Fail loudly rather than letting Claude Code start and time out on every turn.
$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if (-not $listening) {
    Write-Error "nothing listening on $Port. Start it with serve\qwen.ps1 first."
    exit 2
}

# Read the served model name off the server rather than hardcoding it, so a
# quantisation swap in qwen.ps1 does not leave a stale string here.
try {
    $models = Invoke-RestMethod -Uri "$base/v1/models" -TimeoutSec 10
    $modelId = $models.data[0].id
}
catch {
    Write-Error "could not read $base/v1/models: $_"
    exit 2
}

if (-not $modelId) { Write-Error "server returned no model id"; exit 2 }

Write-Output "routing Claude Code at $base"
Write-Output "model: $modelId"

$env:ANTHROPIC_BASE_URL           = $base
$env:ANTHROPIC_AUTH_TOKEN         = 'local'   # not validated, llama-server has no key set
$env:ANTHROPIC_MODEL              = $modelId
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $modelId  # background calls hit the same model

& claude @ClaudeArgs
