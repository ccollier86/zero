---
id: zero.frontend.components.primitives.choices
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: choice-controls
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

# Select, Combobox, Checkbox And RadioGroup

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use the explicit UI subpaths for Select/Combobox. Checkbox and RadioGroup are
animated headless wrappers exported from the root/React barrels and
`@zero/framework/components/checkbox` and `/radio-group`.
They own choices, not permission grants or server validation.

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

## Combobox

ComboboxProps: options required; value string|string[] and onChange optional;
multiple=false, searchable=true, placeholder='Select...',
emptyMessage='No results found.', disabled=false; className and transition optional.
Each ComboboxOption has value/label, optionally icon/description/group/disabled.
Selection is parent-owned: omitting value is not an internal selected-value store.
Single selection toggles the same item to an empty string and closes the popover.
Multiple selection emits an updated array and keeps it open. Search filters the
provided command items; it is not a remote query/loading contract.

## Checkbox And RadioGroup

CheckboxProps extends the animated Radix contract: checked/defaultChecked,
onCheckedChange, disabled, required, name/value plus animation options. checked
supports boolean or indeterminate. Zero adds variant default|accent and size
default|sm|lg, with default/default styling. Treat indeterminate deliberately;
truthiness is not equivalent to selecting every record.

RadioGroup/RadioGroupItem wrap the corresponding headless primitives. Use
value/onValueChange or defaultValue, supply item values, labels, disabled and
orientation/loop where needed. They are not keyboard shortcut registries.
For row selection prefer [DataTable selection](../../data-controls/data-table/export-and-selection.md).

## Related Guides And Next Steps

- [Configuration](./configuration.md) explains inherited prop contracts.
- [Forms](../../forms/index.md) connects values to fields/validation.
- [Table controls](../../data-controls/data-table/controls.md) puts filters in shared slots.
