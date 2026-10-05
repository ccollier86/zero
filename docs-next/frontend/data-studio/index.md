---
id: zero.frontend.data-studio.index
type: index
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: index
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Organization Table Studio

[Frontend index](../index.md) · [Documentation index](../../index.md)

Data Studio manages organization-owned logical tables and revisioned records.
It is a dedicated permission-checked service/control plane, not arbitrary SQL
or a browser-controlled physical database manager. Use DataStudio for the complete
connected UI, or its controller and focused components for custom compositions.

## Guides

- [Configuration](./configuration.md) identifies props/defaults and server prerequisites.
- [Workspace](./workspace.md) covers connected composition, list/detail layout and actions.
- [Controller](./controller.md) covers scoped loading, queries, records and mutations.
- [Grid](./grid.md) covers progressive virtual rows, schema headers/actions,
  resizing and editable cells.
- [Inspector](./inspector.md) covers Record/Table/Code tabs.
- [Toolbar](./toolbar.md) covers shared compact search, table/status selectors and filters.
- [Inline cells](./inline-cell.md) covers accepted saves, keyboard navigation and conflicts.
- [Dialogs](./dialogs.md) covers table schema, record creation and confirmation controls.
- [Values](./values.md) covers typed drafts, display, key projection and code generation.
- [SDK and retry identity](./sdk.md) covers client.dataStudio, errors and operation helpers.
- [Roadmap](./roadmap.md) separates known ideas from current contracts.

## Integration And Authority

The [backend Data Studio manual](../../backend/data-studio/index.md) owns complete
installation, required profiles, schemas, rows, limits and operation outcomes.
Use its [installation](../../backend/data-studio/installation.md) before mounting
the connected UI; there is no generic dataStudio=true flag.

The normal [client/provider](../runtime/app-provider.md) supplies authenticated
HTTP and live scope fences. Guardian permissions determine read/write/manage;
a UI narrowing flag never grants denied server access. Fabric routes the active
organization's database through server-owned identity. Tables are logical records
with immutable table keys, stable column IDs and revisioned commands, not a SQL
terminal. A deliberate column API-key rename requires review/acknowledgement;
label changes and reordering never rename it implicitly.

Administration organizations can own their own application data, like customer
organizations. Platform powers and ordinary app access remain independent;
membership alone does not authorize another organization's Studio.
The working-source manual remains draft pending independent/package qualification.
