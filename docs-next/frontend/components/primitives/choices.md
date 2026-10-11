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
applies_to: ["2.6.0 working source; Morph Select upgrade unreleased"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Select, Combobox, Checkbox And RadioGroup

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use the [canonical Select manual](../controls/select.md) and the explicit UI
subpaths for Select/Combobox. Checkbox and RadioGroup are
animated headless wrappers exported from the root/React barrels and
`@zero/framework/components/checkbox` and `/radio-group`.
They own choices, not permission grants or server validation.

## Select Family

The complete [Select manual](../controls/select.md#select-family) now lives
with the [Controls overview](../controls/index.md). It owns the public facade,
Radix value/form contract and standard composition; this old anchor remains a
route for existing links, not a second copy of the API or examples.

### Morph Presentation And Rich Options

See [Select's morph and rich-option contract](../controls/select.md#morph-presentation-and-rich-options)
for slots, native viewport scrolling, magnetic highlighting, motion and inert
close-paint retirement. These presentation features do not replace Radix's
selection, focus, typeahead or form controller.

## Combobox

ComboboxProps: options required; value string|string[] and onChange optional;
multiple=false, searchable=true, placeholder='Select...',
emptyMessage='No results found.', disabled=false; className and transition optional.
Each ComboboxOption has value/label, optionally icon/description/group/disabled.
Selection is parent-owned: omitting value is not an internal selected-value store.
Single selection toggles the same item to an empty string and closes the popover.
Multiple selection emits an updated array and keeps it open. Search filters the
provided command items; it is not a remote query/loading contract.

Its existing Popover now uses the shared restrained anchored entrance/exit.
Its CommandList supplies magnetic handoff and shared overflow treatment;
filtering, toggling and selection behavior above are unchanged. The same list
integration reaches Cascader without replacing its tree controller.

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

## Switch (Unreleased Public Facade Addition)

Switch is available from root/React and @zero/framework/components/ui/switch.
It reuses the existing animated Radix switch and its shared styling rather than
creating another boolean state controller. Use checked/onCheckedChange or
defaultChecked, give it an accessible label, and supply disabled/name/required
when appropriate. Checkbox indeterminate state is not a Switch state.

Additional presentation props are pressedWidth (default 19), startIcon, endIcon
and thumbIcon (React elements). Change/pending/error persistence remains with
the caller. [DenseList](../dense-list.md) supplies safe settings rows without
an outer button around the switch; [SettingsMatrix](../settings-matrix.md)
supplies multiple controlled choice columns.

## Related Guides And Next Steps

- [Configuration](./configuration.md) explains inherited prop contracts.
- [Forms](../../forms/index.md) connects values to fields/validation.
- [Table controls](../../data-controls/data-table/controls.md) puts filters in shared slots.
