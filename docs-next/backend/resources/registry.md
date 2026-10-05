---
id: zero.resources.registry
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: registry
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, shared-row, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Register And Discover Resources

[Resources index](./index.md) · [Documentation index](../../index.md)

Managed composition collects explicit resource declarations and optional
conventional resource modules into an app-local validated registry.

## Discovery

resources defaults to an empty list; serverResourcesDir defaults to
./server/resources and can be false. Discovery recursively imports supported
JavaScript/TypeScript module extensions in stable order, skipping declaration,
test and spec files.

Modules export defineResource output or arrays through default, resource or
resources exports. Duplicate references from supported exports are not a reason
to publish multiple different declarations with the same identity.

Importing a resource module executes trusted app code. Discovery is not a
sandbox for browser-uploaded files; keep declarations side-effect-free.

## Admission

Registration checks actual table/primary-key compatibility, field lists,
exposure/realm classification, owner/Guardian fields, declared metadata keys,
authorization requirements and current topology/auth prerequisites.
A raw table-name match is not complete admission.

Multi-tenant managed apps fail closed on missing required classifications.
Expose only intended transports and declare global versus tenant data
deliberately.

## App-Local Ownership

The public resource subpath includes ResourceRegistry/createResourceRegistry
and validation/discovery helpers. Compatibility configure/get/register globals
also exist, but normal managed apps use their own registry/services.
Do not assume a global registry safely represents two createApp runtimes.

Changing the caller's declaration object later is not a live configuration
update: admitted definitions/policies/field metadata are captured.
Deploy an intentional configuration change through the owned lifecycle.

## Failures And Diagnostics

Registry/loader errors and validation issues describe configuration failure.
Safe resource loading/evaluation observations should not log absolute paths,
import stacks or private row values.
Doctor can validate trusted declarations; it cannot certify arbitrary
custom callback business behavior.

See [configuration](./configuration.md), [definitions](./definitions.md),
[Fabric realms](../fabric/realms.md) and
[runtime discovery](../runtime/discovery.md).
