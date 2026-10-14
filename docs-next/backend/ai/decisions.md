---
id: zero.ai.decisions
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: typed-decisions
maturity: supported
applies_to: ["2.6.0 development source; new native decision facade"]
modes: [managed-server, standalone-service, native-system-one, self-hosted]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "57ac541e1748757d345d0852f9b177c5d748cc4a"
  snapshot: dirty
  date: "2026-10-13"
  evidence_level: source-observed
---

# Typed Decisions: Jev And Self-Hosted Laya

[Zero AI](./index.md) · [Configuration](./configuration.md) · [Providers](./providers.md)

Use `zero.ai.decisions.evaluate()` for bounded semantic judgments: classify an
intake message, select a configured workflow, score a document against a rubric,
or assess a yes/no proposition. This is a native Zero transport beside AI SDK 7,
not text generation coerced into JSON. The AI SDK does not need to support these
providers. Existing generation, agents, embeddings and media remain unchanged.

The implementation is qualified with deterministic provider fixtures and real
loopback HTTP. Neither hosted Jev inference nor a real Laya checkpoint's quality
is implied by those checks. Validate your actual deployment and decision cases
before enabling automatic business actions.

## Enable A Local Laya Provider

This is an AI configuration fragment for an existing `createApp()` or the
standalone `resolveAIConfig()` / `AIService` composition:

```ts
import type { AIConfig } from '@zero/framework/ai';

export const aiConfig = {
  autoDetect: false,
  providers: {
    localDecisions: {
      type: 'laya',
      baseURL: 'http://127.0.0.1:8000',
      apiKey: null, // Suppress ambient keys; supply a server-only key if required.
      decisionLocality: 'local',
    },
  },
  aliases: { decisions: 'localDecisions/convaiinnovations/laya' },
} satisfies AIConfig;
```

Use the actual model/checkpoint name your server accepts: upstream Laya supports
names such as `multilingual` and `typed-decisions`, as well as its documented
router aliases; compatible third-party servers may differ. A name is sent
unchanged after Zero removes the provider-ID prefix. Further slashes remain
part of the model ID.

`baseURL` accepts the server root, a `/v1` base or a complete `/v1/systemone`
endpoint. Root URLs append `/v1/systemone`; `/v1` appends `/systemone`; a path
already ending in `/systemone` is used as supplied. Proxy path prefixes are
retained. URL credentials, query strings and fragments are rejected. Transport
redirects are disabled. Custom fetch and headers are trusted server startup
configuration, not caller-selectable endpoints.

`decisionLocality: 'local'` is an explicit operator designation. It does not
attest hardware location or prevent a custom fetch/proxy from forwarding data;
operators must enforce the intended network boundary. Omission is conservatively
`hosted`, even for a localhost URL. Local-only evaluation rejects a provider not
explicitly designated local; Jev cannot be designated local.

Zero does not install weights, launch a Laya server or expose it publicly.

## Reject Oversized Laya Inputs Before Networking

Laya admission runs locally before the inference fetch. The default is a
512-token complete-prompt limit and a 192-token question/options budget. Configure
`layaInputLimits.maxInputTokens: 2048` for a deployment configured to handle 2048.
These are operator-owned startup settings; request-level `laya.maxInputTokens`
and `maxQuestionTokens` can lower the guard's ceilings, never raise them.
Jev does not use this guard: its existing provider-managed behavior is unchanged.

For checkpoint-matched token counts, load the matching tokenizer JSON files once
from local deployment resources. Only tokenizer metadata is needed, not weights:

```ts
import { createLayaTokenCounter, type AIConfig } from '@zero/framework/ai';

export async function configureHostedLaya(): Promise<AIConfig> {
  const countTokens = createLayaTokenCounter(
    await Bun.file('./resources/laya/tokenizer.json').json(),
    await Bun.file('./resources/laya/tokenizer_config.json').json(),
  );
  return {
    autoDetect: false,
    providers: {
      remoteDecisions: {
        type: 'laya',
        baseURL: Bun.env.LAYA_BASE_URL,
        apiKey: Bun.env.LAYA_API_KEY,
        decisionLocality: 'hosted',
        layaInputLimits: {
          runtime: 'llama.cpp',
          maxInputTokens: 2048,
          maxQuestionTokens: 192,
          countTokens,
        },
      },
    },
    aliases: { decisions: 'remoteDecisions/laya' },
  };
}
```

