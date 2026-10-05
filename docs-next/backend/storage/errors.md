---
id: zero.storage.errors
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: errors
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

# Safe Storage Errors And Outcomes

[Storage index](./index.md) · [Documentation index](../../index.md)

StorageDomainError uses a closed code, safe bounded scalar details, retryable and
outcome. StorageError(status,message) remains a compatibility class.
Unknown hostile exceptions normalize to an opaque internal failure, not a raw
filesystem/provider message.

## Outcome

not-started/not-committed/committed/unknown describe what the boundary actually
knows; null makes no commit assertion. An unknown outcome cannot be marked
blindly retryable.

toStorageHttpFailure projects fixed public messages/codes/status.
Ambiguous writes return503 with requiresSameIdempotencyKey, not a fresh
retry identity that can duplicate an accepted intent.
A committed deleting state followed by failed cleanup remains committed, even
if the overall request reports continuation trouble.

## Common Codes

Input/metadata invalid400; authentication401; authority/policy403;
missing resource404; revision/idempotency/path conflicts409;
quota/limit413; MIME415; range416; unavailable503.
Details never include paths, object names, tenant/user IDs, capability tokens,
request bodies or operation keys.

## Observability And Audit

Operational events use standard STORAGE_* code definitions and safe stage/
counts/outcome data. Guardian audit attributes current ACL/control-plane changes
to canonical actors, not a caller-provided email/role.

Do not log full upload bodies, presigned URLs or raw third-party exceptions.
An accepted edit plus failed UI refresh/toast is not a failed write and should
not offer an automatic repeat operation.

See [lifecycle](./studio-lifecycle.md), [editing](./studio-editing.md),
[blob lifecycle](./blob-lifecycle.md), [request authority](./request-authority.md)
and [configuration](./configuration.md).
