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
applies_to: ["2.7.0 activity auditing replacement; verify the qualified release commit"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.7.0"
  commit: "d702d72c09e94eb95eb65cc270dad2aa8ab5c2ac"
  snapshot: clean
  date: "2026-10-29"
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

The managed collector records a page only when generated route content actually
commits beneath its readiness gates. A server catalog maps its registered static
pattern to an opaque page ID and label. Canceled/loading routes are not completed
page visits; actual dynamic path values, queries and fragments are not retained.
The managed collector disables generic page-duration heartbeats. A standalone
headless collector can opt into history observation; that remains weaker than a
committed render and cannot assert a semantic record view or human attention.
Use [router-aware AppShell links](../../frontend/app-shell/navigation.md#persistent-client-navigation)
to avoid remounting the collector on ordinary sidebar navigation.
A pagehide tail is best effort;
there is no guaranteed unload delivery. There is no persistent browser spool
or localStorage copy of sensitive activity.

## Bounds and Failure Behavior

Buffers hold at most 128 observations and send at most 32 per batch. Server
admission defaults to 240 observations and separately 240 result selections per
minute per session/scope (`logging.browser`, each configurable 1–10000), with
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

Prefer [receipt-backed views](./activity-auditing.md#instrument-custom-results-without-another-logging-system)
when the displayed records must be inspectable later. `useLoggingRows`,
`useLoggingResultView` and native table/detail bindings use opaque prepared
receipts and server-validated positions, never client record facts. Each
displayed revision has its own historical selection. Rapid filter/close changes
retain original observation ordering even while receipt resolution is pending.
An unresolved receipt, queue overflow or oversized known release is an explicit
collection failure; strict mode pauses protected work rather than silently
claiming a complete view. Optional presets report loss without acquiring that gate.

At most 1001 rows and 256 KiB fit one result manifest. First display admission
expires after five minutes. Previously bound same-collector views and exact
committed replays are not new claims. Browser time remains an observation,
not independent attention evidence. See [activity auditing](./activity-auditing.md)
for custom integration and bounded selections.

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

Normal initial admission is **pending**, not a delivery failure. While the first
acknowledgment is outstanding, protected output remains masked with a neutral
opening status, not a failure/Retry panel. A failed policy request, failed
acknowledgment, expired receipt or 15-second stalled initial handshake shows
the explicit recoverable delivery failure. Healthy client navigation reuses
the current grant/collector and does not display that failure screen. A healthy
renewal does not unmount protected output. None of these presentation states
relax server/SSR/Sync admission or accept stale session/scope acknowledgments.

`AppProvider` reads the server's logging policy and mounts delivery recovery
outside the protected data-readiness guard. A committed sign-in/scope switch
can perform the fixed **empty, same-origin HttpOnly-cookie handshake** while
Sync waits for its grant. This path accepts no uploaded event content, requires
the exact Origin and current policy, and does not enable cookie authentication
for general APIs. The browser collector then uses the normal authenticated
SDK. This avoids making audit recovery wait on the protected Sync baseline that
it must itself unlock. Existing authorization and modal/data scope guards stay
in place.

The collector and session-recovery controller remain mounted independently of
both display gates. A restore intentionally invalidates the current UI audit
acknowledgment; showing the audit retry panel must not retire the restore's
pending final document reload. Protected application content and modal hosts
remain beneath both gates. Actual app unmount or a replacement session still
retires stale recovery callbacks, and the same-document attempt marker still
bounds reloads. No additional app provider, navigation callback, or logging
configuration is needed for this lifecycle correction.

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
