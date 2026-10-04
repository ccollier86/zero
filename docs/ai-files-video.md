# AI Hosted Files And Video

Zero exposes AI SDK 7 provider-hosted files and preview video through the
server-side `AIService`. These are provider operations, not browser routes:
applications decide who may call them, enforce live Guardian authority, and
persist any returned locator or operation envelope they need later.

Use [Zero Storage](./sdk-reference.md#storage) for durable app-owned files. Use
`ai.files` when an AI provider must retain and reuse a file by its own opaque
reference. Use `ai.video` when a configured video model should generate media
or expose an asynchronous provider operation.

## Configure Hosted Files And Video

Select a default hosted-file provider and a video model alias in trusted app
configuration:

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  // db, tables, auth...
  ai: {
    filesProvider: 'openai',
    aliases: {
      video: 'google/veo-3.1-fast-generate-preview',
    },
  },
});
```

The equivalent environment overrides are:

```env
ZERO_AI_FILES_PROVIDER=openai
ZERO_AI_VIDEO_MODEL=google/veo-3.1-fast-generate-preview
```

`filesProvider` is a configured Zero provider ID, not an SDK canonical name.
An upload can select another configured provider explicitly. Metadata,
download, and delete operations always use the provider recorded in the file
locator.

`video` is a normal model alias. A provider-qualified model can be supplied on
each request instead. See [AI Providers](./ai-providers.md) for provider
activation and operation-specific capability status.

The public-safe service status reports the selected file provider without
credentials:

```ts
const status = ai.status();

status.filesProvider;
// {
//   providerId: 'openai',
//   active: true,
//   reason: null,
//   operations: { upload: true, metadata: true, download: true, delete: true }
// }
```

`null` means no default files provider was configured. Upload support does not
imply metadata, download, or delete support; Zero checks the individual
operation before making an SDK call.

## Upload A Provider-Hosted File

`ai.files.upload()` accepts bytes, text, or a `ReadableStream<Uint8Array>`:

```ts
import { getAI } from '@zero/framework/server';

const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const uploaded = await ai.files.upload({
  data: {
    type: 'text',
    text: '# Quarterly account report\n...',
  },
  mediaType: 'text/markdown',
  filename: 'account-report.md',
  metadata: { requestId },
});

await saveHostedFileLocator(uploaded.file);
```

The accepted source shapes are:

```ts
{ type: 'data', data: new Uint8Array(...) }
{ type: 'text', text: '...' }
{ type: 'stream', stream: readableByteStream }
```

URL uploads are intentionally excluded. Fetch and validate a remote resource
inside app-owned trusted code, then pass a bounded byte stream. This keeps SSRF
policy and outbound-network authorization at the application boundary.
This restriction is specific to creating a reusable provider-hosted file.
URL-backed image/file message parts use the separate mandatory downloader in
[AI Generation And Streaming](./ai-generation.md#remote-image-and-file-inputs)
when the selected model cannot consume the URL remotely; that path does not
create a hosted-file locator.

Every upload and download defaults to a 64 MiB byte limit, exported as
`AI_DEFAULT_HOSTED_FILE_MAX_BYTES`. `maxBytes` can lower that limit for one
request but cannot exceed the fixed 64 MiB ceiling. Zero validates in-memory
inputs before provider I/O and bounds streams while they are consumed.
Oversized transfers fail with `AI_REQUEST_LIMIT_EXCEEDED`.

Filenames cannot contain path separators or control characters and cannot
exceed 255 UTF-8 bytes. `mediaType` must be a valid media type. Provider
references and provider-returned metadata are validated before Zero exposes
them.

## Persist The Locator, Not Provider Internals

A successful upload returns metadata containing a versioned locator:

```ts
type AIHostedFileLocator = {
  readonly version: 1;
  readonly providerId: string;
  readonly providerReference: Record<string, string>;
};
```

Persist the complete `file` object. `providerId` is the configured Zero
provider ID used for the operation; it may differ from the AI SDK's canonical
provider name. The provider reference is opaque and can gain provider-returned
fields after later metadata or delete operations.

Do not reconstruct a locator from a guessed file ID, and do not discard the
`version` or `providerId`. Zero validates persisted locators before resolving a
provider.

Provider-hosted files remain subject to that provider's retention and expiry
rules. Zero does not copy them into Zero Storage, automatically delete them, or
make them tenant-readable. Persist app metadata and ownership separately, and
call delete explicitly when application policy requires it.

## Inspect, Download, And Delete

```ts
const metadata = await ai.files.metadata({
  file: savedLocator,
  metadata: { requestId },
});

