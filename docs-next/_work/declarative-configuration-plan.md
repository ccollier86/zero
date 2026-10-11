---
id: zero.declarative-configuration-plan
type: architecture
audience: [developer, agent, maintainer, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: declarative-configuration-evolution
maturity: planned
applies_to: ["Proposed configuration evolution; not an implemented API"]
modes: [managed-server, single-tenant, multi-tenant, simple-permissions, advanced-rbac, fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "5aa2a34a47c7bc05b0c6f01849fdbf477dc01ea8"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: source-observed
---

# Declarative Configuration, Dynamic Settings And Safe Reconciliation

[Working evidence](./index.md) · [Configuration roadmap](../backend/configuration/roadmap.md) · [Product roadmap](../../docs/platform-roadmap.md#configuration-and-plugin-architecture)

Recorded from the configuration design discussion on 2026-10-07. This is an
internal planning record, not a current API reference, implementation commitment,
or instruction to change a consuming application's configuration or databases.
Examples of file organization below are proposals, not new loader options.

## Purpose And Agreed Goals

Evolve Zero's existing declarative configuration rather than replace it with
an unrelated system. Configuration governs the whole application: database
topology and provisioning, Guardian security, service composition, middleware,
routing, feature behavior and the capabilities used by adaptive UI.

The five agreed goals are:

1. Organize new applications into domain-driven configuration pieces by default,
   with a small central entry point.
2. Make each file a useful guided reference: topic/feature grouping, explanations,
   defaults, dependencies and examples of each supported setting and alternative.
3. Improve composition, validation, inspection and reusable presets without
   obscuring precedence or weakening existing typed configuration.
4. Allow explicitly supported settings groups to use database-backed operational
   configuration and permission-controlled management instead of file/env values.
5. Allow the developer to delegate selected controls to organizations or individual
   users, within application-defined boundaries.

Feature requirements must be reconcilable after initial bootstrap when safe.
Configuration is desired state, not permission to silently restructure an
installed application's database or security model.

## Current Foundation Versus Proposed Work

The baseline below was checked against the 2.6.0 source identified above. It
does not imply that every proposed capability already exists.

| Area | Existing foundation | Proposed extension |
| --- | --- | --- |
| App declaration | Typed `zero.config.ts`, `defineZeroConfig`, `createApp`, defaults and cross-feature checks. | A standardized domain/feature layout, richer explanations and deliberate composition tooling. |
| Split files | Ordinary TypeScript imports can already compose focused modules. | Scaffold that organization by default; define presets, provenance and explicit override rules. |
| Startup | Configuration drives managed services, security, routing and resource composition. | Shared feature definitions describing dependencies, readiness and safe reconciliation. |
| Provisioning | Fixed SYSTEM migrations, configured app/Fabric schemas and some feature-specific installers. | Consistent feature-owned optional installation and post-bootstrap reconciliation. |
| Guardian roles | Role assignments are durable SYSTEM records; role/permission definitions come from configured registry semantics. | Optional organization-customizable role definitions and live policy evaluation. |
| AI | Trusted startup configuration, environment resolution and existing provider/service abstractions. | Optional runtime provider settings, scoped BYOK and maintained model/pricing catalogs. |
| UI | Existing public capability projections and live authority inform supported controls. | More consistent configuration-derived composition without duplicating backend policy in components. |

Relevant source: [AppConfig and resolution](../../src/frontend/server/types.ts),
[service composition](../../src/frontend/server/app-platform-services.ts),
[database bootstrap](../../src/frontend/server/app-database-bootstrap.ts),
[SYSTEM migration registry](../../src/migrations/index.ts),
[Guardian kernel](../../src/auth/authorization-kernel.ts), and
[authorization manifest](../../src/auth/auth-authorization-manifest.ts).

The current [configuration declaration guide](../backend/configuration/declaration.md)
documents ordinary typed module composition. `defineZeroConfig` is not currently
an automatic folder loader, inheritance engine or generic database settings API.

## Configuration Organization And Authoring Experience

Organize by **domain → feature → related settings**. Domain ownership, setting
scope, lifecycle and provisioning requirements should inform both the definitions
and their placement. Do not split files merely to reduce line counts.

Illustrative layout; exact names and granularity remain to be designed:

```text
zero.config.ts                 # Compatible, compact application entry point
config/
  app.ts                       # Identity and shared application declarations
  guardian/
    account.ts
    authorization.ts
    organizations.ts
    profiles.ts
    presence.ts
  databases/
    application.ts
    fabric.ts
  ai/
    providers.ts
    byok.ts
    models.ts
  storage.ts
  torrent.ts
  observability.ts
  ui.ts
  environments/
    development.ts
    production.ts
```

Use detailed inline explanations and supported examples near the settings they
explain. Distinguish runnable defaults from commented alternatives so an exhaustive
starter does not accidentally enable every feature. Link deeper guides without
requiring conversation history to understand the file.

Preserve small-app simplicity and existing `zero.config.ts` consumers. Normalize
the project root explicitly; moving configuration must not change asset, schema,
plugin or data paths because a resolver uses a different working directory.

Typed TypeScript remains a supported authoring path. Hydra-style groups, presets,
environment composition and effective-configuration inspection are inspirations,
not a requirement to introduce Python or Hydra itself. YAML is not the preferred
direction: the user dislikes indentation-sensitive configuration. JSON5 is a
brace-based candidate for declarative data, not a decided or currently supported
configuration loader. If adopted, keep trusted TypeScript bindings for schemas,
realms, validators, policies, functions and provider adapters; those cannot safely
be serialized as ordinary JSON settings.

Define deterministic composition: default/project/environment/plugin boundaries,
duplicate handling, array behavior and explicit override rules. Preserve each
domain's distinctions between omission, `false` and supported `null` values.
Do not blindly deep-merge permission lists or protected security settings.
Parsing must remain separate from executing trusted modules, and imports should
not start listeners, migrate databases or make provider requests.

## What Every Settings Group Must Define

These definitions should inform file organization, inline examples, documentation,
validation, provisioning, Doctor diagnostics and public capabilities. Avoid
separately maintained UI and server interpretations of the same policy.

| Definition | Required explanation |
| --- | --- |
| Responsibility | Owning domain/feature, purpose and links to its authoritative guide. |
| Values | Types, defaults, supported alternatives, validation and dependencies. |
| Scope | Application, organization or user; where each value is authoritative. |
| Source | Whether file/env, database or inherited settings are supported. |
| Delegation | Who may read/change it, allowed choices and non-overridable restrictions. |
| Persistence | Schema/resource requirements and SYSTEM/app/Fabric placement. |
| Change behavior | Live update, restart, reconciliation, or explicit migration only. |
| Compatibility | Installed-state prerequisites, forbidden transitions and upgrade behavior. |
| Lifecycle | Readiness, failure/retry, retirement and disable/re-enable behavior. |
| Security | Secret classification, credential handling, authority and audit requirements. |
| Inspection | Redacted effective value/origin/revision and meaningful diagnostics. |

## File-Backed And Database-Backed Operation

Choose backing explicitly for supported settings groups, not arbitrary unrestricted
configuration fields. Use the same domain services and authorization engine in
both modes; source adapters should not create parallel AI or Guardian systems.

File configuration continues to own application capabilities and boundaries:
available features, permission meanings/scopes, delegation ceilings, supported
connections, protected roles and installed topology. In database-backed mode,
the database becomes authoritative for designated mutable operational values.

Distinguish **seed defaults** from **continuing restrictions**. An initial model
selection can seed an editable value; a mandatory provider allowlist remains an
application-enforced restriction. Startup must not repeatedly replace administrator
edits with the original seed. New defaults, new tenants and changes to restrictions
need explicit reconciliation semantics, not ambiguous automatic overwrites.

Database settings need stable identities, revisions, compare-and-set updates,
validation, permission checks, audit records and deterministic change notification.
Caches must include the relevant scope and policy/settings generation. A revoked
setting or credential must not be resurrected by a late asynchronous completion.
Never silently fall back from a selected database source to environment settings
after an error; any fallback is an explicit policy.

Secrets require a dedicated private encrypted store or qualified secret references,
with key material outside the ordinary settings database. Do not automatically copy
every environment secret into a table. Public capabilities, generic Sync, diagnostics
and logs must not expose credentials or the full server configuration.

## Organization And User Delegation

Delegation is feature-specific and optional. The application declares which controls
may be changed, their scope, applicable ceilings and management authority.

Examples include organization AI connections and role definitions, or personal
timezone, regional and notification preferences. Neither an organization nor a
user preference may change the application's tenancy mode, grant platform powers
or bypass its mandatory authentication policy.

Inheritance should be explicit per settings group: some values inherit an app
default, some allow an organization override, and some allow a personal preference.
Do not assume a universal user-over-organization-over-app deep merge. The server
must resolve the caller's current organization and authority; an untrusted tenant
selector cannot choose another organization's configuration.

## Guardian Role Customization

The developer declares the permission catalog, immutable permission scopes,
protected roles, customization rules and initial organization role templates.
In the optional database-backed mode, authorized organization administrators can
edit customizable roles and create combinations of permissions available to them.

Recommend canonical tenant-scoped role definitions and permission membership in
Guardian's SYSTEM database. Fabric may receive deliberately admitted read-only
projections, not independently editable copies of core authentication authority.
Placement is a design recommendation, not a requirement to put every feature's
organization-owned data in SYSTEM.

Preserve protected Owner transfer/last-owner guarantees, actor delegation ceilings,
application-versus-tenant scopes, API-key/native credential ceilings and immediate
live revocation. Administration-organization members can retain separate app and
platform roles; organization membership alone does not grant platform authority.
Deleting and recreating a role key must not silently revive retired assignments.

Changing an assigned role changes every recipient's effective authority. Its policy
revision must participate in session, Sync, background-work and Fabric admission
and final writer fences. Update the resolver, invitations, assignment/replacement
validation and management selectors together; exposing an editor alone is insufficient.
Direct individual permission grants are a separate possible extension, not an
already supported capability or an automatic consequence of editable roles.

## AI Settings, BYOK, Models And Costs

Keep four concerns distinct: provider connections/credentials, model catalogs,
execution/access policy and usage/cost accounting. Platform database-backed provider
settings and organization BYOK are independent opt-ins.

BYOK policy can be optional or required. Optional BYOK may coexist with explicitly
permitted platform-funded access; required BYOK must not silently charge a platform
connection when an organization has no valid key. Define who can manage connections,
which providers/models are allowed, budgets and the funding owner of each request.
User-owned connections can be considered only where the developer explicitly allows
that scope. Provider credentials are not all interchangeable single API keys;
Bedrock and other adapters need their existing typed credential/settings contracts.

Database-backed changes should resolve through the existing AI service layer, with
new requests using the admitted connection generation and a defined policy for
in-flight calls, revocation and disposal. Preserve tenant isolation, trusted endpoint
policy and server-only secrets instead of letting database settings select arbitrary
network destinations or provider code.

Maintain provider model lists through supported discovery APIs where available,
with curated/manual metadata where discovery is incomplete. A Vercel Gateway catalog
is a candidate supplementary source without requiring all inference to use that
gateway. Model IDs, capability descriptions, account/region availability and prices
are different facts; catalog presence is not proof of access or a guaranteed price.

Record metadata provenance, fetch time, refresh/failure behavior and overrides.
Pricing needs units, effective dates and versions, including supported cached-input,
context-tier and non-text dimensions. Usage records should retain the price version
and funding source used at execution; later catalog updates must not rewrite history.
Keep estimated provider cost distinct from an app's customer billing price.

## Conditional Provisioning And Later Reconciliation

Each feature owns its dependencies, versioned migrations/resources, target database
roles, service lifecycle and readiness. Shared planning assembles those requirements;
it must not become a catch-all service containing every domain's logic.

| Situation | Intended behavior |
| --- | --- |
| Fresh app, optional feature disabled | Do not install its optional structures, beyond an explicitly documented minimal foundation. |
| Enable a feature after provisioning | Validate compatibility, reconcile resources safely and expose it only after readiness. |
| Create an organization later | Provision the requirements for that organization with idempotent seeds. |
| Tenant database is unopened | Track required versions and ensure readiness before admitting work there. |
| Disable an installed feature | Stop runtime use; retain its data and migration history. |
| Re-enable it | Reconcile the installed version and resume without overwriting saved state. |
| Structural/security model transition | Reject ordinary reconciliation; require a supported explicit migration procedure. |

Respect migration-disabled installations. Diagnostics inspect and report missing
requirements without secretly installing them. Plan SYSTEM, pinned application
and Fabric actor targets separately; different databases are not one globally atomic
transaction. Define retryable progress and fail closed before exposing half-ready
capabilities. Existing schema collisions must not be silently overwritten.

Preserve released migration identities, ordering/checksums and installed data.
Future feature-owned installation must have an explicit compatibility path; do not
retroactively edit the fixed migration chain or mark skipped migrations as applied.
Disabling a feature never means automatically dropping tables or deleting resources.

### Presence As The Concrete Current Example

Presence currently defaults to disabled, and its service initialization exits
without starting active presence processing when disabled. However, fixed SYSTEM
migration `040` creates five presence tables regardless of that flag. Thus disabled
presence does not currently mean absence of its SYSTEM schema.

Application projection provisioning is conditional through the enabled managed
publisher. Fabric projections belong to the explicitly declared realm contribution;
that contribution remains installed when the runtime feature is disabled. The
presence flag alone is not automatic realm composition.

See [migration 040](../../src/migrations/definitions/040_guardian_presence.ts),
[service initialization](../../src/presence/presence-service.ts),
[managed publisher](../../src/presence/presence-managed-publisher.ts), and
[realm contribution](../../src/presence/presence-realm.ts).

The future fresh-install goal is more selective optional provisioning. Existing apps
must retain their presence tables/history; achieving that goal is not permission to
rewrite migration `040` or remove data.

## Installed-State Compatibility And Doctor

Record a durable, versioned installed application contract. Compare requested
configuration with that contract and actual schema readiness, not just with valid
configuration types. Intent, installed state, service readiness and public UI
capabilities are distinct.

Required rejection example:

```text
Installed: multi-tenant Fabric + advanced RBAC
Requested: single application DB + SYSTEM DB + simple permissions
Result: incompatible ordinary configuration change; no automatic conversion
```

Doctor must return a nonzero result explaining the installed/requested modes and
why a supported migration is needed. It must not silently ignore the setting,
collapse tenant databases, reinterpret roles, weaken access or "repair" the state.
Missing compatibility evidence should be reported as unverified, not presumed safe.

Startup and reconciliation must enforce the same compatibility rules even when
Doctor is skipped. The diagnostic command itself does not prevent file editing;
the shared runtime admission check prevents incompatible application operation.
Validate before applying incompatible mutations, and update the installed contract
only after successful admitted reconciliation, never merely because a file changed.

Safe optional enablement and ordinary authorized setting edits remain possible.
Security-sensitive transitions such as MFA enforcement need their own enrollment,
delivery/readiness and recovery rules; do not imply every auth toggle is safe or hot.
An explicit structural migration needs reviewed data mapping, authority conversion,
backups and recovery; no general conversion procedure is promised by this plan.

## Adaptive UI And Engineering Boundaries

Existing reusable components should consume safe resolved capabilities and caller
authority, with minimal application wiring. Distinguish disabled, pending,
unavailable, read-only and ready states. Configuration-driven layout is not a
substitute for backend authorization, and `enabled: true` is not proof of readiness.

Reuse existing Guardian, Fabric/ReactiveDB, storage, AI, SDK and runtime primitives.
Keep Elysia plugins responsible for transport, validation and lifecycle; domain
services own policy, stores own persistence, SDK/hooks own access and components
own interaction. Prefer Bun-native APIs where available. Use Zero's standard error
and observability boundaries, stable event codes, redaction and domain audit events.
Tokenize any future management UI through the existing design system.

See [engineering standards](../../docs/engineering-standards.md) and
[observability](../../docs/observability.md).

## Proposed Work Sequence And Acceptance

This sequence is a planning aid, not authorization to begin implementation.

- [ ] Inventory every existing configuration group against code, examples and Doctor.
- [ ] Define domain/feature ownership, per-group contracts and the standard scaffold.
- [ ] Preserve current typed configuration and qualify project-root/precedence behavior.
- [ ] Design installed-state compatibility and shared Doctor/startup validation.
- [ ] Design feature-owned provisioning, later reconciliation and legacy migration compatibility.
- [ ] Add selected database-backed groups one domain at a time, starting with an explicitly chosen scope.
- [ ] Add organization/user delegation, live authority and safe capability/UI integration.
- [ ] Document exact supported settings, examples, upgrades, failures and configuration origins.
- [ ] Qualify fresh, existing, single/multi-tenant, simple/RBAC and Fabric deployments with disposable fixtures.

Acceptance must cover preserved administrator edits, concurrent changes, safe
disable/re-enable, missing migrations, unopened tenants, interrupted reconciliation,
credential rotation/revocation, cross-organization isolation and rejection of the
Fabric/RBAC-to-single/simple example before incompatible changes occur.

Unsettled decisions include exact files/preset syntax, whether to add JSON5 beyond
typed TS, supported first database-backed groups, live versus restart boundaries,
and how legacy installed migrations transition to selective future provisioning.
Do not invent callable config keys, commands or endpoints before those contracts
are implemented and verified.

## Related Documentation

- [Configuration index](../backend/configuration/index.md) and [reference](../backend/configuration/configuration.md).
- [Configuration roadmap](../backend/configuration/roadmap.md) and [Doctor roadmap](../cli/doctor/roadmap.md).
- [Guardian roadmap](../backend/guardian/roadmap.md) and [AI roadmap](../backend/ai/roadmap.md).
- [Migration data planes](../backend/migrations/data-planes.md) and [Fabric configuration](../backend/fabric/configuration.md).
- [Presence](../backend/guardian/presence.md) and [adaptive profile upgrade guide](../guides/upgrade.md#opting-into-adaptive-profiles-after-provisioning).
