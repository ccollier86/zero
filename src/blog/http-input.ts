/** Bounded raw JSON transport shared by author and publishing controllers. No body parser consumes a request twice. */
import { AuthError } from '../auth/types';

/** Always settles/cancels the reader, including an interrupted or oversized request. */
export async function readBlogBody(request: Request, maximum = 65536): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || !request.body) {
    throw new AuthError('Expected JSON.', 'BLOG_INVALID_INPUT', 422);
  }
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const next = await reader.read();
      request.signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) throw new AuthError('Blog request is too large.', 'BLOG_INVALID_INPUT', 413);
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new AuthError('Invalid JSON.', 'BLOG_INVALID_INPUT', 422); }
  } finally {
    request.signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Cancellation owns the body lifetime. */ }
  }
}

/** Repeated or unknown query keys are never silently ignored. Numeric coercion is limited to pagination. */
export function readBlogQuery(request: Request, allowed: readonly string[]): Record<string, string | number> {
  const params = new URL(request.url).searchParams, result: Record<string, string | number> = {};
  for (const [key, value] of params) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1 || ['limit', 'offset'].includes(key) && !/^\d{1,6}$/.test(value)) {
      throw new AuthError('Invalid blog query.', 'BLOG_INVALID_INPUT', 422);
    }
    result[key] = ['limit', 'offset'].includes(key) ? Number(value) : value;
  }
  return result;
}
