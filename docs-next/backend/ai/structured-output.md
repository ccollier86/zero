---
id: zero.ai.structured-output
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: structured-output
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

# Structured Output

[Zero AI](./index.md) · [Text generation](./generation.md) · [Documentation index](../../index.md)

Use AIOutput when an application needs a defined result instead of parsing an
untrusted text string itself. The output specification participates in
generation and type inference; validation does not make generated data trusted
for authorization or external actions.

## Typed Object Example

This complete service function receives the app-bound AIService and uses Zod
as the application's schema library. Declare zod in the app's dependencies if
it is not already an app-owned dependency; importing a transitive framework
dependency is not a versioned application contract.

```ts
import { AIOutput, type AIService } from '@zero/framework/ai';
import { z } from 'zod';

const Summary = z.object({
  title: z.string(),
  tags: z.array(z.string()),
});

export async function structuredSummary(ai: AIService, text: string) {
  const result = await ai.generateText({
    prompt: text,
    instructions: 'Summarize the supplied text using the requested output format.',
    output: AIOutput.object({ schema: Summary, name: 'summary' }),
  });
  return result.output; // Inferred { title: string; tags: string[] }.
}
```

The expected result is a schema-validated object, not JSON text. The caller must
already authorize access to the input and any later write. Keep synthetic data
in local tests; real model generation requires a compatible configured provider.

AIOutput wraps the SDK's supported flexible-schema input contract. Zod is one
choice, not a new mandatory Zero runtime. A project can use another supported
schema library/standard-schema implementation with the same output API.

## Output Modes

| Constructor | Inputs | Complete value | Stream behavior |
| --- | --- | --- | --- |
| text() | None | String | Incremental text. |
| object({schema,name?,description?}) | Flexible schema | Inferred schema value | Deep partial object snapshots. |
| array({element,minItems?,maxItems?,name?,description?}) | Element schema and optional bounds | Array of inferred elements | Partial arrays and completed element stream. |
| choice({options,name?,description?}) | String choices | One inferred choice | Incremental choice output. |
| json({name?,description?}) | Optional naming guidance | JSON value | Incremental JSON without a domain schema guarantee. |

AIOutput is a frozen facade; an app cannot replace one constructor for other
callers. Public helper types include AIOutputSpec, AIAnyOutput, AITextOutput,
AIInferOutput and AIInferPartialOutput.

When output is omitted, Zero preserves the unconstrained compatibility result
type; the SDK's ordinary runtime default is text. Explicit output gives callers
a precise contract. Use result.output, not JSON.parse(result.text), when an
output specification was requested.

## Streaming Structured Values

streamText accepts the same output specification. Its result preserves SDK
partialOutputStream and elementStream where the mode supports them.
An incremental partial object is **not** the final validated record: required
properties may not have arrived and values can evolve as content streams.
Do not persist a partial snapshot as a completed domain action.

Example fragment for an already configured service:

```ts
const stream = ai.streamText({
  prompt: 'Produce a synthetic summary.',
  output: AIOutput.object({ schema: Summary }),
});

for await (const partial of stream.partialOutputStream) {
  // Render temporary progress, not an approved final database record.
  showProgress(partial);
}
const complete = await stream.output;
```

Summary, ai and showProgress are supplied by the app/example above. This fragment
does not create a browser endpoint or an automatic reactive collection. The app
chooses its streaming protocol and authorized progress channel.

## Failure And Provider Semantics

generateText forces complete structured-output parsing inside Zero's stable
error boundary. Nonmatching completed output becomes AI_OUTPUT_INVALID with
status 502. Invalid provider responses and unsupported model functionality have
separate AI error codes. The capability catalog is adapter-level; confirm the
selected model supports the requested format.

Streaming retains asynchronous SDK failure behavior. A valid-looking partial
value does not prove the final output succeeded. Consume final output/finish
state and expose a safe error through your app's UI. Avoid logging raw generated
content or vendor parse errors to public telemetry.

name/description guide compatible providers; they are not database names or
authorization scopes. Output schema validation is independent of Guardian/Fabric
ownership and of your app's business rules.

## Verification And Related Guides

With a local provider double, test a matching value, wrong field types, malformed
JSON, required-field omission and partial-to-final streaming. Verify inferred
types in the app's typecheck as well as runtime output. No live provider call
was used to qualify this guide's examples.

[Text generation](./generation.md) owns service request/results.
[Generation controls](./generation-controls.md) adds bounds and cancellation.
[Configuration](./configuration.md) chooses models. Return to
[Zero AI](./index.md) for tool-using and durable agents.
