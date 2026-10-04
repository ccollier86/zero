import { AIError } from './ai-errors';
import {
  aiSafeDownloadAbortReason,
  awaitAISafeDownloadAbortable,
  isAISafeDownloadAbort,
} from './ai-safe-download-cancellation';
import type {
  AISafeDownloadFetch,
  AISafeDownloadFetchInit,
} from './ai-safe-download-contracts';
import {
  remoteAIAssetDownloadFailed,
  remoteAIAssetTooLarge,
} from './ai-safe-download-errors';

export async function fetchAIAssetResponse(
  url: URL,
  fetch: AISafeDownloadFetch,
  init: AISafeDownloadFetchInit,
): Promise<Response> {
  try {
    return await awaitAISafeDownloadAbortable(fetch(url, init), init.signal);
  } catch (error) {
    if (error instanceof AIError) throw error;
    if (isAISafeDownloadAbort(error, init.signal)) {
      throw aiSafeDownloadAbortReason(init.signal);
    }
    throw remoteAIAssetDownloadFailed();
  }
}

export async function readSuccessfulAIAssetResponse(
  response: Response,
  maxBytes: number,
  abortSignal?: AbortSignal,
): Promise<{ data: Uint8Array; mediaType: string | undefined }> {
  if (!response.ok) {
    await cancelAIAssetResponse(response);
    throw remoteAIAssetDownloadFailed();
  }

  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) {
      await cancelAIAssetResponse(response);
      throw remoteAIAssetTooLarge();
    }
  }

  const data = await readBoundedAIAssetBody(response.body, maxBytes, abortSignal);
  return {
    data,
    mediaType: response.headers.get('content-type') ?? undefined,
  };
}

export async function cancelAIAssetResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readBoundedAIAssetBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  abortSignal?: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const chunk = await awaitAISafeDownloadAbortable(reader.read(), abortSignal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw remoteAIAssetTooLarge();
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof AIError) {
      if (error.code === 'AI_REQUEST_ABORTED' || error.code === 'AI_REQUEST_TIMEOUT') {
        await reader.cancel(error).catch(() => undefined);
      }
      throw error;
    }
    if (isAISafeDownloadAbort(error, abortSignal)) {
      throw aiSafeDownloadAbortReason(abortSignal);
    }
    throw remoteAIAssetDownloadFailed();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A rejected read can retain the lock until the stream settles.
    }
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
