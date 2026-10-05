---
id: zero.guardian.modes
type: architecture
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: tenancy-and-authorization-modes
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

# Choose Tenancy And Authorization Independently

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian has two independent mode choices. **Tenancy** determines whether an
account acts in an application-wide identity scope or an active organization
membership. **Authorization** determines how the scope's roles and permissions
are resolved. Start with the simplest profile that expresses the application's
actual ownership model; a physical database choice is a separate decision.

## The Four Profiles

| Profile | Identity/access model | Appropriate use |
| --- | --- | --- |
| Single / simple | A live global user role supplies the application scope. | A straightforward application with ordinary user/admin access. |
| Single / advanced | Application role assignments, declared permissions and protected application ownership. | One application workspace with delegated access or multiple roles per user. |
| Multi / simple | A live active organization membership supplies exactly one role in that scope. | Separate organizations whose access fits one role per membership. |
| Multi / advanced | Organization memberships with retained role assignments, permission sets and protected ownership. | Organizations needing multiple app/platform roles, delegated grants or detailed permissions. |

All four combinations are normalized by the same Guardian configuration path.
Multi-tenancy does not itself require advanced authorization. Individual
features can require a more specific profile: for example, Data Studio's
organization-managed table API has additional Guardian/Fabric prerequisites.
Choose those prerequisites deliberately rather than assuming every feature
activates when `tenancy: 'multi'` is selected.

## Minimal Configuration

These are configuration fragments, not complete servers:

```ts
import { defineAuthConfig } from '@zero/framework/auth';

// The default profile when createApp receives auth: true.
export const ordinary = defineAuthConfig({
  tenancy: 'single',
  authorization: 'simple',
});

export const organizations = defineAuthConfig({
  tenancy: 'multi',
  authorization: 'advanced',
});
```

Pass one configuration to the containing managed `createApp({ auth: ... })`.
Omitted or `false` app auth disables Guardian; a configuration object enables
it. `defineAuthConfig` preserves inference and returns its input; runtime
normalization occurs during composition. Merely importing a configuration
fragment does not create users, organizations, tables or routes.

Single/simple defaults do not make a new installation's first registration
public. Bootstrap is a separate admission policy, with secret mode as its
default. The first owner must be admitted through that setup boundary before
normal registration policy applies.

## Organization Membership Is Not A Global Admin Flag

In multi mode, a credential is bound to a particular live tenant/membership.
An organization owner has that organization's authority; this is not permission
to browse another organization's records or administer the application.

The protected **Administration Organization** serves two purposes:

1. Its own application workspace, with ordinary tenant-scoped app roles.
2. The membership boundary from which explicit application-scoped platform
   permissions can be projected.

An app-only member of that organization is not automatically a platform
operator. In advanced mode, a member can have an app role, a platform role, or
both. Platform/application roles remain unassignable to customer organizations.
Protected owner assignments use their dedicated transfer lifecycle; they are
not ordinary role checkboxes that an access manager may add or remove.

Simple multi mode retains one role per membership. If a person needs separate
app and platform grants combined in one active membership, advanced mode is
the natural fit rather than inventing extra organizations or trusting a client
role label.

## Permission Scope Follows The Chosen Model

In single mode, omitted permission scope defaults to `application`. In multi
mode it defaults to `tenant`. Declare `scope` explicitly in reusable feature
configuration when the distinction matters:

```ts
export const organizationAccess = defineAuthConfig({
  tenancy: 'multi',
  authorization: {
    mode: 'advanced',
    permissions: {
      'documents:read': { scope: 'tenant', label: 'Read documents' },
      'documents:write': { scope: 'tenant', label: 'Edit documents' },
    },
    roles: {
      editor: { permissions: ['documents:read', 'documents:write'] },
    },
  },
});
```

Declaring a permission does not apply it to every endpoint or table. Attach
Guardian access requirements to the relevant route/resource. A schema's
reference field or UI permission gate does not replace that server enforcement.

## Database Topology Is A Separate Axis

Guardian's canonical identity, sessions and grants live in the managed system
database. Application data can use a pinned application database or a Fabric
tenant-database topology. Therefore:

- Single tenancy does not mean canonical auth tables are mixed into app tables.
- Multi tenancy does not by itself create a separate physical file per tenant.
- Fabric selects a tenant database from admitted live scope, not an arbitrary
  browser-provided ID or path.
- Inside a selected file, resource and role policy still govern operations.

Use [data planes](../../concepts/data-planes.md) to choose placement and
[Guardian reference fields](../schema/guardian-references.md) to attribute app
records to users/memberships without copying profile or authentication state.

## Changing A Profile Is An Application Change

Changing a mode string is not an automatic data or ownership migration. Existing
single/advanced ownership adoption, multi administration-tenant adoption and
legacy-role adoption have explicit selectors and constraints. They do not move
application rows into tenant files, assign ownership to those rows, or convert
every old credential into a valid new membership automatically.

Before changing an existing application's profile, define the desired owners,
membership/role assignments, record placement and protected resource policies.
Verify sessions, registration, user administration, API keys and live data under
that model. Keep backup and rollback decisions outside an ordinary documentation
or mode-inspection command.

## Verify The Profile

In a disposable fixture, inspect normalized `tenancy.mode` and
`authorization.mode`, then prove permitted and denied actions with distinct
actors. For multi mode, create two organizations and verify the active tenant
scope is the one admitted by the server. For advanced mode, remove a grant and
verify the old session/key no longer authorizes the removed action.

Do not mistake configuration normalization, a hidden button, a file count or
one successful login for an end-to-end authorization test.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Guardian overview](./index.md) separates identity, sessions and authority.
- [Service boundaries](../../concepts/service-boundaries.md) chooses the proper
  server capability for requests and background work.
- [HTTP endpoints](../runtime/endpoints.md) attaches route access requirements.
- [Data planes](../../concepts/data-planes.md) chooses physical storage without
  conflating it with user permissions.
