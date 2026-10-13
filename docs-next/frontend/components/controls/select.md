---
id: zero.frontend.components.controls.select
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: select
maturity: supported
applies_to: ["2.6.0 working source; Morph Select upgrade unreleased"]
modes: [browser, SSR, native-form, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7ee11611534e6b88ed4041d561c102c8299591ec"
  snapshot: dirty
  date: "2026-10-13"
  evidence_level: source-observed
---

# Select

[Controls index](./index.md) · [Choice-control siblings](../primitives/choices.md) · [Canonical UI reference](../../ui-reference.md)

Select presents one choice through Zero's token-mapped trigger and morphing
menu. Radix owns the value, typeahead, keyboard interaction, form field and focus;
Zero supplies presentation and scoped overlay integration. Use the standard
composition below, then rich slots or native props where needed. Persistence,
permission checks and validation of submitted values remain with the caller.

This manual was extracted from the mixed choice-controls guide without changing
the public API or examples. Its dirty 2.6.0 source evidence is not a published
upgrade or a claim of complete browser qualification. The current implementation
lives in the [Select family](../../../../src/components/controls/select/index.ts);
application imports continue to use the supported public facade below, not that
private physical path.

## Select Family

```tsx
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@zero/framework/components/ui/select';

export function StatusChoice() {
  return (
    <Select defaultValue="active">
      <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="archived">Archived</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

Select is Radix Root; value/onValueChange controls it, defaultValue initializes
uncontrolled state. open/onOpenChange/defaultOpen/disabled/name/required follow
that root contract. SelectGroup, SelectLabel, SelectSeparator, SelectValue,
SelectScrollUpButton and SelectScrollDownButton complete the public family.
SelectContent portals its viewport and defaults position='popper'; its children
provide items. SelectItem requires a nonempty value and accepts disabled.
SelectTrigger is the focus/activation element. Do not place arbitrary option
labels into an API payload without validating the actual value on the server.

### Morph Presentation And Rich Options

The default surface now morphs from the actual trigger into a bounded list, with
one magnetic highlight following native pointer, keyboard and typeahead state.
The resting trigger uses the same popover material and quiet one-pixel border
as the expanded menu, not the stronger text-input boundary. Its picker-specific
radius defaults to 18px through `--zero-theme-picker-trigger-radius`; this does
not round every input or change the compact global control role. Local
`--zero-select-radius-trigger`, native `className`/`style` overrides, disabled and
invalid presentation remain available. Keyboard focus retains a distinct ring;
forced colors use an explicit system outline.
Radix still owns the value, form field, focus return, placement and collision
handling. The outer positioned element is not transformed by a second positioner.
`position="item-aligned"` remains supported; its native layout does not receive
the popper-only decorative trigger lid.

`SelectItemProps` adds `leading`, `description` and `trailing` presentation slots.
Only `children` supplies native ItemText, so descriptions, icons and metadata
do not become the selected label or submitted value. Description IDs are merged
with caller `aria-describedby`. Keep `textValue` explicit for unusual rich titles.
Trailing slots are noninteractive metadata, not nested controls inside an option.
Use [DenseList](../dense-list.md) for rows with separately interactive switches/actions.

```tsx
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem,
  SelectTrigger, SelectValue } from '@zero/framework/components/ui/select';

export function WorkspaceChoice() {
  return <Select name="workspace" defaultValue="design">
    <SelectTrigger aria-label="Workspace"><SelectValue placeholder="Choose workspace" /></SelectTrigger>
    <SelectContent scrollbars="hover" fadeEdges>
      <SelectGroup><SelectLabel>Workspaces</SelectLabel>
        <SelectItem value="design" leading={<span aria-hidden="true">DS</span>}
          description="Design system team" trailing="12 members">Design</SelectItem>
        <SelectItem value="engineering" description="Platform team">Engineering</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>;
}
```

`SelectContentProps` adds `viewportRef`, `fadeEdges=true` and
`scrollbars="hover" | "scroll" | "always" | "hidden"`. The ref reaches the **existing Radix
viewport**. Conditional content-only fades and rails use that same native
scroller; scroll buttons, focus and typeahead keep their original owner.
`hidden` hides the rail, not scrolling or the optional fades. No overflow means
no thumb. [ScrollArea](../primitives/scroll-area.md) documents the shared geometry.

The next-theme picker roles calibrate open 400ms/.12 bounce, close 340ms/0,
highlight 280ms/.08, width 420ms/.16, narrowing 420ms/0 and label return 300ms/.06.
These are physical-spring calibrations, not delayed interaction deadlines.
Local `--zero-select-motion-*`, `--zero-select-bounce-*`, radius and highlight
aliases remain overridable on the trigger/content boundary. Reduced motion
snaps geometry without delaying focus, selection or form updates.

Radix retires the live Select immediately on close. The visual shrink uses an
inert, aria-hidden, stripped paint copy, preserving its native scroll position;
it is not a second menu, form field or registered floating branch. Reopening,
unmounting, losing the trigger or deactivating its modal owner cancels that paint.
Closing paint retires when its visible edges have landed within half a viewport
pixel of the trigger, instead of lingering until imperceptible residual spring
velocity reaches zero. The picked-label return has its own subpixel handoff and
does not keep the surface alive. Close/narrow/label spring settings are unchanged;
there is no extra exit delay or timeout that truncates a still-visible shrink.
Use Combobox for search/multiple selection and Cascader for hierarchical choices;
do not add a search input or another selection controller inside Radix Select.

## Related Guides And Next Steps

- [Combobox and boolean choices](../primitives/choices.md) document sibling
  value/selection contracts; use Combobox for search or multiple selection.
- [Cascader](../cascader.md) owns hierarchical choices.
- [Configuration](../primitives/configuration.md) explains inherited props and
  supported imports.
- [Forms](../../forms/index.md) connects values to fields/validation.
- [Table controls](../../data-controls/data-table/controls.md) puts filters in
  shared slots.
- [Source organization](../source-organization.md) explains the canonical family,
  retained facade and source-copy compatibility boundaries.
