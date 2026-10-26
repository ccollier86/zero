---
id: zero.guides.practiceiq-integration-repair
type: operations
audience: [agent, developer, operator]
owner: platform
status: in-review
visibility: internal
system: cross-system
feature: practiceiq-post-upgrade-repair
maturity: supported
applies_to: ["2.6.0 builds with AppShell linkComponent and native reader cleanup corrections"]
modes: [single-tenant, separate-system-database, Fabric-logging, browser, linux-amd64]
---

# PracticeIQ Navigation, Audit And Avatar Update

[PracticeIQ upgrade index](./index.md) · [Repair analysis and evidence](../../_work/practiceiq-integration-repair.md)

This is a focused package update **after** the completed legacy-state conversion,
not another migration or a production deployment authorization. The reported
deployed baseline is Zero 2.6.0 `be266f5fd7ed063c9cfe43c385b8a80b90e5902a`, archive
SHA-256 `1ce5585d21e8aa1e5110e83931e17fe9992ad273a725e7bbb9a56fb5edd90409`.
Use the exact newer qualified main commit/SHA supplied by the release handoff;
the unchanged `2.6.0` version does not distinguish these packages.

## Ownership And Corrections

| Observed problem | Framework correction | Application responsibility |
| --- | --- | --- |
| Sidebar navigation remounts the whole document/provider | Additive AppShell `linkComponent` composition through existing Zero Link; brand, breadcrumbs and built-in menus included | Pass `linkComponent={Link}` at the common staff shell. Use Link in custom footer/header content too. |
| Healthy admission displays a failure/retry panel briefly | Separate neutral pending admission from failed/expired/stalled delivery; existing recovery owner remains mounted | Keep one unkeyed root AppProvider. Do not disable strict logging or add a duplicate collector/navigation callback. |
| Fast route changes disappear from audit | Immediate admitted popstate/hash observations, URL deduplication and bounded retained delivery | Bind opaque semantic targets with useLoggingView and declare clinical reads through supported logging APIs. A URL change is not a semantic read. |
| Existing uppercase APP_* diagnostics fail action validation | Bridge-only lowercase operational action plus exact `metadata.sourceCode`; audit validator unchanged | No rename is needed for admitted existing codes. Filter retained actions using lowercase spelling. |
| Valid native image upload rejects as invalid Storage input | Best-effort stream cleanup cannot replace successful bounded reads or real failures | Keep the native profile/avatar integration. If a different error remains, capture sanitized route/stage/status/code and investigate it separately. |
| Photo editing only becomes visible on hover | Persistent Upload/Change photo and Remove photo controls, existing crop/save/error/focus protections | No custom uploader or public-avatar workaround. |
| Audit workspace is hard to discover | Existing native LoggingWorkspace remains the investigation UI | Optional administrator-only Audit sidebar link to the already implemented route; this is not a missing logging UI. |

The full baseline browser reproduction had four document requests/four failure
panel flashes across four sidebar changes, no retained rapid navigation, no
visible photo action, and a rejected signed image PUT. See the evidence record
for measured corrected-package results and release qualification status.

## App Integration

Read the application's AGENTS.md and the exact installed owning manuals first.
Continue on its authorized feature/integration branch, preserving its existing
work. The framework agent does not edit PracticeIQ or access its production data.

```tsx
import { AppShell } from '@zero/framework/components/app-shell';
import { Link, usePathname } from '@zero/framework/react';
import type { ReactNode } from 'react';

export function StaffShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <AppShell linkComponent={Link} currentPath={pathname}
    brand={{ name: 'Staff workspace', href: '/app' }}>
    {children}
  </AppShell>;
}
```

Apply that one prop to PracticeIQ's existing staff shell rather than replacing
its nav, permissions, styles, provider or footer. Existing descriptors retain
their hrefs and parameterless callbacks. The reviewed custom StaffUserMenu
already calls router.push for its account action without a competing href; it
does not need to be replaced to adopt this adapter. For any other custom anchors,
use public Link composition if they should navigate client-side. Do not call
router.push alongside a still-active native href. Non-router/standalone shells
may intentionally omit the adapter and retain ordinary document anchors.

## Safe Update And Acceptance

1. Verify the supplied corrected main commit/archive SHA and normal saved release
   with `zero-release --status`. Inspect the app's current pin/lockfile and retain
   its existing backups/recovery artifacts. Apply `zero-update <app-worktree>`
   normally on the app feature branch; do not edit node_modules or private SQL.
2. Adopt the AppShell Link prop above. Preserve single tenancy, application and
   SYSTEM file paths, strict compliance, existing Storage/KV identities, logging
   custody and the current source actor/empty child environment. This repair
   introduces no new schema migration or reconversion step.
3. Run app types, Doctor and its existing tests. Preserve the prior migration 004
   source/bundle identity correction and retries:1 one-total-attempt declaration.
4. Build a disposable linux/amd64 image with the official Zero build and retained
   matching dependencies/source actor entry. Verify workers do not boot the app
   or inherit provider/dotenv secrets. Do not publish/deploy before acceptance.
5. In a real browser, sign in and move between several sidebar routes, Home/brand,
   breadcrumbs and custom account links. Count actual document requests and
   preserve shell identity, not just eventual text. Healthy client navigation
   must not flash Confirm audit delivery/Retry. Test Back/Forward and ordinary
   modified/new-tab links. Dirty form Stay must not navigate or record a completed
   navigation. Unknown/server-only destinations keep documented document fallback.
6. Hard refresh/new tab still establish required admission. Block observations:
   protected content must mask, genuine failure must remain visible and native
   Retry must recover. Test expiry, revoked authority and session recovery; do
   not fix a symptom by suppressing failures or weakening server admission.
7. Sign in as a legitimate authorized administrator. Use `client.logging.health()`
   and retained audit/operational queries. Inspect source pending/discovery,
   delivery failures and separate operationalBridge counters. Verify rapid
   navigation events and the app's actual uppercase custom events are retained.
   Public health alone does not establish this. Do not fabricate an admin token.
8. Test native profile load → visible photo action → choose/crop → stage → signed
   upload → finalize → ordinary profile Save → private image delivery. Keep an
   unsaved name/bio during avatar save and verify it is not discarded. Refresh
   and restart the disposable image with unchanged state, then replace/remove.
   Exercise keyboard/touch, invalid input, conflicts, read-only and revoked scope.
9. Keep diagnostics to route templates, status, stable codes and approved static
   messages. Never retain patient details, raw URLs, image bytes, upload grants,
   receipts, passwords or tokens. A remaining failure is a blocker to investigate,
   not permission to reset identities, drives, logs or receipts.

Production authenticated health, actual app custom-footer behavior and its
cutover remain the PracticeIQ agent's acceptance responsibility. Synthetic Zero
qualification is not a claim that those production checks were performed.

## Owning Manuals

- [AppShell navigation](../../frontend/app-shell/navigation.md#persistent-client-navigation)
- [Zero Link/router](../../frontend/router/navigation.md)
- [Browser activity and required delivery](../../backend/logging/browser.md)
- [Logging operations and health](../../backend/logging/operations.md)
- [Private avatar lifecycle](../../backend/guardian/avatars.md)
- [Native profile settings](../../frontend/guardian/profile-settings.md)
