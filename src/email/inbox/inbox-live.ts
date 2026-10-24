import type { EmailInboxLiveEvent } from './contracts';
import type { EmailInboxServerAccount } from './server-types';

interface Hub { abort: AbortController; listeners: Set<(value: EmailInboxLiveEvent | Error) => void>; ended: boolean }
/** One IDLE connection per actual mailbox/folder, not per React part or subscriber. */
export class EmailInboxLive {
  private readonly owners = new Map<EmailInboxServerAccount['mailbox'], Map<string, Hub>>();
  private closed = false;
  notify(mailbox: EmailInboxServerAccount['mailbox']): void {
    for (const hub of this.owners.get(mailbox)?.values() ?? []) for (const listener of hub.listeners) listener({ type: 'connected' });
  }
  async *watch(account: EmailInboxServerAccount, folder: string, signal: AbortSignal): AsyncIterable<EmailInboxLiveEvent> {
    if (this.closed || signal.aborted) return;
    let hubs = this.owners.get(account.mailbox);
    if (!hubs) { hubs = new Map(); this.owners.set(account.mailbox, hubs); }
    let hub = hubs.get(folder), created = false;
    if (hub?.ended) { hubs.delete(folder); hub = undefined; }
    if (!hub) {
      if ([...this.owners.values()].reduce((sum, value) => sum + value.size, 0) >= 64) throw new Error('Email live subscription limit reached.');
      hub = { abort: new AbortController(), listeners: new Set(), ended: false }; hubs.set(folder, hub); created = true;
    }
    const queue: (EmailInboxLiveEvent | Error)[] = [{ type: 'connected' }];
    let wake: (() => void) | undefined;
    const listener = (event: EmailInboxLiveEvent | Error) => {
      if (event instanceof Error) { queue.length = 0; queue.push(event); }
      else if (queue.length >= 128) { queue.length = 0; queue.push({ type: 'connected' }); }
      else queue.push(event);
      wake?.(); wake = undefined;
    };
    hub.listeners.add(listener);
    let cleaned = false;
    const abort = () => {
      if (!cleaned) {
        cleaned = true; signal.removeEventListener('abort', abort); hub!.listeners.delete(listener);
        if (!hub!.listeners.size) { hub!.abort.abort(); if (hubs!.get(folder) === hub) hubs!.delete(folder); if (!hubs!.size && this.owners.get(account.mailbox) === hubs) this.owners.delete(account.mailbox); }
      }
      wake?.(); wake = undefined;
    };
    signal.addEventListener('abort', abort, { once: true });
    if (created && folder !== '@drafts') {
      const owned = hub;
      void (async () => {
        try { for await (const event of account.mailbox.watch({ folder, signal: owned.abort.signal })) {
          for (const fn of owned.listeners) fn(event);
        } } catch { /* A clean end and a transport failure both require a fresh provider subscription. */ }
        finally { owned.ended = true; if (!owned.abort.signal.aborted) for (const fn of owned.listeners) fn(new Error('Live mail disconnected. Reconnecting is required.')); }
      })();
    }
    try {
      while (!signal.aborted && !hub.abort.signal.aborted) {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        if (next) { yield next; continue; }
        await new Promise<void>(resolve => { wake = resolve; });
      }
    } finally {
      abort();
    }
  }
  close(): void {
    this.closed = true;
    for (const hubs of this.owners.values()) for (const hub of hubs.values()) {
      hub.abort.abort(); for (const listener of hub.listeners) listener(new Error('Email inbox stopped.'));
    }
    this.owners.clear();
  }
}
