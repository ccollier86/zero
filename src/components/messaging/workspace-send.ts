/** Exact-intent send ownership. Unknown outcomes require a read/check or explicit same-key retry. */
import type { DurableMessage } from '../../messaging/contracts';
import type { WorkspaceSource, MessagingWorkspaceDraft } from './workspace-state';
import { EMPTY_MESSAGING_DRAFT, messagingWriteWasRejected } from './workspace-state';
interface SendMode { readonly visibility?: 'conversation' | 'staff'; readonly expectedOwnerEpoch?: number }
interface Pending extends SendMode { readonly requestId: string; readonly text: string; readonly attachmentIds: readonly string[]; task?: Promise<void> }
export class MessagingWorkspaceSends {
  private readonly drafts = new Map<string, MessagingWorkspaceDraft>();
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly source: WorkspaceSource, private readonly current: () => boolean, private readonly signal: AbortSignal,
    private readonly changed: () => void, private readonly accepted: (id: string, message: DurableMessage) => void) {}
  draft(id: string, visibility: 'conversation' | 'staff' = 'conversation'): MessagingWorkspaceDraft { return this.drafts.get(draftKey(id, visibility)) ?? EMPTY_MESSAGING_DRAFT; }
  hasUnfinished(): boolean { return this.drafts.size > 0 || this.pending.size > 0; }
  edit(id: string, text: string, maximum: number, visibility: 'conversation' | 'staff' = 'conversation'): void {
    id = draftKey(id, visibility);
    if (!this.current() || this.pending.has(id)) return;
    if (!this.drafts.has(id) && this.drafts.size >= 32) throw new Error('Finish or clear an existing message draft first.');
    if (text.length > maximum) throw new Error('The draft exceeds the configured character limit.');
    if (!text) this.drafts.delete(id); else this.drafts.set(id, { text, phase: 'editing', requestId: null, error: null });
    this.changed();
  }
  send(id: string, attachments: readonly string[] = [], retry = false, mode: SendMode = {}): Promise<void> {
    if (!this.current()) return Promise.reject(new DOMException('Messaging scope changed.', 'AbortError'));
    const key = draftKey(id, mode.visibility ?? 'conversation');
    let pending = this.pending.get(key);
    if (pending?.task) return pending.task;
    if (pending && !retry) return Promise.resolve();
    if (!pending) {
      const draft = this.draft(id, mode.visibility); if (!draft.text.trim() && !attachments.length) return Promise.resolve();
      pending = { requestId: crypto.randomUUID(), text: draft.text, attachmentIds: [...attachments], ...mode }; this.pending.set(key, pending);
    }
    const active = pending;
    this.set(key, { text: active.text, phase: 'sending', requestId: active.requestId, error: null });
    const work = Promise.resolve().then(async () => {
      try {
        const message = await this.source.messages.send(id, { text: active.text, attachmentIds: active.attachmentIds, visibility: active.visibility, expectedOwnerEpoch: active.expectedOwnerEpoch }, { requestId: active.requestId, signal: this.signal });
        if (this.current()) this.finish(id, key, active, message);
      } catch (error) {
        if (!this.current()) return;
        if (messagingWriteWasRejected(error)) { this.pending.delete(key); this.set(key, { text: active.text, phase: 'rejected', requestId: null, error: 'This message was not accepted. Review it before trying again.' }); }
        else this.set(key, { text: active.text, phase: 'unknown', requestId: active.requestId, error: 'The send result is unconfirmed. Check its result or retry this same message; do not create another copy.' });
      } finally { if (this.pending.get(key) === active) active.task = undefined; }
    }); active.task = work; return work;
  }
  reconcile(id: string, visibility: 'conversation' | 'staff' = 'conversation'): Promise<void> {
    const key = draftKey(id, visibility), pending = this.pending.get(key); if (!pending || !this.current()) return Promise.resolve();
    if (pending.task) return pending.task;
    const task = Promise.resolve().then(async () => { try {
      const receipt = await this.source.receipt(pending.requestId, { signal: this.signal }); if (!this.current()) return;
      if (!receipt) { this.set(key, { ...this.draft(id, visibility), error: 'No accepted receipt is available yet. Only an explicit retry with the same request identity is safe.' }); return; }
      if (receipt.requestId !== pending.requestId || receipt.operation !== 'message.send' || !receipt.resourceId) throw new Error('Incompatible send receipt.');
      const message = await this.source.messages.get(id, receipt.resourceId, { signal: this.signal });
      if (this.current()) this.finish(id, key, pending, message, receipt.resourceId);
    } catch {
      if (this.current() && this.pending.get(key) === pending) this.set(key, { ...this.draft(id, visibility), error: 'The original send could not be reconciled. Its request identity is retained.' });
    } finally { if (this.pending.get(key) === pending) pending.task = undefined; } });
    pending.task = task; return task;
  }
  private finish(id: string, key: string, pending: Pending, message: DurableMessage, receiptId?: string): void {
    if (this.pending.get(key) !== pending || message.conversationId !== id || message.visibility !== (pending.visibility ?? 'conversation') || (receiptId ? message.id !== receiptId : message.text !== pending.text
      || JSON.stringify(message.attachmentIds) !== JSON.stringify(pending.attachmentIds))) throw new Error('Incompatible send acknowledgment.');
    this.pending.delete(key); this.drafts.delete(key); this.accepted(id, message); this.changed();
  }
  private set(id: string, draft: MessagingWorkspaceDraft): void { this.drafts.set(id, draft); this.changed(); }
  clear(): void { this.drafts.clear(); this.pending.clear(); }
}
const draftKey = (id: string, visibility: 'conversation' | 'staff') => JSON.stringify([id, visibility]);
