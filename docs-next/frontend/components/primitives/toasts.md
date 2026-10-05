---
id: zero.frontend.components.primitives.toasts
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: toast-host
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

# Themed Toast Host

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Toaster and ToasterProps are exported from the root/React barrel and
`@zero/framework/components/ui/sonner`. toast is re-exported from Sonner through
the root/React barrel. Toaster owns visual integration, not a persistent inbox.

```tsx
import { Toaster, toast } from '@zero/framework/react';
import { Button } from '@zero/framework/components/ui/button';

export function ToastExample() {
  return <><Button type="button" onClick={() => toast.success('Example complete')}>Notify</Button>
    <Toaster /></>;
}
```

Mount one host for the relevant application region rather than one per row/form.
Use the existing runtime/theme composition. Explicit theme wins over the theme
provider; accepted values are light/dark/system. Source defaults: closeButton=true,
expand=false,gap=10,position='bottom-right',richColors=false,visibleToasts=4.
icons overrides the default status icons. toastOptions/classNames merge with Zero
styles so actions and error/success accents retain their semantic tokens.
Other props follow the installed Sonner contract.

A toast after a mutation should follow server acceptance, not an optimistic UI
update. Sanitize error content before showing it; toasts are not a logging sink,
error ledger or audit log. Dismissing a toast does not revoke a credential or
mark a durable notification read. Use [Notifications](../../notifications/index.md)
for the persisted inbox and its optional toast provider.

## Related Guides And Next Steps

- [Accepted actions](../../hooks/state-and-actions.md) separates callbacks from writes.
- [Frontend observability](../../observability.md) owns safe operational emission.
- [Notifications](../../notifications/index.md) owns durable notification state.
