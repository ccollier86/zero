'use client';
import { Button } from '../ui/button';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
export function WorkspaceSupportActions({ controller, state }: { controller: MessagingWorkspaceController; state: MessagingWorkspaceState }) {
  const conversation = state.conversation;
  if (!state.capabilities?.support || conversation?.kind !== 'support' || conversation.participants.find(row => row.id === controller.userId)?.role !== 'customer') return null;
  const busy = !!state.command && state.command.phase !== 'rejected';
  return conversation.owner === 'assistant' ? <Button size="sm" variant="outline" disabled={busy || conversation.archived} onClick={() => { void controller.requestHuman(); }}>Talk to a person</Button>
    : <span role="status" className="zero-messaging-workspace-hint">{conversation.owner === 'triage' ? 'Waiting for a person' : 'Assigned to support'}</span>;
}
