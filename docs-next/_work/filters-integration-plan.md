---
id: zero.filters-integration-plan
type: architecture
audience: [developer, agent, maintainer]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: filters
maturity: planned
applies_to: ["Proposed Filters feature; not implemented or released"]
modes: [standalone, array, collection, lazy, server, data-studio]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "98e7419778af3097e2481d00c65c148342f054b2"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Filters Component and DataTable Integration Plan

[Working evidence](./index.md) · [Documentation index](../index.md)

Build one reusable Filters family with compact chips and an advanced condition
builder, plus optional integration with Zero's existing DataTable controller.
The same applied conditions must mean the same thing in local evaluation,
authorized server reads, and Fabric actors. Visual quality and documentation
are completion requirements, not a later cleanup pass.

This is a proposed implementation contract. New imports, props, endpoints and
helper names below are not current APIs. Runtime implementation has not started.
The feature branch is a child of the completed local Cascader and Signature Pad
work. Main, release archives, consuming applications and live data remain outside
this planning change.

## Deliverable and scope

Include the standalone component, basic and advanced presentations, typed value
editors, async choices, a React-free query model, local execution, managed server
execution, DataTable and headless-hook integration, MasterDetail forwarding,
Data Studio adoption, focused tests, and both documentation collections.

Reuse Zero's components, schema descriptors, authenticated SDK, query services,
Guardian checks, Fabric routing, state controller and observability boundary.
Do not create another table, dropdown framework, fetching hook hierarchy, global
theme, saved-view database, or authority mechanism.

Saved views and URL state can be app-owned controlled-query examples. Do not
automatically persist queries or put potentially sensitive values in URLs.
Sliders, general JSON-path queries, arbitrary SQL, regex predicates, joins,
dynamic relative-date rules, and a platform-wide UI redesign are not required
for this deliverable and must not appear as working filter options.

## Existing integration points

| Existing owner | Relevant behavior and required integration |
| --- | --- |
| [DataTable controller](../../src/components/data-table/use-data-table-controller.ts) | Owns one source, interaction state and table instance. Filters feeds this controller, not a second one. |
| [Table state](../../src/components/data-table/data-table-state.ts) | Search and column filters are existing criteria. Add an optional tree without changing their meanings. |
| [Toolbar](../../src/components/data-table/data-table-toolbar.tsx) | Has search-first layout, controls/actions/supplemental slots, active-filter feedback and Clear All. |
| [Local table hook](../../src/components/data-table/use-data-table.ts) | Uses scalar TanStack filters; explicit operator objects and grouped conditions need a dedicated evaluator. |
| [Server query adapter](../../src/components/data-table/data-table-server-query.ts) | Accepts scalar operator expressions but serializes flat filter parameters. Preserve legacy transport; add structured-query transport. |
| [Resource query planner](../../src/resources/resource-query.ts) | Composes caller criteria with mandatory policy. User groups must stay inside that composition. |
| [Fabric find contract](../../src/databases/database-operation-contracts.ts) | Already has bounded nested allOf/anyOf and basic/null/list predicates. Extend its closed predicate vocabulary only where required. |
| [Configuration normalization](../../src/frontend/server/types.ts) | Retains SQL definitions but not all logical FieldMeta. Trusted query metadata needs preservation. |
| [MasterDetail](../../src/components/master-detail/master-detail-page.tsx) | Uses the same controller, but does not yet forward filter configuration or controlled table state. |
| [Data Studio filter control](../../src/components/data-studio/data-studio-filter-control.tsx) | Has a separate scalar draft/Apply implementation and logical-column query contract. Replace the presentation through an explicit logical-row adapter. |

The current `filters` prop is an equality map for lazy collection hydration.
The toolbar context's `query` is search text. Neither name may be repurposed.
Normal generated filters currently reach server queries too; correct the older
documentation that describes them exclusively as client-side.

## Visual design and interactions

### Compact toolbar

Keep the existing gooey search first. Follow it with Add filter or an advanced
Filters trigger and readable condition chips. Desktop compact controls should
align with the existing 32-pixel table controls, using small existing icons,
balanced padding and normal readable text. Touch layouts use larger targets.

