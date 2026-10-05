---
id: zero.torrent.authoring
type: how-to
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: authoring
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Write A Simple Versioned Workflow

[Torrent](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

The small DSL creates inert descriptors. WorkflowRegistry compiles and pins
them against trusted activities; WorkflowService executes instances later.
Writing a flow does not execute handlers.

## Minimal Complete Registry

```ts
import { WorkflowRegistry, flow, step, waitFor, expr } from "@zero/framework/workflows";

export const registry = new WorkflowRegistry();
registry.registerActivity({
  name: "normalize", version: "1", databaseCallable: true,
  async handler({ input }) { return { value: input }; },
});
registry.registerActivity({
  name: "record-reply", version: "1", databaseCallable: true,
  async handler({ input, assertCurrentAuthority }) {
    assertCurrentAuthority();
    return { accepted: input };
  },
});
registry.registerWorkflow({
  name: "request-reply", version: 1,
  flow: flow(
    step("prepare", { name: "normalize", version: "1" }),
    waitFor("reply", "reply", { timeoutMs: 60_000 }),
    step("record", { name: "record-reply", version: "1" },
      { input: expr.output("reply") }),
  ),
});
```

This complete registry module is not a running server. Register equivalent
activities/definitions through managed workflows.register, then start through
authorized workflow actions. A running instance waits for its exact
`reply` event; the received payload becomes wait output. The database automation
[delivery example](../database-automations/durable-functions.md#minimal-declaration)
uses that same exact event name. For the matched workflow, private record,
verified webhook and durable trigger composition, follow the
[correlated reply task](../../guides/correlated-workflow.md).

## Definition Shapes

registerWorkflow/create accepts exactly one of:

- steps: legacy sequential StepDefinition array.
- flow: code-authored WorkflowFlow.
- graph: canonical WorkflowGraphIR suitable for database/API/editor storage.

Flow/graph definitions accept name, optional positive integer publication
version, activate (default true), inputSchema and access.
Legacy steps do not accept immutable version/activate publication options.

compileFlow(flow) builds canonical IR. compileWorkflowDefinition(definition,
{ authoringSource?, resolveActivity? }) returns format/source, graph/graphJson,
fingerprint, activation and schema/access snapshots. Registry registration
resolves exact trusted activity versions before fingerprinting.
Standalone compilation without that resolver does not prove activity admission.

## IDs And References

Use stable meaningful IDs per graph, not generated random IDs on every deploy.
Compiler-owned controls reserve @zero/; author IDs must not use it.
Activity versions are strings, default "1"; definition versions are positive
integers. They are different version spaces.

A string activity name may resolve through catalog default/latest selection.
Persisted registration pins the selected exact version, so later default
changes do not silently rewrite old runs. Explicit versions make review easier.

Default step input is the deterministic predecessor output; the first step uses
workflow input. Bind input explicitly with expr for branching/parallel cases
rather than relying on positional guessing. Return JSON-safe output.

## Trust And Upgrade

registerDatabaseWorkflow pins only databaseCallable activities. Do not pass
untrusted JSON to registerWorkflow as code authoring to bypass that gate.
New graphs use safe expressions; they never eval stored JavaScript.

Activity/graph versions and SQL schema migrations are separate. Qualify old run
recovery before removing referenced code. Read [definitions](./definitions.md),
[graph IR](./graph-ir.md), [expressions](./expressions.md) and
[control flow](./control-flow.md) for more advanced composition.
