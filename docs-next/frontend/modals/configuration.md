---
id: zero.frontend.modals.configuration
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: configuration
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Modal Configuration Reference

[Modals index](./index.md) · [Documentation index](../../index.md)

These are browser-time public contracts in the **unreleased structured upgrade**.
There are no modal environment bindings, permission tables or backend migrations.
Import the facade/types from `@zero/framework/modals` or the React/root facade.
All visual values come from the active Zero theme.

## Host Options

| ModalManagerProps | Default / behavior |
| --- | --- |
| `children` | Optional application content; safe page-recession surface wraps it |
| `motion` | Optional provider motion defaults; per-call settings override |
| `recedeSurface` | true; register an app-only surface outside portal hosts; false disables host-owned recession |
| `portalContainer` | document.body; optional app-owned, same-document, non-transformed HTMLElement outside the recession surface |

Normal AppProvider hosts dialogs. Nested managers inherit an existing host rather
than creating independent global stacks. A plain host with no useful app surface
still opens dialogs; missing page recession does not fail an open.

portalContainer does not enable iframe/cross-document rendering or ShadowRoot
styling. Cross-document containers are rejected; keep the portal host in the same
browser document as ModalManager and outside its page-recession surface.

## Descriptor

`ModalDescriptor<T>` requires a nonempty string `title`.
A content descriptor uses `layout:"content"` (default) and optional `body`.
A `tabs`/`nav` descriptor requires nonempty `sections`, forbids `body`, and
optionally accepts `initialSection` identifying a supplied panel.

| Option | Default / accepted values |
| --- | --- |
| `title` | Required visible title and accessible name |
| `meta`, `description`, `icon` | Optional React nodes; icon omitted means no empty leading tile |
| `tone` | default; default/info/success/danger |
| `size` | md; xs/sm/md/lg/xl/full |
| `customSize` | Optional width/maxWidth/height/maxHeight CSS values; viewport bounds remain |
| `placement` | center; center/left/right/bottom |
| `height` | auto for content, fixed for tabs/nav; auto/fixed |
| `scrollbar` | auto; auto/thin/hidden for content body |
| `navScrollbar` | auto; independent auto/thin/hidden for navigation |
| `dismissible` | true; false hides X and blocks advisory dismissal |
| `closeOnClickOutside`, `closeOnEscape` | true; individual dismissal paths can be disabled |
| `allowEditingWhilePending` | false; true deliberately permits newer drafts while actions remain locked |
| `guard` | true; tracked dirty state opens a discard decision if no explicit/bound close guard exists |
| `beforeClose` | Optional boolean/async admission receiving reason and AbortSignal |
| `footer.start` | Optional helper React node; current action error replaces it |
| `actions` | Optional ordered action list, secondary first / primary last |
| `headerActions` | Up to two labeled icon actions; each needs a unique id and callback |
| `motion` | Optional [validated motion profile](./motion.md) |
| `trigger` | Explicit initiating Element; absent/unusable origin safely uses Rise |
| `initialFocus` | auto; auto/cancel/primary or a selector inside the dialog |
| `role` | dialog; dialog/alertdialog |
| `className` | Managed customization without replacing naming/lifecycle/ownership |
| `dataSlot` | Optional stable component/test slot on the managed frame |
| `parentId` | Optional active parent; prefer context.show for ordinary children |
| `onClose` | Post-commit notification, never a veto or durable save receipt |
| `onCloseAutoFocus` | Optional exact-owner focus policy; preventDefault suppresses opener restoration |

Sizes use CSS tokens: xs320px (legacy-compatible extra size), sm420px, md560px,
lg760px, xl1000px, full available viewport. Fixed height is 640px; desktop gutter 32px,
body pad 20px and nav 212px. Theme overrides are centralized in
`--zero-modal-*` tokens. Legacy MODAL_SIZE_CLASSES remains a compatibility helper;
it is not the new shell's sizing authority.

`scrollbar:"hidden"` hides only the scrollbar. Body scroll, wheel/touch/keyboard
and focus visibility remain available; do not emulate it with overflow:hidden.

## Sections And Actions

A section requires unique nonempty `id`/`label` and `body`; optional `icon`,
`badge`, `group` configure presentation. Retain IDs while updating panels.

Each action requires unique nonempty `id`/`label`:

| ModalAction field | Behavior |
| --- | --- |
| `role:"cancel"` | Requests dismissal through the normal guard |
| `variant` | secondary(default)/primary/danger/ghost |
| `onClick(context)` | Optional supplied writer; awaited, generation-fenced, single-flight |
| `value` | Acceptance value for actions without a returned value |
| `closes` | true; false keeps modal open |
| `disabled` | false; context.setActionDisabled can update exact action UI |
| `submit` | false; native form submission rather than global Enter interception |
| `formId` | Explicit native form target; required when more than one active form exists |
| `holdToConfirm` | false; deliberate sustained confirmation |
| `holdDuration` | 1500ms; structured actions admit 250–60000ms finite values, unscaled by motion |

Header callbacks are awaited and locked but do not automatically accept the modal.
An action error is safe presentation; backend permissions, conditional writes,
idempotency and unknown-outcome reconciliation remain the writer's responsibility.

## Legacy Compatibility

`OpenModalOptions` still configures `open({content})`; `OpenConfirmOptions` still
configures the boolean confirm, including additive motion/trigger/icon/tone.
Legacy `from` is retained in types but does not
select a new Motion Lab preset; use structured `motion` when migrating.
`showCloseButton` belongs to legacy opaque content; structured X ownership is
`dismissible`. Private instance/store/resolver fields are not app mutation APIs.

## Related Guides And Next Steps

[Layouts](./layouts.md) shows composed shapes; [motion](./motion.md) explains pace;
[forms](./forms.md) owns accepted submission; [migration](./migration.md) maps old
calls without breaking their return-value or action semantics.
