---
id: zero.frontend.hooks.browser-interactions
type: reference
audience: [developer, agent]
owner: frontend-hooks
status: draft
visibility: internal
system: frontend-components
feature: generic-browser-interactions
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

# DOM, Clipboard, Responsive And Platform Hooks

[Hooks index](./index.md) · [Documentation index](../../index.md)

Generic browser hooks come from @zero/framework/hooks/root/React.
They provide presentation/event primitives, not identity, permissions or server
routing. Use real feature detection for capabilities, not an OS name.

## DOM And Keyboard

useClickAway(handler,{ events?,enabled=true,document? }={}) returns an element ref.
Attach it to the inside region. Default document events mousedown/touchstart run
in capture phase and call the handler only for outside DOM targets.
An explicit document overrides the ambient one; null falls back, so use
enabled=false to disable. Subscription starts after mount and cleans up.

useHotkey(combo,handler,{ scope?,preventDefault=true,enabled=true }={}) registers
keydown. Format includes mod+k/ctrl+shift+s/alt+n/escape, with mod=MacCmd or otherCtrl.
scope ref binds to its current element or falls back to document. Global shortcuts
avoid ordinary input/textarea/select typing except Escape/mod combinations.
It tests requested modifiers; do not assume all unspecified modifier combinations
are excluded. It invokes caller commands, not permissions or an action runner.

useTextSelection() returns noncollapsed Selection or null and tracks selectionchange/
mouseup/keyup, including mutation of the same Selection object. It does not edit
or transmit selected text. Do not log private page selections.

## Clipboard

useCopyToClipboard({ timeoutMs=2000 }={}) returns copied/value/error/copy/reset.
copy(text):Promise<boolean> prefers navigator.clipboard.writeText, then the existing
hidden-textarea copy fallback. Failure returns false with Error state, not a throw.
timeoutMs0 preserves copied status until reset; cleanup clears the pending timer.
Copy only values already authorized into the browser and deliberately requested
by the user. Clipboard support/context can fail; UI must reflect that outcome.

## Responsive And OS Signals

useMediaQuery(query,{ defaultValue=false,initializeWithValue=false }={}) returns a
match boolean. Default avoids first-render hydration drift; true opts into immediate
browser reading. Effect subscribes to matchMedia changes.
useIsMobile() uses max-width767px, not physical device detection.

getOS({ userAgent?,platform?,maxTouchPoints? }={}) is a pure classifier with
undetermined/macos/ios/windows/android/linux/chromeos. Empty input is undetermined.
useOs({ getValueInEffect=true }={}) reads actual navigator after mount; false opts
into client-first accuracy. It recognizes iPad-style Mac+touch hints.
These are UI hints, not trusted device authentication.

## Measurement And Motion

useAutoHeight(deps=[],options={ includeParentBox:true,includeSelfBox:false }) returns
{ ref,height }. Attach ref; it measures bounding geometry and explicit box additions,
rounds for device pixel ratio and watches ResizeObserver. Providing an options
object does not imply every omitted boolean receives the default object's values.
Dependency/observer lifecycle controls remeasurement; it does not animate/render.

useIsInView(forwardedRef,{ inView?,inViewOnce=false,inViewMargin='0px' }={}) returns
{ ref,isInView }. inView=true enables observed visibility; omission/false bypasses
that gate and treats content as visible. It is not a controlled visibility value.

useMotionValueState(motionValue) subscribes to changes and returns its current
numeric value, including a server snapshot from the supplied MotionValue.
Caller owns the MotionValue/animation; it is not reactive database state.

## Verification

Test actual element/ref lifetimes, keyboard/input scope, clipboard success/failure,
SSR defaults, breakpoint changes and reduced-motion/visibility as appropriate.
Not every helper has a full browser/a11y fixture; source-backed documentation is
not that qualification. None silently mounts transport or exposes server authority.

## Related Guides And Next Steps

- [State/actions](./state-and-actions.md) owns local action lifecycle.
- [Timing](./timing.md) owns event-rate projection.
- [Configuration](./configuration.md) owns SSR/provider distinctions.
- [Low-level Sync](../sdk/low-level-sync.md) is unrelated server data reactivity.