Example chip wording is `Status · is any of · Active, Pending`. Field, operator,
value and removal controls are sibling elements, never nested buttons. Long
values truncate with full accessible names and tooltips. Repeated field names
carry their path. Nested groups become meaningful summaries such as
`Any of 3 conditions`; opening one reveals the group, not a flattened list.
When a basic bar contains an existing OR/negated group, adding a basic condition
ANDs it with the intact expression. Do not append inside the OR group or rewrite
its meaning to obtain flat chips.

Use semantic background, border, foreground, primary, muted and destructive
tokens. Active chips can use a restrained tint; invalid drafts need a clear
but quiet error state. Option icons, avatars and semantic colors are optional
renderers, not hardcoded app examples. No huge empty cards, permanently wide
inputs, debug JSON panels, decorative headings or excessive explanatory copy.

### Advanced popover and inline builder

Use one surface with aligned field, condition and value cells, a modest group
indent and compact Match all / Match any controls. A visible row menu supports
edit, duplicate, remove, supported negation and move actions. Right-click may
open that same menu, but every action must be reachable without right-click.

Only the body scrolls; headings and Apply/Cancel actions remain reachable.
Inline mode uses the same builder without imposing another outer card. On
mobile, use Zero's bottom Sheet, stacked condition rows, one constrained scroll
body, reserved close-button space and an anchored footer.

Basic/advanced switching retains the same query and editor drafts. Stable rule
IDs preserve focus through duplicate labels, reordering and edits. Menu-to-editor
transitions use the existing close-focus lifecycle, not arbitrary timeout fixes.
Support keyboard navigation, Enter/Apply, Escape, IME composition, clear/remove,
read-only inspection, reduced motion, and visible touch actions.
After removing a focused chip/row, focus the next sibling, then the previous
sibling, then Add filter. Closing a child editor restores its opening segment.

### Existing primitives

| Need | Reuse |
| --- | --- |
| Nested field picking | Cascader, breadcrumbs and deep search |
| Operators | Compact Command or DropdownMenu |
| Single and multiple choices | Cascader/Command, Checkbox and optional selected-value renderers |
| Text and numbers | Input; two typed Inputs for ranges |
| Booleans | Existing Select or Switch |
| Dates and ranges | Existing Calendar inside the value popover; one month on narrow screens |
| Free-form lists | Existing TagInput where its contract fits |
| Chips and actions | Badge, Button and existing icons |
| Surfaces and scrolling | Popover, Sheet, ScrollArea and SSR-safe media-query support |

Add opt-in compact density to the existing Cascader parts rather than changing
their current defaults. Avoid CommandDialog's larger defaults. Compose Calendar
directly so a date editor does not open competing nested popovers. No new
low-level UI primitive is presently required. If implementation reveals a real
missing primitive, pause and ask the user before building one from scratch.

## Proposed public composition

The UI family belongs at `@zero/framework/components/filters`, with normal
root/React exports. Pure contracts and evaluation helpers belong at a focused
React-free `@zero/framework/filters` subpath. SQL, Bun SQLite and server policy
must not leak into browser exports.

The primary standalone component accepts `schema` or explicit `fields`,
`fieldOverrides`, `query/defaultQuery/onQueryChange`, `mode`, `placement`,
compact/default size, labels, custom value renderers/editors, and `scopeKey`.
It works without DataTable or AppProvider when editing local data.

Expose a small headless hook and useful composition parts for triggers, chips
and the advanced builder. They share one guarded controller. Disabled/read-only
enforcement belongs at that controller, including imperative methods, not just
in the button styles. Custom editors change presentation and produce typed
values; they cannot invent server execution semantics.

Extend `filterable` compatibly:

- Omitted/false keeps today's default and does not unexpectedly clear criteria.
- `true` retains today's generated per-column controls.
- An object opts into the new basic or advanced editor, with schema-derived
  fields, optional field selection/overrides, and popover/inline placement.

Proposed fragment:

```tsx
// Proposed API; implementation and names must be verified before publication.
<DataTableView
  schema={tasks.schema}
  source={{ type: 'server', table: 'tasks' }}
  searchable={{ fields: ['title'] }}
  filterable={{ mode: 'advanced', placement: 'popover' }}
/>
```

