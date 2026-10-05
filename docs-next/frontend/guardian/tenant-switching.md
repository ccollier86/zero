---
id: zero.frontend.guardian.tenant-switching
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: tenant-switcher-and-app-shell
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Tenant Switching And AppShell Workspace Presentation

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

A workspace switch replaces the authenticated tenant session. It is not a
local React selector changing a `tenant_id` field. The SDK rotates the
session and retires old authority/data before the new scope is usable.
See [session switching](../../backend/guardian/sessions.md) and
[scope transitions](../runtime/scope-transitions.md).

## TenantSwitcher

Import from `@zero/framework/components/auth`.
`TenantSwitcherProps`: `className?`, `label?`,
`onSwitched?(tenantId: string)`.

The label follows configured organization terminology unless overridden.
The selector displays server-approved choices, distinguishes Administration,
is disabled during load/switch or fewer than two choices, and reports failures
with retry. A successful committed handoff announces completion and restores
focus to the exact instance's trigger across scope remounts.

```tsx
import { TenantSwitcher } from '@zero/framework/components/auth';

export function WorkspaceNavigation() {
  return <TenantSwitcher label="Workspace" />;
}
```

No available active tenant means no rendered switcher. A selected platform
customer workspace in an administration directory is not the same operation.

## useTenantSwitcher

Import from `@zero/framework/react/hooks`.
Returns `isAvailable`, `terminology`, `tenants`, `activeTenant`,
`isLoading`, `isSwitching`, `error`, `reload()`,
`switchTenant(tenantId): Promise<void>`.

It loads choices for a completed multi-tenant browser session and delegates
the refresh-proof-backed switch. Calling it with the current tenant is a no-op.
A stale captured callback rejects; query responses from a retired scope cannot
replace current choices. Config failure can retain the committed active-tenant
display with a retry path, not fabricate alternatives.

The low-level hook does not itself promise a once-only callback across subtree
remounts. Use the packaged switcher/AppShell presentation for that interaction.

## useTenantAppShellWorkspaces

`useTenantAppShellWorkspaces(options?)` returns
`AppShellWorkspaceConfig | undefined`. It adapts the same switching path to
AppShell's workspace navigation; the auth controller remains the credential
owner.

Options include `onSwitched`, `hideWhenSingle` (true), `label`,
`createLabel`, `onCreate`, `activeActions`,
`itemSubtitle(tenant)`. The generated config contains committed `activeId`,
items, pending/error/retry/announcement state, required active selection and
an `onSelect` delegating to the rotating session path.

One fully loaded membership hides the control by default unless extra create/
active actions or an error make it useful. Creation callbacks are app-owned
navigation; they do not bypass creation policy. Pass the result into your
AppShell's existing workspace prop rather than editing auth state yourself.

The component module also exports `parseTenantSwitcherHandoff`,
`runTenantSwitch` and `TenantSwitcherHandoff` for its presentation contract.
`runTenantSwitch(operation, onSuccess, onFailure?)` contains rejected event
handler promises and returns a success boolean. Handoff parsing validates UI
coordination data; it is never server authority or permission proof.

## Verification And Related Guides

Switch among two organizations and Administration, delay reconciliation,
force a transient failure and revoke a membership. Verify committed labels,
focus/announcements, retry and no old rows/selection after replacement.

- [Frontend runtime](../runtime/index.md) owns shared session/cache barriers.
- [People control plane](./people-control-plane.md) distinguishes administrative browsing from switching.
- [Backend tenancy](../../backend/guardian/tenancy.md) owns membership/creation policy.
