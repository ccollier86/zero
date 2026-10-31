'use client';
/** Reusable native destination chooser. It exposes current capabilities, never a user/contact picker or staff identity list. */
import { Button } from '../ui/button';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
import { useSupportInboxes } from './use-support-inboxes';

export function WorkspaceSupportStart({ controller, state, onStarted }: { controller: MessagingWorkspaceController; state: MessagingWorkspaceState; onStarted(): void }) {
  const named = state.capabilities?.supportInboxes === true, inboxes = useSupportInboxes(controller, named);
  const items = inboxes.items.filter(item => item.canOpen), locked = !!state.command && state.command.phase !== 'rejected';
  const open = async (mode?: 'assistant' | 'human', inboxId?: string) => {
    await controller.openSupport(mode, inboxId);
    if (controller.current() && !controller.getSnapshot().command) onStarted();
  };
  if (named) return <div className="zero-messaging-start-section" aria-label="Message destinations">
    {inboxes.loading ? <p role="status" className="zero-messaging-workspace-hint">Loading message destinations…</p> : inboxes.error ? <div role="alert">
      <p className="zero-messaging-workspace-hint">Message destinations could not be loaded.</p><Button size="xs" variant="ghost" onClick={inboxes.retry}>Retry destinations</Button>
    </div> : items.length ? items.map(inbox => <div key={inbox.id} className="zero-messaging-start-section">
      <Button size="sm" variant="outline" disabled={locked} onClick={() => { void open(undefined, inbox.id); }}>Message {inbox.title}</Button>
      {inbox.assistant && <Button size="xs" variant="ghost" disabled={locked} onClick={() => { void open('human', inbox.id); }}>Talk to a person · {inbox.title}</Button>}
    </div>) : <p role="status" className="zero-messaging-workspace-hint">No message destinations are available under your current access.</p>}
  </div>;
  return <div className="zero-messaging-start-section">
    {state.capabilities?.supportAssistant && <Button size="sm" variant="ghost" disabled={locked} onClick={() => { void open('assistant'); }}>Ask the support assistant</Button>}
    <Button size="sm" variant="outline" disabled={locked} onClick={() => { void open('human'); }}>{state.capabilities?.portal ? 'Message the team' : 'Talk to a person'}</Button>
  </div>;
}
