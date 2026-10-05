---
id: zero.runtime.shutdown
type: operations
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: shutdown
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Drain Extensions Before Disposing Services

[Runtime index](./index.md) · [Documentation index](../../index.md)

Await `app.stop()` when stopping a managed app. The stop boundary first
quiesces the listener, then drains captured app extensions while Guardian/Fabric
services remain usable, disposes owned runtime services, and awaits remaining
plugin stop hooks.

This lets an extension record interrupted work using its live scoped services
before those providers disappear.

## Register An Awaited Drain

This *integration fragment* assumes an app-owned `runner` that implements
cooperative intake/abort/drain; these are its methods, not new Zero APIs:

```ts
import { defineZeroPlugin } from '@zero/framework/server';
import { runner } from '../../services/runner';

export default defineZeroPlugin({
  name: 'example.runner',
  setup({ app }) {
    return app.onStop(async () => {
      runner.stopIntake();
      runner.requestAbort();
      await runner.drain();
    });
  },
});
```

Returning the promise matters. A detached `void runner.drain()` can finish
after Guardian/Fabric disposal. Do not close shared framework databases in an
extension; drain only what that extension owns.

## Stop Ordering And Failure

The listener's accepted connections are stopped before drains. The managed
native transport path calls its force-close stop, so a long-lived request/socket
must not be your extension's drain mechanism. Background work needs an explicit
owned task registry and cooperative interruption.

Repeated/concurrent stops join the same active stop. Each captured drain and
cleanup is attempted once in the owned shutdown sequence; one rejected drain
does not skip later drains or provider teardown. Collected failures reject the
stop promise after cleanup rather than report a successful shutdown.

If listener closure itself cannot be established, teardown does not dispose
dependencies underneath a potentially live listener. Operationally, a stop
failure is a failed lifecycle operation, not permission to delete runtime data.

## Process Signals

Managed apps register with a process-shared SIGINT/SIGTERM dispatcher. It joins
all registered apps with all-settled behavior before exit: 0 when shutdown
succeeds, 1 when one or more stops fail. One app's rejection must not hide another
app's stop. A normally stopped app unregisters itself.

SIGKILL/crash cannot run these drains. Durable services still need their own
restart recovery/idempotency contract; a graceful stop hook is not crash-proof
persistence.

## Bun Socket Accounting Recovery

The internal barrier detects a narrow native stop stall: no pending HTTP
requests, a positive stale WebSocket count and an adapter supporting `unref`.
It reports `APP_LIFECYCLE_SLOW` and continues managed teardown after retiring
that transport. It does not broadly skip waits for live HTTP requests or unknown
adapters.

The default detection interval is 1,000 ms. This is an internal safeguard, not
an `AppConfig.shutdownTimeout` setting or a general task deadline. Extension
drain timeouts/cancellation are part of the extension's own bounded design.

## Verify The Full Boundary

In a disposable composed fixture:

- begin an operation, stop intake and await its interrupted-state write;
- assert Guardian/Fabric still work inside each extension drain;
- reject one drain and prove later drains and service disposal still happen;
- call stop concurrently/repeatedly and check exactly-once cleanup;
- close real Sync sockets and verify no late authorization/timer resurrection;
- exercise restart recovery independently of graceful shutdown.

The repository includes dedicated extension-shutdown, stop-barrier and signal
tests. Their presence is evidence of intended behavior, not a claim that a docs
reader's production deployment was tested.

## Related Guides And Next Steps

- [Plugins](./plugins.md) owns the extension setup/drain declaration.
- [Lifecycle](./lifecycle.md) owns construction failure and resource ownership.
- [Request services](./server-services.md) explains why a background drain needs the right captured authority.
- [Observability](./observability.md) describes lifecycle failure/slow events.
