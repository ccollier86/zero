---
id: zero.frontend.hooks.state-and-actions
type: reference
audience: [developer, agent]
owner: frontend-hooks
status: draft
visibility: internal
system: frontend-components
feature: generic-state-and-actions
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

# Local State And Async Action Helpers

[Hooks index](./index.md) · [Documentation index](../../index.md)

Import these generic helpers from @zero/framework/hooks or root/React. They own
local interaction state, not authenticated transport, persisted form data or
Guardian permission. Use [SDK mutations](../sdk/mutations-and-connection.md) for
scope-bound server commands.

## Accepted Async Actions

```tsx
import { useAsyncAction } from '@zero/framework/hooks';

const exportAction = useAsyncAction(async () => createReport());
```

This React fragment assumes caller-owned createReport returning its actual
completion. Result is pending/error/result/run(...args):Promise<Result>/reset().
Options onSuccess/onError/resetOnRun(default true) configure local feedback.
The helper does not deduplicate calls or cancel external side effects.

The corrected hook separates accepted results from notification failures:
onSuccess sync/async rejection cannot reject an already accepted action or call
its write-failure onError. It awaits that notification before retiring pending.
A failing onError cannot mask the original action rejection.
Caught notification failures emit standard frontend.mutation.failed with safe
surface/stage metadata, not callback/error payloads.

reset retires presentation generations and pending bookkeeping, not running
external work. Default resetOnRun protects the newest UI from old completions.
false deliberately tracks concurrent admitted actions until the group settles.
Unmount suppresses late state/notifications and rejects retained new runs before
executing their action. An already running accepted action still owns its original
promise outcome; no UI teardown is described as server rollback.

## Controlled And Disclosed State

useControlledState({ value?, defaultValue?, onChange? }) returns readonly
[value,setValue]. The setter accepts a new value plus declared trailing callback
arguments. A supplied value remains parent-authoritative until the parent changes
it; requests call onChange, not overwrite controlled presentation. Without value,
defaultValue initializes local state. No persistence or domain validation exists.

useDisclosure({ open?, defaultOpen=false, onOpenChange? }={}) returns
isOpen/setOpen/open/close/toggle. Controlled open requires the parent to accept
changes; uncontrolled state updates locally. Unlike a modal host, this hook
does not render, confirm, trap focus or enforce permissions.

## Render And DOM State

usePrevious(value) returns the previous committed value or undefined initially.
useMounted() is false in SSR/first render and true after mount.
It is a display hint, not a retained-callback lifetime cancellation token.

useStableCallback(callback) keeps a stable identity and calls the latest committed
callback. It does not schedule/await/cancel work. Do not wrap an intentionally
scope-captured callback to make an old authorized closure call a new-scope action.

useDataState(key,forwardedRef?,onChange?) returns [parsedValue,localRef] for
data-<key>. Attach the ref. MutationObserver watches that attribute.
Absent becomes null, empty/"true" true, "false" false, other text remains string.
The corrected SSR snapshot is stable null; browser refs/observers remain local.
onChange observes value changes, not database commits.

## Verification And Upgrade

Focused null-rendered React/SSR tests cover accepted notifications, concurrent/
reset/unmount, controlled parent authority and SSR data snapshots. They are not
full browser/style/package qualification. Callback signatures remain compatible;
the corrected controlled value and acceptance semantics are intentional fixes.

## Related Guides And Next Steps

- [Timing](./timing.md) owns delayed callbacks, not accepted actions.
- [Browser interactions](./browser-interactions.md) owns refs/events.
- [SDK mutations](../sdk/mutations-and-connection.md) owns scoped commands.
- [Configuration](./configuration.md) owns generic composition/read times.
