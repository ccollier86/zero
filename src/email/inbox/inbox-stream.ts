/** Pull-based delivery: a paused browser never accumulates keepalive frames. */
import type { ZeroLifecycleContext } from '../../frontend/server/server-extensions';
import type { EmailInboxService } from './inbox-service';
import { EmailError } from '../email-error';

export async function emailInboxEvents(service: EmailInboxService, context: ZeroLifecycleContext, accountId: string, folder: string): Promise<Response> {
  const guards = service.authority(context), bound = await service.account(context, accountId);
  guards.check();
  if (bound.live === false) throw new EmailError('Live mail is not available.', 'EMAIL_MAILBOX_UNSUPPORTED', 409);
  const abort = new AbortController(), signal = AbortSignal.any([abort.signal, context.request.signal, service.signal]);
  const iterator = service.live.watch(bound, folder, signal)[Symbol.asyncIterator](), encoder = new TextEncoder();
  let ended = false, controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let pending: ReturnType<typeof iterator.next> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => { if (timer) clearTimeout(timer); signal.removeEventListener('abort', retire); abort.abort(); void iterator.return?.().catch(() => {}); };
  const retire = () => { if (!ended) { ended = true; controller?.close(); } cleanup(); };
  const stream = new ReadableStream<Uint8Array>({
    start(source) { controller = source; signal.addEventListener('abort', retire, { once: true }); if (signal.aborted) retire(); },
    async pull(source) {
      if (ended) return;
      try {
        pending ??= iterator.next();
        const next = await Promise.race([pending, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 10_000); })]);
        if (timer) clearTimeout(timer);
        if (ended) return;
        const current = await service.account(context, accountId); guards.check();
        if (ended || current.mailbox !== bound.mailbox || current.live === false) { retire(); return; }
        if (next === null) source.enqueue(encoder.encode(': keepalive\n\n'));
        else {
          pending = undefined;
          if (next.done) { retire(); return; }
          source.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
        }
      } catch { retire(); }
    },
    cancel() { ended = true; cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } });
}
