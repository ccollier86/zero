---
id: zero.frontend.components.controls.index
type: index
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: input-controls
maturity: supported
applies_to: ["2.6.0 working source; canonical Select/FloatingButtonGroup manuals and existing control-family routes"]
modes: [browser, SSR, native-form, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Input And Choice Controls

[Component index](../index.md) · [Canonical UI reference](../../ui-reference.md) · [Forms](../../forms/index.md)

Controls own local input and selection behavior. They do not grant permission,
commit an application record or install another data/session provider. Start
with the public family facade and standard composition; use a specialized
field only when its value and interaction contract match the task.

This directory is a canonical documentation home, not a new wildcard package
API. Select and FloatingButtonGroup have full manuals here. Other families below retain
their existing manuals until their documentation moves are qualified; no
implementation or public import changes are implied by this index.

## Choose The Control

| Task | Public composition and full manual | Boundary |
| --- | --- | --- |
| Single choice without search | [Select](./select.md): Root, trigger/value, content and option parts. | Native single-value/typeahead/form ownership with token-mapped morph presentation and rich noninteractive option slots. |
| Searchable or multiple local choices | [Combobox](../primitives/choices.md#combobox). | Controlled single/multiple values and local Command filtering; caller owns any remote query. |
| Hierarchical choice | [Cascader](../cascader.md). | Tree/path controller rather than another selection controller inside Select. |
| Independent, exclusive or on/off choices | [Checkbox/RadioGroup](../primitives/choices.md#checkbox-and-radiogroup), [Switch](../primitives/choices.md#switch-unreleased-public-facade-addition). | Distinguish indeterminate checkbox state, exclusive radio values and boolean switches. |
| Ordinary text or native numeric input | [Input/Textarea/Label](../primitives/inputs.md#input-textarea-and-label). | Native props, accessible labels and form ownership; no service persistence inferred. |
| Country-aware phone number | [PhoneInput](../phone-input.md). | Existing complete phone metadata, E.164 drafts, possible/valid checks and native form semantics; validation is not ownership proof. |
| Calendar, date range or time | [Dates and time](../primitives/dates-and-time.md). | Use the documented value/timezone policy, not a hand-built popup with another date owner. |
| Controlled tags | [TagInput](../primitives/tags-and-validation.md). | Existing controlled list and caller-supplied suggestions; the separately planned Arc refresh is not yet an API migration. |
| Revision-aware text edit | [InlineEditText](../primitives/inline-editing.md). | Accepted writes, expected revisions, conflict handling and separate blur/explicit modes. |
| Group joined actions or persistent choices | [ButtonGroup and ButtonGroupToggle](../primitives/button-group.md). | Existing joined/separated composition and distinct single/multiple selection controller; neither is replaced by a floating tray. |
| Present a compact magnetic action tray | [FloatingButtonGroup](./floating-button-group.md). | Additive working-source native commands, stationary targets, magnetic/press feedback and reserved labels. Tooltip/placement and accepted writes retain separate owners. |

## Composition And Shared Presentation

Use the [main UI reference](../../ui-reference.md) for canonical typography,
tokens, motion/action mapping and protected family defaults. Focused manuals
own exact props, value shapes and lifecycle requirements. Do not derive a new
public API from a source folder or a similarly named reference component.

For menus and pickers, reuse the existing [Popover](../overlays/popover.md),
[Command](../primitives/command.md) and
[ScrollArea](../primitives/scroll-area.md) only where the owning family's
composition calls for them. Select already owns its Radix viewport; adding a
nested ScrollArea or positioner would create a competing scroll/layout owner.
A magnetic highlight follows native active-option state rather than replacing
keyboard selection.

Descriptions, icons/avatars, group labels, dividers and trailing metadata are
presentation. Keep separately interactive buttons/switches out of a Select
option; use [DenseList](../dense-list.md) or another documented row composition
for independent actions. Decorative layers cannot become duplicate controls,
focus targets or submitted form fields.

## Forms, Migration And Implementation Ownership

Local change callbacks report input intent. Saving and error/pending handling
follow the application's [form workflow](../../forms/index.md) and existing
SDK/accepted-write contracts. Disabled/read-only styling is not a server
permission policy, and display labels are not authorization credentials.

The [source-organization guide](../source-organization.md) identifies canonical
owners, compatibility facades and source-copy behavior. Reusable public parts
belong in the family's full manual; private paint/geometry/state helpers remain
implementation details documented with their parent. New files must not
silently widen package wildcards or overwrite customized app copies.

The [input-modernization plan](../../../_work/arc-input-modernization-plan.md)
records requested TagInput, PhoneInput, MentionInput and InlineEdit treatment
and migration gates. It is documentation-only planned work, not a claim that
MentionInput or the new phone/tag options are currently exported.
