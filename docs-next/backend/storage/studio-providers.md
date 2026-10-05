---
id: zero.storage.studio-providers
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-providers
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

# External Lifecycle Provider Hooks

[Storage index](./index.md) · [Documentation index](../../index.md)

A Studio lifecycle provider is distinct from a StorageAdapter.
The adapter writes/reads/deletes blobs; lifecycle hooks reconcile an external
drive namespace after provisioning retry or restore.

## Injection

Standalone StoragePluginConfig exposes studioLifecycleProvider and
studioLifecycleProviderTimeoutMs. The provider type is available through that
property; the internal implementation interface is not a named export that apps
should import from a source file.

Hooks are retryProvisioning and restoreDrive. Inputs contain the canonical
profile, admitted continuation authority and AbortSignal. The default shared-CAS
implementation has no external namespace work.

## Idempotence And Time Bounds

Hooks must be idempotent: an expired lease or recovered intent may execute them
again. Provider continuation uses durable job generation/leases, renewal and
bounded timeout (default2minutes, maximum30minutes), with explicit retry versus
ambiguous terminal failure.

Observe cancellation and don't retain unrestricted authority for later arbitrary
work. A timeout cannot prove that an external service undid a completed effect;
unknown outcomes preserve that uncertainty.

A third-party adapter/provider claiming required contracts needs real
failure/restart/drain tests. Configuration alone isn't certification.

## Privacy And Recovery

Browser job/profile views omit provider namespace, lease and operation hash.
Emit safe codes/phase/attempt information, not full profile/input or raw provider
exceptions containing credentials/paths.

Provider restore does not magically repopulate purged object metadata.
See [lifecycle](./studio-lifecycle.md), [adapters](./adapters.md),
[configuration](./configuration.md), [errors](./errors.md) and
[request authority](./request-authority.md).
