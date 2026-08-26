<#
.SYNOPSIS
    Starts llama-server on Qwen3.5-9B, pinned to the discrete card.

.DESCRIPTION
    Serves an OpenAI-compatible API on 127.0.0.1:8080, for both the notes
    plugin and the Claude Code lane.

    Two things here are not defaults and both matter:

    -dev Vulkan0 pins the model to the RX 9070 XT. This machine exposes a
    second Vulkan device, the integrated "AMD Radeon(TM) Graphics", which
    reports 16209 MiB because it borrows system RAM. Without the pin a model
    can land there, run from system RAM at a fraction of the speed, and look
    like it worked.

    -c 131072 with a q8_0 KV cache. The model was trained for 262144, so the
    context is a VRAM choice, not a model limit. Measured on this card with
    whisper up:

        32k,  f16 cache   12409.2 MiB total,  3.80 GiB headroom
        64k,  f16 cache   13477.8 MiB total,  2.76 GiB headroom
        128k, f16 cache   15594.4 MiB total,  0.69 GiB headroom
        128k, q8_0 cache  13682.9 MiB total,  2.56 GiB headroom

    Quantising the cache to q8_0 costs about the same as halving the context
    and keeps twice as much of it. 128k at f16 leaves 0.69 GiB, which is one
    browser tab from spilling into system RAM.

    128k matters here because the context is not free at the start. The vault's
    always-loaded CLAUDE.md and rules files alone measure 16,755 tokens through
    /v1/messages/count_tokens, before Claude Code's own system prompt and tool
    definitions.

    llama.cpp allocates the whole KV cache at load, so these are worst-case
    figures rather than starting points.

.PARAMETER Quant
    Which build to serve. Q6_K is the pick and it measured 7.63 GiB at 32k
    against a 9.2 GiB estimate, so the Q4_K_M fallback is not needed. Kept as
    an option for a session that wants the headroom back.

    Q4_K_M is not on disk. Passing it fails the existence check below with a
    named path rather than starting on the wrong model, so the option costs
    nothing until someone downloads the file.

.PARAMETER ContextSize
    Context window in tokens. Default 131072, with a q8_0 KV cache. See the
    table above for what each rung costs.

.EXAMPLE
    .\qwen.ps1

.EXAMPLE
    .\qwen.ps1 -Quant Q4_K_M
#>
[CmdletBinding()]
param(
    [ValidateSet('Q6_K', 'Q4_K_M')]
    [string] $Quant = 'Q6_K',
    [int]    $ContextSize = 131072,
    [string] $CacheType = 'q8_0',
    [int]    $Port = 8080
)

# PS 5.1 turns native stderr into a terminating error under Stop. Do not.
$ErrorActionPreference = 'Continue'

$Exe   = 'C:\llama.cpp\llama-server.exe'
$Model = "C:\models\Qwen3.5-9B-$Quant.gguf"

# Without this the model's own template raises "System message must be at the
# beginning" for any system-role message after position 0. Claude Code sends
# one, so every request returns a 500 that names a line in the built-in
# template rather than anything about this script. The patched copy renders a
# ChatML system turn there instead. Relative to this script, so the repo can
# move.
$Template = Join-Path $PSScriptRoot 'qwen3.5-chat-template.jinja'

if (-not (Test-Path $Exe))      { Write-Error "llama-server missing: $Exe";       exit 2 }
if (-not (Test-Path $Model))    { Write-Error "model missing: $Model";            exit 2 }
if (-not (Test-Path $Template)) { Write-Error "chat template missing: $Template"; exit 2 }

$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listening) { Write-Output "something is already listening on $Port"; exit 1 }

$sizeGiB = [math]::Round((Get-Item $Model).Length / 1GB, 2)
Write-Output "serving $Quant ($sizeGiB GiB on disk) at $ContextSize tokens, $CacheType KV cache, on 127.0.0.1:$Port"

& $Exe `
    -m $Model `
    -dev Vulkan0 `
    -ngl 99 `
    -c $ContextSize `
    -ctk $CacheType `
    -ctv $CacheType `
    --chat-template-file $Template `
    --host 127.0.0.1 `
    --port $Port `
    --jinja
