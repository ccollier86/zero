---
id: zero.resources.definitions
type: how-to
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: definitions
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

# Define A Resource

[Resources index](./index.md) · [Documentation index](../../index.md)

A resource is an immutable declaration for a registered table. Its name defaults
to the table name; the table can be a string or typed Schema table. A typed
table supplies its primary key, and an explicit conflicting key is rejected.

## Basic Declaration

```ts
import {
  defineResource, ownerPolicy, tenantRealm,
} from '@zero/framework/resources';

export const notesResource = defineResource({
  table: 'notes',
  exposure: 'all',
  realm: tenantRealm(),
  policy: ownerPolicy({ userField: 'owner_id' }),
});
```

This assumes the app registers a matching notes schema/owner field.
Shared-row mode also requires the declared tenant discriminator; physical tenant
mode retains the logical realm but does not require that extra app column.
Use a Schema Guardian reference when the owner is a canonical user.

## Actions And Policy Maps

Actions are list/get/create/update/delete, all enabled by default.
A common policy applies to each enabled action. A partial per-action policy map
can deliberately give reads and writes different authority; an omitted policy
does not invent a grant for that action. Duplicate/unknown action names and policy
entries for disabled actions are rejected.

```ts
import {
  authenticatedOnly, defineResource, ownerPolicy, tenantRealm,
} from '@zero/framework/resources';

export const sharedReadNotes = defineResource({
  table: 'notes',
  exposure: 'http',
  realm: tenantRealm(),
  policy: {
    list: authenticatedOnly(),
    get: authenticatedOnly(),
    create: ownerPolicy({ userField: 'owner_id' }),
    update: ownerPolicy({ userField: 'owner_id' }),
    delete: ownerPolicy({ userField: 'owner_id' }),
  },
});
```

Here same-organization authenticated users can read, while ownership restricts
writes. It does not make notes public or cross-organization readable.

## Registration

Supply declarations to the managed `resources` array or resource discovery
directory. Definition validation is only the first stage: the
[registry](./registry.md) checks actual schema, auth configuration, exposure,
realm and field compatibility.

See [policies](./policies.md), [field access](./field-access.md) and
[generated CRUD](./crud.md). Keep server policy code out of browser-shared
schema modules when it would import privileged services.
