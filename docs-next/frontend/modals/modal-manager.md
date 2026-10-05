---
id: zero.frontend.modals.modal-manager
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: modal-manager
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

# Install One Modal Host

[Modals index](./index.md) · [Documentation index](../../index.md)

```tsx
import { ModalManager } from '@zero/framework/modals';

<ModalManager><Application /></ModalManager>;
```

This advanced fragment assumes an app component; normal AppProvider already
mounts ModalManager. Do not install another host inside every page.
ModalManagerProps has required children only, not separate env/service settings.

The host subscribes to a shared @xstate/store, renders a modal stack and removes
closing instances after their exit animation. Dialog semantics provide keyboard/
focus/overlay composition. Accessible titles use the supplied content/confirm
title or "Dialog"; supply meaningful titles for real tasks.

Modals are browser UI. Do not open them during server rendering or from trusted
server services; a process-global UI store is not request-local state.
Open promises require a mounted host and normal app lifecycle; this is not a
distributed dialog service.

Content owns its forms/buttons/sections; the host owns dialog close/size/animation.
Current close-button placement is the existing top-right host control, not a
new packaged header/body/footer manager. The [roadmap](./roadmap.md) records
planned section/layout evolution without pretending it is already implemented.

Scope replacement uses explicit discard through the managed runtime. See
[scope transitions](./scope-transitions.md); host ownership alone is not
authorization. Use server-checked domain operations after confirmation.

## Related Guides And Next Steps

- [Content](./content.md) opens actual instances.
- [Configuration](./configuration.md) owns dialog options.
- [Lifecycle](./lifecycle.md) owns close/animation/callback behavior.
- [AppProvider](../runtime/app-provider.md) owns normal mounting.
