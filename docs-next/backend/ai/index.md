---
id: zero.ai.index
type: index
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: system
maturity: supported
applies_to: ["2.1.1 source baseline"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Zero AI

[Backend systems](../index.md) · [Documentation index](../../index.md)

Zero AI is the server-side AI layer over AI SDK 7. It centralizes configured
providers, model aliases, generation, tools, embeddings and media, with bounded
agents and a Torrent-backed durable-agent runtime. Applications use the same
service API across providers; provider/model-specific behavior remains explicit.

This draft describes the inspected Zero 2.1.1 source contract. It is not an
installed-package or live-provider qualification, and does not replace older
release documentation.

## Choose Your Integration

| Need | Use | Ownership |
| --- | --- | --- |
| AI inside a normal Zero app | `createApp({ ai: ... })` and the app-bound AI service | Zero manages service composition and observability; app authorizes each product action. |
| AI inside a standalone Bun service | `resolveAIConfig()`, then `new AIService(resolved)` | Caller composes routes, authentication, cancellation and shutdown. |
| One bounded tool-using task | `ai.createAgentService()` | Process-local execution; not persistent recovery. |
| An agent that survives retries/restarts or waits for approval | `await ai.createDurableAgentRuntime(registry, options)` | Torrent owns private durable execution state and version-pinned runs. |

Use `@zero/framework/ai` for server imports. AI is not a browser SDK namespace:
never include provider credentials, configured adapters or AIService in a client
bundle. There is no default public generation endpoint, chat UI or end-user
permission granted merely by enabling AI. A route/service must authorize its
actor, validate its inputs and call the app-bound service.

## Core Vocabulary

- A **provider ID** is an app configuration key, such as `primary`; its adapter
  **type** can be `openai`, `amazon-bedrock`, `custom`, or another supported type.
- A **model reference** is `providerId/modelId`. The first slash separates the
  Zero provider; further slashes belong to the provider's model ID.
- A **model alias**, such as `smart`, maps to one model reference. An alias changes
  model selection, not authorization or an app's persistence policy.
- **Capabilities** describe the configured adapter's maximum operation surface.
  They do not discover every model or prove that a particular model supports it.
- A **hosted file locator** identifies a provider-owned uploaded file, not a Zero
  Storage file. It carries a provider binding that must match its model.
- **Ephemeral agents** are bounded in-process tasks. **Durable agents** use
  Torrent's private state, activities, approval waits and recovery.

## Reference And Tasks

- [Configuration](./configuration.md): enable AI, choose explicit versus detected
  providers, define aliases and protect the optional status route.
- [Providers](./providers.md): all 44 built-in identities, capabilities, static
  model candidates, compatible/custom adapters and Bedrock history handling.
- [Provider settings](./provider-settings.md): complete construction settings,
  cloud credential modes and independent Bedrock endpoints.
- [Text generation](./generation.md): completed and streaming calls, instructions,
  reasoning and authorized app-service/HTTP integration.
- [Generation controls](./generation-controls.md): exact timeout, retry, mutable
  input, callback, context and telemetry contracts.
- [Structured output](./structured-output.md): typed object/array/choice/JSON
  results and partial-versus-final streaming.
- [Conversations](./conversations.md): explicit histories, multimodal/tool message
  normalization and temporary session ownership.
- [Tools and approvals](./tools.md): compatibility helpers, typed agent tools,
  runtime/tool/execution context and signed ephemeral approvals.
- [Embeddings](./embeddings.md): single/batch vectors, exact ordering, concurrency
  and integrity bounds.
- [Reranking](./reranking.md): homogeneous document batches, original indices,
  scores and provider-result verification.
- [Media](./media.md): image/transcription/speech inputs, outputs, fixed limits
  and authorized retention.
- [Provider-hosted files](./hosted-files.md): bounded external uploads, durable
  provider locators, downloads/metadata/delete and ownership boundaries.
- [Preview video](./video.md): bounded generated files, model-pinned operations,
  polling/webhook controls and private provider result data.
- [Security](./security.md): app authority, Bun DNS-pinned remote materialization,
  redirects, byte/cancellation boundaries and privacy.
- [Model execution](./model-execution.md): trusted resolution/capability/download
  and lifecycle preparation for custom runners.
- [Ephemeral agents](./agents.md): immutable versions, process-local tools,
  contexts, execution limits and native SDK result/stream behavior.
- [Durable agents](./durable-agents.md): Torrent installation, actor/system runs,
  private state, exact approvals, recovery and scope-checked results.
- [Torrent integration](./torrent-integration.md): one AI call as a registered
  workflow activity with live authority, cancellation and request controls.
- [Operations](./operations.md): complete error families, events, safe metadata,
  readiness/Doctor diagnostics and failure triage.
- [Compatibility](./compatibility.md): existing call shapes, SDK/custom-provider
  boundaries, Bedrock history, retired providers and app upgrade checks.
- [Roadmap](./roadmap.md): current boundaries versus approved research and future
  extensions.

The references above cover the inventoried public AI surface. They remain
source-backed drafts pending independent detailed-guide review and committed
package/example qualification; navigation coverage is not release readiness.
Affected conversation, video and workflow-adapter guides explicitly separate
working corrections from the original clean source baseline.

## Architecture And Design Principles

Provider resolution happens before model I/O. Credentials and construction
settings stay server-only. SDK clients belong to the service registry; Elysia's
AI plugin owns decoration, status transport and lifecycle, not model business
logic. Managed routes should use app-bound services so one app cannot redirect
another app's observability/provider selection through a process-global getter.

The following design philosophy is inferred from those contracts: a small
provider-neutral API, explicit capabilities and account readiness, bounded
untrusted media materialization, typed app-owned tools, and deliberate opt-in to
durability rather than hidden persistence. Enabling AI does not automatically
log prompts, store conversations, grant tenant access or provide a pricing
catalog.

## Related Guides And Next Steps

Start with [configuration](./configuration.md) to choose a server-only provider
boundary. The [backend index](../index.md) connects AI to data/schema and other
systems as those guides are completed. Consult the [roadmap](./roadmap.md) for
model discovery, usage accounting and UI work; those are not present-day APIs.
