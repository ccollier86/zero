---
id: zero.torrent.expressions
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: expressions
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

# Safe Workflow Expressions

[Torrent](./index.md) · [Authoring](./authoring.md) · [Documentation index](../../index.md)

New graph expressions are serializable AST data, never evaluated JavaScript
source strings. expr builders and the same evaluator serve code, database,
API and editor-authored graphs.

## Reference Vocabulary

expr.input(path?) reads original workflow input; expr.previous(path?) reads
the deterministic predecessor result; expr.memory(path?) reads committed
scratch state; expr.output(nodeId, path?) selects one node result.
expr.item(path?) and expr.itemIndex() refer to current each data.

Paths accept dot-separated strings or explicit string arrays. Unsafe prototype
path keys are rejected. A reference identifies data; it does not access a
service/secret/global or run application code.

## Operators

Builders are literal, eq/ne/gt/gte/lt/lte, and/or/not, exists and includes.
Their operands accept expression nodes or JSON values normalized as literals.
validateWorkflowExpression checks tags, keys, depth, node/path/literal bounds.
evaluateWorkflowExpression(expression, context) is side-effect-free;
isWorkflowExpression is shape recognition, not authorization.

Complete expression/choice fragment as an independently compilable descriptor:

```ts
import { flow, choose, when, otherwise, step, expr } from "@zero/framework/workflows";
export const routing = flow(
  choose("route",
    when(expr.and(expr.exists(expr.input("amount")), expr.gt(expr.input("amount"), 100)),
      step("review", { name: "orders.review", version: "1" })),
    otherwise(step("accept", { name: "orders.accept", version: "1" })),
  ),
);
```

Activities must be registered before this becomes a workflow. First matching
when branch wins; otherwise is the required fallback.
Do not put a secret in an expr.literal merely because it is code-authored:
definition graphs may be available to authorized managers/editors.

## Semantics And Boundaries

Missing data remains missing rather than invoking arbitrary getters.
Evaluation uses declared JSON/reference semantics; do not assume JavaScript
coercion, regex execution, template interpolation or general arithmetic/functions
are part of this API. Transform data in a trusted typed activity.

Previous output at a control join can be a collected branch result; explicit
expr.output references make the desired source clear. Array item output is
ordered by source position, not completion timing.

Expressions do not authorize a node: definition access, activity admission and
live execution scope remain separate. Predicate false is a control decision;
authorization failure must not be encoded as a hidden UI-only branch.

Related: [control flow](./control-flow.md), [memory](./memory.md),
[graph IR](./graph-ir.md), [authority](./authority.md).
