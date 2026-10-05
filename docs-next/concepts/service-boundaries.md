---
id: zero.concepts.service-boundaries
type: architecture
audience: [developer, agent]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: service-boundaries
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, trusted-background, browser]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Services, Identity And Authority

[Concepts index](./index.md) · [Documentation index](../index.md)

Use a capability appropriate to the operation's caller. The same user ID or
tenant ID appearing in a record does not turn an ordinary request into trusted
platform setup code.

## Three Server Contexts

| Context | Purpose | Authority boundary |
| --- | --- | --- |
| Plugin/setup services | assemble trusted app plugins and services | application developer/server code; privileged handles are explicit |
| Request services | run an admitted HTTP request | live credential admission, route/resource permission and trusted scope |
| Authority-scoped execution services | verified machine/background work | server-owned scope plus required live async/synchronous authority fences |

Request handlers receive the scoped projection after admission. In Fabric's
tenant-database mode, `zero.data` supplies the admitted tenant-file data client;
domain facades bind scope and actor selectors. App-global raw handles such as
`zero.db` and `zero.databases` are not tenant-safe substitutes: multi-tenant
request projections reject their unscoped use. A tenant request
must not acquire platform-wide services by selecting another ID or falling back
to a process-global compatibility getter.

The explicit unsafe/setup surface is not a tenant-safe service bag. Raw SQL,
raw Elysia handlers and privileged setup remain the application's enforcement
responsibility; they are not substitutes for the ordinary guarded request path.

## Authentication Is Only The First Decision

Authentication verifies the caller. Authorization determines which action and
scope are permitted. Validation checks inputs. Domain services enforce invariants.
Persistence commits the accepted change.

In advanced Guardian, application-scoped platform permissions and tenant/app
permissions are independent. Being a member of the Administration Organization
does not automatically authorize every platform action. Its members can also
hold ordinary app roles in their own workspace.

Compatibility admin-only APIs may deliberately require the legacy global
admin identity role rather than administration membership. For example, AI's
optional status endpoint has an explicit [read policy](../backend/ai/configuration.md).
Use that feature's actual policy instead of assuming every use of “admin” means
the same grant.

## Browser Gates Are Presentation

A signed-in/role/permission gate can hide or render UI. It cannot replace server
checks or protect data already returned to the browser. A client schema's hidden
field, role label, organization selector or metadata filter is not an authority
claim.

On a scope change, query rows, selection, drafts and pending callbacks must not
continue displaying or completing under the old authority. Use Zero's SDK/hooks
and their authorization boundary rather than a component-local fetch/token cache.
Await confirmed mutation results when the UI reports success; optimistic state
is not an accepted server write.

## Machines And Background Work

An app may verify its own machine credentials. Only then should trusted code
construct the public authority-scoped service projection, with its mandatory
live fences. Do not fabricate a browser session or accept an untrusted tenant
selector as the equivalent of that verified principal.

Torrent captures and revalidates actor execution authority; system principals
are explicit. Durable database functions receive source-bound service authority.
A background callback must not assume an old bearer token or local identity
anchor remains authorized after suspension, membership removal or revocation.

## App-Local Ownership

Managed services belong to the concrete app runtime. Compatibility getters
exist for lower-level/older integrations and may be unavailable or ambiguous
when several app runtimes coexist. Keep the app-local service binding passed
by composition; do not invent an ambient “current tenant/app” singleton.

## Related Guides And Next Steps

- [Data planes](./data-planes.md) separates canonical authority from app records.
- [Reactivity](./reactivity.md) explains authorized state delivery and scope resets.
- [Guardian references](../backend/schema/guardian-references.md) explains why
  foreign-key existence must not become an authorization decision.