Add optional `filterQuery` to table initial/controlled state and server-query
input. Do not add a required member or change the old state shape for screens
that do not use this feature. Keep legacy column filters and source equality
filters separate. MasterDetail forwards the same filter configuration plus
optional table initial/state/change props to its existing controller. Review
CrudPage's existing table options and forward the new type where applicable.

Explicit fields override derivation; field overrides adjust presentation and
narrow capabilities. Derivation respects the selected filterable columns and
excludes password/hidden fields by default. Hidden UI fields are not a security
policy; the server has its own trusted query-field allowlist. Do not infer a
complete choice set from the currently visible server page.

For built-in server sources, obtain an authorized capability projection through
the SDK under the same table/resource read policy. It contains supported fields,
kinds, operators, bounds and catalog signature, not private choice labels or
stored values. Cache/fence it by source, live authority and catalog lifetime.
Intersect it with schema-derived UI fields before enabling edits. Local arrays
need no discovery request; custom adapters can declare capabilities directly.
A capability failure is retryable UI state, not permission to guess support.

## Applied queries and editing drafts

One query grammar supports stable rules and AND/OR groups with explicit
operators and typed values. Multiple rules can target the same field.
Normalize an applied expression independently of rule IDs, display labels,
cosmetic ordering, density, and basic/advanced presentation. Cosmetic changes
must not trigger a data refetch.

Keep unfinished editor input outside the applied expression. Text/number/range
editors retain invalid text and the previous applied condition until a valid
commit. Single-choice values can commit immediately; multiple choices and
ranges normally use Apply. Advanced edits apply as a validated batch. Escape
cancels the current editor, not the whole table. Removing a rule, matching null,
choosing an explicit Unassigned option and choosing an empty set are distinct.

A removed field or unsupported saved condition produces an actionable
invalid-query state. Do not silently drop it, broaden the query, or render an
unfiltered result as successful. Empty root is the explicit no-filter case;
unfinished nested groups are not valid applied conditions.

In advanced mode, a child editor's Apply updates only the staged tree. The
panel's Apply publishes the complete validated tree; panel Cancel restores the
applied query. Basic editors commit only their own condition. Ordinary outside
dismissal preserves an unfinished draft, while explicit Cancel or scope
retirement discards it. A mode switch with pending edits retains them and shows
Changes not applied with reachable Apply/Cancel actions.

Filters-level Clear filters clears only its tree. In a staged panel it stages
that clear until Apply. DataTable's Clear All clears global search, legacy
column filters and the applied tree together, but never source hydration
filters or mandatory server policy. Toolbar context adds optional
`filterQuery/setFilterQuery` without changing `query` search text. Applied leaf
conditions contribute to the count; search, group containers and invalid drafts
do not. Removing one tree chip cannot remove a legacy predicate on the same field.

Capture a draft's editing baseline, including stable IDs and schema/source
lifetime. An equivalent deep-copied parent acknowledgement preserves it. A new
external controlled query invalidates stale Apply: retain the draft with an
explanation and a Reload/Cancel action rather than overwrite newer criteria.
Empty multi-choice lists stay invalid drafts with Apply disabled; they are not
equivalent to removing a rule and never disappear from an applied request.

Wire requests carry a versioned, bounded expression without UI labels,
functions or executable syntax. Field paths identify declared catalog entries;
picker groups do not automatically imply joins or JSON-property queries.
Support rule/group negation explicitly in that grammar. The evaluator and
server compiler implement the same NOT semantics; a menu must not offer NOT
before its operation contract is complete. Normalization removes double
negation where valid and counts the final lowered plan.

## Query semantics and parity

Every operator advertised by a built-in source must work locally, in the main
SQLite lane and in Fabric. A single validator and logical value contract feed
the local evaluator and server planner. Do not reuse forgiving display-codec
fallbacks to decide nullness or emptiness.

