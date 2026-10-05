---
id: zero.documentation-standards
type: reference
audience: [agent, maintainer]
owner: zero-documentation
status: draft
visibility: internal
---

# Documentation Standards

These are the agreed authoring rules for the isolated Zero documentation
rebuild. The rules apply immediately within `docs-next/`; their draft status
means the new documentation set has not passed its publication gates.
This authoring policy is maintainer-facing and internal; it is not included in
the future public projection merely because it is outside `_work/`.

[Documentation index](./index.md) · [Authoring process](./documentation-process.md)

## Purpose And Quality Bar

The documentation is a production-facing interface to Zero for developers and
coding agents. It must let a reader discover supported capabilities, choose
the right application modes, compose the existing platform, and verify the
result without conversation history or knowledge of Zero's development history.

1. Write clear, precise explanations and introduce terminology before using it.
2. Explain purpose, appropriate use, prerequisites, and observable behavior.
3. Lead with the usable public contract; internal implementation evidence is
   supporting material, not required reading for ordinary application building.
4. Keep entry points concise and progressively link to deeper explanations.
5. Preserve necessary depth: security, failure, durability, lifecycle, and
   operational details must have an accessible documentation home.
6. Do not equate documentation coverage with correctness or release readiness.
7. Describe verified behavior honestly. Unsupported promises and invented APIs
   are not acceptable examples.

## Isolation And Scope

All rebuild content lives under `docs-next/`. Do not move, rename, overwrite,
delete, or retarget the current `docs/`, README, `llm.txt`, `llms.txt`, package
documentation entries, or active agent instruction/hook files as part of this
pass. Do not add executable agent hooks merely to document a proposed hook.

Existing docs, plans, examples, source, tests, release notes, and relevant
official external documentation may inform the rebuild. Reconcile disagreements
against the supported public contract and record unresolved findings. Never
copy an existing claim into the new reference without checking applicability.

Auditing documentation alone is not permission to alter runtime code,
application projects, databases, storage, credentials, or deployments. For this
rebuild the user explicitly authorized correction of all confirmed platform
defects with focused regression tests, without asking for each fix. Record
reproductions, corrections and review evidence in the internal audit ledger;
do not recast defects as intentional limitations or introduce app workarounds.
This authorization does not include app changes, live data, deployment,
publication or the implementation of unrelated roadmap features.

## Organization And Authority

Use these reader-oriented sections:

- `guides/`: complete tasks spanning systems, including building, operating,
  upgrading, and extending applications.
- `concepts/`: shared concepts and vocabulary used across systems.
- `backend/`: system contracts and feature guides.
- `frontend/`: components, hooks, client SDKs, providers, routing, and styling.
- `cli/`: commands, options, trust boundaries, and procedures.
- `agents/`: agent orientation and instructions/tooling documentation.

Each feature has one authoritative documentation home. Other pages summarize
the relevant relationship and link there rather than duplicate its contract.
Backend/frontend/CLI/agent sections are complementary views, not four separate
copies of the same feature specification.

For example, Guardian owns authorization semantics. A role-management UI page
documents its interface and interaction behavior and links to those semantics.
A task guide connects both in the order a reader needs them.

Every system folder must have, regardless of whether its canonical home is in
the backend, frontend, CLI, SDK, or agent section:

1. `index.md`: overview, terminology, feature navigation, integration map, and
   relevant product philosophy.
2. `configuration.md` when the system has declarative or operational settings;
   otherwise state that configuration is not applicable in its index.
3. `roadmap.md`: known future plans and explicitly labeled ideas.
4. A focused documentation home for every inventoried public feature.

Other sections need their own indexes and appropriate feature references.
Every public component and hook must be inventoried and assigned a destination.
Related small primitives may share a focused page; substantial components and
distinct behaviors deserve detailed guides. A complex feature may have a small
entrance page plus several focused detail pages instead of one enormous file.

## Page Roles And Metadata

Every page has a stable ID, a clear role, an audience, and a review state. Use
Markdown front matter so future catalogs and site navigation can reuse it:

```yaml
id: zero.guardian.sessions
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: public
```

Required fields:

| Field | Meaning |
| --- | --- |
| `id` | Unique semantic identifier that remains stable if the file moves. |
| `type` | `index`, `tutorial`, `how-to`, `reference`, `architecture`, `operations`, `roadmap`, `inventory`, or `template`. |
| `audience` | One or more of `developer`, `agent`, `operator`, or `maintainer`. |
| `owner` | The owning system or documentation area responsible for the contract, not a guessed individual maintainer. |
| `status` | `draft`, `in-review`, or `verified`; this is documentation review state, not feature maturity. |
| `visibility` | `public` or `internal`; `_work/` is always internal regardless of a page's metadata. |

Feature guides and references must also identify their system/feature,
applicable Zero release line or range, relevant modes, and verification
baseline. Use `system`, `feature`, `applies_to`, `modes`, and `reviewed_against`
where applicable. Use this format:

