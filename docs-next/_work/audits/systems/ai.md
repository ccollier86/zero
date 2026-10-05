---
id: zero.inventory.ai
type: inventory
audience: [maintainer, agent]
owner: ai
status: draft
visibility: internal
system: ai
feature: system-inventory
maturity: supported
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "standalone AI plugin/service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# AI System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

This inventory covers the server-only AI package, managed app composition,
provider registry, generation and media operations, ephemeral agents, and the
Torrent durable-agent bridge. The pinned source baseline is clean `main` commit
`a3a5f726768dac890f241a3899c0a1acb66265d9`, whose package metadata is 2.1.1.
The documentation branch was at `cd643b5b862f83b4ab40320486e1b89df1154c87`;
its source/package files did not differ from the pinned baseline. This is source
observation, not qualification of a published archive or provider account.

## Purpose And Terminology

Zero AI is a provider-neutral, server-side execution layer over AI SDK 7. A
provider ID identifies one configured adapter; a model reference resolves a
provider and provider model. An alias such as `fast` or `smart` resolves through
the app registry. Capabilities describe an adapter surface, not a guarantee that
every provider model supports it. Hosted-file locators are provider-owned
references. Ephemeral agents execute in one bounded process run; durable agents
pin a versioned definition into Torrent and persist private execution state.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Planned/final guide | Review status |
| --- | --- | --- | --- | --- | --- |
| Managed AI lifecycle and status | Supported; managed/standalone server | `AIService`, `AIServiceOptions`, `createAIPlugin`, `getAI`, `AIStatus` | `src/ai/{ai-service,ai.plugin}.ts`, lifecycle/plugin tests, app composition | [AI guide](../../../backend/ai/index.md) | Authored; independent guide review pending |
| Configuration resolution and registry | Supported; server startup | `AIConfig`, provider config/status types, `resolveAIConfig`, `createAIRegistry`, `parseAIModelReference`, `isAIModelActive` | `src/ai/{ai-env,ai-registry,ai-provider-types}.ts`, env/registry/settings tests | [AI guide](../../../backend/ai/configuration.md) | Authored; independent guide review pending |
| Provider catalog and capability normalization | Supported catalog; server | `AI_PROVIDER_CATALOG`, `AI_PROVIDER_TYPES`, catalog/capability/status types | `src/ai/ai-provider-catalog.ts`, provider catalog/public-type tests | [AI guide](../../../backend/ai/providers.md) | Authored; independent guide review pending |
| Text generation and streaming | Supported; server | `generateText`, `streamText`, generation request/result/stream types | `src/ai/ai-text-operations.ts`, `ai-generation-lifecycle-observability.ts`, SDK 7/request/lifecycle tests | [AI guide](../../../backend/ai/generation.md) | Authored; independent guide review pending |
| Provider-neutral instructions and reasoning | Supported; server | `instructions`, backward-compatible deprecated `system`, `reasoning`, `providerOptions` | `src/ai/ai-types.ts`, generation/provider-options/request snapshot tests | [AI guide](../../../backend/ai/generation.md) | Authored; independent guide review pending |
| Structured output | Supported; server | `AIOutput`, inference/partial/output spec types | `src/ai/ai-output.ts`, SDK 7 compatibility and request tests | [AI guide](../../../backend/ai/structured-output.md) | Authored; independent guide review pending |
| Timeout, abort, retry, and lifecycle controls | Supported; server; abort callback streaming only | SDK 7 total/step/first-chunk/chunk/tool timeouts, `onAbort`, request options | `src/ai/ai-generation*.ts`, operation limits and lifecycle tests | [AI guide](../../../backend/ai/generation-controls.md) | Authored; independent guide review pending |
| Conversations and normalized messages | Supported; server | `AIConversationBuilder`, `AIConversationSessionBuilder`, `toModelMessages`, conversation/message/session types | `src/ai/{ai-conversation,ai-session}.ts`, conversation/session tests | [AI guide](../../../backend/ai/conversations.md) | Authored; independent guide review pending |
| Typed tools and approvals | Supported; server | `aiTool`, `defineAITools`, typed runtime/tool context, signed approval contracts | `src/ai/ai-toolkit.ts`, `src/ai/agents/`, agent definition/runner tests | [AI guide](../../../backend/ai/tools.md) | Authored; independent guide review pending |
| Single and batch embeddings | Supported; server | `embed`, `embedMany`, `AIEmbed*`, `AIEmbedMany*` | `src/ai/ai-embedding-operations.ts`, embedding and limit tests | [AI guide](../../../backend/ai/embeddings.md) | Authored; independent guide review pending |
| Reranking | Supported where provider capability is active; server | `rerank`, `AIRerank*` | `src/ai/ai-rerank-service.ts`, rerank/Bedrock/provider tests | [AI guide](../../../backend/ai/reranking.md) | Authored; independent guide review pending |
| Image generation | Supported where capable; server | `generateImage`, image prompt/result types | `src/ai/ai-image-operations.ts`, image/provider expansion tests | [AI guide](../../../backend/ai/media.md) | Authored; independent guide review pending |
| Transcription and speech | Supported where capable; server | `transcribe`, `generateSpeech`, audio request/result/download types | `src/ai/ai-audio-operations.ts`, audio/provider tests | [AI guide](../../../backend/ai/media.md) | Authored; independent guide review pending |
| Provider-hosted files | Supported, bounded; server | `AIService.files`, service factory, locator/upload/metadata/download/delete types, 64-MiB constant | `src/ai/{ai-files-service,ai-files-types}.ts`, files tests | [AI guide](../../../backend/ai/hosted-files.md) | Authored; independent guide review pending |
| Video generation | Preview, bounded; server | `AIService.video`, `generate`/`start`/`status`, operation/poll/result types, 256-MiB constant | `src/ai/{ai-video-service,ai-video-types}.ts`, video tests | [AI guide](../../../backend/ai/video.md) | Authored; independent guide review pending |
| Safe remote prompt/media materialization | Supported security boundary; Bun server | `AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES` and request media inputs | `src/ai/ai-prompt-download.ts`, prompt/audio/video download tests | [AI guide](../../../backend/ai/security.md) | Authored; independent guide review pending |
| Model-execution preparation | Supported trusted server integration | `createAIModelExecutionPreparer`, `prepareDirectAIModelExecution`, preparation types | `src/ai/ai-model-execution.ts`, model execution tests | [AI guide](../../../backend/ai/model-execution.md) | Authored; independent guide review pending |
| Bounded ephemeral agents | Supported; one process execution | agent definition/registry/service/runner exports, `AIService.createAgentService()` | `src/ai/agents/`, four direct agent/service tests | [AI guide](../../../backend/ai/agents.md) | Authored; independent guide review pending |
| Torrent-backed durable agents | Supported; managed AI + Torrent | durable definitions/runtime/service/result/progress/approval types and constants, async `createDurableAgentRuntime()` | `src/ai/durable/`, four durable tests, app AI/workflow integration test | [AI guide](../../../backend/ai/durable-agents.md) | Authored; independent guide review pending |
| AI workflow activity adapter | Supported trusted integration | `createAIWorkflowHandler`, `AIWorkflowHandlerOptions` | `src/ai/ai-workflow.ts`, `ai-workflow.test.ts` | [AI guide](../../../backend/ai/torrent-integration.md) | Authored; independent guide review pending |
| Errors and observability | Supported; all server modes | `AIError`, `AIErrorCode`, lifecycle/provider/file event projections | `src/ai/ai-errors.ts`, `ai-observability.ts`, observability/lifecycle tests | [AI guide](../../../backend/ai/operations.md) | Authored; independent guide review pending |
| Doctor validation | Supported; managed project diagnostics | Doctor findings, not an AI package import | `src/doctor/platform-doctor-ai-vector.ts` and focused tests | [AI guide](../../../backend/ai/operations.md) | Authored; independent guide review pending |
| Retired direct Meta-hosted Llama compatibility | Retired compatibility tombstone; no network use | `createMetaLlama`, `metaLlama` | `src/ai/adapters/meta-llama.ts`, retirement test | [AI guide](../../../backend/ai/providers.md) | Authored; independent guide review pending |

