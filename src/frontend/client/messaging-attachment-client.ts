/** Native binary attachment facade. Reuses the SDK's auth/session generation; mutations are never automatically retried. */
import { MESSAGING_API, type MessagingMutationOptions } from '../../messaging/contracts';
import { MESSAGING_ATTACHMENT_MIMES, type BrowserMessagingAttachmentsApi, type MessagingAttachment } from '../../messaging/attachment-contracts';
export type MessagingBinaryTransport = (path: string, init: RequestInit) => Promise<Response>;
type Call = <T>(path: string, method: string, body?: unknown, signal?: AbortSignal, requestId?: string, validate?: (value: unknown) => void) => Promise<T>;
/** Only display contracts are checked here; the native server owns all current membership/scope decisions. */
export function assertMessagingAttachment(value: unknown): asserts value is MessagingAttachment {
  const r = value as Partial<MessagingAttachment> | null;
  if (!r || typeof r !== 'object' || ![r.id, r.conversationId].every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id))
    || typeof r.fileName !== 'string' || r.fileName.length > 180 || /[/\\\p{Cc}\p{Cs}]/u.test(r.fileName)
    || !(MESSAGING_ATTACHMENT_MIMES as readonly unknown[]).includes(r.mimeType) || typeof r.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(r.checksum)
    || !Number.isSafeInteger(r.sizeBytes) || r.sizeBytes! < 1 || r.sizeBytes! > 256 * 1024 * 1024
    || !['conversation', 'staff'].includes(r.visibility!) || !['allocated', 'ready', 'removing', 'removed'].includes(r.state!)
    || !Number.isSafeInteger(r.createdAt) || r.createdAt! < 0 || !Number.isSafeInteger(r.expiresAt) || r.expiresAt! < r.createdAt!
    || r.messageId !== null && (typeof r.messageId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(r.messageId))) throw new Error('Invalid private messaging attachment response.');
}
/** Reads a small native acknowledgment/error; neither an unbounded body nor provider details become an SDK error. */
async function acknowledgment(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('Attachment acknowledgment is unavailable.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; size += next.value.byteLength; if (size > 8192) throw new Error('Attachment acknowledgment is too large.'); chunks.push(next.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function createMessagingAttachmentClient(call: Call, raw: MessagingBinaryTransport | undefined, boundary: () => AbortSignal): BrowserMessagingAttachmentsApi {
  const path = (conversationId: string, id?: string) => '/conversations/' + encodeURIComponent(conversationId) + '/attachments' + (id ? '/' + encodeURIComponent(id) : '');
  const key = (opts: MessagingMutationOptions) => { if (!opts || typeof opts.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(opts.requestId)) throw new Error('A stable messaging requestId is required.'); return opts.requestId; };
  const active = (signal?: AbortSignal) => AbortSignal.any([boundary(), AbortSignal.timeout(10 * 60000), ...(signal ? [signal] : [])]);
  return Object.freeze<BrowserMessagingAttachmentsApi>({
    allocate: (conversationId, input, opts) => call(path(conversationId), 'POST', input, opts.signal, key(opts), assertMessagingAttachment),
    get: (conversationId, id, opts) => call(path(conversationId, id), 'GET', undefined, opts?.signal, undefined, assertMessagingAttachment),
    remove: (conversationId, id, opts) => call(path(conversationId, id), 'DELETE', undefined, opts.signal, key(opts)),
    async upload(conversationId, id, body, opts) {
      if (!raw) throw new Error('Binary messaging upload requires the native Zero SDK transport.');
      const requestId = key(opts), signal = active(opts.signal); signal.throwIfAborted();
      const response = await raw(MESSAGING_API + path(conversationId, id) + '/content', { method: 'PUT', body: body instanceof Uint8Array ? new Blob([Uint8Array.from(body).buffer]) : body,
        headers: { 'Content-Type': 'application/octet-stream', 'Idempotency-Key': requestId }, signal, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
      const value = await acknowledgment(response, signal); signal.throwIfAborted();
      if (!response.ok) throw Object.assign(new Error('Messaging attachment upload was not accepted; retain the allocation and original request identity.'), { status: response.status,
        ...(value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' && /^[A-Z][A-Z_]{1,100}$/.test(value.code) ? { code: value.code } : {}),
        ...(value && typeof value === 'object' && 'outcome' in value && value.outcome === 'unknown' ? { outcome: 'unknown', requiresSameIdempotencyKey: true } : {}) });
      assertMessagingAttachment(value);
      if (value.id !== id || value.conversationId !== conversationId || value.state !== 'ready') throw new Error('Attachment upload acknowledgment is invalid; reconcile its original allocation.');
      return value;
    },
    async download(conversationId, id, opts) {
      if (!raw) throw new Error('Binary messaging download requires the native Zero SDK transport.');
      const signal = active(opts?.signal), asset = await call<MessagingAttachment>(path(conversationId, id), 'GET', undefined, signal, undefined, assertMessagingAttachment);
      if (asset.state !== 'ready') throw new Error('Messaging attachment is not ready.');
      const response = await raw(MESSAGING_API + path(conversationId, id) + '/content', { signal, cache: 'no-store' });
      if (!response.ok || !response.body || response.headers.get('Content-Type') !== asset.mimeType) { await response.body?.cancel().catch(() => {}); throw Object.assign(new Error('Private messaging attachment is unavailable.'), { status: response.status }); }
      const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
      try {
        for (;;) { signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; size += next.value.byteLength;
          if (size > asset.sizeBytes) throw new Error('Attachment exceeds its declared size.'); chunks.push(Uint8Array.from(next.value)); }
        if (size !== asset.sizeBytes) throw new Error('Attachment download was interrupted.');
        const blob = new Blob(chunks, { type: asset.mimeType }), hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); signal.throwIfAborted();
        const checksum = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (checksum !== asset.checksum) throw new Error('Attachment integrity verification failed.');
        return blob;
      } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
  });
}