| Kind | Initial operator family | Required meaning |
| --- | --- | --- |
| Nullable values | Null/not null | Missing/null are retained distinctly from false, zero and empty text. |
| Text | Equal/not equal, contains/not contains, starts/ends with, any/none of | Literal values, not user-authored SQL patterns. Default comparisons are case-sensitive; any advertised case-insensitive variant requires verified Unicode parity. |
| Numbers | Equality, comparisons, between/not between | Finite typed values and inclusive bounds; reject reversed/invalid ranges. |
| Dates | On/not on, before/after, between | Valid calendar dates, independent of host timezone. |
| Datetimes | Equal/not equal, before/after, between | Canonical instants with explicit timezone/offset; equal instants compare equally despite different string offsets. |
| Boolean/enum/select | Equality, any/none of | Existing storage codecs, typed values, and complete JSON lists without comma splitting. |
| Tags/multiple select | Has any/all/none, empty/not empty | Array-element membership, not scalar IN or substring matching. |
| Empty values | Field-specific empty/not empty | Null plus empty text/array where applicable; false and zero are not empty. |

Define null behavior for negative predicates explicitly: absence is not an
automatic match for not-equal/not-contains. Explicit null/empty conditions
express absence. Guard malformed stored array/date values consistently instead
of coercing them into a valid empty value. Test the complete truth table,
including negated rules and nested groups.

Use three-valued predicate logic for valid values, absence and malformed stored
values. Comparison/membership predicates on absence or malformed values yield
unknown, not false that can be inverted into a match. AND/OR/NOT preserve that
unknown; only true selects a row. Explicit null/empty operators handle real
absence, while malformed values remain unknown even for those operators.
The empty root alone is the explicit no-filter expression.

For new literal-text predicates, use verified binary comparisons and literal
substring operations, not legacy SQLite LIKE. Preserve existing LIKE behavior
on legacy requests. Datetimes use a validated UTC millisecond normal form with
an explicit offset at input; reject unsupported sub-millisecond query values.
Stored instants receive the same precision/type admission in local and SQL
execution. No host-local-time parsing or raw lexical ISO-string equality.

No silent browser/SQL coercion is allowed. Absolute dates/ranges are sufficient
for the first version; dynamic relative-date execution and stored interval
columns need their own semantics before their operators can be advertised.

## Trusted schema capabilities

SQL affinity alone cannot identify a date, enum or JSON-array field. Preserve
minimal immutable query metadata from `defineTable` and `schema`, including
logical kind and encoding, into the normalized server query catalog.
Keep UI labels, icons, callbacks, secrets and unrelated FieldMeta out of it.
Raw table definitions get conservative capabilities and a trusted explicit
query-field declaration for richer types.

Use an explicitly recognized framework-owned metadata channel on server-table
projections, with descriptor-safe read/validation and catalog construction.
Admit and preserve exactly that metadata through configuration normalization,
direct/composed realms, spreads, contributions and actor bootstrap. Reject
unknown symbols, invalid metadata and accessors without invoking getters.
Keep existing declared-sync, mutation-validator and Guardian-reference metadata.

Maintain a deterministic query-catalog signature separate from physical
identity. Keep realm fingerprint, schema checksum, database references and
durable receipt namespaces unchanged. Labels/reordering must not change the
SQL schema or create columns. The separate catalog signature is a required
runtime reader/actor capability proof for operations that use that catalog;
extend the strict actor registration/request allowlists deliberately and reject
catalog mismatch before execution. Prove an existing database reopens without
migration, and a stale actor cannot execute with incompatible query metadata.
New metadata must not reproduce the recent Fabric symbol-admission startup
blocker. No data migration is required merely to preserve query metadata.

## Server transport and authorization

Add read-only POST query operations to the existing managed data and Resource
route owners. Proposed paths are `POST /api/data/query` and
`POST /api/resources/:resource/query`. Keep GET list endpoints and their legacy
filter encoding unchanged. Use the normal authenticated SDK rather than raw
component fetch calls. Query values belong in a request body, not automatically
in a URL, URL analytics or saved browser history.

Each new route uses the same list/read admission and services as its existing
GET equivalent. Classify it as a query operation for validation/error mapping,
not as create because the request method is POST. Keep the actual POST method
for app credential resolvers, HMAC verification and method ceilings; a GET-only
key must not acquire POST access automatically. Auth-enabled sources continue
using SDK bearer authentication, not a new page-cookie fallback. Explicitly
public/auth-disabled sources retain their existing read-policy behavior.
Keep named Elysia plugins,
explicit typed dependencies,
request/response validation and thin routes. Align managed data and Resource
query schemas for search, sorting, paging and the structured expression.

