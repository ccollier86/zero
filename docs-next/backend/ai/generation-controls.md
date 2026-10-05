---
id: zero.ai.generation-controls
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: generation-controls
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

# Generation Controls And Lifecycle

[Zero AI](./index.md) · [Text generation](./generation.md) · [Documentation index](../../index.md)

These controls apply to generateText/streamText and their conversation forms.
They do not set global model/provider defaults or guarantee one external side
effect. Omitted controls are forwarded to the pinned SDK/provider; a portable
type is not a claim that every model honors every sampling setting.

## Shared Request Controls

| Control | Accepted contract | Timing/effect |
| --- | --- | --- |
| model | Alias or provider/model string; omitted smart | Resolve before provider I/O. |
| maxRetries | Number; SDK request retries, 0 disables | Zero forwards it; installed SDK default is 2 when omitted, not a per-app persisted setting. |
| abortSignal | AbortSignal | Caller-owned cancellation, also used for safe media downloads. |
| headers | Record<string,string or undefined> | Snapshotted and validated before async retention; provider transport headers. |
| temperature, topP, topK | Numbers | Provider/model generation settings; choose supported combinations. |
| presencePenalty, frequencyPenalty | Numbers | Provider/model-specific token repetition controls. |
| seed | Number | Provider/model determinism hint, not deterministic workflow semantics. |
| reasoning | Portable reasoning level | provider-default/none/minimal/low/medium/high/xhigh; model support varies. |
| maxOutputTokens | Number | Output budget passed to the model. |
| stopSequences | String array | Snapshotted stop strings. |
| providerOptions | Nested provider-name records | Bounded plain JSON only; copied/frozen before SDK use. |
| metadata | App metadata record | Only Zero's approved request metadata projection enters standard telemetry; not a place to log sensitive content. |
| instructions / system | Trusted instructions / deprecated compatible string | Normalized before prompt execution. |
| output | AIOutput specification | Completed/partial output contract. |

Use [configuration](./configuration.md) for startup provider settings; do not
put adapter credentials or endpoint construction settings into an arbitrary
public request body.

## Timeout Contract

timeout is a positive integer total timeout, or an object:

| Field | Meaning |
| --- | --- |
| totalMs | Total generation request deadline. |
| stepMs | Per-generation-step deadline. |
| firstChunkMs | Streaming deadline for the first content chunk. |
| chunkMs | Streaming deadline between content chunks. |
| toolMs | Default deadline for tool execution. |
| tools | Per-tool override map with keys ending in Ms, such as lookupMs for lookup. |

Each supplied timeout must be a safe integer from 1 through 2,147,483,647.
Unknown properties, accessors/hidden properties, invalid values or keys not
ending in Ms are rejected with AI_REQUEST_INVALID. Per-tool maps are limited
to 256 entries. Zero snapshots the object so later caller mutation cannot alter
an in-progress request. Omission does not add a universal Zero deadline.

Request fragment:

```ts
timeout: {
  totalMs: 60_000,
  stepMs: 20_000,
  firstChunkMs: 10_000,
  chunkMs: 10_000,
  toolMs: 15_000,
  tools: { lookupMs: 5_000 },
}
```

A tool timeout or cancellation signal cannot forcibly undo a completed external
write. Tool handlers must cooperate with cancellation and use app-owned
idempotency/domain safeguards. For restart recovery use durable agents/Torrent,
not a larger timeout on an ephemeral call.

## Tool And Context Controls

tools, toolChoice, toolsContext, runtimeContext, activeTools, toolOrder, stopWhen,
prepareStep, toolApproval and toolApprovalSecret are generation inputs.
Tool sets and contexts stay server-side. activeTools/toolOrder lists and
stopWhen arrays are detached before SDK retention. toolApprovalSecret accepts a
string or Uint8Array; bytes are copied so caller mutation cannot race signatures.

A supplied tool set requires local tools capability, and each actual handler
must enforce app authority. Choosing toolChoice or signing an approval does not
grant an actor a domain permission. See [tools](./tools.md) and
[agents](./agents.md) for typed contexts, approval handling and bounded execution.

## Streaming-Only Controls

- streamRetries bounds SDK streaming retries after the response has begun;
  omission disables that opt-in.
- onChunk observes SDK chunks. It is not a permission boundary or automatic
  database mutation.
- onError receives {error} and may synchronously or asynchronously return
  {retry:true}. The return value is preserved; a recoverable interruption is
  not automatically logged as a final failure.
- onAbort receives the SDK abort event. Zero still records request termination
  when that callback settles/throws.
- include and onEnd have the streaming SDK shapes; do not substitute the
  non-streaming callbacks by name alone.

A retry can repeat provider work and may occur after content was delivered.
Consumers must use the selected SDK stream protocol rather than assuming every
retry means a brand-new independent HTTP response.

## Lifecycle And Telemetry

Shared callbacks include onStart, onStepStart, onLanguageModelCallStart,
onLanguageModelCallEnd, onToolExecutionStart, onToolExecutionEnd, onStepEnd and
onEnd. Zero wraps step/model/tool callbacks to emit content-free events and then
awaits the caller callback exactly once. Caller rejection is not swallowed.
Streaming onEnd/onAbort have their own terminal telemetry path.

Callback events may contain prompts, messages, outputs or vendor data even
though Zero's standard lifecycle metadata does not. An app-owned callback must
not blindly forward those events to public logs. Standard Zero events retain
request/step/call/tool correlation, safe timing/usage and error classification.

telemetry accepts the typed SDK telemetry configuration and runtime context.
Opting into an external SDK observer is a separate app-controlled boundary;
Zero's sink adapter is not a blanket authorization to transmit event content.

## Bounded Mutable Inputs

Header admission limits are 256 entries,256 UTF-8 bytes per name,64 KiB per value
and 1 MiB aggregate. Names must be valid HTTP field names; values reject CR, LF
and NUL. Undefined values are omitted. Headers must be plain records with
enumerable data properties.

providerOptions allows plain JSON only: finite numbers, strings, booleans,
null, dense arrays and plain objects. Cycles, custom prototypes, functions,
symbols, accessors and hidden properties are rejected. The limits are 1 MiB
serialized UTF-8, depth 32 and 100,000 visited nodes. Size violations use
AI_REQUEST_LIMIT_EXCEEDED; invalid structure uses AI_REQUEST_INVALID.

These are fixed Zero operation boundaries, not configurable tenant budgets.
Provider limits, safe media-download ceilings and your product's quotas are
separate controls.

## Verification And Related Guides

Use provider doubles to assert the snapshotted request, mutate original options
after admission and verify they do not change retained values. Test immediate
admission failure, provider timeout, explicit abort, callback rejection and
terminal/recoverable stream errors separately. A sequential text success does
not prove all lifecycle paths.

[Text generation](./generation.md) explains completed versus stream results.
[Configuration](./configuration.md) owns provider setup and aliases.
[Structured output](./structured-output.md) covers output validation and partial
stream values. Return to [Zero AI](./index.md) for durable execution choices.