## Public Surface Map

### Package and service surfaces

- `@zero/framework/ai` is the canonical server-only package. Its barrel exports
  AI errors/output, service/config/status/provider contracts, conversations,
  message and generation types, tools, embeddings, reranking, hosted files,
  video, agents, durable agents, provider catalog/registry helpers, workflow
  adaptation, and the retired Meta Llama compatibility symbols. See
  [`src/ai/index.ts`](../../../../src/ai/index.ts).
- `@zero/framework/server` re-exports the managed server-facing AI service,
  operations, agents, durable runtime, types, and constants. It does not turn
  these APIs into browser-safe imports.
- `AIService` owns `status`/`getStatus`, `conversation`, `session`, text and
  conversation generation/streaming, `embed`, `embedMany`, `rerank`, image,
  transcription, speech, `files`, preview `video`, ephemeral-agent creation,
  and asynchronous durable-runtime creation. See
  [`src/ai/ai-service.ts`](../../../../src/ai/ai-service.ts).
- `createAIPlugin()` decorates Elysia context with the app-local service.
  `getAI()` is a compatibility getter; managed code should use the app-bound
  service. No general public generation route, client hook, or bundled AI UI is
  exposed. An optional status route is the only AI-owned HTTP surface.

### Providers and capabilities

The static catalog contains 44 built-ins: Gateway, OpenAI, Azure, Anthropic,
Anthropic AWS, Bedrock, Google, Vertex, Groq, xAI, Cohere, Mistral, Together AI,
DeepInfra, DeepSeek, Cerebras, Perplexity, Fireworks, Voyage, fal, Luma,
Deepgram, ElevenLabs, Hume, Rev AI, AssemblyAI, Gladia, Fish Audio, Replicate,
Prodia, Black Forest Labs, ByteDance, Kling AI, Cartesia, GMI Cloud, Quiver AI,
Baseten, Hugging Face, Open Responses, Moonshot AI, Alibaba, MiniMax, Z.ai, and
Topaz. `openai-compatible` and `custom` are explicit provider types outside that
built-in list. The public compatibility type retains eight required legacy
capability flags; newer flags are optional and normalize into
`ResolvedAIProviderCapabilities`.

