---
id: zero.design-system.icon-animation
type: reference
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: icon-animation
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Icon Triggers, Context And Extension Helpers

[Design-system index](./index.md) · [Documentation index](../../index.md)

AnimateIcon supplies a shared Motion animation context. Named icons use
IconWrapper to consume it or create their own context when explicit triggers
are supplied. Root/react exports AnimateIcon and types; /icons additionally
exports IconWrapper, useAnimateIconContext, getVariants, pathClassName and
staticAnimations. These helpers are presentation APIs, not server services.

Complete grouped trigger example:

```tsx
import { AnimateIcon, Bell } from "@zero/framework/icons";

export function AttentionIcon() {
  return <AnimateIcon animateOnHover animateOnTap>
    <Bell size={20} aria-hidden="true" />
  </AnimateIcon>;
}
```

## Trigger And Completion Controls

Boolean triggers choose the configured animation; string triggers choose that
variant. Default named animation is default. animate is controlled onset,
animateOnHover follows hover, animateOnTap follows pointer interaction, and
animateOnView uses visibility with optional margin/once behavior.

loop repeats while active; loopDelay/delay are milliseconds.
Zero loop delay still schedules a timer turn so rendering/input are not starved
by an endless microtask chain. Stop/unmount retires delayed/loop tasks and
generation fences prevent old runs continuing as the current animation.

initialOnAnimateEnd resets after completion; completeOnStop can await an active
animation before resetting; persistOnAnimateEnd keeps the finished state when
stopping. In corrected development source, retention passes through root/nested
providers, explicit child false overrides parent true, and direct wrapped icons
forward reset/retention settings. Those omitted fields were defects in the
original baseline; default flags remain false.

## Helpers For Custom Icons

IconProps combines animation controls, SVG Motion props and optional size.
IconWrapperProps adds icon component. AnimateIconProps combines span Motion
props, children and asChild. Context includes controls, active/variant and
lifecycle settings; outside a provider, hook returns default/undefined values,
not an error.

getVariants is context-sensitive (it calls the context hook); use it during
component rendering. It selects a named variant, falls back to animations.default
for a missing variant, or maps path/path-loop static animations across paths.
pathClassName normalizes stroke dash styling for those variants.
No helper guarantees arbitrary custom SVG timing, accessibility or reduced
motion; verify the custom component deliberately.

## Verification And Related Guides

Focused context/loop/registry checks passed7tests/14assertions on dirty working
source using SSR probes/timers, not a production browser animation audit.
[Defaults](./configuration.md#animated-icons),
[names](./icons.md), [registry admission](./icon-registry.md) and
[component conventions](./component-conventions.md) complete the contract.
