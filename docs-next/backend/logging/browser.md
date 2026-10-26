---
id: zero.logging.browser
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: browser-activity
maturity: supported
applies_to: ["2.6.0 builds with managed compliance logging and native live audit tables"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "74264b034eba6c32975cc7822a21da18e682f41f"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: implementation-verified
---

# Browser Activity and Required Delivery

[Logging index](./index.md) · [Documentation index](../../index.md)

The existing AppProvider mounts one collector per authenticated scope when the
managed server enables logging. The provider fetches server-owned policy, pins
the observation writer to that exact auth generation, and tears it down on
logout, scope replacement or authority invalidation. Do not mount a second
collector inside every component.

## Signals and View Bindings

```tsx
import { useLoggingActivity, useLoggingView } from '@zero/framework/react';

function DocumentView({ documentId }: { documentId: string }) {
  useLoggingView({ type: 'document', id: documentId });
  const { action } = useLoggingActivity();

  async function copySummary() {
    try {
      await copyAuthorizedSummary();
      action('clipboard.copy.completed');
    } catch {
      action('clipboard.copy.failed');
    }
  }

  return <button onClick={copySummary}>Copy summary</button>;
}
```

This fragment deliberately leaves domain authorization/content generation to
the application. The hook never reads clipboard text. Bind one active page or
document target using opaque IDs; do not pass raw URLs or clinical labels.

Supported observations are view opened/interval/closed, clipboard copy observed/
completed/failed, print requested/dialog closed and navigation changed.
A DOM copy signal does not prove an OS clipboard operation succeeded. A print
dialog closing can mean cancellation; no event claims physical printing.

Viewing intervals distinguish elapsed, visible and active milliseconds. Visibility
requires document visibility and focus; activity uses interaction timestamps with
a 60-second idle cutoff. Key values, pointer coordinates and form contents are
not recorded. The heartbeat is 30 seconds. Each interval is bounded to 60 seconds;
suspension/truncation is marked incomplete. Sleep and hidden time are not
fabricated as attention. Multiple tabs are independent observations, not summed
proof of unique human attention.

The collector notices navigation without storing its raw URL, and explicit
view bindings provide the meaningful target. A pagehide tail is best effort;
there is no guaranteed unload delivery. There is no persistent browser spool
or localStorage copy of sensitive activity.

## Bounds and Failure Behavior

Buffers hold at most 128 observations and send at most 32 per batch. Server
admission is limited to 240 observations per minute per session/scope, with
bounded principal tracking. A batch is fully validated before any event append.
Partial persistence followed by failure is retried with the same identities.
View sequence identity is canonicalized on the server so changing a client
event ID cannot double-count that interval.

Browser timestamps must be within five minutes of server admission. Observations
older than that window are discarded by the client with a drop count rather
than blocking all future batches forever. Offline/blocked delivery remains
observable through `diagnostics()` (`queued`, `dropped`, `failed`,
`stopped`). The ordinary preview collector is best effort; it does not
silently claim full compliance coverage.

Headless integrations can call
`createLoggingCollector(client.logging, policy, options)`. Stop it exactly
once for its owning scope. `client.logging.observe()` is the write-only browser
API; it cannot claim server/provider confirmation or select actor/tenant identity.

## Strict Compliance Delivery Requirement

The strict profile fails closed for protected work if required audit delivery
cannot be acknowledged. This is authenticated delivery admission, not proof
that a browser or extension reported every real-world action.

This requirement belongs only to the explicit highest/compliance profile.
`basic`, `activity` and `detailed` do not block protected work because optional
browser uploads fail, even when view/copy/print capture is enabled. They retain
honest queue/drop/failure reporting. Required server-side evidence is a separate
admission rule, not an optional browser-health test.

The managed enforcement path is:

1. Verify an authenticated same-origin delivery acknowledgment, bound to the
   current session, tenant, policy version and short server expiry.
2. Gate protected UI, SSR/loader release, HTTP/machine operations and Sync/data
   subscriptions consistently. A dismissible browser warning is insufficient.
3. Keep auth, recovery, health and the audit handshake reachable so a blocked
   session can recover without a deadlock.
4. If delivery stops, pause protected work and show a specific retry screen:
   required audit delivery is unavailable; check blocking extensions, relevant
   site settings, connectivity and service status.
5. Resume only after the server validates fresh delivery and current authority.
   Record the interruption/recovery without inventing activity during the gap.

`AppProvider` reads the server's logging policy and mounts delivery recovery
outside the protected data-readiness guard. A committed sign-in/scope switch
can perform the fixed **empty, same-origin HttpOnly-cookie handshake** while
Sync waits for its grant. This path accepts no uploaded event content, requires
the exact Origin and current policy, and does not enable cookie authentication
for general APIs. The browser collector then uses the normal authenticated
SDK. This avoids making audit recovery wait on the protected Sync baseline that
it must itself unlock. Existing authorization and modal/data scope guards stay
in place.

The server grant expires after 60 seconds; the collector renews every 30 seconds.
Session/scope/role/property changes, worker/source failure or invalidation retire
the old grant. Protected streams revalidate at each released chunk; an in-flight
request cannot keep releasing data just because its initial handshake passed.

Do not claim to enumerate extensions or identify the exact blocker. An offline
network, proxy, permission restriction and server outage can look alike.
Ask users to disable the blocking extension for the application or correct a
relevant setting; do not demand unrelated permissions or blanket disabling of
browser protections. Ordinary event observation needs no clipboard-read,
camera, microphone or operating-system surveillance permission.

A delivery handshake cannot prove a browser is uncompromised or that every
client event listener ran. Required server-side access/release evidence remains
necessary even when a client reports a healthy channel. Browser observations
supplement it. Neither passing this check nor selecting a preset is legal
certification.

## Related Guides and Next Steps

- [Capture coverage](./events-and-coverage.md) separates automatic and declared evidence.
- [Server APIs](./api.md) describes `read()`, `run()` and authenticated SSE.
- [Roadmap](./roadmap.md) distinguishes additional UI/deployment work and
  deferred backup features from implemented strict admission.
- [Workspace](../../frontend/components/logging.md) describes connection and scope masking.