Prodia advertises text/streaming/vision/image/video. Topaz advertises images,
not video, because Zero's prompt contract rejects the blank prompt its video
adapter requires. TypeSafe is not integrated because Zero has no public model
evaluation operation.

### Durable-agent surface

`await ai.createDurableAgentRuntime(registry, { agents })` binds definitions to
an app-local Torrent registry without putting Torrent into ordinary
`AIService`'s base runtime graph. Definitions are immutable and version-pinned.
The durable service starts runs as an actor/system principal, reads progress and
results, handles signed approval responses, and disposes its runtime. Public
durable capacity constants cover a 10-MiB maximum canonical private value,
14-MiB exact stored private state, 3,584 private entries, and an 8-MiB combined
declared-context/cumulative-tool envelope. Torrent's extra internal headroom is
not a public AI capacity promise.

## Integration Map

- `createApp({ ai })` resolves configuration during trusted server startup,
  constructs AI before workflow registration, and passes `{ ai }` to
  `workflows.register`. `ai: false`/omitted disables it; `true` enables env
  detection; an object controls providers and aliases.
- Provider credentials and provider options remain server-only. Provider and
  model selection is resolved before SDK I/O; hosted locators must carry the
  same configured Zero provider ID as the selected model.
- Raw and hosted file parts can appear in text/conversation messages. Direct
  `toModelMessages()` use must supply `{ providerId }` for hosted locators.
- Non-native prompt URLs are downloaded through Bun with DNS pinning,
  redirect validation, and one 64-MiB aggregate budget across sequentially
  materialized assets. Provider-native remote URLs remain remote and do not
  consume that budget. Hosted file transfer has a fixed 64-MiB ceiling; video
  materialization has a fixed 256-MiB ceiling. Transcription/video downloads
  use the same safe network boundary.
- Bedrock runtime inference and agent-runtime reranking can use separate
  endpoints. When native historical tool blocks cannot legally be sent on an
  inactive-tool turn, the Bedrock adapter preserves bounded history as
  non-executable text; it does not activate tools or change `toolChoice`.
  Unsupported, overly deep/non-JSON, binary/reference-file, or over-1-MiB
  projections fail closed. Active native blocks are unchanged.
- Durable agent private context, prompts, tool input/output, and receipts stay
  in Torrent private state; public workflow projections contain bounded status
  and progress. The private receipt is the logical once fence for one committed
  `run.started` and exactly one committed terminal event across retry/restart.
  External observer delivery is post-commit best effort; persisted Torrent
  state is authoritative.
