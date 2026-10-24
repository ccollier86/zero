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
  return Response.json({ error: error.message, code: error.code, outcome: error.outcome }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
}
export async function paymentEndpoint(run: () => unknown | Promise<unknown>): Promise<unknown> {
  try { const result = await run(); return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { if (error instanceof PaymentsError) return paymentErrorResponse(error); throw error; }
}
export async function paymentEvents(payments: ScopedPayments, request: Request): Promise<Response> {
  // Establish Guardian admission before starting a 200 stream; the generator rechecks on every delivery/heartbeat.
  await payments.snapshot();
  const abort = new AbortController(), encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of payments.watch({ signal: abort.signal })) {
          if (abort.signal.aborted || request.signal.aborted) break;
          controller.enqueue(encoder.encode(`event: revision\ndata: ${JSON.stringify(event)}\n\n`));
        }
      } catch { if (!abort.signal.aborted) controller.enqueue(encoder.encode('event: stopped\ndata: {"code":"PAYMENTS_STREAM_STOPPED"}\n\n')); }
      finally { if (!abort.signal.aborted) controller.close(); }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
}
