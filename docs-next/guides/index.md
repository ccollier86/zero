---
id: zero.guides.tasks
type: index
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: tasks
maturity: supported
applies_to: ["2.6.0 working source; earlier guide contracts retain their own review metadata"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Build, Operate And Extend An App

[Documentation index](../index.md)

These guides connect system contracts in the order a developer or coding agent
needs them. They do not replace each system's exact reference.

- [First app](./first-app.md): create a new package-mode project, inspect the
  starter and choose safe startup checks.
- [Mode selection](./choose-modes.md): choose tenancy, RBAC, physical topology
  and persistence independently.
- [User-owned records](./user-owned-records.md): combine schema anchors and
  server ownership policy without duplicating authentication.
- [Organization app](./organization-app.md): bootstrap, memberships, roles,
  tenant realms and isolated databases.
- [Organization assembly](./organization-assembly.md): one starter-relative,
  multi-file wiring recipe joining Guardian, Fabric, resources and both Studios.
- [Reactive control plane](./reactive-control-plane.md): compose table/forms/
  master-detail with accepted operations and scope-safe state.
- [UI reference](../frontend/ui-reference.md): canonical tokens, typography,
  action-to-animation rules and component facades/parts with full manual routes.
- [Application UI development](./application-ui-development.md): agent-oriented
  dashboard assembly, component facades/parts, theme/type roles and reactive data.
- [Public UI development](./public-ui-development.md): agent-oriented public-page
  assembly, reading hierarchy, access boundaries, effects and chart demos.
- [Automation](./automation.md): choose Scheduler, Torrent and database actions
  for the right durability/authority contract.
- [Correlated workflow replies](./correlated-workflow.md): compose a private
  record, verified webhook, atomic update and durable event for one exact run.
- [Extensions](./extensions.md): integrate at the public Elysia/service boundary.
- [Add a Markdown docs reader](../plugins/docs/index.md): declare the optional
  package, admit public content and build its reader with
  [section-targeted search](../plugins/docs/search.md).
- [Present code examples](../frontend/components/public-pages/code-block.md): reuse
  the shared CodeBlock family for files, copy controls and prepared highlights.
- [Upgrade safely](./upgrade.md): dependency updates versus real data/model changes.
- [UI upgrade handoff](./ui-upgrade.md): framework branch and artifact provenance,
  new component/manual locations, Doctor triage and staged app adoption with
  original implementations retained.
- [Verification](./verification.md): proportionate source, fixture and deployment checks.

For a short orientation read [Start Here](../start-here.md).
For exact APIs browse [backend](../backend/index.md),
[frontend](../frontend/index.md), [CLI](../cli/index.md) and
[agent tooling](../agents/index.md).