const download = await ai.files.download({
  file: metadata.file,
  maxBytes: 8 * 1024 * 1024,
  metadata: { requestId },
});

for await (const chunk of download.content) {
  await writeChunk(chunk);
}

const deleted = await ai.files.delete({
  file: metadata.file,
  metadata: { requestId },
});
```

The download result contains a bounded, cancellation-aware
`ReadableStream<Uint8Array>`. Transfer telemetry completes only when the stream
closes; cancellation and stream errors are recorded as failures. Consume or
cancel the stream instead of abandoning it unread.

All four methods accept `abortSignal`, optional provider headers and provider
options, and correlation `metadata`. Metadata is sanitized for lifecycle
events, but applications should still keep content and secrets out of it.

## Reuse A Hosted File In A Model Message

Provider-hosted files can be used in text or conversation message content:

```ts
const result = await ai.generateConversation({
  model: 'openai/gpt-4.1',
  instructions: 'Extract the requested account facts.',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Summarize this report.' },
        {
          type: 'file',
          hostedFile: savedLocator,
          mediaType: 'application/pdf',
          filename: 'account-report.pdf',
        },
      ],
    },
  ],
});
```

The locator's `providerId` must equal the configured Zero provider ID selected
by the model reference. Zero checks this before SDK I/O and fails with
`AI_REQUEST_INVALID` on a mismatch. A file uploaded to one provider cannot be
silently sent as an opaque reference to another provider.

`AIService` supplies the resolved provider automatically. Code that calls the
public normalizer directly must state the expected provider:

```ts
import { toModelMessages } from '@zero/framework/server';

const modelMessages = toModelMessages(messages, {
  providerId: 'openai',
});
```

Calling `toModelMessages()` without `providerId` while a hosted locator is
present fails closed. Raw file data and URL-backed message parts keep their
existing behavior and do not require this option.

## Generate Video And Wait For Completion

`ai.video.generate()` runs the SDK's generate-and-poll path and materializes
the completed videos:

```ts
const generated = await ai.video.generate({
  model: 'video',
  prompt: 'A slow aerial orbit around a wind farm at sunrise.',
  aspectRatio: '16:9',
  resolution: '1280x720',
  duration: 8,
  n: 1,
  poll: {
    intervalMs: 2_000,
    timeoutMs: 10 * 60_000,
  },
  metadata: { requestId },
});

for (const video of generated.videos) {
  await persistGeneratedVideo(video);
}
```

`n` and `maxVideosPerCall` are bounded to 1 through 4. Poll intervals are
bounded from 250 ms to 60 seconds, and poll timeouts from 1 second to 24 hours.
Zero validates prompt, frame-image, input-reference, duration, resolution,
aspect-ratio, retry, and aggregate input bounds before provider execution:

| Input | Zero boundary |
| --- | --- |
| `prompt` | Nonblank text up to 1 MiB, or an image prompt with an optional nonblank text instruction. |
| Prompt/frame/reference media | 64 MiB for one in-memory input. |
| `frameImages` | One or two unique `first_frame` / `last_frame` entries. |
| `inputReferences` | 1–16 entries, up to 256 MiB in aggregate. |
| `aspectRatio` | `adaptive` or positive `width:height` components no greater than 10,000. |
| `resolution` | Positive `WIDTHxHEIGHT` dimensions no greater than 16,384. |
| `duration` | Greater than zero and no more than 3,600 seconds. |
| `fps` | Integer from 1 through 120. |
| `seed` | Safe integer. |
| `maxRetries` | Integer from 0 through 10. |

`generateAudio`, provider options, headers, cancellation, and correlation
metadata pass through the typed request after Zero's validation boundary. The
selected provider/model decides which optional video controls it implements.

Each materialized output defaults to the fixed 256 MiB
`AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES` ceiling. `downloadMaxBytes` can lower the
per-output limit but cannot exceed it. Zero downloads provider-returned output
URLs through the same DNS-pinned, redirect-revalidated Bun transport used for
other untrusted AI assets. The same fixed ceiling applies to inline media
returned by a status check.

Video remains an AI SDK preview surface. A catalog flag means the adapter has
a video surface; the selected model and provider operation still determine
whether synchronous generation or asynchronous start/status is available.

## Start A Durable Video Operation

Long-running jobs should start the provider operation and persist the complete
Zero envelope:

```ts
const started = await ai.video.start({
  model: 'video',
  prompt: 'Animate the approved storyboard.',
  webhookUrl: 'https://app.example.com/hooks/video',
  metadata: { runId },
});

