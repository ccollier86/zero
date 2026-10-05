---
id: zero.frontend.overlays.radial-menu
type: reference
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: radial-menu
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Radial Context-Menu Selection

[Overlays index](./index.md) · [Documentation index](../../../index.md)

RadialMenu is a ring-shaped context menu, exported from root/react and
/components/radial-menu with RadialMenuProps/RadialMenuItem. It uses Base UI
context-menu semantics plus animated SVG wedges; it is distinct from DropdownMenu.

Complete presentational callback example:

```tsx
import { RadialMenu } from "@zero/framework/react";
import { Copy, Trash } from "@zero/framework/icons";

export function RadialActions({ choose }: { choose: (id: number) => void }) {
  return <RadialMenu menuItems={[
    { id: 1, label: "Copy", icon: Copy },
    { id: 2, label: "Remove", icon: Trash },
  ]} onSelect={item => choose(item.id)}>
    <section className="rounded-lg border border-border p-6">Open the context menu here.</section>
  </RadialMenu>;
}
```

Each item has numeric id, label and React icon component accepting className/
size/style. Use unique stable IDs and a sensible nonempty action set. Geometry
props size/iconSize/bandWidth/innerGap/outerGap/outerRingWidth default
240/18/50/8/8/12. Avoid negative or impossible geometry in app declarations;
there is no public runtime geometry-policy validator.

## Interaction And Ownership

Children become the context trigger area; omitted children show a default
right-click placeholder. Root owns open and activeIndex locally; no public
controlled-open prop exists. Hover/focus selects a wedge; selection invokes
onSelect(item), and icons animate with active state. Callback is not awaited,
confirmed or retried by the menu.

Existing SVG skin uses neutral light/dark utilities rather than exposing a
general semantic palette/className API. Do not promise arbitrary deep styling
through props that are absent. Use ordinary DropdownMenu for standard dense
administration actions and explicit accessible/confirmation needs.

The menu does not create a global action registry, keyboard shortcut bindings
or permission enforcement. App handlers own actual side effects; deletion must
still use deliberate confirmation/server authority.

## Verification And Related Guides

Verify pointer, keyboard/context invocation, focus, item labels, clipping and
target device behavior before adopting it for essential controls. Source
inspection is not touch/screen-reader qualification.
[DropdownMenu](./dropdown-menu.md), [modals](../../modals/index.md),
[configuration](./configuration.md) and [icons](../../design-system/icons.md)
cover ordinary alternatives.