```yaml
system: guardian
feature: sessions
maturity: supported
applies_to: ["<verified Zero release line or version range>"]
modes: ["<applicable documented mode>"]
reviewed_against:
  package: "@zero/framework"
  version: "<exact inspected package version>"
  commit: "<full source commit>"
  snapshot: clean
  date: "<YYYY-MM-DD>"
  evidence_level: source-observed
```

This is a metadata shape, not a support claim for the sample feature. Replace
all placeholders. `snapshot` is `clean` or `dirty`; dirty observations belong
in working evidence, with relevant changes recorded. `evidence_level` is
`source-observed`, `implementation-verified`, or `package-qualified`.
Implementation verification records actual checks against a reproducible
committed snapshot. Package qualification additionally records the inspected
artifact's version, source commit, and SHA-256 under `reviewed_against.artifact`.
It must verify public exports, relevant examples, and the actual packaged docs.
Keep detailed check results in sanitized working evidence rather than metadata.

For separately maintained SDKs/packages, add `related_packages` entries with
`package`, `version`, and `maturity`; do not assume the core Zero version proves
their compatibility. Do not invent a version range or imply that every
combination of modes has been verified.

Use separate capability labels: **supported**, **preview**, **internal-only**,
and **planned**. Keep unresolved applicability explicit in drafts; resolve it
before presenting the page as verified. A roadmap is future-facing even when
its description of a planned idea has been reviewed.

## Indexes And Backlinks

Indexes and backlinks are required product behavior, not optional polish.

1. Every documentation section folder has an `index.md`. Exempt a directory
   used only for assets, executable fixtures, or a non-documentation artifact.
2. Every content page appears in its immediate parent index. Every child index
   appears in its parent index. This creates a navigable path from the main
   index to every reader-facing page.
3. Every non-root page links back to its parent index near the beginning. Deep
   pages also provide a route to the main documentation index.
4. Index entries include a short purpose or task description; a bare list of
   filenames is insufficient.
5. Indexes distinguish reference, explanation, how-to, operations, and roadmap
   destinations so readers know which kind of answer they will find.
6. Link prerequisites at the point they become necessary. Link the relevant
   configuration, permissions, APIs, components, errors, and upgrade guidance
   within the explanation, not only in an end-of-page link collection.
7. Each feature page has a focused **Related Guides And Next Steps** section.
   Describe why each destination is relevant.
8. Review cross-feature links in both directions. Add a contextual reciprocal
   link when readers benefit from returning or discovering an integration;
   do not mechanically create an all-to-all link graph.
9. Use relative links between new documentation pages and section anchors when
   the target is a specific contract. Avoid machine-specific absolute paths.
10. Reader-facing contract explanations must not depend on the old `docs/`
    tree or excluded working notes. Old docs can be linked as research evidence
    in inventories. Repository source/test links may support explanations.
11. No placeholder link may pretend that an unwritten page exists. Track planned
    destinations as plain paths in the working inventory until they are created.
12. Renames require an inbound-link search, parent-index updates, anchor review,
    and deliberate compatibility handling for previously published links.
13. Publication must verify file targets, anchors, index coverage, backlinks,
    and exclusion of internal material. These checks are requirements for
    future validation tooling, not a claim that such tooling is already shipped.
14. A public page must not link to an internal page or anything under `_work/`.
    Internal preparation pages may link to each other. Changing visibility
    requires checking the complete publication projection for broken links.

## Feature Guide Requirements

Use the [feature guide template](./_work/templates/feature-guide.md) as a
checklist. Adapt presentation to the feature; do not keep meaningless headings
or omit relevant contracts merely because they do not fit an example outline.

A complete guide explains:

- Purpose, suitable uses, terminology, prerequisites, and supported modes.
- A minimal working example and realistic advanced examples.
- Exact public imports, APIs, inputs, results, and asynchronous behavior.
- Configuration, defaults, precedence, interactions, and readiness conditions.
- Backend/frontend/SDK/CLI integration where relevant.
- Authentication, authorization, ownership, tenant boundaries, and secret handling.
- Loading, mutation, live-update, cancellation, retry, shutdown, and recovery
  behavior where relevant.
- Errors, safe presentation, and Zero's established observability conventions.
- Verification steps, expected outcomes, upgrade implications, and related guides.

Operational constraints must be deliberate and verified. An unresolved defect
belongs in findings and blocks any inaccurate claim of correct behavior.

## Configuration References

Document every public configuration option: its exact path, accepted types or
values, default, required conditions, environment bindings, precedence,
interactions, security consequences, and effect on startup or runtime behavior.

Link each option to the feature it controls and link each feature back to the
relevant option or section. Explain omitted/disabled/auto-detected behavior
explicitly, including `false`, `true`, `null`, and object forms where supported.
Record when a value is read: module evaluation, configuration resolution,
service startup, or request time. Explain whether Doctor evaluates that same
path, whether a restart is needed, and whether the value is server-only,
redacted in diagnostics, or deliberately projected to a client/admin surface.
Distinguish startup configuration from supported runtime settings. Describe
value origin (config, environment, default, generated, or persisted) only where
that origin is actually supported. Keep security settings and credentials
server-only where required. Never expose secret values in examples or proposed
diagnostic output.

