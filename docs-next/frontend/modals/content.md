---
id: zero.frontend.modals.content
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: content
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

# Open And Update Content Modals

[Modals index](./index.md) · [Documentation index](../../index.md)

```tsx
import { modals } from '@zero/framework/react';

const modalId = modals.open({
  title: 'Edit task',
  content: <TaskEditor />,
  size: 'lg',
});
```

This browser event fragment assumes TaskEditor and the mounted host.
open(options & { content }) returns a string instance ID.
Use modals.close(modalId) or update(modalId,partialOptions) for that exact instance.
Do not closeLast after an asynchronous task if a newer unrelated modal may have
opened; a retained ID keeps ownership explicit.

OpenModalOptions supports content/title/size/customSize/from/showCloseButton/
closeOnClickOutside/closeOnEscape/className/onClose. Content is caller ReactNode;
ordinary size defaults md, direction top and dismissal controls enabled.
Details are in [configuration](./configuration.md).

The modal does not save forms or await arbitrary app actions. Generated CRUD
composes accepted writers explicitly; custom editors must await their actual
server receipt before announcing success/closing. A modal title/content is
browser-admitted data; do not render credentials or raw provider error text by
default.

onClose is a notification after committed dismissal, not a veto. A throwing/
rejected notification cannot prevent closing or strand other confirms. Safe
frontend.modal_callback.failed records only surface/stage, not modal IDs or
callback payloads. [Lifecycle](./lifecycle.md) owns those corrected semantics.

## Related Guides And Next Steps

- [Lifecycle](./lifecycle.md) owns IDs, exit state and callbacks.
- [Forms](../forms/index.md) owns accepted editor submission.
- [Configuration](./configuration.md) owns sizing/dismissal options.
- [Scope transitions](./scope-transitions.md) owns stale-content discard.
