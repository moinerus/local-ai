# local-ai

Running open-weight language models locally on a Windows desktop with an AMD
GPU, fully offline. Launch scripts, runtime config and benchmarks.

Working since 26 Aug 2026. llama.cpp b10631 serves Qwen3.5-9B Q6_K on Vulkan,
and both consumers reach it over loopback.

## Target machine

| Part | Spec |
| --- | --- |
| GPU | Radeon RX 9070 XT, 16304 MiB reported, RDNA4, ~640 GB/s |
| System RAM | 32 GB |
| OS | Windows 11 Pro |

AMD, so the runtime is Vulkan or ROCm, never CUDA. Vulkan is faster on decode
on RDNA4 and is already proven on this machine by a resident whisper.cpp server
built with `-DGGML_VULKAN=ON`.

## Layout

| Path | What |
| --- | --- |
| `bench/vram.ps1` | Dedicated VRAM per process, grouped by name, with headroom |
| `serve/qwen.ps1` | Starts llama-server on Qwen3.5-9B, pinned to the discrete card |
| `serve/qwen3.5-chat-template.jinja` | The model's chat template, one branch patched |
| `serve/claude-local.sh` | Starts Claude Code in WSL against the local endpoint |

## Measured on this machine, 26 Aug 2026

| Reading | Figure |
| --- | --- |
| Qwen3.5-9B Q6_K, 32k context, zero tokens | 7787.5 MiB |
| The same, 27,525 tokens resident | 7816.9 MiB |
| Total on card at 128k with a q8_0 KV cache | 13682.9 MiB, 2.56 GiB spare |
| Prefill | 1909 tok/s over 27,525 tokens |
| Decode | 67.97 tok/s |

The KV arithmetic that drove model selection estimated 9.2 GiB and the reading
is 7.63 GiB, so it ran 1.6 GiB high. llama.cpp allocates the whole KV cache at
load, which is why the zero-context reading is already the worst case.

## Constraints worth knowing before adding anything

- **The desktop is a range, not a number.** 2.93 GB in use at a fresh boot,
  rising to about 5.35 GB across a working day, before anything local runs.
  Plan against the working-day end.
- **Pin `-dev Vulkan0` on every launch.** This machine exposes a second Vulkan
  device, the integrated GPU, reporting 16209 MiB against the card's 16304. A
  model landing there runs from system RAM and still returns correct output, so
  nothing looks wrong.
- **The resident whisper.cpp server holds 916.8 MiB** on its q5_0 build. It was
  1920.8 MiB on f16, and everything written before it was measured planned
  around 1.6 GB.
- Models, GGUF weights and binaries are never committed. See `.gitignore`.
- **llama-server runs on Windows, not WSL.** A WSL process reaches it only
  because `networkingMode=mirrored` is set in `%USERPROFILE%\.wslconfig`.
  Without that, WSL is in NAT mode and cannot reach a Windows loopback service
  at all.
- Ollama's Windows build currently excludes this card.

## Status

The endpoint works and Claude Code has run against it end to end. Whether the
model is worth using is open: on the two concrete tasks it has been given, the
mechanism worked both times and the answer was confidently wrong both times.
