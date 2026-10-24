/** Browser-only transport: no Stripe SDK, server registry, secrets or persisted billing cache. */
import type { ScopedPayments, PaymentsReadiness } from './contracts';

export type PaymentsClient = Omit<ScopedPayments, 'status'> & { status(): Promise<PaymentsReadiness> };
export interface PaymentsClientTransport {
  request<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal; json?: boolean }): Promise<T>;
  /** AuthClient/Guardian data-boundary identity. In-flight results cannot cross a scope transition. */
  boundary?: () => { key: string; ready: boolean };
  subscribeBoundary?: (callback: () => void) => () => void;
}
export class PaymentsClientError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'PaymentsClientError'; }
}
export function createPaymentsClient(transport: PaymentsClientTransport, options: { basePath?: string } = {}): PaymentsClient {
  const prefix = options.basePath ?? '/api/_zero/payments';
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.endsWith('/')) throw new PaymentsClientError('Invalid payments API path.', 'PAYMENTS_INPUT_INVALID');
  const boundary = () => transport.boundary?.() ?? { key: '', ready: true };
  const check = (key: string) => { const current = boundary(); if (!current.ready || current.key !== key) throw new PaymentsClientError('Billing authority changed. Discard this result and reload billing for the active scope.', 'PAYMENTS_AUTHORITY_CHANGED'); };
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const key = boundary().key; check(key);
    const value = await transport.request<T>(prefix + path, body === undefined ? undefined : { method: 'POST', body });
    check(key); return value;
  };
  const id = (value: string) => encodeURIComponent(value);
  const query = (input: object = {}) => { const params = new URLSearchParams(); for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value)); return params.size ? '?' + params : ''; };
  return {
    status: () => request('/status'), catalog: () => request('/catalog'), snapshot: () => request('/snapshot'),
    customers: { ensure: input => request('/customers/ensure', input) },
    operations: { read: value => request('/operations/' + id(value)) },
    checkout: { create: input => request('/checkout', input), read: value => request('/checkout/' + id(value)) },
    portal: { create: input => request('/portal', input) },
    subscriptions: { list: () => request('/subscriptions'), preview: input => request('/subscriptions/preview', input), change: input => request('/subscriptions/change', input), cancel: input => request('/subscriptions/cancel', input), resume: input => request('/subscriptions/resume', input) },
    invoices: { list: input => request('/invoices' + query(input)), read: value => request('/invoices/' + id(value)), document: value => request('/invoices/' + id(value) + '/document') },
    payments: { list: input => request('/payments' + query(input)) },
    refunds: { create: input => request('/refunds', input), list: input => request('/refunds' + query(input)) },
    entitlements: { read: () => request('/entitlements') }, reconcile: () => request('/reconcile', {}),
    async *watch(input) {
      const key = boundary().key; check(key);
      const controller = new AbortController(), abort = () => controller.abort();
      input?.signal?.addEventListener('abort', abort);
      if (input?.signal?.aborted) controller.abort();
      const unsubscribe = transport.subscribeBoundary?.(() => { try { check(key); } catch { controller.abort(); } });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await transport.request<Response>(prefix + '/events', { signal: controller.signal, json: false }); check(key);
        if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new PaymentsClientError('Invalid billing event stream.', 'PAYMENTS_STREAM_INVALID');
        reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        while (!controller.signal.aborted) {
          const part = await reader.read(); if (part.done) break;
          check(key); buffer += decoder.decode(part.value, { stream: true }).replace(/\r\n/g, '\n');
          if (buffer.length > 65536) throw new PaymentsClientError('Billing event stream exceeded its buffer limit.', 'PAYMENTS_STREAM_INVALID');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const message = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (message.startsWith('event: stopped')) throw new PaymentsClientError('Billing stream stopped. Reauthorize before reconnecting.', 'PAYMENTS_STREAM_STOPPED');
            if (!message.startsWith('event: revision')) continue;
            const line = message.split('\n').find(line => line.startsWith('data: '));
            const event = line ? JSON.parse(line.slice(6)) : null;
            if (!Number.isSafeInteger(event?.revision) || event.revision < 0) throw new PaymentsClientError('Invalid billing event.', 'PAYMENTS_STREAM_INVALID');
            check(key); yield { revision: event.revision };
          }
        }
      } finally { controller.abort(); await reader?.cancel().catch(() => {}); reader?.releaseLock(); unsubscribe?.(); input?.signal?.removeEventListener('abort', abort); }
    },
  };
}
