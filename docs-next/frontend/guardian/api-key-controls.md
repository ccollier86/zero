---
id: zero.frontend.guardian.api-key-controls
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: api-key-ui-and-hook
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Optional API-Key Controls And Hook

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

API-key components are optional, not mounted automatically. The app chooses
where they belong. Public policy and current management capabilities determine
which operations are possible; the backend [API-key contract](../../backend/guardian/api-keys.md)
owns eligibility, live permissions, tenant binding, expiry and rotation.

Import components from `@zero/framework/components/auth`; import
`useAuthApiKeys` from `@zero/framework/react/hooks`.

## Component Modes

All share `className`, `pageSize`, `title`, `description`.

| Component | Required target / purpose |
| --- | --- |
| `SelfApiKeyManagement` | Current user's eligible current scope. |
| `ApplicationUserApiKeyManagement` | `userId`; single-application administrator management. |
| `TenantMemberApiKeyManagement` | `membershipId`; active-tenant administrator management. |
| `PlatformApiKeyManagement` | Optional tenant filter for directory; tenantId+membershipId for a specific customer member. |
| `ApiKeyManagement` | Explicit discriminated `mode` and the corresponding target props. |

`ApiKeyManagementProps.mode` is `self`, `application-admin`,
`tenant-admin` or `platform-admin`. In platform mode, supplying a membership
ID requires a tenant ID. A tenant ID alone filters the platform directory; it
is not enough to issue a key to an unspecified member.

```tsx
import { SelfApiKeyManagement, TenantMemberApiKeyManagement } from '@zero/framework/components/auth';

export function AccountKeys({ membershipId }: { membershipId: string }) {
  return (
    <>
      <SelfApiKeyManagement />
      <TenantMemberApiKeyManagement membershipId={membershipId} />
    </>
  );
}
```

Render the member component only in an appropriately authorized administration
view. Component props select a supported control-plane target, not authority.

## Accepted Operations And One-Time Secret

The interface lists secret-free summaries and offers issue/confirmed rotation/
revocation when the server reports those capabilities. Issue input is
`{ label: string; ttl?: string }`. Await the hook's accepted result.

Issue/rotate returns `IssuedAuthApiKey: { apiKey, secret }`.
The secret reveal supports deliberate copy/dismiss; lists cannot recover it.
While revealing it, unrelated actions are restrained. Dismissal, denied/
unavailable capability, identity/tenant/target or authorization-revision changes
retire sensitive local state. Clipboard failures are not a successful copy.

Do not persist the issued secret in user properties, shared state, URL queries,
analytics or logs. Browser presentation is intentionally temporary; the
credential's external owner must store it securely.

## useAuthApiKeys

`UseAuthApiKeysOptions` mirrors the discriminated component modes and adds
`enabled?`, `limit?`.
Result: readonly `apiKeys`, `page`, `isAvailable`,
`canIssue/canRotate/canRevoke`, `isLoading/isLoadingMore/isMutating`,
`isDenied`, `error`, `reload()`, `loadMore()`,
`issue(input)`, `rotate(keyId, input)`, `revoke(keyId)`.

Capabilities are usable only after a current scope-safe server page/capability
response. A configured feature is not enough. Changed authorization phase/
revision and target invalidate the view; superseded pages cannot reappear.
Mutation results are accepted only within the captured current boundary.
Standard auth reporting handles failures without raw secret metadata.

Unavailable profile, signed-out, public-config unresolved, permission denied,
initial load failure and an empty successful list are different UI states.
Keep your custom toolbar usable for the appropriate retry; don't replace a
failed list with “no keys.”

## Authentication Boundary

A user key carries the user's live scope permissions within its credential
ceiling; it is not a new admin role. Raw keys are not accepted by the human
key-management/ceremony endpoints merely because they can access app APIs.
Rendering these controls does not implement service HMAC or arbitrary
server-master keys.

## Verification And Related Guides

Verify self/admin modes in single/multi profiles, denied issuance, one-time
secret dismissal, rotation/old-secret invalidation and role eligibility removal.
Check changed organization/target/revision clears prior secret display.

- [Backend API keys](../../backend/guardian/api-keys.md) owns security/lifecycle.
- [People control plane](./people-control-plane.md) shows where target-specific controls fit.
- [SDK facades](./sdk-surfaces.md) document direct namespaced API access.
