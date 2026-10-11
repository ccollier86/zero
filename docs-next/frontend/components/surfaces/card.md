---
id: zero.frontend.components.surfaces.card
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: card
maturity: supported
applies_to: ["2.6.0 working source; composable Card/ContentCard upgrade unreleased"]
modes: [browser, SSR, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Card And ContentCard

[Surfaces index](./index.md) · [Component index](../index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use Card's composable parts for application-owned content, or ContentCard for a
standard article with optional managed quick look. Import the supported
`@zero/framework/components/ui/card` and
`@zero/framework/components/ui/content-card` facades. Neither family fetches
records, determines identity or persists actions.

The canonical implementation lives in the
[Card family](../../../../src/components/surfaces/card/index.ts). Its physical
source location does not replace these public imports. The composable upgrade
is unreleased; the contracts below describe the dirty 2.6.0 working source.

## Native Card Composition

Card, CardHeader, CardDescription, CardContent and CardFooter accept native div
props. CardTitle also accepts asChild=false; use a heading child when semantic
heading structure is needed, because its default is a div. Source padding is
header/content/footer 20px when no Card density is specified, with content/footer top padding removed. className
can customize spacing while keeping [tokens](../../design-system/tokens.md).

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@zero/framework/components/ui/card';

export function Summary() {
  return <Card><CardHeader><CardTitle asChild><h2>Summary</h2></CardTitle></CardHeader>
    <CardContent>Application-owned content.</CardContent></Card>;
}
```

## Standard Card Parts

The original native composition remains supported; no content schema or dialog
is required. `CardProps` adds `asChild` for a suitable single root and optional
family density `compact | default | comfortable` (16/20/24px padding). These are
Card family variants, not a replacement for the application-wide density marker.
Native `title`, refs, event handlers and caller styles remain native.
The shared panel radius, typography, border and card surface follow Zero tokens.

| Part | Purpose |
| --- | --- |
| CardHeader / CardTitle / CardDescription | Heading and supporting copy. CardTitle remains a div unless `asChild` supplies a semantic heading. |
| CardAction | Independently interactive trailing controls; a header containing it reserves an action column. |
| CardMedia | Caller-owned image, video or visual, with a tokenized clipped media region; supply appropriate alt text. |
| CardContent / CardSection | Main body or a separated section; arbitrary children remain allowed. |
| CardFooter / CardByline | Footer layout and optional `avatar` with metadata/status. |
| CardMeta / CardStatus | Compact identity and short status. CardStatus takes string children, one polite announcement and `animate=true` changed-status rolls. |

These pieces can be used independently or omitted. `className`, native styles,
semantic heading children and local `--zero-card-*` aliases are deliberate escape
hatches; a styling part does not fetch data, authorize an action or infer loading.

## ContentCard And Managed Quick Look

`ContentCard` is the optional standardized article façade from
`@zero/framework/components/ui/content-card` or the React/root barrel. It follows
the [Arc Card reference](https://uiarc.dev/components/card), using Zero's tokens
and existing modal system rather than installing another dialog manager.

Required `title` is visible React content; `htmlTitle` is the separate native
HTML title attribute. Optional `description`, `media`, `avatar`, `meta`, `status`,
`action` and `children` fill the standard parts. Density defaults to compact.
Without `details`, it is an ordinary article. Custom actions stay separately
focusable and do not open details; only the title becomes the quick-look trigger.

```tsx
import { ModalManager } from '@zero/framework/modals';
import { ContentCard } from '@zero/framework/components/ui/content-card';

export function ProjectPreview() {
  return <ModalManager>
    <ContentCard title="Harbour redesign" description="New booking flow and room pages."
      meta="Design team" status="Updated 2 hours ago"
      action={<button type="button" onClick={() => { /* App-owned navigation/action. */ }}>View project</button>}
      details={<p>Scope, milestones and open questions.</p>} />
  </ModalManager>;
}
```

Mount **one existing ModalManager host** at the application boundary, not one per
card. The self-contained example shows that requirement; AppProvider consumers
reuse its already mounted host. AppShell alone does not supply that host.
`details` accepts a React node or
the ordinary `ModalBody` context callback. Its function can open a child through
`context.show`; the manager retains portal/layer, focus trap, dismissal, dirty
guards, responsive body scrolling and the standardized header/smaller X.

The article is the explicit geometric origin and focus returns to the title
button. Default motion is the established From Button/Rise fallback, with the
same reverse exit, dim/blur and page-recede policy; the card never adds a second
body lock, Escape listener or dialog stack. This is the managed surface morph,
not a promise of Arc's separate multi-element shared-layout implementation.

`open`/`onOpenChange` is controlled; `defaultOpen` initializes local state.
The manager admits user dismissal, including its unsaved-change guard, before
notifying `onOpenChange(false)`. A dismissed controlled card does not replay
while the owner still supplies `open=true`; a deliberate false→true cycle or
changed identity opens a new quick look. Changing `identity`, removing details
or unmounting retires the exact owned quick look.
Live body/status/header presentation updates do not reset the modal generation,
lose its draft/focus or dismiss child dialogs. `detailsTitle` supplies a meaningful
managed heading when the visible title is complex markup. `detailsOptions`
admits size/customSize/placement/height/scrollbar/initialFocus/motion/className
for the **next opening**, without replacing the manager's anatomy. Preview
children, actions, media and byline nodes are not automatically copied into
details: supply the deliberate `details` body so forms, IDs and action state
are not duplicated. Text/number description and metadata can label the managed
header; rich preview nodes are not implicitly instantiated a second time.

Mouse-only hover lifts 2px and media zooms to 1.04; touch/pen do not gain synthetic
hover. Card feedback/status uses canonical roles with local aliases, and reduced
motion removes lift, zoom and status travel. Persistence, async acknowledgment,
permissions, business validation and external destinations remain app-owned.
The existing [ExpandableCards gallery](../public-pages/collections.md#expandablecards)
has a separate legacy public-page contract and is not silently replaced.

## Related Guides And Next Steps

- [Badge, Avatar, Separator and Skeleton](../primitives/surfaces.md#badge) retain
  their separate identity and loading-state contracts.
- [List/detail layout](../primitives/list-detail.md) organizes these surfaces in
  control planes.
- [Modals](../../modals/index.md) owns quick-look layers, dismissal and focus.
- [Design system](../../design-system/index.md) owns reusable visual semantics.
- [Source organization](../source-organization.md) explains canonical family
  files, compatibility facades and source-copy boundaries.
