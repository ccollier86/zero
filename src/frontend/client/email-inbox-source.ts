/** Email transport uses Zero's authenticated fetch; credentials never enter component props. */
import { EMAIL_INBOX_API, type EmailInboxSource, type EmailInboxLiveEvent } from '../../email/inbox/contracts';
import type { FetchInit } from './sdk';

export class EmailInboxRequestError extends Error {
  constructor(message: string, readonly code = 'EMAIL_INBOX_FAILED', readonly outcome: 'none' | 'unknown' = 'none') { super(message); this.name = 'EmailInboxRequestError'; }
}

type EmailFetch = <T = unknown>(path: string, init?: FetchInit) => Promise<T>;
const KNOWN_UNSENT = new Set(['EMAIL_INBOX_INPUT_INVALID', 'EMAIL_INBOX_FORBIDDEN', 'EMAIL_DRAFT_CONFLICT', 'EMAIL_SEND_REJECTED', 'EMAIL_SEND_ID_CONFLICT', 'EMAIL_PROVIDER_REQUEST_REJECTED', 'VALIDATION', 'PARSE']);
export type EmailInboxSdkSurface = EmailInboxSource & { clear(): void };
export function createEmailInboxSource(fetch: EmailFetch): EmailInboxSdkSurface {
  let revision = 0, boundary = new AbortController();
  const request = async <T,>(path: string, body?: unknown, signal?: AbortSignal, raw = false): Promise<T> => {
    const captured = revision;
    signal = signal ? AbortSignal.any([signal, boundary.signal]) : boundary.signal;
    try {
      const result = await fetch<T>(EMAIL_INBOX_API + path, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : structuredClone(body), signal, json: !raw });
      if (captured !== revision) throw new DOMException('Email authorization scope changed.', 'AbortError');
      return result;
    } catch (error) {
      if (signal?.aborted || captured !== revision) throw new DOMException('Email request was retired.', 'AbortError');
      const failure = error as { body?: { error?: string; code?: string }; message?: string };
      const unknown = path === '/send' && !KNOWN_UNSENT.has(failure.body?.code ?? '');
      const code = unknown ? 'EMAIL_SEND_OUTCOME_UNKNOWN' : failure.body?.code ?? 'EMAIL_INBOX_FAILED';
      throw new EmailInboxRequestError(unknown ? 'Send outcome is not confirmed. Check Sent before sending another copy.' : failure.body?.error ?? failure.message ?? 'Email request failed.', code, unknown ? 'unknown' : 'none');
    }
  };
  const source: EmailInboxSdkSurface = {
    clear() { revision++; boundary.abort(); boundary = new AbortController(); },
    accounts: options => request('/accounts', undefined, options?.signal),
    folders: (account, options) => request(`/folders?${new URLSearchParams({ account })}`, undefined, options?.signal),
    list: (account, query, options) => request('/messages', { account, query }, options?.signal),
    read: (account, ref, options) => request('/message', { account, ref }, options?.signal),
    async attachment(account, ref, id, options) { const captured = revision, response = await request<Response>('/attachment', { account, ref, id }, options?.signal, true);
      const blob = await response.blob(); if (captured !== revision || options?.signal?.aborted) throw new DOMException('Email authorization scope changed.', 'AbortError'); return blob; },
    async setFlags(account, ref, flags, options) { await request('/flags', { account, ref, flags }, options?.signal); },
    move: (account, ref, destination, options) => request('/move', { account, ref, destination }, options?.signal),
    getDraft: (account, id, options) => request('/draft/read', { account, id }, options?.signal),
    saveDraft: (account, input, options) => request('/draft/save', { account, ...input }, options?.signal),
    async deleteDraft(account, input, options) { await request('/draft/delete', { account, ...input }, options?.signal); },
    send: (account, input, options) => request('/send', { account, ...input }, options?.signal),
    async *watch(account, folder, options) {
      const captured = revision, abort = new AbortController(), signal = AbortSignal.any([abort.signal, boundary.signal, ...(options?.signal ? [options.signal] : [])]);
      const response = await request<Response>(`/live?${new URLSearchParams({ account, folder })}`, undefined, signal, true);
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new EmailInboxRequestError('Invalid live mail response.');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', afterCR = false;
      // Let the transport's own synchronous abort listener settle first; still
      // retire custom response bodies that do not honor fetch cancellation.
      const cancel = () => { queueMicrotask(() => { void reader.cancel().catch(() => {}); }); }; signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      try {
        while (!signal.aborted && captured === revision) {
          const { value, done } = await reader.read(); if (done) break;
          for (const character of decoder.decode(value, { stream: true })) {
            if (afterCR) { afterCR = false; if (character === '\n') continue; }
            if (character === '\r') { buffer += '\n'; afterCR = true; } else buffer += character;
          }
          if (buffer.length > 256 * 1024) throw new EmailInboxRequestError('Live mail response exceeded its size limit.');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (!data) continue;
            let event: EmailInboxLiveEvent;
            try { event = JSON.parse(data) as EmailInboxLiveEvent; } catch { throw new EmailInboxRequestError('Invalid live mail event.'); }
            if (!event || !['connected', 'resync', 'arrival', 'flags', 'removed'].includes(event.type)) throw new EmailInboxRequestError('Invalid live mail event.');
            if (captured === revision && !options?.signal?.aborted) yield event;
          }
        }
      } finally { signal.removeEventListener('abort', cancel); abort.abort(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
  };
  return Object.freeze(source);
}
