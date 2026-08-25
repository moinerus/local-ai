# local-ai

Running open-weight language models locally on a Windows desktop with an AMD
GPU, fully offline. Launch scripts, runtime config and benchmarks.

Nothing is installed yet. This repo is the scaffold.

## Target machine

| Part | Spec |
| --- | --- |
| GPU | Radeon RX 9070 XT, 16 GB GDDR6, RDNA4, ~640 GB/s |
| System RAM | 32 GB |
| OS | Windows 11 Pro |

AMD, so the runtime is Vulkan or ROCm, never CUDA. Vulkan is faster on decode
on RDNA4 and is already proven on this machine by a resident whisper.cpp server
built with `-DGGML_VULKAN=ON`.

## Planned layout

| Path | What |
| --- | --- |
| `bin/` | Launch scripts for llama-server and the LM Studio endpoint |
| `bench/` | Throughput and VRAM-headroom measurements on this card |
| `config/` | Runtime and model configuration |

## Constraints worth knowing before adding anything

- A resident whisper.cpp server already holds 1.6 GB of video memory, so usable
  VRAM is about 14.4 GB, not 16. Any model sized at 14 GB will not also fit its
  KV cache at full context.
- Models, GGUF weights and binaries are never committed. See `.gitignore`.
- LM Studio runs on Windows, not WSL. WSL localhost cannot reach a Windows
  service.
- Ollama's Windows build currently excludes this card.

## Status

Scaffold only, 25 Aug 2026. First task is measuring real VRAM headroom with
gpt-oss-20b loaded beside the resident whisper server.
