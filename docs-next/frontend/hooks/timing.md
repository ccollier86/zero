---
id: zero.frontend.hooks.timing
type: reference
audience: [developer, agent]
owner: frontend-hooks
status: draft
visibility: internal
system: frontend-components
feature: generic-timing
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

# Debounce, Throttle, Timers And Idle State

[Hooks index](./index.md) · [Documentation index](../../index.md)

These helpers are local UI schedulers from @zero/framework/hooks/root/React.
They are not durable Scheduler jobs, KV rate limits or Torrent waits.
Browser event-loop/background-tab timing is not a security or deadline guarantee.

## Debounced Values And Callbacks

useDebouncedValue(value,delayMs) initially returns value, then updates after the
unchanged delay. delayMs<=0 bypasses delay. Effects clear their timer on replacement/
unmount; no transport or persistence is implicit.

useDebouncedCallback(callback,delayOrOptions) returns a void function with
flush/cancel/isPending. A number sets delay; object options are delay,
flushOnUnmount(default false), leading(default false) and optional maxWait.
Trailing mode retains latest arguments and restarts its delay; maxWait bounds
repeated postponement. Leading mode invokes the first call then ignores calls
within the delay window; it is not leading-plus-trailing mode.
flush executes pending work now; cancel discards it. Server/no-window or zero
delay paths call immediately when invoked. Do not invoke side effects during SSR.

```tsx
import { useDebouncedCallback } from '@zero/framework/hooks';

const searchLater = useDebouncedCallback(setSearch, 200);
```

This fragment assumes app setSearch inside React. It does not fetch unless that
callback does. flushOnUnmount deliberately executes a callback during cleanup;
avoid it for revoked tenant actions without explicit current-scope fences.

## Throttled Projection

useThrottledCallback(callback,waitMs,{ leading=true,trailing=true }={}) returns a
void function plus cancel/flush/isPending. It drops intermediate argument sets,
retaining the latest trailing call. Leading=false defers the initial immediate
invocation; trailing=false suppresses pending-window replay.
cancel removes pending timers/arguments; flush invokes retained trailing work.
No-window/zero delay calls execute immediately.

useThrottledValue(value,waitMs=500,options={}) uses that callback for value
projection. It initially returns value. Neither helper returns a persistence
receipt or a server-side concurrency limit.

## Timer And Idle Helpers

useInterval(callback,delayMs|null,{ immediate=false }={}) schedules browser
interval callbacks; null pauses. immediate invokes once on enabling.
useTimeout(callback,delayMs|null) schedules once; null disables.
Both use latest callback identity and clean subscriptions when dependencies change.

useIdle(timeoutMs=20000,{ events?,initialState=false,disabled=false }={}) returns
inactivity. Default events: mousemove/mousedown/keydown/touchstart/wheel/scroll/
pointerdown/visibilitychange. Activity resets the timer; hidden document marks idle,
and timeout<=0 immediately marks idle after mount. Listeners/timers retire on
cleanup. This is UI inactivity, not Guardian logout or server session expiry.

Pass finite sensible browser timer values and test replacement/unmount. These
helpers do not claim universal runtime validation/monotonic wall-clock admission
for every untyped timer input.

## Related Guides And Next Steps

- [State/actions](./state-and-actions.md) owns async result tracking.
- [Browser interactions](./browser-interactions.md) owns DOM events.
- [Form drafts](../state/form-drafts.md) provides an explicit persistence target.
- [Configuration](./configuration.md) distinguishes render-time options.
