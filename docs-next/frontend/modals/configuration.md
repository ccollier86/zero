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
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Modal Options And Exported Shapes

[Modals index](./index.md) · [Documentation index](../../index.md)

React/open-call inputs are browser-time configuration; there are no modal env
bindings, server tables or Doctor settings. Normal AppProvider mounts the host.

ModalSize is xs/sm/md/lg/xl/full. MODAL_SIZE_CLASSES gives viewport-bounded
widths20/24/32/40/48rem and full viewport minus2rem; content defaults md, confirms sm.
customSize.width overrides the preset; maxWidth/height/maxHeight/overflow are CSS
values. maxHeight defaults calc(100vh - 2rem), overflow auto.
ModalOverflow is auto/scroll/hidden/visible.

OpenModalOptions omits internal id/type/_resolve from ModalInstance; open requires
content. title supplies the accessible name. from defaults top and follows the
underlying dialog direction contract. showCloseButton/closeOnClickOutside/
closeOnEscape default true. className and onClose customize presentation/notification.

ConfirmModalOptions requires title and optionally description/confirmLabel/cancelLabel/
variant(default|destructive)/holdToConfirm/holdDuration. OpenConfirmOptions adds
size/customSize/from/className; it does not include every content dismissal prop.
Hold duration defaults1500ms and must be finite/positive.

ModalType includes content/confirm/context as a exported shape, but there is no
public modals.openContext method. ModalStoreState and ModalInstance are exported
types for integration; modalStore and _resolve are not public mutation/resolver
APIs. There is no public useModals hook. Do not reach into private files to invent one.

Generic ConfirmProvider/useConfirm uses its separate ConfirmOptions, not these
host sizing/hold options. See [generic confirmation](../hooks/confirmation.md).

## Related Guides And Next Steps

- [Content](./content.md) owns ordinary opening/updating.
- [Confirmation](./confirm.md) owns promise/options.
- [HoldButton](./hold-button.md) owns duration/cancellation.
- [Host](./modal-manager.md) owns mounting/rendering.