- AI and durable execution use Zero errors and low-cardinality observability.
  Prompt text, provider options, credentials, raw tool context, and raw provider
  errors must not enter public lifecycle metadata.

## Configuration Inventory

| Configuration | Values/defaults and precedence observed | Security/startup effect | Planned section |
| --- | --- | --- | --- |
| `AppConfig.ai` | `false`/omitted disables; `true` enables auto-detection; object is `AIConfig` | Read during trusted app startup | `docs-next/backend/ai/configuration.md#app-switch` |
| `ai.autoDetect` | Boolean; defaults true for true/object app forms; exactly false disables environment scanning | Prevents ambient provider activation when false | `configuration.md#provider-detection` |
| `ai.providers` | Provider ID map; explicit definitions win over auto-detected same ID | Server-only credentials/fetch/settings; `apiKey: null` and `baseURL: null` suppress ambient fallback | `configuration.md#providers` |
| `ai.aliases` | Explicit aliases override environment/default candidates | Controls model resolution, not authorization | `configuration.md#aliases` |
| `ai.filesProvider` | Explicit config precedes `ZERO_AI_FILES_PROVIDER` | Selects provider used by `AIService.files` | `configuration.md#hosted-files` |
| `ai.statusEndpoint` | Disabled by default; false or object with enabled/basePath/read policy; object defaults enabled | Default basePath `/api/_zero/ai`, actual route `/api/_zero/ai/status`; read modes admin, development, admin-or-dev, disabled or custom callback | `configuration.md#status-endpoint` |
| Alias environment keys | `ZERO_AI_FAST_MODEL`, `SMART`, `EMBEDDING`, `IMAGE`, `TRANSCRIPTION`, `SPEECH`, `RERANKING`, `VIDEO` | Server startup; values must be redacted in diagnostics where sensitive metadata is possible | `configuration.md#aliases` |
| Provider environment | Provider catalog supplies API-key/base-URL/settings keys; ID-specific base URL precedes type-specific, with provider-specific cloud rules | Secrets remain server-only; partial cloud credentials do not become ready providers | `configuration.md#provider-environment` |
| Bedrock endpoints | Runtime setting/env and separate agent-runtime setting/`AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME`; region remains required | Reranking uses the agent-runtime provider even with a custom endpoint | `providers.md#amazon-bedrock` |
| Operation limits | Fixed per-operation request/materialization ceilings plus bounded concurrency/retry/timeout options | Validation occurs before or around provider I/O; not mutable DB policy | operation-specific guides |

Doctor uses AI/vector configuration inspection to validate activation, aliases,
capabilities, files provider, status policy, and cloud credential completeness.
It also flags direct AI SDK usage. A reader guide must trace the exact shared
resolver before claiming complete Doctor/runtime parity. Configuration loading
is trusted module execution, not static inspection; this audit did not execute
it or read environment files.

## Evidence And Verification

Implementation observed:

- Public barrels and app composition: `src/ai/index.ts`, `src/ai/ai-service.ts`,
  `src/ai/ai-env.ts`, `src/ai/ai-provider-catalog.ts`,
  `src/frontend/server/app-factory.ts`, and `src/frontend/server/types.ts`.
- Operation implementations: `src/ai/ai-*-operations.ts`, files/video services,
  generation/conversation/model-execution modules, `src/ai/agents/`, and
  `src/ai/durable/`.
- Integrations: `src/ai/ai-workflow.ts`, Doctor AI/vector modules, and package
  export barrels.

Tests present: 39 direct AI test files cover providers/config/public types,
SDK 7 generation and request snapshots, conversation/session, embeddings,
reranking, images/audio/files/video, downloads/limits, observability, tools and
agents, durable capacity/memory/tool budgets/lifecycle, plugin behavior, and
Bedrock history. Additional app-workflow integration, Doctor, and package-export
tests reference AI. The Guardian/Fabric proof example is not an AI example.

Checks run for this inventory: repository text/file searches, clean-baseline
comparison, and static reading of the source catalog. No tests, builds, app
configs, provider calls, network calls, runtime data, or package artifacts were
executed or inspected. Existing `docs/ai*.md`, platform configuration, SDK
reference, and roadmap pages were used only as research evidence.

## Findings

### Detailed Manual And Public Example Evidence

