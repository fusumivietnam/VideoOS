# VideoOS integration-first foundation

Status: baseline decision after repository reset on 2026-09-17.

## 1. Strategy

VideoOS is a thin control plane around mature upstream engines. The default decision is **integrate before build**.

Before implementing a capability, ask in this order:

1. Can a maintained upstream service already do it well?
2. Can VideoOS integrate through HTTP/API/CLI/events without importing its internal schema?
3. Is the upstream license compatible with the intended deployment model?
4. Can that engine be replaced without migrating VideoOS canonical project/asset data?
5. Only if the answers above fail should VideoOS implement the capability itself.

## 2. Canonical boundary

VideoOS owns only portable product concepts:

- `ProjectRef`
- `AssetRef`
- `EngineBinding`
- `WorkflowRef`
- `ExecutionRef`
- `PublishRef`
- `ApprovalRef`
- normalized events/audit records

An upstream project ID, workflow JSON, node graph, timeline format, provider receipt or remote post ID is stored only as an **external binding**, never as VideoOS canonical truth.

Conceptually:

```text
User / API
    |
    v
VideoOS control plane
    |
    +-- Engine Registry / Capability Registry
    +-- Canonical Project + Asset references
    +-- Policy / Approval / Audit
    |
    v
Hatchet durable workflows
    |
    +-- DramaClaw     creative/story pipeline
    +-- ComfyUI       image/video generation
    +-- WhisperX      transcription/alignment
    +-- OpenCut       editing (when Editor API stabilizes)
    +-- FFmpeg        media interchange/transforms
    +-- Postiz        multi-network publishing
    `-- Mixpost       optional publishing fallback
```

## 3. Recommended upstream set

### Hatchet — adopt as orchestration foundation

Repository: `hatchet-dev/hatchet`

Role:
- durable background tasks
- retries/concurrency
- DAG/workflow execution
- event-driven jobs
- TypeScript/Python workers

Why:
- removes the need for VideoOS to own another queue/lease/retry engine
- MIT licensed
- can remain a separately deployed infrastructure service

VideoOS should define product workflows and adapter activities; Hatchet owns execution mechanics.

### DramaClaw — adopt as optional creative engine, external only

Repository: `dramaclaw/dramaclaw`

Role:
- script/story to scenes/shots
- storyboard and creative asset workflow
- AIGC video pipeline
- creative agent/canvas experience

Boundary:
- Community Edition is Elastic License 2.0 / source available
- do not vendor/fork it into the VideoOS core for a hosted product
- integrate through supported API/CLI/service boundaries and keep it optional

DramaClaw should be replaceable by another `CreativeEngineAdapter`.

### ComfyUI — adopt as generation engine

Repository: `Comfy-Org/ComfyUI`

Role:
- image/video/audio model graphs
- local GPU generation
- model ecosystem and custom nodes

Boundary:
- run as an independent service
- VideoOS stores workflow references, inputs and normalized output assets, not ComfyUI node internals as canonical product state
- GPL-3.0 means integration/distribution choices must stay explicit; service isolation is preferred

### WhisperX — adopt for transcription/alignment

Repository: `m-bain/whisperX`

Role:
- transcription
- word-level timestamps
- alignment
- diarization where configured

Boundary:
- run as a worker/service
- persist normalized transcript/subtitle artifacts back into VideoOS object storage
- BSD-2-Clause is permissive

`SYSTRAN/faster-whisper` can be a lighter transcription-only adapter if alignment/diarization is unnecessary.

### OpenCut — watch/prototype, not a core dependency yet

Repository: `OpenCut-app/OpenCut`

Role when stable:
- interactive timeline/editor surface
- Editor API
- headless rendering
- plugin model/MCP

Current constraint:
- the project is being rewritten from the ground up
- the current README lists Editor API, headless mode, MCP and plugin-first architecture as upcoming
- `opencut-classic` is archived

Therefore build an `EditorAdapter` contract now, but delay hard coupling to OpenCut until its new API stabilizes.

### Postiz — adopt as fast multi-network publishing engine, external only

Repository: `gitroomhq/postiz-app`

Role:
- social account connections
- scheduling
- publishing across many networks
- social automation/analytics surface

Boundary:
- AGPL-3.0
- run as a separately deployed service and review obligations before commercial hosted distribution
- VideoOS should not copy its provider adapters into core

This replaces the plan to hand-build YouTube/TikTok/Instagram/Facebook adapters one by one.

### Mixpost — optional permissive publishing fallback

Repository: `inovector/mixpost`

Role:
- self-hosted scheduling and multi-platform publishing

Trade-off:
- MIT licensed and easier from a licensing perspective
- substantially smaller ecosystem and less recent repository activity than Postiz at the time of this decision

Evaluate it as fallback or for deployments where AGPL constraints make Postiz undesirable.

## 4. What not to build in VideoOS v1

Do not build from scratch:

- custom durable queue/workflow runtime
- full timeline video editor
- diffusion/model graph execution
- story-to-shot creative pipeline
- Whisper transcription/alignment stack
- one native social adapter per network
- generic no-code automation builder
- custom media codecs/rendering engine

VideoOS may add narrow glue when an upstream boundary is insufficient, but that glue stays behind an adapter.

## 5. Repository layout

Keep the VideoOS repository intentionally small:

```text
apps/
  web/                    # thin control plane UI
  api/                    # thin API/BFF
packages/
  contracts/              # VideoOS canonical portable contracts
  engine-registry/        # capabilities, health, versions
  adapters/
    hatchet/
    dramaclaw/
    comfyui/
    whisperx/
    opencut/
    postiz/
    mixpost/
infra/
  compose/                 # optional local integration topology
docs/
```

Do not add upstream source trees under `vendor/` or copy them into the monorepo.

## 6. Upgrade model

Each upstream integration must declare:

- engine ID and version
- capability set
- health endpoint/check
- input/output contract version
- compatibility range tested by VideoOS
- license classification
- deployment mode

Upstream upgrades happen independently. VideoOS compatibility tests protect the adapter boundary.

## 7. First implementation sequence

1. Bootstrap tiny TypeScript control-plane/contracts repository.
2. Integrate Hatchet and prove one durable `engine.execute` workflow.
3. Integrate ComfyUI and normalize one generated asset.
4. Integrate WhisperX and normalize one transcript/subtitle artifact.
5. Integrate Postiz for one scheduled social publish; keep Mixpost as a comparison path.
6. Add DramaClaw as optional creative project/export engine.
7. Prototype OpenCut only after the rewrite exposes a stable Editor API/headless contract.
8. Add observability around cross-engine workflow latency/failure/cost before adding more engines.

The first usable product should prove an end-to-end path across existing engines rather than maximize VideoOS-owned code.
