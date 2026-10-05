---
id: zero.storage.composition
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: composition
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose Storage In A Managed App

[Storage index](./index.md) · [Documentation index](../../index.md)

Managed createApp installs storage with its app-local system ReactiveDB,
Guardian request resolver, authorization kernel/property policy and audit
dependencies. The plugin owns the /storage HTTP surface, ingress checks,
startup publication and cleanup; the service owns domain mutations.

## Normal Access

Authenticated handlers receive a scoped zero.storage facade.
Trusted setup code can access the raw engine, whose grouped APIs are
drives, objects, permissions and uploads (plural). Raw methods accept explicit
actor/scope inputs and are not inherently request-authenticated.

The raw service's studio getter is null by design. Managed request/workflow
projection replaces it with a current authority-bound facade when Studio is
enabled. A raw engine reference must not fabricate a tenant/actor to bypass that
projection.

## Standalone Plugin

createStoragePlugin requires a metadata ReactiveDB. Adapter/localDir, signing
policy, auth/kernel/property/audit resolvers, runtime ownership and optional
lifecycle provider are explicit injection seams.
Prefer managed composition when the app already uses createApp; standalone
registration is not a way to skip live authority.

getStorageService is a compatibility provider getter, not a safe singleton
selector for multiple simultaneous applications. App-local runtime/service
ownership is the normal boundary.

## Lifecycle

Composition admits adapter safety and Studio isolation before traffic.
Failed startup retires owned publication/resources rather than leaving a usable
half-started provider. Managed shutdown stops new work and joins bounded
maintenance/provider drain while dependent system services still exist.

Adapters must truthfully satisfy cooperative cancellation or durable publication
handoff. A noncooperative third-party implementation cannot be made cancellable
by an interface annotation; the owned resources remain guarded until its
settlement/handoff path completes.

See [adapters](./adapters.md), [configuration](./configuration.md),
[request authority](./request-authority.md) and
[runtime shutdown](../runtime/shutdown.md).
