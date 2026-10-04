/**
 * ai-safe-download.ts
 *
 * Orchestrates one untrusted AI asset download. URL/address policy,
 * cancellation, and bounded response reading live behind focused helpers.
 */

import {
  combineAISafeDownloadAbortSignals,
  throwIfAISafeDownloadAborted,
} from './ai-safe-download-cancellation';
import type {
  AISafeDownloadFetch,
  AISafeDownloadFetchInit,
  AISafeDownloadTransportOptions,
  AISafeSingleDownload,
} from './ai-safe-download-contracts';
import {
  assertAISafeDownloadByteLimit,
  invalidRemoteAIAsset,
} from './ai-safe-download-errors';
import {
  cancelAIAssetResponse,
  fetchAIAssetResponse,
  readSuccessfulAIAssetResponse,
} from './ai-safe-download-response';
import {
  assertSafeAIAssetUrl,
  isAIAssetAddressLiteral,
  lookupAIAssetHostnameWithBun,
  normalizeAIAssetHostname,
  pinPublicAIAssetAddress,
} from './ai-safe-download-url-policy';

export type {
  AISafeDownloadFetch,
  AISafeDownloadFetchInit,
  AISafeDownloadResolvedAddress,
  AISafeDownloadTransportOptions,
  AISafeSingleDownload,
} from './ai-safe-download-contracts';
export { createAISafeDownloadScope } from './ai-safe-download-cancellation';

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Create a bounded single-asset download hook without relying on Node APIs. */
export function createAISafeDownload(
  options: AISafeDownloadTransportOptions,
): AISafeSingleDownload {
  const maxBytes = assertAISafeDownloadByteLimit(options.maxBytes);
  return async (request) => {
    const scope = combineAISafeDownloadAbortSignals(
      options.abortSignal,
      request.abortSignal,
    );
    try {
      return await downloadAISafeAsset(request.url, {
        maxBytes,
        abortSignal: scope.signal,
        lookup: options.lookup ?? lookupAIAssetHostnameWithBun,
        fetch: options.fetch ?? (globalThis.fetch as AISafeDownloadFetch),
      });
    } finally {
      scope.dispose();
    }
  };
}

/** Download one URL after validating and pinning every redirect hop. */
export async function downloadAISafeAsset(
  initialUrl: URL,
  options: Required<Pick<AISafeDownloadTransportOptions, 'maxBytes'>> &
    Pick<AISafeDownloadTransportOptions, 'abortSignal'> & {
      readonly lookup: NonNullable<AISafeDownloadTransportOptions['lookup']>;
      readonly fetch: AISafeDownloadFetch;
    },
): Promise<{ data: Uint8Array; mediaType: string | undefined }> {
  assertAISafeDownloadByteLimit(options.maxBytes);
  let current = new URL(initialUrl);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    throwIfAISafeDownloadAborted(options.abortSignal);
    assertSafeAIAssetUrl(current);
    if (current.protocol === 'data:') {
      const response = await fetchAIAssetResponse(current, options.fetch, {
        redirect: 'error',
        signal: options.abortSignal,
      });
      return readSuccessfulAIAssetResponse(
        response,
        options.maxBytes,
        options.abortSignal,
      );
    }

    const pinned = await pinPublicAIAssetAddress(
      current,
      options.lookup,
      options.abortSignal,
    );
    const init: AISafeDownloadFetchInit = {
      headers: new Headers({ host: current.host }),
      redirect: 'manual',
      signal: options.abortSignal,
      ...(current.protocol === 'https:' && !isAIAssetAddressLiteral(current.hostname)
        ? { tls: { serverName: normalizeAIAssetHostname(current.hostname) } }
        : {}),
    };
    const response = await fetchAIAssetResponse(pinned, options.fetch, init);

    if (!REDIRECT_STATUSES.has(response.status)) {
      return readSuccessfulAIAssetResponse(
        response,
        options.maxBytes,
        options.abortSignal,
      );
    }

    current = await resolveRedirect(current, response, redirects);
  }

  throw invalidRemoteAIAsset('Remote AI input exceeded the redirect limit.');
}

async function resolveRedirect(
  current: URL,
  response: Response,
  redirects: number,
): Promise<URL> {
  if (redirects === MAX_REDIRECTS) {
    await cancelAIAssetResponse(response);
    throw invalidRemoteAIAsset('Remote AI input exceeded the redirect limit.');
  }
  const location = response.headers.get('location');
  await cancelAIAssetResponse(response);
  if (!location) {
    throw invalidRemoteAIAsset('Remote AI input returned an invalid redirect.');
  }
  try {
    return new URL(location, current);
  } catch {
    throw invalidRemoteAIAsset('Remote AI input returned an invalid redirect.');
  }
}
