---
id: zero.docs-next
type: index
audience: [developer, agent, maintainer]
owner: zero-documentation
status: draft
visibility: internal
---

# Zero Documentation — Next

This is the isolated workspace for Zero's next production-quality developer
and coding-agent documentation. It is not yet the replacement for the current
documentation shipped with Zero.

The rebuild begins with a source-backed inventory of every system and public
surface. Detailed feature guides, subsystem indexes, configuration references,
and roadmaps will be written against that inventory. Completion means readers
can find, understand, use, and verify the supported contracts—not merely that
Markdown files exist.

## Authoring And Review

Read these documents before adding or reorganizing material in this tree:

1. [Documentation Standards](./documentation-standards.md): the agreed rules
   for quality, structure, indexes, backlinks, examples, applicability, and
   isolation.
2. [Documentation Process](./documentation-process.md): the audit-first
   workflow, maintenance procedures, review gates, and eventual publication
   handoff.
3. [Working Evidence And Templates](./_work/index.md): inventories and review
   material used to prepare the reader-facing documentation.

This preparation index and its authoring links are internal while the reader
guides are being built. Before it becomes the public main index, replace the
preparation navigation with the verified reader section indexes. Public pages
must never link to excluded internal material.

## Planned Reader Navigation

The following destinations describe the agreed organization. They are not
links or claims that the guides are already complete:

| Destination | Purpose |
| --- | --- |
| `start-here.md` | Concise orientation and the shortest verified path to a working Zero application. |
| `guides/` | Task-oriented application-building, operations, upgrade, and extension guides. |
| `concepts/` | Shared concepts such as authority, data planes, reactivity, service boundaries, and observability. |
| `backend/` | System indexes and feature-level backend contracts. |
| `frontend/` | Public components, hooks, client SDKs, routing, providers, and design-system guidance. |
| `cli/` | Commands, options, trust boundaries, side effects, and operational procedures. |
| `agents/` | Agent onboarding and documentation of instructions, rules, hooks, skills, scripts, and tools. |

Each actual section will have an `index.md`. Backend system folders will also
have a configuration reference when applicable, a roadmap, and focused feature
guides. Navigation will offer both system-based and task-based paths.

## Isolation And Status

- Existing `docs/`, README, agent bundles, instructions, and hooks remain
  unchanged by this documentation rebuild unless a later change is explicitly
  approved.
- Existing documentation is research input, not an automatically authoritative
  description of current behavior.
- No new system audit or feature guide is marked complete by creating this
  workspace. The audit and review gates are described in the
  [process](./documentation-process.md#audit-every-system-before-feature-rewriting).
- Audit findings do not authorize application changes, deployments, database
  access, migrations, or unrelated platform fixes.
- Replacing the current documentation or changing package/site/agent entry
  points is a separate, deliberate handoff.
