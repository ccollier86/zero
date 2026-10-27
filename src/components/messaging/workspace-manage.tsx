'use client';
import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger, PopoverViewport } from '../popover';
import { ScrollArea } from '../ui/scroll-area';
import { modals } from '../../modals';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
import type { MessagingDirectoryEntry } from '../../messaging/contracts';
export function WorkspaceManage({ controller, state }: { controller: MessagingWorkspaceController; state: MessagingWorkspaceState }) {
  const conversation = state.conversation!;
  const [open, setOpen] = useState(false), [edit, setEdit] = useState<{ id: string; value: string } | null>(null), [query, setQuery] = useState('');
  const [people, setPeople] = useState<readonly MessagingDirectoryEntry[]>([]);
  const own = conversation.participants.find(row => row.id === controller.userId), configured = !!conversation.managedGroupId;
  const owner = own?.role === 'owner', staff = own?.role === 'staff', busy = !!state.command && state.command.phase !== 'rejected';
  const title = edit?.id === conversation.id ? edit.value : conversation.title;
  useEffect(() => {
    if (!open || !owner || configured || conversation.kind !== 'group') return;
    const abort = new AbortController(), timer = setTimeout(() => { void controller.source.directory({ search: query, limit: 50 }, { signal: abort.signal })
      .then(page => { if (!abort.signal.aborted && controller.current()) setPeople(page.items); }).catch(() => { if (!abort.signal.aborted && controller.current()) setPeople([]); }); }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [controller, open, owner, configured, conversation.id, conversation.kind, query]);
  const destructive = async (action: 'archive' | 'remove' | 'transfer', value: string | undefined, label: string, trigger: HTMLElement) => {
    const id = conversation.id;
    if (!await modals.confirm({ title: label, description: action === 'archive' ? 'The conversation and its retained messages are preserved. You can restore it from Archived.'
      : action === 'transfer' ? 'The selected member becomes the group owner. Your own membership is retained.' : 'Current membership and history rules apply immediately. This does not erase prior accepted messages.',
      confirmLabel: label, variant: action === 'transfer' ? 'default' : 'destructive', trigger })) return;
    if (controller.current() && controller.getSnapshot().selectedId === id) { setOpen(false); await controller.manage(action, value); }
  };
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Conversation options"><Settings2 /></Button></PopoverTrigger>
    <PopoverContent align="end" className="zero-messaging-start" aria-label="Conversation settings"><h3>Conversation settings</h3><PopoverViewport className="zero-messaging-start-body" style={{ maxHeight: 'min(36rem, calc(var(--radix-popover-content-available-height, 100dvh) - 4rem))' }}>
      {configured && <p className="zero-messaging-workspace-hint">Membership and name are managed by organization policy.</p>}
      {owner && !configured && <><Input aria-label="Conversation name" value={title} maxLength={200} disabled={busy} onChange={event => setEdit({ id: conversation.id, value: event.target.value })} />
        <Button size="sm" variant="outline" disabled={busy || title === conversation.title} onClick={() => { void controller.manage('rename', title).then(() => { if (controller.current() && !controller.getSnapshot().command) setEdit(null); }); }}>Save conversation name</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={event => { void destructive('archive', undefined, conversation.archived ? 'Restore conversation' : 'Archive conversation', event.currentTarget); }}>{conversation.archived ? 'Restore conversation' : 'Archive conversation'}</Button></>}
      {staff && <div className="zero-messaging-start-section"><Button size="sm" variant="outline" disabled={busy || conversation.owner === 'human' && conversation.ownerId === controller.userId} onClick={() => { void controller.manage('takeover'); }}>Take ownership</Button>
        <Button size="sm" variant="ghost" disabled={busy || conversation.owner !== 'human' || conversation.ownerId !== controller.userId} onClick={() => { void controller.manage('hand-back', 'triage'); }}>Return to triage</Button>
        {conversation.assistantId && <Button size="sm" variant="ghost" disabled={busy || conversation.owner !== 'human' || conversation.ownerId !== controller.userId} onClick={() => { void controller.manage('hand-back', 'assistant'); }}>Return to assistant</Button>}</div>}
      <h4>Participants</h4><ScrollArea className="zero-messaging-start-scroll" style={{ height: Math.min(240, conversation.participants.length * 56) }}><div>{conversation.participants.map(member => {
        const name = state.people[member.id]?.name ?? member.name ?? (member.kind === 'assistant' ? 'Assistant' : 'Member');
        return <div key={member.id} className="zero-messaging-member-row" data-participant-id={member.id}><span>{name}<small>{member.role}</small></span>
          {owner && !configured && conversation.kind === 'group' && member.role === 'member' && member.kind === 'user' && <div><Button size="xs" variant="ghost" disabled={busy} onClick={event => { void destructive('transfer', member.id, 'Transfer ownership', event.currentTarget); }}>Make owner</Button>
            {conversation.kind === 'group' && <Button size="xs" variant="ghost" disabled={busy} onClick={event => { void destructive('remove', member.id, 'Remove participant', event.currentTarget); }}>Remove</Button>}</div>}
        </div>;
      })}</div></ScrollArea>
      {!configured && owner && conversation.kind === 'group' && <><Input aria-label="Find participant to add" value={query} placeholder="Find a person to add…" onChange={event => setQuery(event.target.value)} disabled={busy} />
        <div className="zero-messaging-add-list">{people.filter(person => !conversation.participants.some(row => row.id === person.id)).map(person => <Button size="sm" variant="ghost" key={person.id} disabled={busy}
          onClick={() => { void controller.manage('add', person.id); }}>Add {person.name}</Button>)}</div></>}
      {!configured && conversation.kind === 'group' && own && own.role !== 'owner' && own.role !== 'staff' && <Button size="sm" variant="ghost" disabled={busy} onClick={event => { void destructive('remove', controller.userId, 'Leave conversation', event.currentTarget); }}>Leave conversation</Button>}
      {owner && !configured && conversation.kind === 'group' && <p className="zero-messaging-workspace-hint">Transfer ownership to another member before leaving.</p>}
      {state.command?.error && <p role="alert" className="zero-messaging-workspace-notice">{state.command.error}</p>}
      {state.command?.phase === 'unknown' && <div className="zero-messaging-workspace-tools"><Button size="xs" onClick={() => { void controller.checkCommand(); }}>Check change</Button><Button size="xs" variant="outline" onClick={() => { void controller.retryCommand(); }}>Retry same change</Button></div>}</PopoverViewport>
    </PopoverContent></Popover>;
}
