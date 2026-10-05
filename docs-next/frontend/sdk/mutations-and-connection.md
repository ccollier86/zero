---
id: zero.frontend.sdk.mutations-and-connection
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: mutations-and-connection
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Mutation Lifecycle And Connection Health

[SDK index](./index.md) · [Documentation index](../../index.md)

useMutation wraps an app-owned SDK action with pending/error/result state.
useConnectionHealth combines transport/auth/browser health for banners and
diagnostics. Neither authorizes operations or changes reconnect policy.

```tsx
import { useMutation } from '@zero/framework/react';

const publish = useMutation(async (id: string) => publishTask(id));
```

This fragment assumes an acknowledged app publishTask writer. Return/await its
promise so the hook can track completion. UseMutationOptions includes onSuccess,
onError, resetOnRun(default true), emitErrors(default true) and metadata.
The result has pending/error/result/run(...args):Promise<Result>/reset().

resetOnRun=true starts a new presentation generation; it does not cancel/rollback
the previous external operation. false retains deliberate concurrent operations
with pending state until admitted work settles. This hook is not table keyed
deduplication; use [table mutation runner](../data-controls/data-table/actions.md)
for duplicate-key/action/refresh behavior.

## Acceptance And Lifecycle

A writer's accepted result stays accepted even if onSuccess sync/async notification
fails. Pending waits for the notification to settle, but that failure neither invokes
the write-failure onError nor turns run into a retryable failed write.
Accepted notification errors emit safe standard frontend.mutation.failed metadata.
A throwing onError cannot mask the original writer rejection.

Retained run callbacks fail closed across scope replacement/unmount. Reset/current
generation fences suppress obsolete state/callback outcomes; unmount prevents late
callbacks. These are corrected development contracts with focused tests; public
callback signatures remain unchanged.

Ordinary writer failures reject run and expose error/onError for app handling.
Do not place secrets/raw rejected values in caller metadata or custom logs.
A UI abort/fence cannot undo accepted server side effects.

## Health Fields

useConnectionHealth returns connected/authenticated/authLoading/offline/
pendingMutations/lastSeq/healthy. offline reflects navigator.onLine, not a
guaranteed server reachability test. pendingMutations is the local Sync queue
count; lastSeq is its observed cursor, not a global Fabric/admin watermark.
healthy means connected and not authLoading; it does not imply no pending writes,
all services healthy or a current authenticated user in an authless app.

SSR exposes safe fallback observations and no socket. Use normal SDK lifecycle/
status; do not reconnect or bypass Guardian based solely on a health banner.

## Related Guides And Next Steps

- [Acknowledged mutations](./acknowledged-mutations.md) owns exact write receipts.
- [Client lifecycle](./client-lifecycle.md) owns connection/reconnect.
- [Data controls actions](../data-controls/data-table/actions.md) owns keyed operations.
- [Scope boundary](../runtime/authorization-scope-boundary.md) owns cache fences.
