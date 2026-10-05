---
id: zero.design-system.themes
type: how-to
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: themes
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

# Theme Persistence, Morph Icon And Circular Transition

[Design-system index](./index.md) · [Documentation index](../../index.md)

ThemeProvider wraps next-themes; ThemeTogglerButton renders the platform switch.
Selected theme can be system while resolved appearance is light or dark.
The morphing sun/moon icon reflects resolved appearance, not a fabricated third
visual theme.

Complete component example, to place inside your normal root runtime:

```tsx
import type { ReactNode } from "react";
import { ThemeProvider, ThemeTogglerButton } from "@zero/framework/react";

export function ThemedArea({ children }: { children: ReactNode }) {
  return <ThemeProvider defaultTheme="system" storageKey="example-theme">
    <header><ThemeTogglerButton modes={["light", "dark", "system"]} /></header>
    {children}
  </ThemeProvider>;
}
```

This is a UI composition example, not a complete app/startup config. The
provider owns browser persistence/system selection; server markup cannot know
all client theme state before hydration.

## Transition Behavior

Click cycles configured modes. Empty modes resets to light/dark/system.
The button computes origin from pointer coordinates or its center for keyboard
activation. When supported and motion permitted, browser View Transitions
animate a circular reveal plus the button snapshot; the morph icon is separate.
The circular duration is650ms in inspected source.

Unsupported APIs, reduced-motion preference or unchanged resolved appearance
commit theme without the circular animation. An active transition prevents
another overlapping transition; button is disabled/busy until settlement.
Direction controls a fallback origin when no concrete origin is supplied.
Caller onClick runs first; preventDefault stops the toggle.

Reduced-motion support here is this transition's contract, not a claim that
every animated platform primitive automatically disables motion.

## Configuration And Verification

[Configuration](./configuration.md#themeprovider) lists wrapper defaults and
inherited prop boundary. Validate keyboard labeling, actual theme classes,
refresh persistence and system changes in the target app/browser. No whole
cross-browser/accessibility qualification is implied by source inspection.

Use [semantic tokens](./tokens.md) instead of manually swapping per-screen
palettes; [icon animation](./icon-animation.md) explains ordinary icon triggers.
