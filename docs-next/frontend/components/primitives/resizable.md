---
id: zero.frontend.components.primitives.resizable
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: resizable-panels
maturity: supported
applies_to: ["2.1.1 dirty working source; additive API unpublished"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Resizable Panel Composition

[Primitive index](./index.md) · [List/detail layout](./list-detail.md) · [Documentation index](../../../index.md)

ResizablePanelGroup, ResizablePanel and ResizableHandle are thin Zero-styled
wrappers around the pinned react-resizable-panels 4.14.2 dependency. They follow
the established [shadcn Resizable composition](https://ui.shadcn.com/docs/components/radix/resizable),
using Zero's border, muted, ring and foreground tokens. The library owns drag,
keyboard interactions, size constraints and separator ARIA; this is not a
separate Zero resize algorithm.

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup }
  from '@zero/framework/components/ui/resizable';

export function SplitWorkspace() {
  return <div className="h-96 min-h-0 min-w-0">
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel defaultSize="60%" minSize="12rem">
        <div className="h-full min-h-0 overflow-auto p-4">List content</div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize list and details" />
      <ResizablePanel defaultSize="40%" minSize="16rem">
        <div className="h-full min-h-0 overflow-auto p-4">Detail content</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}
```

## Props, Size Units And Lifecycle

Group accepts the upstream GroupProps, Panel accepts PanelProps, and Handle
accepts SeparatorProps plus withHandle=false. Group defaults horizontal; use
orientation="vertical" for stacked resizing. Group/Panel/Handle className
decorates their styled presentation. Panel className belongs to its inner
content wrapper; elementRef identifies the outer library panel. Size styles
and layout mechanics remain owned by the library, not conflicting flex/grid
overrides.

Use explicit size units: "60%", "240px" or "16rem". Numeric values mean pixels
in this pinned version, not percentages. Panel exposes defaultSize, minSize,
maxSize, collapsible, collapsedSize, panelRef and onResize; Group exposes disabled,
groupRef, defaultLayout and onLayoutChanged. Panel and Handle must be direct DOM
children of Group. Constraint and imperative API details are defined by the
[upstream API](https://github.com/bvaughn/react-resizable-panels).

withHandle shows an existing icon in a small token-styled grip. Supply an
accessible separator label that identifies the panes. disabled controls input;
it is not an authorization decision. No settings, database, user session or
storage persistence are added by these wrappers. Group callbacks and any layout
persistence are caller-owned; a layout saved by an app must have stable panel
identities. Percentage-based server rendering can settle to measured browser
sizes during hydration; the wrapper is not a viewport-size oracle.

For ordinary list/inspector screens use [ListDetailLayout](./list-detail.md),
which handles mobile Back, desktop inspector visibility, CSS-track adaptation,
independent scroll regions and the bottom action bar. The low-level primitives
do not invent those product-specific transitions.

## Verification And Related Guides

Focused real Chromium fixtures exercise the compiled platform CSS, long content,
separator keyboard/pointer resizing and mobile transitions in the dirty source.
This does not qualify a published archive or an app's custom parent layout.

- [AppShell configuration](../../app-shell/configuration.md) establishes the bounded workspace chain.
- [MasterDetailPage](../../data-controls/master-detail.md) adds data, selection and accepted writes.
- [Scroll areas](./scroll-area.md) separates body scrolling from anchored chrome.
