/** Optional first-party transport for an independently operated append-only checkpoint custodian. */
import type { LoggingCustodyStore, SignedLoggingCheckpoint } from './logging-custody-contracts';
import { LoggingError } from './logging-error';
import { loggingId, loggingRecord } from './logging-validation';

/** No implicit environment, redirects, cookie auth, provider fallback or application bootstrap. */
export function createHttpLoggingCustodyStore(options: { identity: string; endpoint: string; apiKey: string }): LoggingCustodyStore {
  let endpoint: string, identity: string, apiKey: string;
  try {
    identity = loggingId(options.identity)!;
    const url = new URL(options.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    if (typeof options.apiKey !== 'string' || !options.apiKey || options.apiKey.length > 8192 || /[\r\n]/.test(options.apiKey)) throw new Error();
    endpoint = url.href.replace(/\/$/, ''); apiKey = options.apiKey;
  } catch { throw new LoggingError('LOGGING_CONFIG_INVALID', 'Independent custody requires an HTTPS endpoint and an explicit credential.'); }
  const request = async (path: string, body: unknown, signal: AbortSignal): Promise<unknown> => {
    let response: Response;
    try {
      signal.throwIfAborted();
      response = await fetch(endpoint + path, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    } catch { throw new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'Independent custody transport is unavailable.', 'unknown'); }
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) {
      await response.body?.cancel(); throw new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'Independent custody did not acknowledge the request.', 'unknown');
    }
    const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; bytes += next.value.byteLength;
        if (bytes > 8192) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Independent custody response exceeds its limit.'); chunks.push(next.value); }
      const value = loggingRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), ['checkpoint']);
      return value.checkpoint;
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof LoggingError) throw error;
      throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Independent custody response is invalid.', 'unknown');
    } finally { try { reader.releaseLock(); } catch { /* Preserve the actual transport or validation result. */ } }
  };
  return Object.freeze({ identity,
    read: (ledgerId, stream, signal) => request('/checkpoint/read', { ledgerId, stream }, signal) as Promise<SignedLoggingCheckpoint | null>,
    append: (checkpoint, expectedDigest, signal) => request('/checkpoint/append', { checkpoint, expectedDigest }, signal) as Promise<SignedLoggingCheckpoint>,
  } satisfies LoggingCustodyStore);
}
