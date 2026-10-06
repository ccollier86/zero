---
id: zero.docs-next
type: index
audience: [developer, agent, operator, maintainer]
owner: zero-documentation
status: draft
visibility: internal
---

# Zero Documentation

Zero is a Bun/Elysia full-stack platform with a React frontend. Compose shared
schemas, live authority, scoped services, realtime data and reusable controls.
Use the existing platform contracts as the foundation for an app.

This organized documentation is the primary entry point for new Zero work.
It began with a 2.1.1 source audit and receives focused updates as contracts
change; each feature retains its own review/version/evidence metadata. Read the
page matching your installed package rather than treating every historical
baseline or roadmap item as the current release. Older `docs/` guides remain
available as linked compatibility/deep references.

## Start With A Task

- [Start Here](./start-here.md): the high-level model and a short path into the
  right system references.
- [Build and operate an app](./guides/index.md): new projects, mode selection,
  real user ownership, organization apps, control planes, automation and upgrades.
- [Coding-agent guidance](./agents/index.md): use-first onboarding, exact public
  imports, existing instructions/tooling and proportionate verification.
- [Shared concepts](./concepts/index.md): data planes, live service authority
  and how tracked changes become reactive UI.

## System References

| Area | What you will find |
| --- | --- |
| [Backend](./backend/index.md) | Guardian, Schema/Resources, ReactiveDB/Fabric, Sync, Torrent, AI, Storage and optional services |
| [Frontend](./frontend/index.md) | Providers/SDK/router, data/forms/control planes, UI primitives, hooks, tokens and domain organisms |
| [CLI](./cli/index.md) | Creation, dependency updates, committed release provenance, Doctor and safe operational boundaries |
| [Agents](./agents/index.md) | Agent onboarding, existing instruction bundles, scripts/hooks and clearly labeled future tooling |
| [Optional plugins](./plugins/index.md) | Separately installed capabilities, starting with folder-driven Markdown documentation |

Every system index connects its features, configuration and roadmap. Follow
those links to the canonical contract instead of copying an older example or
guessing an internal import.

## Choose The Right Boundaries

Guardian tenancy/RBAC, Fabric topology, persistence placement and table loading
are independent choices. [Choose modes](./guides/choose-modes.md) before building
ownership around the wrong assumption.

Canonical platform data stays in the system database. Application/tenant data
uses declared resources and admitted services. Local identity anchors support
foreign keys; they are not permission caches.

Optimistic UI is not an accepted server write. Use receipt-aware operations when
reporting success, and retire old rows, selections, drafts and callbacks when
authentication or organization scope changes.

## Find The Exact Contract

The 2.4.2 update includes [exact array policy](./backend/resources/array-overlap.md),
[bounded trigger transactions](./backend/database-automations/transaction-functions.md),
[app-function invocation](./backend/database-automations/app-functions.md) and
[retry-safe Torrent starts](./backend/torrent/system-starts.md). Begin at those
feature guides for the current integration rather than older flattened bundles.

The 2.5.0 release adds the optional [Markdown documentation reader](./plugins/docs/index.md),
its [section-aware search](./plugins/docs/search.md), and the shared
[CodeBlock family](./frontend/components/public-pages/code-block.md). The reader
requires the separately installed plugin and normal build integration; it does
not publish this internal/draft documentation tree automatically.

Feature guides state applicability and source baseline. A roadmap item is not an
implemented API. Source tests, example typechecks and exact installed-package
qualification are different evidence; [verification](./guides/verification.md)
explains what each proves.

Use the documentation matching your installed version when upgrading.
[Upgrade guidance](./guides/upgrade.md) separates dependency replacement from
schema, identity, tenant and workflow changes.

## Maintainer Preparation Area

This section is internal and must be excluded from the eventual public reader
projection, search and production agent bundle:

- [Documentation standards](./documentation-standards.md): quality, metadata,
  canonical ownership, indexes, backlinks and evidence.
- [Documentation process](./documentation-process.md): audit, authoring,
  maintenance, review and publication gates.
- [Working evidence](./_work/index.md): inventories, catalogs, checks, findings
  and templates—not application-building prerequisites.

README, the compatibility Start Here page, agent knowledge-file entrances and
generated app README now route readers to this tree. That documentation routing
does not install agent hooks, skills or a documentation website plugin; those
have separate implementation and qualification requirements.
