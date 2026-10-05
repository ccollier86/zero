---
id: zero.frontend.components.primitives.list-detail
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: list-detail-layout
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compact List, Details And Bottom Actions

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

ListDetailLayout, DetailPanel and RecordNavigationBar are the small composition
primitives behind dense control planes. Import the `/list-detail-layout`,
`/detail-panel` and `/record-navigation-bar` UI modules. The larger
[MasterDetailPage](../../data-controls/master-detail.md) adds source/selection/write
behavior; these layout primitives do not query or save on their own.

The additive workspace, visibility and resizing controls below describe the dirty
working source, not an already-qualified published 2.1.1 archive.

## ListDetailLayout

| Prop | Contract/default |
| --- | --- |
| list / detail | Required ReactNodes; one shared mounted tree for each region. |
| bottomBar | Optional sibling below the pane area, outside both scroll regions. |
| hasSelection | false; enables selected-record inspection on mobile. |
| mobileDetailOpen | Optional controlled mobile visibility. If omitted, selection opens detail and Back dismisses it internally. |
| onMobileBack | Optional request to return to the list. Required to operate Back when mobileDetailOpen is explicitly controlled. |
| mobileBackLabel | 'Back to list'; visible button and accessible name. |
| selectedKey | Changes the detail crossfade identity and reopens uncontrolled mobile detail for a new selection. |
| detailVisible | true; controls the desktop detail pane only. A hidden desktop inspector does not prevent mobile inspection. |
| resizable | false; enables the library's pointer/keyboard separator on desktop when detail is visible. |
| listWidth / detailWidth | '3fr' / '2fr'; CSS grid-track defaults, including fractions, minmax and length tracks. |
| className | Outer presentation classes; preserve the bounded height/minimum chain. |

Both panes scroll independently inside a bounded workspace. Long table rows,
detail forms and crossfade motion wrappers do not grow the outer page. The
bottom bar remains below the panes; it does not scroll away with either list or
detail content. Supply a constrained parent such as
[AppShell workspace mode](../../app-shell/configuration.md), or an explicitly
height-constrained flex/grid region with min-height and min-width zero. Merely
adding overflow to an unconstrained page does not establish this relationship.

Desktop resizing delegates to [Zero's Resizable composition](./resizable.md).
Before a user resize, CSS resolves the initial track widths at the current
available width: a 22rem detail track remains 22rem when the container grows.
After a user resize, the chosen relative layout is retained while this layout
instance remains mounted, including desktop hide/show and mobile/desktop
transitions. Changing listWidth/detailWidth resets that retained choice. It is
not automatically saved across remounts or browser sessions. Resizing keeps a
12rem list and 16rem detail minimum on desktop; hide the detail pane when the
screen should prioritize the full-width list instead of a split.

Below the md breakpoint, exactly one pane is shown: list, or selected detail
with Back. The same content nodes stay mounted, so changing viewport size or
desktop visibility does not duplicate form effects, IDs or unsaved fields. A
new selectedKey intentionally changes the crossfade subtree. In controlled
mobile mode, the caller must update mobileDetailOpen when onMobileBack fires;
an explicitly controlled open pane without that callback has a disabled Back
button instead of pretending it can change caller state. Focus restoration
prefers the previous connected visible list target, with a safe list fallback.

DetailPanelProps requires children, optionally header/footer/emptyState,
isEmpty=false and className. Header/footer remain outside the scroll body;
isEmpty displays an empty state instead of those normal regions. Default text
asks the user to select a record. Supply a bounded-height outer container so
scrolling and the bottom bar can work together.

## RecordNavigationBar

Required props: currentIndex (zero-based), totalCount, onPrevious and onNext.
Optional showNavigation=true, status, actions, secondaryPrimaryAction,
primaryAction and className. It displays
one-based current position (0 when empty), disables Previous at index<=0 and Next
at index>=totalCount-1. This is record navigation, not cursor/page pagination.
Use showNavigation=false plus status for an unselected management screen that
needs a useful row/scope count rather than '0 / 0'; action buttons remain usable.
Status has its own polite status region. Count props/callbacks remain required
for compatibility, even when record navigation is hidden.

Dense operational actions have a bounded horizontal strip. Keyboard focus can
scroll the targeted action into view without creating page-level horizontal
overflow. Primary workflows remain reachable below that strip on narrow
containers and alongside it when space allows; long primary labels truncate
visually while retaining their accessible text. The shortcut badge is hidden
in narrow containers, not used as a replacement for the visible action name.

NavigationAction requires icon, label and onClick; optionally disabled and
variant default|destructive|success|warning. Place compact operational commands
here, such as suspend, reset or archive, while role/property/information editing
belongs in the details region. RecordPrimaryAction requires label/onClick and
optionally sublabel, shortcut, disabled and ariaHasPopup. Displayed shortcuts do
not install hotkeys. Callbacks are immediate UI commands, not an async runner;
the app must supply pending/confirmation/error behavior or use a domain controller.

```tsx
import { useState } from 'react';
import { AppShell } from '@zero/framework/components/app-shell';
import { ListDetailLayout } from '@zero/framework/components/ui/list-detail-layout';
import { DetailPanel } from '@zero/framework/components/ui/detail-panel';
import { RecordNavigationBar } from '@zero/framework/components/ui/record-navigation-bar';

export function LocalWorkspace() {
  const [selected, setSelected] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  return <AppShell sidebar={false} contentMode="workspace" header={{ title: 'Records' }}>
    <ListDetailLayout resizable detailVisible={inspecting}
      listWidth="minmax(0, 1fr)" detailWidth="minmax(18rem, 22rem)"
      hasSelection={selected !== null} selectedKey={selected ?? undefined}
      mobileDetailOpen={mobileOpen} onMobileBack={() => setMobileOpen(false)}
      list={<button type="button" onClick={() => { setSelected('example'); setMobileOpen(true); }}>Select example</button>}
      detail={<DetailPanel isEmpty={selected === null} header={<h2>{selected}</h2>}>
        <p>Selected-record information belongs here.</p>
      </DetailPanel>}
      bottomBar={<RecordNavigationBar currentIndex={0} totalCount={1}
        onPrevious={() => {}} onNext={() => {}} showNavigation={false} status="1 record"
        primaryAction={{ label: inspecting ? 'Hide inspector' : 'Inspect',
          onClick: () => setInspecting(value => !value) }} />} />
  </AppShell>;
}
```

This is a local presentation example, not a production data/authority controller.
Use live capability-aware [Guardian](../../guardian/index.md), Data Studio or
Storage organisms for their complete mode/permission contracts.

## Related Guides And Next Steps

- [Master/detail](../../data-controls/master-detail.md) wires data and accepted writes.
- [Guardian control planes](../../guardian/index.md) manages user/organization authority.
- [Data Studio](../../data-studio/index.md) uses the same compact list/detail vocabulary.
- [Resizable panels](./resizable.md) exposes the reusable upstream-backed sizing primitive.
