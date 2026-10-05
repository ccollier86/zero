---
id: zero.frontend.overlays.dropdown-menu
type: how-to
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: dropdown-menu
maturity: supported
applies_to: ["2.1.1 source with audited interaction/token corrections; publication qualification pending"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose Dropdown Actions And Choices

[Overlays index](./index.md) · [Documentation index](../../../index.md)

DropdownMenu provides a local Radix menu with tokenized animated content.
Public symbols include Root-name DropdownMenu, Trigger, Content, Group, Item,
CheckboxItem, RadioGroup, RadioItem, Label, Separator, Shortcut, Sub, SubTrigger
and SubContent, with corresponding Props types.

Complete local-state example:

```tsx
import { useState } from "react";
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem,
  DropdownMenuCheckboxItem } from "@zero/framework/react";

export function RecordMenu({ archive }: { archive: () => void }) {
  const [showArchived, setShowArchived] = useState(false);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline">Actions</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>Record</DropdownMenuLabel>
      <DropdownMenuCheckboxItem checked={showArchived}
        onCheckedChange={value => setShowArchived(value === true)}>
        Show archived
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={archive}>Archive</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
```

Archive is an app-owned callback. For a real async mutation, manage pending/
confirmation through the owning action contract; selecting an item is not an
accepted-write receipt.

## State And Item Semantics

Root accepts controlled open/onOpenChange or defaultOpen for local state.
The styled content installs its portal/highlight internally, with sideOffset4
and available-height overflow behavior. Keyboard focus/dismissal belong to the
underlying Radix menu and forwarded callbacks. Do not wrap content in a second
private portal/context.

Group/Label/Separator organize actions. CheckboxItem supports checked/
onCheckedChange; RadioGroup value/onValueChange selects a RadioItem value.
Shortcut displays hint text only; it does not register a keyboard command.
Item variant is default/destructive; inset aligns labels. disabled prevents
selection/presentation but does not change backend permission.

Sub/SubTrigger/SubContent compose a submenu with independent controlled/default
open state. Subtrigger adds a chevron and supports inset/disabled. Content owns
Motion element, position/collision/focus callbacks and submenu portal.
Use explicit textValue where a custom icon-rich label requires text matching.

## Verification And Related Guides

Check keyboard traversal, focus return, checkbox/radio changes, disabled items
and outside/Escape dismissal in the target app. Provider/context mismatches are
render errors, not backend failures. [Configuration](./configuration.md) owns
exact imports/defaults; [popover](./popover.md) is a form-like alternative;
[table actions](../../data-controls/data-table/index.md) own async row/bulk behavior.