The helper constructs a local tokenizer from detached JSON, disables added
framing, and never truncates the count or downloads anything. For the English
GGUF/HF normalization difference, it takes the larger normalized/unnormalized
count. A custom synchronous `countTokens(text)` function can also be supplied;
it must match the deployed checkpoint and must not perform network operations.
Use `runtime: 'laya'` for Python Laya's whole-serialized-text mask escaping;
`llama.cpp` escapes string values before serialization, preserving JSON keys.
Both preserve object order and serialize containers with spaced JSON separators,
count the question-type prefix and rendered criteria, and reserve CLS/SEP/MASK
framing. The inference body itself remains unchanged.

The limit is **per independently evaluated question**, not summed across the
request. Admission includes state, question, choices/levels/yes-no descriptions
and framing. It also rejects descriptions that exceed the English runtimes'
48-token per-option cap and question/options allocation that would be clipped.
No input is silently shortened. A rejection throws
`AI_REQUEST_LIMIT_EXCEEDED` (HTTP-shaped status 413) without inference HTTP or
retries. Invalid counters fail closed with a sanitized configuration error.

Without a local counter, Zero uses a conservative UTF-8 token upper bound.
It can reject valid input; it is not a character-to-token estimate or a promise
to accept every prompt that fits. Supply the checkpoint tokenizer to use the
capacity accurately. The built-in layout targets the English Laya protocol;
qualify different checkpoints, serializers and model revisions separately.

To manually increase the hosted limit, change the server's supported context
and batch capacity first, then the matching Zero startup budget. With llama.cpp,
the full Laya prompt must fit both `--ctx-size` and `--ubatch-size`; increasing
only Zero's number cannot enlarge server capacity. Do not raise the independent
question/options budget merely because the state context was enlarged. Values
are bounded to 1–8192. Larger admission is not a quality or latency guarantee.

An operator can explicitly set `layaInputLimits: false` for a deployment whose
server-side truncation policy and evidence-coverage reporting have been qualified.
It is never caller-selectable. Admission itself does not fabricate provider
coverage: unreported `truncated` remains null even after a request passed the
local guard. Model/server configuration drift still needs operational checks.

## Enable Jev

```ts
import type { AIConfig } from '@zero/framework/ai';

export const aiConfig = {
  autoDetect: false,
  providers: {
    jev: { type: 'jev', apiKey: Bun.env.TYPESAFE_API_KEY },
  },
  aliases: { decisions: 'jev/jev-1.13.0' },
} satisfies AIConfig;
```

Jev defaults to `https://api.typesafe.ai/v1` and uses Bearer API-key auth.
`TYPESAFE_API_KEY`, then `JEV_API_KEY`, are its catalog environment bindings.
Laya's optional key is `LAYA_API_KEY`; it requires an explicit or environment
base URL, including `LAYA_BASE_URL`. Existing provider-ID/type precedence and
`apiKey: null` / `baseURL: null` suppression rules apply.

The `decisions` alias has **no automatic model candidate**. Supply the alias,
`ZERO_AI_DECISIONS_MODEL`, or a per-call `model`. Discovering a Jev key never
silently chooses it for an unconfigured local decision call. Zero performs no
cross-provider fallback. Pin models when thresholds depend on a particular
version, and qualify a replacement provider/checkpoint separately.

## Evaluate Several Questions Together

