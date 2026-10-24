import type { ScopedPayments } from '@zero/framework/payments';
import { PaymentsError } from './errors';

/** Exact, bounded raw bytes. No JSON parser may run before Stripe signature verification. */
export async function readWebhookBody(request: Request, maximum = 512 * 1024): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new PaymentsError('Webhook body is too large.', 'PAYMENTS_WEBHOOK_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PaymentsError('Webhook body is required.', 'PAYMENTS_WEBHOOK_BODY_REQUIRED', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new PaymentsError('Webhook body is too large.', 'PAYMENTS_WEBHOOK_TOO_LARGE', 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new PaymentsError('Webhook body must be valid UTF-8.', 'PAYMENTS_WEBHOOK_FORMAT_INVALID', 400); }
}
export function paymentErrorResponse(error: PaymentsError): Response {
  return Response.json({ error: error.message, code: error.code, outcome: error.outcome, retryable: error.retryable }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
}
export async function paymentEndpoint(run: () => unknown | Promise<unknown>): Promise<unknown> {
  try { const result = await run(); return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { if (error instanceof PaymentsError) return paymentErrorResponse(error); throw error; }
}
export async function paymentEvents(payments: ScopedPayments, request: Request): Promise<Response> {
  // Establish Guardian admission before starting a 200 stream; the generator rechecks on every delivery/heartbeat.
  await payments.snapshot();
  const abort = new AbortController(), encoder = new TextEncoder();
  const iterator = payments.watch({ signal: abort.signal })[Symbol.asyncIterator]();
  let ended = false, source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cleanup = () => { abort.abort(); request.signal.removeEventListener('abort', onAbort); void iterator.return?.().catch(() => {}); };
  const onAbort = () => { if (!ended) { ended = true; source?.close(); } cleanup(); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { source = controller; request.signal.addEventListener('abort', onAbort, { once: true }); if (request.signal.aborted) onAbort(); },
    async pull(controller) {
      if (ended) return;
      try {
        const next = await iterator.next();
        if (ended) return;
        if (next.done) { ended = true; controller.close(); cleanup(); return; }
        controller.enqueue(encoder.encode(`event: revision\ndata: ${JSON.stringify(next.value)}\n\n`));
      } catch {
        if (!ended) { ended = true; controller.enqueue(encoder.encode('event: stopped\ndata: {"code":"PAYMENTS_STREAM_STOPPED"}\n\n')); controller.close(); cleanup(); }
      }
    },
    cancel() { ended = true; cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
}
