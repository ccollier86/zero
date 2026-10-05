---
id: zero.data-studio.limits
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: limits
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Studio Format And Service Limits

[Data Studio index](./index.md) · [Documentation index](../../index.md)

These are hard public format/service bounds, not constructor quota settings.
The capability API exposes selected current limits for adaptive UI.

| Dimension | Limit/default |
| --- | --- |
| Logical tables per organization DB | 100 |
| Rows per logical table | 100000 |
| Schema versions per table | 256 |
| Row page default/maximum | 25 |
| Schema-history page maximum | 10 |
| Row result byte budget | 768 KiB |
| Columns per schema | 128 |
| Serialized schema | 64 KiB |
| Individual cell | 64 KiB |
| Aggregate row values | 256 KiB |
| JSON nesting/nodes/members | depth32 / nodes4096 / members1024 |
| ColumnId/key/table key | 64 characters |
| Column label/description | 120 / 500 characters |
| Search text | 200 characters |
| HTTP encoded filter | 8192 characters |
| Offset | 100000 |

Canonical byte limits are UTF-8 serialization budgets, not a browser textarea
character hint. HTTP query length and deeper canonical payload budgets are
different boundaries.

## Continuation And Failure

A page can contain fewer than requested rows because of the response budget.
Use actual nextOffset; don't manufacture continuation or a successful empty page
after a limit failure.

Create/count/history admission occurs inside the writer transaction.
Frontend controls should show the server's permitted surface and safe errors,
but disabling a button is not enforcement.

No constructor option raises these ceilings.
A future configurable quota system would require reviewed admission/recovery
behavior, not changing a frontend prop or importing an internal constant.

See [configuration](./configuration.md), [values](./values.md),
[queries](./queries.md), [schema history](./schema-history.md) and [errors](./errors.md).