```ts
import { AIDecision, type AIService } from '@zero/framework/ai';

export async function classifyIntake(ai: AIService, message: string, signal?: AbortSignal) {
  return ai.decisions.evaluate({
    contract: 'support.intake@1',
    state: { message },
    locality: 'local-only',
    abortSignal: signal,
    questions: {
      department: AIDecision.choice('Which team should handle this request?', {
        billing: 'Payments, invoices and refunds',
        technical: 'Product defects and access problems',
        triage: 'Insufficient information or none of the defined teams',
      }),
      repeatedIssue: AIDecision.yesNo('Does the message describe an unresolved repeated issue?'),
      frustration: AIDecision.score('How much frustration is expressed?', [
        'No frustration expressed', 'Frustration expressed', 'Strong frustration expressed',
      ]),
    },
  });
}
```

The builders also exist as `ai.decisions.choice`, `.score` and `.yesNo`.
Direct `{ type, instructions, criteria }` question objects are supported.
The `const` generic infers Choice labels: `answers.department.choice` is the
union `billing | technical | triage`, not an arbitrary string. Instructions and
descriptions may be bounded JSON objects/arrays as well as strings.

| Question | Input | Answer |
| --- | --- | --- |
| `choice` | 2–255 labels with descriptions; description may be null | Selected label, complete probabilities, provider confidence and signals |
| `score` | 2–10 ordered descriptive levels | Fractional probability-weighted level index, probabilities, legend, confidence and signals |
| `noul` / `yesNo()` | Proposition, optionally descriptions for `true` and `false` | `noul`: probability of yes, plus optional reported signals; no invented boolean or confidence |

These are Zero's bounded common-contract limits; the actual server/model can
have stricter limits. An independently evaluated yes/no dimension should not
compete with mutually exclusive department labels.

`contract` is an optional application-owned, versioned identity retained in
provenance. It is not sent to inference. It does not register a schema, store
outcomes, select a policy or create a durable execution record.

## Results, Uncertainty And Evidence Coverage

Every result has immutable `answers`, actual provider-reported `model`, nullable
reported `usage`, `provenance`, nullable `truncated` and `inputCoverage`.
Provenance records provider ID/type, requested/resolved model, deployment
designation, optional contract ID and elapsed time. Provider endpoint paths,
credentials and raw error bodies are not returned as provenance.

Usage maps provider `input_tokens` / `output_tokens` to `inputTokens` /
`outputTokens` / `totalTokens`. Jev's required usage block is validated; a
compatible Laya server that omits it yields `null`, not estimated counts.
Usage is not billing, and zero provider-reported output tokens is not proof of
zero server cost.

Confidence is not the selected label's probability and is not an observed
probability of correctness. Laya and Jev use different statistics. Zero retains
the provider's ordinary confidence unchanged and separately preserves
`signals.jevConfidence` (`x_jev_confidence`) and `signals.answerConfidence`
when present. It does not synthesize or calibrate these values.

Laya gate states are retained as `signals.abstention`: `passed`, `abstained`,
`unevaluated`, or null when not reported. Compatible legacy boolean gates are
normalized to passed/abstained. `signals.abstained` is true/false only for those
two definite states; unevaluated/unreported is null. A missing gate is not a
passed gate. `signals.abstentionThreshold` retains a reported threshold.

Zero never truncates input silently. Reported root or Laya usage-level
truncation is retained, with `inputCoverage.stateTokens`, `stateTokensDropped`
and `truncatedQuestions` when present. Unknown coverage stays null. Malformed
or contradictory coverage is rejected. Strict Jev-compatible Laya responses can
omit these extensions; a valid response is not proof that the full evidence was
read. Policies must explicitly decide whether unknown/truncated evidence is
acceptable.

## Execution Options And Limits

| Option or bound | Behavior |
| --- | --- |
| `model` | Alias or provider/model; omitted uses the explicitly configured `decisions` alias |
| `locality` | `any` by default; `local-only` rejects non-designated providers before fetch |
| `timeoutMs` | Default 10000; integer 1–120000; one deadline for fetch, reading and retry waits |
| `maxRetries` | Default 0; integer 0–3; only 429, 529 and 5xx responses are retryable |
| `abortSignal` | Caller cancellation; already cancelled requests do not send evidence |
| `metadata` | Existing sanitized Zero correlation metadata; never provider input |
| Questions | 1–64 per shared state |
| Input | At most 1MiB serialized request, plus existing JSON depth/node budgets |
| Response | At most 2MiB streamed UTF-8 JSON, regardless of Content-Length |

