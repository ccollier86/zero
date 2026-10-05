---
id: zero.frontend.sdk.scoped-control-planes
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: scoped-control-planes
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

# Readiness And Scoped Studio Facades

[SDK index](./index.md) · [Documentation index](../../index.md)

The integrated client exposes client.dataRealm, client.dataStudio and
client.storageStudio. These are authenticated scoped service facades, not
browser-selected raw database/drive handles. Guardian's active scope and live
permissions govern each server operation.

## Data Realm Readiness

```tsx
import { useDataRealmReadiness } from '@zero/framework/react';

const readiness = useDataRealmReadiness();
```

This fragment belongs under the normal provider. Options are enabled(default true)
and pollIntervalMs. The server snapshot's pollAfterMs takes precedence over the
bounded fallback. Disabled mode is a deliberate UI bypass, not provisioned data.

Result status includes disabled/loading/error plus server realm statuses.
snapshot, isReady/isPending/canRetry/errorCode, isLoading/isProvisioning/isFailed,
refresh():Promise<void> and retry():Promise<void> support packaged gates.
client.dataRealm.getReadiness(signal?) inspects; retry(signal?) retries under
server policy. A browser cannot fabricate another tenant ID or a ready database.

The hook loads only for authenticated stable scope, aborts old work and masks
old snapshots on identity/tenant/authority transition. Pending states poll/retry
according to server classification; a transient transport failure does not
silently become success. Error reporting is code-only.

## Studios

[Data Studio](../data-studio/index.md) owns organization logical table/catalog/schema/
row/revision/operation UI and client.dataStudio methods. The hook is useDataStudio,
not an arbitrary SQL hook.
Storage Studio owns drive provisioning/revisions/quota/permissions/lifecycle
through client.storageStudio and its owning documented UI/service contracts.
Their cache scope keys are projection fences; assigning one does not grant access.

Use installed service capabilities and scope-bound components instead of inventing
platform flags. A disabled/denied/provisioning/error state should stay distinguishable,
and users should not mutate data before readiness.

## Related Guides And Next Steps

- [Data Studio](../data-studio/index.md) owns table control planes.
- [Guardian identity projection](../../backend/guardian/identity-projection.md) owns
  canonical/shallow identities and readiness integration.
- [Runtime data planes](../../backend/runtime/data-planes.md) owns system/app split.
- [Scope transitions](../runtime/scope-transitions.md) owns browser replacement.
