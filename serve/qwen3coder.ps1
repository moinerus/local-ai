<#
.SYNOPSIS
    Starts llama-server on Qwen3-Coder-30B-A3B, pinned to the discrete card,
    with the sparse experts held in system RAM.

.DESCRIPTION
    Serves an OpenAI-compatible API on 127.0.0.1:8080, the same port qwen.ps1
    and gptoss.ps1 use. The card holds one model at a time, so all three
    scripts refuse to start if something is already listening.

    This model was ruled out on 26 Aug 2026 because its 16.45 GiB file exceeds
    anything the card has free, and that ruling was against the wrong
    mechanism. --n-cpu-moe keeps the sparse expert tensors in system RAM, so
    the file size never bound.

    Measured on this machine on 26 Aug 2026:

        prefill @16k depth    610 tok/s
        generation @0         36 to 45 tok/s
        generation @27.5k     15.74 tok/s
        loss to depth         57%

    The depth figure is what decides where this model can be used. Against
    Qwen3.5-9B's 11% loss and gpt-oss-20b's 9%, it runs 4.3 times slower at
    27,525 tokens, and an agentic session lives at high depth by construction.
    D12 records it as single-shot only for that reason.

    Two things here are not defaults.

    -dev Vulkan0 pins the model to the RX 9070 XT. This machine exposes a
    second Vulkan device, the integrated "AMD Radeon(TM) Graphics", which
    reports 16209 MiB because it borrows system RAM. Without the pin a model
    can land there, run from system RAM at a fraction of the speed, and look
    like it worked.

    -ncmoe 24 holds 24 layers of expert tensors off the card. Re-swept 20 to
    28 at five repetitions on 26 Aug 2026: 21 through 25 all land within one
    standard deviation of each other, and 24 itself read tg128 38.62 +/- 1.14
    against the 45.11 +/- 0.24 recorded hours earlier on a lighter desktop.
    The variation between sessions is larger than the variation between
    settings, so 24 is kept because nothing beats it rather than because it
    won. Do not tune this number.

    No --chat-template-file. This model's own template works as built. qwen.ps1
    needs a patched one because Qwen3.5-9B's template rejects a system message
    after position 0.

.NOTES
    The KV cache cost at this context has not been measured on this model. The
    figures recorded for the other two do not carry over: gpt-oss-20b's cache
    is cheap because half its layers use sliding-window attention, and this
    model's attention layout is its own. Read the card after the first load:

        .\bench\vram.ps1

.PARAMETER ContextSize
    Context window in tokens. Default 131072, matching gptoss.ps1 so a bench
    run against this model is comparable with the runs already recorded.

    CLAUDE_CODE_MAX_CONTEXT_TOKENS in serve/claude-local.sh must move with it
    if this model is ever put behind the Claude Code lane.

.PARAMETER ExpertOffload
    Layers passed to --n-cpu-moe. Default 24.

.EXAMPLE
    .\qwen3coder.ps1

.EXAMPLE
    .\qwen3coder.ps1 -ContextSize 32768 -ExpertOffload 22
#>
[CmdletBinding()]
param(
    [int]    $ContextSize = 131072,
    [string] $CacheType = 'q8_0',
    [int]    $ExpertOffload = 24,
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
$Model = Join-Path $ModelDir 'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf'

if (-not (Test-Path $Exe))   { Write-Error "llama-server missing: $Exe"; exit 2 }
if (-not (Test-Path $Model)) { Write-Error "model missing: $Model";      exit 2 }

$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listening) { Write-Output "something is already listening on $Port"; exit 1 }

$sizeGiB = [math]::Round((Get-Item $Model).Length / 1GB, 2)
Write-Output "serving Qwen3-Coder-30B-A3B UD-Q4_K_XL ($sizeGiB GiB on disk) at $ContextSize tokens, $CacheType KV cache, on 127.0.0.1:$Port"
Write-Output "expert offload -ncmoe $ExpertOffload. Load is slower than the other two models because the experts go to system RAM."

& $Exe `
    -m $Model `
    -dev Vulkan0 `
    -ngl 99 `
    --n-cpu-moe $ExpertOffload `
    -c $ContextSize `
    -ctk $CacheType `
    -ctv $CacheType `
    --host 127.0.0.1 `
    --port $Port `
    --jinja
