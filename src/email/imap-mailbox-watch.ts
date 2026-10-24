/** IMAP IDLE subscription ownership, bounded backpressure and reconnect recovery. */
import { setTimeout as delay } from 'node:timers/promises';
import type { ImapFlow } from 'imapflow';
import { EmailError } from './email-error';
import { normalizeImapError, requireMailbox } from './imap-mailbox';
import type { MailboxChange, MailWatchOptions } from './mailbox-types';

type Factory = () => { client: ImapFlow; release(): void };

export function watchImapMailbox(factory: Factory, ready: () => boolean, stop: AbortSignal, options: MailWatchOptions, timeoutMs = 30_000): AsyncIterable<MailboxChange> {
  return { [Symbol.asyncIterator]() {
    const controller = new AbortController();
    const signal = AbortSignal.any([stop, controller.signal, ...(options.signal ? [options.signal] : [])]);
    const iterator = watch(factory, ready, signal, options.folder ?? 'INBOX', timeoutMs);
    return {
      next: () => iterator.next(),
      return: async () => { controller.abort(); return iterator.return(); },
      throw: async (error: unknown) => { controller.abort(); return iterator.throw(error); },
    };
  } };
}

async function* watch(factory: Factory, ready: () => boolean, signal: AbortSignal, folder: string, timeoutMs: number): AsyncGenerator<MailboxChange, void> {
  let connectedBefore = false, backoff = 250;
  while (!signal.aborted) {
    if (!ready()) throw new EmailError('IMAP receiving is not configured', 'EMAIL_PROVIDER_MISCONFIGURED', 500);
    const owned = factory(), client = owned.client;
    let disconnected = false, error: unknown, wake: (() => void) | undefined;
    const queue: MailboxChange[] = [];
    const resync = (reason: 'connected' | 'reconnected' | 'overflow' | 'sequence-expunge' | 'unidentified-flags'): MailboxChange => {
      const box = requireMailbox(client);
      return { type: 'resync', reason, folder, uidValidity: box.uidValidity.toString(), total: box.exists, uidNext: box.uidNext };
    };
    const enqueue = (change: MailboxChange) => {
      if (queue.length >= 128) { queue.length = 0; queue.push(resync('overflow')); }
      else queue.push(change);
      wake?.(); wake = undefined;
    };
    const disconnectedNow = () => { disconnected = true; wake?.(); wake = undefined; };
    const abort = () => { disconnectedNow(); client.close(); };
    client.on('error', value => { error = value; disconnectedNow(); });
    client.on('close', disconnectedNow);
    client.on('exists', value => { if (client.mailbox) enqueue({ type: 'arrival', folder, uidValidity: client.mailbox.uidValidity.toString(), total: value.count, previousTotal: value.prevCount }); });
    client.on('flags', value => { if (client.mailbox) enqueue(value.uid
      ? { type: 'flags', folder, uidValidity: client.mailbox.uidValidity.toString(), uid: value.uid, flags: [...value.flags] }
      : resync('unidentified-flags')); });
    client.on('expunge', value => { if (client.mailbox) enqueue(value.uid
      ? { type: 'removed', folder, uidValidity: client.mailbox.uidValidity.toString(), uid: value.uid }
      : resync('sequence-expunge')); });
    signal.addEventListener('abort', abort, { once: true });
    let lock: { release(): void } | undefined;
    const deadline = setTimeout(() => { error = new EmailError('Mailbox subscription connection timed out', 'EMAIL_DELIVERY_TIMEOUT', 504); abort(); }, timeoutMs);
    try {
      if (signal.aborted) return;
      await client.connect();
      if (!client.capabilities.has('IDLE')) throw new EmailError('This IMAP server does not support live IDLE subscriptions', 'EMAIL_MAILBOX_IDLE_UNSUPPORTED', 409);
      lock = await client.getMailboxLock(folder, { readOnly: true });
      clearTimeout(deadline);
      const initial = resync(connectedBefore ? 'reconnected' : 'connected');
      connectedBefore = true; backoff = 250;
      // Observe all work, including rejected IDLE promises, before yielding control.
      const idle = (async () => {
        while (!signal.aborted && !disconnected) {
          await client.idle();
          if (!signal.aborted && !disconnected) await delay(10, undefined, { signal });
        }
      })().catch(value => { error = value; disconnectedNow(); });
      yield initial;
      while (!signal.aborted && (!disconnected || queue.length)) {
        if (queue.length) yield queue.shift()!;
        else await new Promise<void>(resolve => { wake = resolve; });
      }
      client.close(); await idle;
      if (error && !signal.aborted) throw error;
    } catch (value) {
      if (signal.aborted) return;
      const failure = normalizeImapError(value);
      if (failure.status >= 400 && failure.status < 500) throw failure;
      // Transient disconnects reconnect; the next event always requests cursor reconciliation.
    } finally {
      clearTimeout(deadline); signal.removeEventListener('abort', abort);
      lock?.release(); owned.release();
    }
    if (!signal.aborted) {
      try { await delay(backoff, undefined, { signal }); } catch { return; }
      backoff = Math.min(30_000, backoff * 2);
    }
  }
}
