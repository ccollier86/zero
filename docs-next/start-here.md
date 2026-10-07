---
id: zero.start-here
type: tutorial
audience: [developer, agent]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: orientation
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [managed-applications]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Start Here

[Documentation index](./index.md)

Zero is a Bun/Elysia full-stack platform with a React frontend. Declare data,
resource policy and optional services; the managed runtime connects live
identity, accepted server operations, realtime state and reusable controls.
The productive path is to compose those features rather than rebuild them.

This organized tree is the primary entrance for new platform and application
work. Feature pages retain their source-review/version metadata: verify that a
page describes the package actually installed in your app. Older `docs/` guides
remain linked deep references; internal audit material is not a runtime API.

## The Core Vocabulary

| System | Owns |
| --- | --- |
| Schema | Shared field/table/validation/UI declarations |
| Guardian | Authentication, tenancy, roles, permissions and live authority |
| Resources | Table exposure, realm and action/row/field policy |
| ReactiveDB | Tracked SQLite changes, transactions and subscriptions |
| Fabric | Multiple database actors, placement and tenant-file binding |
| Sync | Authorized snapshots, replay/live delivery and client state |
| Torrent | Durable versioned workflow execution and waiting/recovery |

Informal product names do not change imports or config keys. Other service
families are listed in the [backend index](./backend/index.md).

## Choose Your Entrance

- **New app:** follow [First app](./guides/first-app.md), then declare
  [real ownership](./guides/user-owned-records.md).
- **Organization product:** start with [mode selection](./guides/choose-modes.md)
  and [organization apps](./guides/organization-app.md) before designing records.
- **Account settings:** use the [adaptive profile component](./frontend/guardian/profile-settings.md)
  and [server profile policy](./backend/guardian/user-profiles.md); ordinary
  members do not need administrative writers. Optional contact proof, private
  avatars, availability and required first-use completion have separate readiness
  and rollout contracts linked from those guides. Check the installed version;
  working-source additions are not silently available in older packages.
- **Existing app:** read [upgrade](./guides/upgrade.md); a dependency refresh is
  not a data split, tenant conversion or workflow-definition migration.
- **Coding agent:** read [agent guidance](./agents/index.md), then the relevant
  canonical feature/config page. Respect the app's actual instructions and scope.
- **Markdown documentation:** install and declare the optional
  [docs plugin](./plugins/docs/index.md); its public reader includes
  [passage-aware search](./plugins/docs/search.md) and uses the shared
  [CodeBlock family](./frontend/components/public-pages/code-block.md).
- **Specific capability:** use [backend](./backend/index.md),
  [frontend](./frontend/index.md), [CLI](./cli/index.md) or
  [optional plugins](./plugins/index.md).

The docs plugin is a separately versioned preview package for the 2.5.0
source/local release. Follow its installation and build guidance; neither this
entrance nor installing the framework publishes documentation automatically.

## Four Ideas To Learn Once

1. **Authority is live.** Authentication, authorization and data scope are
   distinct. UI gates and local FK mirrors do not grant permission.
2. **Data planes are explicit.** Canonical Zero data stays in the system DB;
   app records live in the declared app/Fabric plane.
3. **Optimistic is not accepted.** Await receipt-aware operations before reporting
   persisted success. A toast failure is not a failed write.
4. **Existing features are the starting point.** Use public services, declared
   extensions, schema controls and tokens before inventing parallel infrastructure.

Learn [data planes](./concepts/data-planes.md),
[service boundaries](./concepts/service-boundaries.md) and
[reactivity](./concepts/reactivity.md) once; feature guides link back to them.

## A Useful Build Sequence

Choose modes → declare schema/resources → compose server/services → configure
one frontend provider/client → add adaptive controls/actions → verify authority,
accepted operations and realtime under the intended modes.

The [task guides](./guides/index.md) connect those stages to exact references.
[Verification](./guides/verification.md) explains what each check proves without
mistaking a typecheck for an exercised deployment.