Preserve existing GET parameter meanings, including documented omission rules.
Correct the touched SDK's loss of literal commas in flat list values through
an additive lossless encoding and regression tests under the same GET policy;
do not force legacy GET-only credentials onto POST. New tree queries still use
the structured body by default. Never describe malformed list encoding as an
intentional restriction on valid typed values.

The effective query is always:

```text
trusted database/realm binding
AND mandatory Guardian/Resource row policy
AND legacy caller filters and global search
AND validated user filter expression
```

No caller can replace policy with OR/NOT, choose another tenant's database,
query a forbidden field, provide a SQL fragment, or supply authoritative field
types. Use the existing live authority fences, machine-principal projection,
API-key ceilings and revocation behavior on both direct and actor-backed reads.

Share predicate SQL compilation between the normal SQLite and actor/Fabric
lanes. Extend closed find/read contracts for the required literal-text and
guarded JSON-array predicates, not raw SQL escape hatches. Data Studio maps
stable logical column IDs to its own trusted cell expressions.
Preserve Data Studio's canonical typed-cell projection rather than query its
serialized record payload or accidentally filter on display fallback values.

Validate UTF-8 body size, strings, values, breadth, depth, nodes and binding
counts. Start with a 64 KiB query-body limit and 4 KiB per string, enforced by
bounded stream reading before JSON parsing as well as DTO validation. Do not
trust Content-Length as the only protection. Initial expression budgets must
fit the existing actor ceilings of
depth 8, 64 predicate nodes, 50 IN values and 256 bindings. Count the lowered
combined plan, including ranges, search and policy, before dispatch; user
filters cannot consume the whole budget independently. Fail with a stable,
actionable complexity error, never truncate conditions.

## Source execution and lifecycle

| Source | Execution contract |
| --- | --- |
| Array | Shared local evaluator, followed by existing column filters/search/sort/paging. |
| Full reactive collection | The same local path; reactive membership changes recompute results. |
| Existing lazy collection | Preserve the hydration equality map and explicitly loaded-row controls. Do not silently convert it into another source or claim all matching records/totals. A small public server-source recipe gives complete queries. |
| Built-in server | Send the complete expression; render the returned page without another browser filtering/paging pass. |
| Custom server/cursor adapter | Declare supported query capabilities; preserve tree meaning and reject unsupported applied expressions visibly. |
| Data Studio | Compile against declared logical columns; preserve schema revision, progressive query windows and organization authority. |

An existing custom adapter with no capability declaration retains its legacy
behavior. A nonempty new expression requires explicit support; do not assume
that accepting the old query shape means it understands the tree. Known
capabilities restrict the offered editors and operators before application.

A newly added lazy query adapter is optional only if it genuinely provides
isolated server-result membership; it must not reuse the shared hydration cache
as an ordered result set. Source ownership remains explicit.

Criteria changes reset pages, cursor history and page selection through the
existing controller. Keep query criteria separate from authority/source
identity so a filter edit does not invalidate an otherwise authorized captured
write. Preserve unrelated state such as column visibility.

Abort or ignore obsolete record/option requests. Include applied expression
identity in request keys; fence A to B to A lifetimes with generations, not just
equal tenant strings. Clear retired local drafts, choice caches and selection.
Controlled parents deliberately own query persistence and must bind their state
to the source/organization; include a complete scope-keyed example.

Keep toolbar editing usable during row refresh. Scope changes immediately hide
old protected rows and private option labels. Server-result ordered IDs stay
separate from shared cached records. Relevant reactive changes cause scoped
refetch; `live: false` and custom-source event bridges retain their meanings.

## Async choices

Choice loaders are app-owned functions using the SDK or an app service, with
AbortSignal and optional cursor. Filters owns only their UI-facing controller.
Cache by lifetime, field path, typed value, search and cursor. Resolve committed
IDs absent from the loaded page through an optional resolver. Never derive
identity from labels, coerce numeric/boolean IDs into colliding strings, or
silently remove an unavailable choice.

