---
id: zero.ai.operations
type: operations
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: errors-observability-and-doctor
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


# AI Operations, Errors And Diagnostics

[Zero AI](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Model readiness, provider execution, output integrity and durable recovery are
different operational states. Use stable error codes and sanitized lifecycle
events to distinguish them; do not infer a successful model call merely from
an HTTP connection or stream handle.

## Structured Errors

AIError carries name, message, code and an HTTP-shaped status. Service consumers
should branch on code, not parse provider messages. Preserve the error for
trusted diagnostics but project only the product's intended safe message to a
browser. Private causes/raw provider bodies are not public error payloads.

| Failure family | Codes |
| --- | --- |
| Disabled/configuration/construction | AI_DISABLED, AI_PROVIDER_CONFIG_INVALID, AI_PROVIDER_INITIALIZATION_FAILED |
| Provider/model selection | AI_PROVIDER_NOT_CONFIGURED, AI_PROVIDER_NOT_ACTIVE, AI_PROVIDER_RETIRED, AI_MODEL_NOT_CONFIGURED, AI_MODEL_INVALID, AI_CAPABILITY_NOT_SUPPORTED |
| Ordinary tool declaration | AI_TOOL_INVALID |
| Agent declaration/context/approval | AI_AGENT_DEFINITION_INVALID, AI_AGENT_NOT_REGISTERED, AI_AGENT_CONTEXT_INVALID, AI_AGENT_APPROVAL_CONFIG_INVALID |
| Agent execution | AI_AGENT_EXECUTION_LIMIT_EXCEEDED, AI_AGENT_TOOL_EXECUTION_FAILED, AI_AGENT_EXECUTION_TIMEOUT, AI_AGENT_EXECUTION_CANCELLED, AI_AGENT_EXECUTION_FAILED |
| Request/admission | AI_REQUEST_INVALID, AI_REQUEST_LIMIT_EXCEEDED, AI_REQUEST_TIMEOUT, AI_REQUEST_ABORTED |
| Output/provider integrity | AI_OUTPUT_INVALID, AI_PROVIDER_RESPONSE_INVALID |
| Remaining provider execution failure | AI_REQUEST_FAILED |

Statuses vary by the specific contract: invalid inputs normally 400, bounds
413, execution budget 429, bad provider response 502, unavailable model/provider
503 and deadlines 504. Do not substitute one global HTTP status for every code.
Admission failures can occur before a request-start event.

## Lifecycle Events And App Isolation

The Elysia plugin emits configured/provider enabled/skipped/failed status and
optional status-access denial. Request telemetry emits request.started and one
idempotent request.completed/failed terminal per admitted operation. Generated
file download completion is tied to stream completion, not merely obtaining a
download handle; status checks report check completion, not video-job completion.

Generation callbacks emit step, model-call and tool start/completion/failure
events. Request-scoped callId maps preserve per-step correlation. User callbacks
receive original SDK events, are awaited once, and retain rejection behavior.
A recoverable stream interruption is not automatically a final failure; terminal
completion/cancellation must be observed separately.

Managed services bind their emitters to the owning runtime's observability
sink. Standalone services can use their emitter or the compatibility global
sink. A multi-app process should not use getAI() or global sink changes to select
an application's provider/service. See the runtime
[observability boundary](../runtime/observability.md).

Agent observers receive sanitized lifecycle errors and bounded definition/run/
tool identifiers. Durable logical run receipts are committed once; observer
delivery remains post-commit best effort. Retried model/tool attempts may still
produce repeated step/tool events and provider work. Do not sum those as unique
logical runs or infer exactly-once external side effects.

## Metadata And Usage Are Not Billing

Standard request metadata projects provider/model/capability, duration,
provider-reported token counts, tool names and app correlation. Zero bounds and
redacts sensitive-key metadata; it does not authorize arbitrary content just
because it is stored under an innocent key.

Caller metadata is bounded to depth 4, 50 entries per record, 20 array items and
512 characters per string. Sensitive field names redact credentials and
prompt/message/input/output/media-like content. Canonical identifiers also
have sensitive-value checks. Apps must still supply content-free correlation:
never hide prompts or secrets in a generic note field or forward raw SDK events
to a log sink.

Request duration and reported tokens do not supply effective-dated prices,
retry accounting, user charges or a durable usage ledger. Model discovery,
pricing and configurable tenant/BYOK metering remain roadmap work. Keep app
accounting explicit rather than treating a best-effort sink as a transaction.

## Status And Readiness

AIService.status()/getStatus() reports configured providers, activation/source/
reason/capabilities, model aliases and hosted-file support without provider
secrets. Readiness is local configuration/adapter availability, not a live
network health probe, account quota check or current model catalog.

The optional status endpoint is disabled by default. Its admin mode checks the
projected global auth role admin; development mode means NODE_ENV is not
production, not a network-localhost restriction. Configure a custom read
callback when your product needs a different live permission policy. See
[configuration](./configuration.md#status-endpoint) for path and modes.

## Doctor Checks

Doctor's AI pass uses resolved configuration without constructing provider
clients. It checks no active provider, explicit/partially configured inactive
providers, qualified alias syntax, provider presence/activation/capability,
hosted-files provider and optional operation support, and status-route policy.

Focused diagnostics include Bedrock region/incomplete static credentials,
Azure endpoint/credentials, Vertex project/location and custom adapter absence.
A region-only ambient AWS configuration does not by itself trigger an intended
Bedrock warning. Files upload support does not imply metadata/download/delete.
Vector's embeddings bridge separately checks the embedding alias and capability.

Source scans also flag direct AI SDK usage as a bypass of the Zero service
boundary. These are diagnostics, not a ban on trusted lower-level integration
or proof all account/model features work. Doctor config loading executes the
trusted app module and may read its environment; it is not inert JSON parsing.
This audit did not run Doctor or app configuration. The standalone Doctor
manual is being authored separately; no future URL is presented as present.

## Failure Triage

1. Verify AI is enabled and the intended provider is active in local status.
2. Check the qualified provider ID/model and required capability; do not infer
   capabilities from a model name or a global API key.
3. Inspect safe error code/correlation and the operation's admitted bounds.
4. Distinguish immediate rejection, stream failure/abort and asynchronous job
   error; preserve the actual terminal result.
5. For durable agents, inspect authorized progress, the exact installed version,
   recovery state and live authority. Do not repair runs by altering private
   tables or fabricating actor scope.
6. Qualify provider/network behavior separately using authorized synthetic data
   and the app's real account settings.

## Related Guides And Next Steps

[Generation controls](./generation-controls.md) explains timeout/callback
behavior; [security](./security.md) explains media/metadata boundaries.
[Durable agents](./durable-agents.md) distinguishes receipts and private state.
[Compatibility](./compatibility.md) explains upgrades, and the
[roadmap](./roadmap.md) separates implemented operations from planned accounting.
