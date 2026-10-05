---
id: zero.ai.video
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: video
maturity: preview
applies_to: ["2.1.1 source plus uncommitted video integrity corrections"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---


# Preview Video Generation And Operations

[Zero AI](./index.md) · [Media](./media.md) · [Documentation index](../../index.md)

Video is an explicitly preview API. AIService.video exposes generate, start
and status over capable configured SDK 7 models. This guide includes the
working-source result-integrity correction from 2026-10-05: generated results
cannot exceed the admitted requested count, and completed materialized/inline
binary/base64 media cannot be empty. The corrected source has not yet been
assigned a new committed package baseline.

## Choose Materialized Versus Asynchronous Execution

| Method | Result | Responsibility |
| --- | --- | --- |
| video.generate(request) | Materialized SDK GenerateVideoResult | Zero validates output and bounds each downloaded file; the caller stores/serves authorized media. |
| video.start(request) | Start result with a versioned Zero operation envelope | The caller persists the operation with ownership/correlation and owns notification/poll cadence. |
| video.status({ operation }) | One pending/completed/error status | Uses the envelope's pinned model; does not schedule durable polling or automatically download returned URLs. |

generate supports a native doGenerate model or an asynchronous doStart/doStatus
pair. start/status require that asynchronous pair. A provider catalog flag
alone does not imply all its video models support every method.

## Generate A Video

This complete server-side helper assumes a configured video alias and an
authorized actor. No browser/provider key or public route is created.

```ts
import { type AIService } from "@zero/framework/ai";

export async function generateClip(ai: AIService, signal?: AbortSignal) {
  const result = await ai.video.generate({
    prompt: "A slowly rotating blue cube against a plain background.",
    n: 1,
    duration: 5,
    fps: 24,
    downloadMaxBytes: 32 * 1024 * 1024,
    maxRetries: 0,
    abortSignal: signal,
  });
  return {
    bytes: result.video.uint8Array,
    mediaType: result.video.mediaType,
  };
}
```

model defaults to the video alias. n defaults to 1 and admits 1–4;
maxVideosPerCall, when supplied, also admits 1–4. The result contains video,
videos, warnings, responses and providerMetadata. video is the first returned
item; the response can contain fewer than requested videos, but cannot exceed
the admitted count. Returned bytes and metadata are detached before exposure.

## Common Controls And Input Bounds

Common generate/start options are model, prompt, n, maxVideosPerCall,
aspectRatio, resolution, duration, fps, seed, frameImages, inputReferences,
generateAudio, providerOptions, maxRetries, abortSignal, headers and metadata.

- Prompt is nonblank text, or an image plus optional text; text is limited to
  1 MiB. Binary/string image and reference inputs are bounded to 64 MiB each.
- frameImages contains one or two unique first_frame/last_frame entries.
- inputReferences contains 1–16 entries, either raw data or data/mediaType
  objects; that reference list has a 256 MiB aggregate bound.
- fps is an integer 1–120. duration is finite, positive and at most 3,600 seconds.
  seed is a safe integer.
- aspectRatio is adaptive or positive integer ratios up to 10,000 per side.
  resolution is an integer WxH with each dimension 1–16,384.
- maxRetries is an integer 0–10. Headers and provider options use the shared
  snapshot and JSON bounds in [generation controls](./generation-controls.md).

These are portable admission boundaries, not proof a specific model supports
a setting. There is no single combined input-byte quota across prompt,
frameImages and the reference list; the documented per-input/list boundaries
are the actual implementation.

downloadMaxBytes defaults to the exported 256 MiB
AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES and may be lowered to a positive safe
integer. It is a per-file ceiling, not an aggregate limit across all videos.
Oversized output rejects AI_REQUEST_LIMIT_EXCEEDED; malformed response/count or
empty media rejects AI_PROVIDER_RESPONSE_INVALID.

## Durable Operation Envelope And Alias Changes

start replaces the SDK's opaque operation reference with:

```ts
{
  version: 1,
  resolvedModel: "configured-provider/provider-model",
  operation: { /* provider's JSON operation value */ },
}
```

This is a shape illustration, not an operation accepted by a real provider.
The envelope pins the fully qualified model, not the mutable video alias.
status resolves that pinned model without consulting current aliases; changing
an alias cannot silently send an existing job to another provider/model.

Operation values must be finite plain JSON, at most 1 MiB, depth 64 and
10,000 visited nodes. Preserve the complete returned envelope in an
authority-bound app row or Torrent private memory. Zero does not automatically
create that row, claim the operation for an actor, or persist provider job IDs.

## Polling And Webhooks

generate may accept poll intervalMs (250–60,000), timeoutMs
(1,000–86,400,000), and an optional delay function. A supplied interval cannot
exceed the supplied timeout. Omitted controls retain SDK defaults rather than
installing a persisted Zero scheduler.

generate can accept an asynchronous webhook factory returning a provider-facing
url and a received promise. start can accept webhookUrl. HTTPS is required
normally; explicitly allowed development localhost HTTP is controlled by the
service context, defaulting to allowed outside production.

URL validation is not incoming webhook signature verification or ownership
correlation. The app must authenticate provider callbacks and bind them to the
correct operation/invocation. A broad notification must not resume every
waiting workflow. For a durable poll/wait use the app's versioned Torrent
handlers, exact run correlation and private operation state.

## Status Results And Privacy

status returns pending, completed or error after one provider check. Completed
videos may be URL, binary or base64 data. inlineVideoMaxBytes applies to inline
binary/base64 items up to 256 MiB; URLs must be HTTP(S) and are not automatically
materialized. Treat URL access, retention and any subsequent download as
separate product decisions.

An error status carries the provider's terminal error string. That is trusted
service result data, not automatically a safe public HTTP message. Provider
metadata may contain job identifiers or webhook signing secrets. Standard
telemetry excludes those values; do not serialize full results into public
logs.

## Verification And Related Guides

The focused synthetic video suite verifies alias pinning, secret-safe
telemetry, request snapshots/controls, byte/count/empty-output rejection and
asynchronous capability admission. It does not qualify provider accounts,
pricing or real media. Use [security](./security.md) for remote download policy,
[operations](./operations.md) for safe error handling, and
[Torrent integration](./torrent-integration.md) for workflow ownership.
