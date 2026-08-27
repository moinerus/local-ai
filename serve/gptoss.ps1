<#
.SYNOPSIS
    Starts llama-server on gpt-oss-20b, pinned to the discrete card.

.DESCRIPTION
    Serves an OpenAI-compatible API on 127.0.0.1:8080, the same port qwen.ps1
    uses. Only one model is served at a time here, because the card cannot hold
    two, and both scripts refuse to start if something is already listening.

    Measured on this machine on 26 Aug 2026, against Qwen3.5-9B Q6_K on the
    same harness and the same day:

                          gpt-oss-20b    Qwen3.5-9B Q6_K
        prefill pp512     3792 tok/s     2156 tok/s
        generation @0     82.64          76.61
        generation @16k   76.68          71.38
        generation @27.5k 75.26          68.42
        loss to depth     9%             11%
        local task set    45 of 48       36 of 48

    Faster on every axis from 2.3 times the parameter count, and better on the
    task set in bench/run-tasks.js.

    Three things here are not defaults.

    -dev Vulkan0 pins the model to the RX 9070 XT. This machine exposes a
    second Vulkan device, the integrated "AMD Radeon(TM) Graphics", which
    reports 16209 MiB because it borrows system RAM. Without the pin a model
    can land there, run from system RAM at a fraction of the speed, and look
    like it worked.

    No -ncmoe. gpt-oss-20b wants no expert offload at all. Measured, every
    setting above 0 costs throughput: pp512 falls from 3792 to 1842 at 6 and
    to 714 at 24, and generation from 83.35 to 27.03. The flag that rescues
    Qwen3-Coder-30B does nothing for this model except slow it down.

    No --chat-template-file. gpt-oss ships its own harmony template and it
    works as built. qwen.ps1 needs a patched template because the model's own
    one rejects a system message after position 0, which Claude Code sends.

.NOTES
    THIS MODEL DOES NOT FIT, AND RUNS ANYWAY.

    11.27 GiB of weights on a card reporting 16304 MiB, against a desktop that
    holds between 2.93 and 6.66 GB on its own. Served at 128k with a q8_0 KV
    cache the card reads 18535.7 MB total, headroom -2.18 GiB, with
    llama-server holding 9950.1 MB dedicated. The driver places the remainder
    in system memory and reports nothing.

    That is nearly free here because the model is sparse: 3.6 B of 20.91 B are
    active per token, so the spilled portion is experts most tokens never
    touch. It generated 79.28 tok/s through the API in that state.

    It is still an overflow, so if a session feels slow, read the card before
    blaming the model:

        .\bench\vram.ps1

    The compositor is the variable to watch. dwm has been measured anywhere
    between 807.7 MB and 4444.6 MB on this machine within one day.

.PARAMETER ContextSize
    Context window in tokens. Default 131072, with a q8_0 KV cache. The whole
    cache is allocated at load, and it costs about 750 MB here, because half
    of gpt-oss's 24 layers use sliding-window attention.

    CLAUDE_CODE_MAX_CONTEXT_TOKENS in serve/claude-local.sh must move with it.

.EXAMPLE
    .\gptoss.ps1

.EXAMPLE
    .\gptoss.ps1 -ContextSize 65536 -Port 8081
#>
[CmdletBinding()]
param(
    [int]    $ContextSize = 131072,
    [string] $CacheType = 'q8_0',
    [int]    $Port = 8080
)

# PS 5.1 turns native stderr into a terminating error under Stop. Do not.
$ErrorActionPreference = 'Continue'

# The llama-server binary and the directory holding the GGUF files come from
# the environment, so this runs on a machine other than the one it was written
# on. See .env.example. There is deliberately no default: a typed fallback
# would be wrong everywhere but here, and would fail as a missing file rather
# than as an unset variable.
$Exe      = $env:LLAMA_EXE
$ModelDir = $env:MODEL_DIR
if (-not $Exe)      { Write-Error "LLAMA_EXE is not set. See .env.example."; exit 2 }
if (-not $ModelDir) { Write-Error "MODEL_DIR is not set. See .env.example."; exit 2 }
$Model = Join-Path $ModelDir 'gpt-oss-20b-MXFP4.gguf'

if (-not (Test-Path $Exe))   { Write-Error "llama-server missing: $Exe"; exit 2 }
if (-not (Test-Path $Model)) { Write-Error "model missing: $Model";      exit 2 }

$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listening) { Write-Output "something is already listening on $Port"; exit 1 }

$sizeGiB = [math]::Round((Get-Item $Model).Length / 1GB, 2)
Write-Output "serving gpt-oss-20b MXFP4 ($sizeGiB GiB on disk) at $ContextSize tokens, $CacheType KV cache, on 127.0.0.1:$Port"
Write-Output "expect negative headroom in bench\vram.ps1. That is measured and normal for this model."

& $Exe `
    -m $Model `
    -dev Vulkan0 `
    -ngl 99 `
    -c $ContextSize `
    -ctk $CacheType `
    -ctv $CacheType `
    --host 127.0.0.1 `
    --port $Port `
    --jinja