Reuse Cascader admission, keyboard behavior and loading fences. Support bounded
loading, retry, empty, selected and load-more states; window long static lists
with the existing virtualization infrastructure where necessary. Label loading
must not mutate the applied query. Retire pending work and caches on scope or
schema changes, including successful and failed late completions.

## Prefab adoption

DataTableView, low-level useDataTable and MasterDetail get the new contract in
this implementation. Data Studio is the first concrete prefab adopter: replace
its bespoke filter cards, add the expression to its logical-row query compiler
and SDK, preserve stable column IDs during rename/reorder, and retain revision
and progressive-loading behavior. Do not show an advanced group UI while its
backend still supports only flat AND predicates.

Guardian directories and Storage Studio have domain-specific listing
controllers. Do not globally rewrite them into generic table SQL predicates.
Later reuse can use this presentation with an explicit capability-correct
domain adapter; permission/status/owner endpoints keep their semantics.

## Modules and observability

Keep shared types, admission, semantic normalization, field catalogs, value
decoding and local evaluation in focused React-free modules. Keep SQL predicates
in backend modules, plugin DTO/routing in the current named plugins, SDK
transport in client modules, React adapters in hooks and rendering in small
component files. Do not grow DataTable or one Filters file into a catch-all.

Use Zero domain error codes and the current frontend/backend observability
boundaries. Report a loader/action failure once at its owning boundary; avoid
duplicating Cascader and Filters events. Validation errors appear inline without
logging every keystroke. Events contain bounded operations, reasons and counts,
not queries, values, option labels, raw callback exceptions, SQL bindings or
credentials. No direct console logging in reusable code.

Validate server query catalogs during startup and through relevant existing
Doctor paths. Ordinary component props do not need global configuration,
environment variables or a new Doctor scanner for JSX.

## Implementation sequence and acceptance

1. Lock the public shape, semantic operator matrix and source capabilities;
   add parity fixtures before exposing advanced UI options. In parallel, build
   an early styled candidate from existing controls with synthetic fields and
   controlled queries. Inspect its compact hierarchy in light/dark and mobile
   before broad backend wiring; do not defer visual judgment until the end.
2. Preserve/admit trusted metadata and implement the shared validator,
   expression normalization, local evaluator and predicate compiler.
3. Add authenticated query transport and SDK support; prove Guardian and
   direct/Fabric parity with real disposable package-mode fixtures.
4. Build the compact standalone family and its editor/async-choice controllers
   from existing Zero primitives. Capture styled empty, active, invalid,
   advanced, loading and mobile states early; inspect them before adoption.
5. Integrate DataTable state, toolbar, source adapters and MasterDetail; migrate
   Data Studio's filter presentation and logical-row query handling.
6. Finish public guides/examples and indexes, run focused/package checks, and
   review the actual visuals. Only then consider a release/merge separately.

| Gate | Required evidence |
| --- | --- |
| Model and semantics | Immutable inputs, malformed types/accessors, stable IDs, cosmetic semantic-key equality, invalid drafts, groups, repeated fields and bounded complexity. |
| Execution parity | Identical local/direct/Fabric matches for every advertised operator; null/false/zero, Unicode, quotes/commas, date offsets, malformed stored values and JSON arrays. |
| Admission and policy | Metadata cloning/spreads/composition/actor startup, no SQL columns/drift, existing metadata preserved, forbidden fields, policy AND user OR/NOT, revocation and API-key ceilings. |
| Compatibility | Boolean filterable, lazy filters, old complete state objects, old GET/Resource reads, all old/new criteria combined and unchanged toolbar slot names. |
| Lifecycle | Offset/cursor resets, exact/unknown totals, stale responses/errors, independent queries, scope/adapter/schema change, A to B to A, disposal and live membership. |
| UI | Keyboard/mouse/touch, menu-focus transfer, typed drafts/Apply/Cancel, read-only guards, remote labels, loading/retry, empty states and accurate active counts. |
| Visual | Inspect styled screenshots in light/dark at 320, 390, 768 and 1280 pixels; no page overflow, clipped menus, oversized controls or unreachable footer. Desktop chips/triggers align at 32px; long labels never squeeze actions; three nested groups remain readable at 320px. Include applied/unapplied states, mobile keyboard/input/footer reachability, reduced motion and long localized labels. |
| Prefabs | One MasterDetail controller; Data Studio logical columns, renames, revision conflicts, query-window reset and organization isolation. |
| Package | Fresh installed public root/React/UI/core imports, SSR and browser builds; no React/SQLite in the wrong entry point. |
| Documentation | Actual public Markdown examples compile; metadata, indexes, backlinks, supported modes and package applicability are accurate. |

