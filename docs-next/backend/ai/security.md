---
id: zero.ai.security
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: safe-media-and-authority
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


# AI Security And Remote Media

[Zero AI](./index.md) · [Generation controls](./generation-controls.md) · [Documentation index](../../index.md)

Zero separates trusted server composition, model capability admission, bounded
media transport and sanitized telemetry. These boundaries do not authorize an
actor's product action or make provider-hosted content public.

## Application Authority Comes First

AIService is a trusted server service, not a public client capability. Enabling
AI does not install a generation route, assign a Guardian permission, authorize
a tenant's data, or persist conversation history. An app route/service must:

1. Verify the current actor and organization through the normal service boundary.
2. Validate bounded input and apply the app's permissions, quotas and retention.
3. Select an allowed server-owned model/provider/toolset.
4. Pass an appropriate abort signal and call the app-bound service.
5. Return only the product's intended output; retain content in authorized storage.

Do not accept arbitrary adapter credentials, base URLs, executable tool
definitions or execution-context services from a browser request. A model
requesting a tool is not permission to run it. A signed tool approval is not a
replacement for live domain authorization.

The shared [server-services boundary](../runtime/server-services.md) and
[machine-principal boundary](../runtime/machine-services.md) explain trusted
service construction. Keep secrets out of frontend bundles; see
[provider settings](./provider-settings.md).

## Remote Input Transport

Non-native prompt URLs, remote transcription audio and materialized generated
video use the shared Bun transport. It rejects embedded URL credentials and
uses the pinned SDK download-URL policy. Hostnames are resolved through
Bun.dns.lookup; every returned address must pass the public-address policy.
The connection is pinned to a checked address while retaining the logical Host
header and HTTPS serverName. A DNS change cannot redirect that particular
connection after validation.

Redirects are manual and capped at ten hops. Every hop is URL/address checked
and its response body is cancelled before following the next location.
Content-Length is an early size check, never the only check: streaming bytes
are counted, excess reads are cancelled and reader locks released. Non-success
HTTP responses and transport failures become safe AI errors.

The transport also admits SDK-approved data URLs without DNS lookup, subject
to the same materialization byte limit. It does not authorize file-system
access or provide a blanket localhost/private-network exception. The limited
development localhost exception for video webhook *URLs* is a different
provider-notification setting, not a prompt-download bypass.

## Prompt Budget And Provider-Native URLs

The exported AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES is 64 MiB. Text/conversation
and prepared agent executions install a prompt download hook with that
default. Each hook invocation processes its asset batch sequentially and
shares one remaining-byte balance across assets it actually materializes.
This prevents every URL in that batch independently allocating the full limit.

Assets the provider model supports as remote URLs return null to the SDK
downloader and remain remote. They are not fetched by Zero and do not consume
that materialization balance. Provider-side fetch policy and document access
remain the application's responsibility. The local byte ceiling is not a
total input-token, process-RAM, external provider transfer or lifetime quota;
multiple generation steps can invoke materialization again.

The download scope combines caller cancellation with remaining total/step
timeouts. DNS, fetch and body reads are abort-aware. A downloader cannot undo a
remote operation already accepted by a provider.

## Operation-Specific Bounds

| Operation | Local materialization/response boundary |
| --- | --- |
| Text/conversation prompt batch | Default 64 MiB aggregate for fetched assets in one hook invocation. |
| Transcription audio | 64 MiB admitted audio input. |
| Provider-hosted file upload/download | Fixed 64 MiB ceiling, lowerable per operation. |
| Generated images | 64 MiB per image; 256 MiB aggregate generated images. |
| Generated video | 256 MiB maximum per materialized video, lowerable per call. |
| Video status inline data | 256 MiB maximum per binary/base64 item, lowerable per check; returned URLs are not automatically fetched. |

Operation guides define counts, input bounds and result integrity in detail.
[Hosted files](./hosted-files.md) are external provider resources, not Zero
Storage objects. Locators are provider-bound, not actor-ownership proofs.
[Video](./video.md) keeps provider-specific operation metadata private unless an
app explicitly chooses a safe projection.

## Data, Errors And Observers

Standard AI request events contain approved model/provider/correlation fields,
timing, usage and classified errors. They exclude prompts, message bodies,
provider options, uploaded bytes, tool input/output and credential values.
Custom callbacks receive richer SDK data and must sanitize their own output.

Context and tool-output JSON snapshots reject functions, cycles, custom
prototypes and unsupported values. Execution services stay outside serializable
agent context. Durable agent private state is persisted by Torrent but not
published as general workflow progress; it still needs the app's retention and
access policy.

Raw provider responses, file metadata, SDK callbacks or private exception
causes must not be blindly exposed through HTTP errors or analytics. Use
[operations](./operations.md) for safe error presentation and event correlation.
The runtime [observability guide](../runtime/observability.md) explains sink
composition; configuring a sink does not authorize collection of sensitive AI
content.

## Verification

Use synthetic DNS and fetch seams to test private-address rejection, redirect
to private addresses, DNS pinning, absent/misleading Content-Length, oversized
streaming bodies and cancellation while DNS/body work is pending. Test
provider-native pass-through separately from local materialization. Live
provider tests require a separately authorized account and data policy; this
source manual does not claim such qualification.

See [media](./media.md), [hosted files](./hosted-files.md),
[video](./video.md) and [model execution](./model-execution.md) for the consumers
of this transport boundary.