Retries honor bounded `Retry-After` or exponential waits and may incur additional
provider billing. Authentication/client errors, malformed results and network
failures are not automatically retried. A custom fetch ignoring cancellation
cannot extend the caller's deadline; late response bodies are abandoned safely.
Cancelling HTTP does not prove a remote model stopped computing.

Laya additionally accepts bounded `laya` options: `maxInputTokens` → `max_len`,
`maxQuestionTokens` → `head_max_len` (integers 1–8192), `minConfidence` (0–1),
`language` → `lang`, `languageHint` → `lang_guess`, and `task`. Unknown controls
are rejected. These controls are rejected for Jev rather than silently ignored.
The remote server still owns actual checkpoint and resource ceilings. Per-bucket
threshold maps, model installation, native multi-state batch endpoints and other
Laya-specific methods are not currently exposed.

Stable errors use existing `AIError` codes: invalid/oversized input, missing or
inactive model/provider, unsupported capability/locality, cancelled/deadline,
invalid provider response, and provider request failure. Errors contain no raw
provider body, fetch exception or caller abort reason. Operational failure never
becomes a normal `triage`, `false` or completed answer.

Managed AI plugin cleanup calls `decisions.dispose()`: pending native requests
are cancelled and retained handles cannot start new evaluations. Standalone
owners call it themselves when retiring the service.

## Design Method And Application Policy

Use decision models for bounded semantic judgments; code for exact rules,
authorization and execution; reasoning/generation models for planning or prose.
For each meaningful branch, record the contract/question version, evidence,
allowed answers, selected provider/model, evaluation cases, fallback policy and
the eventual observed outcome. Run new routing contracts in shadow mode first.

Automatic thresholds belong to the exact question/provider/version and error
cost. Do not transfer a threshold merely because two servers speak the same
wire protocol. Preserve unknown/insufficient-evidence choices, model abstention,
operational failure and human corrections as different outcomes.

For Reactive DB/Fabric routing, capture authorized evidence and its revision,
evaluate outside the write transaction, then revalidate live authority and
conversation/assignment revision before committing an allowed action. A model
response must not overwrite a newer human assignment or infer access to an
organization, patient record or staff-only history. Trusted setup can explicitly
bind the app-local decision facade into a trigger/workflow activity; ordinary
authority-scoped background service views intentionally do not expose raw
`zero.ai`. Keep their admission and live authority fences, rather than opening
an unsafe service bag. The application supplies idempotency and durable
action/outcome records. Zero does not install a chat router, background job or
database trigger merely by enabling AI.

Automatic caching, contract/schema registries, calibration/evaluation datasets,
outcome persistence and business-policy application are separate future features,
not hidden behaviors of this evaluator. No per-message inference HTTP route is
created; exposed app routes must authorize actors and bound request intake.

## Provider References

Provider contracts were checked against [TypeSafe's API reference](https://docs.typesafe.ai/api),
[confidence semantics](https://docs.typesafe.ai/confidence), and
[Laya's serving implementation](https://github.com/NandhaKishorM/laya/blob/main/laya/serve.py)
and [confidence gates](https://github.com/NandhaKishorM/laya/blob/main/laya/confidence.py).
Local admission also follows [Laya's sequence allocation](https://github.com/NandhaKishorM/laya/blob/main/laya/common.py)
and [llama.cpp's Laya prompt allocation](https://github.com/ggml-org/llama.cpp/blob/b11608/tools/server/server-decision.cpp),
using [Hugging Face's local tokenizer implementation](https://github.com/huggingface/tokenizers.js).
Those upstream pages can change independently of this source snapshot.

See [security](./security.md) and [operations](./operations.md) for the broader
AI service boundary. Decision support does not itself supply healthcare
compliance, clinical triage validation or a permission grant.