Use focused regression suites during implementation and the established fresh
candidate/archive gates for a release. Tests use synthetic data and disposable
external scratch directories, never Pantheon, PracticeIQ or live databases.
There is no database migration or consuming-app rewrite merely to keep existing
table behavior after an upgrade.

## Documentation deliverables

Add `docs/frontend/filters.md` and
`docs-next/frontend/components/filters.md` as the standalone feature entrances.
For the new collection, split deeper operator/adapter explanations into focused
frontend data-control/backend query homes if the guide becomes mixed or large.
Every new page gets an immediate index entry, an early parent backlink, related
guides and reciprocal integration links. Proposed symbols stay out of current
API catalogs until they exist.

| Documentation area | Required upgrade |
| --- | --- |
| Filters | Public imports, composition, exact props/defaults, controlled/local state, drafts, editors, async choices, scope handling, accessibility, SSR and safe failures. |
| DataTable | Current guide plus new controls/configuration/state/sources/server-source/selection guides; boolean/object adoption and combined legacy/tree criteria. |
| MasterDetail and CrudPage | Optional forwarding and a single-controller example; no application-side duplicate table controller. |
| Schema and managed data | Trusted metadata, raw-table declarations, query capabilities, operator semantics, versioned body transport, limits and rejected input. |
| Resources and Fabric | Read-policy composition, credential ceilings, predicate operations, direct/actor parity and metadata admission. |
| Data Studio | Stable logical columns, SDK/query API, advanced filtering, progressive resets, revisions, toolbar/controller adoption and limits. |
| Observability | Exact failure codes, reporting ownership, redaction and quiet expected validation. |
| Navigation and catalogs | Both frontend indexes; new component/configuration indexes, hook/support/public-export inventories, applicable backend indexes and source-backed audit evidence. |

Include complete examples for standalone controlled editing, schema derivation,
basic and advanced modes, custom choice loaders, local/full-collection tables,
built-in server tables, cursor/custom adapters, scope-bound parent state,
MasterDetail and Data Studio. Explain existing lazy hydration versus complete
server queries accurately with a supported server-source adoption example.
Compile the actual examples through the existing UI/SDK/backend example gates.

No mandatory nuqs/Next.js dependency, automatic URL persistence, new migration,
or obsolete release applicability claim belongs in those guides. Document
source additions as unreleased until an actual committed package is qualified.
Keep `docs-next` working material excluded from public artifacts.

## Related guides and next steps

- [DataTable](../frontend/data-controls/data-table/index.md) owns the existing
  source/state/toolbar contract that this feature extends.
- [Component configuration](../frontend/components/configuration.md) is the
  public home for component props and their layer boundaries.
- [Schema UI metadata](../backend/schema/ui-metadata.md) distinguishes display
  metadata from the trusted server capability catalog planned here.
- [Resource queries](../backend/resources/queries.md) owns policy-composed
  listing and its caller query boundary.
- [Fabric operations](../backend/fabric/operations.md) explains the actor-backed
  read contract and its operation limits.
- [Data Studio queries](../backend/data-studio/queries.md) owns the logical-row
  adapter that must preserve query windows and revision handling.
- [Frontend observability](../frontend/observability.md) owns safe browser event
  reporting; shared events must use that boundary.
- [Documentation standards](../documentation-standards.md) governs feature homes,
  examples, indexes, backlinks and truthful applicability.
- [ReUI Filters documentation](https://reui.io/docs/components/radix/filters)
  supplies the interaction reference. Pin and license-check the actual public
  source before adaptation; do not copy paid blocks or introduce a parallel UI
  stack.
