---
id: zero.ai.compatibility
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: compatibility
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


# AI Compatibility And Upgrade Checks

[Zero AI](./index.md) · [Operations](./operations.md) · [Documentation index](../../index.md)

This manual describes inspected Zero 2.1.1 source with AI SDK 7.0.127 and provider
contract 4.0.21. It is not a claim that an older release line, an independently
maintained SDK or every provider account shares these contracts. Verify the
actual installed package and app dependency lock when upgrading.

## Existing Calls And Additive Capabilities

Existing AIService generation, conversations, embedding, image, transcription
and speech method names remain the service boundary. New controls and
modalities do not require replacing ordinary generateText calls with direct
provider SDK usage. Configuration/provider selection remains server-side.

Prefer instructions for new text/conversation code. The deprecated system
string remains supported and is normalized to SDK instructions. System and
developer messages are lifted into trusted instructions; explicit messages
take precedence over prompt. See [generation](./generation.md) and
[conversations](./conversations.md) before changing message construction.

Structured output is an additive output specification through the same
generation API, not a separate arbitrary JSON parser. Partial stream values
are not final schema-valid values. SDK-native result/stream types can change
with their SDK generation even when Zero method names do not; inspect apps that
reach into deeply nested provider/SDK fields.

## Custom Provider Boundary

AIProviderAdapter accepts ProviderV3 or ProviderV4. Normalization preserves V4
extensions and canonical enumerable modality aliases needed by the SDK
registry, including transcriptionModel, speechModel, videoModel and files.
A successful languageModel lookup does not prove every extension exists.

The public AIProviderCapabilities type retains the eight required legacy flags:
text, streaming, tools, vision, embeddings, images, transcription and speech.
Newer reranking/video/files/file lifecycle/skills/realtime/evaluation/batch
flags are optional for source compatibility and normalize into a fully populated
ResolvedAIProviderCapabilities. Config capability overrides may be partial.

Do not advertise capabilities without the actual adapter operation. Provider
flags are adapter-level maxima; per-model support, account limits and native
provider options still need qualification. Preview capability flags do not
create nonexistent Zero realtime, evaluation or batch methods.

## Bedrock Tool History

Amazon Bedrock's native Converse blocks require an active tool configuration.
On a turn with no active tools, Zero's Bedrock wrapper retains completed
tool-call/result/approval history as bounded non-executable text rather than
allowing the underlying adapter to discard it. Active native tool blocks remain
unchanged; toolChoice is not silently enabled.

The synthesized projection is at most 1 MiB UTF-8. Non-JSON, excessive nesting,
unsupported custom/binary/reference-file content and invalid empty tool messages
fail closed with AI_REQUEST_INVALID. Supported text/JSON/denial/error and inline
text-file output is preserved. This is conversation context, not an instruction
to rerun a historical effect. See [providers](./providers.md#amazon-bedrock) and
[tools](./tools.md) for the app's effect/authority boundary.

## Retired Direct Meta Provider

The former direct Meta-hosted Llama type/imports remain compatibility tombstones,
not an operational adapter. createMetaLlama()/metaLlama model lookup raises
AI_PROVIDER_RETIRED with status 410 without network traffic. A configured retired
provider cannot be restored by supplying another key.

Use an app-configured supported Llama host/model or compatible endpoint, with
current account qualification. Retiring the direct Meta adapter does not remove
Llama model families hosted by other providers. Change the provider/model alias,
not unrelated Zero conversation/tool code.

## Working Corrections In This Documentation Pass

The original clean source baseline is separate from three uncommitted focused
corrections described in their affected guides:

- [Sessions](./conversations.md) now reject invalid retention settings, serialize
  sends per session, detach histories/controls and fence late replies after
  manual replacement. maxCharacters remains approximate retained-history pruning.
- [Preview video](./video.md) rejects results exceeding requested n and empty
  materialized/inline completed media.
- [Workflow adapter](./torrent-integration.md) forwards every declared
  AIRequestOptions control and snapshots configured mutable controls before
  asynchronous derivation.

These changes preserve method signatures but intentionally correct invalid or
racy behavior. This draft does not claim they are in the original clean commit,
an npm release or an app's installed archive. The documentation release gate
will assign a corrected committed/artifact baseline separately.

## Persistence And Deployment

Ordinary AIService calls and process-local sessions do not create AI-owned
conversation/provider-configuration tables, so those additive operation
features alone do not require an AI database migration. Enabling durable agents
requires the app's current Torrent system tables/private-memory infrastructure,
exact registered agent versions and the appropriate system-database composition.

Do not assume an old single-database app is migrated to Guardian/Fabric merely
by importing an AI method. Follow the target platform's actual database/auth
upgrade instructions. Retain exact definitions needed by in-flight workflows;
a new model alias is not a migration of existing video operation envelopes.

Provider credentials and construction settings are read at trusted service
startup. Restart/rebuild the service after changing declarations; there is no
documented DB-backed hot provider reconfiguration API.

## Upgrade Verification

1. Record the installed Zero version/source provenance and SDK dependency lock.
2. Typecheck the application's public AI imports, custom adapters and accessed
   native SDK result/stream fields.
3. Run focused synthetic generation/stream/tools/output and media-bound tests.
4. If used, test session concurrency/clear, Bedrock inactive-tool history, file
   locator/provider matching and video operation alias pinning.
5. For Torrent integrations, test control forwarding, live authority/cancellation,
   exact definition recovery and run-specific approval idempotency.
6. Qualify the real provider account separately with authorized synthetic input.
7. Keep the previous deployment/artifact and runtime backup available while
   validating the actual app update.

## Related Guides And Next Steps

[Configuration](./configuration.md) owns provider activation and precedence.
[Provider settings](./provider-settings.md) owns construction credentials and
endpoints. [Operations](./operations.md) distinguishes readiness/events from
account billing, and [roadmap](./roadmap.md) describes planned catalog/config UI.
