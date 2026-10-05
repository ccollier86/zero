---
id: zero.storage.studio-provisioning
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: studio-provisioning
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

# Provision Owner-Bound Drives

[Storage index](./index.md) · [Documentation index](../../index.md)

Studio derives owner/scope identity from current Guardian authority.
The caller chooses organization or personal; it cannot choose an arbitrary
ownerId/tenantId.

## Durable Request

```ts
import type { StorageStudioProvisionRequest } from '@zero/framework/storage';
export const request: StorageStudioProvisionRequest = {
  operationId: 'provision-example-1',
  owner: 'organization',
  key: 'workflow-files',
  name: 'Workflow files',
  creatorAccess: 'admin',
  public: false,
};
```

This is the server request shape. The browser SDK accepts the same request
without operationId and takes that ID in mutation options (see
[client integration](./client-integration.md)).

key is an immutable lowercase machine identity (up to100 characters, beginning
with a letter; letters/digits/underscore/hyphen).
Name is mutable display text, not the namespace/owner identity.

## Atomic Admission

Provision checks owner eligibility, current permission, count/size/MIME/public
policy and stable operation intent. It creates the engine drive/profile and
configured creator/default ACLs with its durable operation record.

Retain operationId for the same logical retry. Reuse with a different intent
conflicts; two unrelated provision requests must not share an ID.
Concurrent owner/key conflicts fail instead of creating duplicate drives.

## Result And Readiness

A receipt reports operationId/replayed/value with the safe drive/profile/control
projection. A profile's lifecycle/revision/generation describes actual state;
don't treat a provider timeout as ready merely because a drive ID exists.

Normal shared-CAS provisioning is local metadata work; external recovery hooks
are explicit advanced integration.
See [editing](./studio-editing.md), [quotas](./studio-quotas.md),
[providers](./studio-providers.md), [errors](./errors.md) and
[authority](./studio-authority.md).
