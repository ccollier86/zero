---
id: zero.frontend.data-controls.data-table.motion-and-live-updates
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-motion-and-live-updates
maturity: preview
applies_to: ["2.6.0 source; verify installed commit/archive"]
modes: [browser, SSR, array, collection, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "3910810a11f81707344f098b2ace5bbb7cd32e9a"
  snapshot: dirty
  date: "2026-10-19"
  evidence_level: source-observed
---

# Table Motion And Reading-Safe Live Updates

[DataTable index](./index.md) · [Documentation index](../../../index.md)

The table provides row reflow, page transitions, loading
placeholders and held live arrivals to the existing Zero table. It retains
Zero's colors, typography, borders, controls and light/dark tokens; it does not
replace the theme with a demo stylesheet. Identify the installed implementation
by commit/archive hash: the version number alone does not distinguish later
2.6.0 fixes. This reference does not certify an app's custom source adapter.

## Ordinary Composition

Use `DataTable` or its `DataTableView` alias from `@zero/framework/react`.
`motion` and `liveUpdates` default to true where their source supports the
behavior. No second animation component, polling timer or query client is
required around the table.

```tsx
import { DataTable } from '@zero/framework/react';
import { defineTable, field } from '@zero/framework/schema';

const invocations = defineTable('invocations', {
  name: field.text(), status: field.text(),
}, { pk: 'id' });

// Complete caller-owned data. Supply new arrays when accepted records change.
const rows = [{ id: 'run-1', name: 'Build report', status: 'Running' }];

export function InvocationList() {
  return <DataTable schema={invocations.schema} data={rows}
    columns={['name', 'status']} searchable sortable
    paginated={{ pageSize: 20 }} motion liveUpdates />;
}
```

For integrated collections/server sources, retain the normal
[client provider](../../runtime/app-provider.md) and server authorization.
Caller-owned arrays need no provider merely to render; their owner is responsible
for supplying a complete, accepted dataset and its loading state. Treat a remote
page as a [server source](./server-sources.md), not a supposedly complete array.

## What Moves And When

Rows retain their stable React/native-table identity. Reordering animates their
actual position change, new visible rows enter, deleted rows leave, and existing
values receive a restrained token-colored change flash. Selection, row actions,
inline editors and custom cells remain React-owned. Presentation never reparents
rows or delays a network request until an animation finishes.

Query replacements take priority over queued page navigation. Rapid changes
coalesce to the latest target; canceled animations/results cannot restore an
obsolete page. A page change uses a short fade out and a directional incoming
page. Search/filter changes reflow identities rather than presenting unrelated
records as newly inserted data.

Footer Next/Previous navigation applies a whole-page directional slide (`8px`
from the next/previous side) with the 525ms incoming timing and no initial stagger.
It does **not** replay first-load row/skeleton reveal. This holds for array/client
pagination, cached pages and a server page delivered after a delayed response.
Loading placeholders still reflect real pending requests; their presence does
not reclassify a page turn as the initial table load. Reduced motion skips travel.

The table's shared `DATA_TABLE_MOTION` export records the working defaults:

| Interaction | Default |
| --- | --- |
| Easing | `cubic-bezier(.2, 0, 0, 1)` |
| Small UI/sort-opacity change | 120ms |
| Exit/value-roller outgoing digit | 350ms |
| Enter/page incoming/number incoming | 525ms |
| Row movement | 700ms plus `min(230ms, abs(distance) * 0.35)` |
| Page fade out | 230ms |
| Height settling | 580ms |
| Query-enter delay / initial row stagger | 120ms / 45ms |
| Fresh-row/value highlight | 2000ms |
| Skeleton pulse / row offset | 1400ms / 70ms |
| Toolbar search publication | 90ms; clearing is immediate |
| Changed-query/page skeleton admission / minimum visible time | 300ms / 400ms |
| Counter carry stagger / keyboard navigation factor | 30ms / 0.7 |

Movement duration changes with distance, not the easing curve or displacement.
The number rollers use directional 75% travel and rightmost-first carries; the
initial value does not roll. The public constant is a readonly reference, not a
mutable per-application configuration object. Table CSS uses table-scoped motion
variables for its presentation; CSS changes alone do not rewrite the JavaScript
WAAPI scheduling contract.

The organism toolbar updates its input immediately and publishes nonempty
search after 90ms. The standalone `DataTableSearch` primitive retains its
immediate controlled callback contract. Filters, sort and page actions do not
inherit an artificial search delay.

## Existing Cell Values

`cellMotion` defaults to `'typewriter'` for plain text, long-form text, email,
phone and URL displays. Empty strings or null/undefined blank values type in
when text arrives. Changing an existing value erases its displayed text and
types the replacement. The effect reuses Zero's internal `TypingText` replacement
mode, rather than introducing a second text-animation library.

The cadence is 24ms per grapheme with erase and type together bounded to 525ms.
Long values batch graphemes within that budget. A newer value retargets from the
currently displayed text; updates do not queue behind old strings. Initial rows
and newly inserted rows keep their row entrance without an additional typing
sequence. Input editors, custom/masked renderers, numbers, dates, booleans and
choice labels are not converted into a string animation.

The source value, accessibility text, selection/copy and layout update to the
full latest value immediately. Only a decorative, non-selectable overlay shows
intermediate glyphs. Editing a cell removes the decorative display; failed writes
still use the existing editor/error/retry contract. Reduced motion or `motion={false}`
settles immediately. Use `cellMotion="highlight"` for the existing value flash only,
or `cellMotion={false}` to suppress both cell effects without disabling row/page motion.

See [text presentation](../../components/text/effects.md#table-value-replacement)
for the relationship to the reusable text primitives.

## Loading And Pending Interaction

Initial pending data uses schema-shaped skeletons. The initial placeholder copy
fades independently of incoming record opacity, with
350ms exits and the same 45ms row stagger. It is inaccessible to selection and
contains no record identities. In the normal initial reveal, the skeleton pulse
remains 1400ms with 70ms row offsets; real rows enter over 525ms from four pixels
above their final position.

The first accepted result begins its row reveal as soon as the actual data is
ready; it does not inherit the later refetch loader's 400ms minimum. If there was
no real skeleton height baseline (for example, a custom first-load presentation),
the table allocates the incoming rows' layout before their opacity/transform
reveal rather than animating a blank frame from header-only height. Replacing a
real skeleton with fewer rows still eases the frame height over 580ms.
Caller-owned data must declare its initial pending state through the data source's
`isLoading`; a genuinely settled empty result followed by a live INSERT is not
treated as a new initial load.

During a same-query background refresh (including live INSERT/UPDATE/DELETE
invalidation or a manual refresh), existing native rows stay visible and mounted
for the entire request, regardless of its duration. No skeleton, whole-table fade
or initial stagger is admitted. The accepted delta uses ordinary row reflow:
retained rows move from their current positions, newly visible identities enter,
and removed identities leave. A failed refresh leaves the acknowledged view in
place with its error/retry UI; it does not replay the table's first load. Existing
edit drafts and selection survive retained row identities. This behavior requires
keeping the DataTable mounted and supplying stable row IDs; do not conditionally
replace the table with a loader or key it by result count/revision in app code.

For a replacement query or page, the existing presentation remains while the new
request starts; a longer request can switch to skeletons after 300ms.
Once that replacement skeleton is visible, its
400ms minimum avoids a distracting blink. Skeletons are not rows, selectable
entities or mutation targets. Custom `loadingState`/`emptyState` remain normal
composition options; a pending acknowledged editor is kept mounted rather than
replaced by a skeleton.

Toolbars and page controls remain available while requests are pending. Old-query
server rows are marked presentation-only and their row/bulk mutation interactions
are unavailable. Authority/source replacement masks old rows immediately;
retaining a previous same-scope page is not permission to retain another tenant's
records. See [server requests and scope](./server-sources.md#requests-live-updates-and-scope).

## Hold Arrivals Without Moving The Reading Position

After an initial baseline, matching new arrivals can be held while the reader is
on a later page, scrolled away, or an existing transition is busy. The table
continues updating existing identities, rather than inserting a new row above
the reader immediately. The centered `N new` indicator counts unacknowledged
matching arrivals, independently of the exact result total. It has two modes:

- When a genuine new record leads the sorted result on page one, it is an
  up-arrow button. Activating it returns to page one, reveals pending arrivals
  and smoothly scrolls the actual reading viewport to its top.
- When arrivals sort elsewhere, or their position is not yet known, it is a
  passive count: no arrow, click action or keyboard target. It never sends the
  reader to an unrelated first page just because a record was inserted.

The same digit roller and entrance motion apply in both modes. No pagination
footer is required: an unpaginated table can still show the indicator. Already
reading the top acknowledges its visible new leading block automatically;
elsewhere arrivals remain counted until explicit reveal, query/source retirement
or their membership is removed. An UPDATE is never a new arrival, but can change
whether an already-counted arrival is now the leading result.

Holding, sorting/filtering, selection, actions and exports use the same effective
row presentation. Held records are not secretly selected or actionable. For
complete datasets, matching totals can include held records while navigation
continues to use the currently presented dataset until reveal. Server exact totals
still come only from the server; an unknown total never becomes a made-up total
or extra last-page jump.

Evidence depends on the source:

| Source | What may establish a new arrival |
| --- | --- |
| Complete `data` array | A newly added stable identity after its caller-owned loading baseline; the caller must not label hydration/pages as complete live data. |
| Registered `collection` | An admitted SDK `sync.change` INSERT; snapshots, catchup and hydration are not INSERT evidence. |
| Built-in `server` | An admitted Sync INSERT confirmed in the accepted page or by a bounded, authenticated query-membership lookup using the schema primary key. |
| Custom `server` | The adapter's query-bound `subscribeChanges` INSERT confirmed in the accepted page or its optional authoritative `confirmInsertedRows` lookup. |
| `lazy` | No automatic complete-dataset holding/count inference from partial hydration. |

Server counters count confirmed genuine matching insertions, not differences in
totals or cache contents. Separate membership reads do not merge lookup rows into
the displayed page. They allow a matching off-page INSERT to contribute to the
new-record indicator while the source retains its normal bounded query model.
Unsupported custom transports/row identities or a backend policy that does not
permit primary-key filtering remain conservative: only accepted-page INSERTs
are confirmed. This is a bounded arrival ledger, not an all-results count service.
See the [live adapter contract](./server-sources.md#live-insert-evidence-and-custom-subscriptions).

Count evidence is not ranking evidence. Complete sources use their actual sorted
row model. Server sources use a current accepted first page or a separate bounded
authorized first-row query under the same search/filter/sort. The built-in query
requests only one row and omits aggregates. Pending/unsupported/stale position
proof remains passive; a custom adapter can supply `getLeadingRowId` rather than
guessing from field names, timestamp direction or insertion events.

The membership lookup itself never shifts the visible page. Ordinary live
revalidation of an offset query can still change that page's membership after
concurrent inserts/deletes; an offset is not a snapshot or a record anchor.
For stronger page stability, use an app-owned cursor/snapshot contract rather
than treating the animation or held counter as a database consistency guarantee.

Stable identities are essential. Missing/duplicate identities disable
identity-based holding/motion rather than inventing entities from array indexes.
For server mode invalid identities remain response errors. A custom `getRowId`
must remain stable across filtering, sorting and page changes; it must not depend
on the row's changing display index.

## Opt Out And Accessibility

```tsx
import { DataTable } from '@zero/framework/react';
import { defineTable, field } from '@zero/framework/schema';

const history = defineTable('history', { event: field.text() }, { pk: 'id' });

export function QuietHistory() {
  return <DataTable schema={history.schema} data={[]}
    motion={false} liveUpdates={false} searchable paginated />;
}
```

`motion={false}` removes the table's presentation motion without changing query,
mutation, loading or authorization semantics. `liveUpdates={false}` disables
held-arrival presentation; it does not disconnect Sync or stop refetching.
For server sources `source.live: false` separately disables automatic change
invalidation/subscription, and `source.prefetch: false` disables speculation.
Manual refresh and accepted mutation acknowledgment remain separate operations.

DataTable uses its outer ScrollArea as the sole owner of genuine horizontal
and, when height-bounded, vertical overflow. It uses native `scrollChaining="auto"`:
the table scrolls internally while it has room, then hands a wheel/touch gesture
to the nearest scrollable ancestor at the top or bottom. A content-height table
passes vertical gestures straight to the page, even when it has horizontal
overflow. There is no global wheel handler competing with the page.

The same Arc-style content fades watch both real overflow axes. They cover at
most 28px and diminish with the remaining hidden distance; they do not dim a
fitting table or invent vertical fades on a table that grows with the page.
The original native viewport remains the owner—there is no nested ScrollArea.
Row/page entrances and the decorative skeleton copy stay inside the
table's paint bounds; their transforms must not create a temporary scroll range.
Horizontal scrollbar chrome is hidden by default, while wide tables remain
scrollable with a trackpad, horizontal wheel or touch gesture. Set
`showHorizontalScrollbar={true}` on DataTable/DataTableView to expose the existing
scrollbar when content genuinely overflows. This does not change other ScrollArea
or semantic Table components' scrolling policy.

`prefers-reduced-motion` removes perceptible row/page/digit travel, disables
decorative pulse/transitions and skips the presentation-only skeleton minimum
wait. Loading, network and accepted-result authority remain unchanged. Footer status/group labels expose complete readable sentences rather
than announcing each visual digit. Arrow navigation is focus-scoped; inputs,
editors, menus, comboboxes, composition and modified keys retain their normal
behavior. Exiting/presentation-only rows cannot receive actions or selection.

A bottom progress track is shown only when a real navigable page count exists.
Its muted track stays visible while the primary-colored fill grows from the first
to last page over the existing 700ms transform transition. The scoped tokens
`--zero-data-table-progress-height` (2px),
`--zero-data-table-progress-background` (the muted surface) and
`--zero-data-table-progress-foreground` (the primary color) control its appearance.
Reduced motion removes the transition, not the progress indicator.

This is navigation progress, not a timer or request-completion percentage.
Unknown-total and opaque-cursor results do not fabricate the track. Built-in
offset sources now request an exact filtered `page.total` through `/api/data` by
default; `source.includeTotal: false` retains lookahead-only paging. With a known
total, the track derives its fraction directly from current page and
`ceil(total / pageSize)`. Accepted live revalidation updates that total, so the
fill adjusts when new rows add a page or deletions remove one. Rows and count use
one authorized ReactiveDB/Fabric snapshot, not the shared cache or the new-row
pill. Custom offset adapters can supply the same total contract. A separate
summary request must not be treated as the same query's total without a matching
authorization/filter/response contract.

## Verification And Related Guides

Verify rapid query/page interruption, same-scope previous rows, authority/source
replacement, keyboard input/editor precedence, reduced motion, narrow widths,
stable row nodes, continuously visible retained rows through slow live refreshes,
delayed receipts and held genuine INSERTs separately from
snapshot/page joiners. The focused working-source cache/event/browser checks
do not establish release/package qualification or custom-endpoint authority.

- [Configuration](./configuration.md) lists the public options and defaults.
- [Sources](./sources.md) distinguishes complete data from hydration/pages.
- [Server sources](./server-sources.md) owns bounded prefetch and live evidence.
- [Controls](./controls.md) covers keyboard/footer and search composition.
- [Editing](./editing.md) preserves acknowledged typed mutation semantics.