The AI manual is now authored as 22 focused pages linked from its
[system index](../../../backend/ai/index.md). All 23 feature groups above have
an actual guide destination; coupled audio/image and error/Doctor contracts
share focused references. The configuration reference reconciles every public
top-level/provider option, all 44 built-in catalog records, the complete provider
construction-settings interface and observed environment/default precedence.
Detailed-guide independent review and committed/artifact qualification remain
separate gates.

The actual Markdown examples are read and statically compiled by
[the AI authoring regression](../../checks/ai-examples.test.ts). Its 18 complete
configuration/service/blueprint examples compile against public source exports;
they are not executed and do not read environment values, start apps or invoke
providers. This source typecheck is not archive/example runtime qualification.

That check reproduced the agent facade's absent-context inference mismatch:
ordinary tool-free generate/stream calls incorrectly required an unknown
executionContext. The focused generic defaults preserve undefined for those
calls while retaining mandatory matching contexts for explicitly typed service
callers. The positive/negative
[facade type regression](../../../../src/ai/agents/ai-agent-service-types.test.ts)
initially failed on the two ordinary calls and now passes. Combined execution:
`bun --no-env-file test src/ai/agents/ai-agent-service-types.test.ts docs-next/_work/checks/ai-examples.test.ts`
reported **2 passed, 0 failed, 20 assertions**. No public method names, runtime
execution policy, routes or provider credentials changed.

The workflow adapter's declared AIRequestOptions controls were also not all
forwarded. Regressions reproduced the omission and mutable-control race
(**5 passed, 2 failed** before correction). One request projection now forwards
the declared controls while stripping handler-only fields, using the ordinary
bounded snapshots at handler construction. The workflow/snapshot/provider-option
subset passed **12 tests, 0 failures, 46 assertions**. Evidence:
[adapter](../../../../src/ai/ai-workflow.ts) and
[regressions](../../../../src/ai/ai-workflow.test.ts).

A fresh `bun --no-env-file run typecheck` completed successfully after these
source corrections. All correction evidence is uncommitted working source;
the original clean baseline remains separately identified above.

### Authorized Video Integrity Corrections

Controlled provider doubles on 2026-10-05 reproduced four response-integrity
cases: a request for one video accepted two returned files, generated empty
binary files were accepted, and completed asynchronous status accepted empty
binary/base64 media. The targeted suite initially reported **7 passed,
4 failed**. The response validator now checks the admitted requested count and
rejects those empty payloads with `AI_PROVIDER_RESPONSE_INVALID` / 502. Existing
per-file byte limits, pinned asynchronous operation envelopes, preview status
and API shapes are unchanged.

Executed `bun --no-env-file test src/ai/ai-video-service.test.ts`: **11 passed,
0 failed, 39 assertions** with Bun 1.3.14. These are synthetic provider doubles;
no provider traffic, real media or application data was accessed. Evidence:
[video response validation](../../../../src/ai/ai-video-response.ts),
[video orchestration](../../../../src/ai/ai-video-service.ts) and
[regressions](../../../../src/ai/ai-video-service.test.ts). This is uncommitted
working-source evidence, not a qualification of the original clean baseline or
a published package.

### Authorized Session Ownership Corrections

During detailed guide reconciliation on 2026-10-05, controlled-runner tests
reproduced invalid retention admission, overlapping send interleaving, late
replies repopulating manually replaced history, and caller/returned/active
history aliases. Before the fix the targeted session file had **3 passed,
9 failed**. The working correction uses per-session FIFO, detached admitted
messages and request controls, rejection-safe queue progression and manual
history revision fences. Queued stale calls reject AI_REQUEST_ABORTED before
provider execution; running calls can settle for their caller but cannot add
old replies to replaced history. Different sessions remain independent.

The declared maxCharacters option is explicitly approximate pruning in the
baseline type; protecting the retained system/tail is not a hard total-memory
budget defect. That policy is preserved. Invalid explicit maxMessages or
maxCharacters is now rejected as AI_REQUEST_INVALID. A focused helper owns
snapshots/admission; no new route, provider, persistence table or public API
alias was introduced.

Executed with Bun 1.3.14 and no automatic env-file loading:
`bun --no-env-file test src/ai/ai-session.test.ts src/ai/ai-conversation.test.ts src/ai/ai-request-snapshot.test.ts`.
Corrected-source result: **23 passed, 0 failed, 63 assertions across3files**.
All runners are synthetic and controlled; no provider traffic or app data.
These are uncommitted working changes, not a claim that the pinned baseline or
an installed archive contains them. Evidence:
[session](../../../../src/ai/ai-session.ts),
[snapshot helper](../../../../src/ai/ai-session-snapshot.ts),
[session regressions](../../../../src/ai/ai-session.test.ts).

