---
id: zero.torrent.control-flow
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: control-flow
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

# Choices, Parallel Branches And Array Items

[Torrent](./index.md) · [Authoring](./authoring.md) · [Documentation index](../../index.md)

The DSL keeps dependent work ordered while allowing explicit independent
branches and bounded item fan-out. It does not infer looping from any activity
receiving an array: each explicitly declares that behavior.

## Choices

choose(id, ...when/otherwise) selects the first true condition and requires a
fallback otherwise. An optional { label } can precede branches.
when(condition, ...nodes) and otherwise(...nodes) wrap ordered branch flows.
Decision state is persisted, so recovery does not casually choose another
branch from changed external data.

See the complete expression descriptor in [expressions](./expressions.md).
Code conditions should use expr, not new JavaScript-source strings.

## Parallel

parallel(id, namedBranches, { label? }?) starts named independent flows and an
all-branches join. Downstream work waits for the required branches.
Branch names provide deterministic output/topology identity. This is logical
async concurrency, not another thread for CPU-bound synchronous JavaScript.

Complete standalone descriptor:

```ts
import { flow, parallel, step } from "@zero/framework/workflows";
export const branches = flow(
  parallel("check-and-notify", {
    check: flow(step("check", { name: "records.check", version: "1" })),
    notify: flow(step("notify", { name: "records.notify", version: "1" })),
  }),
  step("finish", { name: "records.finish", version: "1" }),
);
```

Register activities, schemas/access and workflow before starting it.
A retrying/awaiting required predecessor does not authorize a later dependent
step to run. External effects in independent branches still require idempotency.

## Each

each(id, sourceExpression, body, options?) snapshots an array once and executes
one activity per valid item. Current body admission requires one activity and
zero edges; arbitrary nested flows/waits/parallel per item are not supported.

Complete descriptor for the array-processing case:

```ts
import { flow, each, step, expr } from "@zero/framework/workflows";
export const patients = flow(
  each("insurance", expr.input("patients"),
    flow(step("lookup", { name: "insurance.lookup", version: "1" },
      { input: expr.item() })),
    { concurrency: 4, onInvalid: "skip", onError: "collect", visibility: "private" }),
);
```

The activity receives item { value, index, key }. Source must be an array,
maximum 10,000 items. concurrency defaults 1, maximum 100.
itemSchema validates each snapshot, itemKey derives stable unique keys
(default source-index identity). Duplicate keys reject admission.

onInvalid defaults fail; skip retains a skipped outcome.
onError defaults fail; collect lets other items complete and returns outcomes.
When either collect/skip policy applies, ordered results are
{ ok: true, value } or { ok: false, skipped, error }; otherwise they are ordered
activity outputs. Arrival/completion order does not reorder results.

visibility defaults public semantics when omitted; private keeps item/source/
results in private state, not public step inputs/outputs. Public progress is
payload-redacted for every visibility mode. Item keys may themselves contain
sensitive data and are not public identifiers.

## Failure, Memory And Visibility

A failed required branch/item fails its parent according to the policy.
Pause/cancel abort active attempts and fence late results.
Each items have their own memory namespace; unrelated parallel memory writes
can conflict rather than lose an update.

Use stable topology path plus step ID/item index for public visualization,
not private item keys. [Realtime](./realtime.md) covers projections;
[memory](./memory.md) covers scratch concurrency;
[retries](./retries-and-time.md) covers dependent ordering and timing.
