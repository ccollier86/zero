/** Bounded native JSON/query transport. Bodies have one owner; invalid UTF-8, duplicate query keys and unknown selectors fail closed. */
import { AuthError } from '../auth/types';
export async function readMessagingBody(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || !request.body) throw invalid();
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) { request.signal.throwIfAborted(); const { done, value } = await reader.read(); request.signal.throwIfAborted(); if (done) break;
      size += value.byteLength; if (size > 128 * 1024) throw new AuthError('The messaging request exceeds its byte limit.', 'MESSAGING_INPUT_INVALID', 413); chunks.push(value); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
  } finally { request.signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function readMessagingQuery(request: Request, allowed: readonly string[]): Record<string, string | number | boolean> {
  const params = new URL(request.url).searchParams, result: Record<string, string | number | boolean> = {};
  for (const [key, value] of params) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1 || value.length > 512) throw invalid();
    if (['before', 'limit'].includes(key) || key === 'after' && allowed.includes('before')) { if (!/^\d{1,16}$/.test(value)) throw invalid(); result[key] = Number(value); }
    else if (key === 'archived') { if (!['true', 'false'].includes(value)) throw invalid(); result[key] = value === 'true'; }
    else result[key] = value;
  }
  return result;
}
function invalid() { return new AuthError('The messaging request is invalid.', 'MESSAGING_INPUT_INVALID', 422); }
