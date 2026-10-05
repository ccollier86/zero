---
id: zero.agents.tooling.onboarding
type: how-to
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: onboarding
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["coding-agent application development", "installed-package discovery"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Orient An Agent Before Building

[Tooling index](./index.md) · [Documentation index](../../index.md)

For a new or existing app, establish a small evidence-backed plan before edits.

1. Read the user's repository instructions and preserve dirty app-owned changes.
2. Identify the installed framework version, branch/archive provenance and available public exports. Do not assume the workstation checkout is installed.
3. Read [runtime composition](../../backend/runtime/index.md) and [configuration](../../backend/configuration/index.md) for the actual entry/settings.
4. Choose the declared Guardian permission/tenancy modes and application/Fabric placement deliberately. A package update does not convert modes.
5. Define shared [Schema fields](../../backend/schema/index.md), resources and app services through public declarations.
6. Reuse [frontend providers/controls](../../frontend/index.md) and authenticated SDK; keep routes thin and domain logic service-owned.
7. Implement the smallest complete requested flow with accepted mutation handling and live authority fences.
8. Verify focused contracts, then report changes/evidence and unresolved authorized work.

## Example Task: Organization-Owned Records

Read [Guardian](../../backend/guardian/index.md) for membership/live role scopes,
[Fabric](../../backend/fabric/index.md) for source placement, and
[resources](../../backend/resources/index.md) for authorized data methods.
Define the business schema and user anchor foreign key as appropriate; canonical
profile/security data stays in the system plane. Render records through
[DataTable](../../frontend/data-controls/data-table/index.md), not a duplicate
auth transport/query cache. UI gates express access but cannot enforce it.

If a requested capability already exists, configure/compose it before inventing
a parallel implementation. If it does not exist, explain the extension boundary
and scope of the app-owned service rather than claim a planned API is shipped.

## Related Guides And Next Steps

[Building conventions](./building-conventions.md) gives engineering boundaries,
[CLI workflows](./cli-workflows.md) gives package ownership and
[verification](./verification.md) defines safe checks.
