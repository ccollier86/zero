/** One explicit workspace-management intent, retained across popover/selection changes. No automatic mutation retry. */
import type { MessagingMutationOptions, MessagingReceipt } from '../../messaging/contracts';
import type { WorkspaceSource } from './workspace-state';
import { messagingErrorCode, messagingWriteWasRejected } from './workspace-state';
export interface MessagingWorkspaceCommand { readonly label: string; readonly phase: 'running' | 'unknown' | 'rejected'; readonly error: string | null }
interface Command { readonly requestId: string; readonly run: (options: MessagingMutationOptions) => Promise<unknown>; readonly reconcile: (receipt: MessagingReceipt) => Promise<unknown>;
  readonly accept: (value: unknown) => void; readonly label: string; task?: Promise<void> }
export class MessagingWorkspaceCommands {
  private pending: Command | null = null; private state: MessagingWorkspaceCommand | null = null;
  constructor(private readonly source: WorkspaceSource, private readonly current: () => boolean, private readonly signal: AbortSignal, private readonly changed: () => void) {}
  snapshot(): MessagingWorkspaceCommand | null { return this.state; }
  execute<T>(label: string, run: (options: MessagingMutationOptions) => Promise<T>, reconcile: (receipt: MessagingReceipt) => Promise<T>, accept: (value: T) => void): Promise<void> {
    if (!this.current() || this.pending) return this.pending?.task ?? Promise.resolve();
    this.pending = { label, run, reconcile, accept: value => accept(value as T), requestId: crypto.randomUUID() }; return this.perform(this.pending, false);
  }
  retry(): Promise<void> { return this.pending && this.current() ? this.perform(this.pending, false) : Promise.resolve(); }
  check(): Promise<void> { return this.pending && this.current() ? this.perform(this.pending, true) : Promise.resolve(); }
  clear(): void { this.pending = null; this.state = null; }
  private perform(command: Command, check: boolean): Promise<void> {
    if (command.task) return command.task;
    this.set({ label: command.label, phase: 'running', error: null });
    const work = Promise.resolve().then(async () => {
      try {
        let value: unknown;
        if (check) {
          const receipt = await this.source.receipt(command.requestId, { signal: this.signal });
          if (!this.current()) return;
          if (!receipt || receipt.requestId !== command.requestId) { this.set({ label: command.label, phase: 'unknown', error: 'No accepted receipt is available yet. The original request identity is retained.' }); return; }
          value = await command.reconcile(receipt);
        } else value = await command.run({ requestId: command.requestId, signal: this.signal });
        if (!this.current() || this.pending !== command) return;
        command.accept(value); this.pending = null; this.set(null);
      } catch (error) {
        if (!this.current() || this.pending !== command) return;
        const rejected = !check && messagingWriteWasRejected(error);
        if (rejected) this.pending = null;
        this.set({ label: command.label, phase: rejected ? 'rejected' : 'unknown', error: rejected ? messagingErrorCode(error) === 'MESSAGING_CONTACT_REQUIRED'
          ? 'An accepted contact request is required before this conversation can start.' : 'This change was not accepted. Refresh the current state before trying again.'
          : 'This change has an unconfirmed result. Check it or explicitly retry the same original request.' });
      } finally { command.task = undefined; }
    }); command.task = work; return work;
  }
  private set(value: MessagingWorkspaceCommand | null): void { this.state = value; this.changed(); }
}
