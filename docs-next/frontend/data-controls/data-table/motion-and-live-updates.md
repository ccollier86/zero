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
applies_to: ["2.6.0 working tree; not yet release-qualified"]
modes: [browser, SSR, array, collection, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "5aa2a34a47c7bc05b0c6f01849fdbf477dc01ea8"
  snapshot: dirty
  date: "2026-10-07"
  evidence_level: source-observed
---

# Table Motion And Reading-Safe Live Updates

[DataTable index](./index.md) · [Documentation index](../../../index.md)

The current development table adds row reflow, page transitions, loading
placeholders and held live arrivals to the existing Zero table. It retains
Zero's colors, typography, borders, controls and light/dark tokens; it does not
replace the theme with a demo stylesheet. These additions are working-tree
behavior, not a claim that the published 2.6.0 archive already contains them.

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
| Later request skeleton admission / minimum visible time | 300ms / 400ms |
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

During later queries the
existing presentation remains while the new request starts; a longer request
can switch to skeletons after 300ms. Once a later skeleton is visible, its
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
the reader immediately. A centered `N new` action exposes the held count.
Activating it returns to the first page, reveals held records and scrolls the
table's actual reading viewport to its top. No pagination footer is required:
an unpaginated table can still show this action.

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
new-record button while the source retains its normal bounded query model.
Unsupported custom transports/row identities or a backend policy that does not
permit primary-key filtering remain conservative: only accepted-page INSERTs
are confirmed. This is a bounded arrival ledger, not an all-results count service.
See the [live adapter contract](./server-sources.md#live-insert-evidence-and-custom-subscriptions).

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

`prefers-reduced-motion` removes perceptible row/page/digit travel, disables
decorative pulse/transitions and skips the presentation-only skeleton minimum
wait. Loading, network and accepted-result authority remain unchanged. Footer status/group labels expose complete readable sentences rather
than announcing each visual digit. Arrow navigation is focus-scoped; inputs,
editors, menus, comboboxes, composition and modified keys retain their normal
behavior. Exiting/presentation-only rows cannot receive actions or selection.

A bottom progress track is shown only when a real navigable page count exists.
It grows from the first to last page; it is not a timer or fake request completion
percentage. Unknown-total and opaque-cursor results do not fabricate the track.

## Verification And Related Guides

Verify rapid query/page interruption, same-scope previous rows, authority/source
replacement, keyboard input/editor precedence, reduced motion, narrow widths,
stable row nodes, delayed receipts and held genuine INSERTs separately from
snapshot/page joiners. The focused working-source cache/event/browser checks
do not establish release/package qualification or custom-endpoint authority.

- [Configuration](./configuration.md) lists the public options and defaults.
- [Sources](./sources.md) distinguishes complete data from hydration/pages.
- [Server sources](./server-sources.md) owns bounded prefetch and live evidence.
- [Controls](./controls.md) covers keyboard/footer and search composition.
- [Editing](./editing.md) preserves acknowledged typed mutation semantics.