Ordinary typed imports are an existing configuration pattern. Proposed helpers,
config discovery, precedence changes, or inspection tools must be labeled as
future work until implemented; documentation does not introduce those APIs.

## Examples And Evidence

Public examples use the supported package imports and normal application
composition. Provide prerequisites, filenames, required providers, expected
results, and relevant application modes. Mark fragments and pseudocode clearly;
do not call them complete runnable examples.

Examples must respect Zero's existing engineering boundaries: Bun-first runtime
usage, intentional Elysia plugins/middleware, thin routes, service-owned domain
logic, centralized authenticated SDK transport, reusable Zero UI, design tokens,
and standard errors/observability. Use Node-compatible APIs only where Bun has
no suitable direct replacement. Prefer an existing supported Zero capability
before presenting a new app-owned implementation of the same behavior.

Reuse small executable fixtures/reference applications for important examples
where practical. Record what was typechecked, executed, or tested and against
which version/commit. Prefer the smallest relevant verification set. A broad
suite is appropriate for release qualification, not mandatory for every prose
edit. Never run checks against real application data without explicit authority.

Separate these claims: implementation observed, tests present, checks run, and
checks passed. A source symbol or old test count alone proves neither current
behavior nor supported release status.

Use official primary external sources for technical research, cite the exact
supporting page, and respect licenses/attribution. Do not transplant third-party
documentation or examples wholesale without appropriate permission.

Internal evidence must also be sanitized. Do not retain `.env` contents,
credentials, raw authorization headers/tokens, private application records,
PII/PHI, or unredacted provider payloads/stack traces in this tree. Use synthetic
data and repo-relative paths. Summarize relevant findings rather than commit
databases, storage objects, backups, or raw logs. Keep any explicitly authorized
diagnostic artifacts in the project's designated external storage location.

Configuration and Doctor checks execute trusted modules; they are not static
inspection. Do not read real `.env` files for an audit. Use synthetic explicitly
supplied environment values and disposable fixtures, avoiding automatic env-file
loading. App scripts, hooks, migrations, provider calls, network requests, and
live database/storage/log access need their own explicit scope and authorization;
a documentation check must not perform them implicitly.

## Philosophy, Roadmaps, And Agent Guidance

System indexes may explain established principles and design patterns inferred
from the audit. Identify inference as inference; do not turn an observed pattern
into an invented requirement or promise.

Roadmaps collect known plans, proposed improvements, and ideas with explicit
status and provenance. The platform-wide roadmap summarizes and links to system
roadmaps. Neither a roadmap nor a historical plan is a current API reference.

Start Here and agent guides teach Zero's integrated building approach, mode
selection, public extension points, service/layer responsibilities, reusable
capabilities, and focused verification. Agent instructions should point to
authoritative engineering/procedure documents rather than maintain copies.

Keep the initial agent orientation compact and task-directed; load detailed
guides as needed. Preserve the comprehensive bundle as an optional resource.
Future capability discovery should use metadata checked against real public
exports and the exact installed package version. Shared metadata may feed
indexes, search, scaffolding, and tool adapters without becoming a second API.

## Publication Readiness

A verified page has accurate contracts and applicability, navigable indexes and
backlinks, relevant examples/evidence, and no unresolved misleading claims.
The complete set must additionally pass representative developer/agent tasks
using an installed package without private context or framework-internal imports.

Documentation review status and package support are distinct. A source-observed
or dirty-checkout finding can inform a draft but cannot establish released
support. Public feature pages marked verified must identify the qualified
committed package/artifact they describe and use evidence appropriate to their
claims. Preview features remain previews even when their documentation passes.

Development docs may describe a clearly labeled unreleased source baseline.
Release/package-local docs must describe the exact frozen package, not mutable
`main`. Wider patch/minor/major applicability requires compatibility evidence;
do not retroactively widen a range or retag an artifact through documentation.
Keep older release documentation reachable, and record independently versioned
SDK applicability separately. The actual branch/URL/version-selector mechanism
is a future publication decision, not an already implemented tool.

The future Markdown-first documentation site should consume this same content
and metadata, preserve package-local documentation, use Zero's design tokens,
and offer search and version-aware navigation. Internal audit notes and templates
are excluded from reader navigation and search; that exclusion must be tested.

Publication uses an explicit allowlist or generated public-only projection for
the site, package docs, search corpus, and agent bundles. Never add `docs-next/`
wholesale to package files or copy it recursively into a public site. Front
matter expresses classification; it does not implement filtering. Check actual
archive contents and rendered/bundled targets for exclusions and broken links.
The current package does not include this new tree; changing that is a separate
approved handoff. Maintainer governance remains internal unless a self-contained
public contributor version is deliberately prepared and reviewed.

See the [review and publication procedure](./documentation-process.md#review-and-publication-gates).
