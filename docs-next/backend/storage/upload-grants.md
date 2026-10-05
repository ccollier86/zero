---
id: zero.storage.upload-grants
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: upload-grants
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

# Accept A Bounded Public Upload

[Storage index](./index.md) · [Documentation index](../../index.md)

An upload grant lets app-owned trusted code issue one exact-path bearer
capability without making a drive publicly writable.

## Request

```ts
import type { CreateUploadGrantParams } from '@zero/framework/storage';
export const request: CreateUploadGrantParams = {
  path: '/answers/document.pdf',
  expiresIn: 300,
  maxSize: 5 * 1024 * 1024,
  contentType: 'application/pdf',
  overwrite: false,
  public: false,
  flow: 'document-answer',
  resource: { type: 'workflow', id: 'example-run-id' },
};
```

The app must authorize the real drive/resource linkage and choose the path.
A resource label is correlation metadata, not automatic workflow-owner authority.
Issue through the scoped storage service/route, not a browser-held signing secret.

## Response And Consumption

The result contains token, grantId, driveId/path, expiry and admitted constraints.
PUT /storage/upload-grants/:token accepts the public body under that exact
capability. Detected MIME, byte ceilings, current lifecycle/generation and
reservation policy still apply.

contentType or contentTypes can constrain MIME; overwrite defaults false and
public defaults false. Optional metadata/flow/resource are app values subject to
bounded normalization.
The grant is not automatically a single-use token merely because one upload
was intended; enforce any business single-use/correlation rule in app code.

## Streaming And Lifecycle

Use actual declared/streamed sizes for quota admission. A successful
publication followed by failed metadata must be reconciled, not treated as an
accepted logical object. Stop/cancel uses the adapter's real cooperative/durable
handoff contract.

Never include token/body contents in logs.
See [quotas](./studio-quotas.md), [capabilities](./capabilities.md),
[blob lifecycle](./blob-lifecycle.md), [request authority](./request-authority.md)
and [errors](./errors.md).