await saveVideoOperation(started.operation);
```

The operation shape is:

```ts
type AIVideoOperationEnvelope = {
  readonly version: 1;
  readonly resolvedModel: string; // exact provider/model, never an alias
  readonly operation: JSONValue;  // opaque provider state
};
```

Persist the whole envelope. It is bounded, deeply snapshotted, and pinned to
the provider/model resolved at start time. A later alias change must not move
an in-flight operation to another model.

Check it later with:

```ts
const status = await ai.video.status({
  operation: savedOperation,
  inlineVideoMaxBytes: 64 * 1024 * 1024,
  metadata: { runId },
});
```

`status()` performs one provider status check. It resolves the envelope's
`resolvedModel` directly and deliberately ignores current alias configuration.
The application or a Torrent workflow owns polling cadence, persistence,
retries between checks, and terminal result storage.

Webhook URLs must use HTTPS. Plain HTTP is accepted only for localhost during
non-production development. Treat webhook payloads as untrusted provider
input, authenticate them according to provider guidance, and correlate them
to the persisted operation on the server.

`start()` accepts one validated `webhookUrl`. The synchronous `generate()`
surface instead accepts an SDK webhook factory returning `{ url, received }`;
Zero validates the returned URL if the model uses the factory. Keep both forms
in trusted server code rather than accepting arbitrary callback URLs from a
browser.

## Authorization And Persistence Boundaries

`AIService.files` and `AIService.video` do not mount public endpoints. A route,
tool, activity, or workflow that exposes them must:

1. Resolve the live Guardian actor and tenant.
2. Check application permissions before each sensitive operation.
3. Load locators and operation envelopes through server-owned tenant scope.
4. Prevent one tenant from supplying another tenant's persisted reference.
5. Revalidate authority before irreversible upload, delete, or materialization
   effects.
6. Keep provider headers, credentials, approval data, and webhook secrets out
   of client-controlled metadata.

Provider binding prevents accidental cross-provider reference use; it is not
tenant authorization. Fabric placement, row ownership, and storage policy
remain application concerns.

## Errors And Observability

These methods use the standard `AIError` contract. Important codes include:

| Code | Meaning |
| --- | --- |
| `AI_REQUEST_INVALID` | Invalid locator/envelope, provider mismatch, malformed option, or unsafe URL. |
| `AI_REQUEST_LIMIT_EXCEEDED` | Upload, download, prompt, media input, or generated output exceeded a fixed bound. |
| `AI_CAPABILITY_NOT_SUPPORTED` | The configured provider/model lacks the requested operation. |
| `AI_REQUEST_ABORTED` | The request or transfer was cancelled. |
| `AI_PROVIDER_RESPONSE_INVALID` | The provider returned malformed metadata, references, media, or operation state. |

Lifecycle events contain provider/model identity, operation type, duration, and
safe correlation metadata. They do not contain uploaded bytes, prompts,
generated video, hosted-file references, provider options, or credentials. See
[Observability](./observability.md) for sink and redaction behavior.

## Related Documentation

- [AI](./ai.md)
- [AI Providers](./ai-providers.md)
- [AI Generation And Streaming](./ai-generation.md)
- [AI Conversations](./ai-conversations.md)
- [AI Tools](./ai-tools.md)
- [AI Agents](./ai-agents.md)
- [Torrent: Durable Workflows](./workflows.md)
- [Zero Storage](./sdk-reference.md#storage)
- [Observability](./observability.md)
