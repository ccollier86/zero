---
id: zero.frontend.data-controls.configuration
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: configuration
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Control Configuration

[Data controls index](./index.md) · [Documentation index](../../index.md)

Data controls use React props and explicit data/query sources. They do not
discover environment variables, provision a Fabric database or enable backend
resource permissions. Read settings when the component/source is composed;
live interaction state is not a persisted app configuration table.

The exact [DataTable prop reference](./data-table/configuration.md) owns source,
query controls, columns, sizing, toolbar slots, editing/actions, state and
presentation defaults. Its [source reference](./data-table/sources.md) distinguishes
array, full collection, lazy collection and server-query behavior.

Use the normal app/provider and backend resource configuration for authenticated
sources. Standalone arrays/custom adapters may render without the integrated
client, but their callers still own any transport, authority and accepted writer.
Do not fabricate a browser tenant selector to route privileged operations.

Other data organisms retain their own composition props instead of silently
sharing every DataTable default. In particular MasterDetail's search default and
selection/detail layout differ; generated CRUD adds modal/forms and accepted
callbacks. Their detailed references own those contracts, not generic guesses.

Doctor's trusted server/config checks do not simulate component acceptance,
out-of-order browser queries, keyboard editing or every source mode. Test the
actual configured control and scoped server contract independently.

## Related Guides And Next Steps

- [DataTable](./data-table/index.md) owns the table family.
- [Schema configuration](../../backend/schema/configuration.md) owns field/table declarations.
- [Provider configuration](../runtime/configuration.md) owns transport/context composition.
- [SDK configuration](../sdk/configuration.md) owns authenticated request options.
