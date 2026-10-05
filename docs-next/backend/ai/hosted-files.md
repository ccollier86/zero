---
id: zero.ai.hosted-files
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: provider-hosted-files
maturity: supported
applies_to: ["2.1.1 source baseline"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Provider-Hosted Files

[Zero AI](./index.md) · [Providers](./providers.md) · [Documentation index](../../index.md)

Use ai.files for providers that upload reusable assets into their own account
storage. A hosted locator lets later AI calls refer to that asset without
resending its bytes. This is **not Zero Storage**: it does not provision a drive,
assign user/organization ownership, enforce your product's retention or create
a browser download route.

The app must authorize the source file, persist the returned locator under the
right owner, and authorize every later metadata/download/delete/use action.
Do not accept an arbitrary user-supplied locator as proof that they own that
provider file.

## Upload And Reuse

Complete function with an already configured files-capable app-bound service:

```ts
import type { AIService } from '@zero/framework/ai';

export async function uploadAndDescribe(ai: AIService, bytes: Uint8Array) {
  const uploaded = await ai.files.upload({
    provider: 'primary',
    data: { type: 'data', data: bytes },
    mediaType: 'application/pdf',
    filename: 'synthetic-note.pdf',
  });
  const result = await ai.generateText({
    model: 'primary/<provider-model-id>',
    prompt: undefined,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this supplied document.' },
        {
          type: 'file', hostedFile: uploaded.file,
          mediaType: 'application/pdf', filename: 'synthetic-note.pdf',
        },
      ],
    }],
  });
  return { file: uploaded.file, text: result.text };
}
```

Replace the model placeholder with a compatible account model. The function
assumes the caller already authorized bytes and provider usage; it makes real
provider writes when invoked. No such call was made to qualify this guide.

The model's configured Zero provider ID must equal uploaded.file.providerId.
A Gateway model and a direct-provider model are different bindings even if they
ultimately use the same vendor. Do not edit a locator to bypass that check.

## Methods And Controls

AIService.files implements AIHostedFilesService:

| Method | Request | Result |
| --- | --- | --- |
| upload | provider?, tagged data, mediaType, filename?, maxBytes? plus common controls | AIHostedFileMetadata with a new bound locator. |
| metadata | file plus common controls | Validated metadata and possibly updated provider reference fields. |
| download | file, maxBytes? plus common controls | AIHostedFileDownload with bounded content:ReadableStream<Uint8Array>. |
| delete | file plus common controls | AIHostedFileDeleteResult with provider acknowledgement deleted:boolean. |

Common options are abortSignal, headers, providerOptions and metadata.
upload selects an explicit provider, otherwise ai.filesProvider or its
ZERO_AI_FILES_PROVIDER configuration fallback. Metadata/download/delete use the
locator's provider ID, not a model alias or caller-selected replacement.

File operation support is both advertised capability and an actual SDK files
method. A provider with uploads does not automatically support metadata,
download or delete. Inspect getStatus().filesProvider.operations before building
controls, and still handle live operation failure. No selected/configured/active
provider uses the corresponding AI_PROVIDER_NOT_CONFIGURED or
AI_PROVIDER_NOT_ACTIVE error; unsupported operations use AI_CAPABILITY_NOT_SUPPORTED.

## Upload Sources And Bounds

| Tagged source | Meaning |
| --- | --- |
| {type:'data',data:Uint8Array} | Copied bytes; not ArrayBuffer in this API. |
| {type:'text',text:string} | UTF-8 text. |
| {type:'stream',stream:ReadableStream<Uint8Array>} | An unlocked byte stream, bounded while consumed. |

URLs are intentionally not an upload source. If an app needs remote acquisition,
it must do so through an authorized safe download boundary before upload;
do not replace that with unrestricted user-directed fetch.

maxBytes defaults to the public AI_DEFAULT_HOSTED_FILE_MAX_BYTES constant
(64 MiB). It may reduce that ceiling but cannot exceed it; valid values are
safe integers1 through 67,108,864. Text bytes are measured as UTF-8, not characters.
Non-byte stream chunks are invalid. Crossing the limit cancels the source and
fails with AI_REQUEST_LIMIT_EXCEEDED. Any unread upload source is cancelled after
provider success/failure rather than retained indefinitely.

mediaType is required and validated as a nonempty IANA-shaped media type,
at most 255 characters without control characters. filename is optional and
nonempty when provided: no path separators/control characters, no . or ..,
at most 255 UTF-8 bytes. It is a provider filename, not a filesystem destination.

## Locator And Metadata

AIHostedFileLocator is {version:1,providerId,providerReference}. It preserves
the configured Zero provider identity and the vendor's opaque reference map.
Persist the returned object intact in app-owned authorized storage; its shape is
portable, but the file itself remains in that provider/account.

Reference validation requires a nonempty plain map of at most 32 string entries,
nonempty key/value data, keys at most 255 UTF-8 bytes and values at most 16 KiB,
without forbidden prototype/type keys or control characters. Metadata/update
responses merge new provider reference entries without dropping old ones while
retaining the Zero provider ID.

Metadata contains file, optional filename/mediaType/byteSize/createdAt/expiresAt,
warnings and optional providerMetadata. Returned dates and structured metadata
are validated/detached. Provider metadata may still be sensitive app data: a
validated result is not a blanket public logging payload. Metadata byteSize is
not a claim that a future download fits its selected transfer ceiling.

## Download Lifecycle

download resolves when its bounded stream is available; obtaining headers is
not a completed transfer. Standard telemetry completes only after stream close.
Cancellation, abort and stream failure settle the transfer with a corresponding
failure and release the reader. Producers may reuse buffers; delivered chunks
are detached before consumption.

Complete bounded-download helper:

```ts
import type { AIService, AIHostedFileLocator } from '@zero/framework/ai';

export async function downloadHostedFile(ai: AIService, file: AIHostedFileLocator) {
  const download = await ai.files.download({ file, maxBytes: 8 * 1024 * 1024 });
  return new Uint8Array(await new Response(download.content).arrayBuffer());
}
```

This buffers only within its 8MiB request ceiling. A route may instead return
the stream after authorizing its owner. Cancel an abandoned download or abort
its signal; do not keep a live provider stream when its client no longer needs it.

delete returns the provider's boolean acknowledgement, not a promise that every
reference retained by the app was removed or an app database transaction
committed. Coordinate your product's metadata/retention and retry/idempotency
semantics around that external operation.

## Verification And Related Guides

Use local files-provider doubles to cover byte/text/stream inputs, exact ceilings,
malformed metadata/locators, cross-provider mismatch, unsupported operations,
stream close/cancel/error and unread-source cleanup. No provider account/file
was created or deleted for this guide's qualification.

[Configuration](./configuration.md) selects the files provider.
[Conversations](./conversations.md#normalize-for-trusted-model-integrations)
describes direct message normalization and required provider binding.
[Providers](./providers.md) separates operation flags from real methods.
Return to [Zero AI](./index.md) for model execution and durable use.
