# VideoOS

VideoOS is an **integration-first media control plane**.

The project deliberately does **not** reimplement mature editors, AI generation engines, transcription stacks, workflow runtimes, or social publishing platforms. VideoOS owns only the thin product/control layer needed to connect them safely and consistently.

## What VideoOS owns

- project/workspace identity and policy
- engine registry and capability discovery
- canonical asset references and cross-engine handoff
- workflow definitions at the product level
- approvals, scheduling policy, audit and observability
- integration adapters and compatibility tests

Everything else should come from strong upstream engines where practical.

## Foundation set

| Capability | Preferred upstream | Integration mode |
| --- | --- | --- |
| Durable orchestration | `hatchet-dev/hatchet` | service + SDK |
| Creative/story pipeline | `dramaclaw/dramaclaw` | external service/API only |
| Generative image/video graphs | `Comfy-Org/ComfyUI` | external service/API |
| Speech transcription/alignment | `m-bain/whisperX` | worker/service |
| Video editing | `OpenCut-app/OpenCut` | integration target; do not couple core to the current rewrite |
| Social publishing | `gitroomhq/postiz-app` | external service/API |
| Publishing fallback | `inovector/mixpost` | external service/API |
| Media interchange | FFmpeg/ffprobe | system tools behind adapters |

See [`docs/integration-foundation.md`](docs/integration-foundation.md) for the architectural and licensing boundaries.

## Core rule

**Adapters, not forks.** Upstream repositories stay independently deployable and independently upgradeable. VideoOS must never make its canonical project or asset model equal to an upstream repository's internal schema.