The final queued binary/URL-content admission regression also verifies detached
headers/provider options while a prior turn is held on a controlled barrier.
The final session/conversation/request-snapshot/managed-agent subset passed
**25 tests, 0 failures, 70 assertions** across four files. The managed-agent
fixture verifies rejection before any private-asset network/provider call.

The independent static configuration/generation subset also executed
`bun --no-env-file test src/ai/ai-env.test.ts src/ai/ai-sdk7-compatibility.test.ts src/ai/ai-provider-settings.test.ts`:
**64 passed, 0 failed, 423 assertions**. This does not qualify a live provider or
documentation example/package archive.

| Category | Finding | Evidence/impact | Disposition |
| --- | --- | --- | --- |
| Documentation | The public surface spans many focused contracts; a single AI page cannot safely cover provider readiness, media bounds, agents, and durable semantics | `src/ai/index.ts` and 39 direct test files | Build the planned guide set and cross-link from one system index |
| Maturity | Video is explicitly preview while the rest of the core operation surface is supported | video types/service and current source comments | Preserve preview labeling per operation |
| Compatibility | `system` and the legacy eight required provider capability flags remain compatibility contracts | public types/compatibility tests | Migration guide should prefer `instructions` and optional new capabilities without requiring rewrites |
| Scope | No live provider model/pricing catalog, database-backed provider configuration, OpenAI-compatible public gateway, client hooks, or packaged chat UI is implemented | catalog/config/app/package inspection | Keep these out of current API claims; link approved roadmap items only |
| Release evidence | Source version and tests present do not qualify an npm/archive release or live provider behavior | no artifact/provider checks in this audit | Require release/package/provider-specific qualification separately |

## Known Future Plans

The approved product roadmap records an **AI model catalog and configuration
control plane** as research: provider/Gateway model discovery, effective-dated
capability/pricing metadata, and an explicit trusted env-versus-database model.
It is not a current API. The roadmap also lists AI usage/cost accounting, an AI
chat component package, and schema-declared AI behavior. The historical AI
layer plan keeps a public OpenAI-compatible gateway as future work. Provenance:
[`docs/platform-roadmap.md`](../../../../docs/platform-roadmap.md) and
[`docs/ai-layer-plan.md`](../../../../docs/ai-layer-plan.md). The future reader
home is `docs-next/backend/ai/roadmap.md`; do not duplicate its detailed backlog
in feature guides.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned public home:
`docs-next/backend/ai/index.md`, with configuration, providers, generation,
structured output, conversations, tools, embeddings/reranking, media, hosted
files/video, ephemeral agents, durable agents, security, operations, migration,
and roadmap pages. Cross-link Torrent, Scheduler, Vector, Storage, Guardian,
observability, platform configuration, deployment secrets, and server-only
imports. There is no public frontend AI guide until a client/UI surface ships.

## Independent Inventory Review

Root independently checked the public AI barrel/service methods, resolver,
plugin and status policy against source, and reconciled agent/durable/tool/media
destinations with the export catalog. The status route is `basePath + /status`,
not the basePath itself. Its `admin` policy tests the live legacy global
`role === 'admin'`; administration-organization membership or application-role
permissions alone do not satisfy that particular compatibility policy. An app
needing a different status policy supplies the documented read callback.
This is a static contract review, not provider or archive qualification.

## Completion Review

- [x] Discovered AI feature groups and public barrel/service surfaces recorded.
- [x] Managed app, provider, media-security, Torrent, Doctor, and observability integrations traced from source.
- [x] Implementation observation, tests present, and checks run separated.
- [x] Current scope and roadmap work separated.
- [x] Every provider-specific setting/default reconciled into the authored configuration reference.
- [x] Every inventoried AI feature maps to an actual detailed guide and parent index entry.
- [x] Complete AI configuration/service examples statically checked against public source exports.
- [ ] Detailed AI guides independently reviewed and corrected committed/package baseline qualified.
- [ ] Package artifact and representative live-provider behavior qualified for a release claim.
- [ ] Whole-platform independent review completed.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory verified or beginning detailed feature rewriting.
