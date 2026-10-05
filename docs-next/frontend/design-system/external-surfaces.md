---
id: zero.design-system.external-surfaces
type: reference
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: external-surfaces
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Toast, Sticky Scrolling And Attribution

[Design-system index](./index.md) · [Documentation index](../../index.md)

Zero exposes some dependency APIs rather than redefining them. They remain
presentation helpers, not authenticated service transports.

## Toast Feedback

Root/react exports Sonner toast and Zero's tokenized Toaster/ToasterProps.
Mount Toaster under ThemeProvider before using toast. Wrapper defaults:
closeButton=true, expand=false, gap=10, position=bottom-right, richColors=false,
visibleToasts=4; caller props/icons/toastOptions can customize the host.
Theme defaults to provider choice (or system) unless supplied.

Complete host/action example:

```tsx
import { Button, ThemeProvider, Toaster, toast } from "@zero/framework/react";

export function FeedbackExample() {
  return <ThemeProvider>
    <Button onClick={() => toast.success("Ready")}>Show feedback</Button>
    <Toaster />
  </ThemeProvider>;
}
```

For real writes, notify only after accepted mutation; this example is
presentation-only. Backend errors/private payloads do not belong in toast text.

## Stick-To-Bottom Reexports

StickToBottom/useStickToBottom/useStickToBottomContext plus the dependency's
Animation/GetTargetScrollTop/ScrollElements/ScrollToBottom/ScrollToBottomOptions/
SpringAnimation/StickToBottomContext/StickToBottomInstance/StickToBottomOptions/
StickToBottomProps/StickToBottomState/StopScroll types are public reexports.
They handle scroll behavior; they do not stream AI output, open Sync or persist
chat messages. Use the exact installed dependency type/API rather than inventing
Zero-specific transport guarantees.

## Notices And Ownership

Adapted StreamingText/SecretField portions carry repository third-party notices.
Motion, next-themes, Sonner, Radix and scroll helpers retain their own dependency
license/contracts. Source copying must preserve applicable notices. New docs
do not relicense upstream material or transplant third-party manuals.

[Component guides](../data-controls/index.md) own concrete control behavior,
[themes](./themes.md) owns selection and [tokens](./tokens.md) owns presentation.
